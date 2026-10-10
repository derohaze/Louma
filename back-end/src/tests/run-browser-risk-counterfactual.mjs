import { cp, mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// Remove only transaction risk revalidation in a temporary source copy. The same real HTTP/Mongo
// interleaving test must fail. Never copy environment files or change the working checkout.
const binary = process.argv[2];
if (!binary) throw new Error("Usage: node src/tests/run-browser-risk-counterfactual.mjs <mongod executable>");
const backend = fileURLToPath(new URL("../../", import.meta.url));
const directory = await mkdtemp(join(tmpdir(), "louma-browser-counterfactual-"));
await cp(join(backend, "src"), join(directory, "src"), { recursive: true });
await cp(join(backend, "package.json"), join(directory, "package.json"));
await cp(join(backend, "payment-gateway"), join(directory, "payment-gateway"), {
  recursive: true, filter: source => !source.includes("node_modules") && !source.includes(".env"),
});
await symlink(join(backend, "node_modules"), join(directory, "node_modules"), "junction");
const sourcePath = join(directory, "src/infrastructure/mongodb/browser-mining.ts");
let source = await readFile(sourcePath, "utf8");
const begin = source.indexOf("  if (!input.accountVerified &&");
const end = source.indexOf("  if (existing && existing.status", begin);
if (begin < 0 || end < begin) throw new Error("Risk guard source anchors changed; refusing an ambiguous counterfactual");
await writeFile(sourcePath, source.slice(0, begin) + source.slice(end));
const runner = join(directory, "src/tests/run-isolated-mining-audit.mjs");
source = await readFile(runner, "utf8");
const invocation = '["--import", "tsx", "--test", "src/tests/browser-mining.integration.test.ts"]';
if (!source.includes(invocation)) throw new Error("Runner source anchor changed");
await writeFile(runner, source.replace(invocation, '["--import", "tsx", "--test", "--test-name-pattern=a start/stop between risk", "src/tests/browser-mining.integration.test.ts"]'));
console.log(`Counterfactual source retained: ${directory}`);
const child = spawn(process.execPath, [runner, binary, "browser"], { cwd: directory, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
let output = "";
for (const stream of [child.stdout, child.stderr]) stream.on("data", chunk => { output += chunk; process.stdout.write(chunk); });
const code = await new Promise((resolve, reject) => { child.once("error", reject); child.once("exit", resolve); });
await writeFile(join(directory, "counterfactual-output.txt"), output);
if (code !== 1 || !output.includes("delayed-start status=200") || !output.includes("mining_account_verification_required")) {
  throw new Error("Expected stale-risk bypass was not reproduced; inspect retained output");
}
console.log("Confirmed: without transaction risk revalidation the delayed signed request starts without required account verification.");
