import { PageHeader } from "@/components/page-header";

import { UploadClient } from "./upload-client";

export default function UploadPage() {
  return (
    <main className="page">
      <PageHeader
        eyebrow="Flowstate / Upload"
        title="Extract documents into structured data."
        description="Artifacts are stored, validated, and sent to the review queue automatically."
        links={[
          { href: "/", label: "Dashboard" },
          { href: "/review", label: "Review Queue" },
        ]}
      />

      <UploadClient />
    </main>
  );
}
