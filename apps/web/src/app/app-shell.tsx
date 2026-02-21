"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Button, Dialog, DialogContent, DialogHeader, DialogTitle, cn } from "@flowstate/ui";

const OPERATE_ITEMS = [
  { href: "/", label: "Home" },
  { href: "/upload", label: "Upload" },
  { href: "/review", label: "Review" },
  { href: "/workflows", label: "Workflows" },
];

const BUILD_ITEMS = [
  { href: "/flow-builder", label: "Builder" },
  { href: "/edge", label: "Edge" },
  { href: "/edge-control", label: "Agents" },
  { href: "/evals", label: "Evals" },
];

const ADMIN_ITEMS = [
  { href: "/organizations", label: "Orgs" },
];

const MOBILE_PRIMARY_ITEMS = [
  { href: "/", label: "Home" },
  { href: "/upload", label: "Upload" },
  { href: "/review", label: "Review" },
  { href: "/workflows", label: "Flow" },
];

const MOBILE_MORE_ITEMS = [
  { href: "/flow-builder", label: "Builder" },
  { href: "/edge", label: "Edge" },
  { href: "/edge-control", label: "Agents" },
  { href: "/evals", label: "Evals" },
  { href: "/organizations", label: "Orgs" },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [moreOpen, setMoreOpen] = useState(false);

  function isActive(href: string) {
    return href === "/" ? pathname === "/" : pathname.startsWith(href);
  }

  function renderNavItems(items: Array<{ href: string; label: string }>) {
    return items.map((item) => (
      <Link
        key={item.href}
        href={item.href}
        className={cn(
          "rounded-md px-3 py-2 text-sm font-medium transition-colors",
          isActive(item.href)
            ? "bg-primary text-primary-foreground"
            : "text-muted-foreground hover:bg-muted hover:text-foreground"
        )}
      >
        {item.label}
      </Link>
    ));
  }

  return (
    <div className="min-h-screen bg-background md:grid md:grid-cols-[220px_1fr]">
      <aside className="hidden border-r border-border bg-card md:sticky md:top-0 md:flex md:h-screen md:flex-col">
        <div className="border-b border-border p-4">
          <Link href="/" className="text-lg font-semibold tracking-tight">
            Flowstate
          </Link>
        </div>
        <nav className="flex flex-1 flex-col gap-4 p-3">
          <div className="space-y-1">
            <p className="px-3 text-xs uppercase tracking-wide text-muted-foreground">Operate</p>
            {renderNavItems(OPERATE_ITEMS)}
          </div>
          <div className="space-y-1">
            <p className="px-3 text-xs uppercase tracking-wide text-muted-foreground">Build</p>
            {renderNavItems(BUILD_ITEMS)}
          </div>
          <div className="space-y-1">
            <p className="px-3 text-xs uppercase tracking-wide text-muted-foreground">Admin</p>
            {renderNavItems(ADMIN_ITEMS)}
          </div>
        </nav>
      </aside>

      <div className="min-h-screen pb-20 md:pb-0">
        <header className="sticky top-0 z-20 border-b border-border bg-background/90 px-4 py-3 backdrop-blur md:hidden">
          <Link href="/" className="text-base font-semibold tracking-tight">
            Flowstate
          </Link>
        </header>
        {children}
      </div>

      <nav className="fixed bottom-0 left-0 right-0 z-30 border-t border-border bg-background/95 px-2 py-2 backdrop-blur md:hidden">
        <div className="grid grid-cols-5 gap-1">
          {MOBILE_PRIMARY_ITEMS.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "rounded-md px-1 py-2 text-center text-xs font-medium",
                isActive(item.href)
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              )}
            >
              {item.label}
            </Link>
          ))}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-auto rounded-md px-1 py-2 text-xs font-medium text-muted-foreground"
            onClick={() => setMoreOpen(true)}
          >
            More
          </Button>
        </div>
      </nav>

      <Dialog open={moreOpen} onOpenChange={setMoreOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>More</DialogTitle>
          </DialogHeader>
          <div className="grid gap-2">
            {MOBILE_MORE_ITEMS.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setMoreOpen(false)}
                className={cn(
                  "rounded-md border border-border px-3 py-2 text-sm",
                  isActive(item.href)
                    ? "bg-primary text-primary-foreground"
                    : "text-foreground hover:bg-muted"
                )}
              >
                {item.label}
              </Link>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
