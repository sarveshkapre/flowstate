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
        "w-full rounded-2xl border border-border/90 bg-card shadow-sm md:sticky md:top-20 md:h-fit",
        collapsed ? "p-2 md:w-[64px]" : "p-3 md:w-full",
      )}
    >
      <div
        className={cn(
          "mb-2 flex items-center",
          collapsed
            ? "justify-center"
            : "justify-between gap-2 rounded-xl border border-border bg-muted/40 p-3",
        )}
      >
        {!collapsed ? (
          <div className="min-w-0">
            <p className="truncate text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              Project
            </p>
            <p className="truncate text-base font-semibold text-foreground">{projectName}</p>
            <p className="truncate text-xs text-muted-foreground">ID {projectId.slice(0, 8)}</p>
          </div>
        ) : null}
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
              title={collapsed ? undefined : item.label}
              className={cn(
                "group relative flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                collapsed && "justify-center px-2",
                active
                  ? "bg-slate-950 text-white dark:bg-white dark:text-slate-950"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              <Icon className="h-4 w-4" />
              {!collapsed ? <span>{item.label}</span> : null}
              {collapsed ? (
                <span className="pointer-events-none absolute left-full top-1/2 z-50 ml-2 -translate-y-1/2 whitespace-nowrap rounded-md border border-border bg-popover px-2 py-1 text-xs text-popover-foreground opacity-0 shadow-sm transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
                  {item.label}
                </span>
              ) : null}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
