import { NextResponse } from "next/server";
import { z } from "zod";

import {
  createAssetAnnotation,
  getDatasetAsset,
  getLatestAssetAnnotation,
  listAssetAnnotations,
} from "@/lib/data-store-v2";
import { requirePermission } from "@/lib/v2/auth";

type Params = {
  params: Promise<{ assetId: string }>;
};

const geometrySchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("bbox"),
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
    width: z.number().min(0).max(1),
    height: z.number().min(0).max(1),
  }),
  z.object({
    type: z.literal("polygon"),
    points: z.array(z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) })).min(3),
  }),
]);

const createAnnotationSchema = z.object({
  source: z.enum(["manual", "ai_prelabel", "imported"]).default("manual"),
  notes: z.string().max(5000).optional(),
  shapes: z
    .array(
      z.object({
        id: z.string().optional(),
        label: z.string().min(1).max(200),
        confidence: z.number().min(0).max(1).nullable().optional(),
        identity: z
          .object({
            possible_name: z.string().min(1).max(200),
            confidence: z.number().min(0).max(1).nullable().optional(),
            evidence: z.string().min(1).max(500).nullable().optional(),
          })
          .nullable()
          .optional(),
        geometry: geometrySchema,
      }),
    )
    .min(1)
    .max(200),
});

export async function GET(request: Request, { params }: Params) {
  const { assetId } = await params;
  const asset = await getDatasetAsset(assetId);

  if (!asset) {
    return NextResponse.json({ error: "Asset not found" }, { status: 404 });
  }

  const auth = await requirePermission({
    request,
    permission: "read_project",
    projectId: asset.project_id,
  });

  if (!auth.ok) {
    return auth.response;
  }

  const annotations = await listAssetAnnotations(assetId);
  const latest = await getLatestAssetAnnotation(assetId);
  return NextResponse.json({ annotations, latest });
}

export async function POST(request: Request, { params }: Params) {
  const { assetId } = await params;
  const asset = await getDatasetAsset(assetId);

  if (!asset) {
    return NextResponse.json({ error: "Asset not found" }, { status: 404 });
  }

  const auth = await requirePermission({
    request,
    permission: "review_queue",
    projectId: asset.project_id,
  });

  if (!auth.ok) {
    return auth.response;
  }

  const payload = await request.json().catch(() => null);
  const parsed = createAnnotationSchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request body", details: parsed.error.flatten() }, { status: 400 });
  }

  const annotation = await createAssetAnnotation({
    assetId,
    source: parsed.data.source,
    notes: parsed.data.notes,
    shapes: parsed.data.shapes,
    actor: auth.actor.email ?? undefined,
  });

  return NextResponse.json({ annotation }, { status: 201 });
}
