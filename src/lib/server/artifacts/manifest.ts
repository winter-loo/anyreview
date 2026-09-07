import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { ReviewNotificationTarget } from '../reviews/publish';
import type { ReviewRecord, ReviewVersionRecord } from '../storage/types';

export type ReviewArtifactSource =
	| { type: 'git-diff'; refKind: 'worktree' | 'staged' | 'show' | 'range'; repoRoot: string; sourceRef: string | null; baseCommit?: string | null; headCommit?: string | null }
	| { type: 'document'; path: string; format: 'markdown' | 'text' | 'html' | 'image'; repoRoot?: string | null };

export type ReviewArtifactEntry = {
	id: string;
	kind: 'file-diff' | 'document';
	path: string;
	patchPath?: string;
	artifactPath?: string;
	language?: string;
	lineCount?: number;
	patchBytes?: number;
	additions?: number;
	deletions?: number;
	status?: string;
	mediaType?: string;
	page?: number;
};

export type ReviewArtifactGroup = {
	id: string;
	kind: 'commit';
	title: string;
	sha?: string;
	entries: string[];
};

export type ReviewArtifactManifest = {
	schemaVersion: 1;
	reviewKind: 'code' | 'document';
	review: Pick<ReviewRecord, 'id' | 'title' | 'sourceKind' | 'sourceRef' | 'repoRoot'>;
	version: Pick<ReviewVersionRecord, 'version' | 'baseCommit' | 'headCommit' | 'diffPath' | 'filesPath'>;
	source: ReviewArtifactSource;
	entries: ReviewArtifactEntry[];
	groups: ReviewArtifactGroup[];
	notificationTarget?: ReviewNotificationTarget | null;
	legacyArtifacts?: Record<string, string>;
};

export function manifestPathForArtifact(filesPath: string) {
	return path.join(path.dirname(filesPath), 'manifest.json');
}

export function writeArtifactManifest(artifactDir: string, manifest: ReviewArtifactManifest) {
	const manifestPath = path.join(artifactDir, 'manifest.json');
	writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
	return manifestPath;
}

export function readArtifactManifest(filesPath: string): ReviewArtifactManifest | null {
	const manifestPath = manifestPathForArtifact(filesPath);
	if (!existsSync(manifestPath)) return null;
	return JSON.parse(readFileSync(manifestPath, 'utf8')) as ReviewArtifactManifest;
}
