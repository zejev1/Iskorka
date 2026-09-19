import type { AgentState, V21BodyState, WorldState } from '../world/types';
import { WORLD_MINUTES_PER_YEAR } from '../world/WorldClock';
import { worldWeatherV21 } from '../v21/WeatherV21';
import {
  approachBodyValueV1,
  bodySignalsV1,
  ensureBodyCoreV1,
  type BodySignalsV1,
} from './BodyCoreV1';

const DAY = 24 * 60;
const SEMANTIC_QUANTUM = WORLD_MINUTES_PER_YEAR / 60;
const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));
const clampSigned = (value: number): number => Math.max(-1, Math.min(1, value));

const ACTIVITY_LOAD: Record<string, number> = {
  rest: 0.04,
  relax: 0.06,
  reflect: 0.08,
  pray: 0.09,
  socialize: 0.12,
  bond: 0.13,
  help: 0.22,
  walk: 0.34,
  gather: 0.42,
  work: 0.56,
  hunt: 0.62,
  explore: 0.64,
};

type SleepAwareBody = V21BodyState & {
  sleep?: { status?: string };
};

export interface BodyDecisionPressureV1 {
  recover: number;
  secureResources: number;
}

export interface AdultIntimacyBodyResponseV1 {
  agentId: string;
  arousal: number;
  pleasure: number;
  relaxation: number;
}

function activityLoad(agent: Readonly<AgentState>, body: Readonly<V21BodyState>): number {
  if ((body as SleepAwareBody).sleep?.status === 'sleeping') return 0.02;
  if (agent.movement) return 0.52;
  return ACTIVITY_LOAD[agent.lastAction ?? ''] ?? 0.14;
}

function isSheltered(world: Readonly<WorldState>, agent: Readonly<AgentState>): boolean {
  const kind = world.places[agent.locationId]?.kind;
  return kind !== undefined && ['home', 'workshop', 'library', 'village', 'city'].includes(kind);
}

function pregnancyLoad(world: Readonly<WorldState>, agent: Readonly<AgentState>): number {
  const core = world.v21?.bodiesByAgentId[agent.id]?.bodyCore;
  if (!core || core.reproductive.type !== 'female' || !core.reproductive.pregnancy) return 0;
  const pregnancy = core.reproductive.pregnancy;
  const span = Math.max(1, pregnancy.dueWorldMinute - pregnancy.conceptionWorldMinute);
  const progress = clamp01(
    (world.calendar.elapsedWorldMinutes - pregnancy.conceptionWorldMinute) / span,
  );
  return clamp01(0.12 + progress * 0.42);
}

function cycleTemperatureOffset(world: Readonly<WorldState>, agent: Readonly<AgentState>): number {
  const reproductive = world.v21?.bodiesByAgentId[agent.id]?.bodyCore?.reproductive;
  if (!reproductive || reproductive.type !== 'female' || reproductive.cyclePhase === undefined) return 0;
  return reproductive.cyclePhase >= 0.52 && reproductive.cyclePhase <= 0.9 ? 0.14 : 0;
}

/**
 * Advances physiology once per semantic quantum (or any explicitly supplied
 * interval) using analytic approaches, never heartbeat/breath microticks.
 *
 * Existing food/resource systems remain authoritative during this layer.
 * BodyCore reads their physical consequences and gradually becomes the common
 * body state without replacing working world mechanics in one risky jump.
 */
