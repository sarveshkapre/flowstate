"use client";

import Link from "next/link";
import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";

import { ProjectSidebar } from "@/components/project-sidebar";
import { Button } from "@shadcn-ui/button";

const SIDEBAR_MIN = 220;
const SIDEBAR_MAX = 380;
const SIDEBAR_DEFAULT = 256;
const SIDEBAR_COLLAPSED = 72;
const COLLAPSE_KEY = "flowstate.sidebar.collapsed";
const WIDTH_KEY = "flowstate.sidebar.width";

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

export function ProjectWorkspaceShell({
  projectId,
  projectName,
  children,
}: {
  projectId: string;
  projectName: string;
  children: ReactNode;
}) {
  const [collapsed, setCollapsed] = useState(() => {
    if (typeof window === "undefined") {
      return false;
    }
    try {
      return window.localStorage.getItem(COLLAPSE_KEY) === "1";
    } catch {
      return false;
    }
  });
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    if (typeof window === "undefined") {
      return SIDEBAR_DEFAULT;
    }
    try {
      const storedWidth = window.localStorage.getItem(WIDTH_KEY);
      if (!storedWidth) {
        return SIDEBAR_DEFAULT;
      }
      const nextWidth = Number(storedWidth);
      if (!Number.isFinite(nextWidth)) {
        return SIDEBAR_DEFAULT;
      }
      return clamp(nextWidth, SIDEBAR_MIN, SIDEBAR_MAX);
    } catch {
      return SIDEBAR_DEFAULT;
    }
  });
  const [isResizing, setIsResizing] = useState(false);
  const resizeStartX = useRef(0);
  const resizeStartWidth = useRef(SIDEBAR_DEFAULT);

  useEffect(() => {
    try {
      window.localStorage.setItem(COLLAPSE_KEY, collapsed ? "1" : "0");
      window.localStorage.setItem(WIDTH_KEY, String(sidebarWidth));
    } catch {
      // Ignore local storage access failures.
    }
  }, [collapsed, sidebarWidth]);

  useEffect(() => {
    if (!isResizing) {
      return;
    }

    function onMove(event: MouseEvent) {
      const delta = event.clientX - resizeStartX.current;
      setSidebarWidth(clamp(resizeStartWidth.current + delta, SIDEBAR_MIN, SIDEBAR_MAX));
    }

    function onStop() {
      setIsResizing(false);
    }

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onStop);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onStop);
    };
  }, [isResizing]);

  function startResize(event: ReactMouseEvent<HTMLDivElement>) {
    if (collapsed) {
      return;
    }
    event.preventDefault();
    resizeStartX.current = event.clientX;
    resizeStartWidth.current = sidebarWidth;
    setIsResizing(true);
  }

  const currentSidebarWidth = collapsed ? SIDEBAR_COLLAPSED : sidebarWidth;
  const gridStyle = {
    "--sidebar-width": `${currentSidebarWidth}px`,
  } as CSSProperties;

  return (
    <section className="mx-auto w-full max-w-[1400px] space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-border/80 bg-card px-4 py-3">
        <div>
          <p className="text-xs text-muted-foreground">Local Project</p>
          <h1 className="text-lg font-semibold tracking-tight">{projectName}</h1>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild size="sm" variant="outline">
            <Link href={`/projects/${projectId}/upload`}>Import</Link>
          </Button>
          <Button asChild size="sm" variant="outline">
            <Link href={`/projects/${projectId}/annotate`}>Auto-annotate</Link>
          </Button>
          <Button asChild size="sm" variant="outline">
            <Link href={`/projects/${projectId}/video`}>Video</Link>
          </Button>
          <Button asChild size="sm" variant="outline">
            <Link href={`/projects/${projectId}/exports`}>Export</Link>
          </Button>
        </div>
      </div>
      <div
        className="grid gap-6 lg:[grid-template-columns:var(--sidebar-width)_minmax(0,1fr)]"
        style={gridStyle}
      >
        <div className="relative">
          <ProjectSidebar
            projectId={projectId}
            projectName={projectName}
            collapsed={collapsed}
            onToggleCollapse={() => setCollapsed((value) => !value)}
          />
          {!collapsed ? (
            <div
              role="separator"
              aria-orientation="vertical"
              aria-label="Resize sidebar"
              className="absolute inset-y-0 -right-3 hidden w-3 cursor-col-resize rounded-md transition-colors hover:bg-muted/70 lg:block"
              onMouseDown={startResize}
            />
          ) : null}
        </div>
        <section className="space-y-6">{children}</section>
      </div>
    </section>
  );
}
