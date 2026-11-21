// Compile the pure locale modules into a temporary directory; no app or network needed.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ts = require('typescript');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'goodcoffee-i18n-'));
try {
  for (const name of ['core', 'en', 'de', 'formatting']) {
    const source = fs.readFileSync(path.join(__dirname, '../src/i18n', name + '.ts'), 'utf8');
    fs.writeFileSync(path.join(temp, name + '.js'), ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText);
  }
  const { resolveLanguage, translate, isLanguagePreference } = require(path.join(temp, 'core.js'));
  const { en } = require(path.join(temp, 'en.js'));
  const { de } = require(path.join(temp, 'de.js'));
  const { formatNumber, formatDate, parseInputDate, formatInputDate } = require(path.join(temp, 'formatting.js'));
  assert.equal(resolveLanguage('system', ['de-AT', 'en-GB']), 'de');
  assert.equal(resolveLanguage('system', ['fr-FR', 'en-US', 'de-DE']), 'en');
  assert.equal(resolveLanguage('system', ['fr-FR', 'de-DE']), 'de');
  assert.equal(resolveLanguage('system', ['ja-JP']), 'en');
  assert.equal(resolveLanguage('system', []), 'en');
  assert.equal(resolveLanguage('en', ['de-DE']), 'en');
  assert.equal(resolveLanguage('de', ['en-US']), 'de');
  assert.equal(isLanguagePreference('garbage'), false);
  assert.equal(isLanguagePreference('system'), true);
  assert.deepEqual(Object.keys(de).sort(), Object.keys(en).sort());
  const slots = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
  for (const key of Object.keys(en)) {
    const source = typeof en[key] === 'string' ? { other: en[key] } : en[key];
    const translated = typeof de[key] === 'string' ? { other: de[key] } : de[key];
    for (const form of Object.keys(source)) {
      assert.ok(translated[form], `${key}: missing ${form}`);
      assert.deepEqual(slots(source[form]), slots(translated[form]), `${key}: placeholders differ`);
    }
  }
  assert.equal(translate('en', 'cupCount', { count: 0 }), '0 cups');
  assert.equal(translate('en', 'cupCount', { count: 1 }), '1 cup');
  assert.equal(translate('de', 'cupCount', { count: 2 }), '2 Tassen');
  // Expo Go on the reported iPhone has no Intl.PluralRules. Exercise every
  // count-based message with that API absent, not just the browser/Node runtime.
  const pluralCases = [];
  for (const language of ['en', 'de']) {
    for (const key of Object.keys(en).filter((key) => typeof en[key] !== 'string')) {
      for (const count of [0, 1, 2, -1, 0.5, 1.5, 1000000]) {
        const params = { count, hits: 1 };
        pluralCases.push({ language, key, params, expected: translate(language, key, params) });
      }
    }
  }
  const pluralRulesDescriptor = Object.getOwnPropertyDescriptor(Intl, 'PluralRules');
  try {
    Object.defineProperty(Intl, 'PluralRules', { configurable: true, writable: true, value: undefined });
    for (const { language, key, params, expected } of pluralCases) {
      assert.equal(translate(language, key, params), expected, `${language}/${key}: missing Intl.PluralRules`);
    }
  } finally {
    Object.defineProperty(Intl, 'PluralRules', pluralRulesDescriptor);
  }
  assert.equal(translate('en', 'Continue with {name}', { name: 'Äthiopien Guji' }), 'Continue with Äthiopien Guji');
  const original = de.Discover;
  delete de.Discover;
  assert.equal(translate('de', 'Discover'), 'Discover');
  de.Discover = original;
  assert.equal(formatNumber(18.5, 1, 'en'), '18.5');
  assert.equal(formatNumber(18.5, 1, 'de'), '18,5');
  assert.equal(formatDate(new Date(2026, 9, 30), { month: 'long' }, 'en'), 'October');
  assert.equal(formatDate(new Date(2026, 9, 30), { month: 'long' }, 'de'), 'Oktober');
  for (const input of ['08.10.2026', '08/10/2026', '2026-10-08']) assert.equal(parseInputDate(input), '2026-10-08');
  for (const input of ['31/02/2026', '29.02.2025', '2026-13-01', '00/10/2026', '08/10.2026', '2026-00-01']) assert.equal(parseInputDate(input), null, input);
  assert.equal(parseInputDate('29/02/2024'), '2024-02-29');
  assert.equal(parseInputDate('8.10.', new Date(2026, 0, 1)), '2026-10-08');
  assert.equal(formatInputDate('2026-10-08', 'en'), '08/10/2026');
  assert.equal(formatInputDate('2026-10-08', 'de'), '08.10.2026');
  // Exercise aroma compatibility and translated catalogue labels with the real core translator.
  fs.mkdirSync(path.join(temp, 'i18n'));
  fs.mkdirSync(path.join(temp, 'lib'));
  fs.writeFileSync(path.join(temp, 'i18n/index.js'), `const core=require('../core'); exports.getLanguage=()=> 'en'; exports.t=(key,params)=>core.translate('en',key,params);`);
  // coffeeLabels imports ./core directly (src/i18n/core.ts); point it at the transpiled core.
  fs.writeFileSync(path.join(temp, 'i18n/core.js'), `module.exports=require('../core');`);
  for (const [input, output] of [['src/lib/coffee.ts', 'lib/coffee.js'], ['src/i18n/coffeeLabels.ts', 'i18n/coffeeLabels.js']]) {
    fs.writeFileSync(path.join(temp, output), ts.transpileModule(fs.readFileSync(path.join(__dirname, '..', input), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText);
  }
  const { aromaName, noteMatches, normalizeAromaKey } = require(path.join(temp, 'lib/coffee.js'));
  assert.equal(aromaName('fruit:Beeren'), 'Berries');
  assert.equal(aromaName('fruit:berries'), 'Berries');
  assert.equal(normalizeAromaKey('sweet:Karamell'), 'sweet:caramel');
  assert.equal(noteMatches('Himbeere', ['fruit:Beeren']), true);
  assert.equal(noteMatches('Raspberry', ['fruit:berries']), true);
  assert.equal(noteMatches('Chocolate', ['fruit:berries']), false);
  const { originLabel, processLabel } = require(path.join(temp, 'i18n/coffeeLabels.js'));
  assert.equal(originLabel('Brasilien, Äthiopien', 'en'), 'Brazil, Ethiopia');
  assert.equal(originLabel('Brazil, Ethiopia', 'de'), 'Brasilien, Äthiopien');
  assert.equal(originLabel('Unknown origin', 'de'), 'Unknown origin');
  assert.equal(processLabel('Anaerob'), 'Anaerobic');
  assert.equal(translate('de', 'ratingSummary', { average: formatNumber(4.2, 1, 'de'), count: 7 }), '4,2 · 7 Bewertungen');
  assert.equal(translate('en', 'ratingSummary', { average: formatNumber(4.2, 1, 'en'), count: 7 }), '4.2 · 7 ratings');
  assert.equal(translate('de', 'ratingSummary', { average: formatNumber(5, 1, 'de'), count: 1 }), '5,0 · 1 Bewertung');
  assert.equal(translate('en', 'ratingSummary', { average: formatNumber(5, 1, 'en'), count: 1 }), '5.0 · 1 rating');
  console.log(`Passed: ${Object.keys(en).length} bilingual messages, fallback, locale selection, plural forms, interpolation, dates, numbers and legacy coffee values.`);
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
