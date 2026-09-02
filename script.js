/* =========================================================
   Betoria - script.js  (v4.5)
   made by hiro/ヒロ   https://github.com/h1ro223
   無料で遊べるオンラインカジノ
     ・BLACKJACK 4(ブラックジャック)
     ・MARBLE RACE(マーブルレース)  ← v4.1 で追加
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

const BGM_FILE     = './BGM/BGM.mp3';
const AD_FILES     = ['./AD/ad1.mp4', './AD/ad2.mp4', './AD/ad3.mp4'];
const AD_REWARD    = 300;
const AD_SKIP_SEC  = 5;
const AD_FULL_SEC  = 30;
const AD_SKIP_RATE = 0.95;
/* 広告のクールタイムと、受け取り可能な所持メダルの上限(v3.0・サーバーと合わせる) */
const AD_COOLDOWN_MS = 15000;
const AD_MEDAL_LIMIT = 500;

/* アカウントアイコンの色(server.js の ICON_COLORS と必ず同じ並びにすること) */
const ICON_COLORS = [
  { key: 'brass',     name: 'ブラス' },
  { key: 'emerald',   name: 'エメラルド' },
  { key: 'ruby',      name: 'ルビー' },
  { key: 'sapphire',  name: 'サファイア' },
  { key: 'amethyst',  name: 'アメジスト' },
  { key: 'tangerine', name: 'タンジェリン' },
  { key: 'mint',      name: 'ミント' },
  { key: 'rose',      name: 'ローズ' },
  { key: 'sky',       name: 'スカイ' },
  { key: 'slate',     name: 'スレート' }
];
const DEFAULT_ICON_COLOR = 'brass';
const iconColorOf = (c) => (ICON_COLORS.some(x => x.key === c) ? c : DEFAULT_ICON_COLOR);

/* =========================================================
   オーナー(開発者)の表示(v4.6)
   サーバーから受け取った名前と一致する人だけ、
   名前の先頭に👑を付けて金色で表示する。
   ========================================================= */
function isOwnerName(name){
  return !!name && !!online.ownerName && name === online.ownerName;
}

/* 名前をHTMLにする。オーナーなら👑つきの金色になる。
   名前を画面に出すところは esc(name) ではなくこちらを使う */
function nameHTML(name){
  const n = esc(String(name == null ? '' : name));
  return isOwnerName(name)
    ? '<span class="is-owner"><span class="owner-crown">👑</span>' + n + '</span>'
    : n;
}

/* 全額ベットボーナス(チャンピオンモード・サーバーと合わせる) */
const ALLIN_BONUS_RATE = 1.5;
/* 連勝表示を出し始める連勝数 */
const STREAK_MIN_SHOW = 2;

/* 早抜けモード(v3.2・サーバーと合わせる) */
const SPRINT_GOAL_DEFAULT = 10000;
const SPRINT_GOAL_MIN = 2000;
const SPRINT_GOAL_MAX = 1000000;

/* 大会用メダルを使うモードかどうか */
const isTourneyMode = (m) => m === 'champion' || m === 'sprint';

const MODE_DESC = {
  enjoy: '気軽に遊べる通常モード。メダルはアカウントに反映されます。',
  champion: '全員に大会専用メダル1000枚を配布して競う特別モード。最終順位に応じてEXPが変わります。',
  sprint: '大会専用メダル1000枚から、決められた枚数を超えるまでの早さを競うモード。早く抜けるほどEXPが増えます。'
};

const DEAL_MS     = 240;
const CPU_THINK_MS = 620;
const REVEAL_MS   = 520;

const SUITS = [
  { mark: '♠', red: false }, { mark: '♥', red: true },
  { mark: '♦', red: true },  { mark: '♣', red: false }
];
const RANKS = ['A','2','3','4','5','6','7','8','9','10','J','Q','K'];
const CPU_NAMES = ['CPU ハル', 'CPU ミナ', 'CPU レオ'];
const MIN_HUMANS = 2;   // オンラインで開始に必要な人プレイヤー数
const COUNTDOWN_SEC = 3;
const TURN_LIMIT_SEC = 30;   // オンラインの手番制限(サーバーと合わせる)
const CHAMP_ROUND_MIN = 10;
const CHAMP_ROUND_MAX = 100;

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
  bgmVol: Number(store.get('bj4_bgmVol') ?? 40),
  seOn: store.get('bj4_seOn') !== '0',
  seVol: Number(store.get('bj4_seVol') ?? 60),
  seats: Number(store.get('bj4_seats') ?? 4),
  /* ノルマモード(v3.2) */
  normaOn: store.get('bj4_normaOn') === '1',
  normaTarget: Number(store.get('bj4_normaTarget') ?? 5000)
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

  /* ---- v4.0 ゲーム選択 ---- */
  screenGameSelect: $('screenGameSelect'),
  gameGrid: $('gameGrid'),
  gameSelectBackBtn: $('gameSelectBackBtn'),
  screenGameMenu: $('screenGameMenu'),
  gameMenuBackBtn: $('gameMenuBackBtn'),
  gameMenuTitle: $('gameMenuTitle'),
  gameMenuDesc: $('gameMenuDesc'),
  toGamesBtn: $('toGamesBtn'),
  gmSingleBtn: $('gmSingleBtn'),
  gmSingleDesc: $('gmSingleDesc'),
  gmOnlineBtn: $('gmOnlineBtn'),
  gmTutorialBtn: $('gmTutorialBtn'),
  gmRankingBtn: $('gmRankingBtn'),
  gmRankingDesc: $('gmRankingDesc'),
  gmRulesBtn: $('gmRulesBtn'),

  /* ---- v4.1 マーブルレース ---- */
  screenMarble: $('screenMarble'),
  mrLeaveBtn: $('mrLeaveBtn'),

  /* スロット(v5.0) */
  screenSlotHall: $('screenSlotHall'),
  screenSlot: $('screenSlot'),
  slotHallBackBtn: $('slotHallBackBtn'),
  slHall: $('slHall'),
  slHallCount: $('slHallCount'),
  slLeaveBtn: $('slLeaveBtn'),
  slRulesBtn: $('slRulesBtn'),
  slMachineNo: $('slMachineNo'),
  slDataBB: $('slDataBB'),
  slDataRB: $('slDataRB'),
  slDataStart: $('slDataStart'),
  slDataTotal: $('slDataTotal'),
  slDataRate: $('slDataRate'),
  slSettingsBtn: $('slSettingsBtn'),
  slConnChip: $('slConnChip'),
  slConnDot: $('slConnDot'),
  slConnText: $('slConnText'),
  slotSettingsOverlay: $('slotSettingsOverlay'),
  slotSettingsCloseBtn: $('slotSettingsCloseBtn'),
  slOptMsgBar: $('slOptMsgBar'),
  slOptOneBet: $('slOptOneBet'),
  slOptEasyLever: $('slOptEasyLever'),
  slBonusGraph: $('slBonusGraph'),
  slWCoin: $('slWCoin'),
  slWInvest: $('slWInvest'),
  slWBack: $('slWBack'),
  slWDiff: $('slWDiff'),
  slReelWindow: $('slReelWindow'),
  slReel0: $('slReel0'),
  slReel1: $('slReel1'),
  slReel2: $('slReel2'),
  slBetLamp1: $('slBetLamp1'),
  slBetLamp2: $('slBetLamp2'),
  slBetLamp3: $('slBetLamp3'),
  slLampStart: $('slLampStart'),
  slLampReplay: $('slLampReplay'),
  slLampWait: $('slLampWait'),
  slLampInsert: $('slLampInsert'),
  slGogo: $('slGogo'),
  slGogoOff: $('slGogoOff'),
  slGogoOn: $('slGogoOn'),
  slGogoRainbow: $('slGogoRainbow'),
  slSegCredit: $('slSegCredit'),
  slSegCount: $('slSegCount'),
  slSegPayout: $('slSegPayout'),
  slMsg: $('slMsg'),
  slRentBtn: $('slRentBtn'),
  slBet1Btn: $('slBet1Btn'),
  slMaxBetBtn: $('slMaxBetBtn'),
  slCashoutBtn: $('slCashoutBtn'),
  slDataBtn: $('slDataBtn'),
  slLever: $('slLever'),
  slStop0: $('slStop0'),
  slStop1: $('slStop1'),
  slStop2: $('slStop2'),
  slotDataOverlay: $('slotDataOverlay'),
  slotDataCloseBtn: $('slotDataCloseBtn'),
  slGraphCanvas: $('slGraphCanvas'),
  slStatBB: $('slStatBB'),
  slStatRB: $('slStatRB'),
  slStatRate: $('slStatRate'),
  slStatAvg: $('slStatAvg'),
  slStatDiff: $('slStatDiff'),
  slHistory: $('slHistory'),
  rulesSlot: $('rulesSlot'),
  mrRulesBtn: $('mrRulesBtn'),
  mrRaceNo: $('mrRaceNo'),
  mrPhaseChip: $('mrPhaseChip'),
  mrPhaseText: $('mrPhaseText'),
  mrTimerChip: $('mrTimerChip'),
  mrTimerNum: $('mrTimerNum'),
  mrTrack: $('mrTrack'),
  mrCount: $('mrCount'),
  mrCountNum: $('mrCountNum'),
  mrCheerRow: $('mrCheerRow'),
  mrLanes: $('mrLanes'),
  mrMessageText: $('mrMessageText'),
  mrResult: $('mrResult'),
  mrPodium: $('mrPodium'),
  mrPayout: $('mrPayout'),
  mrBoardNote: $('mrBoardNote'),
  mrEntries: $('mrEntries'),
  mrTickets: $('mrTickets'),
  mrInvestNote: $('mrInvestNote'),
  mrTicketList: $('mrTicketList'),
  mrWatchers: $('mrWatchers'),
  mrBetPanel: $('mrBetPanel'),
  mrTypeSeg: $('mrTypeSeg'),
  mrPickNote: $('mrPickNote'),
  mrBetView: $('mrBetView'),
  mrRaceView: $('mrRaceView'),
  mrSlip: $('mrSlip'),
  mrSlipPicks: $('mrSlipPicks'),
  mrRaceTickets: $('mrRaceTickets'),
  mrRaceTicketList: $('mrRaceTicketList'),
  mrRaceInvestNote: $('mrRaceInvestNote'),
  mrBetValue: $('mrBetValue'),
  mrBetOddsVal: $('mrBetOddsVal'),
  mrBetReturn: $('mrBetReturn'),
  mrChipRow: $('mrChipRow'),
  mrClearBtn: $('mrClearBtn'),
  mrBuyBtn: $('mrBuyBtn'),
  mrWaitPanel: $('mrWaitPanel'),
  mrWaitText: $('mrWaitText'),
  mrRaces: $('mrRaces'),
  mrHits: $('mrHits'),
  mrMisses: $('mrMisses'),
  mrRate: $('mrRate'),
  mrTotalGain: $('mrTotalGain'),
  mrBestGain: $('mrBestGain'),
  rulesMarble: $('rulesMarble'),


  /* ---- v4.0 ロビー / ランキング / ルール ---- */
  lobbyTitle: $('lobbyTitle'),
  roomTitle: $('roomTitle'),
  createModeLabel: $('createModeLabel'),
  rankGameTabs: $('rankGameTabs'),
  rulesGameTabs: $('rulesGameTabs'),
  rulesBj: $('rulesBj'),

  roundChip: $('roundChip'),
  roundNow: $('roundNow'),
  roundMax: $('roundMax'),

  adBtnGain: $('adBtnGain'),
  streakChip: $('streakChip'),
  streakNum: $('streakNum'),
  spectateChip: $('spectateChip'),
  spectateNum: $('spectateNum'),
  spectatePanel: $('spectatePanel'),
  spectateLeaveBtn: $('spectateLeaveBtn'),

  normaRow: $('normaRow'),
  normaCheck: $('normaCheck'),
  normaTargetRow: $('normaTargetRow'),
  normaSeg: $('normaSeg'),
  normaTarget: $('normaTarget'),
  normaChip: $('normaChip'),
  normaNow: $('normaNow'),
  normaGoal: $('normaGoal'),
  singleEndPanel: $('singleEndPanel'),

  tutorialHead: $('tutorialHead'),
  tutorialExitBtn: $('tutorialExitBtn'),
  tutorialChapter: $('tutorialChapter'),
  tutorialTitle: $('tutorialTitle'),
  tutorialPanel: $('tutorialPanel'),
  tutorialText: $('tutorialText'),
  tutorialNextBtn: $('tutorialNextBtn'),
  tutorialSkipBtn: $('tutorialSkipBtn'),
  tutorialEndPanel: $('tutorialEndPanel'),
  tutorialEndBackBtn: $('tutorialEndBackBtn'),
  tutorialEndPlayBtn: $('tutorialEndPlayBtn'),
  singleEndTitle: $('singleEndTitle'),
  singleEndText: $('singleEndText'),
  singleEndBackBtn: $('singleEndBackBtn'),
  singleEndRetryBtn: $('singleEndRetryBtn'),

  friendBtn: $('friendBtn'),
  friendBadge: $('friendBadge'),
  friendOnline: $('friendOnline'),

  noticeBtn: $('noticeBtn'),
  noticeCount: $('noticeCount'),
  noticeBadge: $('noticeBadge'),
  noticeOverlay: $('noticeOverlay'),
  noticeCloseBtn: $('noticeCloseBtn'),
  noticeList: $('noticeList'),
  noticeClearBtn: $('noticeClearBtn'),

  toRankingBtn: $('toRankingBtn'),
  /* ヘルプと確認ダイアログ(v4.6) */
  toHelpBtn: $('toHelpBtn'),
  helpOverlay: $('helpOverlay'),
  helpCloseBtn: $('helpCloseBtn'),
  confirmOverlay: $('confirmOverlay'),
  confirmTitle: $('confirmTitle'),
  confirmText: $('confirmText'),
  confirmWarn: $('confirmWarn'),
  confirmOkBtn: $('confirmOkBtn'),
  confirmCancelBtn: $('confirmCancelBtn'),
  confirmCloseBtn: $('confirmCloseBtn'),
  rankOverlay: $('rankOverlay'),

  bonusOverlay: $('bonusOverlay'),
  bonusCloseBtn: $('bonusCloseBtn'),
  bonusLead: $('bonusLead'),
  bonusValue: $('bonusValue'),
  bonusStreak: $('bonusStreak'),
  bonusStreakNum: $('bonusStreakNum'),
  bonusClaimBtn: $('bonusClaimBtn'),
  bonusAdBox: $('bonusAdBox'),
  bonusAdBtn: $('bonusAdBtn'),
  bonusDone: $('bonusDone'),

  statTotalGain: $('statTotalGain'),
  statBestGain: $('statBestGain'),
  statStreak: $('statStreak'),
  statLoginDays: $('statLoginDays'),
  statCreated: $('statCreated'),
  rankCloseBtn: $('rankCloseBtn'),
  rankKindTabs: $('rankKindTabs'),
  rankDayTabs: $('rankDayTabs'),
  rankAllTimeBtn: $('rankAllTimeBtn'),
  rankYesterdayBtn: $('rankYesterdayBtn'),
  rankNote: $('rankNote'),
  rankList: $('rankList'),
  rankSelf: $('rankSelf'),
  friendOverlay: $('friendOverlay'),
  friendCloseBtn: $('friendCloseBtn'),
  friendTabs: $('friendTabs'),
  friendTabBadge: $('friendTabBadge'),
  friendListView: $('friendListView'),
  friendList: $('friendList'),
  friendReqView: $('friendReqView'),
  friendReqList: $('friendReqList'),
  friendOutList: $('friendOutList'),

  inviteBtn: $('inviteBtn'),
  inviteOverlay: $('inviteOverlay'),
  inviteCloseBtn: $('inviteCloseBtn'),
  inviteTabs: $('inviteTabs'),
  inviteFriendView: $('inviteFriendView'),
  inviteFriendList: $('inviteFriendList'),
  inviteUrlView: $('inviteUrlView'),
  inviteUrlText: $('inviteUrlText'),
  inviteUrlCopyBtn: $('inviteUrlCopyBtn'),
  inviteShareBtn: $('inviteShareBtn'),

  invitedOverlay: $('invitedOverlay'),
  invitedText: $('invitedText'),
  invitedAcceptBtn: $('invitedAcceptBtn'),
  invitedRejectBtn: $('invitedRejectBtn'),

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
  screenSingleSetup: $('screenSingleSetup'),
  singleBackBtn: $('singleBackBtn'),
  singleSeatSeg: $('singleSeatSeg'),
  setupPreview: $('setupPreview'),
  singleStartBtn: $('singleStartBtn'),
  screenLobby: $('screenLobby'),
  screenRoom: $('screenRoom'),
  screenCountdown: $('screenCountdown'),
  screenChampionEnd: $('screenChampionEnd'),
  standingsTitle: $('standingsTitle'),
  screenGame: $('screenGame'),

  toSettingsBtn: $('toSettingsBtn'),
  changelogBtn: $('changelogBtn'),
  changelogOverlay: $('changelogOverlay'),
  changelogCloseBtn: $('changelogCloseBtn'),

  lobbyBackBtn: $('lobbyBackBtn'),
  connBadge: $('connBadge'),
  createModeSeg: $('createModeSeg'),
  createSprintRow: $('createSprintRow'),
  sprintGoalSeg: $('sprintGoalSeg'),
  sprintGoalInput: $('sprintGoalInput'),
  sprintWarn: $('sprintWarn'),
  sprintChip: $('sprintChip'),
  sprintNow: $('sprintNow'),
  sprintGoalNum: $('sprintGoalNum'),
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
  readyBtn: $('readyBtn'),

  turnTimer: $('turnTimer'),
  turnRing: $('turnRing'),
  turnNum: $('turnNum'),

  a2hsBanner: $('a2hsBanner'),
  a2hsText: $('a2hsText'),
  a2hsCloseBtn: $('a2hsCloseBtn'),

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
  doubleBtn: $('doubleBtn'),
  surrenderBtn: $('surrenderBtn'),
  blackjackBtn: $('blackjackBtn'),
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
  profileAvatarChar: $('profileAvatarChar'),
  iconPicker: $('iconPicker'),
  iconSwatches: $('iconSwatches'),
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

  showPassBtn: $('showPassBtn'),
  passBox: $('passBox'),
  passCurrent: $('passCurrent'),
  passNext: $('passNext'),
  passConfirm: $('passConfirm'),
  passError: $('passError'),
  passCancelBtn: $('passCancelBtn'),
  passSubmitBtn: $('passSubmitBtn'),
  devSection: $('devSection'),
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
  devModeBtn: $('devModeBtn'),
  devPinOverlay: $('devPinOverlay'),
  devPinCloseBtn: $('devPinCloseBtn'),
  devPinInput: $('devPinInput'),
  devPinError: $('devPinError'),
  devPinSubmitBtn: $('devPinSubmitBtn'),
  devOverlay: $('devOverlay'),
  devCloseBtn: $('devCloseBtn'),
  devReloadBtn: $('devReloadBtn'),
  devSummary: $('devSummary'),
  devList: $('devList'),
  devDetailOverlay: $('devDetailOverlay'),
  devDetailCloseBtn: $('devDetailCloseBtn'),
  devDetailTitle: $('devDetailTitle'),
  devDetailBody: $('devDetailBody'),

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
  game: 'bj',            // bj | marble(いま選んでいるゲーム)(v4.0)
  mode: 'single',        // single | online
  onlineMode: 'enjoy',   // enjoy | champion (online時のみ有効)
  phase: 'bet',
  dealer: { hand: [], hole: true },
  seats: [],             // {name, level, medal, bet, hand, result, isYou, active, ready, cpu, eliminated}
  message: '',
  tone: '',
  streak: 0,             // 自分の連勝数(v3.0)
  spectating: false,     // 観戦中かどうか(v3.0)
  spectators: 0,
  sprintGoal: 0          // 早抜けモードの勝ち抜け条件(v3.2)
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

/* 中身が前回と変わったときだけ光らせる(v4.5)
   マーブルレースの秒読み中はサーバーから毎秒状態が届き、
   そのたびに renderMedal() が呼ばれていたため、
   メダルの数字が変わっていないのに毎秒点滅していた */
function ledSet(node, text){
  const next = String(text);
  if (node.textContent === next) return;
  node.textContent = next;
  ledTick(node);
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
    const notes = [];
    if (seat.result.doubled) notes.push('DOUBLE');
    if (seat.result.allInBonus) notes.push('全額ベット ×' + ALLIN_BONUS_RATE);
    const sub = notes.length ? '<span class="result-sub">' + esc(notes.join(' / ')) + '</span>' : '';
    tag = '<span class="result-badge" data-r="' + seat.result.kind + '">' + seat.result.label + sub + '</span>';
  } else if (seat.doubled && view.phase === 'play'){
    tag = '<span class="result-badge" data-r="push">DOUBLE</span>';
  } else if (view.mode === 'online' && view.phase === 'bet' && seat.ready){
    tag = '<span class="result-badge" data-r="push">READY</span>';
  }

  const lv = seat.level ? '<span class="member-lv">Lv.' + seat.level + '</span>' : '';
  const medalLabel = (view.mode === 'online' && view.onlineMode === 'champion') ? '大会メダル' : 'メダル';

  return '' +
    '<div class="seat-top">' +
      '<span class="seat-label">' + nameHTML(seat.name) + ' ' + lv + '</span>' +
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
    /* 結果に応じて背景色を変える(win=緑 / bj=金 / lose・surrender=グレー / push=青) */
    if (seat.result) box.dataset.result = seat.result.kind;
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

/* 画面に出す持ち分。シングル中は専用メダルを使う(v3.2) */
function activeMedal(){
  if (isSingleGame()) return single.medal;
  if (view.mode === 'online' && view.onlineMode !== 'enjoy' && !view.spectating){
    const me = view.seats.find(s => s.isYou);
    return me ? me.medal : 0;
  }
  return myMedal();
}

function renderMedal(){
  const tourney = view.mode === 'online' && view.onlineMode !== 'enjoy' && !view.spectating;

  /* チュートリアルは架空のメダルで進むので、席の値をそのまま出す(v3.3) */
  if (view.mode === 'tutorial'){
    const me = view.seats[0];
    if (el.medalLabel) el.medalLabel.textContent = '練習メダル';
    ledSet(el.medalCount, me ? me.medal : 1000);
    renderNorma();
    renderSprint();
    updateAdBtn();
    return;
  }

  if (isSingleGame()){
    if (el.medalLabel) el.medalLabel.textContent = '練習メダル';
    ledSet(el.medalCount, single.medal);
  } else if (tourney){
    const me = view.seats.find(s => s.isYou);
    if (el.medalLabel) el.medalLabel.textContent = '大会メダル';
    ledSet(el.medalCount, me ? me.medal : 0);
  } else {
    if (el.medalLabel) el.medalLabel.textContent = '所持メダル';
    ledSet(el.medalCount, myMedal());
  }
  renderNorma();
  renderSprint();
  updateAdBtn();
}

function betCap(){
  return activeMedal();
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
  el.spectatePanel.hidden = name !== 'spectate';
  el.singleEndPanel.hidden = name !== 'single-end';
  el.tutorialPanel.hidden = name !== 'tutorial';
  el.tutorialEndPanel.hidden = name !== 'tutorial-end';
  /* マーブルレース(v4.1) */
  el.mrBetPanel.hidden  = name !== 'mr-bet';
  el.mrWaitPanel.hidden = name !== 'mr-wait';
  /* チュートリアルでは、見せるだけの操作ボタンとガイドを同時に出す(v3.3)。
     実際の表示可否は showTutorialButtons() が決める */
  if (name === 'tutorial' && tutorial.active) el.actionPanel.hidden = true;
  /* 操作パネルはゲーム画面とマーブルレース画面で使う */
  el.controls.hidden    = (screen !== 'game' && screen !== 'marble')
                          || name === 'none';
}

/* =========================================================
   9. 画面遷移
   ========================================================= */
function showScreen(name){
  screen = name;
  el.body.dataset.screen = name;
  el.screenTitle.hidden = name !== 'title';
  el.screenGameSelect.hidden = name !== 'gameSelect';   // v4.0
  el.screenGameMenu.hidden = name !== 'gameMenu';       // v4.0
  el.screenSingleSetup.hidden = name !== 'singleSetup';
  el.screenLobby.hidden = name !== 'lobby';
  el.screenRoom.hidden  = name !== 'room';
  el.screenCountdown.hidden = name !== 'countdown';
  el.screenChampionEnd.hidden = name !== 'championEnd';
  el.screenGame.hidden  = name !== 'game';
  el.screenMarble.hidden = name !== 'marble';          // v4.1
  el.screenSlotHall.hidden = name !== 'slotHall';      // v5.0
  el.screenSlot.hidden = name !== 'slot';              // v5.0

  el.controls.hidden = (name !== 'game' && name !== 'marble');
  /* v3.2: シングルは専用メダルで完結するので広告は出さない。
     大会系(チャンピオン/早抜け)と観戦中も対象外。
     v4.1: マーブルレースでも広告でメダルを増やせる */
  el.adBtn.hidden = !((name === 'game' || name === 'marble')
                      && view.mode === 'online'
                      && !view.spectating && view.onlineMode === 'enjoy');
  /* チュートリアル中はヘッダーの各種ボタンを触らせない(v3.3) */
  if (view.mode === 'tutorial'){
    el.adBtn.hidden = true;
    el.roundChip.hidden = true;
  }
  el.medalReadout.hidden = !(name === 'game' || name === 'marble' || name === 'slot' || account.user);
  el.brandBtn.disabled = name === 'title';

  updateRoundChip();
  renderStreak();
  renderSpectateChip();
  renderSprint();
  /* v3.2: 画面が変わると持ち分の意味も変わる(練習メダル↔所持メダル)ので
     必ず表示を作り直す。これが無いとタイトルに戻っても練習メダルが残る */
  renderMedal();
  updateChatVisibility();
  window.scrollTo(0, 0);

  updateBonusBtn();
}

/* 連勝表示(v3.0)。2連勝から出し、5連勝以上は強調する */
function renderStreak(){
  const n = view.streak || 0;
  if (screen !== 'game' || n < STREAK_MIN_SHOW){
    el.streakChip.hidden = true;
    el.streakChip.classList.remove('is-hot');
    return;
  }
  const changed = el.streakChip.hidden || el.streakNum.textContent !== String(n);
  el.streakNum.textContent = n;
  el.streakChip.hidden = false;
  el.streakChip.classList.toggle('is-hot', n >= 5);
  if (changed){
    /* アニメーションを再生し直す */
    el.streakChip.style.animation = 'none';
    void el.streakChip.offsetWidth;
    el.streakChip.style.animation = '';
  }
}

