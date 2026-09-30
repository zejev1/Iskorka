import { garmentConditionV1 } from './ClothingV1';
import type { AgentState, V16RemainsState, WorldPlace, WorldState } from '../world/types';
import type { BodyCoreV1 } from './BodyCoreV1';
import { bodySignalsV1, type BodySignalsV1 } from './BodyCoreV1';
import { brainDevelopmentProfileV1 } from './BrainLifecycleV1';
import { humanVisionDevelopmentV1 } from './HumanVisionDevelopmentV1';
import {
  mentorActorsVisibleV1,
  recentFoundingMentorMessagesV1,
} from './FoundingMentorsV1';
import {
  PORTABLE_HUMAN_CONTRACT_VERSION_V1,
  availableSignalV1,
  unavailableSignalV1,
  type ActionOutcomeV1,
  type HumanEnvironmentalCueKindV1,
  type HumanBodyPerceptV1,
  type HumanBodySignalKindV1,
  type LocalObservationV1,
  type PerceptBatchV1,
  type ReceivedMessageV1,
  type SubjectiveSignalV1,
} from './PortableHumanCoreV1';

const BODY_SIGNAL_KEYS: readonly HumanBodySignalKindV1[] = [
  'thirst',
  'hunger',
  'breathlessness',
  'weakness',
  'coldStress',
  'heatStress',
  'sweating',
  'tremor',
  'heartPounding',
  'bladderUrge',
  'bowelUrge',
  'physicalDiscomfort',
  'cryingDrive',
  'tears',
  'blushing',
  'goosebumps',
  'dryMouth',
  'startle',
  'physicalPleasure',
  'sexualDesire',
  'sexualArousal',
  'postPleasureRelaxation',
] as const;

const LOCAL_VISIBILITY_RADIUS = 45;
const MAX_LOCAL_OBSERVATIONS = 24;

/**
 * Bounded, deterministic rotating sample for crowded locations. Every call
 * examines at most twice the returned capacity; changing the absolute review
 * window eventually exposes each co-located person/remains without scanning
 * the full bucket for every Spark.
 */
