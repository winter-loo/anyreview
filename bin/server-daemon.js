import { spawn } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const healthPath = '/api/reviewloop-health';

/** @param {string} port @param {string} host */
async function healthy(port, host = '127.0.0.1') {
	try {
		const response = await fetch(`http://${host}:${port}${healthPath}`, { signal: AbortSignal.timeout(1000) });
		const body = await response.json();
		return response.ok && body?.service === 'reviewloop';
	} catch { return false; }
}

/** @param {string} port */
async function occupied(port) {
	try {
		await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(1000) });
		return true;
	} catch (error) {
		return error instanceof Error && error.name === 'TimeoutError';
	}
}

/** Start the local server in a detached process, or reuse a healthy one.
 * @param {string} port
 * @param {string} host
 * @param {string} probeHost
 */
export async function ensureServer(port, host = '127.0.0.1', probeHost = '127.0.0.1') {
	if (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535) throw new Error(`Invalid server port: ${port}`);
	if (await healthy(port, probeHost)) return port;
	if (await occupied(port)) throw new Error(`Port ${port} is occupied by a server without ReviewLoop's health endpoint.`);

	const build = process.env.REVIEW_SERVER_ENTRY || path.join(root, 'build', 'index.js');
	const vite = path.join(root, 'node_modules', 'vite', 'bin', 'vite.js');
	// A source checkout uses its current sources; a packaged installation uses its build.
	const args = process.env.REVIEW_SERVER_ENTRY ? [build] : existsSync(vite)
		? [vite, '--host', host, '--port', port, '--strictPort']
		: existsSync(build) ? [build] : null;
	if (process.env.REVIEW_SERVER_ENTRY && !existsSync(build)) throw new Error(`ReviewLoop server entry was not found: ${build}`);
	if (!args) throw new Error(`Cannot start ReviewLoop: no Vite installation or server build in ${root}. Run pnpm install or pnpm run build.`);

	const stateDirectory = path.join(homedir(), '.config', 'reviewloop');
	mkdirSync(stateDirectory, { recursive: true, mode: 0o700 });
	const logFile = path.join(stateDirectory, `server-${port}.log`);
	const log = openSync(logFile, 'a', 0o600);
	let child;
	try {
		child = spawn(process.execPath, args, {
			cwd: root,
			env: { ...process.env, HOST: host, PORT: port },
			detached: true,
			stdio: ['ignore', log, log],
			windowsHide: true
		});
	} finally { closeSync(log); }
	let launchError;
	child.once('error', (error) => { launchError = error; });
	child.unref();

	const deadline = Date.now() + 30_000;
	while (Date.now() < deadline) {
		if (await healthy(port, probeHost)) {
			writeFileSync(path.join(stateDirectory, `server-${port}.pid`), `${child.pid}\n`, { mode: 0o600 });
			return port;
		}
		if (launchError || child.exitCode !== null) break;
		await new Promise((resolve) => setTimeout(resolve, 250));
	}
	try { child.kill(); } catch {}
	let detail = '';
	try { detail = readFileSync(logFile, 'utf8').trim().split('\n').slice(-5).join(' | '); } catch {}
	throw new Error(`ReviewLoop failed to start on ${host}:${port}. See ${logFile}${detail ? ` (${detail})` : ''}`);
}

/** Reuse a running server on the historical tunnel ports, starting one if needed. */
export async function ensureTunnelServer() {
	if (process.env.PORT) return ensureServer(process.env.PORT);
	const candidates = ['5173', '8787'];
	for (const port of candidates) if (await healthy(port)) return port;
	return ensureServer('8787');
}
