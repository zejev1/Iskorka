import {TERRAIN_BOUNDS} from './world/geography/TerrainTypes';
import { MapInteraction } from './presentation/MapInteraction';
import { installWorldMapGestures } from './presentation/WorldMapGestures';
import { installObserverChrome } from './presentation/ObserverChrome';
import { WorldAtlasRenderer } from './presentation/WorldAtlasRenderer';
import { atlasLevel } from './presentation/WorldAtlasIndex';
import { physicalPlaceDrawing, applyPhysicalPlaceStyle, visibleMapLabels } from './presentation/MapPlacePresentation';
import { WorldClockPanel } from './presentation/WorldClockPanel';
import { worldStorageDiagnostics } from './persistence/WorldSaveSafety';
import { createSettlementPicker } from './presentation/SettlementPicker';
import { WorldMapCamera, MAX_VISIBLE_RESIDENTS } from './presentation/WorldMapCamera';
import { mapDetail, mapScaleBar, mapEntityDepth } from './presentation/WorldMapVisuals';
import { residentLearningSummary } from './presentation/ResidentLearningView';
import { townMapFocus, residentMapFocus, settlementMapFocus } from './presentation/WorldMapFocus';
import { createWorldMapProjection } from './presentation/WorldMapProjection';
import './browser.css';
import './presentation/world-map-visuals.css';
import './presentation/world-atlas.css';
import type {
  LiveWorldFrame,
} from './runtime/LiveWorldRuntime';
import {
  parseOfflineWorldClockAnchor,
  type OfflineWorldClockAnchor,
} from './runtime/OfflineWorldClock';
import type { WorldEvent } from './world/events';
import {
  ageParts,
  DEFAULT_WORLD_SPEED_ID,
  DEFAULT_WORLD_SPEED_MULTIPLIER,
  isMaximumAccelerationSpeed,
  isWorldSpeedId,
  isWorldSpeedMultiplier,
  WORLD_MINUTES_PER_YEAR,
  WORLD_SPEED_PRESETS,
  worldCalendarAtMinutes,
  worldSpeedPreset,
  type WorldSpeedId,
  type WorldSpeedMultiplier,
} from './world/WorldClock';
import type {
  AgentActionKind,
  AgentState,
  DivineContactKind,
  DivineGiftKind,
  DivineBurdenKind,
  RelationshipState,
  WildlifeSpecies,
  WorldPlaceKind,
  WorldState,
} from './world/types';
import type {
  V19AdventureAbility,
  V19AdventureRank,
  V19DivineInterpretation,
  V19PrayerRecord,
  V19PrayerTopic,
} from './v19/types';
import { projectedResidentPosition } from './presentation/ResidentMotionProjection';
import {
  inspectPlaceV16,
  inspectResidentV16,
  inspectWildlifeV16,
  type TruthfulInspectorReportV16,
} from './v16/TruthfulInspectorsV16';
import { formatWorldTime as formatAinkradWorldTime } from './presentation/WorldTimeFormat';
import { worldDurationDescription } from './v15/WorldTimeContract';
import { residentDecisionReflection } from './world/ResidentDecisionReflection';
import { worldWeatherV21 } from './v21/WeatherV21';
import type {
  V18LivelihoodKind,
  V18LivelihoodStage,
} from './v18/types';

const app = document.querySelector<HTMLDivElement>('#app');

if (!app) {
  throw new Error('Ainkrad browser root not found.');
}

const actionLabels: Record<AgentActionKind, string> = {
  rest: 'отдыхает',
  relax: 'отдыхает на природе',
  walk: 'гуляет',
  gather: 'собирает ресурсы',
  hunt: 'охотится',
  work: 'работает',
  socialize: 'общается',
  help: 'помогает',
  explore: 'исследует мир',
  reflect: 'размышляет',
  bond: 'строит близость',
  pray: 'ищет высший смысл',
};

const actionIcons: Record<AgentActionKind, string> = {
  rest: '☾',
  relax: '☀',
  walk: '↝',
  gather: '✦',
  hunt: '➶',
  work: '⚒',
  socialize: '●●',
  help: '♥',
  explore: '⌁',
  reflect: '…',
  bond: '∞',
  pray: '✧',
};

const livelihoodLabels: Readonly<Record<V18LivelihoodKind, string>> = {
  undecided: 'дело жизни ещё не выбрано',
  farmer: 'земледелец',
  forager: 'собиратель',
  woodcutter: 'лесоруб',
  miner: 'рудокоп',
  fisher: 'рыбак',
  hunter: 'охотник',
  artisan: 'ремесленник',
  smith: 'кузнец',
  builder: 'строитель',
  caregiver: 'попечитель',
  scout: 'разведчик',
  cartographer: 'картограф',
  adventurer: 'искатель приключений',
  warrior: 'воин',
  teacher: 'наставник',
  scribe: 'писец',
  guard: 'страж',
  spiritual_keeper: 'хранитель традиций',
};

const livelihoodStageLabels: Readonly<Record<V18LivelihoodStage, string>> = {
  observing: 'наблюдает',
  apprentice: 'ученик',
  practitioner: 'опытный',
  master: 'мастер',
};

const adventureRankLabels: Readonly<Record<V19AdventureRank, string>> = {
  unranked: 'без ранга',
  F: 'F',
  E: 'E',
  D: 'D',
  C: 'C',
  B: 'B',
  A: 'A',
  S: 'S',
};

const adventureAbilityLabels: Readonly<Record<V19AdventureAbility, string>> = {
  guardian_stance: 'стойка защитника',
  pathfinder: 'следопыт',
  keen_edge: 'точный удар',
  rapid_recovery: 'быстрое восстановление',
  mana_sense: 'чувство маны',
  treasure_appraisal: 'оценка сокровищ',
};

const goalLabels: Record<AgentState['goal']['kind'], string> = {
  recover: 'восстановиться',
  secure_resources: 'обеспечить себя',
  connect: 'найти общение',
  contribute: 'быть полезным',
  explore: 'узнать новое',
  reflect: 'разобраться в себе',
  build_family: 'создать семью',
  seek_truth: 'понять тайны мира',
};

const traitLabels: Record<keyof AgentState['personality'], string> = {
  sociability: 'общительный',
  diligence: 'деятельный',
  curiosity: 'любознательный',
  generosity: 'отзывчивый',
  resilience: 'стойкий',
  riskTolerance: 'смелый',
};

const skillLabels: Record<keyof AgentState['skills'], string> = {
  gathering: 'сбор',
  hunting: 'охота',
  craft: 'ремесло',
  social: 'общение',
  exploration: 'исследование',
};

const raceLabels: Record<NonNullable<AgentState['race']>, string> = {
  human: 'человек',
  elf: 'эльф',
  dwarf: 'гном',
  goblin: 'гоблин',
  orc: 'орк',
  ogre: 'огр',
};

const raceGroupLabels: Record<NonNullable<AgentState['race']>, string> = {
  human: 'Люди',
  elf: 'Эльфы',
  dwarf: 'Гномы',
  goblin: 'Гоблины',
  orc: 'Орки',
  ogre: 'Огры',
};

const raceGroupMarkers: Record<NonNullable<AgentState['race']>, string> = {
  human: '🟨',
  elf: '🟩',
  dwarf: '🟧',
  goblin: '🟪',
  orc: '🟥',
  ogre: '🟦',
};

interface MapPoint {
  x: number;
  y: number;
  label: string;
  symbol: string;
}

const publicPlacePoints: Record<string, MapPoint> = {
  commons: { x: 50, y: 48, label: 'Общая площадь', symbol: '◆' },
  resource_field: { x: 16, y: 23, label: 'Поле', symbol: '✦' },
  workshop: { x: 83, y: 25, label: 'Мастерская', symbol: '⚒' },
  quiet_space: { x: 18, y: 75, label: 'Тихий сад', symbol: '♣' },
  outskirts: { x: 82, y: 76, label: 'Окраина', symbol: '▲' },
  meadow: { x: 8, y: 13, label: 'Дикий луг', symbol: '❀' },
  forest: { x: 50, y: 12, label: 'Северный лес', symbol: '♠' },
  shore: { x: 92, y: 88, label: 'Берег моря', symbol: '≈' },
};

const wildlifeLabels: Record<WildlifeSpecies, string> = {
  rabbit: 'Кролики',
  deer: 'Олени',
  fish: 'Рыба',
  boar: 'Кабаны',
  wolf: 'Волки',
  bird: 'Птицы',
  dire_wolf: 'Лютоволки',
  ogre: 'Огры',
  wraith: 'Тени',
  century_humpback: 'Столетний горбатник',
};

const wildlifeIcons: Record<WildlifeSpecies, string> = {
  rabbit: '🐇',
  deer: '🦌',
  fish: '🐟',
  boar: '🐗',
  wolf: '🐺',
  bird: '🐦',
  dire_wolf: '🐺',
  ogre: '👹',
  wraith: '👻',
  century_humpback: '🪰',
};

const emotionLabels: Record<keyof AgentState['mind']['emotions'], string> = {
  joy: 'радость',
  fear: 'страх',
  grief: 'горе',
  awe: 'трепет',
  hope: 'надежда',
};

const phaseLabels = {
  dawn: 'Рассвет',
  day: 'День',
  evening: 'Вечер',
  night: 'Ночь',
} as const;

const seasonLabels = {
  spring: 'Весна',
  summer: 'Лето',
  autumn: 'Осень',
  winter: 'Зима',
} as const;

const homePoints: readonly MapPoint[] = [
  { x: 7, y: 49, label: 'Дом Алексея', symbol: '⌂' },
  { x: 30, y: 8, label: 'Дом Миры', symbol: '⌂' },
  { x: 69, y: 8, label: 'Дом Кая', symbol: '⌂' },
  { x: 93, y: 49, label: 'Дом Ноа', symbol: '⌂' },
  { x: 70, y: 92, label: 'Дом Илана', symbol: '⌂' },
  { x: 30, y: 92, label: 'Дом Рина', symbol: '⌂' },
];

