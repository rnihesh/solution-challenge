import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/sonner";
import { AuthProvider } from "@/contexts/AuthContext";
import { NetworkProvider } from "@/contexts/NetworkContext";
import { ChatWidget } from "@/components/agent/ChatWidget";
import {
  ServiceWorkerRegistration,
  InstallPrompt,
  OfflineBanner,
  SyncStatusIndicator,
} from "@/components/pwa";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const viewport: Viewport = {
  themeColor: "#10B981",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export const metadata: Metadata = {
  title: "CivicLemma - Civic Issue Reporting Platform",
  description:
    "Report civic issues anonymously and hold your municipality accountable. A transparent platform for people to report potholes, garbage, drainage problems and more.",
  keywords: [
    "civic",
    "municipality",
    "governance",
    "india",
    "transparency",
    "potholes",
    "garbage",
    "drainage",
  ],
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "CivicLemma",
  },
  formatDetection: {
    telephone: false,
  },
  other: {
    "mobile-web-app-capable": "yes",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        <link rel="apple-touch-icon" href="/icons/icon-192x192.png" />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <NetworkProvider>
          <AuthProvider>
            <OfflineBanner />
            {children}
          </AuthProvider>
          <ChatWidget />
          <ServiceWorkerRegistration />
          <InstallPrompt />
          <SyncStatusIndicator />
          <Toaster position="bottom-right" />
        </NetworkProvider>
      </body>
    </html>
  );
}
