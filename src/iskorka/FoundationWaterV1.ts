import type { WorldPlace, WorldState } from '../world/types';
import { placeSupportsCapabilityV1 } from './MedievalPlaceInfrastructureV1';

export const FOUNDATION_WATER_VERSION_V1 =
  'iskorka-foundation-water-v1' as const;

export interface FoundationWellWaterV1 {
  version: typeof FOUNDATION_WATER_VERSION_V1;
  potable: true;
  depthMetres: number;
  capacityLitres: number;
  waterLitres: number;
  rechargeLitresPerDay: number;
  lastAdvancedWorldMinute: number;
}

const DAY = 24 * 60;
const WELL_IDS = ['foundation_well_west', 'foundation_well_east'] as const;
export const FOUNDATION_WELL_IDS_V1: readonly string[] = WELL_IDS;

function connect(a: WorldPlace, b: WorldPlace): void {
  if (!a.connectedPlaceIds.includes(b.id)) a.connectedPlaceIds.push(b.id);
  if (!b.connectedPlaceIds.includes(a.id)) b.connectedPlaceIds.push(a.id);
}

function stableWellPoint(
  world: Readonly<WorldState>,
  side: -1 | 1,
): { x: number; y: number } {
  const commons = world.places.commons;
  const homes = Object.values(world.places)
    .filter(
      (place) =>
        place.kind === 'home' &&
        place.settlementId === 'settlement_ainkrad',
    )
    .sort(
      (a, b) =>
        (a.urbanLot ?? Number.MAX_SAFE_INTEGER) -
          (b.urbanLot ?? Number.MAX_SAFE_INTEGER) ||
        a.id.localeCompare(b.id),
    );
  if (!commons || homes.length === 0) {
    return { x: side * 0.28, y: side * -0.18 };
  }

  const half = side < 0
    ? homes.slice(0, Math.max(1, Math.ceil(homes.length / 2)))
    : homes.slice(Math.floor(homes.length / 2));
  const centroid = {
    x: half.reduce((sum, home) => sum + home.mapX, 0) / half.length,
    y: half.reduce((sum, home) => sum + home.mapY, 0) / half.length,
  };
  // Pull each well toward the commons so it sits between houses rather than
  // beyond the settlement edge. The tiny perpendicular split keeps two wells
  // from landing on the same street line.
  const vx = centroid.x - commons.mapX;
  const vy = centroid.y - commons.mapY;
  const length = Math.max(0.001, Math.hypot(vx, vy));
  const px = -vy / length;
  const py = vx / length;
  return {
    x: commons.mapX + vx * 0.58 + px * side * 0.10,
    y: commons.mapY + vy * 0.58 + py * side * 0.10,
  };
}

function createWell(
  world: Readonly<WorldState>,
  id: string,
  name: string,
  point: { x: number; y: number },
): WorldPlace {
  return {
    id,
    name,
    kind: 'well',
    capacity: 5,
    biome: 'settlement',
    mapX: point.x,
    mapY: point.y,
    connectedPlaceIds: [],
    fertility: 0.35,
    danger: 0.01,
    surface: 'land',
    settlementId: 'settlement_ainkrad',
    discoveredAt: world.now,
    wellWaterV1: {
      version: FOUNDATION_WATER_VERSION_V1,
      potable: true,
      depthMetres: 9.5,
      capacityLitres: 900,
      waterLitres: 760,
      rechargeLitresPerDay: 420,
      lastAdvancedWorldMinute: world.calendar.elapsedWorldMinutes,
    },
  };
}

function nearestHomes(
  world: Readonly<WorldState>,
  well: Readonly<WorldPlace>,
  count = 3,
): WorldPlace[] {
  return Object.values(world.places)
    .filter(
      (place) =>
        place.kind === 'home' &&
        place.settlementId === 'settlement_ainkrad',
    )
    .sort(
      (a, b) =>
        Math.hypot(a.mapX - well.mapX, a.mapY - well.mapY) -
          Math.hypot(b.mapX - well.mapX, b.mapY - well.mapY) ||
        a.id.localeCompare(b.id),
    )
    .slice(0, count);
}

