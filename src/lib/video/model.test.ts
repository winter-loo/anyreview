import { describe, expect, it } from 'vitest';
import { appendLocation, frameAt, frameSeekTime, temporaryRate, type VideoIndex } from './model';
const index: VideoIndex = { schema: 1, hash: 'vfr', codec: 'h264', timestamps: [0, 0.04, 0.16, 0.2], endTime: 0.24, sourceStartTime: 0 };
describe('video review selection', () => {
 it('keeps independent points while converting the last point into an ordered range', () => {
  const points = appendLocation(appendLocation([], 12, false), 30, false);
  expect(appendLocation(points, 20, true)).toEqual([{ type: 'point', frameIndex: 12 }, { type: 'range', startFrameIndex: 20, endFrameIndex: 30 }]);
  expect(appendLocation(points, 12, false)).toEqual(points);
  expect(appendLocation(points, 30, true)).toEqual(points);
 });
 it('locates actual variable-duration frames and seeks inside their intervals', () => {
  expect(frameAt(index, 0.12)).toBe(1);
  expect(frameAt(index, 0.16)).toBe(2);
  expect(frameAt(index, 100)).toBe(3);
  expect(frameAt(index, -1)).toBe(0);
  expect(frameSeekTime(index, 1)).toBeCloseTo(0.1);
  expect(frameSeekTime(index, 3)).toBeCloseTo(0.22);
 });
 it('uses a temporary speed relative to the selected baseline with supported bounds', () => {
  expect(temporaryRate(1, 'up')).toBe(2); expect(temporaryRate(1, 'down')).toBe(0.5);
  expect(temporaryRate(2, 'up')).toBe(3); expect(temporaryRate(2, 'down')).toBe(1);
  expect(temporaryRate(4, 'up')).toBe(4); expect(temporaryRate(0.5, 'down')).toBe(0.25);
 });
});
