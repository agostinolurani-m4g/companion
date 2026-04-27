import type { Metadata, Viewport } from "next";
import "./globals.css";
import ServiceWorkerRegister from "@/components/ServiceWorkerRegister";

export const metadata: Metadata = {
  title: "HMR Companion · Hellenic Mountain Race 2026",
  description:
    "Mappa statica offline-friendly per la HMR 2026: traccia, checkpoint con cutoff, resupply, POI lungo il percorso.",
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
  themeColor: "#0b1221",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="it" className="h-full min-h-full antialiased">
      <body className="h-full min-h-0 overflow-hidden bg-[color:var(--hmr-bg)] text-[color:var(--hmr-text)] antialiased selection:bg-[color:var(--hmr-accent)]/30">
        <ServiceWorkerRegister />
        {children}
      </body>
    </html>
  );
}
