import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const fnDir = path.join(root, "butterbase", "functions");
const deployDir = path.join(root, "butterbase", "deploy");

fs.mkdirSync(deployDir, { recursive: true });

const shared = fs.readFileSync(path.join(fnDir, "_shared.ts"), "utf8");
const sharedBody = shared.replace(/^export /gm, "");

function bundle(entryName, outName) {
  const entry = fs.readFileSync(path.join(fnDir, entryName), "utf8");
  const entryBody = entry.replace(/^import .*_shared\.ts.*\n/m, "");
  const out = `${sharedBody}\n${entryBody}`;
  const outPath = path.join(deployDir, outName);
  fs.writeFileSync(outPath, out);
  return outPath;
}

export const runInitialResearch = bundle(
  "run-initial-research.ts",
  "run-initial-research.bundle.ts",
);
