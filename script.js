/* =========================================================
   BLACKJACK 4 - script.js
   made by hiro / ヒロ   https://github.com/h1ro223
   タイトル / シングル / オンライン(ルーム式) / アカウント・Lv / BGM・SE
   ========================================================= */
'use strict';

/* =========================================================
   1. 設定定数
   ========================================================= */

/* GitHub Pages など別ドメインから使う場合は、ここに Render の URL を入れる
   例: 'https://blackjack4.onrender.com'   同一サーバー配信なら空のままでOK */
const ONLINE_SERVER = '';

const DECK_COUNT      = 6;
const RESHUFFLE_RATIO = 0.25;
const INITIAL_MEDAL   = 1000;
const CPU_MEDAL       = 1000;
const CPU_REFILL      = 500;
const MIN_BET         = 10;
const DEALER_STAND    = 17;
const CPU_STAND       = 17;

const BGM_FILE     = './BGM.mp3';
const AD_FILES     = ['./ad/ad1.mp4', './ad/ad2.mp4', './ad/ad3.mp4'];
const AD_REWARD    = 100;
const AD_SKIP_SEC  = 5;
const AD_FULL_SEC  = 30;
const AD_SKIP_RATE = 0.95;

const DEAL_MS     = 240;
const CPU_THINK_MS = 620;
const REVEAL_MS   = 520;

const SUITS = [
  { mark: '♠', red: false }, { mark: '♥', red: true },
  { mark: '♦', red: true },  { mark: '♣', red: false }
];
const RANKS = ['A','2','3','4','5','6','7','8','9','10','J','Q','K'];
const CPU_NAMES = ['CPU ハル', 'CPU ミナ', 'CPU レオ'];

const EXP_TABLE = { round: 10, win: 25, bj: 40, push: 12, lose: 5 };
const expToNext = (lv) => 100 + (lv - 1) * 50;

/* =========================================================
   2. ストレージ(利用できない環境ではメモリに退避)
   ========================================================= */
const store = (() => {
  const mem = {};
  let ok = false;
  try {
    const k = '__bj4_test__';
    window.localStorage.setItem(k, '1');
    window.localStorage.removeItem(k);
    ok = true;
  } catch { ok = false; }

  return {
    get(key){
      try { return ok ? window.localStorage.getItem(key) : (mem[key] ?? null); }
      catch { return mem[key] ?? null; }
    },
    set(key, val){
      try { if (ok) window.localStorage.setItem(key, val); else mem[key] = val; }
      catch { mem[key] = val; }
    },
    del(key){
      try { if (ok) window.localStorage.removeItem(key); else delete mem[key]; }
      catch { delete mem[key]; }
    }
  };
})();

const settings = {
  bgmOn: store.get('bj4_bgmOn') !== '0',
  bgmVol: Number(store.get('bj4_bgmVol') ?? 100),
  seOn: store.get('bj4_seOn') !== '0',
  seVol: Number(store.get('bj4_seVol') ?? 100),
  seats: Number(store.get('bj4_seats') ?? 4)
};

function saveSettings(){
  store.set('bj4_bgmOn', settings.bgmOn ? '1' : '0');
  store.set('bj4_bgmVol', String(settings.bgmVol));
  store.set('bj4_seOn', settings.seOn ? '1' : '0');
  store.set('bj4_seVol', String(settings.seVol));
  store.set('bj4_seats', String(settings.seats));
}

/* =========================================================
   3. サウンド
   ========================================================= */
const audio = {
  ctx: null,
  master: null,
  bgmBus: null,
  started: false,

  init(){
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();

    /* SE用バス */
    this.master = this.ctx.createGain();
    this.master.gain.value = settings.seVol / 100;
    this.master.connect(this.ctx.destination);

    /* BGM用バス(HTMLAudioを使わないので iOS でも音量が効き、
       Now Playing / Dynamic Island にも表示されない) */
    this.bgmBus = this.ctx.createGain();
    this.bgmBus.gain.value = 0;
    this.bgmBus.connect(this.ctx.destination);
  },

  /* iOSは着信などで中断されるので都度復帰させる */
  resume(){
    if (!this.ctx) return;
    if (this.ctx.state === 'suspended' || this.ctx.state === 'interrupted'){
      const p = this.ctx.resume();
      if (p && p.catch) p.catch(() => {});
    }
  },

  unlock(){
    this.init();
    this.resume();
    this.started = true;
    bgm.apply();
  },

  setVolume(){
    if (this.master) this.master.gain.value = settings.seVol / 100;
  },

  /* 単音 */
  tone(freq, dur, type, gain, delay){
    if (!settings.seOn || !this.ctx) return;
    const t0 = this.ctx.currentTime + (delay || 0);
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type || 'sine';
    osc.frequency.setValueAtTime(freq, t0);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain || 0.2, t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g); g.connect(this.master);
    osc.start(t0); osc.stop(t0 + dur + 0.02);
  },

  /* ノイズ(カードを擦る音) */
  noise(dur, gain, hp){
    if (!settings.seOn || !this.ctx) return;
    const len = Math.floor(this.ctx.sampleRate * dur);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const f = this.ctx.createBiquadFilter();
    f.type = 'highpass';
    f.frequency.value = hp || 1400;
    const g = this.ctx.createGain();
    g.gain.value = gain || 0.18;
    src.connect(f); f.connect(g); g.connect(this.master);
    src.start();
  },

  play(name){
    if (!settings.seOn) return;
    this.init();
    if (!this.ctx) return;
    this.resume();

    switch (name){
      case 'deal':  this.noise(0.13, 0.16, 1800); this.tone(320, 0.07, 'triangle', 0.08); break;
      case 'chip':  this.tone(880, 0.05, 'square', 0.07); this.tone(1320, 0.06, 'square', 0.05, 0.03); break;
      case 'button':this.tone(520, 0.06, 'triangle', 0.1); break;
      case 'flip':  this.noise(0.18, 0.2, 1100); break;
      case 'win':   [523,659,784].forEach((f,i) => this.tone(f, 0.26, 'triangle', 0.16, i*0.075)); break;
      case 'bj':    [523,659,784,1047,1319].forEach((f,i) => this.tone(f, 0.4, 'sawtooth', 0.13, i*0.08)); break;
      case 'lose':  [392,330,262].forEach((f,i) => this.tone(f, 0.3, 'sine', 0.14, i*0.1)); break;
      case 'bust':  this.tone(180, 0.45, 'sawtooth', 0.16); this.noise(0.25, 0.12, 400); break;
      case 'push':  this.tone(440, 0.2, 'sine', 0.12); this.tone(440, 0.2, 'sine', 0.1, 0.16); break;
      case 'levelup': [659,784,988,1319].forEach((f,i) => this.tone(f, 0.5, 'triangle', 0.17, i*0.1)); break;
      case 'join':  this.tone(660, 0.1, 'triangle', 0.12); this.tone(990, 0.12, 'triangle', 0.1, 0.08); break;
      case 'error': this.tone(200, 0.22, 'square', 0.12); break;
    }
  }
};

/* decodeAudioData は Safari 系だと callback 形式しか無い場合があるので両対応 */
function decodeAudio(ctx, arrayBuffer){
  return new Promise((resolve, reject) => {
    let settled = false;
    const ok = (b) => { if (!settled){ settled = true; resolve(b); } };
    const ng = (e) => { if (!settled){ settled = true; reject(e); } };
    let ret;
    try { ret = ctx.decodeAudioData(arrayBuffer, ok, ng); }
    catch (e){ return ng(e); }
    if (ret && typeof ret.then === 'function') ret.then(ok, ng);
  });
}

/* BGM: HTMLAudioElement を使わず WebAudio で鳴らす。
   ・iOS は HTMLMediaElement.volume を無視するが GainNode なら効く
   ・Now Playing に載らないので Dynamic Island / ロック画面に出ない */
const bgm = {
  raw: null,        // 取得済みの圧縮データ
  buffer: null,     // デコード済み
  source: null,     // 再生中のノード
  ducked: false,
  failed: false,
  fetching: null,
  decoding: null,
  stopTimer: null,

  /* 音声ファイルの取得(AudioContext 不要なので先に走らせられる) */
  prefetch(){
    if (this.raw || this.buffer || this.failed) return Promise.resolve();
    if (this.fetching) return this.fetching;
    this.fetching = fetch(BGM_FILE, { cache: 'force-cache' })
      .then(res => { if (!res.ok) throw new Error('HTTP ' + res.status); return res.arrayBuffer(); })
      .then(buf => { this.raw = buf; })
      .catch(() => { this.failed = true; })
      .then(() => { this.fetching = null; renderBgmStatus(); });
    return this.fetching;
  },

  /* デコード(AudioContext が必要) */
  async prepare(){
    if (this.buffer) return this.buffer;
    if (this.failed || !audio.ctx) return null;
    if (this.decoding) return this.decoding;

    await this.prefetch();
    if (!this.raw || this.failed) return null;

    const data = this.raw;
    this.raw = null;   // decodeAudioData は渡した ArrayBuffer を detach する
    this.decoding = decodeAudio(audio.ctx, data)
      .then(b => { this.buffer = b; return b; })
      .catch(() => { this.failed = true; renderBgmStatus(); return null; })
      .then(b => { this.decoding = null; return b; });
    return this.decoding;
  },

  gainTarget(){
    if (!settings.bgmOn || this.failed) return 0;
    return (settings.bgmVol / 100) * (this.ducked ? 0.18 : 1);
  },

  /* 音量反映(スライダー操作でもプチノイズが出ないよう必ずランプさせる) */
  applyGain(fadeSec){
    const bus = audio.bgmBus;
    if (!bus || !audio.ctx) return;
    const now = audio.ctx.currentTime;
    const cur = bus.gain.value;
    bus.gain.cancelScheduledValues(now);
    bus.gain.setValueAtTime(cur, now);
    bus.gain.linearRampToValueAtTime(this.gainTarget(), now + (fadeSec == null ? 0.12 : fadeSec));
  },

  async start(){
    if (this.source || !settings.bgmOn) return;
    audio.init();
    const buf = await this.prepare();
    if (!buf) return;
    if (!settings.bgmOn || this.source) return;   // 待っている間に切られた場合

    clearTimeout(this.stopTimer);
    const src = audio.ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    src.connect(audio.bgmBus);
    src.start(0);
    this.source = src;

    audio.bgmBus.gain.cancelScheduledValues(audio.ctx.currentTime);
    audio.bgmBus.gain.setValueAtTime(0.0001, audio.ctx.currentTime);
    this.applyGain(0.9);
  },

  stop(){
    this.applyGain(0.35);
    const src = this.source;
    this.source = null;
    if (!src) return;
    clearTimeout(this.stopTimer);
    this.stopTimer = setTimeout(() => {
      try { src.stop(); src.disconnect(); } catch {}
    }, 420);
  },

  apply(){
    if (!audio.started) return;   // 初回操作前はブラウザに弾かれるので何もしない
    audio.init();
    audio.resume();
    if (settings.bgmOn){
      if (this.source) this.applyGain();
      else this.start();
    } else {
      this.stop();
    }
  },

  duck(on){
    this.ducked = on;
    if (this.source) this.applyGain(0.25);
  }
};

