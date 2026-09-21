import type { AgentActionKind } from '../world/types';

export interface HumanMotorDevelopmentV1 {
  ageYears: number;
  grossMotor: number;
  balance: number;
  coordination: number;
  fineMotor: number;
  walkingCapacity: number;
  enduranceScale: number;
}

interface MotorAnchorV1 extends Omit<HumanMotorDevelopmentV1, 'ageYears'> {
  age: number;
}

const ANCHORS: readonly MotorAnchorV1[] = [
  { age: 0, grossMotor: 0.04, balance: 0.02, coordination: 0.03, fineMotor: 0.04, walkingCapacity: 0, enduranceScale: 0.05 },
  { age: 0.5, grossMotor: 0.22, balance: 0.14, coordination: 0.13, fineMotor: 0.2, walkingCapacity: 0, enduranceScale: 0.1 },
  { age: 0.75, grossMotor: 0.34, balance: 0.25, coordination: 0.22, fineMotor: 0.3, walkingCapacity: 0.03, enduranceScale: 0.14 },
  { age: 1, grossMotor: 0.48, balance: 0.38, coordination: 0.32, fineMotor: 0.4, walkingCapacity: 0.22, enduranceScale: 0.2 },
  { age: 1.25, grossMotor: 0.62, balance: 0.52, coordination: 0.44, fineMotor: 0.5, walkingCapacity: 0.48, enduranceScale: 0.26 },
  { age: 1.5, grossMotor: 0.74, balance: 0.64, coordination: 0.55, fineMotor: 0.59, walkingCapacity: 0.66, enduranceScale: 0.32 },
  { age: 2, grossMotor: 0.86, balance: 0.78, coordination: 0.7, fineMotor: 0.7, walkingCapacity: 0.82, enduranceScale: 0.42 },
  { age: 3, grossMotor: 0.94, balance: 0.89, coordination: 0.84, fineMotor: 0.82, walkingCapacity: 0.94, enduranceScale: 0.55 },
  { age: 5, grossMotor: 0.98, balance: 0.96, coordination: 0.94, fineMotor: 0.92, walkingCapacity: 0.99, enduranceScale: 0.7 },
  { age: 10, grossMotor: 1, balance: 1, coordination: 0.99, fineMotor: 0.98, walkingCapacity: 1, enduranceScale: 0.88 },
  { age: 18, grossMotor: 1, balance: 1, coordination: 1, fineMotor: 1, walkingCapacity: 1, enduranceScale: 1 },
];

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

function interpolate(a: number, b: number, t: number): number {
  return a + (b - a) * clamp01(t);
}

export function humanMotorDevelopmentV1(ageYearsInput: number): HumanMotorDevelopmentV1 {
  const ageYears = Math.max(0, Number.isFinite(ageYearsInput) ? ageYearsInput : 0);
  if (ageYears >= 18) {
    return { ageYears, grossMotor: 1, balance: 1, coordination: 1, fineMotor: 1, walkingCapacity: 1, enduranceScale: 1 };
  }
  let lower = ANCHORS[0];
  let upper = ANCHORS[ANCHORS.length - 1];
  for (let index = 1; index < ANCHORS.length; index += 1) {
    if (ageYears <= ANCHORS[index].age) {
      lower = ANCHORS[index - 1];
      upper = ANCHORS[index];
      break;
    }
  }
  const t = upper.age === lower.age ? 0 : (ageYears - lower.age) / (upper.age - lower.age);
  return {
    ageYears,
    grossMotor: interpolate(lower.grossMotor, upper.grossMotor, t),
    balance: interpolate(lower.balance, upper.balance, t),
    coordination: interpolate(lower.coordination, upper.coordination, t),
    fineMotor: interpolate(lower.fineMotor, upper.fineMotor, t),
    walkingCapacity: interpolate(lower.walkingCapacity, upper.walkingCapacity, t),
    enduranceScale: interpolate(lower.enduranceScale, upper.enduranceScale, t),
  };
}

export function humanMotorMobilityScaleV1(ageYears: number): number {
  const motor = humanMotorDevelopmentV1(ageYears);
  if (motor.walkingCapacity < 0.45) return 0;
  return clamp01(
    motor.walkingCapacity * 0.52 +
    motor.balance * 0.2 +
    motor.coordination * 0.18 +
    motor.enduranceScale * 0.1,
  );
}

/**
 * Only physical locomotion is changed here. Cognitive/social permissions stay
 * in their own developmental layers.
 */
export function applyHumanMotorActionEnvelopeV1(
  ageYears: number,
  base: ReadonlySet<AgentActionKind>,
): ReadonlySet<AgentActionKind> {
  const actions = new Set(base);
  const mobility = humanMotorMobilityScaleV1(ageYears);
  if (mobility <= 0) {
    actions.delete('walk');
    actions.delete('explore');
    actions.delete('hunt');
    actions.delete('gather');
    actions.delete('work');
    return actions;
  }
  if (humanMotorDevelopmentV1(ageYears).walkingCapacity >= 0.48) {
    actions.add('walk');
  }
  return actions;
}
