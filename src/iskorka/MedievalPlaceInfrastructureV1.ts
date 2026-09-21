import type { WorldPlace, WorldState } from '../world/types';

export const MEDIEVAL_INFRASTRUCTURE_VERSION_V1 =
  'iskorka-medieval-infrastructure-v1' as const;

export type MedievalCapabilityV1 =
  | 'sleep'
  | 'cook'
  | 'dine'
  | 'sanitation'
  | 'wash'
  | 'water_storage'
  | 'household_storage'
  | 'heating'
  | 'general_craft'
  | 'woodworking'
  | 'smithing'
  | 'tool_repair'
  | 'stoneworking'
  | 'leatherwork';

export interface MedievalFixtureV1 {
  id: string;
  kind: string;
  name: string;
  quantity: number;
  condition: number;
  installed: boolean;
  roomId: string;
  powerSource: 'none' | 'human' | 'fire' | 'gravity';
}

export interface MedievalRoomV1 {
  id: string;
  kind:
    | 'bedroom'
    | 'kitchen'
    | 'dining'
    | 'sanitation'
    | 'storage'
    | 'nursery'
    | 'main_workroom'
    | 'carpentry_bay'
    | 'smithy'
    | 'stone_bay'
    | 'leather_bay';
  name: string;
}

export interface MedievalPlaceInfrastructureV1 {
  version: typeof MEDIEVAL_INFRASTRUCTURE_VERSION_V1;
  era: 'pre_electric_medieval';
  target: 'home' | 'workshop' | 'community_nursery';
  rooms: MedievalRoomV1[];
  fixtures: Record<string, MedievalFixtureV1>;
  /** Stored drinking/washing water physically held in household containers. */
  waterCapacityLitres?: number;
  waterReserveLitres?: number;
}

const REQUIREMENTS: Readonly<Record<MedievalCapabilityV1, readonly string[]>> = {
  sleep: ['bed_frame', 'mattress', 'bedding'],
  cook: ['hearth', 'cookpot', 'prep_table', 'kitchen_knife'],
  dine: ['dining_table', 'seating'],
  sanitation: ['privy', 'washbasin', 'water_container'],
  wash: ['washbasin', 'water_container', 'bucket'],
  water_storage: ['water_container', 'bucket'],
  household_storage: ['pantry', 'storage_chest'],
  heating: ['hearth', 'firewood_rack'],
  general_craft: ['workbench', 'bench_vise', 'hammer_set', 'chisel_set', 'hand_saw', 'measuring_tools'],
  woodworking: ['workbench', 'hand_saw', 'adze', 'auger', 'chisel_set', 'mallet'],
  smithing: ['charcoal_forge', 'bellows', 'anvil', 'smithing_hammer', 'tongs', 'quench_trough', 'grindstone'],
  tool_repair: ['workbench', 'file_set', 'grindstone', 'hammer_set'],
  stoneworking: ['stone_bench', 'stone_chisel_set', 'masonry_hammer', 'mallet'],
  leatherwork: ['leather_bench', 'awl', 'leather_knife', 'needles', 'stitching_clamp'],
};

function fixture(
  placeId: string,
  roomId: string,
  kind: string,
  name: string,
  quantity = 1,
  powerSource: MedievalFixtureV1['powerSource'] = 'none',
): MedievalFixtureV1 {
  return {
    id: `${placeId}:fixture:${kind}`,
    kind,
    name,
    quantity,
    condition: 1,
    installed: true,
    roomId,
    powerSource,
  };
}

function fixtureMap(items: MedievalFixtureV1[]): Record<string, MedievalFixtureV1> {
  return Object.fromEntries(items.map((item) => [item.id, item]));
}

