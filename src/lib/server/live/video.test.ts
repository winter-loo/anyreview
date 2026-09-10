import { afterAll, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { digest } from '../../../../bin/live-snapshot.js';
import { videoMetadata, videoIndexState, readVideoIndex } from './video';
import { openFeedbackDb, applyOperations, submitFeedback, agentFeedback, feedbackState } from './feedback';
import type { Snapshot } from './snapshots';
const dir = mkdtempSync(path.join(tmpdir(), 'video-review-test-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
it('indexes real VFR frames and submits mixed locations with authoritative times and no screenshots', async () => {
 const file = path.join(dir, 'vfr.mp4');
 execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc=size=64x48:rate=25', '-frames:v', '4', '-vf', "setpts='if(lt(N,2),N,N+2)/(25*TB)'", '-fps_mode', 'vfr', '-c:v', 'libx264', '-threads', '1', '-bf', '0', '-pix_fmt', 'yuv420p', file]);
 const bytes = readFileSync(file);
 const snapshot: Snapshot = { id: 'video-test', version: 'v1', kind: 'video', files: [{ filename: 'vfr.mp4', snapshotPath: file, size: bytes.length, hash: digest(bytes) }] };
 expect(videoIndexState(snapshot).status).toBe('processing');
 await expect.poll(() => videoIndexState(snapshot).status, { timeout: 10000 }).toBe('ready');
 expect(readVideoIndex(snapshot)).toMatchObject({ timestamps: [0, 0.04, 0.16, 0.2], endTime: 0.24 });
 const db = openFeedbackDb(path.join(dir, 'feedback.db'));
 const note = { id: 'mixed', body: '前两个时间点与最后一段重复', createdAt: '2026-09-10T00:00:00Z', type: 'video', locations: [{ type: 'point', frameIndex: 0 }, { type: 'point', frameIndex: 1 }, { type: 'range', startFrameIndex: 2, endFrameIndex: 3 }] };
 try {
  expect(() => applyOperations(db, snapshot, 'v1', [{ type: 'add', operationId: 'invalid', annotation: { ...note, locations: [{ type: 'point', frameIndex: 4 }] } }])).toThrow();
  expect(() => applyOperations(db, snapshot, 'v1', [{ type: 'add', operationId: 'reverse', annotation: { ...note, locations: [{ type: 'range', startFrameIndex: 3, endFrameIndex: 2 }] } }])).toThrow();
  expect(feedbackState(db, snapshot).annotations).toHaveLength(0);
  applyOperations(db, snapshot, 'v1', [{ type: 'add', operationId: 'save', annotation: note }]);
  expect(agentFeedback(db, snapshot, '/feedback').batches).toHaveLength(0);
  submitFeedback(db, snapshot, 'submit');
  const comment = agentFeedback(db, snapshot, '/feedback').batches[0].comments[0];
  expect(comment).toMatchObject({ preview: false, previewUrl: null, previewError: null, anchor: { type: 'video', frameIndexBase: 0, locations: [{ type: 'point', frameIndex: 0, time: 0 }, { type: 'point', frameIndex: 1, time: 0.04 }, { type: 'range', startFrameIndex: 2, endFrameIndex: 3, startTime: 0.16, endTimeExclusive: 0.24, frameEndpoints: 'inclusive' }] } });
 } finally { db.close(); }
}, 15000);

it('accepts and submits time anchors before indexing, then reports precise frames without moving their times', async () => {
 const file = path.join(dir,'progressive.mp4');
 execFileSync('ffmpeg',['-v','error','-f','lavfi','-i','testsrc=size=64x48:rate=25','-frames:v','4','-vf',"setpts='if(lt(N,2),N,N+2)/(25*TB)'",'-fps_mode','vfr','-c:v','libx264','-threads','1','-bf','0','-pix_fmt','yuv420p',file]);
 const bytes=readFileSync(file);
 const snapshot: Snapshot={id:'progressive',version:'v1',kind:'video',files:[{filename:'progressive.mp4',snapshotPath:file,size:bytes.length,hash:digest(bytes)}]};
 const metadata=await videoMetadata(snapshot);
 expect(metadata.fps).toBeGreaterThan(0);expect(readVideoIndex(snapshot)).toBeNull();
 const db=openFeedbackDb(path.join(dir,'progressive.db'));
 const note={id:'timed',body:'修改这些位置',createdAt:'2026-09-10T00:00:00Z',type:'video',locations:[{type:'point',frameIndex:3,time:.12},{type:'range',startFrameIndex:3,endFrameIndex:5,startTime:.12,endTimeExclusive:.24}]};
 try {
  expect(()=>applyOperations(db,snapshot,'v1',[{type:'add',operationId:'bad-time',annotation:{...note,locations:[{type:'point',frameIndex:0,time:-1}]}}])).toThrow();
  applyOperations(db,snapshot,'v1',[{type:'add',operationId:'save-timed',annotation:note}]);
  submitFeedback(db,snapshot,'submit-timed');
  expect(agentFeedback(db,snapshot,'/feedback').batches[0].comments[0].anchor).toMatchObject({framePrecision:'estimated',locations:[{time:.12},{startTime:.12,endTimeExclusive:.24}]});
  videoIndexState(snapshot);await expect.poll(()=>videoIndexState(snapshot).status,{timeout:10000}).toBe('ready');
  expect(agentFeedback(db,snapshot,'/feedback').batches[0].comments[0].anchor).toMatchObject({framePrecision:'exact',locations:[{frameIndex:1,time:.12},{startFrameIndex:1,endFrameIndex:3,startTime:.12,endTimeExclusive:.24}]});
  expect(feedbackState(db,snapshot).annotations[0].locations).toEqual(note.locations);
 } finally {db.close();}
},15000);
