/**
 * FluencyBridge Inspector — app orchestration.
 *
 * Pipeline per turn:
 *   mic (16 kHz PCM WAV) -> POST /api/assess (Azure PA) -> POST /api/chat (DeepSeek)
 *   -> render student view + researcher inspector -> optional TTS playback.
 */

import { getHealth, getScenarios, assessAudio, chatRecast, getSession, unlockSession } from './api.js';
import { MicrophoneRecorder, RecordingError } from './recorder.js';
import { SPEECH_RATE, speak, speakPhoneme, stopSpeaking, warmUpVoices } from './speech.js';
import {
  $, $$, el, clear, initTooltips, toast, formatMs, formatScore, scoreBand, bandLabel, formatOffset,
  jsonTree, jsonBlock, payloadDetails, chipTag, escapeHtml, highlightJson,
  readModeFlags, SPEAKER_ICON_SVG
} from './ui.js';
import { annotateSentence, setVowelLexicon } from './vowels.js';
import {
  MEDIUM_TIERS, MEDIUM_META, categoryGroups, categoryIdsForTier, defaultCategoryId,
  sentencesForSelection, sentenceOptionText, categoryOptionText, sentenceMedium
} from './library.js';

const FALLBACK_SENTENCES = [
  {
    id: 'cafe-1', category: 'cafe', categoryLabel: 'Cafe & Dining', group: 'scenario',
    groupLabel: 'Practice Scenarios', emoji: '\u2615', label: 'Order a latte', medium: 'scenario',
    referenceText: 'I would like a medium latte with oat milk, please.',
    text: 'I would like a medium latte with oat milk, please.',
    ja: 'オートミルクのミディアムラテをお願いします。',
    source: null, focus: 'ordering, ingredients, paying',
    keywords: ['latte', 'coffee', 'oat milk', 'milk', 'sugar', 'cake', 'check', 'table'],
    starters: ['Can I have a medium latte, please?', 'How much is the chocolate cake?', 'Could we have the check, please?']
  },
  {
    id: 'airport-1', category: 'airport', categoryLabel: 'Airport & Travel', group: 'scenario',
    groupLabel: 'Practice Scenarios', emoji: '\u2708\uFE0F', label: 'Find baggage claim', medium: 'scenario',
    referenceText: 'Where is the baggage claim, please?',
    text: 'Where is the baggage claim, please?',
    ja: '手荷物受取所はどこですか。',
    source: null, focus: 'directions, baggage, boarding',
    keywords: ['baggage claim', 'suitcase', 'flight', 'gate', 'boarding pass'],
    starters: ['Where is the baggage claim, please?', 'Which gate does flight 205 leave from?', 'What time does boarding start?']
  },
  {
    id: 'movies-1', category: 'movies', categoryLabel: 'Famous Movie Lines', group: 'movie',
    groupLabel: 'Famous Movie Lines', emoji: '\uD83C\uDFAC', label: 'May the Force be with you.', medium: 'movie',
    referenceText: 'May the Force be with you.', text: 'May the Force be with you.',
    ja: 'フォースが共にあらんことを。',
    source: 'Star Wars', focus: 'rhythm, stress, linking',
    keywords: ['force', 'back', 'problem'],
    starters: ['May the Force be with you.', 'I will be back.', 'Why so serious?']
  }
];

function fallbackCategories() {
  const byId = new Map();
  FALLBACK_SENTENCES.forEach((sentence) => {
    if (byId.has(sentence.category)) {
      byId.get(sentence.category).sentenceCount += 1;
      return;
    }
    byId.set(sentence.category, {
      id: sentence.category,
      label: sentence.categoryLabel,
      shortLabel: sentence.categoryLabel,
      group: sentence.group,
      groupLabel: sentence.groupLabel,
      emoji: sentence.emoji,
      medium: sentence.medium,
      media: [sentence.medium],
      tip: sentence.focus,
      sentenceCount: 1
    });
  });
  return [...byId.values()];
}

const FALLBACK_GROUPS = [
  { id: 'scenario', label: 'Practice Scenarios' },
  { id: 'movie', label: 'Famous Movie Lines' },
  { id: 'song', label: 'Famous Song Lyrics' },
  { id: 'generations', label: 'Generations' }
];

const dom = {
  categorySelect: $('#categorySelect'),
  sentenceSelect: $('#sentenceSelect'),
  mediumPills: $$('#mediumPills .seg-btn'),
  practiceMeta: $('#practiceMeta'),
  scenarioGoal: $('#scenarioGoal'),
  scriptedToggle: $('#scriptedToggle'),
  modelSentenceCard: $('#modelSentenceCard'),
  modelCardTitle: $('#modelCardTitle'),
  modelCardIcon: $('#modelCardIcon'),
  modelCardHint: $('#modelCardHint'),
  modelSentenceText: $('#modelSentenceText'),
  modelSentenceHint: $('#modelSentenceHint'),
  scoringModeBadge: $('#scoringModeBadge'),
  scoringModeTitle: $('#scoringModeTitle'),
  scoringModeSub: $('#scoringModeSub'),
  playModelBtn: $('#playModelBtn'),
  translateBtn: $('#translateBtn'),
  modelTranslation: $('#modelTranslation'),
  voiceSelect: $('#voiceSelect'),
  vowelToggle: $('#vowelToggle'),
  vowelHint: $('#vowelHint'),
  modelNote: $('#modelNote'),
  micBtn: $('#micBtn'),
  micStage: $('#micStage'),
  micCard: $('.mic-card'),
  micStatus: $('#micStatus'),
  recTimer: $('#recTimer'),
  playback: $('#playback'),
  resetBtn: $('#resetBtn'),
  transcriptCard: $('#transcriptCard'),
  scoreChips: $('#scoreChips'),
  wordStream: $('#wordStream'),
  assessSource: $('#assessSource'),
  noSpeechNote: $('#noSpeechNote'),
  studentPhonemesCard: $('#studentPhonemesCard'),
  studentPhonemes: $('#studentPhonemes'),
  studentPhonemeRule: $('#studentPhonemeRule'),
  aiCard: $('#aiCard'),
  recastText: $('#recastText'),
  aiReply: $('#aiReply'),
  chipRow: $('#chipRow'),
  aiFootnote: $('#aiFootnote'),
  engineSelect: $('#engineSelect'),
  playReplyBtn: $('#playReplyBtn'),
  emptyState: $('#emptyState'),
  turnBadge: $('#turnBadge'),
  tabScores: $('#tab-scores'),
  tabRecast: $('#tab-recast'),
  tabRaw: $('#tab-raw'),
  tabs: Array.from(document.querySelectorAll('.tab')),
  modeButtons: $$('.mode-btn'),
  brandSub: $('.brand-sub'),
  modeBanner: $('#modeBanner'),
  usageBanner: $('#usageBanner'),
  usageBannerIcon: $('#usageBannerIcon'),
  usageBannerTitle: $('#usageBannerTitle'),
  usageBannerText: $('#usageBannerText'),
  usageBannerClose: $('#usageBannerClose'),
  providerPills: $('#providerPills'),
  themeBtn: $('#themeBtn'),
  exportBtn: $('#exportBtn'),
  sessionId: $('#sessionId'),
  sessionIdText: $('#sessionIdText'),
  // Optional passcode gate (server sets ACCESS_CODE).
  accessGate: $('#accessGate'),
  accessGateForm: $('#accessGateForm'),
  accessGateInput: $('#accessGateInput'),
  accessGateError: $('#accessGateError'),
  accessGateSubmit: $('#accessGateSubmit')
};

const viewFlags = readModeFlags();

