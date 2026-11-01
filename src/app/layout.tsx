import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "TaCos",
  description: "Agent-first issue tracking for teams",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // The desktop shell tags <html> with data-desktop before React hydrates.
    <html
      lang="en"
      className={`${inter.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="h-full">{children}</body>
    </html>
  );
}
