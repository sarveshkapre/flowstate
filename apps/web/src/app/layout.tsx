import type { Metadata } from "next";
import { Space_Grotesk, IBM_Plex_Mono } from "next/font/google";

import { AppShell } from "./app-shell";
import "./globals.css";

const sans = Space_Grotesk({ subsets: ["latin"], variable: "--font-sans" });
const mono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-mono" });

export const metadata: Metadata = {
  title: "Flowstate",
  description: "OpenAI-native VisionOps platform",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const themeScript = `(function () {
  var storageKey = "flowstate-theme";
  var stored = "";

  try {
    stored = window.localStorage.getItem(storageKey) || "";
  } catch (_error) {
    stored = "";
  }

  var shouldUseDark = stored === "dark" || (!stored && window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches);
  var mode = shouldUseDark ? "dark" : "light";

  if (mode === "dark") {
    document.documentElement.classList.add("dark");
  } else {
    document.documentElement.classList.remove("dark");
  }

  document.documentElement.dataset.theme = mode;
})();`;

  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script suppressHydrationWarning dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className={`${sans.variable} ${mono.variable}`}>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
