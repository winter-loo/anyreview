import { readFileSync } from 'node:fs';
import { error } from '@sveltejs/kit';
import { documentImageMediaType } from '$lib/server/publishers/document';
import { getDocumentReviewDetail } from '$lib/server/storage/queries';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = ({ params }) => {
	const detail = getDocumentReviewDetail(params.id);
	if (!detail || detail.document.format !== 'image') throw error(404, 'Image review not found');
	const mediaType = documentImageMediaType(detail.document.artifactPath);
	if (!mediaType) throw error(415, 'Unsupported image artifact');
	return new Response(readFileSync(detail.document.artifactPath), {
		headers: {
			'content-type': mediaType,
			'cache-control': 'private, max-age=31536000, immutable',
			'x-content-type-options': 'nosniff'
		}
	});
};
