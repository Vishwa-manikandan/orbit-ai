import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { AppShell } from "@/components/app-shell";
import { ConvexClientProvider } from "@/components/convex-provider";
import { ThemeProvider } from "@/components/theme-provider";
import { ThreadProvider } from "@/components/thread-provider";
import "./globals.css";

export const metadata: Metadata = {
  title: "Orbit AI — Personal agent workspace",
  description:
    "An AI workspace for email, calendar, and follow-ups with observable, approval-gated tool execution.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

/**
 * Applies a stored theme before first paint so switching never flashes the
 * wrong colours. With no stored choice the CSS follows the OS preference.
 */
const themeScript = `(function(){try{var t=localStorage.getItem("orbit-theme");if(t==="light"||t==="dark"){document.documentElement.dataset.theme=t;}}catch(e){}})();`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        <ConvexClientProvider>
          <ThreadProvider>
            <ThemeProvider>
              <AppShell>{children}</AppShell>
            </ThemeProvider>
          </ThreadProvider>
        </ConvexClientProvider>
      </body>
    </html>
  );
}
