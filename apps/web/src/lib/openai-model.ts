export const DEFAULT_OPENAI_MODEL = "gpt-5.2";

export function resolveOpenAIModel(inputModel?: string | null): string {
  const override = inputModel?.trim();
  if (override) {
    return override;
  }

  const envModel = process.env.OPENAI_MODEL?.trim();
  return envModel || DEFAULT_OPENAI_MODEL;
}
