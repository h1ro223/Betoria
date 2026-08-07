/* =========================================================
   BLACKJACK 4 - server.js  (v2.0)
   made by hiro / ヒロ   https://github.com/h1ro223
   Render(無料枠)向け  Express + Socket.io + PostgreSQL
   DATABASE_URL が無い場合はメモリ保存で動作します(ローカル検証用)
   ========================================================= */
'use strict';

const path = require('path');
const crypto = require('crypto');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const PORT = process.env.PORT || 3000;
const SECRET = process.env.AUTH_SECRET || crypto.randomBytes(32).toString('hex');
const TOKEN_DAYS = 30;
const APP_VERSION = '3.0.0';

/* =========================================================
   1. データベース層(PostgreSQL / メモリ フォールバック)
   ========================================================= */
const INITIAL_MEDAL = 1000;

/* アカウントアイコンの色(v3.0)。クライアントの ICON_COLORS と必ず揃えること */
const ICON_COLORS = [
  'brass', 'emerald', 'ruby', 'sapphire', 'amethyst',
  'tangerine', 'mint', 'rose', 'sky', 'slate'
];
const DEFAULT_ICON_COLOR = 'brass';

const db = (() => {
  const url = process.env.DATABASE_URL;

  /* ---- メモリ実装 ---- */
  if (!url){
    console.log('[db] DATABASE_URL 未設定のためメモリ保存で起動します');
    const users = new Map();
    return {
      kind: 'memory',
      async init(){},
      async findUser(name){ return users.get(name) || null; },
      async createUser(row){ users.set(row.username, row); return row; },
      async saveUser(row){ users.set(row.username, row); return row; },
      async deleteUser(name){ return users.delete(name); },
      async listUsers(){
        return [...users.values()].sort((a, b) =>
          String(a.username).localeCompare(String(b.username)));
      }
    };
  }

  /* ---- PostgreSQL実装 ---- */
  const { Pool } = require('pg');
  const pool = new Pool({
    connectionString: url,
    ssl: { rejectUnauthorized: false },
    max: 5
  });

  const COLS = 'username, pass_hash, medal, level, exp, rounds, wins, losses, pushes, bj, ' +
               'champ_plays, champ_wins, champ_losses, champ_draws, last_login, icon_color';

  return {
    kind: 'postgres',
    async init(){
      await pool.query(`
        CREATE TABLE IF NOT EXISTS users(
          username     TEXT PRIMARY KEY,
          pass_hash    TEXT NOT NULL,
          medal        INTEGER NOT NULL DEFAULT ${INITIAL_MEDAL},
          level        INTEGER NOT NULL DEFAULT 1,
          exp          INTEGER NOT NULL DEFAULT 0,
          rounds       INTEGER NOT NULL DEFAULT 0,
          wins         INTEGER NOT NULL DEFAULT 0,
          losses       INTEGER NOT NULL DEFAULT 0,
          pushes       INTEGER NOT NULL DEFAULT 0,
          bj           INTEGER NOT NULL DEFAULT 0,
          champ_plays  INTEGER NOT NULL DEFAULT 0,
          champ_wins   INTEGER NOT NULL DEFAULT 0,
          champ_losses INTEGER NOT NULL DEFAULT 0,
          champ_draws  INTEGER NOT NULL DEFAULT 0,
          last_login   TIMESTAMPTZ,
          icon_color   TEXT NOT NULL DEFAULT '${DEFAULT_ICON_COLOR}',
          created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )`);
      /* 既存テーブルへのマイグレーション(v1.0からの引き継ぎ用) */
      await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS champ_plays  INTEGER NOT NULL DEFAULT 0`);
      await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS champ_wins   INTEGER NOT NULL DEFAULT 0`);
      await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS champ_losses INTEGER NOT NULL DEFAULT 0`);
      await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS champ_draws  INTEGER NOT NULL DEFAULT 0`);
      await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login   TIMESTAMPTZ`);
      await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS icon_color   TEXT NOT NULL DEFAULT '${DEFAULT_ICON_COLOR}'`);
      console.log('[db] PostgreSQL 接続OK');
    },
    async findUser(name){
      const r = await pool.query(`SELECT ${COLS} FROM users WHERE username=$1`, [name]);
      return r.rows[0] || null;
    },
    async createUser(row){
      await pool.query(
        `INSERT INTO users(${COLS}) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
        [row.username, row.pass_hash, row.medal, row.level, row.exp,
         row.rounds, row.wins, row.losses, row.pushes, row.bj,
         row.champ_plays, row.champ_wins, row.champ_losses, row.champ_draws, row.last_login,
         row.icon_color || DEFAULT_ICON_COLOR]);
      return row;
    },
    async saveUser(row){
      await pool.query(
        `UPDATE users SET medal=$2, level=$3, exp=$4, rounds=$5,
         wins=$6, losses=$7, pushes=$8, bj=$9,
         champ_plays=$10, champ_wins=$11, champ_losses=$12, champ_draws=$13,
         last_login=$14, icon_color=$15
         WHERE username=$1`,
        [row.username, row.medal, row.level, row.exp,
         row.rounds, row.wins, row.losses, row.pushes, row.bj,
         row.champ_plays, row.champ_wins, row.champ_losses, row.champ_draws, row.last_login,
         row.icon_color || DEFAULT_ICON_COLOR]);
      return row;
    },
    async deleteUser(name){
      const r = await pool.query(`DELETE FROM users WHERE username=$1`, [name]);
      return r.rowCount > 0;
    },
    async listUsers(){
      const r = await pool.query(`SELECT ${COLS} FROM users ORDER BY username ASC`);
      return r.rows;
    }
  };
})();

/* =========================================================
   2. 認証
   ========================================================= */
const NAME_RE = /^[A-Za-z0-9]{1,8}$/;
const PASS_RE = /^[A-Za-z0-9]{1,8}$/;

function hashPassword(pass, salt){
  const s = salt || crypto.randomBytes(16).toString('hex');
  const h = crypto.scryptSync(pass, s, 32).toString('hex');
  return s + ':' + h;
}

function verifyPassword(pass, stored){
  const [salt, hash] = String(stored).split(':');
  if (!salt || !hash) return false;
  const calc = crypto.scryptSync(pass, salt, 32).toString('hex');
  const a = Buffer.from(calc, 'hex');
  const b = Buffer.from(hash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function sign(payload){
  return crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
}

function makeToken(username){
  const exp = Date.now() + TOKEN_DAYS * 86400000;
  const body = Buffer.from(username).toString('base64url') + '.' + exp;
  return body + '.' + sign(body);
}

function readToken(token){
  if (typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const body = parts[0] + '.' + parts[1];
  const expected = sign(body);
  const a = Buffer.from(parts[2]);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  if (Number(parts[1]) < Date.now()) return null;
  try { return Buffer.from(parts[0], 'base64url').toString('utf8'); }
  catch { return null; }
}

/* =========================================================
   3. レベル / 経験値
   ========================================================= */
const EXP_ROUND = 10;
const EXP_WIN   = 25;
const EXP_BJ    = 40;
const EXP_PUSH  = 12;
const EXP_LOSE  = 5;
const EXP_SURRENDER = 6;
const MAX_LEVEL = 99;

/* チャンピオンモードのEXP係数
   ・1ラウンドあたりの基礎EXPはエンジョイモードの「参加+10」を基準に1.25倍
   ・参加人数が多いほど難易度が上がるため倍率を上乗せ(2人=1.2 / 3人=1.4 / 4人=1.6)
   ・脱落(0枚)の場合は経過ラウンド分の50%
   ・生き残った場合(2〜4位含む)は経過ラウンド分の100%+順位ボーナス */
const CHAMPION_MULT = 1.25;
const CHAMPION_RANK_BONUS = { 1: 80, 2: 40, 3: 20, 4: 8 };
/* サレンダーしたラウンドはEXPの対象にしない(全員サレンダーでの荒稼ぎ対策)。
   順位ボーナスも「実際に勝負したラウンド数 ÷ 規定ラウンド数」で按分する。 */

/* エンジョイモードの1ラウンドあたり平均EXP(参加10 + 結果平均およそ20)を基準にする */
const EXP_ENJOY_AVG = 30;
function championFactor(playerCount){ return 1 + (Math.max(playerCount, 2) - 2) * 0.1; }
function championRoundExp(playerCount){ return EXP_ENJOY_AVG * CHAMPION_MULT * championFactor(playerCount); }

function expToNext(level){ return 120 + (level - 1) * 60; }

function addExp(user, gain){
  user.exp += Math.max(0, Math.round(gain));
  let up = 0;
  while (user.level < MAX_LEVEL && user.exp >= expToNext(user.level)){
    user.exp -= expToNext(user.level);
    user.level++;
    up++;
  }
  if (user.level >= MAX_LEVEL) user.exp = Math.min(user.exp, expToNext(MAX_LEVEL));
  return up;
}

function expForResult(kind){
  if (kind === 'bj')        return EXP_ROUND + EXP_BJ;
  if (kind === 'win')       return EXP_ROUND + EXP_WIN;
  if (kind === 'push')      return EXP_ROUND + EXP_PUSH;
  if (kind === 'surrender') return EXP_SURRENDER;
  return EXP_ROUND + EXP_LOSE;
}

function applyEnjoyResult(user, kind){
  user.rounds++;
  if (kind === 'bj'){ user.wins++; user.bj++; }
  else if (kind === 'win')  user.wins++;
  else if (kind === 'push') user.pushes++;
  else user.losses++;   // lose / surrender
  return addExp(user, expForResult(kind));
}

/* チャンピオンモード終了時の結果反映
   rankKind: 'win'(1位) | 'draw'(1位タイ) | 'lose'(2〜4位 or 脱落) */
function applyChampionResult(user, { rankKind, expGain }){
  user.champ_plays++;
  if (rankKind === 'win') user.champ_wins++;
  else if (rankKind === 'draw') user.champ_draws++;
  else user.champ_losses++;
  return addExp(user, expGain);
}

function publicUser(u){
  return {
    username: u.username,
    medal: u.medal,
    level: u.level,
    exp: u.exp,
    expNext: expToNext(u.level),
    rounds: u.rounds,
    wins: u.wins,
    losses: u.losses,
    pushes: u.pushes,
    bj: u.bj,
    champPlays: u.champ_plays,
    champWins: u.champ_wins,
    champLosses: u.champ_losses,
    champDraws: u.champ_draws,
    iconColor: ICON_COLORS.includes(u.icon_color) ? u.icon_color : DEFAULT_ICON_COLOR
  };
}

/* =========================================================
   4. ブラックジャック エンジン
   ========================================================= */
const SUITS = [
  { mark: '♠', red: false }, { mark: '♥', red: true },
  { mark: '♦', red: true },  { mark: '♣', red: false }
];
const RANKS = ['A','2','3','4','5','6','7','8','9','10','J','Q','K'];
const DECK_COUNT   = 6;
const MIN_BET      = 10;
const DEALER_STAND = 17;
const CPU_STAND    = 17;
const CPU_MEDAL    = 1000;
const CPU_REFILL   = 500;
const CPU_NAMES    = ['CPU ハル', 'CPU ミナ', 'CPU レオ'];
const TURN_LIMIT_MS = 30000;
const CPU_TURN_MS   = 900;
const COUNTDOWN_SEC = 3;
const CHAMPION_START_MEDAL = 1000;
const CHAMPION_ROUND_MIN = 10;
const CHAMPION_ROUND_MAX = 100;
const CHAT_STAMPS = ['👍', '🎉', '😂', '😭', '🔥', '🙏'];
const MIN_HUMANS = 2;   // オンラインで開始に必要な人プレイヤー数
/* チャンピオンモードの全額ベットボーナス(WIN/BLACKJACKの獲得メダルを1.5倍)(v3.0) */
const ALLIN_BONUS_RATE = 1.5;

function buildShoe(){
  const shoe = [];
  for (let d = 0; d < DECK_COUNT; d++)
    for (const s of SUITS)
      for (const r of RANKS)
        shoe.push({ rank: r, mark: s.mark, red: s.red });
  for (let i = shoe.length - 1; i > 0; i--){
    const j = crypto.randomInt(i + 1);
    [shoe[i], shoe[j]] = [shoe[j], shoe[i]];
  }
  return shoe;
}

function cardPoint(rank){
  if (rank === 'A') return 11;
  if (rank === 'J' || rank === 'Q' || rank === 'K') return 10;
  return Number(rank);
}

function handValue(hand){
  let total = 0, aces = 0;
  for (const c of hand){ total += cardPoint(c.rank); if (c.rank === 'A') aces++; }
  while (total > 21 && aces > 0){ total -= 10; aces--; }
  return { total, soft: aces > 0, bust: total > 21 };
}

function isBlackjack(hand){
  return hand.length === 2 && handValue(hand).total === 21;
}

/* =========================================================
   5. ルーム管理
   ========================================================= */
const ROOM_ID_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 紛らわしい文字は除外
const rooms = new Map();

function makeRoomId(){
  let id;
  do {
    id = '';
    for (let i = 0; i < 4; i++) id += ROOM_ID_CHARS[crypto.randomInt(ROOM_ID_CHARS.length)];
  } while (rooms.has(id));
  return id;
}

function createRoom(opts){
  const mode = opts.mode === 'champion' ? 'champion' : 'enjoy';
  const room = {
    id: makeRoomId(),
    mode,
    maxPlayers: Math.min(Math.max(Number(opts.maxPlayers) || 4, 2), 4),
    /* CPU補充はエンジョイかつ3人以上の部屋でのみ有効
       (2人部屋は人が2人必要なので、CPUの入る余地がない) */
    cpuFill: mode === 'enjoy'
             && Number(opts.maxPlayers) >= MIN_HUMANS + 1
             && !!opts.cpuFill,
    championRounds: mode === 'champion'
      ? Math.min(Math.max(Number(opts.championRounds) || CHAMPION_ROUND_MIN,
                          CHAMPION_ROUND_MIN), CHAMPION_ROUND_MAX)
      : null,
    hostName: null,
    players: [],            // {name, sid, cpu, level, medal, bet, hand, done, surrendered, ready, connected, eliminated}
    phase: 'lobby',         // lobby | countdown | bet | play | dealer | result | champion_end
    dealer: { hand: [], hole: true },
    shoe: buildShoe(),
    activeIndex: -1,
    turnTimer: null,
    cpuTimer: null,
    countdownTimer: null,
    message: '',
    round: 0,
    standings: null
  };
  rooms.set(room.id, room);
  return room;
}

function destroyRoom(room){
  if (room.turnTimer) clearTimeout(room.turnTimer);
  if (room.cpuTimer) clearTimeout(room.cpuTimer);
  if (room.countdownTimer) clearTimeout(room.countdownTimer);
  rooms.delete(room.id);
}

function roomList(){
  const out = [];
  for (const r of rooms.values()){
    if (r.phase !== 'lobby') continue;
    const humanN = r.players.filter(p => !p.cpu).length;
    if (humanN === 0 || humanN >= r.maxPlayers) continue;
    out.push({
      id: r.id, count: humanN, max: r.maxPlayers, host: r.hostName,
      mode: r.mode, championRounds: r.championRounds, cpuFill: r.cpuFill
    });
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

function findRoomBySid(sid){
  for (const r of rooms.values())
    if (r.players.some(p => p.sid === sid)) return r;
  return null;
}

function humanCount(room){ return room.players.filter(p => !p.cpu).length; }

/* ホスト以外の参加者が全員「準備完了」を押しているか */
function guestsReady(room){
  const guests = room.players.filter(p => !p.cpu && p.name !== room.hostName);
  return guests.length > 0 && guests.every(p => p.lobbyReady);
}
function activePlayers(room){ return room.players.filter(p => !p.eliminated); }

/* 手札は自分以外にも見せる(ブラックジャックは公開情報) */
function roomState(room, forName){
  const dealerHand = room.dealer.hand.map((c, i) =>
    (room.dealer.hole && i === 1) ? null : c);

  return {
    id: room.id,
    mode: room.mode,
    phase: room.phase,
    maxPlayers: room.maxPlayers,
    cpuFill: room.cpuFill,
    championRounds: room.championRounds,
    hostName: room.hostName,
    isHost: forName === room.hostName,
    minHumans: MIN_HUMANS,
    humanCount: humanCount(room),
    allGuestsReady: guestsReady(room),
    round: room.round,
    message: room.message,
    activeName: room.activeIndex >= 0 && room.players[room.activeIndex]
      ? room.players[room.activeIndex].name : null,
    dealer: { hand: dealerHand, hole: room.dealer.hole },
    standings: room.standings,
    players: room.players.map(p => ({
      name: p.name,
      cpu: !!p.cpu,
      level: p.level,
      medal: p.medal,
      bet: p.bet,
      hand: p.hand,
      done: p.done,
      ready: p.ready,
      lobbyReady: !!p.lobbyReady,
      result: p.result,
      connected: p.connected,
      eliminated: !!p.eliminated,
      iconColor: p.iconColor || DEFAULT_ICON_COLOR,
      doubled: !!p.doubled,
      allIn: !!p.allIn,
      streak: p.streak || 0,
      isYou: p.name === forName
    }))
  };
}

function broadcast(io, room){
  for (const p of room.players){
    if (!p.sid) continue;
    io.to(p.sid).emit('room:state', roomState(room, p.name));
  }
}

function broadcastLobby(io){
  io.emit('room:list', roomList());
}

/* チャット欄に流すシステムメッセージ */
function chatSystem(io, room, body){
  const msg = { from: null, body, kind: 'system', at: Date.now() };
  for (const p of room.players){
    if (p.sid) io.to(p.sid).emit('chat:new', msg);
  }
}

/* =========================================================
   6. ゲーム進行(サーバー権威)
   ========================================================= */
function fillCpuSeats(room){
  if (room.mode !== 'enjoy' || !room.cpuFill) return;
  if (room.maxPlayers < MIN_HUMANS + 1) return;
  const need = room.maxPlayers - room.players.length;
  for (let i = 0; i < need; i++){
    const name = CPU_NAMES[i % CPU_NAMES.length] + (i >= CPU_NAMES.length ? (Math.floor(i / CPU_NAMES.length) + 1) : '');
    room.players.push({
      name, sid: null, cpu: true, level: 0, medal: CPU_MEDAL,
      iconColor: 'slate',
      bet: 0, hand: [], done: false, surrendered: false, ready: false,
      doubled: false, allIn: false, streak: 0,
      result: null, connected: true, eliminated: false
    });
  }
}

function removeCpuSeats(room){
  room.players = room.players.filter(p => !p.cpu);
}

function resetRound(room){
  room.round++;
  room.dealer = { hand: [], hole: true };
  room.activeIndex = -1;
  room.phase = 'bet';
  room.message = 'ベット額を決めてください';
  for (const p of room.players){
    p.bet = 0; p.hand = []; p.done = false; p.surrendered = false;
    p.result = null; p.ready = false;
    p.doubled = false; p.allIn = false;
  }
  if (room.shoe.length < DECK_COUNT * 52 * 0.25) room.shoe = buildShoe();
  autoBetCpu(room);
}

function autoBetCpu(room){
  const cpus = room.players.filter(p => p.cpu && !p.ready);
  if (cpus.length === 0) return;
  if (room.cpuTimer) clearTimeout(room.cpuTimer);
  room.cpuTimer = setTimeout(() => {
    for (const p of cpus){
      if (p.medal < MIN_BET) p.medal = CPU_REFILL;
      const opts = [10, 50, 100, 500].filter(v => v <= p.medal);
      p.bet = opts.length ? opts[crypto.randomInt(opts.length)] : MIN_BET;
      p.ready = true;
    }
  }, 500);
}

function beginCountdown(io, room){
  room.phase = 'countdown';
  room.message = 'まもなく開始します';
  /* 連勝はゲーム単位で数える(v3.0) */
  for (const p of room.players) p.streak = 0;
  let n = COUNTDOWN_SEC;
  broadcastCountdown(io, room, n);
  room.countdownTimer = setInterval(() => {
    n--;
    if (n <= 0){
      clearInterval(room.countdownTimer);
      room.countdownTimer = null;
      if (room.mode === 'champion'){
        for (const p of room.players){
          p.medal = CHAMPION_START_MEDAL;
          p.eliminated = false;
          p.eliminatedAtRound = null;
          p.scoredRounds = 0;   // サレンダー以外で勝負したラウンド数
        }
        room.round = 0;
        room.standings = null;
      }
      resetRound(room);
      broadcast(io, room);
      broadcastLobby(io);
      return;
    }
    broadcastCountdown(io, room, n);
  }, 1000);
}

function broadcastCountdown(io, room, n){
  for (const p of room.players){
    if (!p.sid) continue;
    io.to(p.sid).emit('room:countdown', { n });
  }
}

function dealRound(io, room){
  room.phase = 'play';
  room.dealer = { hand: [], hole: true };

  for (let i = 0; i < 2; i++){
    for (const p of room.players) p.hand.push(room.shoe.pop());
    room.dealer.hand.push(room.shoe.pop());
  }

  /* CPUは自動確定。人のプレイヤーは自分でBLACKJACKを宣言する */
  for (const p of room.players) if (isBlackjack(p.hand) && p.cpu) p.done = true;

  if (isBlackjack(room.dealer.hand)){
    room.message = 'ディーラーがブラックジャック!';
    return finishRound(io, room);
  }

  room.activeIndex = -1;
  nextTurn(io, room);
}

function nextTurn(io, room){
  if (room.turnTimer){ clearTimeout(room.turnTimer); room.turnTimer = null; }

  let i = room.activeIndex + 1;
  while (i < room.players.length && (room.players[i].done || !room.players[i].connected)){
    room.players[i].done = true;
    i++;
  }

  if (i >= room.players.length){
    room.activeIndex = -1;
    return dealerTurn(io, room);
  }

  room.activeIndex = i;
  const cur = room.players[i];
  room.message = cur.name + ' さんのターン';
  broadcast(io, room);

  if (cur.cpu){
    room.cpuTimer = setTimeout(() => cpuPlayTurn(io, room), CPU_TURN_MS);
    return;
  }

  room.turnTimer = setTimeout(() => {
    const p = room.players[room.activeIndex];
    if (p && !p.done){
      p.done = true;
      room.message = isBlackjack(p.hand)
        ? p.name + ' さんは時間切れ(ブラックジャック成立)'
        : p.name + ' さんは時間切れでスタンド';
      nextTurn(io, room);
    }
  }, TURN_LIMIT_MS);
}

function cpuPlayTurn(io, room){
  const p = room.players[room.activeIndex];
  if (!p || !p.cpu){ return; }
  const v = handValue(p.hand);
  if (v.bust || v.total >= CPU_STAND){
    p.done = true;
    return nextTurn(io, room);
  }
  p.hand.push(room.shoe.pop());
  broadcast(io, room);
  room.cpuTimer = setTimeout(() => cpuPlayTurn(io, room), CPU_TURN_MS);
}

function dealerTurn(io, room){
  room.phase = 'dealer';
  room.dealer.hole = false;
  const alive = room.players.some(p => p.bet > 0 && !p.surrendered && !handValue(p.hand).bust);
  if (alive){
    while (handValue(room.dealer.hand).total < DEALER_STAND){
      room.dealer.hand.push(room.shoe.pop());
    }
  }
  const dv = handValue(room.dealer.hand);
  room.message = dv.bust ? 'ディーラーがバースト!' : 'ディーラー ' + dv.total + ' でスタンド';
  broadcast(io, room);
  setTimeout(() => finishRound(io, room), 900);
}

async function finishRound(io, room){
  if (room.turnTimer){ clearTimeout(room.turnTimer); room.turnTimer = null; }
  if (room.cpuTimer){ clearTimeout(room.cpuTimer); room.cpuTimer = null; }
  room.phase = 'result';
  room.dealer.hole = false;

  const dv = handValue(room.dealer.hand);
  const dbj = isBlackjack(room.dealer.hand);

  for (const p of room.players){
    if (p.bet <= 0){ p.result = null; continue; }

    if (p.surrendered){
      const payout = Math.floor(p.bet / 2);
      p.result = { kind: 'surrender', label: 'SURRENDER', payout, net: payout - p.bet };
    } else {
      const v = handValue(p.hand);
      const bj = isBlackjack(p.hand);
      let payout = 0, kind, label;

      if (v.bust){ kind = 'lose'; label = 'BUST'; }
      else if (bj && !dbj){ payout = Math.floor(p.bet * 2.5); kind = 'bj'; label = 'BLACKJACK'; }
      else if (bj && dbj){ payout = p.bet; kind = 'push'; label = 'PUSH'; }
      else if (dbj){ kind = 'lose'; label = 'LOSE'; }
      else if (dv.bust){ payout = p.bet * 2; kind = 'win'; label = 'WIN'; }
      else if (v.total > dv.total){ payout = p.bet * 2; kind = 'win'; label = 'WIN'; }
      else if (v.total < dv.total){ kind = 'lose'; label = 'LOSE'; }
      else { payout = p.bet; kind = 'push'; label = 'PUSH'; }

      /* 全額ベットボーナス(チャンピオンモード限定)
         WIN・BLACKJACKで獲得したメダルをさらに1.5倍にする。
         ダブルダウンで手持ちを使い切った場合も対象。 */
      let allInBonus = false;
      if (room.mode === 'champion' && p.allIn && (kind === 'bj' || kind === 'win')){
        payout = Math.floor(payout * ALLIN_BONUS_RATE);
        allInBonus = true;
      }

      p.result = { kind, label, payout, net: payout - p.bet, doubled: !!p.doubled, allInBonus };
    }

    /* 連勝カウント: WIN / BLACKJACK で加算、PUSH・SURRENDERは維持、負けでリセット */
    if (p.result.kind === 'bj' || p.result.kind === 'win') p.streak = (p.streak || 0) + 1;
    else if (p.result.kind !== 'push') p.streak = 0;

    p.medal += p.result.payout;

    if (room.mode === 'enjoy' && !p.cpu){
      try {
        const u = await db.findUser(p.name);
        if (u){
          u.medal += p.result.payout;
          const up = applyEnjoyResult(u, p.result.kind);
          await db.saveUser(u);
          p.level = u.level;
          if (p.sid) io.to(p.sid).emit('account:update', { user: publicUser(u), levelUp: up });
        }
      } catch (e){ console.error('[result]', e.message); }
    }

    /* サレンダーはEXP計算の対象外。実際に勝負したラウンドだけ数える */
    if (room.mode === 'champion' && !p.surrendered && p.bet > 0){
      p.scoredRounds = (p.scoredRounds || 0) + 1;
    }

    if (room.mode === 'champion' && p.medal <= 0 && !p.eliminated){
      p.medal = 0;
      p.eliminated = true;
      p.eliminatedAtRound = room.round;
    }
  }

  room.message = 'ラウンド終了';
  broadcast(io, room);

  if (room.mode === 'champion') await maybeEndChampionship(io, room);
}

/* =========================================================
   7. チャンピオンシップの終了判定・EXP付与
   ========================================================= */
async function maybeEndChampionship(io, room){
  const alive = activePlayers(room);
  const reachedLimit = room.round >= room.championRounds;
  const soleSurvivor = alive.length <= 1 && room.players.length > 1;

  if (!reachedLimit && !soleSurvivor) return;

  const total = room.players.length;
  const perRound = championRoundExp(total);

  /* 順位付け: 生存者は所持メダル降順、脱落者はその後ろに脱落順(遅いほど上位) */
  const ranked = [...room.players].sort((a, b) => {
    if (a.eliminated !== b.eliminated) return a.eliminated ? 1 : -1;
    if (!a.eliminated) return b.medal - a.medal;
    return (b.eliminatedAtRound || 0) - (a.eliminatedAtRound || 0);
  });

  /* 同メダルは同順位(引き分け)にする */
  let rank = 0;
  for (let i = 0; i < ranked.length; i++){
    if (i === 0){ rank = 1; }
    else {
      const prev = ranked[i - 1];
      const same = !ranked[i].eliminated && !prev.eliminated && ranked[i].medal === prev.medal;
      if (!same) rank = i + 1;
    }
    ranked[i].rank = rank;
  }
  const isDraw = new Map();
  for (let i = 0; i < ranked.length; i++){
    const dup = ranked.filter(x => x.rank === ranked[i].rank).length > 1;
    isDraw.set(ranked[i].name, dup);
  }

  const results = [];
  for (const p of ranked){
    /* サレンダーしたラウンドは数えないので、降りてばかりだとEXPは伸びない */
    const scored = Math.min(p.scoredRounds || 0, room.championRounds);
    /* 順位ボーナスは大会をどれだけ戦い抜いたかで按分する */
    const progress = room.championRounds > 0
      ? Math.min(1, scored / room.championRounds) : 0;

    let expGain, rankKind;
    if (p.eliminated){
      expGain = Math.round(scored * perRound * 0.5);
      rankKind = 'lose';
    } else {
      const bonus = Math.round(
        (CHAMPION_RANK_BONUS[Math.min(p.rank, 4)] || 0) * championFactor(total) * progress);
      expGain = Math.round(scored * perRound) + bonus;
      rankKind = p.rank === 1 ? (isDraw.get(p.name) ? 'draw' : 'win') : 'lose';
    }

    let levelUp = 0, userAfter = null;
    if (!p.cpu){
      try {
        const u = await db.findUser(p.name);
        if (u){
          levelUp = applyChampionResult(u, { rankKind, expGain });
          await db.saveUser(u);
          userAfter = publicUser(u);
          p.level = u.level;
        }
      } catch (e){ console.error('[champion]', e.message); }
    }

    results.push({
      name: p.name, cpu: !!p.cpu, rank: p.rank, medal: p.medal,
      eliminated: !!p.eliminated, expGain, rankKind,
      scoredRounds: scored, totalRounds: room.championRounds
    });

    if (p.sid && userAfter) io.to(p.sid).emit('account:update', { user: userAfter, levelUp });
  }

  room.standings = results;
  room.phase = 'champion_end';
  room.message = '大会終了';
  broadcast(io, room);
  broadcastLobby(io);
}

/* =========================================================
   8. HTTP API
   ========================================================= */
const app = express();
app.use(express.json({ limit: '16kb' }));
app.use(express.static(path.join(__dirname), { extensions: ['html'] }));

function authFail(res, msg){ return res.status(401).json({ error: msg }); }

async function currentUser(req){
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : '';
  const name = readToken(token);
  if (!name) return null;
  return await db.findUser(name);
}

/* 最終ログイン時刻を更新する(短時間の連打では書き込まない) */
const TOUCH_INTERVAL_MS = 60 * 1000;
async function touchLogin(u){
  const prev = u.last_login ? new Date(u.last_login).getTime() : 0;
  if (Date.now() - prev < TOUCH_INTERVAL_MS) return;
  u.last_login = new Date();
  await db.saveUser(u);
}

function blankUserRow(username, pass_hash){
  return {
    username, pass_hash, medal: INITIAL_MEDAL, level: 1, exp: 0,
    rounds: 0, wins: 0, losses: 0, pushes: 0, bj: 0,
    champ_plays: 0, champ_wins: 0, champ_losses: 0, champ_draws: 0,
    last_login: null, icon_color: DEFAULT_ICON_COLOR
  };
}

app.post('/api/register', async (req, res) => {
  try {
    const { username, password } = req.body || {};
    if (!NAME_RE.test(username || '')) return res.status(400).json({ error: 'ユーザー名は英数字1〜8文字です' });
    if (!PASS_RE.test(password || '')) return res.status(400).json({ error: 'パスワードは英数字1〜8文字です' });
    if (await db.findUser(username)) return res.status(409).json({ error: 'そのユーザー名は使われています' });

    const row = blankUserRow(username, hashPassword(password));
    row.last_login = new Date();
    await db.createUser(row);
    res.json({ token: makeToken(username), user: publicUser(row) });
  } catch (e){
    console.error('[register]', e);
    res.status(500).json({ error: '登録に失敗しました' });
  }
});

app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body || {};
    const u = await db.findUser(String(username || ''));
    if (!u || !verifyPassword(String(password || ''), u.pass_hash))
      return res.status(401).json({ error: 'ユーザー名かパスワードが違います' });
    u.last_login = new Date();
    await db.saveUser(u);
    res.json({ token: makeToken(u.username), user: publicUser(u) });
  } catch (e){
    console.error('[login]', e);
    res.status(500).json({ error: 'ログインに失敗しました' });
  }
});

app.get('/api/me', async (req, res) => {
  const u = await currentUser(req);
  if (!u) return authFail(res, '認証が必要です');
  /* トークンでの自動ログインでも「最終ログイン」を更新する */
  try { await touchLogin(u); } catch {}
  res.json({ user: publicUser(u) });
});

app.delete('/api/account', async (req, res) => {
  const u = await currentUser(req);
  if (!u) return authFail(res, '認証が必要です');
  const { password } = req.body || {};
  if (!verifyPassword(String(password || ''), u.pass_hash))
    return res.status(401).json({ error: 'パスワードが違います' });
  try {
    await db.deleteUser(u.username);
    res.json({ ok: true });
  } catch (e){
    console.error('[delete]', e);
    res.status(500).json({ error: '削除に失敗しました' });
  }
});

/* シングルプレイの結果反映 */
app.post('/api/result', async (req, res) => {
  const u = await currentUser(req);
  if (!u) return authFail(res, '認証が必要です');

  const bet = Math.floor(Number(req.body?.bet) || 0);
  const payout = Math.floor(Number(req.body?.payout) || 0);
  const kind = String(req.body?.kind || '');
  if (!['win','lose','push','bj','surrender'].includes(kind)) return res.status(400).json({ error: '不正な結果です' });
  if (bet < MIN_BET || bet > u.medal) return res.status(400).json({ error: '不正なベット額です' });
  if (payout < 0 || payout > bet * 3) return res.status(400).json({ error: '不正な配当です' });

  u.medal = u.medal - bet + payout;
  const up = applyEnjoyResult(u, kind);
  await db.saveUser(u);
  res.json({ user: publicUser(u), levelUp: up });
});

/* 広告視聴報酬(v3.0: 300枚 / クールタイム15秒 / 所持500枚以上は受け取り不可) */
const AD_REWARD = 300;
const AD_COOLDOWN_MS = 15000;
const AD_MEDAL_LIMIT = 500;
const adCooldown = new Map();

app.post('/api/ad', async (req, res) => {
  const u = await currentUser(req);
  if (!u) return authFail(res, '認証が必要です');

  if (u.medal >= AD_MEDAL_LIMIT)
    return res.status(403).json({ error: 'メダルを' + AD_MEDAL_LIMIT + '枚以上持っているため受け取れません' });

  const last = adCooldown.get(u.username) || 0;
  const wait = AD_COOLDOWN_MS - (Date.now() - last);
  if (wait > 0)
    return res.status(429).json({ error: 'あと' + Math.ceil(wait / 1000) + '秒お待ちください', waitMs: wait });

  adCooldown.set(u.username, Date.now());
  u.medal += AD_REWARD;
  await db.saveUser(u);
  res.json({ user: publicUser(u), reward: AD_REWARD, cooldownMs: AD_COOLDOWN_MS });
});

/* アカウントアイコンの色を変更(v3.0) */
app.post('/api/icon', async (req, res) => {
  const u = await currentUser(req);
  if (!u) return authFail(res, '認証が必要です');
  const color = String(req.body?.color || '');
  if (!ICON_COLORS.includes(color)) return res.status(400).json({ error: '選択できない色です' });

  u.icon_color = color;
  await db.saveUser(u);

  /* 接続中なら、参加中のルームの表示にも即反映させる */
  for (const [, sock] of io.of('/').sockets){
    if (!sock.data || sock.data.name !== u.username) continue;
    sock.data.iconColor = color;
    const room = findRoomBySid(sock.id);
    if (!room) continue;
    const p = room.players.find(x => x.sid === sock.id);
    if (p){ p.iconColor = color; broadcast(io, room); }
  }

  res.json({ user: publicUser(u) });
});

app.get('/api/health', (req, res) => res.json({ ok: true, db: db.kind, rooms: rooms.size, version: APP_VERSION }));

/* =========================================================
   8.5 開発者モード(管理者API)
   暗証番号はサーバー側でも必ず検証する。
   ADMIN_PIN を環境変数で設定すれば変更可能。
   ========================================================= */
const ADMIN_PIN = process.env.ADMIN_PIN || '0223';

/* 接続中のソケットからログイン中ユーザー名を集める */
function onlineUserNames(){
  const set = new Set();
  for (const [, sock] of io.of('/').sockets){
    if (sock.data && sock.data.name) set.add(sock.data.name);
  }
  return set;
}

function checkAdmin(req, res){
  const pin = String(req.headers['x-admin-pin'] || req.body?.pin || '');
  const a = Buffer.from(pin);
  const b = Buffer.from(ADMIN_PIN);
  const ok = a.length === b.length && crypto.timingSafeEqual(a, b);
  if (!ok){
    res.status(401).json({ error: '暗証番号が違います' });
    return false;
  }
  return true;
}

app.post('/api/admin/auth', (req, res) => {
  if (!checkAdmin(req, res)) return;
  res.json({ ok: true });
});

app.post('/api/admin/users', async (req, res) => {
  if (!checkAdmin(req, res)) return;
  try {
    const rows = await db.listUsers();
    const online = onlineUserNames();
    res.json({
      users: rows.map(u => ({
        username: u.username,
        level: u.level,
        medal: u.medal,
        exp: u.exp,
        rounds: u.rounds,
        champPlays: u.champ_plays,
        lastLogin: u.last_login ? new Date(u.last_login).toISOString() : null,
        online: online.has(u.username)
      }))
    });
  } catch (e){
    console.error('[admin/users]', e);
    res.status(500).json({ error: '一覧の取得に失敗しました' });
  }
});

app.post('/api/admin/medal', async (req, res) => {
  if (!checkAdmin(req, res)) return;
  const username = String(req.body?.username || '');
  const medal = Math.floor(Number(req.body?.medal));
  if (!Number.isFinite(medal) || medal < 0 || medal > 99999999)
    return res.status(400).json({ error: 'メダル数が不正です' });
  try {
    const u = await db.findUser(username);
    if (!u) return res.status(404).json({ error: 'アカウントが見つかりません' });
    u.medal = medal;
    await db.saveUser(u);
    /* オンライン中なら手持ちの表示も更新させる */
    for (const [, sock] of io.of('/').sockets){
      if (sock.data && sock.data.name === username){
        sock.data.medal = medal;
        sock.emit('account:update', { user: publicUser(u), levelUp: 0 });
      }
    }
    res.json({ ok: true, medal });
  } catch (e){
    console.error('[admin/medal]', e);
    res.status(500).json({ error: '更新に失敗しました' });
  }
});

app.post('/api/admin/delete', async (req, res) => {
  if (!checkAdmin(req, res)) return;
  const username = String(req.body?.username || '');
  try {
    const u = await db.findUser(username);
    if (!u) return res.status(404).json({ error: 'アカウントが見つかりません' });
    await db.deleteUser(username);
    /* 接続中なら切断してルームからも退出させる */
    for (const [, sock] of io.of('/').sockets){
      if (sock.data && sock.data.name === username){
        sock.emit('room:error', 'アカウントが削除されました');
        sock.disconnect(true);
      }
    }
    res.json({ ok: true });
  } catch (e){
    console.error('[admin/delete]', e);
    res.status(500).json({ error: '削除に失敗しました' });
  }
});

/* =========================================================
   9. Socket.io
   ========================================================= */
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

io.use(async (socket, next) => {
  const name = readToken(socket.handshake.auth?.token);
  if (!name) return next(new Error('ログインが必要です'));
  const u = await db.findUser(name);
  if (!u) return next(new Error('アカウントが見つかりません'));
  socket.data.name = u.username;
  socket.data.level = u.level;
  socket.data.medal = u.medal;
  socket.data.iconColor = ICON_COLORS.includes(u.icon_color) ? u.icon_color : DEFAULT_ICON_COLOR;
  try { await touchLogin(u); } catch {}
  next();
});

io.on('connection', (socket) => {
  const name = socket.data.name;

  socket.emit('room:list', roomList());

  socket.on('room:list', () => socket.emit('room:list', roomList()));

  socket.on('room:create', async ({ maxPlayers, mode, cpuFill, championRounds } = {}) => {
    if (findRoomBySid(socket.id)) return;
    await refreshSocketUser(socket);
    if (findRoomBySid(socket.id)) return;

    const room = createRoom({ maxPlayers, mode, cpuFill, championRounds });
    room.hostName = name;
    room.players.push(makePlayer(socket));
    socket.join(room.id);
    socket.emit('room:joined', { id: room.id });
    broadcast(io, room);
    broadcastLobby(io);
  });

  socket.on('room:join', async ({ id } = {}) => {
    const room = rooms.get(String(id || '').toUpperCase());
    if (!room) return socket.emit('room:error', 'その部屋は存在しません');
    if (room.phase !== 'lobby') return socket.emit('room:error', 'その部屋はゲーム中です');
    if (humanCount(room) >= room.maxPlayers) return socket.emit('room:error', 'その部屋は満員です');
    if (room.players.some(p => p.name === name)) return socket.emit('room:error', '既に参加しています');
    if (findRoomBySid(socket.id)) return;

    await refreshSocketUser(socket);
    if (findRoomBySid(socket.id)) return;
    if (room.phase !== 'lobby' || humanCount(room) >= room.maxPlayers)
      return socket.emit('room:error', 'その部屋には参加できませんでした');

    room.players.push(makePlayer(socket));
    socket.join(room.id);
    socket.emit('room:joined', { id: room.id });
    chatSystem(io, room, name + ' さんが参加しました');
    broadcast(io, room);
    broadcastLobby(io);
  });

  socket.on('room:leave', () => leaveRoom(socket));

  /* 待機ルームでの「準備完了」トグル(ホストは対象外) */
  socket.on('room:ready', ({ on } = {}) => {
    const room = findRoomBySid(socket.id);
    if (!room || room.phase !== 'lobby') return;
    if (room.hostName === name) return;
    const p = room.players.find(x => x.sid === socket.id);
    if (!p) return;
    p.lobbyReady = !!on;
    chatSystem(io, room, p.name + (p.lobbyReady ? ' さんが準備完了しました' : ' さんが準備を解除しました'));
    broadcast(io, room);
  });

  socket.on('room:cpuFill', ({ on } = {}) => {
    const room = findRoomBySid(socket.id);
    if (!room || room.hostName !== name || room.phase !== 'lobby' || room.mode !== 'enjoy') return;
    if (room.maxPlayers < MIN_HUMANS + 1){
      room.cpuFill = false;
      broadcast(io, room);
      return socket.emit('room:error', '2人部屋ではCPUを補充できません');
    }
    room.cpuFill = !!on;
    broadcast(io, room);
  });

  socket.on('room:start', ({ confirmed } = {}) => {
    const room = findRoomBySid(socket.id);
    if (!room || room.hostName !== name) return;
    if (room.phase !== 'lobby') return;

    /* CPU補充の有無に関わらず、人のプレイヤーが2人以上いないと開始できない */
    if (humanCount(room) < MIN_HUMANS)
      return socket.emit('room:error', '最低' + MIN_HUMANS + '人のプレイヤーの参加が必要です');

    /* ホスト以外の全員が準備完了になるまで開始できない */
    if (!guestsReady(room))
      return socket.emit('room:error', '全員の準備完了を待っています');

    /* 定員に満たない場合はクライアント側の確認を経てから開始する */
    if (humanCount(room) < room.maxPlayers && !confirmed)
      return socket.emit('room:confirmStart', {
        humans: humanCount(room),
        max: room.maxPlayers
      });

    removeCpuSeats(room);
    if (room.mode === 'enjoy' && room.cpuFill) fillCpuSeats(room);

    beginCountdown(io, room);
  });

  socket.on('game:bet', async ({ amount } = {}) => {
    const room = findRoomBySid(socket.id);
    if (!room || room.phase !== 'bet') return;
    const p = room.players.find(x => x.sid === socket.id);
    if (!p || p.ready) return;

    const bet = Math.floor(Number(amount) || 0);
    if (bet < MIN_BET) return socket.emit('room:error', 'ベット額が不正です');

    if (room.mode === 'champion'){
      if (bet > p.medal) return socket.emit('room:error', '大会用メダルが足りません');
      /* 全額ベット判定(チャンピオンモードのボーナス対象) */
      p.allIn = bet === p.medal;
      p.bet = bet; p.ready = true; p.medal -= bet;
      room.message = room.players.filter(x => x.ready).length + '/' + room.players.length + ' 人がベット済み';
      return broadcast(io, room);
    }

    /* エンジョイモード: DBを正として判定 */
    let u;
    try { u = await db.findUser(p.name); }
    catch (e){ console.error('[bet]', e.message); return socket.emit('room:error', '通信に失敗しました'); }
    if (!u) return socket.emit('room:error', 'アカウントが見つかりません');

    if (bet > u.medal){
      p.medal = u.medal;
      broadcast(io, room);
      socket.emit('account:update', { user: publicUser(u), levelUp: 0 });
      return socket.emit('room:error', 'メダルが足りません');
    }
    if (p.ready) return;

    const wasAllIn = bet === u.medal;
    u.medal -= bet;
    try { await db.saveUser(u); }
    catch (e){ console.error('[bet]', e.message); return socket.emit('room:error', '通信に失敗しました'); }

    p.allIn = wasAllIn;
    p.bet = bet; p.ready = true; p.medal = u.medal; p.level = u.level;
    socket.emit('account:update', { user: publicUser(u), levelUp: 0 });

    room.message = room.players.filter(x => x.ready).length + '/' + room.players.length + ' 人がベット済み';
    broadcast(io, room);
  });

  socket.on('game:deal', () => {
    const room = findRoomBySid(socket.id);
    if (!room || room.hostName !== name || room.phase !== 'bet') return;
    if (!room.players.every(p => p.ready)) return socket.emit('room:error', '全員のベットを待っています');
    dealRound(io, room);
    broadcast(io, room);
  });

  socket.on('game:hit', () => {
    const room = findRoomBySid(socket.id);
    if (!room || room.phase !== 'play') return;
    const p = room.players[room.activeIndex];
    if (!p || p.sid !== socket.id || p.done) return;
    p.hand.push(room.shoe.pop());
    const v = handValue(p.hand);
    if (v.bust || v.total === 21){
      p.done = true;
      room.message = p.name + (v.bust ? ' さんがバースト' : ' さんが21');
      return nextTurn(io, room);
    }
    broadcast(io, room);
  });

  socket.on('game:stand', () => {
    const room = findRoomBySid(socket.id);
    if (!room || room.phase !== 'play') return;
    const p = room.players[room.activeIndex];
    if (!p || p.sid !== socket.id || p.done) return;
    p.done = true;
    nextTurn(io, room);
  });

  /* ダブルダウン: 最初の2枚のときだけ有効。
     ベットを倍にして1枚だけ引き、そのままSTAND扱いにする(v3.0) */
  socket.on('game:double', async () => {
    const room = findRoomBySid(socket.id);
    if (!room || room.phase !== 'play') return;
    const p = room.players[room.activeIndex];
    if (!p || p.sid !== socket.id || p.done) return;
    if (p.hand.length !== 2 || p.doubled || p.surrendered) return;
    if (isBlackjack(p.hand)) return socket.emit('room:error', 'ブラックジャックはダブルダウンできません');

    const extra = p.bet;
    if (extra <= 0) return;

    if (room.mode === 'champion'){
      if (p.medal < extra) return socket.emit('room:error', '大会用メダルが足りません');
      p.medal -= extra;
    } else {
      let u;
      try { u = await db.findUser(p.name); }
      catch (e){ console.error('[double]', e.message); return socket.emit('room:error', '通信に失敗しました'); }
      if (!u) return socket.emit('room:error', 'アカウントが見つかりません');
      if (u.medal < extra){
        p.medal = u.medal;
        broadcast(io, room);
        socket.emit('account:update', { user: publicUser(u), levelUp: 0 });
        return socket.emit('room:error', 'メダルが足りません');
      }
      /* 待っている間に手番が移っていないか再確認する */
      if (room.phase !== 'play' || room.players[room.activeIndex] !== p || p.done) return;
      u.medal -= extra;
      try { await db.saveUser(u); }
      catch (e){ console.error('[double]', e.message); return socket.emit('room:error', '通信に失敗しました'); }
      p.medal = u.medal;
      socket.emit('account:update', { user: publicUser(u), levelUp: 0 });
    }

    p.bet += extra;
    p.doubled = true;
    /* 追加ベットで手持ちを使い切ったら、これも全額ベット扱いにする */
    p.allIn = p.medal <= 0;

    p.hand.push(room.shoe.pop());
    p.done = true;
    const v = handValue(p.hand);
    room.message = p.name + ' さんがダブルダウン' + (v.bust ? ' → バースト' : ' (' + v.total + ')');
    nextTurn(io, room);
  });

  /* BLACKJACK宣言: 最初の2枚で21のときだけ有効(結果はサレンダー同様サーバーが判定) */
  socket.on('game:blackjack', () => {
    const room = findRoomBySid(socket.id);
    if (!room || room.phase !== 'play') return;
    const p = room.players[room.activeIndex];
    if (!p || p.sid !== socket.id || p.done || !isBlackjack(p.hand)) return;
    p.done = true;
    room.message = p.name + ' さんがブラックジャックを宣言!';
    nextTurn(io, room);
  });

  /* サレンダー: 最初の2枚(まだ1枚も引いていない)の時だけ有効 */
  socket.on('game:surrender', () => {
    const room = findRoomBySid(socket.id);
    if (!room || room.phase !== 'play') return;
    const p = room.players[room.activeIndex];
    if (!p || p.sid !== socket.id || p.done || p.hand.length !== 2) return;
    p.surrendered = true;
    p.done = true;
    room.message = p.name + ' さんがサレンダー';
    nextTurn(io, room);
  });

  socket.on('game:next', () => {
    const room = findRoomBySid(socket.id);
    if (!room || room.hostName !== name) return;
    if (room.phase === 'result'){
      resetRound(room);
      broadcast(io, room);
    } else if (room.phase === 'champion_end'){
      room.phase = 'lobby';
      room.standings = null;
      room.players.forEach(p => {
        p.eliminated = false; p.medal = 0; p.ready = false;
        p.lobbyReady = false; p.scoredRounds = 0;
      });
      broadcast(io, room);
      broadcastLobby(io);
    }
  });

  /* 大会を退出(観戦中でも可)。以降の経験値は加算されない */
  socket.on('room:leaveChampionship', () => leaveRoom(socket));

  /* チャット(待機ルーム・ゲーム中どちらでも使用可) */
  socket.on('chat:send', ({ text, stamp } = {}) => {
    const room = findRoomBySid(socket.id);
    if (!room) return;

    const now = Date.now();
    const last = socket.data.lastChat || 0;
    if (now - last < 350) return;                 // 連投防止
    socket.data.lastChat = now;

    let body, kind;
    if (stamp){
      if (!CHAT_STAMPS.includes(String(stamp))) return;
      body = String(stamp); kind = 'stamp';
    } else {
      body = String(text || '').replace(/\s+/g, ' ').trim().slice(0, 60);
      if (!body) return;
      kind = 'text';
    }

    const msg = { from: name, body, kind, at: now };
    for (const p of room.players){
      if (p.sid) io.to(p.sid).emit('chat:new', msg);
    }
  });

  /* 広告視聴などでDB側のメダルが変わったときに読み直す */
  socket.on('player:sync', async () => {
    let u;
    try { u = await db.findUser(name); } catch { return; }
    if (!u) return;
    socket.data.medal = u.medal;
    socket.data.level = u.level;
    socket.data.iconColor = ICON_COLORS.includes(u.icon_color) ? u.icon_color : DEFAULT_ICON_COLOR;
    socket.emit('account:update', { user: publicUser(u), levelUp: 0 });

    const room = findRoomBySid(socket.id);
    if (!room) return;
    const p = room.players.find(x => x.sid === socket.id);
    if (p) p.iconColor = socket.data.iconColor;
    if (p && !p.ready && room.mode === 'enjoy'){ p.medal = u.medal; p.level = u.level; }
    broadcast(io, room);
  });

  socket.on('disconnect', async () => {
    leaveRoom(socket);
    /* 切断した瞬間を最終ログインとして残す(次に見たとき「◯分前」が正しくなる) */
    try {
      const u = await db.findUser(name);
      if (u){ u.last_login = new Date(); await db.saveUser(u); }
    } catch {}
  });
});

/* 接続時のスナップショットではなくDBの最新値をsocketに載せ直す */
async function refreshSocketUser(socket){
  try {
    const u = await db.findUser(socket.data.name);
    if (!u) return;
    socket.data.medal = u.medal;
    socket.data.level = u.level;
    socket.data.iconColor = ICON_COLORS.includes(u.icon_color) ? u.icon_color : DEFAULT_ICON_COLOR;
  } catch (e){ console.error('[refresh]', e.message); }
}

function makePlayer(socket){
  return {
    name: socket.data.name,
    sid: socket.id,
    cpu: false,
    level: socket.data.level,
    medal: socket.data.medal,
    iconColor: socket.data.iconColor || DEFAULT_ICON_COLOR,
    bet: 0, hand: [], done: false, surrendered: false, ready: false,
    doubled: false, allIn: false, streak: 0,
    lobbyReady: false,
    result: null, connected: true, eliminated: false, eliminatedAtRound: null
  };
}

function leaveRoom(socket){
  const room = findRoomBySid(socket.id);
  if (!room) return;
  const idx = room.players.findIndex(p => p.sid === socket.id);
  if (idx < 0) return;
  const left = room.players[idx];
  const wasHost = room.hostName === left.name;
  room.players.splice(idx, 1);
  socket.leave(room.id);

  const remainingHumans = room.players.filter(p => !p.cpu);
  if (remainingHumans.length === 0){ destroyRoom(room); return broadcastLobby(io); }

  /* ホストが抜けたらルームごと解散し、残りの全員を退出させる */
  if (wasHost){
    for (const p of room.players){
      if (!p.sid) continue;
      io.to(p.sid).emit('room:closed', {
        reason: 'ホストが退出したため、このルームは解散されました'
      });
      const s = io.sockets.sockets.get(p.sid);
      if (s) s.leave(room.id);
    }
    destroyRoom(room);
    return broadcastLobby(io);
  }

  chatSystem(io, room, left.name + ' さんが退出しました');

  if (room.phase === 'play'){
    if (idx < room.activeIndex) room.activeIndex--;
    else if (idx === room.activeIndex){ room.activeIndex--; nextTurn(io, room); }
  }

  broadcast(io, room);
  broadcastLobby(io);
}

/* =========================================================
   10. 起動
   ========================================================= */
db.init()
  .then(() => server.listen(PORT, () => console.log('[server] v' + APP_VERSION + ' listening on ' + PORT)))
  .catch((e) => { console.error('[db] 初期化に失敗:', e); process.exit(1); });
