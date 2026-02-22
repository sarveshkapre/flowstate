import { NextResponse } from "next/server";
import { z } from "zod";

import { requirePermission } from "@/lib/v2/auth";
import { runAssetAutoLabel } from "@/lib/auto-label-service";
import { getDatasetAsset } from "@/lib/data-store-v2";

type Params = {
  params: Promise<{ assetId: string }>;
};

const autoLabelSchema = z.object({
  prompt: z.string().max(3000).optional(),
  labelHints: z.array(z.string().min(1).max(200)).max(100).optional(),
  reasoningEffort: z.enum(["low", "medium", "high"]).optional(),
  maxObjects: z.number().int().min(1).max(1000).optional(),
  qualityMode: z.enum(["fast", "dense"]).optional(),
});

export async function POST(request: Request, { params }: Params) {
  const { assetId } = await params;

  const asset = await getDatasetAsset(assetId);
  if (!asset) {
    return NextResponse.json({ error: "Asset not found" }, { status: 404 });
  }

  const auth = await requirePermission({
    request,
    permission: "run_flow",
    projectId: asset.project_id,
  });

  if (!auth.ok) {
    return auth.response;
  }

  const payload = await request.json().catch(() => ({}));
  const parsed = autoLabelSchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request body", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  try {
    const result = await runAssetAutoLabel(assetId, {
      prompt: parsed.data.prompt,
      labelHints: parsed.data.labelHints,
      reasoningEffort: parsed.data.reasoningEffort,
      maxObjects: parsed.data.maxObjects,
      qualityMode: parsed.data.qualityMode,
      actor: auth.actor.email ?? undefined,
    });

    return NextResponse.json({ annotation: result.annotation, model_output: result.model_output });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Auto-label failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
