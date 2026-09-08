/** Allow direct loopback access when adapter-node has a fixed public ORIGIN.
 * Never use arbitrary Host or forwarded headers to construct download URLs.
 */
export function liveOrigin(url: URL, headers: Headers): string {
 const host = headers.get('host');
 if (!host || headers.get('origin') === url.origin) return url.origin;
 try {
  const direct = new URL(`http://${host}`);
  if (['127.0.0.1', 'localhost', '[::1]'].includes(direct.hostname) &&
      direct.host === host.toLowerCase() && direct.pathname === '/' && !direct.search && !direct.hash && !direct.username && !direct.password) {
   return direct.origin;
  }
 } catch { /* Use the configured origin for malformed hosts. */ }
 return url.origin;
}
