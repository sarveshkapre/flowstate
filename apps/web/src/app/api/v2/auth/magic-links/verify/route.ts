import { NextResponse } from "next/server";
import { z } from "zod";

import { verifyMagicLinkToken } from "@/lib/data-store-v2";

const verifySchema = z.object({
  token: z.string().min(1),
});

export async function POST(request: Request) {
  const payload = await request.json().catch(() => null);
  const parsed = verifySchema.safeParse(payload);

  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request body", details: parsed.error.flatten() }, { status: 400 });
  }

  const record = await verifyMagicLinkToken(parsed.data.token);

  if (!record) {
    return NextResponse.json({ error: "Invalid or expired token" }, { status: 401 });
  }

  return NextResponse.json({
    authenticated: true,
    email: record.email,
    message: "Magic link verified. Use this identity to request API keys through project membership.",
  });
}
