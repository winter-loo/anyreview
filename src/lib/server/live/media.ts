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

export function imageMediaType(filePath: string) {
	return IMAGE_MEDIA_TYPES[path.extname(filePath).toLowerCase()] ?? null;
}
