import { expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { networkInterfaces } from 'node:os';
import path from 'node:path';

async function unusedPort() {
 const server=createServer();
 await new Promise<void>((resolve,reject)=>server.listen(0,'127.0.0.1',resolve).once('error',reject));
 const address=server.address();
 if(!address||typeof address==='string')throw new Error('Could not allocate a test port');
 await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));
 return String(address.port);
}

function stopStartedServer(home:string) {
 try {
  const state=JSON.parse(readFileSync(path.join(home,'.config/online-review-server.json'),'utf8'));
  if(Number.isSafeInteger(state.pid))process.kill(state.pid);
 } catch {}
}

it('starts a loopback ReviewLoop server when --local has no server to reuse',async()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'local-review-autostart-'));
 try{
  const file=path.join(dir,'sample.md');writeFileSync(file,'# Autostart');
  const port=await unusedPort();
  const env={...process.env,HOME:dir,USERPROFILE:dir,PORT:port,REVIEW_SERVER_AUTOSTART:'1',ONLINE_REVIEW_URL_SECRET:'autostart-test',ONLINE_REVIEW_FEEDBACK_HOME:path.join(dir,'feedback'),ONLINE_REVIEW_SHORT_LINKS_DB:path.join(dir,'links.db'),REVIEW_SERVER_ENTRY:path.resolve('src/lib/review/fixtures/review-server.mjs')};
  const url=execFileSync(process.execPath,['bin/review.js',file,'--local'],{env,encoding:'utf8'}).trim();
  expect(url).toMatch(new RegExp(`^http://127\\.0\\.0\\.1:${port}/live/`));
  await expect(fetch(url).then(response=>response.text())).resolves.toBe('ReviewLoop test server');
 }finally{stopStartedServer(dir);rmSync(dir,{recursive:true,force:true});}
});
it('publishes local links for files and paste and remembers the local target',()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'local-review-'));
 try {
  const file=path.join(dir,'sample.md');writeFileSync(file,'# Local');
  const bin=path.join(dir,'bin');mkdirSync(bin);
  writeFileSync(path.join(bin,'wl-paste'),`#!${process.execPath}\nprocess.stdout.write('# Clipboard');`,{mode:0o700});
  const env={...process.env,HOME:dir,USERPROFILE:dir,PATH:bin,PORT:'8787',WAYLAND_DISPLAY:'test',WSL_INTEROP:'',WSL_DISTRO_NAME:'',ONLINE_REVIEW_BASE_URL:'https://public.test/live',ONLINE_REVIEW_URL_SECRET:'local-test',ONLINE_REVIEW_FEEDBACK_HOME:path.join(dir,'feedback'),ONLINE_REVIEW_SHORT_LINKS_DB:path.join(dir,'links.db'),REVIEW_SERVER_ENTRY:path.resolve('src/lib/review/fixtures/review-server.mjs')};
  for(const args of [[file,'--local'],['paste','--local','--long']]){
   const url=execFileSync(process.execPath,['bin/review.js',...args],{env,input:'# Paste',encoding:'utf8'}).trim();
   expect(url).toMatch(/^http:\/\/127\.0\.0\.1:8787\/live\//);
   expect(JSON.parse(readFileSync(path.join(dir,'feedback/latest-review.json'),'utf8')).url).toBe(url);
  }
  expect(execFileSync(process.execPath,['bin/review.js',file,'--local'],{env,encoding:'utf8'})).toMatch(/^http:\/\/127\.0\.0\.1:8787\/live\//);
  expect(execFileSync(process.execPath,['bin/review.js',file],{env,encoding:'utf8'})).toMatch(/^https:\/\/public\.test\/live\//);
 } finally {stopStartedServer(dir);rmSync(dir,{recursive:true,force:true});}
});

it('gives one document one URL, across edits, and a different document another',()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'stable-url-'));
 try {
  const file=path.join(dir,'doc.md');writeFileSync(file,'# One');
  const other=path.join(dir,'other.md');writeFileSync(other,'# Two');
  const env={...process.env,HOME:dir,USERPROFILE:dir,PORT:'8787',ONLINE_REVIEW_URL_SECRET:'stable-url-test',ONLINE_REVIEW_FEEDBACK_HOME:path.join(dir,'feedback'),ONLINE_REVIEW_SHORT_LINKS_DB:path.join(dir,'links.db'),REVIEW_SERVER_ENTRY:path.resolve('src/lib/review/fixtures/review-server.mjs')};
  const publish=(target:string,...args:string[])=>execFileSync(process.execPath,['bin/review.js',target,'--local',...args],{env,encoding:'utf8'}).trim();
  const url=publish(file);
  expect(publish(file)).toBe(url);
  writeFileSync(file,'# One, rewritten by the agent');
  expect(publish(file)).toBe(url);
  expect(publish(other)).not.toBe(url);
  expect(publish(file,'--long')).toBe(publish(file,'--long'));
 } finally {stopStartedServer(dir);rmSync(dir,{recursive:true,force:true});}
});

