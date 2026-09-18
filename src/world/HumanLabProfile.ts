import type { WorldState, WildlifePopulation } from './types';

export const ISKORKA_PROFILE = 'iskorka-human-lab-v1' as const;
export const ISKORKA_FOUNDER_NAMES = ['Алексей', 'Мира', 'Илья', 'Анна', 'Марк', 'Лея', 'Данил', 'Нина', 'Роман', 'Тая'] as const;
export const isHumanLab = (world: { readonly profile?: string }): boolean => world.profile === ISKORKA_PROFILE;

/** Applied once at epoch creation, never on reload: no replenishing food or resurrecting animals. */
export function initializeHumanLab(world: WorldState): void {
  if (!isHumanLab(world)) return;
  delete world.centuryHumpback;
  for (const id of ['commons', 'resource_field', 'workshop', 'quiet_space', 'outskirts']) {
    const place = world.places[id];
    if (place) place.name = place.name.replaceAll('Айнкрада', 'Основания');
  }
  if (world.settlements.settlement_ainkrad) world.settlements.settlement_ainkrad.name = 'Основание';
  if (world.places.ocean_ainkrad) world.places.ocean_ainkrad.name = 'Великое море';
  // Ordinary populations use existing physical habitats; no map coordinates are changed.
  const add = (species: WildlifePopulation['species'], habitatId: string, count: number, carryingCapacity: number, threat: number) => {
    const id = `wildlife_foundation_${species}`;
    world.wildlife[id] = { id, species, habitatId, count, carryingCapacity, reproductionRate: 0.12,
      alertness: 0.18, threat, isMonster: false, lastChangedAt: world.now };
  };
  const meadow = ['resource_field', 'outskirts'].map(id => world.places[id])
    .find(place => place && place.surface === 'land' && ['plains', 'forest'].includes(place.biome));
  if (meadow) { add('rabbit', meadow.id, 6, 16, 0.04); add('bird', meadow.id, 8, 20, 0.02); }
  const sea = world.places.ocean_ainkrad;
  if (sea && sea.surface === 'water') add('fish', sea.id, 24, 60, 0.02);
}

/** Fail closed on a mismatched save rather than silently erasing another world's inhabitants. */
export function assertHumanLab(world: Readonly<WorldState>): void {
  if (!isHumanLab(world)) throw new Error('Это сохранение не принадлежит Искорке. Исходный мир не изменён.');
  if (world.centuryHumpback !== undefined) throw new Error('Iskorka cannot contain a century monster scheduler.');
  if (Object.values(world.agents).some(agent => (agent.race ?? 'human') !== 'human')) throw new Error('Iskorka only supports human residents.');
  if (Object.values(world.wildlife).some(pop => pop.isMonster)) throw new Error('Iskorka cannot contain monsters.');
  if (world.places.elf_library_v20) throw new Error('Iskorka cannot contain a nonhuman library.');
  const economy = world.v19?.adventureEconomy;
  if (economy && (Object.keys(economy.dungeonsById).length || Object.keys(economy.artifactsById).length)) {
    throw new Error('Iskorka cannot contain dungeon loot or dungeon generators.');
  }
}
