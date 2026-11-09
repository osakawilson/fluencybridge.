/**
 * Generational practice library: cultural lines grouped by demographic cohort.
 *
 * Kept separate from src/scenarios.js so that file stays lean. Each cohort is a
 * practice "category" in the same shape the library builder already understands
 * (group / label / emoji / tip / keywords / starters / items), where every item
 * carries its own `ja` translation so the 日本語 toggle works without an API call.
 *
 * `GENERATION_CATEGORIES` also contains the "Shuffle / Mix Generations" entry:
 * every cohort line pooled and shuffled once at load for quick-fire practice.
 */

const GENERATION_GROUP = { id: 'generations', label: 'Generations' };
const ALL_CATEGORY_ID = 'generations-all';
const MIX_CATEGORY_ID = 'generations-mix';

const COHORTS = [
  {
    id: 'boomers',
    label: 'Boomers (1946–1954)',
    shortLabel: 'Boomers',
    emoji: '🎸',
    tip: 'classic cinema, rock & folk',
    keywords: ['love', 'answer', 'wind', 'times', 'suspects', 'gin joints', 'plastics',
      'Robinson', 'hills', 'music', 'leap', 'mankind', 'Beatles', 'Dylan'],
    starters: ['All you need is love.', 'Let it be.', "The answer, my friend, is blowin' in the wind."],
    items: [
      { text: 'All you need is love.', source: 'The Beatles · 1967', medium: 'song', ja: '必要なのは愛だけだ。' },
      { text: 'Let it be.', source: 'The Beatles · 1970', medium: 'song', ja: 'なすがままに。' },
      { text: "The times they are a-changin'.", source: 'Bob Dylan · 1964', medium: 'song', ja: '時代は変わりつつある。' },
      { text: "The answer, my friend, is blowin' in the wind.", source: 'Bob Dylan · 1963', medium: 'song', ja: '友よ、答えは風に吹かれている。' },
      { text: 'Round up the usual suspects.', source: 'Casablanca · 1942', medium: 'movie', ja: 'いつもの容疑者を集めろ。' },
      { text: 'Of all the gin joints in all the towns in all the world, she walks into mine.', source: 'Casablanca · 1942', medium: 'movie', ja: '世界中のすべての町のすべてのバーの中で、彼女は私の店にやって来た。' },
      { text: 'I just want to say one word to you. Just one word: plastics.', source: 'The Graduate · 1967', medium: 'movie', ja: '君に一言だけ言いたい。プラスチックだ。' },
      { text: "Here's to you, Mrs. Robinson.", source: 'Simon & Garfunkel · 1968', medium: 'song', ja: 'ミセス・ロビンソンに乾杯。' },
      { text: 'The hills are alive with the sound of music.', source: 'The Sound of Music · 1965', medium: 'song', ja: '音楽の音とともに山々は生きている。' },
      { text: 'One small step for man, one giant leap for mankind.', source: 'Apollo 11 · 1969', medium: 'movie', ja: '人間にとっては小さな一歩、人類にとっては偉大な飛躍。' }
    ]
  },
  {
    id: 'gen-jones',
    label: 'Gen Jones (1955–1964)',
    shortLabel: 'Gen Jones',
    emoji: '🎬',
    tip: 'new wave, arena rock, late-70s film',
    keywords: ['real life', 'fantasy', 'lack of faith', 'try', 'red light', 'S.O.S.',
      'war', 'yellow ribbon', 'oak tree', 'Grease', 'Queen', 'Star Wars', 'Police', 'Journey'],
    starters: ['Is this the real life?', 'Do or do not. There is no try.', 'Grease is the word.'],
    items: [
      { text: 'Is this the real life? Is this just fantasy?', source: 'Queen · 1975', medium: 'song', ja: 'これは現実？それともただの幻想？' },
      { text: "Don't stop me now, 'cause I'm having a good time.", source: 'Queen · 1978', medium: 'song', ja: '止めないで、今すごく楽しいんだ。' },
      { text: 'I find your lack of faith disturbing.', source: 'Star Wars · 1977', medium: 'movie', ja: 'お前の信仰心の欠如は気に障る。' },
      { text: 'Do or do not. There is no try.', source: 'Star Wars · 1980', medium: 'movie', ja: 'やるか、やらないかだ。試すというのはない。' },
      { text: "Roxanne, you don't have to put on the red light.", source: 'The Police · 1978', medium: 'song', ja: 'ロクサーヌ、赤い灯をつける必要はない。' },
      { text: 'Sending out an S.O.S.', source: 'The Police · 1979', medium: 'song', ja: 'SOSを送っている。' },
      { text: "Any way you want it, that's the way you need it.", source: 'Journey · 1980', medium: 'song', ja: '君が望むやり方でいい。' },
      { text: "Someday this war's gonna end.", source: 'Apocalypse Now · 1979', medium: 'movie', ja: 'いつかこの戦争は終わる。' },
      { text: "Tie a yellow ribbon 'round the ole oak tree.", source: 'Tony Orlando & Dawn · 1973', medium: 'song', ja: '古い樫の木に黄色いリボンを結んで。' },
      { text: 'Grease is the word.', source: 'Grease · 1978', medium: 'song', ja: 'グリースこそすべて。' }
    ]
  }
];

