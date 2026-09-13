import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [sveltekit()],
	server: {
		allowedHosts: ['.ts.net', '.trycloudflare.com']
	},
	ssr: {
		// Bundle markdown-it into the portable ReviewLoop tarball; the remote host does not run pnpm install.
		noExternal: ['markdown-it']
	}
});
