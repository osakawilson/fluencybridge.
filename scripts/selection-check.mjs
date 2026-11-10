#!/usr/bin/env node
/**
 * Offline check of the three-tier practice picker (no server, no browser).
 *   node scripts/selection-check.mjs
 *
 * Imports the same pure helpers the UI uses (public/js/library.js) plus the
 * server library (src/scenarios.js) and asserts that every tier/category/medium
 * combination is populated, that option labels follow the spec format, that
 * every one of the 276 practice targets is reachable through the picker, and
 * that the CDN snapshot (public/scenarios.json) ships the very same bank.
 */

import { readFile } from 'node:fs/promises';
import libraryModule from '../src/scenarios.js';

const { CATEGORIES, SENTENCES } = libraryModule;

const source = await readFile(new URL('../public/js/library.js', import.meta.url), 'utf8');
const ui = await import(`data:text/javascript;base64,${Buffer.from(source, 'utf8').toString('base64')}`);
const {
  MEDIUM_TIERS, UI_MEDIUM_TIERS, GENERATION_WINDOWS, categoryGroups, categoryIdsForTier,
  defaultCategoryId, sentencesForSelection, sentenceOptionText, categoryOptionText,
  sentenceMedium, sentenceYear, sentenceTitle, sentenceReleaseLabel, yearBounds,
  generationWindowLabel, generationWindowsForRange, mysteryOptionText, sentencesInYearWindow
} = ui;

let failures = 0;
function check(label, condition, detail) {
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  if (!condition) failures += 1;
}

const tiers = MEDIUM_TIERS.map((tier) => tier.id);
check('four medium tiers (All / Scenarios / Movies / Songs)',
  tiers.join(',') === 'all,scenario,movie,song', tiers.join(','));

/* 0. The verified target count (README: "276 targets"). */
const EXPECTED_TARGETS = 276;
check('the verified 276-target bank is intact', SENTENCES.length === EXPECTED_TARGETS,
  `${SENTENCES.length} targets`);

/* 1. Every category and sentence carries medium metadata. */
const badCategories = CATEGORIES.filter((category) => !category.medium);
const badSentences = SENTENCES.filter((sentence) => !['scenario', 'movie', 'song'].includes(sentence.medium));
check('every category declares a medium', badCategories.length === 0,
  badCategories.map((category) => category.id).join(', '));
check('every target sentence declares a medium', badSentences.length === 0,
  badSentences.slice(0, 4).map((sentence) => sentence.id).join(', '));

const cohorts = CATEGORIES.filter((category) => category.group === 'generations'
  && !category.mix && !category.combined);
check('cohorts expose movie/song media',
  cohorts.every((category) => ['movie', 'song'].includes(category.medium)
    && Array.isArray(category.media)
    && category.media.includes('movie') && category.media.includes('song')),
  cohorts.map((category) => `${category.id}:${category.medium}`).join(' '));

/* 2. Level 2 -> groups per tier. */
const allIds = categoryIdsForTier('all', CATEGORIES);
check('tier All lists every category', allIds.length === CATEGORIES.length, `${allIds.length}/${CATEGORIES.length}`);

const scenarioIds = categoryIdsForTier('scenario', CATEGORIES);
check('tier Scenarios lists only situational categories', scenarioIds.length === 6
  && scenarioIds.every((id) => CATEGORIES.find((category) => category.id === id).group === 'scenario'),
  scenarioIds.join(','));

const cohortGroup = categoryGroups('movie', CATEGORIES).find((group) => group.label === 'Generations');
check('tier Movies keeps the demographic cohorts', Boolean(cohortGroup) && cohortGroup.categories.length === 8,
  cohortGroup && cohortGroup.categories.map((category) => category.label).join(' | '));
check('generations group order (combined -> cohorts -> shuffle/mix)',
  cohortGroup && cohortGroup.categories.map((category) => category.id).join(',')
  === 'generations-all,boomers,gen-jones,gen-x,millennials,gen-z,gen-alpha,generations-mix');
check('default category for Movies/Songs is All Generations (Combined)',
  defaultCategoryId('movie', CATEGORIES) === 'generations-all'
  && defaultCategoryId('song', CATEGORIES) === 'generations-all');
check('default category for Scenarios is the first situation',
  defaultCategoryId('scenario', CATEGORIES) === 'cafe', defaultCategoryId('scenario', CATEGORIES));

