import { chmod, copyFile, mkdir } from "node:fs/promises";
import path from "node:path";

if (process.platform !== "darwin") {
  process.exit(0);
}

const repoRoot = path.resolve(import.meta.dir, "..");
const srcTauri = path.join(repoRoot, "src-tauri");
const inferredTarget =
  process.arch === "arm64"
    ? "aarch64-apple-darwin"
    : process.arch === "x64"
      ? "x86_64-apple-darwin"
      : "";

const target = (process.env.HANDY_BUILD_TARGET || inferredTarget).trim();
if (!["aarch64-apple-darwin", "x86_64-apple-darwin"].includes(target)) {
  throw new Error(
    `Direct local LLM helper: unsupported macOS target "${target || "(empty)"}"`,
  );
}

const manifest = path.join(srcTauri, "local-llm-helper", "Cargo.toml");
const cargo = Bun.spawn({
  cmd: [
    "cargo",
    "build",
    "--release",
    "--manifest-path",
    manifest,
    "--target",
    target,
    "--target-dir",
    path.join(srcTauri, "target"),
  ],
  cwd: repoRoot,
  stdin: "inherit",
  stdout: "inherit",
  stderr: "inherit",
  env: process.env,
});

const exitCode = await cargo.exited;
if (exitCode !== 0) {
  throw new Error(`Direct local LLM helper build failed with exit code ${exitCode}`);
}

const source = path.join(
  srcTauri,
  "target",
  target,
  "release",
  "handy-local-llm",
);
const binariesDir = path.join(srcTauri, "binaries");
const destination = path.join(
  binariesDir,
  `handy-local-llm-${target}`,
);

await mkdir(binariesDir, { recursive: true });
await copyFile(source, destination);
await chmod(destination, 0o755);
console.log(`Prepared direct local LLM helper: ${destination}`);
