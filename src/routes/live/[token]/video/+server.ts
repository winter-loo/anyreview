import { createReadStream } from 'node:fs';
import { Readable } from 'node:stream';
import path from 'node:path';
import { error, json } from '@sveltejs/kit';
import { liveSnapshot } from '$lib/server/live/snapshots';
import { videoIndexState, videoMetadata } from '$lib/server/live/video';
import type { RequestHandler } from './$types';
export const GET: RequestHandler = async ({ params, request, url }) => {
 const snapshot = liveSnapshot(params.token);
 if (snapshot.kind !== 'video') throw error(415, 'Not a video review');
 if (url.searchParams.has('index')) {
  const state = videoIndexState(snapshot);
  const metadata = state.status === 'ready' ? undefined : await videoMetadata(snapshot).catch(() => undefined);
  return json({ ...state, metadata }, { status: state.status === 'processing' ? 202 : 200, headers: { 'cache-control': 'no-store' } });
 }
 const file = snapshot.files[0], size = file.size;
 const headers: Record<string, string> = { 'accept-ranges': 'bytes', 'cache-control': 'private, max-age=31536000, immutable', 'x-content-type-options': 'nosniff', 'content-type': path.extname(file.filename).toLowerCase() === '.webm' ? 'video/webm' : path.extname(file.filename).toLowerCase() === '.mov' ? 'video/quicktime' : 'video/mp4' };
 let start = 0, end = size - 1;
 const range = request.headers.get('range');
 if (range) {
  const match = /^bytes=(\d*)-(\d*)$/.exec(range);
  if (!match || (!match[1] && !match[2])) return new Response(null, { status: 416, headers: { ...headers, 'content-range': `bytes */${size}` } });
  start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
  end = match[1] && match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= size) return new Response(null, { status: 416, headers: { ...headers, 'content-range': `bytes */${size}` } });
  headers['content-range'] = `bytes ${start}-${end}/${size}`;
 }
 headers['content-length'] = String(end - start + 1);
 const stream = createReadStream(file.snapshotPath, { start, end });
 return new Response(Readable.toWeb(stream) as ReadableStream<Uint8Array>, { status: range ? 206 : 200, headers });
};
