"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useStore } from "@/lib/store";

const nav = [
  { href: "/", label: "Cash application" },
  { href: "/exceptions", label: "Exceptions" },
  { href: "/arrears", label: "Arrears" },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { month, setMonth, queueCount, reset } = useStore();

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[220px_1fr]">
      <aside className="border-b border-line bg-panel lg:border-b-0 lg:border-r">
        <div className="px-5 py-5">
          <div className="font-[family-name:var(--font-display)] text-[22px] tracking-tight text-ink">
            Paper Trail
          </div>
          <div className="mt-1 text-[13px] text-muted">
            Cash application · Wharfside Quarter
          </div>
        </div>
        <nav className="flex gap-1 px-3 pb-4 lg:flex-col">
          {nav.map((item) => {
            const active =
              item.href === "/"
                ? pathname === "/"
                : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`rounded-md px-3 py-2 text-[14px] font-medium ${
                  active
                    ? "bg-brand-wash text-brand"
                    : "text-ink hover:bg-line/60"
                }`}
              >
                {item.label}
                {item.href === "/exceptions" && queueCount > 0 ? (
                  <span className="ml-2 rounded-full bg-queue-wash px-1.5 py-0.5 text-[11px] font-semibold text-queue">
                    {queueCount}
                  </span>
                ) : null}
              </Link>
            );
          })}
        </nav>
      </aside>

      <div className="min-w-0">
        <header className="sticky top-0 z-20 flex flex-wrap items-center justify-between gap-3 border-b border-line bg-panel/95 px-5 py-3 backdrop-blur">
          <div className="flex items-center gap-3">
            <label className="text-[13px] text-muted" htmlFor="month">
              Statement month
            </label>
            <select
              id="month"
              value={month}
              onChange={(e) => setMonth(e.target.value)}
              className="rounded-md border border-line bg-paper px-2 py-1.5"
            >
              <option value="2026-09">2026-09</option>
              <option value="2026-10">2026-10</option>
            </select>
            <span className="rounded-full border border-line px-2 py-0.5 text-[12px] font-medium text-muted">
              Synthetic data
            </span>
          </div>
          <button
            type="button"
            onClick={() => void reset()}
            className="rounded-md border border-line px-3 py-1.5 text-[13px] font-medium hover:bg-line/50"
          >
            Reset
          </button>
        </header>
        <main className="px-5 py-5">{children}</main>
      </div>
    </div>
  );
}
