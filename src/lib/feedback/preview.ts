import type { Annotation } from './types';
import html2canvas from 'html2canvas';

/** Capture the document region, not the browser chrome or the open composer. */
export async function capturePreview(kind:string,annotation:Annotation):Promise<string> {
 const selector:Record<string,string>={pdf:'.pdf-canvas',image:'.image-wrapper img',ppt:'.slide-viewport-wrapper',word:'.docx-render-container',excel:'.sheet-content-wrapper'};
 const element = kind === 'html' ? document.querySelector<HTMLIFrameElement>('.docx-render-container iframe')?.contentDocument?.documentElement : document.querySelector(selector[kind]) as HTMLElement|null;
 if(!element) throw new Error('文档尚未加载，无法生成截图');
 const rect=element.getBoundingClientRect();
 const strokes=annotation.strokes as {color:string;size:number;points:{x:number;y:number}[]}[]|undefined;
 const width=element.offsetWidth,height=element.offsetHeight;
 if(!width||!height)throw new Error('文档尺寸不可用');
 const normalized=kind!=='excel';
 const points=strokes?.flatMap(s=>s.points.map(p=>({x:p.x*(normalized?width:1),y:p.y*(normalized?height:1)})))||[];
 let left=0,top=0,right=Math.min(width,1000),bottom=Math.min(height,700);
 if(points.length){left=Math.max(0,Math.min(...points.map(p=>p.x))-80);top=Math.max(0,Math.min(...points.map(p=>p.y))-80);right=Math.min(width,Math.max(...points.map(p=>p.x))+80);bottom=Math.min(height,Math.max(...points.map(p=>p.y))+80);}
 const cropW=Math.max(1,right-left),cropH=Math.max(1,bottom-top),scale=Math.min(2,1400/Math.max(cropW,cropH));
 let canvas:HTMLCanvasElement;
 if(element instanceof HTMLCanvasElement || element instanceof HTMLImageElement){
  canvas=document.createElement('canvas');canvas.width=Math.ceil(cropW*scale);canvas.height=Math.ceil(cropH*scale);
  const ctx=canvas.getContext('2d')!;ctx.fillStyle='white';ctx.fillRect(0,0,canvas.width,canvas.height);
  const actualW=element instanceof HTMLImageElement?element.naturalWidth:element.width, actualH=element instanceof HTMLImageElement?element.naturalHeight:element.height;
  ctx.drawImage(element,left/width*actualW,top/height*actualH,cropW/width*actualW,cropH/height*actualH,0,0,canvas.width,canvas.height);
 } else {
  const rendered=await html2canvas(element,{logging:false,backgroundColor:'#ffffff',scale,x:left,y:top,width:cropW,height:cropH,useCORS:true,
   onclone: doc => {
    const clone=kind === 'html' ? doc.documentElement : doc.querySelector(selector[kind]) as HTMLElement|null;
    if(!clone)return;
    clone.style.width=`${width}px`;
    for(let parent:HTMLElement|null=clone;parent;parent=parent.parentElement){parent.style.zoom='1';parent.style.transform='none';parent.style.overflow='visible';parent.scrollTop=0;parent.scrollLeft=0;}
   },
   ignoreElements:el=>el.matches('.drawing-canvas,.word-drawing-canvas,.drawing-canvas-layer,.annotations-svg,.word-annotations-svg,.saved-svg-layer,.saved-annotations,dialog,.review-tools,.review-comments')});
  canvas=rendered;
 }
 const ctx=canvas.getContext('2d')!;ctx.setTransform(1,0,0,1,0,0);ctx.scale(canvas.width/cropW,canvas.height/cropH);ctx.translate(-left,-top);
 for(const stroke of strokes||[]){ctx.strokeStyle=stroke.color;ctx.lineWidth=stroke.size;ctx.lineCap='round';ctx.lineJoin='round';ctx.beginPath();stroke.points.forEach((p,i)=>{const x=p.x*(normalized?width:1),y=p.y*(normalized?height:1);if(i===0)ctx.moveTo(x,y);else ctx.lineTo(x,y);});ctx.stroke();}
 return canvas.toDataURL('image/png');
}