it('uses loopback when no URL mode or public base URL is configured',()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'default-review-'));
 try {
  const file=path.join(dir,'sample.md');writeFileSync(file,'# Default');
  const inheritedEnv: NodeJS.ProcessEnv={...process.env};
  delete inheritedEnv.ONLINE_REVIEW_BASE_URL;
  const env={...inheritedEnv,HOME:dir,USERPROFILE:dir,PORT:'9876',ONLINE_REVIEW_URL_SECRET:'default-test',ONLINE_REVIEW_FEEDBACK_HOME:path.join(dir,'feedback'),ONLINE_REVIEW_SHORT_LINKS_DB:path.join(dir,'links.db'),REVIEW_SERVER_ENTRY:path.resolve('src/lib/review/fixtures/review-server.mjs')};
  const url=execFileSync(process.execPath,['bin/review.js',file],{env,encoding:'utf8'}).trim();
  expect(url).toMatch(/^http:\/\/127\.0\.0\.1:9876\/live\//);
 } finally {stopStartedServer(dir);rmSync(dir,{recursive:true,force:true});}
});

it('creates and reuses a private URL secret when none is configured',()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'automatic-review-secret-'));
 try {
  const file=path.join(dir,'sample.md');writeFileSync(file,'# Automatic secret');
  const env: NodeJS.ProcessEnv={...process.env,HOME:dir,PORT:'8787',ONLINE_REVIEW_FEEDBACK_HOME:path.join(dir,'feedback'),ONLINE_REVIEW_SHORT_LINKS_DB:path.join(dir,'links.db')};
  delete env.ONLINE_REVIEW_URL_SECRET;
  const publish=()=>execFileSync(process.execPath,['bin/review.js',file,'--local','--long'],{env,encoding:'utf8'}).trim();
  const first=publish();
  expect(publish()).toBe(first);
  const secretPath=path.join(dir,'.config','online-review.secret');
  expect(readFileSync(secretPath,'utf8').trim()).toMatch(/^[a-f0-9]{64}$/);
 } finally {rmSync(dir,{recursive:true,force:true});}
});

it('starts a LAN-bound server for an explicitly selected local network address',async()=>{
 const lanAddress=Object.entries(networkInterfaces()).filter(([name])=>!/tun|wsl/i.test(name)).flatMap(([,entries])=>entries??[]).find((entry)=>entry.family==='IPv4'&&!entry.internal&&(/^(10\.|192\.168\.)/.test(entry.address)||/^172\.(1[6-9]|2\d|3[01])\./.test(entry.address)))?.address;
 if(!lanAddress)return;
 const dir=mkdtempSync(path.join(tmpdir(),'localnet-review-'));
 try{
  const file=path.join(dir,'sample.md');writeFileSync(file,'# Local network');
  const port=await unusedPort();
  const env={...process.env,HOME:dir,USERPROFILE:dir,PORT:port,REVIEW_SERVER_AUTOSTART:'1',ONLINE_REVIEW_URL_SECRET:'localnet-test',ONLINE_REVIEW_FEEDBACK_HOME:path.join(dir,'feedback'),ONLINE_REVIEW_SHORT_LINKS_DB:path.join(dir,'links.db'),REVIEW_SERVER_ENTRY:path.resolve('src/lib/review/fixtures/review-server.mjs')};
  const url=execFileSync(process.execPath,['bin/review.js',file,`--localnet=${lanAddress}`],{env,encoding:'utf8'}).trim();
  expect(url).toMatch(new RegExp(`^http://${lanAddress.replaceAll('.','\\.')}:${port}/live/`));
  await expect(fetch(url).then(response=>response.text())).resolves.toBe('ReviewLoop test server');
 }finally{stopStartedServer(dir);rmSync(dir,{recursive:true,force:true});}
});

it('starts the loopback server before configuring a tailnet tunnel',async()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'tailnet-review-autostart-'));
 try{
  const file=path.join(dir,'sample.md');writeFileSync(file,'# Tailnet');
  const port=await unusedPort();
  const bin=path.join(dir,'bin');mkdirSync(bin);
  const fake=`#!${process.execPath}\nif(process.argv[2]==='status')process.stdout.write(JSON.stringify({BackendState:'Running',Self:{Online:true,DNSName:'review.test.ts.net.'}}));`;
  writeFileSync(path.join(bin,'tailscale'),fake,{mode:0o700});
  writeFileSync(path.join(bin,'tailscale.cmd'),`@"${process.execPath}" "${path.join(bin,'tailscale').replaceAll('\\','\\\\')}" %*\r\n`);
  const env={...process.env,HOME:dir,USERPROFILE:dir,PATH:`${bin}${path.delimiter}${process.env.PATH}`,PORT:port,REVIEW_SERVER_AUTOSTART:'1',TAILSCALE_BIN:process.execPath,TAILSCALE_BIN_ARGS:JSON.stringify([path.join(bin,'tailscale')]),ONLINE_REVIEW_URL_SECRET:'tailnet-test',ONLINE_REVIEW_FEEDBACK_HOME:path.join(dir,'feedback'),ONLINE_REVIEW_SHORT_LINKS_DB:path.join(dir,'links.db'),REVIEW_SERVER_ENTRY:path.resolve('src/lib/review/fixtures/review-server.mjs')};
  const url=execFileSync(process.execPath,['bin/review.js',file,'--tailnet'],{env,encoding:'utf8'}).trim();
  expect(url).toMatch(/^https:\/\/review\.test\.ts\.net\/live\//);
  await expect(fetch(`http://127.0.0.1:${port}/`).then(response=>response.text())).resolves.toBe('ReviewLoop test server');
 }finally{stopStartedServer(dir);rmSync(dir,{recursive:true,force:true});}
});
