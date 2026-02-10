import type { Metadata } from "next";
import { Plus_Jakarta_Sans, Bitter, Space_Mono } from "next/font/google";
import "./globals.css";
import { ErrorBoundaryProvider } from "@/components/errors/ErrorBoundaryProvider";
import { ThemeProvider } from "@/components/theme/ThemeProvider";

const plusJakartaSans = Plus_Jakarta_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-sans",
  display: "swap",
});

const bitter = Bitter({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-display",
  display: "swap",
});

const spaceMono = Space_Mono({
  subsets: ["latin"],
  weight: ["400", "700"],
  variable: "--font-mono",
  display: "swap",
});

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
    <html lang="en" className={`${plusJakartaSans.variable} ${bitter.variable} ${spaceMono.variable}`} suppressHydrationWarning>
      <body className="antialiased">
        <ThemeProvider>
          <ErrorBoundaryProvider>
            {children}
          </ErrorBoundaryProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
