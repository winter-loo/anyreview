import { expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { networkInterfaces, tmpdir } from 'node:os';
import path from 'node:path';

async function unusedPort() {
 const server = createServer();
 await new Promise<void>((resolve, reject) => server.listen(0, '127.0.0.1', resolve).once('error', reject));
 const address = server.address();
 if (!address || typeof address === 'string') throw new Error('Could not allocate a test port');
 await new Promise<void>((resolve) => server.close(() => resolve()));
 return String(address.port);
}

function stopServer(home: string, port: string) {
 try {
  const pid = Number(readFileSync(path.join(home, '.config/anyreview', `server-${port}.pid`), 'utf8'));
  if (Number.isSafeInteger(pid)) process.kill(pid);
 } catch {}
}

function fixtureEnv(home: string, port: string) {
 return {
  ...process.env, HOME: home, USERPROFILE: home, PORT: port,
  REVIEW_SERVER_AUTOSTART: '1',
  REVIEW_SERVER_ENTRY: path.resolve('src/lib/review/fixtures/review-server.mjs'),
  ONLINE_REVIEW_URL_SECRET: 'autostart-test',
  ONLINE_REVIEW_FEEDBACK_HOME: path.join(home, 'feedback'),
  ONLINE_REVIEW_SHORT_LINKS_DB: path.join(home, 'links.db')
 };
}

it('starts a loopback server for a local URL', async () => {
 const home = mkdtempSync(path.join(tmpdir(), 'review-autostart-'));
 const port = await unusedPort();
 try {
  const file = path.join(home, 'sample.md'); writeFileSync(file, '# Autostart');
  const url = execFileSync(process.execPath, ['bin/review.js', file, '--local'], { env: fixtureEnv(home, port), encoding: 'utf8' }).trim();
  expect(url).toMatch(new RegExp(`^http://127\\.0\\.0\\.1:${port}/live/`));
  await expect(fetch(url).then((response) => response.text())).resolves.toBe('AnyReview test server');
 } finally { stopServer(home, port); rmSync(home, { recursive: true, force: true }); }
}, 15000);

it('starts a LAN-bound server for a local network URL', async () => {
 const address = Object.entries(networkInterfaces()).filter(([name]) => !/tun|wsl/i.test(name)).flatMap(([, entries]) => entries ?? []).find((entry) => entry.family === 'IPv4' && !entry.internal && (/^(10\.|192\.168\.)/.test(entry.address) || /^172\.(1[6-9]|2\d|3[01])\./.test(entry.address)))?.address;
 if (!address) return;
 const home = mkdtempSync(path.join(tmpdir(), 'review-lan-autostart-'));
 const port = await unusedPort();
 try {
  const file = path.join(home, 'sample.md'); writeFileSync(file, '# LAN');
  const url = execFileSync(process.execPath, ['bin/review.js', file, `--localnet=${address}`], { env: fixtureEnv(home, port), encoding: 'utf8' }).trim();
  expect(url).toContain(`http://${address}:${port}/live/`);
  await expect(fetch(url).then((response) => response.text())).resolves.toBe('AnyReview test server');
 } finally { stopServer(home, port); rmSync(home, { recursive: true, force: true }); }
}, 15000);

it('starts the server before configuring a tailnet tunnel', async () => {
 const home = mkdtempSync(path.join(tmpdir(), 'review-tailnet-autostart-'));
 const port = await unusedPort();
 try {
  const file = path.join(home, 'sample.md'); writeFileSync(file, '# Tailnet');
  const bin = path.join(home, 'bin'); mkdirSync(bin);
  const fake = `#!${process.execPath}\nif(process.argv[2]==='status')process.stdout.write(JSON.stringify({BackendState:'Running',Self:{Online:true,DNSName:'review.test.ts.net.'}}));`;
  const tailscale = path.join(bin, 'tailscale'); writeFileSync(tailscale, fake, { mode: 0o700 });
  const env = { ...fixtureEnv(home, port), TAILSCALE_BIN: process.execPath, TAILSCALE_BIN_ARGS: JSON.stringify([tailscale]) };
  const url = execFileSync(process.execPath, ['bin/review.js', file, '--tailnet'], { env, encoding: 'utf8' }).trim();
  expect(url).toMatch(/^https:\/\/review\.test\.ts\.net\/live\//);
  await expect(fetch(`http://127.0.0.1:${port}/`).then((response) => response.text())).resolves.toBe('AnyReview test server');
 } finally { stopServer(home, port); rmSync(home, { recursive: true, force: true }); }
}, 15000);
