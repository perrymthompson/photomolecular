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
      <div className="mx-auto flex w-full max-w-[1920px] flex-wrap items-center justify-between gap-2 px-3 py-2.5 sm:gap-4 sm:px-4 sm:py-3 xl:px-6">
        <Link
          href="/"
          className="min-w-0 text-sm font-semibold tracking-tight text-foreground"
        >
          <span className="sm:hidden">Chamber Sensors</span>
          <span className="hidden sm:inline">
            Photomolecular Lab · Chamber Sensors
          </span>
        </Link>
        <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
          <nav className="flex flex-wrap gap-0.5 sm:gap-1">
            {links.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                className="rounded px-2 py-1.5 text-xs text-muted hover:bg-surface-hover hover:text-foreground sm:px-3 sm:text-sm"
              >
                {l.label}
              </Link>
            ))}
          </nav>
          <button
            type="button"
            onClick={toggleMode}
            className="rounded border border-border px-2.5 py-1.5 text-xs text-muted hover:bg-surface-hover hover:text-foreground sm:px-3"
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
