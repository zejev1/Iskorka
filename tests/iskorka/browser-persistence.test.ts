import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ISKORKA_CANONICAL_PRODUCTION_HOST,
  canonicalIskorkaProductionUrl,
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
