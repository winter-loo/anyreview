import { afterEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
 read: vi.fn(), write: vi.fn(), spawn: vi.fn(),
 tunnel: { pid: 12345, exitCode: null as number | null, once: vi.fn(), unref: vi.fn(), kill: vi.fn() }
}));
vi.mock('node:fs', () => ({ readFileSync: mocks.read, writeFileSync: mocks.write, existsSync: () => false, mkdirSync: vi.fn(), openSync: () => 9, closeSync: vi.fn() }));
vi.mock('node:child_process', () => ({ spawn: mocks.spawn }));
import { cloudflarePublicBase } from '../../bin/cloudflare.js';
const url = 'https://test-tunnel.trycloudflare.com';
function setup(cached = false) {
 vi.useFakeTimers();
 mocks.spawn.mockReturnValue(mocks.tunnel);
 mocks.read.mockImplementation((file: string) => file.endsWith('.json')
  ? JSON.stringify(cached ? { port: '8787', url, pid: process.pid } : {}) : `INF ${url}`);
 const fetch = vi.fn();
 vi.stubGlobal('fetch', fetch);
 return fetch;
}
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.clearAllMocks(); vi.restoreAllMocks(); });
it('does not publish an allocated URL while Cloudflare returns 1033', async () => {
 const fetch = setup(); fetch.mockResolvedValue(new Response('1033', { status: 530 }));
 const result = cloudflarePublicBase('8787');
 const assertion = expect(result).rejects.toThrow(/Cloudflare.*(ready|reachable)/);
 await vi.runAllTimersAsync(); await assertion;
 expect(mocks.write.mock.calls.some(([file]) => file.endsWith('.json'))).toBe(false);
 expect(mocks.tunnel.kill).toHaveBeenCalled();
});
it('waits for the public endpoint before saving and returning a tunnel', async () => {
 const fetch = setup(); fetch.mockResolvedValueOnce(new Response('', { status: 530 })).mockResolvedValue(new Response('ok'));
 const result = cloudflarePublicBase('8787');
 await vi.runAllTimersAsync();
 await expect(result).resolves.toBe(`${url}/live`);
 expect(fetch).toHaveBeenCalledTimes(2);
 expect(mocks.write.mock.calls.filter(([file]) => file.endsWith('.json'))).toHaveLength(1);
 expect(mocks.spawn).toHaveBeenCalledWith(expect.any(String), expect.arrayContaining(['--config', expect.stringContaining('online-review-cloudflare-empty.yml')]), expect.any(Object));
 expect(mocks.spawn).toHaveBeenCalledWith(expect.any(String), expect.arrayContaining(['--protocol', 'auto']), expect.any(Object));
});
it('does not reuse a disconnected tunnel merely because its PID is alive', async () => {
 const fetch = setup(true); fetch.mockResolvedValue(new Response('', { status: 530 }));
 await expect(cloudflarePublicBase('8787')).rejects.toThrow(/Cloudflare.*(ready|reachable)/);
 expect(fetch).toHaveBeenCalled();
 expect(mocks.spawn).not.toHaveBeenCalled();
});
it('reuses a reachable tunnel', async () => {
 const fetch = setup(true); fetch.mockResolvedValue(new Response('ok'));
 await expect(cloudflarePublicBase('8787')).resolves.toBe(`${url}/live`);
 expect(fetch).toHaveBeenCalledOnce();
 expect(mocks.spawn).not.toHaveBeenCalled();
});

it('reports DNS lookup failures without claiming a cached tunnel is ready', async () => {
 const fetch = setup(true);
 fetch.mockRejectedValue(new Error('fetch failed', { cause: { code: 'ENOTFOUND' } }));
 await expect(cloudflarePublicBase('8787')).rejects.toThrow('Network/DNS error: ENOTFOUND');
});
it('starts a new tunnel when the cached process has exited', async () => {
 const fetch = setup(true); fetch.mockResolvedValue(new Response('ok'));
 vi.spyOn(process, 'kill').mockImplementation(() => { throw new Error('ESRCH'); });
 const result = cloudflarePublicBase('8787');
 await vi.runAllTimersAsync();
 await expect(result).resolves.toBe(`${url}/live`);
 expect(mocks.spawn).toHaveBeenCalledOnce();
});
