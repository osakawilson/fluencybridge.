/**
 * Pure practice-library selection helpers for the three-tier picker.
 *
 *   1. Medium / type : all | scenario | movie | song      (segmented pills)
 *   2. Category / era: the categories available in that tier
 *   3. Target        : sentences matching BOTH of the above
 *
 * Keeping this logic out of app.js makes the filter deterministic and testable
 * (scripts/selection-check.mjs imports this module directly).
 */

export const MEDIUM_TIERS = [
  { id: 'all', label: 'All', emoji: '' },
  { id: 'scenario', label: 'Scenarios', emoji: '☕' },
  { id: 'movie', label: 'Movies', emoji: '🎬' },
  { id: 'song', label: 'Songs', emoji: '🎵' }
];

/**
 * v1.1.0 ships only the two media the research design uses. The `MEDIUM_TIERS`
 * table above stays complete so the offline selection checks (and any future
 * scenario release) keep their meaning.
 */
export const UI_MEDIUM_TIERS = MEDIUM_TIERS.filter((tier) => tier.id === 'movie' || tier.id === 'song');

export const MEDIUM_META = {
  scenario: { emoji: '☕', label: 'Scenario' },
  movie: { emoji: '🎬', label: 'Movie' },
  song: { emoji: '🎵', label: 'Song' }
};

/**
 * Metadata shown before the reveal. The work/artist is hidden, the media is not.
 */
export const MYSTERY_META = {
  scenario: { emoji: '☕', label: 'Mystery Scenario' },
  movie: { emoji: '🎬', label: 'Mystery Movie' },
  song: { emoji: '🎵', label: 'Mystery Artist' }
};

export const MYSTERY_PLACEHOLDER = '? ? ? ? ? ?';

/**
 * Release-era windows from the v1.1.0 spec. The slider spans the whole bank
 * (1939–2025); these four chips jump straight to a cohort.
 */
export const GENERATION_WINDOWS = [
  { id: 'boomer', label: 'Boomer', emoji: '🎸', from: 1960, to: 1979, tip: 'classic cinema, rock & folk' },
  { id: 'gen-x', label: 'Gen X', emoji: '📼', from: 1980, to: 1995, tip: '80s/90s cinema & alt-rock' },
  { id: 'millennial', label: 'Millennial', emoji: '💿', from: 1996, to: 2010, tip: 'late-90s & 2000s pop culture' },
  { id: 'gen-z', label: 'Gen Z', emoji: '📱', from: 2011, to: 2025, tip: '2010s+ hits, MCU & streaming' }
];

const VALID_MEDIA = ['scenario', 'movie', 'song'];

/** Medium of one sentence; falls back to its collection when untyped. */
export function sentenceMedium(sentence) {
  const medium = sentence && sentence.medium;
  if (VALID_MEDIA.includes(medium)) return medium;
  const group = sentence && sentence.group;
  if (group === 'movie' || group === 'song') return group;
  return 'scenario';
}

/** Medium of a category ('mixed' for cohorts that pool films and songs). */
export function categoryMedium(category) {
  const medium = category && category.medium;
  if (VALID_MEDIA.includes(medium)) return medium;
  if (medium === 'mixed') return 'mixed';
  const group = category && category.group;
  if (group === 'movie' || group === 'song') return group;
  return 'scenario';
}

/** "Star Wars · 1977 · Gen Jones" -> "Star Wars". */
export function shortSource(source) {
  return String(source || '').split('·')[0].trim();
}

/**
 * Release year of a sentence: the explicit `year` field first (src/scenarios.js
 * derives it from `source`), then a `19xx`/`20xx` token in the source, else null.
 */
export function sentenceYear(sentence) {
  const explicit = Number(sentence && sentence.year);
  if (Number.isFinite(explicit) && explicit > 1900) return explicit;
  const years = String((sentence && sentence.source) || '').match(/\b(19\d{2}|20\d{2})\b/g);
  return years && years.length ? Number(years[years.length - 1]) : null;
}

/** Work / band name shown in the reveal (`The Lord of the Rings`, `Queen`). */
export function sentenceTitle(sentence) {
  const explicit = sentence && sentence.title;
  if (explicit) return String(explicit).trim();
  const fromSource = shortSource(sentence && sentence.source);
  if (fromSource) return fromSource;
  return (sentence && (sentence.categoryLabel || sentence.label)) || '';
}

/** `🎬 The Lord of the Rings (2001)` — the reward after a decoded line. */
export function sentenceReleaseLabel(sentence) {
  const year = sentenceYear(sentence);
  const title = sentenceTitle(sentence);
  if (!title) return '';
  return year ? `${title} (${year})` : title;
}

/** Min/max release years present in a bank (defaults to the spec's span). */
export function yearBounds(sentences = []) {
  const years = sentences
    .filter((sentence) => sentenceMedium(sentence) !== 'scenario')
    .map(sentenceYear)
    .filter((year) => Number.isFinite(year));
  if (!years.length) return { min: 1960, max: 2025 };
  return { min: Math.min(...years), max: Math.max(...years) };
}

/** Which spec cohorts a window overlaps ([] when it sits between them). */
export function generationWindowsForRange(from, to) {
  const low = Number(from);
  const high = Number(to);
  if (!Number.isFinite(low) || !Number.isFinite(high)) return [];
  return GENERATION_WINDOWS.filter((window) => window.from <= high && window.to >= low);
}

/** `1960–1995 · Boomer · Gen X` (used under the dual slider). */
export function generationWindowLabel(from, to) {
  const low = Number(from);
  const high = Number(to);
  if (!Number.isFinite(low) || !Number.isFinite(high)) return 'All eras';
  const labels = generationWindowsForRange(low, high).map((window) => window.label);
  return `${low}–${high}${labels.length ? ` · ${labels.join(' · ')}` : ' · between cohorts'}`;
}

