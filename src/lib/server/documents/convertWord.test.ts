import { readFileSync } from 'node:fs';
import { access, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const runner = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock('node:child_process', () => ({
	execFile: (binary: string, args: string[], options: unknown, callback: Function) => {
		runner.execute(binary, args, options).then(() => callback(null, '', ''), (error: Error) => callback(error));
	}
}));
import { convertLegacyWord } from './convertWord';

const docx = readFileSync('samples/documents/reviewloop-prd.docx');
let outputDirectory: string;
const rememberDirectory = (_binary: string, args: string[]) => {
	outputDirectory = args[args.indexOf('--outdir') + 1];
};

afterEach(async () => {
	if (outputDirectory) await expect(access(outputDirectory)).rejects.toThrow();
	vi.unstubAllEnvs();
});

describe('legacy Word conversion', () => {
	it('converts a private copy with an isolated profile and deletes temporary files', async () => {
		runner.execute.mockImplementation(async (binary, args, options) => {
			rememberDirectory(binary, args);
			expect(binary).toBe('/custom/soffice');
			expect(options).toMatchObject({ timeout: 60_000, killSignal: 'SIGKILL' });
			expect(args).toContain('docx:Office Open XML Text');
			expect(args[0]).toContain('/profile');
			expect(readFileSync(path.join(outputDirectory, 'source.doc'))).toEqual(Buffer.from('original'));
			await writeFile(path.join(outputDirectory, 'source.docx'), docx);
		});
		vi.stubEnv('REVIEW_PLATFORM_LIBREOFFICE_BIN', '/custom/soffice');
		expect(await convertLegacyWord(Buffer.from('original'))).toEqual(docx);
	});

	it.each([
		['ENOENT', false, 503],
		['EXIT_FAILURE', false, 422],
		['ETIMEDOUT', true, 504]
	])('reports %s failures and cleans up', async (code, killed, status) => {
		runner.execute.mockImplementation(async (binary, args) => {
			rememberDirectory(binary, args);
			throw Object.assign(new Error('converter failure'), { code, killed });
		});
		await expect(convertLegacyWord(Buffer.from('original'))).rejects.toMatchObject({ status });
	});

	it('rejects a successful process that produced no document', async () => {
		runner.execute.mockImplementation(async (binary, args) => rememberDirectory(binary, args));
		await expect(convertLegacyWord(Buffer.from('invalid'))).rejects.toMatchObject({ status: 422 });
	});
});
