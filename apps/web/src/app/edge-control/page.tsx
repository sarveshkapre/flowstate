import Link from "next/link";

import { EdgeControlClient } from "./edge-control-client";

export default function EdgeControlPage() {
  return (
    <main className="page">
      <header className="hero compact">
        <p className="eyebrow">Flowstate / Edge Control v2</p>
        <h1>Operate edge agents with config versions and command queue workflows.</h1>
        <p className="subtitle">
          Register agents, push config updates, dispatch commands, and track acknowledgements from one control surface.
        </p>
        <div className="link-row">
          <Link href="/">Dashboard</Link>
          <Link href="/edge">Edge Bundles</Link>
          <Link href="/flow-builder">Flow Builder v2</Link>
        </div>
      </header>

      <EdgeControlClient />
    </main>
  );
}
