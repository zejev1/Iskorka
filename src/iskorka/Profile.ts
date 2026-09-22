import type { WorldState, WildlifePopulation } from '../world/types';
import {
  FOUNDING_SPARK_START_AGE_YEARS_V1,
  assertFoundingMentorsV1,
  ensureFoundingMentorWorldV1,
} from './FoundingMentorsV1';

export const ISKORKA_PROFILE = 'iskorka-human-lab-v1' as const;
export const ISKORKA_VERSION = '0.1.0-stage1';
export const ISKORKA_FOUNDER_NAMES = [
  'Андрей', 'Анна', 'Борис', 'Вера', 'Данил', 'Дарья', 'Иван', 'Мария', 'Лев', 'Софья',
] as const;
export const ISKORKA_WORLD_ID = 'iskorka-human-world-v1';
export const ISKORKA_DATABASE = 'iskorka-human-lab-v1';

export function isIskorkaWorld(world: Readonly<WorldState>): boolean {
  return world.simulationProfile === ISKORKA_PROFILE;
}

/** Initial ecology inhabits existing, compatible physical sites. No map relocation or knowledge injection. */
export function initializeIskorkaWorld(world: WorldState, seed: string): void {
  world.simulationProfile = ISKORKA_PROFILE;
  world.bootstrapSeed = seed;
  const town = world.settlements.settlement_ainkrad;
  if (town) town.name = 'Основание';
  for (const place of Object.values(world.places)) {
    if (place.settlementId === 'settlement_ainkrad' || place.id === 'commons') {
      place.name = place.name.replace(/Айнкрада/g, 'Основания').replace(/Айнкрад/g, 'Основание');
    }
  }
  // No physics is invented here: the founding ecology uses the normal F2
  // wildlife populations, but the first children need real, reachable animals
  // in the places their guardians can physically take them to.  Keeping the
  // starter populations on the nearby outskirts also prevents an accidental
  // "hunting lesson" that is only a number in a brain while every edible
  // animal actually lives tens of kilometres away.
  const outskirts = world.places.outskirts;
  const foundationLake = world.places.foundation_lake;
  const ocean = world.places.ocean_ainkrad;
  const additions: WildlifePopulation[] = [];
  if (outskirts?.surface === 'land') {
    for (const [species, count, carryingCapacity, threat, alertness] of [
      ['rabbit', 10, 24, 0.03, 0.22],
      ['deer', 6, 16, 0.08, 0.3],
      ['boar', 4, 10, 0.24, 0.34],
      ['bird', 12, 28, 0.02, 0.25],
    ] as const) additions.push({
      id: `wildlife_foundation_${species}`, species, habitatId: outskirts.id,
      count, carryingCapacity, reproductionRate: 0.14, alertness,
      threat, isMonster: false, lastChangedAt: world.now,
    });
  }
  if (foundationLake?.kind === 'lake' && (foundationLake.waterPolygon?.length ?? 0) >= 3) {
    additions.push({
      id: 'wildlife_foundation_lake_fish', species: 'fish', habitatId: foundationLake.id,
      count: 18, carryingCapacity: 48, reproductionRate: 0.22, alertness: 0.14,
      threat: 0.01, isMonster: false, lastChangedAt: world.now,
    });
  }
  if (ocean?.surface === 'water') additions.push({
    id: 'wildlife_foundation_fish', species: 'fish', habitatId: ocean.id,
    count: 12, carryingCapacity: 32, reproductionRate: 0.2, alertness: 0.12,
    threat: 0.02, isMonster: false, lastChangedAt: world.now,
  });
  for (const population of additions) world.wildlife[population.id] ??= population;
  ensureFoundingMentorWorldV1(world);
  assertIskorkaProfile(world, true);
}

/** Runtime/save boundary: unsupported content fails visibly instead of being deleted from a save. */
export function assertIskorkaProfile(world: Readonly<WorldState>, fresh = false): void {
  if (!isIskorkaWorld(world)) throw new Error('Сохранение не принадлежит Искорке.');
  const agents = Object.values(world.agents);
  if (agents.some(a => (a.race ?? 'human') !== 'human')) throw new Error('В Искорке обнаружена запрещённая раса.');
  if (Object.values(world.wildlife).some(a => a.isMonster || ['dire_wolf', 'ogre', 'wraith', 'century_humpback'].includes(a.species))) {
    throw new Error('В Искорке обнаружен монстр.');
  }
  if (world.centuryHumpback) throw new Error('В Искорке не должно быть цикла монстр-событий.');
  if (Object.values(world.places).some(p => /^(?:settlement_|race_)?(?:elf|dwarf|goblin|orc|ogre)(?:_|$)/.test(p.id))) throw new Error('В Искорке обнаружена локация другой расы.');
  if (Object.keys(world.v19?.adventureEconomy?.dungeonsById ?? {}).length) throw new Error('В Искорке обнаружено подземелье.');
  if ((world.v15?.genesisTeachers.length ?? 0) !== 0) throw new Error('Старые скрытые Genesis-учителя в Искорке отключены.');
  if (world.iskorkaMentorsV1) assertFoundingMentorsV1(world);
  if (fresh) {
    if (!world.iskorkaMentorsV1) throw new Error('Новый мир Искорки требует пять наставников.');
    if (
      agents.length !== 10 ||
      agents.filter(a => a.sex === 'male').length !== 5 ||
      agents.filter(a => a.sex === 'female').length !== 5 ||
      agents.some(
        a =>
          !a.life.alive ||
          Math.abs(a.life.ageYears - FOUNDING_SPARK_START_AGE_YEARS_V1) > 1e-9 ||
          a.life.generation !== 0,
      )
    ) {
      throw new Error('Старт Искорки требует десять шестимесячных Искр: пять мальчиков и пять девочек.');
    }
    if (Object.keys(world.settlements).length !== 1) throw new Error('Старт Искорки требует одно поселение.');
    if (Object.values(world.places).filter(p => p.kind === 'library').length !== 1) throw new Error('Старт Искорки требует одну библиотеку.');
  }
}
