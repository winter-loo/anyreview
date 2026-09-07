import { MAX_FEEDBACK_REQUEST_BYTES } from '$lib/feedback/limits';
import { readFileSync } from 'node:fs';
import { error, json } from '@sveltejs/kit';
import { liveSnapshot } from '$lib/server/live/snapshots';
import { openFeedbackDb, feedbackState, applyOperations, submitFeedback, agentFeedback } from '$lib/server/live/feedback';
import type { FeedbackOperation } from '$lib/feedback/types';
import type { RequestHandler } from './$types';

const headers = {'cache-control':'no-store','x-content-type-options':'nosniff'};
export const GET: RequestHandler = ({params,url}) => {
 const snapshot=liveSnapshot(params.token),db=openFeedbackDb();
 try {
  if (url.searchParams.has('file')) {
   const index=Number(url.searchParams.get('file'));
   if(!Number.isInteger(index)||index<0||index>=snapshot.files.length) throw error(404,'File not found');
   const file=snapshot.files[index];return new Response(readFileSync(file.snapshotPath),{headers:{...headers,'content-type':'application/octet-stream','content-disposition':`attachment; filename*=UTF-8''${encodeURIComponent(file.filename)}`}});
  }
  if (url.searchParams.has('preview')) {
   const row=db.prepare('SELECT preview FROM live_annotations WHERE review=? AND id=?').get(snapshot.id,url.searchParams.get('preview')!) as {preview:Uint8Array}|undefined;
   if(!row?.preview) throw error(404,'Preview not available');
   return new Response(Buffer.from(row.preview),{headers:{...headers,'content-type':'image/png'}});
  }
  if(url.searchParams.get('format')==='agent') {
   const after=Number(url.searchParams.get('after')||0);if(!Number.isSafeInteger(after)||after<0) throw error(400,'Invalid cursor');
   return json(agentFeedback(db,snapshot,`${url.origin}${url.pathname}`,after),{headers});
  }
  return json(feedbackState(db,snapshot),{headers});
 } finally {db.close();}
};
export const POST: RequestHandler = async ({params,request,url}) => {
 const origin=request.headers.get('origin');
 if(origin && origin!==url.origin) throw error(403,'Cross-origin feedback writes are not allowed');
 if(!request.headers.get('content-type')?.startsWith('application/json')) throw error(415,'JSON body required');
 const reader=request.body?.getReader();if(!reader) throw error(400,'Missing body');
 let size=0;const chunks:Uint8Array[]=[];
 while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>MAX_FEEDBACK_REQUEST_BYTES){await reader.cancel();throw error(413,'Feedback request too large');}chunks.push(value);}
 let body:{version:string;operations?:FeedbackOperation[];submit?:string};
 try {body=JSON.parse(Buffer.concat(chunks).toString());}catch{throw error(400,'Invalid JSON');}
 if(!body||typeof body!=='object'||Array.isArray(body))throw error(400,'Invalid request body');
 const snapshot=liveSnapshot(params.token),db=openFeedbackDb();
 try {
  if(body.version!==snapshot.version) throw error(409,'Review version has changed');
  if(body.operations) applyOperations(db,snapshot,body.version,body.operations);
  const result=body.submit?submitFeedback(db,snapshot,body.submit):{};
  return json({...feedbackState(db,snapshot),...result},{headers});
 }finally{db.close();}
};
