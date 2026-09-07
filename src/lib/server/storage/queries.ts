import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { readArtifactManifest } from '../artifacts/manifest';
import { parseDiffFileSections, parseDiffFileStats } from '../git/diffStats';
import { getReviewStore } from './store';

const LARGE_PATCH_BYTES = 1024 * 1024;

export class ReviewArtifactReadError extends Error {
	constructor(
		message: string,
		public readonly cause: unknown
	) {
		super(message);
		this.name = 'ReviewArtifactReadError';
	}
}

function readTextArtifact(filePath: string, artifactKind: string) {
	try {
		return readFileSync(filePath, 'utf8');
	} catch (cause) {
		throw new ReviewArtifactReadError(`Unable to read ${artifactKind} artifact`, cause);
	}
}

function readFilesArtifact(filePath: string) {
	const raw = readTextArtifact(filePath, 'files');
	try {
		return JSON.parse(raw);
	} catch (cause) {
		throw new ReviewArtifactReadError('Unable to parse files artifact', cause);
	}
}

function readCommitsArtifact(filesPath: string) {
	const commitsPath = path.join(path.dirname(filesPath), 'commits.json');
	if (!existsSync(commitsPath)) return [];
	const raw = readTextArtifact(commitsPath, 'commits');
	try {
		return JSON.parse(raw);
	} catch (cause) {
		throw new ReviewArtifactReadError('Unable to parse commits artifact', cause);
	}
}

function normalizeLargeFlag<T extends { patchBytes?: number; tooLarge?: boolean }>(file: T): T {
	// Older review artifacts briefly marked generated-like files as tooLarge even
	// when their per-file patch was tiny. The UI contract is now strict: only
	// patches over 1 MiB are collapsed.
	return { ...file, tooLarge: (file.patchBytes ?? 0) > LARGE_PATCH_BYTES };
}

function normalizeCommitLargeFlags<T extends { files?: Array<{ patchBytes?: number; tooLarge?: boolean }> }>(commit: T): T {
	return { ...commit, files: commit.files?.map(normalizeLargeFlag) ?? [] };
}

export function getDocumentReviewDetail(reviewId: string) {
	const store = getReviewStore();
	const review = store.getReview(reviewId);
	if (!review || review.sourceKind !== 'document') return null;
	const latestVersion = store.getLatestVersion(reviewId);
	if (!latestVersion) return null;
	const manifest = readArtifactManifest(latestVersion.filesPath);
	const format = manifest?.source.type === 'document' ? manifest.source.format : 'markdown';
	const markdown = format === 'image' ? '' : readTextArtifact(latestVersion.diffPath, 'document markdown');
	let document: {
		path: string;
		artifactPath: string;
		lineCount: number;
		format: 'markdown' | 'text' | 'html' | 'image';
		mediaType?: string;
		pageCount?: number;
	} = {
		path: review.sourceRef ?? 'document.md',
		artifactPath: latestVersion.diffPath,
		lineCount: markdown ? markdown.split('\n').length : 0,
		format
	};
	if (manifest?.reviewKind === 'document') {
		const entry = manifest.entries.find((item) => item.kind === 'document');
		if (entry) {
			document = {
				...document,
				path: entry.path,
				artifactPath: entry.artifactPath ?? latestVersion.diffPath,
				lineCount: entry.lineCount ?? document.lineCount,
				mediaType: entry.mediaType,
				pageCount: entry.page ? 1 : undefined
			};
		}
	}
	try {
		const parsed = readFilesArtifact(latestVersion.filesPath);
		if (parsed?.document) document = { ...document, ...parsed.document };
	} catch {
		// The immutable source artifact is enough to render a document review.
	}
	return { review, latestVersion, document, markdown, manifest };
}

export function getReviewDetail(reviewId: string) {
	const store = getReviewStore();
	const review = store.getReview(reviewId);
	if (!review) return null;
	// Keep generic review endpoints usable for document reviews too. Document
	// artifacts store files.json as an object, not the code-review file array.
	if (review.sourceKind === 'document') {
		const documentDetail = getDocumentReviewDetail(reviewId);
		return documentDetail ? { ...documentDetail, files: [], commits: [] } : null;
	}
	const latestVersion = store.getLatestVersion(reviewId);
	const manifest = latestVersion ? readArtifactManifest(latestVersion.filesPath) : null;
	let files = latestVersion ? readFilesArtifact(latestVersion.filesPath).map(normalizeLargeFlag) : [];
	const commits = latestVersion ? readCommitsArtifact(latestVersion.filesPath).map(normalizeCommitLargeFlags) : [];
	// The top-level file list represents the combined range patch shown by the
	// "All commits" row. Older range snapshots stored a concatenation of each
	// individual commit's files in files.json, so rebuild the combined local
	// commits patch metadata from diff.patch whenever commit sections exist.
	if (latestVersion && commits.length > 0) {
		files = parseDiffFileStats(readTextArtifact(latestVersion.diffPath, 'diff')).map(normalizeLargeFlag);
	}
	// Backward compatibility: old snapshots only stored path/addition metadata.
	// Rebuild lightweight per-file metadata from the raw patch without sending the full diff in SSR data.
	if (latestVersion && files.some((file: { id?: string }) => !file.id)) {
		files = parseDiffFileStats(readTextArtifact(latestVersion.diffPath, 'diff')).map(normalizeLargeFlag);
	}
	return { review, latestVersion, files, commits, manifest };
}

export function getReviewDiff(reviewId: string, version: number) {
	const store = getReviewStore();
	const latestVersion = store.getLatestVersion(reviewId);
	if (!latestVersion || latestVersion.version !== version) return null;
	return readTextArtifact(latestVersion.diffPath, 'diff');
}

export function getReviewFileDiff(reviewId: string, version: number, fileId: string) {
	const store = getReviewStore();
	const latestVersion = store.getLatestVersion(reviewId);
	if (!latestVersion || latestVersion.version !== version) return null;
	const files = readFilesArtifact(latestVersion.filesPath);
	const file = files.find((entry: { id?: string }) => entry.id === fileId);
	if (file?.patchPath) return readTextArtifact(file.patchPath, 'file diff');

	const commits = readCommitsArtifact(latestVersion.filesPath);
	for (const commit of commits) {
		const commitFile = commit.files?.find((entry: { id?: string }) => entry.id === fileId);
		if (commitFile?.patchPath) return readTextArtifact(commitFile.patchPath, 'commit file diff');
	}

	// Backward compatibility for snapshots created before per-file artifacts were written.
	const section = parseDiffFileSections(readTextArtifact(latestVersion.diffPath, 'diff')).find((entry) => entry.id === fileId);
	return section?.patch ?? null;
}