/* =========================================================
   4. DOM参照
   ========================================================= */
const $ = (id) => document.getElementById(id);

const el = {
  body: document.body,
  brandBtn: $('brandBtn'),
  medalReadout: $('medalReadout'),
  medalLabel: $('medalLabel'),
  medalCount: $('medalCount'),
  adBtn: $('adBtn'),
  menuBtn: $('menuBtn'),
  accountBtn: $('accountBtn'),
  accountAvatar: $('accountAvatar'),
  accountLv: $('accountLv'),
  leaveBtn: $('leaveBtn'),
  gameRulesBtn: $('gameRulesBtn'),

  roundChip: $('roundChip'),
  roundNow: $('roundNow'),
  roundMax: $('roundMax'),

  fxLayer: $('fxLayer'),
  fxText: $('fxText'),
  fxBurst: $('fxBurst'),

  chatFab: $('chatFab'),
  chatBadge: $('chatBadge'),
  chatPanel: $('chatPanel'),
  chatCloseBtn: $('chatCloseBtn'),
  chatLog: $('chatLog'),
  chatStamps: $('chatStamps'),
  chatInput: $('chatInput'),
  chatSendBtn: $('chatSendBtn'),
  chatFloat: $('chatFloat'),

  screenTitle: $('screenTitle'),
  screenLobby: $('screenLobby'),
  screenRoom: $('screenRoom'),
  screenCountdown: $('screenCountdown'),
  screenChampionEnd: $('screenChampionEnd'),
  screenGame: $('screenGame'),

  toSingleBtn: $('toSingleBtn'),
  toOnlineBtn: $('toOnlineBtn'),
  toRulesBtn: $('toRulesBtn'),
  toSettingsBtn: $('toSettingsBtn'),
  changelogBtn: $('changelogBtn'),
  changelogOverlay: $('changelogOverlay'),
  changelogCloseBtn: $('changelogCloseBtn'),

  lobbyBackBtn: $('lobbyBackBtn'),
  connBadge: $('connBadge'),
  createModeSeg: $('createModeSeg'),
  createModeDesc: $('createModeDesc'),
  createSeg: $('createSeg'),
  createCpuRow: $('createCpuRow'),
  createCpuCheck: $('createCpuCheck'),
  createChampRow: $('createChampRow'),
  champRoundSeg: $('champRoundSeg'),
  champRoundCustom: $('champRoundCustom'),
  createRoomBtn: $('createRoomBtn'),
  refreshRoomsBtn: $('refreshRoomsBtn'),
  roomList: $('roomList'),
  joinIdInput: $('joinIdInput'),
  joinIdBtn: $('joinIdBtn'),

  roomLeaveBtn: $('roomLeaveBtn'),
  roomCountBadge: $('roomCountBadge'),
  roomModeBadge: $('roomModeBadge'),
  roomIdText: $('roomIdText'),
  copyIdBtn: $('copyIdBtn'),
  roomCpuRow: $('roomCpuRow'),
  roomCpuCheck: $('roomCpuCheck'),
  memberList: $('memberList'),
  roomHint: $('roomHint'),
  startGameBtn: $('startGameBtn'),

  countdownCap: $('countdownCap'),
  countdownNum: $('countdownNum'),

  standingsList: $('standingsList'),
  championBackBtn: $('championBackBtn'),

  dealerCards: $('dealerCards'),
  dealerTotal: $('dealerTotal'),
  messageText: $('messageText'),
  aiRow: $('aiRow'),
  humanWrap: $('humanWrap'),

  controls: $('controls'),
  betPanel: $('betPanel'),
  betValue: $('betValue'),
  betClearBtn: $('betClearBtn'),
  betMaxBtn: $('betMaxBtn'),
  dealBtn: $('dealBtn'),
  actionPanel: $('actionPanel'),
  hitBtn: $('hitBtn'),
  standBtn: $('standBtn'),
  surrenderBtn: $('surrenderBtn'),
  nextPanel: $('nextPanel'),
  nextBtn: $('nextBtn'),
  waitPanel: $('waitPanel'),
  waitText: $('waitText'),

  surrenderOverlay: $('surrenderOverlay'),
  surrenderCancelBtn: $('surrenderCancelBtn'),
  surrenderConfirmBtn: $('surrenderConfirmBtn'),

  adOverlay: $('adOverlay'),
  adVideo: $('adVideo'),
  adFallback: $('adFallback'),
  adTimer: $('adTimer'),
  adProgress: $('adProgressBar'),
  adSoundBtn: $('adSoundBtn'),
  adCloseBtn: $('adCloseBtn'),

  accountOverlay: $('accountOverlay'),
  accountCloseBtn: $('accountCloseBtn'),
  accountTitle: $('accountTitle'),
  authView: $('authView'),
  authTabs: $('authTabs'),
  authNote: $('authNote'),
  authName: $('authName'),
  authPass: $('authPass'),
  authError: $('authError'),
  authSubmitBtn: $('authSubmitBtn'),
  profileView: $('profileView'),
  profileAvatar: $('profileAvatar'),
  profileName: $('profileName'),
  profileLevel: $('profileLevel'),
  expText: $('expText'),
  expFill: $('expFill'),
  profileMedal: $('profileMedal'),
  stRounds: $('stRounds'),
  stWin: $('stWin'),
  stLose: $('stLose'),
  stPush: $('stPush'),
  stBj: $('stBj'),
  stRate: $('stRate'),
  champPlays: $('champPlays'),
  champWins: $('champWins'),
  champLosses: $('champLosses'),
  champDraws: $('champDraws'),
  champRate: $('champRate'),
  logoutBtn: $('logoutBtn'),
  showDeleteBtn: $('showDeleteBtn'),
  deleteBox: $('deleteBox'),
  deletePass: $('deletePass'),
  deleteError: $('deleteError'),
  deleteCancelBtn: $('deleteCancelBtn'),
  deleteConfirmBtn: $('deleteConfirmBtn'),

  rulesOverlay: $('rulesOverlay'),
  rulesCloseBtn: $('rulesCloseBtn'),

  settingsOverlay: $('settingsOverlay'),
  settingsCloseBtn: $('settingsCloseBtn'),
  bgmSwitch: $('bgmSwitch'),
  bgmVol: $('bgmVol'),
  bgmVolText: $('bgmVolText'),
  seSwitch: $('seSwitch'),
  seVol: $('seVol'),
  seVolText: $('seVolText'),
  seatSeg: $('seatSeg'),
  resetBtn: $('resetBtn'),

  bgmStatus: $('bgmStatus'),

  toast: $('toast'),
  toastText: $('toastText'),
  levelUp: $('levelUp'),
  levelUpNum: $('levelUpNum')
};

/* =========================================================
   5. 共通状態
   ========================================================= */
const view = {
  mode: 'single',        // single | online
  onlineMode: 'enjoy',   // enjoy | champion (online時のみ有効)
  phase: 'bet',
  dealer: { hand: [], hole: true },
  seats: [],             // {name, level, medal, bet, hand, result, isYou, active, ready, cpu, eliminated}
  message: '',
  tone: ''
};

const account = { token: store.get('bj4_token') || '', user: null };
let guestMedal = Number(store.get('bj4_guestMedal') ?? INITIAL_MEDAL);

let screen = 'title';
let bet = 0;
const shownCount = new Map();   // 配布アニメーション用

/* =========================================================
   6. ユーティリティ
   ========================================================= */
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);
const randInt = (n) => Math.floor(Math.random() * n);
const esc = (s) => String(s).replace(/[&<>"']/g, c =>
  ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));

let toastTimer = null;
function toast(text){
  el.toastText.textContent = text;
  el.toast.hidden = false;
  el.toast.style.animation = 'none';
  void el.toast.offsetWidth;
  el.toast.style.animation = '';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.toast.hidden = true; }, 2400);
}

function ledTick(node){
  node.classList.remove('tick');
  void node.offsetWidth;
  node.classList.add('tick');
}

function setMessage(text, tone){
  view.message = text;
  view.tone = tone || '';
  el.messageText.textContent = text;
  el.messageText.className = view.tone;
}

/* =========================================================
   7. カード / 手札
   ========================================================= */
let shoe = [];
let shoeSize = 0;

function buildShoe(){
  const s = [];
  for (let d = 0; d < DECK_COUNT; d++)
    for (const su of SUITS)
      for (const r of RANKS)
        s.push({ rank: r, mark: su.mark, red: su.red });
  for (let i = s.length - 1; i > 0; i--){
    const j = randInt(i + 1);
    [s[i], s[j]] = [s[j], s[i]];
  }
  shoe = s;
  shoeSize = s.length;
}

function drawCard(){
  if (shoe.length === 0) buildShoe();
  return shoe.pop();
}

function cardPoint(rank){
  if (rank === 'A') return 11;
  if (rank === 'J' || rank === 'Q' || rank === 'K') return 10;
  return Number(rank);
}

function handValue(hand){
  let total = 0, aces = 0;
  for (const c of hand){
    if (!c) continue;
    total += cardPoint(c.rank);
    if (c.rank === 'A') aces++;
  }
  while (total > 21 && aces > 0){ total -= 10; aces--; }
  return { total, soft: aces > 0, bust: total > 21 };
}

function isBlackjack(hand){
  return hand.length === 2 && hand.every(Boolean) && handValue(hand).total === 21;
}

/* =========================================================
   8. 描画
   ========================================================= */
function createCardEl(card, faceDown, animate){
  const node = document.createElement('div');
  if (faceDown || !card){
    node.className = 'card back';
  } else {
    node.className = 'card' + (card.red ? ' red' : '');
    node.innerHTML =
      '<span class="rank">' + card.rank + '</span>' +
      '<span class="suit-lg">' + card.mark + '</span>';
  }
  if (animate) requestAnimationFrame(() => node.classList.add('in'));
  else node.classList.add('in');
  return node;
}

function trackShown(key, len){
  const prev = shownCount.get(key) || 0;
  const base = len < prev ? 0 : prev;
  shownCount.set(key, len);
  return base;
}

function renderDealer(){
  el.body.dataset.phase = view.phase;
  el.dealerCards.innerHTML = '';

  const hand = view.dealer.hand;
  const base = trackShown('__dealer__', hand.length);
  const flip = view.dealer.hole === false && shownCount.get('__hole__') !== 'open';
  shownCount.set('__hole__', view.dealer.hole ? 'closed' : 'open');

  hand.forEach((card, i) => {
    const hidden = view.dealer.hole && i === 1;
    el.dealerCards.appendChild(createCardEl(card, hidden, i >= base || (flip && i === 1)));
  });

  el.dealerTotal.className = 'total-num led';
  if (hand.length === 0){ el.dealerTotal.textContent = '--'; return; }

  if (view.dealer.hole){
    el.dealerTotal.textContent = handValue([hand[0]]).total + '+';
    return;
  }
  const v = handValue(hand);
  el.dealerTotal.textContent = v.total;
  if (v.bust) el.dealerTotal.classList.add('is-bust');
  else if (isBlackjack(hand)) el.dealerTotal.classList.add('is-bj');
}

