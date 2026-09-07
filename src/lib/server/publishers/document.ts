import { readFileSync } from 'node:fs';
import path from 'node:path';

const IMAGE_MEDIA_TYPES: Record<string, string> = {
	'.png': 'image/png',
	'.jpg': 'image/jpeg',
	'.jpeg': 'image/jpeg',
	'.webp': 'image/webp',
	'.gif': 'image/gif',
	'.svg': 'image/svg+xml',
	'.bmp': 'image/bmp',
	'.avif': 'image/avif'
};

export type DocumentReviewSource = {
	filePath: string;
	format?: 'markdown' | 'text' | 'html';
};

export function captureDocumentReviewSource(source: DocumentReviewSource) {
	const sourcePath = path.resolve(source.filePath);
	const content = readFileSync(sourcePath, 'utf8');
	return {
		sourcePath,
		content,
		format: source.format ?? 'markdown',
		lineCount: content.split('\n').length
	};
}

export function documentImageMediaType(filePath: string) {
	return IMAGE_MEDIA_TYPES[path.extname(filePath).toLowerCase()] ?? null;
}
