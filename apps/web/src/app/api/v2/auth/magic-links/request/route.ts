import { NextResponse } from "next/server";
import { z } from "zod";

import { requestMagicLink } from "@/lib/data-store-v2";

const requestSchema = z.object({
  email: z.string().email(),
  ttlMinutes: z.number().int().positive().max(60).optional(),
});

export async function POST(request: Request) {
  const payload = await request.json().catch(() => null);
  const parsed = requestSchema.safeParse(payload);

  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request body", details: parsed.error.flatten() }, { status: 400 });
  }

  const result = await requestMagicLink({
    email: parsed.data.email,
    ttlMinutes: parsed.data.ttlMinutes,
    actor: parsed.data.email,
  });

  const exposeToken = (process.env.FLOWSTATE_MAGIC_LINK_EXPOSE_TOKEN || "true").toLowerCase() !== "false";

  return NextResponse.json(
    {
      email: parsed.data.email,
      expires_at: result.record.expires_at,
      token: exposeToken ? result.token : undefined,
      message: exposeToken
        ? "Magic link token generated for development mode."
        : "Magic link requested. Deliver token through configured email provider.",
    },
    { status: 201 },
  );
}
