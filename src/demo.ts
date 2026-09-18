import { LiveWorldRuntime } from './runtime/LiveWorldRuntime';
import { WORLD_MINUTES_PER_YEAR } from './world/WorldClock';
const world = await LiveWorldRuntime.create({ seed: 'iskorka-demo' });
while (!(await world.catchUpBatchTo(WORLD_MINUTES_PER_YEAR)).completed) { /* no semantic steps skipped */ }
const state = world.worldSnapshot();
console.log(JSON.stringify({ profile: state.profile, years: state.calendar.elapsedWorldMinutes / WORLD_MINUTES_PER_YEAR, settlements: Object.values(state.settlements).map(s => s.name), population: state.population, people: Object.values(state.agents).map(a => ({ name: a.name, alive: a.life.alive })) }, null, 2));
