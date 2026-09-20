import { WorldAtlasRenderer } from '../presentation/WorldAtlasRenderer';
import { WorldMapCamera } from '../presentation/WorldMapCamera';
import { installWorldMapGestures } from '../presentation/WorldMapGestures';
import { physicalPlaceDrawing, applyPhysicalPlaceStyle, visibleMapLabels } from '../presentation/MapPlacePresentation';
import { worldCalendarAtMinutes } from '../world/WorldClock';
import { worldWeatherV21 } from '../v21/WeatherV21';
import type { AgentState, WorldState } from '../world/types';
import { ISKORKA_VERSION, ISKORKA_DATABASE, ISKORKA_WORLD_ID } from './Profile';
import { MINUTES_PER_SECOND, type WorldCommand, type WorldMessage, type Speed, type WorldFrame } from './protocol';
import {
  canonicalIskorkaProductionUrl,
  requestDurableBrowserStorage,
} from './BrowserPersistence';
import './style.css';

// Host operation IDs only; simulation randomness remains the persisted F2 RNG.
function hostId(): string {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const escape = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, s => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[s]!));
const number = (n: number) => new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(n);
const percent = (n: number | undefined) => number((n ?? 0) * 100) + '%';
const action: Record<string, string> = { rest:'Отдыхает', work:'Работает', gather:'Собирает ресурсы', craft:'Мастерит', hunt:'Охотится', fish:'Рыбачит', explore:'Исследует', walk:'Идёт', relax:'Отдыхает', socialize:'Общается', help:'Помогает', reflect:'Размышляет', bond:'Общается с близким', pray:'Молится', read:'Читает', farm:'Работает в поле', build:'Строит', teach:'Обучает' };
const jobs: Record<string, string> = { undecided:'Профессия ещё не выбрана', farmer:'Земледелец', forager:'Собиратель', woodcutter:'Лесоруб', miner:'Рудокоп', fisher:'Рыбак', hunter:'Охотник', artisan:'Ремесленник', smith:'Кузнец', builder:'Строитель', caregiver:'Попечитель', scout:'Разведчик', cartographer:'Картограф', teacher:'Наставник', scribe:'Писец', guard:'Страж', warrior:'Воин', spiritual_keeper:'Хранитель традиций' };
const seasons = { spring:'Весна', summer:'Лето', autumn:'Осень', winter:'Зима' };
const traits: Record<string,string> = { sociability:'Общительность', diligence:'Деятельность', curiosity:'Любознательность', generosity:'Отзывчивость', resilience:'Стойкость', riskTolerance:'Смелость' };
const skills: Record<string,string> = { gathering:'Собирательство', hunting:'Охота', craft:'Ремесло', social:'Общение', exploration:'Исследование' };
let latest: WorldFrame | undefined;
let selected: { type:'agent'|'place'; id:string } = { type:'place', id:'commons' };
let mode: 'people'|'place'|'inspect' = 'people';
let ready = false;
let focused = false;
let raf = 0;
let worker: Worker | undefined;

