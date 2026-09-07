<script lang="ts">
 import nextIcon from '$lib/assets/review-icons/next.svg?url';
 import prevIcon from '$lib/assets/review-icons/prev.svg?url';
	import { onMount, tick } from 'svelte';
	import { reviewViewport, reviewWidth } from '$lib/review/visualViewport';
	import './mobile-review.css';
	import ReviewHeader from './ReviewHeader.svelte';
	import ReviewToolbar from './ReviewToolbar.svelte';
	import ReviewComposer from './ReviewComposer.svelte';
	import ReviewComments from './ReviewComments.svelte';
	import ReviewDetail from './ReviewDetail.svelte';
	import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

	interface Props {
		data: {
			kind: 'pdf';
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

	type PdfAnnotation = {
		id: string;
		pageIndex: number;
		strokes: Stroke[];
		badgePosition: Point;
		body: string;
		createdAt: string;
	};

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

	let pdfDoc = $state<any>(null);
	let currentIndex = $state(0); // 0-indexed
	let totalPages = $state(1);
	let isLoadingPdf = $state(true);
	let isRenderingPage = $state(false);
	let pdfLoadError = $state<string | null>(null);

	let annotationMode = $state(false);
	let brushColor = $state('#e54b4b');
	let brushSize = $state(6);
	let isDrawing = $state(false);
	let currentStroke = $state<Stroke | null>(null);
	let draftStrokes = $state<Stroke[]>([]);
	let composingBrush = $state(false);
	let draftComment = $state('');

	let annotations = $state<PdfAnnotation[]>([]);
	let currentAnnotations = $derived(annotations.filter((ann) => ann.pageIndex === currentIndex));
	let totalAnnotationCount = $derived(annotations.length);

	let selectedAnnotationId = $state<string | null>(null);
	let showListModal = $state(false);
	let notice = $state('');
	let noticeTimer: ReturnType<typeof setTimeout> | undefined;

	let pdfCanvasElement = $state<HTMLCanvasElement | null>(null);
	let drawingCanvasElement = $state<HTMLCanvasElement | null>(null);
	let wrapperElement = $state<HTMLDivElement | null>(null);
	let stageElement = $state<HTMLElement | null>(null);

	let pageViewportWidth = $state(800);
	let pageViewportHeight = $state(1100);

	// Zoom & Pan state
	let zoom = $state(1);
	let panX = $state(0);
	let panY = $state(0);
	let isPinching = $state(false);
	let isPanning = $state(false);
	let isMousePanning = $state(false);
	let isSpacePressed = $state(false);
	let isAnimating = $state(false);

	// Touch tracking
	let initialPinchDist = 0;
	let initialPinchZoom = 1;
	let initialPinchCenter = { x: 0, y: 0 };
	let initialPan = { x: 0, y: 0 };
	let lastTouchPos = { x: 0, y: 0 };
	let lastMousePos = { x: 0, y: 0 };
	let touchStartX = 0;
	let touchStartY = 0;
	let touchStartTime = 0;
	let lastTapTime = 0;
	let lastTapPos = { x: 0, y: 0 };

	let currentRenderTask: any = null;
	const storageKey = $derived(`reviewloop:live-pdf:${data.token}`);

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

		loadPdfDocument();

		window.addEventListener('resize', handleResize);

		const stage = stageElement;
		if (stage) {
			stage.addEventListener('touchstart', handleStageTouchStart, { passive: false });
			stage.addEventListener('touchmove', handleStageTouchMove, { passive: false });
			stage.addEventListener('touchend', handleStageTouchEnd);
			stage.addEventListener('touchcancel', handleStageTouchEnd);
			stage.addEventListener('wheel', handleWheel, { passive: false });
			stage.addEventListener('mousedown', handleStageMouseDown);
			stage.addEventListener('dblclick', handleStageDblClick);
		}

		window.addEventListener('mousemove', handleStageMouseMove);
		window.addEventListener('mouseup', handleStageMouseUp);

		return () => {
			if (currentRenderTask) {
				try {
					currentRenderTask.cancel();
				} catch {}
			}
			window.removeEventListener('resize', handleResize);
			window.removeEventListener('mousemove', handleStageMouseMove);
			window.removeEventListener('mouseup', handleStageMouseUp);
			if (stage) {
				stage.removeEventListener('touchstart', handleStageTouchStart);
				stage.removeEventListener('touchmove', handleStageTouchMove);
				stage.removeEventListener('touchend', handleStageTouchEnd);
				stage.removeEventListener('touchcancel', handleStageTouchEnd);
				stage.removeEventListener('wheel', handleWheel);
				stage.removeEventListener('mousedown', handleStageMouseDown);
				stage.removeEventListener('dblclick', handleStageDblClick);
			}
		};
	});

	async function loadPdfDocument() {
		isLoadingPdf = true;
		pdfLoadError = null;
		try {
			// @ts-expect-error pdfjs-dist build entry is untyped
			const pdfjsLib: any = await import('pdfjs-dist/build/pdf.min.mjs');
			// Bundle the matching worker under the application's public asset path.
			pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

			const loadingTask = pdfjsLib.getDocument({
				url: data.src,
				cMapUrl: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.3.136/cmaps/',
				cMapPacked: true
			});
			pdfDoc = await loadingTask.promise;
			totalPages = pdfDoc.numPages;
			isLoadingPdf = false;
			await tick();
			await renderCurrentPage();
		} catch (err: any) {
			console.error('Failed to load PDF document:', err);
			isLoadingPdf = false;
			pdfLoadError = err?.message || '无法解析该 PDF 文件';
		}
	}

	// Kept separate from renderCurrentPage() because the drawing canvas is
	// mounted lazily by {#if annotationMode}: at page-render time it is usually
	// still null, so it has to be sized again once it appears.
	function syncDrawingCanvasSize() {
		if (!drawingCanvasElement) return;
		const dpr = window.devicePixelRatio || 1;
		drawingCanvasElement.width = Math.floor(pageViewportWidth * dpr);
		drawingCanvasElement.height = Math.floor(pageViewportHeight * dpr);
		drawingCanvasElement.style.width = `${pageViewportWidth}px`;
		drawingCanvasElement.style.height = `${pageViewportHeight}px`;
	}

	$effect(() => {
		if (annotationMode && drawingCanvasElement) {
			// Track page size so the canvas follows page changes and zoom-to-fit.
			void pageViewportWidth;
			void pageViewportHeight;
			syncDrawingCanvasSize();
			redrawDraftCanvas();
		}
	});

	async function renderCurrentPage() {
		if (!pdfDoc || !pdfCanvasElement) return;

		if (currentRenderTask) {
			try {
				currentRenderTask.cancel();
			} catch {}
			currentRenderTask = null;
		}

		isRenderingPage = true;
		try {
			const page = await pdfDoc.getPage(currentIndex + 1);
			const unscaledViewport = page.getViewport({ scale: 1 });

			const stageW = stageElement?.clientWidth || window.innerWidth;
			const stageH = (stageElement?.clientHeight || window.innerHeight) - 40;

			const scaleX = (stageW - 32) / unscaledViewport.width;
			const scaleY = (stageH - 32) / unscaledViewport.height;
			const baseScale = Math.max(0.2, Math.min(scaleX, stageW <= 768 ? scaleX : scaleY, 2.5));

			const viewport = page.getViewport({ scale: baseScale });
			pageViewportWidth = Math.floor(viewport.width);
			pageViewportHeight = Math.floor(viewport.height);

			const dpr = window.devicePixelRatio || 1;
			pdfCanvasElement.width = Math.floor(viewport.width * dpr);
			pdfCanvasElement.height = Math.floor(viewport.height * dpr);
			pdfCanvasElement.style.width = `${pageViewportWidth}px`;
			pdfCanvasElement.style.height = `${pageViewportHeight}px`;

			syncDrawingCanvasSize();

			const ctx = pdfCanvasElement.getContext('2d');
			if (ctx) {
				ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
				const renderContext = {
					canvasContext: ctx,
					viewport: viewport
				};
				currentRenderTask = page.render(renderContext);
				await currentRenderTask.promise;
			}
			currentRenderTask = null;
			isRenderingPage = false;
			redrawDraftCanvas();
		} catch (err: any) {
			if (err?.name !== 'RenderingCancelledException') {
				console.error('Error rendering PDF page:', err);
			}
			isRenderingPage = false;
		}
	}

	function handleResize() {
		renderCurrentPage();
	}

	function persistAnnotations(next: PdfAnnotation[]) {
		annotations = next;
		try {
			localStorage.setItem(storageKey, JSON.stringify(next));
		} catch {
			showNotice('设备存储不足，标注仅临时保留');
		}
	}

	function showNotice(msg: string) {
		notice = msg;
		clearTimeout(noticeTimer);
		noticeTimer = setTimeout(() => {
			notice = '';
		}, 2600);
	}

	function resetZoom(animated = true) {
		if (animated) {
			isAnimating = true;
			setTimeout(() => {
				isAnimating = false;
			}, 250);
		}
		zoom = 1;
		panX = 0;
		panY = 0;
		isPinching = false;
		isPanning = false;
		isMousePanning = false;
	}

	function clampPan() {
		if (!stageElement || (zoom <= 1.02 && pageViewportHeight <= stageElement.clientHeight - 32)) {
			panX = 0;
			panY = 0;
			return;
		}
		const stageRect = stageElement.getBoundingClientRect();
		const baseW = pageViewportWidth || 300;
		const baseH = pageViewportHeight || 300;
		const maxPanX = Math.max(0, (baseW * zoom - stageRect.width) / 2) + stageRect.width * 0.35;
		const maxPanY = Math.max(0, (baseH * zoom - stageRect.height) / 2) + stageRect.height * 0.35;
		panX = Math.min(maxPanX, Math.max(-maxPanX, panX));
		panY = Math.min(maxPanY, Math.max(-maxPanY, panY));
	}

	function applyZoomAtPoint(targetZoom: number, clientX: number, clientY: number, animated = false) {
		const clampedZoom = Math.min(5, Math.max(1, targetZoom));
		if (clampedZoom <= 1.02) {
			resetZoom(animated);
			return;
		}
		if (animated) {
			isAnimating = true;
			setTimeout(() => {
				isAnimating = false;
			}, 250);
		}
		if (!stageElement) {
			zoom = clampedZoom;
			return;
		}
		const stageRect = stageElement.getBoundingClientRect();
		const cx = stageRect.left + stageRect.width / 2;
		const cy = stageRect.top + stageRect.height / 2;
		const fx = clientX - cx;
		const fy = clientY - cy;

		const zoomRatio = clampedZoom / zoom;
		panX = fx - zoomRatio * (fx - panX);
		panY = fy - zoomRatio * (fy - panY);
		zoom = clampedZoom;
		clampPan();
	}

	function applyZoomDelta(delta: number) {
		if (!stageElement) return;
		const stageRect = stageElement.getBoundingClientRect();
		const cx = stageRect.left + stageRect.width / 2;
		const cy = stageRect.top + stageRect.height / 2;
		applyZoomAtPoint(zoom + delta, cx, cy, true);
	}

	function checkDoubleTap(clientX: number, clientY: number) {
		const now = Date.now();
		const dt = now - lastTapTime;
		const dist = Math.hypot(clientX - lastTapPos.x, clientY - lastTapPos.y);
		lastTapTime = now;
		lastTapPos = { x: clientX, y: clientY };
		if (dt > 40 && dt < 300 && dist < 35) {
			if (zoom > 1.1) {
				resetZoom(true);
			} else {
				applyZoomAtPoint(2.5, clientX, clientY, true);
			}
			return true;
		}
		return false;
	}

	async function goToNext() {
		if (currentIndex < totalPages - 1) {
			if (draftStrokes.length > 0 && !confirm('当前绘制的画笔标注尚未保存，切换页面将丢弃，是否继续？')) {
				return;
			}
			cancelDraft();
			resetZoom(false);
			currentIndex += 1;
			selectedAnnotationId = null;
			await tick();
			renderCurrentPage();
		}
	}

	async function goToPrev() {
		if (currentIndex > 0) {
			if (draftStrokes.length > 0 && !confirm('当前绘制的画笔标注尚未保存，切换页面将丢弃，是否继续？')) {
				return;
			}
			cancelDraft();
			resetZoom(false);
			currentIndex -= 1;
			selectedAnnotationId = null;
			await tick();
			renderCurrentPage();
		}
	}

	async function goToIndex(idx: number) {
		if (idx >= 0 && idx < totalPages && idx !== currentIndex) {
			if (draftStrokes.length > 0 && !confirm('当前绘制的画笔标注尚未保存，切换页面将丢弃，是否继续？')) {
				return;
			}
			cancelDraft();
			resetZoom(false);
			currentIndex = idx;
			selectedAnnotationId = null;
			await tick();
			renderCurrentPage();
		}
	}

	function handleKeydown(event: KeyboardEvent) {
		if (document.querySelector('dialog[open]')) return;
		if (
			event.target instanceof HTMLButtonElement ||
			event.target instanceof HTMLInputElement ||
			event.target instanceof HTMLTextAreaElement ||
			(event.target instanceof HTMLElement && event.target.isContentEditable)
		) {
			return;
		}

		if (event.code === 'Space' && !isSpacePressed) {
			isSpacePressed = true;
		} else if (event.key === 'ArrowRight' || event.key === 'PageDown') {
			event.preventDefault();
			goToNext();
		} else if (event.key === 'ArrowLeft' || event.key === 'PageUp') {
			event.preventDefault();
			goToPrev();
		} else if (event.key === 'Escape') {
			if (composingBrush) {
				composingBrush = false;
			} else if (showListModal) {
				showListModal = false;
			} else if (zoom > 1.05) {
				resetZoom(true);
			} else if (annotationMode) {
				annotationMode = false;
			}
		} else if (event.key === '+' || event.key === '=') {
			event.preventDefault();
			applyZoomDelta(0.5);
		} else if (event.key === '-' || event.key === '_') {
			event.preventDefault();
			applyZoomDelta(-0.5);
		} else if (event.key === '0') {
			event.preventDefault();
			resetZoom(true);
		}
	}

	function handleKeyup(event: KeyboardEvent) {
		if (event.code === 'Space') {
			isSpacePressed = false;
			isMousePanning = false;
		}
	}

	function handleStageTouchStart(e: TouchEvent) {
		if (e.touches.length === 2) {
			isPinching = true;
			isPanning = false;
			if (isDrawing) {
				isDrawing = false;
				currentStroke = null;
				redrawDraftCanvas();
			}
			const t1 = e.touches[0];
			const t2 = e.touches[1];
			initialPinchDist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
			initialPinchZoom = zoom;
			initialPinchCenter = {
				x: (t1.clientX + t2.clientX) / 2,
				y: (t1.clientY + t2.clientY) / 2
			};
			initialPan = { x: panX, y: panY };
			e.preventDefault();
		} else if (e.touches.length === 1) {
			touchStartX = e.touches[0].clientX;
			touchStartY = e.touches[0].clientY;
			lastTouchPos = { x: touchStartX, y: touchStartY };
			touchStartTime = Date.now();

			if (checkDoubleTap(touchStartX, touchStartY)) {
				e.preventDefault();
				return;
			}

			if (!annotationMode && (zoom > 1.05 || pageViewportHeight > (stageElement?.clientHeight ?? 0) - 32)) {
				isPanning = true;
				e.preventDefault();
			}
		}
	}

	function handleStageTouchMove(e: TouchEvent) {
		if (isPinching && e.touches.length === 2) {
			e.preventDefault();
			const t1 = e.touches[0];
			const t2 = e.touches[1];
			const currentDist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
			if (initialPinchDist > 10) {
				const scaleFactor = currentDist / initialPinchDist;
				const targetZoom = Math.min(5, Math.max(1, initialPinchZoom * scaleFactor));
				const currentCenter = {
					x: (t1.clientX + t2.clientX) / 2,
					y: (t1.clientY + t2.clientY) / 2
				};
				const centerDeltaX = currentCenter.x - initialPinchCenter.x;
				const centerDeltaY = currentCenter.y - initialPinchCenter.y;

				if (stageElement) {
					const stageRect = stageElement.getBoundingClientRect();
					const cx = stageRect.left + stageRect.width / 2;
					const cy = stageRect.top + stageRect.height / 2;
					const fx = initialPinchCenter.x - cx;
					const fy = initialPinchCenter.y - cy;
					const zoomRatio = targetZoom / initialPinchZoom;
					panX = fx - zoomRatio * (fx - initialPan.x) + centerDeltaX;
					panY = fy - zoomRatio * (fy - initialPan.y) + centerDeltaY;
					zoom = targetZoom;
					clampPan();
				}
			}
		} else if (isPanning && e.touches.length === 1) {
			e.preventDefault();
			const currentX = e.touches[0].clientX;
			const currentY = e.touches[0].clientY;
			const dx = currentX - lastTouchPos.x;
			const dy = currentY - lastTouchPos.y;
			panX += dx;
			panY += dy;
			lastTouchPos = { x: currentX, y: currentY };
			clampPan();
		}
	}

	function handleStageTouchEnd(e: TouchEvent) {
		if (isPinching && e.touches.length < 2) {
			isPinching = false;
			if (zoom <= 1.05 && pageViewportHeight <= (stageElement?.clientHeight ?? 0) - 32) {
				resetZoom(true);
			}
		}
		if (isPanning && e.touches.length === 0) {
			isPanning = false;
			clampPan();
		}

		if (!annotationMode && zoom <= 1.05 && e.touches.length === 0 && e.changedTouches.length === 1) {
			const touchEndX = e.changedTouches[0].clientX;
			const touchEndY = e.changedTouches[0].clientY;
			const dx = touchEndX - touchStartX;
			const dy = touchEndY - touchStartY;
			const dt = Date.now() - touchStartTime;
			if (dt < 400 && Math.abs(dx) > 60 && Math.abs(dy) < 80) {
				if (dx < 0) {
					goToNext();
				} else {
					goToPrev();
				}
			}
		}
	}

	function handleWheel(e: WheelEvent) {
		if (e.ctrlKey || e.metaKey) {
			e.preventDefault();
			const zoomFactor = Math.exp(-e.deltaY * 0.008);
			applyZoomAtPoint(zoom * zoomFactor, e.clientX, e.clientY);
		} else if (zoom > 1.02 || pageViewportHeight > (stageElement?.clientHeight ?? 0) - 32) {
			e.preventDefault();
			panX -= e.deltaX;
			panY -= e.deltaY;
			clampPan();
		}
	}

	function handleStageMouseDown(e: MouseEvent) {
		if (e.button === 1 || (e.button === 0 && isSpacePressed)) {
			isMousePanning = true;
			lastMousePos = { x: e.clientX, y: e.clientY };
			e.preventDefault();
		}
	}

	function handleStageMouseMove(e: MouseEvent) {
		if (isMousePanning) {
			const dx = e.clientX - lastMousePos.x;
			const dy = e.clientY - lastMousePos.y;
			panX += dx;
			panY += dy;
			lastMousePos = { x: e.clientX, y: e.clientY };
			clampPan();
		}
	}

	function handleStageMouseUp(e: MouseEvent) {
		if (isMousePanning) {
			isMousePanning = false;
			clampPan();
		}
	}

	function handleStageDblClick(e: MouseEvent) {
		if (annotationMode && isDrawing) return;
		checkDoubleTap(e.clientX, e.clientY);
	}

	function getNormalizedPoint(e: PointerEvent): Point | null {
		const target = drawingCanvasElement;
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
		if (!annotationMode || isPinching || isSpacePressed || e.button !== 0 || !drawingCanvasElement) return;
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
		if (isPinching || isSpacePressed || !isDrawing || !currentStroke || !drawingCanvasElement) return;
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
		if (!drawingCanvasElement || !currentStroke || currentStroke.points.length < 2) return;
		const ctx = drawingCanvasElement.getContext('2d');
		if (!ctx) return;

		const baseW = pageViewportWidth;
		const baseH = pageViewportHeight;
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
		if (!drawingCanvasElement) return;
		const ctx = drawingCanvasElement.getContext('2d');
		if (!ctx) return;
		const baseW = pageViewportWidth;
		const baseH = pageViewportHeight;
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

	function cancelDraft() {
		composingBrush = false;
		draftStrokes = [];
		draftComment = '';
		currentStroke = null;
		redrawDraftCanvas();
	}

	function saveDraftAnnotation() {
		if (draftStrokes.length === 0) return null;
		const firstPoint = draftStrokes[0].points[0] ?? { x: 0.5, y: 0.5 };
		const annotation: PdfAnnotation = {
			id: crypto.randomUUID(),
			pageIndex: currentIndex,
			strokes: draftStrokes,
			badgePosition: {
				x: Math.min(0.95, Math.max(0.05, firstPoint.x)),
				y: Math.min(0.95, Math.max(0.05, firstPoint.y))
			},
			body: draftComment.trim(),
			createdAt: new Date().toISOString()
		};

		const next = [...annotations, annotation];
		persistAnnotations(next);
		selectedAnnotationId = null;
		annotationMode = false;
		cancelDraft();
		showNotice('已保存标注');
		return annotation;
	}

	function deleteAnnotation(id: string) {
		const next = annotations.filter((ann) => ann.id !== id);
		persistAnnotations(next);
		if (selectedAnnotationId === id) {
			selectedAnnotationId = null;
		}
		showNotice('已删除标注');
	}

	function selectAnnotation(id: string) {
		selectedAnnotationId = selectedAnnotationId === id ? null : id;
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

	async function exportAnnotatedPdfPage() {
		if (!pdfCanvasElement) return;
		try {
			showNotice('正在生成高分辨率标注页...');
			const baseW = pageViewportWidth;
			const baseH = pageViewportHeight;
			const dpr = 2; // high resolution export

			const exportCanvas = document.createElement('canvas');
			exportCanvas.width = baseW * dpr;
			exportCanvas.height = baseH * dpr;
			const ctx = exportCanvas.getContext('2d');
			if (!ctx) throw new Error('Cannot get canvas context');

			ctx.scale(dpr, dpr);
			// Draw rendered pdf page
			ctx.drawImage(pdfCanvasElement, 0, 0, baseW, baseH);

			// Draw saved annotations
			for (let i = 0; i < currentAnnotations.length; i++) {
				const ann = currentAnnotations[i];
				for (const stroke of ann.strokes) {
					if (stroke.points.length === 0) continue;
					ctx.strokeStyle = stroke.color;
					ctx.lineWidth = stroke.size;
					ctx.lineCap = 'round';
					ctx.lineJoin = 'round';
					ctx.beginPath();
					ctx.moveTo(stroke.points[0].x * baseW, stroke.points[0].y * baseH);
					for (let k = 1; k < stroke.points.length; k++) {
						const p0 = stroke.points[k - 1];
						const p1 = stroke.points[k];
						const midX = ((p0.x + p1.x) / 2) * baseW;
						const midY = ((p0.y + p1.y) / 2) * baseH;
						ctx.quadraticCurveTo(p0.x * baseW, p0.y * baseH, midX, midY);
					}
					const last = stroke.points[stroke.points.length - 1];
					ctx.lineTo(last.x * baseW, last.y * baseH);
					ctx.stroke();
				}

				// Draw badge
				const bx = ann.badgePosition.x * baseW;
				const by = ann.badgePosition.y * baseH;
				ctx.save();
				ctx.fillStyle = '#e54b4b';
				ctx.beginPath();
				ctx.arc(bx, by, 14, 0, Math.PI * 2);
				ctx.fill();
				ctx.lineWidth = 2;
				ctx.strokeStyle = '#ffffff';
				ctx.stroke();
				ctx.fillStyle = '#ffffff';
				ctx.font = 'bold 12px sans-serif';
				ctx.textAlign = 'center';
				ctx.textBaseline = 'middle';
				ctx.fillText(String(i + 1), bx, by);
				ctx.restore();
			}

			const blob = await new Promise<Blob | null>((resolve) => exportCanvas.toBlob(resolve, 'image/png'));
			if (!blob) throw new Error('Export failed');

			const url = URL.createObjectURL(blob);
			const a = document.createElement('a');
			a.href = url;
			a.download = `${data.filename.replace(/\.pdf$/i, '')}-page-${currentIndex + 1}-annotated.png`;
			a.click();
			URL.revokeObjectURL(url);
			showNotice('标注页已导出');
		} catch (err: any) {
			console.error('Export error:', err);
			showNotice('导出失败: ' + (err?.message || '未知错误'));
		}
	}
</script>

<svelte:window onkeydown={handleKeydown} onkeyup={handleKeyup} />

<svelte:head>
	<title>{data.filename} (第 {currentIndex + 1} / {totalPages} 页) · Live PDF Review</title>
	<meta name="robots" content="noindex,nofollow" />
</svelte:head>

<div class="pdf-review-container live-review" class:review-comments-open={showListModal} class:review-painting={annotationMode} use:reviewViewport>
	<!-- Top Navigation & Toolbar -->
	<ReviewHeader filename={data.filename} actions={[{ label: '导出当前页 PNG', run: exportAnnotatedPdfPage, disabled: isLoadingPdf }, { label: '放大', run: () => applyZoomDelta(0.5) }, { label: '缩小', run: () => applyZoomDelta(-0.5) }]} hasDraft={draftStrokes.length > 0} ondiscard={cancelDraft}>
<div class="review-pagination">
   <button type="button" aria-label="上一页" onclick={goToPrev} disabled={currentIndex === 0 || isLoadingPdf}><img src={prevIcon} alt="" width="20" height="20" /></button>
   <label><input aria-label="页码" type="number" min="1" max={totalPages} value={currentIndex + 1} onkeydown={(e) => { if(e.key==='Enter') e.currentTarget.blur(); }} onblur={(e) => { const n = Number(e.currentTarget.value); if(Number.isInteger(n) && n >= 1 && n <= totalPages) goToIndex(n-1); e.currentTarget.value=String(currentIndex+1); }} /><span>/ {totalPages} 页</span></label>
   <button type="button" aria-label="下一页" onclick={goToNext} disabled={currentIndex >= totalPages - 1 || isLoadingPdf}><img src={nextIcon} alt="" width="20" height="20" /></button>
  </div><button class="review-fit" type="button" onclick={() => resetZoom(true)}>适合宽度</button>
</ReviewHeader>

	<!-- Main Canvas Stage -->
	<main use:reviewWidth={handleResize}
		class="pdf-stage"
		class:drawing-mode={annotationMode}
		class:space-grabbing={isSpacePressed}
		bind:this={stageElement}
	>
		{#if isLoadingPdf}
			<div class="loading-overlay">
				<div class="spinner"></div>
				<p>正在载入 PDF 文档...</p>
			</div>
		{:else if pdfLoadError}
			<div class="error-overlay">
				<span class="error-icon">⚠️</span>
				<p>{pdfLoadError}</p>
				<button class="retry-btn" onclick={loadPdfDocument}>重新加载</button>
			</div>
		{:else}
			<div
				class="page-wrapper"
				class:animating={isAnimating}
				bind:this={wrapperElement}
				style="transform: translate3d({panX}px, {panY}px, 0) scale({zoom}); width: {pageViewportWidth}px; height: {pageViewportHeight}px;"
			>
				<!-- PDF Rendering Canvas -->
				<canvas bind:this={pdfCanvasElement} class="pdf-canvas"></canvas>

				<!-- Saved Annotations Layer (Vector SVG) -->
				<svg
					class="annotations-svg"
					viewBox="0 0 {pageViewportWidth} {pageViewportHeight}"
					xmlns="http://www.w3.org/2000/svg"
				>
					{#each currentAnnotations as ann, annIndex (ann.id)}
						<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
						<g
							class="annotation-group"
							class:selected={selectedAnnotationId === ann.id}
							role="button"
							tabindex="0"
							onclick={(e) => {
								e.stopPropagation();
								selectAnnotation(ann.id);
							}}
							onkeydown={(e) => {
								if (e.key === 'Enter' || e.key === ' ') {
									e.stopPropagation();
									selectAnnotation(ann.id);
								}
							}}
						>
							{#each ann.strokes as stroke}
								<path
									d={strokesToSvgPath(stroke, pageViewportWidth, pageViewportHeight)}
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
								transform="translate({ann.badgePosition.x * pageViewportWidth}, {ann.badgePosition.y * pageViewportHeight})"
							>
								<circle r="14" class="badge-bg" />
								<text y="4" text-anchor="middle" class="badge-number">{annIndex + 1}</text>
							</g>
						</g>
					{/each}
				</svg>

				<!-- Active Drawing Canvas -->
				{#if annotationMode || draftStrokes.length > 0}
					<canvas
						bind:this={drawingCanvasElement}
						class="drawing-canvas" style:pointer-events={annotationMode ? "auto" : "none"}
						onpointerdown={handlePointerDown}
						onpointermove={handlePointerMove}
						onpointerup={handlePointerUp}
						onpointercancel={handlePointerCancel}
					></canvas>
				{/if}
			</div>

			<!-- Nav Arrows on Left/Right Edges -->
			{#if currentIndex > 0 && !annotationMode}
				<button
					type="button"
					class="nav-arrow left"
					onclick={goToPrev}
					title="上一页 (Left Arrow / PageUp)"
				>
					‹
				</button>
			{/if}
			{#if currentIndex < totalPages - 1 && !annotationMode}
				<button
					type="button"
					class="nav-arrow right"
					onclick={goToNext}
					title="下一页 (Right Arrow / PageDown)"
				>
					›
				</button>
			{/if}
		{/if}

		<!-- Floating Zoom Controls Pill -->
	</main>
 <ReviewToolbar paint={annotationMode} bind:color={brushColor} bind:size={brushSize} colors={BRUSH_COLORS} sizes={BRUSH_SIZES} count={totalAnnotationCount} draftCount={draftStrokes.length} comments={showListModal} disabled={isLoadingPdf}
  onbrowse={() => { annotationMode = false; showListModal=false; }} onpaint={() => { annotationMode = true; showListModal=false; selectedAnnotationId=null; }}
  oncomments={() => { showListModal = !showListModal; }} onfinish={() => { composingBrush=true; }} onundo={undoLastStroke} />

	<!-- Draft Comment Composer Popup -->

 {#if draftStrokes.length > 0 && composingBrush}
  <ReviewComposer context={`第 ${currentIndex+1} 页 · ${draftStrokes.length} 条笔画`} bind:body={draftComment} onclose={() => composingBrush=false} onsave={saveDraftAnnotation} />
 {/if}

	<!-- Selected Annotation Detail Card -->
	{#if selectedAnnotationId}
  {@const selectedAnn = annotations.find(a => a.id === selectedAnnotationId)}
  {#if selectedAnn}
   <ReviewDetail anchor={`第 ${selectedAnn.pageIndex + 1} 页 · 画笔标注`} body={selectedAnn.body} createdAt={selectedAnn.createdAt} quote={''} onclose={() => selectedAnnotationId=null} ondelete={() => deleteAnnotation(selectedAnn.id)} onall={() => { selectedAnnotationId=null; showListModal=true; }} />
  {/if}
 {/if}

	<!-- Annotations List Modal -->
 {#if showListModal}
 <ReviewComments entries={annotations.map(a => ({ id:a.id, anchor:`第 ${a.pageIndex+1} 页 · 画笔标注`, body:a.body, createdAt:a.createdAt }))} onclose={() => showListModal=false} ondelete={deleteAnnotation} onlocate={async (id) => { const a=annotations.find(a=>a.id===id); if(a) { await goToIndex(a.pageIndex); selectedAnnotationId=id; showListModal=false; } }}></ReviewComments>
 {/if}

	<!-- Notice Toast -->
	{#if notice}
		<div class="notice-toast">{notice}</div>
	{/if}
</div>

<style>
	.pdf-review-container {
		display: flex;
		flex-direction: column;
		height: 100vh;
		width: 100vw;
		background: #09090b;
		color: #f4f4f5;
		overflow: hidden;
		user-select: none;
		position: relative;
	}

	/* Top Header */

	/* Center Page Nav */

	/* Right Actions */

	/* Stage */
	.pdf-stage {
		flex: 1;
		position: relative;
		display: flex;
		align-items: center;
		justify-content: center;
		overflow: hidden;
		background: #141416;
	}

	.pdf-stage.drawing-mode {
		cursor: crosshair;
	}

	.pdf-stage.space-grabbing {
		cursor: grab;
	}

	.page-wrapper {
		position: relative;
		box-shadow: 0 20px 50px rgba(0, 0, 0, 0.6);
		transform-origin: center center;
		will-change: transform;
	}

	.page-wrapper.animating {
		transition: transform 0.25s cubic-bezier(0.2, 0, 0, 1);
	}

	.pdf-canvas {
		display: block;
		width: 100%;
		height: 100%;
		background: #ffffff;
	}

	.annotations-svg {
		position: absolute;
		top: 0;
		left: 0;
		width: 100%;
		height: 100%;
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

	.drawing-canvas {
		position: absolute;
		top: 0;
		left: 0;
		width: 100%;
		height: 100%;
		cursor: crosshair;
		touch-action: none;
		z-index: 20;
	}

	/* Nav Arrows */
	.nav-arrow {
		position: absolute;
		top: 50%;
		transform: translateY(-50%);
		width: 44px;
		height: 64px;
		display: flex;
		align-items: center;
		justify-content: center;
		background: rgba(24, 24, 27, 0.6);
		backdrop-filter: blur(8px);
		color: #ffffff;
		border: 1px solid rgba(255, 255, 255, 0.1);
		border-radius: 10px;
		font-size: 28px;
		line-height: 1;
		transition: all 0.15s ease;
		z-index: 25;
		cursor: pointer;
	}

	.nav-arrow:hover {
		background: rgba(39, 39, 42, 0.9);
		transform: translateY(-50%) scale(1.08);
	}

	.nav-arrow.left {
		left: 14px;
	}

	.nav-arrow.right {
		right: 14px;
	}

	/* Floating Zoom Controls */

	/* Composer Popup */

	/* Detail Card */

	/* Modal Backdrop & Content */

	/* Overlays */
	.loading-overlay,
	.error-overlay {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 14px;
		color: #a1a1aa;
		font-size: 14px;
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
		z-index: 60;
		pointer-events: none;
		animation: fadeIn 0.15s ease-out;
	}

	@keyframes fadeIn {
		from {
			opacity: 0;
			transform: translate(-50%, 8px);
		}
		to {
			opacity: 1;
			transform: translate(-50%, 0);
		}
	}

	@media (max-width: 640px) {

		/* The floating edge arrows overlap the page on a narrow screen and
		   there is nothing to gain from them: the header carries prev/next
		   and a horizontal swipe already changes page. */
		.nav-arrow {
			display: none;
		}
		/* One 56px row cannot hold the filename plus every control on a
		   phone, so let the header grow into rows: file identity on the
		   first, controls on the second, and controls scroll sideways
		   rather than compress if they still do not fit. */

	}
</style>