// Gen X (~1965–1980): 80s/90s cinema, grunge & alt-rock.
COHORTS.push(
  {
    id: 'gen-x',
    label: 'Gen X (1965–1980)',
    shortLabel: 'Gen X',
    emoji: '📼',
    tip: '80s/90s cinema, grunge & alt-rock',
    keywords: ['live', 'vista', 'lights', 'whine', 'cheese', 'roads', 'spoon',
      'kung fu', 'phone home', 'truth', 'Nirvana', 'Green Day', 'Matrix', 'Terminator'],
    starters: ['Come with me if you want to live.', 'There is no spoon.', 'Royale with cheese.'],
    items: [
      { text: 'Come with me if you want to live.', source: 'Terminator 2 · 1991', medium: 'movie', ja: '生きたいならついて来い。' },
      { text: 'Hasta la vista, baby.', source: 'Terminator 2 · 1991', medium: 'movie', ja: 'またな、ベイビー。' },
      { text: "With the lights out, it's less dangerous.", source: 'Nirvana · 1991', medium: 'song', ja: '明かりを消せば、危険は少ない。' },
      { text: 'Do you have the time to listen to me whine?', source: 'Green Day · 1994', medium: 'song', ja: '僕の愚痴を聞く時間はある？' },
      { text: 'Royale with cheese.', source: 'Pulp Fiction · 1994', medium: 'movie', ja: 'ロワイヤル・ウィズ・チーズ。' },
      { text: "Where we're going, we don't need roads.", source: 'Back to the Future · 1985', medium: 'movie', ja: 'これから行く所に道はいらない。' },
      { text: 'There is no spoon.', source: 'The Matrix · 1999', medium: 'movie', ja: 'スプーンは存在しない。' },
      { text: 'I know kung fu.', source: 'The Matrix · 1999', medium: 'movie', ja: 'カンフーを覚えた。' },
      { text: 'E.T. phone home.', source: 'E.T. the Extra-Terrestrial · 1982', medium: 'movie', ja: 'E.T.、家に電話する。' },
      { text: "You can't handle the truth!", source: 'A Few Good Men · 1992', medium: 'movie', ja: 'お前には真実に耐えられない！' }
    ]
  },
  {
    id: 'millennials',
    label: 'Millennials (1981–1996)',
    shortLabel: 'Millennials',
    emoji: '💿',
    tip: 'late-90s & 2000s pop culture',
    keywords: ['king of the world', 'heart', 'again', 'pink', 'sit with us', 'Mordor',
      'pass', 'lose yourself', 'friends', 'dead people', 'Titanic', 'Eminem', 'Nemo', 'Mean Girls'],
    starters: ["I'm the king of the world!", 'You shall not pass!', 'On Wednesdays we wear pink.'],
    items: [
      { text: "I'm the king of the world!", source: 'Titanic · 1997', medium: 'movie', ja: '私は世界の王だ！' },
      { text: 'My heart will go on.', source: 'Céline Dion · Titanic · 1997', medium: 'song', ja: '私の心は生き続ける。' },
      { text: 'Oops, I did it again.', source: 'Britney Spears · 2000', medium: 'song', ja: 'あら、またやっちゃった。' },
      { text: 'On Wednesdays we wear pink.', source: 'Mean Girls · 2004', medium: 'movie', ja: '水曜日はピンクを着るの。' },
      { text: "You can't sit with us.", source: 'Mean Girls · 2004', medium: 'movie', ja: '私たちと一緒には座れないよ。' },
      { text: 'One does not simply walk into Mordor.', source: 'The Lord of the Rings · 2001', medium: 'movie', ja: 'モルドールにただ歩いて入ることはできない。' },
      { text: 'You shall not pass!', source: 'The Lord of the Rings · 2001', medium: 'movie', ja: 'ここを通すわけにはいかない！' },
      { text: 'Lose yourself in the music, the moment.', source: 'Eminem · 2002', medium: 'song', ja: '音楽とその瞬間に身をゆだねろ。' },
      { text: 'Fish are friends, not food.', source: 'Finding Nemo · 2003', medium: 'movie', ja: '魚は友達、食べ物じゃない。' },
      { text: 'I see dead people.', source: 'The Sixth Sense · 1999', medium: 'movie', ja: '死んだ人が見える。' }
    ]
  }
);


