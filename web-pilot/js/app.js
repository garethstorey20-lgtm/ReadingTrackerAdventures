// Background stars
(function makeStars() {
  const c = document.getElementById('stars');
  for (let i=0; i<60; i++) {
    const s = document.createElement('div');
    s.className = 'star';
    s.style.width = (Math.random()*3+1) + 'px';
    s.style.height = s.style.width;
    s.style.left = Math.random()*100 + '%';
    s.style.top = Math.random()*100 + '%';
    s.style.animationDelay = (Math.random()*3) + 's';
    c.appendChild(s);
  }
})();

const CHALLENGE_ROUNDS = 12;
const CATCH_ROUND_SEC = 7;
const CATCH_MAX_LIVES = 5;
const STARCADE_GAME_COST = 6;
const STARCADE_TRACK_BONUS = 50;
const STARCADE_WIN_BONUS = 3;
const TREASURE_SCORE_BONUS_THRESHOLD = 150;
const READING_GAME_PERFECT_BONUS = 5;
const FLASH_AUDIO_GAP_MS = 2000;
const SOUND_BOX_AUDIO_GAP_MS = 1000;
const SOUND_BOX_BLEND_STAGGER_MS = 100;
const HW_BOX_HINT_MS = 3000;
const GAME_ANSWER_FONT = "'Andika', 'Sassoon Primary', 'Comic Sans MS', system-ui, sans-serif";
const TRACK_GAME_IDS = ['gpcMatch', 'gpcCatch', 'soundFlip', 'soundBox', 'hwHunt', 'hwBlank', 'hwBoxes', 'flash'];

const state = {
  data: null,
  classKey: null,
  view: 'upload',
  selectedStudent: null,
  game: null,
  passwords: {},
  studentPoints: {},
  flashResults: {},
  flashSetProgress: {},
  flashHub: null,
  gamePlayed: {},
  teacherPassword: 'Teacher123',
  arcade: null,
  arcadeGame: null,
  /** Per-student shuffle decks for answer cycling across games in one session. */
  focusCycleDecks: {},
};
window.adventuresAppState = state;

function $(id){return document.getElementById(id);}

// ============================================================
// SOUND EFFECTS (synthesised — for game button feedback only)
// ============================================================
let _audioCtx = null;
function _getAudioCtx() {
  if (_audioCtx) {
    if (_audioCtx.state === 'suspended') { try { _audioCtx.resume(); } catch(e){} }
    return _audioCtx;
  }
  try {
    _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  } catch(e) { return null; }
  return _audioCtx;
}
function sfxClick() {
  const ctx = _getAudioCtx();
  if (!ctx) return;
  try {
    const now = ctx.currentTime;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'triangle';
    o.frequency.setValueAtTime(880, now);
    o.frequency.exponentialRampToValueAtTime(440, now + 0.06);
    g.gain.setValueAtTime(0.0001, now);
    g.gain.linearRampToValueAtTime(0.07, now + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.09);
    o.connect(g); g.connect(ctx.destination);
    o.start(now); o.stop(now + 0.12);
  } catch(e){}
}
function sfxSplat() {
  const ctx = _getAudioCtx();
  if (!ctx) return;
  try {
    const now = ctx.currentTime;
    const dur = 0.35;
    const bufferSize = Math.floor(ctx.sampleRate * dur);
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      const decay = Math.pow(1 - i/bufferSize, 1.6);
      data[i] = (Math.random() * 2 - 1) * decay;
    }
    const noise = ctx.createBufferSource();
    noise.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(900, now);
    filter.frequency.exponentialRampToValueAtTime(120, now + dur);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.55, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + dur);
    noise.connect(filter); filter.connect(gain); gain.connect(ctx.destination);
    const o = ctx.createOscillator();
    const og = ctx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(120, now);
    o.frequency.exponentialRampToValueAtTime(50, now + 0.2);
    og.gain.setValueAtTime(0.0001, now);
    og.gain.linearRampToValueAtTime(0.35, now + 0.01);
    og.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
    o.connect(og); og.connect(ctx.destination);
    noise.start(now);
    o.start(now); o.stop(now + 0.3);
  } catch(e){}
}

// ============================================================
// AUDIO — class JSON first (personalised), then bundled master GPC library.
// ============================================================
function resolveImportedAudioEntry(entry, depth = 0, seen = null) {
  if (!entry || depth > 5) return null;
  if (typeof entry === 'string') return entry;
  if (entry.data && typeof entry.data === 'string') return entry.data;

  if (entry.ref && typeof entry.ref === 'object') {
    const ref = entry.ref;
    const refClass = ref.className;
    const refType = ref.type;
    const refLabel = ref.label;
    if (!refClass || !refType || !refLabel) return null;

    const key = `${refClass}:${refType}:${refLabel}`;
    if (!seen) seen = new Set();
    if (seen.has(key)) return null;
    seen.add(key);

    const refCls = state.data?.classes?.[refClass];
    const refMap = refCls?.audio?.[refType];
    const refEntry = refMap?.[refLabel];
    return resolveImportedAudioEntry(refEntry, depth + 1, seen);
  }

  return null;
}

function getClassAudioSource(text) {
  if (!state.data || !state.classKey) return null;
  const cls = state.data.classes[state.classKey];
  if (!cls?.audio) return null;
  const sources = [cls.audio.gpc, cls.audio.hw, cls.audio.heartWords, cls.audio.heart];
  for (const src of sources) {
    if (src?.[text]) {
      const resolved = resolveImportedAudioEntry(src[text]);
      if (resolved) return resolved;
    }
  }
  return null;
}

function normalizeMasterAudioKey(text) {
  return String(text ?? '').trim().toLowerCase()
    .replaceAll('a-e', 'a_e')
    .replaceAll('o-e', 'o_e')
    .replaceAll('i-e', 'i_e')
    .replaceAll('e-e', 'e_e')
    .replaceAll('u-e', 'u_e');
}

/** Bundled default GPC clips (data/master-gpc-audio.js). */
function getMasterGpcAudioSource(text) {
  const bank = window.__MASTER_GPC_AUDIO__;
  if (!bank) return null;
  const raw = String(text ?? '').trim();
  if (!raw) return null;
  const keys = [normalizeMasterAudioKey(raw), raw, raw.toLowerCase()];
  for (const key of keys) {
    const entry = bank[key];
    if (!entry) continue;
    if (typeof entry === 'string') return entry;
    if (entry.data && typeof entry.data === 'string') return entry.data;
  }
  return null;
}

function getAudioSource(text) {
  return getClassAudioSource(text) || getMasterGpcAudioSource(text);
}
function hasAudio(text) { return !!getAudioSource(text); }

/** Listen button — always plays when the user taps 🔊. */
function playTargetListen(text) {
  if (text) speak(text);
}

/**
 * Auto-play policy (reading games): once when the target is first shown (not Word Challenge),
 * once when the learner answers correctly. Wrong/timeout does not auto-play.
 */
function playTargetOnShow(g, text) {
  if (!text || !hasAudio(text) || !g || g._spoken) return;
  g._spoken = true;
  speak(text);
}

function playTargetOnCorrect(g, text) {
  if (!text || !hasAudio(text) || !g || g._spokenCorrect) return;
  g._spokenCorrect = true;
  speak(text);
}

/** Self Check: wait at least 2s after previous clip before auto-playing the next card. */
function playFlashTargetOnShow(g, text) {
  if (!text || !hasAudio(text) || !g || g._spoken) return;
  g._spoken = true;
  const gapWait = Math.max(0, _lastAudioEndAt + FLASH_AUDIO_GAP_MS - Date.now());
  const delay = Math.max(300, gapWait);
  setTimeout(() => speak(text), delay);
}

function getGameProgressText(g) {
  if (!g || g.finished) return '';
  if (g.type === 'flash') {
    const total = g.cards?.length || 0;
    return total ? `${g.cardIdx}/${total}` : '';
  }
  if (g.type === 'gpcCatch') {
    if (g.catchPhase !== 'play') return '';
    const total = g.correctNeeded || CHALLENGE_ROUNDS;
    return `${Math.min(g.correct, total)}/${total}`;
  }
  const total = g.totalRounds || CHALLENGE_ROUNDS;
  return `${Math.min(g.roundIdx, total)}/${total}`;
}

function renderGameProgressPill(g) {
  const text = getGameProgressText(g);
  if (!text) return '';
  return `<div class="game-progress-pill" aria-label="Progress ${text}">${text}</div>`;
}

function renderGameTopBar(g, { backOnclick = 'quitToProfile()', backLabel = '← Quit' } = {}) {
  return `<div class="game-top-bar">
    <button type="button" onclick="${backOnclick}" class="text-white/70 hover:text-white text-sm">${backLabel}</button>
    ${renderGameProgressPill(g)}
  </div>`;
}

function spawnPerfectStarBurst() {
  const cx = window.innerWidth * 0.5;
  const cy = window.innerHeight * 0.38;
  for (let i = 0; i < READING_GAME_PERFECT_BONUS; i++) {
    const el = document.createElement('div');
    el.className = 'perfect-star-burst';
    el.textContent = '⭐';
    el.style.left = `${cx + (i - 2) * 36}px`;
    el.style.top = `${cy}px`;
    el.style.animationDelay = `${i * 0.12}s`;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 1800);
  }
}

function resetTargetAudioFlags(g) {
  if (!g) return;
  g._spoken = false;
  g._spokenCorrect = false;
}

let _lastAudioEndAt = 0;

function speak(text) {
  const audioData = getAudioSource(text);
  if (audioData) {
    try {
      const audio = new Audio(audioData);
      const markEnd = () => { _lastAudioEndAt = Date.now(); };
      audio.addEventListener('ended', markEnd);
      audio.addEventListener('error', markEnd);
      audio.play().catch(markEnd);
      return true;
    } catch (e) {}
  }
  return false;
}
function correctSound(){}
function wrongSound(){}
function celebrateSound(){}

function shuffle(arr){ const a=[...arr]; for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];} return a; }

// ============================================================
// HEART WORD SENTENCES
// ============================================================
const HW_SENTENCES = {
  'the': [
    {s: '_____ sun is hot.', d: ['is','am','do']},
    {s: 'Look at _____ moon.', d: ['was','go','am']},
    {s: 'I sit on _____ chair.', d: ['said','can','is']}
  ],
  'a': [
    {s: 'It is _____ dog.', d: ['said','go','was']},
    {s: 'I have _____ hat.', d: ['was','is','of']},
    {s: 'She is _____ girl.', d: ['can','was','do']}
  ],
  'I': [
    {s: '_____ am six.', d: ['the','of','and']},
    {s: '_____ can run fast.', d: ['was','the','and']},
    {s: '_____ like cake.', d: ['the','was','an']}
  ],
  'to': [
    {s: 'I am going _____ school.', d: ['is','am','was']},
    {s: 'Give it _____ me.', d: ['is','was','do']},
    {s: 'Go _____ bed now.', d: ['is','am','of']}
  ],
  'is': [
    {s: 'She _____ here.', d: ['the','and','of']},
    {s: 'It _____ red.', d: ['the','an','of']},
    {s: 'My cat _____ small.', d: ['the','and','of']}
  ],
  'and': [
    {s: 'Mum _____ dad are here.', d: ['is','was','to']},
    {s: 'Cat _____ dog play.', d: ['is','the','my']},
    {s: 'Up _____ down we go.', d: ['is','was','for']}
  ],
  'go': [
    {s: 'Let us _____ home now.', d: ['the','was','of']},
    {s: 'I will _____ to bed.', d: ['the','was','of']},
    {s: 'Can we _____ outside?', d: ['the','my','of']}
  ],
  'no': [
    {s: '_____ thank you.', d: ['is','was','for']},
    {s: 'There is _____ milk left.', d: ['is','was','for']},
    {s: 'Say _____ to him.', d: ['is','was','for']}
  ],
  'so': [
    {s: 'I am _____ happy today.', d: ['is','was','do']},
    {s: 'It was _____ cold outside.', d: ['is','and','to']},
    {s: 'You are _____ kind.', d: ['is','was','for']}
  ],
  'he': [
    {s: '_____ is my dad.', d: ['is','was','of']},
    {s: 'Where is _____?', d: ['is','was','of']},
    {s: '_____ ran fast.', d: ['is','was','of']}
  ],
  'she': [
    {s: '_____ is kind.', d: ['is','was','of']},
    {s: '_____ has a hat.', d: ['is','was','of']},
    {s: '_____ likes apples.', d: ['is','was','of']}
  ],
  'we': [
    {s: '_____ are friends.', d: ['is','was','of']},
    {s: '_____ went home.', d: ['is','was','of']},
    {s: '_____ can play now.', d: ['is','was','of']}
  ],
  'me': [
    {s: 'Come with _____.', d: ['is','was','do']},
    {s: 'Give it to _____.', d: ['is','was','do']},
    {s: 'Look at _____ now.', d: ['is','was','do']}
  ],
  'be': [
    {s: 'Try to _____ good.', d: ['the','my','of']},
    {s: 'I want to _____ tall.', d: ['the','my','of']},
    {s: "Don't _____ late.", d: ['the','my','of']}
  ],
  'my': [
    {s: 'This is _____ book.', d: ['is','was','do']},
    {s: '_____ cat is black.', d: ['is','was','do']},
    {s: 'Where is _____ bag?', d: ['is','was','do']}
  ],
  'you': [
    {s: 'How are _____?', d: ['is','was','of']},
    {s: 'I can see _____.', d: ['is','was','of']},
    {s: '_____ are very kind.', d: ['is','was','of']}
  ],
  'are': [
    {s: 'We _____ here.', d: ['the','my','of']},
    {s: 'They _____ happy.', d: ['the','my','of']},
    {s: 'You _____ smart.', d: ['the','my','of']}
  ],
  'was': [
    {s: 'It _____ fun.', d: ['the','my','and']},
    {s: 'He _____ at home.', d: ['the','my','and']},
    {s: 'The cake _____ sweet.', d: ['the','my','and']}
  ],
  'were': [
    {s: 'They _____ sad.', d: ['the','my','and']},
    {s: 'We _____ at school.', d: ['the','my','and']},
    {s: 'You _____ fast.', d: ['the','my','and']}
  ],
  'they': [
    {s: '_____ are kind.', d: ['is','was','of']},
    {s: '_____ went home.', d: ['is','was','of']},
    {s: '_____ play games.', d: ['is','was','of']}
  ],
  'have': [
    {s: 'I _____ a pet at home.', d: ['the','my','and']},
    {s: 'We _____ cake for tea.', d: ['the','my','and']},
    {s: 'You _____ a new hat.', d: ['the','my','and']}
  ],
  'has': [
    {s: 'He _____ a hat.', d: ['the','my','and']},
    {s: 'She _____ a dog.', d: ['the','my','and']},
    {s: 'It _____ a long tail.', d: ['the','my','and']}
  ],
  'said': [
    {s: 'He _____ hello to me.', d: ['the','my','and']},
    {s: 'She _____ yes please.', d: ['the','my','and']},
    {s: 'Mum _____ go to bed.', d: ['the','my','and']}
  ],
  'says': [
    {s: 'He _____ hi to us.', d: ['the','my','and']},
    {s: 'She _____ no thanks.', d: ['the','my','and']},
    {s: 'Dad _____ stop now.', d: ['the','my','and']}
  ],
  'for': [
    {s: 'This is _____ you.', d: ['is','was','do']},
    {s: 'Wait _____ me here.', d: ['is','was','do']},
    {s: 'Cake _____ tea.', d: ['is','was','do']}
  ],
  'with': [
    {s: 'Come _____ me now.', d: ['is','was','do']},
    {s: 'Play _____ us today.', d: ['is','was','do']},
    {s: 'Tea _____ milk please.', d: ['is','was','do']}
  ],
  'of': [
    {s: 'A cup _____ tea.', d: ['is','was','do']},
    {s: 'Lots _____ fun.', d: ['is','was','do']},
    {s: 'Top _____ the hill.', d: ['is','was','do']}
  ],
  'his': [
    {s: 'That is _____ hat.', d: ['is','was','do']},
    {s: '_____ dog is big.', d: ['is','was','do']},
    {s: '_____ name is Tom.', d: ['is','was','do']}
  ],
  'her': [
    {s: 'Give it to _____.', d: ['is','was','do']},
    {s: 'I see _____ book.', d: ['is','was','do']},
    {s: '_____ mum is here.', d: ['is','was','do']}
  ],
  'do': [
    {s: 'What can I _____?', d: ['is','was','the']},
    {s: '_____ you like cake?', d: ['is','was','the']},
    {s: 'I _____ not know.', d: ['is','was','the']}
  ],
  'does': [
    {s: 'He _____ his best.', d: ['is','was','the']},
    {s: '_____ it work?', d: ['is','was','the']},
    {s: 'She _____ like it.', d: ['is','was','the']}
  ],
  'put': [
    {s: '_____ it down here.', d: ['is','was','the']},
    {s: 'Where do I _____ it?', d: ['is','was','the']},
    {s: 'I _____ on a hat.', d: ['is','was','the']}
  ],
  'one': [
    {s: 'I have just _____ pet.', d: ['is','was','do']},
    {s: '_____ more sleep!', d: ['is','was','do']},
    {s: 'Just _____ ball please.', d: ['is','was','do']}
  ],
  'two': [
    {s: 'I have _____ pets.', d: ['is','was','do']},
    {s: "It is _____ o'clock.", d: ['is','was','do']},
    {s: 'I see _____ red balls.', d: ['is','was','do']}
  ],
  'all': [
    {s: '_____ done now!', d: ['is','was','the']},
    {s: 'We _____ ran fast.', d: ['is','was','the']},
    {s: '_____ the kids played.', d: ['is','was','do']}
  ],
  'who': [
    {s: '_____ are you?', d: ['is','was','the']},
    {s: '_____ is at the door?', d: ['is','was','the']},
    {s: '_____ has my hat?', d: ['is','was','the']}
  ],
  'when': [
    {s: '_____ can we go?', d: ['is','was','the']},
    {s: '_____ is dinner?', d: ['is','was','the']},
    {s: '_____ did you come?', d: ['is','was','the']}
  ],
  'where': [
    {s: '_____ are you?', d: ['is','was','the']},
    {s: '_____ is my bag?', d: ['is','was','the']},
    {s: '_____ do you live?', d: ['is','was','the']}
  ],
  'what': [
    {s: '_____ is that?', d: ['is','was','the']},
    {s: '_____ time is it?', d: ['is','was','the']},
    {s: '_____ a great day!', d: ['is','was','the']}
  ],
  'why': [
    {s: '_____ are you sad?', d: ['is','was','the']},
    {s: '_____ did it fall?', d: ['is','was','the']},
    {s: '_____ not have one?', d: ['is','was','the']}
  ],
  'come': [
    {s: 'Please _____ here.', d: ['the','my','of']},
    {s: '_____ with me now.', d: ['the','my','of']},
    {s: 'Can you _____ and play?', d: ['the','my','of']}
  ],
  'some': [
    {s: 'I want _____ cake.', d: ['is','was','do']},
    {s: 'Give me _____ please.', d: ['is','was','do']},
    {s: '_____ of them ran.', d: ['is','was','do']}
  ],
  'there': [
    {s: 'It is over _____.', d: ['is','was','do']},
    {s: 'Look _____ now!', d: ['is','was','do']},
    {s: '_____ is my hat.', d: ['is','was','do']}
  ],
  'their': [
    {s: 'That is _____ ball.', d: ['is','was','do']},
    {s: '_____ dog is big.', d: ['is','was','do']},
    {s: 'I see _____ house.', d: ['is','was','do']}
  ],
  'here': [
    {s: 'Come _____ to me.', d: ['is','was','do']},
    {s: '_____ I am, mum.', d: ['is','was','do']},
    {s: '_____ is the book.', d: ['is','was','do']}
  ],
  'like': [
    {s: 'I _____ cake.', d: ['the','my','and']},
    {s: 'They _____ to play.', d: ['the','my','and']},
    {s: 'Do you _____ pizza?', d: ['the','my','and']}
  ],
  'love': [
    {s: 'I _____ my mum.', d: ['the','my','and']},
    {s: 'We _____ pizza.', d: ['the','my','and']},
    {s: '_____ is kind.', d: ['the','my','and']}
  ],
  'see': [
    {s: 'I can _____ it.', d: ['the','my','and']},
    {s: 'Can you _____ the cat?', d: ['the','my','and']},
    {s: 'Did you _____ that?', d: ['the','my','and']}
  ],
  'play': [
    {s: 'Let us _____ now.', d: ['the','my','and']},
    {s: 'I _____ ball at home.', d: ['the','my','and']},
    {s: 'Can we _____ here?', d: ['the','my','and']}
  ],
  'on': [
    {s: 'Sit _____ the chair.', d: ['is','was','do']},
    {s: 'Put it _____ the table.', d: ['is','was','do']},
    {s: 'Get _____ the bus.', d: ['is','was','do']}
  ],
  'in': [
    {s: 'Come _____ please.', d: ['is','was','do']},
    {s: 'It is _____ the box.', d: ['is','was','do']},
    {s: 'Get _____ the car.', d: ['is','was','do']}
  ],
  'out': [
    {s: 'Get _____ of bed.', d: ['is','was','do']},
    {s: 'Go _____ to play.', d: ['is','was','do']},
    {s: 'Take it _____ please.', d: ['is','was','do']}
  ],
  'up': [
    {s: 'Look _____ at the sky!', d: ['is','was','do']},
    {s: 'Go _____ the stairs.', d: ['is','was','do']},
    {s: 'Stand _____ now.', d: ['is','was','do']}
  ],
  'down': [
    {s: 'Sit _____ here.', d: ['is','was','do']},
    {s: 'Fall _____ slowly.', d: ['is','was','do']},
    {s: 'Look _____ at the floor.', d: ['is','was','do']}
  ],
  'this': [
    {s: '_____ is fun.', d: ['and','my','for']},
    {s: 'Take _____ home.', d: ['and','my','for']},
    {s: '_____ way please.', d: ['and','my','for']}
  ],
  'that': [
    {s: '_____ is mine.', d: ['and','my','for']},
    {s: 'Look at _____.', d: ['and','my','for']},
    {s: '_____ is good.', d: ['and','my','for']}
  ],
  'then': [
    {s: 'And _____ we ran.', d: ['is','was','do']},
    {s: 'See you _____.', d: ['is','was','do']},
    {s: '_____ what happened?', d: ['is','was','do']}
  ],
  'than': [
    {s: 'Bigger _____ me.', d: ['is','was','do']},
    {s: 'More _____ five.', d: ['is','was','do']},
    {s: 'Faster _____ you.', d: ['is','was','do']}
  ],
  'into': [
    {s: 'Jump _____ the pool.', d: ['is','was','do']},
    {s: 'Look _____ the box.', d: ['is','was','do']},
    {s: 'Go _____ the room.', d: ['is','was','do']}
  ],
  'from': [
    {s: 'I am _____ here.', d: ['is','was','do']},
    {s: 'A gift _____ mum.', d: ['is','was','do']},
    {s: 'Run _____ the dog.', d: ['is','was','do']}
  ],
  'your': [
    {s: 'Where is _____ bag?', d: ['is','was','do']},
    {s: '_____ turn now.', d: ['is','was','do']},
    {s: 'Is this _____?', d: ['is','was','do']}
  ],
  'our': [
    {s: '_____ class is fun.', d: ['is','was','do']},
    {s: 'This is _____ home.', d: ['is','was','do']},
    {s: '_____ team won.', d: ['is','was','do']}
  ],
  'an': [
    {s: 'I have _____ apple.', d: ['is','was','do']},
    {s: '_____ ant ran by.', d: ['is','was','do']},
    {s: '_____ egg on toast.', d: ['is','was','do']}
  ],
  'or': [
    {s: 'Cake _____ ice cream?', d: ['the','my','do']},
    {s: 'Yes _____ no?', d: ['the','my','do']},
    {s: 'Sit _____ stand.', d: ['the','my','do']}
  ],
  'if': [
    {s: '_____ it rains, we stay in.', d: ['is','was','do']},
    {s: 'Tell me _____ you can.', d: ['is','was','do']},
    {s: 'See _____ it works.', d: ['is','was','do']}
  ],
  'because': [
    {s: 'I am happy _____ it is sunny.', d: ['the','my','was']},
    {s: 'We ran _____ we were late.', d: ['the','my','was']},
    {s: 'I sleep _____ I am tired.', d: ['the','my','was']}
  ],
};

/** Word type from CSV batches (verb/noun/adj/function/other) — used for distractor matching. */
const HW_WORD_TYPES = {};

function normalizeWordType(raw) {
  const t = String(raw ?? '').trim().toLowerCase();
  if (t === 'noun' || t === 'n') return 'noun';
  if (t === 'verb' || t === 'v') return 'verb';
  if (t === 'adj' || t === 'adjective' || t === 'ad') return 'adj';
  if (t === 'adverb' || t === 'adv') return 'adv';
  if (t === 'function' || t === 'func' || t === 'determiner' || t === 'pronoun'
    || t === 'preposition' || t === 'conjunction') return 'function';
  if (t === 'number' || t === 'num') return 'number';
  return t ? 'other' : '';
}

function getWordType(word) {
  const w = String(word).toLowerCase();
  const fromBank = normalizeWordType(HW_WORD_TYPES[w]);
  if (fromBank) return fromBank;
  const lv = LONG_VOWEL_WORD_INDEX[w];
  if (lv?.type) return normalizeWordType(lv.type);
  return '';
}

const HW_BLANK_FUNCTION_WORDS = ['the', 'and', 'is', 'was', 'are', 'to', 'a', 'he', 'she', 'we', 'you', 'they', 'it', 'my', 'our', 'in', 'on', 'at', 'for'];

/** Word Challenge distractors: other student focus words first, then common heart words. */
function pickBlankDistractors(target, pool, count = 3) {
  const t = String(target).toLowerCase();
  const targetType = getWordType(t);
  const others = shuffle(
    [...new Set(pool.map(w => String(w).toLowerCase()))].filter(w => {
      if (!w || w === t) return false;
      const wt = getWordType(w);
      if (targetType) return wt && wt !== targetType;
      return !!wt;
    })
  );
  const picks = others.slice(0, count);
  for (const f of HW_BLANK_FUNCTION_WORDS) {
    if (picks.length >= count) break;
    if (f !== t && !picks.includes(f)) picks.push(f);
  }
  return picks.slice(0, count);
}

/** Wrong answers use a different word type so they do not fit the sentence blank. */
function pickBlankDistractorsPreferType(target, pool, count = 3) {
  const t = String(target).toLowerCase();
  const targetType = getWordType(t);
  const poolWords = [...new Set(pool.map(w => String(w).toLowerCase()))].filter(w => w && w !== t && isValidGameToken(w));
  const picks = [];

  const addFrom = (words) => {
    for (const w of shuffle(words)) {
      if (picks.length >= count) break;
      if (!picks.includes(w)) picks.push(w);
    }
  };

  if (targetType) {
    addFrom(poolWords.filter(w => {
      const wt = getWordType(w);
      return wt && wt !== targetType;
    }));
    if (picks.length >= count) return picks.slice(0, count);

    const preferOrder = targetType === 'noun'
      ? ['verb', 'adj', 'function', 'adv', 'number', 'other']
      : targetType === 'verb'
        ? ['noun', 'adj', 'function', 'adv', 'number', 'other']
        : targetType === 'adj'
          ? ['noun', 'verb', 'function', 'adv', 'number', 'other']
          : ['noun', 'verb', 'adj', 'function', 'adv', 'other'];
    for (const prefer of preferOrder) {
      addFrom(poolWords.filter(w => getWordType(w) === prefer));
      if (picks.length >= count) break;
    }
    if (picks.length >= count) return picks.slice(0, count);
  }

  addFrom(HW_BLANK_FUNCTION_WORDS.filter(f => f !== t));
  if (picks.length >= count) return picks.slice(0, count);
  return pickBlankDistractors(target, pool, count);
}

/** Word Challenge option row: curated distractors + different-type fill from pool. */
function buildBlankChallengeOptions(target, curatedD, targetPool, needCount = 3) {
  const t = String(target ?? '').trim();
  if (!isValidGameToken(t)) return [];
  const tKey = t.toLowerCase();
  let distractors = uniqueValidTokens(curatedD).filter(w => w.toLowerCase() !== tKey);
  if (distractors.length < needCount) {
    for (const w of pickBlankDistractorsPreferType(t, targetPool, needCount)) {
      if (distractors.length >= needCount) break;
      const key = w.toLowerCase();
      if (key !== tKey && !distractors.map(d => d.toLowerCase()).includes(key)) distractors.push(w);
    }
  }
  const fallbacks = ['the', 'and', 'is', 'was', 'to', 'a', 'he', 'she', 'we', 'you'];
  for (const f of fallbacks) {
    if (distractors.length >= needCount) break;
    if (f !== tKey && !distractors.includes(f)) distractors.push(f);
  }
  return shuffle([t, ...distractors.slice(0, needCount)]);
}

function normalizeHwBlankSentence(s) {
  return String(s || '')
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/_{2,}/g, '_____');
}

/** Parse UTF-8 CSV (quoted fields, commas inside quotes). */
function parseCsvRows(text) {
  const raw = String(text).replace(/^\uFEFF/, '');
  const rows = [];
  let row = [];
  let cell = '';
  let inQuotes = false;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    const next = raw[i + 1];
    if (inQuotes) {
      if (ch === '"' && next === '"') { cell += '"'; i++; }
      else if (ch === '"') inQuotes = false;
      else cell += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n' || (ch === '\r' && next === '\n')) {
      if (ch === '\r') i++;
      row.push(cell);
      if (row.some(c => String(c).trim().length)) rows.push(row.map(c => String(c).trim()));
      row = []; cell = '';
    } else if (ch !== '\r') cell += ch;
  }
  row.push(cell);
  if (row.some(c => String(c).trim().length)) rows.push(row.map(c => String(c).trim()));
  return rows;
}

/**
 * Integrate one CSV batch into HW_SENTENCES + HW_WORD_TYPES.
 * @returns {{ added: number, updated: number, skipped: number }}
 */
