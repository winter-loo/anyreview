import { createCipheriv, createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
const converter = vi.hoisted(() => vi.fn());
vi.mock('$lib/server/documents/convertPpt', async (original) => ({
	...await original<typeof import('$lib/server/documents/convertPpt')>(),
	convertLegacyPpt: converter
}));
import { GET } from './+server';
import { PptConversionError } from '$lib/server/documents/convertPpt';

function event(extension: string) {
	const secret = 'ppt-endpoint-test';
	vi.stubEnv('ONLINE_REVIEW_URL_SECRET', secret);
	const iv = Buffer.alloc(12, 2);
	const cipher = createCipheriv('aes-256-gcm', createHash('sha256').update(secret).digest(), iv);
	const encrypted = Buffer.concat([cipher.update(path.resolve(`samples/documents/reviewloop-quarterly.${extension}`)), cipher.final()]);
	return { params: { token: Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64url') } } as any;
}
afterEach(() => { vi.unstubAllEnvs(); converter.mockReset(); });
describe('PowerPoint preview endpoint', () => {
	it('serves converted PPTX bytes for a binary PPT source', async () => {
		const converted = readFileSync('samples/documents/reviewloop-quarterly.pptx');
		converter.mockResolvedValue(converted);
		const response = await GET(event('ppt'));
		expect(converter).toHaveBeenCalledTimes(1);
		expect(converter.mock.calls[0][0].equals(readFileSync('samples/documents/reviewloop-quarterly.ppt'))).toBe(true);
		expect(Buffer.from(await response.arrayBuffer())).toEqual(converted);
		expect(response.headers.get('content-type')).toBe('application/vnd.openxmlformats-officedocument.presentationml.presentation');
		expect(response.headers.get('cache-control')).toBe('no-store');
	});
	it('passes PPTX through without requiring LibreOffice', async () => {
		const response = await GET(event('pptx'));
		expect(Buffer.from(await response.arrayBuffer())).toEqual(readFileSync('samples/documents/reviewloop-quarterly.pptx'));
		expect(converter).not.toHaveBeenCalled();
	});
	it('exposes an actionable missing-converter error', async () => {
		converter.mockRejectedValue(new PptConversionError(503, 'Install LibreOffice Impress'));
		await expect(GET(event('ppt'))).rejects.toMatchObject({ status: 503, body: { message: 'Install LibreOffice Impress' } });
	});
});