// Gen Z (~1997–2012): 2010s hits, streaming series & MCU culture.
COHORTS.push(
  {
    id: 'gen-z',
    label: 'Gen Z (1997–2012)',
    shortLabel: 'Gen Z',
    emoji: '📱',
    tip: '2010s hits, MCU & streaming',
    keywords: ['inevitable', 'Iron Man', 'endgame', 'bad guy', 'made for', 'gentle',
      'good night', 'leap of faith', 'mask', 'brutal', 'Avengers', 'Billie Eilish',
      'Taylor Swift', 'Spider-Verse'],
    starters: ['I am inevitable.', "I'm the bad guy.", 'Anyone can wear the mask.'],
    items: [
      { text: 'I am inevitable.', source: 'Avengers: Endgame · 2019', medium: 'movie', ja: '私は避けられない存在だ。' },
      { text: 'And I am Iron Man.', source: 'Avengers: Endgame · 2019', medium: 'movie', ja: 'そして私はアイアンマンだ。' },
      { text: "We're in the endgame now.", source: 'Avengers: Infinity War · 2018', medium: 'movie', ja: 'もう最終局面だ。' },
      { text: "I'm the bad guy.", source: 'Billie Eilish · 2019', medium: 'song', ja: '私は悪者よ。' },
      { text: 'What was I made for?', source: 'Billie Eilish · 2023', medium: 'song', ja: '私は何のために作られたの？' },
      { text: 'Do not go gentle into that good night.', source: 'Interstellar · 2014', medium: 'movie', ja: 'その良き夜に静かに身をゆだねるな。' },
      { text: "It's a leap of faith.", source: 'Spider-Man: Into the Spider-Verse · 2018', medium: 'movie', ja: 'それは信じる一跳びだ。' },
      { text: 'Anyone can wear the mask.', source: 'Spider-Man: Into the Spider-Verse · 2018', medium: 'movie', ja: '誰でもマスクをかぶれる。' },
      { text: "It's brutal out here.", source: 'Olivia Rodrigo · 2021', medium: 'song', ja: 'ここは残酷だ。' },
      { text: "It's me, hi, I'm the problem, it's me.", source: 'Taylor Swift · 2022', medium: 'song', ja: '私よ、こんにちは、問題は私なの。' }
    ]
  },
  {
    id: 'gen-alpha',
    label: 'Gen Alpha (2013+)',
    shortLabel: 'Gen Alpha',
    emoji: '🧸',
    tip: 'viral animated lines & current hooks',
    keywords: ['let it go', 'snowman', 'Bruno', 'miracle', 'Mario', 'Mamma mia',
      'the way', 'sky meets the sea', 'Baby Shark', 'Frozen', 'Encanto', 'Moana'],
    starters: ['Let it go, let it go.', "We don't talk about Bruno.", "It's-a me, Mario!"],
    items: [
      { text: 'Let it go, let it go.', source: 'Frozen · 2013', medium: 'song', ja: 'ありのままに、ありのままに。' },
      { text: 'Do you want to build a snowman?', source: 'Frozen · 2013', medium: 'song', ja: '雪だるまを作らない？' },
      { text: "We don't talk about Bruno.", source: 'Encanto · 2021', medium: 'song', ja: 'ブルーノの話はしない。' },
      { text: 'Waiting on a miracle.', source: 'Encanto · 2021', medium: 'song', ja: '奇跡を待っている。' },
      { text: "It's-a me, Mario!", source: 'The Super Mario Bros. Movie · 2023', medium: 'movie', ja: 'マリオだよ！' },
      { text: 'Mamma mia!', source: 'The Super Mario Bros. Movie · 2023', medium: 'movie', ja: 'マンマ・ミーア！' },
      { text: 'We know the way.', source: 'Moana · 2016', medium: 'song', ja: '僕たちは道を知っている。' },
      { text: 'See the line where the sky meets the sea? It calls me.', source: 'Moana · 2016', medium: 'song', ja: '空と海が出会う線が見える？それが私を呼んでいる。' },
      { text: 'This is the way.', source: 'The Mandalorian · 2019', medium: 'movie', ja: 'これが道だ。' },
      { text: 'Baby Shark, doo doo doo doo doo doo.', source: 'Pinkfong · 2016', medium: 'song', ja: 'ベイビーシャーク、ドゥドゥドゥドゥドゥドゥ。' }
    ]
  }
);

