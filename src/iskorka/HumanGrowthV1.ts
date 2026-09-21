export interface HumanGrowthScalesV1 {
  heightScale: number;
  massScale: number;
}

interface GrowthAnchorV1 extends HumanGrowthScalesV1 {
  ageYears: number;
}

/*
 * Compact human growth calibration. It corrects the old single power curve,
 * which made a 9-month child weigh almost the same as a newborn. Values are
 * deliberately approximate ratios to mature size rather than a medical chart.
 */
const GROWTH_ANCHORS: readonly GrowthAnchorV1[] = [
  { ageYears: 0, heightScale: 0.29, massScale: 0.045 },
  { ageYears: 0.5, heightScale: 0.38, massScale: 0.10 },
  { ageYears: 0.75, heightScale: 0.41, massScale: 0.12 },
  { ageYears: 1, heightScale: 0.44, massScale: 0.135 },
  { ageYears: 2, heightScale: 0.50, massScale: 0.18 },
  { ageYears: 3, heightScale: 0.55, massScale: 0.22 },
  { ageYears: 5, heightScale: 0.64, massScale: 0.30 },
  { ageYears: 10, heightScale: 0.82, massScale: 0.55 },
  { ageYears: 15, heightScale: 0.96, massScale: 0.82 },
  { ageYears: 18, heightScale: 1, massScale: 1 },
] as const;

export function humanGrowthScalesV1(ageYears: number): HumanGrowthScalesV1 {
  if (!Number.isFinite(ageYears) || ageYears < 0) {
    throw new Error('ageYears must be finite and non-negative.');
  }
  if (ageYears >= 18) return { heightScale: 1, massScale: 1 };
  for (let index = 1; index < GROWTH_ANCHORS.length; index += 1) {
    const right = GROWTH_ANCHORS[index];
    if (ageYears > right.ageYears) continue;
    const left = GROWTH_ANCHORS[index - 1];
    const t = (ageYears - left.ageYears) / (right.ageYears - left.ageYears);
    return {
      heightScale: left.heightScale + (right.heightScale - left.heightScale) * t,
      massScale: left.massScale + (right.massScale - left.massScale) * t,
    };
  }
  return { heightScale: 1, massScale: 1 };
}
