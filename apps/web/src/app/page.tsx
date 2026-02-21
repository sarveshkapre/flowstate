import Link from "next/link";
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Tabs, TabsContent, TabsList, TabsTrigger } from "@flowstate/ui";

import { DashboardMetrics } from "./dashboard-metrics";

const capabilities = [
  {
    name: "Ingest + Extraction",
    description: "Upload image/PDF artifacts and run OpenAI-native extraction templates for invoices and receipts.",
    status: "Live",
  },
  {
    name: "Validation + Review",
    description: "Run field/total validation, then route low-confidence jobs into a human review queue.",
    status: "Live",
  },
  {
    name: "Delivery + Edge",
    description: "Ship approved records to CSV/webhooks and build edge adapter bundles for runtime execution.",
    status: "Live",
  },
  {
    name: "Observability + Evals",
    description: "Track drift, connector reliability, and evaluation baselines for operational confidence.",
    status: "Live",
  },
];

const quickLinks = [
  { href: "/upload", label: "Start Uploading" },
  { href: "/review", label: "Open Review Queue" },
  { href: "/workflows", label: "Workflow Builder" },
  { href: "/flow-builder", label: "Flow Builder v2" },
  { href: "/edge-control", label: "Edge Control v2" },
  { href: "/evals", label: "Evals" },
];

export default function HomePage() {
  return (
    <main className="page space-y-5">
      <section className="hero panel relative overflow-hidden">
        <div className="space-y-4">
          <Badge variant="secondary">Flowstate Operator Platform</Badge>
          <h1 className="max-w-4xl text-balance">OpenAI-native VisionOps without CV training overhead.</h1>
          <p className="subtitle">
            Build extraction, validation, and human review workflows with a modular shadcn + Radix component stack.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Button asChild>
              <Link href="/upload">Start Uploading</Link>
            </Button>
            <Button asChild variant="outline">
              <Link href="/review">Review Queue</Link>
            </Button>
            <Button asChild variant="ghost">
              <Link href="/flow-builder">Flow Builder</Link>
            </Button>
          </div>
        </div>
      </section>

      <section className="panel">
        <div className="row between wrap">
          <h2>Core Capabilities</h2>
          <span className="muted">Shadcn-style primitives + Radix behavior wrappers</span>
        </div>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          {capabilities.map((capability) => (
            <Card key={capability.name} className="bg-card/80">
              <CardHeader>
                <div className="row between">
                  <CardTitle>{capability.name}</CardTitle>
                  <Badge variant="outline">{capability.status}</Badge>
                </div>
                <CardDescription>{capability.description}</CardDescription>
              </CardHeader>
            </Card>
          ))}
        </div>
      </section>

      <section className="panel">
        <Tabs defaultValue="operators">
          <TabsList>
            <TabsTrigger value="operators">Operator Shortcuts</TabsTrigger>
            <TabsTrigger value="platform">Platform APIs</TabsTrigger>
          </TabsList>
          <TabsContent value="operators">
            <div className="mt-2 flex flex-wrap gap-2">
              {quickLinks.map((link) => (
                <Button key={link.href} asChild variant="secondary" size="sm">
                  <Link href={link.href}>{link.label}</Link>
                </Button>
              ))}
            </div>
          </TabsContent>
          <TabsContent value="platform">
            <Card className="mt-2">
              <CardContent className="pt-5">
                <div className="flex flex-wrap gap-2">
                  <Button asChild variant="outline" size="sm">
                    <a href="/api/v1/exports/csv?reviewStatus=approved">Export Approved CSV</a>
                  </Button>
                  <Button asChild variant="outline" size="sm">
                    <a href="/api/v1/drift">Drift API</a>
                  </Button>
                  <Button asChild variant="outline" size="sm">
                    <a href="/api/v1/active-learning/candidates">Active Learning Candidates</a>
                  </Button>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </section>

      <DashboardMetrics />
    </main>
  );
}
