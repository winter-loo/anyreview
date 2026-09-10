<script lang="ts">
 import { onMount } from 'svelte';
 import { frameTicks, nearestFrame, pinchTimeline, timelineWindow, type TimelineWindow } from '$lib/video/timeline';
 import VideoReviewDrawer from './VideoReviewDrawer.svelte';
 import { createLiveFeedback } from '$lib/feedback/client.svelte';
 import { appendTimedLocation, estimatedIndex, resolveLocation, frameAt, frameSeekTime, formatVideoTime, temporaryRate, type VideoIndex, type VideoLocation, type VideoAnnotation } from '$lib/video/model';
 let { data }: { data: { kind: 'video'; token: string; filename: string; src: string } } = $props();
 let video: HTMLVideoElement;
 let timeline: HTMLDivElement;
 let screen: HTMLDivElement;
 let desktopListVisible = $state(true);
 let mobile = $state(false), drawer = $state<'composer' | 'list' | null>(null);
 let fullscreen = $state(false), fallbackFullscreen = $state(false), showControls = $state(true);
 let holdDirection = $state<'up' | 'down' | null>(null);
 let gesture: { id: number; x: number; y: number; long: boolean } | null = null;
 let holdTimer: ReturnType<typeof setTimeout> | undefined, controlsTimer: ReturnType<typeof setTimeout> | undefined;
 let suppressClickUntil = 0;
 let index = $state<VideoIndex | null>(null), progress = $state(0), indexError = $state(''), mediaError = $state('');
 let loaded = $state(false), paused = $state(true), frame = $state(0), time = $state(0), scale = $state<'time' | 'frame'>('time');
 let baseRate = $state(1), activeRate = $state(1), held: string | null = null;
 let annotations = $state<VideoAnnotation[]>([]), locations = $state<VideoLocation[]>([]), body = $state(''), composing = $state(false), range = $state(false);
 let mounted = $state(false);
 let viewStart = $state(0), viewSpan = $state(0);
 const visibleSpan = $derived(index ? Math.min(viewSpan || index.endTime, index.endTime) : 0);
 const viewEnd = $derived(viewStart + visibleSpan);
 const zoomed = $derived(!!index && visibleSpan < index.endTime - 0.000001);
 const frameTime = $derived(index?.timestamps[frame] ?? 0);
 const playheadVisible = $derived(frameTime >= viewStart && frameTime <= viewEnd);
 const visibleTicks = $derived(index ? frameTicks(index, viewStart, viewEnd, scale === 'frame' ? 8 : 3) : []);
 const fingers = new Map<number, { x: number; y: number }>();
 let timelineGesture: { mode: 'tap' | 'seek' | 'pan' | 'pinch' | 'blocked'; x: number; y: number; thumb: boolean; aboveTrack: boolean; initial: TimelineWindow; distance: number; ratio: number } | null = null;
 const ready = $derived(!!index && loaded && !mediaError);
 const lastPoint = $derived(locations.at(-1)?.type === 'point' && canLocate(locations.at(-1)!));
 const percent = $derived(visibleSpan ? Math.max(0, Math.min(100, (frameTime - viewStart) / visibleSpan * 100)) : 0);
 const feedback = createLiveFeedback<VideoAnnotation>({ token: () => data.token, kind: 'video', read: () => annotations, replace: next => { annotations = next; } });
 const draftKey = () => `reviewloop:video-draft:${data.token}`;
 $effect(() => {
  if (mounted) { try { localStorage.setItem(draftKey(), JSON.stringify({ composing, locations, body })); } catch { /* Saved annotations use the durable feedback queue. */ } }
 });
 onMount(() => {
  const abort = new AbortController(); let timer: ReturnType<typeof setTimeout>, callback = 0;
  try { const saved = JSON.parse(localStorage.getItem(`reviewloop:live-video:${data.token}`) ?? '[]'); if (Array.isArray(saved)) annotations = saved; } catch {}
  try { const saved = JSON.parse(localStorage.getItem(draftKey()) ?? 'null'); if (saved && Array.isArray(saved.locations) && typeof saved.body === 'string') { locations = saved.locations; body = saved.body; composing = !!saved.composing; } } catch {}
  loaded = video.readyState >= 1;
  initializeEstimate();
  if (video.error) mediaError = '浏览器无法播放此视频编码，请使用兼容的 MP4 视频';
  const query = matchMedia('(max-width: 900px)');
  const resize = () => { mobile = query.matches; };
  resize(); query.addEventListener('change', resize);
  if (composing) drawer = 'composer';
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
 function updateTime() { if (index && video && !video.seeking) { frame = frameAt(index, video.currentTime); time = index.timestamps[frame]; } }
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
 function openList() { endHold(); if (mobile) drawer = 'list'; else desktopListVisible = !desktopListVisible; }
 function closeDrawer() { drawer = null; }
 function recall(p: VideoLocation) { seekFrame(locationStart(p)); if (mobile && drawer === 'list') closeDrawer(); }
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
  seekFrame(next); composing = true; drawer = 'composer'; locations = appendTimedLocation(locations, frame, range, index!); range = false;
 }
 function setView(next: TimelineWindow) { viewStart = next.start; viewSpan = next.end - next.start; }
 function resetTimeline() { viewStart = 0; viewSpan = 0; }
 function pointRatio(clientX: number) { const rect = timeline.getBoundingClientRect(); return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width)); }
 function pointAt(clientX: number) { return viewStart + pointRatio(clientX) * visibleSpan; }
 function timelineDown(event: PointerEvent) {
  if (!ready || !index || event.button !== 0 || fingers.size >= 2) return;
  fingers.set(event.pointerId, { x: event.clientX, y: event.clientY });
  (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  if (fingers.size === 1) {
   timelineGesture = { mode: 'tap', x: event.clientX, y: event.clientY, thumb: event.target instanceof Element && !!event.target.closest('.playhead'), aboveTrack: event.clientY < timeline.querySelector('.timeline-surface')!.getBoundingClientRect().top, initial: { start: viewStart, end: viewEnd }, distance: 0, ratio: 0 };
  } else {
   const [a, b] = [...fingers.values()];
   timelineGesture = { mode: 'pinch', x: 0, y: 0, thumb: false, aboveTrack: false, initial: { start: viewStart, end: viewEnd }, distance: Math.hypot(a.x-b.x,a.y-b.y), ratio: pointRatio((a.x+b.x)/2) };
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
   if (gesture.mode === 'tap' && Math.hypot(event.clientX-gesture.x,event.clientY-gesture.y)>5) gesture.mode = gesture.thumb || gesture.aboveTrack ? 'seek' : 'pan';
   if (gesture.mode === 'seek') seekFrame(nearestFrame(index, pointAt(event.clientX)));
   if (gesture.mode === 'pan') setView(timelineWindow(gesture.initial.start - (event.clientX-gesture.x)/timeline.getBoundingClientRect().width*(gesture.initial.end-gesture.initial.start),gesture.initial.end-gesture.initial.start,index.endTime));
  }
 }
 function timelineUp(event: PointerEvent) {
  if (!fingers.has(event.pointerId)) return;
  const gesture = timelineGesture;
  fingers.delete(event.pointerId);
  if (gesture?.mode === 'tap' && event.type === 'pointerup' && index) {
   const next = nearestFrame(index, pointAt(event.clientX));
   if (gesture.aboveTrack) seekFrame(next); else addFrame(next);
  }
  if (!fingers.size) timelineGesture = null;
  else if (gesture) gesture.mode = 'blocked';
 }
 function timelineLabel(value: number, end = false) {
  if (!index) return '—';
  if (scale === 'frame') return String(frameAt(index, end ? Math.max(0,value-0.000002) : value)+1);
  const label = formatVideoTime(value);
  return visibleSpan < 10 ? label : label.split('.')[0];
 }
 function removeLocation(i: number) { locations = locations.filter((_, n) => n !== i); range = false; }
 function cancel() { drawer = null; composing = false; locations = []; body = ''; range = false; }
 function save() {
  if (!ready || !locations.length || !body.trim()) return;
  feedback.persist([...annotations, { id: crypto.randomUUID(), createdAt: new Date().toISOString(), type: 'video', locations: [...locations], body: body.trim() }]); cancel(); pause();
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
  if (mobile && drawer === 'list') return;
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
<header>
 <div class="title"><strong title={data.filename}>{data.filename}</strong><span>视频评审</span></div>
 <div class="header-actions"><a class="help-link" href="/live/help/video" target="_blank" rel="noopener" aria-label="视频标注帮助（新标签页）" title="视频标注帮助（新标签页）">?</a><span class="sync" role="status">{feedback.context.status}</span>
 {#if annotations.length}<button class="primary submit" disabled={feedback.context.busy} onclick={() => feedback.context.submit()} title={`提交给 AI，${feedback.context.pendingCount} 条待提交`}>提交给 AI{#if feedback.context.pendingCount > 0}<span class="badge">{feedback.context.pendingCount}</span>{/if}</button>{/if}
 </div>
</header>
{#if feedback.context.error}<div class="error" role="alert">{feedback.context.error}<button onclick={() => feedback.context.retry()}>重试同步</button></div>{/if}
<main class:wide={!mobile && !desktopListVisible && !composing}>
 <section class="workspace" aria-label="视频与时间轴">
  <div class="screen" class:fullscreen={fallbackFullscreen} bind:this={screen}>
   <!-- Video is the reviewed artifact; its audio is preserved without an invented caption track. -->
   <!-- svelte-ignore a11y_media_has_caption -->
   <video bind:this={video} src={data.src} playsinline preload="metadata" onloadedmetadata={() => { loaded = true; initializeEstimate(); }} ontimeupdate={updateTime} onseeked={updateTime} onplay={() => { paused = false; revealControls(); }} onpause={() => { paused = true; restoreRate(); revealControls(); }} onended={() => { paused = true; restoreRate(); revealControls(); }} onerror={() => { mediaError = '浏览器无法播放此视频编码。请使用兼容的 MP4（H.264/AAC）视频。'; }}></video>
   <button class="video-surface" disabled={!loaded || !!mediaError} aria-label="视频画面：点击播放或暂停，长按左侧减速、右侧加速" onpointerdown={startHold} onpointermove={moveHold} onpointerup={endHold} onpointercancel={endHold} onlostpointercapture={endHold} oncontextmenu={event => event.preventDefault()} onclick={screenClick}></button>
   <button class="play" class:controls-hidden={!paused && !showControls} disabled={!loaded || !!mediaError} onclick={() => { void togglePlay(); revealControls(); }} aria-label={paused ? '播放' : '暂停'}>
    {#if paused}<svg viewBox="0 0 24 24" width="30" height="30" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z" /></svg>{:else}<svg viewBox="0 0 24 24" width="30" height="30" fill="currentColor" aria-hidden="true"><path d="M6 5h4v14H6zm8 0h4v14h-4z" /></svg>{/if}
   </button>
   <button class="fullscreen-button" disabled={!loaded} onclick={toggleFullscreen} aria-label={fullscreen || fallbackFullscreen ? '退出全屏' : '全屏'}><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">{#if fullscreen || fallbackFullscreen}<path d="M9 3v6H3m18 0h-6V3M3 15h6v6m6 0v-6h6" />{:else}<path d="M9 3H3v6m12-6h6v6M3 15v6h6m6 0h6v-6" />{/if}</svg></button>
   {#if mediaError}<div class="screen-message" role="alert">{mediaError}</div>{/if}
  </div>
  <div class="transport">
   <button class="position" onclick={toggleScale} aria-label={`当前${scale === 'time' ? '时间' : '帧数'}，点击切换为${scale === 'time' ? '帧数' : '时间'}`} title="点击切换时间 / 帧数">{scale === 'frame' ? `${index?.approximate ? '约 ' : ''}${frame + 1} / ${index?.timestamps.length ?? '—'} 帧` : `${formatVideoTime(time)} / ${index ? formatVideoTime(index.endTime) : '—'}`}</button>
   <label class="select-label"><span class="sr-only">基准播放速度</span>{#if holdDirection || activeRate !== baseRate}<span class="temporary-speed" role="status" aria-label={`临时 ${activeRate} 倍速，松开恢复 ${baseRate} 倍速`}>{activeRate > baseRate ? '↑' : activeRate < baseRate ? '↓' : ''} {activeRate}×</span>{:else}<select bind:value={baseRate} onchange={setRate}>{#each [0.25, 0.5, 1, 1.5, 2, 3, 4] as rate}<option value={rate}>{rate}×</option>{/each}</select>{/if}</label>
  </div>
  {#if indexError}<div class="index-progress" role="status">精确帧定位暂不可用，仍可播放和按时间标注。帧号为估算值。{indexError}</div>{:else if !index || index.approximate}<div class="index-progress" role="status"><span>帧号为估算值 · 后台校准 {progress}% · 可正常播放和标注</span><progress max="100" value={progress}></progress></div>{/if}
  <div class="timeline" bind:this={timeline} role="group" aria-label="视频时间轴，双指缩放，缩放后拖动查看其他时间" onpointerdown={timelineDown} onpointermove={timelineMove} onpointerup={timelineUp} onpointercancel={timelineUp} onlostpointercapture={timelineUp}>
   <button class="timeline-surface" disabled={!ready} onclick={event => { if (event.detail === 0) addFrame(frame); }} aria-label="点击时间轴添加评论位置"><span class="track"></span></button>
   <div class="timeline-marks" aria-hidden="true">
   {#if index}
    {#each visibleTicks as tick}<span class="timeline-tick" style:left={`${(index.timestamps[tick]-viewStart)/visibleSpan*100}%`}><span>{scale === 'frame' ? tick+1 : timelineLabel(index.timestamps[tick])}</span></span>{/each}
    {#each annotations as annotation}{#each annotation.locations as p}<span class="mark saved" style:left={`${locationPercent(p)}%`} style:width={p.type === 'range' ? `${locationWidth(p)}%` : '5px'}></span>{/each}{/each}
    {#each locations as p}<span class="mark" class:interval={p.type === 'range'} style:left={`${locationPercent(p)}%`} style:width={p.type === 'range' ? `${locationWidth(p)}%` : '7px'}></span>{/each}
   {/if}
   </div>
   {#if playheadVisible}<button class="playhead" style:left={`${percent}%`} disabled={!ready} aria-label="播放头：拖动定位" onclick={event => { if (event.detail === 0) seekFrame(frame); }}><span></span></button>{/if}
  </div>
  <div class="timeline-labels"><span>{timelineLabel(viewStart)}</span><span>{range ? '再点一处，完成范围' : zoomed ? `${((index?.endTime ?? 0)/visibleSpan).toFixed(1)}× · 拖动平移，双指缩放` : '点击加点 · 双指张开放大'}</span><span>{timelineLabel(viewEnd,true)}</span></div>
  <div class="step-controls">
   <button use:repeatFrame={-10} disabled={!ready} onclick={() => seekFrame(frame - 10)} aria-label="后退十帧">−10 帧</button><button use:repeatFrame={-1} disabled={!ready} onclick={() => seekFrame(frame - 1)} aria-label="上一帧">−1 帧</button>
   <button class="add" disabled={!ready || (locations.length >= 200 && !range)} onclick={() => addFrame(frame)}>＋ 当前帧</button>
   <button use:repeatFrame={1} disabled={!ready} onclick={() => seekFrame(frame + 1)} aria-label="下一帧">+1 帧</button><button use:repeatFrame={10} disabled={!ready} onclick={() => seekFrame(frame + 10)} aria-label="前进十帧">+10 帧</button>
  </div>
  <div class="annotation-actions"><button class="list-button" onclick={openList} aria-haspopup={mobile ? 'dialog' : undefined} aria-expanded={mobile ? drawer === 'list' : desktopListVisible}>标注列表{#if annotations.length}<span class="list-count">{annotations.length}</span>{/if}</button>{#if composing && drawer !== 'composer'}<button onclick={() => { drawer = 'composer'; }}>继续评论</button>{/if}{#if zoomed}<button onclick={resetTimeline}>完整时间轴</button>{:else}<span class="gesture-hint">长按画面左侧减速 · 右侧加速</span>{/if}</div>
  <div class="hints"><span>{activeRate !== baseRate ? `临时 ${activeRate}× · 松开恢复 ${baseRate}×` : '空格播放 · ← → 定位 · Shift 移动十倍'}</span><details><summary>快捷键</summary><p>帧数刻度：← → 移动一帧，Shift + ← → 移动十帧。时间刻度：移动一秒 / 十秒；播放时按住 ↑ ↓ 临时变速，松开恢复。输入评论时不触发快捷键。</p></details></div>
 </section>
 {#if !mobile && (desktopListVisible || composing)}<aside aria-label="视频评论">{#if composing}{@render composerPanel()}{/if}{#if desktopListVisible}{@render commentsPanel()}{/if}</aside>{/if}
</main>
{#snippet composerPanel()}
  <section class="composer" aria-label="添加视频评论">
   <div class="composer-heading"><h2>视频评论</h2><div class="panel-actions"><button class:active={range} disabled={!lastPoint} aria-pressed={range} onclick={() => { range = !range; }}>范围</button>{#if mobile}<button class="close-drawer" aria-label="收起视频评论" onclick={closeDrawer}>×</button>{/if}</div></div>
   <div class="chips" aria-label="已选位置">{#each locations as p, i}<span class="chip"><button disabled={!canLocate(p)} onclick={() => seekFrame(locationStart(p))}>{label(p)}</button><button aria-label={`移除 ${label(p)}`} onclick={() => removeLocation(i)}>×</button></span>{/each}</div>
   {#if range}<p class="range-hint" role="status">点击时间轴上的另一处，与最后一个点组成范围。</p>{/if}
   {#if !locations.length}<p class="range-hint">在时间轴上添加位置，继续这条评论。</p>{/if}
   <textarea bind:value={body} rows="3" maxlength="20000" placeholder="这里需要怎样修改？" aria-label="评论内容"></textarea>
   <div class="composer-actions"><button onclick={cancel}>取消评论</button><button class="primary" disabled={!ready || !locations.length || !body.trim()} onclick={save}>保存评论</button></div>
  </section>
{/snippet}
{#snippet commentsPanel()}
 <section class="comments" aria-label="已保存评论"><div class="list-heading"><h2>标注列表{#if annotations.length}<span>{annotations.length}</span>{/if}</h2>{#if mobile}<button class="close-drawer" aria-label="收起标注列表" onclick={closeDrawer}>×</button>{/if}</div><div class="comment-scroll">
 {#if !annotations.length}<div class="empty"><strong>把修改意见留在具体时刻</strong><p>点击时间轴开始；多个时间点和时间段可以共用一条评论。</p></div>{/if}
 {#each annotations as annotation (annotation.id)}<article><div class="chips">{#each annotation.locations as p}<button class="saved-chip" disabled={!canLocate(p)} onclick={() => recall(p)}>{label(p)}</button>{/each}</div><p>{annotation.body}</p><button class="delete" aria-label="删除评论" onclick={() => feedback.persist(annotations.filter(a => a.id !== annotation.id))}>删除</button></article>{/each}
 </div></section>
{/snippet}
{#if mobile && drawer}
 {#key drawer}<VideoReviewDrawer title={drawer === 'composer' ? '视频评论' : '标注列表'} modal={drawer === 'list'} protect={() => screen} keepVisible={() => timeline?.nextElementSibling as HTMLElement} onclose={closeDrawer}>
  {#if drawer === 'composer'}{@render composerPanel()}{:else}{@render commentsPanel()}{/if}
 </VideoReviewDrawer>{/key}
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
 .transport { display:flex; align-items:center; gap:8px; margin-top:12px; }.play { background:#242424; color:white; border:0; min-width:46px; }.position { flex:1; font-size:13px; font-variant-numeric:tabular-nums; white-space:nowrap; }.select-label select { padding:0 8px; }
 .timeline { touch-action:none; user-select:none; -webkit-user-select:none; position:relative; height:76px; margin:4px 18px 0; }.timeline-surface { position:absolute; inset:36px 0 0; width:100%; min-height:40px; border:0; padding:0; background:transparent; touch-action:none; }.track { position:absolute; top:14px; height:10px; left:0; right:0; border-radius:5px; background:#ddddd6; }.playhead { position:absolute; top:0; width:44px; height:44px; padding:0; transform:translateX(-50%); background:transparent; border:0; touch-action:none; z-index:2; }.playhead span { display:block; margin:auto; width:3px; height:62px; pointer-events:none; background:#242424; border-radius:2px; box-shadow:0 0 0 2px #fff; }.playhead span:before { content:''; position:absolute; top:1px; left:16px; border-left:6px solid transparent; border-right:6px solid transparent; border-top:9px solid #242424; }.mark { position:absolute; top:44px; height:22px; border-radius:4px; background:#2563eb; pointer-events:none; }.mark.interval { background:#93b4fc; border:2px solid #2563eb; }.mark.saved { top:66px; height:6px; background:#9ca3af; }
 .timeline-marks { position:absolute; inset:0; overflow:hidden; pointer-events:none; }
 .timeline-tick { position:absolute; top:42px; height:22px; width:1px; background:#b5b5af; }
 .timeline-tick>span { position:absolute; bottom:26px; transform:translateX(-50%); font-size:10px; color:#77776f; font-variant-numeric:tabular-nums; white-space:nowrap; }
 .timeline-labels { display:flex; justify-content:space-between; gap:6px; color:#77776f; font-size:11px; margin:0 4px 12px; font-variant-numeric:tabular-nums; }.step-controls { display:flex; gap:6px; }.step-controls button { flex:1; padding:0 6px; white-space:nowrap; }.step-controls .add { flex:1.6; color:#1d4ed8; border-color:#b6c9f5; background:#edf3ff; }
 .hints { display:flex; justify-content:space-between; gap:12px; font-size:12px; color:#77776f; margin:12px 0; }.hints details { max-width:320px; }.hints summary { cursor:pointer; }.hints p { line-height:1.6; }.index-progress { display:grid; gap:8px; font-size:13px; padding:12px; }progress { width:100%; height:5px; accent-color:#2563eb; }
 main.wide { grid-template-columns:minmax(0,1fr); }
 aside { min-width:0; }.composer,.comments { background:#fffffd; border:1px solid #deded8; border-radius:14px; padding:16px; margin-bottom:16px; }.composer-heading { display:flex; justify-content:space-between; align-items:center; gap:12px; margin-bottom:10px; }h2 { font-size:15px; margin:0; }h2>span { color:#77776f; margin-left:8px; font-weight:400; }.chips { display:flex; flex-wrap:wrap; gap:7px; }.chip { display:inline-flex; max-width:100%; border:1px solid #b6c9f5; border-radius:9px; overflow:hidden; background:#edf3ff; }.chip button { border:0; border-radius:0; background:transparent; color:#1d4ed8; font-size:12px; padding:0 8px; font-variant-numeric:tabular-nums; }.chip button:last-child { padding:0 12px; font-size:18px; }.composer textarea { display:block; width:100%; resize:vertical; min-height:100px; margin:14px 0; border:1px solid #d5d5ce; border-radius:10px; padding:12px; font:inherit; font-size:16px; }.composer textarea:focus { outline:2px solid #93c5fd; border-color:#2563eb; }.composer-actions { display:flex; justify-content:flex-end; gap:8px; }.range-hint { font-size:12px; color:#1d4ed8; line-height:1.6; }.empty { padding:32px 0 16px; font-size:14px; }.empty p { color:#77776f; line-height:1.7; }.comments article { padding:16px 0; border-bottom:1px solid #e8e8e2; }.comments article:last-child { border-bottom:0; padding-bottom:0; }.comments article p { white-space:pre-wrap; overflow-wrap:anywhere; font-size:14px; line-height:1.6; }.saved-chip { min-height:36px; font-size:12px; padding:0 8px; background:#f5f5f2; }.delete { min-height:36px; border:0; font-size:12px; color:#77776f; background:transparent; }.error { padding:12px 18px; color:#9f1239; background:#fff1f2; display:flex; align-items:center; gap:12px; font-size:14px; }.sr-only { position:absolute; width:1px; height:1px; overflow:hidden; clip-path:inset(50%); }
 @media(max-width:900px) { main { grid-template-columns:minmax(0,1fr); max-width:780px; padding:14px; gap:12px; } video { height:auto; max-height:40svh; }.hints { display:none; }.comments,.composer { margin-bottom:12px; } }
 @media(max-width:480px) { header { padding-inline:10px; gap:6px; }.title strong { font-size:14px; }.title>span,.sync { display:none; }.submit { padding:0 9px; font-size:13px; gap:5px; }main { padding:10px; }.screen { border-radius:10px; min-height:120px; }.transport { gap:5px; }.position { font-size:10px; }select { font-size:12px; min-width:0; }.select-label select { padding:0 4px; }.play { min-width:38px; padding:0 9px; }.step-controls button { font-size:12px; }.timeline-labels { font-size:10px; }.composer { padding:12px; }.composer textarea { min-height:80px; }.composer-actions { padding-bottom:env(safe-area-inset-bottom); } }

 .screen { isolation:isolate; }
 .video-surface { position:absolute; inset:0; z-index:1; width:100%; height:100%; border:0; border-radius:0; padding:0; background:transparent; touch-action:pan-y; user-select:none; -webkit-user-select:none; -webkit-touch-callout:none; }
 .screen .play { position:absolute; z-index:2; left:10px; bottom:10px; display:grid; place-items:center; width:44px; height:44px; padding:0; border:0; border-radius:10px; background:rgb(0 0 0 / .48); color:white; backdrop-filter:blur(6px); transition:opacity .16s ease; }
 .screen .play.controls-hidden { opacity:0; pointer-events:none; }
 .screen .play:focus-visible { opacity:1; pointer-events:auto; }
 .fullscreen-button { position:absolute; z-index:2; bottom:10px; right:10px; display:grid; place-items:center; width:44px; height:44px; padding:0; border:0; background:rgb(0 0 0 / .48); color:white; }
 .temporary-speed { display:grid; place-items:center; min-width:62px; height:44px; border:1px solid #b6c9f5; border-radius:10px; background:#edf3ff; color:#1d4ed8; font-size:14px; font-variant-numeric:tabular-nums; }

 .screen-message { z-index:4; }
 .screen:fullscreen,.screen.fullscreen { position:fixed; z-index:50; inset:0; width:100%; height:100dvh; border-radius:0; min-height:0; }
 .screen:fullscreen video,.screen.fullscreen video { width:100%; height:100%; min-height:0; max-height:none; }
 .screen:fullscreen .play,.screen.fullscreen .play { bottom:calc(16px + env(safe-area-inset-bottom)); left:calc(16px + env(safe-area-inset-left)); }
 .screen:fullscreen .fullscreen-button,.screen.fullscreen .fullscreen-button { bottom:calc(16px + env(safe-area-inset-bottom)); right:calc(16px + env(safe-area-inset-right)); }
 .transport .position { text-align:left; background:transparent; border-color:transparent; padding:0 4px; min-width:0; font-size:13px; color:#525252; }
 .transport .position:hover { color:#1d4ed8; }
 .step-controls button, .annotation-actions button { user-select:none; -webkit-user-select:none; -webkit-touch-callout:none; }
 .step-controls button { touch-action:none; }
 .annotation-actions { display:flex; align-items:center; gap:8px; margin-top:12px; }
 .list-button { display:inline-flex; gap:8px; align-items:center; }
 .list-count { font-size:12px; color:#77776f; }
 .gesture-hint { margin-left:auto; font-size:11px; color:#77776f; }
 .panel-actions,.list-heading { display:flex; gap:8px; align-items:center; }
 .list-heading { justify-content:space-between; }
 .panel-actions { margin-left:auto; }
 .close-drawer { border:0; background:transparent; font-size:25px; font-weight:400; padding:0; width:44px; }
 .comment-scroll { min-height:0; }
 @media(max-width:900px) {
  .gesture-hint { font-size:10px; }
  .composer,.comments { display:flex; flex:1; flex-direction:column; min-height:0; margin:0; padding:0 16px 12px; border:0; border-radius:0; background:transparent; }
  .composer { overflow-y:auto; overscroll-behavior:contain; }
  .composer-heading,.list-heading { flex:none; min-height:44px; margin-bottom:8px; }
  .composer .chips { flex:none; max-height:76px; overflow-y:auto; overscroll-behavior:contain; }
  .composer .chip button { min-height:34px; }
  .composer textarea { flex:1; min-height:52px; resize:none; margin:10px 0; }
  .composer-actions { flex:none; padding-bottom:0; }
  .composer .range-hint { flex:none; margin:3px 0; }
  .comment-scroll { flex:1; overflow-y:auto; overscroll-behavior:contain; -webkit-overflow-scrolling:touch; padding-bottom:8px; }
  .comments article { padding-block:12px; }
  .transport .position { font-size:12px; }
 }
 @media(max-width:900px) {
  :global(.drawer.compact) .composer { padding-bottom:8px; }
  :global(.drawer.compact) .composer-heading { margin-bottom:4px; }
  :global(.drawer.compact) .composer .chips { max-height:36px; }
  :global(.drawer.compact) .composer textarea { min-height:44px; margin:6px 0; }
  :global(.drawer.compact) .composer-actions button { min-height:40px; }
 }
 @media(prefers-reduced-motion:reduce) { .screen .play { transition:none; } }
</style>
