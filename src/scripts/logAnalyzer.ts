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
import { consoleLogger } from "#helpers/logger";
import { pipe } from "#helpers/pipe";
import { parseArgs } from "node:util";
import { loadJson } from "#helpers/loadJson";
import { writeJson } from "#helpers/writeJson";

interface LogAnalyzerOptions {
  inputPath: string;
  outputPath: string;
}

// Fonction d'orchestration principale
const logAnalyzer = async ({ inputPath, outputPath }: LogAnalyzerOptions) => {
  const logger = consoleLogger;

  try {
    logger.info("Reading log file...");
    const logs = await loadJson({
      path: inputPath,
      schema: z.array(logEntrySchema),
    });

    // ---------------- ANALYSIS ----------------
    // Aggregation of the insights
    // Detection of the anomalies
    // Generation of the recommendations

    logger.info("Running analysis pipeline...");

    const analyzedlogs = await pipe<PartialAnalysisReport>(
      (s) => aggregateInsights(logs, s),
      (s) => detectAnomalies(logs, s),
      (s) => correlateAnomalies(logs, s),
      (s) => generateRecommendations(s, { logger }),
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
  } catch (error) {
    logger.error("Pipeline execution failed:", error);
    process.exit(1);
  }
};

const { values } = parseArgs({
  options: {
    input: { type: "string", short: "i" },
    output: { type: "string", short: "o" },
  },
});

await logAnalyzer({
  inputPath: values.input ?? process.env.INPUT_LOGS ?? "./data/rapport.json",
  outputPath: values.output ?? process.env.OUTPUT_JSON ?? "./report/output.json",
});
