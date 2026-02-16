import type { ExtractionJobRecord, WorkflowRunRecord } from "@flowstate/types";

import {
  createExtractionJob,
  createWorkflowRun,
  getWorkflow,
  setWorkflowRunCompleted,
  setWorkflowRunFailed,
  setWorkflowRunRunning,
  updateReviewStatus,
} from "@/lib/data-store";
import { executeExtractionJob } from "@/lib/extraction-service";
import { dispatchWebhookForJobs } from "@/lib/webhook-dispatch";

export async function runWorkflow(input: {
  workflowId: string;
  artifactId: string;
}): Promise<{ run: WorkflowRunRecord | null; extractionJob: ExtractionJobRecord | null }> {
  const workflow = await getWorkflow(input.workflowId);

  if (!workflow || !workflow.is_active) {
    return { run: null, extractionJob: null };
  }

  const run = await createWorkflowRun({
    workflowId: workflow.id,
    artifactId: input.artifactId,
  });

  await setWorkflowRunRunning(run.id);

  const extractionJob = await createExtractionJob({
    artifactId: input.artifactId,
    documentType: workflow.document_type,
  });

  const executed = await executeExtractionJob(extractionJob.id);

  if (!executed) {
    const failedRun = await setWorkflowRunFailed({
      runId: run.id,
      extractionJobId: extractionJob.id,
      errorMessage: "Extraction execution returned no job.",
    });

    return { run: failedRun, extractionJob: null };
  }

  if (executed.status === "failed") {
    const failedRun = await setWorkflowRunFailed({
      runId: run.id,
      extractionJobId: executed.id,
      errorMessage: executed.error_message || "Extraction failed.",
    });

    return { run: failedRun, extractionJob: executed };
  }

  let reviewApplied = false;
  let finalJob = executed;

  if (
    executed.status === "completed" &&
    executed.validation &&
    executed.validation.is_valid &&
    executed.validation.confidence >= workflow.min_confidence_auto_approve
  ) {
    const reviewed = await updateReviewStatus({
      jobId: executed.id,
      reviewStatus: "approved",
      reviewer: "flowstate-bot",
      reviewNotes: `Auto-approved by workflow ${workflow.name}.`,
    });

    if (reviewed) {
      finalJob = reviewed;
      reviewApplied = true;
    }
  }

  if (workflow.webhook_url) {
    await dispatchWebhookForJobs({
      targetUrl: workflow.webhook_url,
      jobs: [finalJob],
      actor: "flowstate-workflow",
    });
  }

  const completedRun = await setWorkflowRunCompleted({
    runId: run.id,
    extractionJobId: finalJob.id,
    autoReviewApplied: reviewApplied,
  });

  return { run: completedRun, extractionJob: finalJob };
}
