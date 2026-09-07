import { createCipheriv, createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
const converter = vi.hoisted(() => vi.fn());
vi.mock('$lib/server/documents/convertWord', async (original) => ({
	...await original<typeof import('$lib/server/documents/convertWord')>(),
	convertLegacyWord: converter
}));
import { GET } from './+server';
import { WordConversionError } from '$lib/server/documents/convertWord';

function event(extension: string) {
	const secret = 'word-endpoint-test';
	vi.stubEnv('ONLINE_REVIEW_URL_SECRET', secret);
	const iv = Buffer.alloc(12, 2);
	const cipher = createCipheriv('aes-256-gcm', createHash('sha256').update(secret).digest(), iv);
	const encrypted = Buffer.concat([cipher.update(path.resolve(`samples/documents/reviewloop-prd.${extension}`)), cipher.final()]);
	return { params: { token: Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64url') } } as any;
}
afterEach(() => { vi.unstubAllEnvs(); converter.mockReset(); });
describe('Word preview endpoint', () => {
	it('serves converted DOCX bytes for a binary DOC source', async () => {
		const converted = readFileSync('samples/documents/reviewloop-prd.docx');
		converter.mockResolvedValue(converted);
		const response = await GET(event('doc'));
		expect(converter).toHaveBeenCalledWith(readFileSync('samples/documents/reviewloop-prd.doc'));
		expect(Buffer.from(await response.arrayBuffer())).toEqual(converted);
		expect(response.headers.get('content-type')).toBe('application/vnd.openxmlformats-officedocument.wordprocessingml.document');
		expect(response.headers.get('cache-control')).toBe('no-store');
	});
	it('passes DOCX through without requiring LibreOffice', async () => {
		const response = await GET(event('docx'));
		expect(Buffer.from(await response.arrayBuffer())).toEqual(readFileSync('samples/documents/reviewloop-prd.docx'));
		expect(converter).not.toHaveBeenCalled();
	});
	it('exposes an actionable missing-converter error', async () => {
		converter.mockRejectedValue(new WordConversionError(503, 'Install LibreOffice Writer'));
		await expect(GET(event('doc'))).rejects.toMatchObject({ status: 503, body: { message: 'Install LibreOffice Writer' } });
	});
});
