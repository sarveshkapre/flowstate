import { NextResponse } from "next/server";
import { z } from "zod";

import { canonicalConnectorType, SUPPORTED_CONNECTOR_TYPES } from "@/lib/v2/connectors";

const DEFAULT_MAX_JSON_BYTES = 256 * 1024;
const DEFAULT_MAX_DEPTH = 8;
const DEFAULT_MAX_KEYS = 100;
const DEFAULT_MAX_ARRAY = 100;
const DEFAULT_MAX_STRING = 2000;

const SENSITIVE_KEY_PATTERN =
  /(api[_-]?key|token|secret|password|authorization|cookie|session|private[_-]?key|client[_-]?secret)/i;

export const connectorTypeSchema = z
  .string()
  .trim()
  .toLowerCase()
  .transform((value) => canonicalConnectorType(value))
  .pipe(z.enum(SUPPORTED_CONNECTOR_TYPES));

export const edgeCommandTypeSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9][a-z0-9_.-]{1,90}$/);

export function jsonByteSize(value: unknown): number {
  const raw = JSON.stringify(value ?? null);
  return Buffer.byteLength(raw, "utf8");
}

export function assertJsonBodySize(value: unknown, maxBytes = DEFAULT_MAX_JSON_BYTES) {
  const size = jsonByteSize(value);

  if (size > maxBytes) {
    throw new Error(`Payload too large (${size} bytes). Max allowed is ${maxBytes} bytes.`);
  }
}

export function sanitizeForStorage(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) {
    return value;
  }

  if (typeof value === "string") {
    if (value.length > DEFAULT_MAX_STRING) {
      return `${value.slice(0, DEFAULT_MAX_STRING)}…[truncated]`;
    }
    return value;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return value;
  }

  if (depth >= DEFAULT_MAX_DEPTH) {
    return "[max-depth]";
  }

  if (Array.isArray(value)) {
    return value.slice(0, DEFAULT_MAX_ARRAY).map((item) => sanitizeForStorage(item, depth + 1));
  }

  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).slice(0, DEFAULT_MAX_KEYS);
    const out: Record<string, unknown> = {};

    for (const [key, item] of entries) {
      if (SENSITIVE_KEY_PATTERN.test(key)) {
        out[key] = "[redacted]";
      } else {
        out[key] = sanitizeForStorage(item, depth + 1);
      }
    }

    return out;
  }

  return String(value);
}

export function invalidRequestResponse(error: unknown) {
  const message = error instanceof Error ? error.message : "Invalid request";
  return NextResponse.json({ error: message }, { status: 400 });
}
