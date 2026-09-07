/** Keep one-finger ink separate from two-finger navigation on scrollable documents. */
export function twoFingerPan(node: HTMLElement, options: {
 enabled: boolean; zoom: number; min: number; max: number;
 onzoom: (zoom: number) => void; oncancel: () => void;
}) {
 let current = options;
 let navigating = false;
 let initial: { x: number; y: number; distance: number; zoom: number; left: number; top: number } | null = null;
 function start(event: TouchEvent) {
  if (!current.enabled || event.touches.length !== 2) return;
  event.preventDefault(); navigating = true; current.oncancel();
  const [a,b] = Array.from(event.touches);
  initial = { x:(a.clientX+b.clientX)/2, y:(a.clientY+b.clientY)/2, distance:Math.hypot(a.clientX-b.clientX,a.clientY-b.clientY), zoom:current.zoom, left:node.scrollLeft, top:node.scrollTop };
 }
 function move(event: TouchEvent) {
  if (!current.enabled || !initial || event.touches.length !== 2) return;
  event.preventDefault();
  const [a,b] = Array.from(event.touches), x=(a.clientX+b.clientX)/2, y=(a.clientY+b.clientY)/2;
  const zoom=Math.max(current.min,Math.min(current.max, initial.zoom*Math.hypot(a.clientX-b.clientX,a.clientY-b.clientY)/Math.max(1,initial.distance)));
  current.onzoom(zoom);
  const rect=node.getBoundingClientRect(), ratio=zoom/initial.zoom;
  node.scrollLeft=(initial.left+initial.x-rect.left)*ratio-(x-rect.left);
  node.scrollTop=(initial.top+initial.y-rect.top)*ratio-(y-rect.top);
 }
 function end(event: TouchEvent) { if(event.touches.length===0) { initial=null; navigating=false; } }
 function pointer(event: PointerEvent) {
  if (!current.enabled || event.pointerType !== 'touch') return;
  if(event.type==='pointerdown' && !event.isPrimary) { navigating=true; current.oncancel(); }
  if(navigating) { event.preventDefault(); event.stopImmediatePropagation(); }
 }
 const touchOptions={capture:true,passive:false};
 node.addEventListener('touchstart',start,touchOptions);node.addEventListener('touchmove',move,touchOptions);
 node.addEventListener('touchend',end,touchOptions);node.addEventListener('touchcancel',end,touchOptions);
 const pointerEvents=['pointerdown','pointermove','pointerup'] as const;
 for(const name of pointerEvents)node.addEventListener(name,pointer,touchOptions);
 return { update(options: typeof current) { current=options; if (!current.enabled) { initial=null; navigating=false; } }, destroy() {
  node.removeEventListener('touchstart',start,touchOptions);node.removeEventListener('touchmove',move,touchOptions);
  node.removeEventListener('touchend',end,touchOptions);node.removeEventListener('touchcancel',end,touchOptions);
  for(const name of pointerEvents)node.removeEventListener(name,pointer,touchOptions);
 } };
}
