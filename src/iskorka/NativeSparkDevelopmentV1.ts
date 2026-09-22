import type { AgentState } from '../world/types';

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

function approach(current: number, target: number, rate: number): number {
  return clamp01(current + (target - current) * clamp01(rate));
}

/**
 * Lived development only. These functions never pick an action for the Spark.
 * They update slow personal meaning after something actually happened to them.
 */
export function recordMentorCareDevelopmentV1(
  agent: AgentState,
  intensity = 1,
): void {
  const dose = clamp01(intensity);
  const careTarget = clamp01(
    0.24 + agent.personality.generosity * 0.5 + agent.personality.sociability * 0.12,
  );
  const trustTarget = clamp01(
    0.3 + agent.personality.resilience * 0.38 + agent.personality.sociability * 0.12,
  );
  agent.mind.values.care = approach(
    agent.mind.values.care,
    careTarget,
    0.0045 * dose,
  );
  agent.mind.beliefs.worldTrust = approach(
    agent.mind.beliefs.worldTrust,
    trustTarget,
    0.004 * dose,
  );
  agent.mind.emotions.hope = approach(
    agent.mind.emotions.hope,
    clamp01(0.32 + trustTarget * 0.45),
    0.003 * dose,
  );
  agent.mind.emotions.fear = approach(
    agent.mind.emotions.fear,
    clamp01(0.06 + (1 - trustTarget) * 0.16),
    0.0028 * dose,
  );
  agent.mind.memoryCoherence = approach(
    agent.mind.memoryCoherence,
    clamp01(0.34 + agent.personality.resilience * 0.34),
    0.0022 * dose,
  );
}

export function recordMentorLessonDevelopmentV1(
  agent: AgentState,
  gained: number,
): void {
  const dose = clamp01(gained * 12 + 0.1);
  const knowledgeTarget = clamp01(
    0.2 + agent.personality.curiosity * 0.58 + agent.personality.diligence * 0.12,
  );
  agent.mind.values.knowledge = approach(
    agent.mind.values.knowledge,
    knowledgeTarget,
    0.004 * dose,
  );
  agent.mind.memoryCoherence = approach(
    agent.mind.memoryCoherence,
    clamp01(0.44 + agent.personality.diligence * 0.32),
    0.003 * dose,
  );
  agent.mind.emotions.awe = approach(
    agent.mind.emotions.awe,
    clamp01(0.08 + agent.personality.curiosity * 0.24),
    0.0018 * dose,
  );
}

export function recordVoluntaryPracticeDevelopmentV1(
  agent: AgentState,
  accepted: boolean,
  succeeded: boolean,
): void {
  const freedomTarget = clamp01(
    0.22 +
      agent.personality.curiosity * 0.3 +
      agent.personality.riskTolerance * 0.3,
  );
  agent.mind.values.freedom = approach(
    agent.mind.values.freedom,
    freedomTarget,
    accepted ? 0.004 : 0.002,
  );
  agent.mind.autonomy = approach(
    agent.mind.autonomy,
    clamp01(0.42 + freedomTarget * 0.42),
    accepted ? 0.005 : 0.0025,
  );
  if (accepted) {
    const ambitionTarget = clamp01(
      0.16 + agent.personality.diligence * 0.56 + agent.personality.riskTolerance * 0.12,
    );
    agent.mind.values.ambition = approach(
      agent.mind.values.ambition,
      ambitionTarget,
      succeeded ? 0.0036 : 0.0018,
    );
    agent.mind.emotions.hope = approach(
      agent.mind.emotions.hope,
      clamp01(0.3 + agent.personality.resilience * 0.38),
      succeeded ? 0.003 : 0.001,
    );
  }
}
