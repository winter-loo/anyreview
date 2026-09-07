<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { reviewViewport } from '$lib/review/visualViewport';
	import './mobile-review.css';
	import { twoFingerPan } from '$lib/review/twoFingerPan';
	import ReviewHeader from './ReviewHeader.svelte';
	import ReviewToolbar from './ReviewToolbar.svelte';
	import ReviewComposer from './ReviewComposer.svelte';
	import ReviewComments from './ReviewComments.svelte';
	import ReviewDetail from './ReviewDetail.svelte';
	import * as XLSX from 'xlsx';

	interface Props {
		data: {
			kind: 'excel';
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

	type CellAnnotation = {
		id: string;
		type: 'cell';
		sheetName: string;
		cellRef: string;
		minR: number;
		maxR: number;
		minC: number;
		maxC: number;
		cellValue: string;
		body: string;
		createdAt: string;
	};

	type PaintAnnotation = {
		id: string;
		type: 'paint';
		sheetName: string;
		badgePosition: Point;
		strokes: Stroke[];
		body: string;
		createdAt: string;
	};

	type ExcelAnnotation = CellAnnotation | PaintAnnotation;

	type GridCell = {
		r: number;
		c: number;
		addr: string;
		value: any;
		formatted: string;
		formula?: string;
		/** Formula cell whose result was never cached in the file. */
		uncachedFormula: boolean;
		type: string;
		rowspan: number;
		colspan: number;
		hiddenByMerge: boolean;
	};

	type SheetData = {
		name: string;
		rowCount: number;
		colCount: number;
		colHeaders: string[];
		rowHeaders: number[];
		rows: GridCell[][];
		uncachedFormulaCount: number;
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

	let workbook = $state<XLSX.WorkBook | null>(null);
	let sheetNames = $state<string[]>([]);
	let activeSheetIndex = $state(0);
	let activeSheetName = $derived(sheetNames[activeSheetIndex] ?? '');
	let currentSheetData = $state<SheetData | null>(null);

	let isLoading = $state(true);
	let loadError = $state<string | null>(null);

	// Grid selection state
	let selStart = $state<{ r: number; c: number } | null>(null);
	let selEnd = $state<{ r: number; c: number } | null>(null);
	let isSelectingCells = $state(false);

	let selectedRange = $derived.by(() => {
		if (!selStart) return null;
		const end = selEnd ?? selStart;
		const minR = Math.min(selStart.r, end.r);
		const maxR = Math.max(selStart.r, end.r);
		const minC = Math.min(selStart.c, end.c);
		const maxC = Math.max(selStart.c, end.c);
		const isSingle = minR === maxR && minC === maxC;
		const startAddr = XLSX.utils.encode_cell({ r: minR, c: minC });
		const endAddr = XLSX.utils.encode_cell({ r: maxR, c: maxC });
		const ref = isSingle ? startAddr : `${startAddr}:${endAddr}`;
		return { minR, maxR, minC, maxC, isSingle, ref };
	});

	// Active cell in formula bar
	let activeCell = $derived.by(() => {
		if (!currentSheetData || !selStart) return null;
		const row = currentSheetData.rows[selStart.r];
		if (!row) return null;
		return row[selStart.c] ?? null;
	});

	// Numeric stats for selected range
	let selectionStats = $derived.by(() => {
		if (!currentSheetData || !selectedRange || selectedRange.isSingle) return null;
		let count = 0;
		let numCount = 0;
		let sum = 0;
		for (let r = selectedRange.minR; r <= selectedRange.maxR; r++) {
			const row = currentSheetData.rows[r];
			if (!row) continue;
			for (let c = selectedRange.minC; c <= selectedRange.maxC; c++) {
				const cell = row[c];
				if (!cell || cell.hiddenByMerge) continue;
				count++;
				if (typeof cell.value === 'number') {
					numCount++;
					sum += cell.value;
				}
			}
		}
		if (count <= 1) return null;
		return {
			count,
			numCount,
			sum: numCount > 0 ? sum : null,
			avg: numCount > 0 ? (sum / numCount) : null
		};
	});

	// Annotations state
	let annotations = $state<ExcelAnnotation[]>([]);
	const storageKey = $derived(`reviewloop:live-excel:${data.token}`);

	let currentSheetAnnotations = $derived(
		annotations.filter((ann) => ann.sheetName === activeSheetName)
	);
	let currentSheetCellAnnotations = $derived(
		currentSheetAnnotations.filter((ann): ann is CellAnnotation => ann.type === 'cell')
	);
	let currentSheetPaintAnnotations = $derived(
		currentSheetAnnotations.filter((ann): ann is PaintAnnotation => ann.type === 'paint')
	);
	let totalAnnotationCount = $derived(annotations.length);

	// Cell annotations map for O(1) cell lookup
	let cellAnnotationsMap = $derived.by(() => {
		const map = new Map<string, CellAnnotation[]>();
		for (const ann of currentSheetCellAnnotations) {
			for (let r = ann.minR; r <= ann.maxR; r++) {
				for (let c = ann.minC; c <= ann.maxC; c++) {
					const addr = XLSX.utils.encode_cell({ r, c });
					const list = map.get(addr) ?? [];
					list.push(ann);
					map.set(addr, list);
				}
			}
		}
		return map;
	});

	// Brush mode & drawing
	let brushMode = $state(false);
	let brushColor = $state('#e54b4b');
	let brushSize = $state(6);
	let isDrawing = $state(false);
	let drawingPointerId: number | null = null;
	let currentStroke = $state<Stroke | null>(null);
	let draftStrokes = $state<Stroke[]>([]);

	// Modals & Popovers
	let showCellComposer = $state(false);
	let cellDraftBody = $state('');
	let showBrushComposer = $state(false);
	let brushDraftComment = $state('');

	let activeDetailAnnotation = $state<ExcelAnnotation | null>(null);
	let showListModal = $state(false);
	let filterCurrentSheetOnly = $state(false);

	// Zoom
	let zoom = $state(1);

	// Notice
	let notice = $state('');
	let noticeTimer: ReturnType<typeof setTimeout> | undefined;

	// DOM references
	let tableContainer = $state<HTMLDivElement | null>(null);
	let drawingCanvas = $state<HTMLCanvasElement | null>(null);

	let contentWidth = $state(1000);
	let contentHeight = $state(800);
	let gridTable = $state<HTMLTableElement | null>(null);

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

		loadWorkbook();

		window.addEventListener('resize', handleResize);
		window.addEventListener('pointerup', handleWindowPointerUp);

		return () => {
			window.removeEventListener('resize', handleResize);
			window.removeEventListener('pointerup', handleWindowPointerUp);
		};
	});

	async function loadWorkbook() {
		isLoading = true;
		loadError = null;
		try {
			const res = await fetch(data.src);
			if (!res.ok) throw new Error(`无法获取表格文件 (HTTP ${res.status})`);
			const buffer = await res.arrayBuffer();

			const wb = XLSX.read(buffer, {
				type: 'array',
				cellDates: true,
				cellStyles: true,
				cellFormula: true
			});

			if (!wb || !wb.SheetNames || wb.SheetNames.length === 0) {
				throw new Error('工作簿中未找到有效的工作表');
			}

			workbook = wb;
			sheetNames = wb.SheetNames;
			activeSheetIndex = 0;
			loadSheet(sheetNames[0]);
			isLoading = false;
		} catch (err: any) {
			console.error('Failed to load Excel workbook:', err);
			isLoading = false;
			loadError = err?.message || '无法解析该表格文件，可能格式不兼容或损坏';
		}
	}

	function loadSheet(sheetName: string) {
		if (!workbook) return;
		const ws = workbook.Sheets[sheetName];
		if (!ws) return;

		const ref = ws['!ref'] || 'A1:A1';
		const range = XLSX.utils.decode_range(ref);

		// Limit rows / cols for performance if monstrous
		const maxRow = Math.min(range.e.r, 800);
		const maxCol = Math.min(range.e.c, 60);

		// Build merges map
		const mergesMap = new Map<string, { isOrigin: boolean; rowspan: number; colspan: number }>();
		if (ws['!merges']) {
			for (const m of ws['!merges']) {
				const origin = XLSX.utils.encode_cell(m.s);
				const rowspan = m.e.r - m.s.r + 1;
				const colspan = m.e.c - m.s.c + 1;
				mergesMap.set(origin, { isOrigin: true, rowspan, colspan });
				for (let r = m.s.r; r <= m.e.r; r++) {
					for (let c = m.s.c; c <= m.e.c; c++) {
						if (r !== m.s.r || c !== m.s.c) {
							mergesMap.set(XLSX.utils.encode_cell({ r, c }), { isOrigin: false, rowspan: 0, colspan: 0 });
						}
					}
				}
			}
		}

		// Col headers
		const colHeaders: string[] = [];
		for (let c = range.s.c; c <= maxCol; c++) {
			colHeaders.push(XLSX.utils.encode_col(c));
		}

		// Row headers & cells
		const rowHeaders: number[] = [];
		const rows: GridCell[][] = [];

		for (let r = range.s.r; r <= maxRow; r++) {
			rowHeaders.push(r + 1);
			const rowCells: GridCell[] = [];
			for (let c = range.s.c; c <= maxCol; c++) {
				const addr = XLSX.utils.encode_cell({ r, c });
				const cell = ws[addr];
				const mergeInfo = mergesMap.get(addr);

				let formatted = '';
				let rawValue: any = '';
				let cellType = 's';
				let formula: string | undefined;
				let uncachedFormula = false;

				if (cell) {
					cellType = cell.t || 's';
					if (cell.f) {
						formula = `=${cell.f}`;
					}

					// 'z' is SheetJS's blank/stub type. A formula cell whose result
					// was never cached in the file arrives as {t:'z', f:'SUM(..)',
					// v:0} -- that 0 is synthesised, not the formula's value. We do
					// not evaluate formulas, so rendering it would show a reviewer a
					// number the spreadsheet never contained. Leave the cell empty
					// and flag it instead.
					const isBlankStub = cellType === 'z';
					uncachedFormula = Boolean(formula) && isBlankStub;

					if (!isBlankStub) {
						rawValue = cell.v ?? '';
						if (cell.w !== undefined) {
							formatted = cell.w;
						} else if (cell.v instanceof Date) {
							formatted = cell.v.toLocaleDateString();
						} else if (cell.v !== undefined && cell.v !== null) {
							formatted = String(cell.v);
						}
					}
				}

				rowCells.push({
					r,
					c,
					addr,
					value: rawValue,
					formatted,
					formula,
					uncachedFormula,
					type: cellType,
					rowspan: mergeInfo?.isOrigin ? mergeInfo.rowspan : 1,
					colspan: mergeInfo?.isOrigin ? mergeInfo.colspan : 1,
					hiddenByMerge: mergeInfo ? !mergeInfo.isOrigin : false
				});
			}
			rows.push(rowCells);
		}

		currentSheetData = {
			name: sheetName,
			rowCount: maxRow - range.s.r + 1,
			colCount: maxCol - range.s.c + 1,
			colHeaders,
			rowHeaders,
			rows,
			uncachedFormulaCount: rows.reduce(
				(n, row) => n + row.filter((cell) => cell.uncachedFormula).length,
				0
			)
		};

		// Reset selection
		selStart = { r: 0, c: 0 };
		selEnd = { r: 0, c: 0 };

		tick().then(() => {
			syncCanvasDimensions();
		});
	}

	function switchSheet(name: string) {
		const idx = sheetNames.indexOf(name);
		if (idx === -1) return false;
		if (idx !== activeSheetIndex) {
			if (draftStrokes.length && !confirm('画笔草稿尚未保存，切换工作表将丢弃，是否继续？')) return false;
			clearDraftStrokes();
			activeSheetIndex = idx;
			loadSheet(name);
			if (brushMode) {
				draftStrokes = [];
				redrawDraftCanvas();
			}
		}
		return true;
	}

	function handleResize() {
		syncCanvasDimensions();
	}

	// Re-measure whenever the rendered sheet or the zoom changes, so the canvas
	// and the saved-annotation SVG keep matching the grid they sit on top of.
	$effect(() => {
		if (!gridTable || !currentSheetData) return;
		void zoom;
		syncCanvasDimensions();
	});

	function syncCanvasDimensions() {
		// Measure the grid table itself. The two obvious alternatives are both
		// wrong: tableContainer is the scroll viewport (a different box, which
		// left the canvas overflowing the content by hundreds of px), and
		// .sheet-content-wrapper also contains the saved-annotation SVG that is
		// itself sized from contentHeight -- measuring it is circular, so the
		// value latches at its initial guess and can never shrink.
		if (!gridTable) return;
		const w = gridTable.offsetWidth;
		const h = gridTable.offsetHeight;
		if (w === 0 || h === 0) return;
		contentWidth = w;
		contentHeight = h;

		if (drawingCanvas) {
			drawingCanvas.width = contentWidth;
			drawingCanvas.height = contentHeight;
			// Pin the CSS box too. .sheet-content-wrapper stretches to fill the
			// scroll viewport, so the width:100% fallback would otherwise leave
			// the canvas wider than the grid it is meant to overlay.
			drawingCanvas.style.width = `${contentWidth}px`;
			drawingCanvas.style.height = `${contentHeight}px`;
			redrawDraftCanvas();
		}
	}

	function showNotice(msg: string) {
		notice = msg;
		clearTimeout(noticeTimer);
		noticeTimer = setTimeout(() => {
			notice = '';
		}, 2600);
	}

	function persistAnnotations(next: ExcelAnnotation[]) {
		annotations = next;
		try {
			localStorage.setItem(storageKey, JSON.stringify(next));
		} catch (err) {
			console.warn('Failed to save Excel annotations to localStorage:', err);
		}
	}

	function deleteAnnotation(id: string) {
		const next = annotations.filter((ann) => ann.id !== id);
		persistAnnotations(next);
		if (activeDetailAnnotation?.id === id) activeDetailAnnotation = null;
		showNotice('已删除批注');
		redrawDraftCanvas();
	}

	// Cell selection handlers
	function handleCellPointerDown(r: number, c: number, e: PointerEvent) {
		if (brushMode || e.button !== 0) return;
		isSelectingCells = true;
		selStart = { r, c };
		selEnd = { r, c };
	}

	function handleCellPointerEnter(r: number, c: number) {
		if (brushMode || !isSelectingCells) return;
		selEnd = { r, c };
	}

	function handleWindowPointerUp() {
		if (isSelectingCells) {
			isSelectingCells = false;
		}
	}

	function isCellSelected(r: number, c: number): boolean {
		if (!selectedRange) return false;
		return (
			r >= selectedRange.minR &&
			r <= selectedRange.maxR &&
			c >= selectedRange.minC &&
			c <= selectedRange.maxC
		);
	}

	function isCellActive(r: number, c: number): boolean {
		if (!selStart) return false;
		return selStart.r === r && selStart.c === c;
	}

	// Cell comment composer
	function openCellComposer() {
		if (!selectedRange || !activeCell) return;
		cellDraftBody = '';
		showCellComposer = true;

	}

	function saveCellAnnotation() {
		if (!cellDraftBody.trim() || !selectedRange || !activeCell) return;

		// An uncached formula cell has no value to quote; record the formula so
		// the comment still carries what the reviewer was looking at.
		const cellValueStr = activeCell.uncachedFormula
			? `${activeCell.formula} (未缓存结果)`
			: activeCell.formatted || String(activeCell.value || '');
		const newAnn: CellAnnotation = {
			id: `cell-ann-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
			type: 'cell',
			sheetName: activeSheetName,
			cellRef: selectedRange.ref,
			minR: selectedRange.minR,
			maxR: selectedRange.maxR,
			minC: selectedRange.minC,
			maxC: selectedRange.maxC,
			cellValue: cellValueStr,
			body: cellDraftBody.trim(),
			createdAt: new Date().toISOString()
		};

		const next = [...annotations, newAnn];
		persistAnnotations(next);
		showCellComposer = false;
		cellDraftBody = '';
		activeDetailAnnotation = null;
		brushMode = false;
		showNotice(`已保存单元格 [${newAnn.cellRef}] 批注`);
	}

	// Brush Drawing Logic
	function toggleBrushMode() {
		brushMode = !brushMode;
		if (brushMode) {
			syncCanvasDimensions();

		} else {
			isDrawing = false;
			drawingPointerId = null;
			currentStroke = null;
			redrawDraftCanvas();

		}
	}

	function getPointerPos(e: PointerEvent): Point | null {
		if (!drawingCanvas) return null;
		const rect = drawingCanvas.getBoundingClientRect();
		const x = (e.clientX - rect.left) * drawingCanvas.width / rect.width;
		const y = (e.clientY - rect.top) * drawingCanvas.height / rect.height;
		return { x, y };
	}

	function handleCanvasPointerDown(e: PointerEvent) {
		if (!brushMode || e.button !== 0 || !e.isPrimary || !drawingCanvas || isDrawing) return;
		e.preventDefault();
		drawingPointerId = e.pointerId;
		const pt = getPointerPos(e);
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

	function handleCanvasPointerMove(e: PointerEvent) {
		if (!isDrawing || !currentStroke || !drawingCanvas || e.pointerId !== drawingPointerId) return;
		e.preventDefault();
		const pt = getPointerPos(e);
		if (!pt) return;
		currentStroke.points.push(pt);
		drawLatestStrokeSegment();
	}

	function handleCanvasPointerUp(e: PointerEvent) {
		if (!isDrawing || e.pointerId !== drawingPointerId) return;
		isDrawing = false;
		drawingPointerId = null;
		if (drawingCanvas?.hasPointerCapture(e.pointerId)) drawingCanvas.releasePointerCapture(e.pointerId);
		if (currentStroke && currentStroke.points.length > 0) {
			draftStrokes = [...draftStrokes, currentStroke];
			currentStroke = null;
			redrawDraftCanvas();
		}
	}

	function handleCanvasPointerCancel(e: PointerEvent) {
		if (e.pointerId !== drawingPointerId) return;
		isDrawing = false;
		drawingPointerId = null;
		currentStroke = null;
		redrawDraftCanvas();
	}

	function drawLatestStrokeSegment() {
		if (!drawingCanvas || !currentStroke || currentStroke.points.length < 2) return;
		const ctx = drawingCanvas.getContext('2d');
		if (!ctx) return;

		const pts = currentStroke.points;
		const p0 = pts[pts.length - 2];
		const p1 = pts[pts.length - 1];

		ctx.save();
		ctx.strokeStyle = currentStroke.color;
		ctx.lineWidth = currentStroke.size;
		ctx.lineCap = 'round';
		ctx.lineJoin = 'round';
		ctx.beginPath();
		ctx.moveTo(p0.x, p0.y);
		ctx.lineTo(p1.x, p1.y);
		ctx.stroke();
		ctx.restore();
	}

	function redrawDraftCanvas() {
		if (!drawingCanvas) return;
		const ctx = drawingCanvas.getContext('2d');
		if (!ctx) return;

		ctx.clearRect(0, 0, drawingCanvas.width, drawingCanvas.height);

		// Draw draft strokes
		for (const stroke of draftStrokes) {
			if (!stroke.points || stroke.points.length === 0) continue;
			ctx.save();
			ctx.strokeStyle = stroke.color;
			ctx.lineWidth = stroke.size;
			ctx.lineCap = 'round';
			ctx.lineJoin = 'round';
			ctx.beginPath();
			ctx.moveTo(stroke.points[0].x, stroke.points[0].y);
			for (let i = 1; i < stroke.points.length; i++) {
				ctx.lineTo(stroke.points[i].x, stroke.points[i].y);
			}
			ctx.stroke();
			ctx.restore();
		}

		// Draw currently active stroke
		if (currentStroke && currentStroke.points.length > 0) {
			ctx.save();
			ctx.strokeStyle = currentStroke.color;
			ctx.lineWidth = currentStroke.size;
			ctx.lineCap = 'round';
			ctx.lineJoin = 'round';
			ctx.beginPath();
			ctx.moveTo(currentStroke.points[0].x, currentStroke.points[0].y);
			for (let i = 1; i < currentStroke.points.length; i++) {
				ctx.lineTo(currentStroke.points[i].x, currentStroke.points[i].y);
			}
			ctx.stroke();
			ctx.restore();
		}
	}

	function undoLastDraftStroke() {
		if (draftStrokes.length === 0) return;
		draftStrokes = draftStrokes.slice(0, -1);
		redrawDraftCanvas();
	}

	function clearDraftStrokes() {
		showBrushComposer=false;
		brushDraftComment='';
		currentStroke=null;
		isDrawing=false;
		draftStrokes = [];
		redrawDraftCanvas();
	}

	function openBrushComposer() {
		if (draftStrokes.length === 0) return;
		showBrushComposer = true;

	}

	function saveBrushAnnotation() {
		if (draftStrokes.length === 0) return;

		// Determine badge position (first point of first stroke)
		const firstPt = draftStrokes[0].points[0] ?? { x: 50, y: 50 };

		const newAnn: PaintAnnotation = {
			id: `paint-ann-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
			type: 'paint',
			sheetName: activeSheetName,
			badgePosition: { x: Math.round(firstPt.x), y: Math.round(firstPt.y) },
			strokes: [...draftStrokes],
			body: brushDraftComment.trim(),
			createdAt: new Date().toISOString()
		};

		const next = [...annotations, newAnn];
		persistAnnotations(next);
		draftStrokes = [];
		showBrushComposer = false;
		brushDraftComment = '';
		redrawDraftCanvas();
		activeDetailAnnotation = null;
		brushMode = false;
		showNotice('已保存画笔标注');
	}

	function strokeToSvgPath(stroke: Stroke): string {
		if (!stroke.points || stroke.points.length === 0) return '';
		const pts = stroke.points;
		if (pts.length === 1) {
			return `M ${pts[0].x} ${pts[0].y} L ${pts[0].x + 0.1} ${pts[0].y + 0.1}`;
		}
		let path = `M ${pts[0].x} ${pts[0].y}`;
		for (let i = 1; i < pts.length; i++) {
			const p0 = pts[i - 1];
			const p1 = pts[i];
			const midX = (p0.x + p1.x) / 2;
			const midY = (p0.y + p1.y) / 2;
			path += ` Q ${p0.x} ${p0.y} ${midX} ${midY}`;
		}
		const last = pts[pts.length - 1];
		path += ` L ${last.x} ${last.y}`;
		return path;
	}

	// Zoom Controls
	function zoomIn() {
		zoom = Math.min(2.0, +(zoom + 0.1).toFixed(1));
		tick().then(syncCanvasDimensions);
	}

	function zoomOut() {
		zoom = Math.max(0.6, +(zoom - 0.1).toFixed(1));
		tick().then(syncCanvasDimensions);
	}

	function zoomReset() {
		zoom = 1;
		tick().then(syncCanvasDimensions);
	}

	// Jump to annotation location
	function jumpToAnnotation(ann: ExcelAnnotation) {
		if (ann.sheetName !== activeSheetName && !switchSheet(ann.sheetName)) return;
		showListModal = false;

		activeDetailAnnotation = ann;

		tick().then(() => {
			if (ann.type === 'cell') {
				selStart = { r: ann.minR, c: ann.minC };
				selEnd = { r: ann.maxR, c: ann.maxC };
				const el = document.getElementById(`cell-${ann.sheetName}-${ann.minR}-${ann.minC}`);
				el?.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
			} else {
				if (tableContainer) {
					tableContainer.scrollTo({
						left: Math.max(0, ann.badgePosition.x - 200),
						top: Math.max(0, ann.badgePosition.y - 200),
						behavior: 'smooth'
					});
				}
			}
		});
	}

	// Export annotations & active sheet CSV
	async function exportAnnotationsJson() {
		const json = JSON.stringify(annotations, null, 2);
		if (navigator.clipboard?.writeText) {
			await navigator.clipboard.writeText(json);
			showNotice('全部批注 JSON 已复制到剪贴板');
			return;
		}
		const blob = new Blob([json], { type: 'application/json' });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = `${data.filename}.annotations.json`;
		a.click();
		URL.revokeObjectURL(url);
		showNotice('已下载批注 JSON 文件');
	}

	function exportActiveSheetCsv() {
		if (!workbook || !activeSheetName) return;
		const ws = workbook.Sheets[activeSheetName];
		if (!ws) return;
		const csv = XLSX.utils.sheet_to_csv(ws);
		const blob = new Blob([new Uint8Array([0xef, 0xbb, 0xbf]), csv], { type: 'text/csv;charset=utf-8' });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = `${activeSheetName}.csv`;
		a.click();
		URL.revokeObjectURL(url);
		showNotice(`已导出 ${activeSheetName}.csv`);
	}
</script>

<svelte:head>
	<title>{data.filename} · Live Excel Review</title>
	<meta name="robots" content="noindex,nofollow" />
</svelte:head>

<div class="excel-review-container live-review" class:review-comments-open={showListModal} class:review-painting={brushMode} use:reviewViewport>
	<!-- Top Navigation Header -->
	<ReviewHeader filename={data.filename} actions={[{ label: '导出当前工作表 CSV', run: exportActiveSheetCsv }, { label: '导出批注 JSON', run: exportAnnotationsJson }, { label: '放大', run: zoomIn }, { label: '缩小', run: zoomOut }, { label: '重置缩放', run: zoomReset }]} hasDraft={draftStrokes.length > 0} ondiscard={clearDraftStrokes}>
<div class="sheet-tabs" role="tablist" aria-label="工作表标签">
			{#each sheetNames as name, idx}
				{@const annCount = annotations.filter((a) => a.sheetName === name).length}
				<button
					type="button"
					role="tab"
					aria-selected={activeSheetIndex === idx}
					class="sheet-tab"
					class:active={activeSheetIndex === idx}
					onclick={() => switchSheet(name)}
				>
					<span class="sheet-name">{name}</span>
					{#if annCount > 0}
						<span class="tab-ann-dot" title="{annCount} 条批注">{annCount}</span>
					{/if}
				</button>
			{/each}
		</div>

</ReviewHeader>

	<!-- Formula Bar & Status Strip -->
	<div class="formula-bar">
		<div class="cell-addr-box">
			{selectedRange ? selectedRange.ref : (currentSheetData?.colHeaders[0] ? `${currentSheetData.colHeaders[0]}1` : '')}
		</div>
		<div class="formula-fx-label">fx</div>
		<div class="formula-input" title="单元格公式或取值">
			{#if activeCell}
				{#if activeCell.formula}
					<span class="formula-val">{activeCell.formula}</span>
					{#if activeCell.uncachedFormula}
						<span class="uncached-note">源文件未保存该公式的计算结果</span>
					{/if}
				{:else}
					<span class="cell-val">{activeCell.formatted}</span>
				{/if}
			{:else}
				<span class="empty-hint">点击表格单元格以查看或添加批注</span>
			{/if}
		</div>

		{#if selectionStats}
			<div class="stats-strip">
				<span>计数: <b>{selectionStats.count}</b></span>
				{#if selectionStats.sum !== null}
					<span>求和: <b>{selectionStats.sum.toLocaleString()}</b></span>
					<span>平均: <b>{selectionStats.avg?.toFixed(2)}</b></span>
				{/if}
			</div>
		{/if}

		<button
			type="button"
			class="add-cell-comment-btn"
			disabled={!selectedRange}
			onclick={openCellComposer}
		>
			批注区域
		</button>
	</div>

	{#if currentSheetData && currentSheetData.uncachedFormulaCount > 0}
		<div class="uncached-banner" role="status">
			<span class="uncached-banner-icon">ƒ</span>
			本表有 <b>{currentSheetData.uncachedFormulaCount}</b> 个公式单元格未显示数值：源文件没有保存公式的计算结果。这些单元格标为
			<span class="uncached-formula-inline">ƒ</span>，选中可在公式栏查看公式本身。
		</div>
	{/if}

	<!-- Main Workspace Area -->
	<main class="excel-stage">
		{#if isLoading}
			<div class="loading-state">
				<div class="spinner"></div>
				<p>正在解析 Excel 电子表格…</p>
			</div>
		{:else if loadError}
			<div class="error-state">
				<div class="error-icon">⚠️</div>
				<p>{loadError}</p>
				<button type="button" onclick={loadWorkbook}>重新加载</button>
			</div>
		{:else if currentSheetData}
			<div
				use:twoFingerPan={{ enabled: brushMode, zoom, min: 0.6, max: 2, onzoom: (value) => zoom=value, oncancel: () => { isDrawing=false; currentStroke=null; redrawDraftCanvas(); } }} class="table-scroll-container"
				class:brush-active={brushMode}
				bind:this={tableContainer}
			>
				<div
					class="sheet-content-wrapper"
					style:zoom="{zoom}"
				>
					<!-- The Spreadsheet Grid Table -->
					<table class="excel-table" bind:this={gridTable}>
						<thead>
							<tr>
								<th class="corner-header"></th>
								{#each currentSheetData.colHeaders as col}
									<th class="col-header">{col}</th>
								{/each}
							</tr>
						</thead>
						<tbody>
							{#each currentSheetData.rows as row, rIdx}
								<tr>
									<th class="row-header">{currentSheetData.rowHeaders[rIdx]}</th>
									{#each row as cell, cIdx}
										{#if !cell.hiddenByMerge}
											{@const hasComments = cellAnnotationsMap.has(cell.addr)}
											<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
											<td
												id="cell-{currentSheetData.name}-{rIdx}-{cIdx}"
												rowspan={cell.rowspan}
												colspan={cell.colspan}
												class="grid-cell"
												class:cell-selected={isCellSelected(rIdx, cIdx)}
												class:cell-active={isCellActive(rIdx, cIdx)}
												class:has-comment={hasComments}
												class:type-number={cell.type === 'n'}
												class:type-boolean={cell.type === 'b'}
												onpointerdown={(e) => handleCellPointerDown(rIdx, cIdx, e)}
												onpointerenter={() => handleCellPointerEnter(rIdx, cIdx)}
												onclick={() => {
													if (hasComments) {
														const anns = cellAnnotationsMap.get(cell.addr);
														if (anns && anns.length > 0) {
															activeDetailAnnotation = anns[0];
														}
													}
												}}
											>
												{#if hasComments}
													<span class="comment-marker-triangle" title="该单元格有批注"></span>
												{/if}
												{#if cell.uncachedFormula}
													<span
														class="uncached-formula"
														title="该单元格是公式 {cell.formula}，但源文件未保存计算结果，此处不显示数值以免误导"
														>ƒ</span
													>
												{:else}
													<span class="cell-text">{cell.formatted}</span>
												{/if}
											</td>
										{/if}
									{/each}
								</tr>
							{/each}
						</tbody>
					</table>

					<!-- Saved Paint Annotations SVG Layer -->
					<svg
						class="saved-svg-layer"
						style:width="{contentWidth}px"
						style:height="{contentHeight}px"
					>
						{#each currentSheetPaintAnnotations as ann, idx}
							<g class="paint-annotation-group" class:active={activeDetailAnnotation?.id === ann.id}>
								{#each ann.strokes as stroke}
									<path
										d={strokeToSvgPath(stroke)}
										stroke={stroke.color}
										stroke-width={stroke.size}
										stroke-linecap="round"
										stroke-linejoin="round"
										fill="none"
									/>
								{/each}

								<!-- Annotation Pin Badge -->
								<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
								<g
									class="badge-marker"
									role="button"
									tabindex="0"
									transform="translate({ann.badgePosition.x}, {ann.badgePosition.y})"
									aria-label={`查看批注 ${idx + 1}`}
									onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); activeDetailAnnotation=ann; } }}
									onclick={() => (activeDetailAnnotation = ann)}
								>
									<circle r="14" fill="#ef4444" stroke="#ffffff" stroke-width="2" />
									<text
										y="4.5"
										text-anchor="middle"
										fill="#ffffff"
										font-size="11"
										font-weight="bold"
									>
										{idx + 1}
									</text>
								</g>
							</g>
						{/each}
					</svg>

					<!-- Paintbrush Active Drawing Canvas Layer -->
					<canvas
						bind:this={drawingCanvas}
						class="drawing-canvas-layer"
						class:active={brushMode}
						onpointerdown={handleCanvasPointerDown}
						onpointermove={handleCanvasPointerMove}
						onpointerup={handleCanvasPointerUp}
						onpointercancel={handleCanvasPointerCancel}
						onlostpointercapture={handleCanvasPointerCancel}
					></canvas>
				</div>
			</div>
		{/if}
	</main>
 <ReviewToolbar paint={brushMode} bind:color={brushColor} bind:size={brushSize} colors={BRUSH_COLORS} sizes={BRUSH_SIZES} count={totalAnnotationCount} draftCount={draftStrokes.length} comments={showListModal} disabled={isLoading}
  onbrowse={() => { if (brushMode) toggleBrushMode(); showListModal=false; }} onpaint={() => { if (!brushMode) toggleBrushMode(); showListModal=false; activeDetailAnnotation=null; }}
  oncomments={() => { showListModal = !showListModal; }} onfinish={() => { showBrushComposer=true; }} onundo={undoLastDraftStroke} />

	<!-- Notice Toast -->
	{#if notice}
		<div class="notice-toast" role="status">
			{notice}
		</div>
	{/if}

{#if showCellComposer && selectedRange && activeCell}
 <ReviewComposer brush={false} context={`${activeSheetName} · ${selectedRange.ref}`} quote={activeCell.formula || activeCell.formatted} bind:body={cellDraftBody} onclose={() => showCellComposer=false} onsave={saveCellAnnotation} />
 {/if}

 {#if draftStrokes.length > 0 && showBrushComposer}
  <ReviewComposer context={`${activeSheetName} · ${draftStrokes.length} 条笔画`} bind:body={brushDraftComment} onclose={() => showBrushComposer=false} onsave={saveBrushAnnotation} />
 {/if}
	<!-- Annotation Detail Popover / Card -->
	{#if activeDetailAnnotation}
  {@const detail = activeDetailAnnotation}
  <ReviewDetail anchor={`${detail.sheetName} · ${detail.type === 'cell' ? detail.cellRef : '画笔标注'}`} body={detail.body} createdAt={detail.createdAt} quote={detail.type === 'cell' ? detail.cellValue : ''} onclose={() => activeDetailAnnotation=null} ondelete={() => deleteAnnotation(detail.id)} onall={() => { activeDetailAnnotation=null; showListModal=true; }} />
 {/if}

	<!-- All Annotations Drawer -->
 {#if showListModal}
 <ReviewComments entries={(filterCurrentSheetOnly ? currentSheetAnnotations : annotations).map(a => ({ id:a.id, anchor: `${a.sheetName} · ${a.type==='cell' ? a.cellRef : '画笔标注'}`, body:a.body, createdAt:a.createdAt, quote:a.type==='cell' ? a.cellValue : undefined }))} onclose={() => showListModal=false} ondelete={deleteAnnotation} onlocate={(id) => { const a=annotations.find(a=>a.id===id); if(a) jumpToAnnotation(a); }}><label><input type="checkbox" bind:checked={filterCurrentSheetOnly} />仅当前工作表</label></ReviewComments>
 {/if}

</div>

<style>
	:global(*) { box-sizing: border-box; }
	:global(body) { margin: 0; background: #f8fafc; color: #1e293b; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; }

	.excel-review-container {
		display: flex;
		flex-direction: column;
		height: 100vh;
		height: 100dvh;
		overflow: hidden;
		background: #f1f5f9;
	}

	/* Top Header */

	/* Floating Brush Toolbar */

	/* Formula Bar */
	.formula-bar {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 6px 16px;
		background: #ffffff;
		border-bottom: 1px solid #e2e8f0;
		font-size: 13px;
		z-index: 10;
	}

	.cell-addr-box {
		font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
		font-weight: 700;
		color: #1e293b;
		background: #f1f5f9;
		padding: 4px 10px;
		border-radius: 6px;
		border: 1px solid #cbd5e1;
		min-width: 64px;
		text-align: center;
	}

	.formula-fx-label {
		font-style: italic;
		font-weight: 700;
		color: #64748b;
		font-family: serif;
		font-size: 15px;
	}

	.formula-input {
		flex: 1;
		padding: 4px 10px;
		background: #f8fafc;
		border: 1px solid #e2e8f0;
		border-radius: 6px;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		color: #0f172a;
	}

	.formula-val {
		font-family: ui-monospace, monospace;
		color: #2563eb;
		font-weight: 600;
	}

	.empty-hint {
		color: #94a3b8;
	}

	.stats-strip {
		display: flex;
		gap: 12px;
		font-size: 12px;
		color: #475569;
		background: #f1f5f9;
		padding: 4px 10px;
		border-radius: 6px;
		white-space: nowrap;
	}

	.add-cell-comment-btn {
		border: 1px solid #2563eb;
		background: #eff6ff;
		color: #2563eb;
		font-size: 12px;
		font-weight: 700;
		padding: 5px 12px;
		border-radius: 6px;
		cursor: pointer;
		white-space: nowrap;
		transition: all 0.15s;
	}

	.add-cell-comment-btn:hover:not(:disabled) {
		background: #2563eb;
		color: #ffffff;
	}

	.add-cell-comment-btn:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}

	/* Main Stage */
	.excel-stage {
		flex: 1;
		position: relative;
		overflow: hidden;
		background: #cbd5e1;
	}

	.loading-state, .error-state {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		height: 100%;
		gap: 12px;
		color: #64748b;
	}

	.spinner {
		width: 36px;
		height: 36px;
		border: 3px solid #cbd5e1;
		border-top-color: #2563eb;
		border-radius: 50%;
		animation: spin 0.8s linear infinite;
	}

	@keyframes spin {
		to { transform: rotate(360deg); }
	}

	.error-icon {
		font-size: 36px;
	}

	/* Table container with scrollbars */
	.table-scroll-container {
		width: 100%;
		height: 100%;
		overflow: auto;
		position: relative;
		background: #ffffff;
	}

	.sheet-content-wrapper {
		position: relative;
		min-width: max-content;
		min-height: max-content;
		transform-origin: top left;
	}

	/* Spreadsheet Grid Table */
	.excel-table {
		border-collapse: collapse;
		table-layout: fixed;
		user-select: none;
		background: #ffffff;
	}

	.corner-header {
		position: sticky;
		top: 0;
		left: 0;
		z-index: 15;
		width: 48px;
		min-width: 48px;
		height: 26px;
		background: #f1f5f9;
		border: 1px solid #cbd5e1;
	}

	.col-header {
		position: sticky;
		top: 0;
		z-index: 10;
		height: 26px;
		min-width: 90px;
		max-width: 240px;
		background: #f8fafc;
		border: 1px solid #cbd5e1;
		color: #475569;
		font-size: 11px;
		font-weight: 700;
		text-align: center;
		line-height: 26px;
	}

	.row-header {
		position: sticky;
		left: 0;
		z-index: 10;
		width: 48px;
		min-width: 48px;
		background: #f8fafc;
		border: 1px solid #cbd5e1;
		color: #475569;
		font-size: 11px;
		font-weight: 700;
		text-align: center;
		vertical-align: middle;
	}

	.grid-cell {
		position: relative;
		height: 24px;
		min-width: 90px;
		max-width: 280px;
		padding: 3px 8px;
		border: 1px solid #e2e8f0;
		color: #1e293b;
		font-size: 12px;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		vertical-align: middle;
		cursor: cell;
	}

	.grid-cell.type-number {
		text-align: right;
		font-variant-numeric: tabular-nums;
	}

	.grid-cell.type-boolean {
		text-align: center;
		font-weight: 600;
	}

	.grid-cell.cell-selected {
		background: rgba(37, 99, 235, 0.12);
	}

	.grid-cell.cell-active {
		outline: 2px solid #2563eb;
		outline-offset: -2px;
		z-index: 2;
	}

	/* Classic Excel Red Comment Marker */
	.comment-marker-triangle {
		position: absolute;
		top: 0;
		right: 0;
		width: 0;
		height: 0;
		border-top: 7px solid #ef4444;
		border-left: 7px solid transparent;
		z-index: 4;
		cursor: pointer;
	}

	.grid-cell.has-comment {
		box-shadow: inset 0 0 0 1px rgba(239, 68, 68, 0.2);
	}

	/* Saved Paint Annotations SVG Layer */
	.saved-svg-layer {
		position: absolute;
		top: 0;
		left: 0;
		pointer-events: none;
		z-index: 16;
	}

	.badge-marker {
		cursor: pointer;
		pointer-events: auto;
		filter: drop-shadow(0 2px 4px rgba(0, 0, 0, 0.25));
		transition: filter 0.1s;
	}

	.badge-marker:hover {
		filter: drop-shadow(0 2px 5px rgba(37, 99, 235, 0.5));
	}

	/* Drawing Canvas Layer */
	/* Uncached formula cells: no value exists in the file, so show a marker
	   rather than a number the spreadsheet never contained. */
	.uncached-formula {
		font-family: 'Cambria Math', 'Times New Roman', Georgia, serif;
		font-style: italic;
		font-size: 13px;
		color: #b45309;
		opacity: 0.75;
		cursor: help;
	}

	.uncached-banner {
		display: flex;
		align-items: baseline;
		gap: 8px;
		padding: 8px 14px;
		background: #fffbeb;
		border-bottom: 1px solid #fde68a;
		color: #78350f;
		font-size: 12.5px;
		line-height: 1.5;
	}

	.uncached-banner b {
		font-weight: 700;
	}

	.uncached-banner-icon,
	.uncached-formula-inline {
		font-family: 'Cambria Math', 'Times New Roman', Georgia, serif;
		font-style: italic;
		color: #b45309;
		font-size: 14px;
	}

	.uncached-note {
		margin-left: 10px;
		font-size: 11.5px;
		color: #b45309;
		white-space: nowrap;
	}

	.drawing-canvas-layer {
		position: absolute;
		top: 0;
		left: 0;
		/* Fallback so the canvas never falls back to its intrinsic 300x150
		   before the JS sizing pass runs; syncCanvasDimensions() overrides. */
		width: 100%;
		height: 100%;
		pointer-events: none;
		z-index: 17;
		cursor: crosshair;
	}

	.table-scroll-container.brush-active {
		touch-action: none;
		overscroll-behavior: none;
	}

	.drawing-canvas-layer.active {
		touch-action: none;
		user-select: none;
		-webkit-user-select: none;
		pointer-events: auto;
	}

	/* Footer & Sheet Tabs */

	.sheet-tabs {
		display: flex;
		align-items: center;
		gap: 4px;
		overflow-x: auto;
	}

	.sheet-tab {
		display: flex;
		align-items: center;
		gap: 6px;
		border: 1px solid transparent;
		background: #f1f5f9;
		color: #475569;
		padding: 6px 14px;
		border-radius: 6px 6px 0 0;
		font-size: 12px;
		font-weight: 600;
		cursor: pointer;
		white-space: nowrap;
		transition: all 0.15s;
	}

	.sheet-tab:hover {
		background: #e2e8f0;
		color: #0f172a;
	}

	.sheet-tab.active {
		background: #ffffff;
		color: #2563eb;
		border-color: #cbd5e1 #cbd5e1 transparent #cbd5e1;
		box-shadow: 0 -2px 0 0 #2563eb inset;
		font-weight: 700;
	}

	.tab-ann-dot {
		background: #ef4444;
		color: #ffffff;
		font-size: 10px;
		font-weight: 700;
		border-radius: 999px;
		padding: 0 5px;
		height: 16px;
		display: inline-flex;
		align-items: center;
		justify-content: center;
	}

	/* Toast */
	.notice-toast {
		position: fixed;
		bottom: 50px;
		left: 50%;
		transform: translateX(-50%);
		z-index: 100;
		background: #1e293b;
		color: #ffffff;
		padding: 8px 16px;
		border-radius: 999px;
		font-size: 13px;
		font-weight: 600;
		box-shadow: 0 6px 20px rgba(0, 0, 0, 0.2);
	}

	/* Modals & Backdrop */

	/* Detail Card Modal */

	/* Drawer Panel */

	/* Mobile responsive adjustments */
	@media (max-width: 768px) {
		/* Let the header grow into rows instead of crushing its controls. */

		.stats-strip {
			display: none;
		}

	}
</style>
