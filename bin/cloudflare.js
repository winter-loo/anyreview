import { spawn } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

/** @param {number} pid */
function runningProcess(pid) {
	if (!Number.isSafeInteger(pid) || pid <= 0) return false;
	try { process.kill(pid, 0); return true; } catch { return false; }
}

function cloudflaredCommand() {
	if (process.env.CLOUDFLARED_BIN) return process.env.CLOUDFLARED_BIN;
	if (process.platform === 'win32') {
		const candidates = [
			process.env.ProgramFiles && path.join(process.env.ProgramFiles, 'cloudflared', 'cloudflared.exe'),
			process.env['ProgramFiles(x86)'] && path.join(process.env['ProgramFiles(x86)'], 'cloudflared', 'cloudflared.exe')
		].filter((candidate) => typeof candidate === 'string');
		const installed = candidates.find((candidate) => existsSync(candidate));
		if (installed) return installed;
	}
	return 'cloudflared';
}

/** @param {string} port */
export async function cloudflarePublicBase(port) {
	const stateDirectory = path.join(homedir(), '.config');
	const stateFile = path.join(stateDirectory, 'online-review-cloudflare.json');
	let state;
	try { state = JSON.parse(readFileSync(stateFile, 'utf8')); } catch {}
	if (state?.port === String(port) && /^https:\/\/[a-z0-9-]+\.trycloudflare\.com$/i.test(state.url) && runningProcess(state.pid)) {
		const failure = await probe(state.url);
		if (!failure) return `${state.url}/live`;
		throw new Error(`Cloudflare tunnel is not reachable (${failure}). Check ${state.logFile || stateFile}. Stop the disconnected tunnel and retry, or use --tailnet.`);
	}

	mkdirSync(stateDirectory, { recursive: true });
	const logFile = path.join(stateDirectory, `online-review-cloudflare-${Date.now()}.log`);
	// Named-tunnel ingress rules override --url, so never load the user's config.
	const configFile = path.join(stateDirectory, 'online-review-cloudflare-empty.yml');
	writeFileSync(configFile, '{}\n', { mode: 0o600 });
	const log = openSync(logFile, 'a');
	let tunnel;
	try {
		// Override protocol settings inherited from unrelated named tunnels.
		tunnel = spawn(cloudflaredCommand(), ['tunnel', '--config', configFile, '--protocol', 'auto', '--url', `http://127.0.0.1:${port}`, '--no-autoupdate'], {
			detached: true,
			stdio: ['ignore', log, log],
			windowsHide: true
		});
	} catch (error) {
		closeSync(log);
		throw new Error(`Cannot run cloudflared: ${error instanceof Error ? error.message : String(error)}`);
	}
	closeSync(log);
	/** @type {{error?: Error}} */
	const launch = {};
	tunnel.once('error', (error) => { launch.error = error; });
	tunnel.unref();

	const deadline = Date.now() + 90_000;
	let failure = 'no public URL allocated';
	while (Date.now() < deadline) {
		await new Promise((resolve) => setTimeout(resolve, 1000));
		if (launch.error) throw new Error(`Cannot run cloudflared: ${launch.error.message}`);
		let output = '';
		try { output = readFileSync(logFile, 'utf8'); } catch {}
		if (tunnel.exitCode !== null) throw new Error(`cloudflared exited with code ${tunnel.exitCode}. See ${logFile}`);
		const match = output.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/i);
		if (match) failure = await probe(match[0]);
		if (match && !failure) {
			writeFileSync(stateFile, JSON.stringify({ pid: tunnel.pid, port: String(port), url: match[0], logFile }, null, 2), { mode: 0o600 });
			return `${match[0]}/live`;
		}
	}

	try { tunnel.kill(); } catch {}
	throw new Error(`Cloudflare tunnel is not ready after 90 seconds (${failure}). Check network connectivity and ${logFile}, or use --tailnet.`);
}

/** @param {string} url */
async function probe(url) {
	try {
		const response = await fetch(url, { signal: AbortSignal.timeout(10000), redirect: 'manual' });
		await response.body?.cancel();
		return response.ok ? '' : `HTTP ${response.status}`;
	} catch (error) {
		const cause = error instanceof Error ? error.cause : undefined;
		if (cause && typeof cause === 'object' && 'code' in cause) return `Network/DNS error: ${cause.code}`;
		return error instanceof Error ? error.message : 'network request failed';
	}
}
