"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Upload, WandSparkles } from "lucide-react";

import { Button } from "@shadcn-ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@shadcn-ui/card";

type UploadResponse = {
  artifact: {
    id: string;
  };
  error?: string;
};

type AutoLabelResponse = {
  artifactId: string;
  model: string;
  responseText: string;
  parsedJson: unknown;
  output: unknown;
  usage: unknown;
  error?: string;
};

const DEFAULT_PROMPT =
  "You are a computer vision expert. Draw bounding boxes for every object in this image and identify each object label. Return concise JSON with an `objects` array where each item has `label`, `bbox` ({x,y,width,height}), and optional `confidence`. Use normalized coordinates in [0,1].";

export function ProjectsClient() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AutoLabelResponse | null>(null);

  useEffect(() => {
    if (!file) {
      setPreviewUrl(null);
      return;
    }

    const nextUrl = URL.createObjectURL(file);
    setPreviewUrl(nextUrl);
    return () => URL.revokeObjectURL(nextUrl);
  }, [file]);

  const canRun = useMemo(() => !!file && !busy, [file, busy]);

  async function uploadSelectedImage() {
    if (!file) {
      throw new Error("Choose an image first.");
    }

    const formData = new FormData();
    formData.append("file", file);

    const uploadResponse = await fetch("/api/v1/uploads", {
      method: "POST",
      body: formData,
    });

    const uploadPayload = (await uploadResponse.json().catch(() => ({}))) as UploadResponse;
    if (!uploadResponse.ok || !uploadPayload.artifact?.id) {
      throw new Error(uploadPayload.error || "Upload failed.");
    }

    return uploadPayload.artifact.id;
  }

  async function onAutoLabel() {
    setBusy(true);
    setError(null);
    setResult(null);

    try {
      const artifactId = await uploadSelectedImage();
      const autoLabelResponse = await fetch("/api/v2/simple-label", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          artifactId,
          prompt: DEFAULT_PROMPT,
        }),
      });

      const autoLabelPayload = (await autoLabelResponse.json().catch(() => ({}))) as AutoLabelResponse;
      if (!autoLabelResponse.ok) {
        throw new Error(autoLabelPayload.error || "Auto-label failed.");
      }

      setResult(autoLabelPayload);
    } catch (runError) {
      setError(runError instanceof Error ? runError.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mx-auto w-full max-w-4xl space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-2xl">Image Auto Label</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-2">
            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              accept="image/*"
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            />
            <Button type="button" variant="outline" onClick={() => fileInputRef.current?.click()}>
              <Upload className="mr-2 h-4 w-4" />
              Upload Image
            </Button>
            <Button type="button" onClick={() => void onAutoLabel()} disabled={!canRun}>
              <WandSparkles className="mr-2 h-4 w-4" />
              {busy ? "Labeling..." : "Auto Label"}
            </Button>
          </div>

          {file ? <p className="text-sm text-muted-foreground">Selected: {file.name}</p> : null}

          {previewUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={previewUrl} alt="Uploaded preview" className="max-h-[420px] w-auto rounded-lg border" />
          ) : null}

          {error ? <p className="text-sm text-destructive">{error}</p> : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-xl">ChatGPT Response</CardTitle>
        </CardHeader>
        <CardContent>
          {result ? (
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">Model: {result.model}</p>
              <pre className="max-h-[420px] overflow-auto rounded-lg border bg-muted/30 p-3 text-xs leading-relaxed">
                {result.responseText || JSON.stringify(result.parsedJson ?? result.output, null, 2)}
              </pre>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Upload an image, then click Auto Label.</p>
          )}
        </CardContent>
      </Card>
    </section>
  );
}