export function advanceBodyPhysiologyV1(
  world: WorldState,
  agent: AgentState,
  elapsedWorldMinutes: number,
): BodySignalsV1 | undefined {
  if (!agent.life.alive || !(elapsedWorldMinutes > 0)) {
    const body = world.v21?.bodiesByAgentId[agent.id];
    return body?.bodyCore ? bodySignalsV1(agent, body, body.bodyCore) : undefined;
  }

  const body = world.v21?.bodiesByAgentId[agent.id];
  if (!body) return undefined;
  const core = ensureBodyCoreV1(world, agent, body);
  if (!core) return undefined;

  const h = core.homeostasis;
  const dose = Math.max(0, Math.min(2, elapsedWorldMinutes / SEMANTIC_QUANTUM));
  const load = activityLoad(agent, body);
  const sleeping = (body as SleepAwareBody).sleep?.status === 'sleeping';
  const sheltered = isSheltered(world, agent);
  const weather = worldWeatherV21(world);
  const thermalExposure = sheltered ? 0.18 : 1;

  const diseaseLoad = clamp01(
    body.diseases.reduce((sum, disease) => sum + disease.severity, 0),
  );
  const woundLoad = clamp01(
    body.wounds.reduce((sum, wound) => sum + diseaseWeight(wound.severity), 0),
  );
  const bleedingLoad = clamp01(
    body.wounds.reduce((sum, wound) => sum + wound.bleeding, 0),
  );
  const digestiveDisease = clamp01(
    body.diseases
      .filter((disease) => disease.kind === 'digestive')
      .reduce((sum, disease) => sum + disease.severity, 0),
  );
  const rhythm = world.v18?.lifeRhythmByAgentId[agent.id];
  const satiety = clamp01(rhythm?.satiety ?? h.stomachFill);
  const pregnancy = pregnancyLoad(world, agent);
  const postpartum = core.reproductive.type === 'female'
    ? core.reproductive.postpartum?.recoveryLoad ?? 0
    : 0;

  const fear = clamp01(agent.mind.emotions.fear);
  const grief = clamp01(agent.mind.emotions.grief);
  const awe = clamp01(agent.mind.emotions.awe);
  const joyPeak = clamp01((agent.mind.emotions.joy - 0.72) / 0.28);

  const inflammationTarget = clamp01(
    diseaseLoad * 0.54 + woundLoad * 0.24 + body.pain * 0.12,
  );
  h.inflammation = clamp01(
    approachBodyValueV1(
      h.inflammation,
      inflammationTarget,
      inflammationTarget > h.inflammation ? 10 * 60 : 2 * DAY,
      elapsedWorldMinutes,
    ),
  );
  h.immuneActivation = clamp01(
    approachBodyValueV1(
      h.immuneActivation,
      clamp01(diseaseLoad * 0.62 + h.inflammation * 0.26),
      18 * 60,
      elapsedWorldMinutes,
    ),
  );

  const ambientDelta = weather.temperatureC > 28
    ? Math.min(0.7, (weather.temperatureC - 28) * 0.045)
    : weather.temperatureC < 8
      ? -Math.min(0.85, (8 - weather.temperatureC) * 0.038)
      : 0;
  const feverOffset = h.inflammation * 0.62 + h.immuneActivation * 0.28;
  const coreTarget =
    36.94 +
    ambientDelta * thermalExposure +
    load * 0.12 +
    feverOffset +
    cycleTemperatureOffset(world, agent) +
    pregnancy * 0.08;
  h.coreTemperatureC = Math.max(
    30,
    Math.min(
      42,
      approachBodyValueV1(h.coreTemperatureC, coreTarget, 150, elapsedWorldMinutes),
    ),
  );
  const skinTarget = Math.max(
    24,
    Math.min(
      36.5,
      32.8 +
        (weather.temperatureC - 20) * 0.16 * thermalExposure +
        load * 0.45,
    ),
  );
  h.skinTemperatureC = Math.max(
    10,
    Math.min(
      40,
      approachBodyValueV1(h.skinTemperatureC, skinTarget, 90, elapsedWorldMinutes),
    ),
  );

  const provisionalHeatStress = clamp01(
    (h.coreTemperatureC - 37.2) / 1.9 +
    Math.max(0, h.skinTemperatureC - 34) / 7,
  );
  const autonomicTarget = clamp01(
    agent.stress * 0.44 +
    fear * 0.38 +
    awe * 0.12 +
    body.pain * 0.18 +
    load * 0.12,
  );
  h.autonomicArousal = clamp01(
    approachBodyValueV1(
      h.autonomicArousal,
      autonomicTarget,
      50,
      elapsedWorldMinutes,
    ),
  );
  h.muscleTension = clamp01(
    approachBodyValueV1(
      h.muscleTension,
      clamp01(agent.stress * 0.34 + fear * 0.24 + body.pain * 0.18 + load * 0.2),
      90,
      elapsedWorldMinutes,
    ),
  );
  h.stressHormoneLoad = clamp01(
    approachBodyValueV1(
      h.stressHormoneLoad,
      clamp01(agent.stress * 0.48 + fear * 0.28 + body.pain * 0.18 + load * 0.12),
      3 * 60,
      elapsedWorldMinutes,
    ),
  );
  h.tearDrive = clamp01(
    approachBodyValueV1(
      h.tearDrive,
      clamp01(grief * 0.58 + fear * 0.17 + body.pain * 0.21 + joyPeak * 0.14),
      35,
      elapsedWorldMinutes,
    ),
  );

  const sweatDrive = clamp01(
    provisionalHeatStress * 0.58 +
    load * 0.2 +
    h.autonomicArousal * 0.12 +
    core.phenotype.sweatSensitivity * 0.08,
  );
  const hasProvisionProxy =
    agent.resources > 0.018 ||
    (agent.locationId === agent.homeId && satiety > 0.42);
  const fluidLoss =
    0.0045 +
    sweatDrive * 0.018 +
    load * 0.008 +
    h.inflammation * 0.004;
  const fluidReplacement = hasProvisionProxy
    ? 0.012 + (sleeping ? 0.002 : 0)
    : 0;
  h.hydration = clamp01(
    h.hydration + (fluidReplacement - fluidLoss) * dose,
  );
  h.electrolyteDeviation = clampSigned(
    approachBodyValueV1(
      h.electrolyteDeviation,
      0,
      2 * DAY,
      elapsedWorldMinutes,
    ) + sweatDrive * 0.01 * dose,
  );

  h.stomachFill = clamp01(
    approachBodyValueV1(h.stomachFill, satiety, 8 * 60, elapsedWorldMinutes),
  );
  const energyTarget = clamp01(
    0.23 +
    satiety * 0.46 +
    agent.resources * 0.12 +
    agent.life.health * 0.1 -
    load * 0.1 -
    pregnancy * 0.08 -
    h.inflammation * 0.06,
  );
  h.energyReserve = clamp01(
    approachBodyValueV1(h.energyReserve, energyTarget, 2 * DAY, elapsedWorldMinutes),
  );

  h.bladderFill = clamp01(
    h.bladderFill +
    dose * (0.025 + h.hydration * 0.035 + (hasProvisionProxy ? 0.018 : 0)),
  );
  if (h.bladderFill >= 0.94) h.bladderFill = 0.16;
  h.bowelLoad = clamp01(
    h.bowelLoad + dose * (0.016 + h.stomachFill * 0.024),
  );
  if (h.bowelLoad >= 0.97) h.bowelLoad = 0.24;

  const circulatoryHealth = clamp01(body.systems.circulatory);
  const respiratoryHealth = clamp01(body.systems.respiratory);
  const endurance = clamp01(agent.life.physiology.endurance);
  const hydrationBloodTarget = clamp01(
    0.82 +
    h.hydration * 0.18 -
    bleedingLoad * 0.07,
  );
  h.bloodVolumeFraction = clamp01(
    approachBodyValueV1(
      h.bloodVolumeFraction,
      hydrationBloodTarget,
      bleedingLoad > 0.05 ? 4 * 60 : 3 * DAY,
      elapsedWorldMinutes,
    ),
  );

  const exertionTarget = sleeping
    ? 0
    : clamp01(load * (1.08 - endurance * 0.46));
  h.exertionDebt = clamp01(
    approachBodyValueV1(
      h.exertionDebt,
      exertionTarget,
      exertionTarget > h.exertionDebt ? 150 : 90,
      elapsedWorldMinutes,
    ),
  );
  h.oxygenDebt = clamp01(
    approachBodyValueV1(
      h.oxygenDebt,
      clamp01(
        load * (0.86 - respiratoryHealth * 0.48) +
        fear * 0.1 +
        h.inflammation * 0.08,
      ),
      80,
      elapsedWorldMinutes,
    ),
  );
  h.cardiovascularLoad = clamp01(
    approachBodyValueV1(
      h.cardiovascularLoad,
      clamp01(
        0.04 +
        load * (0.64 - circulatoryHealth * 0.24) +
        h.autonomicArousal * 0.22 +
        (1 - h.hydration) * 0.16,
      ),
      50,
      elapsedWorldMinutes,
    ),
  );
  h.respiratoryLoad = clamp01(
    approachBodyValueV1(
      h.respiratoryLoad,
      clamp01(
        0.035 +
        load * (0.62 - respiratoryHealth * 0.24) +
        h.oxygenDebt * 0.28 +
        fear * 0.08,
      ),
      45,
      elapsedWorldMinutes,
    ),
  );
  h.muscleFatigue = clamp01(
    approachBodyValueV1(
      h.muscleFatigue,
      clamp01(
        load * (0.92 - agent.life.physiology.strength * 0.24) +
        h.energyReserve < 0.28 ? 0.08 : 0
      ),
      sleeping || load < 0.1 ? 5 * 60 : 4 * 60,
      elapsedWorldMinutes,
    ),
  );

  const restorative = sleeping
    ? 0.82
    : agent.lastAction === 'rest'
      ? 0.52
      : agent.lastAction === 'relax'
        ? 0.38
        : 0.06;
  h.recoveryDebt = clamp01(
    approachBodyValueV1(
      h.recoveryDebt,
      clamp01(
        h.muscleFatigue * 0.42 +
        h.inflammation * 0.26 +
        pregnancy * 0.22 +
        postpartum * 0.32 -
        restorative * agent.life.physiology.recovery * 0.4,
      ),
      8 * 60,
      elapsedWorldMinutes,
    ),
  );

  h.toxinLoad = clamp01(
    approachBodyValueV1(h.toxinLoad, 0, 2 * DAY, elapsedWorldMinutes),
  );
  h.nausea = clamp01(
    approachBodyValueV1(
      h.nausea,
      clamp01(
        digestiveDisease * 0.52 +
        h.toxinLoad * 0.42 +
        h.inflammation * 0.12 +
        pregnancy * 0.08,
      ),
      4 * 60,
      elapsedWorldMinutes,
    ),
  );
  h.dizziness = clamp01(
    approachBodyValueV1(
      h.dizziness,
      clamp01(
        (1 - h.hydration) * 0.3 +
        (1 - h.bloodVolumeFraction) * 0.45 +
        h.oxygenDebt * 0.22,
      ),
      45,
      elapsedWorldMinutes,
    ),
  );

  h.physicalPleasure = clamp01(
    approachBodyValueV1(h.physicalPleasure, 0, 3 * 60, elapsedWorldMinutes),
  );
  if (h.sexualArousal !== undefined) {
    h.sexualArousal = clamp01(
      approachBodyValueV1(h.sexualArousal, 0, 2 * 60, elapsedWorldMinutes),
    );
  }

  const reproductiveTarget = clamp01(
    agent.life.health * 0.55 +
    agent.life.physiology.recovery * 0.25 +
    h.energyReserve * 0.1 +
    h.hydration * 0.1 -
    h.inflammation * 0.18,
  );
  core.reproductive.reproductiveHealth = clamp01(
    approachBodyValueV1(
      core.reproductive.reproductiveHealth,
      reproductiveTarget,
      30 * DAY,
      elapsedWorldMinutes,
    ),
  );

  if (core.reproductive.type === 'male' && core.reproductive.refractoryLoad !== undefined) {
    core.reproductive.refractoryLoad = clamp01(
      approachBodyValueV1(
        core.reproductive.refractoryLoad,
        0,
        90,
        elapsedWorldMinutes,
      ),
    );
  } else if (core.reproductive.type === 'female' && core.reproductive.postpartum) {
    core.reproductive.postpartum.recoveryLoad = clamp01(
      approachBodyValueV1(
        core.reproductive.postpartum.recoveryLoad,
        0,
        21 * DAY,
        elapsedWorldMinutes,
      ),
    );
    if (core.reproductive.postpartum.recoveryLoad < 0.02) {
      delete core.reproductive.postpartum;
    }
  }

  core.lastAdvancedWorldMinute = world.calendar.elapsedWorldMinutes;
  return bodySignalsV1(agent, body, core);
}

