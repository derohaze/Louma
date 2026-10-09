import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { test } from 'node:test';

test('plain HTML backend keeps keys server-side and reconciles an idempotent checkout', { skip: !process.env.LMA_API_KEY_FILE }, async t => {
  const environment = { ...process.env, LOUMA_BASE_URL: process.env.LMA_BASE_URL ?? 'http://127.0.0.1:8090', PORT: '8098' };
  delete environment.LOUMA_API_KEY;
  const child = spawn(process.execPath, ['payment-gateway/examples/html-backend.mjs'], { env: environment, stdio: ['ignore','pipe','pipe'], windowsHide: true });
  t.after(() => child.kill());
  await new Promise((resolve, reject) => {
    child.stdout.once('data', resolve);
    child.once('exit', code => reject(new Error(`example exited ${code}`)));
    child.once('error', reject);
  });
  const page = await fetch('http://127.0.0.1:8098/');
  const html = await page.text();
  assert.equal(page.status, 200);
  assert.equal(html.includes('lma_test_'), false);
  const cookie = page.headers.get('set-cookie').split(';')[0];
  const token = /name="csrf" value="([^"]+)"/.exec(html)[1];
  const options = body => ({ method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/x-www-form-urlencoded' }, body, redirect: 'manual' });
  assert.equal((await fetch('http://127.0.0.1:8098/api/merchant/checkout', options('csrf=wrong'))).status, 403);
  const checkout = await fetch('http://127.0.0.1:8098/api/merchant/checkout', options(`csrf=${token}`));
  assert.equal(checkout.status, 303);
  const replay = await fetch('http://127.0.0.1:8098/api/merchant/checkout', options(`csrf=${token}`));
  assert.equal(replay.headers.get('location'), checkout.headers.get('location'));
  const status = await fetch('http://127.0.0.1:8098/status', { headers: { Cookie: cookie } });
  assert.equal(await status.text(), 'Payment status: requires_action');
});
