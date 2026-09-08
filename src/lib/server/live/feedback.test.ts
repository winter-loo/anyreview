import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { openFeedbackDb,applyOperations,submitFeedback,agentFeedback,feedbackState } from './feedback';
import type { Snapshot } from './snapshots';
const dirs:string[]=[];
afterEach(()=>{for(const dir of dirs.splice(0))rmSync(dir,{recursive:true,force:true});});
const snapshot:Snapshot={id:'review-one',version:'v1',kind:'pdf',files:[{filename:'document.pdf',hash:'abc',size:1,snapshotPath:'/unused'}]};
const annotation={id:'a',body:'Change this',createdAt:new Date().toISOString(),pageIndex:0,badgePosition:{x:.2,y:.3},strokes:[{color:'#ff0000',size:3,points:[{x:.2,y:.3},{x:.4,y:.5}]}]};
function database(){const dir=mkdtempSync(path.join(tmpdir(),'feedback-test-'));dirs.push(dir);return openFeedbackDb(path.join(dir,'test.db'));}
describe('durable live feedback',()=>{
 it('waits for a preview and freezes it once submitted',()=>{
  const db=database();try{
   applyOperations(db,snapshot,'v1',[{operationId:'add',type:'add',annotation}]);
   expect(()=>submitFeedback(db,snapshot,'submit')).toThrow();
   const preview='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
   applyOperations(db,snapshot,'v1',[{operationId:'png',type:'preview',id:'a',preview}]);submitFeedback(db,snapshot,'submit');
   applyOperations(db,snapshot,'v1',[{operationId:'late',type:'preview',id:'a',previewError:'late error'}]);
   const feedback=agentFeedback(db,snapshot,'/feedback');expect(feedback.batches[0].comments[0].previewUrl).toBe('/feedback?preview=a');
   expect(db.prepare('SELECT preview FROM live_annotations WHERE id=?').get('a')?.preview).toBeTruthy();
  }finally{db.close();}
 });
 it('merges separate phones and retries without duplicate comments; exposes only submitted batches',()=>{
  const db=database();try{
   const op={operationId:'one',type:'add' as const,annotation,imported:true};
   applyOperations(db,snapshot,'v1',[op,op]);
   applyOperations(db,snapshot,'v1',[{...op,operationId:'two',annotation:{...annotation,id:'b'}}]);
   expect(feedbackState(db,snapshot).annotations).toHaveLength(2);
   expect(agentFeedback(db,snapshot,'https://test/live/token/feedback').batches).toHaveLength(0);
   const submitted=submitFeedback(db,snapshot,'submit-one');
   expect(submitFeedback(db,snapshot,'submit-one')).toEqual(submitted);
   const feedback=agentFeedback(db,snapshot,'https://test/live/token/feedback');
   expect(feedback.batches).toHaveLength(1);expect(feedback.batches[0].comments).toHaveLength(2);
   expect(feedback.batches[0].comments[0].anchor.page).toBe(1);
   expect(agentFeedback(db,snapshot,'https://test/live/token/feedback',feedback.cursor).batches).toHaveLength(0);
   expect(feedbackState(db,snapshot).pendingCount).toBe(0);
  }finally{db.close();}
 });
 it('keeps deletion tombstones and immutable submitted feedback',()=>{
  const db=database();try{
   applyOperations(db,snapshot,'v1',[{operationId:'add',type:'add',annotation,imported:true}]);submitFeedback(db,snapshot,'s');
   applyOperations(db,snapshot,'v1',[{operationId:'delete',type:'delete',id:'a'},{operationId:'legacy-import',type:'add',annotation,imported:true}]);
   expect(feedbackState(db,snapshot).annotations).toHaveLength(0);
   expect(agentFeedback(db,snapshot,'/feedback').batches[0].comments[0].body).toBe('Change this');
   expect(feedbackState(db,{...snapshot,id:'other'}).annotations).toHaveLength(0);
  }finally{db.close();}
 });
 it('rejects wrong versions and rolls back a malformed operation batch',()=>{
  const db=database();try{
   expect(()=>applyOperations(db,snapshot,'old',[{operationId:'one',type:'add',annotation}])).toThrow();
   expect(()=>applyOperations(db,snapshot,'v1',[{operationId:'one',type:'add',annotation},{operationId:'bad',type:'add',annotation:{...annotation,id:'bad',pageIndex:-1}}])).toThrow();
   expect(feedbackState(db,snapshot).annotations).toHaveLength(0);
  }finally{db.close();}
 });
});

it('returns submitted Markdown quotes and offsets to the agent',()=>{
 const db=database();
 const md={...snapshot,kind:'markdown',files:[{...snapshot.files[0],filename:'paste.md'}]};
 const note={id:'text',body:'Please clarify',createdAt:new Date().toISOString(),blockId:'block-1',startOffset:2,endOffset:7,selectedText:'hello',prefix:'A ',suffix:' world'};
 try {
  expect(()=>applyOperations(db,md,'v1',[{operationId:'invalid',type:'add',annotation:{...note,endOffset:1}}])).toThrow();
  applyOperations(db,md,'v1',[{operationId:'add',type:'add',annotation:note}]);
  expect(agentFeedback(db,md,'/feedback').batches).toHaveLength(0);
  submitFeedback(db,md,'submit');
  expect(agentFeedback(db,md,'/feedback').batches[0].comments[0].anchor).toMatchObject({type:'document-text',filename:'paste.md',blockId:'block-1',selectedText:'hello',startOffset:2,endOffset:7});
 } finally {db.close();}
});
