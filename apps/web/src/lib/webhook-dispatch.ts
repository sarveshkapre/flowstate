import type { ExtractionJobRecord } from "@flowstate/types";

import { recordWebhookDelivery } from "@/lib/data-store";

export async function dispatchWebhookForJobs(input: {
  targetUrl: string;
  jobs: ExtractionJobRecord[];
  actor?: string;
}): Promise<{
  success: boolean;
  statusCode: number | null;
  responseBody: string | null;
  payloadBytes: number;
}> {
  const body = JSON.stringify({
    sent_at: new Date().toISOString(),
    count: input.jobs.length,
    jobs: input.jobs,
  });

  let statusCode: number | null = null;
  let success = false;
  let responseBody: string | null = null;

  try {
    const response = await fetch(input.targetUrl, {
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

  const payloadBytes = Buffer.byteLength(body);

  await recordWebhookDelivery({
    targetUrl: input.targetUrl,
    payloadSizeBytes: payloadBytes,
    success,
    statusCode,
    responseBody,
    actor: input.actor,
    jobIds: input.jobs.map((job) => job.id),
  });

  return { success, statusCode, responseBody, payloadBytes };
}
