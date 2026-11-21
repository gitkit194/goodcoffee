import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { flavourNotes, isFlavourNote, isKnownNote, noteLabel } from '../src/i18n/notes.ts';

const catalog = JSON.parse(readFileSync(new URL('../src/data/catalog-seed.json', import.meta.url), 'utf8'));
const notes: string[] = [...new Set<string>(catalog.coffees.flatMap((c: { roaster_notes: string[] }) => c.roaster_notes))];

test('German notes show in English and back', () => {
  assert.equal(noteLabel('Schokolade', 'en'), 'Chocolate');
  assert.equal(noteLabel('Haselnuss', 'en'), 'Hazelnut');
  assert.equal(noteLabel('Hazelnut', 'de'), 'Haselnuss');
  assert.equal(noteLabel('dunkle Schokolade', 'en'), 'Dark chocolate');
  assert.equal(noteLabel('Walnüsse, Nougat', 'en'), 'Walnut, Nougat');
  assert.equal(noteLabel('Unbekannte Note', 'en'), 'Unbekannte Note');
});

test('every note in the catalogue has an English and a German label', () => {
  assert.deepEqual(notes.filter((n) => !isKnownNote(n)), []);
});

test('body, acidity and balance words are not kept as tasting notes', () => {
  assert.deepEqual(flavourNotes(['Chocolate', 'Nuts & Grains', 'rund']), ['Chocolate', 'Nuts & Grains']);
  assert.deepEqual(flavourNotes(['Ausgewogen', 'milde Säure', 'Vollmundig', 'Long finish', 'Kirsche', 'kirsche']), ['Kirsche']);
  assert.equal(noteLabel('Nuts & Grains', 'de'), 'Nüsse & Getreide');
});

test('no catalogue flavour is mistaken for a body word', () => {
  const dropped = notes.filter((n) => !isFlavourNote(n));
  assert.deepEqual(dropped, ['Elegant']);
});
