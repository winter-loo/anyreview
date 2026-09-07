import { describe, expect, it } from 'vitest';
import { formatFileSize } from './fileSize';

describe('formatFileSize', () => {
	it('keeps small files legible instead of collapsing them to 0.00 MB', () => {
		// The sample PDF that exposed the bug: it used to render as "0.00 MB".
		expect(formatFileSize(3684)).toBe('3.60 KB');
		expect(formatFileSize(21_600)).toBe('21.1 KB');
	});

	it('reports raw bytes without a misleading decimal', () => {
		expect(formatFileSize(0)).toBe('0 B');
		expect(formatFileSize(1)).toBe('1 B');
		expect(formatFileSize(1023)).toBe('1023 B');
	});

	it('steps up a unit exactly at the boundary', () => {
		expect(formatFileSize(1024)).toBe('1.00 KB');
		expect(formatFileSize(1024 * 1024)).toBe('1.00 MB');
		expect(formatFileSize(1024 * 1024 * 1024)).toBe('1.00 GB');
	});

	it('trades decimals for magnitude so the width stays stable', () => {
		expect(formatFileSize(1024 * 9.83)).toBe('9.83 KB');
		expect(formatFileSize(1024 * 47.25)).toBe('47.3 KB');
		expect(formatFileSize(1024 * 512)).toBe('512 KB');
	});

	it('caps at TB rather than inventing units', () => {
		expect(formatFileSize(1024 ** 5)).toBe('1024 TB');
	});

	it('does not pretend to know the size of a bad value', () => {
		expect(formatFileSize(-1)).toBe('未知大小');
		expect(formatFileSize(Number.NaN)).toBe('未知大小');
		expect(formatFileSize(Number.POSITIVE_INFINITY)).toBe('未知大小');
	});
});
