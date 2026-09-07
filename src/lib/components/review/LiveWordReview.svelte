<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { reviewViewport, reviewWidth } from '$lib/review/visualViewport';
	import './mobile-review.css';
	import { twoFingerPan } from '$lib/review/twoFingerPan';
	import ReviewHeader from './ReviewHeader.svelte';
	import ReviewHint from './ReviewHint.svelte';
	import ReviewToolbar from './ReviewToolbar.svelte';
	import ReviewComposer from './ReviewComposer.svelte';
	import ReviewComments from './ReviewComments.svelte';
	import ReviewDetail from './ReviewDetail.svelte';

	interface Props {
		data: {
			kind: 'word';
			token: string;
			filename: string;
			size: number;
			updatedAt: string;
			src: string;
		};
	}

	let { data }: Props = $props();

	type Point = { x: number; y: number };

	type Stroke = {
		color: string;
		size: number;
		points: Point[];
	};

	type TextAnnotation = {
		id: string;
		type: 'text';
		selectedText: string;
		body: string;
		createdAt: string;
	};

	type BrushAnnotation = {
		id: string;
		type: 'brush';
		strokes: Stroke[];
		badgePosition: Point;
		body: string;
		createdAt: string;
	};

	type WordAnnotation = TextAnnotation | BrushAnnotation;

	const BRUSH_COLORS = [
		{ name: '红色', value: '#e54b4b' },
		{ name: '橙黄', value: '#e99821' },
		{ name: '蓝色', value: '#2563eb' },
		{ name: '绿色', value: '#159b79' },
		{ name: '紫色', value: '#9364d8' },
		{ name: '白色', value: '#ffffff' }
	];

	const BRUSH_SIZES = [
		{ name: '细', value: 3 },
		{ name: '中', value: 6 },
		{ name: '粗', value: 12 }
	];

	let isLoading = $state(true);
	let loadError = $state<string | null>(null);
	let docContainer = $state<HTMLDivElement | null>(null);
	let scrollContainer = $state<HTMLElement | null>(null);
	let drawingCanvas = $state<HTMLCanvasElement | null>(null);

	// Zoom state
	// A US Letter .docx page is 816px wide; on a 402px phone the fit ratio is
	// ~0.45, so the floor has to sit below that or the page cannot fit at all.
	const MIN_ZOOM = 0.25;
	const MAX_ZOOM = 2.0;
	const STAGE_PADDING_X = 16; // keep in sync with .word-stage padding

	let zoom = $state(1);

	// Annotations state
	let annotations = $state<WordAnnotation[]>([]);
	let totalAnnotationCount = $derived(annotations.length);
	let brushAnns = $derived(annotations.filter((a): a is BrushAnnotation => a.type === 'brush'));
	let selectedAnnotationId = $state<string | null>(null);
	let showListModal = $state(false);
	let notice = $state('');
	let noticeTimer: ReturnType<typeof setTimeout> | undefined;

	// Text selection annotation state
	let textSelectionCandidate = $state<{ selectedText: string; range: Range } | null>(null);
	let textDraft = $state<{ selectedText: string } | null>(null);
	let textDraftBody = $state('');

	// Brush annotation state
	let brushMode = $state(false);
	let brushColor = $state('#e54b4b');
	let brushSize = $state(6);
	let isDrawing = $state(false);
	let currentStroke = $state<Stroke | null>(null);
	let draftStrokes = $state<Stroke[]>([]);
	let composingBrush = $state(false);
	let brushDraftComment = $state('');

	const storageKey = $derived(`reviewloop:live-word:${data.token}`);

	// The drawing canvas is mounted lazily by {#if brushMode}, so the
	// syncCanvasSize() call at load time runs while drawingCanvas is still null
	// and bails out. Re-sync once the element actually exists, otherwise the
	// canvas keeps its intrinsic 300x150 default.
	$effect(() => {
		if (brushMode && drawingCanvas && docContainer) syncCanvasSize();
	});

	onMount(() => {
		showListModal = window.matchMedia('(min-width: 1100px)').matches;
		try {
			const saved = localStorage.getItem(storageKey);
			if (saved) {
				const parsed = JSON.parse(saved);
				annotations = Array.isArray(parsed) ? parsed : [];
			}
		} catch {
			annotations = [];
		}

		loadWordDocument();

		window.addEventListener('resize', handleResize);
		document.addEventListener('selectionchange', handleSelectionChange);

		return () => {
			window.removeEventListener('resize', handleResize);
			document.removeEventListener('selectionchange', handleSelectionChange);
		};
	});

	async function loadWordDocument() {
		isLoading = true;
		loadError = null;
		try {
			const res = await fetch(data.src);
			if (!res.ok) {
				const failure = await res.json().catch(() => null);
				throw new Error(failure?.message ?? `无法获取文件 (HTTP ${res.status})`);
			}
			const buffer = await res.arrayBuffer();

			if (!docContainer) return;
			docContainer.innerHTML = '';

			const { renderAsync } = await import('docx-preview');
			await renderAsync(buffer, docContainer, undefined, {
				className: 'docx',
				inWrapper: true,
				breakPages: true,
				ignoreWidth: false,
				ignoreHeight: false,
				renderHeaders: true,
				renderFooters: true,
				renderFootnotes: true,
				renderEndnotes: true
			});

			isLoading = false;
			await tick();
			fitToWidth();
			await tick();
			syncCanvasSize();
			renderHighlights();
		} catch (err: any) {
			console.error('Failed to load Word document:', err);
			isLoading = false;
			loadError = err?.message || '无法解析该 Word 文件，可能格式不兼容或损坏';
		}
	}

	/**
	 * A .docx page has a fixed width (816px for US Letter), which overflows any
	 * phone viewport. Scale it down to fit on first render so the document is
	 * readable without horizontal scrolling; the zoom controls still override.
	 */
	function fitToWidth() {
		if (!docContainer || !scrollContainer) return;
		const docWidth = docContainer.scrollWidth;
		const available = scrollContainer.clientWidth - STAGE_PADDING_X * 2;
		if (docWidth <= 0 || available <= 0 || docWidth <= available) return;
		zoom = Math.max(MIN_ZOOM, Math.floor((available / docWidth) * 100) / 100);
	}

	function handleResize() {
		syncCanvasSize();
	}

	function syncCanvasSize() {
		if (!drawingCanvas || !docContainer) return;
		// Use layout sizes only. getBoundingClientRect() is post-transform and
		// .word-document-wrapper carries a scale({zoom}), so mixing the two
		// oversizes the canvas whenever zoom !== 1.
		const w = docContainer.scrollWidth || docContainer.clientWidth;
		const h = docContainer.scrollHeight || docContainer.clientHeight;
		if (w === 0 || h === 0) return;

		const dpr = window.devicePixelRatio || 1;
		drawingCanvas.width = Math.floor(w * dpr);
		drawingCanvas.height = Math.floor(h * dpr);
		drawingCanvas.style.width = `${w}px`;
		drawingCanvas.style.height = `${h}px`;
		redrawDraftCanvas();
	}

	function handleSelectionChange() {
		if (brushMode || isLoading) return;
		const selection = window.getSelection();
		if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
			textSelectionCandidate = null;
			return;
		}

		const range = selection.getRangeAt(0);
		if (!docContainer || !docContainer.contains(range.commonAncestorContainer)) {
			textSelectionCandidate = null;
			return;
		}

		const text = range.toString().trim();
		if (!text || text.length > 5000) {
			textSelectionCandidate = null;
			return;
		}

		textSelectionCandidate = {
			selectedText: text,
			range: range.cloneRange()
		};
	}

	function openTextComposer() {
		if (!textSelectionCandidate) return;
		textDraft = { selectedText: textSelectionCandidate.selectedText };
		textDraftBody = '';
		textSelectionCandidate = null;
		window.getSelection()?.removeAllRanges();

	}

	function cancelTextDraft() {
		textDraft = null;
		textDraftBody = '';
		textSelectionCandidate = null;
	}

	function saveTextDraft() {
		if (!textDraft || !textDraftBody.trim()) return;
		const annotation: TextAnnotation = {
			id: crypto.randomUUID(),
			type: 'text',
			selectedText: textDraft.selectedText,
			body: textDraftBody.trim(),
			createdAt: new Date().toISOString()
		};

		const next = [...annotations, annotation];
		persistAnnotations(next);
		selectedAnnotationId = null;
		brushMode = false;
		cancelTextDraft();
		showNotice('已保存文字批注');
		renderHighlights();
	}

	function persistAnnotations(next: WordAnnotation[]) {
		annotations = next;
		try {
			localStorage.setItem(storageKey, JSON.stringify(next));
		} catch {
			showNotice('设备存储不足，批注仅临时保留');
		}
	}

	function showNotice(msg: string) {
		notice = msg;
		clearTimeout(noticeTimer);
		noticeTimer = setTimeout(() => {
			notice = '';
		}, 2600);
	}

	function deleteAnnotation(id: string) {
		const next = annotations.filter((ann) => ann.id !== id);
		persistAnnotations(next);
		if (selectedAnnotationId === id) selectedAnnotationId = null;
		showNotice('已删除批注');
		renderHighlights();
		redrawDraftCanvas();
	}

	function renderHighlights() {
		if (!document.getElementById('live-word-highlight-style')) {
			const style = document.createElement('style');
			style.id = 'live-word-highlight-style';
			style.textContent = '::highlight(live-word-annotations) { background: #fef08a; color: #18181b; }';
			document.head.append(style);
		}
		const registry = (CSS as any)?.highlights;
		const HighlightClass = (window as any)?.Highlight;
		if (!registry || !HighlightClass || !docContainer) return;
		registry.delete('live-word-annotations');

		const textAnns = annotations.filter((ann): ann is TextAnnotation => ann.type === 'text');
		if (textAnns.length === 0) return;

		const ranges: Range[] = [];
		const walker = document.createTreeWalker(docContainer, NodeFilter.SHOW_TEXT);
		const textNodes: { node: Text; start: number; end: number }[] = [];
		let fullText = '';

		for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
			const start = fullText.length;
			fullText += node.data;
			textNodes.push({ node, start, end: fullText.length });
		}

		for (const ann of textAnns) {
			let searchIndex = 0;
			while ((searchIndex = fullText.indexOf(ann.selectedText, searchIndex)) !== -1) {
				const matchEnd = searchIndex + ann.selectedText.length;
				const startNodeInfo = textNodes.find((tn) => searchIndex >= tn.start && searchIndex < tn.end);
				const endNodeInfo = textNodes.find((tn) => matchEnd > tn.start && matchEnd <= tn.end);

				if (startNodeInfo && endNodeInfo) {
					const range = document.createRange();
					range.setStart(startNodeInfo.node, searchIndex - startNodeInfo.start);
					range.setEnd(endNodeInfo.node, matchEnd - endNodeInfo.start);
					ranges.push(range);
					break;
				}
				searchIndex += 1;
			}
		}

		if (ranges.length > 0) {
			registry.set('live-word-annotations', new HighlightClass(...ranges));
		}
	}

	// Brush handling
	function getNormalizedPoint(e: PointerEvent): Point | null {
		const target = drawingCanvas;
		if (!target) return null;
		const rect = target.getBoundingClientRect();
		if (rect.width === 0 || rect.height === 0) return null;
		const x = (e.clientX - rect.left) / rect.width;
		const y = (e.clientY - rect.top) / rect.height;
		return {
			x: Math.max(0, Math.min(1, x)),
			y: Math.max(0, Math.min(1, y))
		};
	}

	function handlePointerDown(e: PointerEvent) {
		if (!brushMode || !e.isPrimary || e.button !== 0 || !drawingCanvas) return;
		const pt = getNormalizedPoint(e);
		if (!pt) return;

		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);

		isDrawing = true;
		currentStroke = {
			color: brushColor,
			size: brushSize,
			points: [pt]
		};

		redrawDraftCanvas();
	}

	function handlePointerMove(e: PointerEvent) {
		if (!isDrawing || !currentStroke || !drawingCanvas) return;
		const pt = getNormalizedPoint(e);
		if (!pt) return;
		currentStroke.points.push(pt);
		drawLatestStrokeSegment();
	}

	function handlePointerUp(e: PointerEvent) {
		if (!isDrawing) return;
		isDrawing = false;
		if (currentStroke && currentStroke.points.length > 0) {
			draftStrokes = [...draftStrokes, currentStroke];
			currentStroke = null;
			redrawDraftCanvas();
		}
	}

	function handlePointerCancel() {
		if (!isDrawing) return;
		isDrawing = false;
		currentStroke = null;
		redrawDraftCanvas();
	}

	function drawLatestStrokeSegment() {
		if (!drawingCanvas || !currentStroke || currentStroke.points.length < 2) return;
		const ctx = drawingCanvas.getContext('2d');
		if (!ctx) return;

		const baseW = drawingCanvas.offsetWidth;
		const baseH = drawingCanvas.offsetHeight;
		const pts = currentStroke.points;
		const p0 = pts[pts.length - 2];
		const p1 = pts[pts.length - 1];

		const dpr = window.devicePixelRatio || 1;
		ctx.save();
		ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		ctx.strokeStyle = currentStroke.color;
		ctx.lineWidth = currentStroke.size;
		ctx.lineCap = 'round';
		ctx.lineJoin = 'round';

		ctx.beginPath();
		ctx.moveTo(p0.x * baseW, p0.y * baseH);
		ctx.lineTo(p1.x * baseW, p1.y * baseH);
		ctx.stroke();
		ctx.restore();
	}

	function redrawDraftCanvas() {
		if (!drawingCanvas) return;
		const ctx = drawingCanvas.getContext('2d');
		if (!ctx) return;
		const baseW = drawingCanvas.offsetWidth;
		const baseH = drawingCanvas.offsetHeight;
		const dpr = window.devicePixelRatio || 1;

		ctx.save();
		ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		ctx.clearRect(0, 0, baseW, baseH);

		const all = currentStroke ? [...draftStrokes, currentStroke] : draftStrokes;
		for (const stroke of all) {
			if (stroke.points.length === 0) continue;
			ctx.strokeStyle = stroke.color;
			ctx.lineWidth = stroke.size;
			ctx.lineCap = 'round';
			ctx.lineJoin = 'round';

			ctx.beginPath();
			ctx.moveTo(stroke.points[0].x * baseW, stroke.points[0].y * baseH);
			if (stroke.points.length === 1) {
				ctx.lineTo(stroke.points[0].x * baseW + 0.1, stroke.points[0].y * baseH + 0.1);
			} else {
				for (let i = 1; i < stroke.points.length; i++) {
					const p0 = stroke.points[i - 1];
					const p1 = stroke.points[i];
					const midX = ((p0.x + p1.x) / 2) * baseW;
					const midY = ((p0.y + p1.y) / 2) * baseH;
					ctx.quadraticCurveTo(p0.x * baseW, p0.y * baseH, midX, midY);
				}
				const last = stroke.points[stroke.points.length - 1];
				ctx.lineTo(last.x * baseW, last.y * baseH);
			}
			ctx.stroke();
		}
		ctx.restore();
	}

	function undoLastStroke() {
		if (draftStrokes.length > 0) {
			draftStrokes = draftStrokes.slice(0, -1);
			redrawDraftCanvas();
		}
	}

	function cancelBrushDraft() {
		composingBrush = false;
		draftStrokes = [];
		brushDraftComment = '';
		currentStroke = null;
		redrawDraftCanvas();
	}

	function saveBrushDraft() {
		if (draftStrokes.length === 0) return;
		const firstPoint = draftStrokes[0].points[0] ?? { x: 0.5, y: 0.5 };
		const annotation: BrushAnnotation = {
			id: crypto.randomUUID(),
			type: 'brush',
			strokes: draftStrokes,
			badgePosition: {
				x: Math.min(0.95, Math.max(0.05, firstPoint.x)),
				y: Math.min(0.95, Math.max(0.05, firstPoint.y))
			},
			body: brushDraftComment.trim(),
			createdAt: new Date().toISOString()
		};

		const next = [...annotations, annotation];
		persistAnnotations(next);
		selectedAnnotationId = null;
		brushMode = false;
		cancelBrushDraft();
		showNotice('已保存画笔标注');
	}

	function strokesToSvgPath(stroke: Stroke, baseW: number, baseH: number): string {
		if (!stroke.points || stroke.points.length === 0) return '';
		const pts = stroke.points;
		if (pts.length === 1) {
			const x = pts[0].x * baseW;
			const y = pts[0].y * baseH;
			return `M ${x} ${y} L ${x + 0.1} ${y + 0.1}`;
		}
		let path = `M ${pts[0].x * baseW} ${pts[0].y * baseH}`;
		for (let i = 1; i < pts.length; i++) {
			const p0 = pts[i - 1];
			const p1 = pts[i];
			const midX = ((p0.x + p1.x) / 2) * baseW;
			const midY = ((p0.y + p1.y) / 2) * baseH;
			path += ` Q ${p0.x * baseW} ${p0.y * baseH} ${midX} ${midY}`;
		}
		const last = pts[pts.length - 1];
		path += ` L ${last.x * baseW} ${last.y * baseH}`;
		return path;
	}

	async function shareAnnotations() {
		const json = JSON.stringify(annotations, null, 2);
		if (navigator.clipboard?.writeText) {
			await navigator.clipboard.writeText(json);
			showNotice('批注 JSON 已复制到剪贴板');
			return;
		}
		const blob = new Blob([json], { type: 'application/json' });
		const url = URL.createObjectURL(blob);
		const anchor = document.createElement('a');
		anchor.href = url;
		anchor.download = `${data.filename}.annotations.json`;
		anchor.click();
		URL.revokeObjectURL(url);
		showNotice('已下载批注文件');
	}

	function printDocument() {
		window.print();
	}