function seatMarkup(seat){
  const v = handValue(seat.hand);
  const scoreText = seat.hand.length ? v.total : '--';

  let scoreClass = 'total-num led';
  if (seat.hand.length){
    if (v.bust) scoreClass += ' is-bust';
    else if (isBlackjack(seat.hand)) scoreClass += ' is-bj';
  }

  let tag = '';
  if (seat.eliminated){
    tag = '<span class="result-badge" data-r="lose">脱落・観戦中</span>';
  } else if (seat.result){
    tag = '<span class="result-badge" data-r="' + seat.result.kind + '">' + seat.result.label + '</span>';
  } else if (view.mode === 'online' && view.phase === 'bet' && seat.ready){
    tag = '<span class="result-badge" data-r="push">READY</span>';
  }

  const lv = seat.level ? '<span class="member-lv">Lv.' + seat.level + '</span>' : '';
  const medalLabel = (view.mode === 'online' && view.onlineMode === 'champion') ? '大会メダル' : 'メダル';

  return '' +
    '<div class="seat-top">' +
      '<span class="seat-label">' + esc(seat.name) + ' ' + lv + '</span>' +
      '<div class="total-box">' +
        '<span class="total-cap">合計</span>' +
        '<span class="' + scoreClass + '">' + scoreText + '</span>' +
      '</div>' +
    '</div>' +
    '<div class="cards"></div>' +
    tag +
    '<div class="seat-meta">' +
      '<span class="meta-chip is-bet"><span class="meta-key">ベット</span>' +
        '<span class="meta-val">' + seat.bet + '</span></span>' +
      '<span class="meta-chip"><span class="meta-key">' + medalLabel + '</span>' +
        '<span class="meta-val">' + seat.medal + '</span></span>' +
    '</div>';
}

function renderSeats(){
  el.body.dataset.phase = view.phase;
  el.aiRow.innerHTML = '';
  el.humanWrap.innerHTML = '';

  view.seats.forEach((seat) => {
    const box = document.createElement('div');
    box.className = 'seat' + (seat.isYou ? ' is-human' : '');
    if (seat.active) box.classList.add('is-active');
    if (seat.eliminated) box.classList.add('is-out');
    box.innerHTML = seatMarkup(seat);

    const cardsBox = box.querySelector('.cards');
    const base = trackShown('seat:' + seat.name, seat.hand.length);
    seat.hand.forEach((card, i) => cardsBox.appendChild(createCardEl(card, false, i >= base)));

    if (seat.isYou) el.humanWrap.appendChild(box);
    else el.aiRow.appendChild(box);
  });
}

function renderTable(){
  renderDealer();
  renderSeats();
}

function myMedal(){
  return account.user ? account.user.medal : guestMedal;
}

function renderMedal(){
  if (view.mode === 'online' && view.onlineMode === 'champion'){
    const me = view.seats.find(s => s.isYou);
    el.medalCount.textContent = me ? me.medal : 0;
  } else {
    el.medalCount.textContent = myMedal();
  }
  ledTick(el.medalCount);
  if (el.medalLabel){
    el.medalLabel.textContent = (view.mode === 'online' && view.onlineMode === 'champion') ? '大会メダル' : '所持メダル';
  }
}

function betCap(){
  if (view.mode === 'online' && view.onlineMode === 'champion'){
    const me = view.seats.find(s => s.isYou);
    return me ? me.medal : 0;
  }
  return myMedal();
}

function renderBet(){
  el.betValue.textContent = bet;
  const medal = betCap();
  el.betClearBtn.disabled = bet === 0;
  el.betMaxBtn.disabled = medal < MIN_BET;
  el.dealBtn.disabled = bet < MIN_BET;
  document.querySelectorAll('.chip').forEach((chip) => {
    chip.disabled = Number(chip.dataset.chip) > medal - bet;
  });
}

function showPanel(name){
  if (!el.chatFab.hidden){
    requestAnimationFrame(anchorFabAboveControls);
    setTimeout(anchorFabAboveControls, 140);   // レイアウト確定後にもう一度合わせる
  }
  el.betPanel.hidden    = name !== 'bet';
  el.actionPanel.hidden = name !== 'action';
  el.nextPanel.hidden   = name !== 'next';
  el.waitPanel.hidden   = name !== 'wait';
  el.controls.hidden    = (screen !== 'game') || name === 'none';
}

/* =========================================================
   9. 画面遷移
   ========================================================= */
function showScreen(name){
  screen = name;
  el.body.dataset.screen = name;
  el.screenTitle.hidden = name !== 'title';
  el.screenLobby.hidden = name !== 'lobby';
  el.screenRoom.hidden  = name !== 'room';
  el.screenCountdown.hidden = name !== 'countdown';
  el.screenChampionEnd.hidden = name !== 'championEnd';
  el.screenGame.hidden  = name !== 'game';

  el.controls.hidden = name !== 'game';
  el.adBtn.hidden = !(name === 'game' && !(view.mode === 'online' && view.onlineMode === 'champion'));
  el.medalReadout.hidden = !(name === 'game' || account.user);
  el.brandBtn.disabled = name === 'title';

  updateRoundChip();
  updateChatVisibility();
  window.scrollTo(0, 0);
}

function updateRoundChip(){
  const champ = view.mode === 'online' && view.onlineMode === 'champion' && online.state;
  if (!champ || screen !== 'game'){
    el.roundChip.hidden = true;
    return;
  }
  el.roundChip.hidden = false;
  const now = Math.max(online.state.round || 0, 1);
  el.roundNow.textContent = now;
  el.roundMax.textContent = online.state.championRounds || '-';
}

/* =========================================================
   10. アカウント
   ========================================================= */
function apiBase(){
  if (ONLINE_SERVER) return ONLINE_SERVER.replace(/\/+$/, '');
  if (location.protocol === 'http:' || location.protocol === 'https:') return location.origin;
  return '';
}

async function api(path, options){
  const base = apiBase();
  if (!base) throw new Error('サーバーに接続できません(オフラインで開いています)');
  const opt = Object.assign({ headers: {} }, options || {});
  opt.headers['Content-Type'] = 'application/json';
  if (account.token) opt.headers['Authorization'] = 'Bearer ' + account.token;
  const res = await fetch(base + path, opt);
  let data = {};
  try { data = await res.json(); } catch {}
  if (!res.ok) throw new Error(data.error || '通信エラー (' + res.status + ')');
  return data;
}

function setAccount(user, token){
  account.user = user;
  if (token){ account.token = token; store.set('bj4_token', token); }
  renderAccountUi();
}

function clearAccount(){
  account.user = null;
  account.token = '';
  store.del('bj4_token');
  renderAccountUi();
}

function renderAccountUi(){
  const u = account.user;
  if (u){
    el.accountBtn.classList.add('is-in');
    el.accountAvatar.textContent = u.username.charAt(0).toUpperCase();
    el.accountLv.textContent = 'Lv.' + u.level;
    el.accountLv.hidden = false;
  } else {
    el.accountBtn.classList.remove('is-in');
    el.accountAvatar.textContent = '?';
    el.accountLv.hidden = true;
  }
  el.medalReadout.hidden = !(screen === 'game' || u);
  renderMedal();
  renderProfile();
}

function renderProfile(){
  const u = account.user;
  el.authView.hidden = !!u;
  el.profileView.hidden = !u;
  el.accountTitle.textContent = u ? 'マイページ' : 'アカウント';
  el.deleteBox.hidden = true;
  el.deletePass.value = '';
  el.deleteError.hidden = true;
  if (!u) return;

  el.profileAvatar.textContent = u.username.charAt(0).toUpperCase();
  el.profileName.textContent = u.username;
  el.profileLevel.textContent = 'Lv.' + u.level;
  el.profileMedal.textContent = u.medal;

  const need = u.expNext || expToNext(u.level);
  el.expText.textContent = u.exp + ' / ' + need;
  el.expFill.style.width = clamp((u.exp / need) * 100, 0, 100) + '%';

  el.stRounds.textContent = u.rounds;
  el.stWin.textContent = u.wins;
  el.stLose.textContent = u.losses;
  el.stPush.textContent = u.pushes;
  el.stBj.textContent = u.bj;
  const decided = u.wins + u.losses;
  el.stRate.textContent = decided ? Math.round((u.wins / decided) * 100) + '%' : '0%';

  const cp = u.champPlays || 0, cw = u.champWins || 0, cl = u.champLosses || 0, cd = u.champDraws || 0;
  el.champPlays.textContent = cp;
  el.champWins.textContent = cw;
  el.champLosses.textContent = cl;
  el.champDraws.textContent = cd;
  const champDecided = cw + cl;
  el.champRate.textContent = champDecided ? Math.round((cw / champDecided) * 100) + '%' : '0%';
}

/* =========================================================
   10.5 演出(画面中央のカットイン)
   ========================================================= */
const FX_LABEL = {
  hit:       'HIT!',
  stand:     'STAND',
  bust:      'BUST!',
  win:       'WIN!',
  lose:      'LOSE',
  push:      'PUSH',
  surrender: 'SURRENDER',
  blackjack: 'BLACKJACK!!'
};

const SPARK_COLORS = ['#FFC94A', '#FFF2C0', '#E0A21C', '#FFFFFF', '#5BE0AC'];
let fxTimer = null;

function showFx(type, label){
  const text = label || FX_LABEL[type];
  if (!text || !el.fxText) return;

  clearTimeout(fxTimer);
  el.fxLayer.querySelectorAll('.fx-spark').forEach(n => n.remove());

  el.fxText.textContent = text;
  el.fxText.dataset.fx = type;
  el.fxBurst.dataset.fx = type;

  /* アニメーションを確実に再生し直す */
  el.fxText.classList.remove('is-on');
  el.fxBurst.classList.remove('is-on');
  void el.fxText.offsetWidth;
  el.fxText.classList.add('is-on');
  el.fxBurst.classList.add('is-on');

  if (type === 'blackjack') spawnSparks(46);
  else if (type === 'win') spawnSparks(18);

  const dur = type === 'blackjack' ? 2000 : 900;
  fxTimer = setTimeout(() => {
    el.fxText.classList.remove('is-on');
    el.fxBurst.classList.remove('is-on');
  }, dur);
}

function spawnSparks(count){
  const frag = document.createDocumentFragment();
  for (let i = 0; i < count; i++){
    const s = document.createElement('span');
    s.className = 'fx-spark';
    const angle = Math.random() * Math.PI * 2;
    const dist = 120 + Math.random() * 320;
    s.style.setProperty('--sx', Math.cos(angle) * dist + 'px');
    s.style.setProperty('--sy', Math.sin(angle) * dist + 'px');
    s.style.setProperty('--sr', (Math.random() * 720 - 360) + 'deg');
    s.style.background = SPARK_COLORS[randInt(SPARK_COLORS.length)];
    s.style.animationDelay = (Math.random() * 0.18).toFixed(2) + 's';
    s.style.width = s.style.height = (6 + Math.random() * 8).toFixed(0) + 'px';
    frag.appendChild(s);
  }
  el.fxLayer.appendChild(frag);
  setTimeout(() => el.fxLayer.querySelectorAll('.fx-spark').forEach(n => n.remove()), 1800);
}

