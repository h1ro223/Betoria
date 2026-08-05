/* =========================================================
   BLACKJACK 4 - script.js
   made by hiro / ヒロ   https://github.com/h1ro223
   オフライン版:プレイヤー1人 + 補充AI最大3体 vs ディーラーAI
   ========================================================= */
'use strict';

/* ---------- 1. 定数 ---------- */
const DECK_COUNT      = 6;      // 山札のデッキ数
const RESHUFFLE_RATIO = 0.25;   // 残りがこの割合を切ったらシャッフル
const INITIAL_MEDAL   = 1000;   // 初期メダル
const AI_MEDAL        = 1000;   // AIの初期メダル
const AI_REFILL       = 500;    // AIが尽きたときの補充額
const MIN_BET         = 10;     // 最低ベット
const DEALER_STAND    = 17;     // ディーラーはこの数以上でスタンド
const AI_STAND        = 17;     // 補充AIはこの数以上でスタンド

const AD_FILES     = ['./ad/ad1.mp4', './ad/ad2.mp4', './ad/ad3.mp4'];
const AD_REWARD    = 100;       // 広告視聴で貰えるメダル
const AD_SKIP_SEC  = 5;         // スキップ可能になるまでの秒数
const AD_FULL_SEC  = 30;        // フル視聴の秒数
const AD_SKIP_RATE = 0.8;       // スキップ可能になる確率

const DEAL_MS      = 240;       // 1枚配る間隔
const AI_THINK_MS  = 620;       // AIの思考時間
const REVEAL_MS    = 520;       // ディーラー公開の間

const SUITS = [
  { mark: '♠', red: false },
  { mark: '♥', red: true  },
  { mark: '♦', red: true  },
  { mark: '♣', red: false }
];
const RANKS = ['A','2','3','4','5','6','7','8','9','10','J','Q','K'];
const AI_NAMES = ['CPU ハル', 'CPU ミナ', 'CPU レオ'];

/* ---------- 2. DOM参照 ---------- */
const $ = (id) => document.getElementById(id);

const el = {
  medalCount:  $('medalCount'),
  adBtn:       $('adBtn'),
  menuBtn:     $('menuBtn'),

  dealerCards: $('dealerCards'),
  dealerTotal: $('dealerTotal'),
  messageText: $('messageText'),
  aiRow:       $('aiRow'),
  humanWrap:   $('humanWrap'),

  betPanel:    $('betPanel'),
  betValue:    $('betValue'),
  betClearBtn: $('betClearBtn'),
  betMaxBtn:   $('betMaxBtn'),
  dealBtn:     $('dealBtn'),

  actionPanel: $('actionPanel'),
  hitBtn:      $('hitBtn'),
  standBtn:    $('standBtn'),

  nextPanel:   $('nextPanel'),
  nextBtn:     $('nextBtn'),

  adOverlay:   $('adOverlay'),
  adVideo:     $('adVideo'),
  adFallback:  $('adFallback'),
  adTimer:     $('adTimer'),
  adProgress:  $('adProgressBar'),
  adSoundBtn:  $('adSoundBtn'),
  adCloseBtn:  $('adCloseBtn'),

  menuOverlay: $('menuOverlay'),
  menuCloseBtn:$('menuCloseBtn'),
  seatSeg:     $('seatSeg'),
  resetBtn:    $('resetBtn'),
  stRounds:    $('stRounds'),
  stWin:       $('stWin'),
  stLose:      $('stLose'),
  stPush:      $('stPush'),
  stBj:        $('stBj'),
  stMax:       $('stMax'),

  toast:       $('toast'),
  toastText:   $('toastText')
};

/* ---------- 3. 状態 ---------- */
const state = {
  shoe: [],
  shoeSize: 0,
  seats: [],            // 0 = 人間、1〜3 = 補充AI
  dealer: { hand: [], hole: true },
  phase: 'bet',         // bet | deal | play | dealer | result
  activeSeat: -1,
  bet: 0,
  seatCount: 4,
  nextSeatCount: 4,
  busy: false,
  stats: { rounds: 0, win: 0, lose: 0, push: 0, bj: 0, max: INITIAL_MEDAL }
};

const ad = {
  open: false,
  forced: false,
  need: AD_SKIP_SEC,
  elapsed: 0,
  timerId: null,
  ready: false
};

/* ---------- 4. ユーティリティ ---------- */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clamp = (v, min, max) => Math.min(Math.max(v, min), max);
const randInt = (n) => Math.floor(Math.random() * n);

