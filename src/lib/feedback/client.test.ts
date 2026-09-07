import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openFeedbackDb, applyOperations, feedbackState, submitFeedback, agentFeedback } from '$lib/server/live/feedback';
import type { Snapshot } from '$lib/server/live/snapshots';
import type { Annotation, FeedbackOperation } from './types';
import { MAX_FEEDBACK_REQUEST_BYTES, MAX_PREVIEW_BYTES } from './limits';

vi.mock('svelte', () => ({ setContext: vi.fn() }));
vi.mock('./preview', () => ({ capturePreview: vi.fn() }));
import { capturePreview } from './preview';
import { createLiveFeedback } from './client.svelte';

const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const snapshot: Snapshot = { id: 'r1', version: 'v1', kind: 'image', files: [{ filename: 'photo.png', hash: 'abc', size: 1, snapshotPath: '/unused' }] };
const annotation: Annotation = { id: 'a1', body: 'Change this region', createdAt: '2026-09-07T00:00:00Z', imageIndex: 0, badgePosition: { x: 0.2, y: 0.3 }, strokes: [{ color: '#ff0000', size: 3, points: [{ x: 0.2, y: 0.3 }, { x: 0.4, y: 0.5 }] }] };
let directory: string;
let db: ReturnType<typeof openFeedbackDb>;
let entries: Annotation[];
let feedback: ReturnType<typeof createLiveFeedback<Annotation>>;
let stop: (() => void) | undefined;
let stored: Map<string, string>;
let previewRejection: number;
let requests: { operations?: FeedbackOperation[]; submit?: string }[];

beforeEach(() => {
 directory = mkdtempSync(path.join(tmpdir(), 'feedback-client-'));
 db = openFeedbackDb(path.join(directory, 'feedback.db'));
 entries = []; stored = new Map(); requests = []; previewRejection = 0;
 vi.stubGlobal('localStorage', {
  getItem: (key: string) => stored.get(key) ?? null,
  setItem: (key: string, value: string) => stored.set(key, value),
  removeItem: (key: string) => stored.delete(key)
 });
 vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn() });
 vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
  if (init?.body) {
   if (new TextEncoder().encode(init.body).length > MAX_FEEDBACK_REQUEST_BYTES) return Response.json({ message: 'Feedback request too large' }, { status: 413 });
   const body = JSON.parse(init.body); requests.push(body);
   if (body.operations?.some((op: FeedbackOperation) => op.preview) && previewRejection) {
    return Response.json({ message: 'Upload rejected' }, { status: previewRejection });
   }
   try {
    if (body.operations) applyOperations(db, snapshot, body.version, body.operations);
    if (body.submit) submitFeedback(db, snapshot, body.submit);
   } catch (cause: any) {
    return Response.json(cause.body ?? { message: 'Server error' }, { status: cause.status ?? 500 });
   }
  }
  return Response.json(feedbackState(db, snapshot));
 }));
 vi.mocked(capturePreview).mockResolvedValue(png);
 feedback = createLiveFeedback({ token: () => 'token', kind: 'image', read: () => entries, replace: next => { entries = next; } });
});
afterEach(() => {
 stop?.(); stop = undefined; db.close(); rmSync(directory, { recursive: true, force: true }); vi.unstubAllGlobals();
});
async function start() { stop = feedback.start([]); await feedback.context.retry(); }
function submittedComment() { return agentFeedback(db, snapshot, '/feedback').batches[0].comments[0]; }

describe('preview upload fallback', () => {
 it.each([MAX_PREVIEW_BYTES + 1, MAX_FEEDBACK_REQUEST_BYTES])('submits annotations when a generated PNG is %i bytes', async (size) => {
  vi.mocked(capturePreview).mockResolvedValue('data:image/png;base64,' + Buffer.alloc(size).toString('base64'));
  await start(); feedback.persist([annotation]); await feedback.context.submit();
  expect(feedback.context.error).toBe('');
  expect(submittedComment()).toMatchObject({ body: annotation.body, preview: false, previewError: expect.stringContaining('2 MiB') });
  expect(requests.flatMap(r => r.operations ?? []).every(op => !op.preview)).toBe(true);
  expect(JSON.parse(stored.get('reviewloop:feedback:token')!).queue).toEqual([]);
 });
 it('repairs oversized previews restored from the old local queue', async () => {
  stored.set('reviewloop:feedback:token', JSON.stringify({ initialized: true, queue: [
   { operationId: 'add', type: 'add', annotation },
   { operationId: 'preview', type: 'preview', id: annotation.id, preview: 'data:image/png;base64,' + Buffer.alloc(MAX_PREVIEW_BYTES + 1).toString('base64') }
  ] }));
  await start(); await feedback.context.submit();
  expect(feedback.context.error).toBe('');
  expect(submittedComment()).toMatchObject({ preview: false, previewError: expect.stringContaining('2 MiB') });
 });
 it('retries a server-rejected preview as an error-only operation', async () => {
  previewRejection = 413;
  await start(); feedback.persist([annotation]); await feedback.context.submit();
  const previews = requests.flatMap(r => r.operations ?? []).filter(op => op.type === 'preview');
  expect(previews).toHaveLength(2);
  expect(previews[0].preview).toBe(png);
  expect(previews[1]).toMatchObject({ operationId: previews[0].operationId, previewError: expect.stringContaining('服务器限制') });
  expect(previews[1].preview).toBeUndefined();
  expect(feedback.context.error).toBe('');
  expect(submittedComment()).toMatchObject({ preview: false, body: annotation.body });
 });
 it('retains valid previews after temporary server failures and retries them', async () => {
  previewRejection = 503;
  await start(); feedback.persist([annotation]); await feedback.context.submit();
  expect(feedback.context.error).toBe('Upload rejected');
  expect(JSON.parse(stored.get('reviewloop:feedback:token')!).queue[0].preview).toBe(png);
  expect(agentFeedback(db, snapshot, '/feedback').batches).toHaveLength(0);
  previewRejection = 0; await feedback.context.submit();
  expect(feedback.context.error).toBe('');
  expect(submittedComment()).toMatchObject({ preview: true, previewUrl: '/feedback?preview=a1' });
 });
 it('keeps normally sized PNG previews', async () => {
  await start(); feedback.persist([annotation]); await feedback.context.submit();
  expect(feedback.context.error).toBe('');
  expect(submittedComment()).toMatchObject({ preview: true, previewUrl: '/feedback?preview=a1' });
 });
});
