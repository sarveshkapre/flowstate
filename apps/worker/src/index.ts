import pino from "pino";

const logger = pino({ name: "flowstate-worker" });

function bootstrap() {
  logger.info("Worker booted.");
  logger.info("No queue is connected yet. This is the scaffolding baseline.");
}

bootstrap();
