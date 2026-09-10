import { readVideoIndex } from './video';
import { frameEnd, type VideoLocation } from '$lib/video/model';
import { MAX_PREVIEW_BYTES } from '$lib/feedback/limits';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { error } from '@sveltejs/kit';
import { feedbackHome, type Snapshot } from './snapshots';
import type { Annotation, FeedbackOperation } from '../../feedback/types';

export function openFeedbackDb(filename = path.join(feedbackHome(),'feedback.db')) {
 mkdirSync(path.dirname(filename),{recursive:true});
 const db = new DatabaseSync(filename);
 db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
 CREATE TABLE IF NOT EXISTS live_annotations(review TEXT NOT NULL,id TEXT NOT NULL,version TEXT NOT NULL,data TEXT NOT NULL,deleted INTEGER NOT NULL DEFAULT 0,submitted TEXT,preview BLOB,preview_error TEXT,imported INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(review,id));
 CREATE TABLE IF NOT EXISTS live_operations(review TEXT NOT NULL,id TEXT NOT NULL,PRIMARY KEY(review,id));
 CREATE TABLE IF NOT EXISTS live_submissions(sequence INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT UNIQUE NOT NULL,review TEXT NOT NULL,version TEXT NOT NULL,created_at TEXT NOT NULL,comments TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS live_submit_requests(review TEXT NOT NULL,request TEXT NOT NULL,submission TEXT,PRIMARY KEY(review,request));`);
 return db;
}
type Row = { id: string; data: string; submitted: string | null; preview: Uint8Array | null; preview_error: string | null; imported: number };
function validAnnotation(a: Annotation, kind: string) {
 if (!a || typeof a!=='object' || typeof a.id!=='string' || !a.id || a.id.length>200 || typeof a.body!=='string' || a.body.length>20000 || typeof a.createdAt!=='string' || !Number.isFinite(Date.parse(a.createdAt))) throw error(400,'Invalid annotation');
 if (kind==='markdown' && (typeof a.blockId!=='string' || !a.blockId || typeof a.selectedText!=='string' || !a.selectedText.trim() || a.selectedText.length>10000 || typeof a.prefix!=='string' || typeof a.suffix!=='string' || !Number.isInteger(a.startOffset) || !Number.isInteger(a.endOffset) || Number(a.startOffset)<0 || Number(a.endOffset)<=Number(a.startOffset) || Number(a.endOffset)-Number(a.startOffset)!==a.selectedText.length)) throw error(400,'Invalid Markdown text anchor');
 if (kind==='html' && a.type==='text' && (typeof a.selectedText!=='string' || !a.selectedText.trim() || a.selectedText.length>5000)) throw error(400,'Invalid HTML text anchor');
 const strokes = a.strokes as {color:string;size:number;points:{x:number;y:number}[]}[] | undefined;
 if (strokes !== undefined) {
  if (!Array.isArray(strokes) || strokes.length>1000) throw error(400,'Invalid strokes');
  let points=0;
  for (const s of strokes) { if (!s || !/^#[a-f\d]{6}$/i.test(s.color) || !Number.isFinite(s.size) || s.size<=0 || s.size>100 || !Array.isArray(s.points)) throw error(400,'Invalid stroke');
   points+=s.points.length;
   if (points>100000 || s.points.some(p=>!p || !Number.isFinite(p.x)||!Number.isFinite(p.y)||p.x<0||p.y<0||p.x>(kind==='excel'?1000000:1)||p.y>(kind==='excel'?1000000:1))) throw error(400,'Invalid stroke coordinates');
  }
  const badge=a.badgePosition as {x:number;y:number};
  if (!badge || !Number.isFinite(badge.x)||!Number.isFinite(badge.y)) throw error(400,'Invalid annotation marker');
 }
 if (kind==='pdf' || kind==='ppt' || kind==='image') {
  const index = a[kind==='pdf'?'pageIndex':kind==='ppt'?'slideIndex':'imageIndex'];
  if (!Number.isInteger(index) || Number(index)<0) throw error(400,'Invalid page');
  if (!strokes?.length) throw error(400,'A drawing is required');
 }
 if((kind==='word'||kind==='html') && a.type==='brush' && !strokes?.length)throw error(400,'A drawing is required');
 if(kind==='excel' && a.type==='paint' && !strokes?.length)throw error(400,'A drawing is required');
 if(kind==='excel' && a.type==='cell' && ['minR','maxR','minC','maxC'].some(k=>!Number.isInteger(a[k])||Number(a[k])<0))throw error(400,'Invalid cell range');
 if ((kind==='word'||kind==='html') && (a.type!=='text' && a.type!=='brush' || a.type==='text' && typeof a.selectedText!=='string')) throw error(400,'Invalid document annotation');
 if (kind==='excel' && (typeof a.sheetName!=='string' || !['cell','paint'].includes(String(a.type)) || a.type==='cell' && typeof a.cellRef!=='string')) throw error(400,'Invalid worksheet annotation');
}
export function feedbackState(db: DatabaseSync,snapshot: Snapshot) {
 const rows=db.prepare('SELECT * FROM live_annotations WHERE review=? AND deleted=0 ORDER BY rowid').all(snapshot.id) as unknown as Row[];
 return {review:{id:snapshot.id,version:snapshot.version,kind:snapshot.kind,files:snapshot.files.map(({snapshotPath,...f})=>f)},annotations:rows.map(r=>JSON.parse(r.data) as Annotation),pendingCount:rows.filter(r=>!r.submitted).length,submittedCount:rows.filter(r=>r.submitted).length,legacyCount:rows.filter(r=>r.imported&&!r.submitted).length,missingPreviewCount:rows.filter(r=>!r.submitted&&!r.preview&&Array.isArray(JSON.parse(r.data).strokes)).length};
}
export function applyOperations(db: DatabaseSync,snapshot: Snapshot,version: string,operations: FeedbackOperation[]) {
 if (version!==snapshot.version) throw error(409,'Review version has changed');
 if (!Array.isArray(operations)||operations.length>200) throw error(400,'Too many operations');
 db.exec('BEGIN IMMEDIATE');
 try {
  for (const op of operations) {
   if (!op || typeof op.operationId!=='string'||!op.operationId||op.operationId.length>200) throw error(400,'Invalid operation');
   if (db.prepare('SELECT 1 FROM live_operations WHERE review=? AND id=?').get(snapshot.id,op.operationId)) continue;
   if (op.type==='add') {
    validAnnotation(op.annotation!,snapshot.kind);
    if (snapshot.kind==='video') validateVideoAnnotation(op.annotation!, snapshot);
    if (snapshot.kind==='image' && Number(op.annotation!.imageIndex)>=snapshot.files.length) throw error(400,'Invalid image index');
    db.prepare('INSERT OR IGNORE INTO live_annotations(review,id,version,data,imported,preview_error) VALUES(?,?,?,?,?,?)').run(snapshot.id,op.annotation!.id,version,JSON.stringify(op.annotation),op.imported?1:0,Array.isArray(op.annotation!.strokes)&&!op.imported?'pending':null);
   } else if (op.type==='delete') {
    if (typeof op.id!=='string'||!op.id) throw error(400,'Invalid annotation id');
    // Tombstones prevent a stale phone from importing a deleted annotation again.
    db.prepare('INSERT INTO live_annotations(review,id,version,data,deleted) VALUES(?,?,?,?,1) ON CONFLICT(review,id) DO UPDATE SET deleted=1').run(snapshot.id,op.id,version,'{}');
   } else if (op.type==='preview') {
    let bytes: Buffer | null=null;
    if (op.preview) {
     if (!/^data:image\/png;base64,/.test(op.preview)) throw error(400,'Preview must be PNG');
     bytes=Buffer.from(op.preview.split(',')[1],'base64');
     if (bytes.length>MAX_PREVIEW_BYTES||bytes.length<24||bytes.subarray(0,8).toString('hex')!=='89504e470d0a1a0a'||bytes.toString('ascii',12,16)!=='IHDR'||bytes.readUInt32BE(16)<1||bytes.readUInt32BE(20)<1||bytes.readUInt32BE(16)>4096||bytes.readUInt32BE(20)>4096) throw error(400,'Invalid PNG preview');
    }
    db.prepare('UPDATE live_annotations SET preview=?,preview_error=? WHERE review=? AND id=? AND deleted=0 AND submitted IS NULL').run(bytes, String(op.previewError||'').slice(0,300),snapshot.id,String(op.id));
   } else throw error(400,'Invalid operation type');
   db.prepare('INSERT INTO live_operations(review,id) VALUES(?,?)').run(snapshot.id,op.operationId);
  }
  db.exec('COMMIT');
 } catch(e) {db.exec('ROLLBACK');throw e;}
 return feedbackState(db,snapshot);
}
function validateVideoAnnotation(a: Annotation, snapshot: Snapshot) {
 const index = readVideoIndex(snapshot);
 if (!index) throw error(409, '视频帧索引尚未完成');
 if (a.type !== 'video' || !a.body.trim() || !Array.isArray(a.locations) || !a.locations.length || a.locations.length > 200) throw error(400, 'Invalid video annotation');
 const validFrame = (value: unknown) => Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) < index.timestamps.length;
 for (const item of a.locations) {
  if (!item || typeof item !== 'object') throw error(400, 'Invalid video location');
  if (item.type === 'point') { if (!validFrame(item.frameIndex)) throw error(400, 'Invalid video frame'); }
  else if (item.type === 'range') { if (!validFrame(item.startFrameIndex) || !validFrame(item.endFrameIndex) || item.startFrameIndex >= item.endFrameIndex) throw error(400, 'Invalid video range'); }
  else throw error(400, 'Invalid video location');
 }
}
export function annotationAnchor(a: Annotation,snapshot: Snapshot) {
 const fileIndex=snapshot.kind==='image'?Number(a.imageIndex):0;
 const base={filename:snapshot.files[fileIndex]?.filename,version:snapshot.version,fileIndex};
 if(snapshot.kind==='video') {
  const index = readVideoIndex(snapshot);
  if (!index) throw error(409, '视频帧索引不可用');
  return {...base, type:'video', frameIndexBase:0, timeUnit:'seconds', sourceStartTime:index.sourceStartTime,
   locations:(a.locations as VideoLocation[]).map(p=>p.type==='point'
    ? {type:'point',frameIndex:p.frameIndex,time:index.timestamps[p.frameIndex]}
    : {type:'range',startFrameIndex:p.startFrameIndex,endFrameIndex:p.endFrameIndex,startTime:index.timestamps[p.startFrameIndex],endTimeExclusive:frameEnd(index,p.endFrameIndex),frameEndpoints:'inclusive'})};
 }
 if(snapshot.kind==='markdown') return {...base,type:'document-text',blockId:a.blockId,startOffset:a.startOffset,endOffset:a.endOffset,selectedText:a.selectedText,prefix:a.prefix,suffix:a.suffix};
 if(a.type==='cell') return {...base,type:'sheet-range',sheet:a.sheetName,range:a.cellRef,value:a.cellValue,formula:a.formula};
 if(a.type==='text') return {...base,type:'document-text',selectedText:a.selectedText,prefix:a.prefix,suffix:a.suffix};
 return {...base,type:'drawing',page:snapshot.kind==='pdf'?Number(a.pageIndex)+1:snapshot.kind==='ppt'?Number(a.slideIndex)+1:undefined,sheet:a.sheetName,coordinateSpace:snapshot.kind==='excel'?'sheet-pixels':'normalized',strokes:a.strokes,badgePosition:a.badgePosition};
}
export function submitFeedback(db: DatabaseSync,snapshot: Snapshot,requestId: string) {
 if (typeof requestId!=='string'||!requestId||requestId.length>200) throw error(400,'Invalid submission id');
 db.exec('BEGIN IMMEDIATE');
 try {
  const existing=db.prepare('SELECT submission FROM live_submit_requests WHERE review=? AND request=?').get(snapshot.id,requestId);
  if (existing) {db.exec('COMMIT');return existing;}
  const rows=db.prepare('SELECT * FROM live_annotations WHERE review=? AND deleted=0 AND submitted IS NULL ORDER BY rowid').all(snapshot.id) as unknown as Row[];
  if(rows.some(r=>r.preview_error==='pending'))throw error(409,'截图仍在生成，请稍后重试提交');
  const id=rows.length?randomUUID():null;
  if (id) {
   const comments=rows.map(r=>{const a=JSON.parse(r.data) as Annotation;return {id:a.id,body:a.body,createdAt:a.createdAt,anchor:annotationAnchor(a,snapshot),preview:!!r.preview,previewError:r.preview_error||(!r.preview && snapshot.kind!=='video'?'No preview available; inspect the original snapshot and anchor.':null),importedFromLocal:!!r.imported,versionVerified:!r.imported};});
   db.prepare('INSERT INTO live_submissions(id,review,version,created_at,comments) VALUES(?,?,?,?,?)').run(id,snapshot.id,snapshot.version,new Date().toISOString(),JSON.stringify(comments));
   for (const r of rows) db.prepare('UPDATE live_annotations SET submitted=? WHERE review=? AND id=?').run(id,snapshot.id,r.id);
  }
  db.prepare('INSERT INTO live_submit_requests(review,request,submission) VALUES(?,?,?)').run(snapshot.id,requestId,id);
  db.exec('COMMIT');return {submission:id};
 } catch(e) {db.exec('ROLLBACK');throw e;}
}
export function agentFeedback(db: DatabaseSync,snapshot: Snapshot,base: string,after=0) {
 const rows=db.prepare('SELECT * FROM live_submissions WHERE review=? AND sequence>? ORDER BY sequence').all(snapshot.id,after) as unknown as {sequence:number;id:string;created_at:string;comments:string}[];
 return {schemaVersion:1,contentIsUntrusted:true,review:feedbackState(db,snapshot).review,cursor:rows.at(-1)?.sequence??after,files:snapshot.files.map((f,i)=>({filename:f.filename,sha256:f.hash,url:`${base}?file=${i}`})),batches:rows.map(r=>({id:r.id,cursor:r.sequence,submittedAt:r.created_at,status:'submitted',comments:JSON.parse(r.comments).map((c:{id:string;preview:boolean})=>({...c,previewUrl:c.preview?`${base}?preview=${encodeURIComponent(c.id)}`:null}))}))};
}
