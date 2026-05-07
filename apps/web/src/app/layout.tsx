import type { Metadata } from "next";
import "./globals.css";
import { ErrorBoundaryProvider } from "@/components/errors/ErrorBoundaryProvider";
import { ThemeProvider } from "@/components/theme/ThemeProvider";
import { Toaster } from "sonner";
import { SITE_DESCRIPTION, SITE_ICON_PATHS, SITE_NAME, SITE_URL } from "@/lib/site-metadata";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages } from "next-intl/server";
import { RTL_LOCALES } from "@/i18n/config";
import type { SupportedLocale } from "@/i18n/config";

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
      <body className="antialiased" translate="no">
        <NextIntlClientProvider messages={messages}>
          <ThemeProvider>
            <ErrorBoundaryProvider>
              {children}
            </ErrorBoundaryProvider>
            <Toaster position="bottom-right" richColors closeButton />
          </ThemeProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
