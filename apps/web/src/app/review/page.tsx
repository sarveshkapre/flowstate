import Link from "next/link";

import { ReviewClient } from "./review-client";

export default function ReviewPage() {
  return (
    <main className="page">
      <header className="hero compact">
        <p className="eyebrow">Flowstate / Review</p>
        <h1>Approve or reject extraction results.</h1>
        <p className="subtitle">
          Keep human-in-the-loop quality control while automating export to CSV and webhook targets.
        </p>
        <div className="link-row">
          <Link href="/">Dashboard</Link>
          <Link href="/upload">Upload</Link>
        </div>
      </header>

      <ReviewClient />
    </main>
  );
}
