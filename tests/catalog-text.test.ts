// English view of roasters' free-text catalog fields, and the roast date check on the bean forms.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { catalogText, processLabel } from '../src/i18n/coffeeLabels.ts';
import { roastDateProblem } from '../src/i18n/formatting.ts';

test('catalog text: German fragments become English, German view stays as the roaster wrote it', () => {
  assert.equal(processLabel('Natural (anaerob), entkoffeiniert – Sugar Cane / E.A.', 'en'), 'Natural (anaerobic), decaf – Sugar Cane / E.A.');
  assert.equal(processLabel('Washed (Guatemala- und Kenia-Anteil)', 'en'), 'Washed (Guatemala and Kenya portions)');
  assert.equal(processLabel('Natural (Brasilien), Washed (Äthiopien)', 'en'), 'Natural (Brazil), Washed (Ethiopia)');
  assert.equal(catalogText('Kirinyaga, 1.750 m', 'en'), 'Kirinyaga, 1,750 m');
  assert.equal(catalogText('verschiedene Regionen, 1.200–2.000 m', 'en'), 'various regions, 1,200–2,000 m');
  assert.equal(catalogText('Oporapa, Huila, bis 1.850 m', 'en'), 'Oporapa, Huila, up to 1,850 m');
  assert.equal(catalogText('Kirinyaga, 1.750 m', 'de'), 'Kirinyaga, 1.750 m');
  assert.equal(catalogText('Sundance Undulata', 'en'), 'Sundance Undulata');
});

test('process label: an explicit language wins over the app language', () => {
  // The app language in tests is the default; ask for both explicitly so they differ from it at least once.
  assert.equal(processLabel('honey', 'de'), 'Honey');
  assert.equal(processLabel('honey', 'en'), 'Honey process');
  assert.equal(processLabel('anaerob', 'de'), 'Anaerobic');
});

test('roast date: empty and past dates are fine, impossible and future dates are not', () => {
  const now = new Date(2026, 10, 1, 9, 0);
  assert.equal(roastDateProblem('', now), null);
  assert.equal(roastDateProblem('20.10.2026', now), null);
  assert.equal(roastDateProblem('01.11.2026', now), null);
  assert.equal(roastDateProblem('31.02.2026', now), 'invalid');
  assert.equal(roastDateProblem('02.11.2026', now), 'future');
  assert.equal(roastDateProblem('2027-01-01', now), 'future');
});
