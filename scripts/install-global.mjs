#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pnpmCli = process.env.npm_execpath;

if (!pnpmCli || !existsSync(pnpmCli)) {
	console.error('Run this installer through pnpm: pnpm run install:global');
	process.exit(1);
}

const runPnpm = (args, options = {}) =>
	spawnSync(process.execPath, [pnpmCli, ...args], {
		cwd: repoRoot,
		encoding: 'utf8',
		...options
	});

const install = runPnpm(['add', '--global', repoRoot], { stdio: 'inherit' });
if (install.error) {
	console.error(install.error.message);
	process.exit(1);
}
if (install.status !== 0) process.exit(install.status ?? 1);

const globalBin = runPnpm(['bin', '--global']);
if (globalBin.error || globalBin.status !== 0) {
	console.error(globalBin.stderr?.trim() || globalBin.error?.message || 'Cannot locate the pnpm global bin directory.');
	process.exit(globalBin.status ?? 1);
}

const binDir = globalBin.stdout.trim();
const suffixes = process.platform === 'win32' ? ['.cmd', '.ps1', '.exe', ''] : [''];
const commands = ['review', 'reviewctl'];
const missing = commands.filter((command) => !suffixes.some((suffix) => existsSync(resolve(binDir, `${command}${suffix}`))));

if (missing.length > 0) {
	console.error(`Global command shim was not created: ${missing.join(', ')}`);
	process.exit(1);
}

console.log(`Installed global commands in ${binDir}: ${commands.join(', ')}`);