/* 3. Level 3 never comes up empty, for any tier + category pair. */
const emptyCombos = [];
tiers.forEach((tier) => {
  categoryIdsForTier(tier, CATEGORIES).forEach((categoryId) => {
    const pool = sentencesForSelection(SENTENCES, { tier, categoryId });
    if (!pool.length) emptyCombos.push(`${tier}/${categoryId}`);
  });
});
check('every tier + category combination has sentences', emptyCombos.length === 0, emptyCombos.join(', '));

/* 4. Medium filtering is exact. */
const leaky = [];
tiers.filter((tier) => tier !== 'all').forEach((tier) => {
  sentencesForSelection(SENTENCES, { tier, categoryId: 'all' })
    .filter((sentence) => sentenceMedium(sentence) !== tier)
    .forEach((sentence) => leaky.push(`${tier}:${sentence.id}`));
});
check('medium filter never leaks the other media', leaky.length === 0, leaky.slice(0, 5).join(', '));

const movieOnly = sentencesForSelection(SENTENCES, { tier: 'movie', categoryId: 'generations-all' });
const songOnly = sentencesForSelection(SENTENCES, { tier: 'song', categoryId: 'generations-all' });
check('All Generations splits into movies and songs',
  movieOnly.length > 0 && songOnly.length > 0 && movieOnly.length + songOnly.length === 60,
  `${movieOnly.length} movies / ${songOnly.length} songs`);

/* 5. Option labels follow `🎬 [Star Wars] "..."` / `☕ [Cafe] "..."`. */
const LABEL = /^(☕|🎬|🎵) \[[^\]]+\] ".+"$/;
const badLabels = SENTENCES.filter((sentence) => !LABEL.test(sentenceOptionText(sentence, CATEGORIES)));
check('target option labels follow the spec format', badLabels.length === 0,
  badLabels.slice(0, 3).map((sentence) => `${sentence.id}: ${sentenceOptionText(sentence, CATEGORIES)}`).join(' | '));

const sample = (id) => SENTENCES.find((sentence) => sentence.id === id);
console.log(`      e.g. ${sentenceOptionText(sample('cafe-1'), CATEGORIES)}`);
console.log(`      e.g. ${sentenceOptionText(sample('movies-1'), CATEGORIES)}`);
console.log(`      e.g. ${sentenceOptionText(sample('songs-3'), CATEGORIES)}`);
console.log(`      e.g. ${sentenceOptionText(sample('gen-z-2'), CATEGORIES)}`);

check('category option labels carry emoji + label',
  CATEGORIES.every((category) => categoryOptionText(category).length > 3),
  CATEGORIES.slice(0, 3).map((category) => categoryOptionText(category)).join(' | '));

const allLabel = categoryOptionText({ id: 'all', label: 'All categories', sentenceCount: SENTENCES.length });
check('aggregate labels show the tier count (no "(0)")',
  allLabel === `All categories (${SENTENCES.length})`
  && categoryOptionText({ id: 'generations-all', label: 'All Generations (Combined)', combined: true, sentenceCount: 60 })
  === 'All Generations (Combined) (60)'
  && categoryOptionText({ id: 'gen-x', label: 'Gen X (1965–1980)', sentenceCount: 10 }) === 'Gen X (1965–1980)',
  allLabel);

/* 6. Reachability: every target can be selected through some tier/category. */
const unreachable = SENTENCES.filter((sentence) => {
  const tier = sentenceMedium(sentence);
  if (!categoryIdsForTier(tier, CATEGORIES).includes(sentence.category)) return true;
  return !sentencesForSelection(SENTENCES, { tier, categoryId: sentence.category })
    .some((entry) => entry.id === sentence.id);
});
check('every practice target is reachable through the picker', unreachable.length === 0,
  unreachable.slice(0, 4).map((sentence) => `${sentence.id}(${sentence.medium})`).join(', '));

const totals = tiers.map((tier) => `${tier}:${sentencesForSelection(SENTENCES, { tier, categoryId: 'all' }).length}`);
check('medium totals add up to the whole library',
  tiers.slice(1).reduce((sum, tier) => sum + sentencesForSelection(SENTENCES, { tier, categoryId: 'all' }).length, 0)
  === SENTENCES.length, totals.join(' '));

/* 7. v1.1.0: Movies + Songs only, generation windows and mystery metadata. */
check('the UI exposes Movies and Songs only (scenarios hidden in 1.1.0)',
  UI_MEDIUM_TIERS.map((tier) => tier.id).join(',') === 'movie,song',
  UI_MEDIUM_TIERS.map((tier) => tier.id).join(','));
