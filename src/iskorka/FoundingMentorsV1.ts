import type { AgentState, WildlifePopulation, WorldState } from '../world/types';
import { brainDevelopmentProfileV1 } from './BrainLifecycleV1';
import { ensureBrainForAgentV1 } from './BrainStateAdapterV1';
import { tryStoreBrainDatumV1 } from './BrainStateV1';
import {
  recordBodyDrinkV1,
  recordBodyMealV1,
  recordBodyMovementV1,
} from './BodyActionsV1';
import {
  applyIndependentPractice,
  applyOrdinaryLesson,
  type LearningPerson,
  type OrdinaryInstructor,
} from '../v15/KnowledgeTransfer';
import type { GenesisDomain } from '../v15/GenesisBootstrap';
import { consumeStoredResources, harvestRenewably } from '../v15/RenewableAgriculture';
import { ensureRussianKnowledgeV18 } from '../v18/UnderworldFoundationV18';
import { ensureLifeRhythmV18, recordMealV18 } from '../v18/LivelihoodAndRhythmV18';
import { placeSupportsCapabilityV1 } from './MedievalPlaceInfrastructureV1';
import { recordPhysicalGoodsV21 } from '../v21/EmergentSocietyV21';
import {
  consumeHomeWaterLitresV1,
  drawWellWaterLitresV1,
  homeWaterReserveFractionV1,
  nearestFoundationWellIdV1,
  refillHomeWaterFromWellV1,
} from './FoundationWaterV1';
import {
  recordMentorCareDevelopmentV1,
  recordMentorLessonDevelopmentV1,
  recordVoluntaryPracticeDevelopmentV1,
} from './NativeSparkDevelopmentV1';
import {
  brainAcceptsGuidedPracticeV1,
  recordGuidedPracticeExperienceV1,
  type GuidedPracticeExperienceV1,
} from './NativeSparkAgencyV1';

export const FOUNDING_SPARK_START_AGE_YEARS_V1 = 0.5;
export const FOUNDING_MENTOR_RELEASE_AGE_YEARS_V1 = 18;
export const FOUNDING_MENTOR_VERSION_V1 = 'iskorka-founding-mentors-v1' as const;
export const FOUNDING_MENTOR_VISIBILITY_RADIUS_V1 = 45;
const YEAR = 365 * 24 * 60;
const DAY = 24 * 60;
const SEMANTIC_QUANTUM = YEAR / 60;
const MAX_STUDENT_MESSAGES = 8;

export type FoundingMentorRoleV1 =
  | 'care_language'
  | 'agriculture_nature'
  | 'construction_craft'
  | 'household_health'
  | 'survival_navigation';

export type FoundingMentorStatusV1 =
  | 'caregiving'
  | 'farewell'
  | 'departing'
  | 'inactive';

export interface FoundingMentorMessageV1 {
  id: string;
  mentorId: string;
  studentId: string;
  worldMinute: number;
  symbols: string[];
  kind: 'care' | 'lesson' | 'body_education' | 'farewell';
}

export interface FoundingMentorStateV1 {
  id: string;
  name: string;
  role: FoundingMentorRoleV1;
  status: FoundingMentorStatusV1;
  locationId: string;
  position: { x: number; y: number };
  fullKnowledge: Record<GenesisDomain, number>;
  languageMastery: number;
  careMastery: number;
  lessonCount: number;
  feedingCount: number;
  careCount: number;
  lastLessonWorldMinute?: number;
  lastCareWorldMinute?: number;
  farewellWorldMinute?: number;
  departureWorldMinute?: number;
  departureOriginPosition?: { x: number; y: number };
  inactiveWorldMinute?: number;
}

export interface FoundingMentorWorldStateV1 {
  version: typeof FOUNDING_MENTOR_VERSION_V1;
  cohortStudentIds: string[];
  mentorsById: Record<string, FoundingMentorStateV1>;
  messagesByStudentId: Record<string, FoundingMentorMessageV1[]>;
  createdWorldMinute: number;
  releaseAgeYears: number;
  active: boolean;
  farewellStartedWorldMinute?: number;
  departureStartedWorldMinute?: number;
  deactivatedWorldMinute?: number;
  totalMeals: number;
  totalDrinks: number;
  totalLessons: number;
  totalCareActions: number;
}

const MENTOR_SPECS: ReadonlyArray<{
  id: string;
  name: string;
  role: FoundingMentorRoleV1;
}> = [
  { id: 'mentor_elena', name: 'Елена', role: 'care_language' },
  { id: 'mentor_alexey', name: 'Алексей', role: 'agriculture_nature' },
  { id: 'mentor_mikhail', name: 'Михаил', role: 'construction_craft' },
  { id: 'mentor_natalia', name: 'Наталья', role: 'household_health' },
  { id: 'mentor_sergey', name: 'Сергей', role: 'survival_navigation' },
] as const;

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

function stablePracticeUnitV1(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 0xffffffff;
}

type ReproductiveEducationStageV1 =
  | 'body_boundaries'
  | 'puberty'
  | 'conception'
  | 'pregnancy_birth'
  | 'adult_relationships_parenthood';

interface ReproductiveEducationSpecV1 {
  stage: ReproductiveEducationStageV1;
  minAgeYears: number;
  minComprehension: number;
  facts: readonly string[];
  spokenSummary: string;
}

