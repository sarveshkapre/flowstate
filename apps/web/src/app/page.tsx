import Link from "next/link";
import { Button, Card, CardContent } from "@flowstate/ui";

import { DashboardMetrics } from "./dashboard-metrics";

const quickLinks = [
  { href: "/upload", label: "Upload" },
  { href: "/review", label: "Review" },
  { href: "/workflows", label: "Workflows" },
  { href: "/flow-builder", label: "Builder" },
  { href: "/edge-control", label: "Agents" },
  { href: "/evals", label: "Evals" },
];

export default function HomePage() {
  return (
    <main className="page space-y-4">
      <section className="hero">
        <h1>Home</h1>
        <div className="flex flex-wrap gap-2">
          {quickLinks.map((link) => (
            <Button key={link.href} asChild size="sm" variant={link.href === "/upload" ? "default" : "outline"}>
              <Link href={link.href}>{link.label}</Link>
            </Button>
          ))}
        </div>
      </section>

      <Card>
        <CardContent className="pt-5">
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline" size="sm">
              <a href="/api/v1/exports/csv?reviewStatus=approved">CSV</a>
            </Button>
            <Button asChild variant="outline" size="sm">
              <a href="/api/v1/drift">Drift API</a>
            </Button>
            <Button asChild variant="outline" size="sm">
              <a href="/api/v1/active-learning/candidates">Candidates API</a>
            </Button>
          </div>
        </CardContent>
      </Card>

      <DashboardMetrics />
    </main>
  );
}