check('the four spec cohorts are Boomer 1960–1979 / Gen X 1980–1995 / '
  + 'Millennial 1996–2010 / Gen Z 2011–2025',
  GENERATION_WINDOWS.map((window) => `${window.label}:${window.from}-${window.to}`).join('|')
  === 'Boomer:1960-1979|Gen X:1980-1995|Millennial:1996-2010|Gen Z:2011-2025',
  GENERATION_WINDOWS.map((window) => `${window.label} ${window.from}-${window.to}`).join(' | '));

const quotes = SENTENCES.filter((sentence) => sentenceMedium(sentence) !== 'scenario');
const missingYears = quotes.filter((sentence) => !Number.isFinite(sentenceYear(sentence)));
check('every movie/song target carries a release year', missingYears.length === 0,
  missingYears.slice(0, 4).map((sentence) => sentence.id).join(', '));
const missingTitles = quotes.filter((sentence) => !sentenceTitle(sentence));
check('every movie/song target carries a hidden work/artist title', missingTitles.length === 0,
  missingTitles.slice(0, 4).map((sentence) => sentence.id).join(', '));

const bounds = yearBounds(SENTENCES);
check('the generation slider span covers the bank', bounds.min === 1939 && bounds.max === 2023,
  `${bounds.min}–${bounds.max}`);

const boomerPop = sentencesForSelection(quotes, { tier: 'song', yearFrom: 1960, yearTo: 1979 });
check('a generation window filters by medium AND release year',
  boomerPop.length > 0 && boomerPop.every((sentence) => sentenceMedium(sentence) === 'song'
    && sentenceYear(sentence) >= 1960 && sentenceYear(sentence) <= 1979),
  `${boomerPop.length} Boomer songs`);
const genZAll = sentencesInYearWindow(quotes, 2011, 2025);
check('Gen Z window (2011–2025) has targets in both media',
  genZAll.some((sentence) => sentenceMedium(sentence) === 'movie')
  && genZAll.some((sentence) => sentenceMedium(sentence) === 'song'),
  `${genZAll.length} lines`);
check('generation labels name every overlapping cohort',
  generationWindowLabel(1960, 1995) === '1960–1995 · Boomer · Gen X'
  && generationWindowsForRange(2011, 2025).map((window) => window.id).join(',') === 'gen-z',
  generationWindowLabel(1960, 1995));

const sampleQuote = sample('gen-z-1');
const mystery = mysteryOptionText(sampleQuote);
const plain = sentenceOptionText(sampleQuote, CATEGORIES);
check('the mystery label hides the title before scoring',
  mystery === `🎬 [Mystery Movie] "${sampleQuote.referenceText}"` && !mystery.includes('Endgame'),
  mystery);
check('the scored label still names the work (post-reveal inspector)',
  plain.includes('[Avengers: Endgame]'), plain);
check('the reveal label is "Title (Year)"',
  sentenceReleaseLabel(sampleQuote) === 'Avengers: Endgame (2019)',
  sentenceReleaseLabel(sampleQuote));
check('no practice dropdown leaks a source before the reveal',
  quotes.every((sentence) => sentenceOptionText(sentence, CATEGORIES, { mystery: true })
    === mysteryOptionText(sentence)),
  mysteryOptionText(sample('movies-1')));

/* 8. The CDN copy shipped with the site carries the SAME complete bank. */
let bank = null;
try {
  bank = JSON.parse(await readFile(new URL('../public/scenarios.json', import.meta.url), 'utf8'));
} catch (err) {
  bank = null;
}
check('public/scenarios.json (the CDN fallback bank) is published', Boolean(bank));
const bankTargets = bank && Array.isArray(bank.scenarios) ? bank.scenarios : [];
check('the CDN bank carries every target (run `npm run build` after editing the data)',
  bankTargets.length === SENTENCES.length, `${bankTargets.length}/${SENTENCES.length}`);
const bankById = new Map(bankTargets.map((sentence) => [sentence.id, sentence]));
check('the CDN bank matches src/scenarios.js target for target',
  bankById.size === SENTENCES.length
  && SENTENCES.every((sentence) => bankById.has(sentence.id)
    && bankById.get(sentence.id).text === sentence.text),
  `${bankById.size}/${SENTENCES.length} ids`);
check('the CDN bank ships the full category + vowel tables',
  Boolean(bank) && Array.isArray(bank.categories) && bank.categories.length === CATEGORIES.length
  && Boolean(bank.vowels) && Object.keys(bank.vowels).length > 0,
  bank ? `${bank.categories.length} categories, ${Object.keys(bank.vowels || {}).length} vowel entries` : 'missing');

console.log(failures ? `\n${failures} check(s) failed.` : `\nAll selection checks passed (${SENTENCES.length} targets).`);
process.exit(failures ? 1 : 0);

