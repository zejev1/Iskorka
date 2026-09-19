import type {
  AgentSex,
  AgentState,
  V21BodyState,
  WorldState,
} from '../world/types';

export const BODY_CORE_VERSION_V1 = 1 as const;
const ISKORKA_PROFILE = 'iskorka-human-lab-v1';
const DAY = 24 * 60;
const POSTPARTUM_RECOVERY_HALF_LIFE = 21 * DAY;
const POSTPARTUM_MAX_RECOVERY = 84 * DAY;

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));
const clampSigned = (value: number): number => Math.max(-1, Math.min(1, value));

function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function stableUnit(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 0xffffffff;
}

function stableBetween(key: string, min: number, max: number): number {
  return min + (max - min) * stableUnit(key);
}

function seedFor(world: Readonly<WorldState>, agent: Readonly<AgentState>): string {
  return `${world.bootstrapSeed ?? `${world.id}:epoch:${world.epoch ?? 1}`}:${agent.id}:${agent.sex ?? 'unknown'}`;
}

function growthFraction(ageYears: number): number {
  if (ageYears >= 18) return 1;
  return clamp01(Math.max(0, ageYears) / 18);
}

export interface BodyPhenotypeV1 {
  biologicalSex: AgentSex;
  heightM: number;
  massKg: number;
  bodyFatFraction: number;
  painSensitivity: number;
  sweatSensitivity: number;
  motionSicknessSensitivity: number;
}

export interface BodyHomeostasisV1 {
  hydration: number;
  electrolyteDeviation: number;
  energyReserve: number;
  stomachFill: number;
  bladderFill: number;
  bowelLoad: number;

  coreTemperatureC: number;
  skinTemperatureC: number;
  bloodVolumeFraction: number;
  oxygenDebt: number;
  cardiovascularLoad: number;
  respiratoryLoad: number;

  exertionDebt: number;
  muscleFatigue: number;
  recoveryDebt: number;

  inflammation: number;
  immuneActivation: number;
  toxinLoad: number;
  nausea: number;
  dizziness: number;

  autonomicArousal: number;
  muscleTension: number;
  stressHormoneLoad: number;
  tearDrive: number;
  physicalPleasure: number;

  /** Adult physical signal only. It is not desire, consent or a decision. */
  sexualArousal?: number;
}

export interface PregnancyBodyStateV1 {
  conceptionWorldMinute: number;
  dueWorldMinute: number;
  expectedChildCount: 1 | 2 | 3 | 4;
}

export interface PostpartumBodyStateV1 {
  startedWorldMinute: number;
  recoveryLoad: number;
}

export interface MaleSexBodyStateV1 {
  type: 'male';
  reproductiveHealth: number;
  /** Adult-only recovery state. */
  refractoryLoad?: number;
}

export interface FemaleSexBodyStateV1 {
  type: 'female';
  reproductiveHealth: number;
  /** Adult-only ovarian-cycle phase. Not stored for minors or pregnancy. */
  cyclePhase?: number;
  pregnancy?: PregnancyBodyStateV1;
  postpartum?: PostpartumBodyStateV1;
}

export type SexBodyStateV1 = MaleSexBodyStateV1 | FemaleSexBodyStateV1;

export interface BodyCoreV1 {
  version: typeof BODY_CORE_VERSION_V1;
  sex: AgentSex;
  phenotype: BodyPhenotypeV1;
  homeostasis: BodyHomeostasisV1;
  reproductive: SexBodyStateV1;
  createdWorldMinute: number;
  lastAdvancedWorldMinute: number;
}

export interface BodySignalsV1 {
  thirst: number;
  hunger: number;
  breathlessness: number;
  weakness: number;
  coldStress: number;
  heatStress: number;
  sweating: number;
  tremor: number;
  heartPounding: number;
  bladderUrge: number;
  bowelUrge: number;
  physicalDiscomfort: number;
  cryingDrive: number;
}

