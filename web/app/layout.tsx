import "./globals.css";
import React from "react";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { ToastProvider } from "../components/Toast";
import { AppShell } from "../components/AppShell";

export const metadata = {
  title: "Itehaas — Version Control & Code Platform",
  description: "Distributed version control and code collaboration built from first principles.",
  icons: {
    icon: "/itehaas-mark.png",
    shortcut: "/favicon.ico",
    apple: "/itehaas-mark.png",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`dark ${GeistSans.variable} ${GeistMono.variable}`}>
      <body className="h-screen w-screen overflow-hidden bg-canvas text-fg-secondary antialiased font-sans">
        <ToastProvider>
          <AppShell>{children}</AppShell>
        </ToastProvider>
      </body>
    </html>
  );
}