const REPRODUCTIVE_EDUCATION_V1: readonly ReproductiveEducationSpecV1[] = [
  {
    stage: 'body_boundaries',
    minAgeYears: 6,
    minComprehension: 0.28,
    facts: [
      'У каждого человека есть личные границы тела.',
      'Интимное прикосновение требует согласия; отказ нужно уважать.',
      'Состояние тела и любопытство не создают обязанность вступать в близость.',
    ],
    spokenSummary: 'Твоё тело принадлежит тебе. У близости всегда должны быть границы и согласие.',
  },
  {
    stage: 'puberty',
    minAgeYears: 10,
    minComprehension: 0.45,
    facts: [
      'Во время взросления мужское и женское тело постепенно становится способным к размножению.',
      'Половое созревание меняет тело, но не создаёт любовь, согласие или желание ребёнка.',
      'Фертильность зависит от возраста, здоровья и состояния тела.',
    ],
    spokenSummary: 'По мере взросления тело меняется и становится способным к размножению, но решения о близости остаются личными.',
  },
  {
    stage: 'conception',
    minAgeYears: 13,
    minComprehension: 0.62,
    facts: [
      'Беременность может начаться после полового акта, если сперматозоид оплодотворит яйцеклетку.',
      'Половой акт не гарантирует зачатие, а зачатие не является автоматическим следствием любви или желания ребёнка.',
      'Взаимное согласие необходимо независимо от возможности зачатия.',
    ],
    spokenSummary: 'Я объясню биологию зачатия: половая близость может привести к оплодотворению, но это не происходит автоматически.',
  },
  {
    stage: 'pregnancy_birth',
    minAgeYears: 15,
    minComprehension: 0.72,
    facts: [
      'После зачатия развивающийся ребёнок растёт в матке во время беременности.',
      'Беременность длится много месяцев и создаёт дополнительную нагрузку и риски для организма матери.',
      'Роды завершают беременность; после них матери нужно восстановление, а новорождённому нужен постоянный уход.',
    ],
    spokenSummary: 'После зачатия начинается беременность, затем роды и долгий уход за новорождённым. Это серьёзная ответственность, а не просто событие.',
  },
  {
    stage: 'adult_relationships_parenthood',
    minAgeYears: 17,
    minComprehension: 0.82,
    facts: [
      'Сексуальное влечение, любовь, согласие, половой акт, желание ребёнка и фертильность — разные вещи.',
      'Половой акт взрослых людей возможен только по взаимному согласию.',
      'Решение о ребёнке требует учитывать здоровье, отношения, жильё, пищу, время и готовность заботиться о нём.',
      'Ни знание о размножении, ни половое созревание не создают обязанности вступать в отношения или заводить детей.',
    ],
    spokenSummary: 'Перед взрослой жизнью запомни: влечение, любовь, согласие, близость и желание ребёнка — не одно и то же. Решение всегда остаётся вашим.',
  },
] as const;

function teachReproductiveEducationV1(
  world: WorldState,
  student: AgentState,
  mentor: FoundingMentorStateV1,
): ReproductiveEducationStageV1 | undefined {
  const language = ensureRussianKnowledgeV18(world, student);
  const brain = ensureBrainForAgentV1(world, student);
  if (!brain) return undefined;

  const spec = REPRODUCTIVE_EDUCATION_V1.find((candidate) =>
    student.life.ageYears >= candidate.minAgeYears &&
    language.spokenComprehension >= candidate.minComprehension &&
    !brain.data.some((datum) => datum.id === `mentor-reproduction:${candidate.stage}`),
  );
  if (!spec) return undefined;

  const stored = tryStoreBrainDatumV1(brain, {
    id: `mentor-reproduction:${spec.stage}`,
    section: 'knowledge',
    kind: 'human_reproduction_education',
    source: 'message',
    encoded: JSON.stringify({
      stage: spec.stage,
      mentorId: mentor.id,
      mentorName: mentor.name,
      learnedWorldMinute: world.calendar.elapsedWorldMinutes,
      facts: [...spec.facts],
      constraints: {
        createsDesire: false,
        createsConsent: false,
        createsRelationship: false,
        createsPregnancy: false,
        createsParenthoodDecision: false,
      },
    }),
  });
  if (!stored) return undefined;

  const state = ensureFoundingMentorWorldV1(world);
  pushStudentMessage(state, {
    id: `mentor-body-education:${mentor.id}:${student.id}:${spec.stage}`,
    mentorId: mentor.id,
    studentId: student.id,
    worldMinute: world.calendar.elapsedWorldMinutes,
    symbols: [`${mentor.name}: ${spec.spokenSummary}`],
    kind: 'body_education',
  });
  rememberMentorSourceV1(world, student, mentor, `human-reproduction:${spec.stage}`);
  return spec.stage;
}

function roleDomain(role: FoundingMentorRoleV1): GenesisDomain | undefined {
  switch (role) {
    case 'agriculture_nature': return 'agriculture';
    case 'construction_craft': return 'construction';
    case 'household_health': return 'household';
    case 'survival_navigation': return 'survival';
    default: return undefined;
  }
}

export type FoundingGuardianRoutinePhaseV1 =
  | 'home_sleep'
  | 'fresh_air'
  | 'home_care'
  | 'learning_outing';

export function foundingMentorHomeIdV1(
  world: Readonly<WorldState>,
  mentorId: string,
): string | undefined {
  const first = foundingMentorStudentsV1(world, mentorId)[0];
  return first?.homeId;
}

function routinePhaseAtMinuteV1(worldMinute: number): FoundingGuardianRoutinePhaseV1 {
  const hour = ((Math.max(0, worldMinute) % DAY) / 60);
  if (hour < 7 || hour >= 20) return 'home_sleep';
  if (hour < 10) return 'fresh_air';
  if (hour < 12) return 'home_care';
  if (hour < 15) return 'learning_outing';
  if (hour < 18) return 'fresh_air';
  return 'home_care';
}

export function nextFoundingMentorRoutineBoundaryV1(worldMinute: number): number {
  const minute = Math.max(0, worldMinute);
  const dayStart = Math.floor(minute / DAY) * DAY;
  const minuteOfDay = minute - dayStart;
  for (const boundary of [7 * 60, 10 * 60, 12 * 60, 15 * 60, 18 * 60, 20 * 60, DAY]) {
    if (boundary > minuteOfDay + 1e-9) return dayStart + boundary;
  }
  return dayStart + DAY + 7 * 60;
}

export function foundingMentorRoutineDestinationAtV1(
  world: Readonly<WorldState>,
  mentor: Readonly<FoundingMentorStateV1>,
  studentAgeYears: number,
  worldMinute: number,
): string {
  const homeId = foundingMentorHomeIdV1(world, mentor.id) ?? 'commons';
  const phase = routinePhaseAtMinuteV1(worldMinute);
  if (phase === 'home_sleep') return homeId;
  if (phase === 'home_care') {
    const reserve = homeWaterReserveFractionV1(world, homeId);
    if (reserve < 0.35) {
      return nearestFoundationWellIdV1(world, homeId) ?? homeId;
    }
    return homeId;
  }

  const day = Math.floor(Math.max(0, worldMinute) / DAY);
  const mentorIndex = Math.max(0, MENTOR_SPECS.findIndex((spec) => spec.id === mentor.id));
  const pick = (ids: string[]): string => {
    const available = ids.filter((id) => Boolean(world.places[id]));
    if (available.length === 0) return homeId;
    return available[(day + mentorIndex) % available.length] ?? homeId;
  };

  if (phase === 'fresh_air') {
    const nearby = [
      'quiet_space',
      'commons',
      'foundation_well_west',
      'foundation_well_east',
    ];
    if (studentAgeYears >= 1.5) nearby.push('foundation_lake');
    return pick(nearby);
  }

  if (studentAgeYears < 3) return pick(['quiet_space', 'commons']);
  if (studentAgeYears < 5) return pick(['quiet_space', 'commons', 'resource_field']);
  if (studentAgeYears < 8) {
    return pick(['resource_field', 'workshop', 'foundation_lake', 'quiet_space']);
  }
  if (studentAgeYears < 12) {
    return pick(['resource_field', 'workshop', 'foundation_lake', 'meadow', 'forest']);
  }
  return pick([
    'resource_field','workshop','foundation_lake','meadow','forest','outskirts','river','lake',
  ]);
}

