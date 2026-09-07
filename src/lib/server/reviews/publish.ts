import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { artifactsDir, reviewArtifactDir } from '../storage/paths';
import type { ReviewRecord, ReviewSourceKind, ReviewVersionRecord } from '../storage/types';
import type { ReviewStore } from '../storage/db';
import { writeArtifactManifest, type ReviewArtifactManifest } from '../artifacts/manifest';
import { getHeadCommit, type GitCommitSummary } from '../git/git';
import { parseDiffFileSections, type DiffFileStat } from '../git/diffStats';
import { captureGitCommitSections, captureGitReviewDiff } from '../publishers/git-diff';
import { captureDocumentReviewSource, documentImageMediaType } from '../publishers/document';

export interface ReviewNotificationTarget {
	platform: 'discord';
	channelId: string;
	threadId?: string;
	executorMention?: string;
}

export interface PublishReviewInput {
	repoRoot: string;
	title: string;
	sourceKind: ReviewSourceKind;
	sourceRef?: string | null;
	createdBy: string;
	store: ReviewStore;
	baseUrl?: string;
	notificationTarget?: ReviewNotificationTarget | null;
}

export interface PublishReviewResult {
	review: ReviewRecord;
	version: ReviewVersionRecord;
	diff: string;
	files: DiffFileStat[];
	commits: ReviewCommitSection[];
	url: string;
}

export interface ReviewCommitSection extends GitCommitSummary {
	id: string;
	files: DiffFileStat[];
	diffPath?: string;
	patchBytes: number;
	lineCount: number;
	additions: number;
	deletions: number;
}

function timestamp() {
	return new Date().toISOString();
}

function reviewIdFromDate(now = new Date()) {
	const date = now.toISOString().slice(0, 10).replaceAll('-', '');
	const suffix = `${now.getHours()}${now.getMinutes()}${now.getSeconds()}${now.getMilliseconds()}`
		.padStart(9, '0')
		.slice(-4);
	return `CR-${date}-${suffix}`;
}

function commitId(index: number) {
	return `c${String(index + 1).padStart(6, '0')}`;
}

function prefixFileId(commit: string, fileId?: string) {
	return `${commit}-f${fileId ?? '000000'}`;
}

function summarizeFiles(files: DiffFileStat[]) {
	return files.reduce(
		(summary, file) => {
			summary.patchBytes += file.patchBytes ?? 0;
			summary.lineCount += file.lineCount ?? 0;
			summary.additions += file.additions ?? 0;
			summary.deletions += file.deletions ?? 0;
			return summary;
		},
		{ patchBytes: 0, lineCount: 0, additions: 0, deletions: 0 }
	);
}

export interface PublishDocumentReviewInput {
	title: string;
	filePath: string;
	createdBy: string;
	store: ReviewStore;
	baseUrl?: string;
	notificationTarget?: ReviewNotificationTarget | null;
}

export interface PublishDocumentReviewResult {
	review: ReviewRecord;
	version: ReviewVersionRecord;
	document: { path: string; artifactPath: string; lineCount: number };
	url: string;
}

export interface PublishImageReviewInput extends Omit<PublishDocumentReviewInput, 'filePath'> {
	filePath: string;
}

export interface PublishImageReviewResult {
	review: ReviewRecord;
	version: ReviewVersionRecord;
	document: { path: string; artifactPath: string; lineCount: 0; format: 'image'; mediaType: string; pageCount: 1 };
	url: string;
}

