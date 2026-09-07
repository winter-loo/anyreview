export type ReviewStatus = 'draft' | 'in_review' | 'changes_requested' | 'approved' | 'superseded' | 'closed';

export type ReviewSourceKind = 'worktree' | 'staged' | 'show' | 'range' | 'document';

export interface ReviewRecord {
	id: string;
	title: string;
	repoRoot: string;
	sourceKind: ReviewSourceKind;
	sourceRef: string | null;
	status: ReviewStatus;
	createdBy: string;
	createdAt: string;
	updatedAt: string;
}

export interface ReviewVersionRecord {
	id: string;
	reviewId: string;
	version: number;
	baseCommit: string | null;
	headCommit: string | null;
	diffPath: string;
	filesPath: string;
	createdAt: string;
}

export type CommentSide = 'old' | 'new' | 'file';

export interface TextSelectionAnchor {
	blockId: string;
	startOffset: number;
	endOffset: number;
	selectedText: string;
	prefix: string;
	suffix: string;
}

export interface PageRegionAnchor {
	page: number;
	x: number;
	y: number;
	width: number;
	height: number;
}

export interface ReviewCommentRecord {
	id: string;
	reviewId: string;
	version: number;
	filePath: string | null;
	side: CommentSide;
	lineStart: number | null;
	lineEnd: number | null;
	textSelection: TextSelectionAnchor | null;
	pageRegion: PageRegionAnchor | null;
	sentAt: string | null;
	body: string;
	author: string;
	status: 'open' | 'resolved';
	createdAt: string;
	updatedAt: string;
}
