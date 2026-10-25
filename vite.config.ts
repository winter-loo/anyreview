import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vitest/config';

export default defineConfig({
	plugins: [sveltekit()],
	test: {
		env: { REVIEW_SERVER_AUTOSTART: '0' }
	},
	server: {
		allowedHosts: ['.ts.net', '.trycloudflare.com']
	},
	ssr: {
		// Bundle markdown-it into the portable AnyReview tarball; the remote host does not run pnpm install.
		noExternal: ['markdown-it']
	}
});