function phenotypeFor(
  world: Readonly<WorldState>,
  agent: Readonly<AgentState>,
  existing?: Readonly<BodyPhenotypeV1>,
): BodyPhenotypeV1 {
  if (agent.sex !== 'male' && agent.sex !== 'female') {
    throw new Error(`BodyCore requires biological sex for ${agent.id}.`);
  }
  const key = seedFor(world, agent);
  const adultHeightM = agent.sex === 'male'
    ? stableBetween(`${key}:height`, 1.56, 1.94)
    : stableBetween(`${key}:height`, 1.45, 1.82);
  const adultBmi = stableBetween(`${key}:bmi`, 19.2, 28.5);
  const adultMassKg = adultBmi * adultHeightM * adultHeightM;
  const growth = growthFraction(agent.life.ageYears);
  const heightScale = agent.life.ageYears >= 18
    ? 1
    : 0.29 + 0.71 * Math.pow(growth, 0.58);
  const massScale = agent.life.ageYears >= 18
    ? 1
    : 0.045 + 0.955 * Math.pow(growth, 2.05);
  const bodyFatFraction = agent.sex === 'male'
    ? stableBetween(`${key}:body-fat`, 0.10, 0.29)
    : stableBetween(`${key}:body-fat`, 0.17, 0.39);

  return {
    biologicalSex: agent.sex,
    heightM: adultHeightM * heightScale,
    massKg: adultMassKg * massScale,
    bodyFatFraction,
    painSensitivity: existing?.painSensitivity ??
      stableBetween(`${key}:pain-sensitivity`, 0.18, 0.88),
    sweatSensitivity: existing?.sweatSensitivity ??
      stableBetween(`${key}:sweat-sensitivity`, 0.20, 0.90),
    motionSicknessSensitivity: existing?.motionSicknessSensitivity ??
      stableBetween(`${key}:motion-sickness`, 0.08, 0.86),
  };
}

function reproductiveHealth(agent: Readonly<AgentState>): number {
  const age = agent.life.ageYears;
  const ageScale = age < 18
    ? 0.55 + clamp01(age / 18) * 0.45
    : age <= 35
      ? 1
      : age <= 50
        ? 1 - (age - 35) / 60
        : Math.max(0.22, 0.75 - (age - 50) / 55);
  return clamp01(
    agent.life.health * 0.55 +
    agent.life.physiology.recovery * 0.25 +
    agent.life.physiology.endurance * 0.12 +
    ageScale * 0.08,
  );
}

function cyclePhaseAt(
  world: Readonly<WorldState>,
  agent: Readonly<AgentState>,
): number {
  const key = seedFor(world, agent);
  const cycleDays = 25 + Math.floor(stableUnit(`${key}:cycle-length`) * 8);
  const offsetDays = stableUnit(`${key}:cycle-offset`) * cycleDays;
  const day = world.calendar.elapsedWorldMinutes / DAY;
  return ((day + offsetDays) % cycleDays) / cycleDays;
}

function createReproductiveState(
  world: Readonly<WorldState>,
  agent: Readonly<AgentState>,
): SexBodyStateV1 {
  if (agent.sex === 'male') {
    return {
      type: 'male',
      reproductiveHealth: reproductiveHealth(agent),
      ...(agent.life.ageYears >= 18 ? { refractoryLoad: 0 } : {}),
    };
  }
  if (agent.sex === 'female') {
    return {
      type: 'female',
      reproductiveHealth: reproductiveHealth(agent),
      ...(agent.life.ageYears >= 18 ? { cyclePhase: cyclePhaseAt(world, agent) } : {}),
    };
  }
  throw new Error(`BodyCore cannot create a reproductive body without sex for ${agent.id}.`);
}

