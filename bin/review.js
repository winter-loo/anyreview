#!/usr/bin/env node

import { createCipheriv, createHash, randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { homedir, networkInterfaces } from 'node:os';
import path from 'node:path';
import { createInterface } from 'node:readline/promises';
import { stdin, stderr } from 'node:process';
import { DatabaseSync } from 'node:sqlite';
import { readClipboard } from './clipboard.js';
import { rememberReview } from './latest-review.js';
import { readPaste } from './paste.js';
import { digest, freezeReview } from './live-snapshot.js';

const BASE_URL = process.env.ONLINE_REVIEW_BASE_URL || 'https://deeloo.cn/live';
const MAX_MARKDOWN_BYTES = 5 * 1024 * 1024;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_PDF_BYTES = 50 * 1024 * 1024;
const MAX_WORD_BYTES = 50 * 1024 * 1024;
const MAX_PPT_BYTES = 50 * 1024 * 1024;
const MAX_EXCEL_BYTES = 50 * 1024 * 1024;
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg', '.bmp', '.avif']);
const WORD_EXTENSIONS = new Set(['.docx', '.doc']);
const PPT_EXTENSIONS = new Set(['.pptx', '.ppt']);
const EXCEL_EXTENSIONS = new Set(['.xlsx', '.xls', '.csv']);

function isVideoFile(filePath) { return ['.mp4', '.mov', '.webm'].includes(path.extname(filePath).toLowerCase()); }

function isImageFile(filePath) {
	return IMAGE_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

function isMarkdownFile(filePath) {
	return path.extname(filePath).toLowerCase() === '.md';
}

function isHtmlFile(filePath) {
 return ['.html', '.htm'].includes(path.extname(filePath).toLowerCase());
}

function isPdfFile(filePath) {
	return path.extname(filePath).toLowerCase() === '.pdf';
}

function isWordFile(filePath) {
	return WORD_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

function isPptFile(filePath) {
	return PPT_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

function isExcelFile(filePath) {
	return EXCEL_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

function getShortLinksDb() {
	const dbPath = process.env.ONLINE_REVIEW_SHORT_LINKS_DB || path.join(homedir(), '.config/online-review-links.db');
	mkdirSync(path.dirname(dbPath), { recursive: true });
	const db = new DatabaseSync(dbPath);
	db.exec('PRAGMA journal_mode = WAL;');
	db.exec('CREATE TABLE IF NOT EXISTS short_links (id TEXT PRIMARY KEY, token TEXT NOT NULL, created_at TEXT NOT NULL)');
	return db;
}

function createShortLink(token) {
	try {
		const db = getShortLinksDb();
		const id = randomBytes(6).toString('base64url');
		const stmt = db.prepare('INSERT OR REPLACE INTO short_links (id, token, created_at) VALUES (?, ?, ?)');
		stmt.run(id, token, new Date().toISOString());
		return id;
	} catch {
		return token;
	}
}

function readEnvConfig(key) {
	if (process.env[key]) return process.env[key];
	try {
		const env = readFileSync(path.join(homedir(), '.config/online-review.env'), 'utf8');
		const line = env.split(/\r?\n/).find((value) => value.startsWith(`${key}=`));
		if (line) return line.slice(line.indexOf('=') + 1);
	} catch {}
	return undefined;
}

function secret() {
	const val = readEnvConfig('ONLINE_REVIEW_URL_SECRET');
	if (!val) throw new Error('ONLINE_REVIEW_URL_SECRET is not configured');
	return val;
}

function localNetworkAddresses() {
	const addresses = [];
	for (const [name, entries] of Object.entries(networkInterfaces())) {
		if (/tun|wsl/i.test(name)) continue;
		for (const entry of entries ?? []) {
			if (entry.family !== 'IPv4' || entry.internal) continue;
			const octets = entry.address.split('.').map(Number);
			const isPrivate = octets[0] === 10
				|| (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31)
				|| (octets[0] === 192 && octets[1] === 168);
			if (isPrivate) addresses.push({ name, address: entry.address });
		}
	}
	return addresses;
}

async function chooseLocalNetworkAddress(requested) {
	const addresses = localNetworkAddresses();
	if (!addresses.length) throw new Error('No private IPv4 network address was found.');
	if (requested) {
		const selected = addresses.find((entry) => entry.address === requested);
		if (!selected) throw new Error(`Local network address is not assigned to this machine: ${requested}`);
		return selected.address;
	}
	if (addresses.length === 1) return addresses[0].address;

	const choices = addresses.map((entry, index) => `  ${index + 1}. ${entry.name} (${entry.address})`).join('\n');
	if (!stdin.isTTY) throw new Error(`Multiple local network addresses found. Rerun with --localnet=<address>:\n${choices}`);

	stderr.write(`Multiple local network addresses found:\n${choices}\n`);
	const prompt = createInterface({ input: stdin, output: stderr });
	try {
		const answer = await prompt.question(`Select an address [1-${addresses.length}]: `);
		const index = Number(answer) - 1;
		if (!Number.isInteger(index) || index < 0 || index >= addresses.length) throw new Error('Invalid local network address selection.');
		return addresses[index].address;
	} finally {
		prompt.close();
	}
}

async function localServicePort() {
	const candidates = [...new Set([process.env.PORT, '5173', '8787'].filter(Boolean))];
	for (const port of candidates) {
		try {
			await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(1500) });
			return port;
		} catch {}
	}
	throw new Error(`ReviewLoop is not running on ${candidates.map((port) => `127.0.0.1:${port}`).join(' or ')}.`);
}

function tailscalePublicBase(port) {
	const status = spawnSync('tailscale', ['status', '--json'], { encoding: 'utf8' });
	if (status.error) throw new Error(`Cannot run Tailscale: ${status.error.message}`);
	if (status.status !== 0) throw new Error(status.stderr.trim() || 'Cannot read Tailscale status.');
	let details;
	try { details = JSON.parse(status.stdout); } catch { throw new Error('Tailscale returned invalid status data.'); }
	if (details.BackendState !== 'Running' || !details.Self?.Online) throw new Error('Tailscale is not connected.');
	const dnsName = String(details.Self.DNSName ?? '').replace(/\.$/, '');
	if (!dnsName) throw new Error('Tailscale MagicDNS is not available for this machine.');

	const funnel = spawnSync('tailscale', ['funnel', '--bg', '--yes', String(port)], { encoding: 'utf8' });
	if (funnel.error) throw new Error(`Cannot configure Tailscale Funnel: ${funnel.error.message}`);
	if (funnel.status !== 0) throw new Error(funnel.stderr.trim() || funnel.stdout.trim() || 'Cannot configure Tailscale Funnel.');
	return `https://${dnsName}/live`;
}

function latestMarkdown(directory) {
	const candidates = readdirSync(directory, { withFileTypes: true })
		.filter((entry) => entry.isFile() && isMarkdownFile(entry.name))
		.map((entry) => path.join(directory, entry.name));
	if (!candidates.length) return null;
	return candidates.reduce((latest, candidate) =>
		statSync(candidate).mtimeMs > statSync(latest).mtimeMs ? candidate : latest
	);
}

function allImages(directory) {
	return readdirSync(directory, { withFileTypes: true })
		.filter((entry) => entry.isFile() && isImageFile(entry.name))
		.map((entry) => path.join(directory, entry.name))
		.sort((a, b) => a.localeCompare(b));
}

function resolveFiles(args) {
	if (!args.length) {
		const md = latestMarkdown(process.cwd());
		if (md) return [md];
		const images = allImages(process.cwd());
		if (images.length) return images;
		throw new Error(`No Markdown or Image file in ${process.cwd()}`);
	}

	if (args.length === 1) {
		const target = path.resolve(args[0]);
		try {
			const stat = statSync(target);
			if (stat.isDirectory()) {
				const images = allImages(target);
				if (images.length) return images;
				const md = latestMarkdown(target);
				if (md) return [md];
				throw new Error(`No Markdown or Image file in directory ${target}`);
			}
		} catch (err) {
			if (err instanceof Error && 'code' in err && err.code === 'ENOENT') throw err;
			throw err;
		}
		return [target];
	}

	return args.map((arg) => path.resolve(arg));
}

async function main(rawFiles) {
 const args = process.argv.slice(2);
 const local = args.includes('--local');
 const localNetOption = args.find((arg) => arg === '--localnet' || arg.startsWith('--localnet='));
 const tailnet = args.includes('--tailnet');
 const requestedAddress = localNetOption?.includes('=') ? localNetOption.slice(localNetOption.indexOf('=') + 1) : undefined;
 const localHost = localNetOption ? await chooseLocalNetworkAddress(requestedAddress) : '127.0.0.1';
 const port = process.env.PORT || '8787';
 const base = new URL(tailnet ? tailscalePublicBase(await localServicePort()) : local || localNetOption ? `http://${localHost}:${port}/live` : (readEnvConfig('ONLINE_REVIEW_BASE_URL') || BASE_URL));
 if (!['http:', 'https:'].includes(base.protocol) || base.pathname.replace(/\/$/, '') !== '/live' || base.search || base.hash || base.username || base.password) throw new Error('Review base URL must be an HTTP(S) URL ending in /live');
	const files = rawFiles.map((file) => realpathSync(file));

	for (const file of files) {
		const stats = statSync(file);
		if (!stats.isFile()) {
			throw new Error(`Not a regular file: ${file}`);
		}
		if (isVideoFile(file)) {
   if (stats.size > 500 * 1024 * 1024) throw new Error(`Video file must be no larger than 500 MiB: ${file}`);
  } else if (isImageFile(file)) {
			if (stats.size > MAX_IMAGE_BYTES) throw new Error(`Image must be no larger than 5 MiB: ${file}`);
		} else if (isHtmlFile(file)) {
   if (stats.size > MAX_MARKDOWN_BYTES) throw new Error(`HTML file must be no larger than 5 MiB: ${file}`);
  } else if (isMarkdownFile(file)) {
			if (stats.size > MAX_MARKDOWN_BYTES) throw new Error(`Markdown file must be no larger than 5 MiB: ${file}`);
		} else if (isPdfFile(file)) {
			if (stats.size > MAX_PDF_BYTES) throw new Error(`PDF file must be no larger than 50 MiB: ${file}`);
		} else if (isWordFile(file)) {
			if (stats.size > MAX_WORD_BYTES) throw new Error(`Word file must be no larger than 50 MiB: ${file}`);
		} else if (isPptFile(file)) {
			if (stats.size > MAX_PPT_BYTES) throw new Error(`PowerPoint file must be no larger than 50 MiB: ${file}`);
		} else if (isExcelFile(file)) {
			if (stats.size > MAX_EXCEL_BYTES) throw new Error(`Excel file must be no larger than 50 MiB: ${file}`);
		} else {
			throw new Error(`Unsupported file type: ${file}`);
		}
	}

	const isVideoMode = files.length === 1 && isVideoFile(files[0]);
	const allImagesMode = files.every(isImageFile);
	const isHtmlMode = files.length === 1 && isHtmlFile(files[0]);
	const isMarkdownMode = files.length === 1 && isMarkdownFile(files[0]);
	const isPdfMode = files.length === 1 && isPdfFile(files[0]);
	const isWordMode = files.length === 1 && isWordFile(files[0]);
	const isPptMode = files.length === 1 && isPptFile(files[0]);
	const isExcelMode = files.length === 1 && isExcelFile(files[0]);

	if (!isVideoMode && !allImagesMode && !isHtmlMode && !isMarkdownMode && !isPdfMode && !isWordMode && !isPptMode && !isExcelMode) {
		throw new Error('Only video (MP4/MOV/WebM), HTML, Markdown, PDF, Word, PowerPoint, Excel, or Image files are supported');
	}

	const payload = files.length === 1 ? files[0] : JSON.stringify(files);

	const iv = randomBytes(12);
	const cipher = createCipheriv('aes-256-gcm', createHash('sha256').update(secret()).digest(), iv);
	const encrypted = Buffer.concat([cipher.update(payload, 'utf8'), cipher.final()]);
	const token = Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64url');

	freezeReview(digest(token), files);
	const isLong = process.argv.slice(2).includes('--long');
	const url = `${base.href.replace(/\/$/, '')}/${isLong ? token : createShortLink(token)}`;
	rememberReview(url);
	console.log(url);
}

try {
 if (['--help','-h'].includes(process.argv[2]) || (process.argv[2] === 'paste' && ['--help','-h'].includes(process.argv[3]))) {
  console.log('Usage: review <file-or-directory> [--long] [--local | --localnet[=<address>] | --tailnet]\n       review paste [--long] [--local | --localnet[=<address>] | --tailnet]\n       review --clipboard [--long] [--local | --localnet[=<address>] | --tailnet]\n       review feedback [url-or-id] [--json] [--wait] [--after <cursor>] [--timeout <seconds>] [--out <new-directory>]\n\nURL modes: default uses deeloo.cn; --local uses 127.0.0.1; --localnet selects a private IPv4 address; --tailnet enables a public HTTPS Funnel.\n\nFiles: Video (.mp4/.mov/.webm, up to 500 MiB), HTML (.html/.htm), Markdown, PDF, Word, PowerPoint, Excel, or images.\n\nPaste: paste text in a terminal, press Enter then Ctrl+D to publish; Ctrl+C cancels.\n       Or pipe UTF-8 text: cat response.md | review paste');
 } else if (process.argv[2] === 'feedback') {
  const { runFeedback } = await import('./feedback.js');
  await runFeedback(process.argv.slice(3));
 } else {
  const paste = process.argv[2] === 'paste';
  const args = process.argv.slice(paste ? 3 : 2);
  const unknown = args.find(arg => arg.startsWith('--') && !['--long', '--clipboard', '--local', '--localnet', '--tailnet'].includes(arg) && !arg.startsWith('--localnet='));
  if (unknown) throw new Error(`Unknown option: ${unknown}`);
  const urlModes = [args.includes('--local'), args.some((arg) => arg === '--localnet' || arg.startsWith('--localnet=')), args.includes('--tailnet')].filter(Boolean).length;
  if (urlModes > 1) throw new Error('Choose only one of --local, --localnet, or --tailnet.');
  const files = args.filter(arg => !['--long', '--clipboard', '--local', '--localnet', '--tailnet'].includes(arg) && !arg.startsWith('--localnet='));
  const clipboard = args.includes('--clipboard');
  if (paste && clipboard) throw new Error('Choose review paste or review --clipboard, not both.');
  if (paste || clipboard) {
   if (files.length) throw new Error('Paste/clipboard input cannot be combined with file arguments.');
   const text = clipboard ? readClipboard() : await readPaste();
   const root = path.join(homedir(), '.config/online-review-paste');
   mkdirSync(root, {recursive:true, mode:0o700});
   const directory = mkdtempSync(path.join(root, 'capture-'));
   try {
    const file = path.join(directory, clipboard ? 'clipboard.md' : 'paste.md');
    writeFileSync(file, text, {mode:0o600});
    await main([file]);
   } finally { rmSync(directory, {recursive:true, force:true}); }
  } else await main(resolveFiles(files));
 }
} catch (error) {
	console.error(error instanceof Error ? error.message : String(error));
	process.exitCode = 1;
}
