import type { Metadata } from "next";
import localFont from "next/font/local";
import { Bitter, Hanken_Grotesk } from "next/font/google";
import "./globals.css";
import { ErrorBoundaryProvider } from "@/components/errors/ErrorBoundaryProvider";
import { ThemeProvider } from "@/components/theme/ThemeProvider";
import { WebVitalsReporter } from "@/app/_components/WebVitalsReporter";
import { Toaster } from "sonner";
import { SITE_DESCRIPTION, SITE_ICON_PATHS, SITE_NAME, SITE_URL } from "@/lib/site-metadata";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages } from "next-intl/server";
import { RTL_LOCALES } from "@/i18n/config";
import type { SupportedLocale } from "@/i18n/config";

const geistSans = localFont({
  src: "./fonts/GeistVF.woff",
  variable: "--font-sans",
  display: "swap",
});

const geistMono = localFont({
  src: "./fonts/GeistMonoVF.woff",
  variable: "--font-mono",
  display: "swap",
});

const bitter = Bitter({
  subsets: ["latin"],
  weight: ["600", "700"],
  variable: "--font-display",
  display: "swap",
});

// Hanken Grotesk — warm humanist grotesk with true italics. Scoped to the
// landing page only (applied via `.landing-page` in landing-styles.css); the
// rest of the product keeps Geist (--font-sans).
const hankenGrotesk = Hanken_Grotesk({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-landing",
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  applicationName: SITE_NAME,
  title: SITE_NAME,
  description: SITE_DESCRIPTION,
  icons: {
    icon: [
      { url: SITE_ICON_PATHS.favicon, sizes: "any" },
      { url: SITE_ICON_PATHS.icon192, type: "image/png", sizes: "192x192" },
    ],
    shortcut: [SITE_ICON_PATHS.favicon],
    apple: [{ url: SITE_ICON_PATHS.appleTouch, sizes: "180x180", type: "image/png" }],
  },
  verification: {
    google: "ABHMicqF2aoLD1T2krG0zYWL9PJXgaQZkMtfxsY46ug",
  },
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const locale = await getLocale();
  const messages = await getMessages();
  const dir = RTL_LOCALES.includes(locale as SupportedLocale) ? "rtl" : "ltr";

  return (
    <html lang={locale} dir={dir} suppressHydrationWarning>
      <body className={`${geistSans.variable} ${geistMono.variable} ${bitter.variable} ${hankenGrotesk.variable} antialiased`} translate="no">
        <NextIntlClientProvider messages={messages}>
          <ThemeProvider>
            <ErrorBoundaryProvider>
              {children}
            </ErrorBoundaryProvider>
            <Toaster position="bottom-right" richColors closeButton />
          </ThemeProvider>
        </NextIntlClientProvider>
        <WebVitalsReporter />
      </body>
    </html>
  );
}