export function mentorTeachingPlaceV1(
  world: Readonly<WorldState>,
  mentor: Readonly<FoundingMentorStateV1>,
  studentAgeYears: number,
): string {
  return foundingMentorRoutineDestinationAtV1(
    world,
    mentor,
    studentAgeYears,
    world.calendar.elapsedWorldMinutes,
  );
}

export function placeFoundingMentorHouseholdsV1(world: WorldState): void {
  const state = world.iskorkaMentorsV1;
  if (!state?.active) return;
  Object.values(state.mentorsById).forEach((mentor, mentorIndex) => {
    const students = foundingMentorStudentsV1(world, mentor.id);
    const homeId = students[0]?.homeId;
    const home = homeId ? world.places[homeId] : undefined;
    if (!home || students.length === 0) return;
    students.forEach((child, childIndex) => {
      child.locationId = home.id;
      child.position = {
        x: home.mapX + (childIndex === 0 ? -0.12 : 0.12),
        y: home.mapY + (childIndex === 0 ? 0.08 : -0.08),
        layerId: 'surface',
      };
      child.movement = undefined;
    });
    mentor.locationId = home.id;
    mentor.position = {
      x: home.mapX + Math.cos((Math.PI * 2 * mentorIndex) / MENTOR_SPECS.length) * 0.2,
      y: home.mapY + Math.sin((Math.PI * 2 * mentorIndex) / MENTOR_SPECS.length) * 0.2,
    };
  });
}

function worldPlaceIsFoundationWellV1(placeId: string): boolean {
  return placeId === 'foundation_well_west' || placeId === 'foundation_well_east';
}

function mentorDomainAtCurrentPlaceV1(
  mentor: Readonly<FoundingMentorStateV1>,
  placeId: string,
  studentAgeYears: number,
): GenesisDomain | 'language' {
  // Before the existing knowledge-transfer system's minimum learning age,
  // mentors still talk, demonstrate and let children observe, but no adult
  // agriculture/construction/household/survival lesson is written.
  if (studentAgeYears < 5) return 'language';
  if (placeId === 'resource_field') return 'agriculture';
  if (placeId === 'workshop') return 'construction';
  if (worldPlaceIsFoundationWellV1(placeId)) return 'household';
  if (
    placeId === 'outskirts' ||
    placeId === 'forest' ||
    placeId === 'meadow' ||
    placeId === 'shore' ||
    placeId === 'river' ||
    placeId === 'lake' ||
    placeId === 'foundation_lake'
  ) return 'survival';
  if (placeId === 'commons') {
    return mentor.role === 'care_language' ? 'language' : 'household';
  }
  return roleDomain(mentor.role) ?? 'language';
}

function placePosition(world: Readonly<WorldState>, placeId: string, index: number): { x: number; y: number } {
  const place = world.places[placeId] ?? world.places.commons;
  const angle = (Math.PI * 2 * index) / MENTOR_SPECS.length;
  return {
    x: place.mapX + Math.cos(angle) * 0.6,
    y: place.mapY + Math.sin(angle) * 0.6,
  };
}

export function createFoundingMentorWorldV1(
  world: Readonly<WorldState>,
  studentIds: readonly string[],
): FoundingMentorWorldStateV1 {
  const mentorsById: Record<string, FoundingMentorStateV1> = {};
  MENTOR_SPECS.forEach((spec, index) => {
    mentorsById[spec.id] = {
      ...spec,
      status: 'caregiving',
      locationId: 'commons',
      position: placePosition(world, 'commons', index),
      fullKnowledge: {
        agriculture: 0.96,
        construction: 0.96,
        household: 0.96,
        survival: 0.96,
      },
      languageMastery: 1,
      careMastery: 1,
      lessonCount: 0,
      feedingCount: 0,
      careCount: 0,
    };
  });
  return {
    version: FOUNDING_MENTOR_VERSION_V1,
    cohortStudentIds: [...studentIds],
    mentorsById,
    messagesByStudentId: {},
    createdWorldMinute: world.calendar.elapsedWorldMinutes,
    releaseAgeYears: FOUNDING_MENTOR_RELEASE_AGE_YEARS_V1,
    active: true,
    totalMeals: 0,
    totalDrinks: 0,
    totalLessons: 0,
    totalCareActions: 0,
  };
}

export function ensureFoundingMentorWorldV1(world: WorldState): FoundingMentorWorldStateV1 {
  const existing = world.iskorkaMentorsV1;
  if (existing) return existing;
  const students = Object.values(world.agents)
    .filter((agent) => agent.life.generation === 0)
    .map((agent) => agent.id)
    .sort((left, right) => {
      const a = Number(left.match(/\d+$/)?.[0] ?? 0);
      const b = Number(right.match(/\d+$/)?.[0] ?? 0);
      return a - b || left.localeCompare(right);
    });
  const created = createFoundingMentorWorldV1(world, students);
  world.iskorkaMentorsV1 = created;
  placeFoundingMentorHouseholdsV1(world);
  return created;
}

export function isFoundingMentorIdV1(id: string): boolean {
  return MENTOR_SPECS.some((mentor) => mentor.id === id);
}

export function isFoundingCohortStudentV1(
  world: Readonly<WorldState>,
  agentId: string,
): boolean {
  return world.iskorkaMentorsV1?.cohortStudentIds.includes(agentId) ?? false;
}

export function isMentoredMinorV1(
  world: Readonly<WorldState>,
  agent: Readonly<AgentState>,
): boolean {
  const state = world.iskorkaMentorsV1;
  return Boolean(
    state?.active &&
    state.cohortStudentIds.includes(agent.id) &&
    agent.life.alive &&
    agent.life.ageYears < state.releaseAgeYears,
  );
}

export function assignedFoundingMentorV1(
  world: Readonly<WorldState>,
  agentId: string,
): FoundingMentorStateV1 | undefined {
  const state = world.iskorkaMentorsV1;
  if (!state?.active) return undefined;
  const studentIndex = state.cohortStudentIds.indexOf(agentId);
  if (studentIndex < 0) return undefined;
  // Permanent family-like guardianship: exactly one mentor for every two
  // founding children. The caregiver never rotates annually.
  const mentorIndex = Math.min(
    MENTOR_SPECS.length - 1,
    Math.floor(studentIndex / 2),
  );
  return state.mentorsById[MENTOR_SPECS[mentorIndex].id];
}

