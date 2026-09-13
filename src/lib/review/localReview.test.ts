import { expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { networkInterfaces } from 'node:os';
import path from 'node:path';
it('publishes local links for files, paste and clipboard and remembers the local target',()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'local-review-'));
 try {
  const file=path.join(dir,'sample.md');writeFileSync(file,'# Local');
  const bin=path.join(dir,'bin');mkdirSync(bin);
  writeFileSync(path.join(bin,'wl-paste'),`#!${process.execPath}\nprocess.stdout.write('# Clipboard');`,{mode:0o700});
  const env={...process.env,HOME:dir,PATH:bin,PORT:'8787',WAYLAND_DISPLAY:'test',WSL_INTEROP:'',WSL_DISTRO_NAME:'',ONLINE_REVIEW_BASE_URL:'https://public.test/live',ONLINE_REVIEW_URL_SECRET:'local-test',ONLINE_REVIEW_FEEDBACK_HOME:path.join(dir,'feedback'),ONLINE_REVIEW_SHORT_LINKS_DB:path.join(dir,'links.db')};
  for(const args of [[file,'--local'],['paste','--local','--long'],['--clipboard','--local']]){
   const url=execFileSync(process.execPath,['bin/review.js',...args],{env,input:'# Paste',encoding:'utf8'}).trim();
   expect(url).toMatch(/^http:\/\/127\.0\.0\.1:8787\/live\//);
   expect(JSON.parse(readFileSync(path.join(dir,'feedback/latest-review.json'),'utf8')).url).toBe(url);
  }
  expect(execFileSync(process.execPath,['bin/review.js',file,'--local'],{env,encoding:'utf8'})).toMatch(/^http:\/\/127\.0\.0\.1:8787\/live\//);
  expect(execFileSync(process.execPath,['bin/review.js',file],{env,encoding:'utf8'})).toMatch(/^https:\/\/public\.test\/live\//);
 } finally {rmSync(dir,{recursive:true,force:true});}
});

it('publishes with an explicitly selected local network address',()=>{
 const lanAddress=Object.entries(networkInterfaces()).filter(([name])=>!/tun|wsl/i.test(name)).flatMap(([,entries])=>entries??[]).find((entry)=>entry.family==='IPv4'&&!entry.internal&&(/^(10\.|192\.168\.)/.test(entry.address)||/^172\.(1[6-9]|2\d|3[01])\./.test(entry.address)))?.address;
 if(!lanAddress)return;
 const dir=mkdtempSync(path.join(tmpdir(),'localnet-review-'));
 try{
  const file=path.join(dir,'sample.md');writeFileSync(file,'# Local network');
  const env={...process.env,HOME:dir,PORT:'8787',ONLINE_REVIEW_URL_SECRET:'localnet-test',ONLINE_REVIEW_FEEDBACK_HOME:path.join(dir,'feedback'),ONLINE_REVIEW_SHORT_LINKS_DB:path.join(dir,'links.db')};
  const url=execFileSync(process.execPath,['bin/review.js',file,`--localnet=${lanAddress}`],{env,encoding:'utf8'}).trim();
  expect(url).toMatch(new RegExp(`^http://${lanAddress.replaceAll('.','\\.')}:8787/live/`));
 }finally{rmSync(dir,{recursive:true,force:true});}
});
