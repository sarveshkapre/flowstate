import Link from "next/link";

const capabilities = [
  "Upload pipeline for image/PDF artifacts",
  "Invoice + receipt extraction templates",
  "Validation engine (totals + required fields)",
  "Human review queue with approve/reject",
  "CSV export and webhook delivery",
];

export default function HomePage() {
  return (
    <main className="page">
      <section className="hero">
        <p className="eyebrow">Flowstate</p>
        <h1>OpenAI-native VisionOps platform.</h1>
        <p className="subtitle">
          Build extraction, validation, and human review workflows without managing CV training stacks.
        </p>
        <div className="link-row">
          <Link href="/upload">Start Uploading</Link>
          <Link href="/review">Open Review Queue</Link>
          <a href="/api/v1/exports/csv?reviewStatus=approved">Export Approved CSV</a>
        </div>
      </section>

      <section className="panel">
        <h2>Phase 1 Delivered</h2>
        <div className="grid">
          {capabilities.map((item) => (
            <article key={item} className="card">
              <h3>{item}</h3>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
