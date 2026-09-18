import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { validateProfile, validateConstitution, donorRecordIssues } from './check-bootstrap-profile.mjs';
const original = JSON.parse(await readFile(new URL('../iskorka.bootstrap.json', import.meta.url), 'utf8'));
const constitution = await readFile(new URL('../ISKORKA_CONSTITUTION.md', import.meta.url), 'utf8');

test('approved preparation shape passes (not a world baseline)', () => assert.deepEqual(validateProfile(original), []));
test('full handoff bytes are preserved', () => assert.deepEqual(validateConstitution(constitution), []));
test('truncated source is rejected', () => assert.ok(validateConstitution(constitution.replace('КОНЕЧНЫЙ МОЗГ', 'МОЗГ')).length));
test('empty profile produces violations, not a crash', () => assert.ok(validateProfile(null).length));
for (const [name, mutate] of [
  ['settlement relocation', p => { p.initialWorld.placement = 'recenter'; }],
  ['old settlement name', p => { p.initialWorld.settlementName = 'Айнкрад'; }],
  ['wrong founder count', p => { p.initialWorld.adults = 20; }],
  ['prearranged couples', p => { p.initialWorld.predefinedCouples = 5; }],
  ['Cardinal OFF instead of absent', p => { p.cardinal = 'OFF'; }],
  ['removing animals', p => { p.preserve = p.preserve.filter(x => x !== 'animals'); }],
  ['removing weather', p => { p.preserve = p.preserve.filter(x => x !== 'weather'); }],
  ['allowing monsters', p => { p.disabled = p.disabled.filter(x => x !== 'monsters'); }],
  ['wrong donor repository', p => { p.donor.repository = 'zejev1/ainkrad'; }],
]) test(`rejects ${name}`, () => {
  const p = structuredClone(original); mutate(p); assert.ok(validateProfile(p).length);
});
test('unapproved donor blocks the import gate', () => assert.ok(donorRecordIssues({ ...original.donor, ownerApproval: null }).length));
test('branch names cannot stand in for SHA', () => assert.ok(donorRecordIssues({ ...original.donor, sha: 'main' }).length));
test('approval for a different SHA is rejected', () => {
  assert.ok(donorRecordIssues({ repository: original.donor.repository, sha: 'a'.repeat(40),
    ownerApproval: { status: 'owner-confirmed-final', sha: 'b'.repeat(40), reference: 'synthetic-test-fixture' } }).length);
});
test('well-formed synthetic approval record passes structure only', () => {
  const sha = 'a'.repeat(40);
  assert.deepEqual(donorRecordIssues({ repository: original.donor.repository, sha,
    ownerApproval: { status: 'owner-confirmed-final', sha, reference: 'synthetic-test-fixture-not-real-approval' } }), []);
});
test('validation does not change the profile', () => {
  const before = JSON.stringify(original); validateProfile(original); donorRecordIssues(original.donor);
  assert.equal(JSON.stringify(original), before);
});
