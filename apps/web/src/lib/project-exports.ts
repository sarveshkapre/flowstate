import { promises as fs } from "node:fs";
import path from "node:path";

import { z } from "zod";

import {
  getProject,
  listDatasetAssetsByProject,
  listLatestAssetAnnotations,
  resolveDatasetAssetBinarySource,
} from "@/lib/data-store-v2";

const WORKSPACE_ROOT = path.resolve(process.cwd(), "../..");
const DATA_DIR = process.env.FLOWSTATE_DATA_DIR
  ? path.resolve(process.env.FLOWSTATE_DATA_DIR)
  : path.join(WORKSPACE_ROOT, ".flowstate-data");
const LOCAL_PROJECTS_DIR = path.join(DATA_DIR, "local-projects");

const exportMetadataSchema = z.object({
  id: z.string().min(1),
  project_id: z.string().min(1),
  format: z.literal("coco"),
  image_count: z.number().int().nonnegative(),
  annotation_count: z.number().int().nonnegative(),
  class_count: z.number().int().nonnegative(),
  skipped_asset_count: z.number().int().nonnegative(),
  file_name: z.string().min(1),
  created_at: z.string().min(1),
});

type ExportMetadata = z.infer<typeof exportMetadataSchema>;

function projectExportDir(projectId: string) {
  return path.join(LOCAL_PROJECTS_DIR, projectId, "exports");
}

function projectWorkspaceDir(projectId: string) {
  return path.join(LOCAL_PROJECTS_DIR, projectId);
}

function projectManifestPath(projectId: string) {
  return path.join(projectWorkspaceDir(projectId), "project.json");
}

function exportSnapshotDir(projectId: string, exportId: string) {
  return path.join(projectExportDir(projectId), exportId);
}

function metadataPath(projectId: string, exportId: string) {
  return path.join(exportSnapshotDir(projectId, exportId), "metadata.json");
}

function cocoPath(projectId: string, exportId: string, fileName: string) {
  return path.join(exportSnapshotDir(projectId, exportId), fileName);
}

function parseExportIndex(exportId: string) {
  const match = /^export_(\d{4})$/.exec(exportId);
  if (!match) {
    return null;
  }
  const index = Number(match[1]);
  if (!Number.isFinite(index)) {
    return null;
  }
  return index;
}

function clamp01(value: number) {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(1, value));
}

function pngDimensions(bytes: Buffer) {
  if (bytes.length < 24) {
    return null;
  }
  const signature = bytes.subarray(0, 8);
  const isPng =
    signature[0] === 0x89 &&
    signature[1] === 0x50 &&
    signature[2] === 0x4e &&
    signature[3] === 0x47 &&
    signature[4] === 0x0d &&
    signature[5] === 0x0a &&
    signature[6] === 0x1a &&
    signature[7] === 0x0a;
  if (!isPng) {
    return null;
  }
  return {
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20),
  };
}

function jpegDimensions(bytes: Buffer) {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    return null;
  }

  let offset = 2;
  while (offset + 8 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }

    const marker = bytes[offset + 1] ?? 0;
    if (marker === 0xd9 || marker === 0xda) {
      break;
    }

    if (offset + 3 >= bytes.length) {
      break;
    }
    const segmentLength = bytes.readUInt16BE(offset + 2);
    if (!Number.isFinite(segmentLength) || segmentLength < 2) {
      break;
    }

    const isSofMarker =
      (marker >= 0xc0 && marker <= 0xc3) ||
      (marker >= 0xc5 && marker <= 0xc7) ||
      (marker >= 0xc9 && marker <= 0xcb) ||
      (marker >= 0xcd && marker <= 0xcf);

    if (isSofMarker && offset + 8 < bytes.length) {
      const height = bytes.readUInt16BE(offset + 5);
      const width = bytes.readUInt16BE(offset + 7);
      if (width > 0 && height > 0) {
        return { width, height };
      }
    }

    offset += 2 + segmentLength;
  }

  return null;
}

function webpDimensions(bytes: Buffer) {
  if (bytes.length < 30) {
    return null;
  }
  const riff = bytes.subarray(0, 4).toString("ascii");
  const webp = bytes.subarray(8, 12).toString("ascii");
  if (riff !== "RIFF" || webp !== "WEBP") {
    return null;
  }

  const chunkType = bytes.subarray(12, 16).toString("ascii");
  if (chunkType === "VP8X") {
    const width = bytes.readUIntLE(24, 3) + 1;
    const height = bytes.readUIntLE(27, 3) + 1;
    if (width > 0 && height > 0) {
      return { width, height };
    }
  }
  return null;
}

async function imageDimensionsFromFile(filePath: string) {
  const bytes = await fs.readFile(filePath);
  return pngDimensions(bytes) ?? jpegDimensions(bytes) ?? webpDimensions(bytes);
}

async function nextExportId(projectId: string) {
  const existing = await listProjectExports(projectId);
  const maxIndex = existing.reduce((max, item) => {
    const index = parseExportIndex(item.id);
    return index == null ? max : Math.max(max, index);
  }, 0);
  return `export_${String(maxIndex + 1).padStart(4, "0")}`;
}

