import { cp, mkdtemp, symlink, writeFile } from "node:fs/promises";
import { execFileSync, spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// Re-run the permanent 50k acceptance test with ONLY the pre-fix admission loader restored.
// The working checkout, environment files and existing databases are never changed or copied.
const baseline = "989cd1e1b34b89c6890956920aa71d86c958b426";
const binary = process.argv[2];
if (!binary) throw new Error("Usage: node src/tests/run-mining-evidence-counterfactual.mjs <mongod executable>");
const backend = fileURLToPath(new URL("../../", import.meta.url));
const directory = await mkdtemp(join(tmpdir(), "louma-evidence-counterfactual-"));
await cp(join(backend, "src"), join(directory, "src"), { recursive: true });
await cp(join(backend, "package.json"), join(directory, "package.json"));
await cp(join(backend, "payment-gateway"), join(directory, "payment-gateway"), {
  recursive: true, filter: source => !source.includes("node_modules") && !source.includes(".env"),
});
await symlink(join(backend, "node_modules"), join(directory, "node_modules"), "junction");
const original = execFileSync("git", ["show", `${baseline}:back-end/src/infrastructure/mongodb/mining-admission.ts`], { cwd: backend });
await writeFile(join(directory, "src/infrastructure/mongodb/mining-admission.ts"), original);
console.log(`Counterfactual source: ${directory}; baseline ${baseline}; original checkout untouched`);
const child = spawn(process.execPath, ["src/tests/run-isolated-mining-audit.mjs", binary, "counterfactual"], {
  cwd: directory, windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
});
let output = "";
for (const stream of [child.stdout, child.stderr]) stream.on("data", chunk => { output += chunk; process.stdout.write(chunk); });
const code = await new Promise((resolve, reject) => { child.once("error", reject); child.once("exit", resolve); });
await writeFile(join(directory, "counterfactual-output.txt"), output);
if (code !== 1 || !output.includes("mining_start_busy") || !output.includes("503 !== 200")) {
  throw new Error("Counterfactual did not reproduce the expected resource refusal; inspect the retained output");
}
console.log("Confirmed pre-fix failure: the unchanged 50k acceptance test refused the O(N) loader.");
