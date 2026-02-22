"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@shadcn-lib/utils";

import { ThemeToggle } from "@/components/theme-toggle";

const CORE_NAV = [
  { href: "/", label: "Home" },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  function isActive(href: string) {
    return href === "/" ? pathname === "/" : pathname.startsWith(href);
  }

  function renderNavItems() {
    return CORE_NAV.map((item) => (
      <Link
        key={item.href}
        href={item.href}
        className={cn(
          "block rounded-md px-3 py-2 text-sm font-medium transition-colors",
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
    <div className="min-h-screen bg-background md:grid md:grid-cols-[230px_1fr]">
      <aside className="hidden border-r border-border bg-card md:sticky md:top-0 md:flex md:h-screen md:flex-col">
        <div className="border-b border-border px-4 py-3">
          <Link href="/" className="text-lg font-semibold tracking-tight">
            Flowstate
          </Link>
        </div>
        <nav className="flex flex-1 flex-col gap-1 p-3">{renderNavItems()}</nav>
      </aside>

      <div className="min-h-screen pb-20 md:pb-0">
        <header className="sticky top-0 z-20 hidden border-b border-border bg-background/95 px-4 py-3 backdrop-blur md:flex md:justify-end">
          <ThemeToggle />
        </header>
        <header className="sticky top-0 z-20 border-b border-border bg-background/95 px-4 py-3 backdrop-blur md:hidden">
          <div className="mb-2 flex items-center justify-between">
            <Link href="/" className="text-base font-semibold tracking-tight">
              Flowstate
            </Link>
            <ThemeToggle />
          </div>
        </header>
        {children}
      </div>

      <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-background/95 px-2 py-2 backdrop-blur md:hidden">
        <div className="grid grid-cols-4 gap-1">
          {CORE_NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "inline-flex w-full items-center justify-center rounded-md px-2 py-2 text-center text-xs font-medium",
                isActive(item.href)
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              )}
            >
              {item.label}
            </Link>
          ))}
        </div>
      </nav>
    </div>
  );
}