export function foundingMentorStudentsV1(
  world: Readonly<WorldState>,
  mentorId: string,
): AgentState[] {
  const state = world.iskorkaMentorsV1;
  if (!state?.active) return [];
  return state.cohortStudentIds
    .map((id) => world.agents[id])
    .filter((agent): agent is AgentState =>
      Boolean(
        agent?.life.alive &&
        assignedFoundingMentorV1(world, agent.id)?.id === mentorId,
      ),
    );
}

function pushStudentMessage(
  state: FoundingMentorWorldStateV1,
  message: FoundingMentorMessageV1,
): void {
  const list = state.messagesByStudentId[message.studentId] ?? [];
  list.push(message);
  while (list.length > MAX_STUDENT_MESSAGES) list.shift();
  state.messagesByStudentId[message.studentId] = list;
}

export function recentFoundingMentorMessagesV1(
  world: Readonly<WorldState>,
  studentId: string,
  maxAgeWorldMinutes = SEMANTIC_QUANTUM * 2,
): FoundingMentorMessageV1[] {
  const now = world.calendar.elapsedWorldMinutes;
  return (world.iskorkaMentorsV1?.messagesByStudentId[studentId] ?? [])
    .filter((message) => now >= message.worldMinute && now - message.worldMinute <= maxAgeWorldMinutes)
    .map((message) => ({ ...message, symbols: [...message.symbols] }));
}

function mentorLearningPerson(world: WorldState, student: AgentState): LearningPerson | undefined {
  const profile = world.v15?.knowledgeByAgentId[student.id];
  if (!profile) return undefined;
  return {
    id: student.id,
    generation: student.life.generation,
    ageYears: student.life.ageYears,
    aptitude: profile.aptitude,
    knowledge: profile,
  };
}

function mentorInstructor(mentor: Readonly<FoundingMentorStateV1>): OrdinaryInstructor {
  return {
    id: mentor.id,
    generation: -1,
    ageYears: 42,
    ordinaryResident: true,
    aptitude: {
      agriculture: 1,
      construction: 1,
      household: 1,
      survival: 1,
    },
    knowledge: { ...mentor.fullKnowledge },
  };
}

function teachLanguageV1(
  world: WorldState,
  student: AgentState,
  mentor: FoundingMentorStateV1,
): number {
  const language = ensureRussianKnowledgeV18(world, student);
  const development = brainDevelopmentProfileV1(student.life.ageYears);
  const before =
    language.spokenComprehension +
    language.spokenExpression +
    language.vocabulary +
    language.cyrillicLiteracy;
  const age = student.life.ageYears;

  language.spokenComprehension = Math.min(
    development.receptiveLanguage,
    language.spokenComprehension + 0.0016 + development.receptiveLanguage * 0.0034,
  );
  language.spokenExpression = Math.min(
    development.expressiveLanguage,
    language.spokenExpression + (age >= 0.75 ? 0.001 + development.expressiveLanguage * 0.003 : 0),
  );
  language.vocabulary = Math.min(
    Math.max(development.receptiveLanguage, development.expressiveLanguage),
    language.vocabulary + (age >= 0.75 ? 0.0012 + development.semanticLearning * 0.0025 : 0.0004),
  );
  if (age >= 5) {
    language.cyrillicLiteracy = Math.min(
      development.symbolicReasoning,
      language.cyrillicLiteracy + 0.001 + development.symbolicReasoning * 0.0022,
    );
  }
  language.teachingCount += 1;

  const after =
    language.spokenComprehension +
    language.spokenExpression +
    language.vocabulary +
    language.cyrillicLiteracy;
  return Math.max(0, after - before);
}

function rememberMentorSourceV1(
  world: WorldState,
  student: AgentState,
  mentor: Readonly<FoundingMentorStateV1>,
  sourceKey: string,
): void {
  const brain = ensureBrainForAgentV1(world, student);
  if (!brain) return;
  const id = `mentor-source:${mentor.id}:${sourceKey}`;
  if (brain.data.some((datum) => datum.id === id)) return;
  tryStoreBrainDatumV1(brain, {
    id,
    section: 'knowledge',
    kind: 'mentor_source',
    source: 'message',
    encoded: JSON.stringify({
      mentorId: mentor.id,
      mentorName: mentor.name,
      sourceKey,
      firstLearnedWorldMinute: world.calendar.elapsedWorldMinutes,
    }),
  });
}

function skillPracticeFromDomain(
  student: AgentState,
  domain: GenesisDomain,
  gained: number,
): void {
  const practice = Math.min(0.006, gained * 0.45 + 0.0003);
  if (domain === 'agriculture') {
    student.skills.gathering = clamp01(student.skills.gathering + practice);
  } else if (domain === 'construction') {
    student.skills.craft = clamp01(student.skills.craft + practice);
  } else if (domain === 'household') {
    student.skills.social = clamp01(student.skills.social + practice);
  } else if (domain === 'survival') {
    // Generic navigation practice must not magically create hunting skill.
    // Hunting/fishing progress is added only by a real wildlife attempt below.
    student.skills.exploration = clamp01(student.skills.exploration + practice);
  }
}

function practiceActionForDomainV1(
  domain: GenesisDomain,
): GuidedPracticeExperienceV1['action'] {
  if (domain === 'agriculture') return 'gather_food';
  if (domain === 'construction') return 'work';
  if (domain === 'household') return 'fetch_water';
  return 'explore';
}

function guidedWildlifeTargetV1(
  world: Readonly<WorldState>,
  student: Readonly<AgentState>,
  placeId: string,
  fishing: boolean,
): WildlifePopulation | undefined {
  const candidates = Object.values(world.wildlife)
    .filter((population) =>
      !population.isMonster &&
      population.habitatId === placeId &&
      population.count > 0 &&
      (fishing
        ? population.species === 'fish'
        : ['rabbit', 'deer', 'boar', 'bird'].includes(population.species)),
    )
    .sort((left, right) => left.id.localeCompare(right.id));
  if (candidates.length === 0) return undefined;
  const roll = stablePracticeUnitV1(
    `${world.bootstrapSeed ?? world.id}:${student.id}:${placeId}:${Math.floor(world.calendar.elapsedWorldMinutes / DAY)}:${fishing ? 'fish' : 'hunt'}`,
  );
  return candidates[Math.min(candidates.length - 1, Math.floor(roll * candidates.length))];
}

