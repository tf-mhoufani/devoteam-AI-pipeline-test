import { z } from "zod";

// ============================================================================
// 1. INPUT SCHEMA : Validation of the raw log file data
// ============================================================================

export const logEntrySchema = z
  .object({
    timestamp: z.iso.datetime(),
    cpu_usage: z.number(),
    memory_usage: z.number(),
    latency_ms: z.number(),
    disk_usage: z.number(),
    network_in_kbps: z.number(),
    network_out_kbps: z.number(),
    io_wait: z.number(),
    thread_count: z.number(),
    active_connections: z.number(),
    error_rate: z.number(),
    uptime_seconds: z.number(),
    temperature_celsius: z.number(),
    power_consumption_watts: z.number(),
    service_status: z.record(
      z.string(),
      z.enum(["online", "degraded", "offline"]),
    ),
  })
  .strict();

export type LogEntry = z.infer<typeof logEntrySchema>;

// ============================================================================
// 2. OUTPUT SCHEMA : Validation of the output JSON structure
// ============================================================================

export const InsightsSchema = z
  .object({
    average_latency_ms: z.number(),
    max_cpu_usage: z.number(),
    max_memory_usage: z.number(),
    error_rate: z.number(),
    uptime_seconds: z.number(),
  })
  .strict();

export const SeveritySchema = z.enum(["low", "medium", "high"]);
export type Severity = z.infer<typeof SeveritySchema>;

export const AnomalySchema = z
  .object({
    metric: z.string(),
    value: z.number(),
    threshold: z.number(),
    severity: SeveritySchema,
    timestamp: z.iso.datetime(),
    description: z.string(),
  })
  .strict();

export type Anomaly = z.infer<typeof AnomalySchema>;

export const IncidentClusterTypeSchema = z.enum([
  "co_occurrence",
  "temporal_cascade",
]);
export type IncidentClusterType = z.infer<typeof IncidentClusterTypeSchema>;

export const IncidentClusterSchema = z
  .object({
    id: z.string(),
    type: IncidentClusterTypeSchema,
    metrics: z.array(z.string()),
    timestamps: z.array(z.iso.datetime()),
    severity: SeveritySchema,
    log_count: z.number(),
    description: z.string(),
  })
  .strict();

export type IncidentCluster = z.infer<typeof IncidentClusterSchema>;

export const RecommendationSchema = z
  .object({
    id: z.string(),
    action: z.string(),
    target: z.string(),
    parameters: z.record(z.string(), z.any()), // free object for parameters
    benefit_estimate: z.string(),
  })
  .strict();

export type Recommendation = z.infer<typeof RecommendationSchema>;

export const ServiceStatusSummarySchema = z
  .object({
    online: z.array(z.string()),
    degraded: z.array(z.string()),
    offline: z.array(z.string()),
  })
  .strict();

export const OutputSchema = z
  .object({
    timestamp: z.iso.datetime(),
    insights: InsightsSchema,
    anomalies: z.array(AnomalySchema),
    recommendations: z.array(RecommendationSchema),
    service_status_summary: ServiceStatusSummarySchema,
  })
  .strict();

export type AnalysisReport = z.infer<typeof OutputSchema>;

// ============================================================================
// 3. PARTIAL REPORT (filled step by step)
// ============================================================================

/** Pipeline state; `incident_clusters` is internal (Groq orchestration only). */
export type PartialAnalysisReport = Partial<AnalysisReport> & {
  incident_clusters?: IncidentCluster[];
};
