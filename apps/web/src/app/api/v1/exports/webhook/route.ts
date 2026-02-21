import { NextResponse } from "next/server";
import { reviewStatusSchema } from "@flowstate/types";
import { z } from "zod";

import { listExtractionJobs } from "@/lib/data-store";
import { dispatchWebhookForJobs } from "@/lib/webhook-dispatch";
import { requireV1Permission } from "@/lib/v1/auth";

const requestSchema = z.object({
  targetUrl: z.url(),
  reviewStatus: reviewStatusSchema.optional(),
  jobIds: z.array(z.string().uuid()).optional(),
});

export async function POST(request: Request) {
  const unauthorized = await requireV1Permission(request, "run_flow");
  if (unauthorized) {
    return unauthorized;
  }

  const payload = await request.json().catch(() => null);
  const parsed = requestSchema.safeParse(payload);

  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request body", details: parsed.error.flatten() }, { status: 400 });
  }

  let jobs = await listExtractionJobs({
    status: "completed",
    reviewStatus: parsed.data.reviewStatus ?? "approved",
  });

  if (parsed.data.jobIds?.length) {
    const idSet = new Set(parsed.data.jobIds);
    jobs = jobs.filter((job) => idSet.has(job.id));
  }

  const { success, statusCode, responseBody } = await dispatchWebhookForJobs({
    targetUrl: parsed.data.targetUrl,
    jobs,
    actor: "system",
  });

  if (!success) {
    return NextResponse.json(
      {
        error: "Webhook delivery failed",
        statusCode,
        responseBody,
      },
      { status: 502 },
    );
  }

  return NextResponse.json({ success: true, statusCode, responseBody, sent: jobs.length });
}
