/**
 * Practice sentence library shared by the server and the client.
 *
 * Four collections:
 *   - scenario    : communicative situations (cafe, airport, clinic, shopping,
 *                   hotel, train) for A2 functional language
 *   - movie       : iconic film lines for rhythm and connected speech
 *   - song        : lyrical lines for stress and intonation
 *   - generations : cultural lines grouped by demographic cohort (Boomers ...
 *                   Gen Alpha) plus a shuffled "Mix Generations" pool; the data
 *                   lives in src/practiceDataGenerations.js
 *
 * Each entry exposes `referenceText` (the target sentence used for scripted
 * scoring) plus keywords that bias the Azure recogniser toward the expected
 * vocabulary, and `wordVowels` (irregular words -> true IPA nuclei) so Vowel
 * Practice plays the lexical vowel instead of a spelling guess.
 */

const { GENERATION_GROUP, GENERATION_CATEGORIES } = require('./practiceDataGenerations');
const { vowelAlignments } = require('./wordPhonemes');

const LIBRARY = {
  cafe: {
    group: 'scenario',
    medium: 'scenario',
    shortLabel: 'Cafe',
    label: 'Cafe & Dining',
    emoji: '\u2615',
    tip: 'ordering, ingredients, paying',
    keywords: ['latte', 'coffee', 'tea', 'oat milk', 'milk', 'sugar', 'cake', 'sandwich',
      'menu', 'check', 'table', 'water', 'soup', 'card', 'allergic', 'vegetarian'],
    starters: ['Can I have a medium latte, please?', 'How much is the chocolate cake?', 'Could we have the check, please?'],
    items: [
      ['I would like a medium latte with oat milk, please.', 'Order a latte'],
      ['Can I have a table for two by the window?', 'Ask for a table'],
      ['Does this sandwich have any nuts in it?', 'Ask about ingredients'],
      ['Could I see the menu, please?', 'Ask for the menu'],
      ['I will have the chicken soup and a glass of water.', 'Order a meal'],
      ['Can I get this coffee without sugar?', 'Change an order'],
      ['How much is the chocolate cake?', 'Ask the price'],
      ['Could we have the check, please?', 'Ask for the check'],
      ['Do you have any vegetarian dishes?', 'Ask about options'],
      ['Can I pay by card?', 'Ask to pay'],
      ['I would like my steak well done, please.', 'Say how you like it'],
      ['Is the soup hot or cold?', 'Ask about the food'],
      ['I am allergic to milk, so no cheese please.', 'Explain an allergy'],
      ['Can I have some more bread, please?', 'Ask for more']
    ]
  },
  airport: {
    group: 'scenario',
    medium: 'scenario',
    shortLabel: 'Airport',
    label: 'Airport & Travel',
    emoji: '\u2708\uFE0F',
    tip: 'directions, baggage, boarding',
    keywords: ['baggage claim', 'suitcase', 'luggage', 'flight', 'gate', 'boarding pass',
      'passport', 'terminal', 'security', 'taxi', 'delay', 'connecting flight', 'hand luggage'],
    starters: ['Where is the baggage claim, please?', 'Which gate does flight 205 leave from?', 'What time does boarding start?'],
    items: [
      ['Where is the baggage claim, please?', 'Find baggage claim'],
      ['My suitcase did not arrive on flight CA 982.', 'Report a missing bag'],
      ['Which gate does flight 205 leave from?', 'Ask for the gate'],
      ['What time does boarding start?', 'Ask about boarding'],
      ['Is this the line for security?', 'Check the queue'],
      ['I would like a window seat, please.', 'Ask for a seat'],
      ['How long is the delay?', 'Ask about a delay'],
      ['Can I get a boarding pass for my connecting flight?', 'Ask for a boarding pass'],
      ['My passport is in my handbag.', 'Talk about documents'],
      ['Where can I take a taxi to the city center?', 'Ask for a taxi'],
      ['Do I need to check in my hand luggage?', 'Ask about luggage'],
      ['Is there a shuttle bus to the terminal?', 'Ask about the shuttle']
    ]
  },
  clinic: {
    group: 'scenario',
    medium: 'scenario',
    shortLabel: 'Clinic',
    label: 'Clinic & Health',
    emoji: '\uD83E\uDE7A',
    tip: 'symptoms, pharmacy, medicine',
    keywords: ['appointment', 'doctor', 'headache', 'fever', 'sore throat', 'cough',
      'medicine', 'pharmacy', 'prescription', 'allergic', 'dizzy', 'pills', 'penicillin'],
    starters: ['I need an appointment because I have a sore throat.', 'Could I see a doctor this afternoon?', 'Where is the nearest pharmacy?'],
    items: [
      ['I need an appointment because I have a sore throat.', 'Book an appointment'],
      ['I have a headache and a fever since yesterday.', 'Describe symptoms'],
      ['Could I see a doctor this afternoon?', 'Ask for a time'],
      ['I would like some medicine for my cough.', 'Ask for medicine'],
      ['My back hurts when I sit down.', 'Describe pain'],
      ['I am allergic to penicillin.', 'Explain an allergy'],
      ['How often should I take this medicine?', 'Ask about dosage'],
      ['Do I need a prescription for these pills?', 'Ask about a prescription'],
      ['I feel dizzy and I cannot sleep.', 'Describe how you feel'],
      ['Where is the nearest pharmacy?', 'Find a pharmacy'],
      ['Can I pay for the medicine by card?', 'Pay at the counter'],
      ["I have an appointment at three o'clock.", 'Confirm a time']
    ]
  },
  shopping: {
    group: 'scenario',
    medium: 'scenario',
    shortLabel: 'Shopping',
    label: 'Shopping & Sizes',
    emoji: '\uD83D\uDECD\uFE0F',
    tip: 'sizes, discounts, returns',
    keywords: ['size', 'shirt', 'shoes', 'jacket', 'bag', 'discount', 'receipt',
      'fitting room', 'sweater', 'return', 'credit card', 'dress', 'black'],
    starters: ['Do you have this shirt in a larger size?', 'How much does this jacket cost?', 'Where is the fitting room?'],
    items: [
      ['Do you have this shirt in a larger size?', 'Ask for a size'],
      ['Can I try these shoes on, please?', 'Try something on'],
      ['How much does this jacket cost?', 'Ask the price'],
      ['Is there a discount on this bag?', 'Ask for a discount'],
      ['What time does the store close today?', 'Ask about opening hours'],
      ['I am looking for a blue sweater.', 'Describe what you want'],
      ['Can I return this if it does not fit?', 'Ask about returns'],
      ['Do you accept credit cards?', 'Ask about payment'],
      ['This dress is too small for me.', 'Say it does not fit'],
      ['Where is the fitting room?', 'Find the fitting room'],
      ['Do you have the same bag in black?', 'Ask for another colour'],
      ['Can I get a receipt, please?', 'Ask for a receipt']
    ]
  },
  hotel: {
    group: 'scenario',
    medium: 'scenario',
    shortLabel: 'Hotel',
    label: 'Hotel & Accommodations',
    emoji: '\uD83C\uDFE8',
    tip: 'check-in, wifi, room service',
    keywords: ['reservation', 'wifi', 'breakfast', 'check out', 'lift', 'towel',
      'room', 'double room', 'shuttle', 'luggage', 'air conditioner', 'bill'],
    starters: ['I have a reservation for two nights.', 'What is the wifi password, please?', 'What time is check out?'],
    items: [
      ['I have a reservation for two nights.', 'Check in'],
      ['What is the wifi password, please?', 'Ask for the wifi'],
      ['Can I have breakfast in my room?', 'Order room service'],
      ['What time is check out?', 'Ask about check out'],
      ['Is there a lift to the fifth floor?', 'Ask about the lift'],
      ['Could I have an extra towel, please?', 'Ask for an extra'],
      ['Does the room have a coffee machine?', 'Ask about the room'],
      ['Can I leave my luggage here until noon?', 'Store your luggage'],
      ['I would like to book a double room.', 'Book a room'],
      ['Is the airport shuttle free?', 'Ask about the shuttle'],
      ['The air conditioner in my room is not working.', 'Report a problem'],
      ['Can I pay the bill tomorrow morning?', 'Ask about the bill']
    ]
  },
  train: {
    group: 'scenario',
    medium: 'scenario',
    shortLabel: 'Transit',
    label: 'Train & Transit',
    emoji: '\uD83D\uDE86',
    tip: 'tickets, transfers, platforms',
    keywords: ['ticket', 'return ticket', 'platform', 'train', 'station', 'timetable',
      'student discount', 'connection', 'journey', 'seat', 'airport', 'transfer'],
    starters: ['I would like a return ticket to Osaka, please.', 'Which platform does the train leave from?', 'How long does the journey take?'],
    items: [
      ['I would like a return ticket to Osaka, please.', 'Buy a ticket'],
      ['Which platform does the train leave from?', 'Ask for the platform'],
      ['Do I need to change trains at the next station?', 'Ask about a transfer'],
      ['What time does the last train leave?', 'Ask about the last train'],
      ['Is this seat taken?', 'Ask about a seat'],
      ['Can I buy a ticket on the train?', 'Ask about buying on board'],
      ['How long does the journey take?', 'Ask about the journey'],
      ['Does this train stop at Central Station?', 'Check the stops'],
      ['I missed my connection, what can I do?', 'Ask for help'],
      ['Where can I find the timetable?', 'Find the timetable'],
      ['Is there a discount for students?', 'Ask for a discount'],
      ['Please tell me when we arrive at the airport.', 'Ask for a reminder']
    ]
  },
  movies: {
    group: 'movie',
    medium: 'movie',
    shortLabel: 'Classic Movie Lines',
    label: 'Famous Movie Lines',
    emoji: '\uD83C\uDFAC',
    tip: 'rhythm, stress, linking',
    keywords: ['force', 'home', 'problem', 'back', 'kid', 'boat', 'chocolates',
      'infinity', 'swimming', 'Watson', 'serious', 'offer'],
    starters: ['May the Force be with you.', 'There is no place like home.', 'I will be back.'],
    items: [
      ['May the Force be with you.', 'Star Wars', 'Star Wars'],
      ["There's no place like home.", 'The Wizard of Oz', 'The Wizard of Oz'],
      ['Houston, we have a problem.', 'Apollo 13', 'Apollo 13'],
      ["I'll be back.", 'The Terminator', 'The Terminator'],
      ["Here's looking at you, kid.", 'Casablanca', 'Casablanca'],
      ["You're gonna need a bigger boat.", 'Jaws', 'Jaws'],
      ['Life is like a box of chocolates.', 'Forrest Gump', 'Forrest Gump'],
      ['To infinity and beyond!', 'Toy Story', 'Toy Story'],
      ['Just keep swimming.', 'Finding Nemo', 'Finding Nemo'],
      ['Elementary, my dear Watson.', 'Sherlock Holmes', 'Sherlock Holmes'],
      ['Why so serious?', 'The Dark Knight', 'The Dark Knight'],
      ["I'll make him an offer he cannot refuse.", 'The Godfather', 'The Godfather']
    ]
  },
  songs: {
    group: 'song',
    medium: 'song',
    shortLabel: 'Classic Song Lyrics',
    label: 'Famous Song Lyrics',
    emoji: '\uD83C\uDFB5',
    tip: 'stress, intonation, flow',
    keywords: ['sun', 'believin', 'rock', 'breath', 'lonely road', 'wonderful world',
      'darkness', 'mountain', 'beautiful day', 'imagine', 'peace'],
    starters: ['Here comes the sun.', 'We will rock you.', 'What a wonderful world.'],
    items: [
      ["Here comes the sun, and I say it's all right.", 'The Beatles', 'The Beatles'],
      ["Don't stop believin', hold on to that feelin'.", 'Journey', 'Journey'],
      ['We will, we will rock you.', 'Queen', 'Queen'],
      ['Every breath you take, every move you make.', 'The Police', 'The Police'],
      ['I walk a lonely road, the only one that I have ever known.', 'Green Day', 'Green Day'],
      ['What a wonderful world.', 'Louis Armstrong', 'Louis Armstrong'],
      ['Hello darkness, my old friend.', 'Simon & Garfunkel', 'Simon & Garfunkel'],
      ["Ain't no mountain high enough.", 'Marvin Gaye & Tammi Terrell', 'Marvin Gaye & Tammi Terrell'],
      ["It's a beautiful day, don't let it get away.", 'U2', 'U2'],
      ['Imagine all the people living life in peace.', 'John Lennon', 'John Lennon']
    ]
  }
};

