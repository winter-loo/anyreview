import { expect, it } from 'vitest';
import { liveOrigin } from './origin';
const url=new URL('https://deeloo.cn/live/test/feedback');
it('keeps direct loopback attachments local despite a public adapter ORIGIN',()=>{
 for(const host of ['127.0.0.1:8787','localhost:8787','[::1]:8787']){
  expect(liveOrigin(url,new Headers({host}))).toBe(`http://${host}`);
  expect(liveOrigin(url,new Headers({host,origin:`http://${host}`}))).toBe(`http://${host}`);
 }
});
it('preserves public browser requests and rejects arbitrary or malformed hosts',()=>{
 expect(liveOrigin(url,new Headers({host:'127.0.0.1:8787',origin:url.origin}))).toBe(url.origin);
 for(const host of ['evil.test','localhost.evil.test','localhost@evil.test','localhost/path','localhost#fragment']){
  expect(liveOrigin(url,new Headers({host}))).toBe(url.origin);
 }
});
