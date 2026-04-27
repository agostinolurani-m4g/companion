import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Sentiero · itinerari outdoor",
  description: "Pianifica sentieri con mappa e assistente. Dati sul tuo computer (SQLite).",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="it"
      className={`${geistSans.variable} ${geistMono.variable} h-full min-h-0 antialiased`}
    >
      <body className="flex h-full min-h-0 flex-col bg-brand-bg text-brand-text antialiased selection:bg-brand-accent/25 selection:text-brand-text">
        {children}
      </body>
    </html>
  );
}
