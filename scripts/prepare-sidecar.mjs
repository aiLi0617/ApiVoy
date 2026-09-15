import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repository = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const metadata = JSON.parse(execFileSync("cargo", ["metadata", "--format-version", "1", "--no-deps"], {
  cwd: repository,
  encoding: "utf8",
}));
const host = execFileSync("rustc", ["-vV"], { encoding: "utf8" })
  .split(/\r?\n/)
  .find((line) => line.startsWith("host: "))
  ?.slice(6);

if (!host) throw new Error("Unable to determine the Rust host target triple");

execFileSync("cargo", ["build", "-p", "apivoy-local-agent", "--bin", "apivoy-agent", "-p", "apivoy-mock-server", "--bin", "apivoy-mock", "--release"], {
  cwd: repository,
  stdio: "inherit",
});

const extension = process.platform === "win32" ? ".exe" : "";
const destinationDirectory = join(repository, "apps", "desktop", "src-tauri", "binaries");
mkdirSync(destinationDirectory, { recursive: true });
for (const binary of ["apivoy-agent", "apivoy-mock"]) {
  const source = join(metadata.target_directory, "release", `${binary}${extension}`);
  const destination = join(destinationDirectory, `${binary}-${host}${extension}`);
  copyFileSync(source, destination);
  console.log(`Prepared Tauri sidecar: ${destination}`);
}
