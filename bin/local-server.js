import { spawn } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, openSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));

async function responds(host, port) {
	try {
		const response = await fetch(`http://${host}:${port}/`, { signal: AbortSignal.timeout(500) });
		await response.body?.cancel();
		return true;
	} catch {
		return false;
	}
}

/** Ensure the detached ReviewLoop HTTP service is reachable for the selected URL mode. */
export async function ensureLocalServer({ bindHost, accessHost, port }) {
	if (await responds(accessHost, port)) return;
	if (accessHost !== '127.0.0.1' && await responds('127.0.0.1', port)) {
		throw new Error(`A service is already listening on 127.0.0.1:${port}, but it is not reachable at ${accessHost}:${port}. Restart it with HOST=0.0.0.0 or choose another PORT.`);
	}

	const entry = process.env.REVIEW_SERVER_ENTRY || path.resolve(moduleDirectory, '../build/index.js');
	if (!existsSync(entry)) {
		throw new Error(`ReviewLoop server build was not found at ${entry}. Run pnpm build, then retry.`);
	}

	const stateDirectory = path.join(homedir(), '.config');
	mkdirSync(stateDirectory, { recursive: true });
	const logFile = path.join(stateDirectory, `online-review-server-${port}.log`);
	const log = openSync(logFile, 'a');
	let server;
	try {
		server = spawn(process.execPath, [entry], {
			detached: true,
			env: { ...process.env, HOST: bindHost, PORT: String(port) },
			stdio: ['ignore', log, log],
			windowsHide: true
		});
	} finally {
		closeSync(log);
	}
	server.unref();

	let launchError;
	server.once('error', (error) => { launchError = error; });
	const deadline = Date.now() + 10_000;
	while (Date.now() < deadline) {
		await new Promise((resolve) => setTimeout(resolve, 100));
		if (launchError) throw new Error(`Cannot start ReviewLoop: ${launchError.message}`);
		if (await responds(accessHost, port)) {
			writeFileSync(path.join(stateDirectory, 'online-review-server.json'), JSON.stringify({ pid: server.pid, host: bindHost, port: String(port), logFile }, null, 2), { mode: 0o600 });
			return;
		}
		if (server.exitCode !== null) break;
	}

	throw new Error(`ReviewLoop did not start on ${accessHost}:${port}. Check ${logFile}.`);
}
