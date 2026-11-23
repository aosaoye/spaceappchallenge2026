import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const frontendDir = path.resolve(import.meta.dirname, "..");
const stageDir = path.join(frontendDir, ".pages-build");
const outDir = path.join(frontendDir, "out");
const nextBin = path.join(frontendDir, "node_modules", "next", "dist", "bin", "next");

function copySourceTree() {
  fs.rmSync(stageDir, { recursive: true, force: true });
  fs.mkdirSync(stageDir, { recursive: true });

  const copyItems = [
    "app",
    "components",
    "lib",
    "public",
    "package.json",
    "tsconfig.json",
    "next.config.ts",
    "next-env.d.ts",
  ];

  for (const item of copyItems) {
    const src = path.join(frontendDir, item);
    if (!fs.existsSync(src)) continue;
    const dst = path.join(stageDir, item);
    const stat = fs.statSync(src);
    if (stat.isDirectory()) {
      fs.cpSync(src, dst, {
        recursive: true,
        filter: (p) => {
          const rel = path.relative(frontendDir, p).replace(/\\/g, "/");
          return rel !== "app/api" && !rel.startsWith("app/api/");
        },
      });
    } else {
      fs.copyFileSync(src, dst);
    }
  }

  const nmSrc = path.join(frontendDir, "node_modules");
  const nmDst = path.join(stageDir, "node_modules");
  if (fs.existsSync(nmSrc) && !fs.existsSync(nmDst)) {
    try {
      fs.symlinkSync(
        nmSrc,
        nmDst,
        process.platform === "win32" ? "junction" : "dir"
      );
    } catch {
      // Node y los bundlers resuelven ../node_modules automáticamente en subdirectorios de trabajo
    }
  }
}

try {
  copySourceTree();

  execFileSync(process.execPath, [nextBin, "build"], {
    cwd: stageDir,
    stdio: "inherit",
    env: {
      ...process.env,
      GITHUB_PAGES: "true",
      STATIC_EXPORT: "true",
      NODE_PATH: path.join(frontendDir, "node_modules"),
    },
  });

  const stageOut = path.join(stageDir, "out");
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.cpSync(stageOut, outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, ".nojekyll"), "", "utf8");
} finally {
  fs.rmSync(stageDir, { recursive: true, force: true });
}
