import { PageHeader } from "@/components/page-header";

import { ReviewClient } from "./review-client";

export default function ReviewPage() {
  return (
    <main className="page">
      <PageHeader
        eyebrow="Flowstate / Review"
        title="Approve or reject extraction results."
        description="Keep human-in-the-loop quality control while automating export to CSV and webhook targets."
        links={[
          { href: "/", label: "Dashboard" },
          { href: "/upload", label: "Upload" },
        ]}
      />

      <ReviewClient />
    </main>
  );
}
