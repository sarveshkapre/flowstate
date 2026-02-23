"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Boxes,
  Clapperboard,
  FileOutput,
  FolderUp,
  ListChecks,
  PanelLeftClose,
  PanelLeftOpen,
  PencilLine,
  Settings,
} from "lucide-react";

import { cn } from "@shadcn-lib/utils";
import { Button } from "@shadcn-ui/button";

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
  collapsed = false,
  onToggleCollapse,
}: {
  projectId: string;
  projectName: string;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
}) {
  const pathname = usePathname();
  const CollapseIcon = collapsed ? PanelLeftOpen : PanelLeftClose;

  return (
    <aside
      className={cn(
        "w-full rounded-2xl border border-border/90 bg-card p-3 shadow-sm md:sticky md:top-20 md:h-fit",
        collapsed ? "md:w-[72px]" : "md:w-full",
      )}
    >
      <div className="mb-3 flex items-center justify-between gap-2 rounded-xl border border-border bg-muted/40 p-3">
        {collapsed ? (
          <p className="truncate text-sm font-semibold text-foreground">{projectName.slice(0, 1)}</p>
        ) : (
          <div className="min-w-0">
            <p className="truncate text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              Project
            </p>
            <p className="truncate text-base font-semibold text-foreground">{projectName}</p>
            <p className="truncate text-xs text-muted-foreground">ID {projectId.slice(0, 8)}</p>
          </div>
        )}
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          onClick={onToggleCollapse}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className="shrink-0"
        >
          <CollapseIcon className="h-4 w-4" />
        </Button>
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
              title={item.label}
              className={cn(
                "flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                collapsed && "justify-center px-2",
                active
                  ? "bg-slate-950 text-white dark:bg-white dark:text-slate-950"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              <Icon className="h-4 w-4" />
              {!collapsed ? <span>{item.label}</span> : null}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