function createHomeostasis(
  world: Readonly<WorldState>,
  agent: Readonly<AgentState>,
  body: Readonly<V21BodyState>,
): BodyHomeostasisV1 {
  const key = seedFor(world, agent);
  const diseaseLoad = clamp01(body.diseases.reduce((sum, disease) => sum + disease.severity, 0));
  const woundLoad = clamp01(body.wounds.reduce((sum, wound) => sum + wound.severity, 0));
  const rhythm = world.v18?.lifeRhythmByAgentId[agent.id];
  const satiety = clamp01(rhythm?.satiety ?? (0.55 + agent.resources * 0.3));
  const fear = clamp01(agent.mind.emotions.fear);
  const grief = clamp01(agent.mind.emotions.grief);
  const arousal = clamp01(agent.stress * 0.48 + fear * 0.34);

  return {
    hydration: clamp01(stableBetween(`${key}:hydration`, 0.90, 0.98)),
    electrolyteDeviation: 0,
    energyReserve: clamp01(0.52 + agent.resources * 0.28 + agent.energy * 0.12),
    stomachFill: satiety,
    bladderFill: stableBetween(`${key}:bladder`, 0.08, 0.24),
    bowelLoad: stableBetween(`${key}:bowel`, 0.08, 0.26),

    coreTemperatureC: stableBetween(`${key}:core-temp`, 36.75, 37.18),
    skinTemperatureC: stableBetween(`${key}:skin-temp`, 32.3, 33.7),
    bloodVolumeFraction: clamp01(1 - body.wounds.reduce((sum, wound) => sum + wound.bleeding * 0.015, 0)),
    oxygenDebt: 0,
    cardiovascularLoad: clamp01(0.06 + arousal * 0.12),
    respiratoryLoad: clamp01(0.05 + arousal * 0.10),

    exertionDebt: 0,
    muscleFatigue: clamp01((1 - agent.energy) * 0.16),
    recoveryDebt: clamp01((1 - agent.life.physiology.recovery) * 0.08),

    inflammation: clamp01(diseaseLoad * 0.35 + woundLoad * 0.12),
    immuneActivation: clamp01(diseaseLoad * 0.48 + woundLoad * 0.08),
    toxinLoad: 0,
    nausea: clamp01(
      body.diseases
        .filter((disease) => disease.kind === 'digestive')
        .reduce((sum, disease) => sum + disease.severity * 0.45, 0),
    ),
    dizziness: 0,

    autonomicArousal: arousal,
    muscleTension: clamp01(agent.stress * 0.38 + fear * 0.28),
    stressHormoneLoad: clamp01(agent.stress * 0.52 + fear * 0.32 + body.pain * 0.16),
    tearDrive: clamp01(grief * 0.55 + fear * 0.18 + body.pain * 0.22),
    physicalPleasure: 0,
    ...(agent.life.ageYears >= 18 ? { sexualArousal: 0 } : {}),
  };
}

export function createBodyCoreV1(
  world: Readonly<WorldState>,
  agent: Readonly<AgentState>,
  body: Readonly<V21BodyState>,
): BodyCoreV1 {
  if (agent.sex !== 'male' && agent.sex !== 'female') {
    throw new Error(`BodyCore requires male/female sex for ${agent.id}.`);
  }
  return {
    version: BODY_CORE_VERSION_V1,
    sex: agent.sex,
    phenotype: phenotypeFor(world, agent),
    homeostasis: createHomeostasis(world, agent, body),
    reproductive: createReproductiveState(world, agent),
    createdWorldMinute: world.calendar.elapsedWorldMinutes,
    lastAdvancedWorldMinute: world.calendar.elapsedWorldMinutes,
  };
}

export function shouldHaveBodyCoreV1(
  world: Readonly<WorldState>,
  agent: Readonly<AgentState>,
): boolean {
  return world.simulationProfile === ISKORKA_PROFILE &&
    (agent.race ?? 'human') === 'human' &&
    agent.life.alive;
}

/**
 * Additive save repair. It never rolls sex. Existing agent.sex is authoritative.
 * Quantitative phenotype variation is deterministic and consumes no world RNG.
 */
export function ensureBodyCoreV1(
  world: Readonly<WorldState>,
  agent: Readonly<AgentState>,
  body: V21BodyState,
): BodyCoreV1 | undefined {
  if (!shouldHaveBodyCoreV1(world, agent)) return undefined;
  if (agent.sex !== 'male' && agent.sex !== 'female') {
    throw new Error(`Iskorka resident ${agent.id} has no biological sex.`);
  }

  const existing = body.bodyCore;
  if (!existing) {
    const created = createBodyCoreV1(world, agent, body);
    body.bodyCore = created;
    return created;
  }

  if (
    existing.version !== BODY_CORE_VERSION_V1 ||
    existing.sex !== agent.sex ||
    existing.phenotype.biologicalSex !== agent.sex ||
    existing.reproductive.type !== agent.sex
  ) {
    throw new Error(`BodyCore sex/version mismatch for ${agent.id}.`);
  }

  // Physical growth is deterministic from age and the persisted seed; sensitivities
  // stay individual. This is a cheap repair/update, not a second sex roll.
  existing.phenotype = phenotypeFor(world, agent, existing.phenotype);

  const adult = agent.life.ageYears >= 18;
  const now = world.calendar.elapsedWorldMinutes;
  const elapsedSinceBodyAdvance = Math.max(0, now - existing.lastAdvancedWorldMinute);
  if (adult) {
    existing.homeostasis.sexualArousal ??= 0;
    if (existing.reproductive.type === 'male') {
      existing.reproductive.refractoryLoad ??= 0;
    } else {
      const postpartum = existing.reproductive.postpartum;
      if (postpartum) {
        const postpartumAge = Math.max(0, now - postpartum.startedWorldMinute);
        postpartum.recoveryLoad = clamp01(
          approachBodyValueV1(
            postpartum.recoveryLoad,
            0,
            POSTPARTUM_RECOVERY_HALF_LIFE,
            elapsedSinceBodyAdvance,
          ),
        );
        if (postpartumAge >= POSTPARTUM_MAX_RECOVERY || postpartum.recoveryLoad < 0.02) {
          delete existing.reproductive.postpartum;
        }
      }
      if (!existing.reproductive.pregnancy && !existing.reproductive.postpartum) {
        existing.reproductive.cyclePhase = cyclePhaseAt(world, agent);
      } else {
        delete existing.reproductive.cyclePhase;
      }
    }
  } else {
    delete existing.homeostasis.sexualArousal;
    if (existing.reproductive.type === 'male') {
      delete existing.reproductive.refractoryLoad;
    } else {
      delete existing.reproductive.cyclePhase;
      delete existing.reproductive.pregnancy;
      delete existing.reproductive.postpartum;
    }
  }
  existing.lastAdvancedWorldMinute = now;
  return existing;
}

