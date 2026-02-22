"use client";

import Link from "next/link";

import { ThemeToggle } from "@/components/theme-toggle";

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-20 border-b border-border/80 bg-background/90 px-4 py-3 backdrop-blur md:px-6">
        <div className="mx-auto flex w-full max-w-[1400px] items-center justify-between">
          <Link href="/projects" className="text-base font-semibold tracking-tight">
            Flowstate
          </Link>
          <ThemeToggle />
        </div>
      </header>
      <main className="w-full px-4 py-6 md:px-6">{children}</main>
    </div>
  );
}