function homeInfrastructure(place: Readonly<WorldPlace>): MedievalPlaceInfrastructureV1 {
  const beds = Math.max(1, place.capacity);
  const seats = Math.max(3, place.capacity);
  const rooms: MedievalRoomV1[] = [
    { id: `${place.id}:room:bedroom`, kind: 'bedroom', name: 'Спальная комната' },
    { id: `${place.id}:room:kitchen`, kind: 'kitchen', name: 'Кухня с очагом' },
    { id: `${place.id}:room:dining`, kind: 'dining', name: 'Столовая' },
    { id: `${place.id}:room:sanitation`, kind: 'sanitation', name: 'Нужник и умывание' },
    { id: `${place.id}:room:storage`, kind: 'storage', name: 'Кладовая' },
  ];
  const byKind = Object.fromEntries(rooms.map((room) => [room.kind, room.id])) as Record<string,string>;
  return {
    version: MEDIEVAL_INFRASTRUCTURE_VERSION_V1,
    era: 'pre_electric_medieval',
    target: 'home',
    rooms,
    waterCapacityLitres: Math.max(24, place.capacity * 10),
    waterReserveLitres: Math.max(16, place.capacity * 6),
    fixtures: fixtureMap([
      fixture(place.id, byKind.bedroom, 'bed_frame', 'Деревянная кровать', beds),
      fixture(place.id, byKind.bedroom, 'mattress', 'Соломенный или шерстяной тюфяк', beds),
      fixture(place.id, byKind.bedroom, 'bedding', 'Постель и тёплое одеяло', beds),
      fixture(place.id, byKind.bedroom, 'storage_chest', 'Сундук для вещей', Math.max(1, Math.ceil(beds / 2))),
      fixture(place.id, byKind.kitchen, 'hearth', 'Каменный очаг с дымоотводом', 1, 'fire'),
      fixture(place.id, byKind.kitchen, 'cookpot', 'Железный котёл'),
      fixture(place.id, byKind.kitchen, 'prep_table', 'Стол для подготовки пищи'),
      fixture(place.id, byKind.kitchen, 'kitchen_knife', 'Кухонный нож', 2, 'human'),
      fixture(place.id, byKind.kitchen, 'clay_cookware', 'Глиняная посуда', 6),
      fixture(place.id, byKind.kitchen, 'water_container', 'Бочка с питьевой водой'),
      fixture(place.id, byKind.kitchen, 'bucket', 'Деревянное ведро', 2, 'human'),
      fixture(place.id, byKind.kitchen, 'firewood_rack', 'Полка и запас дров'),
      fixture(place.id, byKind.dining, 'dining_table', 'Обеденный стол'),
      fixture(place.id, byKind.dining, 'seating', 'Лавки и табуреты', seats),
      fixture(place.id, byKind.sanitation, 'privy', 'Средневековый нужник без водопровода'),
      fixture(place.id, byKind.sanitation, 'washbasin', 'Таз для умывания'),
      fixture(place.id, byKind.storage, 'pantry', 'Кладовая для продуктов и утвари'),
    ]),
  };
}

function workshopInfrastructure(place: Readonly<WorldPlace>): MedievalPlaceInfrastructureV1 {
  const rooms: MedievalRoomV1[] = [
    { id: `${place.id}:room:main`, kind: 'main_workroom', name: 'Основная рабочая зона' },
    { id: `${place.id}:room:wood`, kind: 'carpentry_bay', name: 'Столярная зона' },
    { id: `${place.id}:room:smithy`, kind: 'smithy', name: 'Кузнечная зона' },
    { id: `${place.id}:room:stone`, kind: 'stone_bay', name: 'Камнерезная зона' },
    { id: `${place.id}:room:leather`, kind: 'leather_bay', name: 'Кожевенная зона' },
    { id: `${place.id}:room:storage`, kind: 'storage', name: 'Инструментальная кладовая' },
  ];
  const byKind = Object.fromEntries(rooms.map((room) => [room.kind, room.id])) as Record<string,string>;
  return {
    version: MEDIEVAL_INFRASTRUCTURE_VERSION_V1,
    era: 'pre_electric_medieval',
    target: 'workshop',
    rooms,
    fixtures: fixtureMap([
      fixture(place.id, byKind.main_workroom, 'workbench', 'Тяжёлый верстак', 2),
      fixture(place.id, byKind.main_workroom, 'bench_vise', 'Ручные тиски и зажимы', 1, 'human'),
      fixture(place.id, byKind.main_workroom, 'hammer_set', 'Набор молотков', 2, 'human'),
      fixture(place.id, byKind.main_workroom, 'chisel_set', 'Набор долот и стамесок', 2, 'human'),
      fixture(place.id, byKind.main_workroom, 'measuring_tools', 'Угольник, линейка, отвес и разметка'),
      fixture(place.id, byKind.main_workroom, 'file_set', 'Набор напильников', 1, 'human'),
      fixture(place.id, byKind.storage, 'tool_rack', 'Стойка для ручного инструмента', 2),
      fixture(place.id, byKind.carpentry_bay, 'hand_saw', 'Ручная пила', 2, 'human'),
      fixture(place.id, byKind.carpentry_bay, 'adze', 'Тесло', 1, 'human'),
      fixture(place.id, byKind.carpentry_bay, 'auger', 'Ручной бурав', 1, 'human'),
      fixture(place.id, byKind.carpentry_bay, 'mallet', 'Деревянная киянка', 2, 'human'),
      fixture(place.id, byKind.smithy, 'charcoal_forge', 'Угольный кузнечный горн', 1, 'fire'),
      fixture(place.id, byKind.smithy, 'bellows', 'Кузнечные меха', 1, 'human'),
      fixture(place.id, byKind.smithy, 'anvil', 'Кузнечная наковальня'),
      fixture(place.id, byKind.smithy, 'smithing_hammer', 'Кузнечный молот', 2, 'human'),
      fixture(place.id, byKind.smithy, 'tongs', 'Кузнечные клещи', 2, 'human'),
      fixture(place.id, byKind.smithy, 'quench_trough', 'Закалочная колода с водой'),
      fixture(place.id, byKind.smithy, 'grindstone', 'Ручной точильный камень', 1, 'human'),
      fixture(place.id, byKind.smithy, 'charcoal_bin', 'Запас древесного угля'),
      fixture(place.id, byKind.stone_bay, 'stone_bench', 'Камнерезный стол'),
      fixture(place.id, byKind.stone_bay, 'stone_chisel_set', 'Камнерезные зубила', 1, 'human'),
      fixture(place.id, byKind.stone_bay, 'masonry_hammer', 'Каменщицкий молоток', 1, 'human'),
      fixture(place.id, byKind.leather_bay, 'leather_bench', 'Стол для кожи'),
      fixture(place.id, byKind.leather_bay, 'awl', 'Шило', 2, 'human'),
      fixture(place.id, byKind.leather_bay, 'leather_knife', 'Нож для кожи', 1, 'human'),
      fixture(place.id, byKind.leather_bay, 'needles', 'Прочные иглы для кожи', 4, 'human'),
      fixture(place.id, byKind.leather_bay, 'stitching_clamp', 'Зажим для шитья кожи', 1, 'human'),
    ]),
  };
}

