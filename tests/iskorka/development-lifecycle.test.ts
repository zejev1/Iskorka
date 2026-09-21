import test from 'node:test';
import assert from 'node:assert/strict';
import { humanGrowthScalesV1 } from '../../src/iskorka/HumanGrowthV1';
import {
  brainDevelopmentProfileV1,
  createBlankNewbornBrainSeedV1,
} from '../../src/iskorka/BrainLifecycleV1';
import { deriveChildContinuityBlueprintV15 } from '../../src/v15/FamilyInheritanceV15';
import { initialRussianKnowledgeV18 } from '../../src/v18/UnderworldFoundationV18';

test('9-month body uses infant growth rather than the old near-newborn mass curve', () => {
  const infant = humanGrowthScalesV1(0.75);
  assert.ok(infant.heightScale >= 0.39 && infant.heightScale <= 0.43);
  assert.ok(infant.massScale >= 0.11 && infant.massScale <= 0.13);
  assert.deepEqual(humanGrowthScalesV1(18), { heightScale: 1, massScale: 1 });
});

test('newborn BrainLifecycle seed has learning machinery but zero acquired content', () => {
  const seed = createBlankNewbornBrainSeedV1('child-1', 1234);
  assert.equal(seed.innate.reflexes, true);
  assert.equal(seed.innate.interoception, true);
  assert.equal(seed.innate.sensoryLearning, true);
  assert.equal(seed.innate.associativeLearning, true);
  assert.deepEqual(seed.acquired, {
    episodes: [],
    concepts: [],
    skills: [],
    lexicon: [],
    personModels: [],
    promises: [],
  });
});

test('9-month brain can learn associations but is not adult symbolic/narrative cognition', () => {
  const infant = brainDevelopmentProfileV1(0.75);
  assert.equal(infant.phase, 'infant');
  assert.ok(infant.proceduralLearning > infant.symbolicReasoning);
  assert.ok(infant.receptiveLanguage > infant.expressiveLanguage);
  assert.ok(infant.expressiveLanguage < 0.05);
  assert.ok(infant.planning < 0.05);
  assert.equal(infant.adultLikeNarrativeReflection, false);
});

test('normal old age slows access without deleting consolidated lifetime experience', () => {
  const adult = brainDevelopmentProfileV1(30);
  const elder = brainDevelopmentProfileV1(90);
  assert.equal(adult.consolidatedExperienceIntegrity, 1);
  assert.equal(elder.consolidatedExperienceIntegrity, 1);
  assert.ok(elder.retrievalSpeed < adult.retrievalSpeed);
  assert.ok(elder.workingMemory < adult.workingMemory);
  assert.ok(elder.retrievalReliability > 0.7);
  assert.equal(elder.adultLikeNarrativeReflection, true);
});

test('severe cognitive decline is separate from chronological age', () => {
  const healthy = brainDevelopmentProfileV1(90);
  const impaired = brainDevelopmentProfileV1(90, {
    neurologicalIntegrity: 0.35,
    memoryIntegrity: 1,
  });
  assert.equal(impaired.consolidatedExperienceIntegrity, 1);
  assert.ok(impaired.retrievalReliability < healthy.retrievalReliability * 0.7);
  assert.ok(impaired.workingMemory < healthy.workingMemory * 0.7);
});

test('legacy birth blueprint no longer copies acquired values, beliefs or skills', () => {
  const parent = (id: string, sex: 'male'|'female') => ({
    id,
    sex,
    race: 'human',
    generation: 0,
    resources: 0.7,
    homeId: 'home',
    socialDrive: 0.8,
    personality: {
      sociability: 0.7,
      diligence: 0.8,
      curiosity: 0.9,
      generosity: 0.6,
      resilience: 0.75,
      riskTolerance: 0.5,
    },
    values: { care: 0.9, freedom: 0.8, knowledge: 0.95, tradition: 0.7, ambition: 0.85 },
    beliefs: { worldTrust: 0.8, divinePresence: 0.7, fate: 0.6, afterlife: 0.75 },
    skills: { gathering: 0.8, hunting: 0.7, craft: 0.9, social: 0.8, exploration: 0.75 },
  });
  let sequence = 0;
  const draws = [0.2,0.7,0.4,0.6,0.3,0.8,0.45,0.55,0.25,0.65,0.35,0.75,0.15,0.85,0.5];
  const source = {
    next: () => draws[sequence++ % draws.length],
    between: (minimum: number, maximum: number) => minimum + (maximum - minimum) * draws[sequence++ % draws.length],
  };
  const child = deriveChildContinuityBlueprintV15(
    parent('a','male'),
    parent('b','female'),
    source,
  );
  assert.deepEqual(child.values, { care: 0, freedom: 0, knowledge: 0, tradition: 0, ambition: 0 });
  assert.deepEqual(child.beliefs, { worldTrust: 0, divinePresence: 0, fate: 0, afterlife: 0 });
  assert.deepEqual(child.skills, { gathering: 0, hunting: 0, craft: 0, social: 0, exploration: 0 });
  assert.notDeepEqual(child.personality, { sociability: 0, diligence: 0, curiosity: 0, generosity: 0, resilience: 0, riskTolerance: 0 });
});

test('legacy Russian layer gives a newborn no innate vocabulary or comprehension', () => {
  const newborn = {
    life: { ageYears: 0 },
  } as Parameters<typeof initialRussianKnowledgeV18>[0];
  const language = initialRussianKnowledgeV18(newborn);
  assert.equal(language.spokenComprehension, 0);
  assert.equal(language.spokenExpression, 0);
  assert.equal(language.vocabulary, 0);
  assert.equal(language.cyrillicLiteracy, 0);
});

test('growth and brain lifecycle profiles stay cheap under large repeated use', () => {
  const start = performance.now();
  let checksum = 0;
  for (let index = 0; index < 250_000; index += 1) {
    const age = (index % 11_000) / 100;
    checksum += humanGrowthScalesV1(age).massScale;
    checksum += brainDevelopmentProfileV1(age).retrievalReliability;
  }
  const elapsedMs = performance.now() - start;
  assert.ok(checksum > 0);
  // Broad CI regression guard, not a claim about S24 performance.
  assert.ok(
    elapsedMs < 2_500,
    `lifespan profile benchmark took ${elapsedMs.toFixed(1)} ms`,
  );
});
