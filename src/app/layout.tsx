import type { Metadata } from "next";
import "./globals.css";
import { ErrorBoundaryProvider } from "@/components/errors/ErrorBoundaryProvider";
import { ThemeProvider } from "@/components/theme/ThemeProvider";
import { Toaster } from "sonner";

const ICON_VERSION = "tn-20260325";

export const metadata: Metadata = {
  title: "TeamNetwork",
  description: "Multi-organization hub for members, events, donations, and more",
  icons: {
    icon: [
      { url: `/favicon.ico?v=${ICON_VERSION}`, sizes: "any" },
      { url: `/icon.png?v=${ICON_VERSION}`, type: "image/png", sizes: "192x192" },
    ],
    shortcut: [`/favicon.ico?v=${ICON_VERSION}`],
    apple: [{ url: `/apple-icon.png?v=${ICON_VERSION}`, sizes: "180x180", type: "image/png" }],
  },
  verification: {
    google: "ABHMicqF2aoLD1T2krG0zYWL9PJXgaQZkMtfxsY46ug",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="antialiased">
        <ThemeProvider>
          <ErrorBoundaryProvider>
            {children}
          </ErrorBoundaryProvider>
          <Toaster position="bottom-right" richColors closeButton />
        </ThemeProvider>
      </body>
    </html>
  );
}