function performGuidedWildlifePracticeV1(
  world: WorldState,
  student: AgentState,
  population: WildlifePopulation,
  fishing: boolean,
): { attempted: boolean; harvested: boolean; defensiveEncounter: boolean } {
  const reserveFloor = Math.max(2, Math.floor(population.carryingCapacity * 0.3));
  const canHarvest = population.count > reserveFloor;
  const successChance = clamp01(
    (fishing ? 0.48 : 0.38) +
      student.skills.hunting * 0.24 +
      student.personality.diligence * 0.08 +
      student.life.physiology.endurance * 0.07 +
      student.life.physiology.strength * (fishing ? 0.02 : 0.06) -
      population.alertness * 0.14 -
      population.threat * (fishing ? 0.04 : 0.12),
  );
  const harvestRoll = stablePracticeUnitV1(
    `${world.bootstrapSeed ?? world.id}:${student.id}:${population.id}:${Math.floor(world.calendar.elapsedWorldMinutes / SEMANTIC_QUANTUM)}:harvest`,
  );
  const harvested = canHarvest && harvestRoll < successChance;
  if (harvested) {
    population.count = Math.max(0, population.count - 1);
    population.lastChangedAt = world.now;
    const meat = population.species === 'deer' ? 0.16
      : population.species === 'boar' ? 0.15
        : population.species === 'rabbit' ? 0.07
          : population.species === 'fish' ? 0.055
            : 0.04;
    recordPhysicalGoodsV21(world, student, 'meat', meat);
  }

  // A supervised boar encounter can produce genuine defensive/combat
  // experience.  It is never granted for merely standing in the forest.
  const defensiveEncounter =
    !fishing &&
    population.species === 'boar' &&
    stablePracticeUnitV1(
      `${world.bootstrapSeed ?? world.id}:${student.id}:${population.id}:${Math.floor(world.calendar.elapsedWorldMinutes / SEMANTIC_QUANTUM)}:defence`,
    ) < 0.42;
  if (defensiveEncounter && student.progression) {
    student.progression.combatMastery = clamp01(
      student.progression.combatMastery + (harvested ? 0.004 : 0.002),
    );
    student.stress = clamp01(student.stress + (harvested ? 0.004 : 0.012));
  }
  student.skills.hunting = clamp01(
    student.skills.hunting + (harvested ? 0.0045 : 0.0018),
  );
  recordBodyMovementV1(world, student, fishing ? 45 : 65, fishing ? 0.2 : 0.32);
  return { attempted: true, harvested, defensiveEncounter };
}

function performGuidedPhysicalPracticeV1(
  world: WorldState,
  student: AgentState,
  mentor: FoundingMentorStateV1,
  domain: GenesisDomain,
): boolean {
  const place = world.places[student.locationId];
  if (!place || mentor.locationId !== student.locationId) return false;
  let succeeded = false;
  let action = practiceActionForDomainV1(domain);
  let targetPopulationId: string | undefined;
  let targetSpecies: string | undefined;
  let harvested: boolean | undefined;
  let defensiveEncounter: boolean | undefined;

  if (domain === 'agriculture' && place.kind === 'resource_field') {
    const resources = world.v15?.renewableResources;
    const knowledge = world.v15?.knowledgeByAgentId[student.id]?.agriculture ?? 0;
    if (resources) {
      const harvestedResult = harvestRenewably(
        resources,
        {
          id: student.id,
          agricultureKnowledge: knowledge,
          diligence: student.personality.diligence,
        },
        {
          eventId: `guided-harvest:${mentor.id}:${student.id}:${Math.floor(world.calendar.elapsedWorldMinutes / SEMANTIC_QUANTUM)}`,
          worldMinutes: world.calendar.elapsedWorldMinutes,
          effort: 0.08,
        },
      );
      Object.assign(resources, {
        ...harvestedResult.next,
        storedResources: clamp01(harvestedResult.next.storedResources),
      });
      succeeded = harvestedResult.harvested > 0;
    }
    recordBodyMovementV1(world, student, 45, 0.24);
  } else if (
    domain === 'construction' &&
    place.kind === 'workshop' &&
    placeSupportsCapabilityV1(place, 'general_craft')
  ) {
    recordBodyMovementV1(world, student, 50, 0.3);
    succeeded = true;
  } else if (domain === 'household' && place.kind === 'well') {
    const fetched = refillHomeWaterFromWellV1(
      world,
      student.homeId,
      place.id,
      4,
    );
    recordBodyMovementV1(world, student, 25, 0.18);
    succeeded = fetched > 0;
  } else if (
    domain === 'survival' &&
    (
      ['quiet_space', 'foundation_lake', 'meadow', 'forest', 'outskirts', 'river', 'lake']
        .includes(place.id) ||
      ['quiet_space', 'meadow', 'forest', 'outskirts', 'shore', 'river', 'lake']
        .includes(place.kind)
    )
  ) {
    const fishing =
      student.life.ageYears >= 10 &&
      (place.id === 'foundation_lake' || place.kind === 'lake' || place.kind === 'river');
    const hunting =
      student.life.ageYears >= 12 &&
      !fishing &&
      (place.id === 'outskirts' || place.kind === 'outskirts' || place.kind === 'forest' || place.kind === 'meadow');
    const population = fishing
      ? guidedWildlifeTargetV1(world, student, place.id, true)
      : hunting
        ? guidedWildlifeTargetV1(world, student, place.id, false)
        : undefined;
    if (population) {
      action = fishing ? 'fish' : 'hunt';
      targetPopulationId = population.id;
      targetSpecies = population.species;
      const outcome = performGuidedWildlifePracticeV1(
        world,
        student,
        population,
        fishing,
      );
      succeeded = outcome.attempted;
      harvested = outcome.harvested;
      defensiveEncounter = outcome.defensiveEncounter;
    } else {
      recordBodyMovementV1(world, student, 50, 0.24);
      succeeded = true;
    }
  }

  recordGuidedPracticeExperienceV1(world, student, {
    domain,
    action,
    placeId: place.id,
    mentorId: mentor.id,
    worldMinute: world.calendar.elapsedWorldMinutes,
    succeeded,
    ...(targetPopulationId ? { targetPopulationId } : {}),
    ...(targetSpecies ? { targetSpecies } : {}),
    ...(harvested === undefined ? {} : { harvested }),
    ...(defensiveEncounter === undefined ? {} : { defensiveEncounter }),
  });
  return succeeded;
}

export type FoundingMentorEducationDomainV1 =
  | GenesisDomain
  | 'language'
  | 'human_reproduction';

export interface FoundingMentorLessonResultV1 {
  taught: boolean;
  mentorId?: string;
  domain?: FoundingMentorEducationDomainV1;
  reproductiveEducationStage?: ReproductiveEducationStageV1;
  mode?: 'demonstration' | 'guided_practice';
  gained: number;
}

