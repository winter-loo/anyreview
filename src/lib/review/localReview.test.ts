import { expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir, networkInterfaces } from 'node:os';
import path from 'node:path';

async function withReviewServer(run: (port: number) => Promise<void>) {
 const server = createServer((request, response) => {
  response.setHeader('content-type', 'application/json');
  response.end(JSON.stringify({ service: 'anyreview' }));
 });
 await new Promise<void>((resolve) => server.listen(0, '0.0.0.0', resolve));
 try { await run((server.address() as { port: number }).port); }
 finally { await new Promise<void>((resolve) => server.close(() => resolve())); }
}

function cli(args: string[], env: NodeJS.ProcessEnv, input = ''): Promise<string> {
 return new Promise((resolve, reject) => {
  const child = spawn(process.execPath, ['bin/review.js', ...args], { env });
  let stdout = '', stderr = '';
  child.stdout.setEncoding('utf8').on('data', (chunk) => { stdout += chunk; });
  child.stderr.setEncoding('utf8').on('data', (chunk) => { stderr += chunk; });
  child.on('error', reject);
  child.on('close', (code) => code === 0 ? resolve(stdout.trim()) : reject(new Error(stderr.trim())));
  child.stdin.end(input);
 });
}

it('publishes local links for files, paste and clipboard and remembers the local target', async () => {
 await withReviewServer(async (port) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'local-review-'));
  try {
   const file = path.join(dir, 'sample.md'); writeFileSync(file, '# Local');
   const bin = path.join(dir, 'bin'); mkdirSync(bin);
   writeFileSync(path.join(bin, 'wl-paste'), `#!${process.execPath}\nprocess.stdout.write('# Clipboard');`, { mode: 0o700 });
   const env = { ...process.env, HOME: dir, PATH: bin, PORT: String(port), WAYLAND_DISPLAY: 'test', WSL_INTEROP: '', WSL_DISTRO_NAME: '', ONLINE_REVIEW_BASE_URL: 'https://public.test/live', ONLINE_REVIEW_URL_SECRET: 'local-test', ONLINE_REVIEW_FEEDBACK_HOME: path.join(dir, 'feedback'), ONLINE_REVIEW_SHORT_LINKS_DB: path.join(dir, 'links.db') };
   for (const args of [[file, '--local'], ['paste', '--local', '--long'], ['--clipboard', '--local']]) {
    const url = await cli(args, env, '# Paste');
    expect(url).toMatch(new RegExp(`^http://127\\.0\\.0\\.1:${port}/live/`));
    expect(JSON.parse(readFileSync(path.join(dir, 'feedback/latest-review.json'), 'utf8')).url).toBe(url);
   }
   expect(await cli([file, '--local'], env)).toMatch(new RegExp(`^http://127\\.0\\.0\\.1:${port}/live/`));
   expect(await cli([file], env)).toMatch(/^https:\/\/public\.test\/live\//);
  } finally { rmSync(dir, { recursive: true, force: true }); }
 });
}, 20000);

it('gives one document one URL across edits and a different document another', async () => {
 await withReviewServer(async (port) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'stable-url-'));
  try {
   const file = path.join(dir, 'doc.md'); writeFileSync(file, '# One');
   const other = path.join(dir, 'other.md'); writeFileSync(other, '# Two');
   const env = { ...process.env, HOME: dir, PORT: String(port), ONLINE_REVIEW_URL_SECRET: 'stable-url-test', ONLINE_REVIEW_FEEDBACK_HOME: path.join(dir, 'feedback'), ONLINE_REVIEW_SHORT_LINKS_DB: path.join(dir, 'links.db') };
   const publish = (target: string, ...args: string[]) => cli([target, '--local', ...args], env);
   const url = await publish(file);
   expect(await publish(file)).toBe(url);
   writeFileSync(file, '# One, rewritten by the agent');
   expect(await publish(file)).toBe(url);
   expect(await publish(other)).not.toBe(url);
   expect(await publish(file, '--long')).toBe(await publish(file, '--long'));
  } finally { rmSync(dir, { recursive: true, force: true }); }
 });
}, 20000);

it('uses loopback when no URL mode or public base URL is configured', async () => {
 await withReviewServer(async (port) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'default-review-'));
  try {
   const file = path.join(dir, 'sample.md'); writeFileSync(file, '# Default');
   const inheritedEnv: NodeJS.ProcessEnv = { ...process.env };
   delete inheritedEnv.ONLINE_REVIEW_BASE_URL;
   const env = { ...inheritedEnv, HOME: dir, PORT: String(port), ONLINE_REVIEW_URL_SECRET: 'default-test', ONLINE_REVIEW_FEEDBACK_HOME: path.join(dir, 'feedback'), ONLINE_REVIEW_SHORT_LINKS_DB: path.join(dir, 'links.db') };
   expect(await cli([file], env)).toMatch(new RegExp(`^http://127\\.0\\.0\\.1:${port}/live/`));
  } finally { rmSync(dir, { recursive: true, force: true }); }
 });
}, 20000);

it('creates and reuses a private URL secret when none is configured', async () => {
 await withReviewServer(async (port) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'automatic-review-secret-'));
  try {
   const file = path.join(dir, 'sample.md'); writeFileSync(file, '# Automatic secret');
   const env: NodeJS.ProcessEnv = { ...process.env, HOME: dir, PORT: String(port), ONLINE_REVIEW_FEEDBACK_HOME: path.join(dir, 'feedback'), ONLINE_REVIEW_SHORT_LINKS_DB: path.join(dir, 'links.db') };
   delete env.ONLINE_REVIEW_URL_SECRET;
   const publish = () => cli([file, '--local', '--long'], env);
   const first = await publish();
   expect(await publish()).toBe(first);
   expect(readFileSync(path.join(dir, '.config/online-review.secret'), 'utf8').trim()).toMatch(/^[a-f0-9]{64}$/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
 });
}, 20000);

it('publishes with an explicitly selected local network address', async () => {
 const lanAddress = Object.entries(networkInterfaces()).filter(([name]) => !/tun|wsl/i.test(name)).flatMap(([, entries]) => entries ?? []).find((entry) => entry.family === 'IPv4' && !entry.internal && (/^(10\.|192\.168\.)/.test(entry.address) || /^172\.(1[6-9]|2\d|3[01])\./.test(entry.address)))?.address;
 if (!lanAddress) return;
 await withReviewServer(async (port) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'localnet-review-'));
  try {
   const file = path.join(dir, 'sample.md'); writeFileSync(file, '# Local network');
   const env = { ...process.env, HOME: dir, PORT: String(port), ONLINE_REVIEW_URL_SECRET: 'localnet-test', ONLINE_REVIEW_FEEDBACK_HOME: path.join(dir, 'feedback'), ONLINE_REVIEW_SHORT_LINKS_DB: path.join(dir, 'links.db') };
   expect(await cli([file, `--localnet=${lanAddress}`], env)).toMatch(new RegExp(`^http://${lanAddress.replaceAll('.', '\\.')}:${port}/live/`));
  } finally { rmSync(dir, { recursive: true, force: true }); }
 });
}, 20000);