/* 精算結果の種類から演出を出す(自分の結果のみ) */
function showResultFx(kind){
  if (kind === 'bj') showFx('blackjack');
  else if (kind === 'win') showFx('win');
  else if (kind === 'push') showFx('push');
  else if (kind === 'surrender') showFx('surrender');
  else showFx('lose');
}

function showLevelUp(level){
  el.levelUpNum.textContent = level;
  el.levelUp.hidden = false;
  audio.play('levelup');
  setTimeout(() => { el.levelUp.hidden = true; }, 1700);
}

async function restoreSession(){
  if (!account.token || !apiBase()) return;
  try {
    const d = await api('/api/me');
    setAccount(d.user);
  } catch { clearAccount(); }
}

let authMode = 'login';

function setAuthMode(mode){
  authMode = mode;
  el.authTabs.querySelectorAll('.seg-btn').forEach(b =>
    b.classList.toggle('is-on', b.dataset.tab === mode));
  el.authSubmitBtn.textContent = mode === 'login' ? 'ログイン' : 'アカウントを作成';
  el.authNote.textContent = mode === 'login'
    ? '登録済みのユーザー名とパスワードを入力してください。'
    : 'アカウントを作るとメダル・戦績・レベルが保存され、オンライン対戦に参加できます。初期メダルは1000枚です。';
  el.authError.hidden = true;
  el.authPass.setAttribute('autocomplete', mode === 'login' ? 'current-password' : 'new-password');
}

function authError(msg){
  el.authError.textContent = msg;
  el.authError.hidden = false;
  audio.play('error');
}

async function submitAuth(){
  const username = el.authName.value.trim();
  const password = el.authPass.value;
  if (!/^[A-Za-z0-9]{1,8}$/.test(username)) return authError('ユーザー名は英数字1〜8文字で入力してください');
  if (!/^[A-Za-z0-9]{1,8}$/.test(password)) return authError('パスワードは英数字1〜8文字で入力してください');

  el.authSubmitBtn.disabled = true;
  el.authError.hidden = true;
  try {
    const d = await api('/api/' + (authMode === 'login' ? 'login' : 'register'), {
      method: 'POST',
      body: JSON.stringify({ username, password })
    });
    setAccount(d.user, d.token);
    el.authPass.value = '';
    audio.play('join');
    toast(authMode === 'login' ? 'おかえりなさい、' + d.user.username + ' さん' : 'アカウントを作成しました');
    closeOverlay(el.accountOverlay);
  } catch (e){
    authError(e.message);
  } finally {
    el.authSubmitBtn.disabled = false;
  }
}

function deleteError(msg){
  el.deleteError.textContent = msg;
  el.deleteError.hidden = false;
  audio.play('error');
}

async function submitDeleteAccount(){
  const password = el.deletePass.value;
  if (!password) return deleteError('パスワードを入力してください');

  el.deleteConfirmBtn.disabled = true;
  el.deleteError.hidden = true;
  try {
    await api('/api/account', { method: 'DELETE', body: JSON.stringify({ password }) });
    if (online.socket){ online.socket.disconnect(); online.socket = null; }
    clearAccount();
    closeOverlay(el.accountOverlay);
    toast('アカウントを削除しました');
    if (screen !== 'title') showScreen('title');
  } catch (e){
    deleteError(e.message);
  } finally {
    el.deleteConfirmBtn.disabled = false;
  }
}

/* =========================================================
   11. シングルプレイ
   ========================================================= */
const single = { busy: false, activeIndex: -1, resolveTurn: null };

function makeSingleSeats(count){
  const prev = new Map(view.seats.map(s => [s.name, s.medal]));
  const seats = [{
    name: account.user ? account.user.username : 'あなた',
    level: account.user ? account.user.level : 0,
    medal: myMedal(), bet: 0, hand: [], result: null,
    isYou: true, active: false, cpu: false, done: false, playing: false
  }];
  for (let i = 1; i < count; i++){
    const name = CPU_NAMES[i - 1];
    seats.push({
      name, level: 0,
      medal: prev.has(name) ? prev.get(name) : CPU_MEDAL,
      bet: 0, hand: [], result: null,
      isYou: false, active: false, cpu: true, done: false, playing: false
    });
  }
  view.seats = seats;
}

function startSingle(){
  view.mode = 'single';
  buildShoe();
  shownCount.clear();
  makeSingleSeats(settings.seats);
  showScreen('game');
  singleBetPhase();
}

function singleBetPhase(){
  view.phase = 'bet';
  view.dealer = { hand: [], hole: true };
  single.busy = false;
  single.activeIndex = -1;
  bet = 0;
  shownCount.clear();

  if (view.seats.length !== settings.seats) makeSingleSeats(settings.seats);

  view.seats.forEach(s => {
    s.hand = []; s.bet = 0; s.result = null; s.done = false; s.playing = false; s.active = false; s.surrendered = false;
    if (s.cpu && s.medal < MIN_BET) s.medal = CPU_REFILL;
  });
  view.seats[0].medal = myMedal();
  view.seats[0].name = account.user ? account.user.username : 'あなた';
  view.seats[0].level = account.user ? account.user.level : 0;

  renderTable();
  renderMedal();
  renderBet();
  showPanel('bet');
  el.dealBtn.textContent = 'カードを配る';

  if (myMedal() < MIN_BET){
    setMessage('メダルが足りません。広告を見て ' + AD_REWARD + ' メダルを受け取れます。', 'alert');
  } else {
    setMessage('ベット額を決めてください');
  }
}

async function singleDeal(){
  if (single.busy || view.phase !== 'bet' || bet < MIN_BET) return;
  single.busy = true;
  view.phase = 'deal';
  showPanel('none');

  if (shoe.length < shoeSize * RESHUFFLE_RATIO){ buildShoe(); toast('山札をシャッフルしました'); }

  const me = view.seats[0];
  me.bet = bet;
  me.medal -= bet;
  me.playing = true;

  view.seats.forEach(s => {
    if (!s.cpu) return;
    const opts = [10, 50, 100, 500].filter(v => v <= s.medal);
    const pick = opts.length ? opts[randInt(opts.length)] : MIN_BET;
    s.bet = pick; s.medal -= pick; s.playing = true;
  });

  renderTable();
  setMessage('カードを配っています…');

  for (let round = 0; round < 2; round++){
    for (const s of view.seats){
      s.hand.push(drawCard());
      audio.play('deal');
      renderTable();
      await sleep(DEAL_MS);
    }
    view.dealer.hand.push(drawCard());
    audio.play('deal');
    renderDealer();
    await sleep(DEAL_MS);
  }

  view.seats.forEach(s => { if (isBlackjack(s.hand)) s.done = true; });

  if (isBlackjack(view.dealer.hand)){
    setMessage('ディーラーがブラックジャック!', 'alert');
    await sleep(REVEAL_MS);
    view.dealer.hole = false;
    audio.play('flip');
    renderDealer();
    await sleep(REVEAL_MS);
    return singleSettle();
  }

  await singlePlaySeats();
}

async function singlePlaySeats(){
  view.phase = 'play';

  for (let i = 0; i < view.seats.length; i++){
    const seat = view.seats[i];
    if (seat.done) continue;
    single.activeIndex = i;
    view.seats.forEach((s, k) => { s.active = k === i; });
    renderTable();

    if (seat.isYou){
      single.busy = false;
      showPanel('action');
      updateActionButtons();
      setMessage('ヒットするか、スタンドするか選んでください');
      await new Promise(res => { single.resolveTurn = () => { single.resolveTurn = null; seat.done = true; res(); }; });
      single.busy = true;
      showPanel('none');
    } else {
      setMessage(seat.name + ' の番です');
      await singleCpuTurn(seat);
    }
  }

  single.activeIndex = -1;
  view.seats.forEach(s => { s.active = false; });
  renderTable();
  await singleDealerTurn();
}

function updateActionButtons(){
  const seat = view.seats[single.activeIndex];
  const off = single.busy || !seat || seat.done;
  el.hitBtn.disabled = off;
  el.standBtn.disabled = off;
  const canSurrender = !!seat && seat.hand.length === 2 && !seat.done;
  el.surrenderBtn.hidden = !canSurrender;
  el.surrenderBtn.disabled = off;
}

async function singleHit(){
  if (view.phase !== 'play' || single.busy) return;
  const seat = view.seats[single.activeIndex];
  if (!seat || !seat.isYou || seat.done) return;

  single.busy = true;
  updateActionButtons();
  showFx('hit');
  seat.hand.push(drawCard());
  audio.play('deal');
  renderTable();
  await sleep(DEAL_MS);

  const v = handValue(seat.hand);
  single.busy = false;

  if (v.bust){
    audio.play('bust');
    showFx('bust');
    setMessage('バースト! ' + v.total, 'alert');
    await sleep(REVEAL_MS);
    if (single.resolveTurn) single.resolveTurn();
    return;
  }
  if (v.total === 21){
    setMessage('21! 自動でスタンドします', 'good');
    await sleep(REVEAL_MS);
    if (single.resolveTurn) single.resolveTurn();
    return;
  }
  updateActionButtons();
}

function singleStand(){
  if (view.phase !== 'play' || single.busy) return;
  const seat = view.seats[single.activeIndex];
  if (!seat || !seat.isYou || seat.done) return;
  audio.play('button');
  showFx('stand');
  el.hitBtn.disabled = true;
  el.standBtn.disabled = true;
  el.surrenderBtn.disabled = true;
  if (single.resolveTurn) single.resolveTurn();
}

function singleSurrender(){
  if (view.phase !== 'play' || single.busy) return;
  const seat = view.seats[single.activeIndex];
  if (!seat || !seat.isYou || seat.done || seat.hand.length !== 2) return;
  audio.play('button');
  showFx('surrender');
  el.hitBtn.disabled = true;
  el.standBtn.disabled = true;
  el.surrenderBtn.disabled = true;
  seat.surrendered = true;
  if (single.resolveTurn) single.resolveTurn();
}

async function singleCpuTurn(seat){
  await sleep(CPU_THINK_MS);
  while (true){
    const v = handValue(seat.hand);
    if (v.bust || v.total >= CPU_STAND) break;
    seat.hand.push(drawCard());
    audio.play('deal');
    renderTable();
    await sleep(CPU_THINK_MS);
  }
  const v = handValue(seat.hand);
  setMessage(seat.name + ' は ' + (v.bust ? 'バースト' : 'スタンド (' + v.total + ')'));
  seat.done = true;
  renderTable();
  await sleep(CPU_THINK_MS * 0.6);
}