app.innerHTML = `
  <div class="ainkrad-app">
    <header class="world-header">
      <div>
        <p class="eyebrow">Искорка · 0.1.0</p>
        <h1 id="world-title">Мир · уровень 1</h1>
      </div>

      <div class="live-indicator" id="live-indicator">
        <span class="live-dot" aria-hidden="true"></span>
        <span id="live-label">ВОССТАНОВЛЕНИЕ</span>
      </div>
    </header>

    <div class="status-strip" aria-label="Состояние мира">
      <span>Возраст <strong id="tick-value">0 дней</strong></span>
      <span>Календарь <strong id="time-value">Год 1 · день 1</strong></span>
      <span>Мир <strong id="world-level-value">ур. 1</strong></span>
      <span>Искр <strong id="population-value">10</strong></span>
      <span>Карта <strong id="growth-value">5 мест</strong></span>
      <span>Животные <strong id="wildlife-value">0</strong></span>
      <span>Ресурсы <strong id="resource-value">—</strong></span>
      <span class="save-state">Состояние <strong id="save-value">Загрузка…</strong></span>
      <details><summary>Данные сохранения</summary><pre id="world-storage-details" style="white-space:pre-wrap;overflow-wrap:anywhere"></pre></details>
    </div>

    <section class="external-clock" aria-label="Внешнее управление скоростью мира">
      <div>
        <span class="external-clock__label">СКОРОСТЬ ВРЕМЕНИ</span>
        <strong id="clock-rate-value">1 мин = 1 год</strong>
      </div>
      <label>
        <span class="sr-only">Базовая скорость мира</span>
        <select id="world-speed-select">
          ${WORLD_SPEED_PRESETS.map(
            (preset) =>
              `<option value="${preset.id}"${preset.id === DEFAULT_WORLD_SPEED_ID ? ' selected' : ''}>${preset.shortLabel}</option>`,
          ).join('')}
        </select>
      </label>
      <small id="live-clock-throughput" aria-live="polite">Измеряем скорость мира…</small>
      <small id="offline-clock-status">Загрузка времени мира…</small>
    </section>

    <section class="maximum-acceleration-mode" id="maximum-acceleration-mode" hidden>
      <strong>Максимальное ускорение</strong>
      <p>Карта и подробные панели остановлены. Искры продолжают проживать все шаги мира; управление скоростью остаётся доступно выше.</p>
    </section>

    <section class="catch-up-overlay" id="catch-up-overlay" aria-live="assertive" hidden>
      <div class="catch-up-overlay__heading">
        <div>
          <span>ПРОДОЛЖЕНИЕ МИРА</span>
          <strong id="catch-up-title">Подготавливаем быстрый догон…</strong>
        </div>
        <b id="catch-up-percent">0%</b>
      </div>
      <div class="catch-up-track"><span id="catch-up-bar"></span></div>
      <p id="catch-up-detail">Продолжаем с сохранённого момента.</p>
    </section>

    <main class="world-layout">
      <section class="world-map-shell" aria-label="Растущая карта Ainkrad">
        <div class="map-toolbar">
          <strong id="map-scale-value">Уровень мира 1 · 11 локаций</strong>
          <div class="map-toolbar__controls">
            <span id="map-time-value">Рассвет · Весна</span>
            <button id="map-zoom-out" type="button" aria-label="Уменьшить карту">−</button>
            <button id="map-zoom-fit" type="button" aria-label="Показать всю карту">100%</button>
            <span id="settlement-picker"></span>
            <button id="map-city-focus" type="button">Город</button>
            <button id="map-resident-focus" type="button" aria-label="Найти выбранную Искру на карте">Искра</button>
          <button id="map-zoom-in" type="button" aria-label="Увеличить карту">+</button>
            <button id="text-scale" type="button" aria-label="Увеличить размер текста">Текст 115%</button>
          </div>
        </div>
        <div class="world-map-viewport" id="world-map-viewport">
          <div class="world-map-stage" id="world-map-stage">
          <section class="world-map" id="world-map" aria-label="Карта Искорки">
            <div class="map-sky" aria-hidden="true"></div>
            <div class="map-grid" aria-hidden="true"></div>
            <div class="terrain terrain--water growth-terrain growth-terrain--3" aria-hidden="true"></div>
            <div class="terrain terrain--grove-one growth-terrain growth-terrain--2" aria-hidden="true"></div>
            <div class="terrain terrain--grove-two growth-terrain growth-terrain--1" aria-hidden="true"></div>
            <div id="biomes-layer" class="biomes-layer" aria-hidden="true"></div>

            <svg
              class="roads"
              id="roads-layer"
              viewBox="0 0 100 100"
              preserveAspectRatio="none"
              aria-hidden="true"
            ></svg>

            <div id="settlements-layer" class="settlements-layer"></div>
            <div id="places-layer" class="places-layer"></div>
            <div id="wildlife-layer" class="wildlife-layer"></div>
            <div id="agents-layer" class="agents-layer"></div>

            <div class="map-hint" id="map-hint">Проведите по карте</div>
            <div class="map-distance" id="map-distance" aria-label="Линейка масштаба"><span></span><b></b></div>

            <div
              class="disturbance-banner"
              id="disturbance-banner"
              aria-live="polite"
            ></div>
          </section>
          </div>
        </div>
      </section>

      <aside class="world-sidebar">
        <section class="resident-panel" aria-live="polite">
          <div class="panel-heading-row">
            <p class="panel-label" title="Искры — искусственные разумные обитатели мира всех народов">Выбранная Искра</p>
            <p class="muted">Искры — искусственные разумные обитатели мира.</p>
            <span class="autonomy-mark">САМ РЕШАЕТ</span>
          </div>

          <label class="resident-picker-label" for="resident-picker">
            <span>Найти конкретную Искру</span>
            <input id="resident-search" type="search" placeholder="Имя Искры" autocomplete="off" />
            <select id="resident-picker" aria-label="Выбрать Искру"></select>
          </label>

          <div class="resident-title-row">
            <div class="resident-portrait" id="resident-portrait" aria-hidden="true">A</div>
            <div>
              <h2 id="resident-name">Мир запускается…</h2>
              <p id="resident-activity" class="resident-activity">Подготавливаем Искр</p>
            </div>
          </div>

          <dl class="resident-facts">
            <div><dt>Место</dt><dd id="resident-place">—</dd></div>
            <div><dt>Цель</dt><dd id="resident-goal">—</dd></div>
            <div><dt>Жизнь</dt><dd id="resident-life">—</dd></div>
            <div><dt>Чувства</dt><dd id="resident-emotion">—</dd></div>
            <div><dt>Тело</dt><dd id="resident-physiology">—</dd></div>
            <div><dt>Характер</dt><dd id="resident-traits">—</dd></div>
            <div><dt>Дело жизни</dt><dd id="resident-profession">—</dd></div>
            <div><dt>Сильный навык</dt><dd id="resident-skill">—</dd></div>
            <div><dt>Мысль</dt><dd id="resident-choice">—</dd></div>
            <div><dt>Личный опыт</dt><dd id="resident-learning">—</dd></div>
          </dl>

          <div class="need-row">
            <span>Энергия</span><span id="energy-value">—</span>
            <div class="need-track"><span id="energy-bar"></span></div>
          </div>
          <div class="need-row">
            <span>Стресс</span><span id="stress-value">—</span>
            <div class="need-track need-track--stress"><span id="stress-bar"></span></div>
          </div>
          <div class="need-row">
            <span>Личные ресурсы</span><span id="personal-resource-value">—</span>
            <div class="need-track need-track--resources"><span id="personal-resource-bar"></span></div>
          </div>
          <div class="need-row need-row--compact">
            <span>Сытость</span><span id="satiety-value">—</span>
            <div class="need-track need-track--satiety"><span id="satiety-bar"></span></div>
          </div>
          <div class="need-row need-row--compact">
            <span>Принадлежность</span><span id="belonging-value">—</span>
            <div class="need-track need-track--belonging"><span id="belonging-bar"></span></div>
          </div>
          <div class="need-row need-row--compact">
            <span>Смысл</span><span id="purpose-value">—</span>
            <div class="need-track need-track--purpose"><span id="purpose-bar"></span></div>
          </div>

          <p class="relationship-note" id="relationship-note">Связи ещё формируются.</p>
          <button class="resident-details-open" id="resident-details-open" type="button">
            Родословная, навыки и реальная жизнь
          </button>

        </section>



        <section class="event-panel">
          <div class="panel-heading-row">
            <p class="panel-label">Жизнь мира</p>
            <span class="event-live">СЕЙЧАС</span>
          </div>
          <ol class="event-feed" id="event-feed">
            <li>Мир вспоминает свою историю…</li>
          </ol>
          <div class="conversation-window" aria-live="polite">
            <strong>Подслушано в мире</strong>
            <div id="conversation-feed">Пока рядом не слышно разговора.</div>
          </div>

        </section>

        <p id="world-message" role="status">Искорка · физический мир</p>
      </aside>
    </main>
    <details class="world-maintenance"><summary>Управление сохранённым миром</summary>
      <p>Обновления продолжают существующий мир. Создание нового завершит текущую эпоху.</p>
      <button id="reset-world" type="button" aria-label="Создать новый мир Искорки">Новый мир</button>
    </details>
    <div class="world-inspector" id="world-inspector" hidden>
      <section class="world-inspector__sheet" role="dialog" aria-modal="true" aria-labelledby="world-inspector-title">
        <header>
          <div>
            <p class="world-inspector__badge" id="world-inspector-badge">ОБЪЕКТ МИРА</p>
            <h2 id="world-inspector-title">Подробности</h2>
            <p id="world-inspector-subtitle"></p>
          </div>
          <button id="world-inspector-close" type="button" aria-label="Закрыть подробности">×</button>
        </header>
        <div class="world-inspector__content" id="world-inspector-content"></div>
        <p class="world-inspector__evidence" id="world-inspector-evidence"></p>
      </section>
    </div>
  </div>
`;

const observerChrome = installObserverChrome(app);

const requiredElement = <T extends Element>(id: string): T => {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing browser element #${id}.`);
  return element as unknown as T;
};

const settlementPicker = createSettlementPicker(requiredElement<HTMLElement>('settlement-picker'), id => {
  if (!lastFrame) return;
  const focus = settlementMapFocus(lastFrame.world, id, mapCamera.width, mapCamera.height);
  if (focus) { mapCamera.x = focus.x; mapCamera.y = focus.y; setMapZoom(focus.pixelsPerUnit / 100); }
});
const worldMap = requiredElement<HTMLElement>('world-map');
const worldMapStage = requiredElement<HTMLElement>('world-map-stage');
const worldMapViewport = requiredElement<HTMLElement>('world-map-viewport');
const roadsLayer = requiredElement<SVGSVGElement>('roads-layer');
const settlementsLayer = requiredElement<HTMLDivElement>('settlements-layer');
const mapZoomOut = requiredElement<HTMLButtonElement>('map-zoom-out');
const mapZoomFit = requiredElement<HTMLButtonElement>('map-zoom-fit');
const mapZoomIn = requiredElement<HTMLButtonElement>('map-zoom-in');
const textScaleButton = requiredElement<HTMLButtonElement>('text-scale');
const worldTitle = requiredElement<HTMLElement>('world-title');
const worldLevelValue = requiredElement<HTMLElement>('world-level-value');
const mapScaleValue = requiredElement<HTMLElement>('map-scale-value');
const mapTimeValue = requiredElement<HTMLElement>('map-time-value');
const mapHint = requiredElement<HTMLElement>('map-hint');
const placesLayer = requiredElement<HTMLDivElement>('places-layer');
const biomesLayer = requiredElement<HTMLDivElement>('biomes-layer');
const wildlifeLayer = requiredElement<HTMLDivElement>('wildlife-layer');
const agentsLayer = requiredElement<HTMLDivElement>('agents-layer');
const atlas = new WorldAtlasRenderer(biomesLayer, roadsLayer, settlementsLayer);
const tickValue = requiredElement<HTMLElement>('tick-value');
const timeValue = requiredElement<HTMLElement>('time-value');
const populationValue = requiredElement<HTMLElement>('population-value');
const growthValue = requiredElement<HTMLElement>('growth-value');
const wildlifeValue = requiredElement<HTMLElement>('wildlife-value');
const resourceValue = requiredElement<HTMLElement>('resource-value');
const saveValue = requiredElement<HTMLElement>('save-value');
const worldSpeedSelect = requiredElement<HTMLSelectElement>('world-speed-select');
const resetWorldButton = requiredElement<HTMLButtonElement>('reset-world');
const clockRateValue = requiredElement<HTMLElement>('clock-rate-value');
const offlineClockStatus = requiredElement<HTMLElement>('offline-clock-status');
const liveClockThroughput = requiredElement<HTMLElement>('live-clock-throughput');
const catchUpOverlay = requiredElement<HTMLElement>('catch-up-overlay');
const maximumAccelerationMode = requiredElement<HTMLElement>('maximum-acceleration-mode');
const resolvedAppShell = app.querySelector<HTMLElement>('.ainkrad-app');
if (!resolvedAppShell) throw new Error('Ainkrad application shell was not created.');
const appShell: HTMLElement = resolvedAppShell;
const catchUpTitle = requiredElement<HTMLElement>('catch-up-title');
const catchUpPercent = requiredElement<HTMLElement>('catch-up-percent');
const catchUpBar = requiredElement<HTMLElement>('catch-up-bar');
const catchUpDetail = requiredElement<HTMLElement>('catch-up-detail');
const liveIndicator = requiredElement<HTMLElement>('live-indicator');
const liveLabel = requiredElement<HTMLElement>('live-label');
const disturbanceBanner = requiredElement<HTMLElement>('disturbance-banner');
const residentPortrait = requiredElement<HTMLElement>('resident-portrait');
const residentPicker = requiredElement<HTMLSelectElement>('resident-picker');
const residentSearch = requiredElement<HTMLInputElement>('resident-search');
const residentName = requiredElement<HTMLElement>('resident-name');
const residentActivity = requiredElement<HTMLElement>('resident-activity');
const residentPlace = requiredElement<HTMLElement>('resident-place');
const residentGoal = requiredElement<HTMLElement>('resident-goal');
const residentLife = requiredElement<HTMLElement>('resident-life');
const residentEmotion = requiredElement<HTMLElement>('resident-emotion');
const residentPhysiology = requiredElement<HTMLElement>('resident-physiology');
const residentTraits = requiredElement<HTMLElement>('resident-traits');
const residentProfession = requiredElement<HTMLElement>('resident-profession');
const residentSkill = requiredElement<HTMLElement>('resident-skill');
const residentChoice = requiredElement<HTMLElement>('resident-choice');
const residentLearning = requiredElement<HTMLElement>('resident-learning');
const mapDistance = requiredElement<HTMLElement>('map-distance');
const relationshipNote = requiredElement<HTMLElement>('relationship-note');
const residentDetailsOpen = requiredElement<HTMLButtonElement>('resident-details-open');
const eventFeed = requiredElement<HTMLOListElement>('event-feed');
const conversationFeed = requiredElement<HTMLElement>('conversation-feed');
const energyValue = requiredElement<HTMLElement>('energy-value');
const energyBar = requiredElement<HTMLElement>('energy-bar');
const stressValue = requiredElement<HTMLElement>('stress-value');
const stressBar = requiredElement<HTMLElement>('stress-bar');
const personalResourceValue = requiredElement<HTMLElement>('personal-resource-value');
const personalResourceBar = requiredElement<HTMLElement>('personal-resource-bar');
const satietyValue = requiredElement<HTMLElement>('satiety-value');
const satietyBar = requiredElement<HTMLElement>('satiety-bar');
const belongingValue = requiredElement<HTMLElement>('belonging-value');
const belongingBar = requiredElement<HTMLElement>('belonging-bar');
const purposeValue = requiredElement<HTMLElement>('purpose-value');
const purposeBar = requiredElement<HTMLElement>('purpose-bar');
const worldMessage = requiredElement<HTMLElement>('world-message');
const worldInspector = requiredElement<HTMLElement>('world-inspector');
const worldInspectorClose = requiredElement<HTMLButtonElement>('world-inspector-close');
const worldInspectorBadge = requiredElement<HTMLElement>('world-inspector-badge');
const worldInspectorTitle = requiredElement<HTMLElement>('world-inspector-title');
const worldInspectorSubtitle = requiredElement<HTMLElement>('world-inspector-subtitle');
const worldInspectorContent = requiredElement<HTMLElement>('world-inspector-content');
const worldInspectorEvidence = requiredElement<HTMLElement>('world-inspector-evidence');

