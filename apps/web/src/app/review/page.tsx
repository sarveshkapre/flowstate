import { PageHeader } from "@/components/page-header";

import { ReviewClient } from "./review-client";

export default function ReviewPage() {
  return (
    <main className="page">
      <PageHeader
        title="Review"
        links={[]}
      />

      <ReviewClient />
    </main>
  );
}
