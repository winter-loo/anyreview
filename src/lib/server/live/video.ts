import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { createInterface } from 'node:readline';
import { readFileSync, writeFileSync, renameSync } from 'node:fs';
import type { Snapshot } from './snapshots';
import type { VideoIndex, VideoMetadata } from '$lib/video/model';
const exec = promisify(execFile);
type IndexState = { status: 'processing'; progress: number } | { status: 'ready'; index: VideoIndex } | { status: 'error'; message: string };
const jobs = new Map<string, IndexState>();
let pending = Promise.resolve();
const cachePath = (snapshot: Snapshot) => `${snapshot.files[0].snapshotPath}.frames-v1.json`;
export function readVideoIndex(snapshot: Snapshot): VideoIndex | null {
 try { const index = JSON.parse(readFileSync(cachePath(snapshot), 'utf8')) as VideoIndex; return index.schema === 1 && index.hash === snapshot.files[0].hash && index.timestamps.length ? index : null; } catch { return null; }
}
const metadataJobs = new Map<string, Promise<VideoMetadata>>();
const metadataPath = (snapshot: Snapshot) => `${snapshot.files[0].snapshotPath}.metadata-v1.json`;
export function readVideoMetadata(snapshot: Snapshot): VideoMetadata | null {
 try { const value = JSON.parse(readFileSync(metadataPath(snapshot), 'utf8')) as VideoMetadata;
  return value.hash === snapshot.files[0].hash && value.duration > 0 && Number.isFinite(value.duration) && value.fps > 0 && Number.isFinite(value.fps) ? value : null;
 } catch { return null; }
}
export function videoMetadata(snapshot: Snapshot): Promise<VideoMetadata> {
 const cached = readVideoMetadata(snapshot);
 if (cached) return Promise.resolve(cached);
 const existing = metadataJobs.get(snapshot.id); if (existing) return existing;
 const job = (async () => {
  const result = await exec('ffprobe', ['-v','error','-select_streams','v:0','-show_entries','stream=codec_name,duration,start_time,avg_frame_rate,r_frame_rate:format=duration,start_time','-of','json',snapshot.files[0].snapshotPath], {timeout:30000,maxBuffer:1024*1024});
  const data = JSON.parse(result.stdout), stream = data.streams?.[0];
  if (!stream) throw new Error('文件中没有可评审的视频轨道');
  const rate = (value: string) => { const [a,b='1'] = String(value).split('/'); return Number(a)/Number(b); };
  const average = rate(stream.avg_frame_rate), nominal = rate(stream.r_frame_rate);
  const fps = Number.isFinite(average) && average > 0 ? average : Number.isFinite(nominal) && nominal > 0 ? nominal : 30;
  const duration = Number(data.format?.duration ?? stream.duration);
  if (!Number.isFinite(duration) || duration <= 0) throw new Error('无法读取视频时长');
  const metadata: VideoMetadata = {hash:snapshot.files[0].hash,duration,fps,sourceStartTime:Number(data.format?.start_time ?? 0),codec:stream.codec_name};
  writeFileSync(metadataPath(snapshot)+'.tmp', JSON.stringify(metadata), {mode:0o600});renameSync(metadataPath(snapshot)+'.tmp', metadataPath(snapshot));
  return metadata;
 })().finally(() => metadataJobs.delete(snapshot.id));
 metadataJobs.set(snapshot.id,job); return job;
}
export function videoIndexState(snapshot: Snapshot): IndexState {
 const existing = jobs.get(snapshot.id);
 if (existing) return existing;
 const cached = readVideoIndex(snapshot);
 if (cached) return { status: 'ready', index: cached };
 const state: IndexState = { status: 'processing', progress: 0 };
 jobs.set(snapshot.id, state);
 // Decode one index at a time to keep concurrent review pages from exhausting the host.
 pending = pending.then(async () => {
  try {
   const index = await probeVideo(snapshot, progress => jobs.set(snapshot.id, { status: 'processing', progress }));
   writeFileSync(cachePath(snapshot) + '.tmp', JSON.stringify(index), { mode: 0o600 });
   renameSync(cachePath(snapshot) + '.tmp', cachePath(snapshot));
   jobs.delete(snapshot.id);
  } catch (cause) {
   jobs.set(snapshot.id, { status: 'error', message: cause instanceof Error ? cause.message : '视频帧索引失败' });
  }
 });
 return state;
}
async function probeVideo(snapshot: Snapshot, progress: (percent: number) => void): Promise<VideoIndex> {
 const file = snapshot.files[0];
 let metadata: { streams: { codec_name: string; duration?: string; start_time?: string }[]; format: { duration?: string; start_time?: string } };
 try {
  const result = await exec('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=codec_name,duration,start_time:format=duration,start_time', '-of', 'json', file.snapshotPath], { timeout: 30000, maxBuffer: 1024 * 1024 });
  metadata = JSON.parse(result.stdout);
 } catch { throw new Error('无法读取视频，请确认文件有效且服务器已安装 ffprobe'); }
 const stream = metadata.streams?.[0];
 if (!stream) throw new Error('文件中没有可评审的视频轨道');
 const origin = Number(metadata.format.start_time ?? 0);
 const duration = Number(metadata.format.duration ?? stream.duration);
 const timestamps: number[] = [];
 let lastDuration = 0;
 await new Promise<void>((resolve, reject) => {
  const child = spawn('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_frames', '-show_entries', 'frame=best_effort_timestamp_time,duration_time,pkt_duration_time', '-of', 'compact=p=0:nk=0', file.snapshotPath], { stdio: ['ignore', 'pipe', 'pipe'] });
  let failed = false, stderr = '';
  const fail = (message: string) => { if (!failed) { failed = true; child.kill(); reject(new Error(message)); } };
  const timer = setTimeout(() => fail('视频帧索引超时，请使用较短的视频后重试'), 10 * 60 * 1000);
  child.stderr.on('data', chunk => { stderr = (stderr + String(chunk)).slice(-2000); });
  const lines = createInterface({ input: child.stdout });
  lines.on('line', line => {
   if (failed || !line.includes('best_effort_timestamp_time=')) return;
   const fields = Object.fromEntries(line.split('|').map(part => part.split('=')));
   const time = Math.round((Number(fields.best_effort_timestamp_time) - origin) * 1e6) / 1e6;
   if (!Number.isFinite(time) || time < 0 || (timestamps.length && time <= timestamps[timestamps.length - 1])) return fail('视频时间戳不连续，无法提供准确帧位置');
   timestamps.push(time); lastDuration = Number(fields.duration_time ?? fields.pkt_duration_time ?? 0);
   if (timestamps.length > 1_000_000) return fail('视频帧数过多，请分段评审');
   if (timestamps.length % 100 === 0 && duration > 0) progress(Math.min(99, Math.round(time / duration * 100)));
  });
  child.on('error', () => fail('无法启动 ffprobe，请检查服务器安装'));
  child.on('close', code => { clearTimeout(timer); lines.close(); if (!failed) { if (code === 0 && !stderr.trim()) resolve(); else reject(new Error('视频解码失败，无法生成准确的帧索引')); } });
 });
 const last = timestamps.at(-1);
 const streamEnd = Number(stream.start_time ?? origin) - origin + Number(stream.duration);
 const endTime = last !== undefined && lastDuration > 0 ? Math.round((last + lastDuration) * 1e6) / 1e6 : streamEnd;
 if (last === undefined || !Number.isFinite(endTime) || endTime <= last) throw new Error('无法确定视频最后一帧的结束时间');
 return { schema: 1, hash: file.hash, timestamps, endTime, sourceStartTime: origin, codec: stream.codec_name };
}
