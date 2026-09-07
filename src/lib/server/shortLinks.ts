import { DatabaseSync } from 'node:sqlite';
import { homedir } from 'node:os';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';

let _db: DatabaseSync | null = null;

export function getShortLinksDb(): DatabaseSync {
	if (_db) return _db;
	const dbPath = process.env.ONLINE_REVIEW_SHORT_LINKS_DB || path.join(homedir(), '.config/online-review-links.db');
	mkdirSync(path.dirname(dbPath), { recursive: true });
	_db = new DatabaseSync(dbPath);
	_db.exec('PRAGMA journal_mode = WAL;');
	_db.exec('CREATE TABLE IF NOT EXISTS short_links (id TEXT PRIMARY KEY, token TEXT NOT NULL, created_at TEXT NOT NULL)');
	return _db;
}

export function createShortLink(token: string): string {
	const db = getShortLinksDb();
	const id = randomBytes(6).toString('base64url');
	const stmt = db.prepare('INSERT OR REPLACE INTO short_links (id, token, created_at) VALUES (?, ?, ?)');
	stmt.run(id, token, new Date().toISOString());
	return id;
}

export function resolveToken(tokenOrId: string): string {
	try {
		const db = getShortLinksDb();
		const stmt = db.prepare('SELECT token FROM short_links WHERE id = ?');
		const row = stmt.get(tokenOrId) as { token: string } | undefined;
		if (row?.token) {
			return row.token;
		}
	} catch {
		// Fall back to original token
	}
	return tokenOrId;
}
