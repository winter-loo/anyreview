import type { ReviewCommentRecord } from '../storage/types';

export type ReviewAnchor =
	| { type: 'diff-line'; path: string; side: 'old' | 'new'; lineStart: number; lineEnd: number }
	| {
			type: 'document-text';
			path: string;
			documentVersion: number;
			lineStart: number;
			lineEnd: number;
			blockId: string;
			startOffset: number;
			endOffset: number;
			selectedText: string;
			prefix: string;
			suffix: string;
		}
	| {
			type: 'page-region';
			path: string;
			documentVersion: number;
			page: number;
			region: { x: number; y: number; width: number; height: number; coordinateSpace: 'normalized' };
		}
	| { type: 'document-line'; path: string; lineStart: number; lineEnd: number }
	| { type: 'file'; path: string }
	| { type: 'review' };

export function anchorFromLegacyComment(comment: ReviewCommentRecord, reviewKind?: 'code' | 'document'): ReviewAnchor {
	if (!comment.filePath) return { type: 'review' };
	if (reviewKind === 'document' && comment.pageRegion) {
		const { page, ...region } = comment.pageRegion;
		return { type: 'page-region', path: comment.filePath, documentVersion: comment.version, page, region: { ...region, coordinateSpace: 'normalized' } };
	}
	if (reviewKind === 'document' && comment.lineStart && comment.textSelection) {
		return {
			type: 'document-text',
			path: comment.filePath,
			documentVersion: comment.version,
			lineStart: comment.lineStart,
			lineEnd: comment.lineEnd ?? comment.lineStart,
			...comment.textSelection
		};
	}
	if (!comment.lineStart) return { type: 'file', path: comment.filePath };
	const lineEnd = comment.lineEnd ?? comment.lineStart;
	if (reviewKind === 'document') {
		return { type: 'document-line', path: comment.filePath, lineStart: comment.lineStart, lineEnd };
	}
	return {
		type: 'diff-line',
		path: comment.filePath,
		side: comment.side === 'old' ? 'old' : 'new',
		lineStart: comment.lineStart,
		lineEnd
	};
}

export function commentWithAnchor(comment: ReviewCommentRecord, reviewKind?: 'code' | 'document') {
	return { ...comment, anchor: anchorFromLegacyComment(comment, reviewKind) };
}
