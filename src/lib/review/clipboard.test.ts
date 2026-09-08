import { expect, it, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { readClipboard } from '../../../bin/clipboard.js';
import { digest } from '../../../bin/live-snapshot.js';

it('selects native clipboard readers and preserves text',()=>{
 for(const [platform,env,command] of [['darwin',{},'pbpaste'],['win32',{},'powershell.exe'],['linux',{WSL_INTEROP:'yes'},'powershell.exe'],['linux',{WAYLAND_DISPLAY:'yes'},'wl-paste'],['linux',{DISPLAY:':0'},'xclip'],['linux',{TMUX:'yes'},'tmux']] as const){
  const run=vi.fn(()=>Buffer.from('# 中文\n\n> quote\n')) as unknown as typeof execFileSync;
  expect(readClipboard({platform,env,run})).toBe('# 中文\n\n> quote\n');
  expect(vi.mocked(run).mock.calls[0][0]).toBe(command);
 }
});
it('rejects empty, binary, oversized text and disconnected sessions',()=>{
 for(const bytes of [Buffer.from(' '),Buffer.from('a\0b'),Buffer.from([255]),Buffer.alloc(5*1024*1024+1,65)]){
  const run=vi.fn(()=>bytes) as unknown as typeof execFileSync;
  expect(()=>readClipboard({platform:'darwin',env:{},run})).toThrow();
 }
 expect(()=>readClipboard({platform:'linux',env:{}})).toThrow('no supported desktop clipboard connection');
});
it('publishes clipboard text through the CLI and cleans its temporary source',()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'clipboard-test-'));
 try{
  const bin=path.join(dir,'bin');mkdirSync(bin);
  const text='# Copy\n\n```sh\necho "$HOME"\n```';
  writeFileSync(path.join(bin,'wl-paste'),`#!${process.execPath}\nprocess.stdout.write(${JSON.stringify(text)});`,{mode:0o700});
  const env={...process.env,HOME:dir,PATH:bin,WAYLAND_DISPLAY:'test',WSL_INTEROP:'',WSL_DISTRO_NAME:'',ONLINE_REVIEW_URL_SECRET:'clipboard-test',ONLINE_REVIEW_FEEDBACK_HOME:path.join(dir,'feedback')};
  const url=execFileSync(process.execPath,['bin/review.js','--clipboard','--long'],{env,encoding:'utf8'}).trim();
  const snapshot=JSON.parse(readFileSync(path.join(dir,'feedback/snapshots',digest(url.split('/').at(-1)!),'manifest.json'),'utf8'));
  expect(snapshot.files[0].filename).toBe('clipboard.md');
  expect(readFileSync(snapshot.files[0].snapshotPath,'utf8')).toBe(text);
  expect(readdirSync(path.join(dir,'.config/online-review-paste'))).toEqual([]);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
