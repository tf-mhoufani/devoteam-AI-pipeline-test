import { consoleLogger, type Logger } from "#helpers/logger";
import type {
  Anomaly,
  IncidentCluster,
  PartialAnalysisReport,
  Recommendation,
} from "#types/schema";
import type { PipelineContext } from "#types/pipeline";
import {
  buildClusterRecommendationPrompt,
  buildRecommendationPrompt,
  buildStatusRecommendationPrompt,
  buildSynthesisPrompt,
  hasUnhealthyServices,
  unhealthyServicesFrom,
} from "./buildRecommendationPrompt";
import {
  GROQ_CLUSTER_SYSTEM_PROMPT,
  GROQ_STATUS_SYSTEM_PROMPT,
  GROQ_SYNTHESIS_SYSTEM_PROMPT,
  GROQ_SYSTEM_PROMPT,
} from "./generateRecommendations.constants";
import { groupAnomaliesByMetric } from "./groupAnomaliesByMetric";
import { getBatchPauseMs } from "#services/groq";
import { sleep } from "#helpers/sleep";
import {
  requestRecommendations,
  type GroqPrompts,
} from "./requestRecommendations";

type GroqJob = GroqPrompts & {
  label: string;
};

/**
 * Adds a unique ID to each recommendation.
 * @param recommendations - The recommendations to add unique IDs to.
 * @returns The recommendations with unique IDs.
 */
const withUniqueIds = (recommendations: Recommendation[]): Recommendation[] =>
  recommendations.map((recommendation, index) => ({
    ...recommendation,
    id: `REC-${String(index + 1).padStart(3, "0")}`,
  }));

/**
 * Creates the jobs for the Groq API.
 * @param state - The state of the analysis.
 * @returns The jobs for the Groq API.
 */
const timestampsCoveredByClusters = (
  clusters: IncidentCluster[],
): Set<string> => {
  const covered = new Set<string>();

  for (const cluster of clusters) {
    if (cluster.log_count === 0) continue;
    for (const timestamp of cluster.timestamps) {
      covered.add(timestamp);
    }
  }

  return covered;
};

const anomaliesRemainingAfterClusters = (
  anomalies: Anomaly[],
  clusters: IncidentCluster[],
): Anomaly[] => {
  const covered = timestampsCoveredByClusters(clusters);
  return anomalies.filter((anomaly) => !covered.has(anomaly.timestamp));
};

const jobsFrom = (state: PartialAnalysisReport): GroqJob[] => {
  const jobs: GroqJob[] = [];
  const clusters = state.incident_clusters ?? [];

  for (const cluster of clusters) {
    if (cluster.log_count === 0) continue;

    const label =
      cluster.type === "temporal_cascade"
        ? `cascade: ${cluster.metrics.join(" → ")}, ${cluster.log_count} events`
        : `cluster: ${cluster.metrics.join(" + ")}, ${cluster.log_count} logs`;

    jobs.push({
      label,
      userContent: buildClusterRecommendationPrompt(
        state.insights,
        cluster,
        state.service_status_summary,
      ),
      systemPrompt: GROQ_CLUSTER_SYSTEM_PROMPT,
    });
  }

  const remaining = anomaliesRemainingAfterClusters(
    state.anomalies ?? [],
    clusters,
  );
  const groups = groupAnomaliesByMetric(remaining);

  jobs.push(
    ...groups.map((group) => ({
      label: `${group.metric}, ${group.count} peaks`,
      userContent: buildRecommendationPrompt(
        state.insights,
        group,
        state.service_status_summary,
      ),
      systemPrompt: GROQ_SYSTEM_PROMPT,
    })),
  );

  const unhealthy = unhealthyServicesFrom(state.service_status_summary);
  if (hasUnhealthyServices(unhealthy)) {
    const degraded = unhealthy.degraded.join(", ") || "none";
    const offline = unhealthy.offline.join(", ") || "none";
    jobs.push({
      label: `service_status: degraded ${degraded}; offline ${offline}`,
      userContent: buildStatusRecommendationPrompt(
        state.insights,
        unhealthy,
        state.service_status_summary,
      ),
      systemPrompt: GROQ_STATUS_SYSTEM_PROMPT,
    });
  }

  return jobs;
};

/**
 * Synthesizes the recommendations.
 * @param state - The state of the analysis.
 * @param drafts - The drafts of the recommendations.
 * @returns The synthesized recommendations.
 */
const synthesizeRecommendations = async (
  state: PartialAnalysisReport,
  drafts: Recommendation[],
  logger: Logger,
): Promise<Recommendation[]> => {
  if (drafts.length < 2) return drafts;

  await sleep(getBatchPauseMs());
  logger.info(
    `Groq synthesis (${drafts.length} recommendations → filter and rank)...`,
  );

  const synthesized = await requestRecommendations(
    {
      userContent: buildSynthesisPrompt(
        state.insights,
        drafts,
        state.service_status_summary,
      ),
      systemPrompt: GROQ_SYNTHESIS_SYSTEM_PROMPT,
    },
    logger,
  );

  if (synthesized.length === 0) {
    logger.warn("Groq synthesis returned no recommendations, keeping drafts");
    return drafts;
  }

  logger.info(`${synthesized.length} recommendation(s) after synthesis`);
  return synthesized;
};

/**
 * Asks Groq for corrective actions per metric group, then for degraded / offline
 * services, then a synthesis pass to drop duplicates and rank by criticality.
 */
export const generateRecommendations = async (
  state: PartialAnalysisReport,
  ctx: PipelineContext = { logs: [] },
): Promise<PartialAnalysisReport> => {
  const logger = ctx.logger ?? consoleLogger;
  const jobs = jobsFrom(state);

  // If there are no jobs, return the state with no recommendations
  if (jobs.length === 0) {
    return { ...state, recommendations: [] };
  }

  const recommendations: Recommendation[] = [];
  const total = jobs.length;

  // Loop through the jobs and request recommendations from the Groq API
  for (const [index, job] of jobs.entries()) {
    if (index > 0) await sleep(getBatchPauseMs());

    logger.info(`Groq batch ${index + 1}/${total} (${job.label})...`);

    const received = await requestRecommendations(
      {
        userContent: job.userContent,
        systemPrompt: job.systemPrompt,
      },
      logger,
    );
    recommendations.push(...received);

    logger.info(
      `${received.length} recommendation(s) (${recommendations.length} total)`,
    );
  }

  // Synthesize the recommendations
  const ranked = await synthesizeRecommendations(state, recommendations, logger);

  // Remove the incident_clusters from the state
  const { incident_clusters, ...restState } = state;
  void incident_clusters;

  return {
    ...restState,
    recommendations: withUniqueIds(ranked),
  };
};
