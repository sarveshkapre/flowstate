import Link from "next/link";

import { FlowBuilderClient } from "./flow-builder-client";

export default function FlowBuilderPage() {
  return (
    <main className="page">
      <header className="hero compact">
        <p className="eyebrow">Flowstate / Flow Builder v2</p>
        <h1>Build, version, deploy, and test visual CV pipelines.</h1>
        <p className="subtitle">
          This is the Milestone 2 control-plane surface for no-code flow graph authoring on top of OpenAI-native runtime APIs.
        </p>
        <div className="link-row">
          <Link href="/">Dashboard</Link>
          <Link href="/workflows">Legacy Workflows</Link>
          <Link href="/organizations">Organizations</Link>
        </div>
      </header>

      <FlowBuilderClient />
    </main>
  );
}
