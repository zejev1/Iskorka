export interface HumanVisionDevelopmentV1 {
  ageYears: number;
  acuityScale: number;
  contrastScale: number;
  motionScale: number;
  recognitionReachScale: number;
}

interface VisionAnchorV1 extends Omit<HumanVisionDevelopmentV1, 'ageYears'> {
  age: number;
}

/**
 * Experimental simulation calibration for ordinary visual maturation and
 * normal ageing. It is deliberately not an ophthalmic diagnosis table.
 * Severe impairment must come from a separate physical condition, not age.
 */
const VISION_ANCHORS_V1: readonly VisionAnchorV1[] = [
  { age: 0, acuityScale: 0.16, contrastScale: 0.2, motionScale: 0.35, recognitionReachScale: 0.18 },
  { age: 0.25, acuityScale: 0.32, contrastScale: 0.38, motionScale: 0.55, recognitionReachScale: 0.32 },
  { age: 0.5, acuityScale: 0.48, contrastScale: 0.54, motionScale: 0.68, recognitionReachScale: 0.46 },
  { age: 0.75, acuityScale: 0.6, contrastScale: 0.64, motionScale: 0.76, recognitionReachScale: 0.58 },
  { age: 1, acuityScale: 0.7, contrastScale: 0.72, motionScale: 0.82, recognitionReachScale: 0.68 },
  { age: 2, acuityScale: 0.82, contrastScale: 0.84, motionScale: 0.9, recognitionReachScale: 0.8 },
  { age: 5, acuityScale: 0.94, contrastScale: 0.94, motionScale: 0.97, recognitionReachScale: 0.93 },
  { age: 10, acuityScale: 0.99, contrastScale: 0.99, motionScale: 1, recognitionReachScale: 0.99 },
  { age: 18, acuityScale: 1, contrastScale: 1, motionScale: 1, recognitionReachScale: 1 },
  { age: 55, acuityScale: 0.98, contrastScale: 0.96, motionScale: 0.97, recognitionReachScale: 0.98 },
  { age: 70, acuityScale: 0.93, contrastScale: 0.88, motionScale: 0.92, recognitionReachScale: 0.93 },
  { age: 85, acuityScale: 0.84, contrastScale: 0.78, motionScale: 0.84, recognitionReachScale: 0.86 },
  { age: 100, acuityScale: 0.76, contrastScale: 0.68, motionScale: 0.76, recognitionReachScale: 0.78 },
];

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

function interpolate(a: number, b: number, t: number): number {
  return a + (b - a) * clamp01(t);
}

export function humanVisionDevelopmentV1(ageYearsInput: number): HumanVisionDevelopmentV1 {
  const ageYears = Math.max(0, Number.isFinite(ageYearsInput) ? ageYearsInput : 0);
  if (ageYears >= VISION_ANCHORS_V1[VISION_ANCHORS_V1.length - 1].age) {
    const last = VISION_ANCHORS_V1[VISION_ANCHORS_V1.length - 1];
    return {
      ageYears,
      acuityScale: last.acuityScale,
      contrastScale: last.contrastScale,
      motionScale: last.motionScale,
      recognitionReachScale: last.recognitionReachScale,
    };
  }

  let lower = VISION_ANCHORS_V1[0];
  let upper = VISION_ANCHORS_V1[1];
  for (let index = 1; index < VISION_ANCHORS_V1.length; index += 1) {
    if (ageYears <= VISION_ANCHORS_V1[index].age) {
      lower = VISION_ANCHORS_V1[index - 1];
      upper = VISION_ANCHORS_V1[index];
      break;
    }
  }
  const t = upper.age === lower.age ? 0 : (ageYears - lower.age) / (upper.age - lower.age);
  return {
    ageYears,
    acuityScale: interpolate(lower.acuityScale, upper.acuityScale, t),
    contrastScale: interpolate(lower.contrastScale, upper.contrastScale, t),
    motionScale: interpolate(lower.motionScale, upper.motionScale, t),
    recognitionReachScale: interpolate(lower.recognitionReachScale, upper.recognitionReachScale, t),
  };
}

export function humanVisualCapacityV1(
  ageYears: number,
  individualBaseline: number,
  nervousSystemHealth: number,
): number {
  const development = humanVisionDevelopmentV1(ageYears);
  return clamp01(
    development.acuityScale * 0.42 +
    development.contrastScale * 0.18 +
    development.motionScale * 0.12 +
    development.recognitionReachScale * 0.18 +
    clamp01(individualBaseline) * 0.07 +
    clamp01(nervousSystemHealth) * 0.03,
  );
}
