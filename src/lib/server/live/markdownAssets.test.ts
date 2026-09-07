import { createCipheriv, createHash, randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, truncateSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { load } from '../../../routes/live/[token]/+page.server';
import { GET } from '../../../routes/live/[token]/assets/[assetId]/+server';
import { liveSnapshot } from './snapshots';
import { markdownImageId, markdownImageUrl } from './markdownAssets';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
const secret = 'markdown-assets-test';
let directory: string, source: string, document: string, token: string;
function encode(file: string) {
 const iv = randomBytes(12);
 const cipher = createCipheriv('aes-256-gcm', createHash('sha256').update(secret).digest(), iv);
 const encrypted = Buffer.concat([cipher.update(file), cipher.final()]);
 return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64url');
}
function publish(markdown: string) {
 writeFileSync(document, markdown); token = encode(document);
 return load({ params: { token }, setHeaders: () => {} } as any) as any;
}
function get(src: string, reviewToken = token) {
 return GET({ params: { token: reviewToken, assetId: markdownImageId(src) } } as any);
}
beforeEach(() => {
 directory = mkdtempSync(path.join(homedir(), '.reviewloop-images-test-'));
 source = path.join(directory, 'source'); mkdirSync(source);
 document = path.join(source, 'review.md');
 vi.stubEnv('ONLINE_REVIEW_URL_SECRET', secret);
 vi.stubEnv('ONLINE_REVIEW_FEEDBACK_HOME', path.join(directory, 'feedback'));
});
afterEach(() => { vi.unstubAllEnvs(); rmSync(directory, { recursive: true, force: true }); });

describe('Markdown local images', () => {
 it('rewrites absolute, relative and reference-style images and reads originals without copying them', async () => {
  mkdirSync(path.join(source, 'images'));
  const absolute = path.join(source, 'absolute.png');
  writeFileSync(absolute, png);
  writeFileSync(path.join(source, 'images', 'relative.png'), png);
  writeFileSync(path.join(source, 'space 图 #1.png'), png);
  const encoded = encodeURI('space 图 ') + '%231.png';
  const markdown = `# Test\n\n![Absolute](${absolute})\n\n![Relative](images/relative.png)\n\n![Reference][picture]\n\n[picture]: <space 图 %231.png>\n`;
  const data = publish(markdown);
  const html = data.renderedBlocks.map((b: any) => b.html).join('');
  for (const src of [absolute, 'images/relative.png', encoded]) {
   expect(html).toContain(markdownImageUrl(token, src));
   const response = await get(src);
   expect(response.headers.get('content-type')).toBe('image/png');
   expect(Buffer.from(await response.arrayBuffer()).equals(png)).toBe(true);
  }
  expect(readFileSync(document, 'utf8')).toBe(markdown);
  const snapshot = liveSnapshot(token);
  expect(snapshot.files).toHaveLength(1);
  expect(readdirSync(path.dirname(snapshot.files[0].snapshotPath))).toEqual(['review.md']);
 });
 it('serves updated image bytes without a stale cache, even after the original Markdown is deleted', async () => {
  const image = path.join(source, 'image.png'); writeFileSync(image, png);
  publish('![Image](image.png)'); unlinkSync(document);
  let response = await get('image.png');
  expect(response.headers.get('cache-control')).toBe('no-store'); await response.arrayBuffer();
  const updated = Buffer.concat([png, Buffer.from('updated')]); writeFileSync(image, updated);
  response = await get('image.png');
  expect(Buffer.from(await response.arrayBuffer()).equals(updated)).toBe(true);
 });
 it('does not grant access to unreferenced images, including references added after publication', async () => {
  writeFileSync(path.join(source, 'private.png'), png); publish('# No images');
  writeFileSync(document, '![New](private.png)');
  await expect(get('private.png')).rejects.toMatchObject({ status: 404 });
 });
 it.each(['../outside.png', '%2e%2e/outside.png', 'escape.png'])('blocks traversal or symlink escape: %s', async src => {
  const outside = path.join(directory, 'outside.png'); writeFileSync(outside, png);
  symlinkSync(outside, path.join(source, 'escape.png'));
  publish(`![Outside](${src})`);
  await expect(get(src)).rejects.toMatchObject({ status: 403 });
 });
 it('allows symlinks whose canonical target stays in the document directory', async () => {
  writeFileSync(path.join(source, 'target.png'), png); symlinkSync('target.png', path.join(source, 'link.png'));
  publish('![Linked](link.png)');
  expect(Buffer.from(await (await get('link.png')).arrayBuffer()).equals(png)).toBe(true);
 });
 it('rejects a tampered token, missing files, unsupported types, directories and oversized images', async () => {
  writeFileSync(path.join(source, 'notes.txt'), 'private');
  mkdirSync(path.join(source, 'directory.png'));
  writeFileSync(path.join(source, 'big.png'), png); truncateSync(path.join(source, 'big.png'), 5 * 1024 * 1024 + 1);
  publish('![Missing](missing.png)\n![Text](notes.txt)\n![Dir](directory.png)\n![Big](big.png)');
  await expect(get('missing.png', token + 'x')).rejects.toMatchObject({ status: 404 });
  await expect(get('missing.png')).rejects.toMatchObject({ status: 404 });
  await expect(get('notes.txt')).rejects.toMatchObject({ status: 415 });
  await expect(get('directory.png')).rejects.toMatchObject({ status: 404 });
  await expect(get('big.png')).rejects.toMatchObject({ status: 413 });
 });
 it('keeps remote and data URLs unchanged and does not serve them through the local endpoint', async () => {
  const remote = 'https://example.com/image.png', dataUrl = `data:image/png;base64,${png.toString('base64')}`;
  const data = publish(`![Remote](${remote})\n![Data](${dataUrl})\n![CDN](//example.com/image.png)`);
  const html = data.renderedBlocks.map((b: any) => b.html).join('');
  expect(html).toContain(remote); expect(html).toContain(dataUrl); expect(html).not.toContain('/assets/');
  await expect(get(remote)).rejects.toMatchObject({ status: 404 });
 });
 it('sandboxes SVG responses when opened directly', async () => {
  writeFileSync(path.join(source, 'diagram.svg'), '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
  publish('![Diagram](diagram.svg)');
  const response = await get('diagram.svg');
  expect(response.headers.get('content-type')).toBe('image/svg+xml');
  expect(response.headers.get('content-security-policy')).toContain('sandbox');
  expect(response.headers.get('x-content-type-options')).toBe('nosniff');
  await response.text();
 });
});
