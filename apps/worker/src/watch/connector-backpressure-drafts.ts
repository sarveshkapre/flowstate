import {
  parseConnectorBackpressureDraftActivationConfig,
  runConnectorBackpressureDraftActivationOnce,
} from "../jobs/connector-backpressure-drafts";

const config = parseConnectorBackpressureDraftActivationConfig();

let tickInFlight = false;

function safeConfigForLogs() {
  return {
    ...config,
    apiKey: config.apiKey ? "[configured]" : "[not-set]",
  };
}

async function runTick() {
  if (tickInFlight) {
    console.warn("[connector-backpressure-drafts] previous tick is still running, skipping");
    return;
  }

  tickInFlight = true;

  try {
    const result = await runConnectorBackpressureDraftActivationOnce({ config });

    if (result.failures.length > 0) {
      console.error(
        `[connector-backpressure-drafts] tick completed with ${result.failures.length} failure(s): ${result.failures.join("; ")}`,
      );
    } else {
      console.log(
        `[connector-backpressure-drafts] tick scanned=${result.scanned_draft_count} ready=${result.ready_count} applied=${result.applied_count} blocked=${result.blocked_count} failed=${result.failed_count}`,
      );
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    console.error(`[connector-backpressure-drafts] tick failed: ${message}`);
  } finally {
    tickInFlight = false;
  }
}

async function bootstrap() {
  console.log("[connector-backpressure-drafts] started", safeConfigForLogs());
  await runTick();

  setInterval(() => {
    void runTick();
  }, config.pollMs);
}

void bootstrap().catch((error) => {
  const message = error instanceof Error ? error.message : "unknown startup error";
  console.error(`[connector-backpressure-drafts] fatal startup error: ${message}`);
  process.exitCode = 1;
});