const avatarElements = new Map<string, HTMLButtonElement>();
const placeElements = new Map<string, HTMLElement>();
const biomeElements = new Map<string, HTMLElement>();
const wildlifeElements = new Map<string, HTMLElement>();
const settlementElements = new Map<string, HTMLElement>();

let selectedAgentId: string | undefined;
let residentPickerSignature = '';
let residentSearchQuery = '';
let lastFrame: LiveWorldFrame | undefined;
let maximumSpeedPresentation = false;
let catchUpPresentation = false;
let headlessAccelerationActive = false;
let continuityAnnounced = false;
let renderedGrowthStage = -1;
const mapCamera = new WorldMapCamera();
let mapZoom = mapCamera.pixelsPerUnit / 100;
let highlightedPlaceIds = new Set<string>();
let inspectedEntity:
  | { kind: 'resident' | 'wildlife' | 'place'; id: string }
  | undefined;

const CLOCK_PREFERENCE_KEY = 'iskorka-v0.1.external-clock';
const OFFLINE_CLOCK_ANCHOR_KEY = 'iskorka-v0.1.offline-clock-anchor';
const TEXT_SCALE_KEY = 'iskorka-v0.1.text-scale';
const TEXT_SCALE_STEPS = [1, 1.15, 1.3] as const;
let preferredSpeedId: WorldSpeedId = DEFAULT_WORLD_SPEED_ID;
let preferredSpeedMultiplier: WorldSpeedMultiplier =
  DEFAULT_WORLD_SPEED_MULTIPLIER;
let pendingOfflineClockAnchor: OfflineWorldClockAnchor | undefined;
let offlineClockStorageAvailable = true;
let textScale: (typeof TEXT_SCALE_STEPS)[number] = 1.15;

try {
  const stored = JSON.parse(
    localStorage.getItem(CLOCK_PREFERENCE_KEY) ?? 'null',
  ) as { speedId?: unknown; multiplier?: unknown } | null;
  if (stored && isWorldSpeedId(stored.speedId)) {
    preferredSpeedId =
      stored.speedId === 'fifty_years_per_minute' || stored.speedId === 'century_per_minute'
        ? 'decade_per_minute'
        : stored.speedId;
  }
  if (stored && isWorldSpeedMultiplier(stored.multiplier)) preferredSpeedMultiplier = 1;
} catch {
  // A blocked localStorage only means the external speed resets on next visit.
}
maximumSpeedPresentation = isMaximumAccelerationSpeed(preferredSpeedId);

try {
  pendingOfflineClockAnchor = parseOfflineWorldClockAnchor(
    localStorage.getItem(OFFLINE_CLOCK_ANCHOR_KEY),
  );
} catch {
  offlineClockStorageAvailable = false;
}

try {
  const storedTextScale = Number(localStorage.getItem(TEXT_SCALE_KEY));
  if (
    TEXT_SCALE_STEPS.includes(
      storedTextScale as (typeof TEXT_SCALE_STEPS)[number],
    )
  ) {
    textScale = storedTextScale as (typeof TEXT_SCALE_STEPS)[number];
  }
} catch {
  // Readability still has a useful mobile-first default without storage.
}

function applyTextScale(): void {
  document.documentElement.style.fontSize = `${16 * textScale}px`;
  textScaleButton.textContent = `Текст ${Math.round(textScale * 100)}%`;
}

applyTextScale();

function applyHeadlessAccelerationPresentation(): void {
  headlessAccelerationActive = maximumSpeedPresentation || catchUpPresentation;
  appShell.classList.toggle('is-headless-acceleration', headlessAccelerationActive);
  maximumAccelerationMode.hidden = !maximumSpeedPresentation;
}

applyHeadlessAccelerationPresentation();

function clockRateLabel(
  speedId: WorldSpeedId,
  multiplier: WorldSpeedMultiplier,
): string {
  const minutes =
    worldSpeedPreset(speedId).worldMinutesPerRealMinute * multiplier;
  if (minutes >= WORLD_MINUTES_PER_YEAR) {
    const years = minutes / WORLD_MINUTES_PER_YEAR;
    return `Цель: 1 мин ≈ ${Number.isInteger(years) ? years : years.toFixed(1)} ${years === 1 ? 'год' : 'лет'}`;
  }
  if (minutes >= 43_200) return `1 мин = ${Math.round(minutes / 43_200)} мес`;
  if (minutes >= 1_440) return `1 мин = ${Math.round(minutes / 1_440)} дн`;
  if (minutes >= 60) return `1 мин = ${Math.round(minutes / 60)} ч`;
  return `1 мин = ${Math.round(minutes)} мин`;
}

function showClockControl(
  speedId: WorldSpeedId,
  multiplier: WorldSpeedMultiplier,
): void {
  worldSpeedSelect.value = speedId;
  clockRateValue.textContent = clockRateLabel(speedId, multiplier);
}

showClockControl(preferredSpeedId, preferredSpeedMultiplier);

const regionNameTranslations: Record<string, string> = {
  Northern: 'Северные',
  Silver: 'Серебряные',
  Quiet: 'Тихие',
  Ancient: 'Древние',
  Eastern: 'Восточные',
  Hidden: 'Скрытые',
  Windward: 'Ветреные',
  Amber: 'Янтарные',
  Village: 'Поселения',
  Crossroads: 'Перекрёстки',
  Fields: 'Поля',
  Steppe: 'Степи',
  Meadow: 'Луга',
  Forest: 'Леса',
  Grove: 'Рощи',
  Woods: 'Чащи',
  Coast: 'Берега',
  Bay: 'Бухты',
  Shore: 'Побережья',
  Heights: 'Высоты',
  Ridge: 'Хребты',
  Pass: 'Перевалы',
  Lake: 'Озёра',
  Waters: 'Воды',
  Riverlands: 'Речные земли',
  Ford: 'Броды',
  Marsh: 'Болота',
  Wetlands: 'Топи',
  Ruins: 'Руины',
  Sanctuary: 'Святилища',
};

function localizedPlaceName(name: string): string {
  if (name.endsWith("'s Home")) {
    return `${name.slice(0, -7)} — дом`;
  }
  return name
    .split(' ')
    .map((part) => regionNameTranslations[part] ?? part)
    .join(' ');
}

