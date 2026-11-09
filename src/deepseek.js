/**
 * DeepSeek V4.1 Flash client (OpenAI-compatible).
 *
 * Uses `response_format: { type: 'json_object' }` and *streams* the response so
 * the inspector can report a real time-to-first-token (TTFT). Every payload is
 * normalised and then checked against the A2 pedagogical constraints server
 * side, so the researcher sees whether the model actually obeyed the prompt.
 */

const { practiceBrief, getScenario } = require('./scenarios');

const API_URL = process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com/v1/chat/completions';
const MODEL = process.env.DEEPSEEK_MODEL || 'deepseek-chat';
const TEMPERATURE = Number(process.env.DEEPSEEK_TEMPERATURE || 0.6);

const SYSTEM_PROMPT = `You are "Bridge", a warm English conversation partner for university ESL learners at CEFR A2. The learner is practising a target sentence out loud; keep the conversation going with simple English and model correct forms through your recast.

HARD RULES (automatically checked by the research harness):
1. "reply" MUST be 25 words or fewer in total.
2. Use ONLY present simple or past simple. NEVER use present perfect, present continuous, past continuous, future, conditionals, or modals of speculation.
3. "reply" MUST contain EXACTLY ONE question (exactly one question mark).
4. Vocabulary and grammar must stay at A2. No idioms, no phrasal verbs, no slang, no long subordinate clauses.
5. "recast" restates ONLY what the learner said, in correct and natural A2 English. Keep the learner's meaning. Do not add new information and do not ask a question.
6. Never mention scores, phonemes, pronunciation, mistakes, feedback, or the assessment. Keep the tone warm and natural.
7. Be kind and patient. Never correct the learner explicitly; let the recast model the correct form.
8. Respond with ONE JSON object only. No markdown, no code fences, no extra text.

JSON SCHEMA:
{
  "recast": "string <=25 words - corrected version of the learner's sentence",
  "reply": "string <=25 words - your natural reply with exactly one question",
  "detected_errors": [
    {"student_said": "string", "issue": "string <=12 words", "corrected": "string", "severity": "minor|major"}
  ],
  "reasoning": "string <=40 words - why the recast changed what it changed (for researchers)",
  "chips": ["answer A", "answer B", "answer C"],
  "cefr_note": "string - one short sentence on the CEFR fit of your reply"
}

REQUIREMENTS FOR THE FIELDS:
- "detected_errors" MUST be [] when the learner's sentence is already grammatical.
- "chips" MUST contain exactly 3 short sentences (<=12 words each) that the LEARNER could say next, in first person, staying inside the scenario.
- All strings must be plain text (no markdown, no emoji).`;

function deepseekConfigured() {
  return Boolean(process.env.DEEPSEEK_API_KEY);
}

