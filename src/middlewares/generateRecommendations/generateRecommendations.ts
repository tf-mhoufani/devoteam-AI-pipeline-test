import type { PartialAnalysisReport, Recommendation } from "#types/schema";
import { chunkAnomalies } from "./chunkAnomalies";
import { getBatchPauseMs, requestRecommendations, sleep } from "./groqClient";

const withUniqueIds = (recommendations: Recommendation[]): Recommendation[] =>
  recommendations.map((recommendation, index) => ({
    ...recommendation,
    id: `REC-${String(index + 1).padStart(3, "0")}`,
  }));

/**
 * Asks Groq for corrective actions on every anomaly, in rate-limited batches.
 */
export const generateRecommendations = async (
  state: PartialAnalysisReport,
): Promise<PartialAnalysisReport> => {
  if (!state.anomalies || state.anomalies.length === 0) {
    return { ...state, recommendations: [] };
  }

  const recommendations: Recommendation[] = [];
  const batches = chunkAnomalies(state.anomalies);
  const total = batches.length;

  for (const [index, batch] of batches.entries()) {
    if (index > 0) await sleep(getBatchPauseMs());

    console.log(
      `🤖 Groq batch ${index + 1}/${total} (${batch.length} anomalies)...`,
    );

    const received = await requestRecommendations(
      state.insights,
      batch,
      state.service_status_summary,
    );
    recommendations.push(...received);

    console.log(
      `   ✓ ${received.length} recommendations (${recommendations.length} total)`,
    );
  }

  return {
    ...state,
    recommendations: withUniqueIds(recommendations),
  };
};