function nurseryInfrastructure(place: Readonly<WorldPlace>): MedievalPlaceInfrastructureV1 {
  const beds = 10;
  const rooms: MedievalRoomV1[] = [
    { id: `${place.id}:room:nursery`, kind: 'nursery', name: 'Общая детская' },
    { id: `${place.id}:room:kitchen`, kind: 'kitchen', name: 'Общая кухня с очагом' },
    { id: `${place.id}:room:dining`, kind: 'dining', name: 'Общий стол' },
    { id: `${place.id}:room:sanitation`, kind: 'sanitation', name: 'Нужники и умывание' },
    { id: `${place.id}:room:storage`, kind: 'storage', name: 'Кладовая' },
  ];
  const byKind = Object.fromEntries(rooms.map((room) => [room.kind, room.id])) as Record<string,string>;
  return {
    version: MEDIEVAL_INFRASTRUCTURE_VERSION_V1,
    era: 'pre_electric_medieval',
    target: 'community_nursery',
    rooms,
    waterCapacityLitres: 90,
    waterReserveLitres: 54,
    fixtures: fixtureMap([
      fixture(place.id, byKind.nursery, 'bed_frame', 'Детская койка', beds),
      fixture(place.id, byKind.nursery, 'mattress', 'Соломенный тюфяк', beds),
      fixture(place.id, byKind.nursery, 'bedding', 'Тёплая постель', beds),
      fixture(place.id, byKind.nursery, 'storage_chest', 'Сундуки для детских вещей', 4),
      fixture(place.id, byKind.kitchen, 'hearth', 'Каменный общий очаг', 1, 'fire'),
      fixture(place.id, byKind.kitchen, 'cookpot', 'Большой железный котёл', 2),
      fixture(place.id, byKind.kitchen, 'prep_table', 'Стол для приготовления пищи', 2),
      fixture(place.id, byKind.kitchen, 'kitchen_knife', 'Кухонный нож', 3, 'human'),
      fixture(place.id, byKind.kitchen, 'water_container', 'Бочки с питьевой водой', 2),
      fixture(place.id, byKind.kitchen, 'bucket', 'Вёдра', 4, 'human'),
      fixture(place.id, byKind.kitchen, 'firewood_rack', 'Запас дров'),
      fixture(place.id, byKind.dining, 'dining_table', 'Большие общие столы', 2),
      fixture(place.id, byKind.dining, 'seating', 'Лавки', 15),
      fixture(place.id, byKind.sanitation, 'privy', 'Нужники без водопровода', 2),
      fixture(place.id, byKind.sanitation, 'washbasin', 'Тазы для умывания', 3),
      fixture(place.id, byKind.storage, 'pantry', 'Общая кладовая'),
    ]),
  };
}