function registerHwSentenceBatchCsv(csvText, batchLabel = 'batch') {
  const rows = parseCsvRows(csvText);
  if (rows.length < 2) return { added: 0, updated: 0, skipped: 0, label: batchLabel };
  const header = rows[0].map(h => h.toLowerCase().replace(/\s+/g, ''));
  const col = (name, alts = []) => {
    const keys = [name, ...alts].map(k => k.toLowerCase().replace(/\s+/g, ''));
    for (const k of keys) {
      const i = header.indexOf(k);
      if (i >= 0) return i;
    }
    return -1;
  };
  const iWord = col('word');
  const iType = col('type', ['wordtype', 'pos', 'partofspeech']);
  const iS1 = col('sentence1', ['sentence_1', 's1']);
  const iS2 = col('sentence2', ['sentence_2', 's2']);
  const iS3 = col('sentence3', ['sentence_3', 's3']);
  if (iWord < 0 || iS1 < 0) {
    console.warn('[Word Challenge] CSV missing word or sentence1 column:', batchLabel);
    return { added: 0, updated: 0, skipped: rows.length - 1, label: batchLabel };
  }
  let added = 0;
  let updated = 0;
  let skipped = 0;
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    const word = String(row[iWord] || '').trim().toLowerCase();
    if (!word) { skipped++; continue; }
    const typeRaw = iType >= 0 ? String(row[iType] || '').trim() : '';
    const type = normalizeWordType(typeRaw) || 'other';
    const sentences = [iS1, iS2, iS3]
      .filter(i => i >= 0)
      .map(i => normalizeHwBlankSentence(row[i]))
      .filter(s => s.length > 0 && /_____/.test(s));
    if (sentences.length === 0) { skipped++; continue; }
    const had = !!HW_SENTENCES[word];
    HW_WORD_TYPES[word] = type;
    HW_SENTENCES[word] = sentences.map(s => ({ s, d: null }));
    if (had) updated++;
    else added++;
  }
  console.info(`[Word Challenge] ${batchLabel}: +${added} new, ${updated} updated, ${skipped} skipped`);
  return { added, updated, skipped, label: batchLabel };
}

function applyHwSentenceCsvBatches() {
  const list = window.__HW_BATCH_CSV_LIST__ || [];
  let total = { added: 0, updated: 0, skipped: 0 };
  list.forEach((csv, i) => {
    const stats = registerHwSentenceBatchCsv(csv, `batch-${i + 1}`);
    total.added += stats.added;
    total.updated += stats.updated;
    total.skipped += stats.skipped;
  });
  if (list.length) console.info('[Word Challenge] Bank loaded:', total);
  return total;
}

/** US Fry spellings → British bank keys (same sentences). */
const HW_BLANK_ALIASES = { center: 'centre', toward: 'towards' };

/** Long A / E / O CSV word banks (gpc → example words, word → sentences). */
let GPC_LONG_VOWEL_BANK = { longA: {}, longE: {}, longO: {} };
let LONG_VOWEL_WORD_INDEX = {};

function longVowelSetForUnit(unitName) {
  const n = String(unitName || '').toLowerCase();
  if (n.includes('long a')) return 'longA';
  if (n.includes('long e')) return 'longE';
  if (n.includes('long o')) return 'longO';
  return null;
}

function applyLongVowelWordLists() {
  const data = window.__LONG_VOWEL_LISTS__;
  if (!data) return { words: 0 };
  GPC_LONG_VOWEL_BANK = { longA: {}, longE: {}, longO: {} };
  LONG_VOWEL_WORD_INDEX = {};
  const ingest = (setId, entries) => {
    for (const e of entries || []) {
      const word = String(e.word || '').toLowerCase();
      const gpc = String(e.gpc || '').trim();
      if (!isValidGameToken(word) || !gpc) continue;
      const gpcKey = normalizeGpcKey(gpc);
      if (!GPC_LONG_VOWEL_BANK[setId][gpcKey]) GPC_LONG_VOWEL_BANK[setId][gpcKey] = [];
      if (!GPC_LONG_VOWEL_BANK[setId][gpcKey].includes(word)) GPC_LONG_VOWEL_BANK[setId][gpcKey].push(word);
      LONG_VOWEL_WORD_INDEX[word] = { ...e, setId };
      const wType = normalizeWordType(e.type);
      if (wType) HW_WORD_TYPES[word] = wType;
      const sentences = (e.sentences || []).filter(s => s && /_____/.test(s));
      if (sentences.length && !HW_SENTENCES[word]) {
        HW_SENTENCES[word] = sentences.map(s => ({ s, d: null }));
      }
    }
  };
  ingest('longA', data.longA);
  ingest('longE', data.longE);
  ingest('longO', data.longO);
  const words = Object.keys(LONG_VOWEL_WORD_INDEX).length;
  if (words) console.info('[Long vowel lists] Loaded', words, 'words');
  return { words };
}

function normalizeGpcKey(gpc) {
  return String(gpc ?? '').trim().toLowerCase()
    .replaceAll('a-e', 'a_e')
    .replaceAll('o-e', 'o_e');
}

function findGpcNeedItem(gpc, needs) {
  const key = normalizeGpcKey(gpc);
  if (!key || !needs) return null;
  const matches = [...needs.targetGpcs, ...needs.masteredGpcs]
    .filter(x => normalizeGpcKey(x.gpc) === key);
  if (!matches.length) return null;
  const inTargets = matches.find(x =>
    needs.targetGpcs.some(t => t.unitIdx === x.unitIdx && normalizeGpcKey(t.gpc) === key)
  );
  return inTargets || matches[0];
}

function pickLongVowelGpcExample(gpc, unitName) {
  const key = normalizeGpcKey(gpc);
  if (!key) return '';
  const setId = longVowelSetForUnit(unitName);
  const banks = setId
    ? [GPC_LONG_VOWEL_BANK[setId]]
    : [GPC_LONG_VOWEL_BANK.longA, GPC_LONG_VOWEL_BANK.longE, GPC_LONG_VOWEL_BANK.longO];
  const candidates = [];
  const add = (w) => {
    const word = String(w ?? '').trim();
    if (!isValidGameToken(word) || normalizeGpcKey(word) === key) return;
    if (!candidates.includes(word)) candidates.push(word);
  };
  for (const bank of banks) {
    for (const w of bank[key] || []) add(w);
  }
  if (!candidates.length) {
    for (const [word, entry] of Object.entries(LONG_VOWEL_WORD_INDEX)) {
      if (setId && entry.setId !== setId) continue;
      if (normalizeGpcKey(entry.gpc) === key) add(word);
    }
  }
  if (!candidates.length) return '';
  return candidates[Math.floor(Math.random() * candidates.length)];
}

function resolveGpcExampleWord(gpc) {
  if (!state.selectedStudent || !isValidGameToken(gpc)) return '';
  const needs = getStudentNeeds(state.selectedStudent);
  const item = findGpcNeedItem(gpc, needs);
  if (item?.exampleWord) return item.exampleWord;
  return pickLongVowelGpcExample(gpc, item?.unit);
}

function getLongVowelBlankEntries(word, pool) {
  const key = HW_BLANK_ALIASES[String(word).toLowerCase()] || String(word).toLowerCase();
  const entry = LONG_VOWEL_WORD_INDEX[key];
  if (!entry?.sentences?.length) return null;
  return entry.sentences.map(s => ({
    s,
    d: pickBlankDistractorsPreferType(word, pool, 3),
  }));
}

/** Curated HW_SENTENCES (+ CSV batches); minimal fallback only when no entry exists. */
function getHwBlankEntries(word, pool) {
  const raw = String(word).toLowerCase();
  const key = HW_BLANK_ALIASES[raw] || raw;
  const fromLong = getLongVowelBlankEntries(word, pool);
  if (fromLong?.length) return fromLong;
  const curated = HW_SENTENCES[key];
  if (curated && curated.length) {
    return curated.map(e => ({
      s: e.s,
      d: (e.d && e.d.length) ? e.d : pickBlankDistractorsPreferType(word, pool, 3),
    }));
  }
  return [{
    s: 'Listen. The word is _____.',
    d: pickBlankDistractorsPreferType(word, pool, 3),
  }];
}

// ============================================================
// PASSWORD GENERATION
// ============================================================
const ADJECTIVES = ['Happy','Brave','Sunny','Lucky','Mighty','Swift','Cosmic','Royal','Wild','Calm','Bold','Cool','Fancy','Gentle','Jolly','Kind','Magic','Quick','Smart','Tiny','Wise','Zesty','Bright','Clever','Funny','Honest','Joyful','Loyal','Polite','Tidy','Friendly','Pink','Blue','Gold','Silver','Red','Green','Purple','Orange','Sparkly','Tall','Small','Big','Fast','Slow','Soft','Strong','Sweet','Shiny','Furry'];
const NOUNS = ['Fox','Bear','Tiger','Lion','Eagle','Wolf','Owl','Dragon','Star','Moon','Sun','Rocket','Comet','Cloud','River','Mountain','Forest','Ocean','Cat','Dog','Bird','Fish','Tree','Leaf','Rose','Apple','Berry','Crystal','Diamond','Pearl','Whale','Shark','Dolphin','Panda','Koala','Rabbit','Mouse','Elephant','Giraffe','Zebra','Monkey','Frog','Turtle','Bee','Sparrow','Robin','Cactus','Daisy','Tulip','Pony'];

function seededRandom(seed) {
  let s = 0;
  for (let i = 0; i < seed.length; i++) s = (s * 31 + seed.charCodeAt(i)) | 0;
  s = Math.abs(s) || 1;
  return function() { s = (s * 9301 + 49297) % 233280; return s / 233280; };
}
function generatePasswords() {
  const cls = state.data.classes[state.classKey];
  const used = new Set();
  state.passwords = {};
  cls.students.forEach((name, idx) => {
    const rnd = seededRandom(state.classKey + '|' + name + '|' + idx);
    let pw, tries = 0;
    do {
      const adj = ADJECTIVES[Math.floor(rnd() * ADJECTIVES.length)];
      const noun = NOUNS[Math.floor(rnd() * NOUNS.length)];
      pw = `${adj} ${noun}`;
      tries++;
      if (tries > 80) { pw = `${pw} ${idx+1}`; break; }
    } while (used.has(pw));
    used.add(pw);
    state.passwords[name] = pw;
  });
}

// ============================================================
// POINTS
// ============================================================
function pointsKey(name) { return `rapoints_${state.classKey}_${name}`; }
function loadPoints() {
  if (window.isDesktopAdventures && window.AdventuresDesktop) {
    window.AdventuresDesktop.loadStudentProgressForClass(state.classKey);
    return;
  }
  state.studentPoints = {};
  try {
    const cls = state.data.classes[state.classKey];
    cls.students.forEach(name => {
      const v = localStorage.getItem(pointsKey(name));
      state.studentPoints[name] = v ? parseInt(v,10) : 0;
    });
  } catch(e) {
    const cls = state.data.classes[state.classKey];
    cls.students.forEach(name => state.studentPoints[name] = 0);
  }
}
function getPoints(name) { return state.studentPoints[name] || 0; }
function addPoints(name, n) {
  state.studentPoints[name] = (state.studentPoints[name] || 0) + n;
  if (window.isDesktopAdventures && window.AdventuresDesktop) {
    window.AdventuresDesktop.setPoints(name, state.studentPoints[name]);
    return;
  }
  try { localStorage.setItem(pointsKey(name), state.studentPoints[name]); } catch(e){}
}
function spendPoints(name, n) {
  if (getPoints(name) < n) return false;
  state.studentPoints[name] -= n;
  if (window.isDesktopAdventures && window.AdventuresDesktop) {
    window.AdventuresDesktop.setPoints(name, state.studentPoints[name]);
    return true;
  }
  try { localStorage.setItem(pointsKey(name), state.studentPoints[name]); } catch(e){}
  return true;
}

function awardStarcadeWinBonus(key) {
  const name = state.selectedStudent;
  if (!name) return;
  state.starcadeBonuses = state.starcadeBonuses || {};
  if (state.starcadeBonuses[key]) return;
  state.starcadeBonuses[key] = true;
  addPoints(name, STARCADE_WIN_BONUS);
}

function isReadingGamePerfect(g) {
  if (g.type === 'flash') {
    return g.finished && g.history?.length > 0 && g.history.every(h => h.correct !== false);
  }
  if (g.type === 'gpcCatch') {
    const need = g.correctNeeded || CHALLENGE_ROUNDS;
    return !!g.won && g.correct >= need && g.attempts === g.correct;
  }
  if (g.type === 'soundFlip') {
    return g.correct === g.totalRounds && g.attempts === g.correct;
  }
  const rounds = g.totalRounds || CHALLENGE_ROUNDS;
  if (g.type === 'hwBoxes' || g.type === 'soundBox') {
    return g.finished && g.correct === rounds && !(g.history || []).some(h => h.correct === false);
  }
  return g.correct === rounds && g.attempts === g.correct;
}

// ============================================================
// FLASH CARD RESULTS
// ============================================================
function flashResultsKey(name) { return `raflash_${state.classKey}_${name}`; }
function loadFlashResults() {
  if (window.isDesktopAdventures && window.AdventuresDesktop) {
    window.AdventuresDesktop.loadStudentProgressForClass(state.classKey);
    return;
  }
  state.flashResults = {};
  try {
    const cls = state.data.classes[state.classKey];
    cls.students.forEach(name => {
      const v = localStorage.getItem(flashResultsKey(name));
      state.flashResults[name] = v ? JSON.parse(v) : {};
    });
  } catch(e) {
    const cls = state.data.classes[state.classKey];
    cls.students.forEach(name => state.flashResults[name] = {});
  }
}
function setFlashResult(name, word, status) {
  if (!state.flashResults[name]) state.flashResults[name] = {};
  state.flashResults[name][word] = status;
  if (window.isDesktopAdventures && window.AdventuresDesktop) {
    window.AdventuresDesktop.setFlashResults(name, state.flashResults[name]);
    return;
  }
  try { localStorage.setItem(flashResultsKey(name), JSON.stringify(state.flashResults[name])); } catch(e){}
}
function getFlashStatus(word) {
  const name = state.selectedStudent;
  if (!name || !state.flashResults[name]) return null;
  return state.flashResults[name][word] || null;
}
function flashBorderClass(word) {
  const s = getFlashStatus(word);
  if (s === 'got') return 'ring-4 ring-green-400 border-green-400';
  if (s === 'tricky') return 'ring-4 ring-orange-400 border-orange-400';
  return '';
}

// ============================================================
// FEEDBACK
// ============================================================
function pickFeedbackMessage(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

/** String GPC or `{ gpc|sound, example|exampleWord }` with optional parallel gpcExamples[i]. */
function parseGpcEntry(entry, exampleFromArray) {
  if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
    const sound = String(entry.gpc ?? entry.sound ?? entry.value ?? '').trim();
    const example = String(entry.example ?? entry.exampleWord ?? exampleFromArray ?? '').trim();
    return { sound, example };
  }
  return {
    sound: String(entry ?? '').trim(),
    example: String(exampleFromArray ?? '').trim()
  };
}

function lookupGpcExampleWord(gpc) {
  return resolveGpcExampleWord(gpc);
}

function getHwContextSnippet(word) {
  const key = HW_BLANK_ALIASES[String(word).toLowerCase()] || String(word).toLowerCase();
  const entry = LONG_VOWEL_WORD_INDEX[key];
  let s = entry?.sentences?.[0] || HW_SENTENCES[key]?.[0]?.s;
  if (!s) return '';
  return String(s).replace(/_____/g, '…').trim();
}

function renderGpcContextBar(exampleWord) {
  const ex = String(exampleWord ?? '').trim();
  if (!ex) return '';
  return `<p class="game-context-bar" aria-label="Example word ${ex}">as in <span class="game-context-word">${ex}</span></p>`;
}

/** Large top-left example hint for Splat the Sound / Sound Splat Challenge (no filled box). */
function renderGpcExampleHint(exampleWord) {
  const ex = String(exampleWord ?? '').trim();
  if (!ex) return '';
  return `<p class="gpc-example-hint" aria-label="Example word ${ex}"><span class="gpc-example-hint-prefix">as in</span><span class="gpc-example-hint-word">${ex}</span></p>`;
}

function renderHwContextBar(word) {
  const snippet = getHwContextSnippet(word);
  if (!snippet) return '';
  return `<p class="game-context-bar game-context-sentence" aria-label="Example sentence">${snippet}</p>`;
}

function isGenericHwBlankSentence(sentence) {
  return String(sentence ?? '').trim() === 'Listen. The word is _____.';
}

/** When Word Challenge has no curated sentence, show the target word discreetly. */
function renderHwBlankWordHint(target) {
  const hint = renderGpcExampleHint(target);
  if (!hint) return '';
  return `<div class="hw-blank-sentence hw-blank-sentence--hint">${hint}</div>`;
}

function renderHwBlankSentence(sentenceHtml) {
  if (!sentenceHtml) return '';
  return `<p class="hw-blank-sentence" aria-label="Sentence">${sentenceHtml}</p>`;
}

function renderHwBlankCompletedSentence(sentence, target, blankAtStart) {
  const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
  const displayTarget = blankAtStart ? cap(target) : target;
  const safe = String(displayTarget).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const parts = String(sentence).split('_____');
  const html = parts.map((part, i) =>
    i < parts.length - 1
      ? `${part}<mark class="hw-blank-focus-word">${safe}</mark>`
      : part
  ).join('');
  return `<div class="hw-blank-complete"><p class="hw-blank-sentence hw-blank-sentence--complete" aria-label="Completed sentence">${html}</p></div>`;
}

const GAME_NEXT_DELAY_MS = 4000;
const CATCH_CORRECT_BREAK_MS = 4000;

function clearGameNextBtnTimer(g) {
  if (!g) return;
  if (g._nextBtnTimer) {
    clearTimeout(g._nextBtnTimer);
    g._nextBtnTimer = null;
  }
}

function renderGameNextButton(label, nextOnclick) {
  return `<button type="button" onclick="sfxClick(); ${nextOnclick}" class="game-next-btn game-next-btn--delayed">${label}</button>`;
}

/** Feedback row with optional Next (visible immediately; nudge after delay). */
function renderGameTopFeedback(message, correct, nextOnclick, nextLabel = 'Next') {
  if (!message) return '';
  const color = correct === false ? 'text-orange-200' : (correct === true ? 'text-green-300' : 'text-white/90');
  const btn = nextOnclick ? renderGameNextButton(nextLabel, nextOnclick) : '';
  return `<div class="game-top-feedback-row fadeIn">
    <div class="game-top-feedback-msg ${color}">${message}</div>
    ${btn}
  </div>`;
}

/** Replaces in-game titles: example/sentence on top, feedback + Next when needed. */
function renderGamePlayHeader({ contextHtml = '', feedbackMessage = null, feedbackCorrect = null, nextOnclick = null, nextLabel = 'Next' }) {
  const feedbackBlock = feedbackMessage
    ? renderGameTopFeedback(feedbackMessage, feedbackCorrect, nextOnclick, nextLabel)
    : '';
  const contextBlock = contextHtml ? `<div class="game-play-context">${contextHtml}</div>` : '';
  if (!contextBlock && !feedbackBlock) return '';
  return `<div class="game-play-header">${contextBlock}${feedbackBlock}</div>`;
}

/** Next is visible immediately; nudge animation starts after GAME_NEXT_DELAY_MS. */
function scheduleGameNextBtnArm() {
  const g = state.game;
  if (!g) return;
  clearGameNextBtnTimer(g);
  requestAnimationFrame(() => {
    const btn = document.querySelector('.game-next-btn--delayed:not(.game-next-btn--nudge)');
    if (!btn) return;
    g._nextBtnTimer = setTimeout(() => {
      btn.classList.add('game-next-btn--nudge');
      g._nextBtnTimer = null;
    }, GAME_NEXT_DELAY_MS);
  });
}

function afterGameRenderArmNext() {
  if (document.querySelector('.game-next-btn--delayed')) scheduleGameNextBtnArm();
}


function correctFeedback(target, type, gameKind) {
  if (type === 'gpc') {
    if (gameKind === 'soundFlip') {
      return pickFeedbackMessage([
        'Yes! You found the match.',
        'Right! Say the sound again.',
        'Good spot! Say it once more.'
      ]);
    }
    const ex = lookupGpcExampleWord(target);
    const exBit = ex ? ` Like in “${ex}”.` : '';
    return pickFeedbackMessage([
      `Yes! Say “${target}” again.${exBit}`,
      `Right! Find a word with “${target}”.${exBit}`,
      `Good! Say “${target}” three times.${exBit}`
    ]);
  }
  if (gameKind === 'hwBlank') {
    return pickFeedbackMessage([
      `Yes! Say “${target}” again.`,
      `Right! What does “${target}” mean?`,
      `Good! Make your own sentence with “${target}”.`,
      `Nice! Try a new sentence with “${target}”.`
    ]);
  }
  return pickFeedbackMessage([
    `Yes! Say “${target}” again.`,
    `Right! Write “${target}” in the air.`,
    `Good! Use “${target}” in a sentence.`,
    `Nice! Picture “${target}” in your mind.`
  ]);
}

const CHALLENGE_RETRY_TYPES = new Set(['gpcMatch', 'hwHunt', 'soundFlip', 'hwBlank']);

function isChallengeRetryGame(type) {
  return CHALLENGE_RETRY_TYPES.has(type);
}

function challengeNextOnclick(g) {
  if (!g?.feedback) return null;
  if (g.feedback.correct) {
    if (g.type === 'soundFlip') return 'nextSoundFlipRound()';
    if (g.type === 'hwBlank') return 'nextBlankRound()';
    return 'nextRound()';
  }
  if (isChallengeRetryGame(g.type)) return 'retryChallengeRound()';
  return null;
}

function challengeNextLabel(g) {
  if (g?.feedback && !g.feedback.correct && isChallengeRetryGame(g.type)) return 'Try again';
  return 'Next';
}

function challengeWrongFeedback(target, type, gameKind) {
  if (type === 'gpc') {
    const ex = lookupGpcExampleWord(target);
    const exBit = ex ? ` Think of “${ex}”.` : '';
    return pickFeedbackMessage([
      `Almost! You can try again — listen for “${target}”.${exBit}`,
      `Good try! Have another go and hear “${target}”.${exBit}`,
      `Not quite — keep going. Say “${target}” and pick again.${exBit}`
    ]);
  }
  if (gameKind === 'hwBlank') {
    return pickFeedbackMessage([
      `Almost! Try again — listen for “${target}”.`,
      `Good effort! You can have another go at “${target}”.`,
      `Not quite — hear the word again, then pick “${target}”.`
    ]);
  }
  return pickFeedbackMessage([
    `Almost! Try again — the word is “${target}”.`,
    `Good try! Listen once more, then pick “${target}”.`,
    `Not quite — you can redo this one. Say “${target}” slowly.`
  ]);
}

window.retryChallengeRound = () => {
  const g = state.game;
  if (!g || !isChallengeRetryGame(g.type) || !g.feedback || g.feedback.correct) return;
  clearGameNextBtnTimer(g);
  sfxClick();
  g.feedback = null;
  if (g.type === 'soundFlip') g.flipPhase = 'ready';
  render();
  setTimeout(() => {
    if (state.view !== 'game' || state.game !== g || g.feedback) return;
    playTargetOnShow(g, g.currentTarget);
    if (g.type === 'soundFlip') startSoundFlipPrompt();
  }, 250);
};

function wrongFeedback(target, type, gameKind) {
  if (type === 'gpc') {
    const ex = lookupGpcExampleWord(target);
    const exBit = ex ? ` Try “${ex}”.` : '';
    return pickFeedbackMessage([
      `Listen again. Say “${target}”.${exBit}`,
      `Not that one. Hear “${target}” again.${exBit}`,
      `Try again. Say “${target}” out loud.${exBit}`
    ]);
  }
  if (gameKind === 'hwBlank') {
    return pickFeedbackMessage([
      `Listen again. The word was “${target}”.`,
      `Try again. Say “${target}”.`,
      `It was “${target}”. Say it slowly.`
    ]);
  }
  return pickFeedbackMessage([
    `Listen again. The word was “${target}”.`,
    `Try again. Say “${target}” slowly.`,
    `It was “${target}”. Say each sound.`
  ]);
}

// ============================================================
// STUDENT NEEDS
// ============================================================

/** True when a GPC or heart-word string is usable in games (not a padded empty JSON slot). */
function isValidGameToken(value) {
  const s = String(value ?? '').trim();
  if (!s) return false;
  if (s === '?' || s === '•') return false;
  return true;
}

