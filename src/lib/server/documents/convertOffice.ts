import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

const run = promisify(execFile);
const MAX_DOCUMENT_BYTES = 50 * 1024 * 1024;

export class OfficeConversionError extends Error {
	constructor(public status: 422 | 503 | 504, message: string) {
		super(message);
	}
}

/** Convert a private copy, leaving the reviewed file untouched. */
export async function convertLegacyOffice(source: Uint8Array, format: 'doc' | 'ppt'): Promise<Buffer<ArrayBuffer>> {
	const settings = format === 'doc'
		? { label: 'Word document', application: 'Word', component: 'Writer', output: 'docx', filter: 'Office Open XML Text', cache: 'word-conversions' }
		: { label: 'PowerPoint presentation', application: 'PowerPoint', component: 'Impress', output: 'pptx', filter: 'Impress MS PowerPoint 2007 XML', cache: 'ppt-conversions' };
	const root = path.join(homedir(), '.cache', 'reviewloop', settings.cache);
	await mkdir(root, { recursive: true, mode: 0o700 });
	const directory = await mkdtemp(path.join(root, `${format}-`));
	try {
		const input = path.join(directory, `source.${format}`);
		await writeFile(input, source);
		try {
			await run(process.env.REVIEW_PLATFORM_LIBREOFFICE_BIN || 'libreoffice', [
				`-env:UserInstallation=${pathToFileURL(path.join(directory, 'profile')).href}`,
				'--headless', '--nologo', '--nodefault', '--norestore',
				'--convert-to', `${settings.output}:${settings.filter}`, '--outdir', directory, input
			], { timeout: 60_000, killSignal: 'SIGKILL', maxBuffer: 1024 * 1024 });
		} catch (cause) {
			const failure = cause as NodeJS.ErrnoException & { killed?: boolean };
			if (failure.code === 'ENOENT') {
				throw new OfficeConversionError(503, `Legacy .${format} preview requires LibreOffice on the server. Install LibreOffice ${settings.component} or configure REVIEW_PLATFORM_LIBREOFFICE_BIN.`);
			}
			if (failure.killed) throw new OfficeConversionError(504, `${settings.label} conversion timed out.`);
			throw new OfficeConversionError(422, `Unable to convert this .${format} document. Check that it is a valid, unencrypted ${settings.application} file.`);
		}
		// LibreOffice can exit successfully without producing a file on invalid input.
		const output = path.join(directory, `source.${settings.output}`);
		try {
			const info = await stat(output);
			if (!info.isFile() || info.size > MAX_DOCUMENT_BYTES) throw new Error('Invalid output size');
			const bytes = await readFile(output);
			if (bytes.length < 4 || bytes.readUInt32LE(0) !== 0x04034b50) throw new Error('Invalid output format');
			return bytes;
		} catch {
			throw new OfficeConversionError(422, `Unable to produce a valid .${settings.output} preview from this ${settings.label}.`);
		}
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
}
