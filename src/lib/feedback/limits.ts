// Shared by the browser queue and feedback API so generated previews stay uploadable.
export const MAX_PREVIEW_BYTES = 2 * 1024 * 1024;
export const MAX_FEEDBACK_REQUEST_BYTES = 4 * 1024 * 1024;

export function pngPreviewBytes(preview: string): number {
 const prefix = 'data:image/png;base64,';
 if (!preview.startsWith(prefix)) return Infinity;
 const padding = preview.endsWith('==') ? 2 : preview.endsWith('=') ? 1 : 0;
 return (preview.length - prefix.length) * 3 / 4 - padding;
}
