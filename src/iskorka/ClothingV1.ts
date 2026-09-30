import type { AgentState, WorldState } from '../world/types';

/** One worn garment, one spare and one unfinished piece. No garment history. */
export interface GarmentV1 {
  material: 'plant_fibre';
  makerId: string;
  madeWorldMinute: number;
  wornSinceWorldMinute?: number;
}
export interface ClothingStateV1 {
  version: 1;
  fibre: number;
  workMinutes: number;
  worn?: GarmentV1;
  spare?: GarmentV1;
  madeCount: number;
}
export const CLOTHING_FIBRE_COST_V1 = 4;
export const CLOTHING_WORK_MINUTES_V1 = 180;
const YEAR = 525600;
const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

export function garmentConditionV1(garment: Readonly<GarmentV1> | undefined, minute: number): number {
  if (!garment) return 0;
  return garment.wornSinceWorldMinute === undefined ? 1 :
    clamp01(1 - Math.max(0, minute - garment.wornSinceWorldMinute) / (3 * YEAR));
}
export function clothingProtectionV1(agent: Readonly<AgentState>, minute: number): number {
  return garmentConditionV1(agent.clothingV1?.worn, minute) * 0.48;
}
export function ensureClothingV1(agent: AgentState): ClothingStateV1 {
  return agent.clothingV1 ??= { version: 1, fibre: 0, workMinutes: 0, madeCount: 0 };
}
export function isFibreSourceV1(world: Readonly<WorldState>, placeId: string): boolean {
  const place = world.places[placeId];
  return Boolean(place && place.surface !== 'water' &&
    (place.kind === 'meadow' || place.kind === 'resource_field'));
}
export function gatherClothingFibreV1(world: WorldState, agent: AgentState): number {
  if (!agent.life.alive || agent.life.ageYears < 13 || agent.movement ||
      !isFibreSourceV1(world, agent.locationId)) return 0;
  const land = world.v16?.settlementResourcesById[
    world.places[agent.locationId]?.settlementId ?? world.places[agent.homeId]?.settlementId ?? ''
  ];
  if (!land || land.renewableBase <= 0.02) return 0;
  const kit = ensureClothingV1(agent);
  const amount = Math.min(1 + agent.skills.gathering, 12 - kit.fibre,
    Math.max(0, land.renewableBase - 0.02) / 0.0001);
  if (!(amount > 0)) return 0;
  kit.fibre += amount;
  land.renewableBase -= amount * 0.0001;
  agent.skills.gathering = clamp01(agent.skills.gathering + 0.001);
  return amount;
}
/** Primitive fibre preparation/weaving is physical practice, not gifted skill. */
export function makeClothingV1(world: WorldState, agent: AgentState, minutes = 60): boolean {
  if (!agent.life.alive || agent.life.ageYears < 15 || agent.movement ||
      world.places[agent.locationId]?.kind !== 'workshop' ||
      !Number.isFinite(minutes) || minutes <= 0) return false;
  const kit = ensureClothingV1(agent);
  if (kit.spare) return false;
  if (kit.workMinutes === 0) {
    if (kit.fibre < CLOTHING_FIBRE_COST_V1) return false;
    kit.fibre -= CLOTHING_FIBRE_COST_V1;
  }
  kit.workMinutes += Math.min(60, minutes) * (0.5 + agent.skills.craft * 0.5);
  agent.skills.craft = clamp01(agent.skills.craft + 0.002);
  if (kit.workMinutes >= CLOTHING_WORK_MINUTES_V1) {
    kit.spare = { material: 'plant_fibre', makerId: agent.id,
      madeWorldMinute: world.calendar.elapsedWorldMinutes };
    kit.workMinutes = 0;
    kit.madeCount += 1;
  }
  return true;
}
export function wearClothingV1(world: Readonly<WorldState>, agent: AgentState): boolean {
  const kit = agent.clothingV1;
  if (!agent.life.alive || agent.life.ageYears < 3 || !kit?.spare ||
      garmentConditionV1(kit.worn, world.calendar.elapsedWorldMinutes) >= 0.98) return false;
  kit.worn = { ...kit.spare, wornSinceWorldMinute: world.calendar.elapsedWorldMinutes };
  delete kit.spare;
  return true;
}
export function assertClothingV1(kit: Readonly<ClothingStateV1> | undefined): void {
  if (!kit) return;
  if (kit.version !== 1 || !Number.isFinite(kit.fibre) || kit.fibre < 0 || kit.fibre > 12 ||
      !Number.isFinite(kit.workMinutes) || kit.workMinutes < 0 || kit.workMinutes >= CLOTHING_WORK_MINUTES_V1 ||
      !Number.isSafeInteger(kit.madeCount) || kit.madeCount < 0)
    throw new Error('Invalid clothing state.');
  for (const garment of [kit.worn, kit.spare]) {
    if (!garment) continue;
    if (garment.material !== 'plant_fibre' || !garment.makerId ||
        !Number.isFinite(garment.madeWorldMinute) || garment.madeWorldMinute < 0 ||
        (garment.wornSinceWorldMinute !== undefined &&
          (!Number.isFinite(garment.wornSinceWorldMinute) ||
            garment.wornSinceWorldMinute < garment.madeWorldMinute)))
      throw new Error('Invalid physical garment.');
  }
}
