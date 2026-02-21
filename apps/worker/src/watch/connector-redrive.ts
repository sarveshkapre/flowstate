import { parseConnectorRedriveConfig, runConnectorRedriveOnce } from "../jobs/connector-redrive";

const config = parseConnectorRedriveConfig();

let tickInFlight = false;

function safeConfigForLogs() {
  return {
    ...config,
    apiKey: config.apiKey ? "[configured]" : "[not-set]",
  };
}

async function runTick() {
  if (tickInFlight) {
    console.warn("[connector-redrive] previous tick is still running, skipping");
    return;
  }

  tickInFlight = true;

  try {
    const result = await runConnectorRedriveOnce({ config });

    if (result.failures.length > 0) {
      console.error(`[connector-redrive] tick completed with ${result.failures.length} failure(s): ${result.failures.join("; ")}`);
    } else if (result.redriven_count > 0 || result.processed_count > 0) {
      console.log(
        `[connector-redrive] tick redriven=${result.redriven_count} processed=${result.processed_count} across ${result.connector_count} connector queue(s)`,
      );
    } else {
      console.log(`[connector-redrive] tick checked ${result.connector_count} connector queue(s), no action needed`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    console.error(`[connector-redrive] tick failed: ${message}`);
  } finally {
    tickInFlight = false;
  }
}

async function bootstrap() {
  console.log("[connector-redrive] started", safeConfigForLogs());
  await runTick();

  setInterval(() => {
    void runTick();
  }, config.pollMs);
}

void bootstrap().catch((error) => {
  const message = error instanceof Error ? error.message : "unknown startup error";
  console.error(`[connector-redrive] fatal startup error: ${message}`);
  process.exitCode = 1;
});
