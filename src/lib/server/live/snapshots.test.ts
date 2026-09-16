import { describe,it,expect } from 'vitest';
import { mkdtempSync,writeFileSync,readFileSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { freezeReview,readSnapshot,pruneVersions } from '../../../../bin/live-snapshot.js';

function withHome(run: (dir: string) => void) {
 const dir=mkdtempSync(path.join(tmpdir(),'live-snapshot-test-'));const old=process.env.ONLINE_REVIEW_FEEDBACK_HOME;process.env.ONLINE_REVIEW_FEEDBACK_HOME=dir;
 try { run(dir); }
 finally { if(old===undefined)delete process.env.ONLINE_REVIEW_FEEDBACK_HOME;else process.env.ONLINE_REVIEW_FEEDBACK_HOME=old;rmSync(dir,{recursive:true,force:true}); }
}

describe('versioned live review snapshot',()=>{
 it('freezes each edit as a new version of the same review, so one URL follows the document',()=>{
  withHome(dir=>{
   const file=path.join(dir,'doc.md');writeFileSync(file,'# First');
   const first=freezeReview('stable',[file]);
   expect(freezeReview('stable',[file]).version).toBe(first.version);
   writeFileSync(file,'# Second revision');
   const second=freezeReview('stable',[file]);
   expect(second.id).toBe(first.id);
   expect(second.version).not.toBe(first.version);
   expect(readFileSync(second.files[0].snapshotPath,'utf8')).toBe('# Second revision');
   // The bytes an earlier reviewer commented on stay readable.
   expect(readFileSync(readSnapshot('stable',first.version)!.files[0].snapshotPath,'utf8')).toBe('# First');
  });
 });

 it('keeps the versions it is told to keep and drops the rest',()=>{
  withHome(dir=>{
   const file=path.join(dir,'doc.md');writeFileSync(file,'# First');
   const first=freezeReview('stable',[file]);
   writeFileSync(file,'# Second revision');
   const second=freezeReview('stable',[file]);
   pruneVersions('stable',[second.version]);
   expect(readSnapshot('stable',first.version)).toBeNull();
   expect(readSnapshot('stable',second.version)?.version).toBe(second.version);
  });
 });

 it('hashes separate reviews separately',()=>{
  withHome(dir=>{
   const file=path.join(dir,'doc.md');writeFileSync(file,'# Shared');
   expect(freezeReview('second',[file]).id).not.toBe(freezeReview('first',[file]).id);
   expect(freezeReview('second',[file]).version).toBe(freezeReview('first',[file]).version);
  });
 });

 it('publishes a source outside the configured home directory',()=>{
  const dir=mkdtempSync(path.join(tmpdir(),'live-snapshot-outside-home-'));const oldFeedback=process.env.ONLINE_REVIEW_FEEDBACK_HOME;const oldHome=process.env.HOME;process.env.ONLINE_REVIEW_FEEDBACK_HOME=dir;process.env.HOME=path.join(dir,'unrelated-home');
  try {const snapshot=freezeReview('outside-home',[path.resolve('README.md')]);expect(snapshot.files[0].filename).toBe('README.md');expect(snapshot.files[0].size).toBeGreaterThan(0);}
  finally{if(oldFeedback===undefined)delete process.env.ONLINE_REVIEW_FEEDBACK_HOME;else process.env.ONLINE_REVIEW_FEEDBACK_HOME=oldFeedback;if(oldHome===undefined)delete process.env.HOME;else process.env.HOME=oldHome;rmSync(dir,{recursive:true,force:true});}
 });
});
