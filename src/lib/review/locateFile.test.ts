import { describe, expect, it } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { digest } from '../../../bin/live-snapshot.js';

const reviewBin=path.resolve('bin/review.js');
function environment(dir:string,extra:NodeJS.ProcessEnv={}){return {...process.env,HOME:dir,ONLINE_REVIEW_URL_SECRET:'locate-test',ONLINE_REVIEW_BASE_URL:'https://example.test/live',ONLINE_REVIEW_FEEDBACK_HOME:path.join(dir,'feedback'),...extra};}
function publishedText(dir:string,url:string){
 const token=url.trim().split('/').at(-1)!;
 const snapshot=JSON.parse(readFileSync(path.join(dir,'feedback/snapshots',digest(token),'manifest.json'),'utf8'));
 return readFileSync(snapshot.files[0].snapshotPath,'utf8');
}
function workspace(prefix:string){
 const dir=mkdtempSync(path.join(tmpdir(),prefix));
 const project=path.join(dir,'project');
 for(const [file,text] of [['docs/unique.md','# Unique'],['a/notes.md','# A'],['b/deep/notes.md','# B']]){
  mkdirSync(path.dirname(path.join(project,file)),{recursive:true});writeFileSync(path.join(project,file),text);
 }
 return {dir,project};
}

describe('review <bare file name>',()=>{
 it('publishes a single fd match and lists ambiguous or missing names without a terminal',()=>{
  const {dir,project}=workspace('locate-test-');
  try {
   const unique=spawnSync(process.execPath,[reviewBin,'unique.md','--long'],{cwd:project,env:environment(dir),encoding:'utf8'});
   expect(unique.status).toBe(0);expect(unique.stderr).toContain('docs/unique.md');
   expect(publishedText(dir,unique.stdout)).toBe('# Unique');

   const ambiguous=spawnSync(process.execPath,[reviewBin,'notes.md'],{cwd:project,env:environment(dir),input:'',encoding:'utf8'});
   expect(ambiguous.status).toBe(1);expect(ambiguous.stdout).toBe('');
   expect(ambiguous.stderr).toContain('  a/notes.md\n  b/deep/notes.md');

   const missing=spawnSync(process.execPath,[reviewBin,'absent.md'],{cwd:project,env:environment(dir),encoding:'utf8'});
   expect(missing.status).toBe(1);expect(missing.stderr).toContain('File not found: absent.md');

   const noFd=spawnSync(process.execPath,[reviewBin,'unique.md'],{cwd:project,env:environment(dir,{PATH:path.join(dir,'empty-bin')}),encoding:'utf8'});
   expect(noFd.status).toBe(1);expect(noFd.stderr).toContain('Install fd');

   const nested=spawnSync(process.execPath,[reviewBin,'docs/absent.md'],{cwd:project,env:environment(dir),encoding:'utf8'});
   expect(nested.status).toBe(1);expect(nested.stderr).toContain('ENOENT');
  } finally {rmSync(dir,{recursive:true,force:true});}
 });

 it('lets a terminal user pick among several matches with the arrow keys and cancel with Ctrl+C',()=>{
  const {dir,project}=workspace('locate-tty-');
  try {
   const harness=`
import os,pty,select,time,signal,re

def run(keys):
 pid,fd=pty.fork()
 if pid==0:os.execv(${JSON.stringify(process.execPath)},[${JSON.stringify(process.execPath)},${JSON.stringify(reviewBin)},'notes.md','--long'])
 data=b'';sent=False;deadline=time.monotonic()+15
 try:
  while time.monotonic()<deadline:
   if not select.select([fd],[],[],.1)[0]:continue
   try:chunk=os.read(fd,65536)
   except OSError:break
   if not chunk:break
   data+=chunk
   if not sent and b'b/deep/notes.md' in data:
    time.sleep(.1);os.write(fd,keys);sent=True
  else:
   os.kill(pid,signal.SIGTERM);raise Exception('timeout')
  _,status=os.waitpid(pid,0)
  return os.waitstatus_to_exitcode(status),data
 finally:os.close(fd)

code,data=run(b'\\x1b[B\\r')
assert code==0,repr(data[-500:])
url=re.search(rb'https://example.test/live/[A-Za-z0-9_-]+',data)
assert url,repr(data[-500:])
print(url.group().decode())
code,data=run(b'\\x03')
assert code==1,repr(data[-500:])
assert b'https://example.test/live/' not in data
assert b'Selection cancelled' in data,repr(data[-500:])
`;
   const url=execFileSync('python3',['-c',harness],{cwd:project,env:environment(dir),encoding:'utf8',timeout:35000});
   expect(publishedText(dir,url)).toBe('# B');
  } finally {rmSync(dir,{recursive:true,force:true});}
 },40000);
});
