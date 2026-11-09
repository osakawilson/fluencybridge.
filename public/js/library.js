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

export const MEDIUM_META = {
  scenario: { emoji: '☕', label: 'Scenario' },
  movie: { emoji: '🎬', label: 'Movie' },
  song: { emoji: '🎵', label: 'Song' }
};

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

/** Level-3 pool: medium AND category must both match. */
export function sentencesForSelection(sentences = [], { tier = 'all', categoryId = 'all' } = {}) {
  return sentences.filter((sentence) => {
    if (tier !== 'all' && sentenceMedium(sentence) !== tier) return false;
    if (categoryId && categoryId !== 'all' && sentence.category !== categoryId) return false;
    return true;
  });
}

/** `🎬 [Star Wars] "May the Force be with you."` */
export function sentenceOptionText(sentence, categories = []) {
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
