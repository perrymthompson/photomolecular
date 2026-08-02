"use client";

import Link from "next/link";
import { useTheme } from "@/components/theme/ThemeProvider";

const links = [
  { href: "/", label: "Individual" },
  { href: "/aggregate", label: "Aggregate" },
  { href: "/dashboard", label: "Dashboard" },
];

export function Nav() {
  const { mode, toggleMode } = useTheme();

  return (
    <header className="border-b border-border bg-panel-elevated">
      <div className="mx-auto flex w-full max-w-[1920px] items-center justify-between gap-4 px-4 py-3 xl:px-6">
        <Link
          href="/"
          className="text-sm font-semibold tracking-tight text-foreground"
        >
          Photomolecular Lab · Chamber Sensors
        </Link>
        <div className="flex items-center gap-2">
          <nav className="flex gap-1">
            {links.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                className="rounded px-3 py-1.5 text-sm text-muted hover:bg-surface-hover hover:text-foreground"
              >
                {l.label}
              </Link>
            ))}
          </nav>
          <button
            type="button"
            onClick={toggleMode}
            className="rounded border border-border px-3 py-1.5 text-xs text-muted hover:bg-surface-hover hover:text-foreground"
            title={
              mode === "dark" ? "Switch to light theme" : "Switch to dark theme"
            }
            aria-label={
              mode === "dark" ? "Switch to light theme" : "Switch to dark theme"
            }
          >
            {mode === "dark" ? "Light" : "Dark"}
          </button>
        </div>
      </div>
    </header>
  );
}
