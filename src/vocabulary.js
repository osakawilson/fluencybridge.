/**
 * Contextual bias vocabulary for the Azure recognizer.
 *
 * Accented (L1-influenced) A2 speech is easily decoded as unrelated words;
 * a PhraseListGrammar biases the decoder toward the classroom lexicon without
 * changing the acoustic model. Terms here are intentionally short and
 * high-frequency so they cannot swallow free conversation.
 */

const A2_CORE_PHRASES = [
  // politeness frames
  'I would like', 'I want', 'I need', 'I have', 'Can I have', 'Could I have',
  'Do you have', 'Can you help me', 'Can you repeat that', 'How much is it',
  'What time', 'Where is', 'My name is', 'Excuse me', 'Thank you', 'Sorry',
  'Yes please', 'No thank you', 'One moment please', 'See you',
  // shared classroom nouns / adjectives
  'latte', 'coffee', 'tea', 'oat milk', 'milk', 'sugar', 'iced', 'hot', 'cold',
  'receipt', 'passport', 'flight', 'luggage', 'suitcase', 'bag', 'ticket',
  'appointment', 'headache', 'medicine', 'doctor', 'nurse', 'clinic',
  'small', 'medium', 'large', 'today', 'tomorrow', 'yesterday', 'this morning',
  'this afternoon', 'two days ago', 'please'
];

/**
 * Category keywords come from the practice library (src/scenarios.js), so the
 * bias stays in sync with whichever sentence the learner selected.
 */

/** Simple word-level additions from a scripted target sentence. */
function referencePhrases(referenceText) {
  if (!referenceText) return [];
  const words = String(referenceText)
    .replace(/[^\p{L}\p{N}'\s-]/gu, ' ')
    .split(/\s+/)
    .filter((word) => word.length > 2);
  return words.slice(0, 20);
}

/**
 * @param {{scenarioId?:string, referenceText?:string, keywords?:string[], limit?:number}} options
 * @returns {string[]} deduplicated, length-capped phrase list
 */
function phrasesForScenario({ referenceText, keywords = [], limit = 120 } = {}) {
  const categoryPhrases = Array.isArray(keywords) ? keywords : [];
  const seen = new Set();
  const phrases = [];

  [...A2_CORE_PHRASES, ...categoryPhrases, ...referencePhrases(referenceText)].forEach((term) => {
    const phrase = String(term || '').replace(/\s+/g, ' ').trim();
    if (!phrase) return;
    const key = phrase.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    phrases.push(phrase);
  });

  return phrases.slice(0, limit);
}

module.exports = { A2_CORE_PHRASES, phrasesForScenario };
