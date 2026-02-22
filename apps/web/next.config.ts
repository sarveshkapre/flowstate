import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  experimental: {
    externalDir: true,
  },
  turbopack: {
    root: path.join(__dirname, "../../../"),
    resolveAlias: {
      "@/lib/utils": "./src/lib/utils",
      "react": "react",
      "react/jsx-runtime": "react/jsx-runtime",
      "react/jsx-dev-runtime": "react/jsx-dev-runtime",
      "react-dom": "react-dom",
      "react-dom/client": "react-dom/client",
    },
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
          { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains; preload" },
        ],
      },
    ];
  },
};

export default nextConfig;
