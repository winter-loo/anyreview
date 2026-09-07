import { DatabaseSync } from 'node:sqlite';
import type { SQLInputValue } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { dbPath as defaultDbPath } from './paths';
import { schemaSql } from './schema';
import type { ReviewCommentRecord, ReviewRecord, ReviewVersionRecord } from './types';

function toReview(row: Record<string, unknown>): ReviewRecord {
	return {
		id: String(row.id),
		title: String(row.title),
		repoRoot: String(row.repo_root),
		sourceKind: row.source_kind as ReviewRecord['sourceKind'],
		sourceRef: row.source_ref === null ? null : String(row.source_ref),
		status: row.status as ReviewRecord['status'],
		createdBy: String(row.created_by),
		createdAt: String(row.created_at),
		updatedAt: String(row.updated_at)
	};
}

function toVersion(row: Record<string, unknown>): ReviewVersionRecord {
	return {
		id: String(row.id),
		reviewId: String(row.review_id),
		version: Number(row.version),
		baseCommit: row.base_commit === null ? null : String(row.base_commit),
		headCommit: row.head_commit === null ? null : String(row.head_commit),
		diffPath: String(row.diff_path),
		filesPath: String(row.files_path),
		createdAt: String(row.created_at)
	};
}

function toComment(row: Record<string, unknown>): ReviewCommentRecord {
	return {
		id: String(row.id),
		reviewId: String(row.review_id),
		version: Number(row.version),
		filePath: row.file_path === null ? null : String(row.file_path),
		side: row.side as ReviewCommentRecord['side'],
		lineStart: row.line_start === null ? null : Number(row.line_start),
		lineEnd: row.line_end === null ? null : Number(row.line_end),
		textSelection:
			row.block_id === null || row.block_id === undefined
				? null
				: {
						blockId: String(row.block_id),
						startOffset: Number(row.start_offset),
						endOffset: Number(row.end_offset),
						selectedText: String(row.selected_text),
						prefix: String(row.prefix),
						suffix: String(row.suffix)
					},
		pageRegion:
			row.region_page === null || row.region_page === undefined
				? null
				: {
						page: Number(row.region_page),
						x: Number(row.region_x),
						y: Number(row.region_y),
						width: Number(row.region_width),
						height: Number(row.region_height)
					},
		sentAt: row.sent_at === null || row.sent_at === undefined ? null : String(row.sent_at),
		body: String(row.body),
		author: String(row.author),
		status: row.status as ReviewCommentRecord['status'],
		createdAt: String(row.created_at),
		updatedAt: String(row.updated_at)
	};
}

function sqlParams(values: Record<string, SQLInputValue>): Record<string, SQLInputValue> {
	return values;
}

export interface ReviewStore {
	home: string;
	db: DatabaseSync;
	insertReview(review: ReviewRecord): void;
	insertVersion(version: ReviewVersionRecord): void;
	listReviews(): ReviewRecord[];
	getReview(id: string): ReviewRecord | null;
	getLatestVersion(reviewId: string): ReviewVersionRecord | null;
	listComments(reviewId: string): ReviewCommentRecord[];
	addComment(comment: ReviewCommentRecord): void;
	markCommentsSent(commentIds: string[], sentAt: string): void;
	close(): void;
}