let mapExtentWorld: Readonly<WorldState> | undefined;
let mapExtent: ReturnType<typeof createWorldMapProjection> | undefined;
function extentForWorld(world: Readonly<WorldState>) {
  if (mapExtentWorld !== world || !mapExtent) {
    mapExtentWorld = world;
    mapExtent = createWorldMapProjection(world);
  }
  return mapExtent;
}
function normalizeWorldCoordinates(_world: Readonly<WorldState>, x: number, y: number): Pick<MapPoint,'x'|'y'> {
  return mapCamera.point(x,y);
}
function applyMapZoom(): void {
  mapCamera.resize(worldMapViewport.clientWidth || 390, worldMapViewport.clientHeight || 600);
  worldMap.style.width = `${mapCamera.width}px`;
  worldMap.style.height = `${mapCamera.height}px`;
  worldMap.style.minHeight = '0';
  worldMap.style.transform = 'none';
  worldMapStage.style.width = '100%';
  worldMapStage.style.height = '100%';
  worldMap.style.setProperty('--place-scale', String(Math.max(0.10, mapCamera.pixelsPerUnit * 0.12 / 42)));
  worldMap.style.setProperty('--resident-scale', String(Math.min(0.8, Math.max(0.18, mapCamera.pixelsPerUnit * 0.025 / 32))));
  worldMap.style.setProperty('--road-width', String(Math.max(0.5, Math.min(12,mapCamera.pixelsPerUnit * 0.04))));
  mapZoomFit.textContent = mapCamera.pixelsPerUnit < 0.5 ? 'Мир' : `${Math.round(mapZoom*100)}%`;
  worldMap.dataset.detail = mapDetail(mapCamera.pixelsPerUnit);
  worldMap.dataset.atlasLevel = atlasLevel(mapCamera.pixelsPerUnit);
  const scale = mapScaleBar(mapCamera.pixelsPerUnit);
  mapDistance.querySelector<HTMLElement>('span')!.style.width = `${scale.pixels}px`;
  mapDistance.querySelector<HTMLElement>('b')!.textContent = scale.label;
}
const mapInteraction = new MapInteraction(worldMap,mapCamera,()=>{
  applyMapZoom();if(lastFrame)renderMap(lastFrame);
});
function scheduleMapPaint(): void { mapInteraction.invalidate(); }
function setMapZoom(nextZoom: number, focalX=mapCamera.width/2, focalY=mapCamera.height/2): void {
  mapCamera.zoom(nextZoom*100,focalX,focalY);
  mapZoom = mapCamera.pixelsPerUnit/100;
  scheduleMapPaint();
}
function focusMapPoint(x: number,y: number): void {
  mapCamera.x=x;mapCamera.y=y;
  scheduleMapPaint();
}
function focusSelectedResident(): void {
  if (!lastFrame) return;
  const focus = residentMapFocus(lastFrame.world, selectedAgentId, mapCamera.pixelsPerUnit);
  if (!focus) return;
  mapCamera.x = focus.x; mapCamera.y = focus.y;
  setMapZoom(focus.pixelsPerUnit / 100);
  worldMapViewport.scrollIntoView({block: 'center', behavior: 'auto'});
}
function fitMapToViewport(): void {
  if (!lastFrame) return;
  const {minX,maxX,minY,maxY}=lastFrame.world.terrain?TERRAIN_BOUNDS:extentForWorld(lastFrame.world);
  mapCamera.x=(minX+maxX)/2;mapCamera.y=(minY+maxY)/2;
  setMapZoom(Math.min(mapCamera.width/Math.max(1,maxX-minX),mapCamera.height/Math.max(1,maxY-minY))*0.85/100);
}
function updateWorldMapScale(world: Readonly<WorldState>): void {
  const places=Object.values(world.places);
  const {minX,maxX,minY,maxY}=extentForWorld(world);
  const worldLevel=world.growth.stage+1;
  applyMapZoom();
  worldTitle.textContent=`Мир · уровень ${worldLevel}`;
  worldLevelValue.textContent=`ур. ${worldLevel}`;
  const level=atlasLevel(mapCamera.pixelsPerUnit);
  const nearest=Object.values(world.settlements).sort((a,b)=>Math.hypot(a.centerX-mapCamera.x,a.centerY-mapCamera.y)-Math.hypot(b.centerX-mapCamera.x,b.centerY-mapCamera.y))[0];
  mapScaleValue.textContent=level==='world'?'Обзор мира':nearest&&Math.hypot(nearest.centerX-mapCamera.x,nearest.centerY-mapCamera.y)<Math.max(2,nearest.radius*2)?localizedPlaceName(nearest.name):'Открытая территория';
  if (renderedGrowthStage<0) {
    const center=world.places.commons;
    if(center){mapCamera.x=center.mapX;mapCamera.y=center.mapY;}
  }
  renderedGrowthStage=world.growth.stage;
  mapHint.textContent='Потяните карту · колёсико или два пальца — масштаб';
}

function pointForPlace(
  placeId: string,
  agentIndex = 0,
  world?: Readonly<WorldState>,
): MapPoint {
  const publicPoint = publicPlacePoints[placeId];
  const place = world?.places[placeId];
  if (place && world) {
    const symbolByKind: Partial<Record<WorldPlaceKind, string>> = {
      home: '⌂',
      construction_site: '▨',
      commons: '◆',
      library: '📖',
      resource_field: '✦',
      workshop: '⚒',
      quiet_space: '♣',
      outskirts: '▲',
      mountains: '△',
      lake: '◉',
      river: '≈',
      swamp: '♨',
      ruins: '⌘',
      cemetery: '✝',
      village: '⌂',
      city: '▦',
      meadow: '❀',
      forest: '♠',
      shore: '≈',
      ocean: '≋',
    };
    const normalized = normalizeWorldCoordinates(
      world,
      place.mapX,
      place.mapY,
    );
    return {
      ...normalized,
      label: publicPoint?.label ?? localizedPlaceName(place.name),
      symbol: publicPoint?.symbol ?? symbolByKind[place.kind] ?? '•',
    };
  }
  if (publicPoint) return publicPoint;
  if (placeId.startsWith('home_')) {
    return homePoints[agentIndex % homePoints.length];
  }
  return { x: 50, y: 48, label: placeId, symbol: '•' };
}

function displayPlaceName(
  world: Readonly<WorldState>,
  agent: Readonly<AgentState>,
): string {
  const publicName = publicPlacePoints[agent.locationId]?.label;
  if (publicName) return publicName;
  const storedName = world.places[agent.locationId]?.name ?? agent.locationId;
  return localizedPlaceName(storedName);
}

function inspectorReportForEntity(
  world: Readonly<WorldState>,
  entity: NonNullable<typeof inspectedEntity>,
): TruthfulInspectorReportV16 | undefined {
  if (entity.kind === 'resident') return inspectResidentV16(world, entity.id);
  if (entity.kind === 'wildlife') return inspectWildlifeV16(world, entity.id);
  return inspectPlaceV16(world, entity.id);
}

function renderInspectorReport(report: TruthfulInspectorReportV16): void {
  worldInspectorBadge.textContent = report.badge;
  worldInspectorTitle.textContent =
    report.kind === 'place' ? localizedPlaceName(report.title) : report.title;
  worldInspectorSubtitle.textContent = report.subtitle;
  worldInspectorEvidence.textContent = report.evidenceNote;
  worldInspectorContent.replaceChildren();

  for (const section of report.sections) {
    const sectionElement = document.createElement('section');
    sectionElement.className = 'world-inspector__section';
    const heading = document.createElement('h3');
    heading.textContent = section.title;
    const rows = document.createElement('dl');
    for (const row of section.rows) {
      const item = document.createElement('div');
      const term = document.createElement('dt');
      const description = document.createElement('dd');
      term.textContent = row.label;
      description.textContent = row.value;
      item.append(term, description);
      rows.append(item);
    }
    sectionElement.append(heading, rows);
    worldInspectorContent.append(sectionElement);
  }
}

function openWorldInspector(
  kind: NonNullable<typeof inspectedEntity>['kind'],
  id: string,
): void {
  if (!lastFrame) return;
  const entity = { kind, id } as const;
  const report = inspectorReportForEntity(lastFrame.world, entity);
  if (!report) return;
  inspectedEntity = entity;
  renderInspectorReport(report);
  worldInspector.hidden = false;
  worldInspectorClose.focus();
}

function refreshWorldInspector(world: Readonly<WorldState>): void {
  if (!inspectedEntity || worldInspector.hidden) return;
  const report = inspectorReportForEntity(world, inspectedEntity);
  if (!report) {
    worldInspector.hidden = true;
    inspectedEntity = undefined;
    return;
  }
  renderInspectorReport(report);
}

function closeWorldInspector(): void {
  worldInspector.hidden = true;
}


function renderPlaces(world: Readonly<WorldState>): void {
  atlas.index.update(world);
  const close=atlasLevel(mapCamera.pixelsPerUnit)==='building';
  const visiblePlaces=atlas.index.visiblePlaces(world,mapCamera,highlightedPlaceIds);
  const townNames=new Map(Object.values(world.settlements).map(t=>[t.centerPlaceId,localizedPlaceName(t.name)]));
  const labelIds=visibleMapLabels(visiblePlaces,mapCamera,highlightedPlaceIds,townNames);
  const liveIds = new Set(visiblePlaces.map(p=>p.id));
  for (const [placeId, element] of placeElements) {
    if (liveIds.has(placeId)) continue;
    element.remove();
    placeElements.delete(placeId);
  }
  const dungeonByEntrance = new Map(
    Object.values(world.v19?.adventureEconomy.dungeonsById ?? {}).map(
      (dungeon) => [dungeon.entrancePlaceId, dungeon] as const,
    ),
  );
  for (const place of visiblePlaces) {
    const placeId=place.id;
    const point = pointForPlace(placeId, 0, world);
    let placeElement = placeElements.get(placeId);
    if (!placeElement) {
      placeElement = document.createElement('button');
      placeElement.setAttribute('type', 'button');
      placeElement.className = `map-place map-place--${place.kind}`;
      placeElement.innerHTML = `
        <span class="place-building" aria-hidden="true">
          ${physicalPlaceDrawing(place,close)}
        </span>
        <span class="place-label"></span>
        <span class="place-count">0</span>
      `;
      placeElement.addEventListener('click', () => {
        openWorldInspector('place', placeId);
      });
      placesLayer.append(placeElement);
      placeElements.set(placeId, placeElement);
      placeElement.dataset.artKind = place.kind+':'+close;
    }
    if (placeElement.dataset.artKind !== place.kind+':'+close) {
      placeElement.querySelector('.place-building')!.innerHTML = physicalPlaceDrawing(place,close);
      placeElement.dataset.artKind = place.kind+':'+close;
    }
    placeElement.className = `map-place map-place--${place.kind} map-place--surface-${place.surface}`;
    applyPhysicalPlaceStyle(placeElement,place,mapCamera);
    const mapLabel=labelIds.get(placeId);
    placeElement.classList.toggle('has-map-label',Boolean(mapLabel));
    if(mapLabel) {
      placeElement.style.setProperty('--label-offset-x',mapLabel.offsetX+'px');
      placeElement.style.setProperty('--label-offset-y',mapLabel.offsetY+'px');
      placeElement.style.setProperty('--map-label-width',mapLabel.width+'px');
    }
    placeElement.classList.toggle(
      'is-territory-claimed',
      place.claimedBySettlementId !== undefined,
    );
    placeElement.dataset.claimedBy = place.claimedBySettlementId ?? '';
    placeElement.classList.toggle('is-highlighted', highlightedPlaceIds.has(placeId));
    const dungeon = dungeonByEntrance.get(placeId);
    placeElement.classList.toggle('has-dungeon', dungeon !== undefined);
    placeElement.dataset.dungeonRank = dungeon?.rank ?? '';
    placeElement.style.left = `${point.x}%`;
    placeElement.style.top = `${point.y}%`;
    placeElement.style.zIndex = String(mapEntityDepth(point.y, mapCamera.pixelsPerUnit*0.10, mapCamera.height));
    placeElement.setAttribute(
      'aria-label',
      dungeon ? `${point.label}; вход в подземелье ранга ${dungeon.rank}` : point.label,
    );
    const label = placeElement.querySelector<HTMLElement>('.place-label');
    if (label) label.textContent = townNames.get(placeId)??point.label;
  }
}

function renderWildlife(world: Readonly<WorldState>): void {
  const visibleWildlife=Object.values(world.wildlife).filter(p=>{
    if(mapCamera.pixelsPerUnit<90)return false;
    const habitat=world.places[p.habitatId];return habitat&&mapCamera.visible(habitat.mapX,habitat.mapY,70);
  }).slice(0,50);
  const liveIds = new Set(visibleWildlife.map(p=>p.id));
  for (const [populationId, element] of wildlifeElements) {
    if (liveIds.has(populationId)) continue;
    element.remove();
    wildlifeElements.delete(populationId);
  }
  for (const population of visibleWildlife) {
    const populationId=population.id;
    const habitat = world.places[population.habitatId];
    if (!habitat) continue;
    const offsets: Record<WildlifeSpecies, { x: number; y: number }> = {
      rabbit: { x: 6, y: 4 },
      deer: { x: 7, y: 5 },
      fish: { x: 4, y: 5 },
      boar: { x: 5, y: 5 },
      wolf: { x: -5, y: 4 },
      bird: { x: 3, y: -5 },
      dire_wolf: { x: -7, y: 6 },
      ogre: { x: 7, y: -6 },
      wraith: { x: -6, y: -6 },
      century_humpback: { x: 0, y: -9 },
    };
    const offset = offsets[population.species];
    let element = wildlifeElements.get(populationId);
    if (!element) {
      element = document.createElement('button');
      element.setAttribute('type', 'button');
      element.className = `wildlife-population wildlife-population--${population.species}`;
      element.innerHTML = `
        <span class="wildlife-icon" aria-hidden="true">${wildlifeIcons[population.species]}</span>
        <span class="wildlife-count"></span>
      `;
      element.addEventListener('click', () => {
        openWorldInspector('wildlife', populationId);
      });
      wildlifeLayer.append(element);
      wildlifeElements.set(populationId, element);
    }

    const point = normalizeWorldCoordinates(world, habitat.mapX + offset.x * 0.005, habitat.mapY + offset.y * 0.005);
    element.style.left = `${point.x}%`;
    element.style.top = `${point.y}%`;

    const label = wildlifeLabels[population.species];
    const count = element.querySelector<HTMLElement>('.wildlife-count');
    if (count) count.textContent = String(population.count);
    element.setAttribute(
      'aria-label',
      `${label}: ${population.count} из ${population.carryingCapacity}`,
    );
    element.classList.toggle('is-depleted', population.count === 0);
    element.classList.toggle('is-monster', population.isMonster === true);
  }
}

