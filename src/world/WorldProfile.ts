import type { WorldState, WildlifePopulation } from './types';

/** Persistent physical-world policy. Not a controller or an agent. */
export const ISKORKA_PROFILE = 'iskorka-human-lab-v1' as const;
export const ISKORKA_FOUNDERS = ['Алексей', 'Анна', 'Михаил', 'Мария', 'Иван', 'Елена', 'Дмитрий', 'Ольга', 'Андрей', 'София'] as const;
export function isIskorka(world: { profile?: unknown }): boolean {
  return world.profile === ISKORKA_PROFILE;
}

/** Only bootstrap data: never a per-tick rescue, population target, or teleport. */
export function finishIskorkaBootstrap(world: WorldState): void {
  if (!isIskorka(world)) return;
  world.settlements.settlement_ainkrad.name = 'Основание';
  const labels: Record<string, string> = {
    commons: 'Площадь Основания', resource_field: 'Поля Основания',
    workshop: 'Мастерская Основания', quiet_space: 'Сад Основания', outskirts: 'Окраина Основания',
  };
  for (const [id, name] of Object.entries(labels)) if (world.places[id]) world.places[id].name = name;
  // Finite, ordinary populations on existing physical habitats. No RNG consumption
  // and no new places/coordinates. Regeneration/hunting remain the donor physics.
  const pools: Array<[string, WildlifePopulation['species'], number, number, number]> = [
    ['outskirts', 'rabbit', 12, 24, .04], ['quiet_space', 'deer', 8, 16, .08],
    ['ocean_ainkrad', 'fish', 30, 60, .02],
  ];
  for (const [habitatId, species, count, carryingCapacity, threat] of pools) {
    const id = `wildlife:${habitatId}:${species}`;
    world.wildlife[id] = { id, species, habitatId, count, carryingCapacity,
      reproductionRate: .012, alertness: .15, threat, isMonster: false, lastChangedAt: world.now };
  }
  delete world.centuryHumpback;
}

/** Reject corruption rather than deleting living actors on load or after a tick. */
export function assertIskorkaProfile(world: WorldState): void {
  if (world.profile !== undefined && !isIskorka(world)) throw new Error('Unknown world profile; explicit migration required.');
  if (!isIskorka(world)) return;
  if (world.centuryHumpback !== undefined) throw new Error('Iskorka cannot contain a century monster controller.');
  if (Object.values(world.agents).some(a => (a.race ?? 'human') !== 'human')) throw new Error('Iskorka is a human-only world.');
  if (Object.values(world.wildlife).some(a => a.isMonster)) throw new Error('Iskorka cannot contain monsters.');
  if (world.v15?.genesisTeachers.length) throw new Error('Iskorka cannot contain hidden Genesis teachers.');
  if (Object.keys(world.v19?.adventureEconomy.dungeonsById ?? {}).length) throw new Error('Iskorka cannot contain dungeons.');
  if (world.settlements.settlement_ainkrad?.name !== 'Основание') throw new Error('The founding settlement must remain Osnovanie.');
}