const asString = (value) => (typeof value === 'string' ? value.trim() : '');
const countWords = (text) => (text ? text.replace(/[^\p{L}\p{N}'\s-]/gu, ' ').trim().split(/\s+/).filter(Boolean).length : 0);
const countQuestions = (text) => (text.match(/\?/g) || []).length;

function sanitizeHistory(history) {
  if (!Array.isArray(history)) return [];
  return history
    .filter((turn) => turn && (turn.role === 'user' || turn.role === 'assistant'))
    .slice(-8)
    .map((turn) => ({
      role: turn.role,
      content: String(turn.content || '').slice(0, 400)
    }))
    .filter((turn) => turn.content.length > 0);
}

function buildMessages({ transcript, scenarioId, history, assessment }) {
  const sentence = getScenario(scenarioId);
  const messages = [{ role: 'system', content: SYSTEM_PROMPT }];

  messages.push({
    role: 'system',
    content: `${practiceBrief(sentence)}\n\nThe learner is practising this target sentence out loud. Reply as a friendly conversation partner in a short, natural turn.`
  });

  const cleanHistory = sanitizeHistory(history);
  messages.push(...cleanHistory);

  let userLine = `LEARNER SAID (speech-to-text, may contain recognition errors): "${transcript}"`;
  if (assessment && Array.isArray(assessment.low_score_words) && assessment.low_score_words.length) {
    const list = assessment.low_score_words
      .slice(0, 6)
      .map((w) => `${w.word} (${Math.round(w.accuracy_score)})`)
      .join(', ');
    userLine += `\nFor your information only (do NOT comment on these in character): words with low pronunciation scores: ${list}.`;
  }
  userLine += '\nReturn the JSON object now.';
  messages.push({ role: 'user', content: userLine });
  return messages;
}


function headers() {
  return {
    'Content-Type': 'application/json',
    Accept: 'text/event-stream',
    Authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}`
  };
}

async function callApi(body, timeoutMs) {
  const response = await fetch(API_URL, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs)
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    const err = new Error(`DeepSeek HTTP ${response.status}: ${text.slice(0, 400) || response.statusText}`);
    err.code = 'DEEPSEEK_HTTP';
    err.status = response.status;
    throw err;
  }
  return response;
}

/** Reads an OpenAI-compatible SSE stream, capturing TTFT. */
async function readStream(response, model) {
  const started = Date.now();
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let content = '';
  let rawEvent = '';
  let ttftMs = null;
  let usage = null;
  let resolvedModel = model;
  let finishReason = null;
  let chunkCount = 0;

  const handleLine = (line) => {
    const trimmed = line.trim();
    if (!trimmed.startsWith('data:')) return;
    const data = trimmed.slice(5).trim();
    if (!data || data === '[DONE]') return;
    let json;
    try { json = JSON.parse(data); } catch (err) { return; }
    chunkCount += 1;
    if (json.error) {
      const err = new Error(`DeepSeek stream error: ${json.error.message || JSON.stringify(json.error)}`);
      err.code = 'DEEPSEEK_STREAM';
      throw err;
    }
    if (json.model) resolvedModel = json.model;
    if (json.usage) usage = json.usage;
    const choice = json.choices && json.choices[0];
    if (choice) {
      if (choice.finish_reason) finishReason = choice.finish_reason;
      const delta = choice.delta && choice.delta.content;
      if (delta) {
        if (ttftMs === null) ttftMs = Date.now() - started;
        content += delta;
      }
    }
  };

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const text = decoder.decode(value, { stream: true });
    rawEvent += text;
    buffer += text;
    let newline = buffer.indexOf('\n');
    while (newline >= 0) {
      const line = buffer.slice(0, newline).replace(/\r$/, '');
      buffer = buffer.slice(newline + 1);
      handleLine(line);
      newline = buffer.indexOf('\n');
    }
  }
  if (buffer) handleLine(buffer);

  return {
    content,
    ttftMs: ttftMs === null ? Date.now() - started : ttftMs,
    ttftMeasured: ttftMs !== null,
    durationMs: Date.now() - started,
    usage,
    model: resolvedModel,
    finishReason,
    chunkCount,
    streamed: true,
    rawEventTail: rawEvent.slice(-1200)
  };
}

async function completeOnce(messages, { stream = true, timeoutMs = 45000 } = {}) {
  const body = {
    model: MODEL,
    messages,
    response_format: { type: 'json_object' },
    temperature: TEMPERATURE,
    max_tokens: 700,
    stream
  };
  const requestStarted = Date.now();
  const response = await callApi(body, timeoutMs);

  if (!stream) {
    const json = await response.json();
    const choice = json.choices && json.choices[0];
    const content = (choice && choice.message && choice.message.content) || '';
    return {
      content,
      ttftMs: Date.now() - requestStarted,
      ttftMeasured: false,
      durationMs: Date.now() - requestStarted,
      usage: json.usage || null,
      model: json.model || MODEL,
      finishReason: (choice && choice.finish_reason) || null,
      chunkCount: 1,
      streamed: false,
      rawEventTail: content.slice(-1200)
    };
  }

  const result = await readStream(response, MODEL);
  if (!result.content.trim()) {
    const err = new Error('DeepSeek returned an empty stream.');
    err.code = 'DEEPSEEK_EMPTY';
    throw err;
  }
  return result;
}

/** Pulls the first JSON object out of a model response (tolerates fences). */
function extractJson(content) {
  let text = String(content || '').trim();
  if (!text) throw new Error('Empty model response.');
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) text = fenced[1].trim();
  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  if (first === -1 || last === -1 || last <= first) {
    throw new Error(`Model response is not JSON: ${text.slice(0, 200)}`);
  }
  return JSON.parse(text.slice(first, last + 1));
}

const TENSE_WARNINGS = [
  { label: 'perfect aspect', pattern: /\b(have|has|had)\s+[a-z]+(ed|en)\b/i },
  { label: 'continuous aspect', pattern: /\b(am|is|are|was|were)\s+[a-z]+ing\b/i },
  { label: 'future reference', pattern: /\b(will|shall)\b|\bgoing to\b/i },
  { label: 'modal / conditional', pattern: /\b(would|could|should|might|may)\b(?!\s+(?:you\s+|i\s+)?(?:like|have|get|want|see|come)\b)/i }
];

function normalizeErrors(list) {
  if (!Array.isArray(list)) return [];
  return list
    .filter((item) => item && typeof item === 'object')
    .map((item) => ({
      student_said: asString(item.student_said || item.student || item.original),
      issue: asString(item.issue || item.problem || item.error_type),
      corrected: asString(item.corrected || item.correction || item.fix),
      severity: ['minor', 'major'].includes(asString(item.severity).toLowerCase())
        ? asString(item.severity).toLowerCase()
        : 'minor'
    }))
    .filter((item) => item.issue || item.corrected);
}

/** Coerces any model output into the contract the UI/inspector expects. */
function normalizePayload(raw, scenarioId) {
  const scenario = getScenario(scenarioId);
  const source = raw && typeof raw === 'object' ? raw : {};
  const recast = asString(source.recast || source.recast_sentence || source.corrected_sentence);
  const reply = asString(source.reply || source.response || source.assistant_reply);
  if (!reply) throw new Error('DeepSeek payload is missing the `reply` field.');

  let chips = source.chips || source.suggested_answers || source.follow_ups || [];
  chips = Array.isArray(chips) ? chips.map(asString).filter(Boolean) : [];
  const fallbackChips = scenario.starters.slice();
  while (chips.length < 3) chips.push(fallbackChips[chips.length] || 'Sorry, can you repeat that, please?');

  return {
    recast: recast || scenario.referenceText,
    reply,
    detected_errors: normalizeErrors(source.detected_errors || source.errors),
    reasoning: asString(source.reasoning || source.explanation || source.why),
    chips: chips.slice(0, 3),
    cefr_note: asString(source.cefr_note || source.cefr || '')
  };
}

/** Server-side verification of the prompt constraints (research signal). */
function checkConstraints(payload) {
  const replyWords = countWords(payload.reply);
  const recastWords = countWords(payload.recast);
  const questions = countQuestions(payload.reply);
  const tenseHits = TENSE_WARNINGS
    .filter((rule) => rule.pattern.test(payload.reply) || rule.pattern.test(payload.recast))
    .map((rule) => rule.label);
  return {
    reply_word_count: replyWords,
    reply_word_limit: 25,
    within_word_limit: replyWords <= 25,
    recast_word_count: recastWords,
    within_recast_limit: recastWords <= 25,
    question_count: questions,
    exactly_one_question: questions === 1,
    chips_count: payload.chips.length,
    chips_ok: payload.chips.length === 3,
    tense_warnings: tenseHits,
    passes_all: replyWords <= 25 && questions === 1 && payload.chips.length === 3 && tenseHits.length === 0
  };
}

/**
 * @returns {Promise<object>} { payload, constraint_check, ttft_ms, ... }
 * Throws on network/parse failure so the caller can decide on a fallback.
 */
async function recastWithDeepSeek({ transcript, scenarioId, history, assessment }) {
  const messages = buildMessages({ transcript, scenarioId, history, assessment });
  const started = Date.now();
  let attempt;
  let downgraded = false;
  try {
    attempt = await completeOnce(messages, { stream: true, timeoutMs: 45000 });
  } catch (err) {
    // Some gateways reject stream + json_object; retry once without streaming.
    downgraded = true;
    attempt = await completeOnce(messages, { stream: false, timeoutMs: 30000 });
  }

  const parsed = extractJson(attempt.content);
  const payload = normalizePayload(parsed, scenarioId);
  return {
    payload,
    constraint_check: checkConstraints(payload),
    model: attempt.model,
    temperature: TEMPERATURE,
    ttft_ms: Math.round(attempt.ttftMs),
    ttft_measured: attempt.ttftMeasured,
    total_ms: Date.now() - started,
    usage: attempt.usage,
    finish_reason: attempt.finishReason,
    streamed: attempt.streamed,
    downgraded,
    source: 'live',
    raw_content: attempt.content,
    raw_model_json: parsed,
    request_messages: messages
  };
}

module.exports = {
  recastWithDeepSeek,
  deepseekConfigured,
  normalizePayload,
  checkConstraints,
  countWords,
  countQuestions,
  SYSTEM_PROMPT
};
