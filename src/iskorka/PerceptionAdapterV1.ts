import type { AgentState, WorldState } from '../world/types';
import type { BodyCoreV1 } from './BodyCoreV1';
import { bodySignalsV1, type BodySignalsV1 } from './BodyCoreV1';
import { brainDevelopmentProfileV1 } from './BrainLifecycleV1';
import {
  humanVisualCapacityV1,
  humanVisionDevelopmentV1,
} from './HumanVisionDevelopmentV1';
import {
  PORTABLE_HUMAN_CONTRACT_VERSION_V1,
  availableSignalV1,
  unavailableSignalV1,
  type HumanBodyPerceptV1,
  type HumanBodySignalKindV1,
  type LocalObservationV1,
  type PerceptBatchV1,
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
  'sexualArousal',
  'postPleasureRelaxation',
] as const;

const LOCAL_VISIBILITY_RADIUS = 45;
const MAX_LOCAL_OBSERVATIONS = 24;
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

function subjectiveSignalV1(
  world: Readonly<WorldState>,
  agent: Readonly<AgentState>,
  core: Readonly<BodyCoreV1>,
  key: HumanBodySignalKindV1,
  raw: number,
): SubjectiveSignalV1 {
  const sensitivity = core.phenotype.interoceptionSensitivity;
  const stableBias =
    (stableUnit(`${world.bootstrapSeed ?? world.id}:${agent.id}:${key}:interoception`) - 0.5) *
    (1 - sensitivity) *
    0.22;
  const gain = 0.72 + sensitivity * 0.32;
  const threshold = (1 - sensitivity) * 0.06;
  const perceived = clamp01(raw * gain + stableBias);
  return availableSignalV1(perceived < threshold ? 0 : perceived);
}

function interoceptionFromSignals(
  world: Readonly<WorldState>,
  agent: Readonly<AgentState>,
  core: Readonly<BodyCoreV1>,
  signals: Readonly<BodySignalsV1>,
): Record<HumanBodySignalKindV1, SubjectiveSignalV1> {
  return Object.fromEntries(
    BODY_SIGNAL_KEYS.map((key) => [
      key,
      subjectiveSignalV1(world, agent, core, key, signals[key]),
    ]),
  ) as Record<HumanBodySignalKindV1, SubjectiveSignalV1>;
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
            world,
            agent,
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
  const capacity = humanVisualCapacityV1(
    agent.life.ageYears,
    core.phenotype.visualAcuityBaseline,
    body.systems.nervous,
  );
  return {
    capacity,
    reach:
      LOCAL_VISIBILITY_RADIUS *
      development.recognitionReachScale *
      (0.72 + core.phenotype.visualAcuityBaseline * 0.28),
  };
}

function visualConfidenceV1(
  world: Readonly<WorldState>,
  agent: Readonly<AgentState>,
  objectId: string,
  distance: number,
  capacity: number,
  reach: number,
): number {
  if (!(capacity > 0) || !(reach > 0)) return 0;
  const distanceFactor = clamp01(1 - distance / Math.max(1, reach));
  const stableBias =
    (stableUnit(`${world.bootstrapSeed ?? world.id}:${agent.id}:${objectId}:vision`) - 0.5) *
    0.16;
  return clamp01(capacity * 0.64 + distanceFactor * 0.3 + stableBias);
}

function recognizedVisuallyV1(
  world: Readonly<WorldState>,
  agent: Readonly<AgentState>,
  objectId: string,
  confidence: number,
): boolean {
  const threshold =
    0.22 +
    stableUnit(`${world.bootstrapSeed ?? world.id}:${agent.id}:${objectId}:recognition`) *
      0.22;
  return confidence >= threshold;
}

