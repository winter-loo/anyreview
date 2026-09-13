import { describe,it,expect } from 'vitest';
import { mkdtempSync,writeFileSync,readFileSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { freezeReview } from '../../../../bin/live-snapshot.js';
describe('immutable live review snapshot',()=>{
 it('retains published bytes after the source changes, and hashes a new review separately',()=>{
  const dir=mkdtempSync(path.join(tmpdir(),'live-snapshot-test-'));const old=process.env.ONLINE_REVIEW_FEEDBACK_HOME;process.env.ONLINE_REVIEW_FEEDBACK_HOME=dir;
  try {const file=path.join(dir,'original.svg');writeFileSync(file,'original');const first=freezeReview('first',[file]);writeFileSync(file,'updated');const same=freezeReview('first',[file]);const next=freezeReview('second',[file]);expect(readFileSync(same.files[0].snapshotPath,'utf8')).toBe('original');expect(same.version).toBe(first.version);expect(next.version).not.toBe(first.version);}
  finally{if(old===undefined)delete process.env.ONLINE_REVIEW_FEEDBACK_HOME;else process.env.ONLINE_REVIEW_FEEDBACK_HOME=old;rmSync(dir,{recursive:true,force:true});}
 });
 it('publishes a source outside the configured home directory',()=>{
  const dir=mkdtempSync(path.join(tmpdir(),'live-snapshot-outside-home-'));const oldFeedback=process.env.ONLINE_REVIEW_FEEDBACK_HOME;const oldHome=process.env.HOME;process.env.ONLINE_REVIEW_FEEDBACK_HOME=dir;process.env.HOME=path.join(dir,'unrelated-home');
  try {const snapshot=freezeReview('outside-home',[path.resolve('README.md')]);expect(snapshot.files[0].filename).toBe('README.md');expect(snapshot.files[0].size).toBeGreaterThan(0);}
  finally{if(oldFeedback===undefined)delete process.env.ONLINE_REVIEW_FEEDBACK_HOME;else process.env.ONLINE_REVIEW_FEEDBACK_HOME=oldFeedback;if(oldHome===undefined)delete process.env.HOME;else process.env.HOME=oldHome;rmSync(dir,{recursive:true,force:true});}
 });
});