function setStreak(n){
  const next = Math.max(0, Number(n) || 0);
  if (view.streak === next){ renderStreak(); return; }
  view.streak = next;
  renderStreak();
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
   9.5 ゲーム選択(v4.0)
   Betoria は複数のトランプゲームを扱うので、
   「いまどのゲームを見ているか」を view.game で持ち回す。
   ========================================================= */
const GAME_INFO = {
  bj: {
    name: 'BLACKJACK 4',
    jp: 'ブラックジャック',
    desc: '手札の合計を21に近づけてディーラーに勝つ、カジノの王道ゲームです。最大4人で対戦できます。',
    singleDesc: '練習メダル1000枚でCPUと遊ぶ',
    tutorial: true
  },
  marble: {
    name: 'MARBLE RACE',
    jp: 'マーブルレース',
    desc: '8つのボールが競い合うレースに投票します。単勝・複勝・馬連の3種類。会場は常時開催なので、1人でもすぐ遊べます。',
    singleDesc: '',
    tutorial: false,
    /* 部屋を作らず、常時開催の会場に入るだけ(v4.1) */
    hall: true
  },
  slot: {
    name: 'SLOT',
    jp: 'スロット',
    desc: '6台のうち好きな台に座って打つ本格的なパチスロです。設定は毎日0:00に変わります。台選びと目押しの腕がものを言います。',
    singleDesc: '',
    tutorial: false,
    /* 部屋を作らず、ホールで台を選ぶ(v5.0) */
    hall: true
  }
};

function gameInfo(g){ return GAME_INFO[g] || GAME_INFO.bj; }

function openGameSelect(){
  showScreen('gameSelect');
}

function openGameMenu(g){
  view.game = GAME_INFO[g] ? g : 'bj';
  const info = gameInfo(view.game);
  el.gameMenuTitle.textContent = info.name;
  el.gameMenuDesc.textContent = info.desc;
  el.gmSingleDesc.textContent = info.singleDesc;
  el.gmRankingDesc.textContent = info.jp + 'の獲得枚数ランキング';
  /* チュートリアルがあるのはブラックジャックだけ */
  el.gmTutorialBtn.hidden = !info.tutorial;

  /* マーブルレースとスロットは部屋を作らないので、
     シングルを隠してオンラインのボタンの文言を変える(v4.1 / v5.0) */
  const hall = !!info.hall;
  el.gmSingleBtn.hidden = hall;
  el.gmOnlineBtn.querySelector('.title-btn-name').textContent =
    !hall ? 'オンラインプレイ' : (g === 'slot' ? '台を選ぶ' : 'レース会場へ');
  el.gmOnlineBtn.querySelector('.title-btn-desc').textContent =
    !hall ? '部屋を作って友達と対戦'
          : (g === 'slot' ? '6台から好きな台を選んで打つ' : '常時開催。1人でもすぐ遊べます');
  el.gmOnlineBtn.querySelector('.title-btn-icon').textContent = hall ? '🏁' : '🌐';

  showScreen('gameMenu');
}

/* 選んでいるゲームのシングルプレイを始める */
function startSelectedSingle(){
  view.game = 'bj';
  openSingleSetup();
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
  if (!res.ok){
    /* v4.2: 別の端末でログインされていたら、その場でログアウトする */
    if (res.status === 401 && data.code === 'session'){
      forceLogout('別の端末でログインされました。\nこの端末からはログアウトしました。');
      throw new Error(data.error || '別の端末でログインされました');
    }
    throw new Error(data.error || '通信エラー (' + res.status + ')');
  }
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
  /* 次に開いたときに「新規登録」タブのままだと迷うので、ログインに戻しておく(v3.1) */
  setAuthMode('login');
  el.authName.value = '';
  el.authPass.value = '';
  renderAccountUi();
}

function renderAccountUi(){
  const u = account.user;
  if (u){
    el.accountBtn.classList.add('is-in');
    el.accountAvatar.textContent = u.username.charAt(0).toUpperCase();
    el.accountAvatar.dataset.iconColor = iconColorOf(u.iconColor);
    el.accountLv.textContent = 'Lv.' + u.level;
    el.accountLv.hidden = false;
  } else {
    el.accountBtn.classList.remove('is-in');
    el.accountAvatar.textContent = '?';
    delete el.accountAvatar.dataset.iconColor;
    el.accountLv.hidden = true;
  }
  el.medalReadout.hidden = !(screen === 'game' || screen === 'marble' || u);
  updateFriendBadge();
  updateNoticeBadge();
  updateBonusBtn();
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
  el.iconPicker.hidden = true;
  resetPassBox();
  updateDevVisibility();
  if (!u) return;

  el.profileAvatarChar.textContent = u.username.charAt(0).toUpperCase();
  el.profileAvatar.dataset.iconColor = iconColorOf(u.iconColor);
  renderIconSwatches();
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

  /* マーブルレースの戦績(v4.1) */
  const mp = u.mrRaces || 0, mh = u.mrHits || 0, mm = u.mrMisses || 0;
  el.mrRaces.textContent = mp;
  el.mrHits.textContent = mh;
  el.mrMisses.textContent = mm;
  const mrDecided = mh + mm;
  el.mrRate.textContent = mrDecided ? Math.round((mh / mrDecided) * 100) + '%' : '0%';
  el.mrTotalGain.textContent = Number(u.mrTotalGain || 0).toLocaleString();
  el.mrBestGain.textContent = Number(u.mrBestGain || 0).toLocaleString();

  /* メダル記録・ログイン記録(v3.2) */
  el.statTotalGain.textContent = Number(u.totalGain || 0).toLocaleString();
  el.statBestGain.textContent = Number(u.bestGain || 0).toLocaleString();
  el.statStreak.textContent = (u.loginStreak || 0) + '日';
  el.statLoginDays.textContent = (u.loginDays || 0) + '日';
  el.statCreated.textContent = fmtCreatedAt(u.createdAt);
}

/* アカウント作成日を YYYY/MM/DD で表示する(JST基準) */
function fmtCreatedAt(iso){
  if (!iso) return '-';
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '-';
  const d = new Date(t + 9 * 3600000);
  const p = (n) => String(n).padStart(2, '0');
  return d.getUTCFullYear() + '/' + p(d.getUTCMonth() + 1) + '/' + p(d.getUTCDate());
}

/* =========================================================
   10.4 アカウントアイコンの色(v3.0)
   ========================================================= */
function renderIconSwatches(){
  const now = iconColorOf(account.user && account.user.iconColor);
  el.iconSwatches.innerHTML = ICON_COLORS.map(c =>
    '<button type="button" class="icon-swatch' + (c.key === now ? ' is-on' : '') + '"' +
      ' data-icon-color="' + c.key + '" data-color="' + c.key + '"' +
      ' title="' + esc(c.name) + '" aria-label="' + esc(c.name) + '"></button>').join('');
}

let iconSaving = false;

async function applyIconColor(color){
  if (iconSaving) return;
  const key = iconColorOf(color);
  if (!account.user) return;
  if (account.user.iconColor === key){ el.iconPicker.hidden = true; return; }

  iconSaving = true;
  el.iconSwatches.querySelectorAll('.icon-swatch').forEach(b => { b.disabled = true; });
  try {
    const d = await api('/api/icon', { method: 'POST', body: JSON.stringify({ color: key }) });
    setAccount(d.user);
    audio.play('chip');
    el.iconPicker.hidden = true;
    toast('アイコンの色を変更しました');
  } catch (e){
    toast(e.message);
    audio.play('error');
  } finally {
    iconSaving = false;
    renderIconSwatches();
  }
}

/* =========================================================
   10.45 フレンド機能(v3.0)
   ========================================================= */
const friends = {
  list: [],        // 成立しているフレンド
  incoming: [],    // 自分宛の申請
  outgoing: [],    // 自分が送った申請
  onlineCount: 0,  // オンライン中のフレンド人数(v3.1)
  tab: 'list',
  loading: false,
  sent: new Set()  // このセッションで申請済みの相手(ボタンの二度押し防止)
};

function isFriend(name){ return friends.list.some(f => f.username === name); }
function friendPending(name){
  return friends.outgoing.some(f => f.username === name)
      || friends.incoming.some(f => f.username === name)
      || friends.sent.has(name);
}

function updateFriendBadge(){
  const n = friends.incoming.length;
  el.friendBtn.hidden = !account.user;
  el.friendBtn.classList.toggle('has-req', n > 0);
  el.friendBadge.textContent = n > 99 ? '99+' : n;
  el.friendBadge.hidden = n === 0;
  el.friendTabBadge.textContent = n > 99 ? '99+' : n;
  el.friendTabBadge.hidden = n === 0;

  /* ❤の下にオンライン中のフレンド人数を出す。0人でも「0」と表示する(v3.1) */
  const online = friends.onlineCount || 0;
  el.friendOnline.textContent = online;
  el.friendBtn.classList.toggle('has-online', online > 0);
  el.friendBtn.title = 'フレンド(オンライン ' + online + '人)';
}

async function loadFriends(silent){
  if (!account.user){
    friends.list = []; friends.incoming = []; friends.outgoing = [];
    friends.onlineCount = 0;
    updateFriendBadge();
    return;
  }
  if (friends.loading) return;
  friends.loading = true;
  try {
    const d = await api('/api/friends');
    friends.list = d.friends || [];
    friends.incoming = d.incoming || [];
    friends.outgoing = d.outgoing || [];
    friends.onlineCount = typeof d.onlineCount === 'number'
      ? d.onlineCount
      : friends.list.filter(f => f.online).length;
    /* サーバーの状態が正なので、ローカルの申請済みメモは掃除する */
    friends.sent.forEach(n => {
      if (!friends.outgoing.some(f => f.username === n) && !isFriend(n)) friends.sent.delete(n);
    });
  } catch (e){
    if (!silent) toast(e.message);
  } finally {
    friends.loading = false;
    updateFriendBadge();
    renderFriendViews();
    if (!el.inviteOverlay.hidden) renderInviteFriends();
    if (screen === 'room' && online.state) renderRoomScreen(online.state);
  }
}

function friendRowMarkup(f, actions){
  return '' +
    '<div class="friend-row' + (f.online ? ' is-online' : '') + '" data-user="' + esc(f.username) + '">' +
      '<span class="friend-avatar" data-icon-color="' + iconColorOf(f.iconColor) + '">' +
        esc(f.username.charAt(0).toUpperCase()) +
        '<span class="friend-dot"></span>' +
      '</span>' +
      '<span class="friend-main">' +
        '<span class="friend-name">' + nameHTML(f.username) + '</span>' +
        '<span class="friend-meta">' +
          '<span class="friend-lv">Lv.' + f.level + '</span>' +
          '<span class="friend-seen">' + esc(formatLastSeen(f)) + '</span>' +
        '</span>' +
      '</span>' +
      '<span class="friend-actions">' + actions + '</span>' +
    '</div>';
}

function renderFriendViews(){
  /* フレンド一覧 */
  el.friendList.innerHTML = friends.list.length
    ? friends.list.map(f => friendRowMarkup(f,
        '<button type="button" class="friend-act is-danger" data-act="remove">解除</button>')).join('')
    : '<p class="empty-note">まだフレンドがいません。<br>待機ルームで他のプレイヤーに申請を送ってみましょう。</p>';

  /* 届いている申請 */
  el.friendReqList.innerHTML = friends.incoming.length
    ? friends.incoming.map(f => friendRowMarkup(f,
        '<button type="button" class="friend-act is-ok" data-act="accept">承認</button>' +
        '<button type="button" class="friend-act is-danger" data-act="reject">拒否</button>')).join('')
    : '<p class="empty-note">届いているフレンド申請はありません。</p>';

  /* 自分が送った申請 */
  el.friendOutList.innerHTML = friends.outgoing.length
    ? friends.outgoing.map(f => friendRowMarkup(f,
        '<button type="button" class="friend-act is-danger" data-act="cancel">取消</button>')).join('')
    : '<p class="empty-note">送信中の申請はありません。</p>';
}

function setFriendTab(tab){
  friends.tab = tab;
  el.friendTabs.querySelectorAll('.seg-btn').forEach(b =>
    b.classList.toggle('is-on', b.dataset.tab === tab));
  el.friendListView.hidden = tab !== 'list';
  el.friendReqView.hidden = tab !== 'requests';
}

function openFriendPanel(){
  if (!account.user){
    toast('フレンド機能にはログインが必要です');
    return openOverlay(el.accountOverlay);
  }
  setFriendTab(friends.incoming.length > 0 ? 'requests' : 'list');
  renderFriendViews();
  openOverlay(el.friendOverlay);
  loadFriends(true);
}

async function friendAction(path, username, okMsg){
  try {
    await api('/api/friends/' + path, {
      method: 'POST', body: JSON.stringify({ username })
    });
    audio.play('join');
    if (okMsg) toast(okMsg);
    await loadFriends(true);
    return true;
  } catch (e){
    audio.play('error');
    toast(e.message);
    await loadFriends(true);
    return false;
  }
}

async function removeFriend(username){
  if (!confirm('「' + username + '」とのフレンドを解除しますか?')) return;
  try {
    await api('/api/friends', { method: 'DELETE', body: JSON.stringify({ username }) });
    toast('フレンドを解除しました');
    audio.play('button');
  } catch (e){ toast(e.message); audio.play('error'); }
  await loadFriends(true);
}

/* 待機ルームからのフレンド申請 */
async function sendFriendRequest(username, btn){
  if (btn) btn.disabled = true;
  friends.sent.add(username);
  const ok = await friendAction('request', username, username + ' さんにフレンド申請を送りました');
  if (!ok) friends.sent.delete(username);
  if (screen === 'room' && online.state) renderRoomScreen(online.state);
}

/* =========================================================
   10.45 パスワード変更 / 開発者モードの表示制御(v3.1)
   ========================================================= */
/* 開発者モードはオーナーアカウントでログイン中のときだけ見せる。
   ただし見た目を隠すだけでは不十分なので、サーバー側でも
   「オーナー本人 + 暗証番号」の二重チェックをしている */
function isOwnerUser(){
  return !!(account.user && account.user.isOwner);
}

function updateDevVisibility(){
  if (el.devSection) el.devSection.hidden = !isOwnerUser();
}

function resetPassBox(){
  if (!el.passBox) return;
  el.passBox.hidden = true;
  el.passCurrent.value = '';
  el.passNext.value = '';
  el.passConfirm.value = '';
  el.passError.hidden = true;
  el.passSubmitBtn.disabled = false;
}

function passFail(msg){
  el.passError.textContent = msg;
  el.passError.hidden = false;
  audio.play('error');
}

async function submitPasswordChange(){
  const current = el.passCurrent.value.trim();
  const next = el.passNext.value.trim();
  const confirm2 = el.passConfirm.value.trim();

  if (!current || !next || !confirm2) return passFail('すべての欄を入力してください');
  if (!/^[A-Za-z0-9]{1,8}$/.test(next)) return passFail('新しいパスワードは英数字1〜8文字です');
  if (next !== confirm2) return passFail('新しいパスワードが一致しません');
  if (current === next) return passFail('現在のパスワードと同じです');

  el.passSubmitBtn.disabled = true;
  el.passError.hidden = true;
  try {
    const d = await api('/api/password', {
      method: 'POST',
      body: JSON.stringify({ current, next })
    });
    /* 変更後は新しいトークンに差し替える(古い端末のセッションは無効になる) */
    setAccount(d.user, d.token);
    resetPassBox();
    audio.play('win');
    toast('パスワードを変更しました');
  } catch (e){
    passFail(e.message);
  } finally {
    el.passSubmitBtn.disabled = false;
  }
}

/* =========================================================
   10.46 通知(v3.2)
   ========================================================= */
const notices = { list: [], unread: 0, loading: false };

function updateNoticeBadge(){
  el.noticeBtn.hidden = !account.user;
  const n = notices.unread || 0;
  el.noticeCount.textContent = n;
  el.noticeBtn.classList.toggle('has-unread', n > 0);
  el.noticeBadge.textContent = n > 99 ? '99+' : n;
  el.noticeBadge.hidden = n === 0;
  el.noticeBtn.title = n > 0 ? '通知(未読 ' + n + '件)' : '通知';
}

async function loadNotices(silent){
  if (!account.user){
    notices.list = []; notices.unread = 0;
    updateNoticeBadge();
    return;
  }
  if (notices.loading) return;
  notices.loading = true;
  try {
    const d = await api('/api/notices');
    notices.list = d.notices || [];
    notices.unread = d.unread || 0;
  } catch (e){
    if (!silent) toast(e.message);
  } finally {
    notices.loading = false;
    updateNoticeBadge();
    if (!el.noticeOverlay.hidden) renderNoticeList();
  }
}

const NOTICE_ICON = { friend: '🤝', invite: '✉', rank: '🏆', bonus: '🎁' };

function renderNoticeList(){
  if (!notices.list.length){
    el.noticeList.innerHTML = '<p class="empty-note">通知はまだありません。</p>';
    el.noticeClearBtn.hidden = true;
    return;
  }
  el.noticeClearBtn.hidden = false;
  el.noticeList.innerHTML = notices.list.map(n =>
    '<div class="notice-row' + (n.read ? '' : ' is-unread') + '">' +
      '<span class="notice-icon">' + (NOTICE_ICON[n.kind] || '📣') + '</span>' +
      '<span class="notice-main">' +
        '<span class="notice-title">' + esc(n.title) + '</span>' +
        (n.body ? '<span class="notice-body">' + esc(n.body) + '</span>' : '') +
        '<span class="notice-at">' + esc(noticeTime(n.at)) + '</span>' +
      '</span>' +
    '</div>').join('');
}

function noticeTime(iso){
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  const diff = Date.now() - t;
  if (diff < 60000) return 'たった今';
  if (diff < 3600000) return Math.floor(diff / 60000) + '分前';
  if (diff < 86400000) return Math.floor(diff / 3600000) + '時間前';
  const d = new Date(t);
  return (d.getMonth() + 1) + '/' + d.getDate();
}

async function openNoticePanel(){
  if (!account.user){
    toast('通知の確認にはログインが必要です');
    return openOverlay(el.accountOverlay);
  }
  renderNoticeList();
  openOverlay(el.noticeOverlay);
  await loadNotices(true);
  /* 開いた時点で既読にする */
  if (notices.unread > 0){
    try {
      await api('/api/notices/read', { method: 'POST' });
      notices.unread = 0;
      notices.list = notices.list.map(n => Object.assign({}, n, { read: true }));
      updateNoticeBadge();
      renderNoticeList();
    } catch {}
  }
}

/* =========================================================
   10.47 ランキング(v3.2)
   ========================================================= */
const ranking = { game: 'bj', kind: 'total', day: 'today', data: null, loading: false };

const RANK_NOTES = {
  total: 'その日にラウンドで勝って得たメダルの合計です(ログインボーナス・広告は含みません)。',
  best: 'その日の中で、1ラウンドの勝利で得た最も多いメダル枚数です。',
  alltime: 'サービス開始からの一撃獲得枚数の記録です。記録した日も表示されます。'
};

/* v4.0: ランキングはゲームごとに完全に分かれている */
function setRankGame(g){
  const next = GAME_INFO[g] ? g : 'bj';
  if (ranking.game === next) return;
  ranking.game = next;
  syncRankTabs();
  loadRanking();
}

function setRankKind(kind){
  ranking.kind = kind;
  /* 「歴代」は一撃獲得枚数だけの機能 */
  if (kind === 'total' && ranking.day === 'alltime') ranking.day = 'today';
  syncRankTabs();
  loadRanking();
}

function setRankDay(day){
  ranking.day = day;
  if (day === 'alltime') ranking.kind = 'best';
  syncRankTabs();
  loadRanking();
}

function syncRankTabs(){
  el.rankGameTabs.querySelectorAll('.seg-btn').forEach(b =>
    b.classList.toggle('is-on', b.dataset.rgame === ranking.game));
  el.rankKindTabs.querySelectorAll('.seg-btn').forEach(b =>
    b.classList.toggle('is-on', b.dataset.kind === ranking.kind));
  el.rankDayTabs.querySelectorAll('.seg-btn').forEach(b =>
    b.classList.toggle('is-on', b.dataset.day === ranking.day));
  /* 総獲得枚数には歴代がないので押せなくする */
  el.rankAllTimeBtn.disabled = ranking.kind === 'total';
  el.rankNote.textContent = ranking.day === 'alltime'
    ? RANK_NOTES.alltime : RANK_NOTES[ranking.kind];
}

async function loadRanking(){
  if (ranking.loading) return;
  ranking.loading = true;
  el.rankList.innerHTML = '<p class="empty-note">読み込み中…</p>';
  el.rankSelf.hidden = true;
  try {
    const d = await api('/api/ranking?day=' + encodeURIComponent(ranking.day) +
                       '&game=' + encodeURIComponent(ranking.game));
    /* 未接続でもオーナーに👑を付けられるようにする(v4.6) */
    if (d && d.owner) online.ownerName = d.owner;
    ranking.data = d;
    if (d.label && ranking.day === 'yesterday'){
      el.rankYesterdayBtn.textContent = '前日(' + d.label + ')';
    }
    renderRankList();
  } catch (e){
    el.rankList.innerHTML = '<p class="empty-note">' + esc(e.message) + '</p>';
  } finally {
    ranking.loading = false;
  }
}

function renderRankList(){
  const d = ranking.data;
  if (!d) return;
  const rows = ranking.day === 'alltime' ? (d.best || [])
             : (ranking.kind === 'total' ? (d.total || []) : (d.best || []));

  if (!rows.length){
    el.rankList.innerHTML = '<p class="empty-note">' +
      esc(gameInfo(ranking.game).name) + ' の記録はまだありません。<br>' +
      'オンラインで勝つと記録されます。</p>';
    return;
  }

  const me = account.user ? account.user.username : null;
  el.rankList.innerHTML = rows.map(r => {
    const top = r.rank <= 3 ? ' is-top is-top' + r.rank : '';
    const mine = me && r.username === me ? ' is-me' : '';
    const crown = r.rank === 1 ? '👑' : (r.rank === 2 ? '🥈' : (r.rank === 3 ? '🥉' : ''));
    return '' +
      '<div class="rank-row' + top + mine + '">' +
        '<span class="rank-no">' +
          (crown ? '<span class="rank-crown">' + crown + '</span>' : '') +
          '<span class="rank-num">' + r.rank + '</span>' +
          '<span class="rank-suffix">位</span>' +
        '</span>' +
        '<span class="rank-avatar" data-icon-color="' + iconColorOf(r.iconColor) + '">' +
          esc(String(r.username).charAt(0).toUpperCase()) + '</span>' +
        '<span class="rank-main">' +
          '<span class="rank-name">' + nameHTML(r.username) + '</span>' +
          '<span class="rank-meta">' +
            '<span class="rank-lv">Lv.' + r.level + '</span>' +
            (r.date ? '<span class="rank-date">' + esc(fmtRankDate(r.date)) + '</span>' : '') +
          '</span>' +
        '</span>' +
        '<span class="rank-medal led">' + Number(r.medal).toLocaleString() + '</span>' +
      '</div>';
  }).join('');

  /* 自分が圏外なら、自分の記録を下に出す */
  renderRankSelf(rows);
}

function fmtRankDate(key){
  const p = String(key).split('-');
  return p.length === 3 ? p[0] + '/' + Number(p[1]) + '/' + Number(p[2]) : key;
}

function renderRankSelf(rows){
  const u = account.user;
  if (!u){ el.rankSelf.hidden = true; return; }
  if (rows.some(r => r.username === u.username)){ el.rankSelf.hidden = true; return; }

  /* 圏外のときは自分の記録だけ表示する(順位は出せないので「-」) */
  const val = ranking.day === 'alltime'
    ? (ranking.game === 'marble' ? u.mrBestGain : u.bestGain) : null;
  if (ranking.day !== 'alltime'){ el.rankSelf.hidden = true; return; }
  el.rankSelf.hidden = false;
  el.rankSelf.innerHTML =
    '<p class="rank-self-cap">あなたの記録</p>' +
    '<div class="rank-row is-me">' +
      '<span class="rank-no"><span class="rank-num">-</span></span>' +
      '<span class="rank-avatar" data-icon-color="' + iconColorOf(u.iconColor) + '">' +
        esc(u.username.charAt(0).toUpperCase()) + '</span>' +
      '<span class="rank-main"><span class="rank-name">' + nameHTML(u.username) + '</span>' +
        '<span class="rank-meta"><span class="rank-lv">Lv.' + u.level + '</span></span></span>' +
      '<span class="rank-medal led">' + Number(val || 0).toLocaleString() + '</span>' +
    '</div>';
}

function openRankPanel(game){
  /* ゲームメニューから開いたときは、そのゲームのランキングを最初に出す(v4.0) */
  if (game && GAME_INFO[game]) ranking.game = game;
  syncRankTabs();
  openOverlay(el.rankOverlay);
  loadRanking();
}

/* =========================================================
   退出の確認(v4.6)

   標準の confirm() だと赤字の注意書きが出せないので、
   サイトの見た目に合わせた確認画面を用意した。
   使い方: askConfirm({ text, warn, okText }).then(ok => ...)
   ========================================================= */
let confirmResolve = null;

function askConfirm({ title, text, warn, okText } = {}){
  el.confirmTitle.textContent = title || '確認';
  el.confirmText.textContent = text || '本当によろしいですか?';
  el.confirmWarn.hidden = !warn;
  if (warn) el.confirmWarn.textContent = warn;
  el.confirmOkBtn.textContent = okText || '退出する';

  openOverlay(el.confirmOverlay);
  audio.play('button');

  return new Promise((resolve) => {
    /* 前の確認が残っていたら、キャンセル扱いで閉じておく */
    if (confirmResolve) confirmResolve(false);
    confirmResolve = resolve;
  });
}

function closeConfirm(ok){
  closeOverlay(el.confirmOverlay);
  const fn = confirmResolve;
  confirmResolve = null;
  if (fn) fn(!!ok);
}

/* ヘルプ(v4.6)。サイト全体の説明。ゲームのルールとは別 */
function openHelp(){
  audio.play('button');
  openOverlay(el.helpOverlay);
}

/* ルールシートの表示をゲームごとに切り替える(v4.0) */
function setRulesGame(g){
  const next = GAME_INFO[g] ? g : 'bj';
  el.rulesGameTabs.querySelectorAll('.seg-btn').forEach(b =>
    b.classList.toggle('is-on', b.dataset.ruleg === next));
  el.rulesBj.hidden = next !== 'bj';
  el.rulesMarble.hidden = next !== 'marble';
  el.rulesSlot.hidden = next !== 'slot';        // v5.0
}

/* ルールを開く。指定が無ければ、いま選んでいるゲームを出す */
function openRules(game){
  setRulesGame(game || view.game || 'bj');
  openOverlay(el.rulesOverlay);
}

/* =========================================================
   10.48 日付の切り替わり監視(v3.2)
   JSTの0:00をまたいだらタイトルに戻し、通知とランキングを読み直す。
   サーバーからの day:changed が届かない場合の保険として、
   クライアント側でも自前で見張る。
   ========================================================= */
function jstToday(){
  return new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
}

let currentDay = jstToday();
let dayChanging = false;

function onDayChanged(){
  const now = jstToday();
  if (now === currentDay || dayChanging) return;
  dayChanging = true;
  currentDay = now;

  /* 対戦中に強制的に飛ばすと迷惑なので、ゲーム中は終わってから案内する */
  const inGame = screen === 'game' || screen === 'marble'
              || screen === 'room' || screen === 'countdown';
  if (inGame && view.mode === 'online'){
    toast('日付が変わりました。ゲーム終了後にタイトルへ戻ります');
    dayChanging = false;
    return;
  }

  alert('日付が変わりました。タイトル画面に戻ります');
  if (online.socket && online.roomId) online.socket.emit('room:leave');
  resetOnlineRoomView();
  showScreen('title');
  refreshAccount().then(() => checkBonus(true));
  loadNotices(true);
  dayChanging = false;
}

function startDayWatch(){
  setInterval(() => {
    if (jstToday() !== currentDay) onDayChanged();
  }, 20000);
}

/* サーバーから最新のアカウント情報を取り直す */
async function refreshAccount(){
  if (!account.user) return;
  try {
    const d = await api('/api/me');
    setAccount(d.user);
  } catch {}
}

/* =========================================================
   10.49 ログインボーナス(v3.2)
   その日はじめてタイトルに来たときに出す。基本500枚 + 広告で500枚。
   広告は最後まで見る必要があるので、スキップ不可の30秒で再生する。
   ========================================================= */
const bonus = { open: false, checking: false, shown: false };

function renderBonus(){
  updateBonusBtn();
  const u = account.user;
  if (!u) return;
  const canBase = !!u.bonusReady;
  const canAd = !!u.bonusAdReady;

  el.bonusClaimBtn.hidden = !canBase;
  el.bonusAdBox.hidden = !canAd;
  el.bonusDone.hidden = canBase || canAd;
  el.bonusValue.textContent = canBase ? 500 : (canAd ? 500 : 0);
  el.bonusLead.textContent = canBase
    ? '本日のログインボーナスです!'
    : (canAd ? '広告を見るともう500メダル受け取れます' : '');
  el.bonusLead.hidden = !canBase && !canAd;

  const streak = u.loginStreak || 0;
  el.bonusStreak.hidden = streak < 1 || canBase;
  el.bonusStreakNum.textContent = streak;
}

/* ログイン直後・日付切替後に、受け取れるボーナスがあれば自動で開く。
   ただし他の画面や別のシートを開いている最中に割り込むと操作の邪魔になるので、
   タイトル画面で何も開いていないときだけ出す(v3.2) */
function canShowBonus(){
  if (screen !== 'title') return false;
  const overlays = [el.accountOverlay, el.rulesOverlay, el.settingsOverlay,
    el.changelogOverlay, el.surrenderOverlay, el.devPinOverlay, el.devOverlay,
    el.helpOverlay, el.confirmOverlay,
    el.friendOverlay, el.inviteOverlay, el.rankOverlay, el.noticeOverlay,
    el.invitedOverlay, el.adOverlay];
  return overlays.every(o => !o || o.hidden);
}

async function checkBonus(auto){
  if (!account.user || bonus.checking) return;
  bonus.checking = true;
  try {
    const s = await api('/api/bonus');
    account.user.bonusReady = !s.claimed;
    account.user.bonusAdReady = s.claimed && !s.adClaimed;
    /* 自動で開くのは1セッションにつき1回だけ。
       閉じたあとはタイトルの「ログインボーナス」ボタンから開ける */
    if (auto && !s.claimed && !bonus.shown && canShowBonus()){
      bonus.shown = true;
      renderBonus();
      openOverlay(el.bonusOverlay);
      audio.play('join');
    }
  } catch {} finally {
    bonus.checking = false;
    updateBonusBtn();
  }
}

/* v3.2: タイトルの常設ボタンは廃止した。
   ・基本の500が未受取 → 開き直せばまた案内する
   ・広告分は「見る」か「閉じる」で、その日は完結させる */
function updateBonusBtn(){ /* 何もしない(互換のため残す) */ }

async function claimBonus(){
  el.bonusClaimBtn.disabled = true;
  try {
    const d = await api('/api/bonus', { method: 'POST' });
    setAccount(d.user);
    audio.play('win');
    showFx('bonus');
    toast('+' + d.reward + ' メダル(連続ログイン ' + d.streak + '日目)');
    renderBonus();
  } catch (e){
    toast(e.message);
    audio.play('error');
    renderBonus();
  } finally {
    el.bonusClaimBtn.disabled = false;
  }
}

/* 広告分。必ず最後まで見てもらう */
async function claimBonusAd(){
  if (!account.user || !account.user.bonusAdReady) return;
  closeOverlay(el.bonusOverlay);
  const watched = await playAd({ forced: true });
  if (!watched){
    /* 途中でやめた場合は受け取らせない */
    openOverlay(el.bonusOverlay);
    renderBonus();
    return;
  }
  try {
    const d = await api('/api/bonus/ad', { method: 'POST' });
    setAccount(d.user);
    audio.play('win');
    toast('+' + d.reward + ' メダルを受け取りました');
  } catch (e){ toast(e.message); }
  /* v3.2: 見終わったらボーナス画面には戻さず、そのままタイトルに残す。
     戻すと「+0メダル」と表示されて紛らわしいため */
  if (screen !== 'title') showScreen('title');
}

/* ボーナス画面を閉じる。広告の案内が出ている段階で閉じたら、
   その日はもう案内しない(v3.2) */
async function closeBonusPanel(){
  const skipAd = !!(account.user && account.user.bonusAdReady);
  closeOverlay(el.bonusOverlay);
  if (!skipAd) return;
  try {
    const d = await api('/api/bonus/skipad', { method: 'POST' });
    setAccount(d.user);
  } catch {}
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
  double:    'DOUBLE DOWN!',
  bonus:     'LOGIN BONUS!',
  clear:     'GAME CLEAR!',
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
    loadFriends(true);
    loadNotices(true);
    checkBonus(true);
    /* 招待URLから来ていた場合は、ログイン完了後に参加する(v3.0) */
    resumeInviteJoin();
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
/* v3.2: シングルプレイはアカウントのメダルを一切消費しない練習モードになった。
   ゲーム開始のたびに専用メダル1000枚が配られ、その中だけで完結する。
   EXP・戦績は今まで通りアカウントに反映される。 */
const SINGLE_START_MEDAL = 1000;
const NORMA_MIN = 1100;    // ノルマの下限(配布額より上でないと意味がない)
const NORMA_MAX = 999999;

const single = {
  busy: false, activeIndex: -1, resolveTurn: null,
  medal: SINGLE_START_MEDAL,   // シングル専用の持ち分
  norma: false,                // ノルマモードかどうか
  normaTarget: 5000,           // 目標メダル
  over: false                  // クリア/ゲームオーバーで終了したか
};

/* シングル中は専用メダル、それ以外はアカウント(またはゲスト)のメダルを見る */
function isSingleGame(){
  return view.mode === 'single' && screen === 'game';
}

function makeSingleSeats(count){
  const prev = new Map(view.seats.map(s => [s.name, s.medal]));
  const seats = [{
    name: account.user ? account.user.username : 'あなた',
    level: account.user ? account.user.level : 0,
    medal: single.medal, bet: 0, hand: [], result: null,
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

/* シングルプレイの準備画面(人数選択) */
function openSingleSetup(){
  view.mode = 'single';
  renderSingleSetup();
  showScreen('singleSetup');
}

function renderSingleSetup(){
  el.singleSeatSeg.querySelectorAll('.seg-btn').forEach(b =>
    b.classList.toggle('is-on', Number(b.dataset.seats) === settings.seats));
  renderNormaSetup();

  const you = account.user ? account.user.username : 'あなた';
  const color = account.user ? iconColorOf(account.user.iconColor) : '';
  const items = ['<div class="preview-seat is-you">' +
      '<span class="preview-avatar"' + (color ? ' data-icon-color="' + color + '"' : '') + '>' +
      esc(you.charAt(0).toUpperCase()) + '</span>' +
      '<span class="preview-name">' + esc(you) + '</span></div>'];
  for (let i = 1; i < settings.seats; i++){
    items.push('<div class="preview-seat">' +
      '<span class="preview-avatar">🤖</span>' +
      '<span class="preview-name">' + esc(CPU_NAMES[i - 1]) + '</span></div>');
  }
  el.setupPreview.innerHTML = items.join('');
}

async function startSingle(){
  view.mode = 'single';
  view.onlineMode = 'enjoy';
  buildShoe();
  shownCount.clear();
  setStreak(0);

  /* 毎回ここで専用メダルを配り直す。アカウントのメダルには一切触れない(v3.2) */
  single.medal = SINGLE_START_MEDAL;
  single.over = false;
  single.norma = settings.normaOn;
  single.normaTarget = clampNorma(settings.normaTarget);

  view.seats = [];   // 前回の持ち分を引き継がないよう作り直す
  makeSingleSeats(settings.seats);

  /* オンラインと同じく、開始前に3・2・1のカウントダウンを見せる */
  await runCountdown();

  showScreen('game');
  renderMedal();
  if (single.norma){
    toast('ノルマモード: ' + single.normaTarget + ' メダルを目指しましょう');
  }
  singleBetPhase();
}

function clampNorma(v){
  const n = Math.floor(Number(v) || 0);
  if (!Number.isFinite(n)) return NORMA_MIN;
  return Math.min(NORMA_MAX, Math.max(NORMA_MIN, n));
}

/* 3→2→1→GO のカウントダウン画面(シングル用) */
function runCountdown(){
  return new Promise((resolve) => {
    showScreen('countdown');
    let n = COUNTDOWN_SEC;
    showCountdown(n);
    const id = setInterval(() => {
      n--;
      if (n <= 0){
        clearInterval(id);
        showCountdown(0);
        setTimeout(resolve, 620);
        return;
      }
      showCountdown(n);
    }, 1000);
  });
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
    s.doubled = false;
    if (s.cpu && s.medal < MIN_BET) s.medal = CPU_REFILL;
  });
  view.seats[0].medal = single.medal;
  view.seats[0].name = account.user ? account.user.username : 'あなた';
  view.seats[0].level = account.user ? account.user.level : 0;

  /* ノルマ達成 / メダル切れの判定はベットに入る前に行う(v3.2) */
  if (single.norma && single.medal >= single.normaTarget) return singleFinish('clear');
  if (single.medal < MIN_BET) return singleFinish('over');

  renderTable();
  renderMedal();
  renderBet();
  showPanel('bet');
  el.dealBtn.textContent = 'カードを配る';
  setMessage('ベット額を決めてください');
}

/* シングルの終了(ノルマ達成 or メダル切れ)(v3.2) */
function singleFinish(kind){
  single.over = true;
  single.busy = false;
  view.phase = 'result';
  renderTable();
  renderMedal();
  showPanel('single-end');

  const clear = kind === 'clear';
  el.singleEndTitle.textContent = clear ? 'ゲームクリア!' : 'ゲームオーバー';
  el.singleEndTitle.classList.toggle('is-clear', clear);
  el.singleEndTitle.classList.toggle('is-over', !clear);

  if (clear){
    el.singleEndText.innerHTML =
      '目標の <b>' + single.normaTarget + '</b> メダルを達成しました!<br>' +
      '最終メダル: <b>' + single.medal + '</b>';
    audio.play('win');
    showFx('clear');
  } else {
    el.singleEndText.innerHTML = single.norma
      ? 'メダルが尽きてしまいました…<br>目標は <b>' + single.normaTarget + '</b> メダルでした。'
      : 'メダルが尽きました。<br>お疲れさまでした!';
    audio.play('lose');
  }
  setMessage(clear ? 'ゲームクリア!' : 'ゲームオーバー', clear ? 'good' : 'alert');
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

  view.seats.forEach(s => { if (isBlackjack(s.hand) && !s.isYou) s.done = true; });

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
  const isBj = !!seat && isBlackjack(seat.hand) && !seat.done;

  /* ブラックジャックの時は宣言ボタンだけを見せる */
  el.hitBtn.hidden = isBj;
  el.standBtn.hidden = isBj;
  el.hitBtn.disabled = off;
  el.standBtn.disabled = off;

  const twoCards = !!seat && seat.hand.length === 2 && !seat.done && !isBj;

  const canSurrender = twoCards;
  el.surrenderBtn.hidden = !canSurrender;
  el.surrenderBtn.disabled = off;

  /* ダブルダウン: 最初の2枚 かつ 同額を追加で払えるときだけ選べる */
  const canDouble = twoCards && !seat.doubled && seat.medal >= seat.bet;
  el.doubleBtn.hidden = !twoCards;
  el.doubleBtn.disabled = off || !canDouble;

  el.blackjackBtn.hidden = !isBj;
  el.blackjackBtn.disabled = off;
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

/* ダブルダウン: ベットを倍にして1枚だけ引き、そのままSTANDになる(v3.0) */
async function singleDouble(){
  if (view.phase !== 'play' || single.busy) return;
  const seat = view.seats[single.activeIndex];
  if (!seat || !seat.isYou || seat.done || seat.doubled) return;
  if (seat.hand.length !== 2 || isBlackjack(seat.hand)) return;

  const extra = seat.bet;
  /* seat.medal は最初のベットを引いた残り。ここからさらに同額を払えるかを見る */
  if (extra <= 0 || seat.medal < extra) return toast('メダルが足りないためダブルダウンできません');

  single.busy = true;
  disableActionButtons();
  audio.play('chip');
  showFx('double');

  /* 追加ベット分は席の持ち分から引く(アカウントへの反映は精算時にまとめて行う) */
  seat.medal -= extra;
  seat.bet += extra;
  seat.doubled = true;
  renderTable();
  await sleep(REVEAL_MS * 0.6);

  seat.hand.push(drawCard());
  audio.play('deal');
  renderTable();
  await sleep(DEAL_MS);

  const v = handValue(seat.hand);
  if (v.bust){
    audio.play('bust');
    showFx('bust');
    setMessage('バースト! ' + v.total, 'alert');
  } else {
    setMessage('ダブルダウン ' + v.total + ' でスタンド');
  }
  await sleep(REVEAL_MS);

  single.busy = false;
  if (single.resolveTurn) single.resolveTurn();
}

function singleStand(){
  if (view.phase !== 'play' || single.busy) return;
  const seat = view.seats[single.activeIndex];
  if (!seat || !seat.isYou || seat.done) return;
  audio.play('button');
  showFx('stand');
  disableActionButtons();
  if (single.resolveTurn) single.resolveTurn();
}

function singleSurrender(){
  if (view.phase !== 'play' || single.busy) return;
  const seat = view.seats[single.activeIndex];
  if (!seat || !seat.isYou || seat.done || seat.hand.length !== 2) return;
  audio.play('button');
  showFx('surrender');
  disableActionButtons();
  seat.surrendered = true;
  if (single.resolveTurn) single.resolveTurn();
}

function singleBlackjack(){
  if (view.phase !== 'play' || single.busy) return;
  const seat = view.seats[single.activeIndex];
  if (!seat || !seat.isYou || seat.done || !isBlackjack(seat.hand)) return;
  audio.play('bj');
  showFx('blackjack');
  disableActionButtons();
  if (single.resolveTurn) single.resolveTurn();
}

function disableActionButtons(){
  el.hitBtn.disabled = true;
  el.standBtn.disabled = true;
  el.doubleBtn.disabled = true;
  el.surrenderBtn.disabled = true;
  el.blackjackBtn.disabled = true;
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
    s.result.doubled = !!s.doubled;
    s.medal += s.result.payout;
  });

  const me = view.seats[0];

  /* 連勝カウント: WIN / BLACKJACK で加算、PUSHは維持、それ以外はリセット */
  if (me.result){
    if (me.result.kind === 'bj' || me.result.kind === 'win') setStreak((view.streak || 0) + 1);
    else if (me.result.kind !== 'push') setStreak(0);
  }

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
        /* v3.2: シングルはメダルを消費しないので、EXPと戦績だけを送る */
        const d = await api('/api/result', {
          method: 'POST',
          body: JSON.stringify({ kind: me.result.kind, practice: true })
        });
        setAccount(d.user);
        if (d.levelUp > 0) showLevelUp(d.user.level);
      } catch (e){ console.warn('[result]', e.message); }
    }
    /* 専用メダルを更新する。アカウント・ゲストのメダルには触れない */
    single.medal = me.medal;
  }

  renderTable();
  renderMedal();
  single.busy = false;
  el.nextBtn.textContent = '次のラウンドへ';
  showPanel('next');
}