async function singleDealerTurn(){
  view.phase = 'dealer';
  showPanel('none');

  const alive = view.seats.some(s => s.playing && !handValue(s.hand).bust);
  setMessage('ディーラーのターン');
  view.dealer.hole = false;
  audio.play('flip');
  renderDealer();
  await sleep(REVEAL_MS);

  if (alive){
    while (handValue(view.dealer.hand).total < DEALER_STAND){
      view.dealer.hand.push(drawCard());
      audio.play('deal');
      renderDealer();
      await sleep(CPU_THINK_MS);
    }
    const dv = handValue(view.dealer.hand);
    setMessage(dv.bust ? 'ディーラーがバースト!' : 'ディーラー ' + dv.total + ' でスタンド', dv.bust ? 'good' : '');
    await sleep(REVEAL_MS);
  }

  await singleSettle();
}

function judge(hand, betAmount, dealerHand){
  const v = handValue(hand);
  const dv = handValue(dealerHand);
  const bj = isBlackjack(hand);
  const dbj = isBlackjack(dealerHand);

  if (v.bust) return { payout: 0, kind: 'lose', label: 'BUST' };
  if (bj && !dbj) return { payout: Math.floor(betAmount * 2.5), kind: 'bj', label: 'BLACKJACK' };
  if (bj && dbj) return { payout: betAmount, kind: 'push', label: 'PUSH' };
  if (dbj) return { payout: 0, kind: 'lose', label: 'LOSE' };
  if (dv.bust) return { payout: betAmount * 2, kind: 'win', label: 'WIN' };
  if (v.total > dv.total) return { payout: betAmount * 2, kind: 'win', label: 'WIN' };
  if (v.total < dv.total) return { payout: 0, kind: 'lose', label: 'LOSE' };
  return { payout: betAmount, kind: 'push', label: 'PUSH' };
}

async function singleSettle(){
  view.phase = 'result';
  view.dealer.hole = false;

  view.seats.forEach(s => {
    if (!s.playing){ s.result = null; return; }
    if (s.surrendered){
      const payout = Math.floor(s.bet / 2);
      s.result = { payout, kind: 'surrender', label: 'SURRENDER' };
    } else {
      s.result = judge(s.hand, s.bet, view.dealer.hand);
    }
    s.medal += s.result.payout;
  });

  const me = view.seats[0];
  renderTable();

  if (me.result){
    const net = me.result.payout - me.bet;
    showResultFx(me.result.kind);
    if (me.result.kind === 'bj'){ audio.play('bj'); setMessage('ブラックジャック! +' + net + ' メダル', 'good'); }
    else if (me.result.kind === 'win'){ audio.play('win'); setMessage('勝ち! +' + net + ' メダル', 'good'); }
    else if (me.result.kind === 'push'){ audio.play('push'); setMessage('引き分け。ベットが戻ります'); }
    else if (me.result.kind === 'surrender'){ audio.play('push'); setMessage('サレンダー。' + net + ' メダル'); }
    else { audio.play('lose'); setMessage('負け… −' + me.bet + ' メダル', 'alert'); }

    if (account.user){
      try {
        const d = await api('/api/result', {
          method: 'POST',
          body: JSON.stringify({ bet: me.bet, payout: me.result.payout, kind: me.result.kind })
        });
        setAccount(d.user);
        me.medal = d.user.medal;
        if (d.levelUp > 0) showLevelUp(d.user.level);
      } catch (e){ console.warn('[result]', e.message); }
    } else {
      guestMedal = me.medal;
      store.set('bj4_guestMedal', String(guestMedal));
    }
  }

  renderTable();
  renderMedal();
  single.busy = false;
  el.nextBtn.textContent = '次のラウンドへ';
  showPanel('next');
}

/* =========================================================
   12. オンライン
   ========================================================= */
const online = {
  socket: null, roomId: null, state: null, connecting: false,
  createMax: 4, createMode: 'enjoy', createCpuFill: false, createRounds: 10,
  lastResultRound: -1
};

function loadSocketIo(){
  return new Promise((resolve, reject) => {
    if (window.io) return resolve();
    const base = apiBase();
    if (!base) return reject(new Error('サーバーに接続できません'));
    const s = document.createElement('script');
    s.src = base + '/socket.io/socket.io.js';
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('通信ライブラリの読み込みに失敗しました'));
    document.head.appendChild(s);
  });
}

function setConn(state, text){
  el.connBadge.className = 'conn-badge' + (state ? ' is-' + state : '');
  el.connBadge.textContent = text;
}

async function enterOnline(){
  if (!account.user){
    toast('オンラインプレイにはログインが必要です');
    openOverlay(el.accountOverlay);
    return;
  }
  showScreen('lobby');
  if (online.socket && online.socket.connected){
    setConn('on', '接続中');
    online.socket.emit('room:list');
    return;
  }
  if (online.connecting) return;

  online.connecting = true;
  setConn('', '接続しています…');
  el.roomList.innerHTML = '<p class="empty-note">読み込み中…</p>';

  try {
    await loadSocketIo();
    connectSocket();
  } catch (e){
    online.connecting = false;
    setConn('off', '接続できません');
    el.roomList.innerHTML = '<p class="empty-note">' + esc(e.message) + '</p>';
  }
}

function connectSocket(){
  const sock = window.io(apiBase(), { auth: { token: account.token }, transports: ['websocket', 'polling'] });
  online.socket = sock;

  sock.on('connect', () => {
    online.connecting = false;
    setConn('on', '接続中');
    sock.emit('room:list');
    updateChatVisibility();
  });

  sock.on('connect_error', (err) => {
    online.connecting = false;
    setConn('off', '接続エラー');
    el.roomList.innerHTML = '<p class="empty-note">' + esc(err.message || '接続に失敗しました') + '</p>';
  });

  sock.on('disconnect', () => {
    setConn('off', '切断されました');
    updateChatVisibility();
    if (screen === 'room' || screen === 'game'){
      toast('サーバーとの接続が切れました');
      showScreen('lobby');
    }
  });

  sock.on('room:list', renderRoomList);
  sock.on('room:error', (msg) => { toast(msg); audio.play('error'); });
  sock.on('room:joined', ({ id }) => { online.roomId = id; audio.play('join'); });
  sock.on('room:state', onRoomState);
  sock.on('room:countdown', ({ n }) => showCountdown(n));
  sock.on('chat:new', onChatMessage);
  sock.on('account:update', ({ user, levelUp }) => {
    setAccount(user);
    if (levelUp > 0) showLevelUp(user.level);
  });
}

function showCountdown(n){
  if (screen !== 'countdown') showScreen('countdown');
  el.countdownCap.textContent = n > 0 ? 'まもなく開始します' : 'スタート!';
  el.countdownNum.textContent = n > 0 ? n : 'GO';
  el.countdownNum.classList.remove('tick');
  void el.countdownNum.offsetWidth;
  el.countdownNum.classList.add('tick');
  audio.play(n > 0 ? 'chip' : 'win');
}

function renderRoomList(list){
  if (!Array.isArray(list) || list.length === 0){
    el.roomList.innerHTML = '<p class="empty-note">参加できる部屋がありません。<br>部屋を作って友達を誘いましょう。</p>';
    return;
  }
  el.roomList.innerHTML = list.map(r => {
    const modeTag = r.mode === 'champion'
      ? '<span class="room-row-tag is-champ">🏆 ' + r.championRounds + 'R</span>'
      : '<span class="room-row-tag">エンジョイ</span>';
    return '' +
    '<div class="room-row">' +
      '<span class="room-row-id">' + esc(r.id) + '</span>' +
      '<span class="room-row-meta">' +
        '<span class="room-row-count">' + r.count + ' / ' + r.max + ' 人 ' + modeTag + '</span>' +
        '<span class="room-row-host">ホスト: ' + esc(r.host || '-') + '</span>' +
      '</span>' +
      '<button type="button" class="mini-btn" data-join="' + esc(r.id) + '">参加</button>' +
    '</div>';
  }).join('');
}

function onRoomState(state){
  online.state = state;
  online.roomId = state.id;
  view.mode = 'online';
  view.onlineMode = state.mode;

  if (state.phase === 'lobby'){
    online.lastResultRound = -1;
    showScreen('room');
    renderRoomScreen(state);
    return;
  }

  if (state.phase === 'champion_end'){
    showScreen('championEnd');
    renderStandings(state);
    return;
  }

  if (screen !== 'game'){ shownCount.clear(); showScreen('game'); }

  view.phase = state.phase;
  view.dealer = { hand: state.dealer.hand, hole: state.dealer.hole };
  view.seats = state.players.map(p => ({
    name: p.name, level: p.level, medal: p.medal, bet: p.bet,
    hand: p.hand || [], result: p.result, isYou: p.isYou,
    active: state.activeName === p.name, ready: p.ready, cpu: !!p.cpu,
    eliminated: !!p.eliminated
  }));

  renderTable();
  renderMedal();
  updateRoundChip();
  setMessage(state.message || '');
  updateOnlinePanels(state);
}

function renderStandings(state){
  const standings = state.standings || [];
  el.standingsList.innerHTML = standings.map(p => {
    const isYou = p.name === (state.players.find(x => x.isYou) || {}).name;
    const rankLabel = p.eliminated ? '脱落' : ('#' + p.rank);
    const kindLabel = p.rankKind === 'win' ? '優勝' : p.rankKind === 'draw' ? '同率1位' : (p.eliminated ? '脱落' : '順位');
    return '' +
      '<div class="standing-row' + (isYou ? ' is-you' : '') + (p.eliminated ? ' is-eliminated' : '') + '">' +
        '<span class="standing-rank' + (p.rank === 1 && !p.eliminated ? ' is-first' : '') + '">' + rankLabel + '</span>' +
        '<div class="standing-info">' +
          '<span class="standing-name">' + esc(p.name) + (p.cpu ? ' (CPU)' : '') + (isYou ? '(あなた)' : '') + '</span>' +
          '<span class="standing-meta">' + kindLabel + ' ・ 大会メダル ' + p.medal + '</span>' +
        '</div>' +
        '<span class="standing-exp">' + (p.cpu ? '-' : '+' + p.expGain + ' EXP') + '</span>' +
      '</div>';
  }).join('');
}

function renderRoomScreen(state){
  el.roomIdText.textContent = state.id;
  el.roomCountBadge.textContent = state.players.length + '/' + state.maxPlayers;

  if (state.mode === 'champion'){
    el.roomModeBadge.textContent = '🏆 チャンピオン ' + state.championRounds + 'R';
    el.roomModeBadge.classList.add('is-champ');
  } else {
    el.roomModeBadge.textContent = 'エンジョイ';
    el.roomModeBadge.classList.remove('is-champ');
  }

  const rows = state.players.map(p => '' +
    '<div class="member-row' + (p.isYou ? ' is-you' : '') + '">' +
      '<span class="member-avatar">' + esc(p.name.charAt(0).toUpperCase()) + '</span>' +
      '<span class="member-name">' + esc(p.name) + (p.isYou ? '(あなた)' : '') + '</span>' +
      '<span class="member-lv">Lv.' + p.level + '</span>' +
      (p.name === state.hostName ? '<span class="member-tag">ホスト</span>' : '') +
    '</div>');

  for (let i = state.players.length; i < state.maxPlayers; i++){
    rows.push('<div class="member-slot">空席を待っています…</div>');
  }
  el.memberList.innerHTML = rows.join('');

  el.roomCpuRow.hidden = state.mode !== 'enjoy';
  if (state.mode === 'enjoy'){
    el.roomCpuCheck.setAttribute('aria-checked', String(!!state.cpuFill));
    el.roomCpuCheck.disabled = !state.isHost;
  }

  el.startGameBtn.hidden = !state.isHost;
  el.roomHint.textContent = state.isHost
    ? '全員が揃ったら「ゲーム開始」を押してください。'
    : 'ホストが開始するのを待っています…';
}