function uniqueValidTokens(values) {
  const out = [];
  const seen = new Set();
  for (const v of values) {
    const s = String(v ?? '').trim();
    if (!isValidGameToken(s)) continue;
    const key = s.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out;
}

/** Target + distractors for splat / word-challenge options; never includes blank placeholders. */
function buildChallengeOptions(target, distractorPool, targetPool, needCount = 3, kind = 'hw') {
  const t = String(target ?? '').trim();
  if (!isValidGameToken(t)) return [];
  const tKey = t.toLowerCase();
  let distractors = shuffle(
    uniqueValidTokens(distractorPool).filter(w => w.toLowerCase() !== tKey)
  ).slice(0, needCount);
  if (distractors.length < needCount) {
    const extra = uniqueValidTokens(targetPool).filter(
      w => w.toLowerCase() !== tKey && !distractors.includes(w)
    );
    for (const w of extra) {
      if (distractors.length >= needCount) break;
      distractors.push(w);
    }
  }
  const fallbacks = kind === 'gpc'
    ? ['sh', 'ch', 'th', 'a', 'e', 'o', 'i', 'u']
    : ['the', 'and', 'is', 'was', 'to', 'a', 'he', 'she', 'we', 'you'];
  for (const f of fallbacks) {
    if (distractors.length >= needCount) break;
    if (f.toLowerCase() !== tKey && !distractors.includes(f)) distractors.push(f);
  }
  return shuffle([t, ...distractors.slice(0, needCount)]);
}

function getStudentNeeds(studentName) {
  const cls = state.data.classes[state.classKey];
  const cps = cls.checkpoints || [];
  const sorted = [...cps].sort((a,b) => new Date(b.date) - new Date(a.date));
  const latest = sorted[0];
  let assessment, coveredUnits, label;
  if (latest && cls.assessments.checkpoints && cls.assessments.checkpoints[latest.id] && cls.assessments.checkpoints[latest.id][studentName]) {
    assessment = cls.assessments.checkpoints[latest.id][studentName];
    coveredUnits = latest.units;
    label = latest.label;
  } else {
    assessment = cls.assessments.baseline[studentName];
    coveredUnits = cls.units.map((_,i)=>i);
    label = 'Baseline';
  }
  const result = { targetGpcs: [], targetHws: [], masteredGpcs: [], masteredHws: [], assessment, label, coveredUnits };
  coveredUnits.forEach(uIdx => {
    const unit = cls.units[uIdx];
    const aUnit = assessment.units[uIdx];
    const gpcExamples = Array.isArray(unit.gpcExamples) ? unit.gpcExamples : [];
    unit.gpcs.forEach((gpc, i) => {
      const { sound, example } = parseGpcEntry(gpc, gpcExamples[i]);
      if (!isValidGameToken(sound)) return;
      const exampleWord = isValidGameToken(example) ? example : '';
      const item = { gpc: sound, exampleWord, unitIdx: uIdx, unit: unit.name };
      if (aUnit.gpcs[i] === 1) result.masteredGpcs.push(item);
      else result.targetGpcs.push(item);
    });
    unit.heartWords.forEach((hw, i) => {
      const text = String(hw ?? '').trim();
      if (!isValidGameToken(text)) return;
      const item = { hw: text, unitIdx: uIdx, unit: unit.name };
      if (aUnit.hws[i] === 1) result.masteredHws.push(item);
      else result.targetHws.push(item);
    });
  });
  const seenHw = new Set();
  result.targetHws = result.targetHws.filter(x => {
    const key = x.hw.toLowerCase();
    if (seenHw.has(key)) return false;
    seenHw.add(key);
    return true;
  });
  const seenMHw = new Set();
  result.masteredHws = result.masteredHws.filter(x => {
    const key = x.hw.toLowerCase();
    if (seenMHw.has(key)) return false;
    seenMHw.add(key);
    return true;
  });
  return result;
}

function getFocusItems(name) {
  const needs = getStudentNeeds(name);
  let items = [
    ...needs.targetGpcs.map(x => ({ type: 'gpc', value: x.gpc })),
    ...needs.targetHws.map(x => ({ type: 'hw', value: x.hw })),
  ].filter(x => isValidGameToken(x.value));
  if (items.length === 0) {
    items = [
      ...needs.masteredGpcs.map(x => ({ type: 'gpc', value: x.gpc })),
      ...needs.masteredHws.map(x => ({ type: 'hw', value: x.hw })),
    ].filter(x => isValidGameToken(x.value));
  }
  if (items.length === 0) items = [{ type: 'gpc', value: 'a' }];
  return items;
}

/** Unmet/met round mix: 75/25 (normal), 100/0 (no met), 66/33 (<10 unmet + met). */
function getFocusRoundWeights(unmetCount, metCount) {
  if (metCount === 0 || unmetCount === 0) return { unmet: 1, met: 0 };
  if (unmetCount < 10) return { unmet: 0.66, met: 0.33 };
  return { unmet: 0.75, met: 0.25 };
}

/** Shuffle-deck: exhaust every item once before any repeat (reshuffle between cycles). */
function createCycleDeck(items) {
  const raw = [...(items || [])];
  const source = raw.length && typeof raw[0] === 'string'
    ? uniqueValidTokens(raw)
    : raw.filter(x => x != null);
  let deck = [];
  let idx = 0;
  function reshuffle() {
    deck = shuffle([...source]);
    idx = 0;
  }
  function next() {
    if (source.length === 0) return null;
    if (idx >= deck.length) reshuffle();
    return deck[idx++];
  }
  if (source.length > 0) reshuffle();
  return { next, reset: reshuffle };
}

function focusPoolSignature(items) {
  return uniqueValidTokens(items).slice().sort((a, b) => a.localeCompare(b)).join('\x1e');
}

/**
 * Session cycle deck: same student + track keeps position across games until every
 * focus word in the pool has been used (then reshuffles for the next cycle).
 * @param {string|null} student
 * @param {'gpc'|'hw'|'mixed'} kind
 * @param {'practice'|'met'} slot
 * @param {string[]} items - tokens or item keys
 */
function getStudentCycleDeck(student, kind, slot, items) {
  const pool = uniqueValidTokens(items);
  if (!student || pool.length === 0) return createCycleDeck(pool);
  const sig = focusPoolSignature(pool);
  const key = `${state.classKey}|${student}|${kind}|${slot}`;
  const store = state.focusCycleDecks;
  const entry = store[key];
  if (!entry || entry.signature !== sig) {
    store[key] = { signature: sig, deck: createCycleDeck(pool) };
  }
  return store[key].deck;
}

/**
 * Precompute challenge answers with weighted unmet/met slots and per-pool cycle decks.
 * @param {string[]} unmetPool - targets not yet mastered
 * @param {string[]} metPool - mastered items (review); ignored when empty
 * @param {number} count - rounds (default 12)
 */
function buildRoundTargetsFromPools(unmetPool, metPool, count = CHALLENGE_ROUNDS, kind = 'gpc') {
  const unmet = uniqueValidTokens(unmetPool);
  const met = uniqueValidTokens(metPool);
  const practicePool = unmet.length > 0 ? unmet : met;
  if (practicePool.length === 0) return [];

  const weights = getFocusRoundWeights(unmet.length, met.length);
  let nMet = 0;
  if (met.length > 0 && unmet.length > 0) {
    nMet = Math.min(count, Math.max(0, Math.round(count * weights.met)));
  }
  const nUnmet = count - nMet;

  const student = state.selectedStudent;
  const unmetDeck = getStudentCycleDeck(student, kind, 'practice', practicePool);
  const metDeck = met.length > 0 ? getStudentCycleDeck(student, kind, 'met', met) : null;

  const slots = [
    ...Array(nUnmet).fill('unmet'),
    ...Array(nMet).fill('met'),
  ];
  return shuffle(slots).map(slot =>
    slot === 'met' && metDeck ? metDeck.next() : unmetDeck.next()
  ).filter(Boolean);
}

function buildRoundTargets(needs, kind, count = CHALLENGE_ROUNDS) {
  const unmet = kind === 'gpc'
    ? needs.targetGpcs.map(x => x.gpc)
    : needs.targetHws.map(x => x.hw);
  const met = kind === 'gpc'
    ? needs.masteredGpcs.map(x => x.gpc)
    : needs.masteredHws.map(x => x.hw);
  return buildRoundTargetsFromPools(unmet, met, count, kind);
}

function assignFocusItems(count) {
  const needs = getStudentNeeds(state.selectedStudent);
  const unmet = [
    ...needs.targetGpcs.map(x => ({ type: 'gpc', value: x.gpc })),
    ...needs.targetHws.map(x => ({ type: 'hw', value: x.hw })),
  ].filter(x => isValidGameToken(x.value));
  const met = [
    ...needs.masteredGpcs.map(x => ({ type: 'gpc', value: x.gpc })),
    ...needs.masteredHws.map(x => ({ type: 'hw', value: x.hw })),
  ].filter(x => isValidGameToken(x.value));
  const key = item => `${item.type}:${item.value}`;
  const practice = unmet.length > 0 ? unmet : met;
  if (practice.length === 0) return [{ type: 'gpc', value: 'a' }];

  const weights = getFocusRoundWeights(unmet.length, met.length);
  let nMet = 0;
  if (met.length > 0 && unmet.length > 0) {
    nMet = Math.min(count, Math.max(0, Math.round(count * weights.met)));
  }
  const nUnmet = count - nMet;

  const student = state.selectedStudent;
  const unmetDeck = getStudentCycleDeck(student, 'mixed', 'practice', practice.map(key));
  const metDeck = met.length > 0 ? getStudentCycleDeck(student, 'mixed', 'met', met.map(key)) : null;
  const byKey = new Map([...practice, ...met].map(item => [key(item), item]));

  const slots = [
    ...Array(nUnmet).fill('unmet'),
    ...Array(nMet).fill('met'),
  ];
  return shuffle(slots).map(slot => {
    const k = slot === 'met' && metDeck ? metDeck.next() : unmetDeck.next();
    return byKey.get(k) || practice[0];
  }).filter(Boolean);
}

function getFlashPoolForKind(needs, kind) {
  if (kind === 'gpc') {
    return needs.targetGpcs.map(x => ({ type: 'gpc', value: x.gpc })).filter(c => isValidGameToken(c.value));
  }
  return needs.targetHws.map(x => ({ type: 'hw', value: x.hw })).filter(c => isValidGameToken(c.value));
}

function hasFlashBeenChecked(value) {
  return !!getFlashStatus(value);
}

/** Stable sets of 5; last set is 5 + remainder (6–9 items). */
function splitIntoStaticFlashSets(items) {
  const sorted = [...items].sort((a, b) => String(a.value).localeCompare(String(b.value), undefined, { sensitivity: 'base' }));
  const sets = [];
  let i = 0;
  const n = sorted.length;
  while (i < n) {
    const left = n - i;
    if (left > 9) {
      sets.push(sorted.slice(i, i + 5));
      i += 5;
    } else {
      sets.push(sorted.slice(i));
      break;
    }
  }
  return sets;
}

function orderFlashSetForPlay(items) {
  const unchecked = items.filter(c => !hasFlashBeenChecked(c.value));
  const checked = items.filter(c => hasFlashBeenChecked(c.value));
  return [...unchecked, ...checked];
}

function flashSetProgressKey(name) { return `raflashsets_${state.classKey}_${name}`; }

function getFlashSetProgressMap(name) {
  if (!state.flashSetProgress) state.flashSetProgress = {};
  if (state.flashSetProgress[name]) return state.flashSetProgress[name];
  if (window.isDesktopAdventures && window.AdventuresDesktop) {
    window.AdventuresDesktop.loadStudentProgressForClass(state.classKey);
    state.flashSetProgress[name] = state.flashSetProgress[name] || {};
    return state.flashSetProgress[name];
  }
  try {
    const v = localStorage.getItem(flashSetProgressKey(name));
    state.flashSetProgress[name] = v ? JSON.parse(v) : {};
  } catch (e) {
    state.flashSetProgress[name] = {};
  }
  return state.flashSetProgress[name];
}

function markFlashSetAttempted(name, kind, setIndex) {
  const map = getFlashSetProgressMap(name);
  map[`${kind}:${setIndex}`] = { attempted: true };
  if (window.isDesktopAdventures && window.AdventuresDesktop) {
    window.AdventuresDesktop.setFlashSetProgress(name, map);
    return;
  }
  try { localStorage.setItem(flashSetProgressKey(name), JSON.stringify(map)); } catch (e) {}
}

function isFlashSetAttempted(name, kind, setIndex) {
  return !!getFlashSetProgressMap(name)[`${kind}:${setIndex}`]?.attempted;
}

function isFlashSetAllGot(items) {
  return items.length > 0 && items.every(c => getFlashStatus(c.value) === 'got');
}

function getFlashSetCardStatus(name, kind, setIndex, items) {
  if (!isFlashSetAttempted(name, kind, setIndex)) return '';
  if (isFlashSetAllGot(items)) return 'flash-set-card--complete';
  return 'flash-set-card--attempted';
}

function gamePlayedKey(name) { return `ragameplayed_${state.classKey}_${name}`; }

function loadGamePlayed() {
  if (window.isDesktopAdventures && window.AdventuresDesktop) {
    window.AdventuresDesktop.loadStudentProgressForClass(state.classKey);
    return;
  }
  state.gamePlayed = {};
  try {
    const cls = state.data.classes[state.classKey];
    cls.students.forEach(name => {
      const v = localStorage.getItem(gamePlayedKey(name));
      state.gamePlayed[name] = v ? JSON.parse(v) : {};
    });
  } catch (e) {
    const cls = state.data.classes[state.classKey];
    cls.students.forEach(name => { state.gamePlayed[name] = {}; });
  }
}

function getGamePlayedMap(name) {
  if (!state.gamePlayed[name]) state.gamePlayed[name] = {};
  return state.gamePlayed[name];
}

function saveGamePlayedMap(name, map) {
  state.gamePlayed[name] = map;
  if (window.isDesktopAdventures && window.AdventuresDesktop) {
    window.AdventuresDesktop.setGamePlayed(name, map);
    return;
  }
  try { localStorage.setItem(gamePlayedKey(name), JSON.stringify(map)); } catch (e) {}
}

function hasPlayedTrackGame(name, gameId) {
  return !!getGamePlayedMap(name)[gameId];
}

function markTrackGamePlayed(name, gameId) {
  if (!TRACK_GAME_IDS.includes(gameId)) return false;
  const played = getGamePlayedMap(name);
  if (played[gameId]) return false;
  played[gameId] = true;
  const allDone = TRACK_GAME_IDS.every(id => played[id]);
  if (allDone) {
    TRACK_GAME_IDS.forEach(id => { delete played[id]; });
    saveGamePlayedMap(name, played);
    addPoints(name, STARCADE_TRACK_BONUS);
    return true;
  }
  saveGamePlayedMap(name, played);
  return false;
}

// ============================================================
// ROUTER
// ============================================================
// ============================================================
// QUIT GAME (in-app confirm — avoids blocked browser confirm())
// ============================================================
function removeQuitConfirmOverlay() {
  const el = document.getElementById('quitConfirmOverlay');
  if (el) el.remove();
  state.quitConfirmPending = false;
  state._quitConfirmHandler = null;
}

window.requestQuitGame = (onConfirm) => {
  sfxClick();
  removeQuitConfirmOverlay();
  state.quitConfirmPending = true;
  state._quitConfirmHandler = typeof onConfirm === 'function' ? onConfirm : null;
  const overlay = document.createElement('div');
  overlay.id = 'quitConfirmOverlay';
  overlay.className = 'quit-confirm-overlay fadeIn';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.innerHTML = `
    <div class="quit-confirm-panel text-center">
      <p class="text-lg font-bold mb-2 arcade-title-friendly">Leave this game?</p>
      <p class="text-sm text-white/75 mb-5">Your progress in this round will not be saved.</p>
      <div class="flex gap-3 justify-center flex-wrap">
        <button type="button" id="quitConfirmStay" class="bg-white/15 hover:bg-white/25 px-5 py-2.5 rounded-xl font-semibold">Keep playing</button>
        <button type="button" id="quitConfirmLeave" class="bg-gradient-to-r from-pink-500 to-purple-600 hover:from-pink-400 hover:to-purple-500 px-5 py-2.5 rounded-xl font-semibold">Leave game</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  overlay.querySelector('#quitConfirmStay').addEventListener('click', () => {
    sfxClick();
    removeQuitConfirmOverlay();
  });
  overlay.querySelector('#quitConfirmLeave').addEventListener('click', () => {
    sfxClick();
    const fn = state._quitConfirmHandler;
    removeQuitConfirmOverlay();
    if (fn) fn();
  });
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) {
      sfxClick();
      removeQuitConfirmOverlay();
    }
  });
};

window.quitToProfile = () => {
  requestQuitGame(() => {
    if (state.game) {
      if (state.game.type === 'soundFlip') cleanupSoundFlip();
      if (state.game.type === 'soundBox') cleanupSoundBox();
      if (state.game._timer) {
        clearTimeout(state.game._timer);
        state.game._timer = null;
      }
      clearGameNextBtnTimer(state.game);
    }
    state.view = 'profile';
    render();
  });
};

function render(){
  const app = $('app');
  switch (state.view) {
    case 'upload': return renderUpload(app);
    case 'classSelect': return renderClassSelect(app);
    case 'dashboard': return renderDashboard(app);
    case 'teacherAuth': return renderTeacherAuth(app);
    case 'studentAuth': return renderStudentAuth(app);
    case 'passwords': return renderPasswords(app);
    case 'profile': return renderProfile(app);
    case 'flashKind': return renderFlashKindPick(app);
    case 'flashSets': return renderFlashSetHub(app);
    case 'game': return renderGame(app);
    case 'arcade': return renderArcade(app);
  }
}

// ============================================================
// UPLOAD
// ============================================================
function renderUpload(app){
  app.innerHTML = `
    <div class="min-h-screen flex items-center justify-center p-4">
      <div class="bg-white/10 backdrop-blur-md border border-white/20 rounded-3xl p-8 md:p-12 max-w-2xl w-full text-center shadow-2xl fadeIn">
        <div class="text-6xl mb-4 floaty">🚀</div>
        <h1 class="text-4xl md:text-5xl font-bold mb-3">Reading Adventure</h1>
        <p class="text-lg text-white/80 mb-8" id="upload-lead">Upload your class data to launch personalised reading games for each student.</p>
        <label class="block">
          <input type="file" accept=".json" id="fileInput" class="hidden">
          <span id="dropZone" class="block cursor-pointer border-2 border-dashed border-white/40 hover:border-white hover:bg-white/10 rounded-2xl p-10 transition">
            <div class="text-5xl mb-3">📁</div>
            <div class="font-semibold mb-1">Click to choose a JSON file</div>
            <div class="text-sm text-white/60">or drag and drop your assessment data here</div>
          </span>
        </label>
        <div id="uploadMsg" class="mt-4 text-yellow-200"></div>
      </div>
    </div>`;
  const input = $('fileInput'); const dz = $('dropZone');
  input.addEventListener('change', e => loadFile(e.target.files[0]));
  ['dragover','dragenter'].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.add('bg-white/10','border-white');}));
  ['dragleave','drop'].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.remove('bg-white/10','border-white');}));
  dz.addEventListener('drop', e => { if (e.dataTransfer.files[0]) loadFile(e.dataTransfer.files[0]);});
}
function loadFile(file){
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const data = JSON.parse(e.target.result);
      if (!data.classes) throw new Error('Invalid format: no classes found');
      const classKeys = Object.keys(data.classes);
      if (classKeys.length === 0) throw new Error('No classes found in file');
      state.data = data;
      // Reset any previous class selection so the picker shows
      state.classKey = null;
      state.passwords = {};
      state.studentPoints = {};
      state.flashResults = {};
      state.view = 'classSelect';
      render();
    } catch(err) {
      $('uploadMsg').textContent = 'Could not read file: ' + err.message;
    }
  };
  reader.readAsText(file);
}

// ============================================================
// CLASS SELECT (pre-landing page after JSON upload)
// ============================================================
function renderClassSelect(app) {
  const classKeys = Object.keys(state.data.classes);

  // Soft palette of gradients to differentiate class cards
  const palettes = [
    'from-pink-500 to-fuchsia-600',
    'from-cyan-500 to-blue-600',
    'from-emerald-500 to-teal-600',
    'from-amber-500 to-orange-600',
    'from-violet-500 to-purple-600',
    'from-rose-500 to-red-600',
    'from-lime-500 to-green-600',
    'from-sky-500 to-indigo-600',
  ];
  const emojis = ['🚀','🌟','🪐','🌈','🎈','🎨','🦄','🐠','🌺','⚡','🎯','🎪'];

  const cards = classKeys.map((key, i) => {
    const cls = state.data.classes[key];
    const palette = palettes[i % palettes.length];
    const emoji = emojis[i % emojis.length];
    const safeKey = key.replace(/'/g,"\\'").replace(/"/g,'&quot;');
    return `
      <button onclick="selectClass('${safeKey}')" class="text-center bg-gradient-to-br ${palette} hover:scale-105 transition transform rounded-2xl p-7 shadow-2xl border border-white/20">
        <div class="text-6xl mb-4 floaty">${emoji}</div>
        <div class="font-extrabold text-3xl md:text-4xl tracking-wide arcade-title-friendly">${key}</div>
        <div class="mt-5 inline-block bg-black/20 rounded-xl px-4 py-2 text-sm font-semibold">Open class →</div>
      </button>`;
  }).join('');

  app.innerHTML = `
    <div class="min-h-screen p-4 md:p-8 flex items-center justify-center">
      <div class="max-w-5xl w-full">
        <div class="flex items-center justify-between mb-6 flex-wrap gap-3">
          <button onclick="state.view='upload'; render()" class="text-white/70 hover:text-white text-sm bg-white/10 hover:bg-white/20 px-4 py-2 rounded-xl">← Choose a different file</button>
          <span class="text-sm text-white/60">${classKeys.length} class${classKeys.length === 1 ? '' : 'es'} loaded</span>
        </div>
        <div class="text-center mb-8 fadeIn">
          <div class="text-5xl md:text-6xl mb-3 floaty">📂</div>
          <h1 class="text-3xl md:text-5xl font-bold mb-2">Choose your class</h1>
          <p class="text-white/75 text-lg">Pick which class you'd like to open today</p>
        </div>
        <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5 fadeIn">${cards}</div>
      </div>
    </div>`;
}

window.selectClass = (key) => {
  if (!state.data || !state.data.classes[key]) return;
  state.classKey = key;
  generatePasswords();
  loadPoints();
  loadFlashResults();
  loadGamePlayed();
  state.view = 'dashboard';
  render();
};

// ============================================================
// DASHBOARD
// ============================================================
function renderDashboard(app){
  const cls = state.data.classes[state.classKey];
  const cards = cls.students.map(name => {
    const initials = name.replace('Student ','S');
    return `
      <button onclick="selectStudent('${name.replace(/'/g,"\\'")}')" class="bg-white/10 hover:bg-white/20 backdrop-blur border border-white/20 rounded-2xl p-5 transition shadow-lg hover:scale-105 flex flex-col items-center gap-3">
        <div class="w-20 h-20 rounded-full bg-gradient-to-br from-pink-400 via-purple-500 to-indigo-500 flex items-center justify-center font-bold text-2xl shadow-xl">${initials}</div>
        <div class="font-semibold text-center text-lg">${name}</div>
        <div class="text-xs text-white/60 flex items-center gap-1">🔒 Password needed</div>
      </button>`;
  }).join('');

  const totalClasses = Object.keys(state.data.classes).length;

  app.innerHTML = `
    <div class="min-h-screen p-4 md:p-8">
      <header class="max-w-6xl mx-auto mb-8 flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 class="text-2xl md:text-4xl font-bold">${state.classKey}</h1>
          <p class="text-white/70 text-sm">Tap your name and enter your secret password</p>
        </div>
        <div class="flex gap-2 items-center flex-wrap">
          ${totalClasses > 1 ? `<button onclick="state.view='classSelect'; render()" class="bg-white/10 hover:bg-white/20 px-4 py-2 rounded-xl text-sm">🔄 Change class</button>` : ''}
          <button onclick="state.view='upload'; render()" class="bg-white/10 hover:bg-white/20 px-4 py-2 rounded-xl text-sm">📁 New file</button>
          <button onclick="openTeacherAccess()" title="Teacher area" class="w-8 h-8 rounded-full bg-white/5 hover:bg-white/20 text-white/40 hover:text-white text-xs transition flex items-center justify-center">·</button>
        </div>
      </header>
      <div class="max-w-6xl mx-auto grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4 fadeIn">${cards}</div>
    </div>`;
}

window.openTeacherAccess = () => {
  state.view = 'teacherAuth';
  render();
};
window.selectStudent = (name) => {
  state.selectedStudent = name;
  state.view = 'studentAuth';
  render();
};

// ============================================================
// STUDENT PASSWORD GATE
// ============================================================
function renderStudentAuth(app) {
  const name = state.selectedStudent;
  const initials = name.replace('Student ','S');
  app.innerHTML = `
    <div class="min-h-screen flex items-center justify-center p-4">
      <div class="bg-white/10 backdrop-blur border border-white/20 rounded-2xl p-8 max-w-md w-full fadeIn">
        <button onclick="state.view='dashboard'; render()" class="text-white/60 hover:text-white text-sm mb-4">← Back</button>
        <div class="text-center mb-6">
          <div class="w-20 h-20 mx-auto rounded-full bg-gradient-to-br from-pink-400 via-purple-500 to-indigo-500 flex items-center justify-center font-bold text-2xl shadow-xl mb-3 floaty">${initials}</div>
          <h2 class="text-2xl font-bold">Hi ${name}!</h2>
          <p class="text-white/70 text-sm mt-1">🔐 Enter your secret password to play</p>
        </div>
        <input type="password" id="studentPwInput" placeholder="Your password" autocomplete="off" class="w-full bg-white/10 border border-white/30 rounded-xl px-4 py-3 mb-3 text-white placeholder-white/50 focus:outline-none focus:border-white text-center text-lg">
        <div id="spwError" class="text-red-300 text-sm mb-3 hidden text-center"></div>
        <button onclick="checkStudentPw()" class="w-full bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-400 hover:to-pink-400 px-4 py-3 rounded-xl font-semibold mb-3">Enter ✨</button>
        <div class="text-xs text-white/40 text-center">Forgot your password? Ask your teacher.</div>
      </div>
    </div>`;
  setTimeout(() => {
    const i = $('studentPwInput');
    if (i) {
      i.focus();
      i.addEventListener('keypress', e => { if (e.key === 'Enter') checkStudentPw(); });
    }
  }, 0);
}

window.checkStudentPw = () => {
  const pw = $('studentPwInput').value.trim();
  const name = state.selectedStudent;
  const studentPw = state.passwords[name];
  if (pw === studentPw || pw === state.teacherPassword) {
    state.view = 'profile';
    render();
  } else {
    const err = $('spwError');
    err.textContent = 'Wrong password. Try again!';
    err.classList.remove('hidden');
    const inp = $('studentPwInput');
    if (inp) { inp.value = ''; inp.classList.add('shake'); setTimeout(() => inp.classList.remove('shake'), 400); }
  }
};

// ============================================================
// TEACHER AUTH
// ============================================================
function renderTeacherAuth(app) {
  app.innerHTML = `
    <div class="min-h-screen flex items-center justify-center p-4">
      <div class="bg-white/10 backdrop-blur border border-white/20 rounded-2xl p-8 max-w-md w-full fadeIn">
        <button onclick="state.view='dashboard'; render()" class="text-white/60 hover:text-white text-sm mb-4">← Back</button>
        <div class="text-center mb-6">
          <div class="text-5xl mb-2">🔐</div>
          <h2 class="text-2xl font-bold">Teacher Area</h2>
          <p class="text-white/60 text-sm mt-1">Restricted access — master password required</p>
        </div>
        <input type="password" id="teacherPwInput" placeholder="Teacher password" autocomplete="off" class="w-full bg-white/10 border border-white/30 rounded-xl px-4 py-3 mb-3 text-white placeholder-white/50 focus:outline-none focus:border-white">
        <div id="pwError" class="text-red-300 text-sm mb-3 hidden"></div>
        <button onclick="checkTeacherPw()" class="w-full bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-400 hover:to-pink-400 px-4 py-3 rounded-xl font-semibold mb-3">Enter</button>
      </div>
    </div>`;
  setTimeout(() => {
    const i = $('teacherPwInput');
    if (i) {
      i.focus();
      i.addEventListener('keypress', e => { if (e.key === 'Enter') checkTeacherPw(); });
    }
  }, 0);
}
window.checkTeacherPw = () => {
  const pw = $('teacherPwInput').value;
  if (pw === state.teacherPassword) {
    state.view = 'passwords';
    render();
  } else {
    const err = $('pwError');
    err.textContent = 'Incorrect password. Try again.';
    err.classList.remove('hidden');
    const inp = $('teacherPwInput');
    if (inp) { inp.value = ''; inp.classList.add('shake'); setTimeout(() => inp.classList.remove('shake'), 400); }
  }
};

// ============================================================
// PASSWORDS LIST
// ============================================================
function renderPasswords(app) {
  const cls = state.data.classes[state.classKey];
  const cards = cls.students.map(name => {
    const pw = state.passwords[name];
    return `
      <div class="print-card border-2 border-dashed border-white/40 rounded-xl p-5">
        <div class="pw-label text-xs text-white/60 uppercase tracking-wider">${state.classKey}</div>
        <div class="pw-name font-bold text-lg mt-1">${name}</div>
        <div class="text-xs text-white/50 mt-2 mb-1">Your secret password:</div>
        <div class="pw-box text-2xl font-mono mt-1 px-4 py-3 bg-white/10 rounded-lg border border-white/20 text-center">${pw}</div>
        <div class="pw-hint text-xs text-white/50 mt-3 text-center">✂️ Cut out & keep safe</div>
      </div>`;
  }).join('');

  app.innerHTML = `
    <div class="min-h-screen p-4 md:p-8">
      <div class="max-w-5xl mx-auto">
        <div class="flex items-center justify-between mb-6 no-print flex-wrap gap-3">
          <button onclick="state.view='dashboard'; render()" class="text-white/70 hover:text-white">← Back</button>
          <div class="flex gap-2">
            <button onclick="changeTeacherPassword()" class="bg-white/10 hover:bg-white/20 px-4 py-2 rounded-xl text-sm">🔑 Change password</button>
            <button onclick="regeneratePasswords()" class="bg-white/10 hover:bg-white/20 px-4 py-2 rounded-xl text-sm">🔄 Regenerate</button>
            <button onclick="window.print()" class="bg-gradient-to-r from-purple-500 to-pink-500 hover:scale-105 transition px-4 py-2 rounded-xl text-sm">🖨️ Print cards</button>
          </div>
        </div>
        <h1 class="text-3xl font-bold mb-2 no-print">Student Passwords</h1>
        <p class="text-white/70 mb-2 no-print">Cut along the dashed lines and hand each student their card.</p>
        <p class="text-yellow-200/90 text-sm mb-6 no-print">💡 Tip: The teacher password (<code class="bg-white/10 px-1 rounded">${state.teacherPassword}</code>) works as a master key — you can use it to access any student's page.</p>
        <div class="grid sm:grid-cols-2 md:grid-cols-3 gap-4">${cards}</div>
      </div>
    </div>`;
}
window.changeTeacherPassword = () => {
  const newPw = prompt('Enter new teacher password (min 4 chars):', state.teacherPassword);
  if (newPw && newPw.length >= 4) { state.teacherPassword = newPw; alert('Password updated for this session.'); render(); }
  else if (newPw !== null) { alert('Password must be at least 4 characters.'); }
};
window.regeneratePasswords = () => {
  if (confirm('Generate new passwords for all students?')) {
    const cls = state.data.classes[state.classKey];
    const used = new Set();
    state.passwords = {};
    cls.students.forEach(name => {
      let pw, tries = 0;
      do {
        const adj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
        const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)];
        pw = `${adj} ${noun}`;
        tries++;
        if (tries > 80) { pw = `${pw} ${tries}`; break; }
      } while (used.has(pw));
      used.add(pw);
      state.passwords[name] = pw;
    });
    render();
  }
};

// ============================================================
// PROFILE
// ============================================================
window.playSound = (text) => { speak(text); };

function profileTrackBannerArt(track) {
  const stroke = track === 'gpc' ? '#7dd3fc' : '#fda4af';
  const fill1 = track === 'gpc' ? '#38bdf8' : '#fb7185';
  const fill2 = track === 'gpc' ? '#6366f1' : '#e11d48';
  const fill3 = track === 'gpc' ? '#fde047' : '#fde047';
  const fill4 = track === 'gpc' ? '#22d3ee' : '#fde047';
  if (track === 'gpc') {
    return `<svg class="game-track-banner-svg" viewBox="0 0 320 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" preserveAspectRatio="xMidYMid meet">
    <path d="M8 14 Q80 8 160 14 T312 14" fill="none" stroke="${stroke}" stroke-width="3" stroke-linecap="round" opacity="0.7"/>
    <circle cx="40" cy="14" r="8" fill="${fill1}" stroke="#fff" stroke-width="2"/>
    <text x="40" y="17.5" text-anchor="middle" font-size="10" font-weight="800" fill="#fff">1</text>
    <circle cx="120" cy="14" r="9" fill="${fill2}" stroke="#fff" stroke-width="2"/>
    <text x="120" y="18" text-anchor="middle" font-size="10" font-weight="800" fill="#fff">2</text>
    <circle cx="200" cy="14" r="9" fill="${fill3}" stroke="#fff" stroke-width="2"/>
    <text x="200" y="18" text-anchor="middle" font-size="10" font-weight="800" fill="#422006">3</text>
    <circle cx="280" cy="14" r="10" fill="${fill4}" stroke="#fff" stroke-width="2"/>
    <text x="280" y="18" text-anchor="middle" font-size="11" font-weight="800" fill="#fff">4</text>
    <polygon points="72,14 80,10 80,18" fill="${stroke}" opacity="0.85"/>
    <polygon points="152,14 160,10 160,18" fill="${stroke}" opacity="0.85"/>
    <polygon points="232,14 240,10 240,18" fill="${stroke}" opacity="0.85"/>
  </svg>`;
  }
  return `<svg class="game-track-banner-svg" viewBox="0 0 320 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" preserveAspectRatio="xMidYMid meet">
    <path d="M8 14 Q80 8 160 14 T312 14" fill="none" stroke="${stroke}" stroke-width="3" stroke-linecap="round" opacity="0.7"/>
    <circle cx="48" cy="14" r="9" fill="${fill1}" stroke="#fff" stroke-width="2"/>
    <text x="48" y="18" text-anchor="middle" font-size="11" font-weight="800" fill="#fff">1</text>
    <circle cx="160" cy="14" r="10" fill="${fill2}" stroke="#fff" stroke-width="2"/>
    <text x="160" y="18.5" text-anchor="middle" font-size="11" font-weight="800" fill="#fff">2</text>
    <circle cx="272" cy="14" r="11" fill="${fill3}" stroke="#fff" stroke-width="2"/>
    <text x="272" y="18.5" text-anchor="middle" font-size="12" font-weight="800" fill="#422006">3</text>
    <polygon points="100,14 108,10 108,18" fill="${stroke}" opacity="0.85"/>
    <polygon points="212,14 220,10 220,18" fill="${stroke}" opacity="0.85"/>
  </svg>`;
}

function profileSectionIcon(kind) {
  const icons = {
    targets: `<svg class="profile-section-icon" viewBox="0 0 32 32" width="28" height="28" aria-hidden="true"><circle cx="16" cy="16" r="14" fill="#6366f1"/><circle cx="16" cy="16" r="9" fill="#818cf8"/><circle cx="16" cy="16" r="4" fill="#fde047"/></svg>`,
    sounds: `<svg class="profile-section-icon" viewBox="0 0 32 32" width="28" height="28" aria-hidden="true"><rect x="4" y="10" width="5" height="12" rx="2" fill="#22d3ee"/><rect x="12" y="6" width="5" height="20" rx="2" fill="#38bdf8"/><rect x="20" y="12" width="5" height="8" rx="2" fill="#0ea5e9"/></svg>`,
    words: `<svg class="profile-section-icon" viewBox="0 0 32 32" width="28" height="28" aria-hidden="true"><path d="M8 8h16v4H12v12H8V8z" fill="#fb7185"/><path d="M14 8h10v16h-4V12h-6V8z" fill="#f472b6" opacity="0.85"/></svg>`,
    games: `<svg class="profile-section-icon" viewBox="0 0 32 32" width="28" height="28" aria-hidden="true"><rect x="4" y="10" width="24" height="14" rx="6" fill="#a855f7"/><circle cx="11" cy="17" r="3" fill="#fde047"/><circle cx="21" cy="17" r="3" fill="#fde047"/></svg>`,
    collection: `<svg class="profile-section-icon" viewBox="0 0 32 32" width="28" height="28" aria-hidden="true"><path d="M16 4l3.2 6.5 7.2 1-5.2 5 1.2 7.2L16 20.8l-6.4 3.4 1.2-7.2-5.2-5 7.2-1L16 4z" fill="#fbbf24" stroke="#fef08a" stroke-width="1.5"/></svg>`,
    starcade: `<svg class="profile-section-icon" viewBox="0 0 32 32" width="56" height="56" aria-hidden="true"><path d="M16 3l4 8.2 9.2 1.3-6.7 6.5 1.6 9.2L16 23.4l-8.1 4.8 1.6-9.2-6.7-6.5 9.2-1.3L16 3z" fill="#fbbf24" stroke="#fef08a" stroke-width="1.5"/></svg>`
  };
  return icons[kind] || '';
}

function profileTargetChip(value, type) {
  const hasAud = hasAudio(value);
  const borderCls = flashBorderClass(value);
  const grad = type === 'gpc'
    ? 'bg-gradient-to-br from-cyan-500/30 to-blue-600/30 border-cyan-300/40'
    : 'bg-gradient-to-br from-pink-500/30 to-rose-600/30 border-pink-300/40';
  const textCls = type === 'gpc' ? 'text-2xl' : 'text-xl';
  const esc = value.replace(/'/g, "\\'");
  return `<div class="inline-flex items-center gap-1 ${grad} border rounded-xl px-3 py-2 ${borderCls}">
    <span class="${textCls} font-bold">${value}</span>
    ${hasAud ? `<button type="button" onclick="playSound('${esc}')" class="ml-1 w-8 h-8 rounded-full bg-yellow-400/30 hover:bg-yellow-400/60 text-base transition transform hover:scale-110" title="Listen">🔊</button>` : ''}
  </div>`;
}

function buildProfileSortedTargets(items, valueKey, type) {
  const got = [];
  const tricky = [];
  const unchecked = [];
  items.forEach(item => {
    const value = item[valueKey];
    const status = getFlashStatus(value);
    if (status === 'got') got.push(item);
    else if (status === 'tricky') tricky.push(item);
    else unchecked.push(item);
  });
  const gotHtml = got.length
    ? got.map(x => profileTargetChip(x[valueKey], type)).join('')
    : `<span class="profile-target-empty">None yet</span>`;
  const trickyHtml = tricky.length
    ? tricky.map(x => profileTargetChip(x[valueKey], type)).join('')
    : `<span class="profile-target-empty">None yet</span>`;
  const uncheckedHtml = unchecked.length
    ? unchecked.map(x => profileTargetChip(x[valueKey], type)).join('')
    : '';
  const uncheckedBlock = uncheckedHtml
    ? `<div class="profile-target-unchecked"><div class="flex flex-wrap gap-2">${uncheckedHtml}</div></div>`
    : '';
  return `${uncheckedBlock}
    <div class="profile-target-col profile-target-col--got">
      <div class="profile-target-col-title"><span class="inline-block w-4 h-4 rounded ring-2 ring-green-400 bg-white/10"></span> I know it</div>
      <div class="profile-target-col-body">${gotHtml}</div>
    </div>
    <div class="profile-target-col profile-target-col--tricky">
      <div class="profile-target-col-title"><span class="inline-block w-4 h-4 rounded ring-2 ring-orange-400 bg-white/10"></span> Still learning</div>
      <div class="profile-target-col-body">${trickyHtml}</div>
    </div>`;
}

function profileTrackIllustration(track, step) {
  const badge = `<circle cx="18" cy="18" r="16" fill="rgba(255,255,255,0.92)" stroke="rgba(0,0,0,0.12)" stroke-width="2"/>
    <text x="18" y="24" text-anchor="middle" font-size="17" font-weight="800" fill="#1e293b">${step}</text>`;
  if (track === 'gpc') {
    if (step === 1) return `<svg class="game-track-svg" viewBox="0 0 160 100" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      ${badge}
      <circle cx="88" cy="58" r="34" fill="#0ea5e9"/>
      <text x="88" y="68" text-anchor="middle" font-size="36" font-weight="800" fill="#fff" font-family="Andika,sans-serif">sh</text>
      <path d="M52 42 L44 58 L52 74" stroke="#fde047" stroke-width="5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>`;
    if (step === 2) return `<svg class="game-track-svg" viewBox="0 0 160 100" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      ${badge}
      <rect x="48" y="36" width="64" height="44" rx="14" fill="#22d3ee"/>
      <text x="80" y="68" text-anchor="middle" font-size="30" font-weight="800" fill="#fff" font-family="Andika,sans-serif">ch</text>
      <circle cx="118" cy="44" r="10" fill="#f472b6"/>
      <circle cx="130" cy="72" r="9" fill="#a855f7"/>
    </svg>`;
    if (step === 3) return `<svg class="game-track-svg" viewBox="0 0 160 100" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      ${badge}
      <rect x="52" y="34" width="32" height="44" rx="8" fill="#38bdf8" stroke="#fff" stroke-width="2"/>
      <text x="68" y="66" text-anchor="middle" font-size="28" font-weight="800" fill="#fff" font-family="Andika,sans-serif">b</text>
      <rect x="96" y="34" width="32" height="44" rx="8" fill="#6366f1" stroke="#fff" stroke-width="2" transform="rotate(180 112 56)"/>
      <text x="112" y="66" text-anchor="middle" font-size="28" font-weight="800" fill="#e0e7ff" font-family="Andika,sans-serif" transform="rotate(180 112 56)">b</text>
    </svg>`;
    return `<svg class="game-track-svg" viewBox="0 0 160 100" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      ${badge}
      <rect x="38" y="42" width="26" height="32" rx="6" fill="#38bdf8" stroke="#fff" stroke-width="2"/>
      <rect x="68" y="42" width="26" height="32" rx="6" fill="#0ea5e9" stroke="#fff" stroke-width="2"/>
      <rect x="98" y="42" width="26" height="32" rx="6" fill="#6366f1" stroke="#fff" stroke-width="2"/>
      <text x="124" y="64" text-anchor="middle" font-size="22" font-weight="800" fill="#fff" font-family="Andika,sans-serif">e</text>
      <rect x="28" y="78" width="22" height="14" rx="4" fill="#22d3ee" stroke="#fff" stroke-width="1.5"/>
      <text x="39" y="88" text-anchor="middle" font-size="9" font-weight="800" fill="#fff" font-family="Andika,sans-serif">sh</text>
      <rect x="54" y="78" width="22" height="14" rx="4" fill="#818cf8" stroke="#fff" stroke-width="1.5"/>
      <text x="65" y="88" text-anchor="middle" font-size="9" font-weight="800" fill="#fff" font-family="Andika,sans-serif">a_e</text>
      <rect x="80" y="78" width="22" height="14" rx="4" fill="#a855f7" stroke="#fff" stroke-width="1.5"/>
      <text x="91" y="88" text-anchor="middle" font-size="9" font-weight="800" fill="#fff" font-family="Andika,sans-serif">t</text>
    </svg>`;
  }
  if (track === 'heart') {
    if (step === 1) return `<svg class="game-track-svg" viewBox="0 0 160 100" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      ${badge}
      <circle cx="88" cy="58" r="34" fill="#f472b6"/>
      <text x="88" y="68" text-anchor="middle" font-size="30" font-weight="800" fill="#fff" font-family="Andika,sans-serif">the</text>
      <circle cx="48" cy="46" r="12" fill="#fde047"/>
      <circle cx="42" cy="56" r="9" fill="#fb923c"/>
      <circle cx="54" cy="58" r="7" fill="#f97316"/>
    </svg>`;
    if (step === 2) return `<svg class="game-track-svg" viewBox="0 0 160 100" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      ${badge}
      <rect x="46" y="38" width="72" height="44" rx="14" fill="#fb7185"/>
      <text x="62" y="68" text-anchor="middle" font-size="26" font-weight="800" fill="#fff" font-family="Andika,sans-serif">w</text>
      <rect x="78" y="52" width="22" height="8" rx="3" fill="rgba(255,255,255,0.45)"/>
      <text x="108" y="68" text-anchor="middle" font-size="26" font-weight="800" fill="#fff" font-family="Andika,sans-serif">s</text>
      <circle cx="128" cy="44" r="10" fill="#fde047"/>
      <circle cx="138" cy="72" r="9" fill="#e11d48"/>
    </svg>`;
    return `<svg class="game-track-svg" viewBox="0 0 160 100" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      ${badge}
      <rect x="52" y="40" width="22" height="32" rx="6" fill="#fda4af" stroke="#fff" stroke-width="2"/>
      <text x="63" y="64" text-anchor="middle" font-size="22" font-weight="800" fill="#fff" font-family="Andika,sans-serif">c</text>
      <rect x="78" y="40" width="22" height="32" rx="6" fill="#f472b6" stroke="#fff" stroke-width="2"/>
      <text x="89" y="64" text-anchor="middle" font-size="22" font-weight="800" fill="#fff" font-family="Andika,sans-serif">a</text>
      <rect x="104" y="40" width="22" height="32" rx="6" fill="#e11d48" stroke="#fff" stroke-width="2"/>
      <text x="115" y="64" text-anchor="middle" font-size="22" font-weight="800" fill="#fff" font-family="Andika,sans-serif">t</text>
      <line x1="48" y1="76" x2="130" y2="76" stroke="#fecdd3" stroke-width="3" stroke-linecap="round"/>
    </svg>`;
  }
  return '';
}

