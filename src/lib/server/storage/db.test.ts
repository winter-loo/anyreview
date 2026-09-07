import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createReviewStore } from './db';

describe('comment text selections', () => {
	it('stores precise rendered-text anchors with the comment', () => {
		const store = createReviewStore(mkdtempSync(path.join(tmpdir(), 'reviewloop-db-')));
		const now = new Date().toISOString();
		store.insertReview({ id: 'r1', title: 'Doc', repoRoot: '/tmp/doc.md', sourceKind: 'document', sourceRef: null, status: 'in_review', createdBy: 'test', createdAt: now, updatedAt: now });
		store.addComment({
			id: 'c1',
			reviewId: 'r1',
			version: 1,
			filePath: 'doc.md',
			side: 'new',
			lineStart: 1,
			lineEnd: 1,
			textSelection: { blockId: 'L1', startOffset: 2, endOffset: 6, selectedText: 'text', prefix: 'A ', suffix: ' here' },
			pageRegion: null,
			sentAt: null,
			body: 'Clarify this',
			author: 'reviewer',
			status: 'open',
			createdAt: now,
			updatedAt: now
		});

		expect(store.listComments('r1')[0].textSelection).toEqual({ blockId: 'L1', startOffset: 2, endOffset: 6, selectedText: 'text', prefix: 'A ', suffix: ' here' });
		store.markCommentsSent(['c1'], '2026-09-05T00:00:00.000Z');
		expect(store.listComments('r1')[0].sentAt).toBe('2026-09-05T00:00:00.000Z');
		store.close();
	});
});
