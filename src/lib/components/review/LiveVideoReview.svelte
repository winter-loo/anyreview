<script lang="ts">
 import { randomId } from '$lib/random-id';
 import { flushSync, onMount } from 'svelte';
 import { frameTicks, nearestFrame, pinchTimeline, timelineWindow, type TimelineWindow } from '$lib/video/timeline';
 import VideoReviewDrawer from './VideoReviewDrawer.svelte';
 import { createLiveFeedback } from '$lib/feedback/client.svelte';
 import { appendTimedLocation, estimatedIndex, resolveLocation, frameAt, frameSeekTime, formatVideoTime, temporaryRate, type VideoIndex, type VideoLocation, type VideoAnnotation } from '$lib/video/model';
 let { data }: { data: { kind: 'video'; token: string; filename: string; src: string } } = $props();
 let video: HTMLVideoElement;
 let timeline: HTMLDivElement;
 let screen: HTMLDivElement;
 let commentInput = $state<HTMLTextAreaElement>();
 let desktopListVisible = $state(true);
 let mobile = $state(false), listOpen = $state(false), locationsOpen = $state(false), confirmClear = $state(false);
 let viewportTop = $state(0), viewportHeight = $state(0), keyboardOpen = $state(false);
 let barGesture = $state<'pressing' | 'scrubbing' | null>(null);
 let fullscreen = $state(false), fallbackFullscreen = $state(false), showControls = $state(true);
 let holdDirection = $state<'up' | 'down' | null>(null);
 let gesture: { id: number; x: number; y: number; long: boolean } | null = null;
 let holdTimer: ReturnType<typeof setTimeout> | undefined, controlsTimer: ReturnType<typeof setTimeout> | undefined;
 let suppressClickUntil = 0;
 let index = $state<VideoIndex | null>(null), progress = $state(0), indexError = $state(''), mediaError = $state('');
 let loaded = $state(false), paused = $state(true), frame = $state(0), time = $state(0), scale = $state<'time' | 'frame'>('time');
 let playerProgress = $state(0), playerDuration = $state(0);
 let baseRate = $state(1), activeRate = $state(1), held: string | null = null;
 let annotations = $state<VideoAnnotation[]>([]), locations = $state<VideoLocation[]>([]), body = $state(''), composing = $state(false), range = $state(false);
 let mounted = $state(false), portrait = $state(false);
 let viewStart = $state(0), viewSpan = $state(0), timelineWidth = $state(0);
 const visibleSpan = $derived(index ? Math.min(viewSpan || index.endTime, index.endTime) : 0);
 const viewEnd = $derived(viewStart + visibleSpan);
 const zoomed = $derived(!!index && visibleSpan < index.endTime - 0.000001);
 const frameTime = $derived(index?.timestamps[frame] ?? 0);
 const visibleTicks = $derived(index ? frameTicks(index, viewStart, viewEnd, Math.max(1, Math.floor(timelineWidth / (scale === 'frame' ? 64 : 130)))) : []);
 const fingers = new Map<number, { x: number; y: number }>();
 let timelineGesture: { mode: 'tap' | 'seek' | 'pinch' | 'blocked'; x: number; y: number; initial: TimelineWindow; distance: number; ratio: number } | null = null;
 const ready = $derived(!!index && loaded && !mediaError);
 const lastPoint = $derived(locations.at(-1)?.type === 'point' && canLocate(locations.at(-1)!));
 const percent = $derived(visibleSpan ? Math.max(0, Math.min(100, (frameTime - viewStart) / visibleSpan * 100)) : 0);
 const positionText = $derived(scale === 'frame' ? `${index?.approximate ? '约 ' : ''}${frame + 1} / ${index?.timestamps.length ?? '—'} 帧` : `${formatVideoTime(time)} / ${index ? formatVideoTime(index.endTime) : '—'}`);
 const feedback = createLiveFeedback<VideoAnnotation>({ token: () => data.token, kind: 'video', read: () => annotations, replace: next => { annotations = next; } });
 // On phones the draft takes over the page: video, timeline and composer fill the visible viewport above the keyboard.
 const composeMode = $derived(mobile && composing);
 const draftKey = () => `reviewloop:video-draft:${data.token}`;
 $effect(() => {
  if (!composeMode) return;
  const viewport = window.visualViewport;
  // The keyboard is open when the visible height drops well below the tallest height seen at this width.
  let baseline = 0, baselineWidth = 0;
  const update = () => {
   const height = viewport?.height ?? innerHeight;
   if (innerWidth !== baselineWidth) { baselineWidth = innerWidth; baseline = height; } else baseline = Math.max(baseline, height);
   viewportTop = viewport?.offsetTop ?? 0; viewportHeight = height; keyboardOpen = height < baseline - 120;
  };
  update(); viewport?.addEventListener('resize', update); viewport?.addEventListener('scroll', update); window.addEventListener('resize', update);
  const oldOverflow = document.body.style.overflow; document.body.style.overflow = 'hidden';
  // While drafting, taps elsewhere still act but never take focus, so the keyboard stays up until cancel or save.
  const holdFocus = (event: PointerEvent) => { if (!(event.target instanceof Element && event.target.closest('textarea'))) event.preventDefault(); };
  document.addEventListener('pointerdown', holdFocus, true);
  return () => { document.removeEventListener('pointerdown', holdFocus, true); viewport?.removeEventListener('resize', update); viewport?.removeEventListener('scroll', update); window.removeEventListener('resize', update); document.body.style.overflow = oldOverflow; keyboardOpen = false; };
 });
 $effect(() => {
  if (mounted) { try { localStorage.setItem(draftKey(), JSON.stringify({ composing, locations, body })); } catch { /* Saved annotations use the durable feedback queue. */ } }
 });
 onMount(() => {
  const abort = new AbortController(); let timer: ReturnType<typeof setTimeout>, callback = 0;
  try { const saved = JSON.parse(localStorage.getItem(`reviewloop:live-video:${data.token}`) ?? '[]'); if (Array.isArray(saved)) annotations = saved; } catch {}
  try { const saved = JSON.parse(localStorage.getItem(draftKey()) ?? 'null'); if (saved && Array.isArray(saved.locations) && typeof saved.body === 'string') { locations = saved.locations; body = saved.body; composing = !!saved.composing; } } catch {}
  loaded = video.readyState >= 1;
  if (loaded) portrait = video.videoHeight > video.videoWidth;
  initializeEstimate();
  if (video.error) mediaError = '浏览器无法播放此视频编码，请使用兼容的 MP4 视频';
  const query = matchMedia('(max-width: 900px)');
  const resize = () => { mobile = query.matches; };
  resize(); query.addEventListener('change', resize);
  const fullscreenChange = () => { fullscreen = document.fullscreenElement === screen; endHold(); revealControls(); };
  document.addEventListener('fullscreenchange', fullscreenChange);
  mounted = true;
  const stop = feedback.start(annotations);
  async function pollIndex() {
   try {
    const response = await fetch(`${data.src}&index=1`, { signal: abort.signal, cache: 'no-store' });
    if (!response.ok) throw new Error('无法读取视频帧索引，请刷新重试');
    const result = await response.json();
    if (result.status === 'ready') { installIndex(result.index); }
    else if (result.metadata) {
     if (!index || (index.approximate && index.hash !== result.metadata.hash)) installIndex(estimatedIndex(result.metadata));
     if (result.status === 'error') indexError = result.message;
     else { progress = result.progress; timer = setTimeout(pollIndex, 800); }
    }
    else if (result.status === 'error') indexError = result.message;
    else { progress = result.progress; timer = setTimeout(pollIndex, 800); }
   } catch (cause) { if (!abort.signal.aborted) indexError = cause instanceof Error ? cause.message : '加载失败'; }
  }
  void pollIndex();
  if ('requestVideoFrameCallback' in video) {
   const tick = (_now: number, meta: VideoFrameCallbackMetadata) => {
    if (!video.paused && !video.seeking && index) { time = meta.mediaTime; frame = frameAt(index, time); }
    callback = video.requestVideoFrameCallback(tick);
   };
   callback = video.requestVideoFrameCallback(tick);
  }
  const cancelGestures = () => { endHold(); fingers.clear(); timelineGesture = null; };
  const visibility = () => { if (document.hidden) cancelGestures(); };
  window.addEventListener('keydown', keydown); window.addEventListener('keyup', keyup); window.addEventListener('blur', cancelGestures); document.addEventListener('visibilitychange', visibility);
  return () => { clearTimeout(holdTimer); clearTimeout(controlsTimer); query.removeEventListener('change', resize); document.removeEventListener('fullscreenchange', fullscreenChange); abort.abort(); clearTimeout(timer); stop(); if (callback) video.cancelVideoFrameCallback(callback); window.removeEventListener('keydown', keydown); window.removeEventListener('keyup', keyup); window.removeEventListener('blur', cancelGestures); document.removeEventListener('visibilitychange', visibility); };
 });
 function initializeEstimate() {
  if (!index && Number.isFinite(video.duration) && video.duration > 0) {
   installIndex(estimatedIndex({hash:'',duration:video.duration,fps:30,sourceStartTime:0,codec:''}));
  }
 }
 function installIndex(next: VideoIndex) {
  index = next;
  frame = frameAt(next, video.currentTime); time = video.currentTime;
  // Keep playback and the selected time window stable while precision improves.
  if (viewSpan) setView(timelineWindow(viewStart,viewSpan,next.endTime));
 }
 function updateTime() {
  if (!video) return;
  playerDuration = Number.isFinite(video.duration) ? video.duration : 0;
  playerProgress = Number.isFinite(video.currentTime) ? video.currentTime : 0;
  if (index && !video.seeking) { frame = frameAt(index, video.currentTime); time = index.timestamps[frame]; }
}
function seekVideo(event: Event) {
  const next = Number((event.currentTarget as HTMLInputElement).value);
  if (!Number.isFinite(next)) return;
  video.currentTime = next;
  playerProgress = next;
  revealControls();
}
 function restoreRate() { clearTimeout(holdTimer); holdDirection = null; held = null; activeRate = baseRate; if (video) video.playbackRate = baseRate; }
 function pause() { video.pause(); restoreRate(); }
 function seekFrame(next: number) {
  if (!ready || !index) return;
  pause(); frame = Math.max(0, Math.min(index.timestamps.length - 1, next));
  time = index.timestamps[frame];
  if (zoomed && (time < viewStart || time > viewEnd)) setView(timelineWindow(time - visibleSpan / 2, visibleSpan, index.endTime));
  video.currentTime = frameSeekTime(index, frame);
 }
 function repeatFrame(node: HTMLButtonElement, amount: number) {
  let pointer: number | null = null, timer: ReturnType<typeof setTimeout> | undefined;
  const stop = () => { clearTimeout(timer); pointer = null; };
  const repeat = () => {
   if (pointer === null || !ready) { stop(); return; }
   seekFrame(frame + amount); timer = setTimeout(repeat, 80);
  };
  const down = (event: PointerEvent) => {
   if (!ready || event.button !== 0 || !event.isPrimary) return;
   stop(); pointer = event.pointerId; node.setPointerCapture(event.pointerId);
   seekFrame(frame + amount); timer = setTimeout(repeat, 350);
  };
  const move = (event: PointerEvent) => {
   if (event.pointerId !== pointer) return;
   const box = node.getBoundingClientRect();
   if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) stop();
  };
  const click = (event: MouseEvent) => {
   // Pointer presses already stepped; keep keyboard and assistive activation intact.
   if (event.detail > 0) { event.preventDefault(); event.stopImmediatePropagation(); }
  };
  const context = (event: Event) => event.preventDefault();
  const visibility = () => { if (document.hidden) stop(); };
  node.addEventListener('pointerdown', down); node.addEventListener('pointermove', move);
  node.addEventListener('pointerup', stop); node.addEventListener('pointercancel', stop); node.addEventListener('lostpointercapture', stop);
  node.addEventListener('click', click, true); node.addEventListener('contextmenu', context);
  window.addEventListener('blur', stop); document.addEventListener('visibilitychange', visibility);
  return { destroy() {
   stop(); node.removeEventListener('pointerdown', down); node.removeEventListener('pointermove', move);
   node.removeEventListener('pointerup', stop); node.removeEventListener('pointercancel', stop); node.removeEventListener('lostpointercapture', stop);
   node.removeEventListener('click', click, true); node.removeEventListener('contextmenu', context);
   window.removeEventListener('blur', stop); document.removeEventListener('visibilitychange', visibility);
  } };
 }
 // Long-press the composer bar, then slide sideways to move through the visible timeline window.
 function scrubBar(node: HTMLElement) {
  let pointer: number | null = null, timer: ReturnType<typeof setTimeout> | undefined, x = 0, y = 0, startTime = 0, scrubbed = false;
  const reset = () => { clearTimeout(timer); pointer = null; barGesture = null; };
  const down = (event: PointerEvent) => {
   if (!ready || !index || event.button !== 0 || !event.isPrimary || pointer !== null) return;
   pointer = event.pointerId; x = event.clientX; y = event.clientY; scrubbed = false; barGesture = 'pressing';
   timer = setTimeout(() => {
    if (pointer === null) return;
    node.setPointerCapture(pointer); startTime = frameTime; scrubbed = true; barGesture = 'scrubbing'; navigator.vibrate?.(10);
   }, 350);
  };
  const move = (event: PointerEvent) => {
   if (event.pointerId !== pointer) return;
   if (barGesture === 'pressing') { if (Math.hypot(event.clientX - x, event.clientY - y) > 10) reset(); return; }
   seekTime(startTime + (event.clientX - x) / node.clientWidth * visibleSpan);
  };
  const up = (event: PointerEvent) => { if (event.pointerId === pointer) reset(); };
  // A finished scrub must not press the button under the finger or move focus away from the comment.
  const click = (event: MouseEvent) => { if (scrubbed) { scrubbed = false; event.preventDefault(); event.stopImmediatePropagation(); } };
  const touchend = (event: TouchEvent) => { if (scrubbed) event.preventDefault(); };
  const context = (event: Event) => event.preventDefault();
  node.addEventListener('pointerdown', down); node.addEventListener('pointermove', move);
  node.addEventListener('pointerup', up); node.addEventListener('pointercancel', up); node.addEventListener('lostpointercapture', up);
  node.addEventListener('click', click, true); node.addEventListener('touchend', touchend, { passive: false }); node.addEventListener('contextmenu', context);
  return { destroy() {
   reset(); node.removeEventListener('pointerdown', down); node.removeEventListener('pointermove', move);
   node.removeEventListener('pointerup', up); node.removeEventListener('pointercancel', up); node.removeEventListener('lostpointercapture', up);
   node.removeEventListener('click', click, true); node.removeEventListener('touchend', touchend); node.removeEventListener('contextmenu', context);
  } };
 }
 function seekTime(next: number) { if (index) seekFrame(frameAt(index, Math.max(0, Math.min(index.endTime, next)))); }
 function step(amount: number) { if (scale === 'frame') seekFrame(frame + amount); else seekTime(time + amount); }
 async function togglePlay() {
  if (!loaded || mediaError) return;
  if (!video.paused) pause(); else { try { await video.play(); } catch { mediaError = '视频无法播放，请检查浏览器是否支持此编码'; } }
 }
 function revealControls() {
  clearTimeout(controlsTimer); showControls = true;
  if (!video.paused) controlsTimer = setTimeout(() => { showControls = false; }, 1800);
 }
 function toggleScale() { scale = scale === 'time' ? 'frame' : 'time'; restoreRate(); }
 function openList() { endHold(); confirmClear = false; if (mobile) listOpen = true; else desktopListVisible = !desktopListVisible; }
 function closeList() { listOpen = false; confirmClear = false; }
 function clearAnnotations() { feedback.persist([]); confirmClear = false; }
 function recall(p: VideoLocation) { seekFrame(locationStart(p)); if (mobile) closeList(); }
 function startHold(event: PointerEvent) {
  if (!ready || event.button !== 0) return;
  if (!event.isPrimary || gesture) { endHold(); return; }
  suppressClickUntil = 0;
  gesture = { id: event.pointerId, x: event.clientX, y: event.clientY, long: false };
  (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  const box = screen.getBoundingClientRect(), direction = event.clientX < box.left + box.width / 2 ? 'down' : 'up';
  holdTimer = setTimeout(() => {
   if (!gesture) return;
   gesture.long = true;
   if (!video.paused) { held = 'pointer'; holdDirection = direction; activeRate = temporaryRate(baseRate, direction); video.playbackRate = activeRate; showControls = false; }
  }, 350);
 }
 function moveHold(event: PointerEvent) {
  if (!gesture || gesture.id !== event.pointerId) return;
  const box = screen.getBoundingClientRect();
  if ((!gesture.long && Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y) > 12) || event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) { suppressClickUntil = Date.now() + 500; endHold(); }
 }
 function endHold() {
  if (gesture?.long) suppressClickUntil = Date.now() + 500;
  gesture = null; clearTimeout(holdTimer); restoreRate();
 }
 function screenClick() { if (Date.now() < suppressClickUntil) return; void togglePlay(); revealControls(); }
 async function toggleFullscreen() {
  endHold();
  if (document.fullscreenElement === screen) { await document.exitFullscreen(); return; }
  if (fallbackFullscreen) { fallbackFullscreen = false; return; }
  if (screen.requestFullscreen && document.fullscreenEnabled) {
   try { await screen.requestFullscreen(); return; } catch { /* Keep custom controls available in a viewport-filling fallback. */ }
  }
  fallbackFullscreen = true;
 }
 $effect(() => {
  if (!fallbackFullscreen) return;
  const old = document.body.style.overflow; document.body.style.overflow = 'hidden';
  return () => { document.body.style.overflow = old; };
 });
 function setRate() { restoreRate(); }
 function addFrame(next: number) {
  if (!ready || (locations.length >= 200 && !range)) return;
  seekFrame(next); composing = true; locations = appendTimedLocation(locations, frame, range, index!); range = false;
  // iOS only raises the keyboard when focus happens synchronously inside the tap.
  if (mobile) { flushSync(); commentInput?.focus({ preventScroll: true }); }
 }
 function keepCommentFocus() { if (composeMode && document.hasFocus()) commentInput?.focus({ preventScroll: true }); }
 function setView(next: TimelineWindow) { viewStart = next.start; viewSpan = next.end - next.start; }
 function resetTimeline() { viewStart = 0; viewSpan = 0; }
 function pointRatio(clientX: number) { const rect = timeline.getBoundingClientRect(); return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width)); }
 function pointAt(clientX: number) { return viewStart + pointRatio(clientX) * visibleSpan; }
 function timelineDown(event: PointerEvent) {
  if (!ready || !index || event.button !== 0 || fingers.size >= 2) return;
  fingers.set(event.pointerId, { x: event.clientX, y: event.clientY });
  (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  if (fingers.size === 1) {
   timelineGesture = { mode: 'tap', x: event.clientX, y: event.clientY, initial: { start: viewStart, end: viewEnd }, distance: 0, ratio: 0 };
  } else {
   const [a, b] = [...fingers.values()];
   timelineGesture = { mode: 'pinch', x: 0, y: 0, initial: { start: viewStart, end: viewEnd }, distance: Math.hypot(a.x-b.x,a.y-b.y), ratio: pointRatio((a.x+b.x)/2) };
  }
 }
 function timelineMove(event: PointerEvent) {
  if (!fingers.has(event.pointerId) || !timelineGesture || !index) return;
  fingers.set(event.pointerId, { x: event.clientX, y: event.clientY });
  const gesture = timelineGesture;
  if (gesture.mode === 'pinch' && fingers.size === 2) {
   const [a,b] = [...fingers.values()];
   setView(pinchTimeline(gesture.initial,index.endTime,gesture.distance,Math.hypot(a.x-b.x,a.y-b.y),gesture.ratio,pointRatio((a.x+b.x)/2)));
  } else if (gesture.mode !== 'blocked' && fingers.size === 1) {
   if (gesture.mode === 'tap' && Math.hypot(event.clientX-gesture.x,event.clientY-gesture.y)>5) gesture.mode = 'seek';
   if (gesture.mode === 'seek') seekFrame(nearestFrame(index, pointAt(event.clientX)));
  }
 }
 function timelineUp(event: PointerEvent) {
  if (!fingers.has(event.pointerId)) return;
  const gesture = timelineGesture;
  fingers.delete(event.pointerId);
  if (gesture?.mode === 'tap' && event.type === 'pointerup' && index) seekFrame(nearestFrame(index, pointAt(event.clientX)));
  if (!fingers.size) timelineGesture = null;
  else if (gesture) gesture.mode = 'blocked';
 }
 function timelineLabel(value: number) {
  if (!index) return '—';
  if (scale === 'frame') return String(frameAt(index, value)+1);
  const label = formatVideoTime(value);
  return visibleSpan < 10 ? label : label.split('.')[0];
 }
 function removeLocation(i: number) { locations = locations.filter((_, n) => n !== i); range = false; }
 function cancel() { composing = false; locationsOpen = false; locations = []; body = ''; range = false; }
 function save() {
  if (!ready || !locations.length || !body.trim()) return;
  feedback.persist([...annotations, { id: randomId(), createdAt: new Date().toISOString(), type: 'video', locations: [...locations], body: body.trim() }]); cancel(); pause();
 }
 function canLocate(p: VideoLocation) { return ready && (!index?.approximate || (p.type === 'point' ? p.time !== undefined : p.startTime !== undefined)); }
 function label(p: VideoLocation) {
  if (index?.approximate && !canLocate(p)) return p.type === 'point' ? `第 ${p.frameIndex+1} 帧 · 待校准` : `第 ${p.startFrameIndex+1}–${p.endFrameIndex+1} 帧 · 待校准`;
  const anchor = p;
  if (index) p = resolveLocation(p,index);
  const at = (f: number) => scale === 'frame' ? `第 ${f + 1} 帧` : formatVideoTime(index?.timestamps[f] ?? 0);
  if (scale === 'time' && anchor.type === 'point' && anchor.time !== undefined) return formatVideoTime(anchor.time);
  if (scale === 'time' && anchor.type === 'range' && anchor.startTime !== undefined && anchor.endTimeExclusive !== undefined) return `${formatVideoTime(anchor.startTime)} – ${formatVideoTime(anchor.endTimeExclusive)}`;
  return (index?.approximate ? '约 ' : '') + (p.type === 'point' ? at(p.frameIndex) : `${at(p.startFrameIndex)} – ${at(p.endFrameIndex)}`);
 }
 function locationStart(p: VideoLocation) { if (index) p = resolveLocation(p,index); return p.type === 'point' ? p.frameIndex : p.startFrameIndex; }
 function locationPercent(p: VideoLocation) { if (!canLocate(p)) return -10000; return index && visibleSpan ? (index.timestamps[locationStart(p)] - viewStart) / visibleSpan * 100 : 0; }
 function locationWidth(p: VideoLocation) { if (index) p = resolveLocation(p,index); return index && p.type === 'range' ? (index.timestamps[p.endFrameIndex] - index.timestamps[p.startFrameIndex]) / visibleSpan * 100 : 0; }
 function inputTarget(event: KeyboardEvent) { return event.target instanceof Element && !!event.target.closest('input, textarea, select, [contenteditable="true"]'); }
 function keydown(event: KeyboardEvent) {
  if (event.key === 'Escape' && fallbackFullscreen) { event.preventDefault(); fallbackFullscreen = false; return; }
  if (mobile && listOpen) return;
  if (!ready || inputTarget(event) || event.ctrlKey || event.metaKey || event.altKey) return;
  if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); step((event.key === 'ArrowLeft' ? -1 : 1) * (event.shiftKey ? 10 : 1)); }
  else if (event.code === 'Space' && !(event.target instanceof Element && event.target.closest('button'))) { event.preventDefault(); if (!event.repeat) void togglePlay(); }
  else if (scale === 'time' && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
   event.preventDefault(); if (!video.paused && !held && !event.repeat) { held = event.key; activeRate = temporaryRate(baseRate, event.key === 'ArrowUp' ? 'up' : 'down'); video.playbackRate = activeRate; }
  }
 }
 function keyup(event: KeyboardEvent) { if (event.key === held) restoreRate(); }
