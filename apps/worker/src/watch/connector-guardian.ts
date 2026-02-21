import { parseConnectorGuardianConfig, runConnectorGuardianOnce } from "../jobs/connector-guardian";

const config = parseConnectorGuardianConfig();

let tickInFlight = false;

function safeConfigForLogs() {
  return {
    ...config,
    apiKey: config.apiKey ? "[configured]" : "[not-set]",
  };
}

async function runTick() {
  if (tickInFlight) {
    console.warn("[connector-guardian] previous tick is still running, skipping");
    return;
  }

  tickInFlight = true;

  try {
    const result = await runConnectorGuardianOnce({ config });

    if (result.failures.length > 0) {
      console.error(
        `[connector-guardian] tick completed with ${result.failures.length} failure(s): ${result.failures.join("; ")}`,
      );
    } else if (result.actioned_count > 0) {
      console.log(
        `[connector-guardian] tick actioned ${result.actioned_count} recommendation(s) across ${result.project_count} project(s)`,
      );
    } else {
      console.log(`[connector-guardian] tick evaluated ${result.connector_count} connector(s), no action needed`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    console.error(`[connector-guardian] tick failed: ${message}`);
  } finally {
    tickInFlight = false;
  }
}

async function bootstrap() {
  console.log("[connector-guardian] started", safeConfigForLogs());
  await runTick();

  setInterval(() => {
    void runTick();
  }, config.pollMs);
}

void bootstrap().catch((error) => {
  const message = error instanceof Error ? error.message : "unknown startup error";
  console.error(`[connector-guardian] fatal startup error: ${message}`);
  process.exitCode = 1;
});