</script>

<svelte:head>
	<title>{data.filename} · Live Word Review</title>
	<meta name="robots" content="noindex,nofollow" />
</svelte:head>

<div class="word-review-container live-review" class:review-comments-open={showListModal} class:review-painting={brushMode} use:reviewViewport>
	<!-- Top Toolbar -->
	<ReviewHeader filename={data.filename} actions={[{ label: '适合宽度', run: () => { zoom = 1; fitToWidth(); } }, { label: '导出批注 JSON', run: shareAnnotations, disabled: !annotations.length }, { label: '打印 / 另存为 PDF', run: printDocument }, { label: '放大', run: () => zoom = Math.min(MAX_ZOOM, zoom + 0.15) }, { label: '缩小', run: () => zoom = Math.max(MIN_ZOOM, zoom - 0.15) }]} hasDraft={draftStrokes.length > 0} ondiscard={cancelBrushDraft} />
<ReviewHint ready={!isLoading} placement="document" text="选择文字即可添加批注" />

	<!-- Scrollable Document Stage -->
	<main use:reviewWidth={() => { zoom=1; fitToWidth(); syncCanvasSize(); }} use:twoFingerPan={{ enabled: brushMode, zoom, min: MIN_ZOOM, max: MAX_ZOOM, onzoom: (value) => zoom=value, oncancel: () => { isDrawing=false; currentStroke=null; redrawDraftCanvas(); } }} class="word-stage" bind:this={scrollContainer}>
		{#if isLoading}
			<div class="loading-overlay">
				<div class="spinner"></div>
				<p>正在解析 Word 文档排版与样式...</p>
			</div>
		{:else if loadError}
			<div class="error-overlay">
				<span class="error-icon">⚠️</span>
				<p>{loadError}</p>
				<button class="retry-btn" onclick={loadWordDocument}>重新加载</button>
			</div>
		{/if}

		<!-- CSS zoom, not transform: scale(). A transform leaves the layout box
		     at full width, so the scroll extent never shrinks and a scaled-down
		     page still overflows its container. zoom scales layout too. -->
		<div class="word-document-wrapper" style:zoom={zoom}>
			<!-- Docx-preview Output Container -->
			<div
				bind:this={docContainer}
				class="docx-render-container"
				class:brush-active={brushMode}
			></div>

			<!-- Saved Brush Annotations (SVG Overlay) -->
			{#if docContainer && brushAnns.length > 0}
				<svg
					class="word-annotations-svg"
					style="width: {docContainer.scrollWidth}px; height: {docContainer.scrollHeight}px;"
					viewBox="0 0 {docContainer.scrollWidth} {docContainer.scrollHeight}"
				>
					{#each brushAnns as ann, annIndex (ann.id)}
						<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
						<g
							class="annotation-group"
							class:selected={selectedAnnotationId === ann.id}
							role="button"
							tabindex="0"
							onclick={() => (selectedAnnotationId = ann.id)}
							onkeydown={(e) => {
								if (e.key === 'Enter') selectedAnnotationId = ann.id;
							}}
						>
							{#each ann.strokes as stroke}
								<path
									d={strokesToSvgPath(stroke, docContainer.scrollWidth, docContainer.scrollHeight)}
									stroke={stroke.color}
									stroke-width={stroke.size}
									stroke-linecap="round"
									stroke-linejoin="round"
									fill="none"
									class="saved-stroke"
								/>
							{/each}

							<!-- Numbered Badge Marker -->
							<g
								class="badge-marker"
								transform="translate({ann.badgePosition.x * docContainer.scrollWidth}, {ann.badgePosition.y * docContainer.scrollHeight})"
							>
								<circle r="14" class="badge-bg" />
								<text y="4" text-anchor="middle" class="badge-number">{annIndex + 1}</text>
							</g>
						</g>
					{/each}
				</svg>
			{/if}

			<!-- Active Drawing Canvas -->
			{#if brushMode || draftStrokes.length > 0}
				<canvas
					bind:this={drawingCanvas}
					class="word-drawing-canvas" style:pointer-events={brushMode ? "auto" : "none"}
					onpointerdown={handlePointerDown}
					onpointermove={handlePointerMove}
					onpointerup={handlePointerUp}
					onpointercancel={handlePointerCancel}
				></canvas>
			{/if}
		</div>

		<!-- Floating Text Selection "Add Comment" Pill -->
		{#if textSelectionCandidate && !textDraft}
			<div class="floating-selection-bar">
				<button type="button" class="btn-add-comment" onclick={openTextComposer}>
					➕ 添加批注 · “{textSelectionCandidate.selectedText.slice(0, 24)}{textSelectionCandidate.selectedText.length > 24 ? '…' : ''}”
				</button>
			</div>
		{/if}
	</main>
 <ReviewToolbar paint={brushMode} bind:color={brushColor} bind:size={brushSize} colors={BRUSH_COLORS} sizes={BRUSH_SIZES} count={totalAnnotationCount} draftCount={draftStrokes.length} comments={showListModal} disabled={isLoading}
  onbrowse={() => { brushMode = false; showListModal=false; }} onpaint={() => { brushMode = true; showListModal=false; selectedAnnotationId=null; }}
  oncomments={() => { showListModal = !showListModal; }} onfinish={() => { composingBrush=true; }} onundo={undoLastStroke} />

{#if textDraft}
 <ReviewComposer brush={false} context="Word · 所选文字" quote={textDraft.selectedText} bind:body={textDraftBody} onclose={cancelTextDraft} onsave={saveTextDraft} />
 {/if}
	<!-- Brush Draft Comment Composer -->

 {#if draftStrokes.length > 0 && composingBrush}
  <ReviewComposer context={`Word · ${draftStrokes.length} 条笔画`} bind:body={brushDraftComment} onclose={() => composingBrush=false} onsave={saveBrushDraft} />
 {/if}

	<!-- Selected Annotation Detail Card -->
	{#if selectedAnnotationId}
  {@const selectedAnn = annotations.find(a => a.id === selectedAnnotationId)}
  {#if selectedAnn}
   <ReviewDetail anchor={selectedAnn.type === 'text' ? '文字批注' : '画笔标注'} body={selectedAnn.body} createdAt={selectedAnn.createdAt} quote={selectedAnn.type === 'text' ? selectedAnn.selectedText : ''} onclose={() => selectedAnnotationId=null} ondelete={() => deleteAnnotation(selectedAnn.id)} onall={() => { selectedAnnotationId=null; showListModal=true; }} />
  {/if}
 {/if}

	<!-- All Annotations Modal -->
 {#if showListModal}
 <ReviewComments entries={annotations.map(a => ({ id:a.id, anchor:a.type==='text' ? 'Word · 文字批注' : 'Word · 画笔标注', body:a.body, createdAt:a.createdAt, quote:a.type==='text' ? a.selectedText : undefined }))} onclose={() => showListModal=false} ondelete={deleteAnnotation} onlocate={(id) => { selectedAnnotationId=id; showListModal=false; const a=annotations.find(a=>a.id===id); if(a?.type==='brush' && scrollContainer && docContainer) scrollContainer.scrollTop=a.badgePosition.y*docContainer.scrollHeight*zoom; }}></ReviewComments>
 {/if}

	<!-- Notice Toast -->
	{#if notice}
		<div class="notice-toast">{notice}</div>
	{/if}
</div>

<style>
	.word-review-container {
		display: flex;
		flex-direction: column;
		height: 100vh;
		width: 100vw;
		background: #09090b;
		color: #f4f4f5;
		overflow: hidden;
		position: relative;
	}

	/* Header */

	/* Center Zoom */

	/* Right Actions */

	/* Main Stage */
	.word-stage {
		flex: 1;
		position: relative;
		overflow: auto;
		background: #18181b;
		display: flex;
		flex-direction: column;
		/* "safe" matters: a plain center pushes an item wider than the container
		   to a negative offset, and browsers cannot scroll into negative
		   overflow, so the left edge of the page became unreachable. safe center
		   falls back to flex-start once the item stops fitting. */
		align-items: safe center;
		padding: 30px 16px;
	}

	.word-document-wrapper {
		position: relative;
		display: flex;
		flex-direction: column;
		align-items: safe center;
	}

	.docx-render-container {
		position: relative;
		display: flex;
		flex-direction: column;
		align-items: safe center;
	}

	.docx-render-container.brush-active {
		user-select: none;
	}

	/* docx-preview DOM style overrides */
	:global(.docx-wrapper) {
		background: transparent !important;
		padding: 0 !important;
		display: flex !important;
		flex-direction: column !important;
		align-items: center !important;
	}

	:global(section.docx) {
		background: #ffffff !important;
		color: #1a1a1a !important;
		box-shadow: 0 12px 36px rgba(0, 0, 0, 0.45) !important;
		border-radius: 3px !important;
		margin-bottom: 28px !important;
	}

	.word-annotations-svg {
		position: absolute;
		top: 0;
		left: 0;
		pointer-events: none;
		z-index: 10;
	}

	.annotation-group {
		cursor: pointer;
		pointer-events: auto;
	}

	.saved-stroke {
		transition: stroke-width 0.15s;
	}

	.annotation-group.selected .saved-stroke {
		filter: drop-shadow(0 0 6px rgba(255, 255, 255, 0.8));
	}

	.badge-marker {
		cursor: pointer;
		transition: filter 0.15s ease;
	}

	.badge-marker:hover {
		filter: drop-shadow(0 2px 5px rgba(37, 99, 235, 0.5));
	}

	.badge-bg {
		fill: #ef4444;
		stroke: #ffffff;
		stroke-width: 2;
	}

	.badge-number {
		fill: #ffffff;
		font-size: 12px;
		font-weight: bold;
		font-family: sans-serif;
	}

	.word-drawing-canvas {
		position: absolute;
		top: 0;
		left: 0;
		/* Fallback so the canvas never renders at its intrinsic 300x150 if the
		   JS sizing pass has not run yet; syncCanvasSize() overrides both. */
		width: 100%;
		height: 100%;
		cursor: crosshair;
		touch-action: none;
		z-index: 20;
	}

	/* Floating Selection Action */
	.floating-selection-bar {
		position: fixed;
		bottom: 30px;
		left: 50%;
		transform: translateX(-50%);
		z-index: 40;
		animation: popUp 0.15s ease-out;
	}

	@keyframes popUp {
		from {
			opacity: 0;
			transform: translate(-50%, 10px);
		}
		to {
			opacity: 1;
			transform: translate(-50%, 0);
		}
	}

	.btn-add-comment {
		background: #2563eb;
		color: #ffffff;
		border: 1px solid #3b82f6;
		border-radius: 999px;
		padding: 8px 18px;
		font-size: 13px;
		font-weight: 500;
		cursor: pointer;
		box-shadow: 0 10px 25px rgba(37, 99, 235, 0.5);
	}

	/* Composer Popup */

	/* Detail Card */

	/* Modal Backdrop & Content */

	/* Loading & Error */
	.loading-overlay,
	.error-overlay {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 14px;
		color: #a1a1aa;
		font-size: 14px;
		padding: 40px 0;
	}

	.spinner {
		width: 32px;
		height: 32px;
		border: 3px solid rgba(255, 255, 255, 0.1);
		border-top-color: #3b82f6;
		border-radius: 50%;
		animation: spin 0.8s linear infinite;
	}

	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}

	.error-icon {
		font-size: 32px;
	}

	.retry-btn {
		background: #2563eb;
		border: none;
		color: #ffffff;
		padding: 6px 14px;
		border-radius: 6px;
		font-size: 13px;
		cursor: pointer;
	}

	/* Notice Toast */
	.notice-toast {
		position: fixed;
		bottom: 72px;
		left: 50%;
		transform: translateX(-50%);
		background: rgba(24, 24, 27, 0.95);
		border: 1px solid rgba(255, 255, 255, 0.15);
		color: #ffffff;
		padding: 8px 18px;
		border-radius: 999px;
		font-size: 12px;
		box-shadow: 0 10px 25px rgba(0, 0, 0, 0.5);
		z-index: 70;
		pointer-events: none;
	}

	@media (max-width: 640px) {

		/* One 56px row cannot hold the filename plus every control on a phone,
		   so let the header grow into rows: the file identity takes the first
		   row, the controls the second, and the controls scroll sideways rather
		   than compress if they still do not fit. */

	}

	/* Print styles */
	@media print {
		.floating-selection-bar,
	.notice-toast,
	.word-drawing-canvas {
			display: none !important;
		}
		.word-review-container,
		.word-stage {
			background: #ffffff !important;
			color: #000000 !important;
			height: auto !important;
			overflow: visible !important;
			padding: 0 !important;
		}
		.word-document-wrapper {
			zoom: 1 !important;
		}
		:global(section.docx) {
			box-shadow: none !important;
			margin: 0 !important;
			page-break-after: always;
		}
	}
</style>
