import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import ServiceWorkerRegister from "@/components/ServiceWorkerRegister";

const uiFont = Inter({ subsets: ["latin"], variable: "--font-ui", display: "swap" });

export const metadata: Metadata = {
  title: "HMR Companion",
  description:
    "Mappa offline-friendly per gare trail/bikepacking: traccia GPX, checkpoint, resupply e POI lungo il percorso.",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    title: "HMR 2026",
    capable: true,
    statusBarStyle: "black-translucent",
  },
  icons: {
    icon: [
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { url: "/icon.svg", sizes: "any", type: "image/svg+xml" },
    ],
    apple: [{ url: "/icon-192.png", sizes: "180x180", type: "image/png" }],
  },
};

export const viewport: Viewport = {
  themeColor: "#080d17",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="it" className={`h-full min-h-full antialiased ${uiFont.variable}`}>
      <body className="h-full min-h-0 overflow-hidden bg-[color:var(--hmr-bg)] text-[color:var(--hmr-text)] antialiased selection:bg-[color:var(--hmr-accent)]/30">
        <ServiceWorkerRegister />
        {children}
      </body>
    </html>
  );
}
