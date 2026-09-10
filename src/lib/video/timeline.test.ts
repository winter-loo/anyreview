import { expect, it } from 'vitest';
import { frameTicks, nearestFrame, pinchTimeline, timelineWindow } from './timeline';
it('zooms into the time under the fingers and returns to the whole duration when pinching inward', () => {
 expect(pinchTimeline({start:0,end:100},100,100,200,.4,.4)).toEqual({start:20,end:70});
 expect(pinchTimeline({start:20,end:70},100,200,50,.4,.4)).toEqual({start:0,end:100});
});
it('pans with the finger midpoint without changing scale', () => {
 expect(pinchTimeline({start:20,end:60},100,100,100,.5,.75)).toEqual({start:10,end:50});
});
it('bounds both ends and permits sub-second inspection without collapsing the viewport', () => {
 expect(timelineWindow(-10,20,100)).toEqual({start:0,end:20});
 expect(timelineWindow(95,20,100)).toEqual({start:80,end:100});
 expect(pinchTimeline({start:0,end:1},1,10,1000,.5,.5)).toEqual({start:.375,end:.625});
 expect(timelineWindow(0,0,.1)).toEqual({start:0,end:.1});
});

it('aligns ticks and snapping to real frame timestamps, including uneven frame durations', () => {
 const index = {schema:1 as const,hash:'test',timestamps:[0,.03,.08,.1,.15],endTime:.2,sourceStartTime:0,codec:'h264'};
 expect(frameTicks(index,.02,.16)).toEqual([1,2,3,4]);
 expect(nearestFrame(index,.071)).toBe(2);
 expect(nearestFrame(index,.085)).toBe(2);
 expect(nearestFrame(index,-1)).toBe(0);
 expect(nearestFrame(index,1)).toBe(4);
});