function ensureAvatar(
  agent: Readonly<AgentState>,
  index: number,
): HTMLButtonElement {
  const existing = avatarElements.get(agent.id);
  if (existing) return existing;

  const avatar = document.createElement('button');
  avatar.type = 'button';
  avatar.className = 'resident-avatar';
  avatar.style.setProperty('--resident-index', String(index));
  avatar.innerHTML = `
    <span class="action-bubble" aria-hidden="true">•</span>
    <span class="resident-figure" aria-hidden="true">
      <span class="resident-shadow"></span>
      <span class="resident-head"><span class="resident-hair"></span></span>
      <span class="resident-arm resident-arm--left"></span>
      <span class="resident-arm resident-arm--right"></span>
      <span class="resident-body"></span>
      <span class="resident-leg resident-leg--left"></span>
      <span class="resident-leg resident-leg--right"></span>
    </span>
    <span class="resident-nameplate"></span>
  `;

  const nameplate = avatar.querySelector<HTMLElement>('.resident-nameplate');
  if (!nameplate) throw new Error('Resident nameplate was not created.');
  nameplate.textContent = agent.name;

  avatar.addEventListener('click', () => {
    selectedAgentId = agent.id;
    updateSelection();
    openWorldInspector('resident', agent.id);
  });

  agentsLayer.append(avatar);
  avatarElements.set(agent.id, avatar);
  return avatar;
}

function strongestTraits(agent: Readonly<AgentState>): string {
  return (Object.entries(agent.personality) as Array<
    [keyof AgentState['personality'], number]
  >)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
    .map(([trait]) => traitLabels[trait])
    .join(' · ');
}

function strongestSkill(agent: Readonly<AgentState>): string {
  const strongest = (Object.entries(agent.skills) as Array<
    [keyof AgentState['skills'], number]
  >).sort((a, b) => b[1] - a[1])[0];
  const progression = agent.progression;
  const level = progression?.level ?? 1;
  const control = Math.round((progression?.objectControlAuthority ?? 0) * 100);
  const system = Math.round((progression?.systemControlAuthority ?? 0) * 100);
  return `ур. ${level} · ${skillLabels[strongest[0]]} ${Math.round(strongest[1] * 100)}% · OC ${control}% · SC ${system}%`;
}

function emotionalSummary(agent: Readonly<AgentState>): string {
  return (Object.entries(agent.mind.emotions) as Array<
    [keyof AgentState['mind']['emotions'], number]
  >)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
    .map(([emotion, value]) => `${emotionLabels[emotion]} ${Math.round(value * 100)}%`)
    .join(' · ');
}

function physiologySummary(
  agent: Readonly<AgentState>,
  world?: Readonly<WorldState>,
): string {
  const physiology = (
    agent.life as AgentState['life'] & {
      physiology?: AgentState['life']['physiology'];
    }
  ).physiology ?? {
    strength: agent.life.stage === 'elder' ? 0.45 : 0.75,
    endurance: agent.life.stage === 'elder' ? 0.42 : 0.72,
    mobility: agent.life.stage === 'elder' ? 0.4 : 0.76,
    recovery: agent.life.stage === 'elder' ? 0.35 : 0.74,
  };
  const bodyState =
    physiology.strength >= 0.82
      ? 'сильный'
      : physiology.mobility < 0.36
        ? 'немощный'
        : physiology.endurance < 0.52
          ? 'быстро устаёт'
          : 'в норме';
  const physical = world?.v21?.bodiesByAgentId[agent.id];
  const clinical = physical
    ? ` · ран ${physical.wounds.length} · болезней ${physical.diseases.length} · боль ${Math.round(physical.pain * 100)}%`
    : '';
  return `${bodyState} · сила ${Math.round(physiology.strength * 100)}% · выносливость ${Math.round(physiology.endurance * 100)}%${clinical}`;
}

function closestRelationship(
  world: Readonly<WorldState>,
  agentId: string,
): RelationshipState | undefined {
  return Object.values(world.relationships)
    .filter(
      (relationship) =>
        relationship.agentA === agentId || relationship.agentB === agentId,
    )
    .sort(
      (a, b) =>
        b.trust + b.affinity + b.respect - b.conflict -
        (a.trust + a.affinity + a.respect - a.conflict),
    )[0];
}

function syncResidentPicker(
  world: Readonly<WorldState>,
  agents: readonly AgentState[],
): void {
  const query = residentSearchQuery.trim().toLocaleLowerCase('ru-RU');
  const sorted = [...agents].filter((agent) =>
    !query || agent.name.toLocaleLowerCase('ru-RU').includes(query),
  ).sort(
    (left, right) => left.name.localeCompare(right.name, 'ru') || left.id.localeCompare(right.id),
  );
  const signature = sorted
    .map((agent) => {
      const livelihood = world.v18?.livelihoodByAgentId[agent.id];
      return `${agent.id}:${agent.name}:${agent.race ?? 'human'}:${livelihood?.primary ?? 'undecided'}`;
    })
    .join('|') + `|query:${query}`;
  if (signature !== residentPickerSignature) {
    residentPickerSignature = signature;
    const groups: HTMLOptGroupElement[] = [];
    for (const race of ['human', 'elf', 'dwarf', 'goblin', 'orc', 'ogre'] as const) {
      const members = sorted.filter((agent) => (agent.race ?? 'human') === race);
      if (members.length === 0) continue;
      const group = document.createElement('optgroup');
      group.dataset.race = race;
      group.label = `${raceGroupMarkers[race]} ${raceGroupLabels[race].toLocaleUpperCase('ru-RU')} · ${members.length}`;
      for (const agent of members) {
        const option = document.createElement('option');
        option.value = agent.id;
        const livelihood = world.v18?.livelihoodByAgentId[agent.id];
        option.textContent = `${agent.name} · ${livelihoodLabels[livelihood?.primary ?? 'undecided']}`;
        group.append(option);
      }
      groups.push(group);
    }
    if (groups.length === 0) {
      const empty = document.createElement('option');
      empty.value = '';
      empty.textContent = 'Никого не найдено';
      residentPicker.replaceChildren(empty);
    } else {
      residentPicker.replaceChildren(...groups);
    }
  }
  if (selectedAgentId) residentPicker.value = selectedAgentId;
}

function updateSelection(): void {
  if (!lastFrame) return;

  const agents = Object.values(lastFrame.world.agents).filter(
    (agent) => agent.life.alive,
  );
  const selected =
    agents.find((agent) => agent.id === selectedAgentId) ?? agents[0];
  if (!selected) return;
  selectedAgentId = selected.id;
  residentPicker.value = selected.id;

  for (const [agentId, avatar] of avatarElements) {
    const isSelected = agentId === selected.id;
    avatar.classList.toggle('is-selected', isSelected);
    avatar.setAttribute('aria-pressed', String(isSelected));
  }

  residentPortrait.textContent = selected.name.slice(0, 1).toUpperCase();
  residentPortrait.style.setProperty(
    '--portrait-index',
    String(agents.findIndex((agent) => agent.id === selected.id)),
  );
  residentName.textContent = selected.name;
  residentActivity.textContent = selected.movement
    ? `в пути · ${actionLabels[selected.movement.purpose]}`
    : selected.lastAction
      ? actionLabels[selected.lastAction]
      : 'осматривается';
  residentPlace.textContent = displayPlaceName(lastFrame.world, selected);
  residentGoal.textContent = goalLabels[selected.goal.kind];
  const age = ageParts(selected.life.ageYears);
  residentLife.textContent = `${age.years} лет ${age.months} мес · ${raceLabels[selected.race ?? 'human']} · поколение ${selected.life.generation} · ${
    selected.origin === 'native' ? 'рождён здесь' : 'вошёл извне'
  }`;
  residentEmotion.textContent = emotionalSummary(selected);
  residentPhysiology.textContent = physiologySummary(selected, lastFrame.world);
  residentTraits.textContent = strongestTraits(selected);
  const livelihood = lastFrame.world.v18?.livelihoodByAgentId[selected.id];
  const socialProfile = lastFrame.world.v19?.adventureEconomy.emergentSociety
    ?.residentsByAgentId[selected.id];
  const recognizedProfession = socialProfile?.recognizedProfessionId
    ? lastFrame.world.v19?.adventureEconomy.emergentSociety
        ?.professionsById[socialProfile.recognizedProfessionId]
    : undefined;
  residentProfession.textContent = recognizedProfession
    ? `${recognizedProfession.title} · признано по ${recognizedProfession.evidenceCount} случаям практики`
    : livelihood
    ? `${livelihoodLabels[livelihood.primary]} · ${livelihoodStageLabels[livelihood.stage]}`
    : 'запись создаётся';
  residentSkill.textContent = strongestSkill(selected);

  if (selected.lastDecision) {
    const reflection = selected.lastDecision.innerThought &&
      selected.lastDecision.deliberationWorldMinutes !== undefined
      ? {
          innerThought: selected.lastDecision.innerThought,
          deliberationWorldMinutes: selected.lastDecision.deliberationWorldMinutes,
        }
      : residentDecisionReflection(selected, selected.lastDecision);
    residentChoice.textContent = reflection.innerThought;
    const decisionSeconds = Math.max(
      10,
      Math.round((reflection.deliberationWorldMinutes * 60) / 5) * 5,
    );
    residentChoice.title = decisionSeconds < 60
      ? `Решение заняло около ${decisionSeconds} секунд времени мира. Само действие продолжается отдельно.`
      : `Решение заняло около ${Math.round(decisionSeconds / 60)} минут времени мира. Само действие продолжается отдельно.`;
  } else {
    residentChoice.textContent = 'первое решение впереди';
    residentChoice.removeAttribute('title');
  }

  residentLearning.textContent = residentLearningSummary(selected);
  const relationship = closestRelationship(lastFrame.world, selected.id);
  if (relationship) {
    const otherId =
      relationship.agentA === selected.id
        ? relationship.agentB
        : relationship.agentA;
    const other = lastFrame.world.agents[otherId];
    relationshipNote.textContent = other
      ? other.life.alive
        ? `Ближе всего: ${other.name} · доверие ${Math.round(relationship.trust * 100)}%`
        : `Помнит ${other.name} · связь не исчезла после смерти`
      : 'Связи продолжают меняться.';
  } else {
    relationshipNote.textContent = 'Связи ещё формируются.';
  }

  const setNeed = (
    value: number,
    valueElement: HTMLElement,
    barElement: HTMLElement,
  ) => {
    const percent = Math.round(value * 100);
    valueElement.textContent = `${percent}%`;
    barElement.style.width = `${percent}%`;
  };

  setNeed(selected.energy, energyValue, energyBar);
  setNeed(selected.stress, stressValue, stressBar);
  setNeed(selected.resources, personalResourceValue, personalResourceBar);
  setNeed(
    lastFrame.world.v18?.lifeRhythmByAgentId[selected.id]?.satiety ??
      selected.resources,
    satietyValue,
    satietyBar,
  );
  setNeed(selected.needs.belonging, belongingValue, belongingBar);
  setNeed(selected.needs.purpose, purposeValue, purposeBar);
}

