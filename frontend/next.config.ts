import type { NextConfig } from "next";

const isStaticExport =
  process.env.GITHUB_PAGES === "true" || process.env.STATIC_EXPORT === "true";
const rawBasePath = (process.env.NEXT_PUBLIC_BASE_PATH || "").trim();
const normalizedBasePath = rawBasePath
  ? `/${rawBasePath.replace(/^\/+|\/+$/g, "")}`
  : "";

const nextConfig: NextConfig = {
  ...(isStaticExport
    ? {
        output: "export" as const,
        images: {
          unoptimized: true,
        },
        ...(normalizedBasePath
          ? {
              basePath: normalizedBasePath,
              assetPrefix: normalizedBasePath,
            }
          : {}),
      }
    : {
        experimental: {
          agentFeedback: true,
        },
        cacheComponents: true,
        partialPrefetching: true,
      }),
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