function diseaseWeight(value: number): number {
  return clamp01(value);
}

/**
 * Converts body sensations into bounded mind/stress feedback. It never chooses
 * an action and never writes personality, values or relationship state.
 */
export function applyBodyMindFeedbackV1(
  agent: AgentState,
  body: Readonly<V21BodyState>,
  signals: Readonly<BodySignalsV1>,
  elapsedWorldMinutes: number,
): void {
  if (!agent.life.alive || !(elapsedWorldMinutes > 0)) return;
  const dose = clamp01(elapsedWorldMinutes / SEMANTIC_QUANTUM);
  const discomfort =
    signals.physicalDiscomfort * 0.32 +
    signals.thirst * 0.18 +
    signals.hunger * 0.14 +
    signals.breathlessness * 0.18 +
    signals.weakness * 0.1 +
    Math.max(signals.coldStress, signals.heatStress) * 0.08;
  const relief =
    signals.physicalPleasure * 0.62 +
    signals.postPleasureRelaxation * 0.38;

  agent.stress = clamp01(
    agent.stress +
    dose * (discomfort * 0.018 - relief * 0.015),
  );
  agent.mind.emotions.fear = clamp01(
    agent.mind.emotions.fear +
    dose * (
      signals.breathlessness * 0.006 +
      signals.startle * 0.004 +
      Math.max(signals.coldStress, signals.heatStress) * 0.003 +
      body.pain * 0.004 -
      signals.postPleasureRelaxation * 0.003
    ),
  );
  agent.mind.emotions.joy = clamp01(
    agent.mind.emotions.joy +
    dose * (
      signals.physicalPleasure * 0.014 +
      signals.postPleasureRelaxation * 0.006 -
      signals.physicalDiscomfort * 0.004
    ),
  );
  agent.mind.emotions.hope = clamp01(
    agent.mind.emotions.hope -
    dose * signals.weakness * 0.0018,
  );
}

