"""Config-driven film build, validation, preview, render and delivery. Python stdlib only."""
from pathlib import Path
import argparse,hashlib,html,json,math,os,re,shlex,subprocess
ROOT=Path(__file__).resolve().parent
CONFIG_PATH=None

def read(path):return json.loads(path.read_text())
def digest(path):
 h=hashlib.sha256()
 with path.open('rb') as f:
  for block in iter(lambda:f.read(1024*1024),b''):h.update(block)
 return h.hexdigest()
def number(n):return f'{n:.6f}'
def stamp(t):
 ms=round(t*1000);return f'{ms//3600000:02}:{ms//60000%60:02}:{ms//1000%60:02},{ms%1000:03}'
def get_config_path():
 global CONFIG_PATH
 return CONFIG_PATH or (ROOT/'config/project.json')
def load(config=None):
 p_path=(ROOT/config).resolve() if config else get_config_path()
 p=read(p_path)
 return p,read(ROOT/p['scenes']),read(ROOT/p['assets'])
def validate(p,scenes,assets):
 if p['schema_version']!=1:raise ValueError('Unsupported project schema')
 for key in ['width','height','fps']:
  if not isinstance(p[key],int) or p[key]<=0:raise ValueError(f'Invalid {key}')
 duration=sum(s['duration'] for s in scenes);ids=set();orders=set();scene_ids=set();start=0;captions=[]
 for key,a in assets.items():
  path=(ROOT/a['path']).resolve()
  if not path.is_relative_to(ROOT):raise ValueError(f'Asset outside project: {key}')
  if not path.is_file():raise ValueError(f'Missing asset: {key}')
  if digest(path)!=a['sha256']:raise ValueError(f'Changed asset: {key}; update its manifest hash deliberately')
 for scene in scenes:
  if scene['id'] in scene_ids:raise ValueError('Duplicate scene id')
  scene_ids.add(scene['id'])
  if not math.isfinite(scene['duration']) or scene['duration']<=0:raise ValueError('Invalid scene duration')
  if not 0<=scene['poster_offset']<scene['duration']:raise ValueError('Invalid storyboard offset')
  for c in scene['clips']:
   if c['id'] in ids:raise ValueError('Duplicate clip id: '+c['id'])
   ids.add(c['id']);end=start+c['offset']+c['duration']
   if not all(math.isfinite(c[k]) for k in ['offset','duration']) or c['offset']<0 or c['duration']<=0 or end>duration+0.00001:raise ValueError('Invalid clip bounds: '+c['id'])
   if 'asset' in c and c['asset'] not in assets:raise ValueError('Unknown clip asset: '+c['id'])
   if 'text' in c:captions.append((start+c['offset'],end,c['id']))
  for m in scene['motion']:
   if m['order'] in orders:raise ValueError('Duplicate motion order')
   orders.add(m['order'])
   if m['op'] not in ['to','set'] or not isinstance(m['target'],str):raise ValueError('Invalid motion')
   if m['offset']<0 or start+m['offset']+m['props'].get('duration',0)>duration+0.00001:raise ValueError('Motion outside film')
  start+=scene['duration']
 for a,b in zip(sorted(captions),sorted(captions)[1:]):
  if a[1]>b[0]+0.00001:raise ValueError('Overlapping captions: '+a[2]+', '+b[2])
 return duration

