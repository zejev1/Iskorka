import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ISKORKA_CANONICAL_PRODUCTION_HOST,
  browserStorageStatusV1,
  canonicalIskorkaProductionUrl,
  requestDurableBrowserStorage,
} from '../../src/iskorka/BrowserPersistence';
import { MINUTES_PER_SECOND } from '../../src/iskorka/protocol';

test('temporary Vercel deployment URLs redirect to one persistent Iskorka origin', () => {
  assert.equal(
    canonicalIskorkaProductionUrl(
      'https://iskorka-abc123-sao-a8bd.vercel.app/?x=1&_vercel_share=secret',
    ),
    `https://${ISKORKA_CANONICAL_PRODUCTION_HOST}/?x=1`,
  );
  assert.equal(
    canonicalIskorkaProductionUrl(
      `https://${ISKORKA_CANONICAL_PRODUCTION_HOST}/`,
    ),
    undefined,
  );
});

test('preview escape hatch keeps an intentionally isolated deployment origin', () => {
  assert.equal(
    canonicalIskorkaProductionUrl(
      'https://iskorka-abc123-sao-a8bd.vercel.app/?preview=1',
    ),
    undefined,
  );
});

test('non-Vercel and unrelated hosts are never redirected', () => {
  assert.equal(canonicalIskorkaProductionUrl('http://localhost:5173/'), undefined);
  assert.equal(canonicalIskorkaProductionUrl('https://example.com/'), undefined);
});

test('realtime speed is exactly one world minute per real minute', () => {
  assert.equal(MINUTES_PER_SECOND.realtime * 60, 1);
});


test('browser storage status distinguishes durable from best-effort without treating IndexedDB as failed', async () => {
  const bestEffort = {
    persisted: async () => false,
    persist: async () => false,
    estimate: async () => ({ usage: 12_345, quota: 9_876_543 }),
  } as unknown as StorageManager;
  assert.deepEqual(await browserStorageStatusV1(bestEffort), {
    durability: 'best_effort',
    usageBytes: 12_345,
    quotaBytes: 9_876_543,
  });
  assert.equal(await requestDurableBrowserStorage(bestEffort), false);

  const durable = {
    persisted: async () => true,
    persist: async () => { throw new Error('must not be called'); },
    estimate: async () => ({ usage: 5, quota: 50 }),
  } as unknown as StorageManager;
  assert.equal((await browserStorageStatusV1(durable)).durability, 'durable');
  assert.equal(await requestDurableBrowserStorage(durable), true);
});

test('missing or restricted StorageManager degrades to unknown instead of blocking launch', async () => {
  assert.deepEqual(await browserStorageStatusV1(undefined), {
    durability: 'unknown',
  });

  const restricted = {
    persisted: async () => { throw new Error('blocked'); },
    persist: async () => { throw new Error('blocked'); },
    estimate: async () => { throw new Error('blocked'); },
  } as unknown as StorageManager;
  assert.deepEqual(await browserStorageStatusV1(restricted), {
    durability: 'unknown',
  });
  assert.equal(await requestDurableBrowserStorage(restricted), undefined);
});
