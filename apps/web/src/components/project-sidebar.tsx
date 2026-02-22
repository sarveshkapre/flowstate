"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Boxes, Clapperboard, FileOutput, FolderUp, ListChecks, PencilLine, Settings } from "lucide-react";

import { cn } from "@shadcn-lib/utils";

const ITEMS = [
  { key: "upload", label: "Import", icon: FolderUp },
  { key: "dataset", label: "Dataset", icon: Boxes },
  { key: "annotate", label: "Annotate", icon: PencilLine },
  { key: "video", label: "Video", icon: Clapperboard },
  { key: "review", label: "Review Queue", icon: ListChecks },
  { key: "exports", label: "Exports", icon: FileOutput },
  { key: "settings", label: "Settings", icon: Settings },
];

export function ProjectSidebar({
  projectId,
  projectName,
}: {
  projectId: string;
  projectName: string;
}) {
  const pathname = usePathname();

  return (
    <aside className="w-full rounded-2xl border border-border/90 bg-card p-3 shadow-sm md:sticky md:top-20 md:h-fit md:w-64">
      <div className="mb-3 rounded-xl border border-border bg-muted/40 p-3">
        <p className="truncate text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          Project
        </p>
        <p className="truncate text-base font-semibold text-foreground">{projectName}</p>
        <p className="truncate text-xs text-muted-foreground">ID {projectId.slice(0, 8)}</p>
      </div>

      <nav className="space-y-1">
        {ITEMS.map((item) => {
          const href = `/projects/${projectId}/${item.key}`;
          const active = pathname.startsWith(`/projects/${projectId}/${item.key}`);
          const Icon = item.icon;

          return (
            <Link
              key={item.key}
              href={href}
              className={cn(
                "flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                active
                  ? "bg-slate-950 text-white dark:bg-white dark:text-slate-950"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              <Icon className="h-4 w-4" />
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
