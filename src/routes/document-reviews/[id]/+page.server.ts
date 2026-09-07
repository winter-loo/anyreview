import { randomUUID } from 'node:crypto';
import { error, fail, redirect } from '@sveltejs/kit';
import { getDocumentReviewDetail, ReviewArtifactReadError } from '$lib/server/storage/queries';
import { renderMarkdownDocument } from '$lib/server/markdown/render';
import { getReviewStore } from '$lib/server/storage/store';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = ({ params, url }) => {
	let detail;
	try {
		detail = getDocumentReviewDetail(params.id);
	} catch (cause) {
		if (cause instanceof ReviewArtifactReadError) {
			throw error(500, cause.message);
		}
		throw cause;
	}
	if (!detail || !detail.latestVersion) throw error(404, 'Document review not found');
	const comments = getReviewStore().listComments(params.id);
	const renderedBlocks = renderMarkdownDocument(detail.markdown);
	const requestedLine = Number(url.searchParams.get('commentLine'));
	const activeLine = Number.isInteger(requestedLine) && requestedLine > 0 ? requestedLine : null;
	return { ...detail, renderedBlocks, comments, activeLine, formError: null, formErrorKey: null };
};

export const actions: Actions = {
	addComment: async ({ params, request }) => {
		const store = getReviewStore();
		const review = store.getReview(params.id);
		if (!review) throw error(404, 'Review not found');
		const latestVersion = store.getLatestVersion(params.id);
		if (!latestVersion) throw error(400, 'Review has no version');

		const form = await request.formData();
		const body = String(form.get('body') ?? '').trim();
		const filePath = String(form.get('filePath') ?? '').trim();
		const side = String(form.get('side') ?? 'new');
		const lineStart = Number(form.get('lineStart'));
		const lineEnd = form.get('lineEnd') === null ? lineStart : Number(form.get('lineEnd'));
		const author = String(form.get('author') ?? 'reviewer').trim() || 'reviewer';
		const documentVersion = Number(form.get('documentVersion'));
		const blockId = String(form.get('blockId') ?? '').trim();
		const startOffset = Number(form.get('startOffset'));
		const endOffset = Number(form.get('endOffset'));
		const selectedText = String(form.get('selectedText') ?? '');
		const prefix = String(form.get('prefix') ?? '');
		const suffix = String(form.get('suffix') ?? '');

		if (!body) return fail(400, { activeLine: lineStart, formErrorKey: 'error.commentBodyRequired' });
		if (!filePath) return fail(400, { activeLine: lineStart, formErrorKey: 'error.filePathRequired' });
		if (side !== 'old' && side !== 'new') return fail(400, { activeLine: lineStart, formErrorKey: 'error.sideInvalid' });
		if (!Number.isInteger(lineStart) || lineStart < 1) return fail(400, { activeLine: null, formErrorKey: 'error.lineStartInvalid' });
		if (!Number.isInteger(lineEnd) || lineEnd < lineStart) return fail(400, { activeLine: lineStart, formErrorKey: 'error.lineEndInvalid' });

		let textSelection = null;
		if (blockId) {
			if (documentVersion !== latestVersion.version) return fail(409, { activeLine: null, formError: 'The document changed. Select the text again.' });
			const detail = getDocumentReviewDetail(params.id);
			if (!detail?.latestVersion) throw error(404, 'Document review not found');
			const block = renderMarkdownDocument(detail.markdown).find((candidate) => candidate.id === blockId);
			if (!block || block.lineStart !== lineStart || block.lineEnd !== lineEnd) return fail(400, { activeLine: null, formError: 'The selected Markdown block is no longer available.' });
			if (!Number.isInteger(startOffset) || !Number.isInteger(endOffset) || startOffset < 0 || endOffset <= startOffset || endOffset > block.text.length) {
				return fail(400, { activeLine: null, formError: 'The selected text range is invalid.' });
			}
			if (selectedText.length > 10_000 || prefix.length > 64 || suffix.length > 64) return fail(400, { activeLine: null, formError: 'The selected text is too large.' });
			const expectedPrefix = block.text.slice(Math.max(0, startOffset - 64), startOffset);
			const expectedSuffix = block.text.slice(endOffset, endOffset + 64);
			if (block.text.slice(startOffset, endOffset) !== selectedText || prefix !== expectedPrefix || suffix !== expectedSuffix) {
				return fail(409, { activeLine: null, formError: 'The selected text no longer matches this document version.' });
			}
			textSelection = { blockId, startOffset, endOffset, selectedText, prefix, suffix };
		}

		const now = new Date().toISOString();
		store.addComment({
			id: randomUUID(),
			reviewId: params.id,
			version: latestVersion.version,
			filePath,
			side,
			lineStart,
			lineEnd,
			textSelection,
			pageRegion: null,
			sentAt: null,
			body,
			author,
			status: 'open',
			createdAt: now,
			updatedAt: now
		});

		throw redirect(303, `/document-reviews/${params.id}#L${lineStart}`);
	}
};
