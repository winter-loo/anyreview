import unittest,sys,json,subprocess,re,copy,math
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]));import pipeline as p
class MigrationTests(unittest.TestCase):
 def setUp(self):self.project,self.scenes,self.assets=p.load()
 def test_v10_render_contract(self):
  doc,srt,timing,_=p.compile_film(self.project,self.scenes,self.assets)
  self.assertEqual(srt,(p.ROOT/'tests/fixtures/v10.srt').read_text())
  old=(p.ROOT/'tests/fixtures/v10.html.source').read_text()
  # Remove only executable script content and normalize local vendoring of the same GSAP version.
  clean=lambda s:re.sub(r'<script(?:\s[^>]*)?>.*?</script>','',s,flags=re.S)
  # Normalize numeric serialization, not DOM structure, media, copy or styling.
  numeric=lambda s:re.sub(r'(data-(?:start|duration|track-index)="?)([\d.]+)',lambda m:m[1]+str(round(float(m[2]),6)),s)
  self.assertEqual(numeric(clean(doc)),numeric(clean(old)))
  import tempfile
  with tempfile.NamedTemporaryFile(suffix='.source',mode='w') as f:
   f.write(doc);f.flush()
   capture=lambda path:json.loads(subprocess.check_output(['node',str(p.ROOT/'tools/capture-timeline.mjs'),str(path)]))
   a=capture(p.ROOT/'tests/fixtures/v10.html.source');b=capture(f.name)
  self.assertEqual(len(a),len(b))
  for old,new in zip(a,b):
   self.assertEqual(old['op'],new['op']);self.assertEqual(old['target'],new['target']);self.assertEqual(old['props'],new['props']);self.assertAlmostEqual(old['at'],new['at'],places=5)
  self.assertEqual(timing['duration'],93.904)
 def test_duplicate_clip_rejected(self):
  self.scenes[0]['clips'].append(copy.deepcopy(self.scenes[0]['clips'][0]))
  with self.assertRaisesRegex(ValueError,'Duplicate clip'):p.validate(self.project,self.scenes,self.assets)
 def test_timing_overrun_rejected(self):
  self.scenes[-1]['clips'][0]['duration']=100
  with self.assertRaisesRegex(ValueError,'bounds'):p.validate(self.project,self.scenes,self.assets)
 def test_unknown_asset_rejected(self):
  self.scenes[0]['clips'][0]['asset']='missing'
  with self.assertRaisesRegex(ValueError,'Unknown clip asset'):p.validate(self.project,self.scenes,self.assets)
 def test_asset_replacement_requires_manifest_update(self):
  next(iter(self.assets.values()))['sha256']='invalid'
  with self.assertRaisesRegex(ValueError,'Changed asset'):p.validate(self.project,self.scenes,self.assets)
 def test_render_signature_tracks_fps_and_asset_bytes(self):
  signature=p.render_signature(self.project,self.assets)
  self.project['fps']=60
  self.assertNotEqual(signature,p.render_signature(self.project,self.assets))
  self.project['fps']=30
  next(iter(self.assets.values()))['sha256']='changed'
  self.assertNotEqual(signature,p.render_signature(self.project,self.assets))
 def test_captions_follow_scene_order(self):
  self.scenes[0]['duration']+=1
  _,_,t,_=p.compile_film(self.project,self.scenes,self.assets)
  self.assertAlmostEqual(t['scene_starts'][1],10.916)
  self.assertAlmostEqual(t['captions'][3]['start'],11.266)
if __name__=='__main__':unittest.main()
