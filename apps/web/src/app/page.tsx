import Link from "next/link";
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from "@flowstate/ui";
import { PageHeader } from "@/components/page-header";

export default function HomePage() {
  return (
    <main className="page space-y-4">
      <PageHeader
        title="Home"
        links={[]}
      />
      <section className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Flow Library</CardTitle>
            <CardDescription>Build and manage reusable extraction workflows.</CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild>
              <Link href="/workflows">Open flows</Link>
            </Button>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Review Queue</CardTitle>
            <CardDescription>Approve the results and keep confidence high.</CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild variant="outline">
              <Link href="/review">Open review queue</Link>
            </Button>
          </CardContent>
        </Card>
      </section>
    </main>
  );
}