def compile_film(p,scenes,assets):
 duration=validate(p,scenes,assets);values={'width':str(p['width']),'height':str(p['height']),'duration':number(duration)};motion=[];caps=[];start=0;starts=[];rows=[]
 for key,a in assets.items():values['asset:'+key]=html.escape(a['path'],quote=True)
 for s in scenes:
  starts.append(round(start,6));rows.append(f"## {s['title']} · {start:.3f}–{start+s['duration']:.3f}s\n")
  for c in s['clips']:
   at=round(start+c['offset'],6);base='clip:'+c['id']+':'
   values.update({base+'start':number(at),base+'duration':number(c['duration']),base+'track':str(c['track'])})
   if 'asset' in c:values[base+'src']=values['asset:'+c['asset']]
   if 'text' in c:
    values[base+'text']=html.escape(c['text']);caps.append({'start':at,'end':round(at+c['duration'],6),'text':c['text']});rows.append(c['text']+'\n')
  for m in s['motion']:motion.append({**m,'at':round(start+m['offset'],6)})
  start+=s['duration']
 motion.sort(key=lambda m:m['order']);commands=['const tl=gsap.timeline({paused:true});']
 for m in motion:commands.append('tl.'+m['op']+'('+json.dumps(m['target'])+','+json.dumps(m['props'],ensure_ascii=False)+','+number(m['at'])+');')
 commands.append('window.__timelines=window.__timelines||{};window.__timelines.main=tl;');values['timeline']='\n'.join(commands)
 template_path=ROOT/p['template']
 template=template_path.read_text()
 def include(m):
  path=(template_path.parent/m[1]).resolve()
  if not path.is_relative_to(template_path.parent.resolve()):
   raise ValueError('Template include outside templates: '+m[1])
  return path.read_text()
 template=re.sub(r'\{\{include:([^{}]+)\}\}',include,template)
 template=re.sub(r'<!--.*?-->', '', template, flags=re.S)
 template=re.sub(r'/\*.*?\*/', '', template, flags=re.S)
 template=re.sub(r'\n[ \t]*', '', template).strip()
 template=re.sub(r'(<style>)(.*?)(</style>)',
  lambda m:m[1]+re.sub(r'\s*([{}])\s*', r'\1', m[2]).replace(';}', '}')+m[3], template, flags=re.S)
 def token(m):
  if m[1] not in values:raise ValueError('Unknown template token: '+m[1])
  return values[m[1]]
 doc=re.sub(r'\{\{([^{}]+)\}\}',token,template)
 for s in scenes:
  for c in s['clips']:
   if f'id="{c["id"]}"' not in doc:raise ValueError('Clip has no template element: '+c['id'])
 caps.sort(key=lambda c:c['start']);srt='\n\n'.join(f'{i+1}\n{stamp(c["start"])} --> {stamp(c["end"])}\n{c["text"]}' for i,c in enumerate(caps))+'\n'
 timing={'duration':round(duration,6),'scene_starts':starts,'scene_durations':[s['duration'] for s in scenes],'captions':caps}
 return doc,srt,timing,'# 当前分镜与旁白（从配置生成）\n\n'+'\n'.join(rows)

def build():
 p,scenes,assets=load();doc,srt,timing,board=compile_film(p,scenes,assets)
 for path,data in [('index.html',doc),('captions.srt',srt),('timing.json',json.dumps(timing,ensure_ascii=False,indent=2)+'\n'),('SCENES.md',board)]: (ROOT/path).write_text(data)
 inventory=['# 当前渲染素材清单（从 '+p['assets']+' 生成）\n','| ID | 文件 | 类型 / 来源 | 大小 | SHA-256 |','|---|---|---|---:|---|']
 for key,a in assets.items():inventory.append(f"| {key} | [{a['path']}]({a['path']}) | {a['kind']} / {a['origin']} | {a['bytes']} | `{a['sha256']}` |")
 (ROOT/'ASSETS.md').write_text('\n'.join(inventory)+'\n')
 watch='<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'+html.escape(p['name'])+' 当前构建</title><style>body{background:#111320;color:#eee;font:17px system-ui;max-width:1100px;margin:30px auto;padding:20px}video{width:100%}a{color:#b6acf5}</style><h1>'+html.escape(p['name'])+' 当前构建</h1><video controls playsinline src="renders/'+html.escape(p['output_name'])+'.mp4"></video><p>'+str(round(timing['duration'],1))+' 秒 · 当前配置生成</p><a href="captions.srt">字幕</a> · <a href="renders/storyboard/index.html">当前分镜</a></html>'
 (ROOT/'watch.html').write_text(watch)
 print(f"Built {len(scenes)} scenes, {len(assets)} assets, {timing['duration']} seconds")
 return p

def hf(p,*args,capture=False):
 command=shlex.split(os.environ['HYPERFRAMES_BIN']) if os.environ.get('HYPERFRAMES_BIN') else ['pnpm','dlx','hyperframes@'+p['hyperframes_version']]
 return subprocess.run([*command,*args],cwd=ROOT,check=True,text=True,capture_output=capture)
def ff(*args,capture=False):return subprocess.run(['ffmpeg',*map(str,args)],cwd=ROOT,check=True,text=True,capture_output=capture)
def check(p):
 result=hf(p,'check','--json',capture=True);(ROOT/'renders').mkdir(exist_ok=True);(ROOT/'renders/check.json').write_text(result.stdout)
 report=json.loads(result.stdout)
 if not report['ok']:raise ValueError('HyperFrames check failed')
 print('HyperFrames check passed; report: renders/check.json')
