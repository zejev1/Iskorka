/** Checks the preparation profile, NOT a running world or remote CI. */
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

export const SOURCE_SHA256 = 'bbe8f366079f05da899431c37554ee4f8b12f9b88f4102bde1c39b988346870c';
const preserved = 'continent geography terrain weather seasons dayNight calendar physicalMovement roads houses fields resources forest rivers lakes sea animals fishing hunting farming mining construction crafting storage humanLibrary reading saveLoad indexedDB deterministicRng timeAccelerationSemantics'.split(' ');
const disabled = 'nonHumanRaces nonHumanSettlements monsters centuryHumpback monsterDependentRpgEconomy interracialDiplomacy racialLibraries racialRules'.split(' ');

/** Returns all configuration violations; does not mutate the supplied record. */
export function validateProfile(p) {
  const errors = [];
  const check = (ok, message) => { if (!ok) errors.push(message); };
  check(p?.schemaVersion === 1 && p?.project === 'Iskorka', 'Invalid project/schema.');
  check(p?.constitutionSourceSha256 === SOURCE_SHA256, 'Source handoff hash changed.');
  const expected = { continents: 1, settlements: 1, settlementName: 'Основание',
    placement: 'keep-donor-coordinates', adults: 10, men: 5, women: 5,
    predefinedCouples: 0, humanLibraries: 1, distinctBodiesAndTemperaments: true };
  for (const [key, value] of Object.entries(expected)) {
    check(p?.initialWorld?.[key] === value, `initialWorld.${key} violates the bootstrap contract.`);
  }
  check(p?.cardinal === 'absent-from-runtime-dependency-graph', 'Cardinal must be absent, not OFF.');
  for (const name of preserved) {
    check(Array.isArray(p?.preserve) && p.preserve.includes(name), `Missing preservation requirement: ${name}`);
  }
  for (const name of disabled) {
    check(Array.isArray(p?.disabled) && p.disabled.includes(name), `Missing disabled subsystem: ${name}`);
  }
  check(p?.conditionalPreserve?.shipsAndNavigation === 'when-stable-in-approved-donor', 'Navigation condition changed.');
  check(p?.conditionalPreserve?.physicalWoundsAndDiseases === 'when-independent-of-cardinal', 'Physical health condition changed.');
  check(p?.donor?.repository === 'zejev1/ainkrad-v0.3', 'Wrong donor repository.');
  return errors;
}

/** Structural approval-record check only. Evidence must still be verified by a human/connected GitHub audit. */
export function donorRecordIssues(d) {
  const errors = [];
  if (d?.repository !== 'zejev1/ainkrad-v0.3') errors.push('Wrong donor repository.');
  if (typeof d?.sha !== 'string' || !/^[0-9a-f]{40}$/.test(d.sha)) errors.push('Missing immutable donor SHA.');
  const a = d?.ownerApproval;
  if (a?.status !== 'owner-confirmed-final' || typeof a?.reference !== 'string' || !a.reference.trim()) {
    errors.push('Missing explicit final-owner approval reference.');
  }
  if (!a?.sha || a.sha !== d?.sha) errors.push('Owner approval must identify this exact donor SHA.');
  return errors;
}

export function validateConstitution(text) {
  const marker = '```text\n';
  const start = text.indexOf(marker);
  const end = text.indexOf('\n```', start + marker.length);
  if (start < 0 || end < 0) return ['Full original handoff is missing.'];
  const source = text.slice(start + marker.length, end) + '\n';
  return createHash('sha256').update(source).digest('hex') === SOURCE_SHA256
    ? [] : ['Original handoff bytes changed or were truncated.'];
}

async function main() {
  const base = new URL('../', import.meta.url);
  const profile = JSON.parse(await readFile(new URL('iskorka.bootstrap.json', base), 'utf8'));
  const constitution = await readFile(new URL('ISKORKA_CONSTITUTION.md', base), 'utf8');
  const errors = [...validateProfile(profile), ...validateConstitution(constitution)];
  if (process.argv.includes('--require-donor')) errors.push(...donorRecordIssues(profile.donor));
  if (errors.length) {
    for (const error of errors) console.error(error);
    process.exitCode = 1;
    return;
  }
  console.log('Preparation profile and original handoff: PASS.');
  console.log('This does NOT certify a working world, physics, a build, or remote donor checks.');
  if (donorRecordIssues(profile.donor).length) console.log('World import remains BLOCKED: no approved final donor.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
