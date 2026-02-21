"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@flowstate/ui";

const NAV_ITEMS = [
  { href: "/", label: "Home" },
  { href: "/upload", label: "Upload" },
  { href: "/review", label: "Review" },
  { href: "/workflows", label: "Workflows" },
  { href: "/flow-builder", label: "Builder" },
  { href: "/edge", label: "Edge" },
  { href: "/edge-control", label: "Agents" },
  { href: "/evals", label: "Evals" },
  { href: "/organizations", label: "Orgs" },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const mobileNav = NAV_ITEMS.slice(0, 5);

  function isActive(href: string) {
    return href === "/" ? pathname === "/" : pathname.startsWith(href);
  }

  return (
    <div className="min-h-screen bg-background md:grid md:grid-cols-[220px_1fr]">
      <aside className="hidden border-r border-border bg-card md:sticky md:top-0 md:flex md:h-screen md:flex-col">
        <div className="border-b border-border p-4">
          <Link href="/" className="text-lg font-semibold tracking-tight">
            Flowstate
          </Link>
        </div>
        <nav className="flex flex-1 flex-col gap-1 p-2">
          {NAV_ITEMS.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "rounded-md px-3 py-2 text-sm transition-colors",
                isActive(item.href)
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              )}
            >
              {item.label}
            </Link>
          ))}
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
          {mobileNav.map((item) => (
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
        </div>
      </nav>
    </div>
  );
}