function profileFlashIllustration() {
  return `<svg class="game-track-svg" viewBox="0 0 160 100" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <rect x="36" y="22" width="44" height="56" rx="8" fill="#4ade80" stroke="#fff" stroke-width="3"/>
    <rect x="80" y="30" width="44" height="48" rx="8" fill="#fb923c" stroke="#fff" stroke-width="3" transform="rotate(8 102 54)"/>
    <path d="M48 42 L56 50 L68 36" stroke="#fff" stroke-width="4" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
    <text x="102" y="58" text-anchor="middle" font-size="28" font-weight="800" fill="#fff">?</text>
    <path d="M72 78 L80 58 L88 78 L76 66 Z" fill="#fde047" stroke="#fbbf24" stroke-width="2"/>
  </svg>`;
}

function profileTrackCard({ id, track, step, title, disabled, played }) {
  const dis = disabled ? 'disabled' : '';
  const check = played ? '<span class="game-track-check" aria-hidden="true">✓</span>' : '';
  return `<button type="button" onclick="startGame('${id}')" ${dis}
    class="game-track-card game-track-${track} game-track-step-${step} relative"
    aria-label="${title}${played ? ' — played' : ''}">
    ${check}
    <div class="game-track-visual">${profileTrackIllustration(track, step)}</div>
    <h3 class="game-track-title arcade-title-friendly">${title}</h3>
  </button>`;
}

