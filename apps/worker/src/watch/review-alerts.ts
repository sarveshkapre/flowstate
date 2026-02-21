import { dispatchReviewAlertsOnce, parseReviewAlertsConfig } from "../jobs/review-alerts";

const config = parseReviewAlertsConfig();

let tickInFlight = false;

function safeConfigForLogs() {
  return {
    ...config,
    apiKey: config.apiKey ? "[configured]" : "[not-set]",
  };
}

async function runTick() {
  if (tickInFlight) {
    console.warn("[review-alerts] previous tick is still running, skipping");
    return;
  }

  tickInFlight = true;

  try {
    const result = await dispatchReviewAlertsOnce({ config });

    if (result.failures.length > 0) {
      console.error(`[review-alerts] tick completed with ${result.failures.length} failure(s): ${result.failures.join("; ")}`);
    } else if (result.alerted_count > 0) {
      console.log(`[review-alerts] tick dispatched ${result.alerted_count} alert(s) across ${result.evaluated_count} project(s)`);
    } else {
      console.log(`[review-alerts] tick evaluated ${result.evaluated_count} project(s), no alerts needed`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    console.error(`[review-alerts] tick failed: ${message}`);
  } finally {
    tickInFlight = false;
  }
}

async function bootstrap() {
  console.log("[review-alerts] started", safeConfigForLogs());
  await runTick();

  setInterval(() => {
    void runTick();
  }, config.pollMs);
}

void bootstrap().catch((error) => {
  const message = error instanceof Error ? error.message : "unknown startup error";
  console.error(`[review-alerts] fatal startup error: ${message}`);
  process.exitCode = 1;
});