// Generational cohorts + the shuffled mix are appended here so the collections
// above stay unchanged; object insertion order drives the UI dropdown order.
Object.assign(LIBRARY, GENERATION_CATEGORIES);

/**
 * Japanese translations, keyed by the exact English target sentence.
 * Stored statically so the toggle needs no runtime API call or latency.
 */
const JA = {
  // Cafe & Dining
  "I would like a medium latte with oat milk, please.": 'オートミルクのミディアムラテをお願いします。',
  "Can I have a table for two by the window?": '窓際の2人用の席をお願いできますか。',
  "Does this sandwich have any nuts in it?": 'このサンドイッチにナッツは入っていますか。',
  "Could I see the menu, please?": 'メニューを見せていただけますか。',
  "I will have the chicken soup and a glass of water.": 'チキンスープとお水を一杯ください。',
  "Can I get this coffee without sugar?": 'このコーヒーは砂糖なしでお願いできますか。',
  "How much is the chocolate cake?": 'チョコレートケーキはいくらですか。',
  "Could we have the check, please?": 'お会計をお願いできますか。',
  "Do you have any vegetarian dishes?": 'ベジタリアン向けの料理はありますか。',
  "Can I pay by card?": 'カードで払えますか。',
  "I would like my steak well done, please.": 'ステーキはウェルダンでお願いします。',
  "Is the soup hot or cold?": 'このスープは温かいですか、冷たいですか。',
  "I am allergic to milk, so no cheese please.": '牛乳アレルギーなので、チーズは入れないでください。',
  "Can I have some more bread, please?": 'パンをもう少しもらえますか。',
  // Airport & Travel
  "Where is the baggage claim, please?": '手荷物受取所はどこですか。',
  "My suitcase did not arrive on flight CA 982.": 'CA982便でスーツケースが届きませんでした。',
  "Which gate does flight 205 leave from?": '205便は何番ゲートから出発しますか。',
  "What time does boarding start?": '搭乗開始は何時ですか。',
  "Is this the line for security?": 'これは保安検査の列ですか。',
  "I would like a window seat, please.": '窓側の席をお願いします。',
  "How long is the delay?": '遅れはどのくらいですか。',
  "Can I get a boarding pass for my connecting flight?": '乗り継ぎ便の搭乗券をもらえますか。',
  "My passport is in my handbag.": 'パスポートはハンドバッグの中です。',
  "Where can I take a taxi to the city center?": '市内中心部へ行くタクシーはどこで乗れますか。',
  "Do I need to check in my hand luggage?": '手荷物を預ける必要はありますか。',
  "Is there a shuttle bus to the terminal?": 'ターミナル行きのシャトルバスはありますか。',
  // Clinic & Health
  "I need an appointment because I have a sore throat.": '喉が痛いので診察の予約をお願いします。',
  "I have a headache and a fever since yesterday.": '昨日から頭痛と熱があります。',
  "Could I see a doctor this afternoon?": '今日の午後に診てもらえますか。',
  "I would like some medicine for my cough.": '咳止めの薬がほしいです。',
  "My back hurts when I sit down.": '座ると背中が痛いです。',
  "I am allergic to penicillin.": 'ペニシリンにアレルギーがあります。',
  "How often should I take this medicine?": 'この薬はどのくらいの頻度で飲めばいいですか。',
  "Do I need a prescription for these pills?": 'この薬は処方箋が必要ですか。',
  "I feel dizzy and I cannot sleep.": 'めまいがして眠れません。',
  "Where is the nearest pharmacy?": '一番近い薬局はどこですか。',
  "Can I pay for the medicine by card?": '薬代はカードで払えますか。',
  "I have an appointment at three o'clock.": '3時に予約があります。',
  // Shopping & Sizes
  "Do you have this shirt in a larger size?": 'このシャツのもっと大きいサイズはありますか。',
  "Can I try these shoes on, please?": 'この靴を試着してもいいですか。',
  "How much does this jacket cost?": 'このジャケットはいくらですか。',
  "Is there a discount on this bag?": 'このバッグは割引になりますか。',
  "What time does the store close today?": '今日は何時に閉店しますか。',
  "I am looking for a blue sweater.": '青いセーターを探しています。',
  "Can I return this if it does not fit?": 'サイズが合わなければ返品できますか。',
  "Do you accept credit cards?": 'クレジットカードは使えますか。',
  "This dress is too small for me.": 'このドレスは私には小さすぎます。',
  "Where is the fitting room?": '試着室はどこですか。',
  "Do you have the same bag in black?": '同じバッグの黒色はありますか。',
  "Can I get a receipt, please?": 'レシートをいただけますか。',
  // Hotel & Accommodations
  "I have a reservation for two nights.": '2泊で予約しています。',
  "What is the wifi password, please?": 'Wi-Fiのパスワードは何ですか。',
  "Can I have breakfast in my room?": '部屋で朝食を食べられますか。',
  "What time is check out?": 'チェックアウトは何時ですか。',
  "Is there a lift to the fifth floor?": '5階へ行くエレベーターはありますか。',
  "Could I have an extra towel, please?": 'タオルをもう一枚もらえますか。',
  "Does the room have a coffee machine?": '部屋にコーヒーメーカーはありますか。',
  "Can I leave my luggage here until noon?": '正午まで荷物を預かってもらえますか。',
  "I would like to book a double room.": 'ダブルルームを予約したいです。',
  "Is the airport shuttle free?": '空港シャトルは無料ですか。',
  "The air conditioner in my room is not working.": '部屋のエアコンが動きません。',
  "Can I pay the bill tomorrow morning?": '明日の朝に支払えますか。',
  // Train & Transit
  "I would like a return ticket to Osaka, please.": '大阪までの往復切符をお願いします。',
  "Which platform does the train leave from?": '電車は何番線から出ますか。',
  "Do I need to change trains at the next station?": '次の駅で乗り換えが必要ですか。',
  "What time does the last train leave?": '終電は何時ですか。',
  "Is this seat taken?": 'この席は空いていますか。',
  "Can I buy a ticket on the train?": '電車の中で切符を買えますか。',
  "How long does the journey take?": '所要時間はどのくらいですか。',
  "Does this train stop at Central Station?": 'この電車はセントラル駅に止まりますか。',
  "I missed my connection, what can I do?": '乗り継ぎに遅れました。どうすればいいですか。',
  "Where can I find the timetable?": '時刻表はどこにありますか。',
  "Is there a discount for students?": '学生割引はありますか。',
  "Please tell me when we arrive at the airport.": '空港に着いたら教えてください。',
  // Famous Movie Lines
  "May the Force be with you.": 'フォースが共にあらんことを。',
  "There's no place like home.": '我が家に勝る場所はない。',
  "Houston, we have a problem.": 'ヒューストン、問題が発生しました。',
  "I'll be back.": 'また戻ってくる。',
  "Here's looking at you, kid.": '君に乾杯。',
  "You're gonna need a bigger boat.": 'もっと大きい船が必要だ。',
  "Life is like a box of chocolates.": '人生はチョコレートの箱のようなものだ。',
  "To infinity and beyond!": '無限の彼方へ、さあ行くぞ！',
  "Just keep swimming.": '泳ぎ続けるんだ。',
  "Elementary, my dear Watson.": '初歩的なことだ、ワトソン君。',
  "Why so serious?": 'なぜそんなに真面目なんだ？',
  "I'll make him an offer he cannot refuse.": '彼が断れない申し出をする。',
  // Famous Song Lyrics
  "Here comes the sun, and I say it's all right.": '太陽が昇ってくる、大丈夫だよ。',
  "Don't stop believin', hold on to that feelin'.": '信じ続けて、その気持ちを忘れないで。',
  "We will, we will rock you.": '俺たちはお前を揺さぶる。',
  "Every breath you take, every move you make.": '君の息づかいも、君の一挙手一投足も。',
  "I walk a lonely road, the only one that I have ever known.": '僕は孤独な道を歩く、ただ一つ知っている道を。',
  "What a wonderful world.": 'なんて素晴らしい世界。',
  "Hello darkness, my old friend.": 'こんにちは闇よ、古い友よ。',
  "Ain't no mountain high enough.": 'どんなに高い山も越えられる。',
  "It's a beautiful day, don't let it get away.": '美しい日だ、逃がさないで。',
  "Imagine all the people living life in peace.": 'すべての人が平和に暮らす世界を想像して。'
};