function eventAgentName(
  event: Readonly<WorldEvent>,
  world: Readonly<WorldState>,
): string {
  const agentId = event.payload.agentId;
  return typeof agentId === 'string'
    ? world.agents[agentId]?.name ?? 'Искра'
    : 'Искра';
}

function eventText(
  event: Readonly<WorldEvent>,
  world: Readonly<WorldState>,
): string | undefined {
  const name = eventAgentName(event, world);
  switch (event.kind) {
    case 'agent.rested':
      return `${name} решил отдохнуть`;
    case 'agent.relaxed':
      return `${name} отдыхает на природе`;
    case 'agent.walked':
      return `${name} отправился гулять`;
    case 'agent.gathered':
      return `${name} добыл ${
        event.payload.material === 'food'
          ? 'пищу'
          : event.payload.material === 'wood'
            ? 'дерево'
            : event.payload.material === 'stone'
              ? 'камень'
              : event.payload.material === 'metal'
                ? 'металл'
                : event.payload.material === 'fuel'
                  ? 'топливо'
                  : 'ресурсы'
      }`;
    case 'agent.hunted': {
      const species = event.payload.species;
      const label =
        typeof species === 'string' && species in wildlifeLabels
          ? wildlifeLabels[species as WildlifeSpecies].toLowerCase()
          : 'дичь';
      return event.payload.succeeded
        ? `${name} добыл: ${label}`
        : `${name} вернулся с охоты без добычи`;
    }
    case 'agent.worked':
      return `${name} работает в мастерской`;
    case 'agent.explored':
      if (typeof event.payload.discoveredRegionId === 'string') {
        return `${name} открыл: ${
          publicPlacePoints[event.payload.discoveredRegionId]?.label ??
          world.places[event.payload.discoveredRegionId]?.name ??
          event.payload.discoveredRegionId
        }`;
      }
      return event.payload.discovered
        ? `${name} нашёл новые ресурсы`
        : `${name} исследует окраину`;
    case 'agent.dungeon.travel_started':
      return `${name} сам отправился ко входу в подземелье ранга ${String(event.payload.rank ?? '?')}`;
    case 'agent.dungeon.expedition':
      return event.payload.outcome === 'success'
        ? `${name} вернулся из подземелья с опытом и добычей`
        : event.payload.outcome === 'retreat'
          ? `${name} решил вовремя отступить из подземелья`
          : `${name} выбрался из подземелья после поражения`;
    case 'agent.market.food_purchase':
      return `${name} купил настоящие припасы поселения`;
    case 'agent.market.artifact_sale':
      return `${name} продал найденный артефакт на местном рынке`;
    case 'agent.market.artifact_purchase':
      return `${name} купил артефакт у поселения`;
    case 'agent.reflected':
      return `${name} ушёл поразмышлять`;
    case 'agent.prayed':
      return `${name} пытается понять тайны мира`;
    case 'agent.education.founding_primer_studied':
      return `${name} изучает основы дома, семьи и безопасной жизни в мире`;
    case 'agent.bond.accepted':
      return `${name} стал кому-то ближе`;
    case 'agent.bond.declined':
      return `${name} получил время всё обдумать`;
    case 'agent.born':
      return `${name} родился — началась новая жизнь`;
    case 'agent.died':
      return event.payload.cause === 'monster'
        ? `${name} погиб при встрече с чудовищем`
        : event.payload.cause === 'war'
          ? `${name} погиб в столкновении поселений`
          : event.payload.cause === 'contamination'
            ? `${name} умер из-за заражения местности`
        : `${name} умер, но его история осталась в мире`;
    case 'agent.life.stage_changed':
      return `${name} перешёл в новый период жизни`;
    case 'agent.socialize.blocked':
      return `${name} не смог найти компанию`;
    case 'agent.help.accepted': {
      const targetId = event.payload.targetId;
      const target =
        typeof targetId === 'string' ? world.agents[targetId]?.name : undefined;
      return `${name} помог${target ? ` ${target}` : ' другой Искре'}`;
    }
    case 'agent.help.rejected':
      return `Помощь ${name} не приняли`;
    case 'agent.goal.changed': {
      const next = event.payload.next;
      return typeof next === 'string' && next in goalLabels
        ? `${name}: новая цель — ${goalLabels[next as AgentState['goal']['kind']]}`
        : `${name} сменил цель`;
    }
    case 'relationship.changed': {
      const a = event.payload.agentA;
      const b = event.payload.agentB;
      const sentiment = event.payload.sentiment;
      const aName = typeof a === 'string' ? world.agents[a]?.name : undefined;
      const bName = typeof b === 'string' ? world.agents[b]?.name : undefined;
      if (!aName || !bName) return 'Между Искрами изменилась связь';
      return typeof sentiment === 'number' && sentiment < -0.18
        ? `${aName} и ${bName} поспорили`
        : `${aName} и ${bName} пообщались`;
    }
    case 'world.disturbance.resource_shock':
      return 'Мир пережил ресурсный удар';
    case 'world.effect.social_barrier':
      return 'Общаться стало труднее';
    case 'world.effect.safety_shock':
      return 'В мире выросла опасность';
    case 'world.region.discovered': {
      const regionId = event.payload.regionId;
      return typeof regionId === 'string'
        ? `Карта выросла: ${
            publicPlacePoints[regionId]?.label ??
            world.places[regionId]?.name ??
            regionId
          }`
        : 'Искры открыли новую территорию';
    }
    case 'world.wildlife.recovered': {
      const species = event.payload.species;
      return typeof species === 'string' && species in wildlifeLabels
        ? `${wildlifeLabels[species as WildlifeSpecies]} размножаются`
        : 'Популяция животных восстанавливается';
    }
    case 'world.wildlife.depleted':
      return 'Одна из популяций животных исчезла из поля зрения';
    case 'world.monster.encountered': {
      const species = event.payload.species;
      const monster =
        typeof species === 'string' && species in wildlifeLabels
          ? wildlifeLabels[species as WildlifeSpecies].toLowerCase()
          : 'чудовище';
      return `${name} встретил в глуши: ${monster}`;
    }
    case 'world.monster.hunted_prey': {
      const monsterSpecies = event.payload.monsterSpecies;
      const preySpecies = event.payload.preySpecies;
      const monster =
        typeof monsterSpecies === 'string' && monsterSpecies in wildlifeLabels
          ? wildlifeLabels[monsterSpecies as WildlifeSpecies]
          : 'Чудовище';
      const prey =
        typeof preySpecies === 'string' && preySpecies in wildlifeLabels
          ? wildlifeLabels[preySpecies as WildlifeSpecies].toLowerCase()
          : 'добычу';
      return `${monster} добыл пищу: ${prey}`;
    }
    case 'world.monster.fed': {
      const monsterSpecies = event.payload.monsterSpecies;
      const monster =
        typeof monsterSpecies === 'string' && monsterSpecies in wildlifeLabels
          ? wildlifeLabels[monsterSpecies as WildlifeSpecies]
          : 'Чудовище';
      return `${monster} убил путника и питался его телом`;
    }
    case 'world.monster.hunger': {
      const monsterSpecies = event.payload.monsterSpecies;
      const monster =
        typeof monsterSpecies === 'string' && monsterSpecies in wildlifeLabels
          ? wildlifeLabels[monsterSpecies as WildlifeSpecies]
          : 'Чудовища';
      return `${monster}: популяция сократилась без доступной добычи`;
    }
    case 'world.sapient_race.emerged':
    case 'world.sapient_people.discovered': {
      const race = String(event.payload.race ?? 'unknown');
      const label =
        race === 'elf'
          ? 'эльфов'
          : race === 'dwarf'
            ? 'гномов'
            : race === 'goblin'
          ? 'гоблинов'
          : race === 'orc'
            ? 'орков'
            : race === 'ogre'
              ? 'огров'
              : race;
      return event.kind === 'world.sapient_people.discovered'
        ? `Искры открыли самостоятельный разумный народ: ${label}`
        : `В мире возник самостоятельный разумный народ: ${label}`;
    }
    case 'agent.level.changed':
      return `${name} достиг уровня ${String(event.payload.level ?? '?')}`;
    case 'world.settlement.founded':
      return `Искры основали ${String(event.payload.name ?? 'новое поселение')}`;
    case 'agent.resettled':
      return `${name} добровольно переселился в другое поселение`;
    case 'world.building.home_started':
      return 'Искры добровольно начали строить новый дом';
    case 'world.building.home_built':
      return 'Искры построили новый дом из местных материалов';
    case 'world.building.home_repaired':
      return 'Искры отремонтировали и вернули бесхозный дом в жизнь';
    case 'agent.household.moved_home':
      return event.payload.reason === 'voluntary_reoccupation_after_repair'
        ? `${name} добровольно поселился в восстановленном доме`
        : `${name} переселился в построенный дом`;
    case 'world.item.tool_crafted':
      return event.payload.toolKind === 'farming'
        ? 'Мастер изготовил земледельческий инструмент'
        : 'Мастер изготовил строительный инструмент';
    case 'world.settlement.contact':
      return 'Представители двух поселений встретились на дороге';
    case 'world.territory.claimed': {
      const placeId = event.payload.placeId;
      return typeof placeId === 'string'
        ? `Поселение заявило землю: ${world.places[placeId]?.name ?? placeId}`
        : 'Поселение заявило право на землю';
    }
    case 'world.settlement.war_started':
      return 'Между поселениями началась война по решению её участников';
    case 'world.settlement.conflict':
      return event.payload.conflictKind === 'land'
        ? 'Поселения столкнулись за спорную землю'
        : 'Поселения совершили вооружённый набег за ресурсами';
    case 'world.settlement.peace':
      return 'Участники прекратили войну';
    case 'world.cemetery.established':
      return 'Искры отвели место под кладбище';
    case 'world.resident.buried': {
      return name === 'Искра'
        ? 'Искры похоронили умершего'
        : `Искры похоронили ${name}`;
    }
    case 'world.city.emerged':
      return `${String(event.payload.name ?? 'Поселение')} выросло в город`;
    case 'world.migrated':
      return 'Старый мир продолжен по новым правилам';
    case 'world.tradition.emerged':
      return 'В мире родилась новая традиция';
    case 'world.entry.resident_manifested':
      return 'В мир вошёл новый внешний обитатель';
    case 'world.entry.deity_manifested':
      return 'Мир почувствовал присутствие неизвестной силы';
    case 'world.omen.aurora':
    case 'world.omen.voice':
    case 'world.omen.eclipse':
    case 'world.omen.miracle':
    case 'world.omen.storm_sign':
      return 'Искры стали свидетелями необъяснимого знамения';
    case 'world.omen.natural.sky_lights':
    case 'world.omen.natural.distant_voice':
    case 'world.omen.natural.silent_storm':
    case 'world.omen.natural.ruin_echo':
      return 'В мире произошло необъяснимое явление';
    default:
      return undefined;
  }
}

function compactAinkradWorldTime(worldMinutes: number): string {
  const calendar = worldCalendarAtMinutes(worldMinutes);
  return `Г${calendar.year} · Д${calendar.dayOfYear}`;
}

function renderEventFeed(frame: Readonly<LiveWorldFrame>): void {
  const items = [...frame.recentEvents]
    .reverse()
    .map((event) => ({ event, text: eventText(event, frame.world) }))
    .filter((item): item is { event: WorldEvent; text: string } =>
      Boolean(item.text),
    )
    .slice(0, 6);

  eventFeed.replaceChildren();
  if (items.length === 0) {
    const empty = document.createElement('li');
    empty.textContent = 'Мир спокойно проживает этот момент.';
    eventFeed.append(empty);
    return;
  }

  for (const item of items) {
    const element = document.createElement('li');
    element.innerHTML = '<span></span><p></p>';
    const time = element.querySelector('span');
    if (time) {
      time.textContent = item.event.occurredWorldMinutes === undefined
        ? 'старое время'
        : compactAinkradWorldTime(item.event.occurredWorldMinutes);
      time.title = item.event.occurredWorldMinutes === undefined
        ? 'Время старой записи не указано в canonical world minutes.'
        : formatAinkradWorldTime(item.event.occurredWorldMinutes);
    }
    const text = element.querySelector('p');
    if (text) text.textContent = item.text;
    eventFeed.append(element);
  }
}

