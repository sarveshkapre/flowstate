const features = [
  "OpenAI-powered extraction",
  "Validation and confidence checks",
  "Human review queue",
  "Workflow automation",
];

export default function HomePage() {
  return (
    <main className="page">
      <section className="hero">
        <p className="eyebrow">Flowstate</p>
        <h1>OpenAI-native VisionOps for operations teams.</h1>
        <p className="subtitle">
          Build extraction, validation, and human-in-the-loop workflows without stitching five tools.
        </p>
      </section>

      <section className="grid">
        {features.map((item) => (
          <article key={item} className="card">
            <h2>{item}</h2>
          </article>
        ))}
      </section>
    </main>
  );
}
