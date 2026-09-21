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
  browserStorageStatusV1,
  canonicalIskorkaProductionUrl,
  requestDurableBrowserStorage,
  type BrowserStorageStatusV1,
} from './BrowserPersistence';
import { buildAgentAnalyticsV1 } from './AgentAnalyticsV1';
import {
  assignedFoundingMentorV1,
  isMentoredMinorV1,
} from './FoundingMentorsV1';
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
let storageStatus: BrowserStorageStatusV1 = { durability: 'unknown' };
let noticeTimer: ReturnType<typeof setTimeout> | undefined;

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
  <div id="notice" role="status" class="notice" hidden><span id="notice-text"></span><button id="notice-close" type="button" aria-label="Закрыть сообщение">×</button></div>
  <dialog id="reset-dialog"><form method="dialog"><span class="eyebrow">НОВОЕ НАЧАЛО</span><h2>Создать новый мир?</h2><p>Текущая эпоха завершится. Начнут жизнь десять новых Искр. Название поселения останется «Основание».</p><label>Ключ генерации<input id="seed" maxlength="128" required autocomplete="off"></label><div class="dialog-buttons"><button value="cancel">Отмена</button><button value="create" class="primary">Создать мир</button></div></form></dialog>`;

const camera = new WorldMapCamera();
const atlas = new WorldAtlasRenderer($('ground'), document.getElementById('roads') as unknown as SVGSVGElement, $('towns'));
function notice(text:string, autoHideMs?:number):void {
  if(noticeTimer)clearTimeout(noticeTimer);
  $('notice-text').textContent=text;
  $('notice').hidden=false;
  if(autoHideMs)noticeTimer=setTimeout(()=>{$('notice').hidden=true;noticeTimer=undefined;},autoHideMs);
}
$('notice-close').onclick=()=>{if(noticeTimer)clearTimeout(noticeTimer);noticeTimer=undefined;$('notice').hidden=true;};
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
  if(camera.pixelsPerUnit>=20)for(const mentor of Object.values(w.iskorkaMentorsV1?.mentorsById??{})){
    if(mentor.status==='inactive'||!camera.visible(mentor.position.x,mentor.position.y,20))continue;
    const p=camera.point(mentor.position.x,mentor.position.y);const marker=document.createElement('div');
    marker.className='mentor-marker';marker.style.left=p.x+'%';marker.style.top=p.y+'%';
    marker.title=mentor.name+' · наставник · '+mentor.status;
    marker.innerHTML='<span class="mentor-dot"></span><span class="mentor-name">'+escape(mentor.name)+'</span>';
    inhabitants.append(marker);
  }
  $('people-map').replaceChildren(inhabitants);
  const metres=100/camera.pixelsPerUnit*100;
  $('scale').textContent=(metres>=1000?(metres/1000).toFixed(1)+' км':number(metres)+' м')+' на 100 px';
}
function activity(a:AgentState,w:WorldState):string {
  if(!a.life.alive)return 'Умер';
  const body=w.v21?.bodiesByAgentId[a.id];
  if(body && 'sleep' in body && (body.sleep as { status?: string } | undefined)?.status === 'sleeping')return 'Спит';
  if(isMentoredMinorV1(w,a)){
    const mentor=assignedFoundingMentorV1(w,a.id);
    if(a.movement?.carriedByFoundingMentorId)return mentor?'С '+mentor.name+' · на руках на прогулке':'На руках у наставника';
    if(a.movement)return mentor?'С '+mentor.name+' · идёт под присмотром':'Идёт под присмотром';
    return mentor?'С '+mentor.name+' · учится и наблюдает':'Под присмотром наставников';
  }
  if(a.movement)return 'В пути';
  const intent=a.agencyCadence?.currentIntent;
  if(intent)return 'Решил: '+(action[intent]??'действовать');
  return a.lastAction ? (action[a.lastAction]??'Действует') : 'Осваивается';
}
function selectAgent(id:string):void {selected={type:'agent',id};mode='people';renderPanel();requestRender();}
function cell(label:string,value:unknown):string {return `<div class="metric"><span>${escape(label)}</span><strong>${escape(value)}</strong></div>`;}
function bytes(n:number|undefined):string {
  if(n===undefined||!Number.isFinite(n))return '—';
  if(n<1024)return number(n)+' Б';
  if(n<1024*1024)return (n/1024).toFixed(n<10*1024?1:0)+' КиБ';
  return (n/1024/1024).toFixed(1)+' МиБ';
}
function precise(n:number|undefined,digits=3):string {
  if(n===undefined||!Number.isFinite(n))return '—';
  return new Intl.NumberFormat('ru-RU',{maximumFractionDigits:digits}).format(n);
}
function percentOrDash(n:number|undefined):string {return n===undefined||!Number.isFinite(n)?'—':percent(n);}
function storageSummary():string {
  return storageStatus.durability==='durable'?'защищено браузером':
    storageStatus.durability==='best_effort'?'обычное IndexedDB':
    'статус неизвестен';
}
const analyticLabels:Record<string,string>={
  workingMemory:'Рабочая память',attentionControl:'Контроль внимания',episodicEncoding:'Запись эпизодов',
  semanticLearning:'Семантическое обучение',proceduralLearning:'Обучение навыкам',receptiveLanguage:'Понимание языка',
  expressiveLanguage:'Выражение языка',symbolicReasoning:'Символьное мышление',planning:'Планирование',
  retrievalReliability:'Надёжность извлечения',retrievalSpeed:'Скорость извлечения',learningPlasticity:'Пластичность',
  consolidatedExperienceIntegrity:'Сохранность опыта',heightM:'Рост',massKg:'Масса',bodyFatFraction:'Доля жира',
  painSensitivity:'Чувствительность к боли',sweatSensitivity:'Чувствительность потоотделения',
  motionSicknessSensitivity:'Чувствительность к укачиванию',visualAcuityBaseline:'Базовое зрение',
  interoceptionSensitivity:'Интероцептивная чувствительность',hydration:'Гидратация',
  electrolyteDeviation:'Электролитное отклонение',energyReserve:'Энергетический запас',stomachFill:'Наполнение желудка',
  bladderFill:'Мочевой пузырь',bowelLoad:'Кишечная нагрузка',coreTemperatureC:'Температура тела',
  skinTemperatureC:'Температура кожи',bloodVolumeFraction:'Объём крови',oxygenDebt:'Кислородный долг',
  cardiovascularLoad:'Сердечно-сосудистая нагрузка',respiratoryLoad:'Дыхательная нагрузка',
  exertionDebt:'Долг нагрузки',muscleFatigue:'Мышечная усталость',recoveryDebt:'Долг восстановления',
  inflammation:'Воспаление',immuneActivation:'Иммунная активация',toxinLoad:'Токсическая нагрузка',
  nausea:'Тошнота',dizziness:'Головокружение',autonomicArousal:'Вегетативное возбуждение',
  muscleTension:'Мышечное напряжение',stressHormoneLoad:'Стресс-гормоны',tearDrive:'Позыв к слезам',
  physicalPleasure:'Физическое удовольствие',sexualArousal:'Физическое возбуждение',reproductiveHealth:'Репродуктивное здоровье',
  skin:'Кожа',musculoskeletal:'Опорно-двигательная',circulatory:'Кровообращение',respiratory:'Дыхание',
  digestive:'Пищеварение',nervous:'Нервная система',immune:'Иммунная система',
  thirst:'Жажда',hunger:'Голод',breathlessness:'Одышка',weakness:'Слабость',coldStress:'Холод',
  heatStress:'Жара',sweating:'Потливость',tremor:'Дрожь',heartPounding:'Сердцебиение',
  bladderUrge:'Позыв к мочеиспусканию',bowelUrge:'Позыв кишечника',physicalDiscomfort:'Физический дискомфорт',
  cryingDrive:'Позыв плакать',tears:'Слёзы',blushing:'Покраснение',goosebumps:'Мурашки',dryMouth:'Сухость во рту',
  startle:'Испуг',postPleasureRelaxation:'Расслабление после удовольствия',
  grossMotor:'Крупная моторика',balance:'Баланс',coordination:'Координация',fineMotor:'Мелкая моторика',
  walkingCapacity:'Способность ходить',enduranceScale:'Возрастная выносливость',
  acuityScale:'Острота зрения',contrastScale:'Контрастность',motionScale:'Восприятие движения',
  recognitionReachScale:'Дальность распознавания',joy:'Радость',fear:'Страх',grief:'Горе',awe:'Трепет',hope:'Надежда',
  care:'Забота',freedom:'Свобода',knowledge:'Знание',tradition:'Традиция',ambition:'Амбиция',
  worldTrust:'Доверие миру',divinePresence:'Вера в божественное',fate:'Вера в судьбу',afterlife:'Вера в посмертие',
  belonging:'Принадлежность',purpose:'Смысл',strength:'Сила',endurance:'Выносливость',mobility:'Подвижность',recovery:'Восстановление',
  gathering:'Собирательство',hunting:'Охота',craft:'Ремесло',social:'Общение',exploration:'Исследование'
};
function valueForMetric(key:string,value:unknown):string {
  if(typeof value==='boolean')return value?'Да':'Нет';
  if(typeof value==='number'){
    if(key==='coreTemperatureC'||key==='skinTemperatureC')return precise(value,2)+' °C';
    if(key==='heightM')return precise(value,3)+' м';
    if(key==='massKg')return precise(value,2)+' кг';
    if(key.toLowerCase().includes('minute'))return precise(value,2);
    if(value>=0&&value<=1)return percent(value);
    return precise(value,3);
  }
  if(value===undefined||value===null)return '—';
  if(Array.isArray(value))return value.length?value.map(v=>typeof v==='object'?JSON.stringify(v):String(v)).join(' · '):'—';
  if(typeof value==='object')return JSON.stringify(value);
  return String(value);
}
function objectCells(value:unknown):string {
  if(!value||typeof value!=='object')return cell('Значение',value);
  return Object.entries(value as Record<string,unknown>).map(([key,val])=>cell(analyticLabels[key]??key,valueForMetric(key,val))).join('');
}
function details(id:string,title:string,body:string,open=false):string {
  return `<details data-detail="${escape(id)}" ${open?'open':''}><summary>${escape(title)}</summary>${body}</details>`;
}
function liveStamp(worldMinute:number):string {
  const cal=worldCalendarAtMinutes(worldMinute);
  return `Год ${cal.year} · день ${cal.dayOfYear} · ${String(cal.hour).padStart(2,'0')}:${String(cal.minute).padStart(2,'0')} · минута ${precise(worldMinute,2)}`;
}
function storagePanelHtml():string {
  const risk=storageStatus.durability==='best_effort';
  const quota=storageStatus.quotaBytes===undefined?'—':bytes(storageStatus.quotaBytes);
  const usage=storageStatus.usageBytes===undefined?'—':bytes(storageStatus.usageBytes);
  return `<section class="storage-card ${risk?'storage-risk':''}"><div><span class="eyebrow">ЛОКАЛЬНОЕ ХРАНИЛИЩЕ</span><strong>${escape(storageSummary())}</strong><p>${risk?'IndexedDB работает и мир сохраняется, но браузер не дал дополнительную защиту от автоматической очистки. Это не ошибка симуляции.':'Мир хранится локально в IndexedDB на постоянном origin.'}</p></div><div class="storage-mini"><span>Использовано ${escape(usage)}</span><span>Квота ${escape(quota)}</span></div>${risk||storageStatus.durability==='unknown'?'<button id="retry-storage" type="button">Повторить запрос защиты</button>':''}</section>`;
}
async function refreshStorageStatusV1(requestProtection=false):Promise<void>{
  if(requestProtection)await requestDurableBrowserStorage(navigator.storage);
  storageStatus=await browserStorageStatusV1(navigator.storage);
}
async function retryStorageProtection(button:HTMLButtonElement):Promise<void>{
  button.disabled=true;
  button.textContent='Проверяю…';
  await refreshStorageStatusV1(true);
  if(storageStatus.durability==='durable')notice('Хранилище защищено браузером.',3500);
  renderPanel();
  if(latest)updateSaveState(latest.world);
}
function updateSaveState(w:WorldState):void {
  const el=$('save-state');
  const suffix=storageStatus.durability==='durable'?' · ✓':
    storageStatus.durability==='best_effort'?' · ⚠':'';
  el.textContent='Сохранено · '+number(w.revision)+suffix;
  el.classList.toggle('storage-risk',storageStatus.durability==='best_effort');
  el.title=storageStatus.durability==='best_effort'
    ? 'IndexedDB работает, но браузер не гарантировал защиту от автоматической очистки.'
    : storageStatus.durability==='durable'
      ? 'Браузер подтвердил защищённое постоянное хранилище.'
      : 'Мир сохранён в IndexedDB.';
}
function renderAgentAnalytics(a:AgentState,w:WorldState):string {
  const snapshot=buildAgentAnalyticsV1(w,a.id);
  const body=snapshot.body;
  const brain=snapshot.brain;
  const foundingMentor=assignedFoundingMentorV1(w,a.id);
  const quick=`${cell('Мозг',brain.present?bytes(brain.usedBytes)+' / '+bytes(brain.budgetBytes):'нет')}${cell('Наставник',foundingMentor?.name??'—')}${cell('Ссылки восприятия',brain.referenceCount)}${cell('Гидратация',body.homeostasis?percentOrDash(body.homeostasis.hydration):'—')}${cell('Температура',body.homeostasis?precise(body.homeostasis.coreTemperatureC,2)+' °C':'—')}${cell('Жажда',body.signals?percentOrDash(body.signals.thirst):'—')}${cell('Голод',body.signals?percentOrDash(body.signals.hunger):'—')}`;
  const brainMain=`<div class="metrics">${cell('Фаза',brain.phase)}${cell('Память использована',bytes(brain.usedBytes))}${cell('Осталось',bytes(brain.remainingBytes))}${cell('Загрузка бюджета',percent(brain.usageFraction))}${cell('Записей',brain.dataCount)}${cell('Сообщений',brain.recentMessageCount)}${cell('Последнее восприятие',brain.lastPerceptWorldMinute===undefined?'—':precise(brain.lastPerceptWorldMinute,2))}${cell('Рабочий шаг',brain.workingStep?.phase??'—')}</div>`;
  const relationHtml=snapshot.relationships.items.length?'<div class="analytics-list">'+snapshot.relationships.items.map(r=>{
    const other=r.agentA===a.id?r.agentB:r.agentA;const otherName=w.agents[other]?.name??other;
    return `<div class="analytics-row"><strong>${escape(otherName)}</strong><span>доверие ${escape(percent(r.trust))} · близость ${escape(percent(r.affinity))} · конфликт ${escape(percent(r.conflict))}</span></div>`;
  }).join('')+'</div>':'<p class="muted">Связи ещё не сформированы.</p>';
  return `<section class="live-analytics"><div class="live-snapshot"><span class="live-dot"></span><div><strong>Аналитика в реальном времени</strong><small>${escape(liveStamp(snapshot.worldMinute))}${latest?.speed==='realtime'?' · Минута = минута':''}</small></div></div><div class="metrics analytics-quick">${quick}</div>${details('brain','Мозг · развитие, память, восприятие',brainMain+'<h4>Возрастные возможности</h4><div class="traits">'+objectCells(brain.development)+'</div><h4>Типы личных данных</h4><div class="traits">'+objectCells(brain.dataKinds)+'</div><h4>Личные ссылки</h4><div class="traits">'+objectCells(brain.referenceKinds)+'</div>',true)}${details('signals','Тело · субъективные сигналы','<div class="traits">'+objectCells(body.signals??{})+'</div>',true)}${details('homeostasis','Тело · внутренняя физиология','<div class="traits">'+objectCells(body.homeostasis??{})+'</div>')}${details('body-dev','Тело · развитие и индивидуальные параметры','<h4>Фенотип</h4><div class="traits">'+objectCells(body.phenotype??{})+'</div><h4>Моторика</h4><div class="traits">'+objectCells(body.motorDevelopment)+'</div><h4>Зрение</h4><div class="traits">'+objectCells(body.visionDevelopment)+'</div>')}${details('systems','Органы, травмы и болезни','<div class="traits">'+objectCells(body.systems??{})+'</div><div class="metrics">'+cell('Боль',percentOrDash(body.pain))+cell('Подвижность',percentOrDash(body.mobilityScale))+cell('Восстановление',percentOrDash(body.recoveryScale))+cell('Сон',body.sleep?'Спит до '+precise(body.sleep.wakesAtWorldMinute,2):'Бодрствует')+'</div><h4>Раны</h4><pre class="analytics-pre">'+escape(JSON.stringify(body.wounds,null,2))+'</pre><h4>Болезни</h4><pre class="analytics-pre">'+escape(JSON.stringify(body.diseases,null,2))+'</pre>')}${details('mind','Психика, ценности и навыки','<h4>Эмоции</h4><div class="traits">'+objectCells(snapshot.mind.mind.emotions)+'</div><h4>Ценности</h4><div class="traits">'+objectCells(snapshot.mind.mind.values)+'</div><h4>Убеждения</h4><div class="traits">'+objectCells(snapshot.mind.mind.beliefs)+'</div><h4>Темперамент</h4><div class="traits">'+objectCells(snapshot.mind.personality)+'</div><h4>Навыки</h4><div class="traits">'+objectCells(snapshot.mind.skills)+'</div><h4>Текущая цель / решение</h4><pre class="analytics-pre">'+escape(JSON.stringify({goal:snapshot.mind.goal,lastDecision:snapshot.mind.lastDecision,plan:snapshot.mind.plan},null,2))+'</pre>')}${details('knowledge','Обучение и знания','<div class="metrics">'+cell('Знакомых мест',snapshot.knowledge.knownPlaceCount)+cell('Знакомых подземелий',snapshot.knowledge.knownDungeonCount)+'</div><pre class="analytics-pre">'+escape(JSON.stringify({learning:snapshot.mind.learning,v15:snapshot.knowledge.v15,language:snapshot.knowledge.language,livelihood:snapshot.knowledge.livelihood,applied:snapshot.knowledge.applied},null,2))+'</pre>')}${details('relations','Семья и отношения','<div class="metrics">'+cell('Родители',snapshot.life.parentIds.length)+cell('Дети',snapshot.life.childIds.length)+cell('Отношения',snapshot.relationships.count)+cell('Поколение',snapshot.identity.generation)+'</div>'+relationHtml)}${details('technical','Технический срез этой Искры','<pre class="analytics-pre">'+escape(JSON.stringify(snapshot,null,2))+'</pre>')}</section>`;
}
function renderPanel():void {
  const w=latest?.world;if(!w)return;
  document.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach(b=>b.setAttribute('aria-selected',String(b.dataset.tab===mode)));
  const panel=$('panel');
  const previousScroll=panel.scrollTop;
  const openDetails=new Set(Array.from(panel.querySelectorAll<HTMLDetailsElement>('details[open][data-detail]')).map(d=>d.dataset.detail!));
  if(mode==='people'){
    const a=selected.type==='agent'?w.agents[selected.id]:undefined;
    let html='';
    if(a){
      const body=w.v21?.bodiesByAgentId[a.id];
      const evidence=w.v16?.residentEvidenceByAgentId[a.id];
      const livelihood=w.v18?.livelihoodByAgentId[a.id];
      html=`<section class="resident-detail"><div class="detail-heading"><div><span class="eyebrow">${a.sex==='male'?'МУЖЧИНА':'ЖЕНЩИНА'} · ${precise(a.life.ageYears,2)} лет</span><h2>${escape(a.name)}</h2></div><button id="follow" aria-label="Найти жителя на карте">⌖</button></div><p class="activity">${escape(activity(a,w))} · ${escape(w.places[a.locationId]?.name??a.locationId)}</p><span class="job">${escape(jobs[livelihood?.primary??'undecided']??'Развивает своё дело')}</span><div class="metrics">${cell('Здоровье',percent(a.life.health))}${cell('Энергия',percent(a.energy))}${cell('Стресс',percent(a.stress))}${cell('Действий',evidence?.recordedDecisionCount??0)}${cell('Раны / болезни',`${body?.wounds.length??0} / ${body?.diseases.length??0}`)}${cell('Ревизия мира',w.revision)}</div>${renderAgentAnalytics(a,w)}</section>`;
    } else {
      html='<p class="panel-intro">Нажмите на Искру. Здесь появится живой аналитический срез её мозга, тела, ощущений, памяти, навыков и текущего состояния.</p>';
    }
    html+='<div class="resident-list">'+Object.values(w.agents).filter(a=>a.life.alive).map(a=>`<button class="resident-card ${selected.type==='agent'&&selected.id===a.id?'active':''}" data-person="${escape(a.id)}"><span class="avatar">${escape(a.name.charAt(0))}</span><span><strong>${escape(a.name)}</strong><small>${number(Math.floor(a.life.ageYears))} лет · ${escape(activity(a,w))}</small></span><span class="arrow">›</span></button>`).join('')+'</div>';
    panel.innerHTML=html;
    panel.querySelectorAll<HTMLButtonElement>('[data-person]').forEach(b=>b.onclick=()=>selectAgent(b.dataset.person!));
    const follow=panel.querySelector<HTMLButtonElement>('#follow');
    if(follow)follow.onclick=()=>{if(a){camera.x=a.position.x;camera.y=a.position.y;requestRender();}};
  } else if(mode==='place'){
    const place=w.places[selected.type==='place'?selected.id:'commons']??w.places.commons;
    const town=w.settlements[place.settlementId??'settlement_ainkrad'];
    const people=Object.values(w.agents).filter(a=>a.life.alive&&a.locationId===place.id);
    const wildlife=Object.values(w.wildlife).filter(a=>a.habitatId===place.id);
    panel.innerHTML=`<span class="eyebrow">${place.kind==='library'?'БИБЛИОТЕКА':'ФИЗИЧЕСКОЕ МЕСТО'}</span><h2>${escape(place.name)}</h2><p class="panel-intro">${escape(town?.name??'За пределами поселения')}</p><div class="metrics">${cell('Жители здесь',people.length)}${cell('Связанные места',place.connectedPlaceIds.length)}${cell('Плодородие',percent(place.fertility))}${cell('Дома в мире',Object.values(w.places).filter(p=>p.kind==='home').length)}</div><h3>Поселения</h3><div class="town-list">${Object.values(w.settlements).map(t=>`<button data-town="${escape(t.id)}">${escape(t.name)} <span>⌖</span></button>`).join('')}</div><h3>Животный мир</h3><p class="muted">${wildlife.length?wildlife.map(a=>escape(({rabbit:'Кролики',deer:'Олени',bird:'Птицы',fish:'Рыба',boar:'Кабаны',wolf:'Волки'} as Record<string,string>)[a.species]??a.species)+': '+number(a.count)).join(' · '):'В этой локации популяции не зарегистрированы.'}</p><h3>Карта</h3><p class="muted">Масштаб меняет только отображение. Люди продолжают жить за пределами экрана.</p>`;
    panel.querySelectorAll<HTMLButtonElement>('[data-town]').forEach(b=>b.onclick=()=>{const t=w.settlements[b.dataset.town!];selected={type:'place',id:t.centerPlaceId};camera.x=t.centerX;camera.y=t.centerY;renderPanel();requestRender();});
  } else {
    const active=Object.values(w.agents).filter(a=>a.life.alive);
    panel.innerHTML=`<span class="eyebrow">ЖИВОЙ МИР</span><h2>Состояние сборки</h2><div class="metrics">${cell('Люди',active.length)}${cell('Поселения',Object.keys(w.settlements).length)}${cell('Локации',Object.keys(w.places).length)}${cell('Ревизия',w.revision)}${cell('Дороги',Object.keys(w.routes).length)}${cell('Эпоха',w.epoch??1)}</div><p class="ok-line">Автономный движок · конечный BrainState · BodyCore · личное восприятие</p>${w.iskorkaMentorsV1?'<section class="storage-card"><div><span class="eyebrow">НАСТАВНИКИ ОСНОВАНИЯ</span><strong>'+escape(w.iskorkaMentorsV1.active?'5 наставников активны':'Наставники ушли')+'</strong><p>Уроков '+number(w.iskorkaMentorsV1.totalLessons)+' · действий ухода '+number(w.iskorkaMentorsV1.totalCareActions)+' · кормлений '+number(w.iskorkaMentorsV1.totalMeals)+'</p></div></section>':''}${storagePanelHtml()}<h3>Ключ мира</h3><code class="seed-code">${escape(w.bootstrapSeed)}</code><h3>Сохранение</h3><p class="muted">${escape(ISKORKA_DATABASE)}<br>${escape(ISKORKA_WORLD_ID)}<br>Мир хранится в IndexedDB на постоянном адресе. Если браузер не выдаёт режим durable, сохранение всё равно работает, но браузер/ОС теоретически могут очистить данные сайта при нехватке места.</p><h3>Время</h3><p class="muted">При «Минута = минута» аналитический экран показывает последний полученный срез мира с точной мировой минутой. На ускорениях экран остаётся наблюдателем и не влияет на причинность.</p>`;
    const retry=panel.querySelector<HTMLButtonElement>('#retry-storage');
    if(retry)retry.onclick=()=>void retryStorageProtection(retry);
  }
  panel.querySelectorAll<HTMLDetailsElement>('details[data-detail]').forEach(d=>{if(openDetails.has(d.dataset.detail!))d.open=true;});
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
  updateSaveState(w);
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
  await requestDurableBrowserStorage(navigator.storage);
  storageStatus=await browserStorageStatusV1(navigator.storage);
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