function updateOnlinePanels(state){
  const me = state.players.find(p => p.isYou);
  if (!me) return showPanel('none');

  if (me.eliminated){
    el.waitText.textContent = '脱落しました。このまま観戦できます(退出も可能です)。';
    return showPanel('wait');
  }

  if (state.phase === 'bet'){
    if (!me.ready){
      bet = clamp(bet, 0, betCap());
      renderBet();
      el.dealBtn.textContent = 'ベットを確定';
      showPanel('bet');
    } else if (state.isHost){
      const allReady = state.players.every(p => p.ready || p.eliminated);
      el.nextBtn.textContent = 'カードを配る';
      el.nextBtn.disabled = !allReady;
      el.nextBtn.dataset.act = 'deal';
      if (allReady) showPanel('next');
      else { el.waitText.textContent = '全員のベットを待っています…'; showPanel('wait'); }
    } else {
      el.waitText.textContent = 'ホストがカードを配るのを待っています…';
      showPanel('wait');
    }
    return;
  }

  if (state.phase === 'play'){
    if (state.activeName === me.name && !me.done){
      el.hitBtn.disabled = false;
      el.standBtn.disabled = false;
      el.surrenderBtn.hidden = (me.hand || []).length !== 2;
      el.surrenderBtn.disabled = false;
      showPanel('action');
    } else {
      el.waitText.textContent = (state.activeName || '他のプレイヤー') + ' さんのターンです…';
      showPanel('wait');
    }
    return;
  }

  if (state.phase === 'result'){
    if (me.result && online.lastResultRound !== state.round){
      online.lastResultRound = state.round;
      const k = me.result.kind;
      audio.play(k === 'bj' ? 'bj' : k === 'win' ? 'win' : (k === 'push' || k === 'surrender') ? 'push' : 'lose');
      showResultFx(k);
    }
    if (state.isHost){
      el.nextBtn.textContent = '次のラウンドへ';
      el.nextBtn.disabled = false;
      el.nextBtn.dataset.act = 'next';
      showPanel('next');
    } else {
      el.waitText.textContent = 'ホストが次のラウンドを始めるのを待っています…';
      showPanel('wait');
    }
    return;
  }

  showPanel('none');
}

/* =========================================================
   12.5 チャット
   ========================================================= */
const chat = { open: false, unread: 0, log: [], floatTimers: [] };

function chatAvailable(){
  return view.mode === 'online'
      && online.socket && online.socket.connected
      && (screen === 'room' || screen === 'game');
}

function updateChatVisibility(){
  const on = chatAvailable();
  el.chatFab.hidden = !on;
  if (on){
    restoreChatFabPos();
  } else {
    closeChat();
    el.chatFloat.innerHTML = '';
  }
}

function openChat(){
  chat.open = true;
  chat.unread = 0;
  el.chatPanel.hidden = false;
  el.chatBadge.hidden = true;
  el.chatFloat.innerHTML = '';
  renderChatLog();
  el.chatLog.scrollTop = el.chatLog.scrollHeight;
  el.chatInput.focus();
}

function closeChat(){
  chat.open = false;
  el.chatPanel.hidden = true;
}

function renderChatLog(){
  if (chat.log.length === 0){
    el.chatLog.innerHTML = '<p class="chat-empty">まだメッセージはありません。<br>スタンプや短い一言を送ってみましょう。</p>';
    return;
  }
  const me = account.user ? account.user.username : '';
  el.chatLog.innerHTML = chat.log.map(m => {
    if (m.kind === 'system'){
      return '<div class="chat-sys">' + esc(m.body) + '</div>';
    }
    const mine = m.from === me;
    const stampCls = m.kind === 'stamp' ? ' is-stamp' : '';
    return '' +
      '<div class="chat-msg' + (mine ? ' is-me' : '') + stampCls + '">' +
        (mine ? '' : '<span class="chat-who">' + esc(m.from) + '</span>') +
        '<span class="chat-body">' + esc(m.body) + '</span>' +
      '</div>';
  }).join('');
}

function pushChatFloat(m){
  const node = document.createElement('div');
  node.className = 'chat-float-item' + (m.kind === 'stamp' ? ' is-stamp' : '');
  if (m.kind === 'system'){
    node.textContent = m.body;
  } else if (m.kind === 'stamp'){
    node.innerHTML = '<b>' + esc(m.from) + '</b>' + esc(m.body);
  } else {
    node.innerHTML = '<b>' + esc(m.from) + '</b>' + esc(m.body);
  }
  el.chatFloat.appendChild(node);
  while (el.chatFloat.children.length > 3) el.chatFloat.removeChild(el.chatFloat.firstChild);
  setTimeout(() => { if (node.parentNode) node.remove(); }, 4200);
}

function onChatMessage(m){
  chat.log.push(m);
  if (chat.log.length > 120) chat.log.shift();

  const me = account.user ? account.user.username : '';
  const mine = m.from === me;

  if (chat.open){
    renderChatLog();
    el.chatLog.scrollTop = el.chatLog.scrollHeight;
  } else {
    if (!mine){
      pushChatFloat(m);
      if (m.kind !== 'system'){
        chat.unread++;
        el.chatBadge.textContent = chat.unread > 99 ? '99+' : chat.unread;
        el.chatBadge.hidden = false;
      }
    }
  }
  if (!mine && m.kind !== 'system') audio.play('chip');
}

function sendChatText(){
  const text = el.chatInput.value.trim();
  if (!text || !online.socket) return;
  online.socket.emit('chat:send', { text });
  el.chatInput.value = '';
  audio.play('button');
}

function sendChatStamp(stamp){
  if (!online.socket) return;
  online.socket.emit('chat:send', { stamp });
  audio.play('button');
}

/* --- チャットFABのドラッグ移動 ---
   位置は右下からのオフセット(px)で保持し、画面外にはみ出さないようclampする。
   タップとドラッグを区別するため、一定距離動いたときだけ「移動」とみなす。 */
const chatDrag = { active: false, moved: false, startX: 0, startY: 0, baseRight: 0, baseBottom: 0 };
const CHAT_FAB_MARGIN = 8;

function loadChatFabPos(){
  try {
    const raw = store.get('bj4_chatFabPos');
    if (!raw) return null;
    const p = JSON.parse(raw);
    if (typeof p.right === 'number' && typeof p.bottom === 'number') return p;
  } catch {}
  return null;
}

function saveChatFabPos(right, bottom){
  store.set('bj4_chatFabPos', JSON.stringify({ right, bottom }));
}

function clampFabPos(right, bottom){
  const w = el.chatFab.offsetWidth || 54;
  const h = el.chatFab.offsetHeight || 54;
  const maxRight = window.innerWidth - w - CHAT_FAB_MARGIN;
  const maxBottom = window.innerHeight - h - CHAT_FAB_MARGIN;
  return {
    right: clamp(right, CHAT_FAB_MARGIN, Math.max(CHAT_FAB_MARGIN, maxRight)),
    bottom: clamp(bottom, CHAT_FAB_MARGIN, Math.max(CHAT_FAB_MARGIN, maxBottom))
  };
}

function applyFabPos(right, bottom){
  el.chatFab.style.top = 'auto';
  el.chatFab.style.transform = 'none';
  el.chatFab.style.right = right + 'px';
  el.chatFab.style.bottom = bottom + 'px';
  positionChatPanelNearFab();
}

/* パネル/未読ポップアップもFABの位置に追従させる */
function positionChatPanelNearFab(){
  if (window.innerWidth <= 700) return;   // スマホは全幅表示なのでCSS任せ
  const right = parseFloat(el.chatFab.style.right || '22');
  const bottom = parseFloat(el.chatFab.style.bottom || '190');
  const panelBottom = bottom + el.chatFab.offsetHeight + 10;
  el.chatPanel.style.right = right + 'px';
  el.chatPanel.style.bottom = panelBottom + 'px';
  el.chatFloat.style.right = right + 'px';
  el.chatFloat.style.bottom = (panelBottom + 6) + 'px';
}

function restoreChatFabPos(){
  const saved = loadChatFabPos();
  if (saved){
    const { right, bottom } = clampFabPos(saved.right, saved.bottom);
    applyFabPos(right, bottom);
    return;
  }
  anchorFabAboveControls();
}

/* 初期位置: 操作パネルの真上・右寄せ(チップやボタンと重ならない位置)
   ユーザーがドラッグで動かした後は、その位置を優先する */
function anchorFabAboveControls(){
  if (loadChatFabPos()) return;
  const ctlH = (screen === 'game' && !el.controls.hidden)
    ? Math.round(el.controls.getBoundingClientRect().height) : 0;
  const { right, bottom } = clampFabPos(12, ctlH + 22);
  applyFabPos(right, bottom);
}

function fabPointerDown(e){
  if (e.button !== undefined && e.button !== 0) return;
  chatDrag.active = true;
  chatDrag.moved = false;
  const rect = el.chatFab.getBoundingClientRect();
  const pt = e.touches ? e.touches[0] : e;
  chatDrag.startX = pt.clientX;
  chatDrag.startY = pt.clientY;
  chatDrag.baseRight = window.innerWidth - rect.right;
  chatDrag.baseBottom = window.innerHeight - rect.bottom;
  window.addEventListener('pointermove', fabPointerMove);
  window.addEventListener('pointerup', fabPointerUp);
  window.addEventListener('touchmove', fabPointerMove, { passive: false });
  window.addEventListener('touchend', fabPointerUp);
}

function fabPointerMove(e){
  if (!chatDrag.active) return;
  const pt = e.touches ? e.touches[0] : e;
  const dx = pt.clientX - chatDrag.startX;
  const dy = pt.clientY - chatDrag.startY;
  if (!chatDrag.moved && Math.hypot(dx, dy) > 6) chatDrag.moved = true;
  if (!chatDrag.moved) return;
  if (e.cancelable) e.preventDefault();

  const next = clampFabPos(chatDrag.baseRight - dx, chatDrag.baseBottom - dy);
  applyFabPos(next.right, next.bottom);
}