/* =========================================================
   11.1 ノルマモード(v3.2)
   ========================================================= */
function renderNormaSetup(){
  el.normaCheck.classList.toggle('is-on', settings.normaOn);
  el.normaCheck.setAttribute('aria-checked', String(settings.normaOn));
  el.normaTargetRow.hidden = !settings.normaOn;

  const preset = [2000, 5000, 10000];
  const isPreset = preset.includes(settings.normaTarget);
  el.normaSeg.querySelectorAll('.seg-btn').forEach(b => {
    const on = b.dataset.norma === 'custom'
      ? !isPreset
      : Number(b.dataset.norma) === settings.normaTarget;
    b.classList.toggle('is-on', on);
  });
  el.normaTarget.hidden = isPreset;
  if (!isPreset) el.normaTarget.value = settings.normaTarget;
}

function setNormaTarget(v){
  settings.normaTarget = clampNorma(v);
  store.set('bj4_normaTarget', String(settings.normaTarget));
  renderNormaSetup();
}

/* ゲーム中のノルマ進捗表示 */
/* 早抜けモードの進捗表示(v3.2) */
function renderSprint(){
  const show = screen === 'game' && view.mode === 'online'
            && view.onlineMode === 'sprint' && !view.spectating && view.sprintGoal > 0;
  el.sprintChip.hidden = !show;
  if (!show) return;

  const me = view.seats.find(s => s.isYou);
  const now = me ? me.medal : 0;
  el.sprintNow.textContent = Number(now).toLocaleString();
  el.sprintGoalNum.textContent = Number(view.sprintGoal).toLocaleString();

  const rate = now / view.sprintGoal;
  el.sprintChip.classList.toggle('is-near', rate >= 0.7 && rate <= 1);
  el.sprintChip.classList.toggle('is-done', !!(me && me.finished));
  if (me && me.finished){
    el.sprintNow.textContent = me.finishRank + '抜け';
    el.sprintGoalNum.textContent = '達成';
  }
}

function renderNorma(){
  const show = isSingleGame() && single.norma;
  el.normaChip.hidden = !show;
  if (!show) return;
  el.normaNow.textContent = single.medal;
  el.normaGoal.textContent = single.normaTarget;
  const rate = single.medal / single.normaTarget;
  el.normaChip.classList.toggle('is-near', rate >= 0.7 && rate < 1);
  el.normaChip.classList.toggle('is-done', rate >= 1);
}

/* =========================================================
   11.5 チュートリアル(v3.3)

   実際のゲーム画面をそのまま使い、決まった手札で6章を見せる。
   カードは固定なので毎回まったく同じ展開になり、
   HIT / STAND / DOUBLE / SURRENDER と
   WIN / LOSE / BUST / PUSH / BLACKJACK を1回ずつ確実に体験できる。

   プレイヤーは「次へ」を押すだけ(操作は自動)。
   メダル・EXP・戦績・ランキングには一切影響しない。
   ========================================================= */
const TUTORIAL_BET = 100;

/* カードの書き方: 'A♠' のように ランク+マーク */
const C = (s) => {
  const rank = s.length === 3 ? s.slice(0, 2) : s[0];
  const mark = s.slice(-1);
  const su = SUITS.find(x => x.mark === mark) || SUITS[0];
  return { rank, mark: su.mark, red: su.red };
};

const TUTORIAL_CHAPTERS = [
  /* ---------- 1章: HIT / STAND / WIN ---------- */
  {
    title: '基本の流れ',
    you: [C('10♠'), C('7♦')],
    dealer: [C('9♣'), C('K♥')],   // 2枚目は最初は裏向き
    draws: [C('3♥')],             // HITで引く札
    steps: [
      { say: 'ブラックジャックへようこそ! まずは基本の流れを見てみましょう。' },
      { say: 'ゲームはベットから始まります。今回は 100メダル を賭けた状態で進めます。', act: 'bet' },
      { say: 'あなたに2枚、ディーラーにも2枚配られます。ディーラーの2枚目は伏せられています。', act: 'deal' },
      { say: '目標は「21を超えずに、ディーラーより大きい数」を作ることです。絵札(J・Q・K)は10、Aは1か11として数えます。' },
      { say: 'あなたの手札は 10 と 7 で <b>17</b>。もう1枚引くか、ここで止めるかを選びます。' },
      { say: '<b>HIT</b> はもう1枚引くことです。押してみましょう。', act: 'hit', focus: 'hitBtn' },
      { say: '3 を引いて <b>20</b> になりました! 21に近づきましたね。' },
      { say: '<b>STAND</b> はこの手札で勝負することです。20なら十分強いので止めましょう。', act: 'stand', focus: 'standBtn' },
      { say: 'あなたの番が終わると、ディーラーが伏せていたカードを開きます。', act: 'dealer' },
      { say: 'ディーラーは 9 と K で <b>19</b>。あなたの 20 の方が大きいので…', act: 'settle' },
      { say: '<b>WIN!</b> 勝つとベットが <b>2倍</b> になって戻ってきます(100 → 200メダル)。' }
    ]
  },

  /* ---------- 2章: BUST ---------- */
  {
    title: '引きすぎに注意',
    you: [C('9♠'), C('6♣')],
    dealer: [C('8♦'), C('7♠')],
    draws: [C('Q♥')],
    steps: [
      { say: '次は気をつけたいパターンです。引きすぎるとどうなるでしょう?', act: 'bet' },
      { say: 'あなたの手札は 9 と 6 で <b>15</b>。少し物足りない数字です。', act: 'deal' },
      { say: 'もう1枚引いてみましょう。', act: 'hit', focus: 'hitBtn' },
      { say: 'Q(=10)を引いて <b>25</b>。21を超えてしまいました。', act: 'settle' },
      { say: 'これが <b>BUST(バースト)</b> です。21を超えた時点で<b>その場で負け</b>となり、ベットしたメダルは戻ってきません。' },
      { say: '「あと1枚引くか」の判断がこのゲームの一番の悩みどころです。' }
    ]
  },

  /* ---------- 3章: PUSH ---------- */
  {
    title: '引き分け',
    you: [C('10♥'), C('9♠')],
    dealer: [C('J♣'), C('9♦')],
    draws: [],
    steps: [
      { say: '3つ目は引き分けのパターンです。', act: 'bet' },
      { say: 'あなたは 10 と 9 で <b>19</b>。良い手札なのでこのまま勝負しましょう。', act: 'deal' },
      { say: '<b>STAND</b> で勝負します。', act: 'stand', focus: 'standBtn' },
      { say: 'ディーラーのカードを開くと…', act: 'dealer' },
      { say: 'ディーラーも J と 9 で <b>19</b>。まったく同じ数字です。', act: 'settle' },
      { say: 'これが <b>PUSH(引き分け)</b> です。勝ちでも負けでもないので、<b>ベットしたメダルはそのまま戻ってきます</b>。' }
    ]
  },

  /* ---------- 4章: DOUBLE / LOSE ---------- */
  {
    title: 'ダブルダウン',
    you: [C('6♠'), C('5♦')],
    dealer: [C('9♥'), C('K♠')],
    draws: [C('4♣')],
    steps: [
      { say: 'ここからは少し進んだ選択肢です。', act: 'bet' },
      { say: 'あなたは 6 と 5 で <b>11</b>。次に10や絵札を引けば21になる、絶好の場面です。', act: 'deal' },
      { say: '<b>DOUBLE(ダブルダウン)</b> は、ベットを<b>倍</b>にして<b>1枚だけ</b>引く選択です。勝てば儲けも倍になります。', focus: 'doubleBtn' },
      { say: 'ただし引けるのは1枚だけで、その後は自動的にSTANDになります。押してみましょう。', act: 'double', focus: 'doubleBtn' },
      { say: 'ベットが 200メダル になり、4 を引いて <b>15</b>。少し弱い数字になってしまいました。', act: 'dealer' },
      { say: 'ディーラーは 9 と K で <b>19</b>。あなたの 15 では届きません。', act: 'settle' },
      { say: '<b>LOSE</b>。倍賭けしていたので、失う額も倍(200メダル)になります。ダブルダウンは強い場面を見極めて使いましょう。' }
    ]
  },

  /* ---------- 5章: SURRENDER ---------- */
  {
    title: 'サレンダー',
    you: [C('10♦'), C('6♥')],
    dealer: [C('A♠'), C('Q♣')],
    draws: [],
    steps: [
      { say: '最後の選択肢は「降りる」という手です。', act: 'bet' },
      { say: 'あなたは 10 と 6 で <b>16</b>。引けばバーストしやすく、止めても勝ちにくい一番つらい数字です。', act: 'deal' },
      { say: 'しかもディーラーの見えているカードは <b>A</b>。とても強い可能性が高い状況です。' },
      { say: '<b>SURRENDER</b> は勝負を降りる代わりに、<b>ベットの半分だけ</b>戻ってくる選択です。', focus: 'surrenderBtn' },
      { say: '勝ち目が薄いときは、損失を半分に抑えるのも立派な戦略です。押してみましょう。', act: 'surrender', focus: 'surrenderBtn' },
      { say: '100メダルのうち <b>50メダルが戻り</b>、このラウンドは終了です。最初の2枚のときだけ選べます。', act: 'settle' }
    ]
  },

  /* ---------- 6章: BLACKJACK ---------- */
  {
    title: 'ブラックジャック',
    you: [C('A♠'), C('K♦')],
    dealer: [C('10♣'), C('8♥')],
    draws: [],
    steps: [
      { say: '最後は、このゲームで一番うれしい瞬間です。', act: 'bet' },
      { say: '配られた2枚は A と K。Aは11として数えるので…', act: 'deal' },
      { say: '<b>最初の2枚でちょうど21</b>! これが <b>BLACKJACK</b> です。', act: 'settle' },
      { say: 'ブラックジャックの配当は <b>2.5倍</b>。100メダルが 250メダル になります(通常の勝ちは2倍)。' },
      { say: 'なお、ディーラーもブラックジャックだった場合は引き分け(PUSH)になります。' },
      { say: 'これで基本ルールはすべて完了です。おつかれさまでした!' }
    ]
  }
];

const tutorial = { chapter: 0, step: 0, busy: false, active: false };

function startTutorial(){
  view.mode = 'tutorial';
  view.onlineMode = 'enjoy';
  tutorial.active = true;
  tutorial.chapter = 0;
  tutorial.step = 0;
  tutorial.busy = false;
  shownCount.clear();
  setStreak(0);

  el.tutorialHead.hidden = false;
  el.body.classList.add('is-tutorial');
  showScreen('game');
  beginTutorialChapter();
}

function endTutorial(){
  tutorial.active = false;
  tutorial.busy = false;
  /* 見せるためだけに無効化していたボタンを元に戻す(v3.3) */
  [el.hitBtn, el.standBtn, el.doubleBtn, el.surrenderBtn, el.blackjackBtn]
    .forEach(b => { b.disabled = false; });
  el.tutorialHead.hidden = true;
  el.body.classList.remove('is-tutorial');
  clearFocus();
  view.mode = null;
  view.seats = [];
  view.dealer = { hand: [], hole: true };
}

/* 章のはじめ: 盤面を作り直す */
function beginTutorialChapter(){
  const ch = TUTORIAL_CHAPTERS[tutorial.chapter];
  tutorial.step = 0;

  el.tutorialChapter.textContent = (tutorial.chapter + 1) + ' / ' + TUTORIAL_CHAPTERS.length;
  el.tutorialTitle.textContent = ch.title;

  view.phase = 'bet';
  view.dealer = { hand: [], hole: true };
  view.seats = [{
    name: account.user ? account.user.username : 'あなた',
    level: account.user ? account.user.level : 1,
    isYou: true, cpu: false,
    medal: 1000, bet: 0, hand: [], result: null,
    done: false, playing: true, active: true, surrendered: false, doubled: false
  }];

  setMessage('第' + (tutorial.chapter + 1) + '章  ' + ch.title);
  renderTable();
  renderMedal();
  showPanel('tutorial');
  showTutorialButtons(ch);
  el.tutorialSkipBtn.hidden = tutorial.chapter >= TUTORIAL_CHAPTERS.length - 1;
  runTutorialStep();
}

/* 今のステップを表示する。
   v3.3 修正: 「先に盤面を動かしてから、その結果を説明する」順にする。
   逆にすると『15になりました』と書いてあるのにまだカードが無い、
   という食い違い(フライング)が起きる。 */
async function runTutorialStep(){
  const ch = TUTORIAL_CHAPTERS[tutorial.chapter];
  const st = ch.steps[tutorial.step];
  if (!st) return;

  tutorial.busy = true;
  el.tutorialNextBtn.disabled = true;
  clearFocus();

  /* このステップに動きがあるなら、説明文より先に見せる。
     押した感じを出すため、対象ボタンを一瞬光らせてから動かす(v3.3) */
  if (st.act){
    el.tutorialText.innerHTML = '<span class="tutorial-wait">…</span>';
    if (st.focus && el[st.focus] && !el[st.focus].hidden){
      setFocus(st.focus);
      el[st.focus].classList.add('is-pressed');
      await sleep(420);
      el[st.focus].classList.remove('is-pressed');
      clearFocus();
    }
    try { await runTutorialAct(st.act, ch); }
    catch (e){ console.warn('[tutorial]', e); }
  }

  el.tutorialText.innerHTML = st.say;
  showTutorialButtons(ch);
  setFocus(st.focus);
  el.tutorialNextBtn.textContent =
    (tutorial.step >= ch.steps.length - 1)
      ? (tutorial.chapter >= TUTORIAL_CHAPTERS.length - 1 ? '完了 ▶' : '次の章へ ▶')
      : '次へ ▶';

  tutorial.busy = false;
  el.tutorialNextBtn.disabled = false;
}

/* 「次へ」: 次のステップへ進む(動きはそのステップの中で再生される) */
async function tutorialNext(){
  if (tutorial.busy) return;
  const ch = TUTORIAL_CHAPTERS[tutorial.chapter];

  tutorial.step++;
  if (tutorial.step < ch.steps.length){
    await runTutorialStep();
    return;
  }

  /* 章が終わった */
  if (tutorial.chapter >= TUTORIAL_CHAPTERS.length - 1){
    finishTutorial();
  } else {
    tutorial.chapter++;
    beginTutorialChapter();
  }
}

/* チュートリアル中は、実際の操作ボタンを「見せるだけ」表示する。
   押せないが、どのボタンの話をしているのかが分かるようにする(v3.3) */
function showTutorialButtons(ch){
  const seat = view.seats[0];
  const hand = seat ? seat.hand : [];
  const two = hand.length === 2;
  const playing = view.phase === 'play' && !seat.done;

  /* この章で使う選択肢に合わせて出し分ける */
  const acts = ch.steps.map(s => s.act).filter(Boolean);
  const useDouble = acts.includes('double');
  const useSurrender = acts.includes('surrender');
  const isBj = two && isBlackjack(hand);

  el.hitBtn.hidden = !playing || isBj;
  el.standBtn.hidden = !playing || isBj;
  el.doubleBtn.hidden = !playing || !two || !useDouble;
  el.surrenderBtn.hidden = !playing || !two || !useSurrender;
  el.blackjackBtn.hidden = !playing || !isBj;

  /* すべて押せないようにしておく(進行は「次へ」だけ) */
  [el.hitBtn, el.standBtn, el.doubleBtn, el.surrenderBtn, el.blackjackBtn]
    .forEach(b => { b.disabled = true; });

  const anyVisible = !el.hitBtn.hidden || !el.standBtn.hidden
                  || !el.doubleBtn.hidden || !el.surrenderBtn.hidden
                  || !el.blackjackBtn.hidden;
  el.actionPanel.hidden = !anyVisible;
}

/* 各ステップに紐づく盤面の動き */
async function runTutorialAct(act, ch){
  const seat = view.seats[0];

  if (act === 'bet'){
    seat.bet = TUTORIAL_BET;
    seat.medal = 1000 - TUTORIAL_BET;
    renderTable();
    audio.play('chip');
    await sleep(REVEAL_MS * 0.5);
    return;
  }

  if (act === 'deal'){
    view.phase = 'deal';
    /* 実際の配札と同じ順(自分→ディーラー→自分→ディーラー) */
    for (let i = 0; i < 2; i++){
      seat.hand.push(ch.you[i]);
      audio.play('deal');
      renderTable();
      await sleep(DEAL_MS);
      view.dealer.hand.push(ch.dealer[i]);
      audio.play('deal');
      renderTable();
      await sleep(DEAL_MS);
    }
    view.phase = 'play';
    renderTable();
    return;
  }

  if (act === 'hit'){
    seat.hand.push(ch.draws.shift());
    audio.play('deal');
    showFx('hit');
    renderTable();
    await sleep(DEAL_MS);
    const v = handValue(seat.hand);
    if (v.bust){
      audio.play('bust');
      showFx('bust');
      setMessage('バースト! ' + v.total, 'alert');
      await sleep(REVEAL_MS);
    }
    return;
  }

  if (act === 'stand'){
    seat.done = true;
    audio.play('button');
    setMessage('スタンド (' + handValue(seat.hand).total + ')');
    await sleep(REVEAL_MS * 0.7);
    return;
  }

  if (act === 'double'){
    seat.bet = TUTORIAL_BET * 2;
    seat.medal = 1000 - seat.bet;
    seat.doubled = true;
    audio.play('chip');
    showFx('double');
    renderTable();
    await sleep(REVEAL_MS * 0.7);
    seat.hand.push(ch.draws.shift());
    seat.done = true;
    audio.play('deal');
    renderTable();
    await sleep(DEAL_MS);
    return;
  }

  if (act === 'surrender'){
    seat.surrendered = true;
    seat.done = true;
    audio.play('button');
    showFx('surrender');
    await sleep(REVEAL_MS * 0.7);
    return;
  }

  if (act === 'dealer'){
    view.phase = 'dealer';
    view.dealer.hole = false;
    audio.play('flip');
    renderTable();
    await sleep(REVEAL_MS);
    return;
  }

  if (act === 'settle'){
    view.phase = 'result';
    view.dealer.hole = false;

    if (seat.surrendered){
      seat.result = { payout: Math.floor(seat.bet / 2), kind: 'surrender', label: 'SURRENDER' };
    } else {
      seat.result = judge(seat.hand, seat.bet, view.dealer.hand);
      seat.result.doubled = !!seat.doubled;
    }
    seat.medal += seat.result.payout;

    renderTable();
    renderMedal();

    const k = seat.result.kind;
    if (k === 'bj'){ audio.play('bj'); showFx('blackjack'); }
    else if (k === 'win'){ audio.play('win'); showFx('win'); }
    else if (k === 'push'){ audio.play('push'); }
    else if (!seat.surrendered) audio.play('lose');

    await sleep(REVEAL_MS);
    return;
  }
}

/* 章を飛ばす */
function skipTutorialChapter(){
  if (tutorial.busy) return;
  if (tutorial.chapter >= TUTORIAL_CHAPTERS.length - 1) return;
  audio.play('button');
  tutorial.chapter++;
  beginTutorialChapter();
}

function finishTutorial(){
  clearFocus();
  el.tutorialHead.hidden = true;
  showPanel('tutorial-end');
  audio.play('win');
  showFx('clear');
  setMessage('チュートリアル完了!', 'good');
}

/* 説明中のボタンを光らせる */
let focusedEl = null;
function setFocus(id){
  clearFocus();
  if (!id || !el[id]) return;
  focusedEl = el[id];
  focusedEl.classList.add('is-guided');
}
function clearFocus(){
  if (focusedEl) focusedEl.classList.remove('is-guided');
  focusedEl = null;
}

/* =========================================================
   12. オンライン
   ========================================================= */
