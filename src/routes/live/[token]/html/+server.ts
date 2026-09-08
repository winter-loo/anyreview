import { feedbackHome } from '$lib/server/live/snapshots';
import { readFileSync, realpathSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { error } from '@sveltejs/kit';
import { _snapshotPaths, _isHtmlFile } from '../+page.server';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = ({ params }) => {
	const secret = process.env.ONLINE_REVIEW_URL_SECRET;
	if (!secret) throw error(503, 'Live review is not configured');

	let filePaths: string[];
	try {
		filePaths = _snapshotPaths(params.token, secret);
	} catch {
		throw error(404, 'Review not found');
	}

	if (filePaths.length !== 1) {
		throw error(400, 'Invalid HTML review');
	}

	const targetPath = filePaths[0];
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

	if (!_isHtmlFile(resolved)) {
		throw error(415, 'Not an HTML file');
	}

	const stats = statSync(resolved);
	if (!stats.isFile()) throw error(404, 'File not found');
	if (stats.size > 5 * 1024 * 1024) throw error(413, 'HTML exceeds 5 MiB');

	return new Response(readFileSync(resolved), {
		headers: {
			'content-type': 'text/html; charset=utf-8',
			'cache-control': 'no-store',
			'content-security-policy': "frame-ancestors 'self'",
			'referrer-policy': 'no-referrer',
			'x-content-type-options': 'nosniff'
		}
	});
};
