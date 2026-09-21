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


export interface BrowserStorageStatusV1 {
  durability: 'durable' | 'best_effort' | 'unknown';
  usageBytes?: number;
  quotaBytes?: number;
}

export async function browserStorageStatusV1(
  storage: StorageManager | undefined,
): Promise<BrowserStorageStatusV1> {
  if (!storage) return { durability: 'unknown' };
  let durability: BrowserStorageStatusV1['durability'] = 'unknown';
  try {
    if (storage.persisted) {
      durability = (await storage.persisted()) ? 'durable' : 'best_effort';
    }
  } catch {
    durability = 'unknown';
  }

  let usageBytes: number | undefined;
  let quotaBytes: number | undefined;
  try {
    const estimate = await storage.estimate?.();
    if (typeof estimate?.usage === 'number' && Number.isFinite(estimate.usage)) {
      usageBytes = estimate.usage;
    }
    if (typeof estimate?.quota === 'number' && Number.isFinite(estimate.quota)) {
      quotaBytes = estimate.quota;
    }
  } catch {
    // Best-effort telemetry only. IndexedDB durability does not depend on it.
  }
  return {
    durability,
    ...(usageBytes === undefined ? {} : { usageBytes }),
    ...(quotaBytes === undefined ? {} : { quotaBytes }),
  };
}
