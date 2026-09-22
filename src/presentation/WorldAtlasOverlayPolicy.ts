const TERRAIN_OWNED_AREA_KINDS = new Set([
  'water',
  'forest',
  'mountains',
  'swamp',
  'meadow',
]);

/**
 * Continuous terrain is the single source of truth for natural surfaces.
 * Legacy/survey polygons may remain in saves for knowledge and boundaries,
 * but must never repaint the rendered terrain at particular zoom levels.
 *
 * Keeping this policy pure makes the zoom regression independently testable
 * without touching geography, simulation state or the terrain generator.
 */
export function shouldPaintAtlasAreaOverlay(
  kind: string,
  hasContinuousTerrain: boolean,
  areaId?: string,
): boolean {
  // The Foundation lake is a physical world feature created after the donor
  // terrain seed is bound.  Its canonical waterPolygon therefore has to be
  // painted even when continuous terrain is present; otherwise the simulation
  // contains a lake while the player only sees its point marker.
  if (kind === 'water' && areaId === 'foundation_lake:water') return true;
  return !hasContinuousTerrain || !TERRAIN_OWNED_AREA_KINDS.has(kind);
}
