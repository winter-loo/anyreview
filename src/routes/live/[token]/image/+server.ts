import { feedbackHome } from '$lib/server/live/snapshots';
import { readFileSync, realpathSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { error } from '@sveltejs/kit';
import { documentImageMediaType } from '$lib/server/publishers/document';
import { _snapshotPaths } from '../+page.server';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = ({ params, url }) => {
	const secret = process.env.ONLINE_REVIEW_URL_SECRET;
	if (!secret) throw error(503, 'Live review is not configured');

	let filePaths: string[];
	try {
		filePaths = _snapshotPaths(params.token, secret);
	} catch {
		throw error(404, 'Review not found');
	}

	const rawIndex = url.searchParams.get('index') ?? '0';
	const index = parseInt(rawIndex, 10);
	if (Number.isNaN(index) || index < 0 || index >= filePaths.length) {
		throw error(404, 'Image not found');
	}

	const targetPath = filePaths[index];
	let resolved: string;
	try {
		resolved = realpathSync(targetPath);
	} catch {
		throw error(404, 'File not found');
	}

	const home = realpathSync(process.env.HOME || homedir());
	if (!(resolved.startsWith(`${home}${path.sep}`) || resolved.startsWith(`/tmp${path.sep}`) || resolved.startsWith(`${realpathSync(feedbackHome())}${path.sep}`))) {
		throw error(403, 'File is not publishable');
	}

	const mediaType = documentImageMediaType(resolved);
	if (!mediaType) throw error(415, 'Unsupported image type');

	const stats = statSync(resolved);
	if (!stats.isFile()) throw error(404, 'File not found');
	if (stats.size > 5 * 1024 * 1024) throw error(413, 'Image exceeds 5 MiB');

	return new Response(readFileSync(resolved), {
		headers: {
			'content-type': mediaType,
			'cache-control': 'no-store',
			'x-content-type-options': 'nosniff'
		}
	});
};
