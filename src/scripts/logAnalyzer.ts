import { z } from "zod";
import {
  logEntrySchema,
  OutputSchema,
  type PartialAnalysisReport,
} from "#types/schema";
import { aggregateInsights } from "#middlewares/aggregateInsights";
import { detectAnomalies } from "#middlewares/detectAnomalies";
import { generateRecommendations } from "#middlewares/generateRecommendations";
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
  try {

    // ---------------- LOADING ----------------
    // Loading the logs from the input file
    // Validation of the logs against the logEntrySchema

    console.log("📥 Lecture du fichier de logs...");
    const logs = await loadJson({
      path: inputPath,
      schema: z.array(logEntrySchema),
    });

    // ---------------- ANALYSIS ----------------
    // Aggregation of the insights
    // Detection of the anomalies
    // Generation of the recommendations

    console.log("🚀  Execution of the analysis pipeline...");

    const analyzedlogs = await pipe<PartialAnalysisReport>(
      (s) => aggregateInsights(logs, s),
      (s) => detectAnomalies(logs, s),
      generateRecommendations,
    )({});

    // ---------------- OUTPUT ----------------
    // Writing the final output to the output file
    // Validation of the output against the OutputSchema

    console.log("💾 Writing the output file...");
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

    console.log(`✅ Success ! The file ${outputPath} has been generated.`);

  } catch (error) {
    console.error("❌ Error during the execution of the pipeline :", error);
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