export function applyFoundingMentorLessonV1(
  world: WorldState,
  student: AgentState,
  mentor: FoundingMentorStateV1,
): FoundingMentorLessonResultV1 {
  if (!student.life.alive || student.life.ageYears >= FOUNDING_MENTOR_RELEASE_AGE_YEARS_V1) {
    return { taught: false, gained: 0 };
  }
  if (mentor.status !== 'caregiving') return { taught: false, gained: 0 };
  if (mentor.locationId !== student.locationId) return { taught: false, gained: 0 };
  if (
    mentor.locationId === 'workshop' &&
    !placeSupportsCapabilityV1(world.places[mentor.locationId], 'general_craft')
  ) {
    return { taught: false, gained: 0 };
  }

  const now = world.calendar.elapsedWorldMinutes;
  const reproductiveEducationStage = teachReproductiveEducationV1(
    world,
    student,
    mentor,
  );
  if (reproductiveEducationStage) {
    recordMentorLessonDevelopmentV1(student, 0.01);
    mentor.lessonCount += 1;
    mentor.lastLessonWorldMinute = now;
    const state = ensureFoundingMentorWorldV1(world);
    state.totalLessons += 1;
    return {
      taught: true,
      mentorId: mentor.id,
      domain: 'human_reproduction',
      reproductiveEducationStage,
      mode: 'demonstration',
      gained: 0.01,
    };
  }

  let gained = 0;
  let domain: FoundingMentorEducationDomainV1 = 'language';
  const lessonDomain = mentorDomainAtCurrentPlaceV1(
    mentor,
    mentor.locationId,
    student.life.ageYears,
  );
  const primaryDomain = lessonDomain === 'language' ? undefined : lessonDomain;

  if (lessonDomain === 'language') {
    gained = teachLanguageV1(world, student, mentor);
    domain = 'language';
    rememberMentorSourceV1(world, student, mentor, 'language');
  } else if (primaryDomain) {
    const learner = mentorLearningPerson(world, student);
    if (learner) {
      const lesson = applyOrdinaryLesson(
        mentorInstructor(mentor),
        learner,
        {
          lessonId: `mentor-lesson:${mentor.id}:${student.id}:${Math.floor(now / SEMANTIC_QUANTUM)}`,
          domain: primaryDomain,
          instructorId: mentor.id,
          learnerId: student.id,
          worldMinutes: now,
          durationWorldMinutes: 180,
          activityVerified: true,
        },
      );
      let practiceGained = 0;
      let physicalPracticeSucceeded = false;
      const acceptedPractice =
        student.life.ageYears >= 8 &&
        brainAcceptsGuidedPracticeV1(world, student, primaryDomain);
      if (acceptedPractice) {
        // First do the physical attempt.  Knowledge-transfer credit is only
        // granted afterwards when that attempt actually happened in the world.
        physicalPracticeSucceeded = performGuidedPhysicalPracticeV1(
          world,
          student,
          mentor,
          primaryDomain,
        );
        if (physicalPracticeSucceeded) {
          const practice = applyIndependentPractice(
            learner,
            {
              practiceId: `mentor-practice:${mentor.id}:${student.id}:${Math.floor(now / SEMANTIC_QUANTUM)}`,
              personId: student.id,
              domain: primaryDomain,
              worldMinutes: now,
              durationWorldMinutes: student.life.ageYears >= 12 ? 120 : 45,
              activityVerified: true,
              challenge: student.life.ageYears >= 12 ? 0.52 : 0.18,
            },
          );
          practiceGained = practice.gained;
        }
      }
      if (student.life.ageYears >= 8) {
        recordVoluntaryPracticeDevelopmentV1(
          student,
          acceptedPractice,
          physicalPracticeSucceeded,
        );
      }
      gained = lesson.gained + practiceGained;
      domain = primaryDomain;
      if (acceptedPractice && physicalPracticeSucceeded) {
        const ageScale = student.life.ageYears < 12 ? 0.35 : 1;
        skillPracticeFromDomain(student, primaryDomain, gained * ageScale);
      }
      rememberMentorSourceV1(world, student, mentor, primaryDomain);
    }
    gained += teachLanguageV1(world, student, mentor) * 0.25;
  }

  recordMentorLessonDevelopmentV1(student, gained);
  mentor.lessonCount += 1;
  mentor.lastLessonWorldMinute = now;
  const state = ensureFoundingMentorWorldV1(world);
  state.totalLessons += 1;
  const physicalPracticeRemembered =
    domain !== 'language' &&
    ensureBrainForAgentV1(world, student)?.data.some(
      (datum) =>
        datum.kind === 'mentor_guided_physical_practice' &&
        (() => {
          try {
            const parsed = JSON.parse(datum.encoded) as { worldMinute?: number; domain?: string; succeeded?: boolean };
            return parsed.worldMinute === now && parsed.domain === domain && parsed.succeeded === true;
          } catch {
            return false;
          }
        })(),
    ) === true;
  const mode: FoundingMentorLessonResultV1['mode'] =
    physicalPracticeRemembered ? 'guided_practice' : 'demonstration';
  pushStudentMessage(state, {
    id: `mentor-message:${mentor.id}:${student.id}:${Math.floor(now / SEMANTIC_QUANTUM)}`,
    mentorId: mentor.id,
    studentId: student.id,
    worldMinute: now,
    symbols: domain === 'language'
      ? [`${mentor.name}: я рядом. Слушай, смотри, повторяй и спрашивай, если не понял.`]
      : mode === 'demonstration'
        ? [`${mentor.name}: сначала я покажу сам. Ты смотри и спрашивай — это урок, не работа.`]
        : [`${mentor.name}: сначала я покажу. Если хочешь — попробуй рядом со мной; это обучение, не обязанность работать.`],
    kind: 'lesson',
  });

  return { taught: true, mentorId: mentor.id, domain, mode, gained };
}

export interface FoundingMentorCareResultV1 {
  cared: boolean;
  resourcesChanged: boolean;
}