export function rotatingPerceptionSampleV1<T>(
  candidates: readonly T[],
  observerId: string,
  worldMinute: number,
  maximum = MAX_LOCAL_OBSERVATIONS,
): T[] {
  const capacity = Math.max(0, Math.trunc(maximum));
  if (candidates.length <= capacity) return candidates.slice();
  if (capacity === 0) return [];
  let hash = 2166136261;
  for (let index = 0; index < observerId.length; index += 1) {
    hash ^= observerId.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  const review = Math.floor(Math.max(0, worldMinute) / 240);
  const start = ((hash >>> 0) + review * capacity) % candidates.length;
  const result: T[] = [];
  const scanLimit = Math.min(candidates.length, capacity * 2);
  for (let offset = 0; offset < scanLimit && result.length < capacity; offset += 1) {
    result.push(candidates[(start + offset) % candidates.length]);
  }
  return result;
}
const MAX_FIXTURE_OBSERVATIONS = 8;
const MAX_RECEIVED_MESSAGES = 8;
const MESSAGE_WINDOW_WORLD_MINUTES = 8_760;

function unavailableInteroception(): Record<HumanBodySignalKindV1, SubjectiveSignalV1> {
  return Object.fromEntries(
    BODY_SIGNAL_KEYS.map((key) => [key, unavailableSignalV1()]),
  ) as Record<HumanBodySignalKindV1, SubjectiveSignalV1>;
}

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

function stableUnit(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 0xffffffff;
}

interface AgentPerceptionNoiseV1 {
  seedKey: string;
  interoceptionUnitBySignal: Partial<Record<HumanBodySignalKindV1, number>>;
  visionNoiseByObjectId: Map<string, { biasUnit: number; thresholdUnit: number }>;
}

interface PerceptionNoiseCacheV1 {
  byAgentId: Map<string, AgentPerceptionNoiseV1>;
}

const perceptionNoiseByWorldV1 = new WeakMap<object, PerceptionNoiseCacheV1>();

function agentNoiseV1(
  world: Readonly<WorldState>,
  agentId: string,
): AgentPerceptionNoiseV1 {
  let worldCache = perceptionNoiseByWorldV1.get(world as object);
  if (!worldCache) {
    worldCache = { byAgentId: new Map() };
    perceptionNoiseByWorldV1.set(world as object, worldCache);
  }
  let noise = worldCache.byAgentId.get(agentId);
  if (!noise) {
    noise = {
      seedKey: `${world.bootstrapSeed ?? world.id}:${world.epoch ?? 1}:${agentId}`,
      interoceptionUnitBySignal: {},
      visionNoiseByObjectId: new Map(),
    };
    worldCache.byAgentId.set(agentId, noise);
  }
  return noise;
}

function cachedInteroceptionUnitV1(
  noise: AgentPerceptionNoiseV1,
  signal: HumanBodySignalKindV1,
): number {
  const prior = noise.interoceptionUnitBySignal[signal];
  if (prior !== undefined) return prior;
  const value = stableUnit(`${noise.seedKey}:${signal}:interoception`);
  noise.interoceptionUnitBySignal[signal] = value;
  return value;
}

function cachedVisionNoiseV1(
  noise: AgentPerceptionNoiseV1,
  objectId: string,
): { biasUnit: number; thresholdUnit: number } {
  const prior = noise.visionNoiseByObjectId.get(objectId);
  if (prior) return prior;
  const value = {
    biasUnit: stableUnit(`${noise.seedKey}:${objectId}:vision`),
    thresholdUnit: stableUnit(`${noise.seedKey}:${objectId}:recognition`),
  };
  noise.visionNoiseByObjectId.set(objectId, value);
  return value;
}

function subjectiveSignalV1(
  noise: AgentPerceptionNoiseV1,
  core: Readonly<BodyCoreV1>,
  key: HumanBodySignalKindV1,
  raw: number,
): SubjectiveSignalV1 {
  const sensitivity = core.phenotype.interoceptionSensitivity;
  const stableBias =
    (cachedInteroceptionUnitV1(noise, key) - 0.5) *
    (1 - sensitivity) *
    0.22;
  const gain = 0.72 + sensitivity * 0.32;
  const threshold = (1 - sensitivity) * 0.06;
  const perceived = clamp01(raw * gain + stableBias);
  return availableSignalV1(perceived < threshold ? 0 : perceived);
}

function interoceptionFromSignals(
  noise: AgentPerceptionNoiseV1,
  core: Readonly<BodyCoreV1>,
  signals: Readonly<BodySignalsV1>,
): Record<HumanBodySignalKindV1, SubjectiveSignalV1> {
  const result = {} as Record<HumanBodySignalKindV1, SubjectiveSignalV1>;
  for (const key of BODY_SIGNAL_KEYS) {
    result[key] = subjectiveSignalV1(noise, core, key, signals[key]);
  }
  return result;
}

/**
 * Body -> brain boundary. Missing body state means unknown/unavailable, never
 * perfect health and never a fabricated numeric zero.
 */
export function humanBodyPerceptV1(
  world: Readonly<WorldState>,
  agent: Readonly<AgentState>,
): HumanBodyPerceptV1 {
  const body = world.v21?.bodiesByAgentId[agent.id];
  const core = body?.bodyCore;
  const development = brainDevelopmentProfileV1(agent.life.ageYears);
  return {
    version: PORTABLE_HUMAN_CONTRACT_VERSION_V1,
    ownerAgentId: agent.id,
    worldMinute: world.calendar.elapsedWorldMinutes,
    ageYears: agent.life.ageYears,
    brainLifePhase: development.phase,
    interoception:
      body && core
        ? interoceptionFromSignals(
            agentNoiseV1(world, agent.id),
            core,
            bodySignalsV1(agent, body, core),
          )
        : unavailableInteroception(),
  };
}

function visionCapacityV1(
  world: Readonly<WorldState>,
  agent: Readonly<AgentState>,
): { capacity: number; reach: number } {
  const body = world.v21?.bodiesByAgentId[agent.id];
  const core = body?.bodyCore;
  if (!body || !core) return { capacity: 0, reach: 0 };
  const development = humanVisionDevelopmentV1(agent.life.ageYears);
  const capacity = clamp01(
    development.acuityScale * 0.42 +
    development.contrastScale * 0.18 +
    development.motionScale * 0.12 +
    development.recognitionReachScale * 0.18 +
    core.phenotype.visualAcuityBaseline * 0.07 +
    body.systems.nervous * 0.03,
  );
  return {
    capacity,
    reach:
      LOCAL_VISIBILITY_RADIUS *
      development.recognitionReachScale *
      (0.72 + core.phenotype.visualAcuityBaseline * 0.28),
  };
}

function visualAssessmentV1(
  noise: AgentPerceptionNoiseV1,
  objectId: string,
  distance: number,
  capacity: number,
  reach: number,
): { confidence: number; recognized: boolean } {
  if (!(capacity > 0) || !(reach > 0)) {
    return { confidence: 0, recognized: false };
  }
  const deterministic = cachedVisionNoiseV1(noise, objectId);
  const distanceFactor = clamp01(1 - distance / Math.max(1, reach));
  const stableBias = (deterministic.biasUnit - 0.5) * 0.16;
  const confidence = clamp01(
    capacity * 0.64 + distanceFactor * 0.3 + stableBias,
  );
  const threshold = 0.22 + deterministic.thresholdUnit * 0.22;
  return { confidence, recognized: confidence >= threshold };
}

function localObservationsV1(
  world: Readonly<WorldState>,
  agent: Readonly<AgentState>,
  localAgents?: readonly Readonly<AgentState>[],
  localRemains?: readonly Readonly<V16RemainsState>[],
  localPlaces?: readonly Readonly<WorldPlace>[],
): LocalObservationV1[] {
  const result: LocalObservationV1[] = [];
  const current = world.places[agent.locationId];
  const vision = visionCapacityV1(world, agent);
  const noise = agentNoiseV1(world, agent.id);
  if (!current || vision.capacity <= 0) return result;

  const here = visualAssessmentV1(
    noise,
    current.id,
    0,
    vision.capacity,
    vision.reach,
  );
  if (here.recognized) {
    result.push({
      objectId: current.id,
      kind: 'place',
      relation: 'here',
      channel: 'vision',
      confidence: here.confidence,
    });
  }

  if (result.length < MAX_LOCAL_OBSERVATIONS) {
    // Co-located remains are immediate physical evidence and must not be
    // crowded out by distant place labels or a busy room.
    const remainsById = world.v16?.remainsById;
    if (localRemains) {
      for (const entry of localRemains) {
        if (result.length >= MAX_LOCAL_OBSERVATIONS) break;
        const assessment = visualAssessmentV1(
          noise,
          entry.id,
          0,
          vision.capacity,
          Math.max(8, vision.reach),
        );
        if (!assessment.recognized) continue;
        result.push({
          objectId: entry.id,
          kind: 'remains',
          relation: 'co_located',
          channel: 'vision',
          confidence: assessment.confidence,
          subjectObjectId: entry.agentId,
          eventKind: 'apparent_death',
        });
      }
    } else if (remainsById) {
      for (const entryId in remainsById) {
        if (result.length >= MAX_LOCAL_OBSERVATIONS) break;
        const entry = remainsById[entryId];
        if (entry.currentPlaceId !== agent.locationId) continue;
        const assessment = visualAssessmentV1(
          noise,
          entry.id,
          0,
          vision.capacity,
          Math.max(8, vision.reach),
        );
        if (!assessment.recognized) continue;
        result.push({
          objectId: entry.id,
          kind: 'remains',
          relation: 'co_located',
          channel: 'vision',
          confidence: assessment.confidence,
          subjectObjectId: entry.agentId,
          eventKind: 'apparent_death',
        });
      }
    }
  }

  // Founding caregivers are immediate nearby people during childhood. Keep
  // them ahead of distant map labels so a busy settlement cannot hide them.
  if (result.length < MAX_LOCAL_OBSERVATIONS) {
    for (const mentor of mentorActorsVisibleV1(world)) {
      if (result.length >= MAX_LOCAL_OBSERVATIONS) break;
      const distance = Math.hypot(
        mentor.position.x - agent.position.x,
        mentor.position.y - agent.position.y,
      );
      if (distance > Math.max(8, vision.reach)) continue;
      const assessment = visualAssessmentV1(
        noise,
        mentor.id,
        distance,
        vision.capacity,
        Math.max(8, vision.reach),
      );
      const veryCloseCaregiver = mentor.locationId === agent.locationId && distance <= 1.5;
      if (!assessment.recognized && !veryCloseCaregiver) continue;
      result.push({
        objectId: mentor.id,
        kind: 'person',
        relation: mentor.locationId === agent.locationId ? 'co_located' : 'connected_visible',
        channel: 'vision',
        confidence: veryCloseCaregiver
          ? Math.max(assessment.confidence, 0.55)
          : assessment.confidence,
      });
    }
  }


  if (
    result.length < MAX_LOCAL_OBSERVATIONS &&
    current.medievalInfrastructureV1
  ) {
    // Furniture/tools are physical world objects, not invisible capabilities.
    // A finite visual frame samples only a bounded subset at once; the window
    // rotates with world days so a child can gradually perceive the whole room.
    const fixtures = Object.values(current.medievalInfrastructureV1.fixtures)
      .filter(
        (fixture) =>
          fixture.installed &&
          fixture.quantity > 0 &&
          fixture.condition >= 0.25,
      )
      .sort((a, b) => a.id.localeCompare(b.id));
    if (fixtures.length > 0) {
      const day = Math.floor(world.calendar.elapsedWorldMinutes / (24 * 60));
      const start =
        (day + Math.floor(stableUnit(`${agent.id}:${current.id}:fixtures`) * fixtures.length)) %
        fixtures.length;
      for (
        let index = 0;
        index < Math.min(MAX_FIXTURE_OBSERVATIONS, fixtures.length) &&
        result.length < MAX_LOCAL_OBSERVATIONS;
        index += 1
      ) {
        const fixture = fixtures[(start + index) % fixtures.length];
        const assessment = visualAssessmentV1(
          noise,
          fixture.id,
          0.8,
          vision.capacity,
          Math.max(4, vision.reach),
        );
        if (!assessment.recognized) continue;
        result.push({
          objectId: fixture.id,
          kind: 'fixture',
          relation: 'co_located',
          channel: 'vision',
          confidence: assessment.confidence,
        });
      }
    }
  }

  // Road topology cannot hide a nearby well from eyesight. The executor
  // supplies a kind-indexed shortlist; vision and distance still gate it.
  const nearbyPlaceIds = new Set([
    ...(localPlaces ?? []).map((place) => place.id),
    ...current.connectedPlaceIds,
  ]);
  for (const id of nearbyPlaceIds) {
    if (result.length >= MAX_LOCAL_OBSERVATIONS) break;
    const place = world.places[id];
    if (!place) continue;
    const distance = Math.hypot(
      place.mapX - agent.position.x,
      place.mapY - agent.position.y,
    );
    if (distance > vision.reach) continue;
    const assessment = visualAssessmentV1(
      noise,
      place.id,
      distance,
      vision.capacity,
      vision.reach,
    );
    if (!assessment.recognized) continue;
    result.push({
      objectId: place.id,
      kind: 'place',
      relation: 'connected_visible',
      channel: 'vision',
      confidence: assessment.confidence,
    });
  }

  if (result.length < MAX_LOCAL_OBSERVATIONS) {
    const people = localAgents ?? Object.values(world.agents);
    for (const other of people) {
      if (
        other.id === agent.id ||
        !other.life.alive ||
        other.locationId !== agent.locationId
      ) continue;
      if (result.length >= MAX_LOCAL_OBSERVATIONS) break;
      const distance = Math.hypot(
        other.position.x - agent.position.x,
        other.position.y - agent.position.y,
      );
      const assessment = visualAssessmentV1(
        noise,
        other.id,
        distance,
        vision.capacity,
        Math.max(8, vision.reach),
      );
      if (!assessment.recognized) continue;
      const observedAction =
        other.movement?.purpose ??
        (other.lastMeaningfulEventAt === world.now ? other.lastAction : undefined);
      result.push({
        objectId: other.id,
        kind: 'person',
        relation: 'co_located',
        channel: 'vision',
        confidence: assessment.confidence,
        ...(observedAction ? { observedAction } : {}),
      });
    }
  }

  return result;
}

function appendIndexedMessageV1(
  index: Map<string, ReceivedMessageV1[]>,
  agentId: string,
  message: ReceivedMessageV1,
): void {
  const messages = index.get(agentId) ?? [];
  const prior = messages.findIndex((item) => item.messageId === message.messageId);
  if (prior >= 0) messages.splice(prior, 1);
  messages.push(message);
  if (messages.length > MAX_RECEIVED_MESSAGES) {
    messages.splice(0, messages.length - MAX_RECEIVED_MESSAGES);
  }
  index.set(agentId, messages);
}

/**
 * Only direct participants can be reconstructed safely from persisted
 * conversation evidence. A historical "observerAudible" flag does not tell us
 * which third party was physically present, so it is never replayed to someone
 * who may have arrived later.
 */
export function buildReceivedMessageIndexV1(
  world: Readonly<WorldState>,
): Map<string, ReceivedMessageV1[]> {
  const now = world.calendar.elapsedWorldMinutes;
  const index = new Map<string, ReceivedMessageV1[]>();
  for (const record of world.v18?.recentConversations ?? []) {
    if (record.worldMinute > now || now - record.worldMinute > MESSAGE_WINDOW_WORLD_MINUTES) {
      continue;
    }
    appendIndexedMessageV1(index, record.listenerId, {
      messageId: `${record.id}:utterance`,
      senderObjectId: record.speakerId,
      symbols: [record.utterance],
      channel: 'hearing',
      confidence: 1,
    });
    appendIndexedMessageV1(index, record.speakerId, {
      messageId: `${record.id}:reply`,
      senderObjectId: record.listenerId,
      symbols: [record.reply],
      channel: 'hearing',
      confidence: 1,
    });
  }
  for (const studentId of world.iskorkaMentorsV1?.cohortStudentIds ?? []) {
    for (const message of recentFoundingMentorMessagesV1(world, studentId)) {
      appendIndexedMessageV1(index, studentId, {
        messageId: message.id,
        senderObjectId: message.mentorId,
        symbols: [...message.symbols],
        channel: 'hearing',
        confidence: 1,
      });
    }
  }
  return index;
}

export interface PerceptionAdapterOptionsV1 {
  localAgents?: readonly Readonly<AgentState>[];
  localPlaces?: readonly Readonly<WorldPlace>[];
  /** A place-indexed bucket supplied by WorldEngine for bounded hot-path work. */
  localRemains?: readonly Readonly<V16RemainsState>[];
  receivedMessages?: readonly ReceivedMessageV1[];
  priorOutcome?: Readonly<ActionOutcomeV1>;
}

const MAX_KNOWN_AFFORDANCE_PLACES_V1 = 24;

function placeSupportsFoodGatheringV1(
  world: Readonly<WorldState>,
  placeId: string,
): boolean {
  const place = world.places[placeId];
  if (!place || place.surface === 'water') return false;
  if (!(place.kind === 'resource_field' || place.kind === 'meadow' || place.biome === 'plains')) {
    return false;
  }
  const resources = place.settlementId
    ? world.v16?.settlementResourcesById[place.settlementId]
    : world.v15?.renewableResources;
  return (resources?.renewableBase ?? 0) > 0.001 && place.fertility > 0.02;
}

function placeHasPotableWaterV1(
  world: Readonly<WorldState>,
  placeId: string,
): boolean {
  const place = world.places[placeId];
  return Boolean(
    place?.kind === 'well' &&
    place.wellWaterV1?.potable &&
    place.wellWaterV1.waterLitres > 0.01,
  );
}

/**
 * Small, current affordances that a person could observe around them or recall
 * from an actually visited place. These are not world-wide resource maps.
 */
function environmentalCuesV1(
  world: Readonly<WorldState>,
  agent: Readonly<AgentState>,
  localAgents?: readonly Readonly<AgentState>[],
): Readonly<Partial<Record<HumanEnvironmentalCueKindV1, number>>> {
  const place = world.places[agent.locationId];
  const home = world.places[agent.homeId];
  const wallet = world.v19?.adventureEconomy.adventurersByAgentId[agent.id];
  const carried = Math.max(0, wallet?.carriedGoods.food ?? 0) +
    Math.max(0, wallet?.carriedGoods.meat ?? 0);
  const settlementId = home?.settlementId;
  const homeFood = agent.locationId === agent.homeId && settlementId
    ? Math.max(0, world.v16?.settlementEconomyById[settlementId]?.stocks.food ?? 0)
    : 0;
  const homeWater = agent.locationId === agent.homeId
    ? Math.max(0, home?.medievalInfrastructureV1?.waterReserveLitres ?? 0)
    : 0;
  const currentWater = placeHasPotableWaterV1(world, agent.locationId) || homeWater > 0.01;
  const knownPlaces = rotatingPerceptionSampleV1(
    agent.knownPlaceIds ?? [],
    `${agent.id}:affordance`,
    world.calendar.elapsedWorldMinutes,
    MAX_KNOWN_AFFORDANCE_PLACES_V1,
  );
  const knownWater = knownPlaces.some((placeId) => placeHasPotableWaterV1(world, placeId));
  const currentFoodSource = placeSupportsFoodGatheringV1(world, agent.locationId);
  const knownFoodSource = knownPlaces.some((placeId) => placeSupportsFoodGatheringV1(world, placeId));
  const nearbyPeople = localAgents?.reduce(
    (count, other) => count + Number(other.id !== agent.id && other.life.alive && other.locationId === agent.locationId),
    0,
  ) ?? 0;

  return {
    foodAtHand: clamp01((carried + homeFood) / 0.12),
    foodGatherableHere: Number(currentFoodSource),
    knownFoodSource: Number(knownFoodSource || currentFoodSource),
    waterHere: Number(currentWater),
    knownWaterSource: Number(knownWater),
    socialOpportunity: clamp01(nearbyPeople / 2),
    clothingNeed: 1 - garmentConditionV1(agent.clothingV1?.worn, world.calendar.elapsedWorldMinutes),
    // Only bodies currently perceived at home, never a global population quota.
    housingPressure: agent.locationId === agent.homeId
      ? clamp01((nearbyPeople + 1 - (home?.capacity ?? 1)) / Math.max(1, home?.capacity ?? 1))
      : 0,
  };
}

function directReceivedMessagesForAgentV1(
  world: Readonly<WorldState>,
  agentId: string,
): ReceivedMessageV1[] {
  const records = world.v18?.recentConversations ?? [];
  const now = world.calendar.elapsedWorldMinutes;
  const messages: ReceivedMessageV1[] = [];
  for (let index = records.length - 1; index >= 0 && messages.length < MAX_RECEIVED_MESSAGES; index -= 1) {
    const record = records[index];
    if (record.worldMinute > now || now - record.worldMinute > MESSAGE_WINDOW_WORLD_MINUTES) continue;
    if (record.listenerId === agentId) {
      messages.push({
        messageId: `${record.id}:utterance`,
        senderObjectId: record.speakerId,
        symbols: [record.utterance],
        channel: 'hearing',
        confidence: 1,
      });
    } else if (record.speakerId === agentId) {
      messages.push({
        messageId: `${record.id}:reply`,
        senderObjectId: record.listenerId,
        symbols: [record.reply],
        channel: 'hearing',
        confidence: 1,
      });
    }
  }
  const mentorMessages = recentFoundingMentorMessagesV1(world, agentId).map((message) => ({
    messageId: message.id,
    senderObjectId: message.mentorId,
    symbols: [...message.symbols],
    channel: 'hearing' as const,
    confidence: 1,
  }));
  return [...messages.reverse(), ...mentorMessages].slice(-MAX_RECEIVED_MESSAGES);
}


/**
 * Iskorka adapter may read the world, but it emits only the resident's bounded
 * current perception. No WorldState, hidden emotion, remote stock or foreign
 * brain object is returned.
 */
export function perceptBatchForAgentV1(
  world: Readonly<WorldState>,
  agentId: string,
  options: Readonly<PerceptionAdapterOptionsV1> = {},
): PerceptBatchV1 {
  const agent = world.agents[agentId];
  if (!agent?.life.alive) {
    throw new Error(`Living resident ${agentId} is required for perception.`);
  }
  return {
    version: PORTABLE_HUMAN_CONTRACT_VERSION_V1,
    ownerAgentId: agent.id,
    worldMinute: world.calendar.elapsedWorldMinutes,
    body: humanBodyPerceptV1(world, agent),
    environmentalCues: environmentalCuesV1(world, agent, options.localAgents),
    localObservations: localObservationsV1(
      world,
      agent,
      options.localAgents,
      options.localRemains,
      options.localPlaces,
    ),
    receivedMessages:
      options.receivedMessages ??
      directReceivedMessagesForAgentV1(world, agent.id),
    ...(options.priorOutcome ? { priorOutcome: { ...options.priorOutcome, perceivedEffects: options.priorOutcome.perceivedEffects.map((effect) => ({ ...effect })) } } : {}),
  };
}
