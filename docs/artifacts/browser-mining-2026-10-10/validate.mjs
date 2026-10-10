import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { writeFile } from 'node:fs/promises';
const cwd = 'D:/Haze/New folder/back-end';
const root = 'D:/Haze/New folder/docs/artifacts/browser-mining-2026-10-10';
const results = [];
for (const suite of ['browser-load', 'all']) {
  const out = createWriteStream(`${root}/${suite}.log`);
  const child = spawn(process.execPath, ['src/tests/run-isolated-mining-audit.mjs', 'C:/Program Files/MongoDB/Server/8.0/bin/mongod.exe', suite], {cwd, windowsHide:true, stdio:['ignore','pipe','pipe']});
  child.stdout.on('data', chunk=>out.write(chunk)); child.stderr.on('data', chunk=>out.write(chunk));
  const code = await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve);});
  await new Promise(resolve=>out.end(resolve)); results.push({suite,code,finishedAt:new Date().toISOString()});
  await writeFile(`${root}/validation-status.json`, JSON.stringify(results,null,2));
}
