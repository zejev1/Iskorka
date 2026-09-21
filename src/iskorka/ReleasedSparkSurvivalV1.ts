import type { AgentState, WorldState } from '../world/types';
import { ensureLifeRhythmV18 } from '../v18/LivelihoodAndRhythmV18';
import { ensureBodyCoreV1 } from './BodyCoreV1';

const HOUR = 60;
const DAY = 24 * HOUR;
export const RELEASED_SPARK_BODY_BOUNDARY_WORLD_MINUTES_V1 = 3 * HOUR;

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));
const canonical = (value: number): number =>
  Math.round(clamp01(value) * 1e12) / 1e12;
const HYDRATION_LOSS_PER_MINUTE = 0.27 / DAY;
const SATIETY_LOSS_PER_MINUTE = 0.46 / DAY;
const STOMACH_LOSS_PER_MINUTE = 0.55 / DAY;
const METABOLIC_RESERVE_LOSS_PER_MINUTE = 0.032 / DAY;

function timeBelowLinearThreshold(
  startValue: number,
  endValue: number,
  threshold: number,
  lossPerMinute: number,
  elapsedWorldMinutes: number,
): number {
  if (endValue > threshold) return 0;
  if (startValue <= threshold) return elapsedWorldMinutes;
  if (!(lossPerMinute > 0)) return 0;
  const minutesUntilThreshold = Math.max(
    0,
    (startValue - threshold) / lossPerMinute,
  );
  return Math.max(0, elapsedWorldMinutes - minutesUntilThreshold);
}

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
  if (
    !mentors ||
    mentors.active ||
    mentors.farewellStartedWorldMinute === undefined ||
    mentors.departureStartedWorldMinute === undefined
  ) return false;
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

  const h = core.homeostasis;
  const rhythm = ensureLifeRhythmV18(world, agent);
  const hydrationBefore = h.hydration;
  const satietyBefore = rhythm.satiety;
  const stomachBefore = h.stomachFill;
  const reserveBefore = survival.metabolicReserve;

  // All passive depletion is linear in canonical world minutes. No result
  // depends on whether the caller supplied one large interval or many small
  // frames. Actual eat/drink actions are the only positive inputs.
  h.hydration = canonical(
    hydrationBefore - elapsed * HYDRATION_LOSS_PER_MINUTE,
  );
  rhythm.satiety = canonical(
    satietyBefore - elapsed * SATIETY_LOSS_PER_MINUTE,
  );
  h.stomachFill = canonical(
    stomachBefore - elapsed * STOMACH_LOSS_PER_MINUTE,
  );
  survival.metabolicReserve = canonical(
    reserveBefore - elapsed * METABOLIC_RESERVE_LOSS_PER_MINUTE,
  );
  h.energyReserve = Math.min(
    h.energyReserve,
    survival.metabolicReserve,
  );

  // Dehydration perturbs electrolytes but cannot create energy or an action.
  h.electrolyteDeviation = Math.max(
    -1,
    Math.min(
      1,
      h.electrolyteDeviation +
        (elapsed / DAY) * 0.08 * Math.max(0, 0.75 - h.hydration),
    ),
  );

  // Wakefulness is a body constraint. Collapse is not a decision script.
  if (!sleeping) {
    agent.energy = canonical(
      agent.energy - elapsed / (18 * HOUR),
    );
  }

  const dehydrationBelow = timeBelowLinearThreshold(
    hydrationBefore,
    h.hydration,
    0.12,
    HYDRATION_LOSS_PER_MINUTE,
    elapsed,
  );
  if (h.hydration <= 0.12) {
    survival.criticalDehydrationWorldMinutes += dehydrationBelow;
  } else {
    survival.criticalDehydrationWorldMinutes = 0;
  }

  let starvationBelow = 0;
  if (
    survival.metabolicReserve <= 0.06 &&
    rhythm.satiety <= 0.05
  ) {
    const reserveBelow = timeBelowLinearThreshold(
      reserveBefore,
      survival.metabolicReserve,
      0.06,
      METABOLIC_RESERVE_LOSS_PER_MINUTE,
      elapsed,
    );
    const satietyBelow = timeBelowLinearThreshold(
      satietyBefore,
      rhythm.satiety,
      0.05,
      SATIETY_LOSS_PER_MINUTE,
      elapsed,
    );
    starvationBelow = Math.min(reserveBelow, satietyBelow);
    survival.criticalStarvationWorldMinutes += starvationBelow;
  } else {
    survival.criticalStarvationWorldMinutes = 0;
  }

  survival.criticalDehydrationWorldMinutes =
    Math.round(survival.criticalDehydrationWorldMinutes * 1e9) / 1e9;
  survival.criticalStarvationWorldMinutes =
    Math.round(survival.criticalStarvationWorldMinutes * 1e9) / 1e9;

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
