import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import { IBM_Plex_Mono } from "next/font/google";
import { Toaster } from "sonner";
import { StoreProvider } from "@/lib/store";
import { AppShell } from "@/components/AppShell";
import "./globals.css";

const plex = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-ibm-plex",
});

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
        className={`${GeistSans.variable} ${plex.variable} font-sans antialiased`}
      >
        <StoreProvider>
          <AppShell>{children}</AppShell>
          <Toaster
            position="bottom-right"
            closeButton
            toastOptions={{
              className: "border-hairline! bg-sheet! text-ink! shadow-none!",
              descriptionClassName: "text-muted!",
            }}
          />
        </StoreProvider>
      </body>
    </html>
  );
}