export function setBodyCorePregnancyV1(
  world: WorldState,
  agentId: string,
  pregnancy: PregnancyBodyStateV1,
): void {
  const agent = world.agents[agentId];
  const body = world.v21?.bodiesByAgentId[agentId];
  if (!agent || !body) return;
  const core = ensureBodyCoreV1(world, agent, body);
  if (!core || core.reproductive.type !== 'female' || agent.life.ageYears < 18) {
    throw new Error(`Pregnancy requires an adult female BodyCore for ${agentId}.`);
  }
  core.reproductive.pregnancy = {
    conceptionWorldMinute: pregnancy.conceptionWorldMinute,
    dueWorldMinute: pregnancy.dueWorldMinute,
    expectedChildCount: pregnancy.expectedChildCount,
  };
  delete core.reproductive.postpartum;
  delete core.reproductive.cyclePhase;
}

export function completeBodyCorePregnancyV1(
  world: WorldState,
  agentId: string,
  childCount: 1 | 2 | 3 | 4,
): void {
  const agent = world.agents[agentId];
  const body = world.v21?.bodiesByAgentId[agentId];
  if (!agent || !body) return;
  const core = ensureBodyCoreV1(world, agent, body);
  if (!core || core.reproductive.type !== 'female') {
    throw new Error(`Childbirth requires a female BodyCore for ${agentId}.`);
  }
  delete core.reproductive.pregnancy;
  core.reproductive.postpartum = {
    startedWorldMinute: world.calendar.elapsedWorldMinutes,
    recoveryLoad: clamp01(0.22 + (childCount - 1) * 0.16),
  };
  delete core.reproductive.cyclePhase;
}

export function reconcileBodyCorePregnanciesV1(world: WorldState): void {
  if (world.simulationProfile !== ISKORKA_PROFILE || !world.v21) return;
  const pregnant = new Map<string, PregnancyBodyStateV1>();
  for (const lifecycle of Object.values(world.v16?.familyLifecycleByPairId ?? {})) {
    if (
      lifecycle.stage !== 'pregnant' ||
      !lifecycle.pregnantAgentId ||
      lifecycle.conceptionWorldMinute === undefined ||
      lifecycle.dueWorldMinute === undefined
    ) continue;
    pregnant.set(lifecycle.pregnantAgentId, {
      conceptionWorldMinute: lifecycle.conceptionWorldMinute,
      dueWorldMinute: lifecycle.dueWorldMinute,
      expectedChildCount: Math.max(1, Math.min(4, Math.trunc(lifecycle.expectedChildCount ?? 1))) as 1 | 2 | 3 | 4,
    });
  }

  for (const [agentId, body] of Object.entries(world.v21.bodiesByAgentId)) {
    const agent = world.agents[agentId];
    if (!agent?.life.alive) continue;
    const core = ensureBodyCoreV1(world, agent, body);
    if (!core || core.reproductive.type !== 'female') continue;
    const pregnancy = pregnant.get(agentId);
    if (pregnancy) {
      core.reproductive.pregnancy = pregnancy;
      delete core.reproductive.postpartum;
      delete core.reproductive.cyclePhase;
    } else if (core.reproductive.pregnancy) {
      // Lifecycle is the authoritative pregnancy record until BodyCore owns
      // conception in a later phase. Never keep a phantom pregnancy.
      delete core.reproductive.pregnancy;
      if (agent.life.ageYears >= 18 && !core.reproductive.postpartum) {
        core.reproductive.cyclePhase = cyclePhaseAt(world, agent);
      }
    }
  }
}

