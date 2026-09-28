import { SEVERITY_RANK } from "./generateRecommendations.constants";
import type { Anomaly, Severity } from "#types/schema";

const EXAMPLE_COUNT = 2;

export type AnomalyGroup = {
  metric: string;
  count: number;
  min: number;
  max: number;
  bySeverity: Partial<Record<Severity, number>>;
  examples: Anomaly[];
};

/**
 * Calculates the worst severity rank from the severity counts.
 * @param bySeverity - The severity counts by severity.
 * @returns The worst severity rank.
 */
const worstSeverityRank = (
  bySeverity: Partial<Record<Severity, number>>,
): number =>
  Math.max(
    0,
    ...Object.keys(bySeverity).map(
      (severity) => SEVERITY_RANK[severity as Severity],
    ),
  );

/**
 * Collapses peaks of the same metric into one Groq payload so recommendations
 * stay unique instead of repeating once per log line.
 */
export const groupAnomaliesByMetric = (
  anomalies: Anomaly[],
): AnomalyGroup[] => {
  const byMetric = new Map<string, Anomaly[]>();

  for (const anomaly of anomalies) {
    const group = byMetric.get(anomaly.metric) ?? [];
    group.push(anomaly);
    byMetric.set(anomaly.metric, group);
  }

  return [...byMetric.entries()]
    .map(([metric, items]) => {
      const values = items.map((item) => item.value);
      const bySeverity = items.reduce<Partial<Record<Severity, number>>>(
        (counts, item) => ({
          ...counts,
          [item.severity]: (counts[item.severity] ?? 0) + 1,
        }),
        {},
      );

      const examples = [...items]
        .sort(
          (a, b) =>
            SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] ||
            b.value - a.value,
        )
        .slice(0, EXAMPLE_COUNT);

      return {
        metric,
        count: items.length,
        min: Math.min(...values),
        max: Math.max(...values),
        bySeverity,
        examples,
      };
    })
    .sort(
      (a, b) =>
        worstSeverityRank(b.bySeverity) - worstSeverityRank(a.bySeverity),
    );
};