$('app').innerHTML = `
  <header class="topbar">
    <div class="brand"><span class="brand-mark" aria-hidden="true">✦</span><div><h1>Искорка</h1><span class="version">${ISKORKA_VERSION}</span></div></div>
    <div class="clock"><strong id="calendar">Открытие мира…</strong><span id="weather">Физический мир · человеческое поселение</span></div>
    <span class="live-status" id="status">Загрузка</span>
  </header>
  <main class="workspace">
    <section class="world-shell" aria-label="Наблюдение за миром">
      <div id="map" class="world-map">
        <div id="ground" class="map-layer"></div>
        <svg id="roads" class="map-layer" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"></svg>
        <div id="towns" class="map-layer"></div><div id="places" class="map-layer"></div><div id="people-map" class="map-layer"></div>
      </div>
      <div class="map-title"><span class="eyebrow">ЧЕЛОВЕЧЕСКИЙ МИР</span><strong id="town-title">Основание</strong><span id="map-caption">Перемещение — пальцем, масштаб — двумя пальцами</span></div>
      <div class="map-controls"><button id="center" title="Вернуться к поселению" aria-label="К поселению">⌖</button><button id="zoom-in" aria-label="Приблизить">+</button><button id="zoom-out" aria-label="Отдалить">−</button></div>
      <div class="map-footer"><span id="scale">100 м</span><span id="save-state">Ожидание сохранения</span></div>
    </section>
    <aside class="inspector">
      <section class="population"><div><span class="eyebrow">НАСЕЛЕНИЕ</span><strong id="population">—</strong></div><div class="life-stats"><span>Родилось <b id="births">0</b></span><span>Умерло <b id="deaths">0</b></span></div></section>
      <nav class="tabs" aria-label="Информация о мире"><button data-tab="people" aria-selected="true">Искры</button><button data-tab="place">Поселение</button><button data-tab="inspect">Проверка</button></nav>
      <div id="panel" class="panel"></div>
    </aside>
  </main>
  <footer class="controls-bar">
    <div class="time-controls"><button id="pause" class="primary" disabled>▶ Запустить</button><label class="speed-label" for="speed">Скорость</label><select id="speed" aria-label="Скорость времени"><option value="realtime">Минута = минута</option><option value="slow">День / мин</option><option value="normal" selected>Год / мин</option><option value="fast">10 лет / мин</option></select><button id="step" title="Продвинуть мир на один сохранённый квант F2" disabled>Один шаг</button></div>
    <div class="reset-controls"><span id="pace" class="pace">Время не пропускается</span><button id="reset" disabled>Новый мир</button></div>
  </footer>
  <div id="notice" role="status" class="notice" hidden></div>
  <dialog id="reset-dialog"><form method="dialog"><span class="eyebrow">НОВОЕ НАЧАЛО</span><h2>Создать новый мир?</h2><p>Текущая эпоха завершится. Начнут жизнь десять новых Искр. Название поселения останется «Основание».</p><label>Ключ генерации<input id="seed" maxlength="128" required autocomplete="off"></label><div class="dialog-buttons"><button value="cancel">Отмена</button><button value="create" class="primary">Создать мир</button></div></form></dialog>`;

const camera = new WorldMapCamera();
const atlas = new WorldAtlasRenderer($('ground'), document.getElementById('roads') as unknown as SVGSVGElement, $('towns'));
function notice(text:string):void { $('notice').textContent=text; $('notice').hidden=false; }
function send(command:WorldCommand):void { worker?.postMessage(command); }
function requestRender():void { if (!raf) raf=requestAnimationFrame(() => { raf=0; drawMap(); }); }
function center():void {
  const w=latest?.world; if (!w) return;
  const p=w.places.commons; camera.x=p.mapX;camera.y=p.mapY;
  camera.pixelsPerUnit=Math.min(camera.width,camera.height)/2.3;
  focused=true;requestRender();
}
function resize():void { const r=$('map').getBoundingClientRect();camera.resize(r.width,r.height); if(!focused)center();requestRender(); }
new ResizeObserver(resize).observe($('map'));
installWorldMapGestures($('map'),camera,requestRender);
let tap: {id:string;type:'agent'|'place';x:number;y:number;pointer:number} | undefined;
const touchPointers=new Set<number>();
$('map').addEventListener('pointerdown',e=>{
 touchPointers.add(e.pointerId);
 const target=(e.target as Element).closest<HTMLElement>('[data-agent-id],[data-place-id]');
 tap=touchPointers.size===1&&target ? {id:target.dataset.agentId??target.dataset.placeId!,type:target.dataset.agentId?'agent':'place',x:e.clientX,y:e.clientY,pointer:e.pointerId}:undefined;
});
$('map').addEventListener('pointermove',e=>{if(tap&&Math.hypot(e.clientX-tap.x,e.clientY-tap.y)>4)tap=undefined;});
$('map').addEventListener('pointerup',e=>{
 touchPointers.delete(e.pointerId);
 if(tap&&tap.pointer===e.pointerId){
  if(tap.type==='agent')selectAgent(tap.id);
  else{selected={type:'place',id:tap.id};mode='place';renderPanel();requestRender();}
 }
 tap=undefined;
});
$('map').addEventListener('pointercancel',e=>{touchPointers.delete(e.pointerId);tap=undefined;});

