import OpenAI from "openai";

type ResponseCreateParams = OpenAI.Responses.ResponseCreateParamsNonStreaming;
type ResponseCreateResult = OpenAI.Responses.Response & { _request_id?: string | null };

function errorMessage(error: unknown): string {
  if (error instanceof Error && typeof error.message === "string") {
    return error.message;
  }
  if (
    typeof error === "object" &&
    error &&
    "error" in error &&
    typeof (error as { error?: unknown }).error === "object"
  ) {
    const candidate = (error as { error?: { message?: unknown } }).error?.message;
    if (typeof candidate === "string") {
      return candidate;
    }
  }
  return String(error ?? "");
}

function isUnsupportedReasoningError(error: unknown) {
  const message = errorMessage(error).toLowerCase();
  if (!message.includes("reasoning.effort")) {
    return false;
  }
  return (
    message.includes("unsupported parameter") ||
    message.includes("not supported") ||
    message.includes("does not support")
  );
}

export async function createResponseWithReasoningFallback(
  openai: OpenAI,
  params: ResponseCreateParams,
): Promise<ResponseCreateResult> {
  try {
    return (await openai.responses.create(params)) as ResponseCreateResult;
  } catch (error) {
    const reasoning = (params as { reasoning?: unknown }).reasoning;
    if (!reasoning || !isUnsupportedReasoningError(error)) {
      throw error;
    }

    const retryParams = { ...(params as Record<string, unknown>) };
    delete retryParams.reasoning;
    return (await openai.responses.create(retryParams as ResponseCreateParams)) as ResponseCreateResult;
  }
}
