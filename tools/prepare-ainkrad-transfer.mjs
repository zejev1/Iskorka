import { readFileSync, writeFileSync, mkdirSync, existsSync, copyFileSync } from 'node:fs';
import { resolve, dirname, relative, isAbsolute } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { deserialize } from 'node:v8';

// Offline preparation only. No network, target writes, resident editing or import.
const args = Object.fromEntries(process.argv.slice(2).map(arg => {
  const index=arg.indexOf('=');
  if (!arg.startsWith('--') || index<3) throw new Error('Use --source=PATH --target=PATH --out=PATH [--snapshot=PATH]');
  return [arg.slice(2,index),arg.slice(index+1)];
}));
const source=resolve(args.source??'.');
if(!args.target||!args.out) throw new Error('Target checkout and a new output directory are required.');
const target=resolve(args.target),out=resolve(args.out);
function inside(root,path){const rel=relative(root,path);return !rel||(!rel.startsWith('..')&&!isAbsolute(rel));}
if(inside(target,out)||inside(source,out)||existsSync(out)) throw new Error('Output must be a new directory outside both checkouts.');
const git=(root,...argv)=>execFileSync('git',['-C',root,...argv],{encoding:'utf8',maxBuffer:32*1024*1024}).trim();
const hash=data=>createHash('sha256').update(data).digest('hex');
const targetHead=git(target,'rev-parse','HEAD');
if(args['target-sha']&&targetHead!==args['target-sha'])throw new Error('Target SHA differs from requested base.');
const beforeTarget=git(target,'status','--porcelain');
const files=git(source,'ls-files','--cached','--others','--exclude-standard','-z').split('\0')
  .filter(p=>p&&!p.startsWith('validation/')&&!p.startsWith('assets/')&&p!=='index.html').sort();
mkdirSync(out,{recursive:true});
const inventory=[];
for(const path of files){
 if(path.startsWith('..')||isAbsolute(path))throw new Error('Invalid source path.');
 const src=resolve(source,path);if(!existsSync(src))continue;
 const data=readFileSync(src),dst=resolve(out,'source',path);
 mkdirSync(dirname(dst),{recursive:true});writeFileSync(dst,data);
 const other=resolve(target,path),targetHash=existsSync(other)?hash(readFileSync(other)):null;
 inventory.push({path,sha256:hash(data),bytes:data.length,targetSha256:targetHash,
  integration:targetHash===hash(data)?'identical':targetHash?'merge-required':'new-module',
  domain:path.startsWith('src/iskorka/')?'spark':path==='src/world/WorldEngine.ts'||path==='src/world/types.ts'?'mixed-boundary':'shared-world-or-support'});
}
const manifest={format:'iskorka-ainkrad-preparation-v1',purpose:'offline-review-only',
 source:{head:git(source,'rev-parse','HEAD'),dirty:git(source,'status','--porcelain')!==''},
 target:{head:targetHead,version:JSON.parse(readFileSync(resolve(target,'package.json'),'utf8')).version},
 automaticImportSupported:false,inventory,
 requirements:[
  'Preserve target independent world-domain agents, isolated external boundary, disconnected operation and water/plant/weather conservation.',
  'Merge mixed WorldEngine/types changes by function; never replace the Ainkrad engine with the Iskorka engine.',
  'Sparks receive PerceptBatch and return ActionIntent; External controllers and system agents receive no brain/body/identity writer.',
  'Retain personal RNG, finite 256 KiB brain, age, memories, maps, relationships, pregnancy, sleep, inventory and pending actions.',
  'No guardian cohort or blank newborn reset may be applied to existing Ainkrad residents.',
  'Map physical IDs and canonical time explicitly before any future cross-world import; refuse collisions and missing places.',
  'Rehearse on a copy with deterministic continuation; preserve external public history and operation deduplication records separately.'
 ]};
if(args.snapshot){
 const raw=readFileSync(resolve(args.snapshot));
 const parsed=args.snapshot.endsWith('.bin')?deserialize(raw):JSON.parse(raw.toString('utf8'));
 const world=parsed.world??parsed;
 if(world.simulationProfile!=='iskorka-human-lab-v1'||!world.agents||!world.places||!world.calendar||!world.iskorkaBrainV1)
  throw new Error('Expected an explicit Iskorka full snapshot, never an inferred Ainkrad save.');
 const residents=Object.values(world.agents);
 const sparks=residents.map(agent=>{
  const brain=world.iskorkaBrainV1.brainsByAgentId[agent.id];
  if(agent.life.alive&&(!brain||brain.ownerAgentId!==agent.id))throw new Error('Missing or foreign live brain: '+agent.id);
  if(!agent.life.alive&&brain)throw new Error('Retired owner still has a private brain: '+agent.id);
  if(!world.places[agent.homeId]||!world.places[agent.locationId])throw new Error('Unresolved resident place: '+agent.id);
  return {id:agent.id,alive:agent.life.alive,generation:agent.life.generation,agent,brain,
   body:world.v21?.bodiesByAgentId[agent.id],
   references:{authoritativeFullSnapshot:'world.snapshot.json',ownerId:agent.id}};
 });
 const snapshot=JSON.stringify(world),sparkData=JSON.stringify({format:'iskorka-spark-review-v1',worldId:world.id,worldMinute:world.calendar.elapsedWorldMinutes,sparks});
 writeFileSync(resolve(out,'world.snapshot.json'),snapshot);
 writeFileSync(resolve(out,'sparks.review.json'),sparkData);
 // Keep the exact input as a rollback/checkpoint artifact as well as portable JSON.
 copyFileSync(resolve(args.snapshot),resolve(out,'source-checkpoint'+(args.snapshot.endsWith('.bin')?'.bin':'.json')));
 manifest.snapshot={worldId:world.id,revision:world.revision,worldMinute:world.calendar.elapsedWorldMinutes,
  live:residents.filter(a=>a.life.alive).length,retired:residents.filter(a=>!a.life.alive).length,
  sha256:hash(snapshot),sparkReviewSha256:hash(sparkData),sourceCheckpointSha256:hash(raw),
  completeRuntimeState:true,completeExternalHistory:false,
  warning:'Review projection is not a standalone resident importer. The full snapshot retains every extension and relationship.'};
}
writeFileSync(resolve(out,'source.patch'),git(source,'diff','--binary','HEAD')+'\n');
writeFileSync(resolve(out,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
writeFileSync(resolve(out,'READ_FIRST.txt'),[
 'ПОДГОТОВКА ПЕРЕНОСА; это не автоматический импорт в Айнкрад.',
 'Исходники находятся в source/. Новые файлы перечислены в manifest.json; один source.patch их не заменяет.',
 'Мир: материалы, строительство, вода, движение, исследования; смешанные файлы требуют переноса по функциям.',
 'Искры: тело, личное восприятие, конечная память, обучение, возраст и одежда; ни внешний контроллер, ни агент мира ими не управляет.',
 'world.snapshot.json сохраняет полное состояние, включая связи и расширения. sparks.review.json служит только для проверки владельцев.',
 'Этот пакет ничего не записывает в целевой репозиторий и не заменяет существующее сохранение Айнкрада.',
 'Перед настоящим переносом нужны адаптеры IDs/времени, архив истории, проверка коллизий и продолжение на копии.'
].join('\n')+'\n');
if(git(target,'rev-parse','HEAD')!==targetHead||git(target,'status','--porcelain')!==beforeTarget)
 throw new Error('Target changed during preparation; investigate concurrent edits.');
console.log(JSON.stringify({output:out,files:inventory.length,targetUnchanged:true,snapshot:manifest.snapshot??null}));