$('center').onclick=center;
$('zoom-in').onclick=()=>{camera.zoom(camera.pixelsPerUnit*1.5);requestRender();};
$('zoom-out').onclick=()=>{camera.zoom(camera.pixelsPerUnit/1.5);requestRender();};

function drawMap():void {
  const w=latest?.world;if(!w)return;
  atlas.render(w,camera);
  const places=Object.values(w.places).filter(p=>camera.visible(p.mapX,p.mapY) && (camera.pixelsPerUnit>25 || ['commons','city','village'].includes(p.kind))).slice(0,180);
  const marked=new Set(selected.type==='place'?[selected.id]:[]);
  const labels=visibleMapLabels(places,camera,marked);
  const nodes=document.createDocumentFragment();
  for(const p of places){
    const point=camera.point(p.mapX,p.mapY);const b=document.createElement('button');
    b.className='place '+(marked.has(p.id)?'selected':'');b.dataset.placeId=p.id;
    b.style.left=point.x+'%';b.style.top=point.y+'%';b.title=p.name;b.setAttribute('aria-label',p.name);
    applyPhysicalPlaceStyle(b,p,camera);b.innerHTML=physicalPlaceDrawing(p,camera.pixelsPerUnit>150);
    const label=labels.get(p.id);if(label){const span=document.createElement('span');span.className='map-label';span.textContent=p.name;span.style.transform=`translate(calc(-50% + ${label.offsetX}px), ${label.offsetY}px)`;b.append(span);}
    b.onclick=()=>{selected={type:'place',id:p.id};mode='place';renderPanel();requestRender();};nodes.append(b);
  }
  $('places').replaceChildren(nodes);
  const inhabitants=document.createDocumentFragment();
  if(camera.pixelsPerUnit>=20)for(const a of Object.values(w.agents)){
    if(!a.life.alive || !camera.visible(a.position.x,a.position.y,20))continue;
    const p=camera.point(a.position.x,a.position.y);const b=document.createElement('button');
    b.className='resident '+(a.sex==='female'?'female ':'')+(selected.type==='agent'&&selected.id===a.id?'selected':'');
    b.style.left=p.x+'%';b.style.top=p.y+'%';b.dataset.agentId=a.id;b.title=a.name+' · '+activity(a,w);b.setAttribute('aria-label',a.name);
    b.innerHTML='<span class="person-dot"></span>'+(selected.type==='agent'&&selected.id===a.id?'<span class="person-name">'+escape(a.name)+'</span>':'');
    b.onclick=()=>selectAgent(a.id);inhabitants.append(b);
  }
  $('people-map').replaceChildren(inhabitants);
  const metres=100/camera.pixelsPerUnit*100;
  $('scale').textContent=(metres>=1000?(metres/1000).toFixed(1)+' км':number(metres)+' м')+' на 100 px';
}
function activity(a:AgentState,w:WorldState):string {
  if(!a.life.alive)return 'Умер';
  if(a.movement)return 'В пути';
  const body=w.v21?.bodiesByAgentId[a.id];
  if(body && 'sleep' in body && (body.sleep as { status?: string } | undefined)?.status === 'sleeping')return 'Спит';
  return a.lastAction ? (action[a.lastAction]??'Действует') : 'Осваивается';
}
function selectAgent(id:string):void {selected={type:'agent',id};mode='people';renderPanel();requestRender();}
function cell(label:string,value:unknown):string {return `<div class="metric"><span>${escape(label)}</span><strong>${escape(value)}</strong></div>`;}
function renderPanel():void {
  const w=latest?.world;if(!w)return;
  document.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach(b=>b.setAttribute('aria-selected',String(b.dataset.tab===mode)));
  const panel=$('panel');
  const previousScroll=panel.scrollTop; const detailsOpen=!!panel.querySelector('details[open]');
  if(mode==='people'){
    const a=selected.type==='agent'?w.agents[selected.id]:undefined;
    let html='';
    if(a){
      const body=w.v21?.bodiesByAgentId[a.id];const evidence=w.v16?.residentEvidenceByAgentId[a.id];
      const livelihood=w.v18?.livelihoodByAgentId[a.id];
      html=`<section class="resident-detail"><div class="detail-heading"><div><span class="eyebrow">${a.sex==='male'?'МУЖЧИНА':'ЖЕНЩИНА'} · ${number(Math.floor(a.life.ageYears))} лет</span><h2>${escape(a.name)}</h2></div><button id="follow" aria-label="Найти жителя на карте">⌖</button></div><p class="activity">${escape(activity(a,w))} · ${escape(w.places[a.locationId]?.name??a.locationId)}</p><span class="job">${escape(jobs[livelihood?.primary??'undecided']??'Развивает своё дело')}</span><div class="metrics">${cell('Здоровье',percent(a.life.health))}${cell('Энергия',percent(a.energy))}${cell('Действий',evidence?.recordedDecisionCount??0)}${cell('Раны / болезни',`${body?.wounds.length??0} / ${body?.diseases.length??0}`)}</div><details><summary>Тело, характер и опыт</summary><div class="traits">${Object.entries(a.personality).map(([k,v])=>cell(traits[k]??k,percent(v))).join('')}${Object.entries(a.skills).map(([k,v])=>cell(skills[k]??k,percent(v))).join('')}${cell('Дети',a.life.childIds.length)}${cell('Поколение',a.life.generation)}</div></details></section>`;
    } else html='<p class="panel-intro">Нажмите на Искру, чтобы увидеть её состояние и прожитый опыт.</p>';
    html+='<div class="resident-list">'+Object.values(w.agents).filter(a=>a.life.alive).map(a=>`<button class="resident-card ${selected.type==='agent'&&selected.id===a.id?'active':''}" data-person="${escape(a.id)}"><span class="avatar">${escape(a.name.charAt(0))}</span><span><strong>${escape(a.name)}</strong><small>${number(Math.floor(a.life.ageYears))} лет · ${escape(activity(a,w))}</small></span><span class="arrow">›</span></button>`).join('')+'</div>';
    panel.innerHTML=html;
    panel.querySelectorAll<HTMLButtonElement>('[data-person]').forEach(b=>b.onclick=()=>selectAgent(b.dataset.person!));
    if($('follow'))$('follow').onclick=()=>{if(a){camera.x=a.position.x;camera.y=a.position.y;requestRender();}};
  } else if(mode==='place'){
    const place=w.places[selected.type==='place'?selected.id:'commons']??w.places.commons;
    const town=w.settlements[place.settlementId??'settlement_ainkrad'];
    const people=Object.values(w.agents).filter(a=>a.life.alive&&a.locationId===place.id);
    const wildlife=Object.values(w.wildlife).filter(a=>a.habitatId===place.id);
    panel.innerHTML=`<span class="eyebrow">${place.kind==='library'?'БИБЛИОТЕКА':'ФИЗИЧЕСКОЕ МЕСТО'}</span><h2>${escape(place.name)}</h2><p class="panel-intro">${escape(town?.name??'За пределами поселения')}</p><div class="metrics">${cell('Жители здесь',people.length)}${cell('Связанные места',place.connectedPlaceIds.length)}${cell('Плодородие',percent(place.fertility))}${cell('Дома в мире',Object.values(w.places).filter(p=>p.kind==='home').length)}</div><h3>Поселения</h3><div class="town-list">${Object.values(w.settlements).map(t=>`<button data-town="${escape(t.id)}">${escape(t.name)} <span>⌖</span></button>`).join('')}</div><h3>Животный мир</h3><p class="muted">${wildlife.length?wildlife.map(a=>escape(({rabbit:'Кролики',deer:'Олени',bird:'Птицы',fish:'Рыба',boar:'Кабаны',wolf:'Волки'} as Record<string,string>)[a.species]??a.species)+': '+number(a.count)).join(' · '):'В этой локации популяции не зарегистрированы.'}</p><h3>Карта</h3><p class="muted">Масштаб меняет только отображение. Люди продолжают жить за пределами экрана.</p>`;
    panel.querySelectorAll<HTMLButtonElement>('[data-town]').forEach(b=>b.onclick=()=>{const t=w.settlements[b.dataset.town!];selected={type:'place',id:t.centerPlaceId};camera.x=t.centerX;camera.y=t.centerY;renderPanel();requestRender();});
  } else {
    const active=Object.values(w.agents).filter(a=>a.life.alive);
    panel.innerHTML=`<span class="eyebrow">ПЕРВЫЙ ЭТАП · МИР</span><h2>Состояние сборки</h2><div class="metrics">${cell('Люди',active.length)}${cell('Поселения',Object.keys(w.settlements).length)}${cell('Локации',Object.keys(w.places).length)}${cell('Ревизия',w.revision)}${cell('Дороги',Object.keys(w.routes).length)}${cell('Эпоха',w.epoch??1)}</div><p class="ok-line">Отдельный автономный движок · IndexedDB</p><p class="muted">Перенесён физический мир F2. Новый конечный мозг, язык и связанная психофизиология ещё не реализованы: это следующие этапы, не возможности этой сборки.</p><h3>Ключ мира</h3><code class="seed-code">${escape(w.bootstrapSeed)}</code><h3>Сохранение</h3><p class="muted">${escape(ISKORKA_DATABASE)}<br>${escape(ISKORKA_WORLD_ID)}<br>Сохранения разных адресов сайта раздельные. При закрытой странице симуляция не выполняется.</p><h3>Время</h3><p class="muted">Движение рассчитывается непрерывно. Квант решений и старения унаследован от F2 и не укрупняется при ускорении. Целевая скорость зависит от устройства.</p>`;
  }
  if(detailsOpen){const details=panel.querySelector('details');if(details)details.open=true;}
  panel.scrollTop=previousScroll;
}
document.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach(b=>b.onclick=()=>{mode=b.dataset.tab as typeof mode;renderPanel();});
function display(frame:WorldFrame):void {
  latest=frame;const w=frame.world;const cal=worldCalendarAtMinutes(w.calendar.elapsedWorldMinutes);const weather=worldWeatherV21(w);
  $('calendar').textContent=`Год ${cal.year} · день ${cal.dayOfYear} · ${String(cal.hour).padStart(2,'0')}:${String(cal.minute).padStart(2,'0')}`;
  $('weather').textContent=`${seasons[cal.season]} · ${weather.label} · ${weather.temperatureC>0?'+':''}${weather.temperatureC} °C`;
  $('population').textContent=number(Object.values(w.agents).filter(a=>a.life.alive).length);
  $('births').textContent=number(w.population.births);$('deaths').textContent=number(w.population.deaths);
  $('status').textContent=frame.paused?'Пауза':'Мир живёт';$('status').classList.toggle('running',!frame.paused);
  $('pause').textContent=frame.paused?'▶ Запустить':'Ⅱ Пауза';
  ($('speed') as HTMLSelectElement).value=frame.speed;
  ($('step') as HTMLButtonElement).disabled=!ready||!frame.paused;
  $('save-state').textContent='Сохранено · '+number(w.revision);
  $('pace').textContent=frame.paused?'На паузе':
    frame.speed==='realtime'?'1 мин мира = 1 мин реального времени':
    `Цель: ${frame.speed==='fast'?'10 лет':frame.speed==='slow'?'день':'год'} / мин`;
  try { localStorage.setItem('iskorka-view-settings',JSON.stringify({paused:frame.paused,speed:frame.speed})); } catch { /* World durability is IndexedDB, not this convenience preference. */ }
  if(!focused)center();renderPanel();requestRender();
}
$('pause').onclick=()=>{if(latest)send({type:'pause',paused:!latest.paused});};
$('speed').onchange=()=>send({type:'speed',speed:($('speed') as HTMLSelectElement).value as Speed});
$('step').onclick=()=>{if(latest){($('step') as HTMLButtonElement).disabled=true;send({type:'advance',minutes:latest.world.v15!.simulationClock.quantumWorldMinutes});}};
$('reset').onclick=()=>{($('seed') as HTMLInputElement).value='iskorka-'+hostId().slice(0,12);($('reset-dialog') as HTMLDialogElement).showModal();};
$('reset-dialog').addEventListener('close',()=>{
  if(($('reset-dialog') as HTMLDialogElement).returnValue!=='create')return;
  const seed=($('seed') as HTMLInputElement).value.trim(); if(!seed)return;
  focused=false;selected={type:'place',id:'commons'};
  send({type:'reset',seed,operationId:hostId()});
});

