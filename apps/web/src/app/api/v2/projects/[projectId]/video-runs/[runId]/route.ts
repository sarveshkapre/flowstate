import { NextResponse } from "next/server";

import { getVideoRun, getVideoRunTracks } from "@/lib/v2/video-run-service";
import { requirePermission } from "@/lib/v2/auth";

type Params = {
  params: Promise<{ projectId: string; runId: string }>;
};

export async function GET(request: Request, { params }: Params) {
  const { projectId, runId } = await params;
  const auth = await requirePermission({ request, permission: "read_project", projectId });
  if (!auth.ok) {
    return auth.response;
  }

  const run = await getVideoRun(projectId, runId);
  if (!run) {
    return NextResponse.json({ error: "Video run not found" }, { status: 404 });
  }

  const tracks = run.status === "done" ? await getVideoRunTracks(projectId, runId) : null;
  return NextResponse.json({
    run,
    tracks_summary: tracks
      ? {
          tracks: tracks.tracks.length,
          classes: tracks.classes.length,
          frame_index_count: tracks.frame_index.length,
        }
      : null,
  });
}
