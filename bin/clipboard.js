import { execFileSync } from 'node:child_process';

const MAX_BYTES = 5 * 1024 * 1024;

/** @param {{platform?:string,env?:NodeJS.ProcessEnv,run?:typeof execFileSync}} options */
export function readClipboard({platform=process.platform,env=process.env,run=execFileSync}={}) {
 /** @type {[string,string[]][]} */
 let commands=[];
 if(platform==='darwin') commands=[['pbpaste',[]]];
 else if(platform==='win32'||env.WSL_DISTRO_NAME||env.WSL_INTEROP) commands=[['powershell.exe',['-NoProfile','-NonInteractive','-Command','[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false); $text = Get-Clipboard -Raw; if ($null -ne $text) { [Console]::Write($text) }']]];
 else if(platform==='linux') {
  if(env.WAYLAND_DISPLAY)commands.push(['wl-paste',['--no-newline','--type','text']]);
  if(env.DISPLAY)commands.push(['xclip',['-selection','clipboard','-out']],['xsel',['--clipboard','--output']]);
  if(env.TMUX)commands.push(['tmux',['save-buffer','-']]);
 }
 if(!commands.length)throw new Error('Cannot read clipboard: no supported desktop clipboard connection or tmux buffer. On Linux, DISPLAY or WAYLAND_DISPLAY must point to your desktop session. You can also use review paste in a terminal shell.');
 for(const [command,args] of commands){
  let bytes;
  try{bytes=run(command,args,{env,timeout:5000,maxBuffer:MAX_BYTES,stdio:['ignore','pipe','pipe']});}
  catch(cause){
   if(/** @type {NodeJS.ErrnoException} */(cause).code==='ENOBUFS')throw new Error('Clipboard text exceeds 5 MiB.');
   continue;
  }
  if(Buffer.byteLength(bytes)>MAX_BYTES)throw new Error('Clipboard text exceeds 5 MiB.');
  let text;
  try{text=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes);}
  catch{throw new Error('Clipboard must contain UTF-8 text.');}
  if(!text.trim())throw new Error('Clipboard has no text. Run /copy first.');
  if(text.includes('\0'))throw new Error('Clipboard must contain plain text or Markdown.');
  return text;
 }
 throw new Error('Cannot read clipboard. Check the desktop session and its clipboard reader: pbpaste (macOS), PowerShell (Windows/WSL), wl-paste (Wayland), or xclip/xsel (X11).');
}
