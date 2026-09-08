#!/usr/bin/env node

import { createCipheriv, createHash, randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
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

function isImageFile(filePath) {
	return IMAGE_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

function isMarkdownFile(filePath) {
	return path.extname(filePath).toLowerCase() === '.md';
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

function secret() {
	if (process.env.ONLINE_REVIEW_URL_SECRET) return process.env.ONLINE_REVIEW_URL_SECRET;
	const env = readFileSync(path.join(homedir(), '.config/online-review.env'), 'utf8');
	const line = env.split(/\r?\n/).find((value) => value.startsWith('ONLINE_REVIEW_URL_SECRET='));
	if (!line) throw new Error('ONLINE_REVIEW_URL_SECRET is not configured');
	return line.slice(line.indexOf('=') + 1);
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

function main(rawFiles) {
 const local = process.argv.slice(2).includes('--local');
 const base = new URL(local ? (process.env.ONLINE_REVIEW_LOCAL_BASE_URL || `http://127.0.0.1:${process.env.PORT || '8787'}/live`) : BASE_URL);
 if (!['http:', 'https:'].includes(base.protocol) || base.pathname.replace(/\/$/, '') !== '/live' || base.search || base.hash || base.username || base.password) throw new Error('Review base URL must be an HTTP(S) URL ending in /live');
	const files = rawFiles.map((file) => realpathSync(file));
	const home = realpathSync(homedir());

	for (const file of files) {
		if (!(file.startsWith(`${home}${path.sep}`) || file.startsWith(`/tmp${path.sep}`))) {
			throw new Error(`File must be under HOME or /tmp: ${file}`);
		}
		const stats = statSync(file);
		if (!stats.isFile()) {
			throw new Error(`Not a regular file: ${file}`);
		}
		if (isImageFile(file)) {
			if (stats.size > MAX_IMAGE_BYTES) throw new Error(`Image must be no larger than 5 MiB: ${file}`);
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

	const allImagesMode = files.every(isImageFile);
	const isMarkdownMode = files.length === 1 && isMarkdownFile(files[0]);
	const isPdfMode = files.length === 1 && isPdfFile(files[0]);
	const isWordMode = files.length === 1 && isWordFile(files[0]);
	const isPptMode = files.length === 1 && isPptFile(files[0]);
	const isExcelMode = files.length === 1 && isExcelFile(files[0]);

	if (!allImagesMode && !isMarkdownMode && !isPdfMode && !isWordMode && !isPptMode && !isExcelMode) {
		throw new Error('Only Markdown, PDF, Word, PowerPoint, Excel, or Image files are supported');
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
  console.log('Usage: review <file-or-directory> [--long] [--local]\n       review paste [--long] [--local]\n       review --clipboard [--long] [--local]\n       review feedback [url-or-id] [--json] [--wait] [--after <cursor>] [--timeout <seconds>] [--out <new-directory>]\n\nPaste: paste text in a terminal, press Enter then Ctrl+D to publish; Ctrl+C cancels.\n       Or pipe UTF-8 text: cat response.md | review paste');
 } else if (process.argv[2] === 'feedback') {
  const { runFeedback } = await import('./feedback.js');
  await runFeedback(process.argv.slice(3));
 } else {
  const paste = process.argv[2] === 'paste';
  const args = process.argv.slice(paste ? 3 : 2);
  const unknown = args.find(arg => arg.startsWith('--') && !['--long', '--clipboard', '--local'].includes(arg));
  if (unknown) throw new Error(`Unknown option: ${unknown}`);
  const files = args.filter(arg => !['--long', '--clipboard', '--local'].includes(arg));
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
    main([file]);
   } finally { rmSync(directory, {recursive:true, force:true}); }
  } else main(resolveFiles(files));
 }
} catch (error) {
	console.error(error instanceof Error ? error.message : String(error));
	process.exitCode = 1;
}
