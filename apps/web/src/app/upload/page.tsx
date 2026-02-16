import Link from "next/link";

import { UploadClient } from "./upload-client";

export default function UploadPage() {
  return (
    <main className="page">
      <header className="hero compact">
        <p className="eyebrow">Flowstate / Upload</p>
        <h1>Extract documents into structured data.</h1>
        <p className="subtitle">Artifacts are stored, validated, and sent to the review queue automatically.</p>
        <div className="link-row">
          <Link href="/">Dashboard</Link>
          <Link href="/review">Review Queue</Link>
        </div>
      </header>

      <UploadClient />
    </main>
  );
}