export function applyFoundingMentorCareV1(
  world: WorldState,
  student: AgentState,
): FoundingMentorCareResultV1 {
  const state = ensureFoundingMentorWorldV1(world);
  if (!isMentoredMinorV1(world, student)) return { cared: false, resourcesChanged: false };
  const mentor = assignedFoundingMentorV1(world, student.id);
  if (!mentor) return { cared: false, resourcesChanged: false };
  const mentorDistance = Math.hypot(
    mentor.position.x - student.position.x,
    mentor.position.y - student.position.y,
  );
  if (
    mentor.locationId !== student.locationId ||
    mentorDistance > 2 ||
    student.movement
  ) {
    return { cared: false, resourcesChanged: false };
  }
  const body = world.v21?.bodiesByAgentId[student.id];
  const core = body?.bodyCore;
  if (!body || !core) return { cared: false, resourcesChanged: false };

  const resources = world.v15?.renewableResources;
  let resourcesChanged = false;
  if (
    resources &&
    resources.storedResources < 0.35 &&
    mentor.locationId === 'resource_field'
  ) {
    // Provisioning is a real mentor action at the field. Caregivers no longer
    // harvest magically from the nursery or make children provide for
    // themselves.
    const harvested = harvestRenewably(
      resources,
      {
        id: mentor.id,
        agricultureKnowledge: mentor.fullKnowledge.agriculture,
        diligence: 0.95,
      },
      {
        eventId: `mentor-harvest:${mentor.id}:${Math.floor(world.calendar.elapsedWorldMinutes / SEMANTIC_QUANTUM)}`,
        worldMinutes: world.calendar.elapsedWorldMinutes,
        effort: 0.48,
      },
    );
    Object.assign(resources, harvested.next);
    resourcesChanged = harvested.harvested > 0;
  }

  const age = student.life.ageYears;
  const mealPortion = age < 1 ? 0.18 : age < 3 ? 0.22 : age < 8 ? 0.25 : 0.28;
  const drinkAmount = age < 1 ? 0.16 : age < 5 ? 0.2 : 0.24;
  const careCost = 0.0007 * (0.72 + Math.min(1, age / 12) * 0.28);
  const hasFood = Boolean(resources && resources.storedResources >= careCost);
  if (resources && hasFood) {
    Object.assign(resources, consumeStoredResources(resources, careCost));
    resourcesChanged = true;
    recordBodyMealV1(world, student, mealPortion);
    recordMealV18(world, student, mealPortion);
    state.totalMeals += 1;
    mentor.feedingCount += 1;
  }
  const physicalDrinkLitres =
    age < 1 ? 0.16 : age < 5 ? 0.22 : age < 12 ? 0.28 : 0.34;
  let suppliedWaterLitres = 0;
  const currentPlace = world.places[mentor.locationId];
  if (currentPlace?.kind === 'well') {
    refillHomeWaterFromWellV1(
      world,
      student.homeId,
      currentPlace.id,
      18,
    );
    suppliedWaterLitres = drawWellWaterLitresV1(
      world,
      currentPlace.id,
      physicalDrinkLitres,
    );
  } else {
    suppliedWaterLitres = consumeHomeWaterLitresV1(
      world,
      student.homeId,
      physicalDrinkLitres,
    );
  }
  if (suppliedWaterLitres >= physicalDrinkLitres * 0.95) {
    recordBodyDrinkV1(world, student, drinkAmount);
    state.totalDrinks += 1;
  }

  const rhythm = ensureLifeRhythmV18(world, student);
  if (hasFood) {
    rhythm.satiety = Math.max(rhythm.satiety, age < 1 ? 0.72 : 0.66);
  }

  student.energy = Math.max(student.energy, age < 3 ? 0.78 : 0.7);
  student.stress = clamp01(student.stress - (age < 5 ? 0.045 : 0.025));
  // Do not grant a child carried provisions, a profession motive or any
  // scripted mental need. Food/water/care come from the guardian's actions.

  // Scripted caregivers can clean/tend injuries and support ordinary recovery,
  // but they do not erase wounds or diseases instantly.
  for (const wound of body.wounds) {
    wound.bleeding = clamp01(wound.bleeding - 0.025 * mentor.careMastery);
    wound.contamination = clamp01(wound.contamination - 0.035 * mentor.careMastery);
    wound.pain = clamp01(wound.pain - 0.015 * mentor.careMastery);
    wound.lastTreatedWorldMinute = world.calendar.elapsedWorldMinutes;
  }
  for (const disease of body.diseases) {
    disease.severity = clamp01(disease.severity - 0.012 * mentor.careMastery);
    disease.lastObservedWorldMinute = world.calendar.elapsedWorldMinutes;
  }
  if (body.wounds.length > 0 || body.diseases.length > 0) {
    student.life.health = clamp01(student.life.health + 0.0025 * mentor.careMastery);
  }

  mentor.careCount += 1;
  mentor.lastCareWorldMinute = world.calendar.elapsedWorldMinutes;
  state.totalCareActions += 1;

  if (age < 5) {
    pushStudentMessage(state, {
      id: `mentor-care:${mentor.id}:${student.id}:${Math.floor(world.calendar.elapsedWorldMinutes / SEMANTIC_QUANTUM)}`,
      mentorId: mentor.id,
      studentId: student.id,
      worldMinute: world.calendar.elapsedWorldMinutes,
      symbols: [`${mentor.name}: я рядом. Сначала поедим, потом будем смотреть и учиться.`],
      kind: 'care',
    });
  }
  recordMentorCareDevelopmentV1(
    student,
    hasFood && suppliedWaterLitres > 0 ? 1 : 0.55,
  );
  return { cared: true, resourcesChanged };
}

export function updateMentorTeachingPositionsV1(world: WorldState): void {
  const state = ensureFoundingMentorWorldV1(world);
  if (!state.active) return;

  Object.values(state.mentorsById).forEach((mentor, index) => {
    if (mentor.status !== 'caregiving') return;
    const students = foundingMentorStudentsV1(world, mentor.id);
    if (students.length === 0) return;

    // The guardian is physically with the pair. The mentor never teleports to
    // a workplace and leaves the children behind merely because a lesson is
    // scheduled there.
    const anchor =
      students.find((student) => Boolean(student.movement)) ??
      students[0];
    const together = students.filter(
      (student) => student.locationId === anchor.locationId,
    );
    const group = together.length > 0 ? together : [anchor];
    const baseX = group.reduce((sum, student) => sum + student.position.x, 0) / group.length;
    const baseY = group.reduce((sum, student) => sum + student.position.y, 0) / group.length;
    const angle = (Math.PI * 2 * index) / MENTOR_SPECS.length;

    mentor.locationId = anchor.locationId;
    mentor.position = {
      x: baseX + Math.cos(angle) * 0.35,
      y: baseY + Math.sin(angle) * 0.35,
    };
  });
}

function allFoundersAdult(world: Readonly<WorldState>, state: Readonly<FoundingMentorWorldStateV1>): boolean {
  const living = state.cohortStudentIds
    .map((id) => world.agents[id])
    .filter((agent): agent is AgentState => Boolean(agent?.life.alive));
  return living.length > 0 && living.every((agent) => agent.life.ageYears >= state.releaseAgeYears);
}