function fabPointerUp(){
  if (!chatDrag.active) return;
  chatDrag.active = false;
  window.removeEventListener('pointermove', fabPointerMove);
  window.removeEventListener('pointerup', fabPointerUp);
  window.removeEventListener('touchmove', fabPointerMove);
  window.removeEventListener('touchend', fabPointerUp);

  if (chatDrag.moved){
    const right = parseFloat(el.chatFab.style.right || '0');
    const bottom = parseFloat(el.chatFab.style.bottom || '0');
    saveChatFabPos(right, bottom);
    /* click イベントの直後発火をこのフレームだけ抑止 */
    requestAnimationFrame(() => { chatDrag.moved = false; });
  }
}

el.chatFab.addEventListener('pointerdown', fabPointerDown);
el.chatFab.addEventListener('touchstart', fabPointerDown, { passive: true });

/* 操作パネルの高さが変わったら(ベット↔アクション等)初期位置を追従させる */
if (window.ResizeObserver){
  new ResizeObserver(() => {
    if (el.chatFab.hidden) return;
    anchorFabAboveControls();
  }).observe(el.controls);
}

window.addEventListener('resize', () => {
  if (!el.chatFab.style.right) return;
  const right = parseFloat(el.chatFab.style.right);
  const bottom = parseFloat(el.chatFab.style.bottom);
  const next = clampFabPos(right, bottom);
  applyFabPos(next.right, next.bottom);
});

function leaveOnlineRoom(){
  if (online.socket) online.socket.emit('room:leave');
  online.roomId = null;
  online.state = null;
  online.lastResultRound = -1;
  chat.log = [];
  chat.unread = 0;
  el.chatBadge.hidden = true;
  closeChat();
  showScreen('lobby');
  if (online.socket) online.socket.emit('room:list');
}

/* =========================================================
   13. ベット操作
   ========================================================= */
function addBet(amount){
  if (view.phase !== 'bet') return;
  const next = clamp(bet + amount, 0, betCap());
  if (next === bet) return;
  bet = next;
  audio.play('chip');
  ledTick(el.betValue);
  renderBet();
}

function confirmBet(){
  if (bet < MIN_BET) return;
  audio.play('button');
  if (view.mode === 'online'){
    if (online.socket) online.socket.emit('game:bet', { amount: bet });
    el.dealBtn.disabled = true;
  } else {
    singleDeal();
  }
}

/* =========================================================
   14. 広告
   ========================================================= */
const ad = { open: false, forced: false, need: AD_SKIP_SEC, elapsed: 0, timerId: null, ready: false };

function openAd(){
  if (ad.open) return;
  ad.open = true;
  ad.elapsed = 0;
  ad.ready = false;
  ad.forced = Math.random() >= AD_SKIP_RATE;
  ad.need = ad.forced ? AD_FULL_SEC : AD_SKIP_SEC;

  el.adFallback.hidden = true;
  el.adVideo.hidden = false;
  el.adVideo.muted = true;
  el.adVideo.loop = true;
  el.adVideo.currentTime = 0;
  el.adVideo.src = AD_FILES[randInt(AD_FILES.length)];
  setSoundIcon();
  el.adProgress.style.width = '0%';
  el.adOverlay.hidden = false;
  bgm.duck(true);
  updateAdFoot();

  const p = el.adVideo.play();
  if (p && p.catch) p.catch(() => {});

  clearInterval(ad.timerId);
  ad.timerId = setInterval(tickAd, 100);
}

function tickAd(){
  ad.elapsed = Math.min(ad.elapsed + 0.1, ad.need);
  el.adTimer.textContent = Math.max(0, Math.ceil(ad.need - ad.elapsed));
  el.adProgress.style.width = (ad.elapsed / ad.need * 100).toFixed(1) + '%';
  if (ad.elapsed >= ad.need && !ad.ready){
    ad.ready = true;
    clearInterval(ad.timerId);
  }
  updateAdFoot();
}

function updateAdFoot(){
  if (ad.ready){
    el.adCloseBtn.disabled = false;
    el.adCloseBtn.textContent = ad.forced ? '閉じて受け取る' : 'スキップして受け取る';
  } else {
    el.adCloseBtn.disabled = true;
    el.adCloseBtn.textContent = 'あと' + Math.max(1, Math.ceil(ad.need - ad.elapsed)) + '秒';
  }
}

async function closeAd(){
  if (!ad.open || !ad.ready) return;
  clearInterval(ad.timerId);
  ad.timerId = null;
  ad.open = false;

  el.adVideo.pause();
  el.adVideo.removeAttribute('src');
  el.adVideo.load();
  el.adOverlay.hidden = true;
  bgm.duck(false);

  if (account.user){
    try {
      const d = await api('/api/ad', { method: 'POST' });
      setAccount(d.user);
    } catch (e){ toast(e.message); return; }
  } else {
    guestMedal += AD_REWARD;
    store.set('bj4_guestMedal', String(guestMedal));
  }

  if (view.phase === 'bet'){
    if (view.mode === 'single'){
      view.seats[0].medal = myMedal();
      renderTable();
      setMessage('ベット額を決めてください');
    } else if (online.socket && online.socket.connected){
      /* サーバーが持つルーム内のメダルは接続時のスナップショットなので
         広告で増えた分をDBから読み直させる */
      online.socket.emit('player:sync');
    }
    renderBet();   // チップボタンの有効/無効を再計算(これが無いと進行不能になる)
  }
  renderMedal();
  audio.play('win');
  toast('+' + AD_REWARD + ' メダルを受け取りました');
}

function setSoundIcon(){
  const muted = el.adVideo.muted;
  el.adSoundBtn.textContent = muted ? '🔇' : '🔊';
  el.adSoundBtn.title = muted ? '音を出す' : '音を消す';
  el.adSoundBtn.setAttribute('aria-label', muted ? '音を出す' : '音を消す');
}

/* =========================================================
   15. モーダル / 設定
   ========================================================= */
function openOverlay(node){ node.hidden = false; }
function closeOverlay(node){ node.hidden = true; }

function renderBgmStatus(){
  if (!el.bgmStatus) return;
  el.bgmStatus.hidden = !bgm.failed;
  if (bgm.failed) el.bgmStatus.textContent = 'BGM.mp3 が見つからないため、BGMは再生されません。';
}

function renderSettings(){
  el.bgmSwitch.classList.toggle('is-on', settings.bgmOn);
  el.bgmSwitch.setAttribute('aria-checked', String(settings.bgmOn));
  el.bgmVol.value = settings.bgmVol;
  el.bgmVolText.textContent = settings.bgmVol + '%';

  el.seSwitch.classList.toggle('is-on', settings.seOn);
  el.seSwitch.setAttribute('aria-checked', String(settings.seOn));
  el.seVol.value = settings.seVol;
  el.seVolText.textContent = settings.seVol + '%';

  el.seatSeg.querySelectorAll('.seg-btn').forEach(b =>
    b.classList.toggle('is-on', Number(b.dataset.seats) === settings.seats));

  renderBgmStatus();
}

/* =========================================================
   16. イベント登録
   ========================================================= */
/* 初回操作で音声を解禁 */
['pointerdown', 'keydown'].forEach(ev =>
  window.addEventListener(ev, () => audio.unlock(), { once: true }));

/* --- タイトル --- */
el.toSingleBtn.addEventListener('click', () => { audio.play('button'); startSingle(); });
el.toOnlineBtn.addEventListener('click', () => { audio.play('button'); enterOnline(); });
el.toRulesBtn.addEventListener('click', () => { audio.play('button'); openOverlay(el.rulesOverlay); });
el.toSettingsBtn.addEventListener('click', () => { audio.play('button'); renderSettings(); openOverlay(el.settingsOverlay); });

el.brandBtn.addEventListener('click', () => {
  if (screen === 'title') return;
  if (screen === 'room' || (screen === 'game' && view.mode === 'online')){
    if (!confirm('部屋から退出してタイトルに戻りますか?')) return;
    if (online.socket) online.socket.emit('room:leave');
    online.roomId = null;
  }
  audio.play('button');
  showScreen('title');
});

el.leaveBtn.addEventListener('click', () => {
  audio.play('button');
  if (view.mode === 'online' && (screen === 'room' || screen === 'game')){
    if (!confirm('部屋から退出しますか?')) return;
    leaveOnlineRoom();
    showScreen('title');
  } else if (screen === 'game'){
    if (view.phase === 'play' && !confirm('タイトルに戻りますか?(このラウンドは終了扱いになります)')) return;
    showScreen('title');
  }
});

el.gameRulesBtn.addEventListener('click', () => { audio.play('button'); openOverlay(el.rulesOverlay); });

el.changelogBtn.addEventListener('click', () => { audio.play('button'); openOverlay(el.changelogOverlay); });
el.changelogCloseBtn.addEventListener('click', () => closeOverlay(el.changelogOverlay));

/* --- ロビー --- */
el.lobbyBackBtn.addEventListener('click', () => { audio.play('button'); showScreen('title'); });
el.refreshRoomsBtn.addEventListener('click', () => {
  audio.play('button');
  if (online.socket) online.socket.emit('room:list');
});
el.createSeg.addEventListener('click', (e) => {
  const b = e.target.closest('.seg-btn');
  if (!b) return;
  online.createMax = Number(b.dataset.max);
  el.createSeg.querySelectorAll('.seg-btn').forEach(x => x.classList.toggle('is-on', x === b));
  audio.play('chip');
});

el.createModeSeg.addEventListener('click', (e) => {
  const b = e.target.closest('.seg-btn');
  if (!b) return;
  online.createMode = b.dataset.mode;
  el.createModeSeg.querySelectorAll('.seg-btn').forEach(x => x.classList.toggle('is-on', x === b));
  const isChamp = online.createMode === 'champion';
  el.createChampRow.hidden = !isChamp;
  el.createCpuRow.hidden = isChamp;
  el.createModeDesc.textContent = isChamp
    ? '全員に大会専用メダル1000枚を配布して競う特別モード。最終順位に応じてEXPが変わります。'
    : '気軽に遊べる通常モード。メダルはアカウントに反映されます。';
  audio.play('chip');
});

el.createCpuCheck.addEventListener('click', () => {
  online.createCpuFill = !online.createCpuFill;
  el.createCpuCheck.setAttribute('aria-checked', String(online.createCpuFill));
  audio.play('button');
});

el.champRoundSeg.addEventListener('click', (e) => {
  const b = e.target.closest('.seg-btn');
  if (!b) return;
  el.champRoundSeg.querySelectorAll('.seg-btn').forEach(x => x.classList.toggle('is-on', x === b));
  if (b.dataset.rounds === 'custom'){
    el.champRoundCustom.hidden = false;
    el.champRoundCustom.focus();
    online.createRounds = clamp(Number(el.champRoundCustom.value) || 10, 1, 200);
  } else {
    el.champRoundCustom.hidden = true;
    online.createRounds = Number(b.dataset.rounds);
  }
  audio.play('chip');
});
el.champRoundCustom.addEventListener('input', () => {
  online.createRounds = clamp(Number(el.champRoundCustom.value) || 1, 1, 200);
});