function renderProfile(app){
  const name = state.selectedStudent;
  if (state.classKey && state.gamePlayed[name] === undefined) {
    try {
      const v = localStorage.getItem(gamePlayedKey(name));
      state.gamePlayed[name] = v ? JSON.parse(v) : {};
    } catch (e) { state.gamePlayed[name] = {}; }
  }
  const needs = getStudentNeeds(name);
  const points = getPoints(name);
  const hasGpcTargets = needs.targetGpcs.length > 0;
  const hasHwTargets = needs.targetHws.length > 0;
  const hasAnyTargets = hasGpcTargets || hasHwTargets;

  const gpcTargetsHtml = needs.targetGpcs.length
    ? `<div class="profile-target-columns">${buildProfileSortedTargets(needs.targetGpcs, 'gpc', 'gpc')}</div>`
    : `<div class="text-white/50 italic text-sm">Great work — no sounds to practise right now!</div>`;

  const hwTargetsHtml = needs.targetHws.length
    ? `<div class="profile-target-columns">${buildProfileSortedTargets(needs.targetHws, 'hw', 'hw')}</div>`
    : `<div class="text-white/50 italic text-sm">Great work — no words to practise right now!</div>`;

  const collectionItems = [...needs.masteredGpcs.map(x => x.gpc), ...needs.masteredHws.map(x => x.hw)];
  const collectionHtml = collectionItems.length
    ? collectionItems.slice(0, 30).map(x => {
        const hasAud = hasAudio(x);
        const borderCls = flashBorderClass(x);
        return `<span class="inline-flex items-center gap-1 px-2 py-1 bg-yellow-400/20 border border-yellow-300/30 rounded-md text-sm ${borderCls}">
          ${x}
          ${hasAud ? `<button onclick="playSound('${x.replace(/'/g,"\\'")}')" class="w-5 h-5 rounded-full bg-yellow-400/30 hover:bg-yellow-400/60 text-xs transition" title="Listen">🔊</button>` : ''}
        </span>`;
      }).join(' ')
    : `<div class="text-white/50 italic text-sm">Play games to build your collection!</div>`;

  const flashMap = state.flashResults[name] || {};
  const hasFlashMarks = Object.keys(flashMap).length > 0;
  const playedMap = getGamePlayedMap(name);
  const flashPlayed = !!playedMap.flash;

  app.innerHTML = `
    <div class="min-h-screen p-4 md:p-8 student-friendly">
      <div class="max-w-5xl mx-auto">
        <button onclick="logoutStudent()" class="text-white/70 hover:text-white mb-4 text-sm">← Back to class (logs out)</button>
        
        <header class="bg-white/10 backdrop-blur border border-white/20 rounded-2xl p-6 mb-6 fadeIn">
          <div class="flex items-center gap-4 mb-4 flex-wrap">
            <div class="w-16 h-16 rounded-full bg-gradient-to-br from-pink-400 via-purple-500 to-indigo-500 flex items-center justify-center font-bold text-xl flex-shrink-0 shadow-xl">${name.replace('Student ','S')}</div>
            <div class="flex-1 min-w-0">
              <h1 class="text-2xl md:text-3xl font-bold">Hello, ${name}!</h1>
            </div>
            <div class="bg-gradient-to-r from-yellow-400 to-orange-400 text-purple-900 px-4 py-2 rounded-2xl font-bold shadow-lg">
              <span class="text-xl">⭐</span> <span class="text-xl">${points}</span> <span class="text-xs">stars</span>
            </div>
          </div>
        </header>

        <h2 class="text-xl font-bold mb-3 profile-heading-row">${profileSectionIcon('games')}<span>Reading Games</span></h2>

        <section class="game-track-section game-track-section-gpc fadeIn" aria-label="Letter sound games">
          <div class="game-track-banner" aria-hidden="true">${profileTrackBannerArt('gpc')}</div>
          <div class="game-track-grid">
            ${profileTrackCard({ id: 'gpcMatch', track: 'gpc', step: 1, title: 'Splat the Sound', disabled: !hasGpcTargets, played: !!playedMap.gpcMatch })}
            ${profileTrackCard({ id: 'gpcCatch', track: 'gpc', step: 2, title: 'Sound Splat Challenge!', disabled: !hasGpcTargets, played: !!playedMap.gpcCatch })}
            ${profileTrackCard({ id: 'soundFlip', track: 'gpc', step: 3, title: 'Sound Flip', disabled: !hasGpcTargets, played: !!playedMap.soundFlip })}
            ${profileTrackCard({ id: 'soundBox', track: 'gpc', step: 4, title: 'Sound Box', disabled: !hasGpcTargets, played: !!playedMap.soundBox })}
          </div>
        </section>

        <section class="game-track-section game-track-section-heart fadeIn" aria-label="Tricky word games">
          <div class="game-track-banner" aria-hidden="true">${profileTrackBannerArt('heart')}</div>
          <div class="game-track-grid">
            ${profileTrackCard({ id: 'hwHunt', track: 'heart', step: 1, title: 'Splat the Word!', disabled: !hasHwTargets, played: !!playedMap.hwHunt })}
            ${profileTrackCard({ id: 'hwBlank', track: 'heart', step: 2, title: 'Word Challenge!', disabled: !hasHwTargets, played: !!playedMap.hwBlank })}
            ${profileTrackCard({ id: 'hwBoxes', track: 'heart', step: 3, title: 'Word Box', disabled: !hasHwTargets, played: !!playedMap.hwBoxes })}
          </div>
        </section>

        <div class="flex justify-center mb-6 fadeIn">
          <button type="button" onclick="startGame('flash')" ${!hasAnyTargets?'disabled':''}
            class="game-track-card game-track-flash w-full max-w-[14rem] relative"
            aria-label="Self Check${flashPlayed ? ' — used' : ''}">
            ${flashPlayed ? '<span class="game-track-check" aria-hidden="true">✓</span>' : ''}
            <div class="game-track-visual">${profileFlashIllustration()}</div>
            <h3 class="game-track-title arcade-title-friendly">Self Check</h3>
            <p class="text-xs text-white/85 mt-1 px-2 leading-snug">Check which sounds and words you know</p>
          </button>
        </div>

        <details class="profile-targets-details bg-gradient-to-br from-indigo-600/30 to-purple-700/30 backdrop-blur border border-indigo-300/40 rounded-2xl p-6 fadeIn" open>
          <summary class="profile-targets-summary profile-heading-row">
            ${profileSectionIcon('targets')}<span>My Reading Targets</span>
            <span class="profile-targets-chevron" aria-hidden="true">▼</span>
          </summary>
          <div class="profile-targets-body">
            ${hasFlashMarks ? `
              <div class="profile-flash-legend">
                <span class="inline-flex items-center gap-1"><span class="inline-block w-4 h-4 rounded ring-2 ring-green-400 bg-white/10"></span> I know it</span>
                <span class="inline-flex items-center gap-1"><span class="inline-block w-4 h-4 rounded ring-2 ring-orange-400 bg-white/10"></span> Still learning</span>
              </div>
            ` : ''}

            <div class="mb-5">
              <h3 class="font-semibold text-cyan-200 mb-2 profile-heading-row">${profileSectionIcon('sounds')}<span>Sounds</span></h3>
              ${gpcTargetsHtml}
            </div>

            <div>
              <h3 class="font-semibold text-pink-200 mb-2 profile-heading-row">${profileSectionIcon('words')}<span>Words</span></h3>
              ${hwTargetsHtml}
            </div>
          </div>
        </details>

        <details class="bg-white/5 rounded-2xl p-5 mb-6">
          <summary class="cursor-pointer font-semibold profile-heading-row">${profileSectionIcon('collection')}<span>Your word collection</span></summary>
          <div class="flex flex-wrap gap-2 mt-3">${collectionHtml}</div>
        </details>

        <div class="mt-8 pt-6 border-t border-white/10">
          <button onclick="openArcadeMenu()" class="w-full bg-white/5 hover:bg-white/10 border border-white/15 rounded-2xl p-6 fadeIn flex flex-col items-center justify-center text-center transition transform hover:scale-[1.02]">
            ${profileSectionIcon('starcade')}
            <div class="mt-2 font-extrabold text-xl arcade-title-friendly">Starcade Bonus</div>
          </button>
        </div>
      </div>
    </div>`;
}

window.logoutStudent = () => {
  state.view = 'dashboard';
  render();
};

window.openArcadeMenu = () => {
  state.arcadeGame = 'menu';
  state.view = 'arcade';
  render();
};

// ============================================================
// READING GAMES
// ============================================================
window.startGame = (g) => {
  sfxClick();
  if (g === 'flash') {
    const needs = getStudentNeeds(state.selectedStudent);
    const gpcPool = getFlashPoolForKind(needs, 'gpc');
    const hwPool = getFlashPoolForKind(needs, 'hw');
    if (gpcPool.length === 0 && hwPool.length === 0) {
      state.game = { type: 'flash', empty: true, pointsAwarded: false, trackMarked: false };
      state.view = 'game';
      render();
      return;
    }
    state.flashHub = { needs, gpcCount: gpcPool.length, hwCount: hwPool.length };
    state.view = 'flashKind';
    render();
    return;
  }
  state.game = { type: g, score: 0, attempts: 0, correct: 0, history: [], roundIdx: 0, totalRounds: CHALLENGE_ROUNDS, pointsAwarded: false, trackMarked: false };
  state.view = 'game';
  initGame();
  render();
};

window.pickFlashKind = (kind) => {
  sfxClick();
  const hub = state.flashHub;
  if (!hub) return;
  const pool = getFlashPoolForKind(hub.needs, kind);
  if (pool.length === 0) return;
  hub.kind = kind;
  hub.sets = splitIntoStaticFlashSets(pool);
  state.view = 'flashSets';
  render();
};

window.beginFlashSet = (setIndex) => {
  sfxClick();
  const hub = state.flashHub;
  if (!hub || !hub.sets || !hub.sets[setIndex]) return;
  const cards = orderFlashSetForPlay(hub.sets[setIndex]);
  state.game = {
    type: 'flash',
    score: 0,
    attempts: 0,
    correct: 0,
    history: [],
    cardIdx: 0,
    cards,
    totalRounds: cards.length,
    flashSetRef: { kind: hub.kind, setIndex },
    pointsAwarded: false,
    trackMarked: false,
  };
  state.view = 'game';
  render();
};

function finishFlashSetAndReturn() {
  state.game = null;
  state.view = 'flashSets';
  render();
}

function completeFlashSet() {
  const g = state.game;
  const name = state.selectedStudent;
  if (g?.flashSetRef && name) {
    markFlashSetAttempted(name, g.flashSetRef.kind, g.flashSetRef.setIndex);
  }
  finishFlashSetAndReturn();
}
function initGame(){
  const needs = getStudentNeeds(state.selectedStudent);
  const g = state.game;
  if (g.type === 'gpcMatch') {
    g.roundTargets = buildRoundTargets(needs, 'gpc', CHALLENGE_ROUNDS);
    g.targetPool = uniqueValidTokens([...needs.targetGpcs.map(x => x.gpc), ...needs.masteredGpcs.map(x => x.gpc)]);
    g.distractorPool = uniqueValidTokens(needs.masteredGpcs.map(x => x.gpc));
    g.totalRounds = CHALLENGE_ROUNDS;
    if (g.roundTargets.length === 0) g.empty = true;
  } else if (g.type === 'hwHunt') {
    g.roundTargets = buildRoundTargets(needs, 'hw', CHALLENGE_ROUNDS);
    g.targetPool = uniqueValidTokens([...needs.targetHws.map(x => x.hw), ...needs.masteredHws.map(x => x.hw)]);
    g.distractorPool = uniqueValidTokens(needs.masteredHws.map(x => x.hw));
    g.totalRounds = CHALLENGE_ROUNDS;
    if (g.roundTargets.length === 0) g.empty = true;
  } else if (g.type === 'flash') {
    if (!g.cards) g.cards = [];
    g.cardIdx = g.cardIdx || 0;
    g.totalRounds = g.cards.length;
  } else if (g.type === 'gpcCatch') {
    initCatchSound(needs);
    return;
  } else if (g.type === 'soundFlip') {
    initSoundFlip(needs);
    return;
  } else if (g.type === 'soundBox') {
    initSoundBox(needs);
    return;
  } else if (g.type === 'hwBlank') {
    initHwBlank(needs);
    return;
  } else if (g.type === 'hwBoxes') {
    initHwBoxes(needs);
    return;
  }
  if (g.targetPool && g.targetPool.length === 0) g.empty = true;
  if (g.cards && g.cards.length === 0) g.empty = true;
  if (!g.empty) newRound();
}
function newRound(){
  const g = state.game;
  if (!g.targetPool && !g.roundTargets) return;
  if (g.roundIdx >= g.totalRounds) { g.finished = true; return; }
  const target = g.roundTargets
    ? g.roundTargets[g.roundIdx]
    : g.targetPool[g.roundIdx % g.targetPool.length];
  const kind = g.type === 'gpcMatch' ? 'gpc' : 'hw';
  g.currentTarget = String(target ?? '').trim();
  g.currentOptions = buildChallengeOptions(g.currentTarget, g.distractorPool, g.targetPool, 3, kind);
  if (!isValidGameToken(g.currentTarget) || g.currentOptions.length < 2) {
    g.roundIdx++;
    if (g.roundIdx >= g.totalRounds) g.finished = true;
    else newRound();
    return;
  }
  g.currentExampleWord = kind === 'gpc' ? resolveGpcExampleWord(g.currentTarget) : '';
  g.currentHwContext = kind === 'hw' ? getHwContextSnippet(g.currentTarget) : '';
  g.feedback = null;
  resetTargetAudioFlags(g);
}
function renderGame(app){
  const g = state.game;
  if (g.empty) {
    app.innerHTML = `<div class="min-h-screen flex items-center justify-center p-4">
      <div class="bg-white/10 backdrop-blur rounded-2xl p-8 text-center max-w-md">
        <div class="text-5xl mb-3">🎉</div>
        <h2 class="text-2xl font-bold mb-2">Nothing to practise!</h2>
        <p class="text-white/70 mb-4">You've mastered everything in this category.</p>
        <button onclick="state.view='profile'; render()" class="bg-white/20 hover:bg-white/30 px-5 py-2 rounded-xl">Back</button>
      </div></div>`;
    return;
  }
  if (g.finished && g.type === 'flash' && g.flashSetRef) {
    completeFlashSet();
    return;
  }
  if (g.finished) return renderGameEnd(app);
  if (g.type === 'gpcMatch') return renderSoundPlanets(app);
  if (g.type === 'hwHunt') return renderHeartWordHunt(app);
  if (g.type === 'flash') return renderFlashGame(app);
  if (g.type === 'gpcCatch') return renderCatchSound(app);
  if (g.type === 'soundFlip') return renderSoundFlip(app);
  if (g.type === 'soundBox') return renderSoundBox(app);
  if (g.type === 'hwBlank') return renderHwBlank(app);
  if (g.type === 'hwBoxes') return renderHwBoxes(app);
}
function renderSoundPlanets(app) {
  const g = state.game;
  const exampleWord = g.currentExampleWord || resolveGpcExampleWord(g.currentTarget);
  const exampleHint = g.feedback ? '' : renderGpcExampleHint(exampleWord);
  const playHeader = renderGamePlayHeader({
    feedbackMessage: g.feedback?.message,
    feedbackCorrect: g.feedback?.correct,
    nextOnclick: challengeNextOnclick(g),
    nextLabel: challengeNextLabel(g),
  });
  const listenBtn = (!g.feedback && hasAudio(g.currentTarget))
    ? `<button type="button" id="listenBtn" class="gpc-splat-listen gpc-splat-listen--lg gpc-splat-listen-corner">🔊 Listen</button>`
    : '';
  const optionsHtml = g.currentOptions.map(opt => {
    let cls = `optionBtn bg-gradient-to-br from-cyan-400 to-blue-600 splat aspect-square flex items-center justify-center text-3xl md:text-5xl font-bold cursor-pointer transition transform hover:scale-105 shadow-2xl`;
    if (g.feedback) {
      if (opt === g.currentTarget) cls += ' ring-4 ring-green-400 scale-110';
      else if (g.feedback.picked === opt) cls += ' ring-4 ring-red-400 opacity-50 shake';
      else cls += ' opacity-30';
    }
    return `<button class="${cls}" data-option="${opt}">${opt}</button>`;
  }).join('');

  app.innerHTML = `
    <div class="gpc-splat-screen gpc-splat-screen--match p-4 md:p-8">
      <div class="max-w-4xl mx-auto relative w-full">
        ${renderGameTopBar(g)}
        <div class="gpc-splat-top-bar">
          ${exampleHint ? `<div class="gpc-example-corner">${exampleHint}</div>` : ''}
          ${listenBtn}
        </div>
        <div class="flex-shrink-0">${playHeader}</div>
        <div class="gpc-splat-area">
          <div class="gpc-splat-grid-wrap max-w-4xl w-full mx-auto">
            <div class="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4 fadeIn">${optionsHtml}</div>
          </div>
        </div>
      </div>
    </div>`;
  attachMatchHandlers('gpc');
}

function renderHeartWordHunt(app) {
  const g = state.game;
  const playHeader = renderGamePlayHeader({
    contextHtml: renderHwContextBar(g.currentHwContext || g.currentTarget),
    feedbackMessage: g.feedback?.message,
    feedbackCorrect: g.feedback?.correct,
    nextOnclick: challengeNextOnclick(g),
    nextLabel: challengeNextLabel(g),
  });
  const optionsHtml = g.currentOptions.map(opt => {
    let cls = `optionBtn bg-gradient-to-br from-pink-400 to-rose-600 splat-soft py-8 px-4 flex items-center justify-center text-3xl md:text-4xl font-bold cursor-pointer transition transform hover:scale-105 shadow-2xl`;
    if (g.feedback) {
      if (opt === g.currentTarget) cls += ' ring-4 ring-green-400 scale-110';
      else if (g.feedback.picked === opt) cls += ' ring-4 ring-red-400 opacity-50 shake';
      else cls += ' opacity-30';
    }
    return `<button class="${cls}" data-option="${opt}">${opt}</button>`;
  }).join('');

  app.innerHTML = `
    <div class="min-h-screen p-4 md:p-8">
      <div class="max-w-4xl mx-auto">
        ${renderGameTopBar(g)}
        ${playHeader}
        <div class="text-center mb-6">
          <button id="listenBtn" class="bg-gradient-to-r from-yellow-400 to-orange-500 hover:from-yellow-300 hover:to-orange-400 text-white font-bold px-8 py-4 rounded-2xl text-xl shadow-2xl transform hover:scale-105 transition">🔊 Listen</button>
        </div>
        <div class="grid grid-cols-2 md:grid-cols-4 gap-4 fadeIn">${optionsHtml}</div>
      </div>
    </div>`;
  attachMatchHandlers('hw');
}

function attachMatchHandlers(type) {
  const g = state.game;
  setTimeout(() => {
    document.querySelectorAll('.optionBtn').forEach(btn => {
      btn.addEventListener('click', () => { sfxClick(); pickOption(btn.getAttribute('data-option'), type); });
    });
    const listenBtn = $('listenBtn');
    if (listenBtn) listenBtn.addEventListener('click', () => playTargetListen(g.currentTarget));
    if (!g.feedback) setTimeout(() => playTargetOnShow(g, g.currentTarget), 400);
    afterGameRenderArmNext();
  }, 0);
}
window.pickOption = (opt, type) => {
  const g = state.game;
  if (g.feedback) return;
  if (!isValidGameToken(opt)) return;
  const correct = opt === g.currentTarget;
  const gameKind = g.type;
  const retryRound = isChallengeRetryGame(gameKind);
  if (correct) {
    g.attempts++;
    g.correct++;
    confetti();
    g.feedback = { picked: opt, correct: true, message: correctFeedback(g.currentTarget, type, gameKind) };
    playTargetOnCorrect(g, g.currentTarget);
    g.history.push({ target: g.currentTarget, picked: opt, correct, type });
  } else if (retryRound) {
    g.feedback = { picked: opt, correct: false, message: challengeWrongFeedback(g.currentTarget, type, gameKind) };
  } else {
    g.attempts++;
    g.feedback = { picked: opt, correct: false, message: wrongFeedback(g.currentTarget, type, gameKind) };
    g.history.push({ target: g.currentTarget, picked: opt, correct, type });
  }
  render();
};
window.nextRound = () => {
  clearGameNextBtnTimer(state.game);
  state.game.roundIdx++;
  newRound();
  render();
};

// ============================================================
// SELF CHECK (flash cards)
// ============================================================
function renderFlashKindPick(app) {
  const hub = state.flashHub;
  if (!hub) {
    state.view = 'profile';
    render();
    return;
  }
  const gpcDisabled = hub.gpcCount === 0;
  const hwDisabled = hub.hwCount === 0;

  app.innerHTML = `
    <div class="min-h-screen p-4 md:p-8 flex flex-col items-center justify-center">
      <div class="max-w-lg w-full bg-white/10 backdrop-blur border border-white/20 rounded-2xl p-8 text-center fadeIn">
        <button type="button" onclick="state.flashHub=null; state.view='profile'; render()" class="text-white/60 hover:text-white text-sm mb-4 block mx-auto">← Back</button>
        <h2 class="text-2xl font-bold mb-2 arcade-title-friendly">Self Check</h2>
        <p class="text-white/80 mb-6 text-sm leading-relaxed">What would you like to check?</p>
        <div class="flex flex-col sm:flex-row gap-3 justify-center">
          <button type="button" onclick="pickFlashKind('gpc')" ${gpcDisabled ? 'disabled' : ''}
            class="bg-cyan-500/35 hover:bg-cyan-500/50 border-2 border-cyan-300/60 px-6 py-4 rounded-xl font-semibold text-lg flex-1 disabled:opacity-40">
            Sounds<span class="block text-sm font-normal mt-1 text-white/75">${hub.gpcCount} to check</span>
          </button>
          <button type="button" onclick="pickFlashKind('hw')" ${hwDisabled ? 'disabled' : ''}
            class="bg-pink-500/35 hover:bg-pink-500/50 border-2 border-pink-300/60 px-6 py-4 rounded-xl font-semibold text-lg flex-1 disabled:opacity-40">
            Words<span class="block text-sm font-normal mt-1 text-white/75">${hub.hwCount} to check</span>
          </button>
        </div>
      </div>
    </div>`;
}

function renderFlashSetHub(app) {
  const hub = state.flashHub;
  if (!hub || !hub.sets) {
    state.view = 'flashKind';
    render();
    return;
  }
  const name = state.selectedStudent;
  const kindLabel = hub.kind === 'gpc' ? 'Sounds' : 'Words';
  const cardsHtml = hub.sets.map((items, idx) => {
    const status = getFlashSetCardStatus(name, hub.kind, idx, items);
    return `<button type="button" onclick="beginFlashSet(${idx})" class="flash-set-card ${status}">
      <div class="flash-set-card-title">Set ${idx + 1}</div>
    </button>`;
  }).join('');

  app.innerHTML = `
    <div class="min-h-screen p-4 md:p-8">
      <div class="max-w-2xl mx-auto fadeIn">
        <button type="button" onclick="state.view='flashKind'; render()" class="text-white/60 hover:text-white text-sm mb-4">← ${kindLabel}</button>
        <h2 class="text-2xl font-bold mb-1 arcade-title-friendly">Self Check — ${kindLabel}</h2>
        <p class="text-white/70 text-sm mb-5">Each set stays the same. Pick a set to check. Orange = started; green = all marked “I know it”.</p>
        <div class="flash-set-grid">${cardsHtml}</div>
      </div>
    </div>`;
}

function renderFlashGame(app){
  const g = state.game;
  if (g.cardIdx >= g.cards.length) {
    g.finished = true;
    render();
    return;
  }
  const card = g.cards[g.cardIdx];
  const audioOk = hasAudio(card.value);
  const colorClass = card.type === 'gpc' ? 'from-cyan-400 to-blue-600' : 'from-pink-400 to-rose-600';
  const typeLabel = card.type === 'gpc' ? 'sound' : 'word';

  const flashContext = card.type === 'gpc'
    ? renderGpcContextBar(resolveGpcExampleWord(card.value))
    : renderHwContextBar(card.value);
  const playHeader = renderGamePlayHeader({ contextHtml: flashContext });

  app.innerHTML = `
    <div class="min-h-screen p-4 md:p-8 flex flex-col">
      ${renderGameTopBar(g, { backOnclick: g.flashSetRef ? 'finishFlashSetAndReturn()' : 'quitToProfile()', backLabel: g.flashSetRef ? '← Sets' : '← Quit' })}
      <p class="text-center text-white/75 text-sm mb-3 max-w-3xl mx-auto w-full">Do you know this ${typeLabel}?</p>
      <div class="max-w-3xl mx-auto w-full">${playHeader}</div>
      <div class="flex-1 flex flex-col items-center justify-center max-w-3xl mx-auto w-full">
        <button id="cardBtn" class="bg-gradient-to-br ${colorClass} rounded-3xl p-12 md:p-16 mb-6 shadow-2xl hover:scale-105 transition floaty">
          <div class="text-7xl md:text-9xl font-bold">${card.value}</div>
          ${audioOk ? '<div class="mt-4 text-sm text-white/80">🔊 Tap to listen</div>' : ''}
        </button>
        <div class="flex flex-col sm:flex-row gap-3 w-full max-w-md justify-center">
          <button onclick="sfxClick(); flashAnswer(false)" class="bg-orange-500/40 hover:bg-orange-500/60 border-2 border-orange-300 px-6 py-3 rounded-xl font-semibold text-lg flex-1">Still learning</button>
          <button onclick="sfxClick(); flashAnswer(true)" class="bg-green-500/40 hover:bg-green-500/60 border-2 border-green-300 px-6 py-3 rounded-xl font-semibold text-lg flex-1">I know it</button>
        </div>
      </div>
    </div>`;
  setTimeout(() => {
    const cardBtn = $('cardBtn');
    if (cardBtn && audioOk) cardBtn.addEventListener('click', () => playTargetListen(card.value));
    if (!g.feedback) playFlashTargetOnShow(g, card.value);
  }, 0);
}
window.flashAnswer = (got) => {
  const g = state.game;
  const card = g.cards[g.cardIdx];
  setFlashResult(state.selectedStudent, card.value, got ? 'got' : 'tricky');
  g.history.push({ target: card.value, type: card.type, correct: got });
  g.attempts++;
  if (got) {
    g.correct++;
    playTargetOnCorrect(g, card.value);
  }
  g.cardIdx++;
  resetTargetAudioFlags(g);
  if (g.cardIdx >= g.cards.length) g.finished = true;
  render();
};

// ============================================================
// SOUND FLIP
// ============================================================
function isMultiLetterGpc(gpc) {
  return String(gpc).length >= 2;
}

/** Letters where mirror / 180° often look the same as upright (o, l, c, …). */
function isAmbiguousFlipChar(c) {
  const ch = String(c).toLowerCase();
  return 'o0celisvxzw'.includes(ch) || ch === 'i' || ch === 'l' || ch === '1' || ch === '|';
}

function getSoundFlipAmbiguity(gpc) {
  const chars = [...String(gpc)];
  if (chars.length === 0) return 'high';
  const ambiguous = chars.filter(isAmbiguousFlipChar).length;
  const ratio = ambiguous / chars.length;
  if (ratio >= 0.5 || chars.every(isAmbiguousFlipChar)) return 'high';
  if (ambiguous > 0) return 'medium';
  return 'low';
}

/** Only transforms that clearly change how the grapheme looks (no position-only tricks). */
function getWholeWordFlipPool(gpc) {
  const level = getSoundFlipAmbiguity(gpc);
  const sideways = [
    { id: 'r90', transform: 'rotate(90deg)' },
    { id: 'r270', transform: 'rotate(-90deg)' }
  ];
  const diagonal = [
    { id: 'r45', transform: 'rotate(45deg)' },
    { id: 'r135', transform: 'rotate(-45deg)' }
  ];
  const strong = [
    { id: 'r180', transform: 'rotate(180deg)' },
    { id: 'mirrorX', transform: 'scaleX(-1)' },
    { id: 'mirrorY', transform: 'scaleY(-1)' },
    ...sideways,
    { id: 'flipBoth', transform: 'scale(-1, -1)' }
  ];
  if (level === 'high') return [...sideways, ...diagonal];
  if (level === 'medium') return [...sideways, ...diagonal, { id: 'r180', transform: 'rotate(180deg)' }];
  return strong;
}

/** Every incorrect letter must be rotated — never upright in the box. */
function sidewaysLetterTilts(count) {
  const tilts = ['rotate(90deg)', 'rotate(-90deg)'];
  return Array.from({ length: count }, (_, i) => tilts[i % 2]);
}

function buildJumbleVariant(gpc, id) {
  const letters = gpc.split('');
  let shuffled = shuffle([...letters]);
  let guard = 0;
  while (shuffled.join('') === gpc && guard++ < 12) shuffled = shuffle([...letters]);
  if (shuffled.join('') === gpc) shuffled = [...letters].reverse();
  const tilts = sidewaysLetterTilts(shuffled.length);
  return {
    id,
    type: 'letters',
    letters: shuffled.map((c, i) => ({ c, t: tilts[i] }))
  };
}

function buildPerLetterTiltVariant(gpc, id) {
  const tilts = sidewaysLetterTilts(gpc.length);
  return {
    id,
    type: 'letters',
    letters: gpc.split('').map((c, i) => ({ c, t: tilts[i] }))
  };
}

function buildSoundFlipVariants(gpc) {
  const correct = { id: 'correct', isCorrect: true, transform: 'none' };
  const incorrect = [];
  const wholePool = getWholeWordFlipPool(gpc);

  wholePool.forEach(v => incorrect.push(v));

  if (isMultiLetterGpc(gpc)) {
    incorrect.push(buildJumbleVariant(gpc, 'jumble'));
    incorrect.push(buildPerLetterTiltVariant(gpc, 'tilt'));
  }

  const seen = new Set();
  const unique = incorrect.filter(v => {
    const key = v.type === 'letters'
      ? v.id + ':' + v.letters.map(l => l.c + l.t).join('|')
      : v.id + ':' + (v.transform || '');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  let picked = shuffle(unique).slice(0, 4);
  const fallbacks = getWholeWordFlipPool(gpc);
  for (const fb of fallbacks) {
    if (picked.length >= 4) break;
    if (!picked.some(p => p.id === fb.id && !p.type)) picked.push(fb);
  }
  while (picked.length < 4 && isMultiLetterGpc(gpc)) {
    const extra = buildPerLetterTiltVariant(gpc, 'tilt' + picked.length);
    if (!picked.some(p => p.id === extra.id)) picked.push(extra);
    else break;
  }

  return shuffle([correct, ...picked.slice(0, 4)]);
}

function renderSoundFlipGlyph(gpc, variant) {
  if (variant.isCorrect) {
    return `<span class="sound-flip-glyph-cell"><span class="sound-flip-letter">${gpc}</span></span>`;
  }
  if (variant.type === 'letters' && variant.letters) {
    const parts = variant.letters.map(l =>
      `<span class="sound-flip-letter-slot"><span class="sound-flip-letter" style="transform:${l.t}">${l.c}</span></span>`
    ).join('');
    return `<span class="sound-flip-glyph-cell"><span class="inline-flex items-center justify-center gap-2 sm:gap-3">${parts}</span></span>`;
  }
  const t = variant.transform && variant.transform !== 'none' ? variant.transform : 'rotate(90deg)';
  return `<span class="sound-flip-glyph-cell"><span class="sound-flip-letter" style="transform:${t}">${gpc}</span></span>`;
}

function initSoundFlip(needs) {
  const g = state.game;
  g.roundTargets = buildRoundTargets(needs, 'gpc', CHALLENGE_ROUNDS);
  g.targetPool = [...new Set([...needs.targetGpcs.map(x => x.gpc), ...needs.masteredGpcs.map(x => x.gpc)])];
  g.totalRounds = CHALLENGE_ROUNDS;
  if (g.roundTargets.length === 0) { g.empty = true; return; }
  newSoundFlipRound();
}

function newSoundFlipRound() {
  const g = state.game;
  if (g.roundIdx >= g.totalRounds) { g.finished = true; return; }
  g.currentTarget = g.roundTargets[g.roundIdx];
  g.currentExampleWord = resolveGpcExampleWord(g.currentTarget);
  g.currentOptions = buildSoundFlipVariants(g.currentTarget);
  g.feedback = null;
  g.flipPhase = 'prompt';
  resetTargetAudioFlags(g);
  if (g._flipReadyTimer) { clearTimeout(g._flipReadyTimer); g._flipReadyTimer = null; }
  if (g._promptAudio) {
    try { g._promptAudio.pause(); } catch (e) {}
    g._promptAudio = null;
  }
}

function startSoundFlipPrompt() {
  const g = state.game;
  if (!g || g.type !== 'soundFlip' || g.flipPhase !== 'prompt' || g._spoken || g.feedback) return;
  g._spoken = true;

  const goReady = () => {
    if (state.game !== g || g.flipPhase !== 'prompt' || g.feedback) return;
    if (g._flipReadyTimer) { clearTimeout(g._flipReadyTimer); g._flipReadyTimer = null; }
    g.flipPhase = 'ready';
    render();
  };

  const audioData = getAudioSource(g.currentTarget);
  if (audioData) {
    try {
      const audio = new Audio(audioData);
      g._promptAudio = audio;
      audio.onended = goReady;
      audio.onerror = () => { g._flipReadyTimer = setTimeout(goReady, 450); };
      audio.play().catch(() => { g._flipReadyTimer = setTimeout(goReady, 500); });
      g._flipReadyTimer = setTimeout(goReady, 5000);
    } catch (e) {
      g._flipReadyTimer = setTimeout(goReady, 550);
    }
  } else {
    g._flipReadyTimer = setTimeout(goReady, 750);
  }
}

function renderSoundFlip(app) {
  const g = state.game;
  const audioOk = hasAudio(g.currentTarget);
  const canPick = g.flipPhase === 'ready' && !g.feedback;
  const modelGlow = g.flipPhase === 'prompt';

  const optionsHtml = g.currentOptions.map(opt => {
    let cls = 'sound-flip-option sound-flip-font rounded-2xl px-3 py-4 sm:px-4 flex items-center justify-center text-3xl sm:text-4xl md:text-5xl font-bold cursor-pointer transition transform hover:scale-105 hover:bg-white/10';
    if (!canPick && !g.feedback) cls += ' opacity-70';
    if (g.feedback) {
      if (opt.isCorrect) cls += ' ring-4 ring-green-400 scale-105 bg-green-500/20';
      else if (g.feedback.picked === opt.id) cls += ' ring-4 ring-red-400 opacity-60 shake';
      else cls += ' opacity-35';
    }
    return `<button type="button" class="${cls}" data-flip-id="${opt.id}" ${!canPick ? 'disabled' : ''}>${renderSoundFlipGlyph(g.currentTarget, opt)}</button>`;
  }).join('');

  const playHeader = renderGamePlayHeader({
    feedbackMessage: g.feedback?.message,
    feedbackCorrect: g.feedback?.correct,
    nextOnclick: challengeNextOnclick(g),
    nextLabel: challengeNextLabel(g),
  });

  app.innerHTML = `
    <div class="sound-flip-screen p-4 md:p-8">
      <div class="sound-flip-screen-inner">
        ${renderGameTopBar(g)}
        ${playHeader}
        <div class="sound-flip-main fadeIn">
          <div class="flex flex-col items-center">
            <div class="sound-flip-model sound-flip-font rounded-2xl px-8 py-10 sm:px-10 sm:py-12 flex items-center justify-center text-5xl sm:text-6xl md:text-7xl font-bold min-w-[8rem] ${modelGlow ? 'prompt-glow' : ''}">
              ${g.currentTarget}
            </div>
            ${audioOk ? `<button type="button" id="soundFlipListen" class="mt-3 bg-gradient-to-r from-yellow-400 to-orange-500 hover:from-yellow-300 hover:to-orange-400 text-white font-bold px-5 py-2 rounded-xl text-sm shadow-lg">🔊 Listen</button>` : ''}
          </div>
          <div class="sound-flip-options-wrap">${optionsHtml}</div>
        </div>
      </div>
    </div>`;

  setTimeout(() => {
    document.querySelectorAll('[data-flip-id]').forEach(btn => {
      btn.addEventListener('click', () => {
        sfxClick();
        pickSoundFlip(btn.getAttribute('data-flip-id'));
      });
    });
    const flipListen = document.getElementById('soundFlipListen');
    if (flipListen) flipListen.addEventListener('click', () => playTargetListen(g.currentTarget));
    if (!g.feedback) startSoundFlipPrompt();
    afterGameRenderArmNext();
  }, 0);
}

function cleanupSoundFlip() {
  const g = state.game;
  if (!g) return;
  if (g._flipReadyTimer) { clearTimeout(g._flipReadyTimer); g._flipReadyTimer = null; }
  if (g._promptAudio) {
    try { g._promptAudio.pause(); } catch (e) {}
    g._promptAudio = null;
  }
}

window.pickSoundFlip = (optionId) => {
  const g = state.game;
  if (!g || g.type !== 'soundFlip' || g.feedback || g.flipPhase !== 'ready') return;
  const opt = g.currentOptions.find(o => o.id === optionId);
  if (!opt) return;
  const correct = !!opt.isCorrect;
  if (correct) {
    g.attempts++;
    g.correct++;
    confetti();
    g.feedback = { picked: optionId, correct: true, message: correctFeedback(g.currentTarget, 'gpc', 'soundFlip') };
    playTargetOnCorrect(g, g.currentTarget);
    g.history.push({ target: g.currentTarget, picked: optionId, correct, type: 'gpc' });
  } else {
    g.feedback = { picked: optionId, correct: false, message: challengeWrongFeedback(g.currentTarget, 'gpc', 'soundFlip') };
  }
  render();
};

window.nextSoundFlipRound = () => {
  const g = state.game;
  clearGameNextBtnTimer(g);
  g.roundIdx++;
  if (g.roundIdx >= g.totalRounds) {
    g.finished = true;
    cleanupSoundFlip();
    render();
    return;
  }
  newSoundFlipRound();
  render();
};

// ============================================================
// SOUND BOX
// ============================================================
const SOUND_BOX_COMMON_GPCS = [
  'a_e', 'e_e', 'i_e', 'o_e', 'u_e',
  'igh', 'tion', 'sion', 'tch', 'dge', 'ng', 'ck', 'qu',
  'sh', 'ch', 'th', 'wh', 'ph',
  'ai', 'ay', 'ee', 'ea', 'oa', 'oo', 'ow', 'ou', 'oi', 'oy', 'ue', 'ew',
  'ir', 'er', 'ur', 'ar', 'or', 'au', 'aw', 'ie', 'ei',
  'bl', 'br', 'cl', 'cr', 'dr', 'fl', 'fr', 'gl', 'gr', 'pl', 'pr', 'sc', 'sk', 'sl', 'sm', 'sn', 'sp', 'st', 'sw', 'tr', 'tw',
  'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l', 'm', 'n', 'o', 'p', 'q', 'r', 's', 't', 'u', 'v', 'w', 'x', 'y', 'z'
];
const SOUND_BOX_BLEND_GPCS = new Set([
  'bl', 'br', 'cl', 'cr', 'dr', 'fl', 'fr', 'gl', 'gr', 'pl', 'pr', 'sc', 'sk', 'sl', 'sm', 'sn', 'sp', 'st', 'sw', 'tr', 'tw'
]);

function buildGpcSegmentPatternList(needs) {
  const set = new Set(SOUND_BOX_COMMON_GPCS.map(normalizeGpcKey));
  for (const item of [...needs.targetGpcs, ...needs.masteredGpcs]) {
    const key = normalizeGpcKey(item.gpc);
    if (key) set.add(key);
  }
  return [...set].sort((a, b) => b.length - a.length);
}

function makeSoundBoxSlot(expectedGpc, idx) {
  return { idx, expectedGpc: normalizeGpcKey(expectedGpc), filled: null, wrong: false };
}

function isMagicEGpcKey(gpc) {
  return /^[aeiou]_e$/.test(normalizeGpcKey(gpc));
}

/** GPC chip shown in bank for a slot (magic-e vowel slots use o_e etc., not the bare vowel). */
function soundBoxSlotBankGpc(slot) {
  return slot.magicVowelSlot ? slot.magicGpc : slot.expectedGpc;
}

/** Audio label for a slot during the left-to-right sequence. */
function soundBoxSlotAudioGpc(slot) {
  return slot.magicVowelSlot ? slot.magicGpc : slot.expectedGpc;
}

/** Resolve clip plan for a slot: exact bank match, or split consonant blends. */
function resolveSoundBoxSlotAudioClips(slot) {
  const primary = normalizeGpcKey(soundBoxSlotAudioGpc(slot));
  if (!primary) return [];

  if (SOUND_BOX_BLEND_GPCS.has(primary) && primary.length === 2) {
    const clips = [];
    const c1 = primary[0];
    const c2 = primary[1];
    if (hasAudio(c1)) clips.push({ label: c1, staggerMs: 0 });
    if (hasAudio(c2)) clips.push({ label: c2, staggerMs: SOUND_BOX_BLEND_STAGGER_MS });
    if (clips.length) return clips;
  }

  if (hasAudio(primary)) return [{ label: primary, staggerMs: 0 }];
  return [];
}

function soundBoxSlotHasAudio(slot) {
  return resolveSoundBoxSlotAudioClips(slot).length > 0;
}

/** Value placed in a box when the learner taps a GPC chip. */
function soundBoxResolveFill(gpc, slot) {
  const key = normalizeGpcKey(gpc);
  if (slot.magicVowelSlot && isMagicEGpcKey(key)) {
    return key.replace('_e', '');
  }
  return key;
}

function greedySegmentSoundBox(text, patterns) {
  const slots = [];
  let pos = 0;
  const lower = String(text ?? '').toLowerCase();
  while (pos < lower.length) {
    let matched = null;
    for (const pat of patterns) {
      if (/_e$/.test(pat)) continue;
      if (lower.startsWith(pat, pos)) { matched = pat; break; }
    }
    if (!matched) matched = lower[pos];
    slots.push(makeSoundBoxSlot(matched, slots.length));
    pos += matched.length;
  }
  return slots;
}

function detectMagicEGpc(word, focusGpc) {
  const w = String(word ?? '').trim().toLowerCase();
  const focusKey = normalizeGpcKey(focusGpc);
  const lvEntry = LONG_VOWEL_WORD_INDEX[w];
  if (lvEntry?.gpc && /_e$/.test(normalizeGpcKey(lvEntry.gpc))) {
    return normalizeGpcKey(lvEntry.gpc);
  }
  if (w.length < 3 || !w.endsWith('e')) return null;
  const prefix = w.slice(0, -1);
  if (focusKey && /_e$/.test(focusKey)) {
    const magicVowel = focusKey.replace('_e', '');
    if (prefix.toLowerCase().includes(magicVowel)) return focusKey;
    return null;
  }
  if (!/[aeiou]/.test(prefix)) return null;
  const m = prefix.match(/^(.+)([aeiou])([^aeiou])$/i);
  if (!m) return null;
  return `${m[2].toLowerCase()}_e`;
}

function segmentWordForSoundBox(word, needs, focusGpc) {
  const w = String(word ?? '').trim().toLowerCase();
  const patterns = buildGpcSegmentPatternList(needs);
  const magicGpc = detectMagicEGpc(w, focusGpc);
  if (magicGpc && w.endsWith('e')) {
    const prefix = w.slice(0, -1);
    const magicVowel = magicGpc.replace('_e', '');
    const slots = [];
    const vce = prefix.match(/^(.+)([aeiou])([^aeiou])$/i);
    if (vce && vce[2].toLowerCase() === magicVowel) {
      const [, pre, vowel, post] = vce;
      if (pre) slots.push(...greedySegmentSoundBox(pre, patterns));
      const vowelSlot = makeSoundBoxSlot(vowel, slots.length);
      vowelSlot.magicVowelSlot = true;
      vowelSlot.magicGpc = magicGpc;
      slots.push(vowelSlot);
      if (post) slots.push(...greedySegmentSoundBox(post, patterns));
    } else {
      const raw = greedySegmentSoundBox(prefix, patterns);
      let marked = false;
      for (const s of raw) {
        if (!marked && s.expectedGpc === magicVowel) {
          s.magicVowelSlot = true;
          s.magicGpc = magicGpc;
          marked = true;
        }
        slots.push(s);
      }
    }
    slots.forEach((s, i) => { s.idx = i; });
    return { slots, magicSuffix: 'e' };
  }
  const slots = greedySegmentSoundBox(w, patterns);
  slots.forEach((s, i) => { s.idx = i; });
  return { slots, magicSuffix: '' };
}

function buildSoundBoxBank(expectedGpcs, gpcPool) {
  const needed = [...new Set(expectedGpcs.map(normalizeGpcKey).filter(Boolean))];
  const needSet = new Set(needed);
  const distractors = shuffle(
    uniqueValidTokens(gpcPool).filter(g => !needSet.has(normalizeGpcKey(g)))
  );
  const extraCount = Math.max(2, Math.min(4, 8 - needed.length));
  return shuffle([...needed, ...distractors.slice(0, extraCount)]);
}

function initSoundBox(needs) {
  const g = state.game;
  g.roundTargets = buildRoundTargets(needs, 'gpc', CHALLENGE_ROUNDS);
  g.targetPool = uniqueValidTokens([...needs.targetGpcs.map(x => x.gpc), ...needs.masteredGpcs.map(x => x.gpc)]);
  g.totalRounds = CHALLENGE_ROUNDS;
  g.roundIdx = 0;
  g.correct = 0;
  g.attempts = 0;
  if (g.roundTargets.length === 0) { g.empty = true; return; }
  newSoundBoxRound(needs);
}

function newSoundBoxRound(needs) {
  const g = state.game;
  g.roundHadError = false;
  g.roundMistakeLogged = false;
  if (g.roundIdx >= g.totalRounds) { g.finished = true; return; }
  g.currentTarget = String(g.roundTargets[g.roundIdx] ?? '').trim();
  if (!isValidGameToken(g.currentTarget)) {
    g.roundIdx++;
    if (g.roundIdx >= g.totalRounds) { g.finished = true; return; }
    newSoundBoxRound(needs);
    return;
  }
  const studentNeeds = needs || getStudentNeeds(state.selectedStudent);
  g.currentExampleWord = resolveGpcExampleWord(g.currentTarget);
  const word = g.currentExampleWord || g.currentTarget;
  const seg = segmentWordForSoundBox(word, studentNeeds, g.currentTarget);
  g.slots = seg.slots;
  g.magicSuffix = seg.magicSuffix;
  g.bank = buildSoundBoxBank(g.slots.map(soundBoxSlotBankGpc), g.targetPool);
  g.phase = 'spell';
  g.feedback = null;
  resetTargetAudioFlags(g);
  cleanupSoundBox();
}

function soundBoxNextEmptySlotIndex(g) {
  return g.slots.findIndex(s => s.filled == null);
}

function soundBoxAllFilled(g) {
  return g.slots.every(s => s.filled != null);
}

function validateSoundBox(g) {
  const wrongIndices = [];
  g.slots.forEach((slot, i) => {
    const exp = normalizeGpcKey(slot.expectedGpc);
    const got = normalizeGpcKey(slot.filled || '');
    if (got !== exp) wrongIndices.push(i);
  });
  return { ok: wrongIndices.length === 0, wrongIndices };
}

function markSoundBoxWrongSlots(g, wrongIndices) {
  g.slots.forEach(s => { s.wrong = false; });
  wrongIndices.forEach(i => { if (g.slots[i]) g.slots[i].wrong = true; });
}

function soundBoxEnterValidate() {
  const g = state.game;
  if (!g || g.type !== 'soundBox' || (g.phase !== 'spell' && g.phase !== 'retry') || !soundBoxAllFilled(g)) return;
  g.attempts++;
  const result = validateSoundBox(g);
  if (result.ok) {
    if (!g.roundHadError) g.correct++;
    confetti();
    g.feedback = { correct: true, message: correctFeedback(g.currentTarget, 'gpc', 'soundBox') };
    playTargetOnCorrect(g, g.currentTarget);
    g.history.push({ target: g.currentTarget, correct: !g.roundHadError, type: 'gpc' });
    g.roundHadError = false;
    g.roundMistakeLogged = false;
    g.phase = 'roundEnd';
  } else {
    markSoundBoxWrongSlots(g, result.wrongIndices);
    g.roundHadError = true;
    if (!g.roundMistakeLogged) {
      g.history.push({ target: g.currentTarget, correct: false, type: 'gpc' });
      g.roundMistakeLogged = true;
    }
    g.feedback = { correct: false, message: 'Try again.' };
    g.phase = 'retry';
  }
  render();
}

function soundBoxPickGpc(gpc) {
  const g = state.game;
  if (!g || g.type !== 'soundBox' || (g.phase !== 'spell' && g.phase !== 'retry')) return;
  const slotIdx = soundBoxNextEmptySlotIndex(g);
  if (slotIdx < 0) return;
  sfxClick();
  const slot = g.slots[slotIdx];
  slot.filled = soundBoxResolveFill(gpc, slot);
  slot.wrong = false;
  if (g.phase === 'retry') g.feedback = null;
  if (soundBoxAllFilled(g)) {
    setTimeout(() => {
      if (state.game === g && (g.phase === 'spell' || g.phase === 'retry') && soundBoxAllFilled(g)) {
        soundBoxEnterValidate();
      }
    }, 350);
  }
  render();
}

function soundBoxClearSlot(slotIdx) {
  const g = state.game;
  if (!g || g.type !== 'soundBox' || (g.phase !== 'spell' && g.phase !== 'retry')) return;
  const slot = g.slots[slotIdx];
  if (!slot || slot.filled == null) return;
  sfxClick();
  slot.filled = null;
  slot.wrong = false;
  g.phase = 'spell';
  g.feedback = null;
  render();
}

function cleanupSoundBox() {
  const g = state.game;
  if (!g) return;
  if (g._sbSeqTimer) { clearTimeout(g._sbSeqTimer); g._sbSeqTimer = null; }
  if (g._sbSeqClipTimers) {
    g._sbSeqClipTimers.forEach(t => clearTimeout(t));
    g._sbSeqClipTimers = null;
  }
  if (g._sbSeqAudios?.length) {
    g._sbSeqAudios.forEach(a => { try { a.pause(); } catch (e) {} });
    g._sbSeqAudios = null;
  }
  if (g._sbSeqAudio) {
    try { g._sbSeqAudio.pause(); } catch (e) {}
    g._sbSeqAudio = null;
  }
}

function playSoundBoxSlotClips(g, clips, onSlotDone) {
  if (!clips.length) { onSlotDone(); return; }
  g._sbSeqAudios = g._sbSeqAudios || [];
  g._sbSeqClipTimers = g._sbSeqClipTimers || [];
  let pending = clips.length;

  const finishClip = () => {
    pending--;
    if (pending <= 0) {
      _lastAudioEndAt = Date.now();
      onSlotDone();
    }
  };

  clips.forEach(clip => {
    const t = setTimeout(() => {
      if (state.game !== g) return;
      const audioData = getAudioSource(clip.label);
      if (!audioData) { finishClip(); return; }
      try {
        const audio = new Audio(audioData);
        g._sbSeqAudios.push(audio);
        g._sbSeqAudio = audio;
        const onEnd = () => {
          const i = g._sbSeqAudios.indexOf(audio);
          if (i >= 0) g._sbSeqAudios.splice(i, 1);
          finishClip();
        };
        audio.addEventListener('ended', onEnd);
        audio.addEventListener('error', onEnd);
        audio.play().catch(onEnd);
      } catch (e) {
        finishClip();
      }
    }, clip.staggerMs || 0);
    g._sbSeqClipTimers.push(t);
  });
}

function playSoundBoxSequenceOnShow(g) {
  if (!g || g.type !== 'soundBox' || g._spoken || g.feedback) return;
  const slotPlans = g.slots.map(resolveSoundBoxSlotAudioClips).filter(clips => clips.length);
  if (!slotPlans.length) return;
  g._spoken = true;
  let slotIdx = 0;
  let isFirstSlot = true;

  const playNextSlot = () => {
    if (slotIdx >= slotPlans.length || state.game !== g) return;
    const clips = slotPlans[slotIdx++];
    const delay = isFirstSlot
      ? 400
      : Math.max(300, _lastAudioEndAt + SOUND_BOX_AUDIO_GAP_MS - Date.now());
    isFirstSlot = false;
    g._sbSeqTimer = setTimeout(() => {
      if (state.game !== g) return;
      playSoundBoxSlotClips(g, clips, playNextSlot);
    }, delay);
  };
  playNextSlot();
}

window.nextSoundBoxRound = () => {
  sfxClick();
  const g = state.game;
  clearGameNextBtnTimer(g);
  g.roundIdx++;
  if (g.roundIdx >= g.totalRounds) {
    g.finished = true;
    cleanupSoundBox();
    render();
    return;
  }
  newSoundBoxRound();
  render();
};

function renderSoundBox(app) {
  const g = state.game;
  const exampleWord = g.currentExampleWord || resolveGpcExampleWord(g.currentTarget);
  const exampleHint = (g.phase !== 'roundEnd' && !g.feedback) ? renderGpcExampleHint(exampleWord) : '';
  const showBank = g.phase === 'spell' || g.phase === 'retry';

  const boxesHtml = g.slots.map(slot => {
    let cls = 'sound-box-cell';
    if (slot.filled) cls += ' filled';
    if (slot.wrong) cls += ' wrong-slot';
    const label = slot.filled || '';
    return `<div class="sound-box-slot"><button type="button" class="${cls}" data-sb-slot="${slot.idx}">${label}</button></div>`;
  }).join('');

  const magicHtml = g.magicSuffix
    ? `<span class="sound-box-magic-e" aria-label="silent e">${g.magicSuffix}</span>`
    : '';

  const bankHtml = showBank
    ? g.bank.map(gpc =>
        `<button type="button" class="sound-box-bank-chip" data-sb-gpc="${gpc.replace(/"/g, '&quot;')}">${gpc}</button>`
      ).join('')
    : '';

  const playHeader = renderGamePlayHeader({
    contextHtml: exampleHint ? `<div class="gpc-example-corner">${exampleHint}</div>` : '',
    feedbackMessage: g.phase === 'retry' && g.feedback ? g.feedback.message : (g.phase === 'roundEnd' && g.feedback ? g.feedback.message : null),
    feedbackCorrect: g.phase === 'roundEnd' ? true : (g.phase === 'retry' ? false : null),
    nextOnclick: null,
  });

  const roundEndPanel = (g.phase === 'roundEnd' && g.feedback) ? `
    <div class="sound-box-round-end fadeIn">
      ${renderGameNextButton('Next', 'nextSoundBoxRound()')}
    </div>` : '';

  app.innerHTML = `
    <div class="sound-box-screen min-h-screen p-4 md:p-8">
      <div class="max-w-4xl mx-auto">
        ${renderGameTopBar(g)}
        ${playHeader}
        <div class="flex justify-center mb-4">
          <button type="button" id="soundBoxListen" class="bg-gradient-to-r from-yellow-400 to-orange-500 hover:from-yellow-300 hover:to-orange-400 text-white font-bold px-6 py-3 rounded-2xl text-lg shadow-lg">🔊 Listen</button>
        </div>
        <div class="sound-box-word-row" aria-label="Sound boxes for ${exampleWord}">
          ${boxesHtml}${magicHtml}
        </div>
        ${showBank ? `<div class="sound-box-bank-grid" id="soundBoxBank">${bankHtml}</div>` : roundEndPanel}
      </div>
    </div>`;

  setTimeout(() => {
    attachSoundBoxHandlers(g, exampleWord);
    afterGameRenderArmNext();
  }, 0);
}

