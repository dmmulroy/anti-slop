import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const assets = join(root, "skills/install-anti-slop/assets");
const jevSource = join(root, "vendor/oxlint-plugin-jev");
const jevRepository = "https://github.com/K-Mistele/oxlint-plugin-jev";
const check = process.argv.includes("--check");

function files(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return files(path);
    return [path];
  });
}

// `src/` minus tests. License and provenance files are part of the shipped distribution too.
function antiSlopFiles() {
  const source = join(root, "src");
  return new Map(
    files(source)
      .filter((path) => !path.endsWith(".test.ts"))
      .map((path) => [relative(source, path), readFileSync(path, "utf8")]),
  );
}

// The fork's built package as consumers install it: `dist/`, license, readme, and a package.json
// reduced to what installing it needs. The fork's scripts, devDependencies, overrides, and
// devEngines only matter for building it, and npm would act on some of them in a `file:` install.
function jevPackageFiles() {
  const dist = join(jevSource, "dist");
  if (!existsSync(join(dist, "index.mjs"))) {
    throw new Error("vendor/oxlint-plugin-jev is not built; run `pnpm build:jev`.");
  }
  const commit = execFileSync("git", ["-C", jevSource, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  const manifest = JSON.parse(readFileSync(join(jevSource, "package.json"), "utf8"));
  const kept = ["name", "version", "description", "license", "type", "exports", "files", "dependencies", "peerDependencies", "engines"];
  const reduced = Object.fromEntries(kept.filter((key) => key in manifest).map((key) => [key, manifest[key]]));
  const upstream = `# oxlint-plugin-jev (vendored build)

- Source: ${jevRepository}
- Commit: ${commit}
- Built with \`pnpm build:jev\` in anti-slop (\`npm ci\` and \`vp pack\` in the \`vendor/oxlint-plugin-jev\` submodule).
- Contents: \`dist/\`, \`LICENSE\`, \`README.md\`, and \`package.json\` keeping only ${kept.map((key) => `\`${key}\``).join(", ")}.

Install it as a local package, for example \`"oxlint-plugin-jev": "file:./tools/oxlint/oxlint-plugin-jev"\`, so its
dependencies install normally. Do not edit \`dist/\`; rebuild from the source commit instead.
`;
  return new Map([
    ...files(dist).map((path) => [relative(jevSource, path), readFileSync(path, "utf8")]),
    ["LICENSE", readFileSync(join(jevSource, "LICENSE"), "utf8")],
    ["README.md", readFileSync(join(jevSource, "README.md"), "utf8")],
    ["package.json", `${JSON.stringify(reduced, null, 2)}\n`],
    ["UPSTREAM.md", upstream],
  ]);
}

const bundles = [
  { destination: join(assets, "anti-slop"), expected: antiSlopFiles(), from: "src" },
  { destination: join(assets, "oxlint-plugin-jev"), expected: jevPackageFiles(), from: "vendor/oxlint-plugin-jev" },
];

for (const { destination, expected, from } of bundles) {
  const name = relative(root, destination);
  if (check) {
    const actual = existsSync(destination) ? files(destination).map((path) => relative(destination, path)).sort() : [];
    if (JSON.stringify([...expected.keys()].sort()) !== JSON.stringify(actual)) {
      throw new Error(`${name} differs from ${from}; run \`pnpm sync:skill-assets\`.`);
    }
    for (const [path, content] of expected) {
      if (readFileSync(join(destination, path), "utf8") !== content) {
        throw new Error(`${name}/${path} differs from ${from}; run \`pnpm sync:skill-assets\`.`);
      }
    }
    console.log(`${name} matches ${from}.`);
  } else {
    rmSync(destination, { recursive: true, force: true });
    for (const [path, content] of expected) {
      mkdirSync(dirname(join(destination, path)), { recursive: true });
      writeFileSync(join(destination, path), content);
    }
    console.log(`Synced ${name}.`);
  }
}
