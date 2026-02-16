import {
  type DocumentType,
  extractionByDocumentSchema,
  type ExtractionJobRecord,
  type ExtractionResult,
} from "@flowstate/types";

import {
  getArtifact,
  getExtractionJob,
  readArtifactBytes,
  setExtractionJobCompleted,
  setExtractionJobFailed,
  setExtractionJobProcessing,
} from "@/lib/data-store";
import { extractionTemplates } from "@/lib/extraction-templates";
import { getOpenAIClient } from "@/lib/openai";
import { validateExtraction } from "@/lib/validation";

function buildArtifactInput(mimeType: string, filename: string, bytes: Buffer) {
  const base64 = bytes.toString("base64");

  if (mimeType === "application/pdf") {
    return {
      type: "input_file" as const,
      filename,
      file_data: base64,
    };
  }

  if (mimeType.startsWith("image/")) {
    return {
      type: "input_image" as const,
      image_url: `data:${mimeType};base64,${base64}`,
      detail: "auto" as const,
    };
  }

  throw new Error(`Unsupported mime type: ${mimeType}`);
}

async function runModelExtraction(input: {
  documentType: DocumentType;
  mimeType: string;
  filename: string;
  bytes: Buffer;
}): Promise<ExtractionResult> {
  const template = extractionTemplates[input.documentType];
  const openai = getOpenAIClient();

  const response = await openai.responses.create({
    model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
    input: [
      {
        role: "system",
        content: [{ type: "input_text", text: template.systemPrompt }],
      },
      {
        role: "user",
        content: [
          { type: "input_text", text: template.userPrompt },
          buildArtifactInput(input.mimeType, input.filename, input.bytes),
        ],
      },
    ],
    text: {
      format: {
        type: "json_schema",
        name: template.schemaName,
        schema: template.jsonSchema,
        strict: true,
      },
    },
  });

  const outputText = response.output_text || "{}";
  const json = JSON.parse(outputText) as unknown;

  const parsed = extractionByDocumentSchema[input.documentType].parse(json);
  return parsed;
}

export async function executeExtractionJob(jobId: string): Promise<ExtractionJobRecord | null> {
  const job = await getExtractionJob(jobId);

  if (!job) {
    return null;
  }

  await setExtractionJobProcessing(jobId);

  const artifact = await getArtifact(job.artifact_id);
  const artifactFile = await readArtifactBytes(job.artifact_id);

  if (!artifact || !artifactFile) {
    return setExtractionJobFailed(jobId, "Artifact not found.");
  }

  try {
    const result = await runModelExtraction({
      documentType: job.document_type,
      mimeType: artifact.mime_type,
      filename: artifact.original_name,
      bytes: artifactFile.bytes,
    });

    const validation = validateExtraction(job.document_type, result);

    return setExtractionJobCompleted(jobId, {
      result,
      validation,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown extraction error";
    return setExtractionJobFailed(jobId, message);
  }
}