function activeKinds(place: Readonly<WorldPlace>): Set<string> {
  return new Set(
    Object.values(place.medievalInfrastructureV1?.fixtures ?? {})
      .filter((item) => item.installed && item.quantity > 0 && item.condition >= 0.25)
      .map((item) => item.kind),
  );
}

export function placeSupportsCapabilityV1(
  place: Readonly<WorldPlace> | undefined,
  capability: MedievalCapabilityV1,
): boolean {
  if (!place?.medievalInfrastructureV1) return false;
  const kinds = activeKinds(place);
  return REQUIREMENTS[capability].every((kind) => kinds.has(kind));
}

export function homeHasEssentialLifeSupportV1(
  place: Readonly<WorldPlace> | undefined,
): boolean {
  if (!place || place.kind !== 'home') return false;
  return ([
    'sleep','cook','dine','sanitation','wash','water_storage','household_storage','heating',
  ] as MedievalCapabilityV1[]).every((capability) =>
    placeSupportsCapabilityV1(place, capability),
  );
}

export function workshopHasCoreEquipmentV1(
  place: Readonly<WorldPlace> | undefined,
): boolean {
  if (!place || place.kind !== 'workshop') return false;
  return ([
    'general_craft','woodworking','smithing','tool_repair','stoneworking','leatherwork',
  ] as MedievalCapabilityV1[]).every((capability) =>
    placeSupportsCapabilityV1(place, capability),
  );
}

export function equipMedievalHomeV1(place: WorldPlace): void {
  place.medievalInfrastructureV1 = homeInfrastructure(place);
}

export function equipMedievalWorkshopV1(place: WorldPlace): void {
  place.medievalInfrastructureV1 = workshopInfrastructure(place);
}

export function equipFoundingNurseryV1(place: WorldPlace): void {
  place.medievalInfrastructureV1 = nurseryInfrastructure(place);
}

export function ensureMedievalPlaceInfrastructureV1(world: WorldState): boolean {
  let changed = false;
  for (const place of Object.values(world.places)) {
    if (!place.medievalInfrastructureV1) {
      if (place.kind === 'home') {
        equipMedievalHomeV1(place);
        changed = true;
      } else if (place.kind === 'workshop') {
        equipMedievalWorkshopV1(place);
        changed = true;
      } else if (place.id === 'commons') {
        equipFoundingNurseryV1(place);
        changed = true;
      }
      continue;
    }
    const infrastructure = place.medievalInfrastructureV1;
    if (place.kind === 'home') {
      if (!(infrastructure.waterCapacityLitres! > 0)) {
        infrastructure.waterCapacityLitres = Math.max(24, place.capacity * 10);
        changed = true;
      }
      if (infrastructure.waterReserveLitres === undefined) {
        infrastructure.waterReserveLitres = Math.min(
          infrastructure.waterCapacityLitres!,
          Math.max(16, place.capacity * 6),
        );
        changed = true;
      }
    } else if (place.id === 'commons' && infrastructure.target === 'community_nursery') {
      if (!(infrastructure.waterCapacityLitres! > 0)) {
        infrastructure.waterCapacityLitres = 90;
        changed = true;
      }
      if (infrastructure.waterReserveLitres === undefined) {
        infrastructure.waterReserveLitres = 54;
        changed = true;
      }
    }
  }
  return changed;
}

export function assertMedievalPlaceInfrastructureV1(world: Readonly<WorldState>): void {
  for (const place of Object.values(world.places)) {
    if (place.kind === 'home' && !homeHasEssentialLifeSupportV1(place)) {
      throw new Error(`Home ${place.id} is only a shell: essential medieval fixtures are missing.`);
    }
    if (place.kind === 'workshop' && !workshopHasCoreEquipmentV1(place)) {
      throw new Error(`Workshop ${place.id} is only a label: physical craft equipment is missing.`);
    }
    const infrastructure = place.medievalInfrastructureV1;
    if (!infrastructure) continue;
    if (infrastructure.era !== 'pre_electric_medieval') {
      throw new Error(`Place ${place.id} has invalid infrastructure era.`);
    }
    for (const item of Object.values(infrastructure.fixtures)) {
      if (!Number.isFinite(item.quantity) || item.quantity < 0 ||
          !Number.isFinite(item.condition) || item.condition < 0 || item.condition > 1) {
        throw new Error(`Fixture ${item.id} has invalid physical state.`);
      }
    }
    if (place.kind === 'home') {
      const capacity = infrastructure.waterCapacityLitres ?? 0;
      const reserve = infrastructure.waterReserveLitres ?? -1;
      if (!(capacity > 0) || reserve < 0 || reserve > capacity) {
        throw new Error(`Home ${place.id} has invalid physical water storage.`);
      }
    }
  }
}
