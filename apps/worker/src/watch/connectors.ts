import { parseConnectorPumpConfig, pumpConnectorQueuesOnce } from "../jobs/connectors";

const config = parseConnectorPumpConfig();

let tickInFlight = false;

function safeConfigForLogs() {
  return {
    ...config,
    apiKey: config.apiKey ? "[configured]" : "[not-set]",
  };
}

async function runTick() {
  if (tickInFlight) {
    console.warn("[connector-pump] previous tick is still running, skipping");
    return;
  }

  tickInFlight = true;

  try {
    const result = await pumpConnectorQueuesOnce({ config });

    if (result.failures.length > 0) {
      console.error(
        `[connector-pump] tick completed with ${result.failures.length} failure(s): ${result.failures.join("; ")}`,
      );
    } else if (result.processed_count > 0) {
      console.log(
        `[connector-pump] tick processed ${result.processed_count} deliveries across ${result.connector_count} connector queue(s)`,
      );
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    console.error(`[connector-pump] tick failed: ${message}`);
  } finally {
    tickInFlight = false;
  }
}

async function bootstrap() {
  console.log("[connector-pump] started", safeConfigForLogs());
  await runTick();

  setInterval(() => {
    void runTick();
  }, config.pollMs);
}

void bootstrap().catch((error) => {
  const message = error instanceof Error ? error.message : "unknown startup error";
  console.error(`[connector-pump] fatal startup error: ${message}`);
  process.exitCode = 1;
});
