import type { AnomalyGroup } from "./groupAnomaliesByMetric";
import type {
  IncidentCluster,
  PartialAnalysisReport,
  Recommendation,
} from "#types/schema";

export type UnhealthyServices = {
  degraded: string[];
  offline: string[];
};

const allowedTargetsFrom = (
  summary: PartialAnalysisReport["service_status_summary"],
): string[] =>
  summary ? [...summary.online, ...summary.degraded, ...summary.offline] : [];

/**
 * Degraded and offline names to remediate.
 * A service listed in both is treated as offline only.
 */
export const unhealthyServicesFrom = (
  summary: PartialAnalysisReport["service_status_summary"],
): UnhealthyServices => {
  const offline = [...new Set(summary?.offline ?? [])];
  const degraded = [...new Set(summary?.degraded ?? [])].filter(
    (service) => !offline.includes(service),
  );

  return { degraded, offline };
};

export const hasUnhealthyServices = ({
  degraded,
  offline,
}: UnhealthyServices): boolean => degraded.length > 0 || offline.length > 0;

/**
 * Builds the Groq user message for one metric group.
 * Role and output rules live in GROQ_SYSTEM_PROMPT.
 */
export const buildRecommendationPrompt = (
  insights: PartialAnalysisReport["insights"],
  group: AnomalyGroup,
  serviceStatus: PartialAnalysisReport["service_status_summary"],
): string => {
  const allowedTargets = allowedTargetsFrom(serviceStatus);

  return `
    Allowed targets: ${allowedTargets.join(", ") || "(none — do not invent a service)"}

    Insights are window aggregates (averages and maxes), not the current live state.
    Current insights : ${JSON.stringify(insights)}
    Service statuses seen over the window : ${JSON.stringify(serviceStatus ?? {})}
    Anomaly group : ${JSON.stringify(group)}
  `;
};

/**
 * Builds the Groq user message for one correlated incident cluster.
 * Role and output rules live in GROQ_CLUSTER_SYSTEM_PROMPT.
 */
export const buildClusterRecommendationPrompt = (
  insights: PartialAnalysisReport["insights"],
  cluster: IncidentCluster,
  serviceStatus: PartialAnalysisReport["service_status_summary"],
): string => {
  const allowedTargets = allowedTargetsFrom(serviceStatus);

  return `
    Allowed targets: ${allowedTargets.join(", ") || "(none — do not invent a service)"}

    Insights are window aggregates (averages and maxes), not the current live state.
    Current insights : ${JSON.stringify(insights)}
    Service statuses seen over the window : ${JSON.stringify(serviceStatus ?? {})}
    Incident cluster : ${JSON.stringify(cluster)}
  `;
};

/**
 * Builds the Groq user message for degraded / offline services.
 * Role and output rules live in GROQ_STATUS_SYSTEM_PROMPT.
 */
export const buildStatusRecommendationPrompt = (
  insights: PartialAnalysisReport["insights"],
  unhealthy: UnhealthyServices,
  serviceStatus: PartialAnalysisReport["service_status_summary"],
): string => {
  const allowedTargets = allowedTargetsFrom(serviceStatus);

  return `
    Allowed targets: ${allowedTargets.join(", ") || "(none — do not invent a service)"}

    Insights are window aggregates (averages and maxes), not the current live state.
    Current insights : ${JSON.stringify(insights)}
    Service statuses seen over the window : ${JSON.stringify(serviceStatus ?? {})}
    Unhealthy services to remediate : ${JSON.stringify(unhealthy)}
    Propose one recommendation per listed degraded service and one per listed offline service.
  `;
};

/**
 * Builds the Groq user message to filter and rank draft recommendations.
 * Role and output rules live in GROQ_SYNTHESIS_SYSTEM_PROMPT.
 */
export const buildSynthesisPrompt = (
  insights: PartialAnalysisReport["insights"],
  drafts: Recommendation[],
  serviceStatus: PartialAnalysisReport["service_status_summary"],
): string => {
  const allowedTargets = allowedTargetsFrom(serviceStatus);

  return `
    Allowed targets: ${allowedTargets.join(", ") || "(none — do not invent a service)"}

    Insights are window aggregates (averages and maxes), not the current live state.
    Current insights : ${JSON.stringify(insights)}
    Service statuses seen over the window : ${JSON.stringify(serviceStatus ?? {})}
    Draft recommendations : ${JSON.stringify(drafts)}
    Merge into at most one recommendation per target: combine actions, union parameters, one enriched benefit_estimate per target. Rank by criticality (offline, then degraded, then metrics).
  `;
};
