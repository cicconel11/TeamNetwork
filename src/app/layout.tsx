import type { Metadata } from "next";
import "./globals.css";
import { ErrorBoundaryProvider } from "@/components/errors/ErrorBoundaryProvider";
import { ThemeProvider } from "@/components/theme/ThemeProvider";
import { Toaster } from "sonner";

export const metadata: Metadata = {
  title: "TeamNetwork",
  description: "Multi-organization hub for members, events, donations, and more",
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
