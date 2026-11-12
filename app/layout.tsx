import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { Toaster } from "sonner";
import { BrainCircuit } from "lucide-react";
import { StoreProvider } from "@/lib/store";
import { AppShell } from "@/components/AppShell";
import "./globals.css";

export const metadata: Metadata = {
  title: "Paper Trail — Cash application",
  description: "Allocate bank receipts to tenant charges with evidence.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en-GB">
      <body
        className={`${GeistSans.variable} ${GeistMono.variable} font-sans antialiased`}
      >
        <StoreProvider>
          <AppShell>{children}</AppShell>
          <Toaster
            position="bottom-right"
            closeButton
            icons={{ success: <BrainCircuit className="h-4 w-4" strokeWidth={2} /> }}
            toastOptions={{
              duration: 5000,
              classNames: {
                toast:
                  "!rounded-[8px] !border !border-side-active !border-l-[3px] !border-l-lime !bg-side !text-side-ink !font-sans",
                title: "!text-[13px] !font-medium !text-side-ink",
                description: "!text-[12px] !text-side-muted",
                icon: "!text-lime",
                closeButton: "!bg-side !border-side-active !text-side-muted hover:!text-side-ink",
              },
            }}
          />
        </StoreProvider>
      </body>
    </html>
  );
}