const state = {
  sessionId: `fb-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
  health: null,
  categories: [],
  groups: FALLBACK_GROUPS,
  sentences: [],
  scenarios: [], // alias kept for the assessment pipeline
  scenarioId: null,
  // Three-tier picker: medium -> category -> sentence.
  medium: 'all',
  categoryId: 'all',
  vowelLexiconSize: 0,
  mode: viewFlags.mode,
  // Demo default: scripted practice against the model sentence.
  scripted: viewFlags.scripted,
  vowelFocus: viewFlags.vowels,
  showTranslation: false,
  engine: 'browser',
  voice: 'en-US-JennyNeural',
  history: [],
  turns: [],
  assess: null,
  chat: null,
  lastRecMeta: null,
  lastTts: null,
  timings: { rec: null, azure: null, llm: null, tts: null, total: null, llmRoundTrip: null },
  busy: false,
  limitHandled: false,
  accessGateOpen: false,
  session: null,
  usageStopped: false,
  usageStop: null
};

let recorder = null;

/* --------------------------------- boot ---------------------------------- */

async function init() {
  initTheme();
  initTooltips();
  wireEvents();
  dom.sessionIdText.textContent = `session ${state.sessionId}`;
  dom.scriptedToggle.checked = state.scripted;
  dom.vowelToggle.checked = state.vowelFocus;
  applyMode(state.mode, { syncUrl: false });
  renderKpis();

  // Optional passcode gate: resolves immediately when ACCESS_CODE is unset.
  await ensureAccess();

  const [health, scenarios] = await Promise.allSettled([getHealth({ usage: true }), getScenarios()]);

  if (health.status === 'fulfilled' && health.value) {
    state.health = health.value;
    renderProviders();
    renderModeBanner();
    // A reload after the daily quota was reached restores the banner + mic lock.
    const quota = health.value.usage && health.value.usage.student;
    if (quota && quota.allowed === false) {
      stopPracticeForToday({ error: 'user_limit_reached', limit: quota.limit, used: quota.used });
    }
    // Prefer Azure Neural TTS for the model sentence; speak() falls back to the
    // browser voice automatically when it is unavailable.
    state.engine = health.value.providers.tts.azure_available ? 'azure' : 'browser';
    dom.engineSelect.value = state.engine;
  } else {
    toast('Cannot reach the API. Start the server with `npm start`.', 'error', 7000);
  }
  renderVoiceOptions();

  if (scenarios.status === 'fulfilled' && scenarios.value && Array.isArray(scenarios.value.scenarios)) {
    applyLibrary(scenarios.value);
  } else {
    applyLibrary({
      categories: fallbackCategories(),
      groups: FALLBACK_GROUPS,
      scenarios: FALLBACK_SENTENCES,
      default: FALLBACK_SENTENCES[0].id
    });
  }

  recorder = new MicrophoneRecorder({
    targetRate: 16000,
    maxMs: 30000,
    onTick: handleRecTick,
    onLimit: handleRecLimit
  });

  updateMicAvailability();
  warmUpVoices();
  renderTab('scores');
  renderModelSentence();
}

/* ------------------------------ access gate ------------------------------ *
 * Only active when the server sets ACCESS_CODE. The code itself is never kept
 * in the page longer than the unlock request: the server replies with an
 * HttpOnly cookie, and api.js keeps a tab-scoped header fallback.
 * ------------------------------------------------------------------------- */

let accessGateResolver = null;

/** Resolves once the lab is reachable (no passcode, or a successful unlock). */
async function ensureAccess() {
  let session = null;
  try {
    session = await getSession();
  } catch (err) {
    // Older server / offline: let the normal boot path report the failure.
    return true;
  }
  state.session = session;
  if (!session.access_code_required || session.authenticated) return true;
  return openAccessGate({ reason: 'required' });
}

function openAccessGate({ reason = 'required' } = {}) {
  state.accessGateOpen = true;
  dom.accessGate.classList.remove('hidden');
  dom.accessGateError.classList.add('hidden');
  dom.accessGateError.textContent = '';
  dom.accessGateInput.value = '';
  dom.accessGateSubmit.disabled = false;
  const subtitle = dom.accessGate.querySelector('.access-gate-sub');
  if (subtitle) {
    subtitle.textContent = reason === 'expired'
      ? 'Your access session expired. Enter the code again to keep practising.'
      : 'This FluencyBridge deployment is limited to invited participants. Enter the access code your instructor shared with you.';
  }
  window.setTimeout(() => dom.accessGateInput.focus(), 40);
  return new Promise((resolve) => { accessGateResolver = resolve; });
}

function closeAccessGate() {
  state.accessGateOpen = false;
  dom.accessGate.classList.add('hidden');
  dom.accessGateInput.value = '';
  const resolve = accessGateResolver;
  accessGateResolver = null;
  if (resolve) resolve(true);
}

async function submitAccessCode(event) {
  event.preventDefault();
  const code = String(dom.accessGateInput.value || '').trim();
  if (!code) return;
  dom.accessGateSubmit.disabled = true;
  dom.accessGateError.classList.add('hidden');
  try {
    await unlockSession(code);
    toast('Unlocked. Welcome to the lab.', 'ok', 2400);
    closeAccessGate();
  } catch (err) {
    dom.accessGateError.textContent = err.status === 429
      ? 'Too many attempts. Wait a few minutes and try again.'
      : (err.message || 'That access code is not correct.');
    dom.accessGateError.classList.remove('hidden');
    dom.accessGateInput.select();
  } finally {
    dom.accessGateSubmit.disabled = false;
  }
}

/* --------------------------- daily usage quota --------------------------- *
 * The server counts a student's daily practice calls and the site-wide Azure
 * budget. Both limits arrive as 429/503 payloads which api.js re-broadcasts as
 * `fb:usage-limit`, so every call site (assess, chat, tts) is covered.
 * ------------------------------------------------------------------------- */

function usageMessage(detail) {
  if (detail && detail.message) return detail.message;
  if (detail && detail.error === 'daily_budget_exhausted') {
    return 'Daily lab practice limit reached for today. System paused until tomorrow.';
  }
  const limit = detail && Number(detail.limit) > 0 ? Number(detail.limit) : 60;
  return `You have completed your ${limit} practice attempts for today! Great work. Please review your scores and practice notes.`;
}

function stopPracticeForToday(detail = {}) {
  const budget = detail.error === 'daily_budget_exhausted';
  state.usageStopped = true;
  state.usageStop = detail;

  dom.usageBannerIcon.textContent = budget ? '⏳' : '🎉';
  dom.usageBannerTitle.textContent = budget ? 'Lab paused for today' : 'Daily practice complete';
  const resets = detail.resets_at ? new Date(detail.resets_at) : null;
  const resetNote = resets && !Number.isNaN(resets.getTime())
    ? ` Practice reopens ${resets.toLocaleString()}.`
    : ' Practice reopens tomorrow.';
  dom.usageBannerText.textContent = usageMessage(detail) + resetNote;
  dom.usageBanner.classList.remove('hidden');

  // Stop the current take and disable the mic; scores stay on screen.
  if (recorder && recorder.isRecording) recorder.cancel();
  stopSpeaking();
  dom.micBtn.disabled = true;
  dom.micBtn.title = budget
    ? 'Daily lab limit reached — practice resumes tomorrow (UTC).'
    : 'Daily practice complete — come back tomorrow (UTC).';
  dom.micStatus.textContent = budget ? 'Paused until tomorrow' : 'Practice complete for today';
  toast(usageMessage(detail), budget ? 'warn' : 'ok', 6000);
}

function currentScenario() {
  return state.scenarios.find((item) => item.id === state.scenarioId) || state.scenarios[0] || FALLBACK_SENTENCES[0];
}

/* -------------------------------- themes --------------------------------- */

function initTheme() {
  const stored = window.localStorage.getItem('fb-theme');
  const prefersLight = window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches;
  applyTheme(stored || (prefersLight ? 'light' : 'dark'));
}

function applyTheme(theme) {
  document.documentElement.classList.toggle('dark', theme === 'dark');
  try { window.localStorage.setItem('fb-theme', theme); } catch (err) { /* ignore */ }
}

/* ------------------------------- providers ------------------------------- */

function setPill(provider, mode, label) {
  const pill = dom.providerPills.querySelector(`[data-provider="${provider}"]`);
  if (!pill) return;
  pill.className = `pill pill-${mode}`;
  pill.innerHTML = `<i></i>${escapeHtml(label)}`;
}

function renderProviders() {
  const h = state.health;
  if (!h || !h.providers) return;
  const { azure, deepseek, tts } = h.providers;
  setPill('azure', azure.live ? 'live' : 'mock', `Azure · ${azure.live ? 'live' : 'mock'}`);
  setPill('deepseek', deepseek.live ? 'live' : 'mock', `DeepSeek · ${deepseek.live ? 'live' : 'mock'}`);
  setPill('tts', tts.azure_available ? 'live' : 'off', `TTS · ${tts.azure_available ? 'Azure' : 'browser'}`);

  dom.providerPills.querySelector('[data-provider="azure"]').title =
    `Pronunciation assessment: ${azure.live ? 'Azure live' : 'MOCK'} · region ${azure.region || 'n/a'} · ${azure.language}`;
  dom.providerPills.querySelector('[data-provider="deepseek"]').title =
    `Model: ${deepseek.model} · temperature ${deepseek.temperature} · ${deepseek.live ? 'live' : 'MOCK'}`;
  dom.providerPills.querySelector('[data-provider="tts"]').title = tts.azure_available
    ? `Azure Neural voice: ${tts.voice} · browser rate ${tts.browser_rate}`
    : `Browser speechSynthesis at rate ${tts.browser_rate} (add AZURE_SPEECH_KEY for neural TTS)`;
}

function renderModeBanner() {
  const h = state.health;
  if (!h || !h.providers) return;
  const mocks = [];
  const missingKeys = [];
  if (!h.providers.azure.live) {
    mocks.push('Azure Pronunciation Assessment');
    missingKeys.push('AZURE_SPEECH_KEY');
  }
  if (!h.providers.deepseek.live) {
    mocks.push('DeepSeek recast');
    missingKeys.push('DEEPSEEK_API_KEY');
  }
  if (!mocks.length) {
    dom.modeBanner.classList.add('hidden');
    return;
  }
  dom.modeBanner.classList.remove('hidden');
  clear(dom.modeBanner);
  dom.modeBanner.append(
    el('strong', { text: 'MOCK DATA:' }),
    el('span', { text: `${mocks.join(' + ')} simulated. Add the missing key(s) to .env and restart for live research data.` }),
    el('code', { text: missingKeys.join(' / ') })
  );
}

/* ------------------------- practice library (UI) ------------------------- */

function applyLibrary(payload) {
  const sentences = Array.isArray(payload.scenarios) ? payload.scenarios
    : (Array.isArray(payload.sentences) ? payload.sentences : FALLBACK_SENTENCES);
  state.sentences = sentences;
  state.scenarios = sentences;
  state.categories = Array.isArray(payload.categories) && payload.categories.length
    ? payload.categories
    : fallbackCategories();
  // Group metadata is kept for provenance/export; the three-tier picker derives
  // its Level-2 groups from `category.group` (see public/js/library.js).
  state.groups = Array.isArray(payload.groups) && payload.groups.length ? payload.groups : FALLBACK_GROUPS;
  // Lexical vowel table (Houston -> /juː/, latte -> /ɑː/, ...). Must be installed
  // before the first render so Vowel Practice never guesses from spelling.
  state.vowelLexiconSize = setVowelLexicon(payload.vowels);
  state.medium = 'all';
  state.categoryId = 'all';
  populateCategories();
  populateSentences(payload.default || sentences[0].id);
}

/** Level 1 -> Level 2: keeps the current category when it survives the tier. */
function setMedium(medium) {
  if (!MEDIUM_TIERS.some((tier) => tier.id === medium) || medium === state.medium) return;
  state.medium = medium;
  if (medium === 'all') state.categoryId = 'all';
  normalizeCategorySelection();
  state.chat = null;
  state.history = [];
  populateCategories();
  populateSentences(null);
}

/** Guarantees `state.categoryId` exists in the Level-2 list for the tier. */
function normalizeCategorySelection() {
  const available = categoryIdsForTier(state.medium, state.categories);
  if (state.medium === 'all') {
    if (state.categoryId !== 'all' && !available.includes(state.categoryId)) state.categoryId = 'all';
    return;
  }
  if (state.categoryId === 'all' || !available.includes(state.categoryId)) {
    state.categoryId = defaultCategoryId(state.medium, state.categories);
  }
}

/** Level 2 dropdown: only the categories that belong to the selected medium. */
function populateCategories() {
  normalizeCategorySelection();

  clear(dom.categorySelect);
  if (state.medium === 'all') {
    dom.categorySelect.appendChild(el('option', {
      value: 'all',
      text: categoryOptionText({
        id: 'all', label: 'All categories', sentenceCount: state.sentences.length
      })
    }));
  }
  categoryGroups(state.medium, state.categories).forEach((group) => {
    const optgroup = el('optgroup', { label: group.label });
    group.categories.forEach((category) => {
      // Count only what this tier can actually offer (e.g. Boomers has 4 films).
      const tierCount = sentencesForSelection(state.sentences, {
        tier: state.medium,
        categoryId: category.id
      }).length;
      optgroup.appendChild(el('option', {
        value: category.id,
        text: categoryOptionText(category, tierCount)
      }));
    });
    dom.categorySelect.appendChild(optgroup);
  });
  dom.categorySelect.value = state.categoryId;

  // Reflect the tier in the Level-1 pills (boot, restore, programmatic change).
  dom.mediumPills.forEach((button) => {
    const active = button.dataset.medium === state.medium;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-pressed', String(active));
  });
}

/** Level 3 dropdown: medium AND category must both match. */
function populateSentences(preferredId) {
  const pool = sentencesForSelection(state.sentences, { tier: state.medium, categoryId: state.categoryId });
  clear(dom.sentenceSelect);

  if (!pool.length) {
    dom.sentenceSelect.disabled = true;
    dom.sentenceSelect.appendChild(el('option', { value: '', text: 'No sentences in this filter' }));
    dom.sentenceSelect.value = '';
    return;
  }
  dom.sentenceSelect.disabled = false;

  const addOption = (sentence, parent) => parent.appendChild(el('option', {
    value: sentence.id,
    text: sentenceOptionText(sentence, state.categories)
  }));

  if (state.categoryId === 'all') {
    // "All categories": keep the pool navigable by grouping it per category.
    state.categories.forEach((category) => {
      const items = pool.filter((sentence) => sentence.category === category.id);
      if (!items.length) return;
      const optgroup = el('optgroup', { label: `${category.emoji || ''} ${category.label}`.trim() });
      items.forEach((sentence) => addOption(sentence, optgroup));
      dom.sentenceSelect.appendChild(optgroup);
    });
  } else {
    pool.forEach((sentence) => addOption(sentence, dom.sentenceSelect));
  }

  const wanted = preferredId ? pool.find((sentence) => sentence.id === preferredId) : null;
  const category = state.categories.find((entry) => entry.id === state.categoryId);
  // "Shuffle / Mix Generations" opens on a random line every time it is picked.
  const pick = wanted || (category && category.mix
    ? pool[Math.floor(Math.random() * pool.length)]
    : pool[0]);
  state.scenarioId = pick.id;
  dom.sentenceSelect.value = state.scenarioId;
  renderScenario();
}

function renderScenario() {
  const sentence = currentScenario();
  state.scenarioId = sentence.id;
  // A new target starts with the translation hidden so learners read English first.
  state.showTranslation = false;
  if (dom.sentenceSelect.value !== sentence.id) dom.sentenceSelect.value = sentence.id;

  const category = state.categories.find((entry) => entry.id === sentence.category);
  const medium = sentenceMedium(sentence);
  const mediumMeta = MEDIUM_META[medium] || MEDIUM_META.scenario;
  dom.scenarioGoal.textContent = [
    `${mediumMeta.emoji} ${mediumMeta.label}`,
    sentence.categoryLabel || (category && category.label),
    sentence.focus
  ].filter(Boolean).join(' · ');
  dom.practiceMeta.textContent = sentence.source
    ? `${sentence.categoryLabel} · ${sentence.source}`
    : `${sentence.emoji || ''} ${sentence.categoryLabel || ''}`.trim();
  dom.practiceMeta.title = sentence.groupLabel || '';

  renderModelSentence();
  if (!state.chat) renderChips(sentence.starters || []);
}

const SCORING_MODE_COPY = {
  scripted: {
    title: '🎯 SCRIPTED ALIGNMENT ACTIVE',
    sub: 'Acoustic Reference Alignment (<code>referenceText</code> bound). '
      + 'Azure evaluates exact phoneme accuracy, omissions, and insertions against ground truth.'
  },
  open: {
    title: '🎙️ OPEN ASR ACTIVE',
    sub: 'Automated Speech Recognition (<code>referenceText: ""</code> open decoder). '
      + 'Azure decodes speech to text first, then grades recognized words.'
  }
};

/**
 * The model sentence card doubles as the scoring-mode explainer: scripted mode
 * shows a target to read aloud; unscripted mode shows an optional prompt.
 */
function renderModelSentence() {
  const sentence = currentScenario();
  const reference = (sentence.referenceText || sentence.text || '').trim();

  dom.scriptedToggle.disabled = !reference;
  dom.modelSentenceText.classList.toggle('is-empty', !reference);
  dom.modelSentenceText.classList.toggle('is-prompt', Boolean(reference) && !state.scripted);
  dom.modelSentenceCard.classList.toggle('is-off', !state.scripted);
  dom.playModelBtn.disabled = !reference;
  dom.modelCardTitle.textContent = state.scripted
    ? 'Target Sentence to Read Aloud'
    : 'Free Speech / Open Topic Practice';
  dom.modelCardIcon.textContent = state.scripted ? '🎯' : '🎙️';
  dom.modelCardHint.textContent = state.scripted
    ? 'Read this exact sentence aloud. The system will grade your pronunciation directly against it.'
    : 'Speak freely in your own words. The system will transcribe what you say and assess your natural speech.';
  dom.modelSentenceHint.textContent = !reference
    ? 'no target'
    : (state.scripted ? 'scripted target' : 'optional prompt');
  dom.vowelToggle.checked = state.vowelFocus;
  dom.vowelToggle.disabled = !reference;
  dom.vowelHint.classList.toggle('hidden', !(state.vowelFocus && reference));

  if (!reference) {
    clear(dom.modelSentenceText);
    dom.modelSentenceText.textContent = 'No target sentence for this selection.';
  } else if (state.vowelFocus) {
    renderVowelSentence(reference);
  } else {
    clear(dom.modelSentenceText);
    dom.modelSentenceText.textContent = reference;
  }

  updateModelTtsNote();
  applyTranslation();
  renderScoringMode();
}

/**
 * Inspector badge: states which Azure scoring path the next turn will use.
 * Scripted -> referenceText bound (miscue/omission aware); open -> "" decoder.
 */
function renderScoringMode() {
  if (!dom.scoringModeBadge) return;
  const copy = state.scripted ? SCORING_MODE_COPY.scripted : SCORING_MODE_COPY.open;
  dom.scoringModeBadge.classList.toggle('is-scripted', state.scripted);
  dom.scoringModeBadge.classList.toggle('is-open', !state.scripted);
  dom.scoringModeBadge.dataset.mode = state.scripted ? 'scripted' : 'open';
  dom.scoringModeBadge.title = state.scripted
    ? 'referenceText is sent with the audio: Azure aligns phonemes to the known sentence.'
    : 'referenceText is empty: Azure runs an open decoder, then grades the recognised words.';
  dom.scoringModeTitle.textContent = copy.title;
  // Static copy only (no user data): the <code> span keeps the payload names mono.
  dom.scoringModeSub.innerHTML = copy.sub;
}

/**
 * Shows/hides the static Japanese translation beneath the English sentence.
 * Hidden by default (and reset whenever a new target is selected).
 */
function applyTranslation() {
  const japanese = (currentScenario().ja || '').trim();
  const visible = Boolean(japanese) && state.showTranslation;

  dom.translateBtn.disabled = !japanese;
  dom.translateBtn.setAttribute('aria-pressed', String(visible));
  dom.translateBtn.classList.toggle('is-active', visible);
  dom.modelTranslation.textContent = japanese;
  dom.modelTranslation.classList.toggle('hidden', !visible);
}

function renderVowelSentence(text) {
  const sentence = currentScenario();
  // `wordVowels` carries the lexical alignment for this specific target
  // (Houston -> /juː/), so homographs stay correct per sentence.
  const words = sentence && sentence.wordVowels ? sentence.wordVowels : undefined;
  clear(dom.modelSentenceText);
  annotateSentence(text, { words }).forEach((token) => {
    if (token.type !== 'word' || !token.vowels.length) {
      dom.modelSentenceText.appendChild(document.createTextNode(token.text));
      return;
    }
    let cursor = 0;
    token.vowels.forEach((vowel) => {
      if (vowel.start > cursor) {
        dom.modelSentenceText.appendChild(document.createTextNode(token.text.slice(cursor, vowel.start)));
      }
      const grapheme = token.text.slice(vowel.start, vowel.end);
      dom.modelSentenceText.appendChild(el('button', {
        class: 'vowel-btn',
        type: 'button',
        'data-tip': `${grapheme} \u2192 /${vowel.ipa}/ in \u201c${vowel.word}\u201d \u00b7 tap to hear`,
        'aria-label': `Hear the vowel /${vowel.ipa}/ in ${vowel.word}`,
        onclick: (event) => playVowel(vowel, grapheme, event.currentTarget)
      }, grapheme));
      cursor = vowel.end;
    });
    if (cursor < token.text.length) {
      dom.modelSentenceText.appendChild(document.createTextNode(token.text.slice(cursor)));
    }
  });
}

function updateModelTtsNote() {
  const tts = state.health && state.health.providers ? state.health.providers.tts : null;
  const azure = state.engine === 'azure' && tts && tts.azure_available;
  const option = dom.voiceSelect.selectedOptions && dom.voiceSelect.selectedOptions[0];
  const label = option ? option.textContent.split('\u00b7')[0].trim() : state.voice;
  dom.modelNote.textContent = azure
    ? `Azure \u00b7 ${label} \u00b7 ${SPEECH_RATE}\u00d7`
    : `Browser voice \u00b7 ${SPEECH_RATE}\u00d7`;
}

function renderVoiceOptions() {
  const tts = state.health && state.health.providers ? state.health.providers.tts : null;
  const voices = (tts && Array.isArray(tts.voices) && tts.voices.length)
    ? tts.voices
    : [
      { id: 'en-US-JennyNeural', label: 'Jenny \u00b7 female (US)' },
      { id: 'en-US-GuyNeural', label: 'Guy \u00b7 male (US)' }
    ];
  clear(dom.voiceSelect);
  voices.forEach((voice) => {
    dom.voiceSelect.appendChild(el('option', { value: voice.id, text: voice.label }));
  });
  const preferred = voices.find((voice) => voice.id === (tts && tts.voice)) ? tts.voice : voices[0].id;
  state.voice = preferred;
  dom.voiceSelect.value = state.voice;
  dom.voiceSelect.disabled = !(tts && tts.azure_available);
  updateModelTtsNote();
}

/* --------------------------------- view mode ----------------------------- */

function applyMode(mode, { syncUrl = true } = {}) {
  state.mode = mode === 'inspector' ? 'inspector' : 'student';
  document.documentElement.dataset.mode = state.mode;
  dom.modeButtons.forEach((button) => {
    const active = button.dataset.mode === state.mode;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-pressed', String(active));
  });

  // The Bridge / DeepSeek conversation bubble is researcher-only.
  if (state.mode === 'inspector' && state.chat) renderChat(state.chat);
  else dom.aiCard.classList.add('hidden');

  if (dom.brandSub) {
    dom.brandSub.textContent = state.mode === 'student' ? 'Pronunciation Practice' : 'Research Inspector PoC';
  }
  document.title = state.mode === 'student'
    ? 'FluencyBridge | Pronunciation Practice'
    : 'FluencyBridge | Research Inspector';

  if (syncUrl) {
    const url = new URL(window.location.href);
    if (state.mode === 'inspector') url.searchParams.set('mode', 'inspector');
    else url.searchParams.delete('mode');
    window.history.replaceState({}, '', url);
  }
}

function syncVowelUrl() {
  const url = new URL(window.location.href);
  if (state.vowelFocus) url.searchParams.set('vowels', '1');
  else url.searchParams.delete('vowels');
  window.history.replaceState({}, '', url);
}

/* -------------------------------- pipeline ------------------------------- */

async function runPipeline(captured) {
  state.busy = true;
  dom.micBtn.disabled = true;
  state.chat = null;
  showAnalyzing();
  dom.micStatus.textContent = 'Scoring pronunciation with Azure…';
  const scenario = currentScenario();

  const assessStart = performance.now();
  let assess = null;
  try {
    assess = await assessAudio({
      audio: captured.base64,
      scenarioId: scenario.id,
      scripted: state.scripted,
      referenceText: state.scripted ? scenario.referenceText : '',
      language: 'en-US'
    });
  } catch (err) {
    const elapsed = Math.round(performance.now() - assessStart);
    state.timings.azure = elapsed;
    updateKpi('azure', elapsed, 'Azure round-trip (failed)');
    renderAssessError(err);
    state.busy = false;
    dom.micBtn.disabled = false;
    dom.micStatus.textContent = 'Tap the mic and speak English';
    return;
  }

  const assessMs = Math.round(performance.now() - assessStart);
  state.timings.azure = assessMs;
  state.assess = assess;
  state.lastRecMeta = captured;
  updateKpi('azure', assessMs, 'Upload + Azure Pronunciation Assessment round-trip (client-measured)');
  renderAssessment(assess, captured);

  if (!assess.ok) {
    state.busy = false;
    dom.micBtn.disabled = false;
    dom.micStatus.textContent = assess.error === 'unrecognized_speech'
      ? 'Audio detected but not recognised — try again closer to the mic'
      : 'No speech detected — try again';
    recomputeTotal();
    // Keep no-transcript attempts in the research log (NoMatch frequency is
    // itself a signal for L1-interference studies).
    state.turns.push({
      index: state.turns.length + 1,
      at: new Date().toISOString(),
      scenario: scenario.id,
      scripted: state.scripted,
      audio: {
        duration_ms: captured.durationMs,
        record_ms: captured.recordMs,
        encode_ms: captured.encodeMs,
        sample_rate: captured.sampleRate,
        input_sample_rate: captured.inputSampleRate,
        bytes: captured.blob ? captured.blob.size : null,
        peak: captured.peak
      },
      timings: { ...state.timings },
      assess,
      chat: null
    });
    renderTab('scores');
    renderRecastTab();
    renderRawTab();
    return;
  }

  const chatStart = performance.now();
  dom.micStatus.textContent = 'Asking Bridge for an A2 recast…';
  let chat = null;
  try {
    chat = await chatRecast({
      transcript: assess.recognized_text,
      scenarioId: scenario.id,
      history: state.history,
      assessment: assess
    });
  } catch (err) {
    const elapsed = Math.round(performance.now() - chatStart);
    state.timings.llm = elapsed;
    updateKpi('llm', elapsed, 'DeepSeek round-trip (failed)');
    toast(`Pedagogical recast failed: ${err.message}`, 'error', 6000);
  }

  if (chat) {
    const roundTrip = Math.round(performance.now() - chatStart);
    state.timings.llmRoundTrip = roundTrip;
    state.timings.llm = Number.isFinite(Number(chat.ttft_ms)) && chat.ttft_ms !== null
      ? Math.round(Number(chat.ttft_ms))
      : roundTrip;
    updateKpi(
      'llm',
      state.timings.llm,
      `TTFT (server) ${formatMs(chat.ttft_ms)} · full round-trip ${formatMs(roundTrip)} · ${chat.model || 'model'}`
    );
    state.chat = chat;
    renderChat(chat);
    state.history.push(
      { role: 'user', content: assess.recognized_text },
      { role: 'assistant', content: chat.payload.reply }
    );
    if (chat.warning) toast(chat.warning, 'warn', 6500);
  }

  state.turns.push({
    index: state.turns.length + 1,
    at: new Date().toISOString(),
    scenario: scenario.id,
    scripted: state.scripted,
    audio: {
      duration_ms: captured.durationMs,
      record_ms: captured.recordMs,
      encode_ms: captured.encodeMs,
      sample_rate: captured.sampleRate,
      input_sample_rate: captured.inputSampleRate,
      bytes: captured.blob ? captured.blob.size : null,
      peak: captured.peak
    },
    timings: { ...state.timings },
    assess,
    chat
  });

  recomputeTotal();
  renderRecastTab();
  renderRawTab();
  state.busy = false;
  dom.micBtn.disabled = false;
  dom.micStatus.textContent = 'Tap the mic for your next line';
}

/* ----------------------------- student render ---------------------------- */

function renderScoreChips(assess) {
  clear(dom.scoreChips);
  const calibrated = assess.calibrated_accuracy_score === null || assess.calibrated_accuracy_score === undefined
    ? assess.accuracy_score
    : assess.calibrated_accuracy_score;

  const items = [
    {
      label: 'Accuracy',
      value: calibrated,
      title: `Calibrated word mean ${formatScore(calibrated)} (Azure raw ${formatScore(assess.accuracy_score)}). `
        + 'Per word: 0.4·Azure + 0.6·weakest phoneme, −25 for epenthetic insertions / lengthening, '
        + '−15 for a long word-final fricative/affricate, capped at 64 (phoneme < 60) or 78 (phoneme < 85).'
    },
    { label: 'Fluency', value: assess.fluency_score },
    { label: 'Completeness', value: assess.completeness_score },
    { label: 'Pron. score', value: assess.pronunciation_score }
  ];

  items.forEach((item) => {
    const chip = el('div', { class: 'score-chip' }, [
      el('span', { class: 'label', text: item.label }),
      el('span', { class: 'value', dataset: { band: scoreBand(item.value) }, text: formatScore(item.value) })
    ]);
    if (item.title) chip.title = item.title;
    if (item.label === 'Completeness' && assess.completeness_meaningful === false) {
      chip.title = 'Completeness is only meaningful in scripted mode; Azure reports 100 for unscripted speech.';
    }
    dom.scoreChips.appendChild(chip);
  });
}

function wordBadge(word) {
  const band = scoreBand(word.accuracy_score);
  const score = formatScore(word.accuracy_score);
  const failed = Array.isArray(word.failed_phonemes) ? word.failed_phonemes : [];
  const weakest = word.weakest_phoneme || null;
  const minScore = Number(word.min_phoneme_score);

  const lines = [`${word.word} — ${score} / 100 · ${bandLabel(word.accuracy_score)}`];
  if (failed.length) {
    lines.push(`failed ${failed.map((p) => `/${p.phoneme}/: ${formatScore(p.accuracy_score, 0)}`).join(', ')}`);
  // 85 is the server-side phoneme warn tier (SCORING.phonemeWarnThreshold),
  // not the 88 Clear band: it decides whether to surface a weakest phone.
  } else if (weakest && (word.phonemes || []).length > 1 && Number.isFinite(minScore) && minScore < 85) {
    lines.push(`weakest /${weakest.phoneme}/: ${formatScore(minScore, 0)}`);
  }
  if (word.error_type && word.error_type !== 'None') lines.push(`azure miscue: ${word.error_type}`);

  const notes = [];
  const capAt = word.calibration && Number.isFinite(Number(word.calibration.capped_at))
    ? Math.round(Number(word.calibration.capped_at))
    : null;
  const capTier = word.phoneme_cap_tier || (word.calibration && word.calibration.cap_tier) || null;
  if (word.phoneme_cap_binding) notes.push(capAt !== null ? `capped to ${capAt}` : 'phoneme cap');
  else if (word.phoneme_cap_applied) notes.push(capTier === 'warn' ? 'weak phoneme' : 'failed phoneme');
  (word.penalties || []).forEach((penalty) => notes.push(`${penalty.type} ${penalty.points}`));
  const azureScore = Number(word.azure_accuracy_score);
  if (Number.isFinite(azureScore) && Math.abs(azureScore - Number(word.accuracy_score)) >= 1) {
    lines.push(`azure ${formatScore(azureScore)} → calibrated ${formatScore(word.accuracy_score, 0)}${notes.length ? ` (${notes.join(', ')})` : ''}`);
  } else if (notes.length) {
    lines.push(notes.join(', '));
  }

  const phonemeText = (word.phonemes || [])
    .map((phoneme) => `${phoneme.is_weakest ? '!' : ''}${phoneme.phoneme} ${formatScore(phoneme.accuracy_score, 0)}`)
    .join(' · ');
  if (phonemeText) lines.push(`phonemes: ${phonemeText}`);
  lines.push(`at ${formatOffset(word.offset_ms)} · ${word.duration_ms ?? '—'} ms`);

  const adjusted = Boolean(word.phoneme_cap_applied) || (word.penalties || []).length > 0;
  const failedLabel = failed.length
    ? ` Failed phoneme ${failed.map((p) => `/${p.phoneme}/ ${formatScore(p.accuracy_score, 0)}`).join(', ')}.`
    : '';

  return el('button', {
    class: 'word',
    type: 'button',
    dataset: { band, adjusted: String(adjusted) },
    'data-tip': lines.join('\n'),
    title: `Tap to hear \u201c${word.word}\u201d`,
    'aria-label': `Hear \u201c${word.word}\u201d. Score ${score} out of 100, ${bandLabel(word.accuracy_score)}.${failedLabel}`,
    onclick: (event) => playWord(word.word, event.currentTarget)
  }, [
    document.createTextNode(word.word),
    el('sup', { text: Number.isFinite(Number(word.accuracy_score)) ? String(Math.round(word.accuracy_score)) : '—' }),
    el('span', { class: 'word-listen', 'aria-hidden': 'true', html: SPEAKER_ICON_SVG })
  ]);
}

function renderAssessment(assess) {
  dom.emptyState.classList.add('hidden');
  dom.transcriptCard.classList.remove('hidden');
  const isLive = assess.source === 'azure';
  const outcome = assess.ok ? '' : ` · ${assess.error || 'no-speech'}`;
  dom.assessSource.className = `source-tag ${isLive ? 'is-live' : 'is-mock'}`;
  dom.assessSource.textContent = `${assess.source} · ${assess.mode}${outcome}`;
  dom.assessSource.title = isLive
    ? 'Live Azure Pronunciation Assessment (HundredMark, phoneme granularity)'
    : (assess.source === 'silence'
      ? 'Pre-check: the clip was silent, so Azure was not called (no cost)'
      : 'Deterministic mock assessment — no Azure key configured');

  renderScoreChips(assess);
  clear(dom.wordStream);
  dom.noSpeechNote.classList.add('hidden');

  if (!assess.ok) {
    renderNoSpeechNote(assess);
    dom.wordStream.appendChild(el('span', { class: 'mic-status', text: 'Nothing to score in this recording.' }));
    // Do not leave a previous turn's reply looking like the answer to this one.
    dom.aiCard.classList.add('hidden');
    hideStudentPhonemes();
  } else {
    const words = assess.words || [];
    if (words.length) words.forEach((word) => dom.wordStream.appendChild(wordBadge(word)));
    else dom.wordStream.appendChild(el('span', { class: 'mic-status', text: assess.recognized_text || '—' }));
    renderStudentPhonemes(assess);
  }

  renderScoresTab();
}

/* --------------------------- student phoneme view ------------------------ */

/**
 * Student Mode shows the per-word phoneme breakdown directly under the
 * colour-coded transcript (the inspector has its own copy of this data).
 */
function renderStudentPhonemes(assess) {
  const words = assess && assess.ok ? (assess.words || []) : [];
  if (!words.length) {
    hideStudentPhonemes();
    return;
  }
  clear(dom.studentPhonemes);
  words.forEach((word) => dom.studentPhonemes.appendChild(wordCard(word)));
  if (assess.word_scoring) {
    const capped = assess.word_scoring.words_capped || 0;
    dom.studentPhonemeRule.textContent = capped ? `calibrated · ${capped} capped` : 'calibrated';
    dom.studentPhonemeRule.title = assess.word_scoring.rule;
  } else {
    dom.studentPhonemeRule.textContent = 'calibrated';
    dom.studentPhonemeRule.removeAttribute('title');
  }
  dom.studentPhonemesCard.classList.remove('hidden');
}

function hideStudentPhonemes() {
  clear(dom.studentPhonemes);
  dom.studentPhonemesCard.classList.add('hidden');
}

/**
 * Distinguishes "we heard nothing" from "we heard audio but no words"
 * (typical for strong L1 interference) and offers the scripted-mode fallback.
 */
function renderNoSpeechNote(assess) {
  const note = dom.noSpeechNote;
  const unrecognized = assess.error === 'unrecognized_speech';
  clear(note);
  note.className = `no-speech ${unrecognized ? 'is-warn' : ''}`.trim();
  note.setAttribute('role', 'status');
  note.appendChild(el('span', { text: assess.message || 'No speech detected in that recording.' }));

  const scenario = currentScenario();
  if (unrecognized && !state.scripted && scenario.referenceText) {
    note.appendChild(el('button', {
      class: 'mini-btn note-action',
      type: 'button',
      title: 'Score against the scenario target sentence instead',
      onclick: () => {
        state.scripted = true;
        dom.scriptedToggle.checked = true;
        renderModelSentence();
        toast('Scripted scoring enabled — record the model sentence to practise it.', 'ok', 4000);
      }
    }, ['Enable Scripted Scoring']));
  }
  note.classList.remove('hidden');
}

function renderAssessError(err) {
  dom.emptyState.classList.add('hidden');
  dom.transcriptCard.classList.remove('hidden');
  dom.assessSource.className = 'source-tag is-error';
  dom.assessSource.textContent = 'error';
  clear(dom.scoreChips);
  clear(dom.wordStream);
  dom.noSpeechNote.classList.add('hidden');
  dom.wordStream.appendChild(el('div', { class: 'error-box' }, [
    el('span', { class: 'error-title', text: 'Assessment failed' }),
    el('span', { class: 'error-msg', text: err.message }),
    el('span', {
      class: 'error-hint',
      text: err.payload ? JSON.stringify(err.payload).slice(0, 500) : 'Check the server console for details.'
    })
  ]));

  const panel = clear(dom.tabScores);
  panel.appendChild(el('div', { class: 'panel-card' }, [
    el('div', { class: 'error-box' }, [
      el('span', { class: 'error-title', text: `HTTP ${err.status || 'error'}` }),
      el('span', { class: 'error-msg', text: err.message }),
      el('span', {
        class: 'error-hint',
        text: err.payload && err.payload.hint ? err.payload.hint : 'See server logs; verify keys/region or set FORCE_MOCK=true.'
      })
    ])
  ]));
  renderTab('scores');
  toast(`Assessment failed: ${err.message}`, 'error', 7000);
}

/** Marks words in the recast that were not in the student's transcript. */
function recastNodes(recast, transcript) {
  const asCleanSet = (text) => new Set(
    String(text || '')
      .toLowerCase()
      .replace(/[^\p{L}\p{N}'\s-]/gu, ' ')
      .split(/\s+/)
      .filter(Boolean)
  );
  const known = asCleanSet(transcript);
  const nodes = [];
  String(recast || '').split(/(\s+)/).forEach((token) => {
    if (!token) return;
    if (/^\s+$/.test(token)) {
      nodes.push(document.createTextNode(token));
      return;
    }
    const clean = token.toLowerCase().replace(/[^\p{L}\p{N}'-]/gu, '');
    if (clean && !known.has(clean)) nodes.push(el('span', { class: 'fix', text: token }));
    else nodes.push(document.createTextNode(token));
  });
  return nodes;
}

function renderChat(chat) {
  const payload = chat.payload || {};
  // The Bridge bubble belongs to the researcher layout only.
  dom.aiCard.classList.toggle('hidden', state.mode !== 'inspector');

  clear(dom.recastText);
  if (payload.recast) {
    recastNodes(payload.recast, state.assess ? state.assess.recognized_text : '')
      .forEach((node) => dom.recastText.appendChild(node));
  } else {
    dom.recastText.textContent = '—';
  }

  dom.aiReply.textContent = payload.reply || '—';
  renderChips(payload.chips || []);

  const check = chat.constraint_check || {};
  const sourceLabel = chat.source === 'live'
    ? 'DeepSeek live'
    : (chat.source === 'fallback' ? 'template fallback' : 'mock recast');
  const bits = [
    sourceLabel,
    chat.ttft_ms === null || chat.ttft_ms === undefined ? null : `TTFT ${formatMs(chat.ttft_ms)}`,
    `${check.reply_word_count ?? '—'} words`,
    `${check.question_count ?? '—'} question`,
    check.passes_all ? 'A2 constraints ✓' : 'A2 constraints !'
  ].filter(Boolean);
  dom.aiFootnote.textContent = bits.join(' · ');
  dom.playReplyBtn.disabled = false;
}

function chipIcon() {
  return el('span', { html: SPEAKER_ICON_SVG });
}

function renderChips(texts) {
  clear(dom.chipRow);
  const list = (Array.isArray(texts) ? texts : []).slice(0, 3);
  if (!list.length) {
    dom.chipRow.appendChild(el('span', { class: 'mic-status', text: 'Record a turn to get suggested answers.' }));
    return;
  }
  list.forEach((text, index) => {
    const button = el('button', {
      class: 'chip-btn',
      type: 'button',
      title: `Play this answer at rate ${SPEECH_RATE}`,
      onclick: () => onChipClick(text, button)
    }, [
      el('span', { class: 'chip-num', text: String(index + 1) }),
      chipIcon(),
      el('span', { text })
    ]);
    dom.chipRow.appendChild(button);
  });
}

async function onChipClick(text, button) {
  button.disabled = true;
  dom.micStatus.textContent = `Try saying: “${text}”`;
  try {
    const result = await speak(text, { engine: state.engine, rate: SPEECH_RATE, voice: state.voice });
    applyTtsResult(text, result, { kind: 'chip' });
    toast(`Speaking: “${text}”`, 'ok', 2600);
    if (result.warning) toast(result.warning, 'warn', 5500);
  } catch (err) {
    toast(`Playback failed: ${err.message}`, 'error', 6000);
  } finally {
    button.disabled = false;
  }
}

async function playText(text, button) {
  const content = String(text || '').trim();
  if (!content) {
    toast('There is nothing to play yet.', 'warn', 2600);
    return;
  }
  const target = button || dom.playReplyBtn;
  target.disabled = true;
  try {
    const result = await speak(content, { engine: state.engine, rate: SPEECH_RATE, voice: state.voice });
    applyTtsResult(content, result, { kind: 'reply' });
    if (result.warning) toast(result.warning, 'warn', 5500);
  } catch (err) {
    toast(`Playback failed: ${err.message}`, 'error', 6000);
  } finally {
    target.disabled = false;
  }
}

/**
 * "Listen to Model": speaks the scripted sentence at 0.85× with Azure Neural
 * TTS when configured, falling back to the browser voice inside speak().
 */
async function playModelSentence() {
  const content = (currentScenario().referenceText || '').trim();
  if (!content) {
    toast('This scenario has no model sentence.', 'warn', 2800);
    return;
  }
  const button = dom.playModelBtn;
  const label = button.querySelector('span');
  const original = label ? label.textContent : 'Listen to Model';
  button.disabled = true;
  if (label) label.textContent = 'Playing…';
  try {
    const result = await speak(content, { engine: state.engine, rate: SPEECH_RATE, voice: state.voice });
    applyTtsResult(content, result, { kind: 'model' });
    if (result.warning) toast(result.warning, 'warn', 5500);
  } catch (err) {
    toast(`Could not play the model sentence: ${err.message}`, 'error', 6500);
  } finally {
    button.disabled = false;
    if (label) label.textContent = original;
  }
}

/* ----------------------------- inspector render -------------------------- */

function emptyPanel(icon, text) {
  return el('div', { class: 'empty-state small' }, [
    el('div', { class: 'empty-icon', text: icon }),
    el('p', { text })
  ]);
}

function meterRow(label, value) {
  const band = scoreBand(value);
  const width = Math.max(2, Math.min(100, Number(value) || 0));
  return el('div', { class: 'meter' }, [
    el('span', { class: 'meter-label', text: label }),
    el('div', { class: 'meter-track' }, [
      el('div', { class: 'meter-fill', dataset: { band }, style: `width:${width}%` })
    ]),
    el('span', { class: 'meter-value', dataset: { band }, text: formatScore(value) })
  ]);
}

function wordCard(word) {
  const band = scoreBand(word.accuracy_score);
  const phonemes = (word.phonemes || []).map((phoneme) => el('button', {
    class: `phoneme${phoneme.is_weakest ? ' is-weakest' : ''}`,
    type: 'button',
    dataset: { band: scoreBand(phoneme.accuracy_score) },
    title: `Hear /${phoneme.phoneme}/ · ${phoneme.is_failed ? 'failed phoneme' : 'phoneme'} `
      + `${formatScore(phoneme.accuracy_score)} · ${phoneme.duration_ms} ms`
      + `${phoneme.is_weakest ? ' · weakest in word' : ''}`,
    'aria-label': `Hear the phoneme /${phoneme.phoneme}/`,
    onclick: (event) => playPhoneme(phoneme.phoneme, { element: event.currentTarget })
  }, [
    phoneme.is_weakest
      ? el('span', { class: 'phoneme-mark', text: '!', title: 'weakest phoneme in this word' })
      : null,
    el('span', { text: phoneme.phoneme }),
    el('b', { text: formatScore(phoneme.accuracy_score, 0) })
  ]));

  const capAt = word.calibration && Number.isFinite(Number(word.calibration.capped_at))
    ? Math.round(Number(word.calibration.capped_at))
    : null;
  const capTier = word.phoneme_cap_tier || (word.calibration && word.calibration.cap_tier) || null;
  const capReason = capTier === 'warn' ? 'A phoneme scored below 85' : 'A phoneme scored below 60';

  const flags = [
    word.error_type && word.error_type !== 'None'
      ? el('span', { class: 'error-flag', text: word.error_type })
      : null,
    word.phoneme_cap_binding
      ? el('span', {
        class: 'error-flag',
        title: `${capReason} and the composite was above ${capAt}, so the word is capped at ${capAt} (never clear).`,
        text: capAt !== null ? `cap ${capAt}` : 'capped'
      })
      : (word.phoneme_cap_applied
        ? el('span', {
          class: 'error-flag',
          title: `${capReason}. The word is already below the ${capAt} cap, so the cap did not change it.`,
          text: capTier === 'warn' ? 'phoneme < 85' : 'phoneme < 60'
        })
        : null),
    ...(word.penalties || []).map((penalty) => el('span', {
      class: 'error-flag',
      title: penalty.note,
      text: `${penalty.type} ${penalty.points}`
    }))
  ].filter(Boolean);

  const notes = [
    Number.isFinite(Number(word.azure_accuracy_score)) ? `azure ${formatScore(word.azure_accuracy_score)}` : null,
    Number.isFinite(Number(word.min_phoneme_score)) && word.weakest_phoneme
      ? `min /${word.weakest_phoneme.phoneme}/ ${formatScore(word.min_phoneme_score, 0)}`
      : null,
    word.calibration && Number.isFinite(Number(word.calibration.composite))
      ? `composite ${formatScore(word.calibration.composite, 0)}`
      : null,
    `${word.offset_ms ?? '—'} ms`
  ].filter(Boolean);

  return el('div', { class: 'word-card', dataset: { band } }, [
    el('div', { class: 'word-card-top' }, [
      el('div', { class: 'word-card-word-wrap' }, [
        el('button', {
          class: 'word-card-word',
          type: 'button',
          title: `Hear \u201c${word.word}\u201d`,
          'aria-label': `Hear \u201c${word.word}\u201d`,
          onclick: (event) => playWord(word.word, event.currentTarget)
        }, [
          document.createTextNode(word.word),
          el('span', { class: 'word-card-speaker', 'aria-hidden': 'true', html: SPEAKER_ICON_SVG })
        ]),
        flags.length ? el('span', { class: 'word-card-flags' }, flags) : null
      ]),
      el('span', { class: 'word-card-score', dataset: { band }, text: formatScore(word.accuracy_score) })
    ]),
    phonemes.length
      ? el('div', { class: 'phoneme-row' }, phonemes)
      : el('span', { class: 'time-flag', text: 'no phoneme data' }),
    el('div', { class: 'word-card-notes' }, notes.map((note) => el('span', { text: note })))
  ]);
}

function renderScoresTab() {
  const panel = clear(dom.tabScores);
  const assess = state.assess;

  if (!assess) {
    panel.appendChild(emptyPanel('📊', 'Record a turn to see Azure HundredMark scores, per-word accuracy and phoneme GOP.'));
    return;
  }

  const headChips = [
    chipTag(assess.mode, ''),
    chipTag(assess.source === 'azure' ? 'azure live' : 'mock', assess.source === 'azure' ? 'good' : 'warn'),
    chipTag(`${assess.audio_duration_ms ?? '—'} ms`, ''),
    assess.audio_format ? chipTag(assess.audio_format, '') : null,
    Number.isFinite(Number(assess.audio_peak)) ? chipTag(`peak ${assess.audio_peak}`, '') : null,
    Number.isFinite(Number(assess.audio_rms)) ? chipTag(`rms ${assess.audio_rms}`, '') : null,
    assess.prosody_score === null || assess.prosody_score === undefined ? null : chipTag('prosody', '')
  ].filter(Boolean);

  if (assess.bias && assess.bias.phrase_list_applied) {
    const phraseChip = chipTag(`${assess.bias.phrase_list_count} phrase bias`, 'good');
    phraseChip.title = `PhraseListGrammar: ${(assess.bias.phrase_list || []).slice(0, 12).join(', ')} …`;
    headChips.push(phraseChip);
  }

  if (!assess.ok) {
    panel.appendChild(el('div', { class: 'panel-card' }, [
      el('div', { class: 'panel-head' }, [
        el('span', { class: 'panel-title', text: 'Recognition outcome' }),
        el('div', { class: 'panel-actions' }, [
          chipTag(assess.error || 'no_speech', assess.error === 'unrecognized_speech' ? 'warn' : 'bad')
        ])
      ]),
      el('p', { style: 'font-size:12px;color:var(--text-2)', text: assess.message || '' }),
      el('dl', { class: 'recap-list', style: 'margin-top:8px' }, [
        recapRow('Recognizer reason', assess.recognizer_reason),
        recapRow('NoMatch reason', assess.no_match_reason),
        recapRow('Audio present', assess.audio_present ? 'yes' : 'no'),
        recapRow('Peak / RMS', `${assess.audio_peak ?? '—'} / ${assess.audio_rms ?? '—'}`),
        recapRow('Duration', `${assess.audio_duration_ms ?? '—'} ms`)
      ])
    ]));
  }

  const meters = el('div', { style: 'margin-top:4px' });
  [
    ['Accuracy (Azure)', assess.accuracy_score],
    ['Accuracy (calibrated)', assess.calibrated_accuracy_score],
    ['Fluency', assess.fluency_score],
    ['Completeness', assess.completeness_score],
    ['Pron. score', assess.pronunciation_score],
    ['Prosody', assess.prosody_score]
  ].forEach(([label, value]) => {
    if (value !== null && value !== undefined) meters.appendChild(meterRow(label, value));
  });

  const calibrationNote = assess.word_scoring
    ? `word calibration: ${assess.word_scoring.words_capped} capped · `
      + `${assess.word_scoring.words_penalised} penalised · `
      + `azure mean ${formatScore(assess.word_scoring.mean_azure_accuracy)} → calibrated ${formatScore(assess.word_scoring.mean_calibrated_accuracy)}`
    : null;

  panel.appendChild(el('div', { class: 'panel-card' }, [
    el('div', { class: 'panel-head' }, [
      el('span', { class: 'panel-title', text: 'Azure overall' }),
      el('div', { class: 'panel-actions' }, headChips)
    ]),
    meters,
    assess.recognized_text
      ? el('p', { class: 'recap-quote', style: 'margin-top:9px;font-size:12px', text: `"${assess.recognized_text}"` })
      : null,
    assess.completeness_meaningful === false
      ? el('p', { class: 'time-flag', style: 'margin-top:6px', text: 'completeness = 100 by convention in unscripted mode' })
      : null,
    calibrationNote ? el('p', { class: 'time-flag', style: 'margin-top:6px', text: calibrationNote }) : null
  ]));

  if (assess.words && assess.words.length) {
    const wordsHead = [chipTag('HundredMark', ''), chipTag('phoneme granularity', '')];
    if (assess.word_scoring) {
      const calibChip = chipTag('calibrated', 'good');
      calibChip.title = `${assess.word_scoring.rule} · capped ${assess.word_scoring.words_capped}/${assess.word_scoring.words}`;
      wordsHead.push(calibChip);
    }
    panel.appendChild(el('div', { class: 'panel-card' }, [
      el('div', { class: 'panel-head' }, [
        el('span', { class: 'panel-title', text: `Words & phonemes (${assess.words.length})` }),
        el('div', { class: 'panel-actions' }, wordsHead)
      ]),
      assess.word_scoring
        ? el('p', { class: 'time-flag', style: 'margin-bottom:8px', text: assess.word_scoring.rule })
        : null,
      el('div', { class: 'word-grid' }, assess.words.map(wordCard))
    ]));
  }

  if (assess.bias) {
    panel.appendChild(payloadDetails(
      'Contextual bias · PhraseListGrammar',
      `${assess.bias.phrase_list_count} phrases${assess.bias.scenario ? ` · ${assess.bias.scenario}` : ''}`,
      jsonTree(assess.bias),
      false
    ));
  }

  const rawHead = assess.raw && assess.raw.NBest && assess.raw.NBest[0]
    ? 'Azure raw · NBest[0]'
    : 'Azure raw payload';
  const rawValue = assess.raw && assess.raw.NBest && assess.raw.NBest[0] ? assess.raw.NBest[0] : (assess.raw || {});
  panel.appendChild(payloadDetails(rawHead, `${JSON.stringify(rawValue).length} chars`, jsonTree(rawValue), false));
  panel.appendChild(jsonBlock('Azure full JSON result', assess.raw || {}, { copyLabel: 'Copy' }));
}

function playVowel(vowel, grapheme, element) {
  // `word` is the SSML inner text, so Azure synthesises
  // `<phoneme alphabet="ipa" ph="juː">Houston</phoneme>` - the vowel of *that*
  // word, not a bare grapheme read out of context.
  return playPhoneme(vowel.ipa, { grapheme, word: vowel.word, element });
}

/** Speaks a single word at 0.85x so the learner can compare their production. */
async function playWord(word, element) {
  const text = String(word || '').trim();
  if (!text) return;
  if (element) element.classList.add('is-playing');
  try {
    const result = await speak(text, { engine: state.engine, rate: SPEECH_RATE, voice: state.voice });
    applyTtsResult(text, result, { kind: 'word' });
    if (result.warning) toast(result.warning, 'warn', 4500);
  } catch (err) {
    toast(`Could not play \u201c${text}\u201d: ${err.message}`, 'error', 5000);
  } finally {
    if (element) element.classList.remove('is-playing');
  }
}

/** Plays an isolated IPA phone (vowel practice or a phoneme chip). */
async function playPhoneme(phoneme, { grapheme, word, element } = {}) {
  const phone = String(phoneme || '').trim();
  if (!phone) return;
  if (element) element.classList.add('is-playing');
  try {
    const result = await speakPhoneme(phone, {
      engine: state.engine,
      rate: SPEECH_RATE,
      voice: state.voice,
      // The word (when known) becomes the SSML inner text of <phoneme>.
      word: word || '',
      grapheme: grapheme || phone
    });
    applyTtsResult(`/${phone}/`, result, { kind: 'phoneme' });
    if (result.warning) toast(result.warning, 'warn', 4500);
  } catch (err) {
    toast(`Could not play /${phone}/: ${err.message}`, 'error', 5000);
  } finally {
    if (element) element.classList.remove('is-playing');
  }
}

function applyTtsResult(text, result, { kind = 'reply' } = {}) {
  state.timings.tts = result.ttftMs;
  state.lastTts = {
    text,
    kind,
    engine: result.engine,
    voice: result.voice || null,
    phoneme: result.phoneme || null,
    ttft_ms: result.ttftMs,
    total_ms: result.totalMs,
    server_ms: result.serverMs === undefined ? null : result.serverMs,
    fallback_from: result.fallbackFrom || null,
    at: new Date().toISOString()
  };
  updateKpi(
    'tts',
    result.ttftMs,
    `${result.engine} voice ${result.voice || 'default'} · rate ${SPEECH_RATE} · total ${formatMs(result.totalMs)}`
  );
  // Model playback is practice, not part of the turn's reply audio.
  if (kind !== 'model' && state.turns.length) {
    state.turns[state.turns.length - 1].tts = state.lastTts;
    renderRawTab();
  }
}

function constraintItem(name, pass, verdict, warnOnly = false) {
  const node = el('div', {
    class: `constraint ${pass ? 'pass' : (warnOnly ? 'warnbox' : 'fail')}`
  }, [
    el('span', { class: 'name', text: name }),
    el('span', { class: 'verdict', text: verdict })
  ]);
  return node;
}

function errorsTable(errors) {
  if (!errors || !errors.length) {
    return el('p', { class: 'time-flag', text: 'No grammar or lexical errors were flagged for this utterance.' });
  }
  const rows = errors.map((error) => el('tr', {}, [
    el('td', { class: 'said', text: error.student_said || '—' }),
    el('td', { text: error.issue || '—' }),
    el('td', { class: 'fixed', text: error.corrected || '—' }),
    el('td', { class: 'mono', text: error.severity || 'minor' })
  ]));
  return el('div', { class: 'table-wrap' }, [
    el('table', { class: 'data-table' }, [
      el('thead', {}, [el('tr', {}, [
        el('th', { text: 'Student said' }),
        el('th', { text: 'Issue' }),
        el('th', { text: 'Corrected' }),
        el('th', { text: 'Severity' })
      ])]),
      el('tbody', {}, rows)
    ])
  ]);
}

function recapRow(label, value, mono = false) {
  return el('div', { class: 'recap-row' }, [
    el('dt', { text: label }),
    el('dd', { class: mono ? 'mono' : '', text: value === null || value === undefined || value === '' ? '—' : String(value) })
  ]);
}

function renderRecastTab() {
  const panel = clear(dom.tabRecast);
  const chat = state.chat;

  if (!chat) {
    panel.appendChild(emptyPanel('🧠', 'Record a turn to receive the DeepSeek pedagogical recast.'));
    return;
  }

  const payload = chat.payload || {};
  const check = chat.constraint_check || {};
  const chips = [
    chipTag(chat.source === 'live' ? 'deepseek live' : (chat.source === 'fallback' ? 'fallback' : 'mock'),
      chat.source === 'live' ? 'good' : 'warn'),
    chipTag(chat.model || 'model', ''),
    typeof chat.temperature === 'number' ? chipTag(`temp ${chat.temperature}`, '') : null,
    chat.streamed ? chipTag('streamed', '') : chipTag('non-stream', '')
  ].filter(Boolean);

  panel.appendChild(el('div', { class: 'panel-card' }, [
    el('div', { class: 'panel-head' }, [
      el('span', { class: 'panel-title', text: 'Prompt constraint verification' }),
      el('div', { class: 'panel-actions' }, chips)
    ]),
    el('div', { class: 'constraint-grid' }, [
      constraintItem('Reply ≤ 25 words', check.within_word_limit !== false, `${check.reply_word_count ?? '—'} / 25`),
      constraintItem('Exactly 1 question', check.exactly_one_question !== false, `${check.question_count ?? '—'} × ?`),
      constraintItem('Exactly 3 chips', check.chips_ok !== false, `${check.chips_count ?? 0} chips`),
      constraintItem('A2 tenses only', !(check.tense_warnings && check.tense_warnings.length),
        check.tense_warnings && check.tense_warnings.length ? check.tense_warnings.join(', ') : 'clean', true)
    ])
  ]));

  panel.appendChild(el('div', { class: 'panel-card' }, [
    el('div', { class: 'panel-head' }, [el('span', { class: 'panel-title', text: 'Detected errors' })]),
    errorsTable(payload.detected_errors)
  ]));

  panel.appendChild(el('div', { class: 'panel-card' }, [
    el('div', { class: 'panel-head' }, [el('span', { class: 'panel-title', text: 'Recast & reasoning' })]),
    el('dl', { class: 'recap-list' }, [
      recapRow('Recast', payload.recast),
      recapRow('Partner reply', payload.reply),
      recapRow('Reasoning', payload.reasoning),
      recapRow('CEFR note', payload.cefr_note),
      recapRow('Chips', (payload.chips || []).join('  |  ')),
      recapRow('TTFT (server)', formatMs(chat.ttft_ms), true),
      recapRow('Total (server)', formatMs(chat.total_ms), true),
      recapRow('Client round-trip', formatMs(state.timings.llmRoundTrip), true),
      recapRow('Usage', chat.usage
        ? `${chat.usage.prompt_tokens ?? '?'} prompt + ${chat.usage.completion_tokens ?? '?'} completion`
        : 'not reported', true),
      recapRow('Finish reason', chat.finish_reason)
    ])
  ]));

  if (chat.warning || chat.error) {
    panel.appendChild(el('div', { class: 'warn-box', text: chat.warning || chat.error }));
  }

  panel.appendChild(jsonBlock('DeepSeek normalised payload', payload, { copyLabel: 'Copy' }));
  panel.appendChild(payloadDetails(
    'Model output · raw JSON',
    `${chat.raw_content ? chat.raw_content.length : 0} chars`,
    jsonTree(chat.raw_model_json || payload),
    false
  ));
}

/* -------------------------------- raw JSON ------------------------------- */

function preBlock(value) {
  return el('pre', { class: 'json-pre', html: highlightJson(value) });
}

function assessRequestPayload() {
  const meta = state.lastRecMeta;
  return {
    endpoint: 'POST /api/assess',
    scenarioId: state.scenarioId,
    scripted: state.scripted,
    referenceText: state.scripted ? currentScenario().referenceText : '',
    language: 'en-US',
    audio: meta && meta.blob ? `<base64 WAV elided · ${meta.blob.size} bytes>` : '<no audio captured>',
    audio_meta: meta ? {
      duration_ms: meta.durationMs,
      record_ms: meta.recordMs,
      encode_ms: meta.encodeMs,
      sample_rate: meta.sampleRate,
      input_sample_rate: meta.inputSampleRate,
      peak: meta.peak
    } : null
  };
}

function sessionTable() {
  const head = ['#', 'time', 'scenario', 'mode', 'words', 'acc', 'azure', 'ttft', 'tts']
    .map((label) => el('th', { text: label }));
  const rows = state.turns.map((turn) => el('tr', {}, [
    el('td', { class: 'mono', text: String(turn.index) }),
    el('td', { class: 'mono', text: new Date(turn.at).toLocaleTimeString() }),
    el('td', { text: turn.scenario }),
    el('td', { class: 'mono', text: turn.assess ? turn.assess.mode : '—' }),
    el('td', { class: 'mono', text: String(turn.assess && turn.assess.words ? turn.assess.words.length : 0) }),
    el('td', { class: 'mono', text: formatScore(turn.assess ? turn.assess.accuracy_score : null) }),
    el('td', { class: 'mono', text: formatMs(turn.timings ? turn.timings.azure : null) }),
    el('td', { class: 'mono', text: turn.chat ? formatMs(turn.chat.ttft_ms) : '—' }),
    el('td', { class: 'mono', text: turn.tts ? formatMs(turn.tts.ttft_ms) : '—' })
  ]));

  return el('div', { class: 'table-wrap' }, [
    el('table', { class: 'data-table' }, [
      el('thead', {}, [el('tr', {}, head)]),
      el('tbody', {}, rows.length ? rows : [el('tr', {}, [el('td', { colspan: '9', text: 'No completed turns yet.' })])])
    ])
  ]);
}

function renderRawTab() {
  const panel = clear(dom.tabRaw);
  const assess = state.assess;
  const chat = state.chat;

  if (!assess) {
    panel.appendChild(emptyPanel('{ }', 'Record a turn to capture request/response payloads and the latency log.'));
    return;
  }

  panel.appendChild(payloadDetails(
    'Assess · request',
    formatMs(state.timings.azure),
    preBlock(assessRequestPayload()),
    false
  ));

  panel.appendChild(payloadDetails(
    'Assess · response',
    `${JSON.stringify(assess).length} chars`,
    preBlock(assess),
    true
  ));

  if (chat) {
    const lastTurn = state.turns.length ? state.turns[state.turns.length - 1] : null;
    const chatRequest = {
      endpoint: 'POST /api/chat',
      transcript: lastTurn && lastTurn.assess ? lastTurn.assess.recognized_text : '',
      scenarioId: state.scenarioId,
      history_turns: state.history.length,
      response_format: { type: 'json_object' },
      low_score_words: chat.turn ? chat.turn.low_score_words : [],
      messages: chat.request_messages || null
    };
    panel.appendChild(payloadDetails(
      'Chat · request',
      chat.request_messages ? `${chat.request_messages.length} messages` : 'summary',
      preBlock(chatRequest),
      false
    ));
    panel.appendChild(payloadDetails(
      'Chat · response',
      `${JSON.stringify(chat).length} chars`,
      preBlock(chat),
      false
    ));
  }

  panel.appendChild(el('div', { class: 'panel-card' }, [
    el('div', { class: 'panel-head' }, [
      el('span', {
        class: 'panel-title',
        text: `Session log (${state.turns.length} turn${state.turns.length === 1 ? '' : 's'})`
      }),
      el('div', { class: 'panel-actions' }, [
        el('button', { class: 'mini-btn', type: 'button', onclick: exportSession, text: 'Download JSON' })
      ])
    ]),
    sessionTable()
  ]));

  panel.appendChild(el('p', {
    class: 'time-flag',
    text: 'Audio base64 is elided here to keep the DOM light — the exported session JSON keeps every score, payload and timing.'
  }));
}

/* ------------------------------ tabs & reset ----------------------------- */

function renderTab(name) {
  const panels = { scores: dom.tabScores, recast: dom.tabRecast, raw: dom.tabRaw };
  Object.entries(panels).forEach(([key, node]) => {
    if (node) node.classList.toggle('hidden', key !== name);
  });
  dom.tabs.forEach((tab) => {
    const active = tab.dataset.tab === name;
    tab.classList.toggle('is-active', active);
    tab.setAttribute('aria-selected', String(active));
  });
  if (name === 'recast') renderRecastTab();
  if (name === 'raw') renderRawTab();
}

function resetTurn() {
  if (state.busy) {
    toast('Wait for the current turn to finish before resetting.', 'warn', 3000);
    return;
  }
  if (recorder && recorder.isRecording) recorder.cancel();
  stopSpeaking();
  setPlayback(null);
  state.assess = null;
  state.chat = null;
  state.history = [];
  state.lastTts = null;
  state.timings = { rec: null, azure: null, llm: null, tts: null, total: null, llmRoundTrip: null };
  renderKpis();
  dom.transcriptCard.classList.add('hidden');
  dom.aiCard.classList.add('hidden');
  hideStudentPhonemes();
  dom.emptyState.classList.remove('hidden');
  dom.recTimer.textContent = '0.0s';
  dom.micStatus.textContent = 'Tap the mic and speak English';
  dom.turnBadge.textContent = `Turn ${state.turns.length + 1}`;
  clear(dom.tabScores).appendChild(emptyPanel('📊', 'Record a turn to see Azure HundredMark scores, per-word accuracy and phoneme GOP.'));
  clear(dom.tabRecast).appendChild(emptyPanel('🧠', 'Record a turn to receive the DeepSeek pedagogical recast.'));
  clear(dom.tabRaw).appendChild(emptyPanel('{ }', 'Record a turn to capture request/response payloads and the latency log.'));
  renderChips(currentScenario().starters || []);
  toast('Turn cleared — the session log is preserved for export.', 'info', 2800);
}

/* --------------------------------- export -------------------------------- */

function exportSession() {
  const payload = {
    app: 'FluencyBridge Inspector PoC',
    export_version: 1,
    session_id: state.sessionId,
    exported_at: new Date().toISOString(),
    providers: state.health ? state.health.providers : null,
    server_limits: state.health ? state.health.limits : null,
    scenario: state.scenarioId,
    scripted_mode: state.scripted,
    tts_engine: state.engine,
    speech_rate: SPEECH_RATE,
    turns: state.turns,
    last_tts: state.lastTts
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = el('a', { href: url, download: `fluencybridge-${state.sessionId}.json` });
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1200);
  toast(`Session exported (${state.turns.length} turn${state.turns.length === 1 ? '' : 's'}).`, 'ok', 3200);
}

/* ---------------------------------- boot --------------------------------- */

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

function setKpi(key, text) {
  const node = document.querySelector(`[data-kpi="${key}"]`);
  if (!node) return;
  node.textContent = text;
  const card = node.closest('.kpi');
  if (card) {
    card.classList.add('is-filled');
    card.classList.remove('is-pending');
  }
}

function updateKpi(key, ms, tooltip) {
  setKpi(key, formatMs(ms));
  const node = document.querySelector(`[data-kpi="${key}"]`);
  if (node) {
    const card = node.closest('.kpi');
    if (card) card.title = tooltip || '';
  }
  recomputeTotal();
}

function recomputeTotal() {
  const parts = [state.timings.rec, state.timings.azure, state.timings.llm]
    .filter((value) => Number.isFinite(value));
  if (!parts.length) return;
  const total = parts.reduce((sum, value) => sum + value, 0);
  state.timings.total = total;
  setKpi('total', formatMs(total));
  const node = document.querySelector('[data-kpi="total"]');
  if (node) {
    const card = node.closest('.kpi');
    if (card) {
      card.title = `Record ${formatMs(state.timings.rec)} + Azure ${formatMs(state.timings.azure)} + DeepSeek TTFT ${formatMs(state.timings.llm)}`
        + (state.timings.llmRoundTrip ? ` (full LLM round-trip ${formatMs(state.timings.llmRoundTrip)})` : '')
        + ' — TTS latency tracked separately';
    }
  }
}

function renderKpis() {
  ['rec', 'azure', 'llm', 'tts', 'total'].forEach((key) => {
    const node = document.querySelector(`[data-kpi="${key}"]`);
    if (!node) return;
    node.textContent = '—';
    const card = node.closest('.kpi');
    if (card) {
      card.classList.remove('is-filled');
      card.classList.add('is-pending');
    }
  });
}

function showAnalyzing() {
  dom.emptyState.classList.add('hidden');
  dom.transcriptCard.classList.remove('hidden');
  hideStudentPhonemes();
  dom.assessSource.textContent = 'analyzing…';
  dom.assessSource.className = 'source-tag';
  dom.noSpeechNote.classList.add('hidden');
  clear(dom.scoreChips);
  clear(dom.wordStream);
  dom.wordStream.appendChild(el('div', { class: 'skeleton', style: 'width:100%' }, [
    el('div', { class: 'skeleton-line w-80' }),
    el('div', { class: 'skeleton-line w-60' }),
    el('div', { class: 'skeleton-line w-40' })
  ]));
  clear(dom.tabScores).appendChild(el('div', { class: 'panel-card skeleton' }, [
    el('div', { class: 'skeleton-line w-40' }),
    el('div', { class: 'skeleton-line w-80' }),
    el('div', { class: 'skeleton-line w-60' }),
    el('div', { class: 'skeleton-line w-80' })
  ]));
}

function wireEvents() {
  dom.micBtn.addEventListener('click', toggleRecording);
  dom.resetBtn.addEventListener('click', resetTurn);
  dom.playModelBtn.addEventListener('click', playModelSentence);
  dom.translateBtn.addEventListener('click', () => {
    state.showTranslation = !state.showTranslation;
    applyTranslation();
  });
  dom.playReplyBtn.addEventListener('click', () => {
    if (!state.chat) return;
    playText(state.chat.payload.reply, dom.playReplyBtn);
  });
  dom.exportBtn.addEventListener('click', exportSession);
  dom.modeButtons.forEach((button) => {
    button.addEventListener('click', () => applyMode(button.dataset.mode));
  });
  dom.themeBtn.addEventListener('click', () => {
    applyTheme(document.documentElement.classList.contains('dark') ? 'light' : 'dark');
  });
  dom.sessionId.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(state.sessionId);
      toast(`Session ID copied: ${state.sessionId}`, 'ok', 2600);
    } catch (err) {
      toast(`Session ID: ${state.sessionId}`, 'info', 4000);
    }
  });
  dom.categorySelect.addEventListener('change', () => {
    state.categoryId = dom.categorySelect.value;
    state.chat = null;
    state.history = [];
    populateSentences(state.scenarioId);
    const option = dom.categorySelect.selectedOptions[0];
    toast(`Category: ${option ? option.textContent.trim() : 'all'}`, 'info', 2000);
  });
  dom.mediumPills.forEach((button) => {
    button.addEventListener('click', () => {
      const medium = button.dataset.medium;
      if (medium !== state.medium) {
        setMedium(medium);
      } else {
        // Re-clicking the active tier resets Level 2 to that tier's default.
        const reset = defaultCategoryId(medium, state.categories);
        if (reset !== state.categoryId) {
          state.categoryId = reset;
          state.chat = null;
          state.history = [];
          populateCategories();
          populateSentences(null);
        }
      }
      const tier = MEDIUM_TIERS.find((entry) => entry.id === medium);
      const category = state.categories.find((entry) => entry.id === state.categoryId);
      toast(
        `${tier ? tier.label : medium} · ${category ? category.label : 'All categories'}`,
        'info',
        2200
      );
    });
  });
  dom.sentenceSelect.addEventListener('change', () => {
    state.scenarioId = dom.sentenceSelect.value;
    state.chat = null;
    state.history = [];
    renderScenario();
    renderChips(currentScenario().starters || []);
  });
  dom.scriptedToggle.addEventListener('change', () => {
    state.scripted = dom.scriptedToggle.checked;
    renderModelSentence();
  });
  dom.voiceSelect.addEventListener('change', () => {
    state.voice = dom.voiceSelect.value;
    updateModelTtsNote();
  });
  dom.vowelToggle.addEventListener('change', () => {
    state.vowelFocus = dom.vowelToggle.checked;
    renderModelSentence();
    syncVowelUrl();
  });
  dom.engineSelect.addEventListener('change', () => {
    state.engine = dom.engineSelect.value;
    updateModelTtsNote();
    if (state.engine === 'azure' && !(state.health && state.health.providers.tts.azure_available)) {
      toast('Azure Neural TTS is not configured — the browser voice will be used.', 'warn', 5000);
    }
  });
  dom.tabs.forEach((tab) => tab.addEventListener('click', () => renderTab(tab.dataset.tab)));
  dom.usageBannerClose.addEventListener('click', () => dom.usageBanner.classList.add('hidden'));
  // 429 user_limit_reached / 503 daily_budget_exhausted from any endpoint.
  window.addEventListener('fb:usage-limit', (event) => stopPracticeForToday(event.detail || {}));
  dom.accessGateForm.addEventListener('submit', submitAccessCode);
  // Any 401 from api.js (e.g. the cookie expired mid-session) re-opens the gate.
  window.addEventListener('fb:access-required', () => {
    if (state.accessGateOpen) return;
    openAccessGate({ reason: 'expired' });
  });
  document.addEventListener('keydown', (event) => {
    const tag = (event.target && event.target.tagName) || '';
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(tag)) return;
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    if (event.code === 'KeyR') {
      event.preventDefault();
      toggleRecording();
    }
    if (event.code === 'Escape') stopSpeaking();
  });
  window.addEventListener('beforeunload', () => {
    stopSpeaking();
    if (recorder && recorder.isRecording) recorder.cancel();
  });
}

function updateMicAvailability() {
  // A reached daily quota keeps the mic disabled (the rest of the UI stays
  // readable so the student can review scores and practice notes).
  if (state.usageStopped) {
    dom.micBtn.disabled = true;
    return;
  }
  if (!MicrophoneRecorder.supported) {
    dom.micBtn.disabled = true;
    dom.micBtn.title = 'Microphone capture needs Chrome/Edge/Firefox on localhost or HTTPS';
    dom.micStatus.textContent = 'Microphone capture is not supported in this browser.';
    return;
  }
  dom.micStatus.textContent = 'Tap the mic and speak English';
}

/* ------------------------------- recording ------------------------------- */

let playbackUrl = null;

function setPlayback(blob) {
  if (playbackUrl) {
    try { URL.revokeObjectURL(playbackUrl); } catch (err) { /* ignore */ }
    playbackUrl = null;
  }
  if (!blob) {
    dom.playback.classList.add('hidden');
    dom.playback.removeAttribute('src');
    return;
  }
  playbackUrl = URL.createObjectURL(blob);
  dom.playback.src = playbackUrl;
  dom.playback.classList.remove('hidden');
}

function setRecordingUi(active) {
  dom.micBtn.classList.toggle('is-recording', active);
  dom.micBtn.setAttribute('aria-pressed', String(active));
  dom.micBtn.setAttribute('aria-label', active ? 'Stop recording' : 'Start recording');
  dom.micStage.classList.toggle('is-recording', active);
  dom.micCard.classList.toggle('is-recording', active);
  if (active) {
    dom.recTimer.textContent = '0.0s';
    dom.micStatus.textContent = 'Listening… tap again to stop';
  } else {
    dom.micStatus.textContent = 'Processing…';
    dom.micCard.querySelectorAll('.wave span').forEach((bar) => { bar.style.height = '7px'; });
  }
}

function handleRecTick(ms, level) {
  dom.recTimer.textContent = `${(ms / 1000).toFixed(1)}s`;
  const bars = dom.micCard.querySelectorAll('.wave span');
  bars.forEach((bar, index) => {
    const wobble = 0.55 + 0.45 * Math.sin(ms / 130 + index * 0.9);
    const height = 7 + Math.min(1, level * 5) * 27 * wobble;
    bar.style.height = `${Math.max(7, height).toFixed(1)}px`;
  });
}

function handleRecLimit() {
  if (state.limitHandled) return;
  state.limitHandled = true;
  toast('30 second limit reached — stopping the recording.', 'warn', 3200);
  stopRecording();
}

async function toggleRecording() {
  if (state.usageStopped) {
    toast(usageMessage(state.usageStop), 'info', 5000);
    return;
  }
  if (state.busy) {
    toast('Still analysing the previous answer…', 'warn', 2500);
    return;
  }
  if (recorder && recorder.isRecording) await stopRecording();
  else await startRecording();
}

async function startRecording() {
  stopSpeaking();
  state.limitHandled = false;
  dom.micBtn.disabled = true;
  try {
    await recorder.start();
    setRecordingUi(true);
  } catch (err) {
    setRecordingUi(false);
    dom.micStatus.textContent = 'Tap the mic and speak English';
    toast(err.message || 'Could not start the recording.', 'error', 6000);
  } finally {
    dom.micBtn.disabled = false;
  }
}

async function stopRecording() {
  if (!recorder || !recorder.isRecording) return;
  setRecordingUi(false);
  dom.micStatus.textContent = 'Encoding audio…';

  let captured = null;
  try {
    captured = await recorder.stop();
  } catch (err) {
    toast(`Recording failed: ${err.message}`, 'error', 6000);
    dom.micStatus.textContent = 'Tap the mic and speak English';
    return;
  }
  if (!captured) return;
  if (captured.durationMs < 300) {
    toast('That was very short — please say a full sentence.', 'warn', 3200);
    dom.micStatus.textContent = 'Tap the mic and speak English';
    return;
  }
  // 0.001 (-60 dBFS) keeps soft / tentative L1-accented speech; only near-
  // digital silence is blocked locally (the server has its own low floor).
  if (captured.peak < 0.001) {
    toast('Almost no sound was captured — check the microphone and try again.', 'warn', 4500);
    dom.micStatus.textContent = 'Tap the mic and speak English';
    return;
  }

  setPlayback(captured.blob);
  state.timings = { rec: captured.totalRecMs, azure: null, llm: null, tts: null, total: null, llmRoundTrip: null };
  state.lastTts = null;
  renderKpis();
  updateKpi('rec', captured.totalRecMs, 'Record + WAV encode (client)');
  dom.turnBadge.textContent = `Turn ${state.turns.length + 1}`;
  await runPipeline(captured);
}
