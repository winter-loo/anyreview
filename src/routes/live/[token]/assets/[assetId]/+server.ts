import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { error } from '@sveltejs/kit';
import { resolveMarkdownAsset } from '$lib/server/live/markdownAssets';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params }) => {
	const asset = resolveMarkdownAsset(params.token, params.assetId);
	const file = await open(asset.path, constants.O_RDONLY | constants.O_NOFOLLOW)
		.catch(() => { throw error(404, 'Image file is unavailable'); });
	try {
		const stats = await file.stat();
		if (!stats.isFile()) throw error(404, 'Image file is unavailable');
		if (stats.size > 5 * 1024 * 1024) throw error(413, 'Image exceeds 5 MiB');
		return new Response(Readable.toWeb(file.createReadStream()) as ReadableStream<Uint8Array>, {
			headers: {
				'content-type': asset.mediaType,
				'cache-control': 'no-store',
				'x-content-type-options': 'nosniff',
				// SVG images must not gain the review origin's privileges when opened directly.
				'content-security-policy': "sandbox; default-src 'none'; style-src 'unsafe-inline'",
				'cross-origin-resource-policy': 'same-origin'
			}
		});
	} catch (cause) {
		await file.close();
		throw cause;
	}
};