function attachSoundBoxHandlers(g, exampleWord) {
  document.getElementById('soundBoxListen')?.addEventListener('click', () => {
    if (exampleWord) playTargetListen(exampleWord);
  });
  if (g.phase === 'spell' && !g.feedback) {
    setTimeout(() => playSoundBoxSequenceOnShow(g), 400);
  }
  if (!showBankPhase(g)) return;
  document.querySelectorAll('[data-sb-gpc]').forEach(btn => {
    btn.addEventListener('click', () => soundBoxPickGpc(btn.getAttribute('data-sb-gpc')));
  });
  document.querySelectorAll('[data-sb-slot]').forEach(btn => {
    const slotIdx = parseInt(btn.getAttribute('data-sb-slot'), 10);
    btn.addEventListener('click', () => {
      if (g.slots[slotIdx]?.filled != null) soundBoxClearSlot(slotIdx);
    });
  });
}

function showBankPhase(g) {
  return g.phase === 'spell' || g.phase === 'retry';
}

// ============================================================
// CATCH THE SOUND
// ============================================================
function initCatchSound(needs) {
  const g = state.game;
  const targets = needs.targetGpcs.map(x => x.gpc);
  const mastered = needs.masteredGpcs.map(x => x.gpc);
  g.roundTargets = buildRoundTargets(needs, 'gpc', CHALLENGE_ROUNDS);
  g.targetPool = uniqueValidTokens([...targets, ...mastered]);
  g.distractorPool = uniqueValidTokens(mastered.length > 0 ? mastered : targets);
  if (g.roundTargets.length === 0) { g.empty = true; return; }
  g.lives = 5;
  g.maxLives = 5;
  g.correctNeeded = CHALLENGE_ROUNDS;
  g.roundIdx = 0;
  g.attempts = 0;
  g.correct = 0;
  g.won = false;
  g.catchPhase = 'play';
  newCatchRound();
}

function startCatchBreak() {
  const g = state.game;
  if (g._timer) { clearTimeout(g._timer); g._timer = null; }
  g.catchPhase = 'break';
  g.feedback = null;
  const target = String(g.roundTargets[g.roundIdx] ?? '').trim();
  if (!isValidGameToken(target)) {
    g.roundIdx++;
    if (g.roundIdx >= g.roundTargets.length) { g.finished = true; return; }
    startCatchBreak();
    return;
  }
  g.breakExampleWord = resolveGpcExampleWord(target);
}

function advanceCatchAfterRound() {
  const g = state.game;
  if (g.correct >= g.correctNeeded) { g.finished = true; g.won = true; render(); return; }
  if (g.lives <= 0) { g.finished = true; g.won = false; render(); return; }
  g.roundIdx++;
  if (g.roundIdx >= g.roundTargets.length) {
    g.finished = true;
    g.won = g.correct >= g.correctNeeded;
    render();
    return;
  }
  startCatchBreak();
  render();
}

function newCatchRound() {
  const g = state.game;
  const target = String(g.roundTargets[g.roundIdx] ?? '').trim();
  if (!isValidGameToken(target)) {
    g.roundIdx++;
    if (g.roundIdx >= g.totalRounds) { g.finished = true; return; }
    newCatchRound();
    return;
  }
  g.currentTarget = target;
  g.currentExampleWord = resolveGpcExampleWord(target);
  g.currentOptions = buildChallengeOptions(target, g.distractorPool, g.targetPool, 5, 'gpc');
  g.feedback = null;
  resetTargetAudioFlags(g);
  startCatchTimer(g);
}

function startCatchTimer(g) {
  if (g._timer) { clearTimeout(g._timer); g._timer = null; }
  g._timer = setTimeout(() => {
    if (state.view !== 'game' || state.game !== g || g.finished || g.feedback) return;
    g.lives--;
    g.attempts++;
    g.feedback = {
      timeout: true,
      picked: null,
      correct: false,
      message: pickFeedbackMessage([
        "Time's up! Say the sound.",
        `Say "${g.currentTarget}". Try again.`
      ])
    };
    render();
    setTimeout(() => {
      if (state.view !== 'game' || state.game !== g) return;
      advanceCatchAfterRound();
    }, 1600);
  }, CATCH_ROUND_SEC * 1000);
}

window.catchPick = (opt) => {
  const g = state.game;
  if (g.catchPhase === 'break' || g.feedback || g.finished) return;
  if (!isValidGameToken(opt)) return;
  if (g._timer) { clearTimeout(g._timer); g._timer = null; }
  sfxClick();
  const correct = opt === g.currentTarget;
  g.attempts++;
  g.feedback = {
    picked: opt,
    correct,
    message: correct
      ? correctFeedback(g.currentTarget, 'gpc', 'gpcCatch')
      : wrongFeedback(g.currentTarget, 'gpc', 'gpcCatch')
  };
  if (correct) {
    g.correct++;
    confetti();
    playTargetOnCorrect(g, g.currentTarget);
  } else {
    g.lives--;
  }
  render();
  setTimeout(() => {
    if (state.view !== 'game' || state.game !== g) return;
    advanceCatchAfterRound();
  }, correct ? CATCH_CORRECT_BREAK_MS : 1400);
};

window.catchGo = () => {
  sfxClick();
  const g = state.game;
  if (!g || g.type !== 'gpcCatch' || g.catchPhase !== 'break') return;
  g.catchPhase = 'play';
  newCatchRound();
  render();
};

window.catchQuit = () => {
  quitToProfile();
};

function renderCatchBreak(app) {
  const g = state.game;
  const word = String(g.breakExampleWord ?? '').trim();
  const livesHtml = Array.from({ length: g.maxLives }, (_, i) =>
    `<span class="text-xl">${i < g.lives ? '❤️' : '🤍'}</span>`
  ).join('');

  app.innerHTML = `
    <div class="flex flex-col p-2 sm:p-3" style="height:100vh; max-height:100vh; overflow:hidden;">
      <div class="max-w-3xl mx-auto w-full flex flex-col flex-1 min-h-0">
        <div class="game-top-bar mb-1">
          <button type="button" onclick="catchQuit()" class="text-white/70 hover:text-white text-xs sm:text-sm bg-white/5 px-2 py-1 rounded-lg">← Quit</button>
          <div class="flex gap-2 items-center text-xs sm:text-sm">
            <span class="bg-white/10 px-2 py-1 rounded-full">${livesHtml}</span>
          </div>
        </div>
        <div class="catch-break-screen">
          <div class="flex-1 flex items-center justify-center px-4">
            ${word ? `<p class="catch-break-word-wrap" aria-label="Next example word ${word}"><span class="catch-break-next-label">next</span><span class="catch-break-word">${word}</span></p>` : ''}
          </div>
          <div class="catch-break-go-wrap">
            <button type="button" onclick="catchGo()" class="game-next-btn catch-go-btn">GO!</button>
          </div>
        </div>
      </div>
    </div>`;
}

function renderCatchSound(app) {
  const g = state.game;
  if (g.catchPhase === 'break') return renderCatchBreak(app);
  const livesHtml = Array.from({length: g.maxLives}, (_, i) =>
    `<span class="text-xl">${i < g.lives ? '❤️' : '🤍'}</span>`
  ).join('');

  const driftClasses = shuffle(['drift1','drift2','drift3','drift4','drift5','drift6']);

  const optionsHtml = g.currentOptions.map((opt, i) => {
    const drift = driftClasses[i % driftClasses.length];
    let cls = `catchBubble ${drift} bg-gradient-to-br from-emerald-400 to-teal-600 splat w-full aspect-square flex items-center justify-center font-bold cursor-pointer shadow-2xl select-none`;
    if (g.feedback) {
      if (opt === g.currentTarget) cls += ' ring-4 ring-green-400';
      else if (g.feedback.picked === opt) cls += ' ring-4 ring-red-400 opacity-50';
      else cls += ' opacity-30';
    }
    return `<div class="flex items-center justify-center p-1"><button class="${cls}" style="font-size: clamp(1.5rem, 5vw, 2.75rem);" data-option="${opt}">${opt}</button></div>`;
  }).join('');

  const timerBar = !g.feedback
    ? `<div class="w-full bg-white/10 rounded-full h-2.5 overflow-hidden"><div class="h-full bg-gradient-to-r from-green-400 via-yellow-400 to-red-500" style="animation: countdownBar ${CATCH_ROUND_SEC}s linear forwards;"></div></div>`
    : `<div class="h-2.5"></div>`;
  const exampleWord = g.currentExampleWord || resolveGpcExampleWord(g.currentTarget);
  const exampleHint = g.feedback ? '' : renderGpcExampleHint(exampleWord);
  const playHeader = renderGamePlayHeader({
    feedbackMessage: g.feedback?.message,
    feedbackCorrect: g.feedback?.correct,
  });

  app.innerHTML = `
    <div class="gpc-splat-screen flex flex-col p-2 sm:p-3" style="height:100vh; max-height:100vh; overflow:hidden;">
      <div class="max-w-3xl mx-auto w-full flex flex-col flex-1 min-h-0 relative">
        <div class="game-top-bar mb-1 relative z-10">
          <button type="button" onclick="catchQuit()" class="text-white/70 hover:text-white text-xs sm:text-sm bg-white/5 px-2 py-1 rounded-lg">← Quit</button>
          <div class="flex gap-2 items-center">
            ${renderGameProgressPill(g)}
            <span class="bg-white/10 px-2 py-1 rounded-full text-xs sm:text-sm">${livesHtml}</span>
          </div>
        </div>
        ${exampleHint ? `<div class="gpc-example-corner">${exampleHint}</div>` : ''}
        ${playHeader}
        <div class="gpc-catch-timer flex-shrink-0">${timerBar}</div>
        <div class="gpc-splat-area flex-1 min-h-0 flex items-center justify-center w-full">
          <div class="gpc-splat-grid-wrap w-full" style="max-width: 480px;">
            <div class="grid grid-cols-3 gap-1 sm:gap-2 w-full pt-1 pr-1">
              ${optionsHtml}
            </div>
          </div>
        </div>
      </div>
    </div>`;

  setTimeout(() => {
    document.querySelectorAll('.catchBubble').forEach(btn => {
      btn.addEventListener('click', () => catchPick(btn.getAttribute('data-option')));
    });
    if (!g.feedback) setTimeout(() => playTargetOnShow(g, g.currentTarget), 400);
  }, 0);
}

// ============================================================
// WORD BOX (heart word spelling / Elkonin boxes)
// ============================================================
/* Tall / Short / Tail — single source of truth for Word Box letter zones */
const ELKONIN_TALL = new Set(['b', 'd', 'f', 'h', 'i', 'k', 'l', 't']); /* top line → baseline */
const ELKONIN_SHORT = new Set(['a', 'c', 'e', 'm', 'n', 'o', 'r', 's', 'u', 'v', 'w', 'x', 'z']); /* midline → baseline */
const ELKONIN_TAIL = new Set(['g', 'j', 'p', 'q', 'y']); /* body mid→base; tail in descender zone */

function getLetterBoxMeta(letter) {
  const c = String(letter).toLowerCase();
  if (ELKONIN_TAIL.has(c)) return { shape: 'descender', baseline: 'descend', dotted: c === 'j' };
  if (ELKONIN_TALL.has(c)) return { shape: 'tall', baseline: 'on', dotted: c === 'i' };
  if (ELKONIN_SHORT.has(c)) return { shape: 'short', baseline: 'on', dotted: false };
  return { shape: 'short', baseline: 'on', dotted: false };
}

/** Read handwriting zone heights from .elkonin-page CSS variables (stable before layout). */
function elkoninZoneHeights(box) {
  const page = box?.closest('.elkonin-page');
  const src = page || box || document.documentElement;
  const cs = getComputedStyle(src);
  const num = (name, fallback) => {
    const v = parseFloat(cs.getPropertyValue(name));
    return Number.isFinite(v) && v > 0 ? v : fallback;
  };
  return {
    x: num('--elkonin-x-h', 45),
    asc: num('--elkonin-asc-h', 37),
    desc: num('--elkonin-desc-h', 45)
  };
}

const ELKONIN_FONT_STACK = "'Andika', 'Sassoon Primary', 'Comic Sans MS', system-ui, sans-serif";
const ELKONIN_GLYPH_LINE_HEIGHT = 0.88; /* matches tall letters */
const ELKONIN_SHORT_SCALE = 1.3475; /* 0.98 × 1.25 × 1.10 — short letters fill mid→base */
const ELKONIN_DOTTED_I_SCALE = 0.5625; /* dotted i only; other tall letters unchanged */
const ELKONIN_TAIL_LIFT_RATIO = 0.10; /* tail glyphs nudged up within box, not slot */
const ELKONIN_FONT_WEIGHT_SHORT = 175; /* 75% less bold than 700 — matches tall letters */
const ELKONIN_FONT_WEIGHT_TALL = 175; /* tall + tail share weight and fit strategy */
let _elkoninMeasureCanvas;

function elkoninMeasureCanvas() {
  return _elkoninMeasureCanvas || (_elkoninMeasureCanvas = document.createElement('canvas'));
}

/** Font ink metrics for fitting letters to handwriting zones (Andika). */
function elkoninMeasureLetter(letter, fontSizePx, fontWeight) {
  const ctx = elkoninMeasureCanvas().getContext('2d');
  ctx.font = `${fontWeight} ${fontSizePx}px ${ELKONIN_FONT_STACK}`;
  const m = ctx.measureText(letter);
  const ascent = m.actualBoundingBoxAscent ?? fontSizePx * 0.72;
  const descent = m.actualBoundingBoxDescent ?? fontSizePx * 0.2;
  const width = m.width ?? fontSizePx * 0.55;
  return { ascent, descent, width, height: ascent + descent };
}

/** Largest size so tall letter fills sky line → base line. */
function elkoninFitTallSize(letter, maxH, maxW) {
  let lo = 6;
  let hi = maxH * 2.5;
  let best = lo;
  for (let i = 0; i < 52; i++) {
    const mid = (lo + hi) / 2;
    const ink = elkoninMeasureLetter(letter, mid, ELKONIN_FONT_WEIGHT_TALL);
    if (ink.height <= maxH && ink.width <= maxW) {
      best = mid;
      lo = mid;
    } else hi = mid;
  }
  return best;
}

/** Largest size so letter body fills short box (mid-line → base line) and fits width. */
function elkoninFitShortSize(letter, maxH, maxW) {
  let lo = 6;
  let hi = maxH * 2.5;
  let best = lo;
  for (let i = 0; i < 52; i++) {
    const mid = (lo + hi) / 2;
    const ink = elkoninMeasureLetter(letter, mid, ELKONIN_FONT_WEIGHT_SHORT);
    if (ink.ascent <= maxH && ink.width <= maxW) {
      best = mid;
      lo = mid;
    } else hi = mid;
  }
  return best;
}

function elkoninGlyphWeight(shape) {
  if (shape === 'tall' || shape === 'descender') return ELKONIN_FONT_WEIGHT_TALL;
  return ELKONIN_FONT_WEIGHT_SHORT;
}

/** Tall/short/tail: canvas descent lifts line box so ink baseline sits on target line. */
function elkoninPlaceGlyphOnBaseline(glyph, box, shape) {
  const lh = ELKONIN_GLYPH_LINE_HEIGHT;
  const letter = glyph.textContent.trim();
  const fs = parseFloat(glyph.style.fontSize) || parseFloat(getComputedStyle(glyph).fontSize);
  if (!fs) return;
  const m = elkoninMeasureLetter(letter, fs, elkoninGlyphWeight(shape));
  const descentPx = m.descent * lh;
  glyph.style.lineHeight = String(lh);
  glyph.style.position = 'absolute';
  glyph.style.left = '50%';
  glyph.style.margin = '0';
  glyph.style.padding = '0';
  glyph.style.maxWidth = '90%';
  glyph.style.visibility = 'visible';
  glyph.style.opacity = '1';
  glyph.style.transformOrigin = 'bottom center';
  glyph.style.transform = 'translateX(-50%)';
  if (shape === 'descender') {
    const tail = box.querySelector('.elkonin-zone-desc');
    const zones = elkoninZoneHeights(box);
    const tailH = tail?.offsetHeight > 2 ? tail.offsetHeight : zones.desc;
    const boxH = box.clientHeight > 2 ? box.clientHeight : zones.x + zones.desc;
    const liftPx = boxH * ELKONIN_TAIL_LIFT_RATIO;
    glyph.style.bottom = `calc(${tailH}px - ${descentPx}px)`;
    glyph.style.transform = `translateX(-50%) translateY(-${liftPx}px)`;
    return;
  }
  glyph.style.bottom = `calc(0px - ${descentPx}px)`;
}

function fitElkoninGlyphs() {
  if (state.game?.type !== 'hwBoxes') return;
  const page = document.querySelector('.elkonin-page');
  if (!page) return;
  const pad = 4;
  const lh = ELKONIN_GLYPH_LINE_HEIGHT;

  page.querySelectorAll('.elkonin-box.tall.filled').forEach(box => {
    const glyph = box.querySelector('.elkonin-glyph');
    if (!glyph) return;
    const letter = glyph.textContent.trim();
    if (!letter) return;
    const maxH = box.clientHeight - pad;
    const maxW = box.clientWidth - pad;
    if (maxH < 8 || maxW < 8) return;
    const size = elkoninFitTallSize(letter, maxH / lh, maxW);
    glyph.style.fontSize = `${size}px`;
    elkoninPlaceGlyphOnBaseline(glyph, box, 'tall');
    elkoninVerifyTallGlyph(glyph, box);
    if (letter === 'i') {
      glyph.style.fontSize = `${parseFloat(glyph.style.fontSize) * ELKONIN_DOTTED_I_SCALE}px`;
      elkoninPlaceGlyphOnBaseline(glyph, box, 'tall');
    }
  });

  page.querySelectorAll('.elkonin-box.short.filled').forEach(box => {
    const glyph = box.querySelector('.elkonin-glyph');
    if (!glyph) return;
    const letter = glyph.textContent.trim();
    if (!letter) return;
    const maxH = box.clientHeight - pad;
    const maxW = box.clientWidth - pad;
    if (maxH < 8 || maxW < 8) return;
    const size = elkoninFitShortSize(letter, maxH / lh, maxW) * ELKONIN_SHORT_SCALE;
    glyph.style.fontSize = `${size}px`;
    elkoninPlaceGlyphOnBaseline(glyph, box, 'short');
    elkoninVerifyShortGlyph(glyph, box);
  });

  page.querySelectorAll('.elkonin-box.descender.filled, .elkonin-box.desc.filled').forEach(box => {
    const glyph = box.querySelector('.elkonin-glyph');
    if (!glyph) return;
    const letter = glyph.textContent.trim();
    if (!letter) return;
    const maxH = box.clientHeight - pad;
    const maxW = box.clientWidth - pad;
    if (maxH < 8 || maxW < 8) return;
    const size = elkoninFitTallSize(letter, maxH / lh, maxW);
    glyph.style.fontSize = `${size}px`;
    elkoninPlaceGlyphOnBaseline(glyph, box, 'descender');
    elkoninVerifyTailGlyph(glyph, box);
  });
}

/** Short letter: body between mid and base; baseline on base line. */
function elkoninVerifyShortGlyph(glyph, box) {
  const pad = 1;
  let size = parseFloat(glyph.style.fontSize);
  const boxRect = box.getBoundingClientRect();
  for (let i = 0; i < 10; i++) {
    elkoninPlaceGlyphOnBaseline(glyph, box, 'short');
    const ink = elkoninInkRect(glyph);
    if (!ink) break;
    const gapTop = ink.top - boxRect.top;
    const gapBottom = boxRect.bottom - ink.bottom;
    if (gapTop < -pad) size *= 0.96;
    else if (gapBottom > pad + 2) size *= 0.97;
    else if (gapTop > pad && gapBottom <= pad + 2) size *= 1.04;
    else if (gapTop <= pad && gapBottom <= pad + 2) break;
    glyph.style.fontSize = `${size}px`;
  }
  elkoninPlaceGlyphOnBaseline(glyph, box, 'short');
}

/** Tall letter: top touches sky line (box top), baseline on base line (box bottom). */
function elkoninVerifyTallGlyph(glyph, box) {
  const pad = 2;
  const dotted = box.closest('.elkonin-slot')?.classList.contains('shape-dotted');
  let size = parseFloat(glyph.style.fontSize);
  const boxRect = box.getBoundingClientRect();
  for (let i = 0; i < 10; i++) {
    elkoninPlaceGlyphOnBaseline(glyph, box, 'tall');
    const ink = elkoninInkRect(glyph);
    if (!ink) break;
    const gapTop = ink.top - boxRect.top;
    const gapBottom = boxRect.bottom - ink.bottom;
    if (gapTop > pad + 2 || gapBottom > pad + 2) size *= 0.97;
    else if (!dotted && gapTop < -pad - 1) size *= 0.96;
    else if (gapTop > pad + 1 && gapBottom <= pad + 2) size *= 1.03;
    else if (gapTop <= pad + 1 && gapBottom <= pad + 2) break;
    glyph.style.fontSize = `${size}px`;
  }
  elkoninPlaceGlyphOnBaseline(glyph, box, 'tall');
}

/** Tail letter: body fills mid→base like tall fills sky→base; descender stays in tail zone. */
function elkoninVerifyTailGlyph(glyph, box) {
  const pad = 2;
  const body = box.querySelector('.elkonin-zone-body');
  if (!body) return;
  let size = parseFloat(glyph.style.fontSize);
  const boxRect = box.getBoundingClientRect();
  const bodyRect = body.getBoundingClientRect();
  for (let i = 0; i < 10; i++) {
    elkoninPlaceGlyphOnBaseline(glyph, box, 'descender');
    const ink = elkoninInkRect(glyph);
    if (!ink) break;
    const gapTop = ink.top - bodyRect.top;
    const gapBaseline = bodyRect.bottom - ink.bottom;
    const gapBottom = boxRect.bottom - ink.bottom;
    if (gapTop > pad + 2 || gapBaseline > pad + 2) size *= 0.97;
    else if (gapTop < -pad - 1 || gapBottom < -pad) size *= 0.96;
    else if (gapTop > pad + 1 && gapBaseline <= pad + 2) size *= 1.03;
    else if (gapTop <= pad + 1 && gapBaseline <= pad + 2 && gapBottom >= -pad) break;
    glyph.style.fontSize = `${size}px`;
  }
  elkoninPlaceGlyphOnBaseline(glyph, box, 'descender');
}

function elkoninInkRect(glyph) {
  try {
    const range = document.createRange();
    range.selectNodeContents(glyph);
    const r = range.getBoundingClientRect();
    return r.width > 0 && r.height > 0 ? r : null;
  } catch (_) {
    return glyph.getBoundingClientRect();
  }
}

