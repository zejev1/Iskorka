import {IskorkaRuntime} from '../src/iskorka/WorldRuntime';
import {InMemoryWorldStore} from '../src/world/InMemoryWorldStore';
import {assertIskorkaProfile} from '../src/iskorka/Profile';
import {writeFileSync} from 'node:fs';
const started=performance.now(),r=await IskorkaRuntime.openOrCreate(new InMemoryWorldStore(),'iskorka-baseline-20260918','iskorka-world'),records=[];
for(let year=10;year<=110;year+=10){
 await r.advanceTo(year*525600);const w=r.snapshot();assertIskorkaProfile(w);
 records.push({year,alive:Object.values(w.agents).filter(a=>a.life.alive).length,births:w.population.births,deaths:w.population.deaths,settlements:Object.keys(w.settlements).length,places:Object.keys(w.places).length});
 console.log(JSON.stringify(records.at(-1)));
}
writeFileSync('validation/century-world.json',JSON.stringify({seed:'iskorka-baseline-20260918',milliseconds:performance.now()-started,records},null,2));