function requireUnit(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`${label} must be finite in 0..1.`);
  }
  return value;
}

export function assertBodyCoreV1(
  agent: Readonly<AgentState>,
  core: Readonly<BodyCoreV1>,
): void {
  if (agent.sex !== 'male' && agent.sex !== 'female') {
    throw new Error(`BodyCore owner ${agent.id} has invalid sex.`);
  }
  if (
    core.version !== BODY_CORE_VERSION_V1 ||
    core.sex !== agent.sex ||
    core.phenotype.biologicalSex !== agent.sex ||
    core.reproductive.type !== agent.sex
  ) {
    throw new Error(`BodyCore sex/version mismatch for ${agent.id}.`);
  }

  if (!Number.isFinite(core.phenotype.heightM) || core.phenotype.heightM < 0.35 || core.phenotype.heightM > 2.25) {
    throw new Error(`BodyCore ${agent.id} height is invalid.`);
  }
  if (!Number.isFinite(core.phenotype.massKg) || core.phenotype.massKg < 1.5 || core.phenotype.massKg > 260) {
    throw new Error(`BodyCore ${agent.id} mass is invalid.`);
  }
  requireUnit(core.phenotype.bodyFatFraction, `BodyCore ${agent.id}.bodyFatFraction`);
  requireUnit(core.phenotype.painSensitivity, `BodyCore ${agent.id}.painSensitivity`);
  requireUnit(core.phenotype.sweatSensitivity, `BodyCore ${agent.id}.sweatSensitivity`);
  requireUnit(core.phenotype.motionSicknessSensitivity, `BodyCore ${agent.id}.motionSicknessSensitivity`);

  const h = core.homeostasis;
  for (const key of [
    'hydration', 'energyReserve', 'stomachFill', 'bladderFill', 'bowelLoad',
    'bloodVolumeFraction', 'oxygenDebt', 'cardiovascularLoad', 'respiratoryLoad',
    'exertionDebt', 'muscleFatigue', 'recoveryDebt', 'inflammation',
    'immuneActivation', 'toxinLoad', 'nausea', 'dizziness', 'autonomicArousal',
    'muscleTension', 'stressHormoneLoad', 'tearDrive', 'physicalPleasure',
  ] as const) requireUnit(h[key], `BodyCore ${agent.id}.${key}`);
  if (!Number.isFinite(h.electrolyteDeviation) || h.electrolyteDeviation < -1 || h.electrolyteDeviation > 1) {
    throw new Error(`BodyCore ${agent.id}.electrolyteDeviation is invalid.`);
  }
  if (!Number.isFinite(h.coreTemperatureC) || h.coreTemperatureC < 25 || h.coreTemperatureC > 45) {
    throw new Error(`BodyCore ${agent.id}.coreTemperatureC is invalid.`);
  }
  if (!Number.isFinite(h.skinTemperatureC) || h.skinTemperatureC < 5 || h.skinTemperatureC > 45) {
    throw new Error(`BodyCore ${agent.id}.skinTemperatureC is invalid.`);
  }

  requireUnit(core.reproductive.reproductiveHealth, `BodyCore ${agent.id}.reproductiveHealth`);
  const adult = agent.life.ageYears >= 18;
  if (adult) {
    requireUnit(h.sexualArousal, `BodyCore ${agent.id}.sexualArousal`);
  } else if (h.sexualArousal !== undefined) {
    throw new Error(`Minor ${agent.id} cannot have adult sexual physiology.`);
  }

  const rawReproductive = core.reproductive as unknown as Record<string, unknown>;
  if (core.reproductive.type === 'male') {
    if ('cyclePhase' in rawReproductive || 'pregnancy' in rawReproductive || 'postpartum' in rawReproductive) {
      throw new Error(`Male BodyCore ${agent.id} contains female reproductive state.`);
    }
    if (adult) requireUnit(core.reproductive.refractoryLoad, `BodyCore ${agent.id}.refractoryLoad`);
    else if (core.reproductive.refractoryLoad !== undefined) {
      throw new Error(`Minor ${agent.id} cannot have adult refractory physiology.`);
    }
  } else {
    if ('refractoryLoad' in rawReproductive) {
      throw new Error(`Female BodyCore ${agent.id} contains male reproductive state.`);
    }
    if (!adult && (core.reproductive.cyclePhase !== undefined || core.reproductive.pregnancy || core.reproductive.postpartum)) {
      throw new Error(`Minor ${agent.id} cannot have adult female reproductive state.`);
    }
    if (core.reproductive.cyclePhase !== undefined) {
      requireUnit(core.reproductive.cyclePhase, `BodyCore ${agent.id}.cyclePhase`);
    }
    if (core.reproductive.pregnancy) {
      const p = core.reproductive.pregnancy;
      if (
        !Number.isFinite(p.conceptionWorldMinute) ||
        !Number.isFinite(p.dueWorldMinute) ||
        p.dueWorldMinute <= p.conceptionWorldMinute ||
        p.expectedChildCount < 1 || p.expectedChildCount > 4
      ) throw new Error(`BodyCore ${agent.id} pregnancy is invalid.`);
    }
    if (core.reproductive.postpartum) {
      if (!Number.isFinite(core.reproductive.postpartum.startedWorldMinute)) {
        throw new Error(`BodyCore ${agent.id} postpartum time is invalid.`);
      }
      requireUnit(core.reproductive.postpartum.recoveryLoad, `BodyCore ${agent.id}.postpartum.recoveryLoad`);
    }
  }
}