function sendFarewell(
  world: WorldState,
  state: FoundingMentorWorldStateV1,
  mentor: FoundingMentorStateV1,
): void {
  const students = foundingMentorStudentsV1(world, mentor.id);
  for (const student of students) {
    if (!student.life.alive) continue;
    const message =
      `${mentor.name}: ты уже взрослый. Я больше не буду кормить, поить или решать за тебя, и назад не вернусь. ` +
      'Запасы еды и воды конечны: воду мы брали из колодцев, пищу выращивали, собирали, ловили и добывали. ' +
      'В мастерской инструменты работают только вместе со знаниями и практикой. ' +
      'В библиотеке есть часть записанных знаний мира, но искать их там или нет — решать только тебе. ' +
      'Если ты чего-то не знаешь, дальше тебе придётся самому наблюдать, спрашивать, читать, пробовать и делать выводы. Прощай.';

    pushStudentMessage(state, {
      id: `mentor-farewell:${mentor.id}:${student.id}`,
      mentorId: mentor.id,
      studentId: student.id,
      worldMinute: world.calendar.elapsedWorldMinutes,
      symbols: [message],
      kind: 'farewell',
    });

    const brain = ensureBrainForAgentV1(world, student);
    if (brain) {
      tryStoreBrainDatumV1(brain, {
        id: `mentor-farewell-orientation:${mentor.id}`,
        section: 'knowledge',
        kind: 'mentor_farewell_orientation',
        source: 'message',
        encoded: JSON.stringify({
          mentorId: mentor.id,
          mentorName: mentor.name,
          learnedWorldMinute: world.calendar.elapsedWorldMinutes,
          facts: [
            'Наставник уходит окончательно и больше не будет обеспечивать взрослую Искру.',
            'Еда и вода конечны и не появляются сами.',
            'Вода в Основании набиралась из колодцев.',
            'Пища требует выращивания, собирательства, рыбной ловли или охоты.',
            'Инструменты мастерской требуют знаний и практики.',
            'Библиотека содержит часть записанных знаний мира.',
            'Идти в библиотеку или нет — личное решение.',
            'Неизвестное можно узнавать через наблюдение, разговор, чтение, попытки и собственные выводы.',
          ],
          constraints: {
            createsTask: false,
            createsGoal: false,
            forcesLibraryVisit: false,
            forcesWork: false,
            forcesSurvivalAction: false,
          },
        }),
      });
    }
  }
}

function mentorVisibleToAnySpark(world: Readonly<WorldState>, mentor: Readonly<FoundingMentorStateV1>): boolean {
  for (const agent of Object.values(world.agents)) {
    if (!agent.life.alive) continue;
    const distance = Math.hypot(agent.position.x - mentor.position.x, agent.position.y - mentor.position.y);
    if (distance <= FOUNDING_MENTOR_VISIBILITY_RADIUS_V1) return true;
  }
  return false;
}

export function advanceFoundingMentorLifecycleV1(world: WorldState): void {
  const state = ensureFoundingMentorWorldV1(world);
  if (!state.active) return;
  const now = world.calendar.elapsedWorldMinutes;

  if (!state.farewellStartedWorldMinute && allFoundersAdult(world, state)) {
    state.farewellStartedWorldMinute = now;
    for (const mentor of Object.values(state.mentorsById)) {
      mentor.status = 'farewell';
      mentor.farewellWorldMinute = now;
      // Do not teleport the caregiver to a ceremonial square. Farewell happens
      // wherever the guardian actually is with their own two young adults.
      sendFarewell(world, state, mentor);
    }
    return;
  }

  if (
    state.farewellStartedWorldMinute !== undefined &&
    state.departureStartedWorldMinute === undefined &&
    now - state.farewellStartedWorldMinute >= SEMANTIC_QUANTUM
  ) {
    state.departureStartedWorldMinute = now;
    for (const mentor of Object.values(state.mentorsById)) {
      mentor.status = 'departing';
      mentor.departureWorldMinute = now;
      mentor.departureOriginPosition = { ...mentor.position };
      // Keep the real last place; only the visible actor walks outward.
      // locationId is not rewritten to a distant place by teleportation.
    }
  }

  if (state.departureStartedWorldMinute !== undefined) {
    const commons = world.places.commons;
    const outskirts = world.places.outskirts;
    const dx = (outskirts?.mapX ?? commons.mapX + 1) - commons.mapX;
    const dy = (outskirts?.mapY ?? commons.mapY) - commons.mapY;
    const length = Math.max(0.001, Math.hypot(dx, dy));
    const ux = dx / length;
    const uy = dy / length;
    const elapsedQuanta = Math.max(1, (now - state.departureStartedWorldMinute) / SEMANTIC_QUANTUM + 1);
    for (const mentor of Object.values(state.mentorsById)) {
      if (mentor.status !== 'departing') continue;
      const start =
        mentor.departureOriginPosition ??
        { ...mentor.position };
      mentor.position = {
        x: start.x + ux * elapsedQuanta * 18,
        y: start.y + uy * elapsedQuanta * 18,
      };
    }

    const stillVisible = Object.values(state.mentorsById).some((mentor) =>
      mentor.status === 'departing' && mentorVisibleToAnySpark(world, mentor),
    );
    if (!stillVisible) {
      state.active = false;
      state.deactivatedWorldMinute = now;
      for (const mentor of Object.values(state.mentorsById)) {
        mentor.status = 'inactive';
        mentor.inactiveWorldMinute = now;
      }
    }
  }
}

export function mentorActorsVisibleV1(
  world: Readonly<WorldState>,
): FoundingMentorStateV1[] {
  const state = world.iskorkaMentorsV1;
  if (!state) return [];
  return Object.values(state.mentorsById)
    .filter((mentor) => mentor.status !== 'inactive')
    .map((mentor) => ({
      ...mentor,
      position: { ...mentor.position },
      fullKnowledge: { ...mentor.fullKnowledge },
    }));
}

export function assertFoundingMentorsV1(world: Readonly<WorldState>): void {
  const state = world.iskorkaMentorsV1;
  if (!state) throw new Error('Iskorka founding mentor state is missing.');
  if (state.version !== FOUNDING_MENTOR_VERSION_V1) throw new Error('Unsupported founding mentor version.');
  if (Object.keys(state.mentorsById).length !== 5) throw new Error('Exactly five founding mentors are required.');
  if (state.cohortStudentIds.length !== 10) throw new Error('Founding mentor cohort must contain ten Sparks.');
  for (const spec of MENTOR_SPECS) {
    const mentor = state.mentorsById[spec.id];
    if (!mentor || mentor.name !== spec.name || mentor.role !== spec.role) {
      throw new Error(`Founding mentor ${spec.id} is invalid.`);
    }
    if (mentor.status !== 'inactive' && !world.places[mentor.locationId]) {
      throw new Error(`Founding mentor ${mentor.id} references missing place ${mentor.locationId}.`);
    }
  }
}