const GROUPS = [
  { id: 'scenario', label: 'Practice Scenarios' },
  { id: 'movie', label: 'Famous Movie Lines' },
  { id: 'song', label: 'Famous Song Lyrics' },
  GENERATION_GROUP
];

const CATEGORIES = Object.entries(LIBRARY).map(([id, category]) => ({
  id,
  group: category.group,
  groupLabel: (GROUPS.find((group) => group.id === category.group) || GROUPS[0]).label,
  label: category.label,
  shortLabel: category.shortLabel || category.label,
  emoji: category.emoji,
  // 'scenario' | 'movie' | 'song' for pickable content; cohorts that pool both
  // media report their majority medium plus the full `media` list.
  medium: category.medium || (category.group === 'scenario' ? 'scenario' : category.group),
  media: category.media || [category.medium || category.group],
  tip: category.tip,
  keywords: category.keywords,
  sentenceCount: category.items.length,
  // "Shuffle / Mix Generations" starts on a random line in the UI.
  mix: Boolean(category.mix),
  // "All Generations (Combined)" pools every cohort in release order.
  combined: Boolean(category.combined)
}));

/**
 * Normalises a library item. Collections use the compact
 * `[text, label, source]` tuple; generational entries use an object so each
 * line can carry its own `medium`, `ja` translation and vowel overrides.
 */
