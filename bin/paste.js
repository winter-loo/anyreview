import { createInterface } from 'node:readline';

export const MAX_PASTE_BYTES = 5 * 1024 * 1024;

/** @param {Buffer} bytes */
function validate(bytes) {
 let text;
 try { text = new TextDecoder('utf-8', {fatal:true,ignoreBOM:true}).decode(bytes); }
 catch { throw new Error('Paste must contain UTF-8 text.'); }
 if (!text.trim()) throw new Error('No text received. Run review paste in a terminal, paste your text, then finish with Enter and Ctrl+D.');
 if (text.includes('\0')) throw new Error('Paste must contain plain text or Markdown, not binary data.');
 return text;
}

/** Read pasted text from a terminal or piped stdin. Never evaluate the content.
 * @param {NodeJS.ReadStream} input
 * @param {NodeJS.WriteStream} output
 */
export async function readPaste(input = process.stdin, output = process.stderr) {
 if (!input.isTTY) {
  /** @type {Buffer[]} */
  const chunks = []; let size = 0;
  for await (const chunk of input) {
   const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
   size += bytes.length;
   if (size > MAX_PASTE_BYTES) throw new Error('Pasted text exceeds 5 MiB.');
   chunks.push(bytes);
  }
  return validate(Buffer.concat(chunks));
 }
 output.write('粘贴文本后按 Enter，再按 Ctrl+D 发布；Ctrl+C 取消。\n');
 return /** @type {Promise<string>} */ (new Promise((resolve,reject)=>{
  // readline uses raw terminal input, avoiding canonical-mode truncation of long pasted lines.
  const reader = createInterface({input,output,terminal:true,historySize:0});
  /** @type {Buffer[]} */
  const chunks = []; let size = 0; let failed = false;
  const fail = (/** @type {unknown} */ error) => { failed=true; reader.close(); input.pause(); reject(error); };
  reader.on('line',line=>{
   const bytes=Buffer.from(line+'\n');size+=bytes.length;
   if(size>MAX_PASTE_BYTES) { fail(new Error('Pasted text exceeds 5 MiB.')); return; }
   chunks.push(bytes);
  });
  reader.on('SIGINT',()=>fail(new Error('Paste cancelled. Nothing was published.')));
  reader.on('error',fail);
  reader.on('close',()=>{
   input.pause();
   if(failed)return;
   try { resolve(validate(Buffer.concat(chunks))); } catch(error){reject(error);}
  });
 }));
}