function scheduleElkoninGlyphFit() {
  const run = () => fitElkoninGlyphs();
  const prep = () => {
    if (document.fonts?.load) {
      return Promise.all([
        document.fonts.load(`700 40px ${ELKONIN_FONT_STACK}`),
        document.fonts.load(`400 40px ${ELKONIN_FONT_STACK}`),
        document.fonts.load(`${ELKONIN_FONT_WEIGHT_SHORT} 40px ${ELKONIN_FONT_STACK}`),
        document.fonts.load(`${ELKONIN_FONT_WEIGHT_TALL} 40px ${ELKONIN_FONT_STACK}`)
      ]).then(run).catch(run);
    }
    run();
  };
  requestAnimationFrame(() => requestAnimationFrame(prep));
  if (document.fonts?.ready) document.fonts.ready.then(prep);
}

function buildElkoninSlots(word) {
  return [...word].map((ch, idx) => ({
    idx,
    expected: ch,
    filled: null,
    wrong: false,
    ...getLetterBoxMeta(ch)
  }));
}

const ELKONIN_BANK_ROWS = ['qwertyuiop', 'asdfghjkl', 'zxcvbnm'];

function buildElkoninBank() {
  const tiles = [];
  let id = 0;
  for (const row of ELKONIN_BANK_ROWS) {
    for (const ch of row) tiles.push({ id: id++, letter: ch });
  }
  return tiles;
}

function renderElkoninBankGrid() {
  return ELKONIN_BANK_ROWS.map(row =>
    `<div class="elkonin-bank-row">${[...row].map(ch =>
      `<button type="button" class="elkonin-bank-tile" data-bank-letter="${ch}">${ch}</button>`
    ).join('')}</div>`
  ).join('');
}

function hwBoxesSpelledWord(g) {
  return g.slots.map(s => s.filled || '').join('');
}

function hwBoxesAllFilled(g) {
  return g.slots.every(s => s.filled);
}

function validateHwBoxesSpelling(g) {
  const target = g.currentTarget;
  const spelled = hwBoxesSpelledWord(g);
  const wrongIndices = [];
  const norm = (s) => String(s).toLowerCase();
  const t = norm(target);
  const s = norm(spelled);
  if (s === t) return { ok: true, wrongIndices };
  for (let i = 0; i < g.slots.length; i++) {
    const slot = g.slots[i];
    const exp = norm(slot.expected);
    const got = norm(slot.filled || '');
    if (got !== exp) wrongIndices.push(i);
  }
  if (wrongIndices.length === 0 && s !== t) {
    for (let i = 0; i < g.slots.length; i++) wrongIndices.push(i);
  }
  return { ok: false, wrongIndices };
}

function markHwBoxesWrongSlots(g, wrongIndices) {
  g.slots.forEach(s => { s.wrong = false; });
  wrongIndices.forEach(i => { if (g.slots[i]) g.slots[i].wrong = true; });
}

function renderElkoninBoxInner(letter, shape) {
  const glyph = letter ? `<span class="elkonin-glyph">${letter}</span>` : '';
  if (shape === 'tall') {
    return `<div class="elkonin-box-stack">
      <div class="elkonin-zone-asc" aria-hidden="true"></div>
      <div class="elkonin-zone-body" aria-hidden="true"></div>
    </div>${glyph || ''}`;
  }
  if (shape === 'descender') {
    return `<div class="elkonin-box-stack">
      <div class="elkonin-zone-body" aria-hidden="true"></div>
      <div class="elkonin-zone-desc" aria-hidden="true"></div>
    </div>${glyph || ''}`;
  }
  return `<div class="elkonin-box-stack"><div class="elkonin-zone-body" aria-hidden="true"></div></div>${glyph || ''}`;
}

function hwBoxesLowFeedback(word) {
  return pickFeedbackMessage([
    `Yes! Say “${word}” again.`,
    `Good! Write “${word}” in the air.`,
    `Right! That is “${word}”.`
  ]);
}

const WORD_BOX_CONTEXT = {
  'too': ['It is ____ hot!', 'That is ____ big!', 'I am ____ tired.'],
  'the': ['Look at ____ sun.', 'The ____ cat is soft.'],
  'to': ['Go ____ bed now.', 'I walk ____ school.'],
  'said': ['She ____ hello.', 'Dad ____ stop.'],
  'was': ['It ____ fun.', 'He ____ here.'],
  'you': ['I see ____.', 'How are ____?'],
  'are': ['We ____ here.', 'They ____ kind.'],
  'all': ['We are ____ done!', 'We ____ ran.'],
};

function isWordBoxBlankNotFirst(sentence) {
  const first = String(sentence).trim().split(/\s+/)[0] || '';
  return first !== '____' && !/^_____?$/.test(first);
}

function getWordBoxContextSentence(word) {
  const key = String(word).toLowerCase();
  const longEntry = LONG_VOWEL_WORD_INDEX[key];
  if (longEntry?.sentences?.length) {
    const valid = longEntry.sentences
      .map(s => s.replace(/_____/g, '____'))
      .filter(isWordBoxBlankNotFirst);
    if (valid.length) return valid[Math.floor(Math.random() * valid.length)];
  }
  const pool = (WORD_BOX_CONTEXT[key] || []).filter(isWordBoxBlankNotFirst);
  if (pool.length) return pool[Math.floor(Math.random() * pool.length)];
  const entries = HW_SENTENCES[key];
  if (entries?.length) {
    const valid = entries
      .map(e => e.s.replace(/_____/g, '____'))
      .filter(isWordBoxBlankNotFirst);
    if (valid.length) return valid[Math.floor(Math.random() * valid.length)];
  }
  return '';
}

function initHwBoxes(needs) {
  const g = state.game;
  g.roundTargets = buildRoundTargets(needs, 'hw', CHALLENGE_ROUNDS);
  g.targetPool = uniqueValidTokens([...needs.targetHws.map(x => x.hw), ...needs.masteredHws.map(x => x.hw)]);
  g.totalRounds = CHALLENGE_ROUNDS;
  g.roundIdx = 0;
  g.correct = 0;
  g.attempts = 0;
  if (g.roundTargets.length === 0) { g.empty = true; return; }
  newHwBoxesRound();
}

function newHwBoxesRound() {
  const g = state.game;
  if (g._hintTimer) { clearTimeout(g._hintTimer); g._hintTimer = null; }
  g.roundHadError = false;
  g.roundMistakeLogged = false;
  if (g.roundIdx >= g.totalRounds) { g.finished = true; return; }
  g.currentTarget = String(g.roundTargets[g.roundIdx] ?? '').trim();
  if (!isValidGameToken(g.currentTarget)) {
    g.roundIdx++;
    if (g.roundIdx >= g.totalRounds) { g.finished = true; return; }
    newHwBoxesRound();
    return;
  }
  g.contextSentence = getWordBoxContextSentence(g.currentTarget);
  g.slots = buildElkoninSlots(g.currentTarget);
  g.bank = buildElkoninBank();
  g.phase = 'spell';
  g.feedback = null;
  resetTargetAudioFlags(g);
}

function hwBoxesNextEmptySlotIndex(g) {
  return g.slots.findIndex(s => s.filled == null);
}

function hwBoxesPickLetter(letter) {
  const g = state.game;
  if (g.phase !== 'spell' && g.phase !== 'retry') return;
  const slotIdx = hwBoxesNextEmptySlotIndex(g);
  if (slotIdx < 0) return;
  sfxClick();
  hwBoxesPlaceInSlot(slotIdx, letter);
}

window.hwBoxesShowHint = () => {
  const g = state.game;
  if (!g || g.type !== 'hwBoxes' || g.phase === 'hint' || g.phase === 'roundEnd' || g.phase === 'review') return;
  sfxClick();
  if (g._hintTimer) { clearTimeout(g._hintTimer); g._hintTimer = null; }
  g.phase = 'hint';
  render();
  g._hintTimer = setTimeout(() => {
    if (state.game !== g || g.phase !== 'hint') return;
    g.phase = 'spell';
    g._hintTimer = null;
    render();
  }, HW_BOX_HINT_MS);
};

function hwBoxesEnterReview() {
  const g = state.game;
  if ((g.phase !== 'spell' && g.phase !== 'retry') || !hwBoxesAllFilled(g)) return;
  g.phase = 'review';
  g.feedback = null;
  render();
}

function hwBoxesPlaceInSlot(slotIdx, letter) {
  const g = state.game;
  if (g.phase !== 'spell' && g.phase !== 'retry') return;
  const slot = g.slots[slotIdx];
  const ch = String(letter || '').toLowerCase();
  if (!slot || !ch) return;

  slot.filled = ch;
  slot.wrong = false;
  if (g.phase === 'retry') g.feedback = null;

  if (hwBoxesAllFilled(g)) {
    setTimeout(() => {
      if (state.game === g && (g.phase === 'spell' || g.phase === 'retry') && hwBoxesAllFilled(g)) {
        hwBoxesEnterReview();
      }
    }, 350);
  }
  render();
}

function hwBoxesClearSlot(slotIdx) {
  const g = state.game;
  if (g.phase !== 'spell' && g.phase !== 'retry') return;
  const slot = g.slots[slotIdx];
  if (!slot || slot.filled == null) return;
  slot.filled = null;
  slot.wrong = false;
  g.phase = 'spell';
  render();
}

window.hwBoxesReviewAnswer = (looksOk) => {
  const g = state.game;
  if (!g || g.type !== 'hwBoxes' || g.phase !== 'review') return;
  sfxClick();
  const result = validateHwBoxesSpelling(g);

  if (looksOk && result.ok) {
    if (!g.roundHadError) g.correct++;
    confetti();
    g.feedback = { correct: true, message: hwBoxesLowFeedback(g.currentTarget) };
    playTargetOnCorrect(g, g.currentTarget);
    g.history.push({ target: g.currentTarget, correct: !g.roundHadError, type: 'hw' });
    g.roundHadError = false;
    g.roundMistakeLogged = false;
    g.phase = 'roundEnd';
    render();
    return;
  }

  if (!looksOk && result.ok) {
    g.feedback = { correct: false, message: 'Tap ✓ when you are ready.' };
    g.phase = 'review';
    render();
    return;
  }

  markHwBoxesWrongSlots(g, result.wrongIndices);
  g.roundHadError = true;
  if (!g.roundMistakeLogged) {
    g.history.push({ target: g.currentTarget, correct: false, type: 'hw' });
    g.roundMistakeLogged = true;
  }
  g.feedback = { correct: false, message: 'Try again.' };
  g.phase = 'retry';
  render();
};

window.nextHwBoxesRound = () => {
  sfxClick();
  const g = state.game;
  clearGameNextBtnTimer(g);
  g.roundIdx++;
  if (g.roundIdx >= g.totalRounds) {
    g.finished = true;
    render();
    return;
  }
  newHwBoxesRound();
  render();
};

function renderHwBoxes(app) {
  const g = state.game;
  const audioOk = hasAudio(g.currentTarget);
  const useSpellLayout = g.phase === 'spell' || g.phase === 'retry' || g.phase === 'review' || g.phase === 'roundEnd';
  const showBank = g.phase === 'spell' || g.phase === 'retry';
  const showLine = g.phase === 'spell' || g.phase === 'retry' || g.phase === 'review';

  const boxesHtml = g.slots.map(slot => {
    let cls = `elkonin-box ${slot.shape}`;
    if (slot.dotted) cls += ' shape-dotted';
    if (slot.filled) cls += ' filled';
    if (slot.wrong) cls += ' wrong-slot';
    const inner = renderElkoninBoxInner(slot.filled, slot.shape);
    return `<div class="elkonin-slot shape-${slot.shape}${slot.dotted ? ' shape-dotted' : ''}">
      <div class="elkonin-pad-top" aria-hidden="true"></div>
      <div class="${cls}" data-slot-idx="${slot.idx}" draggable="false">${inner}</div>
      <div class="elkonin-pad-bottom" aria-hidden="true"></div>
    </div>`;
  }).join('');

  const bankHtml = renderElkoninBankGrid();

  const contextHtml = showLine && g.contextSentence && g.phase !== 'roundEnd'
    ? `<p class="hw-box-sentence game-context-sentence" aria-label="Example sentence">${g.contextSentence}</p>`
    : '';
  const playHeader = renderGamePlayHeader({
    contextHtml,
    feedbackMessage: g.phase === 'retry' && g.feedback ? g.feedback.message : null,
    feedbackCorrect: g.phase === 'retry' ? false : null,
    nextOnclick: null,
  });

  const reviewPanel = g.phase === 'review' ? `
      <div class="hw-box-review-panel fadeIn">
        <p class="hw-box-review-prompt">Does it look OK?</p>
        <div class="flex gap-4 justify-center flex-wrap">
          <button type="button" id="hwBoxesYes" class="bg-green-500/50 hover:bg-green-500/70 border-2 border-green-300 w-16 h-16 rounded-2xl text-3xl font-bold" aria-label="Yes">✓</button>
          <button type="button" id="hwBoxesNo" class="bg-orange-500/40 hover:bg-orange-500/60 border-2 border-orange-300 w-16 h-16 rounded-2xl text-3xl font-bold" aria-label="Try again">✗</button>
        </div>
      </div>` : '';

  const roundEndPanel = (g.phase === 'roundEnd' && g.feedback) ? `
      <div class="hw-box-review-panel hw-box-round-end-panel fadeIn">
        <p class="hw-box-review-prompt text-green-300">${g.feedback.message}</p>
        ${renderGameNextButton('Next', 'nextHwBoxesRound()')}
      </div>` : '';

  const bottomPanel = showBank
    ? `<div class="elkonin-bank-grid" id="elkoninBankGrid">${bankHtml}</div>`
    : (reviewPanel || roundEndPanel);

  app.innerHTML = `
    <div class="hw-box-screen min-h-screen p-4 md:p-8">
      <div class="max-w-4xl mx-auto">
        ${renderGameTopBar(g)}
        ${playHeader}
        <div class="flex justify-center mb-4">
          <button type="button" id="hwBoxesListen" class="bg-gradient-to-r from-yellow-400 to-orange-500 hover:from-yellow-300 hover:to-orange-400 text-white font-bold px-6 py-3 rounded-2xl text-lg shadow-lg">🔊 Listen</button>
        </div>

        ${useSpellLayout ? `
        <div class="hw-box-spell-area">
        <div class="hw-box-spell-row">
          <p class="hw-box-context" aria-hidden="true"></p>
          <div class="hw-box-elkonin-wrap">
        <div class="elkonin-page mb-0">
          <div class="elkonin-line-wrap">
            <div class="elkonin-handwriting-guides" aria-hidden="true">
              <div class="elkonin-guide elkonin-guide-sky"></div>
              <div class="elkonin-guide elkonin-guide-mid"></div>
              <div class="elkonin-guide elkonin-guide-base"></div>
              <div class="elkonin-guide elkonin-guide-worm"></div>
            </div>
            <div class="elkonin-boxes-row" id="elkoninBoxesRow">${boxesHtml}</div>
          </div>
        </div>
          </div>
          <button type="button" id="hwBoxesHint" class="hw-box-hint-btn${showBank ? '' : ' hw-box-hint-btn--placeholder'}" aria-label="Show the word briefly" title="Show the word briefly" ${showBank ? '' : 'tabindex="-1"'}>💡</button>
        </div>
          ${bottomPanel}
        </div>
        ` : `
        <div class="elkonin-page mb-4 opacity-90">
          <div class="elkonin-line-wrap">
            <div class="elkonin-handwriting-guides" aria-hidden="true">
              <div class="elkonin-guide elkonin-guide-sky"></div>
              <div class="elkonin-guide elkonin-guide-mid"></div>
              <div class="elkonin-guide elkonin-guide-base"></div>
              <div class="elkonin-guide elkonin-guide-worm"></div>
            </div>
            <div class="elkonin-boxes-row" id="elkoninBoxesRow">${boxesHtml}</div>
          </div>
        </div>
        `}
      </div>
      ${g.phase === 'hint' ? `
        <div class="hw-box-hint-overlay" role="dialog" aria-label="Hint">
          <div class="hw-box-hint-bar-wrap" style="--hw-hint-ms:${HW_BOX_HINT_MS}ms"><div class="hw-box-hint-bar"></div></div>
          <div class="hw-box-hint-word">${g.currentTarget}</div>
        </div>
      ` : ''}
    </div>`;

  setTimeout(() => {
    attachHwBoxesHandlers(g);
    scheduleElkoninGlyphFit();
    afterGameRenderArmNext();
  }, 0);
}

function attachHwBoxesHandlers(g) {
  const listenBtn = document.getElementById('hwBoxesListen');
  if (listenBtn) listenBtn.addEventListener('click', () => playTargetListen(g.currentTarget));
  document.getElementById('hwBoxesHint')?.addEventListener('click', () => hwBoxesShowHint());

  if (g.phase === 'spell') setTimeout(() => playTargetOnShow(g, g.currentTarget), 400);

  if (g.phase === 'review') {
    document.getElementById('hwBoxesYes')?.addEventListener('click', () => hwBoxesReviewAnswer(true));
    document.getElementById('hwBoxesNo')?.addEventListener('click', () => hwBoxesReviewAnswer(false));
    return;
  }

  if (g.phase !== 'spell' && g.phase !== 'retry') return;

  document.querySelectorAll('.elkonin-bank-tile').forEach(tile => {
    const letter = tile.getAttribute('data-bank-letter');
    tile.addEventListener('click', () => hwBoxesPickLetter(letter));
  });

  document.querySelectorAll('.elkonin-box').forEach(box => {
    const slotIdx = parseInt(box.getAttribute('data-slot-idx'), 10);
    box.addEventListener('click', () => {
      if (g.slots[slotIdx].filled == null) return;
      sfxClick();
      hwBoxesClearSlot(slotIdx);
    });
  });

  scheduleElkoninGlyphFit();
}

// ============================================================
// FILL IN THE BLANK
// ============================================================
function initHwBlank(needs) {
  const g = state.game;
  g.roundTargets = buildRoundTargets(needs, 'hw', CHALLENGE_ROUNDS);
  g.targetPool = uniqueValidTokens([
    ...needs.targetHws.map(x => x.hw),
    ...needs.masteredHws.map(x => x.hw),
  ]);
  g.sentenceDecks = {};
  if (g.roundTargets.length === 0) { g.empty = true; return; }
  g.totalRounds = CHALLENGE_ROUNDS;
  g.roundIdx = 0;
  g.attempts = 0;
  g.correct = 0;
  newBlankRound();
}

function newBlankRound() {
  const g = state.game;
  if (g.roundIdx >= g.totalRounds) { g.finished = true; return; }
  const target = String(g.roundTargets[g.roundIdx] ?? '').trim();
  if (!isValidGameToken(target)) {
    g.roundIdx++;
    if (g.roundIdx >= g.totalRounds) { g.finished = true; return; }
    newBlankRound();
    return;
  }
  const key = target.toLowerCase();
  const entries = getHwBlankEntries(target, g.targetPool);
  if (!g.sentenceDecks[key]) g.sentenceDecks[key] = createCycleDeck(entries);
  const entry = g.sentenceDecks[key].next();
  if (!entry || !entry.s) {
    g.roundIdx++;
    if (g.roundIdx >= g.totalRounds) { g.finished = true; return; }
    newBlankRound();
    return;
  }
  const curatedD = entry.d ? uniqueValidTokens(entry.d) : [];
  g.currentTarget = target;
  g.currentSentence = entry.s;
  g.currentOptions = buildBlankChallengeOptions(target, curatedD, g.targetPool, 3);
  g.feedback = null;
  resetTargetAudioFlags(g);
}

window.blankPick = (opt) => {
  const g = state.game;
  if (g.feedback) return;
  if (!isValidGameToken(opt)) return;
  sfxClick();
  const correct = opt.toLowerCase() === g.currentTarget.toLowerCase();
  if (correct) {
    g.attempts++;
    g.feedback = {
      picked: opt,
      correct: true,
      message: correctFeedback(g.currentTarget, 'hw', 'hwBlank')
    };
    g.correct++;
    confetti();
    playTargetOnCorrect(g, g.currentTarget);
    g.history.push({ target: g.currentTarget, picked: opt, correct, type: 'hw' });
  } else {
    g.feedback = {
      picked: opt,
      correct: false,
      message: challengeWrongFeedback(g.currentTarget, 'hw', 'hwBlank')
    };
  }
  render();
};

window.nextBlankRound = () => {
  clearGameNextBtnTimer(state.game);
  state.game.roundIdx++;
  newBlankRound();
  render();
};

function renderHwBlank(app) {
  const g = state.game;
  const blankAudioOk = hasAudio(g.currentTarget);
  const sentenceParts = g.currentSentence.split('_____');
  const blankAtStart = (sentenceParts[0] || '').trim().length === 0;
  const cap = (s) => s ? (s.charAt(0).toUpperCase() + s.slice(1)) : s;
  const answeredCorrect = !!(g.feedback && g.feedback.correct);

  const sentenceHtml = sentenceParts.map((part, i) =>
    i < sentenceParts.length - 1
      ? `${part}<span class="hw-blank-gap">?</span>`
      : part
  ).join('');

  const noExampleSentence = isGenericHwBlankSentence(g.currentSentence);
  const contextHtml = answeredCorrect ? '' : (
    noExampleSentence ? '' : renderHwBlankSentence(sentenceHtml)
  );
  const playHeader = renderGamePlayHeader({
    contextHtml,
    feedbackMessage: g.feedback?.message,
    feedbackCorrect: g.feedback?.correct,
    nextOnclick: challengeNextOnclick(g),
    nextLabel: challengeNextLabel(g),
  });

  let mainPanel = '';
  if (answeredCorrect) {
    mainPanel = renderHwBlankCompletedSentence(g.currentSentence, g.currentTarget, blankAtStart);
  } else {
    const optionsHtml = g.currentOptions.map((opt) => {
      const displayOpt = blankAtStart ? cap(opt) : opt;
      let cls = 'blankOption bg-gradient-to-br from-fuchsia-400 to-purple-600 rounded-2xl py-5 px-4 flex items-center justify-center gap-3 text-2xl md:text-3xl font-bold cursor-pointer transition transform hover:scale-105 shadow-xl';
      if (g.feedback) {
        if (opt.toLowerCase() === g.currentTarget.toLowerCase()) cls += ' ring-4 ring-green-400 scale-105';
        else if (g.feedback.picked === opt) cls += ' ring-4 ring-red-400 opacity-50 shake';
        else cls += ' opacity-30';
      }
      return `<button class="${cls}" data-option="${opt.replace(/"/g,'&quot;')}">${displayOpt}</button>`;
    }).join('');
    const listenBlock = blankAudioOk
      ? `<div class="text-center mb-6"><button type="button" id="blankListenBtn" class="bg-gradient-to-r from-yellow-400 to-orange-500 hover:from-yellow-300 hover:to-orange-400 text-white font-bold px-8 py-4 rounded-2xl text-xl shadow-2xl transform hover:scale-105 transition">🔊 Listen</button></div>`
      : '<div class="mb-6"></div>';
    mainPanel = `${listenBlock}<div class="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">${optionsHtml}</div>`;
  }

  app.innerHTML = `
    <div class="hw-blank-screen min-h-screen p-4 md:p-8${answeredCorrect ? ' hw-blank-screen--success' : ''}">
      <div class="max-w-4xl mx-auto hw-blank-screen-inner">
        ${renderGameTopBar(g)}
        ${playHeader}
        ${mainPanel}
      </div>
    </div>`;

  setTimeout(() => {
    if (!answeredCorrect) {
      document.querySelectorAll('.blankOption').forEach(btn => {
        btn.addEventListener('click', () => blankPick(btn.getAttribute('data-option')));
      });
      const blankListen = document.getElementById('blankListenBtn');
      if (blankListen) blankListen.addEventListener('click', () => playTargetListen(g.currentTarget));
      if (!g.feedback && isGenericHwBlankSentence(g.currentSentence)) {
        setTimeout(() => playTargetOnShow(g, g.currentTarget), 400);
      }
    }
    afterGameRenderArmNext();
  }, 0);
}

// ============================================================
// GAME END SCREEN
// ============================================================
function gameEndCorrectFraction(g) {
  if (g.type === 'flash') {
    return `${g.correct}/${g.cards?.length || 0}`;
  }
  const total = g.totalRounds || CHALLENGE_ROUNDS;
  return `${g.correct}/${total}`;
}

function calcReadingGameStars(g) {
  return Math.max(0, g.correct || 0);
}

function renderGameEnd(app){
  const g = state.game;
  const scoreDenom = (g.type === 'hwBoxes' || g.type === 'soundBox') ? (g.totalRounds || CHALLENGE_ROUNDS) : g.attempts;
  const pct = scoreDenom ? Math.round(g.correct / scoreDenom * 100) : 0;
  let msg, emoji;
  let success = pct >= 70;

  if (g.type === 'gpcCatch') {
    success = !!g.won;
    if (success) { msg = `You caught all ${CHALLENGE_ROUNDS} sounds!`; emoji = "🎯"; }
    else { msg = "Out of lives! Try again."; emoji = "💔"; }
  } else if (g.type === 'soundFlip') {
    success = g.correct >= g.totalRounds || (g.finished && pct >= 70);
    if (g.correct === g.totalRounds) { msg = `Perfect — all ${g.totalRounds} flipped right!`; emoji = "🏆"; }
    else if (success) { msg = "You finished Sound Flip!"; emoji = "🔄"; }
    else { msg = "Good try — practise those orientations again!"; emoji = "💪"; }
  } else if (g.type === 'hwBlank') {
    success = g.correct >= 8;
    if (g.correct === g.totalRounds) { msg = "Perfect! Every sentence correct!"; emoji = "🏆"; }
    else if (success) { msg = "Great job — you passed!"; emoji = "⭐"; }
    else { msg = "Good try. Keep practising!"; emoji = "💪"; }
  } else if (g.type === 'hwBoxes') {
    success = g.correct >= Math.ceil(CHALLENGE_ROUNDS / 2);
    if (g.correct === g.totalRounds) { msg = "You spelled every word in Word Box!"; emoji = "🏆"; }
    else if (success) { msg = "Great Word Box spelling!"; emoji = "📦"; }
    else { msg = "Good try — keep building those words!"; emoji = "💪"; }
  } else if (g.type === 'soundBox') {
    success = g.correct >= Math.ceil(CHALLENGE_ROUNDS / 2);
    if (g.correct === g.totalRounds) { msg = "You built every sound in Sound Box!"; emoji = "🏆"; }
    else if (success) { msg = "Great Sound Box work!"; emoji = "🔊"; }
    else { msg = "Good try — keep listening for sounds!"; emoji = "💪"; }
  } else if (g.type === 'flash') {
    const known = g.correct;
    const total = g.cards?.length || g.attempts || 0;
    success = total > 0 && known >= Math.ceil(total * 0.5);
    if (known === total && total > 0) { msg = 'You knew every item you checked!'; emoji = '🌟'; }
    else if (success) { msg = 'Self check complete — nice work!'; emoji = '✅'; }
    else { msg = 'Thanks for checking — keep practising!'; emoji = '💪'; }
  } else {
    if (pct >= 90) { msg = "Outstanding work!"; emoji = "🏆"; }
    else if (pct >= 70) { msg = "Strong effort!"; emoji = "⭐"; }
    else if (pct >= 50) { msg = "You're learning — keep going!"; emoji = "💪"; }
    else { msg = "Good practise. Let's try again."; emoji = "🌱"; }
  }

  let starsAwarded = 0;
  let trackBonusAwarded = false;
  let perfectBonus = 0;
  if (!g.pointsAwarded) {
    starsAwarded = calcReadingGameStars(g);
    if (isReadingGamePerfect(g)) {
      perfectBonus = READING_GAME_PERFECT_BONUS;
      starsAwarded += perfectBonus;
    }
    if (starsAwarded > 0) addPoints(state.selectedStudent, starsAwarded);
    g.pointsAwarded = true;
    g.perfectBonusAwarded = perfectBonus;
  } else {
    starsAwarded = calcReadingGameStars(g);
    if (g.perfectBonusAwarded) starsAwarded += g.perfectBonusAwarded;
  }
  if (!g.trackMarked && TRACK_GAME_IDS.includes(g.type)) {
    trackBonusAwarded = markTrackGamePlayed(state.selectedStudent, g.type);
    g.trackMarked = true;
  }

  const wrongItems = g.history.filter(h => !h.correct);
  const wrongHtml = wrongItems.length
    ? `<div class="mt-4"><div class="text-sm text-white/60 mb-2">Items to practise more:</div><div class="flex flex-wrap gap-2 justify-center">${wrongItems.map(w => {
        const hasAud = hasAudio(w.target);
        return `<span class="inline-flex items-center gap-1 px-3 py-1 bg-orange-500/30 rounded-full">
          ${w.target}
          ${hasAud ? `<button onclick="playSound('${w.target.replace(/'/g,"\\'")}')" class="w-5 h-5 rounded-full bg-yellow-400/30 hover:bg-yellow-400/60 text-xs" title="Listen">🔊</button>` : ''}
        </span>`;
      }).join('')}</div></div>`
    : `<div class="mt-4 text-green-200">Every single one correct! 🌟</div>`;

  const totalStars = getPoints(state.selectedStudent);
  const perfectBonusShown = g.perfectBonusAwarded || 0;
  const perfectBonusHtml = perfectBonusShown > 0
    ? `<div class="game-end-perfect-bonus fadeIn">
        <div class="game-end-perfect-bonus-title">Perfect score!</div>
        <div class="game-end-perfect-bonus-sub">+${perfectBonusShown} bonus stars</div>
      </div>`
    : '';
  if (perfectBonusShown > 0) {
    spawnPerfectStarBurst();
    for (let i = 0; i < 3; i++) setTimeout(() => confetti(), i * 280);
  }

  app.innerHTML = `
    <div class="min-h-screen flex items-center justify-center p-4">
      <div class="bg-white/10 backdrop-blur border border-white/20 rounded-3xl p-8 max-w-lg w-full text-center fadeIn">
        <div class="text-7xl mb-4">${emoji}</div>
        <h2 class="text-3xl font-bold mb-1">${msg}</h2>
        <p class="text-white/70 mb-6">${state.selectedStudent}</p>
        ${perfectBonusHtml}
        <div class="grid grid-cols-3 gap-3 mb-4">
          <div class="bg-white/10 rounded-xl p-3"><div class="text-2xl font-bold">+${starsAwarded}</div><div class="text-xs text-white/70">stars earned</div></div>
          <div class="bg-white/10 rounded-xl p-3"><div class="text-2xl font-bold">${gameEndCorrectFraction(g)}</div><div class="text-xs text-white/70">${g.type === 'flash' ? 'I know it' : 'score'}</div></div>
          <div class="bg-yellow-400/20 rounded-xl p-3"><div class="text-2xl font-bold">${totalStars}</div><div class="text-xs text-white/70">total stars</div></div>
        </div>
        ${wrongHtml}
        ${trackBonusAwarded ? `<p class="mt-4 text-yellow-200 font-semibold fadeIn">🌟 Starcade bonus! +${STARCADE_TRACK_BONUS} stars — you played every game once!</p>` : ''}
        <div class="flex gap-3 mt-6 justify-center flex-wrap">
          <button onclick="sfxClick(); startGame('${g.type}')" class="bg-white/20 hover:bg-white/30 px-5 py-2 rounded-xl">Play again</button>
          <button onclick="sfxClick(); state.view='profile'; render()" class="bg-gradient-to-r from-pink-500 to-purple-600 hover:from-pink-400 hover:to-purple-500 px-5 py-2 rounded-xl font-semibold">Back to games</button>
        </div>
      </div>
    </div>`;
}