function normalizeItem(item) {
  if (Array.isArray(item)) {
    return {
      text: String(item[0] || ''),
      label: item[1] || null,
      source: item[2] || null,
      ja: item[3] || null,
      vowels: item[4] || null,
      medium: null
    };
  }
  return {
    text: String(item.text || ''),
    label: item.label || null,
    source: item.source || null,
    ja: item.ja || null,
    vowels: item.vowels || null,
    medium: item.medium || null
  };
}

const SENTENCES = [];
Object.entries(LIBRARY).forEach(([categoryId, category]) => {
  const meta = CATEGORIES.find((entry) => entry.id === categoryId);
  const isQuote = category.group !== 'scenario';
  category.items.forEach((raw, index) => {
    const item = normalizeItem(raw);
    const text = item.text;
    SENTENCES.push({
      id: `${categoryId}-${index + 1}`,
      category: categoryId,
      categoryLabel: category.label,
      group: category.group,
      groupLabel: meta.groupLabel,
      emoji: category.emoji,
      // Scenario items carry a short action label; quotes/lyrics show the line.
      label: isQuote ? text : (item.label || text),
      text,
      referenceText: text,
      sampleUtterance: text,
      // Three-tier picker filter: scenario | movie | song.
      medium: item.medium || meta.medium,
      ja: item.ja || JA[text] || null,
      source: isQuote ? (item.source || item.label || null) : null,
      focus: category.tip,
      keywords: category.keywords,
      starters: category.starters,
      // Irregular words / proper nouns -> lexical vowel nuclei (see src/wordPhonemes.js).
      wordVowels: vowelAlignments(text, item.vowels)
    });
  });
});

const DEFAULT_SCENARIO_ID = SENTENCES[0].id;

function getScenario(id) {
  return SENTENCES.find((sentence) => sentence.id === id) || SENTENCES[0];
}

function getCategory(id) {
  return CATEGORIES.find((category) => category.id === id) || CATEGORIES[0];
}

/** Compact practice block injected into the DeepSeek system prompt. */
function practiceBrief(sentence) {
  const category = getCategory(sentence.category);
  return [
    `PRACTICE CATEGORY: ${category.label}`,
    `TARGET SENTENCE: "${sentence.referenceText}"`,
    `LANGUAGE FOCUS: ${sentence.focus}`
  ].join('\n');
}

module.exports = {
  GROUPS,
  CATEGORIES,
  SENTENCES,
  // Backwards-compatible names used by the server and existing scripts
  SCENARIOS: SENTENCES,
  DEFAULT_SCENARIO_ID,
  getScenario,
  getCategory,
  practiceBrief
};
