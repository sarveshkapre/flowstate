export type ImageDimensions = {
  width: number;
  height: number;
};

function pngDimensions(bytes: Buffer): ImageDimensions | null {
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
  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  if (width <= 0 || height <= 0) {
    return null;
  }
  return { width, height };
}

function jpegDimensions(bytes: Buffer): ImageDimensions | null {
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

function webpDimensions(bytes: Buffer): ImageDimensions | null {
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

export function inferImageDimensionsFromBuffer(bytes: Buffer): ImageDimensions | null {
  return pngDimensions(bytes) ?? jpegDimensions(bytes) ?? webpDimensions(bytes);
}
