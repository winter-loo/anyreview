import { describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
const run=promisify(execFile);

describe('default feedback target',()=>{
 it('uses the latest publication for short and long URLs, supports flags and explicit overrides',async()=>{
  const dir=mkdtempSync(path.join(tmpdir(),'latest-feedback-'));
  const server=createServer((req,res)=>{res.setHeader('content-type','application/json');res.end(JSON.stringify({files:[],batches:[],requested:req.url}));});
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  const address=server.address() as {port:number};
  const base=`http://127.0.0.1:${address.port}/live`;
  const env={...process.env,HOME:dir,ONLINE_REVIEW_URL_SECRET:'latest-test',ONLINE_REVIEW_BASE_URL:base,ONLINE_REVIEW_FEEDBACK_HOME:path.join(dir,'feedback'),ONLINE_REVIEW_SHORT_LINKS_DB:path.join(dir,'links.db')};
  const cli=async(args:string[])=>(await run(process.execPath,['bin/review.js',...args],{env})).stdout.trim();
  try {
   await expect(cli(['feedback'])).rejects.toThrow('No published review found');
   const file=path.join(dir,'example.md');writeFileSync(file,'# First');
   for(const flags of [[],['--long']]) {
    const url=await cli([file,...flags]);
    expect(JSON.parse(readFileSync(path.join(dir,'feedback/latest-review.json'),'utf8')).url).toBe(url);
    const result=JSON.parse(await cli(['feedback']));
    expect(result.requested).toBe(`${new URL(url).pathname}/feedback?format=agent&after=0`);
    expect(result.batches).toEqual([]);
    const waiting=JSON.parse(await cli(['feedback','--wait','--timeout','0','--json','--after','3']));
    expect(waiting.requested).toBe(`${new URL(url).pathname}/feedback?format=agent&after=3`);
   }
   expect(JSON.parse(await cli(['feedback','manual','--after','7'])).requested).toBe('/live/manual/feedback?format=agent&after=7');
   const record=readFileSync(path.join(dir,'feedback/latest-review.json'),'utf8');
   await expect(cli([path.join(dir,'missing.md')])).rejects.toThrow();
   expect(readFileSync(path.join(dir,'feedback/latest-review.json'),'utf8')).toBe(record);
   writeFileSync(path.join(dir,'feedback/latest-review.json'),'broken');
   await expect(cli(['feedback'])).rejects.toThrow('Cannot read latest review record');
   expect(JSON.parse(await cli(['feedback','manual'])).requested).toContain('/live/manual/feedback');
  } finally {
   await new Promise<void>((resolve,reject)=>server.close(e=>e?reject(e):resolve()));
   rmSync(dir,{recursive:true,force:true});
  }
 },20000);
 it('uses the most recent legacy short link when no publication pointer exists',async()=>{
  const dir=mkdtempSync(path.join(tmpdir(),'legacy-feedback-'));
  const dbPath=path.join(dir,'links.db');const db=new DatabaseSync(dbPath);
  db.exec('CREATE TABLE short_links(id TEXT,token TEXT,created_at TEXT)');
  db.prepare('INSERT INTO short_links VALUES (?,?,?)').run('old','unused','2026-01-01');
  db.prepare('INSERT INTO short_links VALUES (?,?,?)').run('new','unused','2026-02-01');db.close();
  try {
   const script="import {latestReview} from './bin/latest-review.js'; console.log(latestReview());";
   const {stdout}=await run(process.execPath,['--input-type=module','-e',script],{env:{...process.env,HOME:dir,ONLINE_REVIEW_BASE_URL:'https://example.test/live',ONLINE_REVIEW_FEEDBACK_HOME:path.join(dir,'feedback'),ONLINE_REVIEW_SHORT_LINKS_DB:dbPath}});
   expect(stdout.trim()).toBe('https://example.test/live/new');
  } finally {rmSync(dir,{recursive:true,force:true});}
 });
});
