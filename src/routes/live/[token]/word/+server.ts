import { feedbackHome } from '$lib/server/live/snapshots';
import { readFileSync, realpathSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { error } from '@sveltejs/kit';
import { _snapshotPaths, _isWordFile } from '../+page.server';
import { convertLegacyWord, WordConversionError } from '$lib/server/documents/convertWord';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params }) => {
	const secret = process.env.ONLINE_REVIEW_URL_SECRET;
	if (!secret) throw error(503, 'Live review is not configured');

	let filePaths: string[];
	try {
		filePaths = _snapshotPaths(params.token, secret);
	} catch {
		throw error(404, 'Review not found');
	}

	if (filePaths.length !== 1) {
		throw error(400, 'Invalid Word review');
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

	if (!_isWordFile(resolved)) {
		throw error(415, 'Not a Word document');
	}

	const stats = statSync(resolved);
	if (!stats.isFile()) throw error(404, 'File not found');
	if (stats.size > 50 * 1024 * 1024) throw error(413, 'Word document exceeds 50 MiB');

	let bytes = readFileSync(resolved);
	if (path.extname(resolved).toLowerCase() === '.doc') {
		try {
			bytes = await convertLegacyWord(bytes);
		} catch (cause) {
			if (cause instanceof WordConversionError) throw error(cause.status, cause.message);
			throw cause;
		}
	}

	return new Response(bytes, {
		headers: {
			'content-type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
			'cache-control': 'no-store',
			'x-content-type-options': 'nosniff'
		}
	});
};
