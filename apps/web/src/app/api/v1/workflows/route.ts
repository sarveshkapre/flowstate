import { NextResponse } from "next/server";
import { documentTypeSchema } from "@flowstate/types";
import { z } from "zod";

import { createWorkflow, listWorkflows } from "@/lib/data-store";

const createWorkflowSchema = z.object({
  name: z.string().min(1).max(160),
  description: z.string().max(2000).optional(),
  documentType: documentTypeSchema,
  minConfidenceAutoApprove: z.number().min(0).max(1).default(0.9),
  webhookUrl: z.url().optional(),
  isActive: z.boolean().optional(),
});

export async function GET() {
  const workflows = await listWorkflows();
  return NextResponse.json({ workflows });
}

export async function POST(request: Request) {
  const payload = await request.json().catch(() => null);
  const parsed = createWorkflowSchema.safeParse(payload);

  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request body", details: parsed.error.flatten() }, { status: 400 });
  }

  const workflow = await createWorkflow({
    name: parsed.data.name,
    description: parsed.data.description,
    documentType: parsed.data.documentType,
    minConfidenceAutoApprove: parsed.data.minConfidenceAutoApprove,
    webhookUrl: parsed.data.webhookUrl,
    isActive: parsed.data.isActive,
  });

  return NextResponse.json({ workflow }, { status: 201 });
}
