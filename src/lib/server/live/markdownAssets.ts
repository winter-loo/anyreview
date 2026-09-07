import { createHash } from 'node:crypto';
import { readFileSync, realpathSync, statSync } from 'node:fs';
import path from 'node:path';
import { error } from '@sveltejs/kit';
import { markdownImageSources } from '$lib/server/markdown/render';
import { documentImageMediaType } from '$lib/server/publishers/document';
import { decodePaths, liveSnapshot } from './snapshots';

export function isLocalMarkdownImage(src: string) {
	return !!src && !src.startsWith('//') && !src.startsWith('#') && !/^[a-z][a-z\d+.-]*:/i.test(src);
}

export function markdownImageId(src: string) {
	return createHash('sha256').update(src).digest('hex');
}

export function markdownImageUrl(token: string, src: string) {
	return isLocalMarkdownImage(src) ? `/live/${encodeURIComponent(token)}/assets/${markdownImageId(src)}` : src;
}

/** Resolve only images referenced in this review's frozen Markdown, from its original directory. */
export function resolveMarkdownAsset(token: string, assetId: string) {
	if (!/^[a-f0-9]{64}$/.test(assetId)) throw error(404, 'Image not found');
	const snapshot = liveSnapshot(token);
	if (snapshot.kind !== 'markdown' || snapshot.files.length !== 1) throw error(404, 'Image not found');
	const markdownPath = snapshot.files[0].snapshotPath;
	if (statSync(markdownPath).size > 5 * 1024 * 1024) throw error(413, 'Document exceeds 5 MiB');
	const src = markdownImageSources(readFileSync(markdownPath, 'utf8'))
		.find(candidate => isLocalMarkdownImage(candidate) && markdownImageId(candidate) === assetId);
	if (!src) throw error(404, 'Image is not referenced by this review');

	const originalPaths = decodePaths(token, process.env.ONLINE_REVIEW_URL_SECRET!);
	let root: string, resolved: string;
	try {
		root = realpathSync(path.dirname(originalPaths[0]));
		// Strip URL query/fragment before decoding, preserving percent-encoded characters in filenames.
		const pathname = decodeURIComponent(src.split(/[?#]/, 1)[0]);
		resolved = realpathSync(path.resolve(root, pathname));
	} catch {
		throw error(404, 'Image file is unavailable');
	}
	const relative = path.relative(root, resolved);
	if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
		throw error(403, 'Image must be inside the reviewed document directory');
	}
	const mediaType = documentImageMediaType(resolved);
	if (!mediaType) throw error(415, 'Unsupported image type');
	return { path: resolved, mediaType };
}
