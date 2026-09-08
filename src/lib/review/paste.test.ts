import { describe, expect, it } from 'vitest';
import { spawnSync, execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { digest } from '../../../bin/live-snapshot.js';

function environment(dir:string){return {...process.env,HOME:dir,ONLINE_REVIEW_URL_SECRET:'paste-test',ONLINE_REVIEW_BASE_URL:'https://example.test/live',ONLINE_REVIEW_FEEDBACK_HOME:path.join(dir,'feedback')};}
function publishedText(dir:string,url:string){
 const token=url.trim().split('/').at(-1)!;
 const snapshot=JSON.parse(readFileSync(path.join(dir,'feedback/snapshots',digest(token),'manifest.json'),'utf8'));
 expect(snapshot.kind).toBe('markdown');expect(snapshot.files[0].filename).toBe('paste.md');
 return readFileSync(snapshot.files[0].snapshotPath,'utf8');
}
describe('review paste',()=>{
 it('preserves piped Markdown exactly, publishes a snapshot and removes the temporary file',()=>{
  const dir=mkdtempSync(path.join(tmpdir(),'paste-test-'));
  try {
   const input='\uFEFF# 回答\r\n\r\n```sh\necho "$HOME"\n```\n\n> quote without final newline';
   const url=execFileSync(process.execPath,['bin/review.js','paste','--long'],{env:environment(dir),input,encoding:'utf8'});
   expect(publishedText(dir,url)).toBe(input);
   expect(readdirSync(path.join(dir,'.config/online-review-paste'))).toEqual([]);
  }finally{rmSync(dir,{recursive:true,force:true});}
 });
 it('rejects empty, binary, invalid UTF-8, oversized input and removed commands without publishing',()=>{
  const dir=mkdtempSync(path.join(tmpdir(),'paste-errors-'));
  try {
   for(const input of [Buffer.from(' \n'),Buffer.from('a\0b'),Buffer.from([255]),Buffer.alloc(5*1024*1024+1,65)]){
    const result=spawnSync(process.execPath,['bin/review.js','paste'],{env:environment(dir),input,encoding:'utf8'});
    expect(result.status).toBe(1);expect(result.stdout).toBe('');expect(result.stderr.length).toBeGreaterThan(0);
   }
   for(const args of [['paste','--clipboard'],['agent','codex'],['paste','unexpected.md']]){
    const result=spawnSync(process.execPath,['bin/review.js',...args],{env:environment(dir),input:'text',encoding:'utf8'});
    expect(result.status).toBe(1);expect(result.stdout).toBe('');
   }
  }finally{rmSync(dir,{recursive:true,force:true});}
 });
 it('accepts a long multiline paste in a real terminal and supports cancellation',()=>{
  const dir=mkdtempSync(path.join(tmpdir(),'paste-tty-'));
  try {
   const harness=`
import os,pty,select,time,signal

def run(cancel):
 pid,fd=pty.fork()
 if pid==0:os.execv(${JSON.stringify(process.execPath)},[${JSON.stringify(process.execPath)},'bin/review.js','paste','--long'])
 data=b'';sent=False;deadline=time.monotonic()+15
 try:
  while time.monotonic()<deadline:
   if not select.select([fd],[],[],.1)[0]:continue
   try:chunk=os.read(fd,65536)
   except OSError:break
   if not chunk:break
   data+=chunk
   if not sent and 'Ctrl+C'.encode() in data:
    time.sleep(.05)
    payload=b'\\x03' if cancel else b'# Test\\r\\r'+b'x'*5000+b'\\r\\x04'
    while payload:
     n=os.write(fd,payload);payload=payload[n:]
    sent=True
  else:
   os.kill(pid,signal.SIGTERM);raise Exception('timeout')
  _,status=os.waitpid(pid,0)
  assert os.waitstatus_to_exitcode(status)==(1 if cancel else 0),repr(data[-500:])
  if cancel:assert b'https://example.test/live/' not in data
  else:
   import re
   url=re.search(rb'https://example.test/live/[A-Za-z0-9_-]+',data)
   assert url,repr(data[-500:])
   print(url.group().decode())
 finally:os.close(fd)
run(False)
run(True)
`;
   const url=execFileSync('python3',['-c',harness],{env:environment(dir),encoding:'utf8',timeout:35000});
   expect(readdirSync(path.join(dir,'feedback/snapshots'))).toHaveLength(1);
   expect(publishedText(dir,url)).toBe('# Test\n\n'+'x'.repeat(5000)+'\n');
  }finally{rmSync(dir,{recursive:true,force:true});}
 },40000);
});