export function ensureFoundationWellsV1(world: WorldState): boolean {
  const commons = world.places.commons;
  if (!commons) return false;
  let changed = false;
  const specs = [
    {
      id: WELL_IDS[0],
      name: 'Западный колодец Основания',
      point: stableWellPoint(world, -1),
    },
    {
      id: WELL_IDS[1],
      name: 'Восточный колодец Основания',
      point: stableWellPoint(world, 1),
    },
  ] as const;

  for (const spec of specs) {
    let well = world.places[spec.id];
    if (!well) {
      well = createWell(world, spec.id, spec.name, spec.point);
      world.places[spec.id] = well;
      changed = true;
    } else {
      const prior = JSON.stringify({
        kind: well.kind,
        x: well.mapX,
        y: well.mapY,
        settlementId: well.settlementId,
        water: well.wellWaterV1,
      });
      well.name = spec.name;
      well.kind = 'well';
      well.biome = 'settlement';
      well.surface = 'land';
      well.settlementId = 'settlement_ainkrad';
      well.mapX = spec.point.x;
      well.mapY = spec.point.y;
      well.capacity = Math.max(3, well.capacity);
      well.danger = Math.min(0.04, well.danger);
      well.wellWaterV1 ??= {
        version: FOUNDATION_WATER_VERSION_V1,
        potable: true,
        depthMetres: 9.5,
        capacityLitres: 900,
        waterLitres: 760,
        rechargeLitresPerDay: 420,
        lastAdvancedWorldMinute: world.calendar.elapsedWorldMinutes,
      };
      if (
        prior !==
        JSON.stringify({
          kind: well.kind,
          x: well.mapX,
          y: well.mapY,
          settlementId: well.settlementId,
          water: well.wellWaterV1,
        })
      ) changed = true;
    }

    // A village well belongs to the residential street network, not to
    // a magical direct edge across the whole square. Connect through the
    // nearest houses; their ordinary streets lead onward to the commons.
    const nearbyHomes = nearestHomes(world, well);
    const desired = new Set(nearbyHomes.map((home) => home.id));
    for (const connectedId of [...well.connectedPlaceIds]) {
      if (desired.has(connectedId)) continue;
      const other = world.places[connectedId];
      if (other) {
        other.connectedPlaceIds = other.connectedPlaceIds.filter(
          (id) => id !== well.id,
        );
      }
      well.connectedPlaceIds = well.connectedPlaceIds.filter(
        (id) => id !== connectedId,
      );
      changed = true;
    }
    for (const home of nearbyHomes) {
      const beforeA = well.connectedPlaceIds.length;
      const beforeB = home.connectedPlaceIds.length;
      connect(well, home);
      if (
        well.connectedPlaceIds.length !== beforeA ||
        home.connectedPlaceIds.length !== beforeB
      ) changed = true;
    }
  }

  const settlement = world.settlements.settlement_ainkrad;
  if (settlement) {
    for (const id of WELL_IDS) {
      if (!settlement.memberPlaceIds.includes(id)) {
        settlement.memberPlaceIds.push(id);
        changed = true;
      }
    }
  }
  return changed;
}

function advanceWellV1(
  world: Readonly<WorldState>,
  well: WorldPlace,
): FoundationWellWaterV1 | undefined {
  const water = well.wellWaterV1;
  if (!water?.potable) return undefined;
  const now = world.calendar.elapsedWorldMinutes;
  const elapsed = Math.max(0, now - water.lastAdvancedWorldMinute);
  if (elapsed > 0) {
    water.waterLitres = Math.min(
      water.capacityLitres,
      water.waterLitres + (elapsed / DAY) * water.rechargeLitresPerDay,
    );
    water.lastAdvancedWorldMinute = now;
  }
  return water;
}