function renderAudibleConversations(frame: Readonly<LiveWorldFrame>): void {
  const conversations = [...(frame.world.v18?.recentConversations ?? [])]
    .filter((conversation) => conversation.observerAudible)
    .sort((left, right) => right.worldMinute - left.worldMinute)
    .slice(0, 3);
  conversationFeed.replaceChildren();
  if (conversations.length === 0) {
    conversationFeed.textContent = 'Пока рядом не слышно разговора.';
    return;
  }
  for (const conversation of conversations) {
    const item = document.createElement('article');
    const speaker = frame.world.agents[conversation.speakerId]?.name ?? 'Искра';
    const listener = frame.world.agents[conversation.listenerId]?.name ?? 'собеседник';
    const place = frame.world.places[conversation.placeId]?.name ?? conversation.placeId;
    const heading = document.createElement('span');
    heading.textContent = `${speaker} → ${listener} · ${localizedPlaceName(place)}`;
    const quote = document.createElement('p');
    quote.textContent = `«${conversation.utterance}»`;
    const reply = document.createElement('p');
    reply.textContent = `${listener}: «${conversation.reply}»`;
    item.append(heading, quote, reply);
    conversationFeed.append(item);
  }
}

function announceDisturbance(frame: Readonly<LiveWorldFrame>): void {
  const disturbance = frame.disturbances[0];
  if (!disturbance) {
    disturbanceBanner.classList.remove('is-visible');
    return;
  }

  disturbanceBanner.textContent =
    disturbance.kind === 'resource_shock'
      ? '⚠ Ресурсный удар — Искры решают сами'
      : disturbance.kind === 'social_barrier'
        ? '⚠ Социальный барьер'
        : '⚠ Угроза безопасности';
  disturbanceBanner.classList.add('is-visible');
}

function updateWorldTime(frame: Readonly<LiveWorldFrame>): void {
  const elapsedWorldMinutes = frame.world.calendar.elapsedWorldMinutes;
  const calendar = worldCalendarAtMinutes(elapsedWorldMinutes);
  const weather = worldWeatherV21(frame.world, elapsedWorldMinutes);
  worldMap.dataset.phase = calendar.phase;
  worldMap.dataset.weather = weather.kind;
  const clock = `${String(calendar.hour).padStart(2, '0')}:${String(calendar.minute).padStart(2, '0')}`;
  timeValue.textContent = `год ${calendar.year} · день ${calendar.dayOfYear} · ${clock}`;
  timeValue.title = `Прошло ${calendar.totalDays} дней мира`;
  const elapsedYears = elapsedWorldMinutes / WORLD_MINUTES_PER_YEAR;
  tickValue.textContent = elapsedYears >= 1
    ? `${elapsedYears.toFixed(1)} г.`
    : `${Math.floor(elapsedWorldMinutes / 1_440)} дн.`;
  mapTimeValue.textContent =
    `${phaseLabels[calendar.phase]} · ${seasonLabels[calendar.season]} · ` +
    `${weather.label} ${weather.temperatureC > 0 ? '+' : ''}${weather.temperatureC}°C · ` +
    weather.comfortLabel;
}

function persistOfflineClockAnchor(
  frame: Readonly<LiveWorldFrame>, wallClockMs = Date.now(),
  speedId = preferredSpeedId, multiplier = preferredSpeedMultiplier,
): void { clockPanel.persist(frame, wallClockMs, speedId, multiplier); }

function resumeOfflineClockFromStoredAnchor(frame: Readonly<LiveWorldFrame>): void {
  clockPanel.restore(frame);
}

function updateOfflineClockContinuity(frame: Readonly<LiveWorldFrame>): void {
  clockPanel.update(frame);
}

function renderMap(frame: Readonly<LiveWorldFrame>): void {
  updateWorldMapScale(frame.world);
  worldMap.dataset.growth = String(Math.min(3, frame.world.growth.stage));
  atlas.render(frame.world,mapCamera);
  renderPlaces(frame.world);
  renderWildlife(frame.world);

  const agents = Object.values(frame.world.agents).filter(
    (agent) => agent.life.alive,
  );
  const showResidents=mapCamera.pixelsPerUnit>=90;
  const visibleAgents = agents.filter(agent => (showResidents||agent.id===selectedAgentId)&&mapCamera.visible(agent.position.x,agent.position.y));
  const renderedAgents = visibleAgents.slice(0, MAX_VISIBLE_RESIDENTS);
  const selected = visibleAgents.find(agent => agent.id === selectedAgentId);
  if (selected && !renderedAgents.includes(selected)) {
    renderedAgents.pop();renderedAgents.push(selected);
  }
  const renderedAgentIds = new Set(renderedAgents.map((agent) => agent.id));
  for (const [agentId, avatar] of avatarElements) {
    if (renderedAgentIds.has(agentId)) continue;
    avatar.remove();
    avatarElements.delete(agentId);
  }
  if (!selectedAgentId) selectedAgentId = agents[0]?.id;

  const occupancy = new Map<string, AgentState[]>();
  for (const agent of agents) {
    const residents = occupancy.get(agent.locationId) ?? [];
    if (!agent.movement?.boatId) residents.push(agent);
    occupancy.set(agent.locationId, residents);
  }

  for (const [placeId, element] of placeElements) {
    const count = occupancy.get(placeId)?.length ?? 0;
    const badge = element.querySelector<HTMLElement>('.place-count');
    if (badge) badge.textContent = String(count);
    element.classList.toggle('is-active', count > 0);
  }

  worldMap.dataset.visibleResidents = String(renderedAgents.length);
  worldMap.dataset.visiblePlaces = String(placeElements.size);
  renderedAgents.forEach((agent, index) => {
    const avatar = ensureAvatar(agent, index);
    const persistedPosition = projectedResidentPosition(
      agent,
      frame.world,
      frame.tick,
    );
    const base = persistedPosition
      ? normalizeWorldCoordinates(
          frame.world,
          persistedPosition.x,
          persistedPosition.y,
        )
      : pointForPlace(agent.locationId, index, frame.world);
    const { x, y } = base;
    const isMoving = Boolean(agent.movement);

    avatar.style.left = `${x}%`;
    avatar.style.top = `${y}%`;
    avatar.style.zIndex = String(mapEntityDepth(y, 0, mapCamera.height));
    avatar.classList.toggle('is-selected', agent.id === selectedAgentId);
    avatar.setAttribute('aria-pressed', String(agent.id === selectedAgentId));
    avatar.classList.toggle('is-moving', isMoving);
    avatar.classList.toggle('is-sailing', Boolean(agent.movement?.boatId));
    avatar.classList.toggle(
      'is-ambient',
      !isMoving && agent.lastAction !== 'rest',
    );
    avatar.classList.toggle('is-resting', agent.lastAction === 'rest');
    avatar.classList.toggle('is-relaxing', agent.lastAction === 'relax');
    avatar.classList.toggle('is-walking', agent.lastAction === 'walk');
    avatar.classList.toggle('is-hunting', agent.lastAction === 'hunt');
    avatar.classList.toggle('is-reflecting', agent.lastAction === 'reflect');
    avatar.classList.toggle('is-socializing', agent.lastAction === 'socialize');
    avatar.classList.toggle('is-helping', agent.lastAction === 'help');
    avatar.classList.toggle('is-child', agent.life.stage === 'child');
    avatar.classList.toggle(
      'is-adolescent',
      agent.life.stage === 'adolescent',
    );
    avatar.classList.toggle('is-elder', agent.life.stage === 'elder');
    for (const race of ['human', 'elf', 'dwarf', 'goblin', 'orc', 'ogre'] as const) {
      avatar.classList.toggle(`is-race-${race}`, (agent.race ?? 'human') === race);
    }
    const physiology = (
      agent.life as Partial<AgentState['life']>
    ).physiology;
    const mobility = physiology?.mobility ?? 0.72;
    avatar.style.setProperty(
      '--walk-duration',
      `${Math.round(280 + (1 - mobility) * 520)}ms`,
    );
    avatar.dataset.lifeStage = agent.life.stage;
    avatar.dataset.action = agent.lastAction ?? 'idle';

    const actionBubble = avatar.querySelector<HTMLElement>('.action-bubble');
    if (actionBubble) {
      const visibleAction = agent.movement?.purpose ?? agent.lastAction;
      actionBubble.textContent = agent.movement?.boatId ? '🛶' : visibleAction
        ? actionIcons[visibleAction]
        : '•';
    }

    avatar.setAttribute(
      'aria-label',
      `${agent.name}: ${
        agent.movement
          ? `идёт: ${actionLabels[agent.movement.purpose]}`
          : agent.lastAction
            ? actionLabels[agent.lastAction]
            : 'осматривается'
      }, ${displayPlaceName(frame.world, agent)}`,
    );
  });

  mapInteraction.paintedFrame();
}

function updateWorld(frame: Readonly<LiveWorldFrame>): void {
  if(mapInteraction.defer(()=>updateWorld(frame)))return;
  observerChrome.clear();
  lastFrame = frame;
  if (headlessAccelerationActive) {
    const worldLevel = frame.world.growth.stage + 1;
    worldTitle.textContent = `Мир · уровень ${worldLevel}`;
    updateWorldTime(frame);
    preferredSpeedId = frame.clock.speedId;
    preferredSpeedMultiplier = frame.clock.multiplier;
    showClockControl(frame.clock.speedId, frame.clock.multiplier);
    const timing = frame.liveTiming;
    if (timing?.actualWorldMinutesPerRealMinute !== undefined) {
      const rate = timing.actualWorldMinutesPerRealMinute;
      const tempo = rate >= WORLD_MINUTES_PER_YEAR
        ? `${(rate / WORLD_MINUTES_PER_YEAR).toFixed(1)} г.`
        : rate >= 1_440
          ? `${(rate / 1_440).toFixed(1)} дн.`
          : `${rate.toFixed(1)} мин.`;
      liveClockThroughput.textContent = `Фактически за минуту: ${tempo}` +
        (timing.capacityLimited ? ' · предел расчёта устройства' : '');
    }
    updateOfflineClockContinuity(frame);
    liveLabel.textContent = 'МИР УСКОРЕН';
    liveIndicator.classList.add('is-live');
    return;
  }
  const agents=Object.values(frame.world.agents).filter(agent=>agent.life.alive);
  syncResidentPicker(frame.world,agents);
  applyMapZoom();
  renderMap(frame);
  const humanPopulation = agents.filter(
    (agent) => (agent.race ?? 'human') === 'human',
  ).length;
  populationValue.textContent = `${humanPopulation} людей · ${agents.length} разумных`;
  growthValue.textContent = `${Object.keys(frame.world.places).length} мест · +${Math.round(
    frame.world.growth.explorationProgress * 100,
  )}%`;
  wildlifeValue.textContent = String(
    Object.values(frame.world.wildlife).reduce(
      (sum, population) =>
        sum + (population.isMonster === true ? 0 : population.count),
      0,
    ),
  );
  resourceValue.textContent = `${Math.round(frame.world.environment.resourcePool * 100)}%`;
  updateWorldTime(frame);
  settlementPicker.update(frame.world);
  if (frame.clock) {
    preferredSpeedId = frame.clock.speedId;
    preferredSpeedMultiplier = frame.clock.multiplier;
    showClockControl(frame.clock.speedId, frame.clock.multiplier);
  }
  const timing = frame.liveTiming;
  if (timing?.actualWorldMinutesPerRealMinute !== undefined) {
    const rate = timing.actualWorldMinutesPerRealMinute;
    const tempo = rate >= WORLD_MINUTES_PER_YEAR ? `${(rate / WORLD_MINUTES_PER_YEAR).toFixed(1)} г.` :
      rate >= 1440 ? `${(rate / 1440).toFixed(1)} дн.` : `${rate.toFixed(1)} мин.`;
    liveClockThroughput.textContent = `Фактически за минуту: ${tempo}` +
      (timing.capacityLimited ? ' · предел расчёта устройства, очередь ограничена' : '') +
      (timing.pendingWorldMinutes > frame.clock.worldMinutesPerTick * 2
        ? ` · осталось рассчитать ${worldDurationDescription(timing.pendingWorldMinutes)}` : '');
  }
  updateOfflineClockContinuity(frame);

  requiredElement<HTMLElement>('world-storage-details').textContent = worldStorageDiagnostics(frame.world, location.origin);
  if (frame.continuity.durable) {
    saveValue.textContent = `Сохранён: ${formatAinkradWorldTime(frame.world.calendar.elapsedWorldMinutes)}`;
    saveValue.title = frame.continuity.resumed ? `Загружен с ${formatAinkradWorldTime(frame.continuity.resumedFromWorldMinutes)}` : 'Новый мир';
    saveValue.classList.add('is-saved');
  } else {
    saveValue.textContent = 'Только сеанс';
    saveValue.classList.remove('is-saved');
  }

  if (frame.continuity.resumed && !continuityAnnounced) {
    liveLabel.textContent = 'МИР ПРОДОЛЖЕН';
    continuityAnnounced = true;
  } else {
    liveLabel.textContent = 'МИР ЖИВЁТ';
  }
  liveIndicator.classList.add('is-live');

  renderEventFeed(frame);
  renderAudibleConversations(frame);
  announceDisturbance(frame);
  updateSelection();
  refreshWorldInspector(frame.world);
}

