import { PageHeader } from "@/components/page-header";

export default function HomePage() {
  return (
    <main className="page space-y-4">
      <PageHeader title="Home" links={[]} />
      <p className="text-sm leading-6 text-muted-foreground">
        OpenAI-native VisionOps workspace for extraction and operations.
      </p>
    </main>
  );
}
