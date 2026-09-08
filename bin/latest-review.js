import { mkdirSync, readFileSync, writeFileSync, renameSync, rmSync, existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { feedbackHome } from './live-snapshot.js';

/** Remember a successfully snapshotted review, including long-URL publications.
 * @param {string} url
 */
export function rememberReview(url) {
 const root=feedbackHome();
 mkdirSync(root,{recursive:true,mode:0o700});
 const file=path.join(root,'latest-review.json');
 const temporary=file+'.'+randomUUID()+'.tmp';
 try {
  writeFileSync(temporary,JSON.stringify({url,publishedAt:new Date().toISOString()}),{mode:0o600,flag:'wx'});
  renameSync(temporary,file);
 } finally { rmSync(temporary,{force:true}); }
}

export function latestReview() {
 const file=path.join(feedbackHome(),'latest-review.json');
 if(existsSync(file)) {
  let record;
  try { record=JSON.parse(readFileSync(file,'utf8')); }
  catch { throw new Error('Cannot read latest review record. Pass a review URL explicitly or publish a document again.'); }
  if(typeof record?.url!=='string'||!record.url)throw new Error('Invalid latest review record. Pass a review URL explicitly or publish a document again.');
  return record.url;
 }
 // Older releases recorded short links but did not keep a latest-review pointer.
 const dbPath=process.env.ONLINE_REVIEW_SHORT_LINKS_DB||path.join(homedir(),'.config/online-review-links.db');
 if(existsSync(dbPath)) {
  const db=new DatabaseSync(dbPath,{readOnly:true});
  try {
   const row=db.prepare('SELECT id FROM short_links ORDER BY created_at DESC, rowid DESC LIMIT 1').get();
   if(row && typeof row.id==='string') {
    const base=process.env.ONLINE_REVIEW_BASE_URL||'https://deeloo.cn/live';
    return `${base.replace(/\/$/,'')}/${row.id}`;
   }
  } finally {db.close();}
 }
 throw new Error('No published review found. Publish a document with review first, or run review feedback <URL>.');
}
