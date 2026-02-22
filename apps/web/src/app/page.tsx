import { DashboardMetrics } from "./dashboard-metrics";
import { PageHeader } from "@/components/page-header";

export default function HomePage() {
  return (
    <main className="page space-y-4">
      <PageHeader
        title="Home"
        links={[
          { href: "/upload", label: "Upload" },
          { href: "/review", label: "Review" },
          { href: "/workflows", label: "Workflows" },
        ]}
      />

      <DashboardMetrics />
    </main>
  );
}
