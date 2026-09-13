import { build } from 'esbuild';

await build({
	entryPoints: ['src/cli/main.ts'],
	bundle: true,
	platform: 'node',
	format: 'esm',
	target: 'node24',
	outfile: 'dist-cli/reviewctl.js',
	banner: { js: '#!/usr/bin/env node' }
});
