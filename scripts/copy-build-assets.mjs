import { cpSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

cpSync(join(root, "src"), join(root, "dist"), {
  recursive: true,
  filter: (path) => !path.endsWith(".ts") || path.endsWith(".d.ts"),
});
