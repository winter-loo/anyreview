import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

const SECRET_KEY = 'ONLINE_REVIEW_URL_SECRET';

/** @param {string} key */
export function readEnvConfig(key) {
	if (process.env[key]) return process.env[key];
	try {
		const env = readFileSync(path.join(homedir(), '.config/online-review.env'), 'utf8');
		const line = env.split(/\r?\n/).find((value) => value.startsWith(`${key}=`));
		if (line) return line.slice(line.indexOf('=') + 1);
	} catch {}
	return undefined;
}

/** Return the configured URL secret, creating a persistent local one on first use. */
export function reviewUrlSecret() {
	const configured = readEnvConfig(SECRET_KEY);
	if (configured) return configured;

	const configDirectory = path.join(homedir(), '.config');
	const secretPath = path.join(configDirectory, 'online-review.secret');
	try {
		const existing = readFileSync(secretPath, 'utf8').trim();
		if (existing) return existing;
	} catch {}

	mkdirSync(configDirectory, { recursive: true, mode: 0o700 });
	const generated = randomBytes(32).toString('hex');
	try {
		// Exclusive creation makes simultaneous CLI/server first starts converge on one value.
		writeFileSync(secretPath, `${generated}\n`, { flag: 'wx', mode: 0o600 });
		return generated;
	} catch (cause) {
		if (cause && typeof cause === 'object' && 'code' in cause && cause.code === 'EEXIST') {
			const existing = readFileSync(secretPath, 'utf8').trim();
			if (existing) return existing;
		}
		throw cause;
	}
}