def storyboard(p,final):
 sb_dir = 'storyboard' if p['output_name'] == 'ReviewLoop' else f"storyboard-{p['output_name']}"
 out=ROOT/'renders'/sb_dir;out.mkdir(exist_ok=True);cards=[];start=0
 for i,scene in enumerate(load()[1]):
  at=start+scene['poster_offset'];name=f'{i+1:02}-{scene["id"]}.png'
  ff('-y','-v','error','-ss',at,'-i',final,'-frames:v','1',out/name)
  narration=''.join(c['text'] for c in scene['clips'] if 'text' in c)
  cards.append(f'<section><h2>{i+1}. {html.escape(scene["title"])} · {start:.3f}–{start+scene["duration"]:.3f}s</h2><img src="{name}"><p>{html.escape(narration)}</p></section>')
  start+=scene['duration']
 (out/'index.html').write_text('<!doctype html><meta charset="utf-8"><title>'+html.escape(p['name'])+' 当前分镜</title><style>body{background:#111320;color:#eee;font:18px/1.6 system-ui;max-width:1100px;margin:auto;padding:24px}img{width:100%}section{margin-bottom:40px;break-after:page}@media print{body{background:white;color:black}}</style><h1>'+html.escape(p['name'])+' · 从当前成片生成的分镜</h1>'+''.join(cards))

def render_signature(p,assets):
 return hashlib.sha256(json.dumps({'fps':p['fps'],'hyperframes_version':p['hyperframes_version'],'asset_hashes':{k:a['sha256'] for k,a in assets.items()}},sort_keys=True).encode()).hexdigest()

def finish(p):
 out=ROOT/'renders';src=out/(p['output_name']+'-render.mp4');final=out/(p['output_name']+'.mp4')
 if not src.is_file():raise ValueError('Render first')
 receipt_name = 'render-receipt.json' if p['output_name'] == 'ReviewLoop' else f"{p['output_name']}-receipt.json"
 receipt=read(out/receipt_name)
 current,_,_,_=compile_film(*load())
 if receipt['composition_sha256']!=hashlib.sha256(current.encode()).hexdigest() or receipt['render_sha256']!=digest(src) or receipt['render_signature']!=render_signature(p,load()[2]):raise ValueError('Render is stale; run render again before finish')
 loud=p['loudness'];base=f"loudnorm=I={loud['integrated']}:TP={loud['true_peak']}:LRA={loud['range']}"
 result=ff('-hide_banner','-i',src,'-vn','-af',base+':print_format=json','-f','null','-',capture=True)
 m=json.JSONDecoder().raw_decode(result.stderr[result.stderr.rindex('{'):])[0]
 loud_name = 'loudness.json' if p['output_name'] == 'ReviewLoop' else f"loudness-{p['output_name']}.json"
 (out/loud_name).write_text(json.dumps(m,indent=2))
 flt=base+f":measured_I={m['input_i']}:measured_TP={m['input_tp']}:measured_LRA={m['input_lra']}:measured_thresh={m['input_thresh']}:offset={m['target_offset']}:linear=true"
 ff('-y','-v','error','-i',src,'-map','0:v','-map','0:a','-c:v','copy','-af',flt,'-c:a','aac','-b:a','192k','-ar','48000','-movflags','+faststart',final)
 ff('-v','error','-i',final,'-f','null','-')
 proof_prefix = 'proof' if p['output_name'] == 'ReviewLoop' else f"proof-{p['output_name']}"
 for t in p['proof_times']:ff('-y','-v','error','-ss',t,'-i',final,'-frames:v','1',out/f'{proof_prefix}-{t:.3f}.png')
 srt_name = 'captions.srt' if p['output_name'] == 'ReviewLoop' else f"{p['output_name']}.srt"
 (out/srt_name).write_bytes((ROOT/'captions.srt').read_bytes());storyboard(p,final);print('Verified delivery:',final)

def main():
 global CONFIG_PATH
 parser=argparse.ArgumentParser(description=__doc__)
 parser.add_argument('command',nargs='?',default='build',choices=['build','validate','check','preview','render','finish','release'])
 parser.add_argument('--config',default=None,help='Project config path relative to root')
 args=parser.parse_args()
 if args.config:
  CONFIG_PATH=(ROOT/args.config).resolve()
 if args.command=='validate':p,s,a=load();validate(p,s,a);print('Config and asset hashes valid');return
 if args.command=='finish':finish(load()[0]);return
 p=build()
 if args.command in ['check','render','release']:check(p)
 if args.command=='preview':hf(p,'preview','--background')
 if args.command in ['render','release']:
  out=ROOT/'renders';out.mkdir(exist_ok=True);src=out/(p['output_name']+'-render.mp4')
  composition_hash=digest(ROOT/'index.html');signature=render_signature(p,load()[2])
  hf(p,'render','--quality','high','--fps',str(p['fps']),'--output',str(src))
  receipt_name = 'render-receipt.json' if p['output_name'] == 'ReviewLoop' else f"{p['output_name']}-receipt.json"
  (out/receipt_name).write_text(json.dumps({'composition_sha256':composition_hash,'render_sha256':digest(src),'render_signature':signature,'hyperframes_version':p['hyperframes_version']},indent=2))
 if args.command=='release':finish(p)

if __name__=='__main__':main()