/**
 * Salience only. These pressures may affect which goal the mind considers, but
 * they do not directly execute eating, drinking, resting or any other action.
 */
export function bodyDecisionPressureV1(
  world: Readonly<WorldState>,
  agent: Readonly<AgentState>,
): BodyDecisionPressureV1 {
  const body = world.v21?.bodiesByAgentId[agent.id];
  const core = body?.bodyCore;
  if (!body || !core) return { recover: 0, secureResources: 0 };
  const signals = bodySignalsV1(agent, body, core);
  return {
    recover: clamp01(
      signals.weakness * 0.42 +
      signals.breathlessness * 0.28 +
      signals.physicalDiscomfort * 0.2 +
      Math.max(signals.coldStress, signals.heatStress) * 0.1,
    ),
    secureResources: clamp01(
      signals.thirst * 0.58 + signals.hunger * 0.42,
    ),
  };
}

/**
 * Physical response to an already voluntary adult intimacy event.
 * This function never creates consent, desire, love, trust or child intent.
 */
export function recordAdultIntimacyBodyResponseV1(
  world: WorldState,
  a: AgentState,
  b: AgentState,
  mutualAttachment: number,
  mutualIntimacyInterest: number,
): AdultIntimacyBodyResponseV1[] {
  if (
    a.life.ageYears < 18 ||
    b.life.ageYears < 18 ||
    !a.life.alive ||
    !b.life.alive
  ) return [];

  const responses: AdultIntimacyBodyResponseV1[] = [];
  for (const agent of [a, b]) {
    const body = world.v21?.bodiesByAgentId[agent.id];
    if (!body) continue;
    const core = ensureBodyCoreV1(world, agent, body);
    if (!core || core.homeostasis.sexualArousal === undefined) continue;

    const signals = bodySignalsV1(agent, body, core);
    const comfort = clamp01(1 - signals.physicalDiscomfort);
    const availableEnergy = clamp01(
      agent.energy * 0.55 + core.homeostasis.energyReserve * 0.45,
    );
    const arousal = clamp01(
      0.16 +
      mutualIntimacyInterest * 0.48 +
      mutualAttachment * 0.18 +
      comfort * 0.12 +
      availableEnergy * 0.08 -
      agent.stress * 0.14 -
      body.pain * 0.18,
    );
    const pleasure = clamp01(
      arousal *
      (0.46 + mutualAttachment * 0.28 + comfort * 0.22) *
      (0.58 + agent.life.health * 0.42) *
      (1 - body.pain * 0.42),
    );
    const relaxation = clamp01(
      pleasure * (0.5 + mutualAttachment * 0.28),
    );

    core.homeostasis.sexualArousal = Math.max(
      core.homeostasis.sexualArousal,
      arousal,
    );
    core.homeostasis.physicalPleasure = Math.max(
      core.homeostasis.physicalPleasure,
      pleasure,
    );
    core.homeostasis.autonomicArousal = Math.max(
      core.homeostasis.autonomicArousal,
      arousal * 0.72,
    );
    core.homeostasis.muscleTension = Math.max(
      core.homeostasis.muscleTension,
      arousal * 0.28,
    );

    if (core.reproductive.type === 'male') {
      core.reproductive.refractoryLoad = Math.max(
        core.reproductive.refractoryLoad ?? 0,
        pleasure * 0.78,
      );
    }

    // Immediate interpretation of physical reward. Relationship meaning still
    // belongs to the normal mind/memory systems.
    agent.stress = clamp01(
      agent.stress - relaxation * 0.025,
    );
    agent.mind.emotions.joy = clamp01(
      agent.mind.emotions.joy + pleasure * 0.024,
    );
    agent.mind.emotions.fear = clamp01(
      agent.mind.emotions.fear - relaxation * 0.006,
    );

    responses.push({
      agentId: agent.id,
      arousal,
      pleasure,
      relaxation,
    });
  }
  return responses;
}
