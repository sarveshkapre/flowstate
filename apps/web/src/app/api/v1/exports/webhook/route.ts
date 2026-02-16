import { NextResponse } from "next/server";
import { reviewStatusSchema } from "@flowstate/types";
import { z } from "zod";

import { listExtractionJobs, recordWebhookDelivery } from "@/lib/data-store";

const requestSchema = z.object({
  targetUrl: z.url(),
  reviewStatus: reviewStatusSchema.optional(),
  jobIds: z.array(z.string().uuid()).optional(),
});

export async function POST(request: Request) {
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

  const body = JSON.stringify({
    sent_at: new Date().toISOString(),
    count: jobs.length,
    jobs,
  });

  let statusCode: number | null = null;
  let success = false;
  let responseBody: string | null = null;

  try {
    const response = await fetch(parsed.data.targetUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body,
    });

    statusCode = response.status;
    responseBody = await response.text();
    success = response.ok;
  } catch (error) {
    responseBody = error instanceof Error ? error.message : "Unknown webhook error";
  }

  await recordWebhookDelivery({
    targetUrl: parsed.data.targetUrl,
    payloadSizeBytes: Buffer.byteLength(body),
    success,
    statusCode,
    responseBody,
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
