import { readFileSync, realpathSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { error } from '@sveltejs/kit';
import { _pathsFromToken, _isPptFile } from '../+page.server';
import { convertLegacyPpt, PptConversionError } from '$lib/server/documents/convertPpt';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params }) => {
	const secret = process.env.ONLINE_REVIEW_URL_SECRET;
	if (!secret) throw error(503, 'Live review is not configured');

	let filePaths: string[];
	try {
		filePaths = _pathsFromToken(params.token, secret);
	} catch {
		throw error(404, 'Review not found');
	}

	if (filePaths.length !== 1) {
		throw error(400, 'Invalid PowerPoint review');
	}

	const targetPath = filePaths[0];
	let resolved: string;
	try {
		resolved = realpathSync(targetPath);
	} catch {
		throw error(404, 'File not found');
	}

	const home = realpathSync(process.env.HOME || homedir());
	if (!(resolved.startsWith(`${home}${path.sep}`) || resolved.startsWith(`/tmp${path.sep}`))) {
		throw error(403, 'File is not publishable');
	}

	if (!_isPptFile(resolved)) {
		throw error(415, 'Not a PowerPoint presentation');
	}

	const stats = statSync(resolved);
	if (!stats.isFile()) throw error(404, 'File not found');
	if (stats.size > 50 * 1024 * 1024) throw error(413, 'PowerPoint file exceeds 50 MiB');

	let bytes = readFileSync(resolved);
	if (path.extname(resolved).toLowerCase() === '.ppt') {
		try {
			bytes = await convertLegacyPpt(bytes);
		} catch (cause) {
			if (cause instanceof PptConversionError) throw error(cause.status, cause.message);
			throw cause;
		}
	}

	return new Response(bytes, {
		headers: {
			'content-type': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
			'cache-control': 'no-store',
			'x-content-type-options': 'nosniff'
		}
	});
};