type LiveWorldWorkerPayload =
  {
      type: 'frame';
      protocolVersion: string;
      frame: LiveWorldFrame;
    } | {
      type: 'catch_up_progress';
      protocolVersion: string;
      worldEpoch: number;
      fromWorldMinutes: number;
      currentWorldMinutes: number;
      targetWorldMinutes: number;
      percent: number;
      elapsedRealMs: number;
      estimatedRemainingMs: number | null;
      semanticQuantaProcessed: number;
      completed: boolean;
    } | {
      type: 'catch_up_recovery';
      protocolVersion: string;
      message: string;
      batchQuanta: number;
      abandoned: boolean;
    } | {
      type: 'clock_applied'; protocolVersion: string; worldEpoch: number; currentWorldMinutes: number;
      speedId: WorldSpeedId; multiplier: WorldSpeedMultiplier; discarded: boolean;
    } | {
      type: 'fatal';
      protocolVersion: string;
      message: string;
    };

type LiveWorldWorkerMessage = LiveWorldWorkerPayload & { clockRevision?: number };

async function requestPersistentAinkradStorage(): Promise<void> {
  if (!navigator.storage?.persist) return;
  try {
    const alreadyPersistent =
      typeof navigator.storage.persisted === 'function'
        ? await navigator.storage.persisted()
        : false;
    if (alreadyPersistent) return;
    const granted = await navigator.storage.persist();
    if (!granted) {
      console.warn('[Ainkrad storage] Persistent local storage was not granted.');
    }
  } catch {
    console.warn('[Ainkrad storage] Persistent-storage request failed.');
  }
}
void requestPersistentAinkradStorage();

const liveWorldWorker = new Worker(
  new URL('./runtime/liveWorld.worker.ts', import.meta.url),
  { type: 'module' },
);
const clockPanel = new WorldClockPanel({
  root: requiredElement<HTMLElement>('world-speed-select').closest<HTMLElement>('.external-clock')!,
  overlay: catchUpOverlay, status: offlineClockStatus, title: catchUpTitle, percent: catchUpPercent,
  bar: catchUpBar, detail: catchUpDetail, initialAnchor: pendingOfflineClockAnchor,
  storageAvailable: offlineClockStorageAvailable, anchorKey: OFFLINE_CLOCK_ANCHOR_KEY,
  preferenceKey: CLOCK_PREFERENCE_KEY, speedId: preferredSpeedId, multiplier: preferredSpeedMultiplier,
  post: message => liveWorldWorker.postMessage(message),
  onPreference: (speedId, multiplier) => {
    preferredSpeedId = speedId; preferredSpeedMultiplier = multiplier;
    maximumSpeedPresentation = isMaximumAccelerationSpeed(speedId);
    applyHeadlessAccelerationPresentation();
    showClockControl(speedId, multiplier);
  },
});


mapZoomOut.addEventListener('click', () => setMapZoom(mapZoom / 1.22));
mapZoomIn.addEventListener('click', () => setMapZoom(mapZoom * 1.22));
mapZoomFit.addEventListener('click', fitMapToViewport);
requiredElement<HTMLButtonElement>('map-city-focus').addEventListener('click', () => {
  if(!lastFrame)return;
  const focus = townMapFocus(lastFrame.world, selectedAgentId, mapCamera.width, mapCamera.height);
  if (focus) { mapCamera.x=focus.x;mapCamera.y=focus.y;setMapZoom(focus.pixelsPerUnit/100); }
});
requiredElement<HTMLButtonElement>('map-resident-focus').addEventListener('click', focusSelectedResident);
installWorldMapGestures(worldMapViewport,mapCamera,phase=>{
  mapZoom=mapCamera.pixelsPerUnit/100;mapInteraction.gesture(phase);
});
new ResizeObserver(scheduleMapPaint).observe(worldMapViewport);
residentDetailsOpen.addEventListener('click', () => {
  if (selectedAgentId) openWorldInspector('resident', selectedAgentId);
});
residentPicker.addEventListener('change', () => {
  selectedAgentId = residentPicker.value || undefined;
  updateSelection();
  focusSelectedResident();
});
residentSearch.addEventListener('input', () => {
  residentSearchQuery = residentSearch.value;
  residentPickerSignature = '';
  if (lastFrame) {
    const living = Object.values(lastFrame.world.agents).filter((agent) => agent.life.alive);
    syncResidentPicker(lastFrame.world, living);
  }
});
textScaleButton.addEventListener('click', () => {
  const currentIndex = TEXT_SCALE_STEPS.indexOf(textScale);
  textScale = TEXT_SCALE_STEPS[(currentIndex + 1) % TEXT_SCALE_STEPS.length];
  applyTextScale();
  try {
    localStorage.setItem(TEXT_SCALE_KEY, String(textScale));
  } catch {
    // Scaling remains active for this session when storage is blocked.
  }
});
worldInspectorClose.addEventListener('click', closeWorldInspector);
worldInspector.addEventListener('click', (event) => {
  if (event.target === worldInspector) closeWorldInspector();
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !worldInspector.hidden) closeWorldInspector();
});

function publishClockControl(initial = false): void {
  clockPanel.publish(preferredSpeedId, preferredSpeedMultiplier, initial);
}

worldSpeedSelect.addEventListener('change', () => {
  if (!isWorldSpeedId(worldSpeedSelect.value)) return;
  preferredSpeedId = worldSpeedSelect.value;
  preferredSpeedMultiplier = 1;
  publishClockControl();
});


resetWorldButton.addEventListener('click', () => {
  const accepted = window.confirm(
    'Начать новую эпоху Искорки? Текущая эпоха будет завершена.',
  );
  if (!accepted || window.prompt('Чтобы завершить текущую эпоху, введите НОВЫЙ МИР') !== 'НОВЫЙ МИР') return;
  pendingOfflineClockAnchor = undefined;
  clockPanel.reset();
  liveWorldWorker.postMessage({ type: 'reset_world' });
});

window.addEventListener('pagehide', () => {
  if (lastFrame) persistOfflineClockAnchor(lastFrame);
});

document.addEventListener('visibilitychange', () => {
  if (!lastFrame) return;
  if (document.visibilityState === 'hidden') {
    persistOfflineClockAnchor(lastFrame);
    return;
  }
  resumeOfflineClockFromStoredAnchor(lastFrame);
  updateOfflineClockContinuity(lastFrame);
});

window.addEventListener('pageshow', () => {
  if (!lastFrame) return;
  resumeOfflineClockFromStoredAnchor(lastFrame);
  updateOfflineClockContinuity(lastFrame);
});

publishClockControl(true);

liveWorldWorker.addEventListener(
  'message',
  (event: MessageEvent<LiveWorldWorkerMessage>) => {
    if (event.data.type === 'frame') {
      if (clockPanel.accepts(event.data.clockRevision ?? 0)) updateWorld(event.data.frame);
      return;
    }
    if (event.data.type === 'catch_up_progress') {
      if (clockPanel.accepts(event.data.clockRevision ?? 0)) {
        catchUpPresentation = !event.data.completed;
        applyHeadlessAccelerationPresentation();
        clockPanel.progress(event.data);
      }
      return;
    }
    if (event.data.type === 'clock_applied') {
      if (event.data.discarded) {
        catchUpPresentation = false;
        applyHeadlessAccelerationPresentation();
      }
      clockPanel.acknowledge(event.data);
      return;
    }
    if (event.data.type === 'catch_up_recovery') {
      if (!clockPanel.accepts(event.data.clockRevision ?? 0)) return;
      if (event.data.abandoned) {
        catchUpPresentation = false;
        applyHeadlessAccelerationPresentation();
        clockPanel.continuity.targetWorldMinutes = undefined;
        catchUpOverlay.hidden = true;
        offlineClockStatus.textContent =
          'Догон остановлен, мир продолжает жить с последнего сохранённого момента';
        offlineClockStatus.classList.remove('is-catching-up');
        worldMessage.textContent =
          `Браузер не смог записать даже минимальный пакет догона: ${event.data.message}. ` +
          'Сохранённый мир не удалён и продолжает жить с последней подтверждённой точки.';
      } else {
        catchUpOverlay.hidden = false;
        catchUpTitle.textContent = 'Продолжаем расчёт';
        catchUpDetail.textContent =
          `Браузеру требуется больше времени. ` +
          'Сохраняем уже прожитую историю.';
        offlineClockStatus.textContent =
          `Продолжаем с сохранённого момента`;
        offlineClockStatus.classList.add('is-catching-up');
      }
      return;
    }

    observerChrome.error(event.data.message);
    liveLabel.textContent = 'ОШИБКА МИРА';
    liveLabel.title = event.data.message;
    saveValue.textContent = event.data.message;
    liveIndicator.classList.remove('is-live');
    worldMessage.textContent = event.data.message;
    if (clockPanel.continuity.targetWorldMinutes !== undefined) {
      catchUpTitle.textContent = 'Догон остановлен';
      catchUpDetail.textContent = 'Подробности доступны в диагностике.';
    }
  },
);

liveWorldWorker.addEventListener('error', () => {
  observerChrome.error('Фоновый цикл мира остановился.');
  liveLabel.textContent = 'ОШИБКА МИРА';
  liveLabel.title = 'Фоновый цикл мира остановился.';
  liveIndicator.classList.remove('is-live');
  worldMessage.textContent = 'Фоновый цикл мира остановился.';
  if (clockPanel.continuity.targetWorldMinutes !== undefined) {
    catchUpTitle.textContent = 'Догон остановлен';
    catchUpDetail.textContent =
      'Фоновый цикл мира остановился. Перезагрузка продолжит с последней сохранённой точки.';
  }
});
