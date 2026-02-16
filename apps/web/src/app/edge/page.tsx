import Link from "next/link";

import { EdgeBundlesClient } from "./edge-bundles-client";

export default function EdgePage() {
  return (
    <main className="page">
      <header className="hero compact">
        <p className="eyebrow">Flowstate / Edge Adapters</p>
        <h1>Package workflows for edge runtimes.</h1>
        <p className="subtitle">
          Generate adapter-specific manifests for Cloudflare Workers, Vercel Edge Functions, and browser WASM clients.
        </p>
        <div className="link-row">
          <Link href="/">Dashboard</Link>
          <Link href="/workflows">Workflow Builder</Link>
          <Link href="/review">Review Queue</Link>
        </div>
      </header>

      <EdgeBundlesClient />
    </main>
  );
}