export function publishImageReview(input: PublishImageReviewInput): PublishImageReviewResult {
	const sourcePath = path.resolve(input.filePath);
	const mediaType = documentImageMediaType(sourcePath);
	if (!mediaType) throw new Error('Image reviews support PNG, JPEG, and WebP files');
	const now = timestamp();
	const id = reviewIdFromDate();
	const artifactDir = reviewArtifactDir(id, 1).replace(artifactsDir(), path.join(input.store.home, 'artifacts'));
	mkdirSync(artifactDir, { recursive: true });
	const artifactPath = path.join(artifactDir, `page-1${path.extname(sourcePath).toLowerCase()}`);
	const filesPath = path.join(artifactDir, 'document.json');
	const metadataPath = path.join(artifactDir, 'metadata.json');
	const review: ReviewRecord = {
		id, title: input.title, repoRoot: path.dirname(sourcePath), sourceKind: 'document', sourceRef: sourcePath,
		status: 'in_review', createdBy: input.createdBy, createdAt: now, updatedAt: now
	};
	const version: ReviewVersionRecord = {
		id: `${id}-v1`, reviewId: id, version: 1, baseCommit: null, headCommit: null,
		diffPath: artifactPath, filesPath, createdAt: now
	};
	const document = { path: sourcePath, artifactPath, lineCount: 0 as const, format: 'image' as const, mediaType, pageCount: 1 as const };
	const manifest: ReviewArtifactManifest = {
		schemaVersion: 1,
		reviewKind: 'document',
		review: { id: review.id, title: review.title, sourceKind: review.sourceKind, sourceRef: review.sourceRef, repoRoot: review.repoRoot },
		version: { version: 1, baseCommit: null, headCommit: null, diffPath: artifactPath, filesPath },
		source: { type: 'document', path: sourcePath, format: 'image', repoRoot: path.dirname(sourcePath) },
		entries: [{ id: 'page-1', kind: 'document', path: sourcePath, artifactPath, mediaType, page: 1 }],
		groups: [],
		notificationTarget: input.notificationTarget ?? null,
		legacyArtifacts: { document: artifactPath, files: filesPath, metadata: metadataPath }
	};
	copyFileSync(sourcePath, artifactPath);
	writeFileSync(filesPath, JSON.stringify({ document }, null, 2), 'utf8');
	writeArtifactManifest(artifactDir, manifest);
	writeFileSync(metadataPath, JSON.stringify({ review, version, document, notificationTarget: input.notificationTarget ?? null }, null, 2), 'utf8');
	input.store.insertReview(review);
	input.store.insertVersion(version);
	const baseUrl = input.baseUrl ?? 'http://localhost:5173';
	return { review, version, document, url: `${baseUrl}/document-reviews/${id}` };
}

export function publishDocumentReview(input: PublishDocumentReviewInput): PublishDocumentReviewResult {
	const now = timestamp();
	const id = reviewIdFromDate();
	const { sourcePath, content: markdown, lineCount } = captureDocumentReviewSource({ filePath: input.filePath, format: 'markdown' });
	const artifactDir = reviewArtifactDir(id, 1).replace(artifactsDir(), path.join(input.store.home, 'artifacts'));
	mkdirSync(artifactDir, { recursive: true });

	const markdownPath = path.join(artifactDir, 'document.md');
	const filesPath = path.join(artifactDir, 'document.json');
	const metadataPath = path.join(artifactDir, 'metadata.json');
	const review: ReviewRecord = {
		id,
		title: input.title,
		repoRoot: path.dirname(sourcePath),
		sourceKind: 'document',
		sourceRef: sourcePath,
		status: 'in_review',
		createdBy: input.createdBy,
		createdAt: now,
		updatedAt: now
	};
	const version: ReviewVersionRecord = {
		id: `${id}-v1`,
		reviewId: id,
		version: 1,
		baseCommit: null,
		headCommit: null,
		diffPath: markdownPath,
		filesPath,
		createdAt: now
	};
	const document = { path: sourcePath, artifactPath: markdownPath, lineCount };
	const manifest: ReviewArtifactManifest = {
		schemaVersion: 1,
		reviewKind: 'document',
		review: { id: review.id, title: review.title, sourceKind: review.sourceKind, sourceRef: review.sourceRef, repoRoot: review.repoRoot },
		version: { version: version.version, baseCommit: version.baseCommit, headCommit: version.headCommit, diffPath: version.diffPath, filesPath: version.filesPath },
		source: { type: 'document', path: sourcePath, format: 'markdown', repoRoot: path.dirname(sourcePath) },
		entries: [{ id: 'document', kind: 'document', path: sourcePath, artifactPath: markdownPath, language: 'markdown', lineCount }],
		groups: [],
		notificationTarget: input.notificationTarget ?? null,
		legacyArtifacts: { document: markdownPath, files: filesPath, metadata: metadataPath }
	};
	writeFileSync(markdownPath, markdown, 'utf8');
	writeFileSync(filesPath, JSON.stringify({ document }, null, 2), 'utf8');
	writeArtifactManifest(artifactDir, manifest);
	writeFileSync(metadataPath, JSON.stringify({ review, version, document, manifestPath: path.join(artifactDir, 'manifest.json'), notificationTarget: input.notificationTarget ?? null }, null, 2), 'utf8');
	input.store.insertReview(review);
	input.store.insertVersion(version);
	const baseUrl = input.baseUrl ?? 'http://localhost:5173';
	return { review, version, document, url: `${baseUrl}/document-reviews/${id}` };
}