function setMessage(text, tone){
  el.messageText.textContent = text;
  el.messageText.className = tone || '';
}

let toastTimer = null;
function toast(text){
  el.toastText.textContent = text;
  el.toast.hidden = false;
  el.toast.style.animation = 'none';
  void el.toast.offsetWidth;
  el.toast.style.animation = '';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.toast.hidden = true; }, 2200);
}

function ledTick(node){
  node.classList.remove('tick');
  void node.offsetWidth;
  node.classList.add('tick');
}

/* ---------- 5. 山札 ---------- */
function buildShoe(){
  const shoe = [];
  for (let d = 0; d < DECK_COUNT; d++){
    for (const suit of SUITS){
      for (const rank of RANKS){
        shoe.push({ rank, mark: suit.mark, red: suit.red });
      }
    }
  }
  // Fisher-Yates
  for (let i = shoe.length - 1; i > 0; i--){
    const j = randInt(i + 1);
    [shoe[i], shoe[j]] = [shoe[j], shoe[i]];
  }
  state.shoe = shoe;
  state.shoeSize = shoe.length;
}

function drawCard(){
  if (state.shoe.length === 0) buildShoe();
  return state.shoe.pop();
}

function checkReshuffle(){
  if (state.shoe.length < state.shoeSize * RESHUFFLE_RATIO){
    buildShoe();
    return true;
  }
  return false;
}

/* ---------- 6. 手札計算 ---------- */
function cardPoint(rank){
  if (rank === 'A') return 11;
  if (rank === 'J' || rank === 'Q' || rank === 'K') return 10;
  return Number(rank);
}

function handValue(hand){
  let total = 0;
  let aces = 0;
  for (const c of hand){
    total += cardPoint(c.rank);
    if (c.rank === 'A') aces++;
  }
  while (total > 21 && aces > 0){
    total -= 10;
    aces--;
  }
  return { total, soft: aces > 0, bust: total > 21 };
}

function isBlackjack(hand){
  return hand.length === 2 && handValue(hand).total === 21;
}

/* ---------- 7. 席の生成 ---------- */
function makeSeats(count){
  const seats = [];
  seats.push({
    id: 0, name: 'あなた', human: true,
    medal: state.seats[0] ? state.seats[0].medal : INITIAL_MEDAL,
    bet: 0, hand: [], shown: 0, done: false, result: null, playing: false
  });
  for (let i = 1; i < count; i++){
    const prev = state.seats[i];
    seats.push({
      id: i, name: AI_NAMES[i - 1], human: false,
      medal: prev && !prev.human ? prev.medal : AI_MEDAL,
      bet: 0, hand: [], shown: 0, done: false, result: null, playing: false
    });
  }
  state.seats = seats;
  state.seatCount = count;
}

/* ---------- 8. 描画 ---------- */
function createCardEl(card, faceDown, animate){
  const node = document.createElement('div');
  if (faceDown){
    node.className = 'card back';
  } else {
    node.className = 'card' + (card.red ? ' red' : '');
    node.innerHTML =
      '<span class="rank">' + card.rank + '</span>' +
      '<span class="suit-sm">' + card.mark + '</span>' +
      '<span class="suit-lg">' + card.mark + '</span>';
  }
  if (animate) requestAnimationFrame(() => node.classList.add('in'));
  else node.classList.add('in');   // 既出のカードは即表示(再アニメーション防止)
  return node;
}

