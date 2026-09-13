import os from 'node:os';
import path from 'node:path';
import { firstEnv } from '../config/env';

/** Root directory for durable review DB and artifact snapshots. Works in both SvelteKit and CLI contexts. */
export function reviewHome() {
	return firstEnv(['REVIEW_PLATFORM_HOME'], path.join(os.homedir(), '.review-platform'))!;
}

/** Directory containing immutable per-review/version artifacts. */
export function artifactsDir() {
	return path.join(reviewHome(), 'artifacts');
}

/** SQLite DB path planned for durable review metadata and comments. */
export function dbPath() {
	return path.join(reviewHome(), 'reviews.db');
}

export function reviewArtifactDir(reviewId: string, version: number) {
	return path.join(artifactsDir(), reviewId, `v${version}`);
}
