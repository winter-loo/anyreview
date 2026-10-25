import { createServer } from 'node:http';
import { afterEach, expect, test } from 'vitest';
import { ensureServer } from './server-daemon.js';

const servers = [];
afterEach(async () => {
	await Promise.all(servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve))));
});

async function listen(handler) {
	const server = createServer(handler);
	servers.push(server);
	await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
	return String(server.address().port);
}

test('reuses a healthy AnyReview server', async () => {
	const port = await listen((request, response) => {
		response.setHeader('Content-Type', 'application/json');
		response.end(JSON.stringify({ service: 'anyreview' }));
	});
	expect(await ensureServer(port)).toBe(port);
});

test('refuses to publish through an unrelated server', async () => {
	const port = await listen((request, response) => response.end('another app'));
	await expect(ensureServer(port)).rejects.toThrow(/occupied by a server without AnyReview/);
});
