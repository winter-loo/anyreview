import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [sveltekit()],
	server: {
		allowedHosts: ['.ts.net']
	},
	ssr: {
		// Bundle markdown-it into the portable ltsql tarball; the remote host does not run pnpm install.
		noExternal: ['markdown-it']
	}
});
