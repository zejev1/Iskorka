import type { AgentState, WorldState } from '../world/types';
import { ensureLifeRhythmV18 } from '../v18/LivelihoodAndRhythmV18';
import { ensureBodyCoreV1 } from './BodyCoreV1';

const HOUR = 60;
const DAY = 24 * HOUR;
export const RELEASED_SPARK_BODY_BOUNDARY_WORLD_MINUTES_V1 = 3 * HOUR;

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

export type ReleasedSparkFatalCauseV1 = 'dehydration' | 'starvation';

export interface ReleasedSparkSurvivalAdvanceV1 {
  advancedWorldMinutes: number;
  forceSleep: boolean;
  fatalCause?: ReleasedSparkFatalCauseV1;
}

export function isReleasedFoundingSparkV1(
  world: Readonly<WorldState>,
  agent: Readonly<AgentState>,
): boolean {
  const mentors = world.iskorkaMentorsV1;
  if (!mentors || mentors.active) return false;
  return (
    agent.life.alive &&
    agent.life.ageYears >= mentors.releaseAgeYears &&
    mentors.cohortStudentIds.includes(agent.id)
  );
}

export function hasReleasedFoundingSparksV1(
  world: Readonly<WorldState>,
): boolean {
  return Object.values(world.agents).some((agent) =>
    isReleasedFoundingSparkV1(world, agent),
  );
}

/**
 * Absolute physical boundary. It depends only on canonical world time, never
 * caller frame size, so year/min acceleration cannot change physiology.
 */
export function nextReleasedSparkBodyBoundaryV1(worldMinute: number): number {
  const quantum = RELEASED_SPARK_BODY_BOUNDARY_WORLD_MINUTES_V1;
  return (Math.floor(Math.max(0, worldMinute) / quantum) + 1) * quantum;
}

/**
 * Body-only survival clock after the scripted guardians have truly left.
 *
 * This function deliberately contains NO action selection. It can make a
 * person thirsty, hungry, tired, weak or critically ill; it cannot decide to
 * walk, drink, eat, hunt, farm, sleep voluntarily or visit a library.
 */
export function advanceReleasedSparkSurvivalV1(
  world: WorldState,
  agent: AgentState,
  fromWorldMinute: number,
  toWorldMinute: number,
  sleeping: boolean,
): ReleasedSparkSurvivalAdvanceV1 {
  if (
    !isReleasedFoundingSparkV1(world, agent) ||
    !(toWorldMinute > fromWorldMinute)
  ) {
    return { advancedWorldMinutes: 0, forceSleep: false };
  }

  const body = world.v21?.bodiesByAgentId[agent.id];
  if (!body) return { advancedWorldMinutes: 0, forceSleep: false };
  const core = ensureBodyCoreV1(world, agent, body);
  if (!core) return { advancedWorldMinutes: 0, forceSleep: false };

  const survival = core.releasedAdultSurvivalV1 ??= {
    lastAdvancedWorldMinute: fromWorldMinute,
    metabolicReserve: core.homeostasis.energyReserve,
    criticalDehydrationWorldMinutes: 0,
    criticalStarvationWorldMinutes: 0,
  };
  const effectiveFrom = Math.max(
    fromWorldMinute,
    survival.lastAdvancedWorldMinute,
  );
  const elapsed = Math.max(0, toWorldMinute - effectiveFrom);
  if (!(elapsed > 0)) {
    return {
      advancedWorldMinutes: 0,
      forceSleep: !sleeping && agent.energy <= 0,
      ...(survival.fatalCause ? { fatalCause: survival.fatalCause } : {}),
    };
  }

  const days = elapsed / DAY;
  const h = core.homeostasis;
  const rhythm = ensureLifeRhythmV18(world, agent);

  // Hunger becomes noticeable within hours. This is sensation/metabolism only:
  // no pantry, granary, field or hunt is accessed here.
  rhythm.satiety = clamp01(rhythm.satiety - days * 0.46);
  h.stomachFill = clamp01(h.stomachFill - days * 0.55);

  // Human dehydration becomes critical in days, not simulated years.
  // Heat/exertion remain additive in BodyPhysiologyV1.
  h.hydration = clamp01(h.hydration - days * 0.27);
  h.electrolyteDeviation = Math.max(
    -1,
    Math.min(
      1,
      h.electrolyteDeviation +
        days * 0.08 * Math.max(0, 0.75 - h.hydration),
    ),
  );

  // Long-term stored metabolic reserve: starvation takes weeks rather than the
  // same timescale as thirst. BodyPhysiology may model short-term energy, but
  // it may never invent calories above this physically depleted reserve.
  const hungerPressure = clamp01(1 - rhythm.satiety);
  survival.metabolicReserve = clamp01(
    survival.metabolicReserve -
      days * (0.012 + hungerPressure * 0.032),
  );
  h.energyReserve = Math.min(h.energyReserve, survival.metabolicReserve);

  // Wakefulness is a body constraint. Collapse is not a decision script.
  if (!sleeping) {
    agent.energy = clamp01(
      agent.energy - elapsed / (18 * HOUR),
    );
  }

  const dehydrationSeverity = clamp01((0.38 - h.hydration) / 0.38);
  const starvationSeverity = clamp01(
    Math.max(
      (0.22 - survival.metabolicReserve) / 0.22,
      (0.12 - rhythm.satiety) / 0.12,
    ),
  );
  if (dehydrationSeverity > 0 || starvationSeverity > 0) {
    agent.life.health = clamp01(
      agent.life.health -
        days * (
          dehydrationSeverity * 0.075 +
          starvationSeverity * 0.022
        ),
    );
    agent.stress = clamp01(
      agent.stress +
        days * (
          dehydrationSeverity * 0.09 +
          starvationSeverity * 0.035
        ),
    );
  }

  if (h.hydration <= 0.12) {
    survival.criticalDehydrationWorldMinutes += elapsed;
  } else {
    survival.criticalDehydrationWorldMinutes = Math.max(
      0,
      survival.criticalDehydrationWorldMinutes - elapsed * 0.5,
    );
  }

  if (
    survival.metabolicReserve <= 0.06 &&
    rhythm.satiety <= 0.05
  ) {
    survival.criticalStarvationWorldMinutes += elapsed;
  } else {
    survival.criticalStarvationWorldMinutes = Math.max(
      0,
      survival.criticalStarvationWorldMinutes - elapsed * 0.2,
    );
  }

  if (
    survival.criticalDehydrationWorldMinutes >= 18 * HOUR
  ) {
    survival.fatalCause = 'dehydration';
    agent.life.health = Math.min(agent.life.health, 0.01);
  } else if (
    survival.criticalStarvationWorldMinutes >= 7 * DAY
  ) {
    survival.fatalCause = 'starvation';
    agent.life.health = Math.min(agent.life.health, 0.01);
  }

  survival.lastAdvancedWorldMinute = toWorldMinute;
  return {
    advancedWorldMinutes: elapsed,
    forceSleep: !sleeping && agent.energy <= 0,
    ...(survival.fatalCause ? { fatalCause: survival.fatalCause } : {}),
  };
}