// ============================================================
// THE STARCADE
// ============================================================
function renderArcade(app) {
  if (state.arcadeGame === 'menu' || !state.arcadeGame) return renderArcadeMenu(app);
  if (state.arcadeGame === 'ttt') return renderTTT(app);
  if (state.arcadeGame === 'c4') return renderC4(app);
  if (state.arcadeGame === 'slime') return renderTreasureHunter(app);
  if (state.arcadeGame === 'pong') return renderPong(app);
}

function renderArcadeMenu(app) {
  const points = getPoints(state.selectedStudent);
  const games = [
    { id: 'ttt', name: 'Tic-Tac-Toe', emoji: '⭕', desc: 'Three in a row. You vs the computer.', cost: STARCADE_GAME_COST, accent: 'ttt' },
    { id: 'c4', name: 'Connect 4', emoji: '🔴', desc: 'Drop your pieces. Get four in a row.', cost: STARCADE_GAME_COST, accent: 'c4' },
    { id: 'slime', name: 'Treasure Hunter', emoji: '🏴‍☠️', desc: 'Say each word, find treasures, and grab ⭐ bonus tiles for +3 clicks.', cost: STARCADE_GAME_COST, accent: 'slime' },
    { id: 'pong', name: 'Pong', emoji: '🏓', desc: 'Move your paddle. Hit power-ups. First to 6 wins.', cost: STARCADE_GAME_COST, accent: 'pong' },
  ];
  const cards = games.map(g => {
    const canAfford = points >= g.cost;
    const lockedClass = canAfford ? '' : ' arcade-cabinet-card--locked';
    const menuStars = [12, 68, 124, 180].map((left, i) =>
      `<span class="arcade-menu-star" style="left:${left}px;top:${18 + i * 14}px;animation-delay:${i * 0.7}s">✦</span>`
    ).join('');
    return `
      <button type="button" onclick="${canAfford ? `launchArcadeGame('${g.id}', ${g.cost})` : ''}" ${!canAfford ? 'disabled' : ''} class="arcade-cabinet-card arcade-cabinet-card--${g.accent}${lockedClass}" aria-label="${g.name}, ${canAfford ? g.cost + ' stars' : 'need more stars'}">
        <div class="arcade-menu-stars" aria-hidden="true">${menuStars}</div>
        <div class="arcade-cabinet-marquee-trim" aria-hidden="true"></div>
        <div class="arcade-marquee">
          <div class="arcade-marquee-screen">
            <span class="arcade-marquee-icon" aria-hidden="true">${g.emoji}</span>
          </div>
          <h3 class="arcade-marquee-title arcade-title-friendly">${g.name}</h3>
        </div>
        <div class="arcade-cabinet-body">
          <p class="arcade-cabinet-desc arcade-instructions">${g.desc}</p>
          <div class="arcade-cabinet-panel" aria-hidden="true">
            <span class="arcade-cabinet-joystick"></span>
            <span class="arcade-cabinet-btn arcade-cabinet-btn--a"></span>
            <span class="arcade-cabinet-btn arcade-cabinet-btn--b"></span>
          </div>
          <div class="arcade-cabinet-cost">
            ${canAfford ? `Play (${g.cost} ⭐)` : `Need ${g.cost - points} more ⭐`}
          </div>
        </div>
        <div class="arcade-cabinet-plinth" aria-hidden="true"></div>
      </button>`;
  }).join('');

  app.innerHTML = `
    <div class="min-h-screen p-4 md:p-8">
      <div class="max-w-5xl mx-auto">
        <div class="flex justify-between items-center mb-6">
          <button onclick="sfxClick(); state.view='profile'; render()" class="text-white/70 hover:text-white text-sm">← Back to games</button>
          <span class="bg-yellow-400/20 px-4 py-2 rounded-full font-bold">⭐ ${points} stars</span>
        </div>
        <h1 class="text-3xl md:text-4xl font-bold text-center mb-2 arcade-title-friendly">🌟 The Starcade</h1>
        <p class="arcade-instructions text-center text-white/85 mb-2">Use your stars to play fun games.</p>
        <div class="arcade-menu-grid fadeIn">${cards}</div>
      </div>
    </div>`;
}

window.launchArcadeGame = (gameId, cost) => {
  sfxClick();
  const name = state.selectedStudent;
  if (!spendPoints(name, cost)) {
    alert(`You need ${cost} ⭐ to play. You have ${getPoints(name)}.`);
    return;
  }
  if (gameId === 'ttt') {
    state.arcade = {
      board: Array(9).fill(null),
      cellItems: assignFocusItems(9),
      playerTurn: true, winner: null, finished: false, winLine: null
    };
  } else if (gameId === 'c4') {
    state.arcade = {
      board: Array(6).fill(null).map(()=>Array(7).fill(null)),
      cellItems: Array(6).fill(null).map(()=>assignFocusItems(7)),
      playerTurn: true, winner: null, finished: false, winCells: null, lastMove: null
    };
  }
  state.starcadeBonuses = {};
  state.arcadeGame = gameId;
  state.view = 'arcade';
  render();
};

window.exitArcadeGame = () => {
  sfxClick();
  if (window._pongParentPointer) {
    window.removeEventListener('mousemove', window._pongParentPointer);
    window.removeEventListener('pointermove', window._pongParentPointer);
    window._pongParentPointer = null;
  }
  if (window._pongWinHandler) {
    window.removeEventListener('message', window._pongWinHandler);
    window._pongWinHandler = null;
  }
  if (window._treasureHandler) {
    window.removeEventListener('message', window._treasureHandler);
    window._treasureHandler = null;
  }
  state.arcadeGame = 'menu';
  render();
};

// ============================================================
// PONG (embedded canvas game)
// ============================================================
function sendPongFocusWords() {
  const frame = document.getElementById('pongFrame');
  if (!frame || !frame.contentWindow) return;
  try {
    frame.contentWindow.postMessage({
      type: 'pong-focus-words',
      words: getFocusItems(state.selectedStudent)
    }, '*');
  } catch (e) {}
}

function renderPong(app) {
  if (window._pongWinHandler) {
    window.removeEventListener('message', window._pongWinHandler);
  }
  window._pongWinHandler = (e) => {
    if (!e.data || !e.data.type) return;
    if (e.data.type === 'pong-win') { confetti(); awardStarcadeWinBonus('pong-win'); }
    if (e.data.type === 'pong-speak' && e.data.word) speak(e.data.word);
    if (e.data.type === 'pong-ready') sendPongFocusWords();
  };
  window.addEventListener('message', window._pongWinHandler);

  app.innerHTML = `
    <div class="arcade-screen arcade-screen--pong flex flex-col">
      <button type="button" onclick="exitArcadeGame()" class="arcade-pong-exit">← Starcade</button>
      <iframe id="pongFrame" src="../HTML games/PONG.html?embed=1" class="arcade-pong-frame flex-1 w-full" title="Pong game" allow="autoplay"></iframe>
    </div>`;

  const frame = document.getElementById('pongFrame');
  if (frame) frame.onload = () => sendPongFocusWords();

  if (window._pongParentPointer) {
    window.removeEventListener('mousemove', window._pongParentPointer);
    window.removeEventListener('pointermove', window._pongParentPointer);
  }
  window._pongParentPointer = (e) => {
    if (state.arcadeGame !== 'pong') return;
    const pongFrame = document.getElementById('pongFrame');
    if (!pongFrame?.contentWindow) return;
    const rect = pongFrame.getBoundingClientRect();
    try {
      pongFrame.contentWindow.postMessage({
        type: 'pong-pointer-y',
        clientY: e.clientY,
        frameTop: rect.top,
        frameHeight: rect.height
      }, '*');
    } catch (err) {}
  };
  window.addEventListener('mousemove', window._pongParentPointer, { passive: true });
  window.addEventListener('pointermove', window._pongParentPointer, { passive: true });
}

// ============================================================
// TIC-TAC-TOE
// ============================================================
window.tttMove = (idx) => {
  const a = state.arcade;
  if (a.finished || a.board[idx] || !a.playerTurn) return;
  sfxClick();
  if (a.cellItems[idx]) speak(a.cellItems[idx].value);

  a.board[idx] = 'X';
  a.playerTurn = false;
  const winInfo = tttCheckWin(a.board);
  if (winInfo || !a.board.includes(null)) {
    if (winInfo) {
      a.winner = winInfo.player; a.winLine = winInfo.line;
      if (winInfo.player === 'X') { setTimeout(()=>{ confetti(); }, 400); awardStarcadeWinBonus('ttt-win'); }
    }
    a.finished = true; render(); return;
  }
  render();
  setTimeout(() => {
    const aiMove = tttAIMove(a.board);
    if (aiMove !== -1) {
      a.board[aiMove] = 'O';
      if (a.cellItems[aiMove]) speak(a.cellItems[aiMove].value);
    }
    const w2 = tttCheckWin(a.board);
    if (w2 || !a.board.includes(null)) {
      if (w2) {
        a.winner = w2.player; a.winLine = w2.line;
        if (w2.player === 'X') awardStarcadeWinBonus('ttt-win');
      }
      a.finished = true;
    }
    a.playerTurn = true;
    render();
  }, 2000);
};
function tttCheckWin(b) {
  const lines = [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];
  for (const line of lines) {
    const [x,y,z] = line;
    if (b[x] && b[x] === b[y] && b[x] === b[z]) return { player: b[x], line };
  }
  return null;
}
function tttAIMove(board) {
  if (Math.random() < 0.35) {
    const empty = board.map((v,i) => v ? null : i).filter(i => i !== null);
    return empty.length ? empty[Math.floor(Math.random() * empty.length)] : -1;
  }
  for (let i = 0; i < 9; i++) { if (!board[i]) { const t = [...board]; t[i] = 'O'; if (tttCheckWin(t)) return i; } }
  for (let i = 0; i < 9; i++) { if (!board[i]) { const t = [...board]; t[i] = 'X'; if (tttCheckWin(t)) return i; } }
  if (!board[4]) return 4;
  const corners = [0,2,6,8].filter(i => !board[i]);
  if (corners.length) return corners[Math.floor(Math.random()*corners.length)];
  const empty = board.map((v,i) => v ? null : i).filter(i => i !== null);
  return empty.length ? empty[Math.floor(Math.random() * empty.length)] : -1;
}
function renderTTT(app) {
  const a = state.arcade;
  const points = getPoints(state.selectedStudent);
  let resultMessage = '';
  if (a.finished) {
    if (a.winner === 'X') resultMessage = `<div class="text-2xl font-bold text-yellow-300 mb-2 arcade-title-friendly">🎉 You won!</div>`;
    else if (a.winner === 'O') resultMessage = `<div class="text-xl font-bold text-white/80 mb-2 arcade-instructions">The computer won. Try again!</div>`;
    else resultMessage = `<div class="text-xl font-bold text-white/80 mb-2 arcade-instructions">It is a draw! 🤝</div>`;
  }
  const board = a.board.map((cell, i) => {
    const inWinLine = a.winLine && a.winLine.includes(i);
    const item = a.cellItems[i];
    const itemType = item.type;
    const itemValue = item.value;
    const highlight = inWinLine ? 'ring-4 ring-yellow-400 bg-yellow-400/30' : (cell ? 'bg-white/20' : 'bg-white/10 hover:bg-white/25');
    const disabled = a.finished || cell || !a.playerTurn;

    let content = '';
    if (cell === 'X') {
      content = `<div class="relative flex flex-col items-center justify-center">
        <span class="text-4xl md:text-5xl text-pink-300 font-bold leading-none">✕</span>
        <span class="text-xs md:text-sm text-white/80 mt-1">${itemValue}</span>
      </div>`;
    } else if (cell === 'O') {
      content = `<div class="relative flex flex-col items-center justify-center">
        <span class="text-4xl md:text-5xl text-cyan-300 font-bold leading-none">○</span>
        <span class="text-xs md:text-sm text-white/80 mt-1">${itemValue}</span>
      </div>`;
    } else {
      const colorClass = itemType === 'gpc' ? 'text-cyan-200' : 'text-pink-200';
      content = `<span class="${colorClass} text-3xl md:text-4xl font-bold">${itemValue}</span>`;
    }
    return `<button onclick="tttMove(${i})" ${disabled ? 'disabled' : ''} class="aspect-square min-h-[4.5rem] sm:min-h-[5.5rem] ${highlight} disabled:hover:bg-white/20 rounded-2xl flex items-center justify-center transition shadow-lg" title="${itemValue}">${content}</button>`;
  }).join('');

  app.innerHTML = `
    <div class="arcade-screen p-1 sm:p-2 flex flex-col">
      <div class="arcade-wrap max-w-2xl mx-auto w-full arcade-play-shell">
        <div class="arcade-play-chrome">
          <div class="flex justify-between items-center mb-0.5">
            <button onclick="exitArcadeGame()" class="text-white/70 hover:text-white text-sm">← The Starcade</button>
            <span class="text-xs sm:text-sm font-bold arcade-title-friendly">⭕ Tic-Tac-Toe</span>
          </div>
          <details class="arcade-howto-details">
            <summary>How to play ▾</summary>
            <p class="arcade-instructions text-white/85 text-center px-1">You are <strong>X</strong>. Computer is <strong>O</strong>. Tap a square and say it. Get <strong>3 in a row</strong>.</p>
          </details>
        </div>

        <div class="arcade-playfield">
          <div class="arcade-board w-full" style="width:min(96vw, calc(100dvh - 9rem)); max-width:520px;">
            <div class="grid grid-cols-3 gap-2 w-full mx-auto" style="max-height:min(82dvh, calc(100dvh - 10rem));">${board}</div>
          </div>
        </div>

        <div class="arcade-play-dock text-center">
          ${resultMessage ? `<div class="arcade-toast">${resultMessage}</div>` : ''}
          ${a.finished ? `
            ${points >= STARCADE_GAME_COST ? `<button onclick="launchArcadeGame('ttt', ${STARCADE_GAME_COST})" class="bg-gradient-to-r from-pink-500 to-purple-600 hover:scale-105 transition px-5 py-2 rounded-xl font-semibold mr-2">Play again (${STARCADE_GAME_COST} ⭐)</button>` : `<div class="text-white/60 text-sm mb-1 arcade-instructions">Earn more stars by playing reading games</div>`}
            <button onclick="exitArcadeGame()" class="bg-white/10 hover:bg-white/20 px-4 py-2 rounded-xl">The Starcade</button>
          ` : `<p class="arcade-instructions text-white/85 text-sm">${a.playerTurn ? 'Your turn. Tap a square.' : 'Wait. The computer is playing...'}</p>`}
        </div>
      </div>
    </div>`;
}

// ============================================================
// CONNECT 4
// ============================================================
const C4_ROWS = 6, C4_COLS = 7;

function c4DropRow(board, col) {
  for (let r = C4_ROWS - 1; r >= 0; r--) {
    if (!board[r][col]) return r;
  }
  return -1;
}
function c4CheckWin(board, player) {
  const dirs = [[0,1],[1,0],[1,1],[1,-1]];
  for (let r = 0; r < C4_ROWS; r++) {
    for (let c = 0; c < C4_COLS; c++) {
      if (board[r][c] !== player) continue;
      for (const [dr, dc] of dirs) {
        const cells = [[r,c]];
        for (let k = 1; k < 4; k++) {
          const nr = r + dr*k, nc = c + dc*k;
          if (nr < 0 || nr >= C4_ROWS || nc < 0 || nc >= C4_COLS) break;
          if (board[nr][nc] !== player) break;
          cells.push([nr,nc]);
        }
        if (cells.length === 4) return cells;
      }
    }
  }
  return null;
}
function c4BoardFull(board) { return board[0].every(c => c !== null); }
function c4Copy(board) { return board.map(r => [...r]); }

function c4AIMove(board) {
  for (let c = 0; c < C4_COLS; c++) {
    const r = c4DropRow(board, c);
    if (r === -1) continue;
    const test = c4Copy(board); test[r][c] = 'O';
    if (c4CheckWin(test, 'O')) return c;
  }
  for (let c = 0; c < C4_COLS; c++) {
    const r = c4DropRow(board, c);
    if (r === -1) continue;
    const test = c4Copy(board); test[r][c] = 'X';
    if (c4CheckWin(test, 'X')) return c;
  }
  if (Math.random() < 0.3) {
    const valid = [];
    for (let c = 0; c < C4_COLS; c++) if (c4DropRow(board, c) !== -1) valid.push(c);
    return valid.length ? valid[Math.floor(Math.random() * valid.length)] : -1;
  }
  const order = [3, 2, 4, 1, 5, 0, 6];
  for (const c of order) {
    if (c4DropRow(board, c) !== -1) {
      const r = c4DropRow(board, c);
      const test = c4Copy(board); test[r][c] = 'O';
      let bad = false;
      for (let c2 = 0; c2 < C4_COLS; c2++) {
        const r2 = c4DropRow(test, c2);
        if (r2 === -1) continue;
        const t2 = c4Copy(test); t2[r2][c2] = 'X';
        if (c4CheckWin(t2, 'X')) { bad = true; break; }
      }
      if (!bad) return c;
    }
  }
  for (const c of order) if (c4DropRow(board, c) !== -1) return c;
  return -1;
}

window.c4Drop = (col) => {
  const a = state.arcade;
  if (a.finished || !a.playerTurn) return;
  const row = c4DropRow(a.board, col);
  if (row === -1) return;
  sfxClick();
  if (a.cellItems[row] && a.cellItems[row][col]) speak(a.cellItems[row][col].value);

  a.board[row][col] = 'X';
  a.lastMove = [row, col];
  a.playerTurn = false;
  const win = c4CheckWin(a.board, 'X');
  if (win) { a.winner = 'X'; a.winCells = win; a.finished = true; setTimeout(()=>{ confetti(); }, 400); awardStarcadeWinBonus('c4-win'); render(); return; }
  if (c4BoardFull(a.board)) { a.finished = true; render(); return; }
  render();
  setTimeout(() => {
    const aiCol = c4AIMove(a.board);
    if (aiCol === -1) { a.finished = true; render(); return; }
    const aiRow = c4DropRow(a.board, aiCol);
    a.board[aiRow][aiCol] = 'O';
    a.lastMove = [aiRow, aiCol];
    const win2 = c4CheckWin(a.board, 'O');
    if (win2) { a.winner = 'O'; a.winCells = win2; a.finished = true; }
    else if (c4BoardFull(a.board)) { a.finished = true; }
    a.playerTurn = true;
    render();
  }, 2000);
};

function renderC4(app) {
  const a = state.arcade;
  const points = getPoints(state.selectedStudent);
  let resultMessage = '';
  if (a.finished) {
    if (a.winner === 'X') resultMessage = `<div class="text-2xl font-bold text-yellow-300 arcade-title-friendly">🎉 You won!</div>`;
    else if (a.winner === 'O') resultMessage = `<div class="text-xl font-bold text-white/80 arcade-instructions">The computer won. Try again!</div>`;
    else resultMessage = `<div class="text-xl font-bold text-white/80 arcade-instructions">It is a draw! 🤝</div>`;
  }

  let colBtns = '';
  for (let c = 0; c < C4_COLS; c++) {
    const canDrop = !a.finished && a.playerTurn && c4DropRow(a.board, c) !== -1;
    colBtns += `<button onclick="c4Drop(${c})" ${!canDrop ? 'disabled' : ''} class="h-full min-h-0 w-full ${canDrop ? 'bg-yellow-400/30 hover:bg-yellow-400/60 cursor-pointer text-yellow-200' : 'opacity-30 text-white/30'} rounded-md flex items-center justify-center text-sm sm:text-base transition">${canDrop ? '⬇' : '·'}</button>`;
  }

  let cells = '';
  for (let r = 0; r < C4_ROWS; r++) {
    for (let c = 0; c < C4_COLS; c++) {
      const v = a.board[r][c];
      const isWin = a.winCells && a.winCells.some(([wr, wc]) => wr === r && wc === c);
      const isLast = a.lastMove && a.lastMove[0] === r && a.lastMove[1] === c;
      const item = a.cellItems[r][c];
      const label = item ? item.value : '';
      let inner = '';
      if (v === 'X') {
        const pc = isWin ? 'bg-gradient-to-br from-yellow-300 to-red-500 ring-2 ring-yellow-300' : 'bg-gradient-to-br from-red-400 to-red-600';
        inner = `<div class="w-full h-full rounded-full ${pc} shadow-md ${isLast ? 'drop-anim' : ''} flex items-center justify-center text-white font-bold arcade-c4-piece-label px-0.5 text-center">${label}</div>`;
      } else if (v === 'O') {
        const pc = isWin ? 'bg-gradient-to-br from-yellow-300 to-amber-500 ring-2 ring-yellow-300' : 'bg-gradient-to-br from-yellow-300 to-yellow-500';
        inner = `<div class="w-full h-full rounded-full ${pc} shadow-md ${isLast ? 'drop-anim' : ''} flex items-center justify-center text-blue-900 font-bold arcade-c4-piece-label px-0.5 text-center">${label}</div>`;
      } else {
        inner = `<div class="w-full h-full rounded-full bg-blue-950/80 shadow-inner flex items-center justify-center text-white/50 font-semibold arcade-c4-piece-label arcade-c4-piece-label--ghost px-0.5 text-center">${label}</div>`;
      }
      cells += `<div class="arcade-c4-cell p-0.5">${inner}</div>`;
    }
  }

  const turnStatus = a.finished ? '' : (a.playerTurn
    ? 'Your turn. Tap an arrow to drop a piece.'
    : 'Wait. The computer is playing...');

  app.innerHTML = `
    <div class="arcade-screen p-1 sm:p-2 flex flex-col">
      <div class="arcade-wrap arcade-c4-wrap max-w-5xl mx-auto w-full arcade-play-shell">
        <div class="arcade-play-chrome">
          <div class="flex justify-between items-center mb-0.5">
            <button onclick="exitArcadeGame()" class="text-white/70 hover:text-white text-xs sm:text-sm">← The Starcade</button>
            <span class="text-sm font-bold arcade-title-friendly">🔴 Connect 4</span>
          </div>
          <details class="arcade-howto-details">
            <summary>How to play ▾</summary>
            <p class="arcade-instructions text-white/85 text-center px-1">You are <strong>Red</strong>. Computer is <strong>Yellow</strong>. Tap ⬇ to drop. Get <strong>4 in a row</strong>.</p>
          </details>
        </div>

        <div class="arcade-playfield arcade-board-area">
          <div class="arcade-board arcade-c4-board">
            <div class="arcade-c4-inner bg-blue-700 rounded-xl p-1 shadow-2xl">
              <div class="arcade-c4-drop-row grid grid-cols-7 gap-0.5">${colBtns}</div>
              <div class="arcade-c4-cell-grid grid grid-cols-7 grid-rows-6 gap-0.5 bg-blue-800 rounded-lg p-0.5">${cells}</div>
            </div>
          </div>
        </div>

        <div class="arcade-play-dock arcade-c4-status text-center">
          ${resultMessage ? `<div class="arcade-toast">${resultMessage}</div>` : ''}
          ${a.finished ? `
            ${points >= STARCADE_GAME_COST ? `<button onclick="launchArcadeGame('c4', ${STARCADE_GAME_COST})" class="bg-gradient-to-r from-red-500 to-orange-600 hover:scale-105 transition px-4 py-2 rounded-xl font-semibold text-sm mr-2">Play again (${STARCADE_GAME_COST} ⭐)</button>` : `<div class="text-white/60 text-sm mb-1 arcade-instructions">Earn more stars by playing reading games</div>`}
            <button onclick="exitArcadeGame()" class="bg-white/10 hover:bg-white/20 px-4 py-2 rounded-xl text-sm">The Starcade</button>
          ` : `<p class="arcade-instructions text-white/85 text-sm">${turnStatus}</p>`}
        </div>
      </div>
    </div>`;
}

// ============================================================
// TREASURE HUNTER (embedded — id slime for routing)
// ============================================================
function sendTreasureFocusWords() {
  const frame = document.getElementById('treasureFrame');
  if (!frame || !frame.contentWindow) return;
  try {
    frame.contentWindow.postMessage({
      type: 'treasure-focus-words',
      words: getFocusItems(state.selectedStudent)
    }, '*');
  } catch (e) {}
}

function restartTreasureGame() {
  const frame = document.getElementById('treasureFrame');
  if (frame && frame.contentWindow) {
    try { frame.contentWindow.postMessage({ type: 'treasure-restart' }, '*'); } catch (e) {}
  }
}

function renderTreasureHunter(app) {
  const points = getPoints(state.selectedStudent);
  if (window._treasureHandler) {
    window.removeEventListener('message', window._treasureHandler);
  }
  window._treasureHandler = (e) => {
    if (!e.data || !e.data.type) return;
    if (e.data.type === 'treasure-game-over') {
      if (e.data.allFound) confetti();
      if (typeof e.data.score === 'number' && e.data.score > TREASURE_SCORE_BONUS_THRESHOLD) {
        awardStarcadeWinBonus('treasure-score');
      }
    }
    if (e.data.type === 'treasure-speak' && e.data.word) speak(e.data.word);
    if (e.data.type === 'treasure-ready') sendTreasureFocusWords();
  };
  window.addEventListener('message', window._treasureHandler);

  app.innerHTML = `
    <div class="arcade-screen p-1 sm:p-2 flex flex-col">
      <div class="arcade-wrap arcade-treasure-wrap max-w-5xl mx-auto w-full arcade-play-shell">
        <div class="arcade-play-chrome">
          <div class="flex justify-between items-center mb-0.5">
            <button onclick="exitArcadeGame()" class="text-white/70 hover:text-white text-xs sm:text-sm">← The Starcade</button>
            <span class="text-sm font-bold arcade-title-friendly">🏴‍☠️ Treasure Hunter</span>
          </div>
          <details class="arcade-howto-details">
            <summary>How to play ▾</summary>
            <p class="arcade-instructions text-white/85 text-center px-1">Tap a tile to say the word. Numbers hint at treasure. Find <strong>3</strong> ⭐ tiles for <strong>+3 clicks</strong> each. You start with <strong>10 clicks</strong>.</p>
          </details>
        </div>

        <div class="arcade-playfield arcade-board-area">
          <iframe id="treasureFrame" src="../HTML games/TreasureHunter.html?embed=1" class="arcade-treasure-frame w-full h-full" title="Treasure Hunter game" allow="autoplay"></iframe>
        </div>

        <div class="arcade-play-dock arcade-treasure-status text-center flex gap-2 justify-center flex-wrap items-center">
          ${points >= STARCADE_GAME_COST ? `<button onclick="launchArcadeGame('slime', ${STARCADE_GAME_COST})" class="bg-gradient-to-r from-amber-500 to-yellow-600 hover:scale-105 transition px-4 py-2 rounded-xl font-semibold text-sm">Play again (${STARCADE_GAME_COST} ⭐)</button>` : ''}
          <button onclick="restartTreasureGame()" class="bg-white/10 hover:bg-white/20 px-4 py-2 rounded-xl text-sm">↻ New board</button>
          <button onclick="exitArcadeGame()" class="bg-white/10 hover:bg-white/20 px-4 py-2 rounded-xl text-sm">The Starcade</button>
        </div>
      </div>
    </div>`;

  const frame = document.getElementById('treasureFrame');
  if (frame) frame.onload = () => sendTreasureFocusWords();
}

// Confetti (visual only)
function confetti() {
  const colors = ['#f87171','#fbbf24','#34d399','#60a5fa','#a78bfa','#f472b6'];
  for (let i=0; i<30; i++) {
    const c = document.createElement('div');
    c.className = 'confetti';
    c.style.background = colors[i % colors.length];
    c.style.left = (Math.random()*100) + '%';
    c.style.animationDelay = (Math.random()*0.5) + 's';
    document.body.appendChild(c);
    setTimeout(() => c.remove(), 2500);
  }
}

applyHwSentenceCsvBatches();
applyLongVowelWordLists();

async function bootstrapAdventuresCore() {
  if (window.isDesktopAdventures && window.AdventuresDesktop) {
    await window.AdventuresDesktop.loadAllStudentProgress();
    const loaded = await window.AdventuresDesktop.tryAutoLoadClassData();
    if (loaded) {
      window.AdventuresDesktop.startClassDataWatch();
      const lead = $('upload-lead');
      if (lead && state.view !== 'upload') {
        lead.textContent = 'Connected to your shared class data folder. Games update when Assessment Tracker saves.';
      }
      render();
      return;
    }
    const lead = $('upload-lead');
    if (lead) {
      lead.textContent = 'No shared class data found yet. Open Assessment Tracker first, or choose a JSON backup file below.';
    }
  }
  render();
}

if (window.DrivePilot) { DrivePilot.start(); } else { bootstrapAdventuresCore(); }