async function launch():Promise<void>{
  if(!('Worker' in window)||!('indexedDB' in window))throw new Error('Браузер не поддерживает Worker или IndexedDB.');
  const durable = await requestDurableBrowserStorage(navigator.storage);
  if (durable === false) {
    notice('Браузер не дал постоянное хранилище. Не очищайте данные сайта, иначе локальный мир будет удалён.');
  }
  let settings:{paused:boolean;speed:Speed}={paused:false,speed:'normal'};
  try{const saved=JSON.parse(localStorage.getItem('iskorka-view-settings')??'null');if(saved&&typeof saved.paused==='boolean'&&Object.hasOwn(MINUTES_PER_SECOND,saved.speed))settings=saved;}catch{}
  worker=new Worker(new URL('./worker.js',import.meta.url),{type:'module',name:'iskorka-world'});
  worker.onmessage=(event:MessageEvent<WorldMessage>)=>{
    if(event.data.type==='frame')display(event.data);
    else if(event.data.type==='ready'){
      ready=true;($('pause')as HTMLButtonElement).disabled=false;($('reset')as HTMLButtonElement).disabled=false;
      ($('step')as HTMLButtonElement).disabled=!latest?.paused;
    }else if(event.data.type==='error'){
      notice('Мир остановлен: '+event.data.message);$('status').textContent='Ошибка';$('status').classList.remove('running');
      ($('pause')as HTMLButtonElement).disabled=true;($('step')as HTMLButtonElement).disabled=true;
    }
  };
  worker.onerror=event=>{notice('Не удалось запустить движок: '+event.message);$('status').textContent='Ошибка';};
  send({type:'init',seed:'iskorka-'+hostId(),...settings});
}
// IndexedDB is origin-scoped. Vercel's unique deployment hosts would otherwise
// create a different world database after every deployment.
const canonicalUrl = canonicalIskorkaProductionUrl(location.href);
if (canonicalUrl) {
  location.replace(canonicalUrl);
} else if(navigator.locks){
  navigator.locks.request('iskorka-human-lab-owner',{mode:'exclusive',ifAvailable:true},async lock=>{
    if(!lock){notice('Этот мир уже открыт в другой вкладке. Закройте её и обновите страницу.');$('status').textContent='Другая вкладка';return;}
    await launch().catch(e=>notice(String(e)));
    await new Promise<void>(()=>{});
  }).catch(e=>notice(String(e)));
}else launch().catch(e=>notice(String(e)));
window.addEventListener('beforeunload',()=>{worker?.terminate();});
