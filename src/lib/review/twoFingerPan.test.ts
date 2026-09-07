import { describe, expect, it, vi } from 'vitest';
import { twoFingerPan } from './twoFingerPan';

function touch(type: string, points: {clientX:number; clientY:number}[]) {
 return Object.assign(new Event(type, {cancelable:true}), { touches:points });
}
function target() {
 return Object.assign(new EventTarget(), { scrollLeft:100, scrollTop:200, getBoundingClientRect:()=>({left:0,top:0}) }) as unknown as HTMLElement;
}

describe('two-finger navigation while drawing', () => {
 it('leaves single-finger ink alone and cancels the active stroke before navigating', () => {
  const node=target(), cancel=vi.fn(), zoom=vi.fn();
  const action=twoFingerPan(node,{enabled:true,zoom:1,min:.25,max:2,onzoom:zoom,oncancel:cancel});
  const single=touch('touchstart',[{clientX:100,clientY:100}]);node.dispatchEvent(single);
  expect(single.defaultPrevented).toBe(false);expect(cancel).not.toHaveBeenCalled();
  node.dispatchEvent(touch('touchstart',[{clientX:100,clientY:100},{clientX:200,clientY:100}]));
  expect(cancel).toHaveBeenCalledOnce();
  const move=touch('touchmove',[{clientX:80,clientY:70},{clientX:180,clientY:70}]);node.dispatchEvent(move);
  expect(move.defaultPrevented).toBe(true);expect(node.scrollLeft).toBe(120);expect(node.scrollTop).toBe(230);
  expect(zoom).toHaveBeenLastCalledWith(1);
  node.dispatchEvent(touch('touchend',[]));
  const pointer=Object.assign(new Event('pointermove',{cancelable:true}),{pointerType:'touch',isPrimary:true});node.dispatchEvent(pointer);
  expect(pointer.defaultPrevented).toBe(false);
  action.destroy();
 });
 it('bounds pinch zoom and stops changing state after cleanup or when disabled', () => {
  const node=target(), cancel=vi.fn(), zoom=vi.fn();const options={enabled:true,zoom:1,min:.5,max:2,onzoom:zoom,oncancel:cancel};
  const action=twoFingerPan(node,options);
  const points=[{clientX:100,clientY:100},{clientX:200,clientY:100}];
  node.dispatchEvent(touch('touchstart',points));node.dispatchEvent(touch('touchmove',[points[0],{clientX:500,clientY:100}]));
  expect(zoom).toHaveBeenLastCalledWith(2);
  node.dispatchEvent(touch('touchend',[]));action.update({...options,enabled:false});
  cancel.mockClear();node.dispatchEvent(touch('touchstart',points));expect(cancel).not.toHaveBeenCalled();
  action.destroy();action.update(options);node.dispatchEvent(touch('touchstart',points));expect(cancel).not.toHaveBeenCalled();
 });
});
