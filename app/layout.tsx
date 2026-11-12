import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { Toaster } from "sonner";
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
            toastOptions={{
              className: "border-line! bg-surface! text-ink!",
              descriptionClassName: "text-muted!",
            }}
          />
        </StoreProvider>
      </body>
    </html>
  );
}