export async function publishReview(input: PublishReviewInput): Promise<PublishReviewResult> {
	const now = timestamp();
	const id = reviewIdFromDate();
	if (input.sourceKind === 'document') throw new Error('Use publishDocumentReview for document sources');
	const gitSource = { repoRoot: input.repoRoot, sourceKind: input.sourceKind, sourceRef: input.sourceRef ?? null };
	const headCommit = await getHeadCommit(input.repoRoot).catch(() => null);
	const diff = await captureGitReviewDiff(gitSource);
	const commitDiffs = await captureGitCommitSections(gitSource);
	const artifactDir = reviewArtifactDir(id, 1).replace(artifactsDir(), path.join(input.store.home, 'artifacts'));
	const fileArtifactsDir = path.join(artifactDir, 'files');
	const commitArtifactsDir = path.join(artifactDir, 'commits');
	mkdirSync(fileArtifactsDir, { recursive: true });
	mkdirSync(commitArtifactsDir, { recursive: true });

	const diffPath = path.join(artifactDir, 'diff.patch');
	let commitFiles: DiffFileStat[] = [];
	const commits: ReviewCommitSection[] = commitDiffs.map(({ diff: commitDiff, ...commit }, index) => {
		const id = commitId(index);
		const diffPath = path.join(commitArtifactsDir, `${id}.patch`);
		const filesInCommit = parseDiffFileSections(commitDiff).map(({ patch, ...file }) => {
			const fileId = prefixFileId(id, file.id);
			const patchPath = path.join(fileArtifactsDir, `${fileId}.patch`);
			writeFileSync(patchPath, patch, 'utf8');
			return { ...file, id: fileId, patchPath } satisfies DiffFileStat;
		});
		writeFileSync(diffPath, commitDiff, 'utf8');
		commitFiles = [...commitFiles, ...filesInCommit];
		return { ...commit, id, files: filesInCommit, diffPath, ...summarizeFiles(filesInCommit) };
	});

	// The top-level files artifact powers the review page's All/Combined view,
	// so store the combined range/worktree patch rather than per-commit patches.
	let files: DiffFileStat[] = parseDiffFileSections(diff).map(({ patch, ...file }) => {
		const patchPath = path.join(fileArtifactsDir, `${file.id}.patch`);
		writeFileSync(patchPath, patch, 'utf8');
		return { ...file, patchPath } satisfies DiffFileStat;
	});

	if (files.length === 0 && commitFiles.length > 0) {
		files = commitFiles;
	}

	const filesPath = path.join(artifactDir, 'files.json');
	const commitsPath = path.join(artifactDir, 'commits.json');
	const metadataPath = path.join(artifactDir, 'metadata.json');

	const review: ReviewRecord = {
		id,
		title: input.title,
		repoRoot: input.repoRoot,
		sourceKind: input.sourceKind,
		sourceRef: input.sourceRef ?? null,
		status: 'in_review',
		createdBy: input.createdBy,
		createdAt: now,
		updatedAt: now
	};

	const version: ReviewVersionRecord = {
		id: `${id}-v1`,
		reviewId: id,
		version: 1,
		baseCommit: null,
		headCommit,
		diffPath,
		filesPath,
		createdAt: now
	};

	writeFileSync(diffPath, diff, 'utf8');
	writeFileSync(filesPath, JSON.stringify(files, null, 2), 'utf8');
	writeFileSync(commitsPath, JSON.stringify(commits, null, 2), 'utf8');
	const manifest: ReviewArtifactManifest = {
		schemaVersion: 1,
		reviewKind: 'code',
		review: { id: review.id, title: review.title, sourceKind: review.sourceKind, sourceRef: review.sourceRef, repoRoot: review.repoRoot },
		version: { version: version.version, baseCommit: version.baseCommit, headCommit: version.headCommit, diffPath: version.diffPath, filesPath: version.filesPath },
		source: {
			type: 'git-diff',
			refKind: input.sourceKind as 'worktree' | 'staged' | 'show' | 'range',
			repoRoot: input.repoRoot,
			sourceRef: input.sourceRef ?? null,
			headCommit
		},
		entries: files.map((file) => ({
			id: file.id ?? file.path,
			kind: 'file-diff',
			path: file.path,
			patchPath: file.patchPath,
			lineCount: file.lineCount,
			patchBytes: file.patchBytes,
			additions: file.additions,
			deletions: file.deletions,
			status: file.status
		})),
		groups: commits.map((commit) => ({ id: commit.id, kind: 'commit', title: commit.subject, sha: commit.sha, entries: commit.files.map((file) => file.id ?? file.path) })),
		notificationTarget: input.notificationTarget ?? null,
		legacyArtifacts: { diff: diffPath, files: filesPath, commits: commitsPath, metadata: metadataPath }
	};
	writeArtifactManifest(artifactDir, manifest);
	writeFileSync(metadataPath, JSON.stringify({ review, version, commitsPath, manifestPath: path.join(artifactDir, 'manifest.json'), notificationTarget: input.notificationTarget ?? null }, null, 2), 'utf8');
	input.store.insertReview(review);
	input.store.insertVersion(version);

	const baseUrl = input.baseUrl ?? 'http://localhost:5173';
	return { review, version, diff, files, commits, url: `${baseUrl}/reviews/${id}` };
}
