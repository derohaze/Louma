import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const backend = fileURLToPath(new URL('../../../back-end/', import.meta.url));
const frontend = fileURLToPath(new URL('../../../frontend/', import.meta.url));
const root = fileURLToPath(new URL('./', import.meta.url));
const binary = process.argv[2];
if (!binary) throw new Error('Pass the mongod executable; the audit creates its own isolated database.');
const pkg = JSON.parse(await readFile(`${backend}/package.json`, 'utf8'));
const checks = [
  ['backend-typecheck', backend, ['node_modules/typescript/bin/tsc', '--noEmit', '-p', 'tsconfig.json']],
  ['frontend-typecheck', frontend, ['node_modules/typescript/bin/tsc', '--noEmit']],
  ['unit', backend, pkg.scripts.test.split(' ').slice(1)],
  ['browser-load-telemetry', backend, ['src/tests/run-isolated-mining-audit.mjs', binary, 'browser-load']],
];
const results = [];
for (const [name, cwd, args] of checks) {
  const out = createWriteStream(`${root}/${name}.log`);
  const child = spawn(process.execPath, args, { cwd, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', chunk => out.write(chunk));
  child.stderr.on('data', chunk => out.write(chunk));
  const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', resolve); });
  await new Promise(resolve => out.end(resolve));
  results.push({ name, code, finishedAt: new Date().toISOString() });
  await writeFile(`${root}/final-status.json`, JSON.stringify(results, null, 2));
  if (code !== 0) { process.exitCode = 1; break; }
}
