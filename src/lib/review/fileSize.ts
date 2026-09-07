/**
 * Human-readable byte counts for the review UI.
 *
 * The live document viewers used to hardcode `(size / 1024 / 1024).toFixed(2)`
 * MB, which renders every file under ~5 KiB as a flat "0.00 MB" and tells a
 * reviewer nothing. Pick the unit from the magnitude instead, and drop the
 * fractional part for bytes, where a decimal is noise.
 */
export function formatFileSize(bytes: number): string {
	if (!Number.isFinite(bytes) || bytes < 0) return '未知大小';
	if (bytes < 1024) return `${Math.round(bytes)} B`;

	const units = ['KB', 'MB', 'GB', 'TB'];
	let value = bytes / 1024;
	let unitIndex = 0;
	while (value >= 1024 && unitIndex < units.length - 1) {
		value /= 1024;
		unitIndex += 1;
	}

	// Keep three significant figures: 9.83 KB, 47.2 KB, 512 KB. A fixed decimal
	// count would print either 512.00 KB or 9.8 KB depending on the choice.
	const decimals = value >= 100 ? 0 : value >= 10 ? 1 : 2;
	return `${value.toFixed(decimals)} ${units[unitIndex]}`;
}
