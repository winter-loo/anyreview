import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, realpathSync, statSync, writeFileSync, existsSync, renameSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
/** @param {string | Uint8Array} value */
export const digest = value => createHash('sha256').update(value).digest('hex');
export function feedbackHome() { return process.env.ONLINE_REVIEW_FEEDBACK_HOME || path.join(homedir(), '.config/online-review-feedback'); }
/** @typedef {{id:string,version:string,kind:string,files:{filename:string,hash:string,size:number,snapshotPath:string}[]}} Snapshot */
/** Freeze exactly the bytes a published capability refers to. @param {string} id @param {string[]} sources @returns {Snapshot} */
export function freezeReview(id,sources) {
 const directory=path.join(feedbackHome(),'snapshots',id),manifest=path.join(directory,'manifest.json');
 if(existsSync(manifest))return JSON.parse(readFileSync(manifest,'utf8'));
 if(!sources.length||sources.length>100)throw new Error('Invalid review files');
 const home=realpathSync(homedir());let total=0;
 const files=sources.map((source,index)=>{
  const resolved=realpathSync(source);
  if(!resolved.startsWith(home+path.sep)&&!resolved.startsWith('/tmp/'))throw new Error('File is not publishable');
  const stat=statSync(resolved);total+=stat.size;
  if(!stat.isFile()||stat.size>50*1024*1024||total>200*1024*1024)throw new Error('Review is too large');
  const ext=path.extname(resolved).toLowerCase();
  if(!['.png','.jpg','.jpeg','.webp','.gif','.svg','.bmp','.avif','.pdf','.docx','.doc','.pptx','.ppt','.xlsx','.xls','.csv','.md'].includes(ext))throw new Error('Unsupported review file');
  const bytes=readFileSync(resolved),hash=digest(bytes),filename=path.basename(resolved);
  const snapshotPath=path.join(directory,String(index),filename);mkdirSync(path.dirname(snapshotPath),{recursive:true});writeFileSync(snapshotPath,bytes,{mode:0o600});
  return {filename,hash,size:bytes.length,snapshotPath};
 });
 const ext=path.extname(files[0].filename).toLowerCase();
 const kind=ext==='.pdf'?'pdf':['.doc','.docx'].includes(ext)?'word':['.ppt','.pptx'].includes(ext)?'ppt':['.xlsx','.xls','.csv'].includes(ext)?'excel':ext==='.md'?'markdown':'image';
 if(files.length>1&&kind!=='image')throw new Error('Only image reviews support multiple files');
 const snapshot={id,version:digest(JSON.stringify(files.map(f=>[f.filename,f.hash]))),kind,files};
 writeFileSync(manifest+'.tmp',JSON.stringify(snapshot),{mode:0o600});renameSync(manifest+'.tmp',manifest);return snapshot;
}
