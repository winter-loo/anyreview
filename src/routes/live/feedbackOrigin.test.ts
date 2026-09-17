import { expect, it } from 'vitest';
import { POST } from './[token]/feedback/+server';

async function probe(origin: string, site?: string, host?: string) {
 const headers = new Headers({ origin, 'content-type': 'application/json' });
 if (site) headers.set('sec-fetch-site', site);
 if (host) headers.set('host', host);
 const url = new URL('https://deeloo.cn/live/test/feedback');
 // Invalid JSON body stops before any snapshot or database writes.
 return POST({ url, params: { token: 'test' }, request: new Request(url, { method: 'POST', headers, body: 'null' }) } as Parameters<typeof POST>[0]);
}
it('accepts same-origin browser feedback through a different public tunnel origin', async () => {
 await expect(probe('https://archlinux.taila6b1f7.ts.net', 'same-origin')).rejects.toMatchObject({ status: 400, body: { message: 'Invalid request body' } });
});
it('rejects cross-site and same-site writes from other origins', async () => {
 for (const site of ['cross-site', 'same-site', 'none', undefined]) {
  await expect(probe('https://evil.example', site)).rejects.toMatchObject({ status: 403 });
 }
});
it('retains the configured origin fallback for clients without fetch metadata', async () => {
 await expect(probe('https://deeloo.cn')).rejects.toMatchObject({ status: 400 });
});
it('accepts plain-HTTP LAN feedback, which browsers send without fetch metadata', async () => {
 await expect(probe('http://192.168.10.104:8788', undefined, '192.168.10.104:8788')).rejects.toMatchObject({ status: 400 });
});
it('rejects cross-site writes whose origin does not match the requested host', async () => {
 await expect(probe('http://evil.example', undefined, '192.168.10.104:8788')).rejects.toMatchObject({ status: 403 });
 await expect(probe('http://192.168.10.104:9999', undefined, '192.168.10.104:8788')).rejects.toMatchObject({ status: 403 });
});
