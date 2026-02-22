"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { FolderKanban } from "lucide-react";

import { cn } from "@shadcn-lib/utils";

import { ThemeToggle } from "@/components/theme-toggle";

const NAV_ITEMS = [{ href: "/projects", label: "Projects", icon: FolderKanban }];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="min-h-screen bg-background md:grid md:grid-cols-[240px_1fr]">
      <aside className="hidden border-r border-slate-800 bg-gradient-to-b from-slate-950 to-[#020617] text-slate-100 md:sticky md:top-0 md:flex md:h-screen md:flex-col">
        <div className="border-b border-slate-800/90 px-5 py-5">
          <p className="text-[10px] uppercase tracking-[0.18em] text-slate-400">Workspace</p>
          <h1 className="mt-1 text-xl font-semibold tracking-tight text-slate-100">Flowstate</h1>
          <p className="mt-1 text-xs text-slate-400">OpenAI vision ops</p>
        </div>

        <nav className="flex-1 space-y-1 px-3 py-4">
          {NAV_ITEMS.map((item) => {
            const active = pathname.startsWith(item.href);
            const Icon = item.icon;
            return (
              <Link
                key={`${item.href}-${item.label}`}
                href={item.href}
                className={cn(
                  "flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                  active
                    ? "bg-slate-800 text-slate-100 shadow-[inset_0_0_0_1px_rgba(148,163,184,0.22)]"
                    : "text-slate-300 hover:bg-slate-800/70 hover:text-slate-100",
                )}
              >
                <Icon className="h-4 w-4" />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="border-t border-slate-800/90 px-4 py-4">
          <button
            type="button"
            className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-slate-700 bg-black text-xs font-semibold text-slate-300"
            aria-label="Profile"
          >
            N
          </button>
        </div>
      </aside>

      <div className="min-h-screen pb-16 md:pb-0">
        <header className="sticky top-0 z-20 border-b border-border/80 bg-background/90 px-4 py-3 backdrop-blur md:px-6">
          <div className="flex items-center justify-between">
            <Link href="/projects" className="text-base font-semibold tracking-tight md:hidden">
              Flowstate
            </Link>
            <div className="hidden md:block" />
            <ThemeToggle />
          </div>
        </header>
        {children}
      </div>

      <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-background/95 px-2 py-2 backdrop-blur md:hidden">
        <div className="grid grid-cols-2 gap-1">
          {NAV_ITEMS.map((item) => {
            const active = pathname.startsWith(item.href);
            const Icon = item.icon;
            return (
              <Link
                key={`mobile-${item.href}-${item.label}`}
                href={item.href}
                className={cn(
                  "inline-flex w-full flex-col items-center justify-center gap-1 rounded-md px-2 py-1 text-center text-[11px] font-medium",
                  active
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                <Icon className="h-4 w-4" />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