el.createRoomBtn.addEventListener('click', () => {
  if (!online.socket || !online.socket.connected) return toast('サーバーに接続していません');
  audio.play('button');
  online.socket.emit('room:create', {
    maxPlayers: online.createMax,
    mode: online.createMode,
    cpuFill: online.createCpuFill,
    championRounds: online.createRounds
  });
});
el.roomList.addEventListener('click', (e) => {
  const b = e.target.closest('[data-join]');
  if (!b || !online.socket) return;
  audio.play('button');
  online.socket.emit('room:join', { id: b.dataset.join });
});
el.joinIdBtn.addEventListener('click', () => {
  const id = el.joinIdInput.value.trim().toUpperCase();
  if (id.length !== 4) return toast('ルームIDは4桁です');
  if (!online.socket) return toast('サーバーに接続していません');
  audio.play('button');
  online.socket.emit('room:join', { id });
});
el.joinIdInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') el.joinIdBtn.click(); });

/* --- 待機ルーム --- */
el.roomLeaveBtn.addEventListener('click', () => { audio.play('button'); leaveOnlineRoom(); });
el.startGameBtn.addEventListener('click', () => {
  if (!online.socket) return;
  audio.play('button');
  online.socket.emit('room:start');
});
el.roomCpuCheck.addEventListener('click', () => {
  if (el.roomCpuCheck.disabled || !online.socket) return;
  const next = el.roomCpuCheck.getAttribute('aria-checked') !== 'true';
  online.socket.emit('room:cpuFill', { on: next });
  audio.play('button');
});
el.copyIdBtn.addEventListener('click', async () => {
  const id = el.roomIdText.textContent;
  try { await navigator.clipboard.writeText(id); toast('ルームID ' + id + ' をコピーしました'); }
  catch { toast('ルームID: ' + id); }
});
el.championBackBtn.addEventListener('click', () => {
  audio.play('button');
  if (online.socket) online.socket.emit('game:next');
  showScreen('lobby');
  if (online.socket) online.socket.emit('room:list');
});

/* --- ゲーム操作 --- */
document.querySelectorAll('.chip').forEach(chip =>
  chip.addEventListener('click', () => addBet(Number(chip.dataset.chip))));

el.betClearBtn.addEventListener('click', () => {
  if (view.phase !== 'bet') return;
  bet = 0; audio.play('button'); ledTick(el.betValue); renderBet();
});
el.betMaxBtn.addEventListener('click', () => {
  if (view.phase !== 'bet') return;
  bet = betCap(); audio.play('chip'); ledTick(el.betValue); renderBet();
});
el.dealBtn.addEventListener('click', confirmBet);

el.hitBtn.addEventListener('click', () => {
  if (view.mode === 'online'){
    audio.play('button');
    showFx('hit');
    el.hitBtn.disabled = true; el.standBtn.disabled = true; el.surrenderBtn.disabled = true;
    if (online.socket) online.socket.emit('game:hit');
  } else singleHit();
});

el.standBtn.addEventListener('click', () => {
  if (view.mode === 'online'){
    audio.play('button');
    showFx('stand');
    el.hitBtn.disabled = true; el.standBtn.disabled = true; el.surrenderBtn.disabled = true;
    if (online.socket) online.socket.emit('game:stand');
  } else singleStand();
});

el.surrenderBtn.addEventListener('click', () => {
  if (el.surrenderBtn.disabled) return;
  audio.play('button');
  openOverlay(el.surrenderOverlay);
});
el.surrenderCancelBtn.addEventListener('click', () => closeOverlay(el.surrenderOverlay));
el.surrenderConfirmBtn.addEventListener('click', () => {
  closeOverlay(el.surrenderOverlay);
  audio.play('button');
  if (view.mode === 'online'){
    showFx('surrender');
    el.hitBtn.disabled = true; el.standBtn.disabled = true; el.surrenderBtn.disabled = true;
    if (online.socket) online.socket.emit('game:surrender');
  } else {
    singleSurrender();
  }
});

el.nextBtn.addEventListener('click', () => {
  audio.play('button');
  if (view.mode === 'online'){
    if (!online.socket) return;
    el.nextBtn.disabled = true;
    online.socket.emit(el.nextBtn.dataset.act === 'deal' ? 'game:deal' : 'game:next');
  } else if (view.phase === 'result'){
    singleBetPhase();
  }
});

el.adBtn.addEventListener('click', () => { audio.play('button'); openAd(); });
el.adCloseBtn.addEventListener('click', closeAd);
el.adSoundBtn.addEventListener('click', () => {
  el.adVideo.muted = !el.adVideo.muted;
  setSoundIcon();
  if (!el.adVideo.muted){
    const p = el.adVideo.play();
    if (p && p.catch) p.catch(() => {});
  }
});
el.adVideo.addEventListener('error', () => {
  el.adVideo.hidden = true;
  el.adFallback.hidden = false;
});

/* --- アカウント --- */
el.accountBtn.addEventListener('click', () => {
  audio.play('button');
  renderProfile();
  openOverlay(el.accountOverlay);
});
el.accountCloseBtn.addEventListener('click', () => closeOverlay(el.accountOverlay));
el.authTabs.addEventListener('click', (e) => {
  const b = e.target.closest('.seg-btn');
  if (b) { audio.play('chip'); setAuthMode(b.dataset.tab); }
});
el.authSubmitBtn.addEventListener('click', submitAuth);
el.authPass.addEventListener('keydown', (e) => { if (e.key === 'Enter') submitAuth(); });
el.authName.addEventListener('keydown', (e) => { if (e.key === 'Enter') el.authPass.focus(); });
el.logoutBtn.addEventListener('click', () => {
  if (!confirm('ログアウトしますか?')) return;
  if (online.socket){ online.socket.disconnect(); online.socket = null; }
  clearAccount();
  closeOverlay(el.accountOverlay);
  toast('ログアウトしました');
  if (screen !== 'title') showScreen('title');
});

el.showDeleteBtn.addEventListener('click', () => {
  audio.play('button');
  el.deleteBox.hidden = !el.deleteBox.hidden;
  el.deletePass.value = '';
  el.deleteError.hidden = true;
  if (!el.deleteBox.hidden) el.deletePass.focus();
});
el.deleteCancelBtn.addEventListener('click', () => {
  el.deleteBox.hidden = true;
  el.deletePass.value = '';
  el.deleteError.hidden = true;
});
el.deleteConfirmBtn.addEventListener('click', () => {
  if (!confirm('本当にアカウントを削除しますか?この操作は取り消せません。')) return;
  submitDeleteAccount();
});
el.deletePass.addEventListener('keydown', (e) => { if (e.key === 'Enter') el.deleteConfirmBtn.click(); });

/* --- ルール / 設定 --- */
el.menuBtn.addEventListener('click', () => { audio.play('button'); renderSettings(); openOverlay(el.settingsOverlay); });
el.rulesCloseBtn.addEventListener('click', () => closeOverlay(el.rulesOverlay));
el.settingsCloseBtn.addEventListener('click', () => closeOverlay(el.settingsOverlay));

el.bgmSwitch.addEventListener('click', () => {
  settings.bgmOn = !settings.bgmOn;
  saveSettings(); renderSettings(); bgm.apply();
  audio.play('button');
});
el.bgmVol.addEventListener('input', () => {
  settings.bgmVol = Number(el.bgmVol.value);
  el.bgmVolText.textContent = settings.bgmVol + '%';
  saveSettings();
  bgm.applyGain(0.06);   // ドラッグ中は短いランプで追従させる
});
el.bgmVol.addEventListener('change', () => { saveSettings(); bgm.apply(); });
el.seSwitch.addEventListener('click', () => {
  settings.seOn = !settings.seOn;
  saveSettings(); renderSettings();
  if (settings.seOn) audio.play('button');
});
el.seVol.addEventListener('input', () => {
  settings.seVol = Number(el.seVol.value);
  el.seVolText.textContent = settings.seVol + '%';
  saveSettings(); audio.setVolume();
});
el.seVol.addEventListener('change', () => audio.play('chip'));

el.seatSeg.addEventListener('click', (e) => {
  const b = e.target.closest('.seg-btn');
  if (!b) return;
  settings.seats = Number(b.dataset.seats);
  saveSettings(); renderSettings();
  audio.play('chip');
  if (screen === 'game' && view.mode === 'single' && view.phase === 'bet'){
    makeSingleSeats(settings.seats);
    bet = clamp(bet, 0, myMedal());
    renderTable(); renderBet();
  } else if (screen === 'game'){
    toast('次のラウンドから ' + settings.seats + '人になります');
  }
});

el.resetBtn.addEventListener('click', () => {
  if (account.user) return toast('ログイン中はサーバーのメダルが使われます');
  guestMedal = INITIAL_MEDAL;
  store.set('bj4_guestMedal', String(guestMedal));
  renderMedal();
  if (screen === 'game' && view.mode === 'single'){ shoe = []; buildShoe(); singleBetPhase(); }
  closeOverlay(el.settingsOverlay);
  toast('メダルを初期化しました');
});

/* --- チャット --- */
el.chatFab.addEventListener('click', () => {
  if (chatDrag.moved) return;   // ドラッグ直後のクリック発火は無視
  audio.play('button');
  if (chat.open) closeChat(); else openChat();
});
el.chatCloseBtn.addEventListener('click', () => { audio.play('button'); closeChat(); });
el.chatSendBtn.addEventListener('click', sendChatText);
el.chatInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter'){ e.preventDefault(); sendChatText(); }
});
el.chatStamps.addEventListener('click', (e) => {
  const b = e.target.closest('.stamp-btn');
  if (b) sendChatStamp(b.dataset.stamp);
});

/* --- 全体 --- */
[el.accountOverlay, el.rulesOverlay, el.settingsOverlay, el.changelogOverlay, el.surrenderOverlay].forEach(node =>
  node.addEventListener('click', (e) => { if (e.target === node) closeOverlay(node); }));

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape'){
    [el.accountOverlay, el.rulesOverlay, el.settingsOverlay, el.changelogOverlay, el.surrenderOverlay].forEach(n => { if (!n.hidden) closeOverlay(n); });
    return;
  }
  if (!el.adOverlay.hidden) return;
  if (document.activeElement && document.activeElement.tagName === 'INPUT') return;
  if (screen !== 'game') return;

  const key = e.key.toLowerCase();
  if (view.phase === 'play' && !el.actionPanel.hidden){
    if (key === 'h') el.hitBtn.click();
    if (key === 's') el.standBtn.click();
  } else if (view.phase === 'bet' && key === 'enter' && !el.betPanel.hidden){
    el.dealBtn.click();
  } else if (key === 'enter' && !el.nextPanel.hidden){
    el.nextBtn.click();
  }
});

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  audio.resume();
  bgm.apply();
});
window.addEventListener('pageshow', () => { audio.resume(); bgm.apply(); });

window.addEventListener('beforeunload', () => {
  if (online.socket) online.socket.emit('room:leave');
});

/* =========================================================
   17. 起動
   ========================================================= */
async function init(){
  buildShoe();
  if (settings.bgmOn) bgm.prefetch();
  setAuthMode('login');
  renderSettings();
  renderAccountUi();
  showScreen('title');
  await restoreSession();
}

init();
