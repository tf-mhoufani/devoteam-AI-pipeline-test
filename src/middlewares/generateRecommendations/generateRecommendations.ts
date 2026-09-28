import type { PartialAnalysisReport, Recommendation } from "#types/schema";
import {
  buildRecommendationPrompt,
  buildStatusRecommendationPrompt,
  buildSynthesisPrompt,
  hasUnhealthyServices,
  unhealthyServicesFrom,
} from "./buildRecommendationPrompt";
import {
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
const jobsFrom = (state: PartialAnalysisReport): GroqJob[] => {
  const groups = groupAnomaliesByMetric(state.anomalies ?? []);
  const jobs: GroqJob[] = groups.map((group) => ({
    label: `${group.metric}, ${group.count} peaks`,
    userContent: buildRecommendationPrompt(
      state.insights,
      group,
      state.service_status_summary,
    ),
    systemPrompt: GROQ_SYSTEM_PROMPT,
  }));

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
): Promise<Recommendation[]> => {
  if (drafts.length < 2) return drafts;

  await sleep(getBatchPauseMs());
  console.log(
    `🤖 Groq synthesis (${drafts.length} recommendations → filter & rank)...`,
  );

  const synthesized = await requestRecommendations({
    userContent: buildSynthesisPrompt(
      state.insights,
      drafts,
      state.service_status_summary,
    ),
    systemPrompt: GROQ_SYNTHESIS_SYSTEM_PROMPT,
  });

  if (synthesized.length === 0) {
    console.warn("⚠️ Groq synthesis empty, keeping draft recommendations");
    return drafts;
  }

  console.log(`   ✓ ${synthesized.length} recommendations`);
  return synthesized;
};

/**
 * Asks Groq for corrective actions per metric group, then for degraded / offline
 * services, then a synthesis pass to drop duplicates and rank by criticality.
 */
export const generateRecommendations = async (
  state: PartialAnalysisReport,
): Promise<PartialAnalysisReport> => {
  const jobs = jobsFrom(state);
  if (jobs.length === 0) {
    return { ...state, recommendations: [] };
  }

  const recommendations: Recommendation[] = [];
  const total = jobs.length;

  for (const [index, job] of jobs.entries()) {
    if (index > 0) await sleep(getBatchPauseMs());

    console.log(`🤖 Groq group ${index + 1}/${total} (${job.label})...`);

    const received = await requestRecommendations({
      userContent: job.userContent,
      systemPrompt: job.systemPrompt,
    });
    recommendations.push(...received);

    console.log(
      `   ✓ ${received.length} recommendations (${recommendations.length} total)`,
    );
  }

  const ranked = await synthesizeRecommendations(state, recommendations);

  return {
    ...state,
    recommendations: withUniqueIds(ranked),
  };
};
