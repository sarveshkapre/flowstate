import { PageHeader } from "@/components/page-header";

import { UploadClient } from "./upload-client";

export default function UploadPage() {
  return (
    <main className="page">
      <PageHeader
        title="Upload"
        links={[
          { href: "/", label: "Dashboard" },
          { href: "/review", label: "Review" },
        ]}
      />

      <UploadClient />
    </main>
  );
}