function localObservationsV1(
  world: Readonly<WorldState>,
  agent: Readonly<AgentState>,
): LocalObservationV1[] {
  const result: LocalObservationV1[] = [];
  const current = world.places[agent.locationId];
  const vision = visionCapacityV1(world, agent);
  if (!current || vision.capacity <= 0) return result;

  const hereConfidence = visualConfidenceV1(
    world,
    agent,
    current.id,
    0,
    vision.capacity,
    vision.reach,
  );
  if (recognizedVisuallyV1(world, agent, current.id, hereConfidence)) {
    result.push({
      objectId: current.id,
      kind: 'place',
      relation: 'here',
      channel: 'vision',
      confidence: hereConfidence,
    });
  }

  for (const id of current.connectedPlaceIds) {
    if (result.length >= MAX_LOCAL_OBSERVATIONS) break;
    const place = world.places[id];
    if (!place) continue;
    const distance = Math.hypot(
      place.mapX - agent.position.x,
      place.mapY - agent.position.y,
    );
    if (distance > vision.reach) continue;
    const confidence = visualConfidenceV1(
      world,
      agent,
      place.id,
      distance,
      vision.capacity,
      vision.reach,
    );
    if (!recognizedVisuallyV1(world, agent, place.id, confidence)) continue;
    result.push({
      objectId: place.id,
      kind: 'place',
      relation: 'connected_visible',
      channel: 'vision',
      confidence,
    });
  }

  if (result.length < MAX_LOCAL_OBSERVATIONS) {
    const people = Object.values(world.agents)
      .filter(
        (other) =>
          other.id !== agent.id &&
          other.life.alive &&
          other.locationId === agent.locationId,
      )
      .sort((a, b) => a.id.localeCompare(b.id));
    for (const other of people) {
      if (result.length >= MAX_LOCAL_OBSERVATIONS) break;
      const distance = Math.hypot(
        other.position.x - agent.position.x,
        other.position.y - agent.position.y,
      );
      const confidence = visualConfidenceV1(
        world,
        agent,
        other.id,
        distance,
        vision.capacity,
        Math.max(8, vision.reach),
      );
      if (!recognizedVisuallyV1(world, agent, other.id, confidence)) continue;
      const observedAction =
        other.movement?.purpose ??
        (other.lastMeaningfulEventAt === world.now ? other.lastAction : undefined);
      result.push({
        objectId: other.id,
        kind: 'person',
        relation: 'co_located',
        channel: 'vision',
        confidence,
        ...(observedAction ? { observedAction } : {}),
      });
    }
  }

  if (result.length < MAX_LOCAL_OBSERVATIONS) {
    const remains = Object.values(world.v16?.remainsById ?? {})
      .filter((entry) => entry.currentPlaceId === agent.locationId)
      .sort((a, b) => a.id.localeCompare(b.id));
    for (const entry of remains) {
      if (result.length >= MAX_LOCAL_OBSERVATIONS) break;
      const confidence = visualConfidenceV1(
        world,
        agent,
        entry.id,
        0,
        vision.capacity,
        Math.max(8, vision.reach),
      );
      if (!recognizedVisuallyV1(world, agent, entry.id, confidence)) continue;
      result.push({
        objectId: entry.id,
        kind: 'remains',
        relation: 'co_located',
        channel: 'vision',
        confidence,
        subjectObjectId: entry.agentId,
        eventKind: 'apparent_death',
      });
    }
  }
  return result;
}

function receivedMessagesV1(
  world: Readonly<WorldState>,
  agent: Readonly<AgentState>,
): PerceptBatchV1['receivedMessages'] {
  const now = world.calendar.elapsedWorldMinutes;
  const records = world.v18?.recentConversations ?? [];
  const messages: Array<PerceptBatchV1['receivedMessages'][number]> = [];

  for (let index = records.length - 1; index >= 0; index -= 1) {
    if (messages.length >= MAX_RECEIVED_MESSAGES) break;
    const record = records[index];
    if (record.worldMinute > now || now - record.worldMinute > MESSAGE_WINDOW_WORLD_MINUTES) {
      continue;
    }

    if (record.listenerId === agent.id) {
      messages.push({
        messageId: `${record.id}:utterance`,
        senderObjectId: record.speakerId,
        symbols: [record.utterance],
        channel: 'hearing',
        confidence: 1,
      });
      continue;
    }
    if (record.speakerId === agent.id) {
      messages.push({
        messageId: `${record.id}:reply`,
        senderObjectId: record.listenerId,
        symbols: [record.reply],
        channel: 'hearing',
        confidence: 1,
      });
      continue;
    }
    if (
      record.observerAudible &&
      record.placeId === agent.locationId &&
      record.speakerId !== agent.id &&
      record.listenerId !== agent.id
    ) {
      messages.push({
        messageId: `${record.id}:overheard`,
        senderObjectId: record.speakerId,
        symbols: [record.utterance],
        channel: 'hearing',
        confidence: clamp01(record.audibility),
      });
    }
  }

  return messages.reverse();
}

/**
 * Iskorka adapter may read the world, but it emits only the resident's bounded
 * current perception. No WorldState, hidden emotion, remote stock or foreign
 * brain object is returned.
 */
export function perceptBatchForAgentV1(
  world: Readonly<WorldState>,
  agentId: string,
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
    localObservations: localObservationsV1(world, agent),
    receivedMessages: receivedMessagesV1(world, agent),
  };
}
