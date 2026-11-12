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
    <div className="min-h-screen lg:grid lg:grid-cols-[224px_1fr]">
      <aside className="border-b border-hairline bg-sheet lg:border-b-0 lg:border-r">
        <div className="px-4 py-4">
          <div className="text-[22px] font-medium tracking-[-0.02em] text-ink">
            Paper Trail
          </div>
          <div className="mt-0.5 text-[13px] text-muted">
            Cash application · Wharfside Quarter
          </div>
        </div>
        <nav className="flex gap-1 px-2 pb-3 lg:flex-col">
          {nav.map((item) => {
            const active =
              item.href === "/"
                ? pathname === "/"
                : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`rounded-lg px-3 py-1.5 text-[14px] font-medium ${
                  active
                    ? "bg-fill text-ink"
                    : "text-ink hover:bg-fill/70"
                }`}
              >
                {item.label}
                {item.href === "/exceptions" && queueCount > 0 ? (
                  <span className="ml-2 rounded-full bg-queue-wash px-1.5 py-0.5 text-[11px] font-medium text-queue">
                    {queueCount}
                  </span>
                ) : null}
              </Link>
            );
          })}
        </nav>
      </aside>

      <div className="min-w-0">
        <header className="sticky top-0 z-20 flex h-12 flex-wrap items-center justify-between gap-2 border-b border-hairline bg-sheet/95 px-4 backdrop-blur">
          <div className="flex items-center gap-2.5">
            <label className="text-[12px] text-muted" htmlFor="month">
              Statement month
            </label>
            <select
              id="month"
              value={month}
              onChange={(e) => setMonth(e.target.value)}
              className="rounded-lg border border-hairline bg-paper px-2 py-1 text-[13px]"
            >
              <option value="2026-09">2026-09</option>
              <option value="2026-10">2026-10</option>
            </select>
            <span className="rounded-full border border-hairline px-2 py-0.5 text-[12px] font-medium text-muted">
              Synthetic data
            </span>
          </div>
          <button
            type="button"
            onClick={() => void reset()}
            className="rounded-lg border border-hairline px-2.5 py-1 text-[13px] font-medium text-ink hover:bg-fill"
          >
            Reset
          </button>
        </header>
        <main className="px-4 py-4">{children}</main>
      </div>
    </div>
  );
}
