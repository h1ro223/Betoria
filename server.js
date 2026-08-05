/* =========================================================
   BLACKJACK 4 - server.js
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

/* =========================================================
   1. データベース層(PostgreSQL / メモリ フォールバック)
   ========================================================= */
const INITIAL_MEDAL = 1000;

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
      async saveUser(row){ users.set(row.username, row); return row; }
    };
  }

  /* ---- PostgreSQL実装 ---- */
  const { Pool } = require('pg');
  const pool = new Pool({
    connectionString: url,
    ssl: { rejectUnauthorized: false },
    max: 5
  });

  const COLS = 'username, pass_hash, medal, level, exp, rounds, wins, losses, pushes, bj';

  return {
    kind: 'postgres',
    async init(){
      await pool.query(`
        CREATE TABLE IF NOT EXISTS users(
          username   TEXT PRIMARY KEY,
          pass_hash  TEXT NOT NULL,
          medal      INTEGER NOT NULL DEFAULT ${INITIAL_MEDAL},
          level      INTEGER NOT NULL DEFAULT 1,
          exp        INTEGER NOT NULL DEFAULT 0,
          rounds     INTEGER NOT NULL DEFAULT 0,
          wins       INTEGER NOT NULL DEFAULT 0,
          losses     INTEGER NOT NULL DEFAULT 0,
          pushes     INTEGER NOT NULL DEFAULT 0,
          bj         INTEGER NOT NULL DEFAULT 0,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )`);
      console.log('[db] PostgreSQL 接続OK');
    },
    async findUser(name){
      const r = await pool.query(`SELECT ${COLS} FROM users WHERE username=$1`, [name]);
      return r.rows[0] || null;
    },
    async createUser(row){
      await pool.query(
        `INSERT INTO users(${COLS}) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [row.username, row.pass_hash, row.medal, row.level, row.exp,
         row.rounds, row.wins, row.losses, row.pushes, row.bj]);
      return row;
    },
    async saveUser(row){
      await pool.query(
        `UPDATE users SET medal=$2, level=$3, exp=$4, rounds=$5,
         wins=$6, losses=$7, pushes=$8, bj=$9 WHERE username=$1`,
        [row.username, row.medal, row.level, row.exp,
         row.rounds, row.wins, row.losses, row.pushes, row.bj]);
      return row;
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
const MAX_LEVEL = 99;

function expToNext(level){ return 100 + (level - 1) * 50; }

function addExp(user, gain){
  user.exp += gain;
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
  if (kind === 'bj')   return EXP_ROUND + EXP_BJ;
  if (kind === 'win')  return EXP_ROUND + EXP_WIN;
  if (kind === 'push') return EXP_ROUND + EXP_PUSH;
  return EXP_ROUND + EXP_LOSE;
}

function applyResult(user, kind){
  user.rounds++;
  if (kind === 'bj'){ user.wins++; user.bj++; }
  else if (kind === 'win')  user.wins++;
  else if (kind === 'push') user.pushes++;
  else user.losses++;
  return addExp(user, expForResult(kind));
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
    bj: u.bj
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
const TURN_LIMIT_MS = 30000;

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

function createRoom(maxPlayers){
  const room = {
    id: makeRoomId(),
    maxPlayers: Math.min(Math.max(Number(maxPlayers) || 4, 2), 4),
    hostName: null,
    players: [],            // {name, sid, level, bet, hand, done, result, ready}
    phase: 'lobby',         // lobby | bet | play | dealer | result
    dealer: { hand: [], hole: true },
    shoe: buildShoe(),
    activeIndex: -1,
    turnTimer: null,
    message: '',
    round: 0
  };
  rooms.set(room.id, room);
  return room;
}

function destroyRoom(room){
  if (room.turnTimer) clearTimeout(room.turnTimer);
  rooms.delete(room.id);
}

function roomList(){
  const out = [];
  for (const r of rooms.values()){
    if (r.phase !== 'lobby') continue;
    if (r.players.length === 0 || r.players.length >= r.maxPlayers) continue;
    out.push({ id: r.id, count: r.players.length, max: r.maxPlayers, host: r.hostName });
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

function findRoomBySid(sid){
  for (const r of rooms.values())
    if (r.players.some(p => p.sid === sid)) return r;
  return null;
}

/* 手札は自分以外にも見せる(ブラックジャックは公開情報) */
function roomState(room, forName){
  const dealerHand = room.dealer.hand.map((c, i) =>
    (room.dealer.hole && i === 1) ? null : c);

  return {
    id: room.id,
    phase: room.phase,
    maxPlayers: room.maxPlayers,
    hostName: room.hostName,
    isHost: forName === room.hostName,
    round: room.round,
    message: room.message,
    activeName: room.activeIndex >= 0 && room.players[room.activeIndex]
      ? room.players[room.activeIndex].name : null,
    dealer: { hand: dealerHand, hole: room.dealer.hole },
    players: room.players.map(p => ({
      name: p.name,
      level: p.level,
      medal: p.medal,
      bet: p.bet,
      hand: p.hand,
      done: p.done,
      ready: p.ready,
      result: p.result,
      connected: p.connected,
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

/* =========================================================
   6. ゲーム進行(サーバー権威)
   ========================================================= */
function resetRound(room){
  room.dealer = { hand: [], hole: true };
  room.activeIndex = -1;
  room.phase = 'bet';
  room.message = 'ベット額を決めてください';
  for (const p of room.players){
    p.bet = 0; p.hand = []; p.done = false; p.result = null; p.ready = false;
  }
  if (room.shoe.length < DECK_COUNT * 52 * 0.25) room.shoe = buildShoe();
}

function dealRound(io, room){
  room.round++;
  room.phase = 'play';
  room.dealer = { hand: [], hole: true };

  for (let i = 0; i < 2; i++){
    for (const p of room.players) p.hand.push(room.shoe.pop());
    room.dealer.hand.push(room.shoe.pop());
  }

  for (const p of room.players) if (isBlackjack(p.hand)) p.done = true;

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
  room.message = room.players[i].name + ' さんのターン';
  broadcast(io, room);

  room.turnTimer = setTimeout(() => {
    const p = room.players[room.activeIndex];
    if (p && !p.done){
      p.done = true;
      room.message = p.name + ' さんは時間切れでスタンド';
      nextTurn(io, room);
    }
  }, TURN_LIMIT_MS);
}

function dealerTurn(io, room){
  room.phase = 'dealer';
  room.dealer.hole = false;
  const alive = room.players.some(p => p.bet > 0 && !handValue(p.hand).bust);
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
  room.phase = 'result';
  room.dealer.hole = false;

  const dv = handValue(room.dealer.hand);
  const dbj = isBlackjack(room.dealer.hand);

  for (const p of room.players){
    if (p.bet <= 0){ p.result = null; continue; }
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

    p.result = { kind, label, payout, net: payout - p.bet };

    try {
      const u = await db.findUser(p.name);
      if (u){
        u.medal += payout;
        const up = applyResult(u, kind);
        await db.saveUser(u);
        p.medal = u.medal;
        p.level = u.level;
        if (p.sid) io.to(p.sid).emit('account:update', { user: publicUser(u), levelUp: up });
      }
    } catch (e){ console.error('[result]', e.message); }
  }

  room.message = 'ラウンド終了';
  broadcast(io, room);
}

/* =========================================================
   7. HTTP API
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

app.post('/api/register', async (req, res) => {
  try {
    const { username, password } = req.body || {};
    if (!NAME_RE.test(username || '')) return res.status(400).json({ error: 'ユーザー名は英数字1〜8文字です' });
    if (!PASS_RE.test(password || '')) return res.status(400).json({ error: 'パスワードは英数字1〜8文字です' });
    if (await db.findUser(username)) return res.status(409).json({ error: 'そのユーザー名は使われています' });

    const row = {
      username, pass_hash: hashPassword(password),
      medal: INITIAL_MEDAL, level: 1, exp: 0,
      rounds: 0, wins: 0, losses: 0, pushes: 0, bj: 0
    };
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
    res.json({ token: makeToken(u.username), user: publicUser(u) });
  } catch (e){
    console.error('[login]', e);
    res.status(500).json({ error: 'ログインに失敗しました' });
  }
});

app.get('/api/me', async (req, res) => {
  const u = await currentUser(req);
  if (!u) return authFail(res, '認証が必要です');
  res.json({ user: publicUser(u) });
});

/* シングルプレイの結果反映 */
app.post('/api/result', async (req, res) => {
  const u = await currentUser(req);
  if (!u) return authFail(res, '認証が必要です');

  const bet = Math.floor(Number(req.body?.bet) || 0);
  const payout = Math.floor(Number(req.body?.payout) || 0);
  const kind = String(req.body?.kind || '');
  if (!['win','lose','push','bj'].includes(kind)) return res.status(400).json({ error: '不正な結果です' });
  if (bet < MIN_BET || bet > u.medal + bet) return res.status(400).json({ error: '不正なベット額です' });
  if (payout < 0 || payout > bet * 3) return res.status(400).json({ error: '不正な配当です' });

  u.medal = u.medal - bet + payout;
  const up = applyResult(u, kind);
  await db.saveUser(u);
  res.json({ user: publicUser(u), levelUp: up });
});

/* 広告視聴報酬 */
const adCooldown = new Map();
app.post('/api/ad', async (req, res) => {
  const u = await currentUser(req);
  if (!u) return authFail(res, '認証が必要です');
  const last = adCooldown.get(u.username) || 0;
  if (Date.now() - last < 4000) return res.status(429).json({ error: '少し時間をおいてください' });
  adCooldown.set(u.username, Date.now());
  u.medal += 100;
  await db.saveUser(u);
  res.json({ user: publicUser(u) });
});

app.get('/api/health', (req, res) => res.json({ ok: true, db: db.kind, rooms: rooms.size }));

/* =========================================================
   8. Socket.io
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
  next();
});

io.on('connection', (socket) => {
  const name = socket.data.name;

  socket.emit('room:list', roomList());

  socket.on('room:list', () => socket.emit('room:list', roomList()));

  socket.on('room:create', async ({ maxPlayers } = {}) => {
    if (findRoomBySid(socket.id)) return;
    await refreshSocketUser(socket);
    if (findRoomBySid(socket.id)) return;
    const room = createRoom(maxPlayers);
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
    if (room.players.length >= room.maxPlayers) return socket.emit('room:error', 'その部屋は満員です');
    if (room.players.some(p => p.name === name)) return socket.emit('room:error', '既に参加しています');
    if (findRoomBySid(socket.id)) return;

    await refreshSocketUser(socket);
    if (findRoomBySid(socket.id)) return;
    if (room.phase !== 'lobby' || room.players.length >= room.maxPlayers)
      return socket.emit('room:error', 'その部屋には参加できませんでした');

    room.players.push(makePlayer(socket));
    socket.join(room.id);
    socket.emit('room:joined', { id: room.id });
    broadcast(io, room);
    broadcastLobby(io);
  });

  socket.on('room:leave', () => leaveRoom(socket));

  socket.on('room:start', () => {
    const room = findRoomBySid(socket.id);
    if (!room || room.hostName !== name) return;
    if (room.phase !== 'lobby') return;
    if (room.players.length < 1) return;
    resetRound(room);
    broadcast(io, room);
    broadcastLobby(io);
  });

  socket.on('game:bet', async ({ amount } = {}) => {
    const room = findRoomBySid(socket.id);
    if (!room || room.phase !== 'bet') return;
    const p = room.players.find(x => x.sid === socket.id);
    if (!p || p.ready) return;

    const bet = Math.floor(Number(amount) || 0);
    if (bet < MIN_BET) return socket.emit('room:error', 'ベット額が不正です');

    /* ルーム内のメダルは古い可能性があるのでDBを正として判定する
       (広告視聴などで途中増減しても正しく処理できる) */
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
    if (p.ready) return;   // 待っている間に確定済みになっていないか再確認

    u.medal -= bet;
    try { await db.saveUser(u); }
    catch (e){ console.error('[bet]', e.message); return socket.emit('room:error', '通信に失敗しました'); }

    p.bet = bet;
    p.ready = true;
    p.medal = u.medal;
    p.level = u.level;
    socket.emit('account:update', { user: publicUser(u), levelUp: 0 });

    room.message = room.players.filter(x => x.ready).length + '/' + room.players.length + ' 人がベット済み';
    broadcast(io, room);
  });

  /* 広告視聴などでDB側のメダルが変わったときに読み直す */
  socket.on('player:sync', async () => {
    let u;
    try { u = await db.findUser(name); } catch { return; }
    if (!u) return;
    socket.data.medal = u.medal;
    socket.data.level = u.level;
    socket.emit('account:update', { user: publicUser(u), levelUp: 0 });

    const room = findRoomBySid(socket.id);
    if (!room) return;
    const p = room.players.find(x => x.sid === socket.id);
    if (p && !p.ready){ p.medal = u.medal; p.level = u.level; }
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

  socket.on('game:next', () => {
    const room = findRoomBySid(socket.id);
    if (!room || room.hostName !== name || room.phase !== 'result') return;
    resetRound(room);
    broadcast(io, room);
  });

  socket.on('disconnect', () => leaveRoom(socket));
});

/* 接続時のスナップショットではなくDBの最新値をsocketに載せ直す */
async function refreshSocketUser(socket){
  try {
    const u = await db.findUser(socket.data.name);
    if (!u) return;
    socket.data.medal = u.medal;
    socket.data.level = u.level;
  } catch (e){ console.error('[refresh]', e.message); }
}

function makePlayer(socket){
  return {
    name: socket.data.name,
    sid: socket.id,
    level: socket.data.level,
    medal: socket.data.medal,
    bet: 0, hand: [], done: false, ready: false,
    result: null, connected: true
  };
}

function leaveRoom(socket){
  const room = findRoomBySid(socket.id);
  if (!room) return;
  const idx = room.players.findIndex(p => p.sid === socket.id);
  if (idx < 0) return;
  const left = room.players[idx];
  room.players.splice(idx, 1);
  socket.leave(room.id);

  if (room.players.length === 0){ destroyRoom(room); return broadcastLobby(io); }

  if (room.hostName === left.name){
    room.hostName = room.players[0].name;
    room.message = 'ホストが退出したため ' + room.hostName + ' さんがホストになりました';
  }

  if (room.phase === 'play'){
    if (idx < room.activeIndex) room.activeIndex--;
    else if (idx === room.activeIndex){ room.activeIndex--; nextTurn(io, room); }
  }

  broadcast(io, room);
  broadcastLobby(io);
}

/* =========================================================
   9. 起動
   ========================================================= */
db.init()
  .then(() => server.listen(PORT, () => console.log('[server] listening on ' + PORT)))
  .catch((e) => { console.error('[db] 初期化に失敗:', e); process.exit(1); });