/** True when the window covers every era the bank can offer. */
export function isFullYearSpan(from, to, sentences = []) {
  const bounds = yearBounds(sentences);
  return Number(from) <= bounds.min && Number(to) >= bounds.max;
}

/** Sentences whose release year falls inside [from, to]. */
export function sentencesInYearWindow(sentences = [], from, to) {
  const hasWindow = from !== null && from !== undefined && from !== ''
    && to !== null && to !== undefined && to !== '';
  const low = hasWindow ? Number(from) : NaN;
  const high = hasWindow ? Number(to) : NaN;
  if (!Number.isFinite(low) || !Number.isFinite(high)) return [...sentences];
  return sentences.filter((sentence) => {
    const year = sentenceYear(sentence);
    return Number.isFinite(year) && year >= low && year <= high;
  });
}

/**
 * Level-2 groups for a tier. Cohorts are shown for Movies, Songs and All (the
 * spec's demographic lists); Situations only for Scenarios/All.
 * @returns {Array<{label:string, categories:Array}>}
 */
export function categoryGroups(tier, categories = []) {
  const inGroup = (groupId) => categories.filter((category) => category.group === groupId);
  const groups = [];

  if (tier === 'all' || tier === 'scenario') {
    groups.push({ label: 'Situations', categories: inGroup('scenario') });
  }
  if (tier === 'all' || tier === 'movie' || tier === 'song') {
    groups.push({ label: 'Generations', categories: inGroup('generations') });
  }

  const classics = [];
  if (tier === 'all' || tier === 'movie') classics.push(...inGroup('movie'));
  if (tier === 'all' || tier === 'song') classics.push(...inGroup('song'));
  if (classics.length) groups.push({ label: 'Classic Collections', categories: classics });

  return groups.filter((group) => group.categories.length);
}

/** Ids selectable in the Level-2 dropdown for this tier. */
export function categoryIdsForTier(tier, categories = []) {
  return categoryGroups(tier, categories).flatMap((group) => group.categories.map((category) => category.id));
}

/** Default Level-2 selection when the tier changes. */
export function defaultCategoryId(tier, categories = []) {
  if (tier === 'scenario') {
    const first = categories.find((category) => category.group === 'scenario');
    return first ? first.id : 'all';
  }
  if (tier === 'movie' || tier === 'song') {
    const generations = categories.filter((category) => category.group === 'generations');
    const combined = generations.find((category) => category.combined) || generations[0];
    return combined ? combined.id : 'all';
  }
  return 'all';
}

/**
 * Level-3 pool: medium AND category must both match. An optional generation
 * window (`yearFrom`/`yearTo`) narrows the pool to that release-era range.
 */
export function sentencesForSelection(sentences = [], {
  tier = 'all', categoryId = 'all', yearFrom = null, yearTo = null
} = {}) {
  const hasWindow = yearFrom !== null && yearFrom !== undefined && yearFrom !== ''
    && yearTo !== null && yearTo !== undefined && yearTo !== '';
  const low = hasWindow ? Number(yearFrom) : NaN;
  const high = hasWindow ? Number(yearTo) : NaN;
  const filterYears = Number.isFinite(low) && Number.isFinite(high);
  return sentences.filter((sentence) => {
    if (tier !== 'all' && sentenceMedium(sentence) !== tier) return false;
    if (categoryId && categoryId !== 'all' && sentence.category !== categoryId) return false;
    if (filterYears) {
      const year = sentenceYear(sentence);
      if (!Number.isFinite(year) || year < low || year > high) return false;
    }
    return true;
  });
}

/** `🎬 [Mystery Movie] "I am inevitable."` — the pre-reveal dropdown label. */
export function mysteryOptionText(sentence) {
  const medium = sentenceMedium(sentence);
  const meta = MYSTERY_META[medium] || MYSTERY_META.movie;
  const text = (sentence && (sentence.referenceText || sentence.text)) || '';
  return `${meta.emoji} [${meta.label}] "${text}"`;
}

/**
 * `🎬 [Star Wars] "May the Force be with you."`
 * With `{ mystery: true }` the work/artist is replaced by the mystery badge.
 */
export function sentenceOptionText(sentence, categories = [], { mystery = false } = {}) {
  if (mystery) return mysteryOptionText(sentence);
  const medium = sentenceMedium(sentence);
  const meta = MEDIUM_META[medium];
  const category = categories.find((entry) => entry.id === sentence.category);
  const tag = medium === 'scenario'
    ? (category && category.shortLabel) || 'Scenario'
    : shortSource(sentence.source) || (category && category.shortLabel) || meta.label;
  const text = sentence.referenceText || sentence.text || '';
  return `${meta.emoji} [${tag}] "${text}"`;
}

/**
 * `🎸 Boomers (1946–1954)` / `🌍 All Generations (Combined) (31)`.
 * Aggregates show how many lines the *current tier* offers.
 */
export function categoryOptionText(category, tierCount = null) {
  if (!category) return 'All categories';
  const emoji = category.emoji ? `${category.emoji} ` : '';
  const provided = tierCount === null || tierCount === undefined ? NaN : Number(tierCount);
  const count = Number.isFinite(provided) ? provided : Number(category.sentenceCount);
  const aggregate = Boolean(category.mix || category.combined || category.id === 'all');
  const suffix = aggregate && Number.isFinite(count) ? ` (${count})` : '';
  return `${emoji}${category.label}${suffix}`.trim();
}
