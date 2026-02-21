"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Badge, Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, Input } from "@flowstate/ui";

const NAV_ITEMS = [
  { href: "/", label: "Dashboard" },
  { href: "/upload", label: "Upload" },
  { href: "/review", label: "Review Queue" },
  { href: "/workflows", label: "Workflows v1" },
  { href: "/flow-builder", label: "Flow Builder v2" },
  { href: "/edge", label: "Edge Bundles" },
  { href: "/edge-control", label: "Edge Control v2" },
  { href: "/evals", label: "Evals" },
  { href: "/organizations", label: "Organizations" },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  function closePalette() {
    setOpen(false);
    setQuery("");
  }

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const isOpenShortcut = (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k";

      if (isOpenShortcut) {
        event.preventDefault();
        setOpen((current) => !current);
        return;
      }

      if (event.key === "Escape") {
        closePalette();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const results = useMemo(() => {
    const normalized = query.trim().toLowerCase();

    if (!normalized) {
      return NAV_ITEMS;
    }

    return NAV_ITEMS.filter((item) => item.label.toLowerCase().includes(normalized) || item.href.includes(normalized));
  }, [query]);

  return (
    <>
      <button type="button" className="cmdk-hint" onClick={() => setOpen(true)}>
        <Badge variant="outline">Jump</Badge>
        <kbd>cmd+k</kbd>
      </button>
      {children}
      <Dialog open={open} onOpenChange={(nextOpen) => (nextOpen ? setOpen(true) : closePalette())}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Command Palette</DialogTitle>
            <DialogDescription>Jump to any operator screen.</DialogDescription>
          </DialogHeader>
          <label className="field">
            <span>Go to</span>
            <Input
              autoFocus
              placeholder="Search pages..."
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>

          <div className="cmdk-list">
            {results.length === 0 ? <p className="muted">No matches.</p> : null}
            {results.map((item) => (
              <Link key={item.href} href={item.href} className="cmdk-item" onClick={closePalette}>
                <span>{item.label}</span>
                <span className="mono">{item.href}</span>
              </Link>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