</script>

<svelte:head><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" /></svelte:head>
<header class:hidden={composeMode}>
 <div class="title"><strong title={data.filename}>{data.filename}</strong><span>视频评审</span></div>
 <div class="header-actions"><a class="help-link" href="/live/help/video" target="_blank" rel="noopener" aria-label="视频标注帮助（新标签页）" title="视频标注帮助（新标签页）">?</a><span class="sync" role="status">{feedback.context.status}</span>
 {#if annotations.length}<button class="primary submit" disabled={feedback.context.busy} onclick={() => feedback.context.submit()} title={`提交给 AI，${feedback.context.pendingCount} 条待提交`}>提交给 AI{#if feedback.context.pendingCount > 0}<span class="badge">{feedback.context.pendingCount}</span>{/if}</button>{/if}
 </div>
</header>
{#if feedback.context.error}<div class="error" role="alert">{feedback.context.error}<button onclick={() => feedback.context.retry()}>重试同步</button></div>{/if}
<main class:wide={!mobile && !desktopListVisible && !composing} class:portrait={!mobile && portrait} class:compose={composeMode} class:keyboard={keyboardOpen} style:top={composeMode ? `${viewportTop}px` : undefined} style:height={composeMode ? `${viewportHeight}px` : undefined}>
 <section class="workspace" aria-label="视频与时间轴">
  <div class="screen" class:fullscreen={fallbackFullscreen} bind:this={screen}>
   <!-- Video is the reviewed artifact; its audio is preserved without an invented caption track. -->
   <!-- svelte-ignore a11y_media_has_caption -->
   <video bind:this={video} src={data.src} playsinline preload="metadata" onloadedmetadata={() => { loaded = true; portrait = video.videoHeight > video.videoWidth; updateTime(); initializeEstimate(); }} ontimeupdate={updateTime} onseeked={updateTime} onplay={() => { paused = false; revealControls(); }} onpause={() => { paused = true; restoreRate(); revealControls(); }} onended={() => { paused = true; restoreRate(); revealControls(); }} onerror={() => { mediaError = '浏览器无法播放此视频编码。请使用兼容的 MP4（H.264/AAC）视频。'; }}></video>
   <button class="video-surface" disabled={!loaded || !!mediaError} aria-label="视频画面：点击播放或暂停，长按左侧减速、右侧加速" onpointerdown={startHold} onpointermove={moveHold} onpointerup={endHold} onpointercancel={endHold} onlostpointercapture={endHold} oncontextmenu={event => event.preventDefault()} onclick={screenClick}></button>
   <button class="play" class:controls-hidden={!paused && !showControls} disabled={!loaded || !!mediaError} onclick={() => { void togglePlay(); revealControls(); }} aria-label={paused ? '播放' : '暂停'}>
    {#if paused}<svg viewBox="0 0 24 24" width="30" height="30" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z" /></svg>{:else}<svg viewBox="0 0 24 24" width="30" height="30" fill="currentColor" aria-hidden="true"><path d="M6 5h4v14H6zm8 0h4v14h-4z" /></svg>{/if}
   </button>
   <button class="fullscreen-button" disabled={!loaded} onclick={toggleFullscreen} aria-label={fullscreen || fallbackFullscreen ? '退出全屏' : '全屏'}><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">{#if fullscreen || fallbackFullscreen}<path d="M9 3v6H3m18 0h-6V3M3 15h6v6m6 0v-6h6" />{:else}<path d="M9 3H3v6m12-6h6v6M3 15v6h6m6 0h6v-6" />{/if}</svg></button>
   <label class="video-progress" class:controls-hidden={!paused && !showControls}>
    <span class="sr-only">视频播放进度</span>
    <input type="range" min="0" max={playerDuration} step="any" value={playerProgress} disabled={!loaded || !!mediaError || !playerDuration} oninput={seekVideo} aria-label="视频播放进度" />
   </label>
   {#if mediaError}<div class="screen-message" role="alert">{mediaError}</div>{/if}
  </div>
  <div class="controls">
  <div class="transport">
   <button class="time-toggle" onclick={toggleScale} aria-label={`当前${scale === 'time' ? '时间' : '帧数'} ${positionText}，点击切换为${scale === 'time' ? '帧数' : '时间'}`} title="点击切换时间 / 帧数">{positionText}</button>
   <label class="select-label"><span class="sr-only">基准播放速度</span>{#if holdDirection || activeRate !== baseRate}<span class="temporary-speed" role="status" aria-label={`临时 ${activeRate} 倍速，松开恢复 ${baseRate} 倍速`}>{activeRate > baseRate ? '↑' : activeRate < baseRate ? '↓' : ''} {activeRate}×</span>{:else}<select bind:value={baseRate} onchange={setRate}>{#each [0.25, 0.5, 1, 1.5, 2, 3, 4] as rate}<option value={rate}>{rate}×</option>{/each}</select>{/if}</label>
  </div>
  {#if indexError}<div class="index-progress" role="status">精确帧定位暂不可用，仍可播放和按时间标注。帧号为估算值。{indexError}</div>{:else if !index || index.approximate}<div class="index-progress" role="status"><span>帧号为估算值 · 后台校准 {progress}% · 可正常播放和标注</span><progress max="100" value={progress}></progress></div>{/if}
  <div class="timeline" class:disabled={!ready} bind:this={timeline} bind:clientWidth={timelineWidth} role="slider" tabindex="0" aria-label="视频时间轴：点击或拖动定位，双指缩放和平移" aria-valuemin={0} aria-valuemax={index?.endTime ?? 0} aria-valuenow={frameTime} aria-valuetext={positionText} onpointerdown={timelineDown} onpointermove={timelineMove} onpointerup={timelineUp} onpointercancel={timelineUp} onlostpointercapture={timelineUp}>
   <span class="track" aria-hidden="true"><span class="track-fill" style:width={`${percent}%`}></span></span>
   <div class="timeline-marks" aria-hidden="true">
   {#if index}
    {#each visibleTicks as tick}{@const at = (index.timestamps[tick]-viewStart)/visibleSpan*100}<span class="timeline-tick" class:start={at < 10} class:end={at > 90} style:left={`${at}%`}><span>{scale === 'frame' ? tick+1 : timelineLabel(index.timestamps[tick])}</span></span>{/each}
    {#each annotations as annotation}{#each annotation.locations as p}<span class="mark saved" style:left={`${locationPercent(p)}%`} style:width={p.type === 'range' ? `${locationWidth(p)}%` : '5px'}></span>{/each}{/each}
    {#each locations as p}<span class="mark" class:interval={p.type === 'range'} style:left={`${locationPercent(p)}%`} style:width={p.type === 'range' ? `${locationWidth(p)}%` : '7px'}></span>{/each}
   {/if}
   </div>
  </div>
  {#if range || zoomed}<div class="timeline-hint">{range ? '定位到终点，点「＋ 当前帧」完成范围' : `${((index?.endTime ?? 0)/visibleSpan).toFixed(1)}× · 双指平移缩放`}</div>{/if}
  <div class="step-controls">
   <button use:repeatFrame={-10} disabled={!ready} onclick={() => seekFrame(frame - 10)} aria-label="后退十帧">−10 帧</button><button use:repeatFrame={-1} disabled={!ready} onclick={() => seekFrame(frame - 1)} aria-label="上一帧">−1 帧</button>
   <button class="add" disabled={!ready || (locations.length >= 200 && !range)} onclick={() => addFrame(frame)}>＋ 当前帧</button>
   <button use:repeatFrame={1} disabled={!ready} onclick={() => seekFrame(frame + 1)} aria-label="下一帧">+1 帧</button><button use:repeatFrame={10} disabled={!ready} onclick={() => seekFrame(frame + 10)} aria-label="前进十帧">+10 帧</button>
  </div>
  {#if composeMode}{@render composerPanel()}{/if}
  <div class="annotation-actions"><button class="list-button" onclick={openList} aria-haspopup={mobile ? 'dialog' : undefined} aria-expanded={mobile ? listOpen : desktopListVisible}>标注列表{#if annotations.length}<span class="list-count">{annotations.length}</span>{/if}</button>{#if zoomed}<button onclick={resetTimeline}>完整时间轴</button>{:else}<span class="gesture-hint">长按画面左侧减速 · 右侧加速</span>{/if}</div>
  <div class="hints"><span>{activeRate !== baseRate ? `临时 ${activeRate}× · 松开恢复 ${baseRate}×` : '空格播放 · ← → 定位 · Shift 移动十倍'}</span><details><summary>快捷键</summary><p>帧数刻度：← → 移动一帧，Shift + ← → 移动十帧。时间刻度：移动一秒 / 十秒；播放时按住 ↑ ↓ 临时变速，松开恢复。输入评论时不触发快捷键。</p></details></div>
  </div>
 </section>
 {#if !mobile && (desktopListVisible || composing)}<aside aria-label="视频评论">{#if composing}{@render composerPanel()}{/if}{#if desktopListVisible}{@render commentsPanel()}{/if}</aside>{/if}
</main>
{#snippet locationChip(p: VideoLocation, i: number)}<span class="chip"><button disabled={!canLocate(p)} onclick={() => seekFrame(locationStart(p))}>{label(p)}</button><button aria-label={`移除 ${label(p)}`} onclick={() => removeLocation(i)}>×</button></span>{/snippet}
{#snippet composerPanel()}
  <section class="composer" aria-label="添加视频评论">
   <div class="composer-bar" class:pressing={barGesture === 'pressing'} class:scrubbing={barGesture === 'scrubbing'} use:scrubBar title="长按后左右滑动切换时间">
    <div class="bar-items">
    <div class="locations" aria-label="已选位置">
     {#if !locations.length}<span class="locations-empty">点「＋ 当前帧」添加位置</span>
     {:else if locations.length === 1}{@render locationChip(locations[0], 0)}
     {:else}<button class="locations-toggle" aria-expanded={locationsOpen} onclick={() => { locationsOpen = !locationsOpen; }}>{locations.length} 个位置<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d={locationsOpen ? 'm6 15 6-6 6 6' : 'm6 9 6 6 6-6'} /></svg></button>{/if}
    </div>
    <button class="bar-button" class:active={range} disabled={!lastPoint} aria-pressed={range} aria-label="范围" title="范围：与下一次点击组成时间段" onclick={() => { range = !range; }}><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12h18M7 8l-4 4 4 4M17 8l4 4-4 4" /></svg></button>
    <button class="bar-button" aria-label="取消评论" title="取消评论" onclick={cancel}><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg></button>
    <button class="bar-button primary" aria-label="保存评论" title="保存评论" disabled={!ready || !locations.length || !body.trim()} onclick={save}><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 12 5 5 9-10" /></svg></button>
    </div>
    <div class="scrub-readout" aria-live="polite">{#if barGesture === 'scrubbing'}<span aria-hidden="true">‹</span><span class="scrub-track" aria-hidden="true"><span style:left={`${percent}%`}></span></span><strong>{positionText}</strong><span aria-hidden="true">›</span>{/if}</div>
   </div>
   {#if locations.length > 1 && locationsOpen}<ul class="location-list">{#each locations as p, i}<li>{@render locationChip(p, i)}</li>{/each}</ul>{/if}
   <textarea bind:this={commentInput} onblur={keepCommentFocus} bind:value={body} rows="3" maxlength="20000" placeholder="这里需要怎样修改？" aria-label="评论内容"></textarea>
  </section>
{/snippet}
{#snippet commentsPanel()}
 <section class="comments" aria-label="已保存评论"><div class="list-heading"><h2>标注列表{#if annotations.length}<span>{annotations.length}</span>{/if}</h2><div class="list-actions">{#if annotations.length}{#if confirmClear}<button class="clear danger" onclick={clearAnnotations}>确认清空</button><button class="clear" onclick={() => { confirmClear = false; }}>取消</button>{:else}<button class="clear" aria-label={`清空全部 ${annotations.length} 条标注`} onclick={() => { confirmClear = true; }}>清空</button>{/if}{/if}</div>{#if mobile}<button class="close-drawer" aria-label="收起标注列表" onclick={closeList}>×</button>{/if}</div><div class="comment-scroll">
 {#if !annotations.length}<div class="empty"><strong>把修改意见留在具体时刻</strong><p>定位到画面后点「＋ 当前帧」开始；多个时间点和时间段可以共用一条评论。</p></div>{/if}
 {#each annotations as annotation (annotation.id)}<article><div class="chips">{#each annotation.locations as p}<button class="saved-chip" disabled={!canLocate(p)} onclick={() => recall(p)}>{label(p)}</button>{/each}</div><p>{annotation.body}</p><button class="delete" aria-label="删除评论" onclick={() => feedback.persist(annotations.filter(a => a.id !== annotation.id))}>删除</button></article>{/each}
 </div></section>
{/snippet}
{#if mobile && listOpen}
 <VideoReviewDrawer title="标注列表" onclose={closeList}>{@render commentsPanel()}</VideoReviewDrawer>
{/if}
<style>
 :global(body) { margin:0; background:#f5f5f2; color:#242424; font-family:Inter,ui-sans-serif,system-ui,sans-serif; }
 :global(*) { box-sizing:border-box; }
 button,select { font:inherit; font-size:14px; color:inherit; min-height:44px; border:1px solid #d9d9d2; border-radius:10px; background:#fff; cursor:pointer; padding:0 12px; touch-action:manipulation; }
 button:disabled { opacity:.4; cursor:default; } button:focus-visible,select:focus-visible { outline:3px solid #93c5fd; outline-offset:2px; }
 button.primary,button.active { background:#2563eb; border-color:#2563eb; color:#fff; }
 header { display:flex; align-items:center; justify-content:space-between; gap:12px; padding:10px 18px; padding-top:calc(10px + env(safe-area-inset-top)); border-bottom:1px solid #deded8; background:#fffffd; }
 .title { min-width:0; display:grid; gap:2px; }.title strong { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }.title>span,.sync { font-size:12px; color:#77776f; }
 .help-link { display:grid; place-items:center; width:44px; height:44px; flex:none; color:#526174; font-size:18px; font-weight:700; text-decoration:none; border-radius:8px; user-select:none; } .help-link:hover { background:#edf3ff; color:#2563eb; } .help-link:focus-visible { outline:3px solid #93c5fd; }
 .header-actions { display:flex; align-items:center; gap:14px; flex:none; }.submit { display:flex; align-items:center; gap:8px; white-space:nowrap; font-weight:700; }.badge { border-radius:999px; padding:2px 7px; background:#ffffff35; font-size:12px; }
 main { max-width:1600px; margin:0 auto; padding:24px; display:grid; grid-template-columns:minmax(0,1fr) 360px; align-items:start; gap:24px; }
 .workspace { min-width:0; }.screen { position:relative; display:flex; align-items:center; justify-content:center; background:#111314; border-radius:14px; overflow:hidden; min-height:160px; }video { display:block; width:100%; height:min(56dvh,660px); object-fit:contain; }.screen-message { position:absolute; inset:0; display:grid; place-content:center; padding:32px; color:white; background:#111d; }
 .transport { display:flex; align-items:center; justify-content:space-between; gap:8px; margin-top:12px; }.play { background:#242424; color:white; border:0; min-width:46px; }.select-label { flex:none; }.select-label select { padding:0 8px; }
 .timeline { touch-action:none; user-select:none; -webkit-user-select:none; position:relative; height:44px; margin:4px 10px 0; cursor:pointer; }.timeline.disabled { opacity:.4; cursor:default; }.timeline:focus-visible { outline:3px solid #93c5fd; outline-offset:2px; border-radius:6px; }.track { position:absolute; top:20px; height:10px; left:0; right:0; border-radius:5px; background:#ddddd6; overflow:hidden; pointer-events:none; }.track-fill { display:block; height:100%; background:#242424; }.mark { position:absolute; top:16px; height:18px; border-radius:4px; background:#2563eb; pointer-events:none; }.mark.interval { background:#93b4fc88; border:2px solid #2563eb; }.mark.saved { top:36px; height:6px; background:#9ca3af; }
 .timeline-marks { position:absolute; inset:0; overflow:hidden; pointer-events:none; }
 .timeline-tick { position:absolute; top:14px; height:20px; width:1px; background:#b5b5af; }
 .timeline-tick.start>span { transform:none; }.timeline-tick.end>span { transform:translateX(-100%); }
 .timeline-tick>span { position:absolute; bottom:22px; transform:translateX(-50%); font-size:10px; color:#77776f; font-variant-numeric:tabular-nums; white-space:nowrap; }
 .timeline-hint { text-align:center; color:#77776f; font-size:11px; margin:2px 4px 0; }.step-controls { margin-top:10px; }.step-controls { display:flex; gap:6px; }.step-controls button { flex:1; padding:0 6px; white-space:nowrap; }.step-controls .add { flex:1.6; color:#1d4ed8; border-color:#b6c9f5; background:#edf3ff; }
 .hints { display:flex; justify-content:space-between; gap:12px; font-size:12px; color:#77776f; margin:12px 0; }.hints details { max-width:320px; }.hints summary { cursor:pointer; }.hints p { line-height:1.6; }.index-progress { display:grid; gap:8px; font-size:13px; padding:12px; }progress { width:100%; height:5px; accent-color:#2563eb; }
 main.wide { grid-template-columns:minmax(0,1fr); }
 aside { min-width:0; }.composer,.comments { background:#fffffd; border:1px solid #deded8; border-radius:14px; padding:16px; margin-bottom:16px; }h2 { font-size:15px; margin:0; }h2>span { color:#77776f; margin-left:8px; font-weight:400; }.chips { display:flex; flex-wrap:wrap; gap:7px; }.chip { display:inline-flex; max-width:100%; border:1px solid #b6c9f5; border-radius:9px; overflow:hidden; background:#edf3ff; }.chip button { border:0; border-radius:0; background:transparent; color:#1d4ed8; font-size:12px; padding:0 8px; font-variant-numeric:tabular-nums; }.chip button:last-child { padding:0 12px; font-size:18px; }.composer textarea { display:block; width:100%; resize:vertical; min-height:100px; margin:12px 0 0; border:1px solid #d5d5ce; border-radius:10px; padding:12px; font:inherit; font-size:16px; }.composer textarea:focus { outline:2px solid #93c5fd; border-color:#2563eb; }.empty { padding:32px 0 16px; font-size:14px; }.empty p { color:#77776f; line-height:1.7; }.comments article { padding:16px 0; border-bottom:1px solid #e8e8e2; }.comments article:last-child { border-bottom:0; padding-bottom:0; }.comments article p { white-space:pre-wrap; overflow-wrap:anywhere; font-size:14px; line-height:1.6; }.saved-chip { min-height:36px; font-size:12px; padding:0 8px; background:#f5f5f2; }.delete { min-height:36px; border:0; font-size:12px; color:#77776f; background:transparent; }.error { padding:12px 18px; color:#9f1239; background:#fff1f2; display:flex; align-items:center; gap:12px; font-size:14px; }.sr-only { position:absolute; width:1px; height:1px; overflow:hidden; clip-path:inset(50%); }
 @media(max-width:900px) { main { grid-template-columns:minmax(0,1fr); max-width:780px; padding:14px; gap:12px; } video { height:auto; max-height:40svh; }.hints { display:none; }.comments,.composer { margin-bottom:12px; } }
 @media(max-width:480px) { header { padding-inline:10px; gap:6px; }.title strong { font-size:14px; }.title>span,.sync { display:none; }.submit { padding:0 9px; font-size:13px; gap:5px; }main { padding:10px; }.screen { border-radius:10px; min-height:120px; }select { font-size:12px; min-width:0; }.select-label select { padding:0 4px; }.play { min-width:38px; padding:0 9px; }.step-controls button { font-size:12px; }.timeline-hint { font-size:10px; }.composer { padding:12px; }.composer textarea { min-height:80px; }.video-progress { left:50px; right:50px; bottom:6px; height:36px; } }

 .screen { isolation:isolate; }
 .video-surface { position:absolute; inset:0; z-index:1; width:100%; height:100%; border:0; border-radius:0; padding:0; background:transparent; touch-action:pan-y; user-select:none; -webkit-user-select:none; -webkit-touch-callout:none; }
 .screen .play { position:absolute; z-index:2; left:10px; bottom:10px; display:grid; place-items:center; width:44px; height:44px; padding:0; border:0; border-radius:10px; background:rgb(0 0 0 / .48); color:white; backdrop-filter:blur(6px); transition:opacity .16s ease; }
 .screen .play.controls-hidden { opacity:0; pointer-events:none; }
 .screen .play:focus-visible { opacity:1; pointer-events:auto; }
 .fullscreen-button { position:absolute; z-index:2; bottom:10px; right:10px; display:grid; place-items:center; width:44px; height:44px; padding:0; border:0; background:rgb(0 0 0 / .48); color:white; }
 .video-progress { position:absolute; z-index:3; left:64px; right:64px; bottom:10px; height:44px; display:flex; align-items:center; opacity:1; transition:opacity .16s ease; }
 .video-progress.controls-hidden { opacity:0; pointer-events:none; }
 .video-progress input { width:100%; margin:0; accent-color:#fff; cursor:pointer; touch-action:manipulation; }
 .temporary-speed { display:grid; place-items:center; min-width:62px; height:44px; border:1px solid #b6c9f5; border-radius:10px; background:#edf3ff; color:#1d4ed8; font-size:14px; font-variant-numeric:tabular-nums; }

 .screen-message { z-index:4; }
 .screen:fullscreen,.screen.fullscreen { position:fixed; z-index:50; inset:0; width:100%; height:100dvh; border-radius:0; min-height:0; }
 .screen:fullscreen video,.screen.fullscreen video { width:100%; height:100%; min-height:0; max-height:none; }
 .screen:fullscreen .play,.screen.fullscreen .play { bottom:calc(16px + env(safe-area-inset-bottom)); left:calc(16px + env(safe-area-inset-left)); }
 .screen:fullscreen .fullscreen-button,.screen.fullscreen .fullscreen-button { bottom:calc(16px + env(safe-area-inset-bottom)); right:calc(16px + env(safe-area-inset-right)); }
.screen:fullscreen .video-progress,.screen.fullscreen .video-progress { bottom:calc(16px + env(safe-area-inset-bottom)); left:70px; right:70px; }
 .time-toggle { min-width:0; background:transparent; border-color:transparent; padding:0 4px; font-size:13px; color:#525252; font-variant-numeric:tabular-nums; white-space:nowrap; }
 .time-toggle:hover { color:#1d4ed8; }
 .step-controls button, .annotation-actions button { user-select:none; -webkit-user-select:none; -webkit-touch-callout:none; }
 .step-controls button { touch-action:none; }
 .annotation-actions { display:flex; align-items:center; gap:8px; margin-top:12px; }
 .list-button { display:inline-flex; gap:8px; align-items:center; }
 .list-count { font-size:12px; color:#77776f; }
 .gesture-hint { margin-left:auto; font-size:11px; color:#77776f; }
 .list-heading { display:flex; gap:8px; align-items:center; }
 .list-actions { margin-left:auto; display:flex; gap:4px; }
 .clear { min-height:36px; border:0; font-size:12px; color:#77776f; background:transparent; padding:0 8px; }
 .clear.danger { color:#9f1239; }
 .clear:hover { color:#242424; }
 .clear.danger:hover { color:#881337; }
 .close-drawer { border:0; background:transparent; font-size:25px; font-weight:400; padding:0; width:44px; }
 .comment-scroll { min-height:0; }
 .composer-bar { position:relative; touch-action:none; user-select:none; -webkit-user-select:none; -webkit-touch-callout:none; }
 .bar-items { display:flex; align-items:center; gap:6px; transition:opacity .2s ease; }
 .composer-bar.pressing .bar-items { opacity:0; transition-delay:.12s; }
 .composer-bar.scrubbing .bar-items { opacity:0; pointer-events:none; }
 .scrub-readout { position:absolute; inset:0; display:flex; align-items:center; gap:10px; padding:0 8px; border-radius:10px; background:#edf3ff; color:#1d4ed8; font-variant-numeric:tabular-nums; opacity:0; pointer-events:none; transition:opacity .15s ease; }
 .composer-bar.scrubbing .scrub-readout { opacity:1; }
 .scrub-readout strong { font-size:13px; white-space:nowrap; }
 .scrub-readout>span[aria-hidden] { font-size:20px; line-height:1; }
 .scrub-track { position:relative; flex:1; height:4px; border-radius:2px; background:#b6c9f5; }
 .scrub-track span { position:absolute; top:-5px; width:3px; height:14px; margin-left:-1.5px; border-radius:2px; background:#1d4ed8; }
 .locations { flex:1; min-width:0; display:flex; }
 .locations .chip { min-width:0; }
 .locations .chip button:first-child { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
 .locations-empty { font-size:12px; color:#1d4ed8; }
 .locations-toggle { display:inline-flex; align-items:center; gap:4px; border-color:#b6c9f5; background:#edf3ff; color:#1d4ed8; font-size:12px; padding:0 10px; white-space:nowrap; }
 .bar-button { flex:none; display:grid; place-items:center; width:44px; padding:0; }
 .location-list { list-style:none; margin:8px 0 0; padding:0; display:grid; gap:6px; max-height:96px; overflow-y:auto; overscroll-behavior:contain; }
 .location-list .chip { display:flex; }
 .location-list .chip button:first-child { flex:1; text-align:left; }
 @media(max-width:900px) {
  .gesture-hint { font-size:10px; }
  .comments { display:flex; flex:1; flex-direction:column; min-height:0; margin:0; padding:0 16px 12px; border:0; border-radius:0; background:transparent; }
  .list-heading { flex:none; min-height:44px; margin-bottom:8px; }
  .comment-scroll { flex:1; overflow-y:auto; overscroll-behavior:contain; -webkit-overflow-scrolling:touch; padding-bottom:8px; }
  .comments article { padding-block:12px; }
 }
 header.hidden { display:none; }
 /* Desktop portrait video: the full-height video sits on the right; controls, composer and list stack on the left. */
 main.portrait { grid-template-columns:minmax(0,1fr) auto; grid-template-rows:auto 1fr; grid-template-areas:'controls screen' 'aside screen'; row-gap:0; }
 main.portrait .workspace { display:contents; }
 main.portrait .controls { grid-area:controls; min-width:0; }
 main.portrait aside { grid-area:aside; margin-top:16px; }
 main.portrait .screen { grid-area:screen; align-self:start; position:sticky; top:24px; }
 main.portrait video { width:auto; max-width:min(46vw,640px); height:calc(100dvh - 120px); min-height:420px; }
 main.portrait .transport { margin-top:0; }
 /* Phone draft layout: pinned to the visual viewport so the keyboard never pushes the video or composer away. */
 main.compose { position:fixed; z-index:10; inset-inline:0; top:0; height:100dvh; max-width:none; display:flex; flex-direction:column; align-items:stretch; padding:6px 8px calc(6px + env(safe-area-inset-bottom)); overflow:hidden; background:#f5f5f2; }
 main.compose .workspace { flex:1; min-height:0; display:flex; flex-direction:column; }
 main.compose .controls { flex:0 1 auto; min-height:0; display:flex; flex-direction:column; }
 main.compose .screen { flex:1 1 0; min-height:72px; border-radius:8px; }
 main.compose video { position:absolute; inset:0; height:100%; max-height:none; }
 main.compose .screen .play,main.compose .fullscreen-button { width:36px; height:36px; min-height:36px; left:6px; bottom:6px; }
 main.compose .fullscreen-button { left:auto; right:6px; }
 main.compose .transport,main.compose .index-progress,main.compose .annotation-actions { display:none; }
 main.compose .timeline,main.compose .timeline-hint { flex:none; margin-top:0; }
 main.compose .step-controls { margin-top:6px; }
 main.compose .step-controls { flex:none; }
 main.compose.keyboard .timeline,main.compose.keyboard .timeline-hint { display:none; }
 main.compose.keyboard .step-controls { margin-top:6px; }
 main.compose .step-controls button { min-height:34px; font-size:12px; }
 main.compose .composer { flex:0 1 auto; min-height:0; display:flex; flex-direction:column; margin:6px 0 0; padding:6px; border-radius:10px; }
 main.compose .composer-bar,main.compose .composer textarea { flex:none; }
 main.compose .location-list { flex:0 1 auto; min-height:34px; margin-top:6px; }
 main.compose .composer-bar button { min-height:36px; }
 main.compose .bar-button { width:40px; }
 main.compose .chip button { min-height:34px; }
 main.compose .composer textarea { height:64px; min-height:40px; margin-top:6px; padding:8px 10px; resize:none; }
 @media(prefers-reduced-motion:reduce) { .screen .play { transition:none; } }
</style>
