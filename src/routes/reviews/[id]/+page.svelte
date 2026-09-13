<script lang="ts">
	import { tick } from 'svelte';
	import ReviewHero from '$lib/components/review/ReviewHero.svelte';
	import { getFileBadges, summarizeCommitMessage } from '$lib/review/commitUi';

	let { data } = $props();

	type ReviewFile = {
		id?: string;
		path: string;
		oldPath?: string;
		additions: number;
		deletions: number;
		status: 'added' | 'deleted' | 'modified' | 'renamed';
		patchBytes?: number;
		lineCount?: number;
		tooLarge?: boolean;
		generatedLike?: boolean;
	};

	type ReviewCommit = {
		id: string;
		sha: string;
		shortSha: string;
		authorName: string;
		authorDate: string;
		subject: string;
		message?: string;
		files: ReviewFile[];
		additions: number;
		deletions: number;
		patchBytes: number;
		lineCount: number;
	};

	type ReviewComment = {
		id: string;
		reviewId: string;
		version: number;
		filePath: string | null;
		side: 'old' | 'new' | 'file';
		lineStart: number | null;
		lineEnd: number | null;
		body: string;
		author: string;
		status: 'open' | 'resolved';
		createdAt: string;
		updatedAt: string;
	};

	type DiffRow = {
		index: number;
		text: string;
		kind: 'added' | 'deleted' | 'header' | 'context';
		oldLine: number | null;
		newLine: number | null;
		side: 'old' | 'new' | null;
		lineNumber: number | null;
		hunkHeader: string | null;
		commentable: boolean;
		hunkIndex: number | null;
	};

	type CommentAnchor = {
		side: 'old' | 'new';
		lineStart: number;
		lineEnd: number;
		insertAfterIndex: number;
		label: string;
	};

	type DiffDisplayItem =
		| { type: 'diff'; key: string; row: DiffRow }
		| { type: 'comment'; key: string; row: DiffRow; comment: ReviewComment }
		| { type: 'composer'; key: string; anchor: CommentAnchor };

	const latestVersion = $derived(data.latestVersion!);
	const commits = $derived((data.commits ?? []) as ReviewCommit[]);
	let selectedCommitId = $state('all');
	let commitsCollapsed = $state(false);
	let search = $state('');
	let filter = $state<'important' | 'code' | 'tests' | 'generated' | 'large' | 'all'>('important');
	const filterOptions = ['important', 'code', 'tests', 'generated', 'large', 'all'] as const;
	let selectedFile = $state<ReviewFile | null>(null);
	let loadedDiffs = $state<Record<string, string>>({});
	let loadingFileId = $state<string | null>(null);
	let loadError = $state<string | null>(null);
	let forceLarge = $state<Record<string, boolean>>({});
	let reviewed = $state<Record<string, boolean>>({});
	let comments = $state<ReviewComment[]>([]);
	let commentAuthor = $state('reviewer');
	let activeDraftAnchor = $state<CommentAnchor | null>(null);
	let dragStartAnchor = $state<CommentAnchor | null>(null);
	let dragCurrentAnchor = $state<CommentAnchor | null>(null);
	let dragPointerId = $state<number | null>(null);
	let commentBody = $state('');
	let commentError = $state<string | null>(null);
	let commentSubmitting = $state(false);
	let renderedRowLimit = $state(900);
	let activeHunkIndex = $state(0);
	let agentTriggering = $state(false);
	let agentTriggerMessage = $state<string | null>(null);
	let agentTriggerError = $state<string | null>(null);

	function fileKey(file: ReviewFile) {
		return file.id ?? file.path;
	}

	function isTestFile(file: ReviewFile) {
		return /(^|\/)(test|tests|sql|case|cases)(\/|$)/i.test(file.path) || /(_test|\.test|\.spec)\./i.test(file.path);
	}

	function isCodeFile(file: ReviewFile) {
		return !file.generatedLike && !isTestFile(file) && /\.(java|ts|js|svelte|sh|sql|xml|properties|md)$/i.test(file.path);
	}

	function matchesFilter(file: ReviewFile) {
		if (filter === 'all') return true;
		if (filter === 'large') return Boolean(file.tooLarge);
		if (filter === 'generated') return Boolean(file.generatedLike);
		if (filter === 'tests') return isTestFile(file) && !file.generatedLike;
		if (filter === 'code') return isCodeFile(file);
		return !file.generatedLike && !file.tooLarge;
	}

	const selectedCommit = $derived(commits.find((commit) => commit.id === selectedCommitId) ?? null);
	const selectedCommitMessage = $derived(
		selectedCommit ? summarizeCommitMessage(selectedCommit.message, 120, selectedCommit.subject) : null
	);
	const commitFiles = $derived(selectedCommit ? selectedCommit.files : (data.files as ReviewFile[]));
	const filteredFiles = $derived(
		commitFiles.filter((file) => {
			const q = search.trim().toLowerCase();
			const matchesSearch = !q || file.path.toLowerCase().includes(q) || file.oldPath?.toLowerCase().includes(q);
			return matchesSearch && matchesFilter(file);
		})
	);

	const selectedKey = $derived(selectedFile ? fileKey(selectedFile) : '');
	const selectedDiff = $derived(selectedKey ? loadedDiffs[selectedKey] : '');
	const diffLines = $derived(selectedDiff ? selectedDiff.split('\n') : []);
	const diffRows = $derived(parseUnifiedDiffRows(diffLines));
	const selectedFileComments = $derived(
		comments.filter((comment) => comment.filePath === selectedFile?.path && comment.status === 'open')
	);
	const dragPreviewAnchor = $derived(
		dragStartAnchor && dragCurrentAnchor ? normalizedRangeAnchor(dragStartAnchor, dragCurrentAnchor) : dragStartAnchor
	);
	const displayItems = $derived(buildDiffDisplayItems(diffRows, selectedFileComments, activeDraftAnchor));
	const hunkRows = $derived(diffRows.filter((row) => row.kind === 'header' && row.hunkHeader));
	const visibleDisplayItems = $derived(displayItems.filter((item) => item.type !== 'diff' || item.row.index < renderedRowLimit));
	const hiddenDiffRows = $derived(Math.max(0, diffRows.length - renderedRowLimit));
	const commitComparison = $derived(selectedCommit ? buildCommitComparison(selectedCommit) : null);

	function formatBytes(bytes = 0) {
		if (bytes < 1024) return `${bytes} B`;
		if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
		return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
	}


	function buildCommitComparison(commit: ReviewCommit) {
		const index = commits.findIndex((entry) => entry.id === commit.id);
		const previous = index > 0 ? commits[index - 1] : null;
		const next = index >= 0 && index < commits.length - 1 ? commits[index + 1] : null;
		const touchedBy = new Map<string, number>();
		for (const entry of commits) {
			for (const file of entry.files) touchedBy.set(file.path, (touchedBy.get(file.path) ?? 0) + 1);
		}
		const sharedFiles = commit.files.filter((file) => (touchedBy.get(file.path) ?? 0) > 1);
		return { position: index + 1, previous, next, uniqueFiles: commit.files.length - sharedFiles.length, sharedFiles, sharedPreview: sharedFiles.slice(0, 5) };
	}

	async function ensureRowRendered(rowIndex: number) {
		if (rowIndex >= renderedRowLimit) {
			renderedRowLimit = Math.min(diffRows.length, rowIndex + 350);
			await tick();
		}
	}

	async function scrollToHunk(delta: number) {
		if (hunkRows.length === 0) return;
		const nextIndex = Math.max(0, Math.min(hunkRows.length - 1, activeHunkIndex + delta));
		activeHunkIndex = nextIndex;
		const row = hunkRows[nextIndex];
		await ensureRowRendered(row.index);
		document.querySelector(`[data-hunk-index="${nextIndex}"]`)?.scrollIntoView({ block: 'start', behavior: 'smooth' });
	}

	function resetDiffViewport() {
		renderedRowLimit = 900;
		activeHunkIndex = 0;
		activeDraftAnchor = null;
		resetDragSelection();
	}

	function commentHash(comment: ReviewComment) {
		return `comment-${comment.id}`;
	}

	function commentShareHref(comment: ReviewComment) {
		return `#${commentHash(comment)}`;
	}

	async function copyCommentLink(comment: ReviewComment) {
		await navigator.clipboard.writeText(`${window.location.origin}${window.location.pathname}${commentShareHref(comment)}`);
	}

	async function openComment(comment: ReviewComment) {
		if (!comment.filePath) return;
		const candidates = selectedCommit?.files ?? (data.files as ReviewFile[]);
		let file = candidates.find((entry) => entry.path === comment.filePath);
		if (!file && selectedCommit) {
			selectCommit('all');
			await tick();
			file = (data.files as ReviewFile[]).find((entry) => entry.path === comment.filePath);
		}
		if (file) {
			await loadFile(file, true);
			await tick();
		}
		location.hash = commentHash(comment);
		document.getElementById(commentHash(comment))?.scrollIntoView({ block: 'center', behavior: 'smooth' });
	}

	async function triggerHermesAgent() {
		agentTriggering = true;
		agentTriggerMessage = null;
		agentTriggerError = null;
		try {
			const response = await fetch(`/api/reviews/${data.review.id}/agent/trigger-comments`, { method: 'POST' });
			const payload = await response.json();
			if (!response.ok) throw new Error(payload.message ?? payload.error ?? 'Unable to notify the executor bot');
			agentTriggerMessage = payload.message ?? `Notified the executor bot about ${payload.newCommentCount ?? 0} open comments.`;
		} catch (cause) {
			agentTriggerError = cause instanceof Error ? cause.message : 'Unable to notify the executor bot';
		} finally {
			agentTriggering = false;
		}
	}

	function diffClass(line: string) {
		if (line.startsWith('+') && !line.startsWith('+++')) return 'added';
		if (line.startsWith('-') && !line.startsWith('---')) return 'deleted';
		if (line.startsWith('diff --git') || line.startsWith('@@')) return 'header';
		return '';
	}


	function parseHunkHeader(line: string) {
		const match = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
		if (!match) return null;
		return { oldLine: Number(match[1]), newLine: Number(match[2]) };
	}

	function parseUnifiedDiffRows(lines: string[]): DiffRow[] {
		let oldLine: number | null = null;
		let newLine: number | null = null;
		let hunkHeader: string | null = null;
		let currentHunkIndex: number | null = null;
		let nextHunkIndex = 0;
		return lines.map((line, index) => {
			const parsedHeader = parseHunkHeader(line);
			if (parsedHeader) {
				oldLine = parsedHeader.oldLine;
				newLine = parsedHeader.newLine;
				hunkHeader = line;
				currentHunkIndex = nextHunkIndex;
				nextHunkIndex += 1;
				return { index, text: line, kind: 'header', oldLine: null, newLine: null, side: null, lineNumber: null, hunkHeader, commentable: false, hunkIndex: currentHunkIndex };
			}

			if (line.startsWith('+') && !line.startsWith('+++')) {
				const lineNumber = newLine;
				if (newLine !== null) newLine += 1;
				return { index, text: line, kind: 'added', oldLine: null, newLine: lineNumber, side: 'new', lineNumber, hunkHeader, commentable: lineNumber !== null, hunkIndex: currentHunkIndex };
			}

			if (line.startsWith('-') && !line.startsWith('---')) {
				const lineNumber = oldLine;
				if (oldLine !== null) oldLine += 1;
				return { index, text: line, kind: 'deleted', oldLine: lineNumber, newLine: null, side: 'old', lineNumber, hunkHeader, commentable: lineNumber !== null, hunkIndex: currentHunkIndex };
			}

			const rowOldLine = oldLine;
			const rowNewLine = newLine;
			if (oldLine !== null) oldLine += 1;
			if (newLine !== null) newLine += 1;
			return { index, text: line, kind: diffClass(line) || 'context', oldLine: rowOldLine, newLine: rowNewLine, side: rowNewLine !== null ? 'new' : null, lineNumber: rowNewLine, hunkHeader, commentable: rowNewLine !== null && hunkHeader !== null, hunkIndex: currentHunkIndex };
		});
	}

	function anchorKey(anchor: CommentAnchor) {
		return `${anchor.side}:${anchor.lineStart}:${anchor.lineEnd}:${anchor.insertAfterIndex}`;
	}

	function commentsForRow(row: DiffRow, rowComments: ReviewComment[]) {
		if (row.lineNumber === null || row.side === null) return [];
		return rowComments.filter((comment) => comment.side === row.side && (comment.lineEnd ?? comment.lineStart) === row.lineNumber);
	}

	function buildDiffDisplayItems(rows: DiffRow[], rowComments: ReviewComment[], draftAnchor: CommentAnchor | null): DiffDisplayItem[] {
		const items: DiffDisplayItem[] = [];
		for (const row of rows) {
			items.push({ type: 'diff', key: `diff:${row.index}`, row });
			for (const comment of commentsForRow(row, rowComments)) {
				items.push({ type: 'comment', key: `comment:${comment.id}`, row, comment });
			}
			if (draftAnchor?.insertAfterIndex === row.index) {
				items.push({ type: 'composer', key: `composer:${anchorKey(draftAnchor)}`, anchor: draftAnchor });
			}
		}
		return items;
	}

	function lineAnchor(row: DiffRow): CommentAnchor | null {
		if (!row.commentable || row.side === null || row.lineNumber === null) return null;
		return { side: row.side, lineStart: row.lineNumber, lineEnd: row.lineNumber, insertAfterIndex: row.index, label: `Line ${row.lineNumber}` };
	}

	function normalizedRangeAnchor(start: CommentAnchor, end: CommentAnchor): CommentAnchor | null {
		if (start.side !== end.side) return null;
		const lineStart = Math.min(start.lineStart, end.lineStart);
		const lineEnd = Math.max(start.lineEnd, end.lineEnd);
		return {
			side: start.side,
			lineStart,
			lineEnd,
			insertAfterIndex: Math.max(start.insertAfterIndex, end.insertAfterIndex),
			label: `Lines ${lineStart}-${lineEnd}`
		};
	}

	function anchorLabel(anchor: CommentAnchor) {
		const prefix = anchor.lineStart === anchor.lineEnd ? 'Line' : 'Lines';
		const range = anchor.lineStart === anchor.lineEnd ? `${anchor.lineStart}` : `${anchor.lineStart}-${anchor.lineEnd}`;
		return `${prefix} ${range} · ${anchor.side === 'old' ? 'LEFT' : 'RIGHT'}`;
	}

	function commentLabel(comment: ReviewComment) {
		const lineEnd = comment.lineEnd ?? comment.lineStart;
		const prefix = comment.lineStart === lineEnd ? 'Line' : 'Lines';
		const range = comment.lineStart === lineEnd ? `${comment.lineStart}` : `${comment.lineStart}-${lineEnd}`;
		return `${prefix} ${range} · ${comment.side === 'old' ? 'LEFT' : 'RIGHT'}`;
	}

	function rowInAnchorRange(row: DiffRow, anchor: CommentAnchor | null) {
		if (!anchor || row.side !== anchor.side || row.lineNumber === null) return false;
		return row.lineNumber >= anchor.lineStart && row.lineNumber <= anchor.lineEnd;
	}

	function lineLabel(row: DiffRow, side: 'old' | 'new') {
		const line = side === 'old' ? row.oldLine : row.newLine;
		return line === null ? '' : String(line);
	}

	function resetDragSelection() {
		dragStartAnchor = null;
		dragCurrentAnchor = null;
		dragPointerId = null;
	}

	function rowFromPointer(event: PointerEvent) {
		const element = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('.diff-line[data-row-index]');
		const rowIndex = element ? Number(element.dataset.rowIndex) : Number.NaN;
		return Number.isFinite(rowIndex) ? diffRows.find((row) => row.index === rowIndex) : null;
	}

	function updateDragCurrent(event: PointerEvent) {
		if (dragPointerId !== event.pointerId || !dragStartAnchor) return;
		const row = rowFromPointer(event);
		const anchor = row ? lineAnchor(row) : null;
		if (anchor && anchor.side === dragStartAnchor.side) {
			dragCurrentAnchor = anchor;
		}
	}

	async function startInlineComment(row: DiffRow) {
		const anchor = lineAnchor(row);
		if (!anchor) return;
		activeDraftAnchor = anchor;
		resetDragSelection();
		commentBody = '';
		commentError = null;
		await tick();
		// Opening a composer near the bottom of the diff can place the Save/Cancel
		// row below the visible scrollport. Bring the full composer into view.
		document.querySelector('form.inline-comment.composer')?.scrollIntoView({ block: 'nearest' });
	}

	async function finishDragComment(row: DiffRow) {
		const anchor = lineAnchor(row);
		if (!anchor) return;
		const range = dragStartAnchor ? normalizedRangeAnchor(dragStartAnchor, anchor) : anchor;
		if (!range) return;
		activeDraftAnchor = range;
		resetDragSelection();
		commentBody = '';
		commentError = null;
		await tick();
		document.querySelector('form.inline-comment.composer')?.scrollIntoView({ block: 'nearest' });
	}

	function startPlusDrag(event: PointerEvent, row: DiffRow) {
		const anchor = lineAnchor(row);
		if (!anchor) return;
		event.preventDefault();
		dragStartAnchor = anchor;
		dragCurrentAnchor = anchor;
		dragPointerId = event.pointerId;
		activeDraftAnchor = null;
		(event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
	}

	function movePlusDrag(event: PointerEvent) {
		updateDragCurrent(event);
	}

	async function endPlusDrag(event: PointerEvent, row: DiffRow) {
		if (dragPointerId !== event.pointerId) return;
		event.preventDefault();
		updateDragCurrent(event);
		(event.currentTarget as HTMLElement).releasePointerCapture?.(event.pointerId);
		const targetAnchor = dragCurrentAnchor ?? lineAnchor(row);
		if (!targetAnchor) {
			resetDragSelection();
			return;
		}
		await finishDragComment({ ...row, side: targetAnchor.side, lineNumber: targetAnchor.lineStart, commentable: true, index: targetAnchor.insertAfterIndex });
	}

	function cancelInlineComment() {
		activeDraftAnchor = null;
		resetDragSelection();
		commentBody = '';
		commentError = null;
	}

	async function loadFile(file: ReviewFile, force = false) {
		selectedFile = file;
		loadError = null;
		resetDiffViewport();
		const key = fileKey(file);
		if (file.tooLarge && !force && !forceLarge[key]) return;
		if (loadedDiffs[key]) return;
		if (!file.id) {
			loadError = 'This review was published before per-file diff artifacts existed. Re-publish the review to enable lazy file loading.';
			return;
		}
		loadingFileId = key;
		try {
			const response = await fetch(`/api/reviews/${data.review.id}/versions/${latestVersion.version}/files/${file.id}/diff`);
			if (!response.ok) throw new Error(await response.text());
			const payload = await response.json();
			loadedDiffs = { ...loadedDiffs, [key]: payload.diff };
			forceLarge = { ...forceLarge, [key]: true };
		} catch (cause) {
			loadError = cause instanceof Error ? cause.message : 'Unable to load file diff';
		} finally {
			loadingFileId = null;
		}
	}

	function loadLargeFile(file: ReviewFile) {
		forceLarge = { ...forceLarge, [fileKey(file)]: true };
		void loadFile(file, true);
	}

	function markReviewed(file: ReviewFile) {
		const key = fileKey(file);
		reviewed = { ...reviewed, [key]: !reviewed[key] };
	}

	function selectCommit(commitId: string) {
		selectedCommitId = commitId;
		selectedFile = null;
		loadError = null;
		resetDiffViewport();
	}

	function hasActiveTextSelection() {
		// Button descendants are not text-selectable in some browsers by default;
		// once enabled via CSS, avoid treating a completed drag-selection as a click.
		return Boolean(window.getSelection()?.toString().trim());
	}

	function selectCommitFromClick(commitId: string) {
		if (hasActiveTextSelection()) return;
		selectCommit(commitId);
	}

	function commitReviewedCount(commit: ReviewCommit) {
		return commit.files.filter((file) => reviewed[fileKey(file)]).length;
	}

	function moveCommit(delta: number) {
		if (commits.length === 0) return;
		const ids = ['all', ...commits.map((commit) => commit.id)];
		const current = Math.max(0, ids.indexOf(selectedCommitId));
		const next = (current + delta + ids.length) % ids.length;
		selectCommit(ids[next]);
	}

	function onCommitKeydown(event: KeyboardEvent) {
		if (event.key === 'j' || event.key === 'ArrowDown') {
			event.preventDefault();
			moveCommit(1);
		}
		if (event.key === 'k' || event.key === 'ArrowUp') {
			event.preventDefault();
			moveCommit(-1);
		}
	}

	async function submitInlineComment(anchor: CommentAnchor) {
		commentError = null;
		const body = commentBody.trim();
		if (!selectedFile || !anchor) {
			commentError = 'Select a concrete diff range before commenting.';
			return;
		}
		if (!body) {
			commentError = 'Comment body is required.';
			return;
		}
		commentSubmitting = true;
		try {
			const response = await fetch(`/api/reviews/${data.review.id}/comments`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					filePath: selectedFile.path,
					side: anchor.side,
					lineStart: anchor.lineStart,
					lineEnd: anchor.lineEnd,
					body,
					author: commentAuthor.trim() || 'reviewer'
				})
			});
			if (!response.ok) throw new Error(await response.text());
			const payload = (await response.json()) as { comment: ReviewComment };
			comments = [...comments, payload.comment];
			cancelInlineComment();
		} catch (cause) {
			commentError = cause instanceof Error ? cause.message : 'Unable to add comment';
		} finally {
			commentSubmitting = false;
		}
	}

	$effect(() => {
		comments = [...(data.comments as ReviewComment[])];
	});

	$effect(() => {
		if (typeof window === 'undefined') return;
		const id = window.location.hash.replace(/^#comment-/, '');
		if (!id) return;
		const comment = comments.find((entry) => entry.id === id);
		if (comment) void openComment(comment);
	});

	$effect(() => {
		const selectedStillVisible = selectedFile && filteredFiles.some((file) => fileKey(file) === fileKey(selectedFile!));
		if (!selectedStillVisible) {
			const nextFile = filteredFiles[0] ?? null;
			if (nextFile) {
				// Keep the detail pane in sync with the visible file list and load small
				// diffs immediately. Large files still stop in loadFile() and show the
				// explicit "Load large diff" affordance.
				void loadFile(nextFile);
			} else {
				selectedFile = null;
				loadError = null;
			}
		}
	});
</script>

<svelte:head>
	<title>{data.review.id} · Review</title>
</svelte:head>

<main class="page">
	<nav><a href="/reviews">← Reviews</a></nav>
	<ReviewHero
		eyebrow={`${data.review.id} · ${data.review.status}`}
		title={data.review.title}
		meta={[
			`${data.review.sourceKind}${data.review.sourceRef ? ` ${data.review.sourceRef}` : ''}`,
			`v${latestVersion.version}`,
			`${data.files.length} files`,
			`+${data.summary.additions} -${data.summary.deletions}`,
			`${formatBytes(data.summary.patchBytes)} indexed`
		]}
		codeText={data.review.repoRoot}
	>
		<div class="actions">
			<a class="button" href={`/api/reviews/${data.review.id}/raw.patch`}>Download raw patch</a>
			<span>{data.summary.largeFiles} &gt;1 MiB collapsed · {data.summary.generatedFiles} generated-like labeled</span>
		</div>
	</ReviewHero>


	<section class="summary">
		<div>
			<strong>Metadata-first review</strong>
			<span>Diffs load on demand; only patches over 1 MiB stay collapsed, while generated-like files are labeled but still readable.</span>
		</div>
		<span class="shortcut-hint">Commit navigation: <kbd>j</kbd>/<kbd>k</kbd></span>
	</section>

	<section
		class="review-workspace"
		class:without-commits={commits.length === 0}
		class:commits-collapsed={commits.length > 0 && commitsCollapsed}
		style:--review-columns={commitsCollapsed ? '58px minmax(320px, 480px) minmax(620px, 1fr)' : undefined}
	>
		{#if commits.length > 0}
			<aside class="commit-rail" class:rail-collapsed={commitsCollapsed} aria-label="Commit navigation">
				<div class="pane-head compact commit-rail-head">
					{#if !commitsCollapsed}
						<div>
							<p class="eyebrow">Commit range</p>
							<h2>{commits.length} commits</h2>
						</div>
						<div class="commit-head-actions">
							<span class="keyboard-pill">j/k</span>
							<button class="panel-toggle" type="button" aria-label="Collapse commit range panel" title="Collapse commit range panel" onclick={() => (commitsCollapsed = true)}>‹</button>
						</div>
					{:else}
						<button class="panel-toggle expand" type="button" aria-label="Expand commit range panel" title="Expand commit range panel" onclick={() => (commitsCollapsed = false)}>›</button>
						<span class="collapsed-count" title={`${commits.length} commits`}>{commits.length}</span>
					{/if}
				</div>

				{#if !commitsCollapsed}
					<button class="commit-row all-row" class:active={selectedCommitId === 'all'} onclick={() => selectCommitFromClick('all')} onkeydown={onCommitKeydown}>
						<span class="commit-dot">∑</span>
						<span class="commit-main">
							<strong>Merged local commits</strong>
							<small>{data.files.length} files · +{data.summary.additions} -{data.summary.deletions} · all commits combined</small>
						</span>
					</button>

					<div class="commit-list">
						{#each commits as commit, index}
							{@const message = summarizeCommitMessage(commit.message, 76, commit.subject)}
							{@const activeCommit = selectedCommitId === commit.id}
							{@const doneFiles = commitReviewedCount(commit)}
							<button class="commit-row" class:active={activeCommit} onclick={() => selectCommitFromClick(commit.id)} onkeydown={onCommitKeydown}>
								<span class="commit-dot">{doneFiles === commit.files.length ? '✓' : index + 1}</span>
								<span class="commit-main">
									<span class="commit-subject">{message.preview}</span>
									<span class="commit-facts">
										<code>{commit.shortSha}</code>
										<span>{commit.files.length} files</span>
										<span class="plus">+{commit.additions}</span>
										<span class="minus">-{commit.deletions}</span>
									</span>
									{#if activeCommit && selectedCommitMessage}
										<pre class="commit-message">{selectedCommitMessage.full}</pre>
									{/if}
								</span>
							</button>
						{/each}
					</div>
				{/if}
			</aside>
		{/if}

		<section class="file-pane">
			<div class="pane-head">
				<div>
					<p class="eyebrow">{selectedCommit ? 'Selected commit' : 'Combined all local commits patch'}</p>
					<h2>{selectedCommit ? 'Files in selected commit' : 'All changes'}</h2>
				</div>
				<span class="count-pill">{filteredFiles.length}/{commitFiles.length}</span>
			</div>

			{#if commitComparison}
				<div class="commit-compare-card">
					<strong>Commit layer {commitComparison.position}/{commits.length}</strong>
					<span>{commitComparison.uniqueFiles} unique files · {commitComparison.sharedFiles.length} files also touched by other commits</span>
					<div class="compare-actions">
						<button disabled={!commitComparison.previous} onclick={() => commitComparison.previous && selectCommit(commitComparison.previous.id)}>Previous layer</button>
						<button disabled={!commitComparison.next} onclick={() => commitComparison.next && selectCommit(commitComparison.next.id)}>Next layer</button>
					</div>
					{#if commitComparison.sharedPreview.length > 0}
						<p>Shared hot files: {commitComparison.sharedPreview.map((file) => file.path).join(' · ')}</p>
					{/if}
				</div>
			{/if}

			<div class="file-toolbar">
				<input bind:value={search} placeholder="Search path" aria-label="Search files" />
				<div class="filters" aria-label="File filters">
					{#each filterOptions as option}
						<button class:active={filter === option} onclick={() => (filter = option)}>{option}</button>
					{/each}
				</div>
			</div>

			<ul class="file-list">
				{#each filteredFiles as file}
					<li class:selected={selectedFile && fileKey(selectedFile) === fileKey(file)} class:reviewed={reviewed[fileKey(file)]}>
						<button onclick={() => void loadFile(file)}>
							<span class="file-path">{file.path}</span>
							<span class="file-stats">
								<span class="plus">+{file.additions}</span>
								<span class="minus">-{file.deletions}</span>
								<span>{file.lineCount ?? '?'} lines</span>
								<span>{formatBytes(file.patchBytes)}</span>
							</span>
							<span class="badges">
								{#each getFileBadges(file) as badge}<em>{badge}</em>{/each}
								{#if commitComparison?.sharedFiles.some((shared) => shared.path === file.path)}<em class="shared-badge">multi-commit</em>{/if}
								{#if reviewed[fileKey(file)]}<em class="reviewed-badge">reviewed</em>{/if}
							</span>
						</button>
					</li>
				{/each}
			</ul>
		</section>

		<section class="diff-panel">
			<div class="diff-header">
				<div>
					<p class="eyebrow">Diff viewer</p>
					<h2>{selectedFile?.path ?? 'Select a file'}</h2>
					{#if selectedFile?.oldPath}<p>renamed from {selectedFile.oldPath}</p>{/if}
				</div>
				{#if selectedFile}
					<div class="diff-actions">
						<button disabled={hunkRows.length === 0 || activeHunkIndex === 0} onclick={() => void scrollToHunk(-1)}>Previous hunk</button>
						<button disabled={hunkRows.length === 0 || activeHunkIndex >= hunkRows.length - 1} onclick={() => void scrollToHunk(1)}>Next hunk</button>
						<span class="hunk-counter">{hunkRows.length ? `${activeHunkIndex + 1}/${hunkRows.length}` : '0/0'} hunks</span>
						<button onclick={() => markReviewed(selectedFile!)}>{reviewed[fileKey(selectedFile)] ? 'Reviewed ✓' : 'Mark reviewed'}</button>
					</div>
				{/if}
			</div>

			{#if loadError}
				<p class="error">{loadError}</p>
			{:else if selectedFile?.tooLarge && !loadedDiffs[selectedKey]}
				<div class="collapsed">
					<h3>Diff over 1 MiB collapsed</h3>
					<p>{selectedFile.path} has {selectedFile.lineCount ?? '?'} lines / {formatBytes(selectedFile.patchBytes)}. Load it only if you really need the full text.</p>
					<button class="primary" onclick={() => selectedFile && loadLargeFile(selectedFile)}>Load large diff</button>
				</div>
			{:else if loadingFileId}
				<p class="loading">Loading file diff…</p>
			{:else if diffLines.length > 0}
				<div class="virtual-diff">
					{#if hiddenDiffRows > 0}
						<div class="diff-window-banner">Rendering first {Math.min(renderedRowLimit, diffRows.length)} of {diffRows.length} diff rows for large-patch responsiveness. <button onclick={() => (renderedRowLimit = Math.min(diffRows.length, renderedRowLimit + 900))}>Load next rows</button><button onclick={() => (renderedRowLimit = diffRows.length)}>Show all</button></div>
					{/if}
					<div class="diff-flow">
						{#each visibleDisplayItems as item (item.key)}
							<div class="diff-item">
								{#if item.type === 'diff'}
									<div
										class={`diff-line ${item.row.kind}`}
										class:commentable={item.row.commentable}
										class:range-pending={rowInAnchorRange(item.row, dragPreviewAnchor)}
										class:range-active={rowInAnchorRange(item.row, activeDraftAnchor)}
										data-row-index={item.row.index}
										data-hunk-index={item.row.kind === 'header' ? item.row.hunkIndex : undefined}
									>
										<span class="line-no old-no">{lineLabel(item.row, 'old')}</span>
										<span class="line-no new-no">{lineLabel(item.row, 'new')}</span>
										<span class="comment-gutter">
											{#if item.row.commentable}
												<button
													title="Add line comment; drag to select a line range"
													aria-label={`Add comment on ${selectedFile?.path}:${item.row.lineNumber}; drag to select a line range`}
													onpointerdown={(event) => startPlusDrag(event, item.row)}
													onpointermove={movePlusDrag}
													onpointerup={(event) => void endPlusDrag(event, item.row)}
													onpointercancel={resetDragSelection}
												>+</button
												>
											{/if}
										</span>
										<code>{item.row.text || ' '}</code>
									</div>
								{:else if item.type === 'comment'}
									<article class="inline-comment" id={commentHash(item.comment)} data-comment-id={item.comment.id}>
										<div class="comment-meta">
											<strong>{item.comment.author}</strong>
											<span>{commentLabel(item.comment)}</span>
											<time datetime={item.comment.createdAt}>{new Date(item.comment.createdAt).toLocaleString()}</time>
											<a href={commentShareHref(item.comment)} onclick={() => void copyCommentLink(item.comment)}>Copy link</a>
										</div>
										<p>{item.comment.body}</p>
									</article>
								{:else}
									<form class="inline-comment composer" onsubmit={(event) => { event.preventDefault(); void submitInlineComment(item.anchor); }}>
										<div class="comment-meta">
											<strong>New review comment</strong>
											<span>{anchorLabel(item.anchor)}</span>
										</div>
										<div class="composer-fields">
											<input bind:value={commentAuthor} aria-label="Comment author" placeholder="reviewer" />
											<textarea bind:value={commentBody} rows="3" placeholder="Add a GitHub-style inline review comment"></textarea>
										</div>
										<div class="comment-actions">
											<button class="primary" type="submit" disabled={commentSubmitting}>{commentSubmitting ? 'Saving…' : 'Add single comment'}</button>
											<button type="button" onclick={cancelInlineComment}>Cancel</button>
										</div>
										{#if commentError}<p class="error compact-error">{commentError}</p>{/if}
									</form>
								{/if}
							</div>
						{/each}
					</div>
				</div>
			{:else if selectedFile}
				<p class="empty">Click a file to load its diff.</p>
			{:else}
				<p class="empty">No file selected.</p>
			{/if}
		</section>
	</section>


	<section class="comments overview-comments">
		<div class="comments-head">
			<div>
				<p class="eyebrow">Review comments</p>
				<h2>Inline comments</h2>
			</div>
			<div class="comments-toolbar">
				<button onclick={() => void triggerHermesAgent()} disabled={agentTriggering}>{agentTriggering ? 'Notifying executor…' : 'Notify executor bot about open comments'}</button>
				<span class="count-pill">{comments.length}</span>
			</div>
		</div>
		{#if agentTriggerMessage}<p class="success compact-status">{agentTriggerMessage}</p>{/if}
		{#if agentTriggerError}<p class="error compact-status">{agentTriggerError}</p>{/if}
		<p class="comment-filter-note">Use <strong>+</strong> for a single-line comment, or press and drag <strong>+</strong> across diff lines before releasing to choose a line range. Comments are anchored by path, side, and line range, and exported by <code>reviewctl comments --review {data.review.id} --json</code>.</p>
		{#if comments.length === 0}
			<p class="empty-comment">No inline comments yet.</p>
		{:else}
			<div class="comment-list">
				{#each comments as comment}
					<article id={`overview-${commentHash(comment)}`}>
						<div class="comment-meta">
							<strong>{comment.author}</strong>
							<span>{comment.filePath ?? 'general'}{comment.lineStart ? `:${comment.lineStart}` : ''} · {comment.side === 'old' ? 'LEFT' : comment.side === 'new' ? 'RIGHT' : 'FILE'}</span>
							<time datetime={comment.createdAt}>{new Date(comment.createdAt).toLocaleString()}</time>
							<button type="button" onclick={() => void openComment(comment)}>Open</button>
							<a href={commentShareHref(comment)} onclick={() => void copyCommentLink(comment)}>Copy link</a>
						</div>
						<p>{comment.body}</p>
					</article>
				{/each}
			</div>
		{/if}
	</section>

</main>


<style>
	:global(body) {
		margin: 0;
		background: #f5f7fb;
	}
	.page {
		max-width: 1680px;
		margin: 0 auto;
		padding: 20px 22px 28px;
		font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
		color: #111827;
	}
	nav a,
	.button {
		color: #2563eb;
		text-decoration: none;
		font-weight: 650;
	}
	.commit-facts code {
		font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
	}
	.eyebrow,
	.meta,
	.actions,
	.diff-header p,
	.file-stats,
	.commit-facts,
	.shortcut-hint {
		color: #667085;
		font-size: 0.83rem;
		font-weight: 650;
	}
	.eyebrow {
		margin: 0 0 3px;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		font-size: 0.69rem;
	}
	.meta,
	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: 10px;
		margin-bottom: 2px;
	}
	.summary,
	.commit-rail,
	.file-pane,
	.diff-panel,
	.comments {
		border: 1px solid #d9e1ee;
		border-radius: 14px;
		background: #fff;
		box-shadow: 0 1px 2px rgb(16 24 40 / 0.04);
	}
	.summary {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 14px;
		margin: 14px 0;
		padding: 10px 12px;
		background: #f8fbff;
	}
	.summary div {
		display: flex;
		gap: 8px;
		align-items: baseline;
		flex-wrap: wrap;
	}
	kbd,
	.keyboard-pill,
	.count-pill {
		border: 1px solid #cbd5e1;
		border-bottom-width: 2px;
		border-radius: 6px;
		background: #fff;
		padding: 1px 6px;
		font: 700 0.75rem ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
		color: #475467;
	}
	.review-workspace {
		display: grid;
		grid-template-columns: var(--review-columns, minmax(300px, 360px) minmax(300px, 440px) minmax(520px, 1fr));
		gap: 12px;
		align-items: stretch;
		min-height: 78vh;
	}
	.review-workspace.commits-collapsed {
		grid-template-columns: 58px minmax(320px, 480px) minmax(620px, 1fr);
	}
	.review-workspace.without-commits {
		grid-template-columns: minmax(320px, 440px) minmax(520px, 1fr);
	}
	.commit-rail,
	.file-pane,
	.diff-panel {
		min-width: 0;
		min-height: 0;
		max-height: 82vh;
		display: flex;
		flex-direction: column;
		overflow: hidden;
	}
	.file-pane {
		overflow: hidden;
	}
	.commit-rail:focus-visible {
		outline: 3px solid #bfdbfe;
		outline-offset: 2px;
	}
	.commit-rail.rail-collapsed {
		align-items: stretch;
	}
	.commit-rail-head {
		min-height: 44px;
	}
	.commit-rail.rail-collapsed .commit-rail-head {
		flex-direction: column;
		align-items: center;
		justify-content: flex-start;
		gap: 8px;
		padding: 10px 8px;
	}
	.commit-head-actions {
		display: flex;
		align-items: center;
		gap: 8px;
	}
	.panel-toggle {
		display: inline-grid;
		place-items: center;
		width: 30px;
		height: 30px;
		padding: 0;
		border-radius: 999px;
		font-size: 1.15rem;
		font-weight: 850;
		line-height: 1;
	}
	.panel-toggle.expand {
		width: 34px;
		height: 34px;
		font-size: 1.25rem;
	}
	.collapsed-count {
		display: inline-grid;
		place-items: center;
		width: 34px;
		height: 34px;
		border-radius: 999px;
		background: #eff6ff;
		color: #1d4ed8;
		font-weight: 850;
		font-size: 0.8rem;
	}
	.commit-rail,
	.commit-rail * {
		user-select: text;
	}
	.pane-head {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 12px;
		padding: 13px 14px 10px;
		border-bottom: 1px solid #e4eaf3;
	}
	.pane-head h2 {
		margin: 0;
		font-size: 1rem;
		letter-spacing: -0.01em;
	}
	.pane-head.compact {
		align-items: center;
	}
	button,
	.button {
		border: 1px solid #cfd8e6;
		border-radius: 9px;
		background: #f8fafc;
		padding: 7px 10px;
		cursor: pointer;
		font: inherit;
		transition: border-color 120ms ease, background 120ms ease, box-shadow 120ms ease;
	}
	button:hover {
		border-color: #9bb5d6;
		background: #f5f8fc;
	}
	button.active,
	button.primary {
		background: #1f6feb;
		border-color: #1f6feb;
		color: #fff;
	}
	.commit-list {
		overflow: auto;
		padding: 8px;
		display: grid;
		gap: 6px;
	}
	.commit-row {
		width: calc(100% - 16px);
		margin: 8px 8px 0;
		display: grid;
		grid-template-columns: 30px minmax(0, 1fr);
		gap: 8px;
		text-align: left;
		border-color: transparent;
		background: transparent;
		box-shadow: none;
	}
	.commit-list .commit-row {
		width: 100%;
		margin: 0;
	}
	.commit-row.active {
		background: #eff6ff;
		border-color: transparent;
		color: #0f172a;
		box-shadow: inset 3px 0 0 #1f6feb;
	}
	.commit-dot {
		align-self: start;
		display: inline-grid;
		place-items: center;
		width: 24px;
		height: 24px;
		border-radius: 999px;
		background: #eef2f7;
		color: #475467;
		font-size: 0.75rem;
		font-weight: 800;
	}
	.commit-row.active .commit-dot {
		background: #1f6feb;
		color: #fff;
	}
	.commit-main {
		min-width: 0;
		display: grid;
		gap: 4px;
	}
	.commit-subject,
	.commit-main strong {
		font-weight: 720;
		line-height: 1.25;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.commit-facts,
	.file-stats,
	.badges {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 6px;
	}
	.commit-message {
		margin: 4px 0 0;
		/* Let the active commit row grow so the full message is visible; the
		 * surrounding commit list already owns vertical scrolling for the rail. */
		max-height: none;
		overflow: visible;
		white-space: pre-wrap;
		word-break: break-word;
		background: transparent;
		color: #101828;
		border: 0;
		border-left: 2px solid #c7d2fe;
		border-radius: 0;
		padding: 2px 0 2px 10px;
		font-size: 0.78rem;
		line-height: 1.45;
	}
	.plus {
		color: #0f8a43;
		font-weight: 760;
	}
	.minus {
		color: #cf2e2e;
		font-weight: 760;
	}

	.file-toolbar {
		padding: 10px 12px;
		border-bottom: 1px solid #e4eaf3;
	}
	input,
	textarea {
		box-sizing: border-box;
		width: 100%;
		border: 1px solid #cbd5e1;
		border-radius: 8px;
		padding: 8px 10px;
		font: inherit;
	}
	textarea {
		resize: vertical;
		min-height: 96px;
	}
	.filters,
	.diff-actions,
	.comments-toolbar {
		display: flex;
		flex-wrap: wrap;
		gap: 7px;
		margin-top: 9px;
	}
	.filters button {
		padding: 4px 8px;
		font-size: 0.8rem;
	}
	.file-list {
		overflow: auto;
		list-style: none;
		padding: 8px;
		margin: 0;
		display: grid;
		gap: 6px;
	}
	.file-list li button {
		width: 100%;
		text-align: left;
		background: #fff;
		padding: 9px;
	}
	.file-list li.selected button {
		border-color: #1f6feb;
		background: #f7fbff;
		box-shadow: inset 3px 0 0 #1f6feb;
	}
	.file-list li.reviewed {
		opacity: 0.68;
	}
	.file-path {
		display: block;
		font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
		font-size: 0.8rem;
		line-height: 1.35;
		word-break: break-word;
	}
	.file-stats,
	.badges {
		margin-top: 5px;
	}
	em {
		border-radius: 999px;
		background: #eef2f7;
		color: #475467;
		padding: 2px 7px;
		font-style: normal;
		font-size: 0.73rem;
		font-weight: 760;
	}
	em.reviewed-badge {
		background: #dcfce7;
		color: #166534;
	}
	em.shared-badge {
		background: #fef3c7;
		color: #92400e;
	}
	.commit-compare-card {
		display: grid;
		gap: 6px;
		padding: 10px 12px;
		border-bottom: 1px solid #e4eaf3;
		background: #fffbeb;
		font-size: 0.84rem;
	}
	.commit-compare-card p {
		margin: 0;
		color: #667085;
		word-break: break-word;
	}
	.compare-actions {
		display: flex;
		gap: 8px;
		flex-wrap: wrap;
	}
	.diff-header {
		display: flex;
		justify-content: space-between;
		gap: 16px;
		background: #fff;
		border-bottom: 1px solid #e4eaf3;
		padding: 13px 14px 10px;
	}
	.diff-header h2 {
		margin: 0 0 4px;
		font-size: 1rem;
		word-break: break-all;
	}
	.virtual-diff {
		flex: 1;
		min-height: 0;
		overflow: auto;
		background: #0b1020;
		font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
		font-size: 12px;
		line-height: 20px;
	}
	.diff-flow {
		min-width: max-content;
	}
	.diff-window-banner {
		position: sticky;
		top: 0;
		z-index: 3;
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 8px 12px;
		background: #172554;
		color: #dbeafe;
		font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
	}
	.diff-window-banner button {
		padding: 3px 8px;
	}
	.diff-item {
		position: relative;
	}
	.diff-line {
		display: grid;
		grid-template-columns: 54px 54px 34px max-content;
		white-space: pre;
		color: #d9e6ff;
		min-width: max-content;
	}
	.diff-line code {
		padding-right: 24px;
	}
	.line-no,
	.comment-gutter {
		background: #111827;
		color: #94a3b8;
		padding-right: 8px;
		text-align: right;
		user-select: none;
	}
	.old-no {
		position: sticky;
		left: 0;
	}
	.new-no {
		position: sticky;
		left: 54px;
	}
	.comment-gutter {
		position: sticky;
		left: 108px;
		display: inline-flex;
		gap: 3px;
		justify-content: center;
		padding-right: 0;
	}
	.comment-gutter button {
		width: 22px;
		height: 18px;
		margin-top: 1px;
		padding: 0;
		border-radius: 999px;
		border-color: #3b82f6;
		background: #1f6feb;
		color: #fff;
		font: 800 12px/16px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
		opacity: 0;
	}
	.diff-line.commentable:hover .comment-gutter button,
	.diff-line.header:hover .comment-gutter button,
	.comment-gutter button:focus-visible {
		opacity: 1;
	}
	.diff-line.range-pending code,
	.diff-line.range-active code {
		box-shadow: inset 3px 0 0 #f59e0b;
		background: rgb(245 158 11 / 0.13);
	}
	.added code {
		color: #86efac;
	}
	.deleted code {
		color: #fca5a5;
	}
	.header code {
		color: #93c5fd;
		font-weight: 700;
	}
	.collapsed,
	.empty,
	.loading,
	.error {
		margin: 14px;
		border-radius: 10px;
		padding: 18px;
		background: #f8fafc;
	}
	.error {
		background: #fef2f2;
		color: #b91c1c;
	}
	.success {
		margin: 14px;
		border-radius: 10px;
		padding: 12px;
		background: #ecfdf3;
		color: #166534;
	}
	.compact-status {
		margin: 10px 0;
	}
	.comments {
		margin-top: 16px;
		padding: 14px;
	}
	.comments-head,
	.comment-actions,
	.comment-meta {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 10px;
		flex-wrap: wrap;
	}
	.comments h2 {
		margin: 0;
	}
	.inline-comment {
		position: sticky;
		left: 142px;
		box-sizing: border-box;
		margin-left: 142px;
		margin-right: 20px;
		margin-bottom: 6px;
		width: min(760px, calc(100dvw - 248px));
		max-width: calc(100dvw - 248px);
		padding: 8px 10px;
		border: 1px solid #bfdbfe;
		border-radius: 8px;
		background: #f8fbff;
		color: #111827;
		font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
		line-height: 1.3;
	}
	.inline-comment:target {
		border-color: #f59e0b;
		box-shadow: 0 0 0 3px rgb(245 158 11 / 0.25);
	}
	.inline-comment p {
		margin: 6px 0 0;
		white-space: pre-wrap;
		word-break: break-word;
	}
	.inline-comment.composer {
		display: grid;
		gap: 8px;
		background: #eff6ff;
	}
	.inline-comment.composer > * {
		min-width: 0;
		max-width: 100%;
	}
	.composer-fields {
		display: grid;
		grid-template-columns: minmax(120px, 160px) minmax(0, 1fr);
		gap: 8px;
	}
	.composer-fields input,
	.composer-fields textarea {
		min-width: 0;
	}
	.composer-fields textarea {
		min-height: 62px;
		resize: none;
	}
	.inline-comment.composer .comment-actions {
		justify-content: flex-start;
	}
	.comment-actions span,
	.comment-filter-note,
	.empty-comment {
		color: #667085;
		font-size: 0.84rem;
	}
	.comment-list {
		margin-top: 12px;
	}
	.comment-meta {
		justify-content: flex-start;
		font-size: 0.85rem;
		color: #667085;
	}
	.comment-meta strong {
		color: #111827;
	}
	.comment-meta span {
		font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
		min-width: 0;
		overflow-wrap: anywhere;
		white-space: normal;
	}
	.compact-error {
		margin: 0;
		padding: 10px 12px;
	}
	pre:not(.commit-message) {
		overflow: auto;
		padding: 12px;
		border-radius: 8px;
		background: #0f172a;
		color: #dbeafe;
	}
	article {
		border-top: 1px solid #e2e8f0;
		padding: 12px 0;
	}
	@media (max-width: 1200px) {
		.review-workspace,
		.review-workspace.without-commits {
			grid-template-columns: 1fr;
		}
		.commit-rail,
		.file-pane,
		.diff-panel {
			max-height: none;
		}
		.virtual-diff {
			height: 70vh;
			flex: none;
		}
	}
	@media (max-width: 640px) {
		.page {
			padding: 10px 10px 20px;
		}
		.summary {
			align-items: flex-start;
			padding: 10px;
		}
		.shortcut-hint {
			display: none;
		}
		.review-workspace {
			gap: 10px;
		}
		.summary,
		.commit-rail,
		.file-pane,
		.diff-panel,
		.comments {
			border-radius: 12px;
		}
		.pane-head,
		.diff-header {
			padding: 12px;
		}
		.diff-header {
			flex-direction: column;
			gap: 8px;
		}
		.diff-actions {
			width: 100%;
		}
		.diff-actions button {
			min-height: 40px;
			flex: 1 1 auto;
		}
		.file-toolbar {
			padding: 10px;
		}
		.file-toolbar input {
			min-height: 44px;
			font-size: 16px;
		}
		.filters {
			flex-wrap: nowrap;
			overflow-x: auto;
			padding-bottom: 2px;
		}
		.filters button {
			min-height: 40px;
			flex: 0 0 auto;
		}
		.file-list li button,
		.commit-row {
			min-height: 44px;
		}
		.virtual-diff {
			height: 68vh;
			font-size: 11px;
			line-height: 19px;
		}
		.comment-gutter button {
			opacity: 1;
		}
		.inline-comment {
			left: 8px;
			width: calc(100vw - 38px);
			min-width: 280px;
			margin: 8px;
			padding: 10px;
		}
		.composer-fields {
			grid-template-columns: 1fr;
		}
		.composer-fields input,
		.composer-fields textarea {
			font-size: 16px;
		}
		.comments {
			padding: 12px;
		}
		.comments-toolbar button {
			min-height: 44px;
		}
	}
</style>
