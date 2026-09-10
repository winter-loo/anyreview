import { frameAt, type VideoIndex } from './model';
export type TimelineWindow = { start: number; end: number };
/** Keep a zoomed viewport inside the immutable video's time bounds. */
export function timelineWindow(start: number, span: number, duration: number): TimelineWindow {
 const boundedSpan = Math.max(Math.min(0.25, duration), Math.min(duration, span));
 const boundedStart = Math.max(0, Math.min(duration - boundedSpan, start));
 return { start: boundedStart, end: boundedStart + boundedSpan };
}
/** Preserve the time beneath the initial finger midpoint while zooming or panning. */
export function pinchTimeline(initial: TimelineWindow, duration: number, initialDistance: number, distance: number, initialRatio: number, ratio: number): TimelineWindow {
 const span = Math.max(Math.min(0.25, duration), Math.min(duration, (initial.end - initial.start) * Math.max(8, initialDistance) / Math.max(8, distance)));
 const anchor = initial.start + initialRatio * (initial.end - initial.start);
 return timelineWindow(anchor - ratio * span, span, duration);
}

/** Tick positions use actual presentation timestamps, including variable frame rates. */
export function frameTicks(index: VideoIndex, start: number, end: number, divisions = 8) {
 const first = frameAt(index, start), last = frameAt(index, end);
 const stride = Math.max(1, Math.ceil((last - first) / divisions));
 const ticks: number[] = [];
 for (let frame = Math.ceil(first / stride) * stride; frame <= last; frame += stride) {
  if (index.timestamps[frame] >= start && index.timestamps[frame] <= end) ticks.push(frame);
 }
 return ticks;
}
export function nearestFrame(index: VideoIndex, time: number) {
 const frame = frameAt(index, time), next = frame + 1;
 return next < index.timestamps.length && index.timestamps[next] - time < time - index.timestamps[frame] ? next : frame;
}
