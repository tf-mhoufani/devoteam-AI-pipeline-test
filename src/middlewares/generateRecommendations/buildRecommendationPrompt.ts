import type { Anomaly, PartialAnalysisReport } from "#types/schema";

const allowedTargetsFrom = (
  summary: PartialAnalysisReport["service_status_summary"],
): string[] =>
  summary
    ? [...summary.online, ...summary.degraded, ...summary.offline]
    : [];

/**
 * Builds the Groq user message for one anomaly batch.
 * Role and output rules live in GROQ_SYSTEM_PROMPT.
 */
export const buildRecommendationPrompt = (
  insights: PartialAnalysisReport["insights"],
  anomalies: Anomaly[],
  serviceStatus: PartialAnalysisReport["service_status_summary"],
): string => {
  const allowedTargets = allowedTargetsFrom(serviceStatus);

  return `
    Allowed targets: ${allowedTargets.join(", ") || "(none — do not invent a service)"}

    Insights are window aggregates (averages and maxes), not the current live state.
    Current insights : ${JSON.stringify(insights)}
    Service status snapshot : ${JSON.stringify(serviceStatus ?? {})}
    Anomalies to fix : ${JSON.stringify(anomalies)}
  `;
};
