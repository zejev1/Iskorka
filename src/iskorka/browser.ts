import './iskorka.css';
import '../presentation/world-atlas.css';
import { WorldAtlasRenderer } from '../presentation/WorldAtlasRenderer';
import { WorldMapCamera } from '../presentation/WorldMapCamera';
import { installWorldMapGestures } from '../presentation/WorldMapGestures';
import { placeDrawing, mapScaleBar } from '../presentation/WorldMapVisuals';
import { WORLD_SPEED_PRESETS, worldCalendarAtMinutes, type WorldSpeedId } from '../world/WorldClock';
import { worldWeatherV21 } from '../v21/WeatherV21';
import type { IskorkaCommand, IskorkaMessage, IskorkaFrame } from './protocol';
import { buildingSize } from '../world/BuildingFootprints';

const app = document.querySelector<HTMLDivElement>('#app')!;
app.innerHTML = `
<header><div class="brand"><span class="spark">✦</span><div><h1>Искорка <small>0.1.0</small></h1><p>Основание · физический мир</p></div></div><div id="clock">Первое открытие мира</div></header>
<main>
  <section class="world-panel" aria-label="Мир">
    <div class="toolbar"><button id="play" disabled>▶ Продолжить</button><select id="speed" aria-label="Скорость времени" disabled></select><span id="weather">—</span></div>
    <div id="map" class="world-map world-map-viewport" tabindex="0" aria-label="Карта мира. Перетаскивайте для перемещения, используйте два пальца для масштаба."><div id="ground" class="biomes-layer"></div><svg id="roads" viewBox="0 0 100 100" preserveAspectRatio="none"></svg><div id="towns"></div><div id="places"></div><div id="residents"></div><div class="map-tools"><button id="zoom-in" aria-label="Приблизить">+</button><button id="zoom-out" aria-label="Отдалить">−</button><button id="home" aria-label="Показать Основание">⌂</button></div><div id="scale"></div><div class="map-title">ОСНОВАНИЕ</div></div>
    <div class="world-bottom"><span id="status" role="status">Загрузка…</span><button id="save" disabled>Сохранить</button></div>
    <div class="notice" id="notice" role="alert" hidden></div>
  </section>
  <aside>
    <div class="section-head"><h2>Жители</h2><span id="population">—</span></div><div id="people"></div>
    <section class="inspector"><h2 id="detail-title">Выберите Искру</h2><div id="detail">Каждая точка на карте — житель этого мира. Нажмите на имя или на точку, чтобы увидеть его состояние.</div></section>
    <details><summary>События мира</summary><div id="events"></div></details>
    <details><summary>Первый этап</summary><p>Работает физический мир F2: тело, погода, движение, хозяйство и чтение. Новые конечный мозг и приобретённый язык ещё не реализованы. Старые нужды и диалоги не выдаются за новую личность.</p><p>Мир сохраняется после каждого вычисленного шага. Закрытая вкладка не накапливает скрытый долг времени. При открытии — пауза.</p></details>
    <button id="reset" class="danger" disabled>Новый мир</button>
  </aside>
</main><footer>Свобода жить внутри мира. Без управляющего наблюдателя.<span id="diagnostic"></span></footer>`;
const get = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const escape = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[c]!));
const map = get('map');
const camera = new WorldMapCamera();
const renderer = new WorldAtlasRenderer(get('ground'), document.getElementById('roads') as unknown as SVGSVGElement, get('towns'));
const worker = new Worker(new URL('./iskorka.worker.ts', import.meta.url), { type: 'module' });
const send = (message: IskorkaCommand) => worker.postMessage(message);
let frame: IskorkaFrame | undefined;
let focusedEpoch: number | undefined;
let selectedId: string | undefined;
let selectedPlace: string | undefined;
let renderRequested = false;
const speedSelect = get<HTMLSelectElement>('speed');
for (const preset of WORLD_SPEED_PRESETS) {
  const option = document.createElement('option'); option.value = preset.id; option.textContent = preset.shortLabel; option.title = preset.description; speedSelect.append(option);
}
const actionNames: Record<string, string> = { rest:'Отдых', work:'Работа', gather:'Сбор ресурсов', hunt:'Охота / рыбалка', socialize:'Общение', explore:'Исследование', reflect:'Размышление', learn:'Обучение', craft:'Ремесло', care:'Забота', teach:'Обучение другого', read:'Чтение' };
const percent = (x: number) => `${Math.round(x * 100)}%`;
function notify(text: string, error = false) { const n=get('notice'); n.textContent=text; n.hidden=false; n.classList.toggle('error', error); }
function focusHome() {
  if (!frame) return;
  const home = frame.world.places.commons;
  camera.x = home.mapX; camera.y = home.mapY; camera.pixelsPerUnit = 180; scheduleMap();
}
function scheduleMap() {
  if (renderRequested) return;
  renderRequested=true;
  requestAnimationFrame(() => { renderRequested=false; renderMap(); });
}
function renderMap() {
  if (!frame) return;
  const world=frame.world;
  renderer.render(world, camera);
  const places=document.createDocumentFragment();
  for (const place of Object.values(world.places)) {
    if (!camera.visible(place.mapX,place.mapY)) continue;
    if (camera.pixelsPerUnit < 3 && place.id !== 'commons' && place.kind !== 'village' && place.kind !== 'city') continue;
    if (['ocean','lake','river'].includes(place.kind)) continue; // The actual polygon is already rendered, not a fake building.
    const p=camera.point(place.mapX,place.mapY);
    const marker=document.createElement('button'); marker.className=`place ${place.kind}`; marker.dataset.place=place.id;
    marker.style.left=`${p.x}%`;marker.style.top=`${p.y}%`;
    const size=buildingSize(place);
    marker.style.width=`${size.width ? size.width*camera.pixelsPerUnit : Math.max(18,Math.min(40,.1*camera.pixelsPerUnit))}px`;
    if(size.width) { marker.style.height=`${size.height*camera.pixelsPerUnit}px`; marker.style.transform=`translate(-50%,-50%) rotate(${place.rotation ?? 0}rad)`; }
    marker.title=place.name; marker.setAttribute('aria-label',place.name);
    marker.innerHTML=placeDrawing(place.kind);
    if (['commons','library','workshop'].includes(place.kind) && camera.pixelsPerUnit>100) { const label=document.createElement('span'); label.className='place-caption';label.textContent=place.name;marker.append(label); }
    places.append(marker);
  }
  get('places').replaceChildren(places);
  const residents=document.createDocumentFragment();
  // Exact persisted positions: no animation that pretends a motionless body travels.
  for (const agent of Object.values(world.agents)) {
    if (!agent.life.alive || !camera.visible(agent.position.x,agent.position.y) || camera.pixelsPerUnit<3) continue;
    const p=camera.point(agent.position.x,agent.position.y);
    const marker=document.createElement('button');marker.className=`person ${agent.sex} ${agent.id===selectedId?'selected':''}`;
    marker.dataset.agent=agent.id; marker.title=agent.name;marker.setAttribute('aria-label',`Искра ${agent.name}`);
    marker.style.left=`${p.x}%`;marker.style.top=`${p.y}%`;
    marker.textContent=agent.name[0];residents.append(marker);
  }
  get('residents').replaceChildren(residents);
  const scale=mapScaleBar(camera.pixelsPerUnit); get('scale').textContent=scale.label;get('scale').style.width=`${scale.pixels}px`;
}
function selectAgent(id: string, focus = false) {
  selectedId=id;selectedPlace=undefined;
  const a=frame?.world.agents[id];
  if (focus && a) {camera.x=a.position.x;camera.y=a.position.y;camera.pixelsPerUnit=Math.max(180,camera.pixelsPerUnit);}
  renderDetails();scheduleMap();
}
function renderDetails() {
  if (!frame) return;
  const w=frame.world,a=selectedId?w.agents[selectedId]:undefined;
  if (a) {
    get('detail-title').textContent=a.name;
    const location=w.places[a.locationId]?.name ?? a.locationId;
    const destination=a.movement?w.places[a.movement.targetPlaceId]?.name:undefined;
    get('detail').innerHTML=`<p>${a.sex==='female'?'Женщина':'Мужчина'} · ${Math.floor(a.life.ageYears)} лет · ${a.life.alive?'живёт':'умерла / умер'}</p><dl><dt>Здоровье</dt><dd>${percent(a.life.health)}</dd><dt>Энергия</dt><dd>${percent(a.energy)}</dd><dt>Стресс</dt><dd>${percent(a.stress)}</dd><dt>Ресурсы</dt><dd>${percent(a.resources)}</dd></dl><p><b>${escape(actionNames[a.lastAction ?? ''] ?? a.lastAction ?? 'Начало жизни')}</b><br>${escape(destination?`В пути: ${destination}`:location)}</p><p class="muted">Любознательность ${percent(a.personality.curiosity)} · общительность ${percent(a.personality.sociability)} · трудолюбие ${percent(a.personality.diligence)}</p><p class="muted">Известных мест: ${a.knownPlaceIds?.length ?? 0} · детей: ${a.life.childIds.length}</p>`;
  } else if (selectedPlace) {
    const p=w.places[selectedPlace]; if(!p)return;
    get('detail-title').textContent=p.name;
    const present=Object.values(w.agents).filter(a=>a.life.alive&&!a.movement&&a.locationId===p.id);
    const wildlife=Object.values(w.wildlife).filter(a=>a.habitatId===p.id);
    get('detail').innerHTML=`<p>Жителей на месте: ${present.length} · вместимость: ${p.capacity}</p><p>Плодородие: ${percent(p.fertility)} · опасность: ${percent(p.danger)}</p><p>${escape(wildlife.map(a=>`${a.species}: ${Math.floor(a.count)}`).join(', '))}</p>`;
  }
}
function renderFrame(next: IskorkaFrame) {
  frame=next;
  const w=next.world;
  if (focusedEpoch !== w.epoch) {focusedEpoch=w.epoch;selectedId=undefined;selectedPlace=undefined;focusHome();get('detail-title').textContent='Выберите Искру';get('detail').textContent='Нажмите на имя или жителя на карте.';}
  const c=worldCalendarAtMinutes(w.calendar.elapsedWorldMinutes),weather=worldWeatherV21(w);
  get('clock').textContent=`Год ${c.year} · день ${c.dayOfYear} · ${String(c.hour).padStart(2,'0')}:${String(c.minute).padStart(2,'0')}`;
  get('weather').textContent=`${weather.label} · ${weather.temperatureC}°C`;
  const alive=Object.values(w.agents).filter(a=>a.life.alive);
  get('population').textContent=String(alive.length);
  get('people').innerHTML=alive.map(a=>`<button class="resident-row" data-agent="${escape(a.id)}"><span class="dot ${a.sex}"></span><span>${escape(a.name)}<small>${Math.floor(a.life.ageYears)} лет · ${escape(a.movement?'В пути':actionNames[a.lastAction ?? ''] ?? a.lastAction ?? 'Начало жизни')}</small></span><span class="health">${percent(a.life.health)}</span></button>`).join('') || '<p>Живых жителей не осталось. Никакого скрытого восстановления населения.</p>';
  get<HTMLButtonElement>('play').textContent=next.running?'Ⅱ Пауза':'▶ Продолжить';
  speedSelect.value=next.speed;
  get('status').textContent=`${next.running?'Мир живёт':'Пауза'} · ${next.capacityLimited?'Скорость ограничена мощностью устройства':'Автосохранение'} · запись ${w.revision}`;
  get('diagnostic').textContent=`Эпоха ${w.epoch} · шаг ${Math.round(next.workMs)} мс`;
  get('events').innerHTML=next.recentEvents.slice(-20).reverse().map(e=>`<p><b>${escape(e.kind)}</b><br>${escape(JSON.stringify(e.payload)).slice(0,320)}</p>`).join('') || '<p>Пока нет событий.</p>';
  for (const id of ['play','speed','save','reset']) get<HTMLButtonElement>(id).disabled=false;
  map.dataset.revision=String(w.revision);
  renderDetails();scheduleMap();
}
worker.addEventListener('message', (e: MessageEvent<IskorkaMessage>) => {
  if(e.data.type==='frame') renderFrame(e.data.frame);
  else if(e.data.type==='saved') notify(`Сохранено. Запись ${e.data.revision}.`);
  else if(e.data.type==='error') {if(frame)frame.running=false;get('play').textContent='▶ Продолжить';notify(e.data.message,true);get('status').textContent='Мир остановлен: ошибка';}
});
worker.addEventListener('error', e=>notify(`Не удалось запустить мир: ${e.message}`,true));
get('play').onclick=()=>send({type:frame?.running?'pause':'play'});
speedSelect.onchange=()=>send({type:'speed',speed:speedSelect.value as WorldSpeedId});
get('save').onclick=()=>send({type:'save'});
get('reset').onclick=()=>{ if(confirm('Начать новый мир? Текущее состояние будет сохранено как контрольная копия, а активный мир начнётся заново с десяти жителей.'))send({type:'reset',seed:crypto.randomUUID(),operationId:crypto.randomUUID()}); };
get('home').onclick=focusHome;
get('zoom-in').onclick=()=>{camera.zoom(camera.pixelsPerUnit*1.6);scheduleMap();};
get('zoom-out').onclick=()=>{camera.zoom(camera.pixelsPerUnit/1.6);scheduleMap();};
for(const b of Array.from(document.querySelectorAll('.map-tools button'))) b.addEventListener('pointerdown',e=>e.stopPropagation());
get('people').onclick=e=>{const t=(e.target as Element).closest<HTMLElement>('[data-agent]');if(t?.dataset.agent)selectAgent(t.dataset.agent,true);};
map.addEventListener('click', e=>{const t=(e.target as Element).closest<HTMLElement>('[data-agent],[data-place]');if(t?.dataset.agent)selectAgent(t.dataset.agent);else if(t?.dataset.place){selectedPlace=t.dataset.place;selectedId=undefined;renderDetails();scheduleMap();}});
// Viewport pointer capture retargets a touch click. Preserve the original tap
// target, but discard it on any drag or second finger (never select after pan).
let tap: {pointerId:number;x:number;y:number;agent?:string;place?:string}|undefined;
map.addEventListener('pointerdown',e=>{
  if(!e.isPrimary){tap=undefined;return;}
  const t=(e.target as Element).closest<HTMLElement>('[data-agent],[data-place]');
  tap=t?{pointerId:e.pointerId,x:e.clientX,y:e.clientY,agent:t.dataset.agent,place:t.dataset.place}:undefined;
});
map.addEventListener('pointermove',e=>{if(tap&&Math.hypot(e.clientX-tap.x,e.clientY-tap.y)>4)tap=undefined;});
map.addEventListener('pointercancel',()=>{tap=undefined;});
map.addEventListener('pointerup',e=>{
  const t=tap;tap=undefined;if(!t||t.pointerId!==e.pointerId)return;
  if(t.agent)selectAgent(t.agent);
  else if(t.place){selectedPlace=t.place;selectedId=undefined;renderDetails();scheduleMap();}
});
installWorldMapGestures(map,camera,()=>scheduleMap());
new ResizeObserver(()=>{camera.resize(map.clientWidth,map.clientHeight);scheduleMap();}).observe(map);
window.addEventListener('pagehide',()=>send({type:'pause'}));
send({type:'boot',seed:crypto.randomUUID()});