export function bodySignalsV1(
  agent: Readonly<AgentState>,
  body: Readonly<V21BodyState>,
  core: Readonly<BodyCoreV1>,
): BodySignalsV1 {
  const h = core.homeostasis;
  const coldStress = clamp01((36.45 - h.coreTemperatureC) / 2.8 + (31.5 - h.skinTemperatureC) / 10);
  const heatStress = clamp01((h.coreTemperatureC - 37.25) / 2.1 + (h.skinTemperatureC - 34) / 9);
  const breathlessness = clamp01(
    h.respiratoryLoad * 0.42 +
    h.oxygenDebt * 0.42 +
    h.exertionDebt * 0.16,
  );
  const weakness = clamp01(
    (1 - h.energyReserve) * 0.24 +
    (1 - h.hydration) * 0.24 +
    (1 - h.bloodVolumeFraction) * 0.28 +
    h.oxygenDebt * 0.16 +
    h.muscleFatigue * 0.08,
  );
  const thirst = clamp01(
    (1 - h.hydration) * 0.68 +
    Math.abs(h.electrolyteDeviation) * 0.12 +
    heatStress * 0.11 +
    h.exertionDebt * 0.09,
  );
  const hunger = clamp01(
    (1 - h.energyReserve) * 0.58 +
    (1 - h.stomachFill) * 0.34 +
    h.exertionDebt * 0.08,
  );
  const sweating = clamp01(
    heatStress * 0.58 +
    h.exertionDebt * 0.2 +
    h.autonomicArousal * 0.14 +
    core.phenotype.sweatSensitivity * 0.08,
  ) * h.hydration;
  const tremor = clamp01(Math.max(
    coldStress,
    h.autonomicArousal * core.phenotype.painSensitivity * 0.62,
    h.muscleFatigue * 0.5,
  ));
  const physicalDiscomfort = clamp01(
    body.pain * 0.28 +
    h.nausea * 0.14 +
    h.dizziness * 0.10 +
    Math.max(coldStress, heatStress) * 0.16 +
    breathlessness * 0.16 +
    h.muscleFatigue * 0.08 +
    h.bladderFill * 0.04 +
    h.bowelLoad * 0.04,
  );
  return {
    thirst,
    hunger,
    breathlessness,
    weakness,
    coldStress,
    heatStress,
    sweating,
    tremor,
    heartPounding: clamp01(h.cardiovascularLoad * 0.58 + h.autonomicArousal * 0.42),
    bladderUrge: clamp01((h.bladderFill - 0.55) / 0.45),
    bowelUrge: clamp01((h.bowelLoad - 0.62) / 0.38),
    physicalDiscomfort,
    cryingDrive: clamp01(h.tearDrive * (0.72 + core.phenotype.painSensitivity * 0.28)),
  };
}

/** Utility for later analytic catch-up. Kept pure so large dt never needs microticks. */
export function approachBodyValueV1(
  value: number,
  target: number,
  halfLifeWorldMinutes: number,
  elapsedWorldMinutes: number,
): number {
  if (!(halfLifeWorldMinutes > 0) || !(elapsedWorldMinutes > 0)) return finite(value, target);
  const decay = Math.pow(0.5, elapsedWorldMinutes / halfLifeWorldMinutes);
  return target + (finite(value, target) - target) * decay;
}

export function clampBodySignedV1(value: number): number {
  return clampSigned(value);
}
