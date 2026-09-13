import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { latestReview } from './latest-review.js';

export async function runFeedback(args) {
 if (['--help','-h'].includes(args[0])) {
  console.log('Usage: review feedback [url-or-id] [--json] [--wait] [--after <cursor>] [--timeout <seconds>] [--out <new-directory>]\nWithout a URL, reads submitted feedback for the most recently published local review.');
  return;
 }
 const explicitTarget=args[0] && !args[0].startsWith('--') ? args[0] : undefined;
 let cursor=0,wait=false,timeout=300,out;
 for(let i=explicitTarget?1:0;i<args.length;i++){
  const flag=args[i];
  if(flag==='--json')continue;
  if(flag==='--wait'){wait=true;continue;}
  if(!['--after','--timeout','--out'].includes(flag)||!args[i+1])throw new Error(`Unknown or incomplete option: ${flag}`);
  const value=args[++i];if(flag==='--after')cursor=Number(value);else if(flag==='--timeout')timeout=Number(value);else out=value;
 }
 if(!Number.isSafeInteger(cursor)||cursor<0||!Number.isFinite(timeout)||timeout<0)throw new Error('Invalid cursor or timeout');
 const target=explicitTarget || latestReview();
 const base=process.env.ONLINE_REVIEW_BASE_URL||`http://127.0.0.1:${process.env.PORT||'8787'}/live`;
 const review=new URL(/^https?:\/\//.test(target)?target:`${base.replace(/\/$/,'')}/${target}`);
 if(!['https:','http:'].includes(review.protocol)||!/^\/live\/[^/]+\/?$/.test(review.pathname))throw new Error('Expected a /live/<token> review URL');
 const endpoint=new URL(`${review.pathname.replace(/\/$/,'')}/feedback`,review.origin);
 endpoint.searchParams.set('format','agent');endpoint.searchParams.set('after',String(cursor));
 const deadline=Date.now()+timeout*1000;
 let result;
 do {
  const response=await fetch(endpoint,{signal:AbortSignal.timeout(30000)});
  if(!response.ok)throw new Error(`Feedback request failed (HTTP ${response.status})`);
  result=await response.json();
  if(!Array.isArray(result.batches))throw new Error('Invalid feedback response');
  if(result.batches.length||!wait||Date.now()>=deadline)break;
  await new Promise(resolve=>setTimeout(resolve,Math.min(2000,Math.max(0,deadline-Date.now()))));
 }while(true);
 if(out){
  await mkdir(out,{recursive:false});
  const resources=[...result.files.map(f=>({url:f.url,name:`original-${f.sha256.slice(0,12)}-${path.basename(f.filename)}`})),...result.batches.flatMap(b=>b.comments.filter(c=>c.previewUrl).map(c=>({url:c.previewUrl,name:`annotation-${String(c.id).replace(/[^a-zA-Z0-9_-]/g,'_')}.png`})) )];
  const downloaded=new Set();
  for(const resource of resources){
   if(downloaded.has(resource.name))continue;downloaded.add(resource.name);
   const url=new URL(resource.url);if(url.origin!==endpoint.origin||url.pathname!==endpoint.pathname)throw new Error('Unexpected attachment URL');
   const response=await fetch(url,{signal:AbortSignal.timeout(600000)});if(!response.ok)throw new Error(`Attachment download failed (HTTP ${response.status})`);
   if(!response.body)throw new Error('Empty attachment response');
   await pipeline(response.body,createWriteStream(path.join(out,resource.name),{flags:'wx'}));resource.localPath=path.join(out,resource.name);
  }
  result.downloads=resources;await writeFile(path.join(out,'feedback.json'),JSON.stringify(result,null,2),{flag:'wx'});
 }
 console.log(JSON.stringify(result,null,2));
}
