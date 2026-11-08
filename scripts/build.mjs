import { execFileSync } from "node:child_process";
import { copyFileSync, rmSync } from "node:fs";

rmSync("dist", { recursive: true, force: true });
execFileSync("tsc", ["-p", "tsconfig.build.json"], { stdio: "inherit" });

for (const file of ["LICENSE", "UPSTREAM.md", "padding-line-options.d.ts"]) {
  copyFileSync(`src/vendor/eslint-stylistic/${file}`, `dist/vendor/eslint-stylistic/${file}`);
}
