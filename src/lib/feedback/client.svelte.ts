import { setContext } from 'svelte';
import { FEEDBACK_CONTEXT, type Annotation, type FeedbackOperation, type FeedbackState } from './types';
import { capturePreview } from './preview';
import { MAX_PREVIEW_BYTES, pngPreviewBytes } from './limits';

class FeedbackRequestError extends Error {
 constructor(public status: number, message: string) { super(message); }
}

export function createLiveFeedback<T extends {id:string;body:string;createdAt:string}>(config:{token:()=>string;kind:string;read:()=>T[];replace:(entries:T[])=>void}) {
 let status=$state('正在连接'),error=$state(''),pendingCount=$state(0),submittedCount=$state(0),busy=$state(false);
 let state=$state<FeedbackState|null>(null);
 let queue:FeedbackOperation[]=[],running:Promise<void>|null=null,stopped=false;
 let legacy:T[]=[],jobs:Promise<void>[]=[];
 const key=()=>`reviewloop:feedback:${config.token()}`;
 const url=()=>`/live/${encodeURIComponent(config.token())}/feedback`;
 const operationId=()=>crypto.randomUUID();
 function stash(){try{localStorage.setItem(key(),JSON.stringify({queue,initialized:!!state}));}catch{error='本机缓存空间不足，请保持页面打开直到同步完成';}}
 async function request(body?:object):Promise<FeedbackState>{
  const response=await fetch(url(),body?{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}:{cache:'no-store'});
  if(!response.ok){let message='同步失败，请重试';try{message=(await response.json()).message||message;}catch{}throw new FeedbackRequestError(response.status,message);}
  return response.json();
 }
 function discardPreview(operation:FeedbackOperation,message:string){
  delete operation.preview;operation.previewError=message;stash();
 }
 function boundPreview(operation:FeedbackOperation){
  if(operation.type==='preview'&&operation.preview&&pngPreviewBytes(operation.preview)>MAX_PREVIEW_BYTES){
   discardPreview(operation,'截图超过 2 MiB 限制，请结合原文件与坐标查看');
  }
 }
 function accept(next:FeedbackState){
  state=next;pendingCount=next.pendingCount;submittedCount=next.submittedCount;
  const entries=new Map(next.annotations.map(a=>[a.id,a]));
  for(const op of queue){if(op.type==='add'&&op.annotation)entries.set(op.annotation.id,op.annotation);if(op.type==='delete')entries.delete(op.id!);}
  config.replace([...entries.values()] as unknown as T[]);
  try{localStorage.setItem(`reviewloop:live-${config.kind}:${config.token()}`,JSON.stringify([...entries.values()]));}catch{}
 }
 async function flush(){
  if(stopped)return;
  if(running)return running;
  running=(async()=>{
   try{
    status='正在同步';error='';
    if(!state){
     const remote=await request();
     // Import only records from pre-sync browsers. Stable IDs make repeated imports harmless.
     if(legacy.length){const seen=new Set(queue.filter(o=>o.type==='add').map(o=>o.annotation?.id));for(const entry of legacy)if(!seen.has(entry.id))queue.push({operationId:operationId(),type:'add',annotation:entry as unknown as Annotation,imported:true});legacy=[];}
     accept(remote);stash();
    }
    while(queue.length){
     await Promise.all(jobs);
     // A preview can be up to 2 MiB. Send individually to keep requests bounded.
     const operation=queue[0];boundPreview(operation);
     let next:FeedbackState;
     try{next=await request({version:state!.review.version,operations:[operation]});}
     catch(cause){
      if(operation.type!=='preview'||!operation.preview||!(cause instanceof FeedbackRequestError)||cause.status!==413)throw cause;
      // A proxy may impose a lower limit. Keep the annotation and send the supported error-only operation.
      discardPreview(operation,'截图上传超出服务器限制，请结合原文件与坐标查看');
      next=await request({version:state!.review.version,operations:[operation]});
     }
     queue=queue.filter(o=>o.operationId!==operation.operationId);accept(next);stash();
    }
    accept(await request());status='已同步';
   }catch(e){status='未同步';error=e instanceof Error?e.message:'同步失败';stash();}
   finally{running=null;}
  })();
  return running;
 }
 function persist(next:T[]){
  const previous=config.read();const ids=new Set(next.map(a=>a.id)),existing=new Set(previous.map(a=>a.id));
  for(const old of previous)if(!ids.has(old.id))queue.push({operationId:operationId(),type:'delete',id:old.id});
  for(const entry of next)if(!existing.has(entry.id)){
   const annotation=entry as unknown as Annotation;
   queue.push({operationId:operationId(),type:'add',annotation});
   if(Array.isArray(annotation.strokes)){
    const previewOperation:FeedbackOperation={operationId:operationId(),type:'preview',id:entry.id,previewError:'截图生成被中断，请结合原文件与坐标查看'};
    queue.push(previewOperation);
    const job=capturePreview(config.kind,annotation).then(preview=>{previewOperation.preview=preview;previewOperation.previewError='';boundPreview(previewOperation);}).catch(e=>{previewOperation.previewError=e instanceof Error?e.message:'截图生成失败';}).finally(()=>{stash();void flush();});
    jobs.push(job);void job.finally(()=>jobs=jobs.filter(j=>j!==job));
   }
  }
  config.replace(next);try{localStorage.setItem(`reviewloop:live-${config.kind}:${config.token()}`,JSON.stringify(next));}catch{}stash();void flush();
 }
 function start(local:T[]){
  try{const saved=JSON.parse(localStorage.getItem(key())||'null');queue=Array.isArray(saved?.queue)?saved.queue:[];if(!saved?.initialized)legacy=local;}catch{legacy=local;}
  void flush();
  const retry=()=>void flush();window.addEventListener('online',retry);
  const timer=setInterval(retry,15000);
  return ()=>{stopped=true;clearInterval(timer);window.removeEventListener('online',retry);};
 }
 async function submit(){
  if(busy)return;busy=true;
  try{
   await Promise.all(jobs);await flush();if(error||queue.length||!state)throw new Error(error||'请等待批注同步完成');
   // Retain this key through a failed request so retrying cannot submit twice.
   const requestKey=`${key()}:submit`;let id=localStorage.getItem(requestKey);if(!id){id=operationId();localStorage.setItem(requestKey,id);}
   const next=await request({version:state.review.version,submit:id});accept(next);localStorage.removeItem(requestKey);status='已提交给 AI';
  }catch(e){error=e instanceof Error?e.message:'提交失败，请重试';}
  finally{busy=false;}
 }
 const context={get status(){return status;},get error(){return error;},get pendingCount(){return pendingCount;},get submittedCount(){return submittedCount;},get legacyCount(){return state?.legacyCount||0;},get missingPreviewCount(){return state?.missingPreviewCount||0;},get busy(){return busy;},submit,retry:flush};
 setContext(FEEDBACK_CONTEXT,context);
 return {start,persist,...{get context(){return context;}}};
}
