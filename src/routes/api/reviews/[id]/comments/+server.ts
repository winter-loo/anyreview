import { randomUUID } from 'node:crypto';
import { error, json } from '@sveltejs/kit';
import { getReviewStore } from '$lib/server/storage/store';
import { commentWithAnchor } from '$lib/server/comments/anchors';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = ({ params }) => {
	const store = getReviewStore();
	const review = store.getReview(params.id);
	const reviewKind = review?.sourceKind === 'document' ? 'document' : 'code';
	return json({ comments: store.listComments(params.id).map((comment) => commentWithAnchor(comment, reviewKind)) });
};

export const POST: RequestHandler = async ({ params, request }) => {
	const store = getReviewStore();
	const review = store.getReview(params.id);
	if (!review) throw error(404, 'Review not found');
	const latestVersion = store.getLatestVersion(params.id);
	if (!latestVersion) throw error(400, 'Review has no version');
	let body: {
		filePath?: string;
		side?: 'old' | 'new' | 'file';
		lineStart?: number;
		lineEnd?: number;
		body?: string;
		author?: string;
		pageRegion?: { page?: number; x?: number; y?: number; width?: number; height?: number };
	};
	try {
		body = (await request.json()) as typeof body;
	} catch {
		throw error(400, 'Invalid JSON request body');
	}
	if (!body.body?.trim()) throw error(400, 'Comment body is required');
	if (!body.filePath?.trim()) throw error(400, 'filePath is required for inline review comments');
	const region = body.pageRegion;
	let lineStart: number | null = null;
	let lineEnd: number | null = null;
	let pageRegion = null;
	if (region) {
		if (review.sourceKind !== 'document') throw error(400, 'pageRegion is only valid for document reviews');
		const values = [region.x, region.y, region.width, region.height].map(Number);
		const page = Number(region.page);
		const [x, y, width, height] = values;
		if (!Number.isInteger(page) || page < 1) throw error(400, 'pageRegion.page must be a positive integer');
		if (values.some((value) => !Number.isFinite(value)) || x < 0 || y < 0 || width <= 0 || height <= 0 || x + width > 1 || y + height > 1) {
			throw error(400, 'pageRegion coordinates must describe a normalized rectangle inside the page');
		}
		pageRegion = { page, x, y, width, height };
	} else {
		if (body.side !== 'old' && body.side !== 'new') throw error(400, 'side must be old or new for inline review comments');
		lineStart = Number(body.lineStart);
		if (!Number.isInteger(lineStart) || lineStart < 1) throw error(400, 'lineStart must be a positive integer for inline review comments');
		lineEnd = body.lineEnd === undefined ? lineStart : Number(body.lineEnd);
		if (!Number.isInteger(lineEnd) || lineEnd < lineStart) throw error(400, 'lineEnd must be an integer greater than or equal to lineStart');
	}
	const now = new Date().toISOString();
	const comment = {
		id: randomUUID(),
		reviewId: params.id,
		version: latestVersion.version,
		filePath: body.filePath.trim(),
		side: pageRegion ? ('file' as const) : body.side!,
		lineStart,
		lineEnd,
		textSelection: null,
		pageRegion,
		sentAt: null,
		body: body.body.trim(),
		author: body.author ?? 'anonymous',
		status: 'open' as const,
		createdAt: now,
		updatedAt: now
	};
	store.addComment(comment);
	const reviewKind = review.sourceKind === 'document' ? 'document' : 'code';
	return json({ comment: commentWithAnchor(comment, reviewKind) }, { status: 201 });
};