function renderDealer(){
  el.dealerCards.innerHTML = '';
  const hand = state.dealer.hand;
  const shown = state.dealer.shown || 0;
  hand.forEach((card, i) => {
    const hidden = state.dealer.hole && i === 1;
    const isNew = i >= shown || (state.dealer.flip && i === 1);
    el.dealerCards.appendChild(createCardEl(card, hidden, isNew));
  });
  state.dealer.shown = hand.length;
  state.dealer.flip = false;

  el.dealerTotal.className = 'seat-total led';
  if (hand.length === 0){
    el.dealerTotal.textContent = '--';
    return;
  }
  if (state.dealer.hole){
    const v = handValue([hand[0]]);
    el.dealerTotal.textContent = v.total + '+';
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

  let scoreClass = 'seat-score led';
  if (seat.hand.length){
    if (v.bust) scoreClass += ' is-bust';
    else if (isBlackjack(seat.hand)) scoreClass += ' is-bj';
  }

  const badge = seat.result
    ? '<span class="result-badge" data-r="' + seat.result.kind + '">' + seat.result.label + '</span>'
    : '';

  return '' +
    '<div class="seat-top">' +
      '<span class="seat-label">' + seat.name + '</span>' +
      '<span class="' + scoreClass + '">' + scoreText + '</span>' +
    '</div>' +
    '<div class="cards"></div>' +
    badge +
    '<span class="seat-meta">' +
      '<span>BET<b>' + seat.bet + '</b></span>' +
      '<span>MEDAL<b>' + seat.medal + '</b></span>' +
    '</span>';
}

function renderSeats(){
  el.aiRow.innerHTML = '';
  el.humanWrap.innerHTML = '';

  state.seats.forEach((seat) => {
    const box = document.createElement('div');
    box.className = 'seat' + (seat.human ? ' is-human' : '');
    if (state.activeSeat === seat.id && state.phase === 'play') box.classList.add('is-active');
    if (seat.hand.length === 0 && state.phase !== 'bet' && !seat.playing) box.classList.add('is-out');
    box.dataset.seat = String(seat.id);
    box.innerHTML = seatMarkup(seat);

    const cardsBox = box.querySelector('.cards');
    const shown = seat.shown || 0;
    seat.hand.forEach((card, i) => {
      cardsBox.appendChild(createCardEl(card, false, i >= shown));
    });
    seat.shown = seat.hand.length;

    if (seat.human) el.humanWrap.appendChild(box);
    else el.aiRow.appendChild(box);
  });
}

function renderMedal(){
  const medal = state.seats[0] ? state.seats[0].medal : 0;
  el.medalCount.textContent = medal;
  ledTick(el.medalCount);
  if (medal > state.stats.max) state.stats.max = medal;
}

function renderBet(){
  el.betValue.textContent = state.bet;
  const medal = state.seats[0].medal;
  el.betClearBtn.disabled = state.bet === 0;
  el.betMaxBtn.disabled = medal < MIN_BET;
  el.dealBtn.disabled = state.bet < MIN_BET;
  document.querySelectorAll('.chip').forEach((chip) => {
    chip.disabled = Number(chip.dataset.chip) > medal - state.bet;
  });
}

function renderStats(){
  el.stRounds.textContent = state.stats.rounds;
  el.stWin.textContent    = state.stats.win;
  el.stLose.textContent   = state.stats.lose;
  el.stPush.textContent   = state.stats.push;
  el.stBj.textContent     = state.stats.bj;
  el.stMax.textContent    = state.stats.max;
}

function showPanel(name){
  el.betPanel.hidden    = name !== 'bet';
  el.actionPanel.hidden = name !== 'action';
  el.nextPanel.hidden   = name !== 'next';
}

/* ---------- 9. ベットフェーズ ---------- */
function startBetPhase(){
  if (state.nextSeatCount !== state.seatCount) makeSeats(state.nextSeatCount);

  state.phase = 'bet';
  state.activeSeat = -1;
  state.bet = 0;
  state.busy = false;
  state.dealer.hand = [];
  state.dealer.hole = true;
  state.dealer.shown = 0;
  state.dealer.flip = false;

  state.seats.forEach((seat) => {
    seat.hand = [];
    seat.bet = 0;
    seat.shown = 0;
    seat.done = false;
    seat.result = null;
    seat.playing = false;
    if (!seat.human && seat.medal < MIN_BET) seat.medal = AI_REFILL;
  });

  renderDealer();
  renderSeats();
  renderMedal();
  renderBet();
  showPanel('bet');

  if (state.seats[0].medal < MIN_BET){
    setMessage('メダルが足りません。広告を見て ' + AD_REWARD + ' メダルを受け取れます。', 'alert');
  } else {
    setMessage('ベット額を決めてください');
  }
}

function addBet(amount){
  if (state.phase !== 'bet') return;
  const medal = state.seats[0].medal;
  const next = clamp(state.bet + amount, 0, medal);
  if (next === state.bet) return;
  state.bet = next;
  ledTick(el.betValue);
  renderBet();
}

/* ---------- 10. 配札 ---------- */
async function startRound(){
  if (state.busy || state.phase !== 'bet') return;
  if (state.bet < MIN_BET) return;

  state.busy = true;
  state.phase = 'deal';
  showPanel('none');

  if (checkReshuffle()) toast('山札をシャッフルしました');

  // ベット確定
  const human = state.seats[0];
  human.bet = state.bet;
  human.medal -= state.bet;
  human.playing = true;

  state.seats.forEach((seat) => {
    if (seat.human) return;
    const options = [10, 50, 100, 500].filter((v) => v <= seat.medal);
    const pick = options.length ? options[randInt(options.length)] : MIN_BET;
    seat.bet = pick;
    seat.medal -= pick;
    seat.playing = true;
  });

  renderMedal();
  renderSeats();
  setMessage('カードを配っています…');

  // 2巡配る(プレイヤー → ディーラーの順)
  for (let round = 0; round < 2; round++){
    for (const seat of state.seats){
      seat.hand.push(drawCard());
      renderSeats();
      await sleep(DEAL_MS);
    }
    state.dealer.hand.push(drawCard());
    renderDealer();
    await sleep(DEAL_MS);
  }

  // ナチュラルBJの席は自動確定
  state.seats.forEach((seat) => {
    if (isBlackjack(seat.hand)) seat.done = true;
  });

  // ディーラーがBJならその場で公開
  if (isBlackjack(state.dealer.hand)){
    setMessage('ディーラーがブラックジャック!', 'alert');
    await sleep(REVEAL_MS);
    await revealDealer();
    await settle();
    return;
  }

  await playSeats();
}

/* ---------- 11. プレイフェーズ ---------- */
async function playSeats(){
  state.phase = 'play';

  for (const seat of state.seats){
    if (seat.done) continue;
    state.activeSeat = seat.id;
    renderSeats();

    if (seat.human){
      state.busy = false;
      showPanel('action');
      updateActionButtons();
      setMessage('ヒットするか、スタンドするか選んでください');
      await waitHumanTurn(seat);
      state.busy = true;
      showPanel('none');
    } else {
      setMessage(seat.name + ' の番です');
      await playAI(seat);
    }
  }

  state.activeSeat = -1;
  renderSeats();
  await dealerTurn();
}

let humanResolve = null;

function waitHumanTurn(seat){
  return new Promise((resolve) => {
    humanResolve = () => {
      humanResolve = null;
      seat.done = true;
      resolve();
    };
  });
}

function updateActionButtons(){
  const seat = state.seats[state.activeSeat];
  const busy = state.busy;
  el.hitBtn.disabled = busy || !seat || seat.done;
  el.standBtn.disabled = busy || !seat || seat.done;
}

async function humanHit(){
  if (state.phase !== 'play' || state.busy) return;
  const seat = state.seats[state.activeSeat];
  if (!seat || !seat.human || seat.done) return;

  state.busy = true;
  updateActionButtons();

  seat.hand.push(drawCard());
  renderSeats();
  await sleep(DEAL_MS);

  const v = handValue(seat.hand);
  state.busy = false;

  if (v.bust){
    setMessage('バースト! ' + v.total, 'alert');
    await sleep(REVEAL_MS);
    if (humanResolve) humanResolve();
    return;
  }
  if (v.total === 21){
    setMessage('21! 自動でスタンドします', 'good');
    await sleep(REVEAL_MS);
    if (humanResolve) humanResolve();
    return;
  }
  updateActionButtons();
}

function humanStand(){
  if (state.phase !== 'play' || state.busy) return;
  const seat = state.seats[state.activeSeat];
  if (!seat || !seat.human || seat.done) return;
  el.hitBtn.disabled = true;
  el.standBtn.disabled = true;
  if (humanResolve) humanResolve();
}

async function playAI(seat){
  await sleep(AI_THINK_MS);
  while (true){
    const v = handValue(seat.hand);
    if (v.bust || v.total >= AI_STAND) break;
    seat.hand.push(drawCard());
    renderSeats();
    await sleep(AI_THINK_MS);
  }
  const v = handValue(seat.hand);
  setMessage(seat.name + ' は ' + (v.bust ? 'バースト' : 'スタンド (' + v.total + ')'));
  seat.done = true;
  renderSeats();
  await sleep(AI_THINK_MS * 0.6);
}

/* ---------- 12. ディーラー ---------- */
async function revealDealer(){
  state.dealer.hole = false;
  state.dealer.flip = true;
  renderDealer();
  await sleep(REVEAL_MS);
}

async function dealerTurn(){
  state.phase = 'dealer';
  showPanel('none');

  // 全員バーストならディーラーは引かない
  const alive = state.seats.some((s) => s.playing && !handValue(s.hand).bust);

  setMessage('ディーラーのターン');
  await revealDealer();

  if (alive){
    while (handValue(state.dealer.hand).total < DEALER_STAND){
      state.dealer.hand.push(drawCard());
      renderDealer();
      await sleep(AI_THINK_MS);
    }
    const dv = handValue(state.dealer.hand);
    setMessage(dv.bust ? 'ディーラーがバースト!' : 'ディーラー ' + dv.total + ' でスタンド',
               dv.bust ? 'good' : '');
    await sleep(REVEAL_MS);
  }

  await settle();
}

/* ---------- 13. 精算 ---------- */
async function settle(){
  state.phase = 'result';
  state.dealer.hole = false;
  renderDealer();

  const dealerVal = handValue(state.dealer.hand);
  const dealerBJ  = isBlackjack(state.dealer.hand);

  state.seats.forEach((seat) => {
    if (!seat.playing){ seat.result = null; return; }

    const v = handValue(seat.hand);
    const bj = isBlackjack(seat.hand);
    let payout = 0;
    let kind, label;

    if (v.bust){
      kind = 'lose'; label = 'BUST';
    } else if (bj && !dealerBJ){
      payout = Math.floor(seat.bet * 2.5);
      kind = 'bj'; label = 'BLACKJACK';
    } else if (bj && dealerBJ){
      payout = seat.bet;
      kind = 'push'; label = 'PUSH';
    } else if (dealerBJ){
      kind = 'lose'; label = 'LOSE';
    } else if (dealerVal.bust){
      payout = seat.bet * 2;
      kind = 'win'; label = 'WIN';
    } else if (v.total > dealerVal.total){
      payout = seat.bet * 2;
      kind = 'win'; label = 'WIN';
    } else if (v.total < dealerVal.total){
      kind = 'lose'; label = 'LOSE';
    } else {
      payout = seat.bet;
      kind = 'push'; label = 'PUSH';
    }

    seat.medal += payout;
    seat.result = { kind, label, payout };

    if (seat.human){
      state.stats.rounds++;
      if (kind === 'bj'){ state.stats.win++; state.stats.bj++; }
      else if (kind === 'win')  state.stats.win++;
      else if (kind === 'lose') state.stats.lose++;
      else state.stats.push++;
    }
  });

  renderSeats();
  renderMedal();
  renderStats();

  // 人間の結果でメッセージ
  const me = state.seats[0];
  if (me.result){
    const net = me.result.payout - me.bet;
    if (me.result.kind === 'bj'){
      setMessage('ブラックジャック! +' + net + ' メダル', 'good');
    } else if (me.result.kind === 'win'){
      setMessage('勝ち! +' + net + ' メダル', 'good');
    } else if (me.result.kind === 'push'){
      setMessage('引き分け。ベットが戻ります');
    } else {
      setMessage('負け… −' + me.bet + ' メダル', 'alert');
    }
  }

  state.busy = false;
  showPanel('next');
  el.nextBtn.focus({ preventScroll: true });
}

/* ---------- 14. 広告 ---------- */
function openAd(){
  if (ad.open) return;
  ad.open = true;
  ad.elapsed = 0;
  ad.ready = false;
  ad.forced = Math.random() >= AD_SKIP_RATE;
  ad.need = ad.forced ? AD_FULL_SEC : AD_SKIP_SEC;

  const src = AD_FILES[randInt(AD_FILES.length)];
  el.adFallback.hidden = true;
  el.adVideo.hidden = false;
  el.adVideo.muted = true;
  el.adVideo.loop = true;
  el.adVideo.currentTime = 0;
  el.adVideo.src = src;
  el.adSoundBtn.textContent = '音を出す';
  el.adProgress.style.width = '0%';

  el.adOverlay.hidden = false;
  updateAdFoot();

  const play = el.adVideo.play();
  if (play && typeof play.catch === 'function') play.catch(() => {});

  clearInterval(ad.timerId);
  ad.timerId = setInterval(tickAd, 100);
}

function tickAd(){
  ad.elapsed = Math.min(ad.elapsed + 0.1, ad.need);
  const remain = Math.max(0, Math.ceil(ad.need - ad.elapsed));
  el.adTimer.textContent = remain;
  el.adProgress.style.width = (ad.elapsed / ad.need * 100).toFixed(1) + '%';

  if (ad.elapsed >= ad.need && !ad.ready){
    ad.ready = true;
    clearInterval(ad.timerId);
    updateAdFoot();
  } else if (!ad.ready){
    updateAdFoot();
  }
}

function updateAdFoot(){
  if (ad.ready){
    el.adCloseBtn.disabled = false;
    el.adCloseBtn.textContent = ad.forced ? '閉じて受け取る' : 'スキップして受け取る';
  } else {
    const remain = Math.max(1, Math.ceil(ad.need - ad.elapsed));
    el.adCloseBtn.disabled = true;
    el.adCloseBtn.textContent = 'あと' + remain + '秒';
  }
}

function closeAd(){
  if (!ad.open || !ad.ready) return;
  clearInterval(ad.timerId);
  ad.timerId = null;
  ad.open = false;

  el.adVideo.pause();
  el.adVideo.removeAttribute('src');
  el.adVideo.load();
  el.adOverlay.hidden = true;

  state.seats[0].medal += AD_REWARD;
  renderMedal();
  renderStats();
  if (state.phase === 'bet'){
    renderBet();
    setMessage('ベット額を決めてください');
  }
  toast('+' + AD_REWARD + ' メダルを受け取りました');
}

function onAdError(){
  el.adVideo.hidden = true;
  el.adFallback.hidden = false;
}

function toggleAdSound(){
  el.adVideo.muted = !el.adVideo.muted;
  el.adSoundBtn.textContent = el.adVideo.muted ? '音を出す' : '音を消す';
  if (!el.adVideo.muted){
    const play = el.adVideo.play();
    if (play && typeof play.catch === 'function') play.catch(() => {});
  }
}

/* ---------- 15. メニュー ---------- */
function openMenu(){
  renderStats();
  el.menuOverlay.hidden = false;
}

function closeMenu(){
  el.menuOverlay.hidden = true;
}

function setSeatCount(count){
  state.nextSeatCount = count;
  el.seatSeg.querySelectorAll('.seg-btn').forEach((b) => {
    b.classList.toggle('is-on', Number(b.dataset.seats) === count);
  });
  if (state.phase === 'bet'){
    makeSeats(count);
    state.bet = clamp(state.bet, 0, state.seats[0].medal);
    renderSeats();
    renderBet();
  } else {
    toast('次のラウンドから ' + count + '人になります');
  }
}

function resetAll(){
  state.stats = { rounds: 0, win: 0, lose: 0, push: 0, bj: 0, max: INITIAL_MEDAL };
  state.seats = [];
  makeSeats(state.nextSeatCount);
  state.seats[0].medal = INITIAL_MEDAL;
  buildShoe();
  renderStats();
  closeMenu();
  startBetPhase();
  toast('初期化しました');
}

/* ---------- 16. イベント登録 ---------- */
document.querySelectorAll('.chip').forEach((chip) => {
  chip.addEventListener('click', () => addBet(Number(chip.dataset.chip)));
});

el.betClearBtn.addEventListener('click', () => {
  if (state.phase !== 'bet') return;
  state.bet = 0;
  ledTick(el.betValue);
  renderBet();
});

el.betMaxBtn.addEventListener('click', () => {
  if (state.phase !== 'bet') return;
  state.bet = state.seats[0].medal;
  ledTick(el.betValue);
  renderBet();
});

el.dealBtn.addEventListener('click', startRound);
el.hitBtn.addEventListener('click', humanHit);
el.standBtn.addEventListener('click', humanStand);
el.nextBtn.addEventListener('click', () => {
  if (state.phase !== 'result') return;
  startBetPhase();
});

el.adBtn.addEventListener('click', openAd);
el.adCloseBtn.addEventListener('click', closeAd);
el.adSoundBtn.addEventListener('click', toggleAdSound);
el.adVideo.addEventListener('error', onAdError);

el.menuBtn.addEventListener('click', openMenu);
el.menuCloseBtn.addEventListener('click', closeMenu);
el.menuOverlay.addEventListener('click', (e) => {
  if (e.target === el.menuOverlay) closeMenu();
});
el.seatSeg.addEventListener('click', (e) => {
  const btn = e.target.closest('.seg-btn');
  if (btn) setSeatCount(Number(btn.dataset.seats));
});
el.resetBtn.addEventListener('click', resetAll);

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape'){
    if (!el.menuOverlay.hidden) closeMenu();
    return;
  }
  if (!el.adOverlay.hidden || !el.menuOverlay.hidden) return;

  const key = e.key.toLowerCase();
  if (state.phase === 'play' && !state.busy){
    if (key === 'h') humanHit();
    if (key === 's') humanStand();
  } else if (state.phase === 'bet' && key === 'enter'){
    startRound();
  } else if (state.phase === 'result' && key === 'enter'){
    startBetPhase();
  }
});

/* ---------- 17. 起動 ---------- */
function init(){
  buildShoe();
  makeSeats(4);
  renderStats();
  startBetPhase();
}

init();
