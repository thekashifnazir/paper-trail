"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useStore } from "@/lib/store";

const nav = [
  { href: "/", label: "Run" },
  { href: "/exceptions", label: "Reconcile" },
  { href: "/arrears", label: "Arrears" },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { month, setMonth, queueCount, reset } = useStore();

  return (
    <div className="min-h-screen bg-canvas">
      <header className="sticky top-0 z-20 bg-nav text-white">
        <div className="mx-auto flex min-h-14 max-w-[1280px] flex-wrap items-center justify-between gap-x-6 gap-y-2 px-6 py-2">
          <div className="flex flex-wrap items-center gap-6">
            <Link
              href="/"
              className="text-[16px] font-semibold tracking-[-0.01em] text-white"
            >
              Paper Trail
            </Link>
            <nav className="flex items-center gap-1">
              {nav.map((item) => {
                const active =
                  item.href === "/"
                    ? pathname === "/"
                    : pathname.startsWith(item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    className={`inline-flex items-center rounded-md px-3 py-1.5 text-[14px] font-medium transition-colors ${
                      active
                        ? "bg-nav-active text-white"
                        : "text-white/75 hover:bg-white/5 hover:text-white"
                    }`}
                  >
                    {item.label}
                    {item.href === "/exceptions" && queueCount > 0 ? (
                      <span className="ml-2 rounded-full bg-white/15 px-1.5 py-px text-[11px] font-semibold text-white">
                        {queueCount}
                      </span>
                    ) : null}
                  </Link>
                );
              })}
            </nav>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <label className="sr-only" htmlFor="month">
              Statement month
            </label>
            <select
              id="month"
              value={month}
              onChange={(e) => setMonth(e.target.value)}
              className="rounded-md border border-white/20 bg-white/10 px-2 py-1 text-[13px] text-white [&>option]:text-ink"
            >
              <option value="2026-09">2026-09</option>
              <option value="2026-10">2026-10</option>
            </select>
            <span className="rounded-full border border-white/20 px-2 py-0.5 text-[12px] font-medium text-white/75">
              Synthetic data
            </span>
            <button
              type="button"
              onClick={() => void reset()}
              className="rounded-md border border-white/20 px-2.5 py-1 text-[13px] font-medium text-white/90 hover:bg-white/10"
            >
              Reset
            </button>
            <span className="text-[13px] text-white/75">
              Finance · Credit control
            </span>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-[1280px] p-6">{children}</main>
    </div>
  );
}