async function ensureProjectWorkspace(project: {
  id: string;
  name: string;
  slug: string;
  created_at: string;
}) {
  await fs.mkdir(path.join(projectWorkspaceDir(project.id), "images"), { recursive: true });
  await fs.mkdir(path.join(projectWorkspaceDir(project.id), "annotations"), { recursive: true });
  await fs.mkdir(projectExportDir(project.id), { recursive: true });

  try {
    await fs.access(projectManifestPath(project.id));
  } catch {
    await fs.writeFile(
      projectManifestPath(project.id),
      JSON.stringify(
        {
          id: project.id,
          name: project.name,
          slug: project.slug,
          classes: [],
          created_at: project.created_at,
          updated_at: new Date().toISOString(),
        },
        null,
        2,
      ),
      "utf8",
    );
  }
}

export async function listProjectExports(projectId: string): Promise<ExportMetadata[]> {
  const dir = projectExportDir(projectId);

  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const records: ExportMetadata[] = [];

    for (const entry of entries) {
      if (!entry.isDirectory() || parseExportIndex(entry.name) == null) {
        continue;
      }

      const file = metadataPath(projectId, entry.name);
      try {
        const text = await fs.readFile(file, "utf8");
        records.push(exportMetadataSchema.parse(JSON.parse(text)));
      } catch {
        continue;
      }
    }

    records.sort((left, right) => right.id.localeCompare(left.id));
    return records;
  } catch {
    return [];
  }
}

export async function getProjectExport(projectId: string, exportId: string): Promise<ExportMetadata | null> {
  try {
    const text = await fs.readFile(metadataPath(projectId, exportId), "utf8");
    return exportMetadataSchema.parse(JSON.parse(text));
  } catch {
    return null;
  }
}

export async function readProjectExportFile(projectId: string, exportId: string) {
  const metadata = await getProjectExport(projectId, exportId);
  if (!metadata) {
    return null;
  }

  const filePath = cocoPath(projectId, exportId, metadata.file_name);
  const bytes = await fs.readFile(filePath);
  return {
    metadata,
    bytes,
    filePath,
  };
}

export async function createProjectCocoExport(projectId: string) {
  const project = await getProject(projectId);
  if (!project) {
    throw new Error("Project not found.");
  }
  await ensureProjectWorkspace(project);

  const assets = (await listDatasetAssetsByProject({ projectId, limit: 5000 })).filter(
    (asset) => asset.asset_type === "image" || asset.asset_type === "video_frame",
  );
  const latestAnnotations = await listLatestAssetAnnotations(assets.map((asset) => asset.id));

  const images: Array<{ id: number; file_name: string; width: number; height: number }> = [];
  const annotations: Array<{
    id: number;
    image_id: number;
    category_id: number;
    bbox: [number, number, number, number];
    area: number;
    iscrowd: 0;
  }> = [];
  const categoryIdByLabel = new Map<string, number>();

  let annotationId = 1;
  let imageId = 1;
  let skippedAssets = 0;

  for (const asset of assets) {
    const source = await resolveDatasetAssetBinarySource(asset);
    let width = asset.width;
    let height = asset.height;

    if ((!width || !height) && source?.mimeType.startsWith("image/")) {
      try {
        const dimensions = await imageDimensionsFromFile(source.filePath);
        width = dimensions?.width ?? null;
        height = dimensions?.height ?? null;
      } catch {
        width = null;
        height = null;
      }
    }

    if (!width || !height) {
      skippedAssets += 1;
      continue;
    }

    const currentImageId = imageId++;
    images.push({
      id: currentImageId,
      file_name: source?.fileName || `${asset.id}.jpg`,
      width,
      height,
    });

    const annotation = latestAnnotations.get(asset.id);
    if (!annotation) {
      continue;
    }

    for (const shape of annotation.shapes) {
      if (shape.geometry.type !== "bbox") {
        continue;
      }

      const label = shape.label.trim() || "unknown";
      if (!categoryIdByLabel.has(label)) {
        categoryIdByLabel.set(label, categoryIdByLabel.size + 1);
      }

      const x = clamp01(shape.geometry.x) * width;
      const y = clamp01(shape.geometry.y) * height;
      const w = clamp01(shape.geometry.width) * width;
      const h = clamp01(shape.geometry.height) * height;

      if (w < 1 || h < 1) {
        continue;
      }

      annotations.push({
        id: annotationId++,
        image_id: currentImageId,
        category_id: categoryIdByLabel.get(label) ?? 1,
        bbox: [
          Number(x.toFixed(2)),
          Number(y.toFixed(2)),
          Number(w.toFixed(2)),
          Number(h.toFixed(2)),
        ],
        area: Number((w * h).toFixed(2)),
        iscrowd: 0,
      });
    }
  }

  const categories = [...categoryIdByLabel.entries()]
    .sort((left, right) => left[1] - right[1])
    .map(([name, id]) => ({ id, name, supercategory: "object" as const }));

  const coco = {
    images,
    annotations,
    categories,
  };

  await fs.mkdir(projectExportDir(projectId), { recursive: true });
  const exportId = await nextExportId(projectId);
  const snapshotDir = exportSnapshotDir(projectId, exportId);
  await fs.mkdir(snapshotDir, { recursive: true });

  const metadata: ExportMetadata = {
    id: exportId,
    project_id: projectId,
    format: "coco",
    image_count: images.length,
    annotation_count: annotations.length,
    class_count: categories.length,
    skipped_asset_count: skippedAssets,
    file_name: "coco.json",
    created_at: new Date().toISOString(),
  };

  await fs.writeFile(cocoPath(projectId, exportId, metadata.file_name), JSON.stringify(coco, null, 2), "utf8");
  await fs.writeFile(metadataPath(projectId, exportId), JSON.stringify(metadata, null, 2), "utf8");

  return metadata;
}
