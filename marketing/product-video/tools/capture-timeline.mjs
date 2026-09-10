// Test/import helper: execute only the local, trusted composition script in a bounded VM.
import fs from 'node:fs';import vm from 'node:vm';
const html=fs.readFileSync(process.argv[2],'utf8');
const nodes=[...html.matchAll(/id="(prompt-char-\d+)"/g)].map(m=>({id:m[1]}));
const commands=[];const timeline={};
for(const op of ['set','to'])timeline[op]=(target,props,at)=>{commands.push({op,target:typeof target==='string'?target:'#'+target.id,props,at});return timeline};
const sandbox={gsap:{timeline:()=>timeline},document:{querySelectorAll:selector=>{if(selector!=='.prompt-char')throw Error(selector);return nodes}},window:{}};
for(const m of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g))if(m[1].trim())vm.runInNewContext(m[1],sandbox,{timeout:1000});
console.log(JSON.stringify(commands));
