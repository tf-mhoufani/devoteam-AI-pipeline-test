import type { Logger } from "#helpers/logger";
import type { LogEntry, PartialAnalysisReport } from "#types/schema";

/** Shared context passed to every pipeline middleware. */
export type PipelineContext = {
  logs: LogEntry[];
  logger?: Logger;
};

export type Middleware = (
  state: PartialAnalysisReport,
  ctx: PipelineContext,
) => PartialAnalysisReport | Promise<PartialAnalysisReport>;
