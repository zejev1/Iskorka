export const ISKORKA_CANONICAL_PRODUCTION_HOST =
  'iskorka-sao-a8bd.vercel.app';

/**
 * Vercel deployment URLs change on every build and IndexedDB is isolated by
 * origin. Redirect those transient Iskorka hosts to one stable production
 * origin before opening the world database.
 *
 * Add ?preview=1 only when intentionally inspecting an isolated preview.
 */
export function canonicalIskorkaProductionUrl(
  href: string,
): string | undefined {
  const url = new URL(href);
  const host = url.hostname.toLowerCase();
  if (url.searchParams.get('preview') === '1') return undefined;
  if (host === ISKORKA_CANONICAL_PRODUCTION_HOST) return undefined;
  if (!host.startsWith('iskorka') || !host.endsWith('.vercel.app')) {
    return undefined;
  }
  url.protocol = 'https:';
  url.hostname = ISKORKA_CANONICAL_PRODUCTION_HOST;
  url.port = '';
  url.searchParams.delete('_vercel_share');
  return url.toString();
}

export async function requestDurableBrowserStorage(
  storage: StorageManager | undefined,
): Promise<boolean | undefined> {
  if (!storage?.persisted || !storage?.persist) return undefined;
  try {
    if (await storage.persisted()) return true;
    return await storage.persist();
  } catch {
    return undefined;
  }
}