export function createReviewStore(home?: string): ReviewStore {
	const resolvedHome = home ?? path.dirname(defaultDbPath());
	mkdirSync(resolvedHome, { recursive: true });
	const db = new DatabaseSync(path.join(resolvedHome, 'reviews.db'));
	db.exec('PRAGMA journal_mode = WAL');
	db.exec('PRAGMA foreign_keys = ON');
	db.exec(schemaSql);

	return {
		home: resolvedHome,
		db,
		insertReview(review) {
			db.prepare(
				`INSERT INTO reviews (id, title, repo_root, source_kind, source_ref, status, created_by, created_at, updated_at)
				 VALUES (@id, @title, @repoRoot, @sourceKind, @sourceRef, @status, @createdBy, @createdAt, @updatedAt)`
			).run(
				sqlParams({
					id: review.id,
					title: review.title,
					repoRoot: review.repoRoot,
					sourceKind: review.sourceKind,
					sourceRef: review.sourceRef,
					status: review.status,
					createdBy: review.createdBy,
					createdAt: review.createdAt,
					updatedAt: review.updatedAt
				})
			);
		},
		insertVersion(version) {
			db.prepare(
				`INSERT INTO review_versions (id, review_id, version, base_commit, head_commit, diff_path, files_path, created_at)
				 VALUES (@id, @reviewId, @version, @baseCommit, @headCommit, @diffPath, @filesPath, @createdAt)`
			).run(
				sqlParams({
					id: version.id,
					reviewId: version.reviewId,
					version: version.version,
					baseCommit: version.baseCommit,
					headCommit: version.headCommit,
					diffPath: version.diffPath,
					filesPath: version.filesPath,
					createdAt: version.createdAt
				})
			);
		},
		listReviews() {
			return db.prepare('SELECT * FROM reviews ORDER BY updated_at DESC').all().map((row) => toReview(row as Record<string, unknown>));
		},
		getReview(id) {
			const row = db.prepare('SELECT * FROM reviews WHERE id = ?').get(id);
			return row ? toReview(row as Record<string, unknown>) : null;
		},
		getLatestVersion(reviewId) {
			const row = db
				.prepare('SELECT * FROM review_versions WHERE review_id = ? ORDER BY version DESC LIMIT 1')
				.get(reviewId);
			return row ? toVersion(row as Record<string, unknown>) : null;
		},
		listComments(reviewId) {
			return db
				.prepare(
					`SELECT comments.*, selection.block_id, selection.start_offset, selection.end_offset,
						selection.selected_text, selection.prefix, selection.suffix,
						region.page AS region_page, region.x AS region_x, region.y AS region_y,
						region.width AS region_width, region.height AS region_height,
						COALESCE(selection.sent_at, region.sent_at) AS sent_at
					 FROM comments
					 LEFT JOIN comment_text_selections AS selection ON selection.comment_id = comments.id
					 LEFT JOIN comment_page_regions AS region ON region.comment_id = comments.id
					 WHERE comments.review_id = ?
					 ORDER BY comments.created_at ASC`
				)
				.all(reviewId)
				.map((row) => toComment(row as Record<string, unknown>));
		},
		addComment(comment) {
			db.exec('BEGIN IMMEDIATE');
			try {
				db.prepare(
					`INSERT INTO comments (id, review_id, version, file_path, side, line_start, line_end, body, author, status, created_at, updated_at)
					 VALUES (@id, @reviewId, @version, @filePath, @side, @lineStart, @lineEnd, @body, @author, @status, @createdAt, @updatedAt)`
				).run(
					sqlParams({
					id: comment.id,
					reviewId: comment.reviewId,
					version: comment.version,
					filePath: comment.filePath,
					side: comment.side,
					lineStart: comment.lineStart,
					lineEnd: comment.lineEnd,
					body: comment.body,
					author: comment.author,
					status: comment.status,
					createdAt: comment.createdAt,
					updatedAt: comment.updatedAt
					})
				);
				if (comment.textSelection) {
					db.prepare(
						`INSERT INTO comment_text_selections (comment_id, block_id, start_offset, end_offset, selected_text, prefix, suffix)
						 VALUES (@commentId, @blockId, @startOffset, @endOffset, @selectedText, @prefix, @suffix)`
					).run(sqlParams({ commentId: comment.id, ...comment.textSelection }));
				}
				if (comment.pageRegion) {
					db.prepare(
						`INSERT INTO comment_page_regions (comment_id, page, x, y, width, height)
						 VALUES (@commentId, @page, @x, @y, @width, @height)`
					).run(sqlParams({ commentId: comment.id, ...comment.pageRegion }));
				}
				db.exec('COMMIT');
			} catch (cause) {
				db.exec('ROLLBACK');
				throw cause;
			}
		},
		markCommentsSent(commentIds, sentAt) {
			const textStatement = db.prepare('UPDATE comment_text_selections SET sent_at = ? WHERE comment_id = ?');
			const regionStatement = db.prepare('UPDATE comment_page_regions SET sent_at = ? WHERE comment_id = ?');
			db.exec('BEGIN IMMEDIATE');
			try {
				for (const commentId of commentIds) {
					textStatement.run(sentAt, commentId);
					regionStatement.run(sentAt, commentId);
				}
				db.exec('COMMIT');
			} catch (cause) {
				db.exec('ROLLBACK');
				throw cause;
			}
		},
		close() {
			db.close();
		}
	};
}
