#!/usr/bin/env node
// Publishes a workspace package to NPM. Workspace packages point `main`/`types`/`exports`
// at TypeScript source for local development; this script temporarily swaps them to the
// built `dist/` output for the publish, then restores the original package.json.
// Usage: node scripts/publish-package.mjs <packages/dir> [--dry-run]
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const [packageDir, ...flags] = process.argv.slice(2);
if (!packageDir) {
  console.error("Usage: node scripts/publish-package.mjs <package-dir> [--dry-run]");
  process.exit(1);
}

const packageJsonPath = join(resolve(packageDir), "package.json");
const originalContents = readFileSync(packageJsonPath, "utf8");
const manifest = JSON.parse(originalContents);

const run = (command, args) =>
  execFileSync(command, args, { cwd: resolve(packageDir), stdio: "inherit" });

try {
  run("bun", ["run", "build"]);
  manifest.main = "./dist/index.js";
  manifest.types = "./dist/index.d.ts";
  manifest.exports = { ".": { types: "./dist/index.d.ts", default: "./dist/index.js" } };
  writeFileSync(packageJsonPath, `${JSON.stringify(manifest, null, 2)}\n`);
  run("bun", ["publish", "--access", "public", ...flags]);
} catch (error) {
  console.error(
    `Publish failed for ${manifest.name}: ${error instanceof Error ? error.message : error}`,
  );
  process.exitCode = 1;
} finally {
  writeFileSync(packageJsonPath, originalContents);
}
