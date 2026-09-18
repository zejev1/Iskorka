import { describe, expect, it } from 'vitest';
import { shouldPaintAtlasAreaOverlay } from '../src/presentation/WorldAtlasOverlayPolicy';

describe('atlas natural-surface ownership', () => {
  it('leaves legacy water overlays available without continuous terrain', () => {
    expect(shouldPaintAtlasAreaOverlay('water', false)).toBe(true);
  });

  it('prevents water polygons from repainting continuous terrain at any zoom', () => {
    expect(shouldPaintAtlasAreaOverlay('water', true)).toBe(false);
    expect(shouldPaintAtlasAreaOverlay('forest', true)).toBe(false);
    expect(shouldPaintAtlasAreaOverlay('settlement', true)).toBe(true);
    expect(shouldPaintAtlasAreaOverlay('resource_field', true)).toBe(true);
  });
});

