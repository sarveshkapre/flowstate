import { NextResponse } from "next/server";
import { documentTypeSchema } from "@flowstate/types";
import { z } from "zod";

import {
  createExtractionJob,
  getArtifact,
  listExtractionJobs,
} from "@/lib/data-store";
import { executeExtractionJob } from "@/lib/extraction-service";
import { requireV1Permission } from "@/lib/v1/auth";
import { parseExtractionListFilters } from "@/lib/v1/extractions-request";

const createRequestSchema = z.object({
  artifactId: z.string().uuid(),
  documentType: documentTypeSchema,
});

export async function GET(request: Request) {
  const unauthorized = await requireV1Permission(request, "read_project");
  if (unauthorized) {
    return unauthorized;
  }

  const url = new URL(request.url);
  const parsedFilters = parseExtractionListFilters(url.searchParams);
  if (!parsedFilters.ok) {
    return NextResponse.json({ error: parsedFilters.error }, { status: 400 });
  }

  const jobs = await listExtractionJobs(parsedFilters.filters);

  const jobsWithArtifacts = await Promise.all(
    jobs.map(async (job) => {
      const artifact = await getArtifact(job.artifact_id);
      return {
        ...job,
        artifact_file_url: artifact ? `/api/v1/uploads/${artifact.id}/file` : null,
        artifact_name: artifact?.original_name ?? null,
        artifact_mime_type: artifact?.mime_type ?? null,
      };
    }),
  );

  return NextResponse.json({ jobs: jobsWithArtifacts });
}

export async function POST(request: Request) {
  const unauthorized = await requireV1Permission(request, "run_flow");
  if (unauthorized) {
    return unauthorized;
  }

  const payload = await request.json().catch(() => null);
  const parsed = createRequestSchema.safeParse(payload);

  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request body", details: parsed.error.flatten() }, { status: 400 });
  }

  const artifact = await getArtifact(parsed.data.artifactId);

  if (!artifact) {
    return NextResponse.json({ error: "Artifact not found" }, { status: 404 });
  }

  const job = await createExtractionJob({
    artifactId: parsed.data.artifactId,
    documentType: parsed.data.documentType,
  });

  const finalJob = await executeExtractionJob(job.id);

  return NextResponse.json({ job: finalJob }, { status: 201 });
}
