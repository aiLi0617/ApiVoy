import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const styles = readFileSync(new URL("./styles.css", import.meta.url), "utf8");

assert.match(
  styles,
  /:root\[data-theme="light"\][\s\S]*?--apivoy-project-rail:\s*var\(--apivoy-nav\)/,
  "light project rail must use the navigation surface without a dark mix",
);
assert.match(
  styles,
  /\.project-module-nav\s*\{[^}]*background:\s*var\(--apivoy-project-rail\)/,
  "project rail must use its theme-aware surface token",
);

console.log("Theme style tests passed");