/** Fisher–Yates shuffle on a copy (Math.random is fine: order is cosmetic). */
function shuffled(list) {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Every cohort line, tagged with its cohort so mixed pools stay traceable. */
function pooledItems() {
  return COHORTS.flatMap((cohort) => cohort.items.map((item) => ({
    text: item.text,
    source: `${item.source} · ${cohort.shortLabel}`,
    medium: item.medium,
    ja: item.ja,
    cohort: cohort.shortLabel
  })));
}

/**
 * A cohort pools films and songs, so its category-level `medium` is the
 * majority medium (descriptive metadata for the picker). Exact filtering is
 * done per sentence through `item.medium`.
 */
function dominatingMedium(items) {
  const counts = items.reduce((acc, item) => {
    acc[item.medium] = (acc[item.medium] || 0) + 1;
    return acc;
  }, {});
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
}

function pooledMedia() {
  return [...new Set(COHORTS.flatMap((cohort) => cohort.items.map((item) => item.medium)))];
}

const ALL_CATEGORY = {
  group: GENERATION_GROUP.id,
  label: 'All Generations (Combined)',
  shortLabel: 'All Generations',
  emoji: '🌍',
  tip: 'every cohort in release order',
  combined: true,
  medium: pooledMedia().length > 1 ? 'mixed' : pooledMedia()[0],
  keywords: [...new Set(COHORTS.flatMap((cohort) => cohort.keywords))].slice(0, 40),
  starters: COHORTS.flatMap((cohort) => cohort.starters).slice(0, 3),
  items: pooledItems()
};

const MIX_CATEGORY = {
  group: GENERATION_GROUP.id,
  label: 'Shuffle / Mix Generations',
  shortLabel: 'Shuffle / Mix',
  emoji: '🎲',
  tip: 'quick-fire mixed-era lines',
  mix: true,
  medium: 'mixed',
  keywords: [...new Set(COHORTS.flatMap((cohort) => cohort.keywords))].slice(0, 40),
  starters: shuffled(pooledItems()).slice(0, 3).map((item) => item.text),
  // Pooled + shuffled once at load: a fresh server start re-rolls the order.
  items: shuffled(pooledItems())
};

/** LIBRARY-shaped entry (the builder in src/scenarios.js consumes this). */
function toLibraryEntry(cohort) {
  return {
    group: GENERATION_GROUP.id,
    label: cohort.label,
    shortLabel: cohort.shortLabel,
    emoji: cohort.emoji,
    tip: cohort.tip,
    medium: dominatingMedium(cohort.items),
    media: [...new Set(cohort.items.map((item) => item.medium))],
    keywords: cohort.keywords,
    starters: cohort.starters,
    items: cohort.items
  };
}

const GENERATION_CATEGORIES = {
  [ALL_CATEGORY_ID]: ALL_CATEGORY,
  ...Object.fromEntries(COHORTS.map((cohort) => [cohort.id, toLibraryEntry(cohort)])),
  [MIX_CATEGORY_ID]: MIX_CATEGORY
};

module.exports = {
  GENERATION_GROUP,
  ALL_CATEGORY_ID,
  MIX_CATEGORY_ID,
  COHORTS,
  ALL_CATEGORY,
  MIX_CATEGORY,
  GENERATION_CATEGORIES
};

