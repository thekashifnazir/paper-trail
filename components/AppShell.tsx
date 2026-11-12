"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { MotionConfig } from "framer-motion";
import {
  ArrowLeftRight,
  Building2,
  ChevronsUpDown,
  Clock3,
  Inbox,
  RotateCcw,
  type LucideIcon,
} from "lucide-react";
import { FindMatchProvider } from "@/components/match/FindMatch";
import { useStore } from "@/lib/store";

const nav: { href: string; label: string; icon: LucideIcon }[] = [
  { href: "/", label: "Cash application", icon: ArrowLeftRight },
  { href: "/exceptions", label: "Exceptions", icon: Inbox },
  { href: "/arrears", label: "Arrears", icon: Clock3 },
];

const MONTHS = [
  { value: "2026-09", label: "Sep 2026" },
  { value: "2026-10", label: "Oct 2026" },
];

function LogoMark() {
  return (
    <span
      className="flex h-6 w-6 items-center justify-center rounded-[6px] bg-side-ink"
      aria-hidden
    >
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
        <path
          d="M3 3.5h8M3 7h5M3 10.5h6.5"
          stroke="var(--side)"
          strokeWidth="1.6"
          strokeLinecap="round"
        />
      </svg>
    </span>
  );
}

function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}

function Sidebar({ pathname, queueCount }: { pathname: string; queueCount: number }) {
  return (
    <aside className="sticky top-0 flex h-screen w-[var(--sidebar-w)] shrink-0 flex-col bg-side text-side-ink">
      <div className="flex h-[var(--topbar-h)] items-center gap-2.5 px-4">
        <LogoMark />
        <span className="text-[15px] font-semibold tracking-[-0.01em]">Paper Trail</span>
      </div>

      <div className="px-3">
        <div
          className="flex h-9 items-center gap-2 rounded-[8px] border border-side-active px-2.5 text-[13px]"
          title="One property in this workspace"
        >
          <Building2 className="h-3.5 w-3.5 text-side-muted" aria-hidden />
          <span className="min-w-0 flex-1 truncate">Wharfside Quarter</span>
          <ChevronsUpDown className="h-3.5 w-3.5 text-side-muted" aria-hidden />
        </div>
      </div>

      <div className="label mt-5 px-4 !text-side-muted">Workspace</div>
      <nav className="mt-1.5 flex flex-col gap-0.5 px-3">
        {nav.map((item) => {
          const active = isActive(pathname, item.href);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={`relative flex h-8 items-center gap-2.5 rounded-[6px] px-2.5 text-[13px] font-medium ${
                active
                  ? "bg-side-active text-side-ink"
                  : "text-side-muted hover:bg-side-active hover:text-side-ink"
              }`}
            >
              {active ? (
                <span
                  className="absolute -left-3 top-1.5 bottom-1.5 w-[2px] rounded-r-full bg-lime"
                  aria-hidden
                />
              ) : null}
              <Icon className="h-4 w-4 shrink-0" strokeWidth={1.75} aria-hidden />
              <span className="flex-1">{item.label}</span>
              {item.href === "/exceptions" && queueCount > 0 ? (
                <span className="money rounded-full bg-queue-tint px-1.5 text-[11px] leading-[18px] font-medium text-queue">
                  {queueCount}
                </span>
              ) : null}
            </Link>
          );
        })}
      </nav>

      <div className="mt-auto px-4 pb-4">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-side-active px-2.5 py-1 text-[11px] font-medium text-side-muted">
          <span className="h-1.5 w-1.5 rounded-full bg-side-muted" aria-hidden />
          Synthetic data
        </span>
      </div>
    </aside>
  );
}

function MonthSwitch({
  month,
  onChange,
}: {
  month: string;
  onChange: (value: string) => void;
}) {
  return (
    <div
      role="radiogroup"
      aria-label="Statement month"
      className="inline-flex h-8 items-center rounded-[8px] border border-line bg-canvas p-0.5"
    >
      {MONTHS.map((m) => {
        const on = m.value === month;
        return (
          <button
            key={m.value}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(m.value)}
            className={`h-full rounded-[6px] border px-3 text-[13px] font-medium ${
              on
                ? "border-line bg-surface text-ink"
                : "border-transparent text-muted hover:text-ink"
            }`}
          >
            {m.label}
          </button>
        );
      })}
    </div>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { month, setMonth, queueCount, reset } = useStore();
  const title = nav.find((item) => isActive(pathname, item.href))?.label ?? "";

  return (
    <MotionConfig reducedMotion="user">
      <FindMatchProvider>
      <div className="flex min-h-screen">
        <Sidebar pathname={pathname} queueCount={queueCount} />
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-20 flex h-[var(--topbar-h)] shrink-0 items-center gap-4 border-b border-line bg-surface px-6">
            <h1 className="text-[15px] font-semibold tracking-[-0.01em] text-ink">{title}</h1>
            <span className="h-4 w-px bg-line" aria-hidden />
            <MonthSwitch month={month} onChange={setMonth} />
            <button
              type="button"
              onClick={() => void reset()}
              className="ml-auto inline-flex h-8 items-center gap-1.5 rounded-[8px] border border-line bg-surface px-3 text-[13px] font-medium text-ink hover:bg-canvas"
            >
              <RotateCcw className="h-3.5 w-3.5 text-muted" aria-hidden />
              Reset
            </button>
          </header>
          <main className="min-h-0 flex-1 px-6 py-5">{children}</main>
        </div>
      </div>
      </FindMatchProvider>
    </MotionConfig>
  );
}
