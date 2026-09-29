import { z } from "zod";
import {
  logEntrySchema,
  OutputSchema,
  type PartialAnalysisReport,
} from "#types/schema";
import { aggregateInsights } from "#middlewares/aggregateInsights";
import { correlateAnomalies } from "#middlewares/correlateAnomalies";
import { detectAnomalies } from "#middlewares/detectAnomalies";
import { generateRecommendations } from "#middlewares/generateRecommendations";
import { consoleLogger, type Logger } from "#helpers/logger";
import { pipe } from "#helpers/pipe";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";
import { loadJson } from "#helpers/loadJson";
import { writeJson } from "#helpers/writeJson";

export type InfraLogAnalyzerOptions = {
  inputPath: string;
  outputPath: string;
  logger?: Logger;
};

/**
 * Reads logs, runs the analysis pipeline, and writes a validated report.
 * @param inputPath - The path to the input log file.
 * @param outputPath - The path to the output report file.
 * @param logger - The logger to use.
 * @returns A promise that resolves when the report is written.
 */
export const infraLogAnalyzer = async ({
  inputPath,
  outputPath,
  logger = consoleLogger,
}: InfraLogAnalyzerOptions): Promise<void> => {


  // ---------------- LOADING ----------------
  // Loading the logs from the input file
  // Validation of the logs against the logEntrySchema

  logger.info("Reading log file...");

  const logs = await loadJson({
    path: inputPath,
    schema: z.array(logEntrySchema),
  });

  // ---------------- ANALYSIS ----------------
  // Aggregation of the insights
  // Detection of the anomalies
  // Correlation of related spikes
  // Generation of the recommendations

  logger.info("Running analysis pipeline...");

  const ctx = { logs, logger };

  const analyzedlogs = await pipe<PartialAnalysisReport>(
    (s) => aggregateInsights(s, ctx),
    (s) => detectAnomalies(s, ctx),
    (s) => correlateAnomalies(s, ctx),
    (s) => generateRecommendations(s, ctx),
  )({});

  // ---------------- OUTPUT ----------------
  // Writing the final output to the output file
  // Validation of the output against the OutputSchema

  logger.info("Writing output file...");

  await writeJson({
    path: outputPath,
    data: {
      timestamp: new Date().toISOString(),
      insights: analyzedlogs.insights!,
      anomalies: analyzedlogs.anomalies!,
      recommendations: analyzedlogs.recommendations!,
      service_status_summary: analyzedlogs.service_status_summary!,
    },
    schema: OutputSchema,
  });

  logger.info(`Success. Generated ${outputPath}.`);
};

const runCli = async (): Promise<void> => {
  // Parse the command line arguments
  const { values } = parseArgs({
    options: {
      input: { type: "string", short: "i" },
      output: { type: "string", short: "o" },
    },
  });

  // Run the infrastructure log analyzer
  try {
    await infraLogAnalyzer({
      inputPath: values.input ?? process.env.INPUT_LOGS ?? "./data/rapport.json",
      outputPath:
        values.output ?? process.env.OUTPUT_JSON ?? "./report/output.json",
      logger: consoleLogger,
    });
  } catch (error) {
    consoleLogger.error("Pipeline execution failed:", error);
    process.exit(1);
  }
};

// ESM equivalent of `require.main === module`.
// Run the CLI only when this file is executed directly (e.g. npm run analyze:infra-log).
// When Vitest imports `infraLogAnalyzer` for tests, process.argv[1] points to Vitest —
// skip the CLI so we export the function without parseArgs, side effects, or process.exit.
const isMainModule =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMainModule) {
  await runCli();
}