const online = {
  connectPromise: null,     // 接続手続き中の Promise(v4.2)
  ownerName: '',            // オーナーのアカウント名(v4.6)
  socket: null, roomId: null, state: null, connecting: false,
  createMax: 4, createMode: 'enjoy', createCpuFill: false, createRounds: 10,
  createSprintGoal: SPRINT_GOAL_DEFAULT,
  lastResultRound: -1,
  /* 演出の重複防止用(v3.0) */
  dealtRound: -1, dealerRound: -1, cardTotal: 0, dealerHole: true
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

/* ロビーの表示を、選んでいるゲームに合わせて整える(v4.0)
   ゲームごとに表示する名前を差し替える */
function syncLobbyForGame(){
  const info = gameInfo(view.game);
  el.lobbyTitle.textContent = info.name + ' - オンライン';
  el.roomTitle.textContent = info.name + ' 待機ルーム';
}

async function enterOnline(){
  /* マーブルレースはロビーを経由せず、直接会場に入る(v4.1) */
  if (view.game === 'marble') return enterMarble();
  /* スロットは部屋ではなくホール(台選び)へ入る(v5.0) */
  if (view.game === 'slot') return enterSlotHall();
  if (!account.user){
    toast('オンラインプレイにはログインが必要です');
    openOverlay(el.accountOverlay);
    return;
  }
  syncLobbyForGame();
  showScreen('lobby');
  if (online.socket && online.socket.connected){
    setConn('on', '接続中');
    online.socket.emit('room:list');
    return;
  }
  el.roomList.innerHTML = '<p class="empty-note">読み込み中…</p>';
  try {
    await ensureSocket();
  } catch (e){
    el.roomList.innerHTML = '<p class="empty-note">' + esc(e.message) + '</p>';
  }
}

/* =========================================================
   接続の確保(v4.2)

   socket.io のライブラリ自体は必要になってから読み込んでいる。
   v4.1ではマーブルレースがこの読み込みを待たずに接続しようとしていたため、
   ライブラリが未読み込みだと会場に入れなかった。
   ここに一本化して、どの画面から来ても同じ手順を通るようにした。
   ========================================================= */
async function ensureSocket(){
  if (online.socket && online.socket.connected) {
    setConn('on', '接続中');
    return online.socket;
  }
  /* すでに接続手続き中なら、その完了を待つ(二重に繋がないため) */
  if (online.connectPromise) return online.connectPromise;

  online.connecting = true;
  setConn('', '接続しています…');

  online.connectPromise = (async () => {
    try {
      await loadSocketIo();
      if (!online.socket) connectSocket();
      /* connect イベントが来るまで待つ。
         Renderが眠っていると起きるまで時間がかかるので、長めに待つ */
      if (!online.socket.connected){
        await new Promise((resolve, reject) => {
          const done = () => { cleanup(); resolve(); };
          const failed = (e) => { cleanup(); reject(new Error((e && e.message) || '接続に失敗しました')); };
          const timer = setTimeout(() => { cleanup(); reject(new Error('接続がタイムアウトしました')); }, 70000);
          function cleanup(){
            clearTimeout(timer);
            online.socket.off('connect', done);
            online.socket.off('connect_error', failed);
          }
          online.socket.once('connect', done);
          online.socket.once('connect_error', failed);
        });
      }
      return online.socket;
    } catch (e){
      online.connecting = false;
      setConn('off', '接続できません');
      throw e;
    } finally {
      online.connectPromise = null;
    }
  })();

  return online.connectPromise;
}

function connectSocket(){
  const sock = window.io(apiBase(), { auth: { token: account.token }, transports: ['websocket', 'polling'] });
  online.socket = sock;

  sock.on('connect', () => {
    online.connecting = false;
    setConn('on', '接続中');
    sock.emit('room:list');
    updateChatVisibility();
    loadFriends(true);
    loadNotices(true);
    /* マーブルレースの会場にいたなら入り直す(v4.1) */
    if (marble.joined && screen === 'marble') sock.emit('marble:join');
    /* 招待URL・招待通知からの参加待ちがあれば実行する(v3.0) */
    const pend = online.pendingJoin;
    if (pend){
      online.pendingJoin = null;
      sock.emit('room:join', { id: String(pend.id).toUpperCase(), via: pend.via });
    }
  });

  sock.on('connect_error', (err) => {
    online.connecting = false;
    setConn('off', '接続エラー');
    /* v4.2: 別端末ログインで弾かれた場合は、繋ぎ直さずログアウトする */
    if (err && /別の端末/.test(err.message || '')){
      return forceLogout(err.message + '。\nこの端末からはログアウトしました。');
    }
    el.roomList.innerHTML = '<p class="empty-note">' + esc(err.message || '接続に失敗しました') + '</p>';
  });

  sock.on('disconnect', () => {
    setConn('off', '切断されました');
    updateChatVisibility();
    if (screen === 'marble'){
      /* 会場は入り直せばよいので、タイトルに戻さず待たせる(v4.1) */
      toast('サーバーとの接続が切れました');
      stopMarbleRace();
      stopMrTimer();
      showPanel('mr-wait');
      el.mrWaitText.textContent = '再接続しています…';
      return;
    }
    if (screen === 'room' || screen === 'game'){
      toast('サーバーとの接続が切れました');
      showScreen('lobby');
    }
  });

  sock.on('room:list', renderRoomList);
  sock.on('room:error', (msg) => { toast(msg); audio.play('error'); });
  sock.on('room:joined', ({ id }) => {
    online.roomId = id;
    online.pendingJoin = null;
    audio.play('join');
  });
  /* オーナー名を受け取る(v4.6) */
  sock.on('app:info', (d) => { online.ownerName = (d && d.owner) || ''; });

  sock.on('room:state', onRoomState);

  /* 別の端末でログインされた(v4.2) */
  sock.on('auth:kicked', (d) => {
    forceLogout(((d && d.reason) || '別の端末でログインされました') +
                '。\nこの端末からはログアウトしました。');
  });

  /* スロット(v5.0) */
  sock.on('slot:lobby',   onSlotLobby);
  sock.on('slot:sat',     onSlotSat);
  sock.on('slot:resume',  onSlotResume);
  sock.on('slot:state',   onSlotState);
  sock.on('slot:cashout', onSlotCashout);
  /* 接続の状態を上部に出す(v5.1) */
  sock.on('connect',    () => slSetConn('on'));
  sock.on('disconnect', () => slSetConn('off'));

  /* マーブルレース(v4.1) */
  sock.on('marble:state', onMarbleState);
  /* 会場チャット(v4.5)。表示は通常のチャットと同じ仕組みを使う */
  sock.on('marble:chat', onChatMessage);
  sock.on('marble:bought', (t) => {
    toast(t.label + ' ' + t.picks.join('-') + ' に ' +
          Number(t.amount).toLocaleString() + ' メダル投票しました');
  });
  sock.on('room:countdown', ({ n }) => showCountdown(n));
  sock.on('chat:new', onChatMessage);

  /* 観戦を開始した(v3.0) */
  sock.on('room:spectating', ({ id }) => {
    online.roomId = id;
    online.pendingJoin = null;
    view.spectating = true;
    audio.play('join');
    toast('観戦を開始しました');
  });

  /* 招待URL・フレンド招待からの参加に失敗した(v3.0) */
  sock.on('room:joinFailed', ({ reason, via } = {}) => {
    online.pendingJoin = null;
    audio.play('error');
    toast(reason || '参加できませんでした');
    /* 招待URLから来た場合はタイトルへ戻す */
    if (via === 'url') showScreen('title');
    else if (screen !== 'room' && screen !== 'game') showScreen('lobby');
  });

  /* フレンド関連(v3.0) */
  sock.on('friend:request', ({ username }) => {
    toast(username + ' さんからフレンド申請が届きました');
    audio.play('join');
    loadFriends(true);
  });
  sock.on('friend:accepted', ({ username }) => {
    toast(username + ' さんとフレンドになりました');
    audio.play('win');
    loadFriends(true);
  });
  sock.on('friend:update', () => loadFriends(true));

  /* 通知が増えた(v3.2) */
  sock.on('notice:new', () => loadNotices(true));

  /* 日付が変わった(v3.2) */
  sock.on('day:changed', () => {
    loadNotices(true);
    onDayChanged();
  });

  /* 部屋への招待が届いた(v3.0) */
  sock.on('room:invited', (data) => {
    /* 自分がすでに同じ部屋にいる/ゲーム中なら出さない */
    if (online.roomId === data.roomId) return;
    if (screen === 'game' || screen === 'marble')
      return toast(data.from + ' さんから招待が届いています');
    showInvited(data);
  });
  sock.on('room:inviteSent', ({ username }) => {
    toast(username + ' さんに招待を送りました');
    audio.play('chip');
  });

  /* ホストが退出してルームが解散された */
  sock.on('room:closed', ({ reason } = {}) => {
    resetOnlineRoomView();
    audio.play('error');
    showScreen('lobby');
    renderMedal();
    sock.emit('room:list');
    toast(reason || 'ルームは解散されました');
  });

  /* 定員に満たない状態での開始確認 */
  sock.on('room:confirmStart', ({ humans, max } = {}) => {
    const ok = confirm(
      '参加人数が足りていません(' + humans + '/' + max + '人)。\nこのまま開始してもよろしいですか?');
    if (ok) sock.emit('room:start', { confirmed: true });
  });
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
  /* v4.0: いま選んでいるゲームの部屋だけを出す。
     ほかのゲームの部屋が混ざると、入ってから違うゲームだったという事故になる */
  const all = Array.isArray(list) ? list : [];
  const rooms = all.filter(r => (r.game || 'bj') === view.game);
  const others = all.length - rooms.length;

  if (rooms.length === 0){
    el.roomList.innerHTML =
      '<p class="empty-note">' + esc(gameInfo(view.game).name) +
      ' の部屋がありません。<br>部屋を作って友達を誘いましょう。' +
      (others > 0 ? '<br><span class="field-hint">(ほかのゲームの部屋が ' + others + ' 件あります)</span>' : '') +
      '</p>';
    return;
  }
  el.roomList.innerHTML = rooms.map(r => {
    const modeTag = r.mode === 'champion'
      ? '<span class="room-row-tag is-champ">🏆 ' + r.championRounds + 'R</span>'
      : r.mode === 'sprint'
        ? '<span class="room-row-tag is-sprint">⚡ ' + Number(r.sprintGoal || 0).toLocaleString() + '超え</span>'
        : '<span class="room-row-tag">エンジョイ</span>';

    /* 試合中の部屋は観戦、満員の待機部屋は参加不可(v3.0) */
    const stateTag = r.playing
      ? '<span class="room-row-state is-playing">試合中</span>'
      : '<span class="room-row-state is-waiting">待機中</span>';

    const btn = r.playing
      ? '<button type="button" class="mini-btn is-spectate" data-spectate="' + esc(r.id) + '">観戦</button>'
      : (r.full
          ? '<button type="button" class="mini-btn is-full" disabled>満員</button>'
          : '<button type="button" class="mini-btn" data-join="' + esc(r.id) + '">参加</button>');

    const spec = r.spectators > 0
      ? '<span class="room-row-spec">👁' + r.spectators + '</span>' : '';

    return '' +
    '<div class="room-row">' +
      '<span class="room-row-id">' + esc(r.id) + '</span>' +
      '<span class="room-row-meta">' +
        '<span class="room-row-count' + (r.full && !r.playing ? ' is-full' : '') + '">' +
          r.count + ' / ' + r.max + ' 人 ' + modeTag + spec + '</span>' +
        '<span class="room-row-host">ホスト: ' + esc(r.host || '-') + '</span>' +
      '</span>' +
      '<span class="room-row-actions">' + stateTag + btn + '</span>' +
    '</div>';
  }).join('');
}

/* ---------------------------------------------------------
   オンラインの演出(v3.0)
   サーバーは最終状態をまとめて送ってくるので、そのままだと一括描画になる。
   配札とディーラーのめくりだけ、シングルに近い「間」を作って見せる。
   演出中に届いた新しい状態は pending に退避し、終わり次第まとめて適用する。
   --------------------------------------------------------- */
const ONLINE_DEAL_MS   = 160;   // オンラインの配札間隔(シングルより短め)
const ONLINE_REVEAL_MS = 300;
const onlineAnim = { busy: false, pending: null, token: 0 };

function cancelOnlineAnim(){
  onlineAnim.busy = false;
  onlineAnim.pending = null;
  onlineAnim.token++;
}

/* 演出の途中で画面から離れたら中断する */
function animAlive(token){
  return onlineAnim.busy && onlineAnim.token === token
      && screen === 'game' && view.mode === 'online';
}

function mapSeats(state){
  return state.players.map(p => ({
    name: p.name, level: p.level, medal: p.medal, bet: p.bet,
    hand: p.hand || [], result: p.result, isYou: p.isYou,
    active: state.activeName === p.name, ready: p.ready, cpu: !!p.cpu,
    eliminated: !!p.eliminated, doubled: !!p.doubled,
    finished: !!p.finished, finishRank: p.finishRank || null, retired: !!p.retired,
    iconColor: iconColorOf(p.iconColor)
  }));
}

function onRoomState(state){
  online.state = state;
  online.roomId = state.id;
  view.mode = 'online';
  view.onlineMode = state.mode;
  view.game = state.game || 'bj';

  /* ロビー・カウントダウン・大会結果は演出を打ち切ってすぐ反映する */
  if (state.phase === 'lobby' || state.phase === 'countdown' || state.phase === 'champion_end'){
    cancelOnlineAnim();
    return applyRoomState(state);
  }

  if (onlineAnim.busy){ onlineAnim.pending = state; return; }

  if (shouldAnimateDeal(state)) return runDealAnimation(state);
  if (shouldAnimateDealer(state)) return runDealerAnimation(state);

  applyRoomState(state);
}

/* ベット直後の配札(全員2枚・ディーラー2枚)のときだけ演出する */
function shouldAnimateDeal(state){
  if (state.phase !== 'play') return false;
  if (online.dealtRound === state.round) return false;
  if (!state.dealer || (state.dealer.hand || []).length !== 2) return false;
  if (!state.players.length) return false;
  if (!state.players.every(p => (p.hand || []).length === 2)) return false;
  /* すでにカードが出ている(＝途中参加や再描画)ときは演出しない */
  const shownNow = view.seats.reduce((n, s) => n + (s.hand ? s.hand.length : 0), 0);
  return shownNow === 0;
}

async function runDealAnimation(state){
  onlineAnim.busy = true;
  const token = ++onlineAnim.token;
  online.dealtRound = state.round;

  if (screen !== 'game') showScreen('game');
  shownCount.clear();

  view.phase = 'deal';
  view.dealer = { hand: [], hole: true };
  view.seats = mapSeats(state).map(s =>
    Object.assign({}, s, { hand: [], active: false, result: null }));

  renderTable();
  renderMedal();
  updateRoundChip();
  stopTurnTimer();
  showPanel('none');
  setMessage('カードを配っています…');

  const hands = state.players.map(p => p.hand || []);
  const dealerHand = state.dealer.hand || [];

  for (let round = 0; round < 2; round++){
    for (let i = 0; i < view.seats.length; i++){
      if (!animAlive(token)) return endOnlineAnim(token);
      if (hands[i].length <= round) continue;
      view.seats[i].hand.push(hands[i][round]);
      audio.play('deal');
      renderSeats();
      await sleep(ONLINE_DEAL_MS);
    }
    if (!animAlive(token)) return endOnlineAnim(token);
    if (dealerHand.length > round){
      view.dealer.hand.push(dealerHand[round]);
      audio.play('deal');
      renderDealer();
      await sleep(ONLINE_DEAL_MS);
    }
  }

  endOnlineAnim(token);
}

/* ディーラーの手番: ホールカードのめくりと引き足しを1枚ずつ見せる */
function shouldAnimateDealer(state){
  if (state.phase !== 'dealer') return false;
  if (online.dealerRound === state.round) return false;
  if (!state.dealer || state.dealer.hole !== false) return false;
  return true;
}

async function runDealerAnimation(state){
  onlineAnim.busy = true;
  const token = ++onlineAnim.token;
  online.dealerRound = state.round;

  const full = state.dealer.hand || [];
  /* まず今見えている2枚のうち伏せ札だけを開く */
  const shown = Math.min(2, full.length);

  view.phase = 'dealer';
  view.seats = mapSeats(state).map(s => Object.assign({}, s, { active: false }));
  view.dealer = { hand: full.slice(0, shown), hole: false };

  stopTurnTimer();
  showPanel('none');
  setMessage('ディーラーのターン');
  audio.play('flip');
  renderTable();
  await sleep(ONLINE_REVEAL_MS);

  for (let i = shown; i < full.length; i++){
    if (!animAlive(token)) return endOnlineAnim(token);
    view.dealer.hand.push(full[i]);
    audio.play('deal');
    renderDealer();
    await sleep(ONLINE_DEAL_MS);
  }

  if (animAlive(token)){
    setMessage(state.message || '');
    await sleep(ONLINE_REVEAL_MS);
  }
  endOnlineAnim(token);
}

/* 演出を終えて、その間に届いていた最新状態を反映する */
function endOnlineAnim(token){
  if (onlineAnim.token !== token) return;   // 途中で打ち切られている
  onlineAnim.busy = false;
  const next = onlineAnim.pending || online.state;
  onlineAnim.pending = null;
  if (next) applyRoomState(next);
}

function applyRoomState(state){
  view.spectating = !!state.isSpectator;
  view.spectators = state.spectatorCount || 0;
  view.sprintGoal = state.sprintGoal || 0;
  el.body.classList.toggle('is-spectating', view.spectating);

  if (state.phase === 'lobby'){
    online.lastResultRound = -1;
    online.dealtRound = -1;
    online.dealerRound = -1;
    online.cardTotal = 0;
    stopTurnTimer();
    setStreak(0);
    showScreen('room');
    renderRoomScreen(state);
    return;
  }

  if (state.phase === 'countdown'){
    stopTurnTimer();
    setStreak(0);
    return;   // カウントダウンは room:countdown 側で描画する
  }

  if (state.phase === 'champion_end'){
    stopTurnTimer();
    showScreen('championEnd');
    renderStandings(state);
    return;
  }

  if (screen !== 'game'){ shownCount.clear(); showScreen('game'); }

  view.phase = state.phase;
  view.dealer = { hand: state.dealer.hand, hole: state.dealer.hole };
  view.seats = mapSeats(state);

  /* 手札が増えていたらカードの音を添える(一括描画でも手応えを出す) */
  const total = state.players.reduce((n, p) => n + ((p.hand || []).length), 0)
              + ((state.dealer.hand || []).length);
  if (online.cardTotal > 0 && total > online.cardTotal) audio.play('deal');
  if (online.dealerHole === true && state.dealer.hole === false) audio.play('flip');
  online.cardTotal = state.phase === 'bet' ? 0 : total;
  online.dealerHole = state.dealer.hole;

  const me = state.players.find(p => p.isYou);
  setStreak(me ? me.streak : 0);

  renderTable();
  renderMedal();
  updateRoundChip();
  renderSpectateChip();
  syncTurnTimer(state);
  setMessage(state.message || '');
  updateOnlinePanels(state);
}

function renderStandings(state){
  const standings = state.standings || [];
  const sprint = state.mode === 'sprint';
  el.standingsTitle.textContent = sprint ? '早抜け 結果' : '大会結果';

  el.standingsList.innerHTML = standings.map(p => {
    const isYou = p.name === (state.players.find(x => x.isYou) || {}).name;

    /* 早抜けは「抜けた順位」。リタイアした人は順位なしで「-」表示(v3.2) */
    let rankLabel, kindLabel, first;
    if (sprint){
      first = p.rank === 1;
      rankLabel = p.rank ? ('#' + p.rank) : 'ー';
      kindLabel = p.rank
        ? (p.rank === 1 ? '1抜け' : p.rank + '抜け')
        : 'リタイア';
    } else {
      first = p.rank === 1 && !p.eliminated;
      rankLabel = p.eliminated ? '脱落' : ('#' + p.rank);
      kindLabel = p.rankKind === 'win' ? '優勝'
                : p.rankKind === 'draw' ? '同率1位'
                : (p.eliminated ? '脱落' : '順位');
    }

    const sub = sprint
      ? (p.rank ? '<span class="standing-sub">' + Number(p.sprintGoal || 0).toLocaleString() + ' メダル突破</span>' : '')
      : (p.scoredRounds != null
          ? '<span class="standing-sub">勝負したラウンド ' + p.scoredRounds + ' / ' + p.totalRounds + '</span>'
          : '');

    return '' +
      '<div class="standing-row' + (isYou ? ' is-you' : '') +
        ((sprint ? !p.rank : p.eliminated) ? ' is-eliminated' : '') + '">' +
        '<span class="standing-rank' + (first ? ' is-first' : '') + '">' + rankLabel + '</span>' +
        '<div class="standing-info">' +
          '<span class="standing-name">' + nameHTML(p.name) + (p.cpu ? ' (CPU)' : '') + (isYou ? '(あなた)' : '') + '</span>' +
          '<span class="standing-meta">' + kindLabel + ' ・ 大会メダル ' + Number(p.medal).toLocaleString() +
            sub +
          '</span>' +
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
    el.roomModeBadge.classList.remove('is-sprint');
  } else if (state.mode === 'sprint'){
    el.roomModeBadge.textContent = '⚡ 早抜け ' + Number(state.sprintGoal || 0).toLocaleString() + '超え';
    el.roomModeBadge.classList.add('is-sprint');
    el.roomModeBadge.classList.remove('is-champ');
  } else {
    el.roomModeBadge.textContent = 'エンジョイ';
    el.roomModeBadge.classList.remove('is-champ', 'is-sprint');
  }

  const rows = state.players.map(p => {
    const isHost = p.name === state.hostName;
    const badge = isHost
      ? '<span class="member-tag">ホスト</span>'
      : (p.lobbyReady
          ? '<span class="member-ready">準備完了</span>'
          : '<span class="member-wait">準備中</span>');

    /* 自分以外の人には、フレンドなら🤝、そうでなければ申請ボタンを出す(v3.0) */
    let social = '';
    if (!p.isYou && !p.cpu && account.user){
      if (isFriend(p.name)){
        social = '<span class="member-mate" title="フレンド">🤝</span>';
      } else if (friendPending(p.name)){
        social = '<button type="button" class="member-req" disabled>申請中</button>';
      } else {
        social = '<button type="button" class="member-req" data-req="' + esc(p.name) + '">申請</button>';
      }
    }

    return '' +
      '<div class="member-row' + (p.isYou ? ' is-you' : '') + '">' +
        '<span class="member-avatar" data-icon-color="' + iconColorOf(p.iconColor) + '">' +
          esc(p.name.charAt(0).toUpperCase()) + '</span>' +
        '<span class="member-name">' + nameHTML(p.name) + (p.isYou ? '(あなた)' : '') + '</span>' +
        social +
        '<span class="member-lv">Lv.' + p.level + '</span>' +
        badge +
      '</div>';
  });

  for (let i = state.players.length; i < state.maxPlayers; i++){
    rows.push('<div class="member-slot">空席を待っています…</div>');
  }
  el.memberList.innerHTML = rows.join('');

  const cpuAllowed = state.mode === 'enjoy' && state.maxPlayers >= (state.minHumans || 2) + 1;
  el.roomCpuRow.hidden = state.mode !== 'enjoy';
  if (state.mode === 'enjoy'){
    el.roomCpuCheck.setAttribute('aria-checked', String(!!state.cpuFill && cpuAllowed));
    el.roomCpuCheck.disabled = !state.isHost || !cpuAllowed;
    el.roomCpuRow.classList.toggle('is-disabled', !cpuAllowed);
  }

  const minH = state.minHumans || 2;
  const humans = state.humanCount != null ? state.humanCount : state.players.filter(p => !p.cpu).length;
  const enough = humans >= minH;
  const allReady = !!state.allGuestsReady;
  const me = state.players.find(p => p.isYou);

  /* ホスト: 開始ボタン / ゲスト: 準備完了ボタン */
  el.startGameBtn.hidden = !state.isHost;
  el.startGameBtn.disabled = !(enough && allReady);
  el.readyBtn.hidden = state.isHost;
  if (!state.isHost && me){
    el.readyBtn.classList.toggle('is-on', !!me.lobbyReady);
    el.readyBtn.querySelector('.btn-main').textContent = me.lobbyReady ? '準備完了' : '準備完了';
    el.readyBtn.querySelector('.btn-sub').textContent = me.lobbyReady
      ? 'もう一度押すと解除できます'
      : '押すとホストが開始できます';
  }

  el.roomHint.classList.remove('is-warn');
  if (!enough){
    el.roomHint.textContent = '最低' + minH + '人のプレイヤーの参加が必要です(現在 ' + humans + '人)';
    el.roomHint.classList.add('is-warn');
  } else if (!allReady){
    const waiting = state.players.filter(p => !p.cpu && p.name !== state.hostName && !p.lobbyReady).length;
    el.roomHint.textContent = state.isHost
      ? '参加者の準備完了を待っています(あと ' + waiting + '人)'
      : '「準備完了」を押すとホストが開始できます';
    if (state.isHost) el.roomHint.classList.add('is-warn');
  } else {
    el.roomHint.textContent = state.isHost
      ? '全員の準備が整いました。「ゲーム開始」を押してください。'
      : 'ホストが開始するのを待っています…';
  }
}

function updateOnlinePanels(state){
  /* 観戦者は操作できないので、専用パネルだけを見せる(v3.0) */
  if (state.isSpectator) return showPanel('spectate');

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
      const hand = me.hand || [];
      const isBj = isBlackjack(hand);
      const twoCards = !isBj && hand.length === 2;
      el.hitBtn.hidden = isBj;
      el.standBtn.hidden = isBj;
      el.hitBtn.disabled = false;
      el.standBtn.disabled = false;
      el.surrenderBtn.hidden = !twoCards;
      el.surrenderBtn.disabled = false;

      /* ダブルダウン: 最初の2枚 かつ 同額を追加で払えるときだけ押せる */
      el.doubleBtn.hidden = !twoCards;
      el.doubleBtn.disabled = !(twoCards && !me.doubled && me.bet > 0 && me.medal >= me.bet);

      el.blackjackBtn.hidden = !isBj;
      el.blackjackBtn.disabled = false;
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

/* いまのチャットがマーブルレースの会場チャットかどうか(v4.5)。
   会場は部屋を持たないので、送信先のイベント名が変わる */

/* =========================================================
   スロット (v5.0)
   ---------------------------------------------------------
   実機のパチスロと同じで、当たりはレバーを叩いた瞬間にサーバーが決める。
   ここ(クライアント)がやるのは次の3つだけ。
     ・リールを回して見せる
     ・停止ボタンを押した「位置」をサーバーに送る
     ・サーバーが返してきた停止位置までリールを滑らせて止める
   当選役はクライアントに一切届かないので、ここをいじっても出玉は変わらない。
   ========================================================= */

const SL_KOMA = 21;
const SL_SYM_IMG = {
  1: './slot/Reel/Grape.png',
  2: './slot/Reel/Cherry.png',
  3: './slot/Reel/Clown.png',
  4: './slot/Reel/Bell.png',
  5: './slot/Reel/Replay.png',
  6: './slot/Reel/BAR.png',
  7: './slot/Reel/7.png'
};
/* リール配列。サーバーの SL_REEL_DATA と必ず同じにすること。
   見た目を作るためだけに持っている(抽選には一切使わない) */
const SL_REEL_DATA = [
  [4,7,5,1,5,1,6,2,1,5,1,7,3,1,5,1,2,6,1,5,1],
  [5,7,1,2,5,4,1,2,5,6,1,2,5,4,1,2,5,6,1,2,3],
  [1,7,6,4,5,1,3,4,5,1,3,4,5,1,3,4,5,1,3,4,5]
];


/* =========================================================
   スロットの中身 (v5.1)
   ---------------------------------------------------------
   v5.0 まではサーバーが当たりを決めていたが、
   停止ボタンを押してから止まるまでの間が大きかったため、
   v5.1 でジャグラーシミュレーターと同じ「ブラウザ側で決める」作りに戻した。
   押した瞬間に計算して、そのまま止める。

   ※ このため、開発者ツールを開けば当たりや設定を覗ける状態になっている。
      友達うちで遊ぶ前提での割り切り。広く公開するなら作りを戻すこと。
   ========================================================= */
const SL_SYM = { GRAPE: 1, CHERRY: 2, CLOWN: 3, BELL: 4, REPLAY: 5, BAR: 6, SEVEN: 7 };

/* 有効5ライン: 各リールの行(0=上, 1=中, 2=下)。server.js と同じにすること */
const SL_LINES = [
  [0,0,0], [1,1,1], [2,2,2], [0,1,2], [2,1,0]
];

/* 設定別確率(index0 = 設定1)。6号機アイムジャグラーEX準拠 */
const SL_SETTINGS = [
  { bb: 1/273.1, rb: 1/439.8, grape: 1/6.02 },
  { bb: 1/269.7, rb: 1/399.6, grape: 1/6.02 },
  { bb: 1/269.7, rb: 1/331.0, grape: 1/6.02 },
  { bb: 1/259.0, rb: 1/315.1, grape: 1/6.02 },
  { bb: 1/259.0, rb: 1/255.0, grape: 1/6.02 },
  { bb: 1/255.0, rb: 1/255.0, grape: 1/5.85 }
];
const SL_P_REPLAY = 1/7.298;
const SL_P_CHERRY = 1/38.1;
const SL_P_BELL   = 1/1092.3;
const SL_P_CLOWN  = 1/1092.3;
/* 中段チェリー(BB確定・BB確率の内数) */
const slRareCherryProb = s => (s <= 3 ? 1/2184.53 : 1/1820.44);
const SL_CHERRY_DUP_RATE = 0.25;  // ボーナス当選時にチェリーが重複する割合(概算)

/* 停止目標図柄(null=不問)。BB=7/7/7、RB=7/7/BAR */
const SL_TARGETS = {
  GRAPE:      [1, 1, 1],
  BELL:       [4, 4, 4],
  CLOWN:      [3, 3, 3],
  REPLAY:     [5, 5, 5],
  CHERRY:     [2, null, null],
  RARECHERRY: [2, null, null],
  BB:         [7, 7, 7],
  RB:         [7, 7, 6]
};

/* 設定の振り分けはサーバー側(server.js の slPickSetting)が受け持つ。
   台に座ったときに 1〜6 の数字だけ受け取る */

/* 台の決まりごと。server.js 側と必ず同じ数字にすること */
const SL_MAX_SLIP   = 4;      // 最大4コマ引き込み
const SL_PEKA_FIRST = 0.15;   // 先ペカ(レバーON時点灯)の割合。残り85%は後ペカ
const SL_BB_LIMIT   = 280;    // BB: 280枚を超える払い出しで終了
const SL_RB_LIMIT   = 98;     // RB: 98枚を超える払い出しで終了
const SL_PAY_CAP    = 15;     // 1ゲームの払い出し上限
const SL_CREDIT_MAX = 50;     // クレジット上限


/* 0以上1未満の乱数 */
function slRandom(){ return Math.random(); }

const slMod  = (n, m) => ((n % m) + m) % m;
const slModK = n => slMod(n, SL_KOMA);

/* 指定位置に停めたときに窓に見える3コマ */
function slWindowCol(reelIdx, pos){
  const d = SL_REEL_DATA[reelIdx];
  return [d[slModK(pos)], d[slModK(pos + 1)], d[slModK(pos + 2)]];
}

/* 窓の全ラインを評価して成立役を返す */
function slEvalWins(cols){
  const wins = [];
  SL_LINES.forEach((rows, i) => {
    const s = [cols[0][rows[0]], cols[1][rows[1]], cols[2][rows[2]]];
    if (s[0] === SL_SYM.CHERRY) wins.push({ role: 'CHERRY', line: i });
    if (s[0] === s[1] && s[1] === s[2]){
      if      (s[0] === SL_SYM.GRAPE)  wins.push({ role: 'GRAPE',  line: i });
      else if (s[0] === SL_SYM.BELL)   wins.push({ role: 'BELL',   line: i });
      else if (s[0] === SL_SYM.CLOWN)  wins.push({ role: 'CLOWN',  line: i });
      else if (s[0] === SL_SYM.REPLAY) wins.push({ role: 'REPLAY', line: i });
      else if (s[0] === SL_SYM.SEVEN)  wins.push({ role: 'BB',     line: i });
    }
    if (s[0] === SL_SYM.SEVEN && s[1] === SL_SYM.SEVEN && s[2] === SL_SYM.BAR)
      wins.push({ role: 'RB', line: i });
  });
  return wins;
}

/* 払い出し枚数。ブドウは複数ライン成立でも1回分だけ(実機準拠)
   ブドウ 3BET=8枚 / 2BET=14枚 / 1BET=8枚 */
function slPayoutFor(wins, bet, cherryUnit){
  let total = 0, grapePaid = false;
  const cUnit = (cherryUnit === undefined) ? (bet === 3 ? 1 : 7) : cherryUnit;
  for (const w of wins){
    switch (w.role){
      case 'GRAPE':
        if (!grapePaid){ total += (bet === 2 ? 14 : 8); grapePaid = true; }
        break;
      case 'BELL':  total += 14;    break;
      case 'CLOWN': total += 10;    break;
      case 'CHERRY':total += cUnit; break;
    }
  }
  return Math.min(total, SL_PAY_CAP);
}

/* チェリー1ラインあたりの払い出し枚数 */
function slCherryUnitFor(bet, cols, inBonus){
  if (bet === 3) return 1;
  /* 非ボーナス時の1BET連チェリーは1枚×2ライン=2枚。2BETは7枚×2ライン=14枚 */
  if (bet === 1 && !inBonus && slCenterCherryLinked(cols[0], cols[1])) return 1;
  return 7;
}

/* ---- 単チェリー判定 ----
   実機の「単チェリー」= 順押しで左にチェリーが露出しているのに、
   中リールの真横・斜めにチェリーが繋がっていない停止形。
   この形が出た時点でボーナス成立が確定する。 */
function slCherryRows(col){
  const rows = [];
  if (!col) return rows;
  for (let r = 0; r < 3; r++) if (col[r] === SL_SYM.CHERRY) rows.push(r);
  return rows;
}
function slCenterCherryLinked(col0, col1){
  if (!col0 || !col1) return false;
  const c0 = slCherryRows(col0), c1 = slCherryRows(col1);
  return c0.some(r => c1.some(r2 => Math.abs(r2 - r) <= 1));
}
function slIsSoloCherry(cols, order){
  if (!cols || !cols[0] || !cols[1]) return false;
  if (!order || order.length !== 3) return false;
  if (!(order[0] === 0 && order[1] === 1 && order[2] === 2)) return false; // 順押し限定
  if (!cols[0].includes(SL_SYM.CHERRY)) return false;
  return !slCenterCherryLinked(cols[0], cols[1]);
}

/* ---- 停止制御(最大4コマ引き込み + 蹴飛ばし) ---- */

/* 図柄symを行rowに置ける停止位置の一覧 */
function slAlignSet(reelIdx, sym, row, avoidCherry){
  const set = [];
  for (let t = 0; t < SL_KOMA; t++){
    if (SL_REEL_DATA[reelIdx][t] !== sym) continue;
    const p = slModK(t - row);
    if (avoidCherry && reelIdx === 0 && slWindowCol(0, p).includes(SL_SYM.CHERRY)) continue;
    set.push(p);
  }
  return set;
}

/* どのタイミングで押しても4コマ以内に引き込めるか */
function slCoversAllPresses(setArr){
  if (setArr.length === 0) return false;
  const s = [...setArr].sort((a, b) => a - b);
  for (let i = 0; i < s.length; i++){
    const gap = (i === s.length - 1) ? (s[0] + SL_KOMA - s[i]) : (s[i + 1] - s[i]);
    if (gap > SL_MAX_SLIP + 1) return false;
  }
  return true;
}

/* 押された位置から実際に停める位置を決める。
   g はそのゲームの状態(フラグ・停止済みリール・押し順) */
function slChooseStopPosition(g, reelIdx, curPos){
  const stopped = g.cols;
  const nStopped = stopped.filter(Boolean).length;

  /* 狙う役: 小役優先 → なければ保持中のボーナス。
     ボーナスはGOGO!CHANCE点灯中のみ揃えられる(未点灯なら蹴飛ばす) */
  const aimableBonus = g.lampLit ? g.bonusFlag : null;
  const flagRole = g.smallFlag || aimableBonus || null;
  const allowed = new Set();
  if (g.smallFlag){
    allowed.add(g.smallFlag);
    if (g.smallFlag === 'RARECHERRY') allowed.add('CHERRY');
  } else if (aimableBonus) allowed.add(aimableBonus);

  const target = flagRole ? SL_TARGETS[flagRole] : null;

  let base = Math.floor(curPos);
  if (curPos - base < 0.2) base = base - 1;   // 最低限の移動距離を確保
  const candidates = [];
  for (let s = 0; s <= SL_MAX_SLIP; s++) candidates.push({ slip: s, p: slModK(base - s) });

  const scoreOf = (cand) => {
    const col = slWindowCol(reelIdx, cand.p);
    const cols = stopped.slice();
    cols[reelIdx] = col;

    if (nStopped === 2){
      /* 第3停止: 完成形を厳密に判定する */
      const wins = slEvalWins(cols);
      const badWins = wins.filter(w => !allowed.has(w.role));
      const flagHit = flagRole && wins.some(w =>
        flagRole === 'RARECHERRY' ? (w.role === 'CHERRY' && w.line === 1) : w.role === flagRole);
      if (badWins.length > 0) return 1000 + badWins.length * 10;  // 蹴飛ばす
      if (flagHit) return 0;
      return 10;
    }

    /* 第1・第2停止 */
    let penalty = 0;
    /* 単チェリー制御(順押しの第2停止=中リールのみ)。
       重複当選なら「繋がらない形(=単チェリー)」、非重複なら「繋がる形」を優先する */
    if (reelIdx === 1 && cols[0] && cols[0].includes(SL_SYM.CHERRY) &&
        g.pressOrder.length === 1 && g.pressOrder[0] === 0 &&
        (g.smallFlag === 'CHERRY' || g.smallFlag === 'RARECHERRY')){
      if (slCenterCherryLinked(cols[0], col) === !!g.dupCherry) penalty += 40;
    }
    if (!allowed.has('CHERRY') && cols[0]){
      /* チェリーは左リールだけで成立が決まるので、左停止時点で必ず避ける */
      if (cols[0].includes(SL_SYM.CHERRY)) penalty = 500;
    }
    if (!target) return penalty + 10;

    const avoidCherry = !allowed.has('CHERRY');
    let live = 0, guaranteed = 0;
    const lineSet = (flagRole === 'RARECHERRY') ? [SL_LINES[1]] : SL_LINES;
    lineSet.forEach(rows => {
      let ok = true;
      for (let c = 0; c < 3; c++){
        const t = target[c];
        if (t == null) continue;
        const cc = cols[c];
        if (!cc) continue;
        if (cc[rows[c]] !== t){ ok = false; break; }
      }
      if (!ok) return;
      live++;
      let sure = true;
      for (let c = 0; c < 3; c++){
        if (cols[c]) continue;
        const t = target[c];
        if (t == null) continue;
        if (!slCoversAllPresses(slAlignSet(c, t, rows[c], avoidCherry))){ sure = false; break; }
      }
      if (sure) guaranteed++;
    });
    /* ブドウは引き込みが保証された形をすべて同格に扱う(出目のバリエーション用) */
    if (flagRole === 'GRAPE') return penalty + (guaranteed > 0 ? 0 : 100);
    return penalty + (guaranteed > 0 ? 0 : 100) + (10 - live);
  };

  let bestScore = Infinity;
  for (const cand of candidates){
    cand.score = scoreOf(cand);
    if (cand.score < bestScore) bestScore = cand.score;
  }
  const bestList = candidates.filter(c => c.score === bestScore);
  if (flagRole === 'GRAPE' && bestList.length > 1){
    return bestList[Math.floor(Math.random() * bestList.length)].p;
  }
  return bestList[0].p;   // 通常は最小スベリ
}


/* BETできる上限。ボーナス中は2枚、通常は3枚 */
function slBetCap(m){ return m.inBonus ? 2 : 3; }

/* レバーON。ここで当たりが決まる(実機と同じ) */
function slLeverOn(m){
  m.cols = [null, null, null];
  m.pressOrder = [];
  m.rareLamp = false;

  if (m.inBonus){
    m.smallFlag = 'GRAPE';       // ボーナス中は毎ゲームブドウ
    m.dupCherry = false;
  } else {
    const sp = SL_SETTINGS[m.setting - 1];
    let newBonus = false, rareHit = false, dupCherry = false;

    if (!m.bonusFlag){
      const r = slRandom();
      if (r < sp.bb){
        m.bonusFlag = 'BB'; newBonus = true;
        if (r < slRareCherryProb(m.setting)) rareHit = true;              // 中段チェリー(BB内数)
        else if (slRandom() < SL_CHERRY_DUP_RATE) dupCherry = true;       // チェリー重複BB
      } else if (r < sp.bb + sp.rb){
        m.bonusFlag = 'RB'; newBonus = true;
        if (slRandom() < SL_CHERRY_DUP_RATE) dupCherry = true;            // チェリー重複RB
      }
    }

    /* 小役抽選 */
    if (rareHit){
      m.smallFlag = 'RARECHERRY';
      m.rareLamp = true;
    } else if (dupCherry){
      m.smallFlag = 'CHERRY';
    } else {
      const r2 = slRandom();
      let acc = 0;
      m.smallFlag = null;
      if      (r2 < (acc += sp.grape))     m.smallFlag = 'GRAPE';
      else if (r2 < (acc += SL_P_REPLAY))  m.smallFlag = 'REPLAY';
      else if (r2 < (acc += SL_P_CHERRY))  m.smallFlag = 'CHERRY';
      else if (r2 < (acc += SL_P_BELL))    m.smallFlag = 'BELL';
      else if (r2 < (acc += SL_P_CLOWN))   m.smallFlag = 'CLOWN';
    }
    m.dupCherry = !!(dupCherry || rareHit);

    /* GOGO!CHANCEの点灯タイミング(先ペカ15% / 後ペカ85%) */
    if (newBonus && !m.lampLit){
      if (slRandom() < SL_PEKA_FIRST) m.lampLit = true;   // 先ペカ
      else m.lampPending = true;                          // 後ペカ(第3停止離しで点灯)
    }
  }

  m.phase = 'spin';
  m.totalG++;
  if (!m.inBonus) m.startG++;
}

/* 3リール停止後の判定。払い出しとボーナス開始・終了をまとめて行う */
function slResolveGame(m){
  const cols = m.cols;
  const wins = slEvalWins(cols);
  const bet  = m.bet;

  /* リプレイ */
  const hasReplay = wins.some(w => w.role === 'REPLAY');

  /* ボーナス図柄が揃ったか */
  const bbAligned = wins.some(w => w.role === 'BB');
  const rbAligned = wins.some(w => w.role === 'RB');

  let pay = 0;
  if (!bbAligned && !rbAligned && !hasReplay){
    const cUnit = slCherryUnitFor(bet, cols, m.inBonus);
    pay = slPayoutFor(wins, bet, cUnit);
  }

  /* 後ペカ: 第3停止を離した時点で点灯する。
     単チェリー形が出たときは、抽選結果に関わらず必ず点灯させる(実機準拠) */
  let pekaNow = false;
  if (!m.inBonus && m.bonusFlag && !m.lampLit){
    if (m.lampPending) pekaNow = true;
    else if (slIsSoloCherry(cols, m.pressOrder)) pekaNow = true;
  }
  if (pekaNow){ m.lampLit = true; m.lampPending = false; }

  /* ボーナス開始 */
  let started = null;
  if (bbAligned || rbAligned){
    m.inBonus   = true;
    m.bonusType = bbAligned ? 'BB' : 'RB';
    m.bonusPaid = 0;
    m.bonusFlag = null;
    m.lampLit   = false;
    m.lampPending = false;
    if (bbAligned) m.bb++; else m.rb++;
    m.bonusLog.push({ type: m.bonusType, at: m.startG, g: m.totalG });
    if (m.bonusLog.length > 200) m.bonusLog.shift();
    m.startG = 0;                 // スタートG数は当選ではなく消化開始でリセットする
    started = m.bonusType;
  }

  /* ボーナス中の払い出しと終了判定 */
  let ended = null;
  if (m.inBonus && !started){
    m.bonusPaid += pay;
    const limit = m.bonusType === 'BB' ? SL_BB_LIMIT : SL_RB_LIMIT;
    if (m.bonusPaid > limit){
      ended = { type: m.bonusType, paid: m.bonusPaid };
      m.inBonus = false;
      m.bonusType = null;
      m.bonusPaid = 0;
    }
  }

  /* 払い出しの枚数は結果として返すだけ。
     実際のコインの増減はサーバーが持っているので、ここでは足さない
     (二重に足すと画面とサーバーで食い違う) */

  m.replayPending = hasReplay ? bet : 0;
  m.bet = 0;
  m.phase = 'idle';

  return { wins, pay, hasReplay, started, ended, peka: pekaNow, rare: m.rareLamp };
}


/* 1ゲームぶんの状態。サーバーの台オブジェクトと同じ形にしてあるので、
   slLeverOn() や slChooseStopPosition() をそのまま使える */
function slNewGameState(setting){
  return {
    setting: setting || 1,
    bb: 0, rb: 0, startG: 0, totalG: 0,
    credit: 0, tray: 0, invested: 0,
    phase: 'idle', bet: 0, replayPending: 0,
    cols: [null, null, null], pressOrder: [],
    smallFlag: null, bonusFlag: null, dupCherry: false,
    lampLit: false, lampPending: false, rareLamp: false,
    inBonus: false, bonusType: null, bonusPaid: 0,
    bonusLog: []
  };
}

/* 動きの間(ま)を決める数字。すべてジャグラーシミュレーターと同じ値にしてある。
   ここを変えると打ち心地が変わるので、触るときは juggler_handover.md と見比べること */
const SL_REV_MS      = 780;   // リール1回転にかかる時間(約77rpm)
const SL_WAIT_MS     = 4100;  // 実機規定のサイクルタイム(4.1秒)。前のゲームのレバーからこの時間が過ぎるまで次は回らない
const SL_STOP_GATE_MS= 600;   // レバー音が鳴っている間は停止ボタンを押せない
const SL_STOP_MIN_MS = 150;   // 停止操作の最小間隔(同時押し対策)
const SL_SLIP_MS     = 38;    // 1コマ滑るのにかける時間(実機の見え方に合わせてある)
const SL_BET_LAMP_MS = 50;    // BETランプを1本ずつ点けていく間隔
const SL_BET_CT_MS   = 100;   // BETを押してからレバーを受け付けるまで(同時押し対策)
const SL_COUNT_MS    = 100;   // COUNT/PAY OUT の数字が1つ増える間隔
const SL_END_HIDE_MS = 150;   // ボーナス終了後にCOUNTを「---」に戻すまで
const SL_COIN_VALUE  = 19;    // 精算レート。サーバーの SL_COIN_VALUE と合わせる
const SL_RENT_MEDAL  = 1000;  // 貸出に必要な所持メダル

/* スロットの設定(v5.1)。ジャグラーシミュレーターにあったものを移植した */
const slotOpt = {
  msgBar:       store.get('bj4_slMsgBar') !== '0',   // 既定ON
  oneBetOnLamp: store.get('bj4_slOneBet') === '1',
  easyLever:    store.get('bj4_slEasyLever') === '1'
};
function saveSlotOpt(){
  store.set('bj4_slMsgBar', slotOpt.msgBar ? '1' : '0');
  store.set('bj4_slOneBet', slotOpt.oneBetOnLamp ? '1' : '0');
  store.set('bj4_slEasyLever', slotOpt.easyLever ? '1' : '0');
}
function applySlotOpt(){
  if (el.slMsg) el.slMsg.hidden = !slotOpt.msgBar;
  if (el.slOptMsgBar)  el.slOptMsgBar.checked  = slotOpt.msgBar;
  if (el.slOptOneBet)  el.slOptOneBet.checked  = slotOpt.oneBetOnLamp;
  if (el.slOptEasyLever) el.slOptEasyLever.checked = slotOpt.easyLever;
}

const slot = {
  joined: false,      // ホールを見ているか
  seated: false,      // 台に座っているか
  no: 0,              // 座っている台番号
  lobby: null,        // ホールの一覧
  st: null,           // 自分の台の状態(サーバーから来たもの)
  phase: 'idle',      // idle | spin
  spinning: [false, false, false],
  stopped: [false, false, false],
  pending: [false, false, false],   // 停止要求を出して返事待ち
  lastStopAt: 0,
  gateAt: 0,
  gateTimer: 0,
  reels: [],
  raf: 0,
  payout: 0,
  g: null,            // 台の中身(抽選・停止判定はここを見て行う)
  setting: 1,

  /* ウェイト(実機の4.1秒サイクル)。
     前のゲームでレバーを引いた時刻を覚えておき、そこから4.1秒経つまで次は回さない */
  leverAt: 0,         // 最後にレバーが実際に効いた時刻
  inWait: false,      // ウェイト待ちの最中か
  waitTimer: 0,
  pendingLever: false,// ウェイト明けに回し始める予約

  /* BETランプの順次点灯 */
  betLampShown: 0,
  betLampTimer: 0,
  betCtUntil: 0,      // この時刻まではレバーを受け付けない
  betCtTimer: 0,

  /* COUNT / PAY OUT のカウントアップ演出 */
  dispCount: 0,       // いま画面に出ているCOUNT
  dispPayout: 0,      // いま画面に出ているPAY OUT
  countTimer: 0,
  countHidden: true,  // COUNTが「---」表示か
  replayLamp: false,  // リプレイランプ(回転中も消さないので独立して持つ)
  /* データ表示モード用。着席してからの記録 */
  log: [],            // 差枚の推移
  diff: 0,            // 現在差枚
  betSum: 0,          // 投入した枚数の合計
  paySum: 0,          // 払い出された枚数の合計
  bonusLog: []
};

/* コマの大きさを決める。ジャグラーシミュレーターと同じ計算にしてある。
   小役画像は 1280x470 なので、その比率でコマの高さを出す。
   隙間はコマ高さの10%、上下に覗かせる量は24%。 */
const SL_CELL_GAP_RATIO = 0.10;
const SL_PEEK_RATIO     = 0.24;
const slMetrics = { cellH: 60, gap: 6, peek: 14, pitch: 66 };

function slLayoutReels(){
  const reel = el.slReel0;
  if (!reel) return slMetrics;
  const w = reel.getBoundingClientRect().width;
  if (w > 0){
    const cellH = Math.round(w * 470 / 1280);
    const gap   = Math.round(cellH * SL_CELL_GAP_RATIO);
    const peek  = Math.round(cellH * SL_PEEK_RATIO);
    slMetrics.cellH = cellH;
    slMetrics.gap   = gap;
    slMetrics.peek  = peek;
    slMetrics.pitch = cellH + gap;
    const root = document.documentElement.style;
    root.setProperty('--sl-cellH', cellH + 'px');
    root.setProperty('--sl-cellGap', gap + 'px');
    root.setProperty('--sl-windowH', (cellH * 3 + gap * 2 + peek * 2) + 'px');
  }
  return slMetrics;
}

/* リールの帯を組み立てる。1周ぶんを2セット並べて、途切れなく回して見せる */
function slBuildStrip(idx){
  const { cellH, gap } = slMetrics;
  const reel = el['slReel' + idx];
  if (!reel) return;
  const strip = reel.querySelector('.sl-strip');
  let html = '';
  for (let rep = 0; rep < 2; rep++){
    for (let i = 0; i < SL_KOMA; i++){
      const sym = SL_REEL_DATA[idx][i];
      html += '<div class="sl-cell" style="height:' + cellH + 'px;margin-bottom:' + gap + 'px">' +
              '<img src="' + SL_SYM_IMG[sym] + '" alt="" draggable="false"></div>';
    }
  }
  strip.innerHTML = html;
}

function slBuildAllStrips(){
  slLayoutReels();
  for (let i = 0; i < 3; i++) slBuildStrip(i);
  slDrawReels();
}

/* 位置posのときの帯の縦位置を求めて反映する。
   pos<1のときは1周ぶんずらして、上に覗くコマが帯の外に出て空白になるのを防ぐ */
function slDrawReel(idx){
  const r = slot.reels[idx];
  if (!r) return;
  const reel = el['slReel' + idx];
  if (!reel) return;
  const strip = reel.querySelector('.sl-strip');
  const p = ((r.pos % SL_KOMA) + SL_KOMA) % SL_KOMA;
  const ep = p < 1 ? p + SL_KOMA : p;
  const y = slMetrics.peek - ep * slMetrics.pitch;
  strip.style.transform = 'translate3d(0,' + y.toFixed(2) + 'px,0)';
}
function slDrawReels(){ for (let i = 0; i < 3; i++) slDrawReel(i); }

/* 毎フレーム、回っているリールを進める。
   実機は図柄が「上から下」へ流れるので、posは減る向きに動かす。
   停止するときは、決まったコマ数ぶんだけ滑らせてから止める */
function slTick(now){
  slot.raf = 0;
  let moving = false;
  for (let i = 0; i < 3; i++){
    const r = slot.reels[i];
    if (!r || !r.spin) continue;
    moving = true;
    const dt = Math.min(50, now - (r.last || now));
    r.last = now;

    if (r.remain != null){
      /* 停止中。残りのコマ数を減らしていき、0になったらぴたりと止める */
      const step = dt / SL_SLIP_MS;
      r.remain -= step;
      if (r.remain <= 0.001){
        r.pos = r.target;
        r.spin = false;
        r.remain = null;
        r.target = null;
        slot.spinning[i] = false;
        slot.stopped[i] = true;
        audio.play('chip');
        slSyncStopButtons();
      } else {
        r.pos = slMod(r.target + r.remain, SL_KOMA);
      }
    } else {
      r.pos = slMod(r.pos - (dt / SL_REV_MS) * SL_KOMA, SL_KOMA);
    }
    slDrawReel(i);
  }
  if (moving) slot.raf = requestAnimationFrame(slTick);
}
function slStartLoop(){
  if (!slot.raf) slot.raf = requestAnimationFrame(slTick);
}

/* ---------- ホール(台選び) ---------- */

async function enterSlotHall(){
  if (!account.user){
    toast('スロットで遊ぶにはログインが必要です');
    openOverlay(el.accountOverlay);
    return;
  }
  slot.joined = true;
  showScreen('slotHall');
  el.slHall.innerHTML = '<p class="empty-note">読み込み中…</p>';
  try {
    const sock = await ensureSocket();
    if (!slot.joined) return;
    sock.emit('slot:lobby');
  } catch {
    el.slHall.innerHTML = '<p class="empty-note">接続できませんでした</p>';
  }
}

function leaveSlotHall(){
  slot.joined = false;
  if (online.socket && online.socket.connected) online.socket.emit('slot:leaveLobby');
  showScreen('gameSelect');
}

function renderSlotHall(){
  const d = slot.lobby;
  if (!d || !el.slHall) return;
  const busy = d.machines.filter(m => m.seat).length;
  el.slHallCount.textContent = d.machines.length + '台中 ' + busy + '台プレイ中';

  el.slHall.innerHTML = d.machines.map(m => {
    const mine = account.user && m.seat === account.user.username;
    const badge = !m.seat ? '<span class="sl-badge is-open">空席</span>'
                : m.offline ? '<span class="sl-badge is-off">離席中</span>'
                : '<span class="sl-badge is-busy">プレイ中</span>';
    const who = m.seat
      ? '<span>' + nameHTML(m.seat) + '</span>'
      : '<span class="sl-empty">だれでも座れます</span>';
    const rate = m.rate ? '1/' + m.rate.toFixed(1) : '1/---';
    const canSit = !m.seat || mine;
    return '<div class="sl-machine-card' + (mine ? ' is-mine' : '') + '">' +
      '<div class="sl-machine-head">' +
        '<span class="sl-machine-no">' + m.no + '<small>番台</small></span>' + badge +
      '</div>' +
      '<div class="sl-machine-user">' + who + '</div>' +
      '<div class="sl-machine-data">' +
        '<div class="sl-row"><span class="sl-k">BB</span><span class="sl-v is-bb">' + m.bb + '</span></div>' +
        '<div class="sl-row"><span class="sl-k">RB</span><span class="sl-v is-rb">' + m.rb + '</span></div>' +
        '<div class="sl-row"><span class="sl-k">スタート</span><span class="sl-v">' + m.startG + '</span></div>' +
        '<div class="sl-row"><span class="sl-k">総回転</span><span class="sl-v">' + m.totalG + '</span></div>' +
        '<div class="sl-row is-wide"><span class="sl-k">合成確率</span><span class="sl-v">' + rate + '</span></div>' +
      '</div>' +
      '<button type="button" class="btn' + (canSit ? ' primary' : '') + '" data-sit="' + m.no + '"' +
        (canSit ? '' : ' disabled') + '>' +
        (mine ? '台に戻る' : canSit ? '着席する' : '使用中') +
      '</button>' +
    '</div>';
  }).join('');
}

/* ---------- 台に座る ---------- */

function slSit(no){
  if (!online.socket || !online.socket.connected) return;
  online.socket.emit('slot:sit', { no });
}

/* 着席したときの初期化。台のデータは引き継ぐが、
   差枚などの「自分の記録」はここから数え直す */
function slEnterMachine(st){
  slot.seated = true;
  slot.no = st.no;
  slot.st = st;
  slot.setting = st.setting || 1;
  slot.phase = 'idle';
  slot.spinning = [false, false, false];
  slot.stopped = [true, true, true];
  slot.pending = [false, false, false];
  slot.payout = 0;
  slot.reels = [0, 1, 2].map(i => ({ pos: i * 7, spin: false, target: null, remain: null, last: 0 }));

  /* 台の中身を作る。抽選と停止判定はこれを見て行う */
  slot.g = slNewGameState(st.setting || 1);
  slot.g.bb = st.bb; slot.g.rb = st.rb;
  slot.g.startG = st.startG; slot.g.totalG = st.totalG;
  slot.g.credit = st.credit; slot.g.tray = st.tray || 0;
  slot.g.lampLit = !!st.lampLit;
  slot.g.bonusLog = (st.bonusLog || []).slice();
  slot.bonusLog = slot.g.bonusLog;
  /* 前の続きから打てるよう、ランプが点いていればフラグも戻す */
  if (st.lampLit && !st.inBonus) slot.g.bonusFlag = st.bonusFlag || 'BB';
  slot.g.inBonus = !!st.inBonus;
  slot.g.bonusType = st.bonusType || null;
  slot.g.bonusPaid = st.bonusPaid || 0;
  slot.g.replayPending = st.replayPending || 0;

  /* 演出まわりの状態も入れ直す */
  slClearWait();
  slClearBetLampAnim();
  slStopCountAnim();
  slot.leverAt = 0;
  slot.betLampShown = 0;
  slot.betCtUntil = 0;
  slot.dispPayout = 0;
  slot.dispCount = st.bonusPaid || 0;
  slot.countHidden = !st.inBonus;
  slot.replayLamp = (st.replayPending || 0) > 0;

  applySlotOpt();
  slSetConn(online.socket && online.socket.connected ? 'on' : 'off');

  showScreen('slot');
  /* 画面が出てからでないとリールの幅が測れないので、描画のあとに組み立てる */
  slBuildAllStrips();
  requestAnimationFrame(() => { slBuildAllStrips(); slRenderAll(); });
  slRenderAll();
}

/* ---------- 画面の更新 ---------- */

function slRenderAll(){
  const st = slot.st;
  const g  = slot.g;
  if (!st) return;
  const coins = (st.coins != null ? st.coins : st.credit);
  /* BETやボーナスの状態は、押した瞬間に見た目へ出したいので手元の g を優先する */
  const bet     = g ? g.bet : st.bet;
  const inBonus = g ? g.inBonus : st.inBonus;
  const bonusType = g ? g.bonusType : st.bonusType;
  const bonusPaid = g ? g.bonusPaid : st.bonusPaid;
  const lampLit = g ? g.lampLit : st.lampLit;
  const rareLamp= g ? g.rareLamp : st.rareLamp;
  const bb = g ? g.bb : st.bb;
  const rb = g ? g.rb : st.rb;
  const startG = g ? g.startG : st.startG;
  const totalG = g ? g.totalG : st.totalG;
  const rate = (bb + rb) && totalG ? totalG / (bb + rb) : null;

  el.slMachineNo.textContent = st.no + '番台';

  /* データカウンター */
  el.slDataBB.textContent = bb;
  el.slDataRB.textContent = rb;
  el.slDataStart.textContent = startG;
  el.slDataTotal.textContent = totalG;
  el.slDataRate.textContent = rate ? '1/' + rate.toFixed(1) : '1/---';

  /* 情報バー。回収は「いま精算したら戻ってくるメダル」 */
  const back = (coins + bet) * SL_COIN_VALUE;
  const diff = back - st.invested;
  el.slWCoin.textContent   = coins;
  el.slWInvest.textContent = st.invested.toLocaleString();
  el.slWBack.textContent   = back.toLocaleString();
  el.slWDiff.textContent   = (diff >= 0 ? '+' : '') + diff.toLocaleString();
  el.slWDiff.style.color   = diff >= 0 ? '#7fd4ff' : '#ff8a8a';

  /* 7セグ。数字はカウントアップ演出が持っているので、そちらに任せる */
  slDrawSeg();

  /* BETランプ。枚数が増えたときは1本ずつ点ける(演出は slSetBetLamps が持つ) */
  if (bet !== slot.betLampShown && !slot.betLampTimer) slSetBetLamps(bet);

  slUpdateStateLamps();

  /* GOGO!CHANCE */
  const lit = !!lampLit, rainbow = !!rareLamp && lit;
  el.slGogoOff.hidden = lit;
  el.slGogoOn.hidden = !lit;
  el.slGogoRainbow.hidden = !rainbow;
  el.slGogo.classList.toggle('is-lit', lit);
  el.slGogo.classList.toggle('is-rainbow', rainbow);

  slRenderBonusGraph();
  slSyncButtons();
}

/* データカウンター右側の履歴グラフ。
   最新10回ぶんのボーナスを、当たったゲーム数の深さで棒にして並べる。
   1段=約78G(9段で700G)。BB=赤 / RB=黄 */
function slRenderBonusGraph(){
  const box = el.slBonusGraph;
  if (!box) return;
  const list = (slot.bonusLog || []).slice(-10);
  let html = '';
  for (let c = 0; c < 10; c++){
    const b = list[c];
    let lv = 0, cls = '';
    if (b){
      lv = Math.max(1, Math.min(9, Math.ceil((b.at || 0) / 78)));
      cls = b.type === 'BB' ? 'is-b' : 'is-r';
    }
    html += '<div class="sl-bg-col">';
    for (let r = 0; r < 9; r++){
      html += '<span class="sl-bg-cell' + (b && r < lv ? ' ' + cls : '') + '"></span>';
    }
    html += '</div>';
  }
  box.innerHTML = html;
}

/* 状態ランプ(Start / Replay / Wait / Insert Medals)をまとめて面倒みる。
   実機の点灯条件に合わせてある */
function slUpdateStateLamps(){
  const st = slot.st, g = slot.g;
  if (!st) return;
  const idle = slot.phase === 'idle';
  const bet = g ? g.bet : st.bet;

  /* Start … レバー待ちで、BETかリプレイがある */
  el.slLampStart.classList.toggle('is-on', idle && (bet > 0 || st.replayPending > 0));
  /* Wait … ウェイトの最中だけ */
  el.slLampWait.classList.toggle('is-on', !!slot.inWait);
  /* Replay … 回転中も消さない。次のゲームの結果が出るまで点いたまま */
  el.slLampReplay.classList.toggle('is-on', !!slot.replayLamp);
  /* Insert Medals … レバー待ちの間はずっと点滅(BET数に関わらず) */
  el.slLampInsert.classList.toggle('is-blink', idle);
  el.slLampInsert.classList.toggle('is-on', false);
}

/* ボタンの押せる・押せないを揃える */
function slSyncButtons(){
  const st = slot.st, g = slot.g;
  if (!st) return;
  const idle = slot.phase === 'idle';
  const coins = (st.coins != null ? st.coins : st.credit);
  const bet = g ? g.bet : st.bet;
  const inBonus = g ? g.inBonus : st.inBonus;
  const lampLit = g ? g.lampLit : st.lampLit;
  const cap = slBetCapNow();

  /* メダルが足りないのに押せてしまうと「押したのに借りられない」ので、
     足りないときは最初から押せなくしておく */
  const medal = account.user ? Number(account.user.medal || 0) : 0;
  el.slRentBtn.disabled = !idle || medal < SL_RENT_MEDAL;
  el.slBet1Btn.disabled = !idle || st.replayPending > 0 || coins < 1 || bet >= cap || inBonus;
  el.slMaxBetBtn.disabled = !idle || st.replayPending > 0 || (coins < 1 && bet === 0) || bet >= cap;
  el.slCashoutBtn.disabled = !idle;

  /* 0BETのときはレバーをグレーアウトする(簡単レバーモードなら引ける)。
     BETの直後・ウェイト中も受け付けない */
  const canLever = idle && !slot.inWait && !slBetCtActive() && slCanPullLever() &&
                   !(inBonus && bet < 2 && st.replayPending === 0);
  el.slLever.classList.toggle('is-off', !canLever);
  slSyncStopButtons();
}

function slSyncStopButtons(){
  const spinning = slot.phase === 'spin';
  /* レバーONから少しの間は停止を受け付けない(実機のウェイト)。
     この間もボタンが光っていると「押したのに止まらない」と感じるので、
     ウェイト中は消灯させて押せないようにする */
  const gated = performance.now() < slot.gateAt;
  for (let i = 0; i < 3; i++){
    const btn = el['slStop' + i];
    if (!btn) continue;
    const live = spinning && !gated && !slot.stopped[i] && !slot.pending[i];
    btn.disabled = !live;
    btn.classList.toggle('is-live', live);
  }
  /* 状態ランプは slUpdateStateLamps() が一手に面倒をみるので、ここでは触らない */
}

function slMsg(text){ if (el.slMsg) el.slMsg.textContent = text; }

/* =========================================================
   動きの間(ま)まわり。実機に合わせた仕掛け
   ========================================================= */

/* ---- ウェイト(実機の4.1秒サイクル) ----
   実機は1ゲームにかならず4.1秒かける決まりになっている。
   前のゲームのレバーから4.1秒経っていない状態でレバーを引くと、
   レバー音もレバーの動きもリールの回転もぜんぶ保留になり、
   ウェイトが明けた瞬間にまとめて始まる。 */
function slWaitLeft(){
  if (!slot.leverAt) return 0;
  return Math.max(0, SL_WAIT_MS - (performance.now() - slot.leverAt));
}

function slBeginWait(ms){
  slot.inWait = true;
  slot.pendingLever = true;
  slMsg('ウェイト');
  slUpdateStateLamps();   // Waitランプをすぐ点ける
  slSyncButtons();
  clearTimeout(slot.waitTimer);
  slot.waitTimer = setTimeout(() => {
    slot.inWait = false;
    slot.waitTimer = 0;
    slUpdateStateLamps();   // Waitランプを消す
    if (slot.pendingLever){
      slot.pendingLever = false;
      slDoLever();          // ウェイト明け。ここで初めて回り出す
    } else {
      slRenderAll();
    }
  }, ms);
}

function slClearWait(){
  clearTimeout(slot.waitTimer);
  slot.waitTimer = 0;
  slot.inWait = false;
  slot.pendingLever = false;
}

/* ---- BETランプの順次点灯 ----
   MAXBETで1・2・3を同時に光らせず、0.05秒ずつずらして1本ずつ点ける */
function slRenderBetLamps(){
  for (let i = 1; i <= 3; i++){
    el['slBetLamp' + i].classList.toggle('is-on', slot.betLampShown >= i);
  }
}
function slClearBetLampAnim(){
  clearTimeout(slot.betLampTimer);
  slot.betLampTimer = 0;
}
function slAnimateBetLamps(target){
  slClearBetLampAnim();
  const step = () => {
    if (slot.betLampShown >= target){ slot.betLampTimer = 0; return; }
    slot.betLampShown++;
    slRenderBetLamps();
    slot.betLampTimer = setTimeout(step, SL_BET_LAMP_MS);
  };
  /* 1本目は待たずに点ける */
  step();
}
function slSetBetLamps(target){
  if (target > slot.betLampShown){
    slAnimateBetLamps(target);            // 増えるときだけ演出する
  } else {
    slClearBetLampAnim();
    slot.betLampShown = target;           // 減る・消えるは即座に
    slRenderBetLamps();
  }
}

/* ---- BETクールタイム ----
   BETを押した直後にレバーが効いてしまうと、押したつもりのない枚数で回ってしまう。
   この間はレバーをグレーアウトするので、明けたら必ず元に戻すこと
   (戻し忘れると、押せるのに押せない見た目のままになる) */
function slStartBetCT(){
  slot.betCtUntil = performance.now() + SL_BET_CT_MS;
  clearTimeout(slot.betCtTimer);
  slot.betCtTimer = setTimeout(() => {
    slot.betCtTimer = 0;
    slSyncButtons();          // グレーアウトを解除する
  }, SL_BET_CT_MS + 10);
}
function slBetCtActive(){ return performance.now() < slot.betCtUntil; }

/* ---- COUNT / PAY OUT のカウントアップ ----
   実機は払い出し枚数がパラパラと増えていく。0.1秒ごとに1つ進める */
function slStopCountAnim(){
  clearTimeout(slot.countTimer);
  slot.countTimer = 0;
}
function slTickCount(){
  const g = slot.g;
  const targetPay = slot.payout;
  const targetCount = (g && g.inBonus) ? g.bonusPaid : slot.dispCount;
  let moved = false;

  if (slot.dispPayout < targetPay){ slot.dispPayout++; moved = true; }
  if (g && g.inBonus && slot.dispCount < targetCount){ slot.dispCount++; moved = true; }

  slDrawSeg();
  if (moved){
    slot.countTimer = setTimeout(slTickCount, SL_COUNT_MS);
  } else {
    slot.countTimer = 0;
  }
}
function slStartCountAnim(){
  if (slot.countTimer) return;
  slot.countTimer = setTimeout(slTickCount, SL_COUNT_MS);
}

/* 7セグの描画だけを切り出したもの(カウントアップ中に何度も呼ぶため) */
function slDrawSeg(){
  const st = slot.st, g = slot.g;
  if (!st) return;
  el.slSegCredit.textContent = st.credit;
  el.slSegPayout.textContent = slot.dispPayout;
  el.slSegCount.textContent = slot.countHidden ? '---' : slot.dispCount;
}

/* ボーナスが終わったあと、少し置いてからCOUNTを「---」に戻す */
function slHideCount(){
  setTimeout(() => {
    slot.countHidden = true;
    slot.dispCount = 0;
    slDrawSeg();
  }, SL_END_HIDE_MS);
}


/* ---------- 操作 ---------- */

function slRent(){
  if (!online.socket) return;
  online.socket.emit('slot:rent');
  audio.play('chip');
}

/* BET。nを省略するとMAXBET。
   コインの出し入れはサーバーが持っているので、押した内容をそのまま送る。
   ただし見た目はすぐ変えたいので、手元の状態も同時に進める */
function slBet(n){
  const g = slot.g, st = slot.st;
  if (!g || !st || slot.phase !== 'idle') return;
  if (st.replayPending > 0) return;

  const cap = slBetCapNow();
  const want = (n === undefined || n === null) ? cap : Math.floor(Number(n) || 0);
  if (!Number.isFinite(want) || want < 1) return;
  if (g.inBonus && want < 2 && n !== undefined) return;

  const coins = (st.coins != null ? st.coins : st.credit);
  const add = Math.min(want, cap - g.bet, coins);
  if (add <= 0) return;

  g.bet += add;
  slStartBetCT();                 // 押した直後はレバーを受け付けない
  slSetBetLamps(g.bet);           // ランプは1本ずつ点ける
  online.socket.emit('slot:bet', n === undefined ? { n: cap } : { n: add });
  audio.play('chip');
  slRenderAll();
}

/* いまBETできる上限。ボーナス中は2枚が最優先、
   次に「GOGO中は1BETのみ」の設定、それ以外は3枚 */
function slBetCapNow(){
  const g = slot.g;
  if (!g) return 3;
  if (g.inBonus) return 2;
  if (slotOpt.oneBetOnLamp && g.lampLit) return 1;
  return 3;
}

/* レバーを引けるか(BET枚数の観点だけ) */
function slCanPullLever(){
  const g = slot.g, st = slot.st;
  if (!g || !st) return false;
  if (st.replayPending > 0) return true;
  if (g.bet > 0) return true;
  /* 簡単レバーモードのときだけ、BET0でも引ける */
  const coins = (st.coins != null ? st.coins : st.credit);
  return !!slotOpt.easyLever && coins >= 1;
}

/* レバーON。ウェイトが残っていれば、明けるまで待ってから回し始める */
function slLever(){
  const g = slot.g, st = slot.st;
  if (!g || !st || slot.phase !== 'idle') return;
  if (slot.inWait) return;                 // すでにウェイト待ち
  if (slBetCtActive()) return;             // BETの直後は受け付けない

  /* 簡単レバーモード。BETしていない状態でレバーを引いたらMAXBETしてから */
  if (g.bet === 0 && st.replayPending === 0){
    if (!slotOpt.easyLever){ slMsg('メダルをBETしてください'); return; }
    slBet();
    if (g.bet === 0) return;               // コインが足りなかった
  }
  if (st.replayPending > 0 && g.bet === 0) g.bet = st.replayPending;
  if (g.bet < 1) return;
  if (g.inBonus && g.bet < 2){ slMsg('MAXBETしてください'); return; }

  /* 実機は1ゲームに4.1秒かける。残っていれば、その間ぜんぶ保留する */
  const left = slWaitLeft();
  if (left > 0){ slBeginWait(left); return; }
  slDoLever();
}

/* 実際に回し始めるところ。ウェイトが明けたあともここに来る */
function slDoLever(){
  const g = slot.g;
  if (!g) return;

  slot.leverAt = performance.now();
  el.slLever.classList.add('is-pulled');
  setTimeout(() => el.slLever.classList.remove('is-pulled'), 160);

  /* 抽選(実機の内部抽選と同じ。レバーを叩いた瞬間に決まる) */
  slLeverOn(g);

  slot.phase = 'spin';
  slot.stopped = [false, false, false];
  slot.pending = [false, false, false];
  slot.payout = 0;
  slot.dispPayout = 0;
  slStopCountAnim();
  slot.gateAt = performance.now() + SL_STOP_GATE_MS;
  slot.betSum += g.bet;

  const now = performance.now();
  for (let i = 0; i < 3; i++){
    const r = slot.reels[i];
    r.spin = true; r.target = null; r.remain = null; r.last = now;
  }
  slStartLoop();
  slMsg('');
  el.slReelWindow.classList.remove('is-win');
  audio.play('button');

  /* 台のデータはサーバーにも残しておく(他の人のホール表示に出るため) */
  if (online.socket) online.socket.emit('slot:spin', { bet: g.bet });

  slSyncStopButtons();
  clearTimeout(slot.gateTimer);
  slot.gateTimer = setTimeout(slSyncStopButtons, SL_STOP_GATE_MS + 10);
  slRenderAll();
}

/* 停止ボタン。押した瞬間にここで停止位置を決めて、そのまま止める */
function slStop(idx){
  const g = slot.g;
  if (!g || slot.phase !== 'spin') return;
  if (slot.stopped[idx] || g.cols[idx]) return;
  const now = performance.now();
  if (now - slot.lastStopAt < SL_STOP_MIN_MS) return;
  if (now < slot.gateAt) return;
  slot.lastStopAt = now;

  const r = slot.reels[idx];
  if (!r) return;
  const cur = slMod(r.pos, SL_KOMA);
  const stopPos = slChooseStopPosition(g, idx, cur);

  g.cols[idx] = slWindowCol(idx, stopPos);
  g.pressOrder.push(idx);

  /* 何コマ滑るかを出して、そのぶんだけ動かしてから止める */
  r.target = stopPos;
  r.remain = slMod(cur - stopPos, SL_KOMA);
  if (r.remain > SL_MAX_SLIP + 0.5) r.remain = slMod(r.remain, 1);
  slStartLoop();
  slSyncStopButtons();

  if (g.pressOrder.length < 3) return;

  /* 3つとも押し終えたので結果を出す */
  const res = slResolveGame(g);
  slAfterGame(res);
}

/* 1ゲームの後始末。表示を更新して、結果をサーバーにも伝える */
function slAfterGame(res){
  const g = slot.g;
  slot.phase = 'idle';
  slot.payout = res.pay || 0;
  slot.paySum += res.pay || 0;
  slot.diff = slot.paySum - slot.betSum;
  slot.log.push(slot.diff);
  if (slot.log.length > 5000) slot.log.shift();
  slot.bonusLog = g.bonusLog;

  /* リプレイランプは、次のゲームの結果が出るまで点けたままにする(実機と同じ)。
     リール回転中に消えないよう、replayPending とは別に持っている */
  slot.replayLamp = !!res.hasReplay;

  /* BETランプは消す */
  slSetBetLamps(0);

  /* ボーナスに入ったらCOUNTを0から出す */
  if (res.started){
    slot.countHidden = false;
    slot.dispCount = 0;
  }
  /* 払い出しはパラパラと増やす */
  if (res.pay > 0 || (g.inBonus && !res.started)) slStartCountAnim();
  else slDrawSeg();

  if (res.pay > 0){
    el.slReelWindow.classList.add('is-win');
    setTimeout(() => el.slReelWindow.classList.remove('is-win'), 1300);
    audio.play('chip');
  }
  if (res.peka){
    audio.play('win');
    slMsg('GOGO! CHANCE 点灯!');
  } else if (res.started){
    audio.play('win');
    slMsg(res.started === 'BB' ? 'BIG BONUS スタート!' : 'REGULAR BONUS スタート!');
  } else if (res.ended){
    slMsg(res.ended.type + ' 終了  ' + res.ended.paid + '枚獲得');
    slHideCount();
  } else if (res.hasReplay){
    slMsg('リプレイ');
  } else if (res.pay > 0){
    slMsg(res.pay + '枚 払い出し');
  } else {
    slMsg('');
  }

  /* サーバーに結果を伝えて、コインと台データを更新してもらう */
  if (online.socket){
    online.socket.emit('slot:report', {
      pay: res.pay || 0,
      replay: !!res.hasReplay,
      started: res.started || null,
      ended: res.ended ? res.ended.type : null,
      bb: g.bb, rb: g.rb,
      startG: g.startG, totalG: g.totalG,
      lampLit: !!g.lampLit
    });
  }
  slSyncStopButtons();
  slRenderAll();
}

async function slCashout(){
  if (slot.phase !== 'idle') return;
  const st = slot.st, g = slot.g;
  const coins = st ? (st.coins != null ? st.coins : st.credit) + (g ? g.bet : st.bet) : 0;
  const ok = await askConfirm({
    title: '精算して席を立ちますか?',
    text: 'コイン ' + coins + '枚 を ' + (coins * SL_COIN_VALUE).toLocaleString() + ' メダルとして受け取ります。',
    warn: '席を立つと、この台は他の人が座れるようになります。',
    okText: '精算する'
  });
  if (!ok) return;
  if (online.socket) online.socket.emit('slot:cashout');
}

/* ---------- サーバーからの受信 ---------- */

function onSlotLobby(d){
  slot.lobby = d;
  if (screen === 'slotHall') renderSlotHall();
}

function onSlotSat(st){
  slot.log = [];
  slot.diff = 0;
  slot.betSum = 0;
  slot.paySum = 0;
  slot.bonusLog = [];
  slEnterMachine(st);
  slMsg('メダルを借りてゲームスタート!');
  audio.play('join');
}

/* 切断から戻ってきたとき。台のデータは引き継ぐ */
function onSlotResume(st){
  slEnterMachine(st);
  slMsg('前に打っていた ' + st.no + '番台に戻りました');
  toast(st.no + '番台に戻りました');
}

function onSlotState(st){
  slot.st = st;
  /* コインの枚数と台データはサーバーが正。手元の状態にも反映しておく */
  if (slot.g){
    slot.g.credit = st.credit;
    slot.g.tray   = st.tray || 0;
    if (slot.phase === 'idle' && st.bet === 0 && slot.g.bet !== 0 && st.replayPending === 0){
      /* サーバー側でBETが取り消された(精算など) */
      slot.g.bet = 0;
    }
  }
  if (screen === 'slot') slRenderAll();
}

/* 精算した(自分で押した場合も、0時や自動退席の場合もここに来る) */
function onSlotCashout(d){
  slot.seated = false;
  slot.phase = 'idle';
  slot.g = null;
  slClearWait();
  slClearBetLampAnim();
  slStopCountAnim();
  clearTimeout(slot.betCtTimer); slot.betCtTimer = 0;
  for (const r of slot.reels) { r.spin = false; r.target = null; r.remain = null; }
  if (slot.raf){ cancelAnimationFrame(slot.raf); slot.raf = 0; }

  const gain = d.gain || 0;
  const sign = gain >= 0 ? '+' : '';
  if (d.reason === 'reset'){
    toast('0時になったため精算しました(' + sign + gain.toLocaleString() + 'メダル)');
  } else if (d.reason === 'offline'){
    toast('自動退席しました(' + sign + gain.toLocaleString() + 'メダル)');
  } else {
    toast('精算しました  コイン' + d.coins + '枚 → ' +
          d.medal.toLocaleString() + 'メダル(' + sign + gain.toLocaleString() + ')');
  }
  if (d.user) setAccount(d.user);

  if (screen === 'slot'){
    slot.joined = true;
    showScreen('slotHall');
    if (online.socket && online.socket.connected) online.socket.emit('slot:lobby');
  }
}

/* 接続の状態を上部に出す */
function slSetConn(state){
  if (!el.slConnDot) return;
  const on = state === 'on';
  el.slConnDot.classList.toggle('is-on', on);
  el.slConnDot.classList.toggle('is-off', !on);
  el.slConnText.textContent = on ? '接続中' : '接続が切れています';
  el.slConnChip.classList.toggle('is-off', !on);
}

/* ---------- データ表示モード ---------- */

function openSlotData(){
  slRenderData();
  openOverlay(el.slotDataOverlay);
}

function slRenderData(){
  const st = slot.st;
  const g = st ? st.totalG : 0;
  const bb = st ? st.bb : 0;
  const rb = st ? st.rb : 0;

  el.slStatBB.textContent = bb ? '1/' + (g / bb).toFixed(1) : '1/---';
  el.slStatRB.textContent = rb ? '1/' + (g / rb).toFixed(1) : '1/---';
  el.slStatRate.textContent = slot.betSum
    ? (slot.paySum / slot.betSum * 100).toFixed(1) + '%' : '---%';
  el.slStatAvg.textContent = (bb + rb) ? Math.round(g / (bb + rb)) : '---';
  const d = slot.diff;
  el.slStatDiff.textContent = (d >= 0 ? '+' : '') + d;

  slDrawGraph();
  slRenderHistory();
}

/* 差枚グラフ */
function slDrawGraph(){
  const cv = el.slGraphCanvas;
  if (!cv) return;
  const ctx = cv.getContext('2d');
  const W = cv.width, H = cv.height;
  ctx.clearRect(0, 0, W, H);

  /* 目盛り */
  const data = slot.log;
  let max = 500, min = -500;
  for (const v of data){ if (v > max) max = v; if (v < min) min = v; }
  const pad = 28;
  const y0 = (v) => pad + (max - v) / (max - min) * (H - pad * 2);

  ctx.strokeStyle = 'rgba(255,255,255,.12)';
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(pad, y0(0)); ctx.lineTo(W - pad, y0(0)); ctx.stroke();

  ctx.fillStyle = 'rgba(243,238,226,.55)';
  ctx.font = '11px sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText('+' + max, 4, y0(max) + 10);
  ctx.fillText(String(min), 4, y0(min) - 2);
  ctx.fillText('0', 4, y0(0) - 3);

  if (data.length < 2){
    ctx.fillStyle = 'rgba(243,238,226,.4)';
    ctx.textAlign = 'center';
    ctx.fillText('まだデータがありません', W / 2, H / 2);
    return;
  }

  ctx.strokeStyle = '#35FF6E';
  ctx.lineWidth = 2;
  ctx.beginPath();
  data.forEach((v, i) => {
    const x = pad + i / (data.length - 1) * (W - pad * 2);
    const y = y0(v);
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  });
  ctx.stroke();
}

function slRenderHistory(){
  const list = slot.bonusLog || [];
  if (!list.length){
    el.slHistory.innerHTML = '<p class="empty-note">まだボーナスがありません</p>';
    return;
  }
  el.slHistory.innerHTML = list.slice().reverse().map((b, i) => {
    const no = list.length - i;
    const cls = b.type === 'BB' ? 'is-bb' : 'is-rb';
    return '<div class="sl-hist-row">' +
      '<span class="sl-hist-no">' + no + '</span>' +
      '<span class="sl-hist-type ' + cls + '">' + b.type + '</span>' +
      '<span class="sl-hist-g">' + b.at + 'G</span>' +
    '</div>';
  }).join('');
}

function chatIsMarble(){ return screen === 'marble' && marble.joined; }

function chatAvailable(){
  /* 観戦者はチャットを見られない(v3.0) */
  if (view.spectating) return false;
  return view.mode === 'online'
      && online.socket && online.socket.connected
      && (screen === 'room' || screen === 'game' || chatIsMarble());
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

/* チャットの表示領域は最大4件分まで(v3.1)
   吹き出しの高さは中身(文字数・スタンプ)で変わるので、
   実際に描画された直近4件を測って上限を決める。5件目からはスクロールになる。 */
const CHAT_MAX_ROWS = 4;

function fitChatLog(){
  const log = el.chatLog;
  if (el.chatPanel.hidden) return;

  log.style.maxHeight = '';
  const items = Array.from(log.children).filter(n => !n.classList.contains('chat-empty'));
  if (items.length <= CHAT_MAX_ROWS) return;

  const cs = getComputedStyle(log);
  const padY = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
  const gap = parseFloat(cs.rowGap || cs.gap) || 0;

  const tail = items.slice(-CHAT_MAX_ROWS);
  let h = 0;
  for (const n of tail) h += n.getBoundingClientRect().height;
  h += gap * (CHAT_MAX_ROWS - 1) + padY;

  log.style.maxHeight = Math.ceil(h) + 'px';
}

function scrollChatToEnd(){
  fitChatLog();
  el.chatLog.scrollTop = el.chatLog.scrollHeight;
}

function openChat(){
  chat.open = true;
  chat.unread = 0;
  el.chatPanel.hidden = false;
  el.chatBadge.hidden = true;
  el.chatFloat.innerHTML = '';
  renderChatLog();
  scrollChatToEnd();
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
        (mine ? '' : '<span class="chat-who">' + nameHTML(m.from) + '</span>') +
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
    node.innerHTML = '<b>' + nameHTML(m.from) + '</b>' + esc(m.body);
  } else {
    node.innerHTML = '<b>' + nameHTML(m.from) + '</b>' + esc(m.body);
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
    scrollChatToEnd();
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

/* 会場チャットとルームチャットで送り先を切り替える(v4.5) */
function chatEvent(){ return chatIsMarble() ? 'marble:chat' : 'chat:send'; }

function sendChatText(){
  const text = el.chatInput.value.trim();
  if (!text || !online.socket) return;
  online.socket.emit(chatEvent(), { text });
  el.chatInput.value = '';
  audio.play('button');
}

function sendChatStamp(stamp){
  if (!online.socket) return;
  online.socket.emit(chatEvent(), { stamp });
  audio.play('button');
}

/* マーブルレース専用の応援スタンプ(v4.5) */
function sendChatCheer(cheer){
  if (!online.socket || !chatIsMarble()) return;
  online.socket.emit('marble:chat', { cheer });
  audio.play('button');
}

/* 応援スタンプのボタンを並べる。会場にいるときだけ出す */
function renderMarbleCheers(){
  if (!el.mrCheerRow) return;
  const on = chatIsMarble();
  el.mrCheerRow.hidden = !on;
  if (!on) return;

  const list = (marble.state && marble.state.cheers) || [];
  const sig = list.join('|');
  if (el.mrCheerRow.dataset.sig === sig) return;   // 中身が同じなら作り直さない
  el.mrCheerRow.dataset.sig = sig;
  el.mrCheerRow.innerHTML = list.map(c =>
    '<button type="button" class="mr-cheer" data-cheer="' + esc(c) + '">' + esc(c) + '</button>'
  ).join('');
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
  const ctlH = ((screen === 'game' || screen === 'marble') && !el.controls.hidden)
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

/* =========================================================
   12.35 招待(フレンド招待 / 招待URL)(v3.0)
   ========================================================= */
function inviteUrlFor(roomId){
  const base = location.origin + location.pathname;
  return base + '?room=' + encodeURIComponent(roomId);
}

function setInviteTab(tab){
  el.inviteTabs.querySelectorAll('.seg-btn').forEach(b =>
    b.classList.toggle('is-on', b.dataset.tab === tab));
  el.inviteFriendView.hidden = tab !== 'friend';
  el.inviteUrlView.hidden = tab !== 'url';
}

function renderInviteFriends(){
  const st = online.state;
  const inRoom = st ? st.players.map(p => p.name) : [];
  const rows = friends.list.map(f => {
    let action;
    if (inRoom.includes(f.username)){
      action = '<button type="button" class="friend-act" disabled>参加中</button>';
    } else if (!f.online){
      action = '<button type="button" class="friend-act" disabled>オフライン</button>';
    } else {
      action = '<button type="button" class="friend-act is-ok" data-invite="' +
               esc(f.username) + '">招待</button>';
    }
    return friendRowMarkup(f, action);
  });
  el.inviteFriendList.innerHTML = rows.length
    ? rows.join('')
    : '<p class="empty-note">フレンドがいません。<br>待機ルームで他のプレイヤーに申請を送ってみましょう。</p>';
}

function openInvitePanel(){
  if (!online.state || !online.roomId) return;
  setInviteTab('friend');
  el.inviteUrlText.value = inviteUrlFor(online.roomId);
  el.inviteShareBtn.hidden = !navigator.share;
  renderInviteFriends();
  openOverlay(el.inviteOverlay);
  loadFriends(true);
}

/* 招待が届いたとき */
let pendingInvite = null;

function showInvited(data){
  pendingInvite = data;
  const modeText = data.mode === 'champion'
    ? '🏆 チャンピオン ' + data.championRounds + 'R'
    : data.mode === 'sprint'
      ? '⚡ 早抜け ' + Number(data.sprintGoal || 0).toLocaleString() + '超え'
      : 'エンジョイ';
  el.invitedText.innerHTML =
    '<b>' + esc(data.from) + '</b> さんから招待が届きました。<br>' +
    esc(modeText) + ' ・ ' + data.count + '/' + data.max + '人' +
    '<span class="invited-room">' + esc(data.roomId) + '</span>';
  openOverlay(el.invitedOverlay);
  audio.play('join');
}

function acceptInvite(){
  const inv = pendingInvite;
  pendingInvite = null;
  closeOverlay(el.invitedOverlay);
  if (!inv) return;
  audio.play('button');
  joinRoomById(inv.roomId, 'invite');
}

/* 部屋に入る共通処理。via を付けると満員時のメッセージが変わる */
function joinRoomById(id, via){
  if (!online.socket || !online.socket.connected){
    online.pendingJoin = { id, via };
    enterOnline();
    return;
  }
  if (screen !== 'lobby' && screen !== 'title') showScreen('lobby');
  if (online.roomId) online.socket.emit('room:leave');
  online.socket.emit('room:join', { id: String(id).toUpperCase(), via: via || undefined });
}

/* 観戦人数の表示 */
function renderSpectateChip(){
  const n = view.spectators || 0;
  const show = screen === 'game' && view.mode === 'online' && n > 0;
  el.spectateChip.hidden = !show;
  if (show) el.spectateNum.textContent = n;
}

/* =========================================================
   12.4 手番タイマー(オンライン)
   ========================================================= */
const turnTimer = { id: null, endAt: 0, key: '' };
const TURN_RING_LEN = 2 * Math.PI * 19;   // CSSの r=19 と合わせる

function startTurnTimer(key){
  if (turnTimer.key === key && turnTimer.id) return;   // 同じ手番なら継続
  stopTurnTimer();
  turnTimer.key = key;
  turnTimer.endAt = Date.now() + TURN_LIMIT_SEC * 1000;
  el.turnTimer.hidden = false;
  tickTurnTimer();
  turnTimer.id = setInterval(tickTurnTimer, 200);
}

function stopTurnTimer(){
  clearInterval(turnTimer.id);
  turnTimer.id = null;
  turnTimer.key = '';
  el.turnTimer.hidden = true;
  el.turnTimer.classList.remove('is-warn', 'is-danger', 'is-mine');
}

function tickTurnTimer(){
  const left = Math.max(0, turnTimer.endAt - Date.now());
  const sec = Math.ceil(left / 1000);
  const ratio = clamp(left / (TURN_LIMIT_SEC * 1000), 0, 1);

  el.turnNum.textContent = sec;
  el.turnRing.style.strokeDasharray = TURN_RING_LEN;
  el.turnRing.style.strokeDashoffset = (TURN_RING_LEN * (1 - ratio)).toFixed(1);

  el.turnTimer.classList.toggle('is-warn', sec <= 10 && sec > 5);
  el.turnTimer.classList.toggle('is-danger', sec <= 5);

  if (left <= 0){ clearInterval(turnTimer.id); turnTimer.id = null; }
}

/* サーバー状態からタイマーの表示を決める */
function syncTurnTimer(state){
  if (!state || state.phase !== 'play' || !state.activeName){
    stopTurnTimer();
    return;
  }
  const me = state.players.find(p => p.isYou);
  const active = state.players.find(p => p.name === state.activeName);
  /* CPUの手番にはタイマーが無いので出さない */
  if (!active || active.cpu){ stopTurnTimer(); return; }

  startTurnTimer(state.round + ':' + state.activeName);
  el.turnTimer.classList.toggle('is-mine', !!me && state.activeName === me.name);
}

/* ルームから離れたときの共通後始末(v3.0)
   チャンピオンモードの「大会メダル」表示が残らないよう、必ず所持メダルに戻す */
function resetOnlineRoomView(){
  stopTurnTimer();
  cancelOnlineAnim();
  online.roomId = null;
  online.state = null;
  online.lastResultRound = -1;
  online.dealtRound = -1;
  online.dealerRound = -1;
  online.cardTotal = 0;
  online.dealerHole = true;
  view.onlineMode = 'enjoy';
  view.spectating = false;
  view.spectators = 0;
  view.sprintGoal = 0;
  el.body.classList.remove('is-spectating');
  view.seats = [];
  view.dealer = { hand: [], hole: true };
  setStreak(0);
  shownCount.clear();
  chat.log = [];
  chat.unread = 0;
  el.chatBadge.hidden = true;
  closeChat();
  renderMedal();
}

function leaveOnlineRoom(){
  if (online.socket) online.socket.emit('room:leave');
  resetOnlineRoomView();
  showScreen('lobby');
  renderMedal();
  if (online.socket) online.socket.emit('room:list');
}

/* =========================================================
   12.9 マーブルレース(v4.1)

   競馬をそのままボールのレースにしたゲーム。
   ほかの2つと違って部屋を作らず、サーバーに1つだけある会場に
   出入りする形なので、1人でもそのまま遊べる。

   画面はサーバーから届く state をそのまま描くだけ。
   レースの動きも、サーバーが用意した位置データ(track)を
   なめらかに補間して見せているだけなので、
   全員がまったく同じレースを見ることになる。
   ========================================================= */
const MR_TYPE_INFO = {
  win:      { label: '単勝', picks: 1, note: '1着になるボールを1つ選んでください' },
  place:    { label: '複勝', picks: 1, note: '3着以内に入るボールを1つ選んでください' },
  quinella: { label: '馬連', picks: 2, note: '1着と2着になる2つを選んでください(順不同)' }
};

const marble = {
  joined: false,
  state: null,
  type: 'win',
  picks: [],
  amount: 0,
  /* レース演出 */
  view: '',              // 'bet' | 'race'(いま見せている側)(v4.2)
  shownCount: 0,         // 秒読みで出した数字(v4.3)
  raf: null,
  raceStart: 0,
  lastRank: '',
  shownRace: -1,
  timerId: null
};

/* ---------------------------------------------------------
   会場への出入り
   --------------------------------------------------------- */
async function enterMarble(){
  if (!account.user){
    toast('マーブルレースにはログインが必要です');
    openOverlay(el.accountOverlay);
    return;
  }
  view.game = 'marble';
  view.mode = 'online';
  view.onlineMode = 'enjoy';
  view.spectating = false;

  marble.joined = true;
  marble.state = null;
  marble.type = 'win';
  marble.picks = [];
  marble.amount = 0;
  marble.shownRace = -1;
  marble.view = '';

  showScreen('marble');
  showPanel('mr-wait');
  el.mrWaitText.textContent = '会場に入っています…';
  setMrMessage('まもなくレースが始まります');
  marbleShowView('race');   // 入場中はコース側を見せておく
  renderMarble();
  updateChatVisibility();   // v4.5: 会場チャットを使えるようにする

  /* v4.2: socket.io の読み込みと接続を必ず待ってから入場する。
     ここを待たずに emit していたのが「会場が開かない」不具合の原因だった */
  try {
    const sock = await ensureSocket();
    if (!marble.joined) return;          // 待っている間に戻っていたら何もしない
    sock.emit('marble:join');
  } catch (e){
    if (!marble.joined) return;
    el.mrWaitText.textContent = 'サーバーに接続できませんでした';
    setMrMessage(e.message || '接続に失敗しました', 'bad');
    toast(e.message || '接続に失敗しました');
  }
}

function leaveMarble(){
  marble.joined = false;
  stopMarbleRace();
  stopMrTimer();
  if (online.socket && online.socket.connected) online.socket.emit('marble:leave');
  /* v4.5: 会場を出たらチャットも閉じる */
  chat.log = [];
  updateChatVisibility();
}

/* ---------------------------------------------------------
   受信
   --------------------------------------------------------- */
function onMarbleState(state){
  if (!marble.joined) return;
  marble.state = state;
  if (screen !== 'marble') showScreen('marble');

  /* 新しいレースになったら選択をリセットする */
  if (state.phase === 'bet' && marble.shownRace !== state.raceNo){
    marble.shownRace = state.raceNo;
    marble.picks = [];
    marble.amount = 0;
    marble.shownCount = 0;
    stopMarbleRace();
    resetMarbleBalls();
  }

  if (state.phase === 'bet'){
    marbleShowView('bet');
    showPanel('mr-bet');
    setMrMessage('投票を受け付けています');
  } else if (state.phase === 'count'){
    /* 締め切ってからスタートまでの秒読み(v4.3)。
       ここでコース画面へ移り、3・2・1を見せる */
    marbleShowView('race');
    showPanel('mr-wait');
    el.mrWaitText.textContent = 'まもなくスタートです';
    setMrMessage('投票を締め切りました');
    showMarbleCountdown(state.count);
  } else if (state.phase === 'race'){
    marbleShowView('race');
    showPanel('mr-wait');
    el.mrWaitText.textContent = 'レース中です…';
    hideMarbleCountdown();
    startMarbleRace(state);
  } else if (state.phase === 'result'){
    marbleShowView('race');
    showPanel('mr-wait');
    el.mrWaitText.textContent = 'まもなく次のレースが始まります…';
    hideMarbleCountdown();
    showMarbleResult(state);
  } else {
    hideMarbleCountdown();
    marbleShowView('race');
    showPanel('mr-wait');
    el.mrWaitText.textContent = '会場を準備しています…';
  }

  startMrTimer(state.deadline);
  renderMarble();
  updateChatVisibility();
}

/* ---------------------------------------------------------
   残り時間
   --------------------------------------------------------- */
/* 残り時間の表示(v4.4)
   秒読み中は画面中央に大きく数字が出るので二重になるし、
   レース中の残り秒数は見ても意味がない(進み具合はボールを見ればわかる)。
   数字を出すのは「投票の締め切りまで」と「次のレースまで」だけにした */
const MR_TIMER_PHASES = ['bet', 'result'];

function startMrTimer(deadline){
  stopMrTimer();
  const ph = marble.state ? marble.state.phase : '';
  const show = !!deadline && MR_TIMER_PHASES.includes(ph);
  el.mrTimerChip.hidden = !show;
  if (!show) return;

  const tick = () => {
    const left = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
    el.mrTimerNum.textContent = left;
    el.mrTimerChip.classList.toggle('is-urgent',
      left <= 5 && marble.state && marble.state.phase === 'bet');
    if (left <= 0) stopMrTimer(true);
  };
  tick();
  marble.timerId = setInterval(tick, 250);
}
function stopMrTimer(keep){
  if (marble.timerId){ clearInterval(marble.timerId); marble.timerId = null; }
  if (!keep) el.mrTimerChip.classList.remove('is-urgent');
}

/* ---------------------------------------------------------
   コースの描画
   --------------------------------------------------------- */
function renderMarbleLanes(){
  const st = marble.state;
  if (!st || !st.balls.length){ el.mrLanes.innerHTML = ''; return; }

  /* 自分が買っているボールに印を付ける */
  const mine = new Set();
  for (const t of (st.myTickets || [])) for (const n of t.picks) mine.add(n);

  el.mrLanes.innerHTML = st.balls.map(b =>
    '<div class="mr-lane' + (mine.has(b.no) ? ' is-mine' : '') + '" data-lane="' + b.no + '">' +
      '<span class="mr-lane-no">' + b.no + '</span>' +
      '<span class="mr-lane-road">' +
        '<span class="mr-ball" data-ball="' + b.no + '" ' +
          'style="background:' + b.color + ';color:' + b.ink + '">' + b.no + '</span>' +
      '</span>' +
      '<span class="mr-lane-rank" data-rank="' + b.no + '"></span>' +
    '</div>').join('');
  resetMarbleBalls();
}

/* ボールをスタート位置に戻す */
function resetMarbleBalls(){
  el.mrLanes.querySelectorAll('.mr-ball').forEach(n => {
    n.style.transform = 'translateX(0) rotate(0deg)';
    n.classList.remove('is-leader');
  });
  el.mrLanes.querySelectorAll('.mr-lane-rank').forEach(n => {
    n.textContent = '';
    n.classList.remove('is-goal');
  });
}

/* 位置データ(0〜1が MR_TICKS+1 個)を、いまの時刻で線形に補間する */
function marbleProgressAt(pts, x){
  const n = pts.length - 1;
  const t = Math.max(0, Math.min(1, x)) * n;
  const i = Math.min(n - 1, Math.floor(t));
  const f = t - i;
  return pts[i] + (pts[i + 1] - pts[i]) * f;
}

function startMarbleRace(state){
  if (!state.track || !state.track.length) return;
  /* すでに走っているなら二重に始めない */
  if (marble.raf) return;

  /* 途中から入ってきた人でも、残り時間から今の位置に合わせる */
  const elapsed = state.deadline ? (state.raceMs - (state.deadline - Date.now())) : 0;
  marble.raceStart = Date.now() - Math.max(0, elapsed);
  marble.lastRank = '';

  const road = el.mrLanes.querySelector('.mr-lane-road');
  let roadW = road ? road.clientWidth : 300;

  const step = () => {
    const st = marble.state;
    if (!st || !st.track || screen !== 'marble'){ marble.raf = null; return; }

    const x = Math.min(1, (Date.now() - marble.raceStart) / st.raceMs);
    const r2 = el.mrLanes.querySelector('.mr-lane-road');
    if (r2 && r2.clientWidth) roadW = r2.clientWidth;

    /* 現在位置から順位を出す。
       位置がぴったり同じときは、確定している着順のほうを優先する(v4.4)。
       こうしないと僅差のときに番号順で並んでしまい、
       ゴール直前の表示が最終結果と食い違って見える */
    const rankOf = new Map((st.order || []).map((no, i) => [no, i]));
    const now = st.track.map(t => ({ no: t.no, p: marbleProgressAt(t.pts, x) }));
    now.sort((a, b) => (b.p - a.p) ||
      ((rankOf.get(a.no) ?? 99) - (rankOf.get(b.no) ?? 99)));

    now.forEach((item, idx) => {
      const ball = el.mrLanes.querySelector('.mr-ball[data-ball="' + item.no + '"]');
      if (ball){
        /* 端で見切れないよう、ボール1個ぶん内側に収める */
        const px = item.p * (roadW - 22) + 11;
        ball.style.transform = 'translateX(' + px.toFixed(1) + 'px) rotate(' +
          (item.p * roadW * 1.9).toFixed(0) + 'deg)';
        ball.classList.toggle('is-leader', idx === 0);
      }
      const rank = el.mrLanes.querySelector('.mr-lane-rank[data-rank="' + item.no + '"]');
      if (rank){
        rank.textContent = (idx + 1);
        /* ゴールしたら順位を金色に光らせる(v4.6)。
           どのボールが到達済みか一目でわかるようにするため */
        rank.classList.toggle('is-goal', item.p >= 1);
      }
    });

    /* 先頭が入れ替わった瞬間だけ音を鳴らす(鳴りすぎないように) */
    const lead = now[0] ? String(now[0].no) : '';
    if (lead && lead !== marble.lastRank && x < 0.97){
      marble.lastRank = lead;
      if (x > 0.05) audio.play('chip');
    }

    if (x >= 1){ marble.raf = null; return; }
    marble.raf = requestAnimationFrame(step);
  };
  marble.raf = requestAnimationFrame(step);
  audio.play('deal');
}

function stopMarbleRace(){
  if (marble.raf){ cancelAnimationFrame(marble.raf); marble.raf = null; }
}

/* ---------------------------------------------------------
   スタート前の秒読み(v4.3)
   サーバーから届く数字をそのまま出すだけ。
   同じ数字が続けて届いても、演出は1回しか出さない。
   --------------------------------------------------------- */
function showMarbleCountdown(n){
  if (!(n > 0)) return hideMarbleCountdown();
  el.mrCount.hidden = false;
  if (marble.shownCount === n) return;
  marble.shownCount = n;

  el.mrCountNum.textContent = n;
  el.mrCountNum.classList.remove('is-pop');
  void el.mrCountNum.offsetWidth;
  el.mrCountNum.classList.add('is-pop');
  audio.play('chip');

  /* スタート位置に戻しておく(前のレースの位置が残らないように) */
  resetMarbleBalls();
}

function hideMarbleCountdown(){
  el.mrCount.hidden = true;
  marble.shownCount = 0;
}

/* ---------------------------------------------------------
   結果表示
   --------------------------------------------------------- */
function showMarbleResult(state){
  const st = state;
  if (!st.order || !st.order.length){ el.mrResult.hidden = true; return; }
  stopMarbleRace();

  /* 最終位置に揃えておく(演出の途中で結果に入っても破綻しないように) */
  const road = el.mrLanes.querySelector('.mr-lane-road');
  const roadW = road ? road.clientWidth : 300;
  st.order.forEach((no, idx) => {
    const ball = el.mrLanes.querySelector('.mr-ball[data-ball="' + no + '"]');
    if (ball){
      ball.style.transform = 'translateX(' + (roadW - 11).toFixed(1) + 'px) rotate(720deg)';
      ball.classList.toggle('is-leader', idx === 0);
    }
    const rank = el.mrLanes.querySelector('.mr-lane-rank[data-rank="' + no + '"]');
    if (rank){
      rank.textContent = (idx + 1);
      rank.classList.add('is-goal');   // 全員ゴール済み(v4.6)
    }
  });

  const byNo = new Map(st.balls.map(b => [b.no, b]));
  el.mrResult.hidden = false;
  el.mrPodium.innerHTML = st.order.slice(0, 3).map((no, i) => {
    const b = byNo.get(no) || { name: '?', color: '#888', ink: '#fff' };
    return '<div class="mr-podium-item' + (i === 0 ? ' is-1st' : '') + '">' +
      '<span class="mr-podium-rank">' + (i + 1) + '着</span>' +
      '<span class="mr-podium-ball" style="background:' + b.color + ';color:' + b.ink + '">' + no + '</span>' +
      '<span class="mr-podium-name">' + esc(b.name) + '</span>' +
    '</div>';
  }).join('');

  const r = st.result;
  if (!r || !r.invest){
    el.mrPayout.innerHTML = '<p class="mr-payout-line">このレースは投票していません</p>';
    setMrMessage('レース終了');
    return;
  }
  if (r.payout > 0){
    const net = r.payout - r.invest;
    el.mrPayout.innerHTML =
      '<div class="mr-payout-total">+' + Number(r.payout).toLocaleString() + '</div>' +
      '<p class="mr-payout-line">' + r.hits.length + '点的中 / 投票 ' +
        Number(r.invest).toLocaleString() + ' メダル / 収支 ' +
        (net >= 0 ? '+' : '') + Number(net).toLocaleString() + '</p>';
    setMrMessage('的中! ' + Number(r.payout).toLocaleString() + ' メダル獲得', 'gold');
    audio.play('win');
  } else {
    el.mrPayout.innerHTML =
      '<p class="mr-payout-miss">はずれ… ' + Number(r.invest).toLocaleString() + ' メダル</p>';
    setMrMessage('はずれ…', 'bad');
    audio.play('lose');
  }
}

function setMrMessage(text, tone){
  el.mrMessageText.textContent = text;
  el.mrMessageText.className = tone || '';
}

/* ---------------------------------------------------------
   フェーズごとの画面切り替え(v4.2)

   スマホの1画面に収めるため、投票中は出走表だけ、
   レース中はコースだけを見せる。切り替えはフェードで繋ぐ。
   --------------------------------------------------------- */
function marbleShowView(which){
  const next = which === 'bet' ? el.mrBetView : el.mrRaceView;
  const prev = which === 'bet' ? el.mrRaceView : el.mrBetView;
  if (marble.view === which) return;
  marble.view = which;

  /* 出ていく側をふわっと消してから、入れ替える。
     フェードの途中でもう一度切り替わることがあるので、
     消すときは「まだ裏側のままか」を必ず確かめる。
     これを見ていないと、古いタイマーが新しい画面を隠してしまう */
  if (!prev.hidden){
    prev.classList.add('is-leaving');
    setTimeout(() => {
      prev.classList.remove('is-leaving');
      if (marble.view !== (prev === el.mrBetView ? 'bet' : 'race')) prev.hidden = true;
    }, 260);
  }
  next.hidden = false;
  /* アニメーションをやり直させる */
  next.classList.remove('is-leaving');
  void next.offsetWidth;
}

/* ---------------------------------------------------------
   出走表・投票券・観客
   --------------------------------------------------------- */
function renderMarbleEntries(){
  const st = marble.state;
  if (!st || !st.balls.length){ el.mrEntries.innerHTML = ''; return; }
  const betting = st.phase === 'bet';
  const showQuinella = marble.type === 'quinella';

  /* 人気順を出すため、単勝オッズの低い順に順位を付ける */
  const sorted = st.balls.map((b, i) => ({ i, o: st.odds ? st.odds.win[i] : 99 }))
                         .sort((a, b) => a.o - b.o);
  const favRank = new Map();
  sorted.forEach((x, idx) => favRank.set(x.i, idx));

  el.mrEntries.innerHTML = st.balls.map((b, i) => {
    const win = st.odds ? st.odds.win[i] : 0;
    const place = st.odds ? st.odds.place[i] : 0;
    const picked = marble.picks.includes(b.no);
    const rank = favRank.get(i);
    const cls = (picked ? ' is-picked' : '') +
                (rank === 0 ? ' is-fav' : '') +
                (rank >= 6 ? ' is-long' : '');
    /* 馬連を選んでいるときは、単勝オッズだけ出しても意味が薄いので表記を変える */
    const oddsHtml = showQuinella
      ? '単勝 <b>' + win.toFixed(1) + '</b>'
      : (marble.type === 'place'
          ? '複勝 <b>' + place.toFixed(1) + '</b>'
          : '単勝 <b>' + win.toFixed(1) + '</b>');

    /* 馬連のときは何番目に選んだかが分かるよう番号を出す */
    const mark = picked && MR_TYPE_INFO[marble.type].picks > 1
      ? (marble.picks.indexOf(b.no) + 1) : '✓';

    return '<button type="button" class="mr-entry' + cls + '" data-entry="' + b.no + '"' +
      (betting ? '' : ' disabled') + '>' +
      '<span class="mr-entry-ball" style="background:' + b.color + ';color:' + b.ink + '">' + b.no + '</span>' +
      '<span class="mr-entry-body">' +
        '<span class="mr-entry-name">' + esc(b.name) + '</span>' +
        '<span class="mr-entry-odds">' + oddsHtml + '</span>' +
      '</span>' +
      '<span class="mr-entry-mark">' + mark + '</span>' +
    '</button>';
  }).join('');

  el.mrBoardNote.textContent = betting
    ? (MR_TYPE_INFO[marble.type].label + 'のオッズ')
    : '締め切りました';
}

/* 投票券の一覧。投票画面とレース画面の両方に同じものを出す(v4.2) */
function renderMarbleTickets(){
  const st = marble.state;
  const list = st ? (st.myTickets || []) : [];
  if (!list.length){
    el.mrTickets.hidden = true;
    el.mrRaceTickets.hidden = true;
    return;
  }
  el.mrTickets.hidden = false;
  el.mrRaceTickets.hidden = false;

  const byNo = new Map((st.balls || []).map(b => [b.no, b]));
  const order = (st.phase === 'result' && st.order) ? st.order : null;
  const hitPicks = new Set();
  if (st.result) for (const h of (st.result.hits || [])) hitPicks.add(h.type + ':' + h.picks.join('-'));

  el.mrTicketList.innerHTML = list.map(t => {
    const key = t.type + ':' + t.picks.join('-');
    const hit = order ? hitPicks.has(key) : null;
    const cls = hit === null ? '' : (hit ? ' is-hit' : ' is-miss');
    const balls = t.picks.map(n => {
      const b = byNo.get(n) || { color: '#888', ink: '#fff' };
      return '<span class="mr-ticket-ball" style="background:' + b.color + ';color:' + b.ink + '">' + n + '</span>';
    }).join('');
    const pay = hit ? '<span class="mr-ticket-pay">+' +
      Math.floor(t.amount * t.odds).toLocaleString() + '</span>' : '';
    return '<div class="mr-ticket' + cls + '">' +
      '<span class="mr-ticket-type">' + esc(t.label || MR_TYPE_INFO[t.type].label) + '</span>' +
      '<span class="mr-ticket-picks">' + balls + '</span>' +
      '<span class="mr-ticket-amt">' + Number(t.amount).toLocaleString() +
        ' × ' + t.odds.toFixed(1) + '</span>' + pay +
    '</div>';
  }).join('');

  const note = '合計 ' + Number(st.myInvest || 0).toLocaleString() +
    ' メダル(' + list.length + '/' + st.maxTickets + '枚)';
  el.mrInvestNote.textContent = note;
  el.mrRaceInvestNote.textContent = note;
  el.mrRaceTicketList.innerHTML = el.mrTicketList.innerHTML;
}

function renderMarbleWatchers(){
  const st = marble.state;
  const list = st ? (st.watchers || []) : [];
  if (!list.length){ el.mrWatchers.innerHTML = ''; return; }
  el.mrWatchers.innerHTML = list.map(w =>
    '<span class="mr-watcher">' +
      '<span class="mr-watcher-avatar" data-icon-color="' + iconColorOf(w.iconColor) + '">' +
        esc(String(w.name).charAt(0).toUpperCase()) + '</span>' +
      nameHTML(w.name) +
      (w.invest > 0 ? '<span class="mr-watcher-invest">' +
        Number(w.invest).toLocaleString() + '</span>' : '') +
    '</span>').join('');
}

/* ---------------------------------------------------------
   投票の操作
   --------------------------------------------------------- */
function currentMarbleOdds(){
  const st = marble.state;
  if (!st || !st.odds) return null;
  const need = MR_TYPE_INFO[marble.type].picks;
  if (marble.picks.length !== need) return null;

  if (marble.type === 'quinella'){
    const a = Math.min(marble.picks[0], marble.picks[1]);
    const b = Math.max(marble.picks[0], marble.picks[1]);
    return st.odds.quinella[a + '-' + b] || null;
  }
  const idx = st.balls.findIndex(x => x.no === marble.picks[0]);
  if (idx < 0) return null;
  return marble.type === 'win' ? st.odds.win[idx] : st.odds.place[idx];
}

/* 選択中の内容を投票スリップに出す(v4.2)。
   ボールは出走表から直接選ぶので、専用の選択行は無くした */
function renderMarbleSlip(){
  const st = marble.state;
  const info = MR_TYPE_INFO[marble.type];
  const ready = marble.picks.length === info.picks;

  el.mrSlip.classList.toggle('is-ready', ready);
  el.mrPickNote.textContent = ready ? info.label : info.note;

  if (!st || !marble.picks.length){ el.mrSlipPicks.innerHTML = ''; return; }
  const byNo = new Map(st.balls.map(b => [b.no, b]));
  el.mrSlipPicks.innerHTML = marble.picks.map(n => {
    const b = byNo.get(n) || { color: '#888', ink: '#fff' };
    return '<span class="mr-slip-ball" style="background:' + b.color +
           ';color:' + b.ink + '">' + n + '</span>';
  }).join('');
}

/* このレースですでに投票しているか(v4.3: 1レース1点なので買い直しできない) */
function marbleAlreadyBet(){
  const st = marble.state;
  return !!(st && (st.myTickets || []).length >= (st.maxTickets || 1));
}

function renderMarbleBetPanel(){
  const st = marble.state;
  const odds = currentMarbleOdds();
  const medal = myMedal();
  const done = marbleAlreadyBet();

  el.mrBetValue.textContent = marble.amount.toLocaleString();

  if (odds){
    el.mrBetOddsVal.textContent = odds.toFixed(1) + '倍';
    el.mrBetReturn.textContent = marble.amount > 0
      ? Math.floor(marble.amount * odds).toLocaleString() : '-';
  } else {
    el.mrBetOddsVal.textContent = '-';
    el.mrBetReturn.textContent = '-';
  }

  const min = st ? st.minBet : 10;
  el.mrBuyBtn.disabled = !st || st.phase !== 'bet' || !odds || done ||
                         marble.amount < min || marble.amount > medal;
  el.mrBuyBtn.textContent = done ? '投票済み' : '投票する';
  el.mrClearBtn.disabled = done || (marble.amount === 0 && marble.picks.length === 0);

  /* 持っているメダルを超えるチップは押せないようにする。
     投票済みならすべて押せない(1レース1点のため) */
  el.mrChipRow.querySelectorAll('.chip').forEach(c => {
    c.disabled = done || Number(c.dataset.mrchip) > medal - marble.amount;
  });

  el.mrTypeSeg.querySelectorAll('.seg-btn').forEach(b => {
    b.classList.toggle('is-on', b.dataset.mrtype === marble.type);
    b.disabled = done;
  });

  /* 投票済みであることが分かるよう、スリップの案内文も変える */
  if (done) el.mrPickNote.textContent = 'このレースは投票済みです';
}

function renderMarble(){
  const st = marble.state;
  if (st){
    el.mrRaceNo.textContent = st.raceNo;
    const label = {
      bet: '投票受付中', count: 'まもなく開始',
      race: 'レース中', result: '払い戻し', idle: '待機中'
    }[st.phase] || '';
    el.mrPhaseText.textContent = label;
    el.mrPhaseChip.className = 'mr-chip is-phase is-' + st.phase;
    el.mrResult.hidden = st.phase !== 'result';

    /* v4.3: レースが動いている間は会場から出られないようにする。
       途中で抜けられると、投票した分の払い戻しが受け取れなくなるため */
    const racing = st.phase === 'count' || st.phase === 'race';
    el.mrLeaveBtn.hidden = racing;

    /* 出走表が変わったらコースを作り直す */
    if (el.mrLanes.childElementCount !== st.balls.length) renderMarbleLanes();
  }
  renderMarbleEntries();
  renderMarbleSlip();
  renderMarbleBetPanel();
  renderMarbleTickets();
  renderMarbleWatchers();
  renderMarbleCheers();
  renderMedal();
}

/* ボールを選ぶ。買い目の種類ごとに選べる数が違う */
function marbleTogglePick(no){
  const st = marble.state;
  if (!st || st.phase !== 'bet') return;
  if (marbleAlreadyBet()) return toast('このレースはすでに投票済みです');
  const need = MR_TYPE_INFO[marble.type].picks;
  const i = marble.picks.indexOf(no);

  if (i >= 0) marble.picks.splice(i, 1);
  else {
    /* 上限まで選んでいたら、古いほうを押し出す */
    if (marble.picks.length >= need) marble.picks.shift();
    marble.picks.push(no);
  }
  audio.play('chip');
  renderMarble();
}

function marbleSetType(type){
  if (!MR_TYPE_INFO[type] || marble.type === type) return;
  if (marbleAlreadyBet()) return;
  marble.type = type;
  marble.picks = [];
  audio.play('chip');
  renderMarble();
}

function marbleAddChip(v){
  const st = marble.state;
  if (!st || st.phase !== 'bet' || marbleAlreadyBet()) return;
  const max = Math.min(myMedal(), st.maxBet);
  marble.amount = Math.min(max, marble.amount + v);
  audio.play('chip');
  renderMarbleBetPanel();
}

function marbleClear(){
  if (marbleAlreadyBet()) return;
  marble.amount = 0;
  marble.picks = [];
  audio.play('button');
  renderMarble();
}

function marbleBuy(){
  const st = marble.state;
  const odds = currentMarbleOdds();
  if (!st || st.phase !== 'bet' || !odds) return;
  if (marbleAlreadyBet()) return toast('このレースはすでに投票済みです');
  if (marble.amount < st.minBet) return toast('最低' + st.minBet + 'メダルから投票できます');
  if (marble.amount > myMedal()) return toast('メダルが足りません');

  audio.play('button');
  online.socket.emit('marble:bet', {
    type: marble.type,
    picks: marble.picks.slice(),
    amount: marble.amount
  });
  /* v4.3: 1レース1点なので、買ったあとは選択をそのまま残して
     「何に投票したか」が分かるようにしておく */
  renderMarble();
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
const ad = { open: false, forced: false, need: AD_SKIP_SEC, elapsed: 0, timerId: null, ready: false,
             mode: 'reward', resolve: null };

/* 広告のクールタイム(v3.0)。所持メダルが上限以上のときも受け取れない */
const adGate = { nextAt: 0, tickId: null };

function adBlockReason(){
  if (myMedal() >= AD_MEDAL_LIMIT) return 'limit';
  if (Date.now() < adGate.nextAt) return 'cool';
  return '';
}

function updateAdBtn(){
  const reason = adBlockReason();
  el.adBtn.disabled = !!reason;
  el.adBtn.classList.toggle('is-off', !!reason);

  if (reason === 'limit'){
    el.adBtn.dataset.short = '上限';
    el.adBtn.title = 'メダルを' + AD_MEDAL_LIMIT + '枚以上持っているため受け取れません';
    if (el.adBtnGain) el.adBtnGain.textContent = AD_MEDAL_LIMIT + '枚未満で受取可';
  } else if (reason === 'cool'){
    const sec = Math.max(1, Math.ceil((adGate.nextAt - Date.now()) / 1000));
    el.adBtn.dataset.short = sec + 's';
    el.adBtn.title = 'あと' + sec + '秒で受け取れます';
    if (el.adBtnGain) el.adBtnGain.textContent = 'あと ' + sec + ' 秒';
  } else {
    el.adBtn.dataset.short = '+' + AD_REWARD;
    el.adBtn.title = '広告を見てメダルを受け取る';
    if (el.adBtnGain) el.adBtnGain.textContent = 'メダル +' + AD_REWARD;
  }
}

function startAdTicker(){
  if (adGate.tickId) return;
  adGate.tickId = setInterval(() => {
    if (!el.adBtn.hidden) updateAdBtn();
  }, 500);
}

function openAd(){
  if (ad.open) return;
  const reason = adBlockReason();
  if (reason === 'limit'){
    audio.play('error');
    return toast('メダルを' + AD_MEDAL_LIMIT + '枚以上持っているため受け取れません');
  }
  if (reason === 'cool'){
    audio.play('error');
    return toast('あと' + Math.ceil((adGate.nextAt - Date.now()) / 1000) + '秒お待ちください');
  }
  startAdVideo('reward', Math.random() >= AD_SKIP_RATE);
}

/* 動画の再生開始。mode で終了時の処理を切り替える(v3.2)
   'reward' = 通常の広告報酬 / 'bonus' = ログインボーナスの追加分 */
function startAdVideo(mode, forced){
  ad.open = true;
  ad.mode = mode;
  ad.elapsed = 0;
  ad.ready = false;
  ad.forced = !!forced;
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

  /* ログインボーナスの広告はここで完了を伝えるだけ。
     通常の広告報酬(/api/ad)とは別扱いにする(v3.2) */
  if (ad.mode === 'bonus'){
    ad.mode = 'reward';
    const done = ad.resolve;
    ad.resolve = null;
    if (done) done(true);
    return;
  }

  let gained = AD_REWARD;
  if (account.user){
    try {
      const d = await api('/api/ad', { method: 'POST' });
      setAccount(d.user);
      if (d.reward) gained = d.reward;
      adGate.nextAt = Date.now() + (d.cooldownMs || AD_COOLDOWN_MS);
    } catch (e){
      /* サーバー側でも上限・クールタイムを見ているので、拒否されたら合わせる */
      adGate.nextAt = Math.max(adGate.nextAt, Date.now() + 2000);
      updateAdBtn();
      audio.play('error');
      toast(e.message);
      return;
    }
  } else {
    guestMedal += AD_REWARD;
    store.set('bj4_guestMedal', String(guestMedal));
    adGate.nextAt = Date.now() + AD_COOLDOWN_MS;
  }
  updateAdBtn();

  if (view.phase === 'bet'){
    /* v3.2: シングルは専用メダルで完結するので広告の対象外。オンラインのみ同期する */
    if (view.mode === 'online' && online.socket && online.socket.connected){
      /* サーバーが持つルーム内のメダルは接続時のスナップショットなので
         広告で増えた分をDBから読み直させる */
      online.socket.emit('player:sync');
    }
    renderBet();   // チップボタンの有効/無効を再計算(これが無いと進行不能になる)
  }
  renderMedal();
  updateAdBtn();
  audio.play('win');
  toast('+' + gained + ' メダルを受け取りました');
}

/* 最後まで見てもらう広告。見終わったら true を返す(v3.2) */
function playAd(opts){
  return new Promise((resolve) => {
    if (ad.open) return resolve(false);
    ad.resolve = resolve;
    startAdVideo('bonus', opts && opts.forced);
  });
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
  if (bgm.failed) el.bgmStatus.textContent = BGM_FILE.replace('./', '') + ' が見つからないため、BGMは再生されません。';
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

  renderBgmStatus();
  updateDevVisibility();
}

/* =========================================================
   15.5 開発者モード
   ========================================================= */
const dev = { pin: '', users: [] };

function openDevPin(){
  /* サーバー側でも検証しているが、入口でも念のため確認する(v3.1) */
  if (!isOwnerUser()){
    audio.play('error');
    return toast('この操作は許可されていません');
  }
  el.devPinInput.value = '';
  el.devPinError.hidden = true;
  openOverlay(el.devPinOverlay);
  setTimeout(() => el.devPinInput.focus(), 60);
}

function devError(msg){
  el.devPinError.textContent = msg;
  el.devPinError.hidden = false;
  audio.play('error');
}

async function submitDevPin(){
  const pin = el.devPinInput.value.trim();
  if (!pin) return devError('暗証番号を入力してください');

  el.devPinSubmitBtn.disabled = true;
  try {
    await api('/api/admin/auth', { method: 'POST', body: JSON.stringify({ pin }) });
    dev.pin = pin;
    closeOverlay(el.devPinOverlay);
    closeOverlay(el.settingsOverlay);
    audio.play('join');
    openDevPanel();
  } catch (e){
    devError(e.message);
  } finally {
    el.devPinSubmitBtn.disabled = false;
  }
}

/* 指定アカウントのマイページ相当を読み取り専用で表示する(v3.2) */
async function openDevDetail(username){
  el.devDetailTitle.textContent = username + ' の詳細';
  el.devDetailBody.innerHTML = '<p class="empty-note">読み込み中…</p>';
  openOverlay(el.devDetailOverlay);
  try {
    const d = await api('/api/admin/detail', {
      method: 'POST',
      body: JSON.stringify({ pin: dev.pin, username })
    });
    renderDevDetail(d);
  } catch (e){
    el.devDetailBody.innerHTML = '<p class="empty-note">' + esc(e.message) + '</p>';
  }
}

function renderDevDetail(d){
  const u = d.user;
  const rate = (w, n) => (n > 0 ? Math.round((w / n) * 100) + '%' : '0%');
  const decided = u.wins + u.losses;
  const champDecided = u.champWins + u.champLosses;

  const stat = (k, v, wide) =>
    '<div class="stat' + (wide ? ' is-wide' : '') + '">' +
      '<span class="stat-key">' + esc(k) + '</span>' +
      '<span class="stat-val led">' + esc(String(v)) + '</span></div>';

  el.devDetailBody.innerHTML = '' +
    '<div class="sheet-section">' +
      '<div class="profile-head">' +
        '<span class="profile-avatar" data-icon-color="' + iconColorOf(u.iconColor) + '">' +
          '<span class="profile-avatar-char">' + esc(u.username.charAt(0).toUpperCase()) + '</span>' +
        '</span>' +
        '<div class="profile-id">' +
          '<span class="profile-name">' + esc(u.username) + '</span>' +
          '<span class="profile-level led">Lv.' + u.level + '</span>' +
        '</div>' +
      '</div>' +
      '<p class="sheet-note">' +
        (d.online ? '<b style="color:var(--jade)">ログイン中</b>' : 'オフライン') +
        ' ・ 最終ログイン: ' + esc(formatLastSeen({ lastLogin: d.lastLogin })) +
        (u.isOwner ? ' ・ <b>オーナー</b>' : '') +
      '</p>' +
    '</div>' +

    '<div class="sheet-section"><h3>基本</h3><div class="stat-grid">' +
      stat('所持メダル', Number(u.medal).toLocaleString()) +
      stat('レベル', u.level) +
      stat('EXP', u.exp + ' / ' + d.expNext) +
    '</div></div>' +

    '<div class="sheet-section"><h3>戦績(エンジョイモード)</h3><div class="stat-grid">' +
      stat('ラウンド', u.rounds) + stat('勝ち', u.wins) + stat('負け', u.losses) +
      stat('引き分け', u.pushes) + stat('BJ', u.bj) + stat('勝率', rate(u.wins, decided)) +
    '</div></div>' +

    '<div class="sheet-section"><h3>戦績(チャンピオンモード)</h3><div class="stat-grid">' +
      stat('プレイ数', u.champPlays) + stat('勝ち(1位)', u.champWins) +
      stat('負け', u.champLosses) + stat('引き分け', u.champDraws) +
      stat('勝率', rate(u.champWins, champDecided)) +
    '</div></div>' +

    '<div class="sheet-section"><h3>メダル記録</h3><div class="stat-grid">' +
      stat('総獲得枚数', Number(u.totalGain || 0).toLocaleString(), true) +
      stat('一撃獲得枚数', Number(u.bestGain || 0).toLocaleString(), true) +
    '</div>' +
    (u.bestGainAt ? '<p class="block-note">一撃の記録日: ' + esc(u.bestGainAt) + '</p>' : '') +
    '</div>' +

    '<div class="sheet-section"><h3>ログイン記録</h3><div class="stat-grid">' +
      stat('連続ログイン', (u.loginStreak || 0) + '日') +
      stat('通算ログイン', (u.loginDays || 0) + '日') +
      stat('アカウント作成日', fmtCreatedAt(u.createdAt), true) +
    '</div></div>';
}

function openDevPanel(){
  openOverlay(el.devOverlay);
  loadDevUsers();
}

async function loadDevUsers(){
  el.devSummary.textContent = '読み込み中…';
  el.devList.innerHTML = '';
  try {
    const d = await api('/api/admin/users', { method: 'POST', body: JSON.stringify({ pin: dev.pin }) });
    dev.users = d.users || [];
    renderDevUsers();
  } catch (e){
    el.devSummary.textContent = e.message;
  }
}

/* 最終ログインを「X分前」などに整形 */
function formatLastSeen(user){
  if (user.online) return '現在ログイン中';
  if (!user.lastLogin) return 'ログイン履歴なし';
  const diff = Date.now() - new Date(user.lastLogin).getTime();
  if (diff < 0) return 'たった今';
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'たった今';
  if (min < 60) return min + '分前';
  const hour = Math.floor(min / 60);
  if (hour < 24) return hour + '時間前';
  const day = Math.floor(hour / 24);
  if (day >= 7) return '7日以上前';
  return day + '日前';
}

function renderDevUsers(){
  const list = dev.users;
  const onlineN = list.filter(u => u.online).length;
  el.devSummary.textContent = '登録アカウント ' + list.length + '件(ログイン中 ' + onlineN + '件)';

  if (list.length === 0){
    el.devList.innerHTML = '<p class="empty-note">アカウントがありません。</p>';
    return;
  }

  el.devList.innerHTML = list.map(u => '' +
    '<div class="dev-row" data-user="' + esc(u.username) + '">' +
      '<div class="dev-main">' +
        '<span class="dev-name-row">' +
          '<span class="dev-name">' + esc(u.username) + '</span>' +
          '<span class="dev-lv">Lv.' + u.level + '</span>' +
          (u.online ? '<span class="dev-online">ログイン中</span>' : '') +
        '</span>' +
        '<span class="dev-medal">' +
          '<span class="dev-medal-cap">メダル</span>' +
          '<span class="dev-medal-val">' + u.medal + '</span>' +
        '</span>' +
        '<span class="dev-seen">最終ログイン: ' + esc(formatLastSeen(u)) + '</span>' +
      '</div>' +
      '<div class="dev-actions">' +
        '<button type="button" class="dev-btn" data-act="detail">詳細</button>' +
        '<button type="button" class="dev-btn" data-act="edit">編集</button>' +
        '<button type="button" class="dev-btn is-danger" data-act="delete">削除</button>' +
      '</div>' +
    '</div>').join('');
}

function openDevEdit(row, username){
  if (row.querySelector('.dev-edit')) return;
  const user = dev.users.find(u => u.username === username);
  const box = document.createElement('div');
  box.className = 'dev-edit';
  box.innerHTML =
    '<input type="number" class="text-input" min="0" max="99999999" value="' + (user ? user.medal : 0) + '">' +
    '<button type="button" class="dev-btn" data-act="save">保存</button>' +
    '<button type="button" class="dev-btn" data-act="cancel">取消</button>';
  row.appendChild(box);
  box.querySelector('input').focus();
}

async function saveDevMedal(row, username){
  const input = row.querySelector('.dev-edit input');
  if (!input) return;
  const medal = Math.floor(Number(input.value));
  if (!Number.isFinite(medal) || medal < 0) return toast('メダル数が不正です');
  try {
    await api('/api/admin/medal', {
      method: 'POST',
      body: JSON.stringify({ pin: dev.pin, username, medal })
    });
    toast(username + ' のメダルを ' + medal + ' にしました');
    audio.play('chip');
    /* 自分自身を編集した場合は手元の表示も更新 */
    if (account.user && account.user.username === username){
      account.user.medal = medal;
      renderAccountUi();
    }
    await loadDevUsers();
  } catch (e){ toast(e.message); }
}

async function deleteDevUser(username){
  if (!confirm('「' + username + '」を削除します。\n所持メダル・戦績・レベルはすべて失われ、元に戻せません。\n\n本当に削除しますか?')) return;
  try {
    await api('/api/admin/delete', {
      method: 'POST',
      body: JSON.stringify({ pin: dev.pin, username })
    });
    toast(username + ' を削除しました');
    /* 自分を削除した場合はログアウト状態にする */
    if (account.user && account.user.username === username){
      if (online.socket){ online.socket.disconnect(); online.socket = null; }
      clearAccount();
      closeOverlay(el.devOverlay);
      if (screen !== 'title') showScreen('title');
      return;
    }
    await loadDevUsers();
  } catch (e){ toast(e.message); }
}

/* =========================================================
   15.6 ホーム画面への追加案内(スマホブラウザのみ)
   ========================================================= */
function isStandalone(){
  return window.matchMedia('(display-mode: standalone)').matches
      || window.navigator.standalone === true;
}

function setupA2HS(){
  /* すでにホーム画面から起動している場合は出さない */
  if (isStandalone()) return;
  /* 一度閉じたら二度と出さない */
  if (store.get('bj4_a2hsClosed') === '1') return;

  const ua = navigator.userAgent;
  const isIOS = /iPhone|iPad|iPod/.test(ua)
             || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isAndroid = /Android/.test(ua);
  if (!isIOS && !isAndroid) return;

  el.a2hsText.innerHTML = isIOS
    ? '下の<b>共有マーク</b>から<b>「ホーム画面に追加」</b>すると、全画面で快適にプレイできます。'
    : 'メニューから<b>「ホーム画面に追加」</b>すると、全画面で快適にプレイできます。';

  /* 起動直後は邪魔なので少し待ってから出す */
  setTimeout(() => {
    if (isStandalone()) return;
    el.a2hsBanner.hidden = false;
  }, 2500);
}

function closeA2HS(){
  el.a2hsBanner.hidden = true;
  store.set('bj4_a2hsClosed', '1');
}

/* =========================================================
   16. イベント登録
   ========================================================= */
/* 初回操作で音声を解禁 */
['pointerdown', 'keydown'].forEach(ev =>
  window.addEventListener(ev, () => audio.unlock(), { once: true }));

/* --- タイトル(v4.0) --- */
el.toGamesBtn.addEventListener('click', () => { audio.play('button'); openGameSelect(); });
el.toHelpBtn.addEventListener('click', () => openHelp());
el.helpCloseBtn.addEventListener('click', () => closeOverlay(el.helpOverlay));
el.confirmOkBtn.addEventListener('click', () => closeConfirm(true));
el.confirmCancelBtn.addEventListener('click', () => closeConfirm(false));
el.confirmCloseBtn.addEventListener('click', () => closeConfirm(false));

/* --- ゲーム選択(v4.0) --- */
el.gameSelectBackBtn.addEventListener('click', () => { audio.play('button'); showScreen('title'); });
el.gameGrid.addEventListener('click', (e) => {
  const card = e.target.closest('.game-card');
  if (!card) return;
  audio.play('button');
  openGameMenu(card.dataset.game);
});

/* --- ゲームごとのメニュー(v4.0) --- */
el.gameMenuBackBtn.addEventListener('click', () => { audio.play('button'); openGameSelect(); });
el.gmSingleBtn.addEventListener('click', () => { audio.play('button'); startSelectedSingle(); });
el.gmOnlineBtn.addEventListener('click', () => { audio.play('button'); enterOnline(); });
el.gmTutorialBtn.addEventListener('click', () => { audio.play('button'); startTutorial(); });
el.gmRankingBtn.addEventListener('click', () => { audio.play('button'); openRankPanel(view.game); });
el.gmRulesBtn.addEventListener('click', () => { audio.play('button'); openRules(view.game); });
el.toSettingsBtn.addEventListener('click', () => { audio.play('button'); renderSettings(); openOverlay(el.settingsOverlay); });

el.brandBtn.addEventListener('click', async () => {
  if (screen === 'title') return;
  if (tutorial.active && screen === 'game'){
    const ok = await askConfirm({
      title: 'チュートリアルを終了',
      text: 'チュートリアルを終了してタイトルに戻ります。よろしいですか?',
      okText: '終了する'
    });
    if (!ok) return;
    endTutorial();
    showScreen('title');
    renderMedal();
    return;
  }
  if (screen === 'room' || (screen === 'game' && view.mode === 'online')){
    const ok = await askConfirm({
      title: '部屋から退出',
      text: '部屋から退出してタイトルに戻ります。よろしいですか?'
    });
    if (!ok) return;
    if (online.socket) online.socket.emit('room:leave');
    resetOnlineRoomView();
  }
  if (screen === 'marble'){
    /* v4.3: レース中は抜けさせない */
    const ph = marble.state ? marble.state.phase : '';
    if (ph === 'count' || ph === 'race'){
      toast('レースが終わるまでお待ちください');
      return;
    }
    /* v4.6: 投票済みならメダルが戻らないことを伝える */
    const bet = marble.state ? (marble.state.myInvest || 0) : 0;
    const ok = await askConfirm({
      title: '会場から退出',
      text: 'レース会場から退出してタイトルに戻ります。よろしいですか?',
      warn: bet > 0
        ? '※投票時にベットした ' + Number(bet).toLocaleString() +
          ' メダルは返却されません！！'
        : ''
    });
    if (!ok) return;
    leaveMarble();
  }
  audio.play('button');
  showScreen('title');
  renderMedal();
});

el.leaveBtn.addEventListener('click', async () => {
  if (view.mode === 'online' && (screen === 'room' || screen === 'game')){
    const ok = await askConfirm({
      title: '部屋から退出',
      text: '部屋から退出してタイトルに戻ります。よろしいですか?'
    });
    if (!ok) return;
    leaveOnlineRoom();
    showScreen('title');
  } else if (screen === 'game'){
    if (view.phase === 'play'){
      const ok = await askConfirm({
        title: 'タイトルへ戻る',
        text: 'タイトルに戻ります。よろしいですか?',
        warn: 'このラウンドは終了扱いになります',
        okText: '戻る'
      });
      if (!ok) return;
    }
    audio.play('button');
    showScreen('title');
  }
});

el.gameRulesBtn.addEventListener('click', () => { audio.play('button'); openRules('bj'); });

el.changelogBtn.addEventListener('click', () => { audio.play('button'); openOverlay(el.changelogOverlay); });

/* --- シングル準備画面 --- */
el.singleBackBtn.addEventListener('click', async () => {
  const ok = await askConfirm({
    title: 'タイトルへ戻る',
    text: 'タイトルに戻ります。よろしいですか?', okText: '戻る'
  });
  if (ok) showScreen('title');
});
el.singleSeatSeg.addEventListener('click', (e) => {
  const b = e.target.closest('.seg-btn');
  if (!b) return;
  settings.seats = Number(b.dataset.seats);
  saveSettings();
  renderSingleSetup();
  audio.play('chip');
});
/* --- ノルマモード(v3.2) --- */
el.normaRow.addEventListener('click', () => {
  audio.play('chip');
  settings.normaOn = !settings.normaOn;
  store.set('bj4_normaOn', settings.normaOn ? '1' : '0');
  renderNormaSetup();
});
el.normaSeg.addEventListener('click', (e) => {
  const b = e.target.closest('.seg-btn');
  if (!b) return;
  audio.play('chip');
  if (b.dataset.norma === 'custom'){
    el.normaTarget.hidden = false;
    el.normaSeg.querySelectorAll('.seg-btn').forEach(x => x.classList.toggle('is-on', x === b));
    el.normaTarget.value = settings.normaTarget;
    setTimeout(() => el.normaTarget.focus(), 60);
  } else {
    setNormaTarget(b.dataset.norma);
  }
});
el.normaTarget.addEventListener('change', () => setNormaTarget(el.normaTarget.value));
el.normaTarget.addEventListener('blur', () => setNormaTarget(el.normaTarget.value));

el.singleEndRetryBtn.addEventListener('click', () => {
  audio.play('button');
  openSingleSetup();
});
el.singleEndBackBtn.addEventListener('click', () => {
  audio.play('button');
  showScreen('title');
});

el.singleStartBtn.addEventListener('click', () => { audio.play('button'); startSingle(); });

/* --- チュートリアル(v3.3) --- */
el.tutorialNextBtn.addEventListener('click', tutorialNext);
el.tutorialSkipBtn.addEventListener('click', skipTutorialChapter);
el.tutorialExitBtn.addEventListener('click', async () => {
  const ok = await askConfirm({
    title: 'チュートリアルを終了',
    text: 'チュートリアルを終了してタイトルに戻ります。よろしいですか?',
    okText: '終了する'
  });
  if (!ok) return;
  endTutorial();
  showScreen('title');
});
el.tutorialEndBackBtn.addEventListener('click', () => {
  audio.play('button');
  endTutorial();
  showScreen('title');
});
el.tutorialEndPlayBtn.addEventListener('click', () => {
  audio.play('button');
  endTutorial();
  openSingleSetup();
});
el.changelogCloseBtn.addEventListener('click', () => closeOverlay(el.changelogOverlay));

/* --- ロビー --- */
el.lobbyBackBtn.addEventListener('click', async () => {
  const ok = await askConfirm({
    title: 'タイトルへ戻る',
    text: 'タイトルに戻ります。よろしいですか?', okText: '戻る'
  });
  if (ok) showScreen('title');
});
el.refreshRoomsBtn.addEventListener('click', () => {
  audio.play('button');
  if (online.socket) online.socket.emit('room:list');
});
el.createSeg.addEventListener('click', (e) => {
  const b = e.target.closest('.seg-btn');
  if (!b) return;
  online.createMax = Number(b.dataset.max);
  el.createSeg.querySelectorAll('.seg-btn').forEach(x => x.classList.toggle('is-on', x === b));
  updateCreateCpuRow();
  audio.play('chip');
});

/* 2人部屋では人が2人必要なのでCPUの入る余地がない */
function updateCreateCpuRow(){
  const allowed = online.createMode === 'enjoy' && online.createMax >= MIN_HUMANS + 1;
  el.createCpuRow.hidden = online.createMode !== 'enjoy';
  el.createCpuRow.classList.toggle('is-disabled', !allowed);
  el.createCpuCheck.disabled = !allowed;
  if (!allowed){
    online.createCpuFill = false;
    el.createCpuCheck.setAttribute('aria-checked', 'false');
  }
}

el.createModeSeg.addEventListener('click', (e) => {
  const b = e.target.closest('.seg-btn');
  if (!b) return;
  online.createMode = b.dataset.mode;
  el.createModeSeg.querySelectorAll('.seg-btn').forEach(x => x.classList.toggle('is-on', x === b));
  const mode = online.createMode;
  el.createChampRow.hidden = mode !== 'champion';
  el.createSprintRow.hidden = mode !== 'sprint';
  updateCreateCpuRow();
  el.createModeDesc.textContent = MODE_DESC[mode] || MODE_DESC.enjoy;
  audio.play('chip');
});

/* 早抜けモードの勝ち抜け条件(v3.2) */
el.sprintGoalSeg.addEventListener('click', (e) => {
  const b = e.target.closest('.seg-btn');
  if (!b) return;
  el.sprintGoalSeg.querySelectorAll('.seg-btn').forEach(x => x.classList.toggle('is-on', x === b));
  if (b.dataset.goal === 'custom'){
    el.sprintGoalInput.hidden = false;
    el.sprintGoalInput.value = online.createSprintGoal;
    el.sprintWarn.hidden = false;
    setTimeout(() => el.sprintGoalInput.focus(), 60);
  } else {
    el.sprintGoalInput.hidden = true;
    el.sprintWarn.hidden = true;
    online.createSprintGoal = Number(b.dataset.goal);
  }
  audio.play('chip');
});
el.sprintGoalInput.addEventListener('input', () => {
  online.createSprintGoal = clamp(
    Number(el.sprintGoalInput.value) || SPRINT_GOAL_DEFAULT, SPRINT_GOAL_MIN, SPRINT_GOAL_MAX);
});
el.sprintGoalInput.addEventListener('blur', () => {
  el.sprintGoalInput.value = online.createSprintGoal;
});

el.createCpuCheck.addEventListener('click', () => {
  if (el.createCpuCheck.disabled) return;
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
    online.createRounds = clamp(Number(el.champRoundCustom.value) || CHAMP_ROUND_MIN, CHAMP_ROUND_MIN, CHAMP_ROUND_MAX);
  } else {
    el.champRoundCustom.hidden = true;
    online.createRounds = Number(b.dataset.rounds);
  }
  audio.play('chip');
});
el.champRoundCustom.addEventListener('input', () => {
  online.createRounds = clamp(Number(el.champRoundCustom.value) || CHAMP_ROUND_MIN, CHAMP_ROUND_MIN, CHAMP_ROUND_MAX);
});

el.createRoomBtn.addEventListener('click', () => {
  if (!online.socket || !online.socket.connected) return toast('サーバーに接続していません');
  audio.play('button');
  online.socket.emit('room:create', {
    game: view.game,
    maxPlayers: online.createMax,
    mode: online.createMode,
    cpuFill: online.createCpuFill,
    championRounds: online.createRounds,
    sprintGoal: online.createSprintGoal
  });
});
el.roomList.addEventListener('click', (e) => {
  if (!online.socket) return;
  const join = e.target.closest('[data-join]');
  if (join){
    audio.play('button');
    online.socket.emit('room:join', { id: join.dataset.join });
    return;
  }
  const spec = e.target.closest('[data-spectate]');
  if (spec){
    audio.play('button');
    online.socket.emit('room:spectate', { id: spec.dataset.spectate });
  }
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
el.roomLeaveBtn.addEventListener('click', async () => {
  const ok = await askConfirm({
    title: '部屋から退出',
    text: 'この部屋から退出します。よろしいですか?'
  });
  if (ok) leaveOnlineRoom();
});

/* --- ログインボーナス(v3.2) --- */
el.bonusCloseBtn.addEventListener('click', closeBonusPanel);
/* 背景クリック・Escでも「閉じた」扱いにする(広告の案内はその日は終了) */
el.bonusOverlay.addEventListener('click', (e) => {
  if (e.target === el.bonusOverlay) closeBonusPanel();
});
el.bonusClaimBtn.addEventListener('click', claimBonus);
el.bonusAdBtn.addEventListener('click', claimBonusAd);

/* --- 通知・ランキング(v3.2) --- */
el.noticeBtn.addEventListener('click', () => { audio.play('button'); openNoticePanel(); });
el.noticeCloseBtn.addEventListener('click', () => closeOverlay(el.noticeOverlay));
el.noticeClearBtn.addEventListener('click', async () => {
  if (!confirm('通知をすべて削除しますか?')) return;
  audio.play('button');
  try {
    await api('/api/notices', { method: 'DELETE' });
    notices.list = []; notices.unread = 0;
    updateNoticeBadge();
    renderNoticeList();
    toast('通知を削除しました');
  } catch (e){ toast(e.message); }
});

el.toRankingBtn.addEventListener('click', () => { audio.play('button'); openRankPanel(); });
el.rankCloseBtn.addEventListener('click', () => closeOverlay(el.rankOverlay));
/* ランキングのゲーム切り替え(v4.0) */
el.rankGameTabs.addEventListener('click', (e) => {
  const b = e.target.closest('.seg-btn');
  if (!b) return;
  audio.play('chip');
  setRankGame(b.dataset.rgame);
});
/* ルールのゲーム切り替え(v4.0) */

/* ---------- スロットの操作を配線する (v5.0) ---------- */

el.slotHallBackBtn.addEventListener('click', () => { audio.play('button'); leaveSlotHall(); });

/* ホールの「着席する」ボタン */
el.slHall.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-sit]');
  if (!btn || btn.disabled) return;
  audio.play('button');
  slSit(Number(btn.dataset.sit));
});

el.slLeaveBtn.addEventListener('click', () => { audio.play('button'); slCashout(); });

/* システム設定(v5.1) */
el.slSettingsBtn.addEventListener('click', () => {
  audio.play('button');
  applySlotOpt();
  openOverlay(el.slotSettingsOverlay);
});
el.slotSettingsCloseBtn.addEventListener('click', () => closeOverlay(el.slotSettingsOverlay));
el.slOptMsgBar.addEventListener('change', () => {
  slotOpt.msgBar = el.slOptMsgBar.checked; saveSlotOpt(); applySlotOpt();
});
el.slOptOneBet.addEventListener('change', () => {
  slotOpt.oneBetOnLamp = el.slOptOneBet.checked; saveSlotOpt(); slSyncButtons();
});
el.slOptEasyLever.addEventListener('change', () => {
  slotOpt.easyLever = el.slOptEasyLever.checked; saveSlotOpt(); slSyncButtons();
});
el.slRulesBtn.addEventListener('click', () => { audio.play('button'); openRules('slot'); });

el.slRentBtn.addEventListener('click', () => slRent());
el.slBet1Btn.addEventListener('click', () => slBet(1));
el.slMaxBetBtn.addEventListener('click', () => slBet());
el.slCashoutBtn.addEventListener('click', () => { audio.play('button'); slCashout(); });
el.slDataBtn.addEventListener('click', () => { audio.play('button'); openSlotData(); });
el.slotDataCloseBtn.addEventListener('click', () => closeOverlay(el.slotDataOverlay));

/* レバー。押した瞬間に反応させたいので pointerdown で拾う */
el.slLever.addEventListener('pointerdown', (e) => { e.preventDefault(); slLever(); });

/* 停止ボタン。指を離すのを待たず、触れた瞬間に止める(実機と同じ感覚にする) */
for (let i = 0; i < 3; i++){
  const btn = el['slStop' + i];
  if (!btn) continue;
  btn.addEventListener('pointerdown', (e) => { e.preventDefault(); slStop(i); });
}

/* キーボード操作(PC向け) */
document.addEventListener('keydown', (e) => {
  if (screen !== 'slot') return;
  if (e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
  /* オーバーレイが開いているときは触らせない */
  if (!el.slotDataOverlay.hidden || !el.rulesOverlay.hidden || !el.confirmOverlay.hidden ||
      !el.slotSettingsOverlay.hidden) return;

  switch (e.key){
    case ' ': case 'Spacebar': e.preventDefault(); slLever(); break;
    case 'ArrowLeft':  e.preventDefault(); slStop(0); break;
    case 'ArrowDown':  e.preventDefault(); slStop(1); break;
    case 'ArrowRight': e.preventDefault(); slStop(2); break;
    case 'ArrowUp':    e.preventDefault(); slBet();   break;
    case '1':          e.preventDefault(); slBet(1);  break;
    case 'Insert':     e.preventDefault(); slRent();  break;
  }
});

/* 画面の幅が変わったらリールを組み直す(コマの高さが変わるため) */
window.addEventListener('resize', () => {
  if (screen === 'slot') slBuildAllStrips();
});

el.rulesGameTabs.addEventListener('click', (e) => {
  const b = e.target.closest('.seg-btn');
  if (!b) return;
  audio.play('chip');
  setRulesGame(b.dataset.ruleg);
});
el.rankKindTabs.addEventListener('click', (e) => {
  const b = e.target.closest('.seg-btn');
  if (!b) return;
  audio.play('chip');
  setRankKind(b.dataset.kind);
});
el.rankDayTabs.addEventListener('click', (e) => {
  const b = e.target.closest('.seg-btn');
  if (!b || b.disabled) return;
  audio.play('chip');
  setRankDay(b.dataset.day);
});

/* --- マーブルレース(v4.1) --- */
el.mrTypeSeg.addEventListener('click', (e) => {
  const b = e.target.closest('.seg-btn');
  if (!b) return;
  marbleSetType(b.dataset.mrtype);
});
/* ボールは出走表から直接選ぶ(v4.2で選択専用の行は廃止) */
el.mrEntries.addEventListener('click', (e) => {
  const b = e.target.closest('.mr-entry');
  if (!b || b.disabled) return;
  marbleTogglePick(Number(b.dataset.entry));
});
el.mrChipRow.addEventListener('click', (e) => {
  const c = e.target.closest('.chip');
  if (!c || c.disabled) return;
  marbleAddChip(Number(c.dataset.mrchip));
});
el.mrClearBtn.addEventListener('click', () => marbleClear());
el.mrBuyBtn.addEventListener('click', () => marbleBuy());
el.mrRulesBtn.addEventListener('click', () => { audio.play('button'); openRules('marble'); });
/* 応援スタンプ(v4.5) */
el.mrCheerRow.addEventListener('click', (e) => {
  const b = e.target.closest('.mr-cheer');
  if (!b) return;
  sendChatCheer(b.dataset.cheer);
});
el.mrLeaveBtn.addEventListener('click', async () => {
  /* v4.3: レース中は抜けられない(払い戻しを取りこぼさないため) */
  const ph = marble.state ? marble.state.phase : '';
  if (ph === 'count' || ph === 'race') return toast('レースが終わるまでお待ちください');

  /* v4.6: 投票済みで抜けると、そのぶんは戻ってこないので強く伝える */
  const bet = marble.state ? (marble.state.myInvest || 0) : 0;
  const ok = await askConfirm({
    title: '会場から退出',
    text: 'レース会場から退出してタイトルに戻ります。よろしいですか?',
    warn: bet > 0
      ? '※投票時にベットした ' + Number(bet).toLocaleString() +
        ' メダルは返却されません！！'
      : ''
  });
  if (!ok) return;

  leaveMarble();
  showScreen('title');
  renderMedal();
});

/* --- フレンド(v3.0) --- */
el.friendBtn.addEventListener('click', () => { audio.play('button'); openFriendPanel(); });
el.friendCloseBtn.addEventListener('click', () => closeOverlay(el.friendOverlay));
el.friendTabs.addEventListener('click', (e) => {
  const b = e.target.closest('.seg-btn');
  if (!b) return;
  audio.play('chip');
  setFriendTab(b.dataset.tab);
});

function onFriendListClick(e){
  const btn = e.target.closest('.friend-act');
  if (!btn || btn.disabled) return;
  const row = btn.closest('.friend-row');
  if (!row) return;
  const user = row.dataset.user;
  const act = btn.dataset.act;
  audio.play('button');
  if (act === 'accept') friendAction('accept', user, user + ' さんとフレンドになりました');
  else if (act === 'reject') friendAction('reject', user, '申請を拒否しました');
  else if (act === 'cancel') friendAction('reject', user, '申請を取り消しました');
  else if (act === 'remove') removeFriend(user);
}
[el.friendList, el.friendReqList, el.friendOutList].forEach(node =>
  node.addEventListener('click', onFriendListClick));

/* 待機ルームからのフレンド申請 */
el.memberList.addEventListener('click', (e) => {
  const b = e.target.closest('[data-req]');
  if (!b || b.disabled) return;
  audio.play('button');
  sendFriendRequest(b.dataset.req, b);
});

/* --- 招待(v3.0) --- */
el.inviteBtn.addEventListener('click', () => { audio.play('button'); openInvitePanel(); });
el.inviteCloseBtn.addEventListener('click', () => closeOverlay(el.inviteOverlay));
el.inviteTabs.addEventListener('click', (e) => {
  const b = e.target.closest('.seg-btn');
  if (!b) return;
  audio.play('chip');
  setInviteTab(b.dataset.tab);
});
el.inviteFriendList.addEventListener('click', (e) => {
  const b = e.target.closest('[data-invite]');
  if (!b || b.disabled || !online.socket) return;
  audio.play('button');
  b.disabled = true;
  b.textContent = '送信済み';
  online.socket.emit('room:invite', { username: b.dataset.invite });
});
el.inviteUrlCopyBtn.addEventListener('click', async () => {
  const url = el.inviteUrlText.value;
  audio.play('button');
  try {
    await navigator.clipboard.writeText(url);
    toast('招待URLをコピーしました');
  } catch {
    el.inviteUrlText.select();
    toast('URLを選択しました。コピーしてください');
  }
});
el.inviteShareBtn.addEventListener('click', async () => {
  if (!navigator.share) return;
  try {
    await navigator.share({
      title: 'BLACKJACK 4',
      text: '一緒にブラックジャックで遊びませんか?',
      url: el.inviteUrlText.value
    });
  } catch {}
});

el.invitedAcceptBtn.addEventListener('click', acceptInvite);
el.invitedRejectBtn.addEventListener('click', () => {
  pendingInvite = null;
  closeOverlay(el.invitedOverlay);
  audio.play('button');
});

/* --- 観戦(v3.0) --- */
el.spectateLeaveBtn.addEventListener('click', () => {
  audio.play('button');
  if (online.socket) online.socket.emit('room:stopSpectate');
  resetOnlineRoomView();
  showScreen('lobby');
  renderMedal();
  if (online.socket) online.socket.emit('room:list');
});

el.startGameBtn.addEventListener('click', () => {
  if (!online.socket) return;
  audio.play('button');
  online.socket.emit('room:start');
});
el.readyBtn.addEventListener('click', () => {
  if (!online.socket || !online.state) return;
  const me = online.state.players.find(p => p.isYou);
  audio.play('button');
  online.socket.emit('room:ready', { on: !(me && me.lobbyReady) });
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
  resetOnlineRoomView();
  showScreen('lobby');
  renderMedal();
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
    disableActionButtons();
    if (online.socket) online.socket.emit('game:hit');
  } else singleHit();
});

el.standBtn.addEventListener('click', () => {
  if (view.mode === 'online'){
    audio.play('button');
    showFx('stand');
    disableActionButtons();
    if (online.socket) online.socket.emit('game:stand');
  } else singleStand();
});

el.doubleBtn.addEventListener('click', () => {
  if (el.doubleBtn.disabled) return;
  if (view.mode === 'online'){
    audio.play('chip');
    showFx('double');
    disableActionButtons();
    if (online.socket) online.socket.emit('game:double');
  } else {
    singleDouble();
  }
});

el.blackjackBtn.addEventListener('click', () => {
  if (el.blackjackBtn.disabled) return;
  if (view.mode === 'online'){
    audio.play('bj');
    showFx('blackjack');
    disableActionButtons();
    if (online.socket) online.socket.emit('game:blackjack');
  } else {
    singleBlackjack();
  }
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
    disableActionButtons();
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

/* --- アイコンの色変更(v3.0) --- */
el.profileAvatar.addEventListener('click', () => {
  if (!account.user) return;
  audio.play('button');
  el.iconPicker.hidden = !el.iconPicker.hidden;
  if (!el.iconPicker.hidden) renderIconSwatches();
});
el.iconSwatches.addEventListener('click', (e) => {
  const b = e.target.closest('.icon-swatch');
  if (!b || b.disabled) return;
  applyIconColor(b.dataset.color);
});

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

/* --- パスワード変更(v3.1) --- */
el.showPassBtn.addEventListener('click', () => {
  audio.play('button');
  const willOpen = el.passBox.hidden;
  resetPassBox();
  el.passBox.hidden = !willOpen;
  if (willOpen) setTimeout(() => el.passCurrent.focus(), 60);
});
el.passCancelBtn.addEventListener('click', () => { audio.play('button'); resetPassBox(); });
el.passSubmitBtn.addEventListener('click', submitPasswordChange);
[el.passCurrent, el.passNext, el.passConfirm].forEach(inp =>
  inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') submitPasswordChange(); }));

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

/* --- 開発者モード --- */
el.devModeBtn.addEventListener('click', () => { audio.play('button'); openDevPin(); });
el.devPinCloseBtn.addEventListener('click', () => closeOverlay(el.devPinOverlay));
el.devPinSubmitBtn.addEventListener('click', submitDevPin);
el.devPinInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') submitDevPin(); });
el.devDetailCloseBtn.addEventListener('click', () => closeOverlay(el.devDetailOverlay));
el.devDetailOverlay.addEventListener('click', (e) => {
  if (e.target === el.devDetailOverlay) closeOverlay(el.devDetailOverlay);
});
el.devCloseBtn.addEventListener('click', () => closeOverlay(el.devOverlay));
el.devReloadBtn.addEventListener('click', () => { audio.play('button'); loadDevUsers(); });

el.devList.addEventListener('click', (e) => {
  const btn = e.target.closest('.dev-btn');
  if (!btn) return;
  const row = btn.closest('.dev-row');
  if (!row) return;
  const username = row.dataset.user;
  const act = btn.dataset.act;
  audio.play('button');
  if (act === 'edit') openDevEdit(row, username);
  else if (act === 'save') saveDevMedal(row, username);
  else if (act === 'detail') openDevDetail(row.dataset.user);
  else if (act === 'cancel'){ const b = row.querySelector('.dev-edit'); if (b) b.remove(); }
  else if (act === 'delete') deleteDevUser(username);
});
el.devList.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  const row = e.target.closest('.dev-row');
  if (row && e.target.closest('.dev-edit')) saveDevMedal(row, row.dataset.user);
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
/* 招待通知(invitedOverlay)は誤タップで消えると困るので背景クリックでは閉じない */
const closableOverlays = [el.accountOverlay, el.rulesOverlay, el.settingsOverlay,
  el.changelogOverlay, el.surrenderOverlay, el.devPinOverlay, el.devOverlay,
  el.friendOverlay, el.inviteOverlay, el.rankOverlay, el.noticeOverlay];

closableOverlays.forEach(node =>
  node.addEventListener('click', (e) => { if (e.target === node) closeOverlay(node); }));

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape'){
    closableOverlays.forEach(n => { if (!n.hidden) closeOverlay(n); });
    if (!el.bonusOverlay.hidden) closeBonusPanel();
    if (!el.devDetailOverlay.hidden) closeOverlay(el.devDetailOverlay);
    return;
  }
  if (!el.adOverlay.hidden) return;
  if (document.activeElement && document.activeElement.tagName === 'INPUT') return;
  if (screen !== 'game') return;

  const key = e.key.toLowerCase();
  if (view.phase === 'play' && !el.actionPanel.hidden){
    if (key === 'h') el.hitBtn.click();
    if (key === 's') el.standBtn.click();
    if (key === 'd' && !el.doubleBtn.hidden && !el.doubleBtn.disabled) el.doubleBtn.click();
  } else if (view.phase === 'bet' && key === 'enter' && !el.betPanel.hidden){
    el.dealBtn.click();
  } else if (key === 'enter' && !el.nextPanel.hidden){
    el.nextBtn.click();
  }
});

el.a2hsCloseBtn.addEventListener('click', () => { audio.play('button'); closeA2HS(); });

/* ホーム画面に追加された状態で開き直したらバナーを消す */
window.matchMedia('(display-mode: standalone)').addEventListener?.('change', (e) => {
  if (e.matches) el.a2hsBanner.hidden = true;
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
/* 招待URL(?room=XXXX)で開かれた場合の処理(v3.0)
   ログイン済みならそのまま参加、未ログインならログイン後に参加する */
function readInviteFromUrl(){
  let id = '';
  try {
    id = (new URLSearchParams(location.search).get('room') || '').trim().toUpperCase();
  } catch { return; }
  if (!/^[A-Z0-9]{4}$/.test(id)) return;

  online.pendingJoin = { id, via: 'url' };
  /* URLはそのままだとリロードのたびに参加してしまうので消しておく */
  try { history.replaceState(null, '', location.pathname); } catch {}
}

/* 招待URLからの参加待ちがあれば実行する。未ログインならログインを促す */
function resumeInviteJoin(){
  const pend = online.pendingJoin;
  if (!pend) return;
  if (!account.user){
    toast('参加するにはログインが必要です');
    setAuthMode('login');
    openOverlay(el.accountOverlay);
    return;
  }
  toast('ルーム ' + pend.id + ' に参加します…');
  enterOnline();   // 接続後、connectハンドラで join が走る
}

/* =========================================================
   起動画面(v4.2)

   Renderの無料枠は、しばらく使われていないとサーバーが眠ってしまい、
   起こすのに30秒ほどかかることがある。その間なにも出ないと
   「壊れている」と思われてしまうので、ロゴを見せながら状況を伝える。

   ついでにここで先に接続まで済ませておくと、
   あとからマーブルレースの会場を開いたときも待たされずに済む。
   ========================================================= */
const SPLASH_MIN_MS  = 1500;    // ロゴを見せる最低時間
const SPLASH_WAIT_MS = 9000;    // これ以上は待たせず、接続は裏で続ける
let splashDone = false;

function splashSay(text, sub){
  const t = $('splashText');
  if (t) t.textContent = text;
  const su = $('splashSub');
  if (su && typeof sub === 'boolean') su.hidden = !sub;
}

function splashProgress(pct){
  const bar = $('splashBarFill');
  if (bar) bar.style.width = Math.max(0, Math.min(100, pct)) + '%';
}

function hideSplash(){
  if (splashDone) return;
  splashDone = true;
  splashProgress(100);
  const sp = $('splash');
  if (!sp){ document.body.classList.remove('is-booting'); return; }
  sp.classList.add('is-hiding');
  document.body.classList.remove('is-booting');
  /* 完全に消えてから DOM ごと外す(重ならないように) */
  setTimeout(() => { if (sp.parentNode) sp.parentNode.removeChild(sp); }, 620);
}

async function runSplash(){
  const started = Date.now();
  splashProgress(12);
  splashSay('読み込んでいます…');

  const skip = $('splashSkipBtn');
  if (skip) skip.addEventListener('click', hideSplash);

  /* ログインしていない人は接続の必要がないので、ロゴだけ見せて終わり */
  if (!account.token){
    splashProgress(70);
    const rest = Math.max(0, SPLASH_MIN_MS - (Date.now() - started));
    await sleep(rest);
    return hideSplash();
  }

  splashSay('サーバーに接続しています…');
  splashProgress(35);

  /* 3秒たっても繋がらなければ、眠っている可能性を伝える */
  const slowTimer = setTimeout(() => {
    if (splashDone) return;
    splashSay('サーバーを起動しています…', true);
    splashProgress(60);
    if (skip) skip.hidden = false;
  }, 3000);

  try {
    await Promise.race([
      ensureSocket(),
      sleep(SPLASH_WAIT_MS).then(() => { throw new Error('slow'); })
    ]);
    splashSay('準備ができました');
    splashProgress(95);
  } catch {
    /* 待ちきれなかっただけ。接続は裏で続いているのでそのまま進める */
    splashSay('接続を待っています…', true);
  }
  clearTimeout(slowTimer);

  const rest = Math.max(0, SPLASH_MIN_MS - (Date.now() - started));
  if (rest) await sleep(rest);
  hideSplash();
}

/* =========================================================
   別の端末でログインされたとき(v4.2)
   ここに来たら、この端末はもうログイン状態ではない。
   ========================================================= */
let kickedAlready = false;
function forceLogout(reason){
  if (kickedAlready) return;
  kickedAlready = true;

  /* 会場やルームからは黙って抜ける(通信はもう通らない) */
  marble.joined = false;
  stopMarbleRace();
  stopMrTimer();
  if (online.socket){
    try { online.socket.disconnect(); } catch {}
    online.socket = null;
  }
  online.connectPromise = null;
  online.connecting = false;
  clearAccount();
  document.querySelectorAll('.overlay').forEach(o => { o.hidden = true; });
  showScreen('title');
  renderMedal();
  alert(reason || '別の端末でログインされました。\nこの端末からはログアウトしました。');
  /* 次にログインし直せるよう、目印を戻しておく */
  setTimeout(() => { kickedAlready = false; }, 1200);
}

async function init(){
  buildShoe();
  if (settings.bgmOn) bgm.prefetch();
  readInviteFromUrl();
  setAuthMode('login');
  renderSettings();
  renderAccountUi();
  renderIconSwatches();
  updateCreateCpuRow();
  updateAdBtn();
  startAdTicker();
  setupA2HS();
  showScreen('title');
  await restoreSession();
  updateAdBtn();
  if (account.user){ loadFriends(true); loadNotices(true); checkBonus(true); }
  startDayWatch();
  resumeInviteJoin();
  /* 画面の準備が全部できてから起動画面を閉じる(v4.2) */
  await runSplash();
}

init();
