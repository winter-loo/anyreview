/** Timestamps use the browser media timeline; indices are zero-based presentation order. */
export type VideoIndex = { schema: 1; hash: string; timestamps: number[]; endTime: number; sourceStartTime: number; codec: string; approximate?: boolean };
export type VideoLocation = { type: 'point'; frameIndex: number; time?: number } | { type: 'range'; startFrameIndex: number; endFrameIndex: number; startTime?: number; endTimeExclusive?: number };
export type VideoAnnotation = { id: string; body: string; createdAt: string; type: 'video'; locations: VideoLocation[] };

export function frameAt(index: VideoIndex, time: number) {
 let low = 0, high = index.timestamps.length - 1;
 while (low < high) { const mid = Math.ceil((low + high) / 2); if (index.timestamps[mid] <= time + 0.000001) low = mid; else high = mid - 1; }
 return low;
}
export function frameEnd(index: VideoIndex, frame: number) { return index.timestamps[frame + 1] ?? index.endTime; }
/** Seek inside the frame interval to avoid decoder rounding at boundaries. */
export function frameSeekTime(index: VideoIndex, frame: number) { return (index.timestamps[frame] + frameEnd(index, frame)) / 2; }
export function appendLocation(locations: VideoLocation[], frame: number, range: boolean): VideoLocation[] {
 const last = locations.at(-1);
 if (range && last?.type === 'point') {
  const next: VideoLocation = frame === last.frameIndex ? last : { type: 'range', startFrameIndex: Math.min(frame, last.frameIndex), endFrameIndex: Math.max(frame, last.frameIndex) };
  return [...locations.slice(0, -1), next];
 }
 if (locations.some(p => p.type === 'point' && p.frameIndex === frame)) return locations;
 return [...locations, { type: 'point', frameIndex: frame }];
}
export function temporaryRate(base: number, direction: 'up' | 'down') {
 return Math.max(0.25, Math.min(4, direction === 'up' ? base + 1 : base === 1 ? 0.5 : base - 1));
}
export function formatVideoTime(seconds: number) {
 const ms = Math.max(0, Math.round(seconds * 1000));
 const hours = Math.floor(ms / 3600000), minutes = Math.floor(ms / 60000) % 60, secs = Math.floor(ms / 1000) % 60;
 return `${hours ? `${hours}:` : ''}${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${String(ms % 1000).padStart(3, '0')}`;
}

export type VideoMetadata = { hash: string; duration: number; fps: number; sourceStartTime: number; codec: string };
export function estimatedIndex(metadata: VideoMetadata): VideoIndex {
 const count = Math.min(1_000_000, Math.max(1, Math.ceil(metadata.duration * metadata.fps)));
 return { schema: 1, hash: metadata.hash, codec: metadata.codec, sourceStartTime: metadata.sourceStartTime, endTime: metadata.duration, approximate: true,
  timestamps: Array.from({ length: count }, (_, frame) => frame / metadata.fps) };
}
/** Stable time anchors survive a change from estimated to actual frame numbers. */
export function resolveLocation(p: VideoLocation, index: VideoIndex): VideoLocation {
 if (p.type === 'point') return p.time === undefined ? p : { ...p, frameIndex: frameAt(index, p.time) };
 return p.startTime === undefined || p.endTimeExclusive === undefined ? p : { ...p, startFrameIndex: frameAt(index, p.startTime), endFrameIndex: frameAt(index, p.endTimeExclusive - 0.000002) };
}
export function timedLocation(p: VideoLocation, index: VideoIndex): VideoLocation {
 if (p.type === 'point') return { ...p, time: p.time ?? index.timestamps[p.frameIndex] };
 return { ...p, startTime: p.startTime ?? index.timestamps[p.startFrameIndex], endTimeExclusive: p.endTimeExclusive ?? frameEnd(index, p.endFrameIndex) };
}
export function appendTimedLocation(locations: VideoLocation[], frame: number, range: boolean, index: VideoIndex): VideoLocation[] {
 const point = timedLocation({ type: 'point', frameIndex: frame }, index) as Extract<VideoLocation, {type:'point'}>;
 const last = locations.at(-1);
 if (range && last?.type === 'point') {
  const previous = resolveLocation(last, index) as Extract<VideoLocation, {type:'point'}>;
  if (previous.frameIndex === frame) return locations;
  const startTime = Math.min(last.time ?? index.timestamps[previous.frameIndex], point.time!);
  const endFrame = Math.max(previous.frameIndex, frame);
  return [...locations.slice(0,-1), { type:'range', startFrameIndex:frameAt(index,startTime), endFrameIndex:endFrame, startTime, endTimeExclusive:frameEnd(index,endFrame) }];
 }
 if (locations.some(p => p.type === 'point' && (p.time ?? index.timestamps[p.frameIndex]) === point.time)) return locations;
 return [...locations,point];
}
