import type { Metadata, Viewport } from "next"
import "./globals.css"
import { AppShell } from "@/components/AppShell"

export const metadata: Metadata = {
  title: "Mission Control — OpenCode OS",
  description: "Local mission control dashboard for OpenCode and your AI agents.",
  applicationName: "Mission Control",
  robots: { index: false, follow: false },
}

export const viewport: Viewport = {
  themeColor: "#04060d",
  colorScheme: "dark",
  width: "device-width",
  initialScale: 1,
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen antialiased">
        <div className="aurora-root" aria-hidden />
        <div className="relative z-10">
          <AppShell>{children}</AppShell>
        </div>
      </body>
    </html>
  )
}