"use client";

import { useMemo, useState } from "react";

import type { DocumentType } from "@flowstate/types";

type UploadResponse = {
  artifact: {
    id: string;
    original_name: string;
    mime_type: string;
  };
  file_url: string;
};

type ExtractionResponse = {
  job: {
    id: string;
    status: string;
    review_status: string;
    validation: {
      is_valid: boolean;
      confidence: number;
      issues: Array<{ code: string; message: string; severity: "warning" | "error" }>;
    } | null;
    result: unknown;
    error_message: string | null;
  } | null;
};

export function UploadClient() {
  const [file, setFile] = useState<File | null>(null);
  const [documentType, setDocumentType] = useState<DocumentType>("invoice");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploadResult, setUploadResult] = useState<UploadResponse | null>(null);
  const [extractionResult, setExtractionResult] = useState<ExtractionResponse | null>(null);

  const canSubmit = useMemo(() => file !== null && !busy, [file, busy]);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!file) {
      setError("Choose a file first.");
      return;
    }

    setBusy(true);
    setError(null);
    setUploadResult(null);
    setExtractionResult(null);

    try {
      const formData = new FormData();
      formData.append("file", file);

      const uploadResponse = await fetch("/api/v1/uploads", {
        method: "POST",
        body: formData,
      });

      if (!uploadResponse.ok) {
        const payload = (await uploadResponse.json().catch(() => null)) as { error?: string } | null;
        throw new Error(payload?.error || "Upload failed.");
      }

      const uploadJson = (await uploadResponse.json()) as UploadResponse;
      setUploadResult(uploadJson);

      const extractionResponse = await fetch("/api/v1/extractions", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          artifactId: uploadJson.artifact.id,
          documentType,
        }),
      });

      if (!extractionResponse.ok) {
        const payload = (await extractionResponse.json().catch(() => null)) as { error?: string } | null;
        throw new Error(payload?.error || "Extraction failed.");
      }

      const extractionJson = (await extractionResponse.json()) as ExtractionResponse;
      setExtractionResult(extractionJson);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Unknown error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel">
      <h2>Upload Artifact</h2>
      <p className="muted">
        Upload an image or PDF. Flowstate will run extraction, validation, and queue it for review.
      </p>

      <form className="stack" onSubmit={onSubmit}>
        <label className="field">
          <span>Document Type</span>
          <select
            value={documentType}
            onChange={(event) => setDocumentType(event.target.value as DocumentType)}
          >
            <option value="invoice">Invoice</option>
            <option value="receipt">Receipt</option>
          </select>
        </label>

        <label className="field">
          <span>File</span>
          <input
            type="file"
            accept="image/*,application/pdf"
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
          />
        </label>

        <button type="submit" className="button" disabled={!canSubmit}>
          {busy ? "Running extraction..." : "Upload + Extract"}
        </button>
      </form>

      {error && <p className="error">{error}</p>}

      {uploadResult && (
        <div className="result-card">
          <h3>Uploaded</h3>
          <p className="mono">Artifact ID: {uploadResult.artifact.id}</p>
          <a href={uploadResult.file_url} target="_blank" rel="noreferrer">
            Open uploaded file
          </a>
        </div>
      )}

      {extractionResult?.job && (
        <div className="result-card">
          <h3>Extraction Result</h3>
          <p>Status: {extractionResult.job.status}</p>
          <p>Review: {extractionResult.job.review_status}</p>
          <p>Valid: {String(extractionResult.job.validation?.is_valid ?? false)}</p>
          <p>Confidence: {extractionResult.job.validation?.confidence ?? 0}</p>
          <pre className="json">{JSON.stringify(extractionResult.job.result, null, 2)}</pre>
        </div>
      )}
    </section>
  );
}