export function drawWellWaterLitresV1(
  world: WorldState,
  wellId: string,
  requestedLitres: number,
): number {
  const well = world.places[wellId];
  if (!well || well.kind !== 'well' || !(requestedLitres > 0)) return 0;
  const water = advanceWellV1(world, well);
  if (!water) return 0;
  const drawn = Math.min(requestedLitres, water.waterLitres);
  water.waterLitres -= drawn;
  return drawn;
}

export function homeWaterReserveFractionV1(
  world: Readonly<WorldState>,
  homeId: string | undefined,
): number {
  const home = homeId ? world.places[homeId] : undefined;
  const infrastructure = home?.medievalInfrastructureV1;
  if (!home || home.kind !== 'home' || !infrastructure) return 0;
  const capacity = Math.max(0, infrastructure.waterCapacityLitres ?? 0);
  if (!(capacity > 0)) return 0;
  return Math.max(
    0,
    Math.min(1, (infrastructure.waterReserveLitres ?? 0) / capacity),
  );
}

export function nearestFoundationWellIdV1(
  world: Readonly<WorldState>,
  fromPlaceId: string,
): string | undefined {
  const from = world.places[fromPlaceId];
  if (!from) return undefined;
  return WELL_IDS
    .map((id) => world.places[id])
    .filter((well): well is WorldPlace => Boolean(well?.wellWaterV1?.potable))
    .sort(
      (a, b) =>
        Math.hypot(a.mapX - from.mapX, a.mapY - from.mapY) -
          Math.hypot(b.mapX - from.mapX, b.mapY - from.mapY) ||
        a.id.localeCompare(b.id),
    )[0]?.id;
}

export function refillHomeWaterFromWellV1(
  world: WorldState,
  homeId: string,
  wellId: string,
  maximumCarryLitres = 18,
): number {
  const home = world.places[homeId];
  const well = world.places[wellId];
  const infrastructure = home?.medievalInfrastructureV1;
  if (
    !home ||
    home.kind !== 'home' ||
    !well ||
    well.kind !== 'well' ||
    !infrastructure ||
    !placeSupportsCapabilityV1(home, 'water_storage')
  ) return 0;

  const capacity = Math.max(0, infrastructure.waterCapacityLitres ?? 0);
  const reserve = Math.max(0, infrastructure.waterReserveLitres ?? 0);
  const room = Math.max(0, capacity - reserve);
  const requested = Math.min(room, Math.max(0, maximumCarryLitres));
  if (!(requested > 0)) return 0;
  const drawn = drawWellWaterLitresV1(world, wellId, requested);
  if (!(drawn > 0)) return 0;
  infrastructure.waterReserveLitres = reserve + drawn;
  infrastructure.lastWaterFetchWorldMinute = world.calendar.elapsedWorldMinutes;
  return drawn;
}

export function consumeHomeWaterLitresV1(
  world: WorldState,
  homeId: string,
  requestedLitres: number,
): number {
  const home = world.places[homeId];
  const infrastructure = home?.medievalInfrastructureV1;
  if (
    !home ||
    home.kind !== 'home' ||
    !infrastructure ||
    !placeSupportsCapabilityV1(home, 'water_storage') ||
    !(requestedLitres > 0)
  ) return 0;
  const reserve = Math.max(0, infrastructure.waterReserveLitres ?? 0);
  const consumed = Math.min(reserve, requestedLitres);
  infrastructure.waterReserveLitres = reserve - consumed;
  return consumed;
}

export function assertFoundationWellsV1(world: Readonly<WorldState>): void {
  for (const id of WELL_IDS) {
    const well = world.places[id];
    if (!well || well.kind !== 'well' || well.surface !== 'land') {
      throw new Error(`Foundation well ${id} is missing or not walkable.`);
    }
    const water = well.wellWaterV1;
    if (
      !water ||
      water.version !== FOUNDATION_WATER_VERSION_V1 ||
      !water.potable ||
      !(water.capacityLitres > 0) ||
      water.waterLitres < 0 ||
      water.waterLitres > water.capacityLitres ||
      !(water.rechargeLitresPerDay > 0)
    ) {
      throw new Error(`Foundation well ${id} has invalid potable water state.`);
    }
  }
}
