/* =========================================================
   Betoria - server.js  (v6.0)
   made by hiro/ヒロ   https://github.com/h1ro223
   無料で遊べるオンラインカジノ
     ・BLACKJACK 4(ブラックジャック)
     ・MARBLE RACE(マーブルレース)  ← v4.1 で追加
     ・SLOT(スロット / アイムジャグラーEX 6号機準拠)  ← v5.0 で追加
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
const APP_VERSION = '6.0.0';

/* =========================================================
   1. データベース層(PostgreSQL / メモリ フォールバック)
   ========================================================= */
const INITIAL_MEDAL = 1000;

/* =========================================================
   日付まわり(v3.2)
   ランキングとログインボーナスの区切りは JST の 0:00。
   Render は UTC で動くので、必ずこのユーティリティを通すこと。
   ========================================================= */
const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

/* 'YYYY-MM-DD' 形式のJST日付を返す */
function jstDateKey(d){
  const t = (d ? new Date(d) : new Date()).getTime();
  return new Date(t + JST_OFFSET_MS).toISOString().slice(0, 10);
}

/* JSTの日付キーを n 日ずらす */
function shiftDateKey(key, days){
  const t = Date.parse(key + 'T00:00:00Z') + days * 86400000;
  return new Date(t).toISOString().slice(0, 10);
}

/* 次に JST 0:00 を迎えるまでのミリ秒 */
function msUntilNextJstMidnight(){
  const now = Date.now() + JST_OFFSET_MS;
  const next = Math.floor(now / 86400000) * 86400000 + 86400000;
  return next - now;
}

/* 表示用 'M/D' */
function shortDate(key){
  const [, m, d] = key.split('-');
  return Number(m) + '/' + Number(d);
}

/* =========================================================
   ゲームの種類(v4.0)
   Betoria は複数のトランプゲームを扱うサイトになったため、
   「どのゲームの記録か」を必ず持ち歩く。
   ランキングはゲームごとに完全に分ける(本人の希望)。
   ========================================================= */
const GAMES = ['bj', 'marble', 'slot'];
const DEFAULT_GAME = 'bj';
function normGame(g){ return GAMES.includes(g) ? g : DEFAULT_GAME; }

/* ランキング集計に使う users テーブルの列名。
   ゲームを増やすときはここに1ブロック足して、
   DB層のマイグレーション(ALTER TABLE)にも同じ列を足すこと。 */
const RANK_FIELDS = {
  bj: {
    total: 'total_gain', best: 'best_gain', bestAt: 'best_gain_at',
    dayKey: 'day_key', dayGain: 'day_gain', dayBest: 'day_best'
  },
  marble: {
    total: 'mr_total_gain', best: 'mr_best_gain', bestAt: 'mr_best_gain_at',
    dayKey: 'mr_day_key', dayGain: 'mr_day_gain', dayBest: 'mr_day_best'
  },
  slot: {
    total: 'sl_total_gain', best: 'sl_best_gain', bestAt: 'sl_best_gain_at',
    dayKey: 'sl_day_key', dayGain: 'sl_day_gain', dayBest: 'sl_day_best'
  }
};
/* サイトのオーナー(開発者)のアカウント名。
   この名前だけ、画面上で👑つきの金色で表示される(v4.6) */
const OWNER_NAME = process.env.OWNER_NAME || 'hiro';

const GAME_LABEL = {
  bj: 'ブラックジャック', marble: 'マーブルレース', slot: 'スロット'
};

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
    const friends = new Map();   // 'a|b'(a<b) -> {user_a, user_b, status, requester}
    const notices = [];          // {id, username, kind, title, body, is_read, created_at}
    const ranks = new Map();     // 'game|dateKey' -> Map(username -> row)(v4.0)
    let noticeId = 1;
    let lastSettled = null;
    const fkey = (a, b) => (a < b ? a + '|' + b : b + '|' + a);
    return {
      kind: 'memory',
      async init(){},
      async findUser(name){ return users.get(name) || null; },
      async createUser(row){ users.set(row.username, row); return row; },
      async saveUser(row){ users.set(row.username, row); return row; },
      async deleteUser(name){
        for (const [k, r] of [...friends]){
          if (r.user_a === name || r.user_b === name) friends.delete(k);
        }
        for (let i = notices.length - 1; i >= 0; i--)
          if (notices[i].username === name) notices.splice(i, 1);
        for (const m of ranks.values()) m.delete(name);
        return users.delete(name);
      },
      async listUsers(){
        return [...users.values()].sort((a, b) =>
          String(a.username).localeCompare(String(b.username)));
      },
      /* ---- フレンド(v3.0) ---- */
      async findLink(a, b){ return friends.get(fkey(a, b)) || null; },
      async saveLink(row){ friends.set(fkey(row.user_a, row.user_b), row); return row; },
      async deleteLink(a, b){ return friends.delete(fkey(a, b)); },
      async listLinks(name){
        return [...friends.values()].filter(r => r.user_a === name || r.user_b === name);
      },
      /* ---- 通知(v3.2) ---- */
      async addNotice(n){
        notices.push({
          id: noticeId++, username: n.username, kind: n.kind,
          title: n.title, body: n.body || '', is_read: false, created_at: new Date()
        });
      },
      async listNotices(name, limit){
        return notices.filter(n => n.username === name)
          .sort((a, b) => b.id - a.id).slice(0, limit)
          .map(n => Object.assign({}, n));
      },
      async countUnread(name){
        return notices.filter(n => n.username === name && !n.is_read).length;
      },
      async markNoticesRead(name){
        for (const n of notices) if (n.username === name) n.is_read = true;
      },
      async clearNotices(name){
        for (let i = notices.length - 1; i >= 0; i--)
          if (notices[i].username === name) notices.splice(i, 1);
      },
      async trimNotices(name, keep){
        const mine = notices.filter(n => n.username === name).sort((a, b) => b.id - a.id);
        for (const n of mine.slice(keep)){
          const i = notices.indexOf(n);
          if (i >= 0) notices.splice(i, 1);
        }
      },
      /* ---- ランキング(v3.2 / v4.0でゲーム別化) ---- */
      async lastSettled(){ return lastSettled; },
      async setLastSettled(key){ lastSettled = key; },
      async usersWithDay(key, game){
        const F = RANK_FIELDS[normGame(game)];
        return [...users.values()]
          .filter(u => u[F.dayKey] === key && ((u[F.dayGain] || 0) > 0 || (u[F.dayBest] || 0) > 0))
          .map(u => ({
            username: u.username, level: u.level,
            icon_color: u.icon_color, day_gain: u[F.dayGain] || 0, day_best: u[F.dayBest] || 0
          }));
      },
      async saveDailyRanks(key, game, rows){
        const k = normGame(game) + '|' + key;
        if (!ranks.has(k)) ranks.set(k, new Map());
        const m = ranks.get(k);
        for (const x of rows){
          m.set(x.username, {
            username: x.username, level: x.level, icon_color: x.icon_color,
            total_gain: x.day_gain, best_gain: x.day_best
          });
        }
      },
      async getDailyRanks(key, game){
        const k = normGame(game) + '|' + key;
        return ranks.has(k) ? [...ranks.get(k).values()] : [];
      },
      async purgeDailyRanks(before){
        /* キーは 'game|YYYY-MM-DD' なので、日付部分だけを見て判定する */
        for (const k of [...ranks.keys()]){
          const date = k.split('|')[1] || '';
          if (date < before) ranks.delete(k);
        }
      },
      async topAllTimeBest(game, limit){
        const F = RANK_FIELDS[normGame(game)];
        return [...users.values()]
          .filter(u => (u[F.best] || 0) > 0)
          .sort((a, b) => ((b[F.best] || 0) - (a[F.best] || 0)) ||
                          String(a.username).localeCompare(String(b.username)))
          .slice(0, limit)
          .map(u => ({
            username: u.username, level: u.level, icon_color: u.icon_color,
            best_gain: u[F.best] || 0, best_gain_at: u[F.bestAt] || null
          }));
      },
      async liveDay(key, game, limit){
        const F = RANK_FIELDS[normGame(game)];
        return [...users.values()]
          .filter(u => u[F.dayKey] === key && ((u[F.dayGain] || 0) > 0 || (u[F.dayBest] || 0) > 0))
          .slice(0, limit)
          .map(u => ({
            username: u.username, level: u.level, icon_color: u.icon_color,
            day_gain: u[F.dayGain] || 0, day_best: u[F.dayBest] || 0
          }));
      }
    };
  }

  /* ---- PostgreSQL実装 ---- */
  const { Pool, types } = require('pg');

  /* v3.2 修正: pg は BIGINT(OID 20) を「数値の精度が落ちないように」
     既定で文字列として返す。そのまま加算すると
     "500" + 150 → "500150" と文字列連結になり、
     ランキングの数値が桁違いに壊れる。
     このゲームで扱う桁ではNumberで安全に表せるので数値に変換しておく。
     ついでに NUMERIC(OID 1700) も数値にしておく。 */
  types.setTypeParser(20, (v) => (v === null ? null : Number(v)));
  types.setTypeParser(1700, (v) => (v === null ? null : Number(v)));

  const pool = new Pool({
    connectionString: url,
    ssl: { rejectUnauthorized: false },
    max: 5,
    /* 長時間放置された接続はDB側から切られることがあるので、
       こちらから先に片付けて作り直す(v3.2 修正) */
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
    keepAlive: true
  });

  /* これが無いと、待機中の接続でエラーが起きたときに
     Node.jsのプロセスごと落ちる(pgの仕様)。
     Renderの無料プランは寝て起きてを繰り返すため、
     アイドル接続が切られる場面が多く、実際にクラッシュしていた。 */
  pool.on('error', (e) => {
    console.error('[db] プール接続でエラー(処理は継続します):', e.message);
  });

  const COLS = 'username, pass_hash, medal, level, exp, rounds, wins, losses, pushes, bj, ' +
               'champ_plays, champ_wins, champ_losses, champ_draws, last_login, icon_color, ' +
               'total_gain, best_gain, best_gain_at, day_key, day_gain, day_best, ' +
               'bonus_date, bonus_ad_date, login_streak, login_days, created_at, ' +
               /* マーブルレース(v4.1) */
               'mr_total_gain, mr_best_gain, mr_best_gain_at, mr_day_key, mr_day_gain, mr_day_best, ' +
               'mr_races, mr_hits, mr_misses, ' +
               /* スロット(v5.0) */
               'sl_total_gain, sl_best_gain, sl_best_gain_at, sl_day_key, sl_day_gain, sl_day_best, ' +
               'sl_games, sl_bb, sl_rb, ' +
               /* 同時ログイン制限(v4.2) */
               'session_id';

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
      /* フレンド関係(v3.0)。user_a < user_b になるよう常に並べて1行で持つ */
      await pool.query(`
        CREATE TABLE IF NOT EXISTS friends(
          user_a     TEXT NOT NULL,
          user_b     TEXT NOT NULL,
          status     TEXT NOT NULL DEFAULT 'pending',
          requester  TEXT NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          PRIMARY KEY(user_a, user_b)
        )`);
      await pool.query(`CREATE INDEX IF NOT EXISTS friends_a_idx ON friends(user_a)`);
      await pool.query(`CREATE INDEX IF NOT EXISTS friends_b_idx ON friends(user_b)`);

      /* ランキング・ログインボーナス用の列(v3.2) */
      await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS total_gain    BIGINT  NOT NULL DEFAULT 0`);
      await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS best_gain     BIGINT  NOT NULL DEFAULT 0`);
      await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS best_gain_at  TEXT`);
      await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS day_key       TEXT`);
      await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS day_gain      BIGINT  NOT NULL DEFAULT 0`);
      await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS day_best      BIGINT  NOT NULL DEFAULT 0`);
      await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS bonus_date    TEXT`);
      await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS bonus_ad_date TEXT`);
      await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS login_streak  INTEGER NOT NULL DEFAULT 0`);
      await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS login_days    INTEGER NOT NULL DEFAULT 0`);

      /* 使わなくなった列の後片付け。
         IF EXISTS なので、何度デプロイしても安全に空振りする。
         全環境に反映されたら、この処理自体は消してしまってかまわない */
      for (const col of ['hl_total_gain', 'hl_best_gain', 'hl_best_gain_at',
                         'hl_day_key', 'hl_day_gain', 'hl_day_best',
                         'hl_rounds', 'hl_wins', 'hl_losses']){
        await pool.query(`ALTER TABLE users DROP COLUMN IF EXISTS ${col}`);
      }
      /* 廃止したゲームの日次ランキングも消しておく */
      await pool.query(`DELETE FROM rank_daily_v4 WHERE game NOT IN ('bj', 'marble', 'slot')`);

      /* マーブルレース用の列(v4.1) */
      await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS mr_total_gain   BIGINT  NOT NULL DEFAULT 0`);
      await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS mr_best_gain    BIGINT  NOT NULL DEFAULT 0`);
      await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS mr_best_gain_at TEXT`);
      await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS mr_day_key      TEXT`);
      await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS mr_day_gain     BIGINT  NOT NULL DEFAULT 0`);
      await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS mr_day_best     BIGINT  NOT NULL DEFAULT 0`);
      await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS mr_races        INTEGER NOT NULL DEFAULT 0`);
      await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS mr_hits         INTEGER NOT NULL DEFAULT 0`);
      await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS mr_misses       INTEGER NOT NULL DEFAULT 0`);

      /* スロット用の列(v5.0) */
      await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS sl_total_gain   BIGINT  NOT NULL DEFAULT 0`);
      await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS sl_best_gain    BIGINT  NOT NULL DEFAULT 0`);
      await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS sl_best_gain_at TEXT`);
      await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS sl_day_key      TEXT`);
      await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS sl_day_gain     BIGINT  NOT NULL DEFAULT 0`);
      await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS sl_day_best     BIGINT  NOT NULL DEFAULT 0`);
      await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS sl_games        INTEGER NOT NULL DEFAULT 0`);
      await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS sl_bb           INTEGER NOT NULL DEFAULT 0`);
      await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS sl_rb           INTEGER NOT NULL DEFAULT 0`);

      /* いま有効なログインの識別子(v4.2)
         同じアカウントに2台からログインできないようにするために使う。
         新しくログインするたびに作り直し、古い端末のトークンを無効にする */
      await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS session_id TEXT`);

      /* 通知(v3.2) */
      await pool.query(`
        CREATE TABLE IF NOT EXISTS notices(
          id         BIGSERIAL PRIMARY KEY,
          username   TEXT NOT NULL,
          kind       TEXT NOT NULL,
          title      TEXT NOT NULL,
          body       TEXT NOT NULL DEFAULT '',
          is_read    BOOLEAN NOT NULL DEFAULT FALSE,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )`);
      await pool.query(`CREATE INDEX IF NOT EXISTS notices_user_idx ON notices(username, id DESC)`);

      /* 日次ランキングの確定結果(v3.2) */
      await pool.query(`
        CREATE TABLE IF NOT EXISTS rank_daily(
          date_key   TEXT NOT NULL,
          username   TEXT NOT NULL,
          level      INTEGER NOT NULL DEFAULT 1,
          icon_color TEXT,
          total_gain BIGINT NOT NULL DEFAULT 0,
          best_gain  BIGINT NOT NULL DEFAULT 0,
          PRIMARY KEY(date_key, username)
        )`);
      await pool.query(`CREATE INDEX IF NOT EXISTS rank_daily_idx ON rank_daily(date_key)`);

      /* 日次ランキング(v4.0・ゲーム別)
         旧 rank_daily は主キーが (date_key, username) でゲームを持てないため、
         主キーを張り替えるのではなく新しいテーブルを用意した。
         日次ランキングは3日しか保持しないので、作り直しても実害がない。
         旧テーブルは削除の互換のために残してある。 */
      await pool.query(`
        CREATE TABLE IF NOT EXISTS rank_daily_v4(
          date_key   TEXT NOT NULL,
          game       TEXT NOT NULL,
          username   TEXT NOT NULL,
          level      INTEGER NOT NULL DEFAULT 1,
          icon_color TEXT,
          total_gain BIGINT NOT NULL DEFAULT 0,
          best_gain  BIGINT NOT NULL DEFAULT 0,
          PRIMARY KEY(date_key, game, username)
        )`);
      await pool.query(`CREATE INDEX IF NOT EXISTS rank_daily_v4_idx ON rank_daily_v4(date_key, game)`);

      /* 集計の進行状況(v3.2) */
      await pool.query(`
        CREATE TABLE IF NOT EXISTS rank_meta(
          id           INTEGER PRIMARY KEY,
          last_settled TEXT
        )`);
      await pool.query(`INSERT INTO rank_meta(id, last_settled) VALUES(1, NULL) ON CONFLICT (id) DO NOTHING`);

      /* v3.2 修正: BIGINTが文字列として扱われていた期間に、
         メダルの加算が文字列連結になって桁が壊れた記録が残っている。
         一度だけ集計値をリセットする(このフラグで二度目は走らない)。 */
      await pool.query(`ALTER TABLE rank_meta ADD COLUMN IF NOT EXISTS gain_fixed BOOLEAN NOT NULL DEFAULT FALSE`);
      const fixed = await pool.query(`SELECT gain_fixed FROM rank_meta WHERE id=1`);
      if (!fixed.rows[0] || !fixed.rows[0].gain_fixed){
        await pool.query(`UPDATE users SET total_gain=0, best_gain=0, best_gain_at=NULL,
                          day_gain=0, day_best=0, day_key=NULL`);
        await pool.query(`DELETE FROM rank_daily`);
        await pool.query(`UPDATE rank_meta SET gain_fixed=TRUE WHERE id=1`);
        console.log('[db] 壊れていたランキング集計値をリセットしました');
      }
      console.log('[db] PostgreSQL 接続OK');
    },
    async findUser(name){
      const r = await pool.query(`SELECT ${COLS} FROM users WHERE username=$1`, [name]);
      return r.rows[0] || null;
    },
    async createUser(row){
      await pool.query(
        `INSERT INTO users(${COLS}) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,
          $17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,
          $28,$29,$30,$31,$32,$33,$34,$35,$36,
          $37,$38,$39,$40,$41,$42,$43,$44,$45,$46)`,
        [row.username, row.pass_hash, row.medal, row.level, row.exp,
         row.rounds, row.wins, row.losses, row.pushes, row.bj,
         row.champ_plays, row.champ_wins, row.champ_losses, row.champ_draws, row.last_login,
         row.icon_color || DEFAULT_ICON_COLOR,
         row.total_gain || 0, row.best_gain || 0, row.best_gain_at || null,
         row.day_key || null, row.day_gain || 0, row.day_best || 0,
         row.bonus_date || null, row.bonus_ad_date || null,
         row.login_streak || 0, row.login_days || 0,
         row.created_at || new Date(),
         /* マーブルレース(v4.1) */
         row.mr_total_gain || 0, row.mr_best_gain || 0, row.mr_best_gain_at || null,
         row.mr_day_key || null, row.mr_day_gain || 0, row.mr_day_best || 0,
         row.mr_races || 0, row.mr_hits || 0, row.mr_misses || 0,
         /* スロット(v5.0) */
         row.sl_total_gain || 0, row.sl_best_gain || 0, row.sl_best_gain_at || null,
         row.sl_day_key || null, row.sl_day_gain || 0, row.sl_day_best || 0,
         row.sl_games || 0, row.sl_bb || 0, row.sl_rb || 0,
         row.session_id || null]);
      return row;
    },
    async saveUser(row){
      await pool.query(
        `UPDATE users SET medal=$2, level=$3, exp=$4, rounds=$5,
         wins=$6, losses=$7, pushes=$8, bj=$9,
         champ_plays=$10, champ_wins=$11, champ_losses=$12, champ_draws=$13,
         last_login=$14, icon_color=$15,
         total_gain=$16, best_gain=$17, best_gain_at=$18,
         day_key=$19, day_gain=$20, day_best=$21,
         bonus_date=$22, bonus_ad_date=$23, login_streak=$24, login_days=$25,
         mr_total_gain=$26, mr_best_gain=$27, mr_best_gain_at=$28,
         mr_day_key=$29, mr_day_gain=$30, mr_day_best=$31,
         mr_races=$32, mr_hits=$33, mr_misses=$34,
         sl_total_gain=$35, sl_best_gain=$36, sl_best_gain_at=$37,
         sl_day_key=$38, sl_day_gain=$39, sl_day_best=$40,
         sl_games=$41, sl_bb=$42, sl_rb=$43,
         session_id=$44
         WHERE username=$1`,
        [row.username, row.medal, row.level, row.exp,
         row.rounds, row.wins, row.losses, row.pushes, row.bj,
         row.champ_plays, row.champ_wins, row.champ_losses, row.champ_draws, row.last_login,
         row.icon_color || DEFAULT_ICON_COLOR,
         row.total_gain || 0, row.best_gain || 0, row.best_gain_at || null,
         row.day_key || null, row.day_gain || 0, row.day_best || 0,
         row.bonus_date || null, row.bonus_ad_date || null,
         row.login_streak || 0, row.login_days || 0,
         /* マーブルレース(v4.1) */
         row.mr_total_gain || 0, row.mr_best_gain || 0, row.mr_best_gain_at || null,
         row.mr_day_key || null, row.mr_day_gain || 0, row.mr_day_best || 0,
         row.mr_races || 0, row.mr_hits || 0, row.mr_misses || 0,
         /* スロット(v5.0) */
         row.sl_total_gain || 0, row.sl_best_gain || 0, row.sl_best_gain_at || null,
         row.sl_day_key || null, row.sl_day_gain || 0, row.sl_day_best || 0,
         row.sl_games || 0, row.sl_bb || 0, row.sl_rb || 0,
         row.session_id || null]);
      return row;
    },
    async deleteUser(name){
      await pool.query(`DELETE FROM friends WHERE user_a=$1 OR user_b=$1`, [name]);
      await pool.query(`DELETE FROM notices WHERE username=$1`, [name]);
      await pool.query(`DELETE FROM rank_daily WHERE username=$1`, [name]);
      await pool.query(`DELETE FROM rank_daily_v4 WHERE username=$1`, [name]);
      const r = await pool.query(`DELETE FROM users WHERE username=$1`, [name]);
      return r.rowCount > 0;
    },
    async listUsers(){
      const r = await pool.query(`SELECT ${COLS} FROM users ORDER BY username ASC`);
      return r.rows;
    },
    /* ---- フレンド(v3.0) ---- */
    async findLink(a, b){
      const [x, y] = a < b ? [a, b] : [b, a];
      const r = await pool.query(
        `SELECT user_a, user_b, status, requester FROM friends WHERE user_a=$1 AND user_b=$2`, [x, y]);
      return r.rows[0] || null;
    },
    async saveLink(row){
      await pool.query(
        `INSERT INTO friends(user_a, user_b, status, requester) VALUES($1,$2,$3,$4)
         ON CONFLICT (user_a, user_b) DO UPDATE SET status=EXCLUDED.status, requester=EXCLUDED.requester`,
        [row.user_a, row.user_b, row.status, row.requester]);
      return row;
    },
    async deleteLink(a, b){
      const [x, y] = a < b ? [a, b] : [b, a];
      const r = await pool.query(`DELETE FROM friends WHERE user_a=$1 AND user_b=$2`, [x, y]);
      return r.rowCount > 0;
    },
    async listLinks(name){
      const r = await pool.query(
        `SELECT user_a, user_b, status, requester FROM friends WHERE user_a=$1 OR user_b=$1`, [name]);
      return r.rows;
    },
    /* ---- 通知(v3.2) ---- */
    async addNotice(n){
      await pool.query(
        `INSERT INTO notices(username, kind, title, body) VALUES($1,$2,$3,$4)`,
        [n.username, n.kind, n.title, n.body || '']);
    },
    async listNotices(name, limit){
      const r = await pool.query(
        `SELECT id, kind, title, body, is_read, created_at FROM notices
         WHERE username=$1 ORDER BY id DESC LIMIT $2`, [name, limit]);
      return r.rows;
    },
    async countUnread(name){
      const r = await pool.query(
        `SELECT COUNT(*)::int AS n FROM notices WHERE username=$1 AND is_read=FALSE`, [name]);
      return r.rows[0].n;
    },
    async markNoticesRead(name){
      await pool.query(`UPDATE notices SET is_read=TRUE WHERE username=$1 AND is_read=FALSE`, [name]);
    },
    async clearNotices(name){
      await pool.query(`DELETE FROM notices WHERE username=$1`, [name]);
    },
    /* 通知が増えすぎないよう、古いものを間引く */
    async trimNotices(name, keep){
      await pool.query(
        `DELETE FROM notices WHERE username=$1 AND id NOT IN (
           SELECT id FROM notices WHERE username=$1 ORDER BY id DESC LIMIT $2)`, [name, keep]);
    },
    /* ---- ランキング(v3.2) ---- */
    async lastSettled(){
      const r = await pool.query(`SELECT last_settled FROM rank_meta WHERE id=1`);
      return r.rows[0] ? r.rows[0].last_settled : null;
    },
    async setLastSettled(key){
      await pool.query(
        `INSERT INTO rank_meta(id, last_settled) VALUES(1,$1)
         ON CONFLICT (id) DO UPDATE SET last_settled=EXCLUDED.last_settled`, [key]);
    },
    /* その日の成績を持つ人だけを確定用に取り出す(v4.0でゲーム別)
       列名は RANK_FIELDS から組み立てる。値は固定の識別子なので注入の心配はない */
    async usersWithDay(key, game){
      const F = RANK_FIELDS[normGame(game)];
      const r = await pool.query(
        `SELECT username, level, icon_color, ${F.dayGain} AS day_gain, ${F.dayBest} AS day_best
         FROM users WHERE ${F.dayKey}=$1 AND (${F.dayGain} > 0 OR ${F.dayBest} > 0)`, [key]);
      return r.rows;
    },
    async saveDailyRanks(key, game, rows){
      const g = normGame(game);
      for (const x of rows){
        await pool.query(
          `INSERT INTO rank_daily_v4(date_key, game, username, level, icon_color, total_gain, best_gain)
           VALUES($1,$2,$3,$4,$5,$6,$7)
           ON CONFLICT (date_key, game, username) DO UPDATE SET
             level=EXCLUDED.level, icon_color=EXCLUDED.icon_color,
             total_gain=EXCLUDED.total_gain, best_gain=EXCLUDED.best_gain`,
          [key, g, x.username, x.level, x.icon_color, x.day_gain, x.day_best]);
      }
    },
    async getDailyRanks(key, game){
      const r = await pool.query(
        `SELECT username, level, icon_color, total_gain, best_gain
         FROM rank_daily_v4 WHERE date_key=$1 AND game=$2`, [key, normGame(game)]);
      return r.rows;
    },
    /* 保存期間を過ぎた日次ランキングを消す */
    async purgeDailyRanks(before){
      await pool.query(`DELETE FROM rank_daily    WHERE date_key < $1`, [before]);
      await pool.query(`DELETE FROM rank_daily_v4 WHERE date_key < $1`, [before]);
    },
    /* 歴代の一撃ランキング(usersテーブルから直接) */
    async topAllTimeBest(game, limit){
      const F = RANK_FIELDS[normGame(game)];
      const r = await pool.query(
        `SELECT username, level, icon_color, ${F.best} AS best_gain, ${F.bestAt} AS best_gain_at
         FROM users WHERE ${F.best} > 0
         ORDER BY ${F.best} DESC, username ASC LIMIT $1`, [limit]);
      return r.rows;
    },
    /* 進行中(本日)の集計をその場で読む */
    async liveDay(key, game, limit){
      const F = RANK_FIELDS[normGame(game)];
      const r = await pool.query(
        `SELECT username, level, icon_color, ${F.dayGain} AS day_gain, ${F.dayBest} AS day_best
         FROM users WHERE ${F.dayKey}=$1 AND (${F.dayGain} > 0 OR ${F.dayBest} > 0) LIMIT $2`,
        [key, limit]);
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

/* =========================================================
   トークン(v4.2でログイン識別子つきに変更)

   形式: base64url(ユーザー名).有効期限.ログイン識別子.署名
   v4.1までは識別子のない3つ組だった。古いトークンも読めるようにしてあるが、
   そのユーザーが一度でも新しくログインすると session_id が入るので、
   古いトークンはそこで使えなくなる(=自動的に追い出される)。
   ========================================================= */
/* Socket.io の実体。下のほうで代入する。
   ログイン処理から古い接続を切るために、ここから参照できるようにしている */
let ioRef = null;

function newSessionId(){ return crypto.randomBytes(9).toString('base64url'); }

function makeToken(username, sessionId){
  const exp = Date.now() + TOKEN_DAYS * 86400000;
  const body = Buffer.from(username).toString('base64url') + '.' + exp +
               '.' + (sessionId || '');
  return body + '.' + sign(body);
}

/* 戻り値は { name, sid } か null。sid は古いトークンだと null になる */
function readToken(token){
  if (typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3 && parts.length !== 4) return null;

  const sig = parts[parts.length - 1];
  const body = parts.slice(0, parts.length - 1).join('.');
  const expected = sign(body);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  if (Number(parts[1]) < Date.now()) return null;

  try {
    return {
      name: Buffer.from(parts[0], 'base64url').toString('utf8'),
      sid: parts.length === 4 ? (parts[2] || null) : null
    };
  } catch { return null; }
}

/* そのトークンが「いま有効なログイン」かどうか。
   session_id をまだ持っていないユーザー(v4.1以前から居る人)は、
   次にログインするまで今までどおり使えるようにしている */
function sessionValid(user, sid){
  if (!user) return false;
  if (!user.session_id) return true;
  return user.session_id === sid;
}

/* 新しくログインしたので、同じアカウントで繋がっている古い接続を切る。
   先に画面へ知らせてから切断する */
function kickOtherSessions(name, keepSid){
  if (!ioRef) return;
  for (const sock of ioRef.sockets.sockets.values()){
    if (sock.data && sock.data.name === name && sock.data.sid !== keepSid){
      sock.emit('auth:kicked', { reason: '別の端末でログインされました' });
      setTimeout(() => { try { sock.disconnect(true); } catch {} }, 120);
    }
  }
  /* マーブルレースの会場からも外しておく */
  if (typeof marble !== 'undefined' && marble.watchers.has(name)){
    marble.watchers.delete(name);
    marble.tickets.delete(name);
  }
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
    iconColor: ICON_COLORS.includes(u.icon_color) ? u.icon_color : DEFAULT_ICON_COLOR,
    isOwner: u.username === OWNER_NAME,
    /* v3.2 */
    totalGain: Number(u.total_gain || 0),
    bestGain: Number(u.best_gain || 0),
    bestGainAt: u.best_gain_at || null,
    loginStreak: Number(u.login_streak || 0),
    loginDays: Number(u.login_days || 0),
    createdAt: u.created_at ? new Date(u.created_at).toISOString() : null,
    /* 今日のログインボーナスを受け取れるか(v3.2) */
    bonusReady: u.bonus_date !== jstDateKey(),
    bonusAdReady: u.bonus_date === jstDateKey() && u.bonus_ad_date !== jstDateKey(),
    /* マーブルレース(v4.1) */
    mrRaces: Number(u.mr_races || 0),
    mrHits: Number(u.mr_hits || 0),
    mrMisses: Number(u.mr_misses || 0),
    mrTotalGain: Number(u.mr_total_gain || 0),
    mrBestGain: Number(u.mr_best_gain || 0),
    mrBestGainAt: u.mr_best_gain_at || null
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

/* マーブルレース用の応援スタンプ(v4.5)
   競馬中継のような掛け声を、押すだけで送れるようにしたもの。
   自由入力もできるが、レース中は手が離せないので定型文を用意した */
const MR_CHEERS = [
  'いけーっ！', '差せ差せ！', '本命こい！', '大穴きた！',
  'まくれー！', '粘れー！', 'よし来た！', 'あーっ！',
  'とられた…', 'ナイス！', 'ここから！', '頼む！'
];
const MIN_HUMANS = 2;   // オンラインで開始に必要な人プレイヤー数
/* チャンピオンモードの全額ベットボーナス(WIN/BLACKJACKの獲得メダルを1.5倍)(v3.0) */
const ALLIN_BONUS_RATE = 1.5;

/* =========================================================
   早抜けモード(v3.2)
   大会メダル1000枚からスタートし、目標枚数を「超えた」人から順に勝ち抜け。
   最後の1人が残った時点で終了し、その人はリタイア扱いになる。
   もらえるEXPは抜けた順位で決まり、ラウンド数や目標枚数では変わらない。
   ========================================================= */
const SPRINT_GOAL_DEFAULT = 10000;   // おすすめの目標
const SPRINT_GOAL_MIN     = 2000;
const SPRINT_GOAL_MAX     = 1000000;
/* 順位ごとの固定EXP(1位から順に) */
const SPRINT_EXP = [120, 80, 50];
/* リタイア(メダル切れ・最後の1人)は一律この値 */
const SPRINT_EXP_RETIRE = 20;

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
   4.6 マーブルレース エンジン(v4.1)

   競馬をそのままボールのレースに置き換えたゲーム。
   ほかの2ゲームと違い「部屋」を作らない。会場はサーバーに1つだけで、
   ログインしている人なら誰でも自由に出入りできる常時開催のレースにした。
   そのため1人しかいなくても普通に遊べる(シングル専用モードは無い)。

   1レースの流れ(およそ1分):
     bet(投票 35秒)→ race(レース 15秒)→ result(払い戻し 10秒)→ 次のレースへ

   着順の決め方:
     各ボールに「強さ w」を毎レース割り当て、
     1着は w に比例した確率で選び、選ばれたボールを除いて2着を選ぶ…
     というのを8回繰り返して着順を決める(プラケット・ルースモデル)。
     オッズはこの確率から逆算するので、強いボールほど低配当になる。
   ========================================================= */
const MR_BALLS       = 8;
const MR_BET_MS      = 30000;   // 投票受付(v4.3)
const MR_COUNT_SEC   = 3;       // 締め切ってからスタートまでの秒読み(v4.3)
const MR_RUSH_MS     = 5000;    // 全員が投票し終えたときの残り時間(v4.6)
const MR_RACE_MS     = 20000;   // レース本番(v4.5で短縮)
const MR_RESULT_MS   = 10000;   // 払い戻しの確認
const MR_PAYOUT_RATE = 0.85;    // 払戻率(控除率15%)。上げるとメダルが増えやすくなる
const MR_MIN_BET     = 10;
const MR_MAX_BET     = 100000;
const MR_MAX_TICKETS = 1;       // 1レースで買える投票券の枚数(v4.3で1枚に)
const MR_TICKS       = 32;      // 演出用に送る位置データの数(v4.5)
const MR_MIN_ODDS    = 1.1;
const MR_ROOM        = 'marble-hall';

/* 8つのボール。枠番の色は競馬の枠順に寄せてある */
const MR_BALL_DEFS = [
  { no: 1, name: 'スノー',     color: '#F2F2F2', ink: '#1A1A1A' },
  { no: 2, name: 'シャドウ',   color: '#2E2E38', ink: '#F2F2F2' },
  { no: 3, name: 'フレイム',   color: '#E24B3C', ink: '#FFF3F1' },
  { no: 4, name: 'オーシャン', color: '#3D7BE0', ink: '#F0F6FF' },
  { no: 5, name: 'サンダー',   color: '#E8C33A', ink: '#221C05' },
  { no: 6, name: 'リーフ',     color: '#3FAE66', ink: '#F0FFF7' },
  { no: 7, name: 'アンバー',   color: '#E88A32', ink: '#2A1603' },
  { no: 8, name: 'ブロッサム', color: '#E27BB0', ink: '#2E0A1D' }
];

/* 0以上1未満の乱数。cryptoで作って予測できないようにする */
function mrRandom(){ return crypto.randomInt(1000000) / 1000000; }

/* 買い目の種類 */
const MR_BET_TYPES = {
  win:      { key: 'win',      label: '単勝', picks: 1, ordered: false },
  place:    { key: 'place',    label: '複勝', picks: 1, ordered: false },
  quinella: { key: 'quinella', label: '馬連', picks: 2, ordered: false }
};

/* 会場はサーバーに1つだけ */
const marble = {
  phase: 'idle',          // idle | bet | count | race | result(v4.3で count を追加)
  rushed: false,          // 全員投票で締め切りを早めたか(v4.6)
  count: 0,               // 秒読みの残り(3→2→1)
  countTimer: null,
  raceNo: 0,
  balls: [],
  order: [],              // 着順(ボール番号の配列)
  track: [],              // 演出用の位置データ
  tickets: new Map(),     // username -> [ticket]
  watchers: new Map(),    // username -> { sid, name, level, iconColor }
  deadline: 0,
  timer: null,
  odds: null,
  lastResult: null
};

/* ---------------------------------------------------------
   出走表を作る。強さは毎レースばらつかせる
   --------------------------------------------------------- */
function makeMarbleBalls(){
  return MR_BALL_DEFS.map(def => {
    /* 1.32^0〜1.32^9 で、人気と大穴の差が競馬らしくなる幅にした */
    const grade = crypto.randomInt(10);
    const w = Math.pow(1.32, grade) * (0.85 + mrRandom() * 0.3);
    return { ...def, w };
  });
}

/* 1着になる確率。強さをそのまま正規化したもの */
function mrWinProbs(balls){
  const W = balls.reduce((a, b) => a + b.w, 0);
  return balls.map(b => b.w / W);
}

/* 3着以内に入る確率を厳密に求める。
   8頭なので O(n^3) でも十分に軽い */
function mrPlaceProbs(balls){
  const n = balls.length;
  const w = balls.map(b => b.w);
  const W = w.reduce((a, b) => a + b, 0);
  const out = new Array(n).fill(0);

  for (let i = 0; i < n; i++){
    /* 1着 */
    let p = w[i] / W;

    /* 2着(誰かが1着になった残りから選ばれる) */
    for (let j = 0; j < n; j++){
      if (j === i) continue;
      p += (w[j] / W) * (w[i] / (W - w[j]));
    }

    /* 3着 */
    for (let j = 0; j < n; j++){
      if (j === i) continue;
      const w1 = W - w[j];
      for (let k = 0; k < n; k++){
        if (k === i || k === j) continue;
        p += (w[j] / W) * (w[k] / w1) * (w[i] / (w1 - w[k]));
      }
    }
    out[i] = p;
  }
  return out;
}

/* 馬連(1着と2着の組み合わせ)の確率 */
function mrQuinellaProb(balls, ia, ib){
  const w = balls.map(b => b.w);
  const W = w.reduce((a, b) => a + b, 0);
  return (w[ia] / W) * (w[ib] / (W - w[ia])) +
         (w[ib] / W) * (w[ia] / (W - w[ib]));
}

/* 確率からオッズへ。控除率を引いて、小数第1位に丸める */
function mrToOdds(p){
  if (!(p > 0)) return 999.9;
  const o = MR_PAYOUT_RATE / p;
  return Math.max(MR_MIN_ODDS, Math.round(o * 10) / 10);
}

/* 出走表からオッズ表をまとめて作る */
function makeMarbleOdds(balls){
  const win = mrWinProbs(balls).map(mrToOdds);
  const place = mrPlaceProbs(balls).map(mrToOdds);

  /* 馬連は「1-2」のような文字列をキーにする(小さい番号が先) */
  const quinella = {};
  for (let i = 0; i < balls.length; i++){
    for (let j = i + 1; j < balls.length; j++){
      const key = balls[i].no + '-' + balls[j].no;
      quinella[key] = mrToOdds(mrQuinellaProb(balls, i, j));
    }
  }
  return { win, place, quinella };
}

/* 買い目からオッズを引く。存在しない買い目なら null */
function mrOddsOf(type, picks){
  const o = marble.odds;
  if (!o) return null;
  if (type === 'win' || type === 'place'){
    const idx = marble.balls.findIndex(b => b.no === picks[0]);
    if (idx < 0) return null;
    return type === 'win' ? o.win[idx] : o.place[idx];
  }
  if (type === 'quinella'){
    const key = mrPairKey(picks);
    return o.quinella[key] || null;
  }
  return null;
}

function mrPairKey(picks){
  const a = Math.min(picks[0], picks[1]);
  const b = Math.max(picks[0], picks[1]);
  return a + '-' + b;
}

/* ---------------------------------------------------------
   着順を決める(プラケット・ルース)
   --------------------------------------------------------- */
function drawMarbleOrder(balls){
  const pool = balls.map((b, i) => ({ no: b.no, w: b.w, i }));
  const order = [];
  while (pool.length){
    const W = pool.reduce((a, b) => a + b.w, 0);
    let r = mrRandom() * W;
    let idx = 0;
    for (; idx < pool.length - 1; idx++){
      r -= pool[idx].w;
      if (r <= 0) break;
    }
    order.push(pool[idx].no);
    pool.splice(idx, 1);
  }
  return order;
}

/* ---------------------------------------------------------
   レースの見た目を作る。
   着順は先に決まっているので、その順にゴールしつつ
   途中は抜きつ抜かれつに見えるような位置データを用意する。
   クライアントはこの数字を補間して描くだけでよい。
   --------------------------------------------------------- */
function makeMarbleTrack(balls, order){
  /* -------------------------------------------------------
     着順ごとのゴール時刻を決める(v4.4で作り直し)

     v4.3までは「0.90 + 着順 × 0.012」の固定式だったので、
     どのレースも1着〜8着が同じ幅にきれいに並び、
     結果として毎回そっくりな僅差レースになっていた。

     v4.4では2つの要素でタイム差をつける。
       1. 強さの差 … 隣り合う着順どうしの実力差が大きいほど、
                      その間のタイム差も大きくなる
       2. レースごとの気分 … 荒れ具合を毎回ランダムに変える。
                      同じ顔ぶれでも、圧勝の回と大混戦の回が出る
     ------------------------------------------------------- */
  const W = balls.reduce((a, b) => a + b.w, 0);
  const wOf = {};
  for (const b of balls) wOf[b.no] = b.w / W;     // 0〜1に均した強さ

  /* このレースの荒れ具合。小さいほど団子、大きいほど差がつく。
     2乗しているのは「そこそこの回」を多めに、
     「極端な回」をたまに出すため */
  const spread = 0.35 + Math.pow(mrRandom(), 2) * 1.85;

  /* 隣り合う着順の間隔を、実力差から積み上げていく。

     v4.5の修正(重要):
     v4.4では積み上げた値をその場で Math.min(0.995, t) と頭打ちにしていた。
     そのため上限を超えた着順が「まとめて 0.995」に潰れてしまい、
     8頭のうち何頭も“まったく同じゴール時刻”になっていた。
     3000レースで調べたところ、91%のレースでゴール時刻が4種類以下、
     37%では2種類以下という状態で、これが
     「終盤に下位が横一列で並ぶ」「途中で止まって見える」の原因だった。

     さらに、その下にある「はみ出したら縮める」補正は
     頭打ちした“後”の値を見ていたため never fire(3000回中0回)だった。

     v4.5では頭打ちをやめ、まず素の値を全部出しきってから、
     はみ出した分だけ全体を比率で縮める。
     こうすると必ず全員バラバラのゴール時刻になり、間隔も保たれる。 */
  const MR_FINISH_LAST = 0.998;   // 最下位がゴールする位置(=演出のほぼ終わり)

  /* まず「着順どうしの間隔の比率」だけを積み上げる。
     ここでは画面の幅を気にせず、実力差の大小関係だけを作る */
  const cum = [0];
  for (let i = 1; i < order.length; i++){
    const prev = wOf[order[i - 1]] || 0;
    const cur  = wOf[order[i]] || 0;

    /* 実力差ぶんの間隔。前が格上なら開き、同格なら詰まる。
       差がマイナス(格下が先着＝波乱)のときは 0 として扱う */
    const byPower = Math.max(0, prev - cur) * 2.6;
    /* 最低限の間隔と、着順ごとのゆらぎ。
       0.012 は「どんなに実力が拮抗していても、これだけは離れる」下限 */
    const jitter = 0.004 + mrRandom() * 0.020;

    /* 後ろの着順ほど間隔を広げる(v4.5)。
       本物のレースでも先頭集団は固まり、後方はばらけていくので、
       これがないと下位4頭が横一列に並んで見えてしまう */
    const tail = 1 + (i - 1) * 0.26;

    cum.push(cum[i - 1] + ((0.012 + byPower) * spread + jitter) * tail);
  }

  /* 1着から最下位までを、どれだけの幅に収めるか。
     広いほど「圧勝」に、狭いほど「大混戦」に見える。
     ここを広げすぎると1着がゴールしたあと長く待つことになるので、
     20秒のレースで2〜4秒に収まる範囲にしている(v4.5) */
  const span = 0.10 + Math.pow(mrRandom(), 1.2) * 0.10;

  /* 比率をその幅に写す。割合で配るので、
     必ず全員ちがうゴール時刻になり、はみ出すこともない
     (v4.4は頭打ちで潰れて団子になっていた) */
  const total = cum[cum.length - 1] || 1;
  const lead = MR_FINISH_LAST - span;
  const finish = {};
  for (let i = 0; i < order.length; i++){
    finish[order[i]] = lead + span * (cum[i] / total);
  }

  /* 揺らぎの大きさも荒れ具合に合わせる。
     差がつくレースほど道中も動きが大きく見えるようにした */
  const waveScale = 0.75 + spread * 0.35;

  return balls.map(b => {
    /* ボールごとに揺らぎの波を3つ持たせる(抜きつ抜かれつの表現) */
    const waves = [];
    for (let k = 0; k < 3; k++){
      /* v4.5: 揺らぎが速く大きすぎると、1フレームで進む量より
         揺らぎの戻りが上回ってしまい「後退しない」制約に当たって
         その場で止まって見えていた。振幅を抑え、周期をゆっくりにする */
      waves.push({
        amp: (0.014 + mrRandom() * 0.024) * waveScale,
        freq: 0.7 + mrRandom() * 1.5,
        phase: mrRandom() * Math.PI * 2
      });
    }
    const pts = [];
    let prev = 0;
    const fin = finish[b.no];

    /* このボールがゴールするフレームを先に決めてしまう(v4.5)。
       以前は毎フレームの位置を計算してから「1に届いたか」で
       判定していたため、小数の丸めのせいで
       まれに下位が先にゴールしたことになり、
       表示される着順と食い違うことがあった。
       ここで整数のフレーム番号として確定させれば、
       finish の順序がそのまま到達順になり、絶対に食い違わない */
    const goalTick = Math.max(1, Math.min(MR_TICKS, Math.ceil(fin * MR_TICKS)));

    for (let t = 0; t <= MR_TICKS; t++){
      /* 自分のゴールフレームに達したら、そこからはゴール地点 */
      if (t >= goalTick){ prev = 1; pts.push(1); continue; }

      const x = t / MR_TICKS;
      let p = x / fin;

      /* 揺らぎはスタートとゴールで0になるよう、中央でだけ効かせる */
      const damp = Math.sin(Math.PI * x) * (1 - x) * 1.15;
      let noise = 0;
      for (const w of waves) noise += Math.sin(x * w.freq * Math.PI * 2 + w.phase) * w.amp;
      p += noise * damp;

      /* ゴールする手前までの天井。
         ゴールが近づくにつれ天井も上がっていくので、
         ここに張り付いたボールも止まって見えない */
      const cap = 0.940 + 0.055 * (t / goalTick);
      p = Math.max(prev, Math.min(cap, p));   // 逆走はしない

      /* 動きが完全に止まると不自然なので、最低限は進ませる */
      const creep = prev + 0.0020;
      if (p < creep) p = Math.min(cap, creep);

      prev = p;
      /* 小数4桁で送る。3桁だと最低前進量が丸めで消えて
         「止まって見える」フレームができてしまう */
      pts.push(Math.round(p * 10000) / 10000);
    }
    pts[MR_TICKS] = 1;
    return { no: b.no, pts };
  });
}

/* ---------------------------------------------------------
   投票券の判定
   --------------------------------------------------------- */
function mrTicketHit(ticket, order){
  const top3 = order.slice(0, 3);
  if (ticket.type === 'win')   return order[0] === ticket.picks[0];
  if (ticket.type === 'place') return top3.includes(ticket.picks[0]);
  if (ticket.type === 'quinella'){
    const top2 = order.slice(0, 2);
    return ticket.picks.every(n => top2.includes(n));
  }
  return false;
}

/* ---------------------------------------------------------
   会場の状態をクライアントに送る形にする
   --------------------------------------------------------- */
function marbleState(forName){
  const tickets = marble.tickets.get(forName) || [];
  const invest = tickets.reduce((a, t) => a + t.amount, 0);

  /* 会場にいる人の一覧(名前とアイコンだけ。投票内容は伏せる) */
  const watchers = [...marble.watchers.values()].map(w => ({
    name: w.name, level: w.level, iconColor: w.iconColor,
    invest: (marble.tickets.get(w.name) || []).reduce((a, t) => a + t.amount, 0)
  }));

  const st = {
    phase: marble.phase,
    count: marble.count || 0,
    countSec: MR_COUNT_SEC,
    raceNo: marble.raceNo,
    balls: marble.balls.map(b => ({ no: b.no, name: b.name, color: b.color, ink: b.ink })),
    odds: marble.odds,
    deadline: marble.deadline || null,
    betMs: MR_BET_MS,
    raceMs: MR_RACE_MS,
    resultMs: MR_RESULT_MS,
    rushed: !!marble.rushed,
    cheers: MR_CHEERS,
    stamps: CHAT_STAMPS,
    minBet: MR_MIN_BET,
    maxBet: MR_MAX_BET,
    maxTickets: MR_MAX_TICKETS,
    payoutRate: MR_PAYOUT_RATE,
    ticks: MR_TICKS,
    watchers,
    myTickets: tickets,
    myInvest: invest
  };

  /* 秒読み中は出走表を見せたままにしたいので、着順や位置データはまだ送らない */
  if (marble.phase === 'race' || marble.phase === 'result'){
    st.track = marble.track;
    st.order = marble.order;
  }
  if (marble.phase === 'result' && marble.lastResult){
    st.result = marble.lastResult.perUser.get(forName) || { payout: 0, hits: [], invest: 0 };
    st.order = marble.lastResult.order;
  }
  return st;
}

/* マーブルレースの会場チャット(v4.5)
   部屋を持たないゲームなので、観客一覧をそのまま宛先にする */
function marbleChat(io, msg){
  for (const w of marble.watchers.values()){
    if (w.sid) io.to(w.sid).emit('marble:chat', msg);
  }
}

function marbleChatSystem(io, body){
  marbleChat(io, { from: null, body, kind: 'system', at: Date.now() });
}

function broadcastMarble(io){
  for (const w of marble.watchers.values()){
    if (!w.sid) continue;
    io.to(w.sid).emit('marble:state', marbleState(w.name));
  }
}

/* ---------------------------------------------------------
   進行
   --------------------------------------------------------- */
function marbleClearTimer(){
  if (marble.timer){ clearTimeout(marble.timer); marble.timer = null; }
  if (marble.countTimer){ clearInterval(marble.countTimer); marble.countTimer = null; }
}

/* 会場を完全に止める(v4.2)
   最後の1人が抜けたら、投票中でもレース中でもその場で停止する。
   無人のサーバーでタイマーを回し続けないための処理。
   投票内容は退出時に消しているので、途中で止めても取りこぼしは起きない */
function stopMarbleHall(){
  marbleClearTimer();
  marble.phase = 'idle';
  marble.count = 0;
  marble.rushed = false;
  marble.balls = [];
  marble.odds = null;
  marble.order = [];
  marble.track = [];
  marble.tickets = new Map();
  marble.lastResult = null;
  marble.deadline = 0;
}

/* 会場から人がいなくなっていないか確かめ、いなければ止める */
/* 会場が無人なら止める。
   v4.6: ただし「まだ始まっていない投票受付中」に限る。

   投票せずに退出 → もう一度入り直すと出走表が作り直される、という
   やり直し(リセマラ)ができてしまっていたため、
   一度始まったレースは無人になっても最後まで裏で進めるようにした。
   止めてよいのは、次のレースを始める判断をするときだけ。 */
function checkMarbleEmpty(){
  if (marble.watchers.size === 0 && marble.phase !== 'idle'){
    stopMarbleHall();
    console.log('[marble] 会場が無人になったため停止しました');
    return true;
  }
  return false;
}

/* 投票受付の開始。会場に誰もいなければ止めておく(無駄に動かさない) */
function startMarbleBetting(io){
  marbleClearTimer();
  if (marble.watchers.size === 0){
    stopMarbleHall();
    return;
  }
  marble.raceNo++;
  marble.phase = 'bet';
  marble.balls = makeMarbleBalls();
  marble.odds = makeMarbleOdds(marble.balls);
  marble.order = [];
  marble.track = [];
  marble.lastResult = null;
  marble.tickets = new Map();
  marble.rushed = false;
  marble.deadline = Date.now() + MR_BET_MS;

  broadcastMarble(io);
  marble.timer = setTimeout(() => startMarbleCountdown(io), MR_BET_MS);
}

/* 会場にいる全員が投票し終えたら、締め切りを早める(v4.6)
   待ち時間を減らしてテンポよく回すための処理。
   一度早めたら戻さない(rushed)ので、
   あとから人が入ってきても締め切りが延びることはない */
function maybeRushMarble(io){
  if (marble.phase !== 'bet' || marble.rushed) return;
  if (marble.watchers.size === 0) return;

  for (const w of marble.watchers.values()){
    const t = marble.tickets.get(w.name);
    if (!t || !t.length) return;      // まだ投票していない人がいる
  }

  const left = marble.deadline - Date.now();
  if (left <= MR_RUSH_MS) return;     // すでに残りわずかなら何もしない

  marble.rushed = true;
  marble.deadline = Date.now() + MR_RUSH_MS;
  marbleClearTimer();
  marble.timer = setTimeout(() => startMarbleCountdown(io), MR_RUSH_MS);
  marbleChatSystem(io, '全員の投票が完了しました。まもなく締め切ります');
}

/* 締め切ってからスタートまでの秒読み(v4.3)
   ブラックジャックの開始前と同じ 3・2・1 の演出をレースにも入れた。
   着順はレース開始時に決めるので、ここではまだ何も抽選していない */
function startMarbleCountdown(io){
  marbleClearTimer();

  marble.phase = 'count';
  marble.count = MR_COUNT_SEC;
  marble.deadline = Date.now() + MR_COUNT_SEC * 1000;
  marble.message = '';
  broadcastMarble(io);

  marble.countTimer = setInterval(() => {
    marble.count--;
    if (marble.count <= 0){
      clearInterval(marble.countTimer);
      marble.countTimer = null;
      return startMarbleRace(io);
    }
    broadcastMarble(io);
  }, 1000);
}

/* レース本番。着順はこの瞬間に確定させ、演出データと一緒に配る */
function startMarbleRace(io){
  marbleClearTimer();
  marble.phase = 'race';   // v4.6: 始まったレースは無人でも最後まで走らせる
  marble.order = drawMarbleOrder(marble.balls);
  marble.track = makeMarbleTrack(marble.balls, marble.order);
  marble.deadline = Date.now() + MR_RACE_MS;

  broadcastMarble(io);
  marble.timer = setTimeout(() => finishMarbleRace(io), MR_RACE_MS);
}

/* 払い戻し */
async function finishMarbleRace(io){
  marbleClearTimer();
  marble.phase = 'result';
  marble.deadline = Date.now() + MR_RESULT_MS;

  const order = marble.order;
  const perUser = new Map();

  for (const [name, tickets] of marble.tickets){
    if (!tickets.length) continue;
    let payout = 0;
    const hits = [];
    let invest = 0;

    for (const t of tickets){
      invest += t.amount;
      if (mrTicketHit(t, order)){
        const pay = Math.floor(t.amount * t.odds);
        payout += pay;
        hits.push({ type: t.type, picks: t.picks, odds: t.odds, amount: t.amount, payout: pay });
      }
    }
    perUser.set(name, { payout, hits, invest });

    try {
      const u = await db.findUser(name);
      if (!u) continue;
      u.medal += payout;
      /* ランキングはマーブルレース単独で集計する */
      recordGain(u, payout - invest, 'marble');
      const up = applyMarbleResult(u, hits.length > 0);
      await db.saveUser(u);
      const w = marble.watchers.get(name);
      if (w && w.sid) io.to(w.sid).emit('account:update', { user: publicUser(u), levelUp: up });
    } catch (e){ console.error('[marble]', e.message); }
  }

  marble.lastResult = { order, perUser };
  broadcastMarble(io);

  /* 結果を会場チャットにも残しておくと、
     少し目を離していても何が起きたか追える(v4.5) */
  const win = marble.balls.find(b => b.no === order[0]);
  marbleChatSystem(io, 'RACE ' + marble.raceNo + ' 結果 … 1着 ' +
    order[0] + ' ' + (win ? win.name : '') +
    '(' + order.slice(0, 3).join('-') + ')');
  /* 誰も残っていなければ次のレースは始めない */
  if (checkMarbleEmpty()) return;
  marble.timer = setTimeout(() => startMarbleBetting(io), MR_RESULT_MS);
}

/* レース参加時のEXP。的中したらもう少し多めに */
const MR_EXP_RACE = 15;
const MR_EXP_HIT  = 25;
function applyMarbleResult(user, hit){
  user.mr_races = Number(user.mr_races || 0) + 1;
  if (hit) user.mr_hits = Number(user.mr_hits || 0) + 1;
  else user.mr_misses = Number(user.mr_misses || 0) + 1;
  return addExp(user, MR_EXP_RACE + (hit ? MR_EXP_HIT : 0));
}

/* =========================================================
   4.5 スロット(アイムジャグラーEX 6号機準拠)  ★v6.0で作り直し
   ---------------------------------------------------------
   ホールに6台。誰でも好きな空き台に座って打てる(先着順)。
   設定1〜6は台ごとに毎日0:00で振り直す。プレイヤーには一切見せない。

   ■ 遅延ゼロとズル防止を両立させる仕組み(v6.0)
     v5.0 … サーバーが停止位置まで決めていた → 押してから止まるまで通信待ちが出た
     v5.1 … ブラウザに全部任せた → 速いがズルし放題
     v6.0 … 「サーバーが当たりと種(seed)を決め、ブラウザが即座に止め、
             サーバーが同じ入力で計算し直して答え合わせする」

     停止制御は seed さえ同じなら必ず同じ答えになる(決定論的)ので、
     ブラウザは通信を待たずに止められるのに、結果はサーバーが握ったままになる。
     停止制御の本体は shared/slot-core.js に置いて、両者が同じものを読む。

   ■ 何が守れて、何が守れないか
     守れる … 出ていないボーナスを作る / 払い出しを水増しする / 設定を覗く
     守れない … 「押す位置」を機械的に選ぶ(自動目押し)
                → これは実機でも腕の差なので許容する
   ========================================================= */

const slotCore = require('./shared/slot-core.js');

/* 設定別確率。★サーバー専用。ブラウザには絶対に渡さないこと */
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
const SL_CHERRY_DUP_RATE = 0.25;

/* 設定の振り分け。既定は均等。
   低設定を厚くしたい場合は [40,25,15,10,6,4] のように重みを変える。
   変えたら必ず tests/t_rtp.js で全体の還元率を測り直すこと */
const SL_SETTING_WEIGHTS = [1, 1, 1, 1, 1, 1];

const SL_MACHINES   = 6;      // ホールの台数
const SL_PEKA_FIRST = 0.15;   // 先ペカ(レバーON時点灯)の割合。残り85%は後ペカ
const SL_CREDIT_MAX = 50;     // クレジット上限
const SL_RENT_MEDAL = 1000;   // 貸出1回で使う所持メダル
const SL_RENT_COIN  = 50;     // 貸出1回で得られるコイン(=1枚20メダル。20スロ)

/* 精算のレート(重要)。ここを貸出と同じ20にしてはいけない。
   実機の確率をそのまま使っているため還元率は
     設定1=98.5% 2=99.7% 3=101.5% 4=103.4% 5=106.0% 6=107.9%
   となり、均等に振ると全体102.8%でメダルが増え続けてしまう
   (ハイ&ローを1.28倍で撤去したときと同じ問題)。
   実際のホールと同じ「貸出20円・換金19円」の非等価にして約97.7%に収めている。
   数字を触るときは必ず tests/t_rtp.js で測り直すこと */
const SL_COIN_VALUE = 19;

const SL_WAIT_MS    = 4100;              // 実機規定のサイクルタイム
const SL_OFFLINE_MS = 10 * 60 * 1000;    // 切断から自動退席までの猶予(10分)
const SL_SWEEP_MS   = 30 * 1000;         // 自動退席の見回り間隔
const SL_SPIN_TTL   = 60 * 1000;         // 回し始めてこの時間で無効にする
const SL_ROOM       = 'slot-hall';       // ロビーの配信先

/* EXP。1ゲームでは増えすぎるので、ボーナスを引いたときだけ配る */
const SL_EXP_BB = 40;
const SL_EXP_RB = 20;

/* 予測できない乱数。抽選はすべてこれを使う */
function slRandom(){ return crypto.randomInt(1000000) / 1000000; }

function slPickSetting(){
  const total = SL_SETTING_WEIGHTS.reduce((a, b) => a + b, 0);
  let r = crypto.randomInt(total);
  for (let i = 0; i < SL_SETTING_WEIGHTS.length; i++){
    r -= SL_SETTING_WEIGHTS[i];
    if (r < 0) return i + 1;
  }
  return 1;
}

/* ---------------------------------------------------------
   ホールの台
   --------------------------------------------------------- */
function makeSlotMachine(no){
  return {
    no,
    setting: slPickSetting(),   // ★プレイヤーには絶対に見せない
    dayKey: jstDateKey(),

    /* 座席 */
    seat: null,          // username | null
    sid: null,           // 接続中のソケット。切断中は null
    level: 1,
    iconColor: DEFAULT_ICON_COLOR,
    offlineAt: 0,

    /* 台データ(0:00でリセット。着席していなくても全員に見せる) */
    bb: 0, rb: 0, startG: 0, totalG: 0,

    /* 手持ち。クレジットは50枚が上限で、あふれた分は下皿へ */
    credit: 0, tray: 0,
    invested: 0,         // この着席で投入したメダル総額(精算時の収支計算用)

    /* ゲーム進行 */
    phase: 'idle',       // idle | spin
    bet: 0,
    replayPending: 0,
    bonusFlag: null,     // 成立して未消化のボーナス
    lampLit: false,      // GOGO!CHANCE 点灯中
    lampPending: false,  // 後ペカ待ち
    inBonus: false,
    bonusType: null,
    bonusPaid: 0,
    bonusLog: [],

    /* 回している最中の情報。slot:spin で作り slot:stop で使う */
    spin: null,          // { id, flags, seed, bet, at }
    lastSpinAt: 0        // 前回レバーが効いた時刻(ウェイト用)
  };
}

const slotHall = [];
for (let i = 1; i <= SL_MACHINES; i++) slotHall.push(makeSlotMachine(i));

function slotById(no){
  const n = Math.floor(Number(no));
  return slotHall.find(m => m.no === n) || null;
}
function slotOf(name){
  return slotHall.find(m => m.seat === name) || null;
}

/* ---- コインの出し入れ ----
   払い出しを Math.min で切り捨てると枚数が消えるので、必ずこの関数を通す */
function slAddCoin(m, n){
  const add = Math.max(0, Math.floor(n));
  if (!add) return;
  const room = Math.max(0, SL_CREDIT_MAX - m.credit);
  const toCredit = Math.min(room, add);
  m.credit += toCredit;
  m.tray   += add - toCredit;
}
function slCoinTotal(m){ return m.credit + m.tray; }
function slTakeCoin(m, n){
  const want = Math.max(0, Math.floor(n));
  const use  = Math.min(want, slCoinTotal(m));
  if (!use) return 0;
  const fromCredit = Math.min(m.credit, use);
  m.credit -= fromCredit;
  m.tray   -= (use - fromCredit);
  return use;
}

/* BETできる上限。ボーナス中は2枚、通常は3枚 */
function slBetCap(m){ return m.inBonus ? 2 : 3; }

/* 合成確率。ボーナス0回のときは「---」にしたいので null を返す */
function slCombinedRate(m){
  const hit = m.bb + m.rb;
  if (!hit || !m.totalG) return null;
  return m.totalG / hit;
}

/* ロビーに出す台情報。★設定は絶対に含めないこと */
function slotLobby(){
  return {
    machines: slotHall.map(m => ({
      no: m.no,
      seat: m.seat,
      level: m.seat ? m.level : null,
      iconColor: m.seat ? m.iconColor : null,
      offline: !!(m.seat && !m.sid),
      bb: m.bb, rb: m.rb,
      startG: m.startG, totalG: m.totalG,
      rate: slCombinedRate(m)
    })),
    owner: OWNER_NAME
  };
}
function broadcastSlotLobby(io){
  io.to(SL_ROOM).emit('slot:lobby', slotLobby());
}

/* 着席している本人にだけ送る台の状態。★setting は入れない */
function slotState(m){
  return {
    no: m.no,
    credit: m.credit,
    tray: m.tray,
    coins: slCoinTotal(m),
    bet: m.bet,
    replayPending: m.replayPending,
    phase: m.phase,
    lampLit: m.lampLit,
    inBonus: m.inBonus,
    bonusType: m.bonusType,
    bonusPaid: m.bonusPaid,
    bb: m.bb, rb: m.rb,
    startG: m.startG, totalG: m.totalG,
    rate: slCombinedRate(m),
    invested: m.invested,
    waitMs: slSlotWaitLeft(m),
    bonusLog: m.bonusLog.slice(-50)
  };
}
function sendSlotState(io, m){
  if (m.sid) io.to(m.sid).emit('slot:state', slotState(m));
}

/* 前のゲームからの残りウェイト */
function slSlotWaitLeft(m){
  if (!m.lastSpinAt) return 0;
  return Math.max(0, SL_WAIT_MS - (Date.now() - m.lastSpinAt));
}

/* ---------------------------------------------------------
   抽選(レバーONのときサーバーが1回だけ実行)
   実行順序が極めて重要。この順番を変えないこと。
   --------------------------------------------------------- */
function slDrawGame(m){
  /* ボーナス中は抽選せず毎ゲーム必ずブドウ */
  if (m.inBonus){
    return { smallFlag: 'GRAPE', bonusFlag: null, dupCherry: false, peka: false };
  }

  const sp = SL_SETTINGS[m.setting - 1];
  let newBonus = false, rareHit = false, dupCherry = false;

  /* ステップ1: ボーナス抽選(フラグ未保持のときだけ)
     1つの乱数 r で BB / RB を連続判定する。別々の乱数を使わないこと */
  if (!m.bonusFlag){
    const r = slRandom();
    if (r < sp.bb){
      m.bonusFlag = 'BB'; newBonus = true;
      if (r < slRareCherryProb(m.setting)) rareHit = true;               // 中段チェリー(BB内数)
      else if (slRandom() < SL_CHERRY_DUP_RATE) dupCherry = true;        // チェリー重複BB
    } else if (r < sp.bb + sp.rb){
      m.bonusFlag = 'RB'; newBonus = true;
      if (slRandom() < SL_CHERRY_DUP_RATE) dupCherry = true;             // チェリー重複RB
    }
  }

  /* ステップ2: 小役抽選 */
  let smallFlag = null;
  if (rareHit) smallFlag = 'RARECHERRY';
  else if (dupCherry) smallFlag = 'CHERRY';
  else {
    const r2 = slRandom();
    let acc = 0;
    if      (r2 < (acc += sp.grape))     smallFlag = 'GRAPE';
    else if (r2 < (acc += SL_P_REPLAY))  smallFlag = 'REPLAY';
    else if (r2 < (acc += SL_P_CHERRY))  smallFlag = 'CHERRY';
    else if (r2 < (acc += SL_P_BELL))    smallFlag = 'BELL';
    else if (r2 < (acc += SL_P_CLOWN))   smallFlag = 'CLOWN';
  }

  /* GOGO!CHANCEの点灯タイミング(先ペカ15% / 後ペカ85%) */
  let peka = false;
  if (newBonus && !m.lampLit){
    if (slRandom() < SL_PEKA_FIRST){ m.lampLit = true; peka = true; }
    else m.lampPending = true;
  }

  return {
    smallFlag,
    bonusFlag: m.bonusFlag,
    dupCherry: !!(dupCherry || rareHit),
    peka
  };
}

/* ---------------------------------------------------------
   0:00 の設定変更。全台リセットして、座っている人は強制退席
   --------------------------------------------------------- */
async function resetSlotHall(io){
  const key = jstDateKey();
  for (const m of slotHall){
    if (m.seat){
      try { await cashOutSlot(io, m, 'reset'); }
      catch (e){ console.error('[slot] 0時精算に失敗:', e.message); }
    }
    const fresh = makeSlotMachine(m.no);
    fresh.dayKey = key;
    Object.assign(m, fresh);
  }
  broadcastSlotLobby(io);
  console.log('[slot] 設定を振り直しました(' + key + ')');
}

/* ---------------------------------------------------------
   精算(退席)
   reason: 'manual' | 'offline' | 'reset'
   --------------------------------------------------------- */
async function cashOutSlot(io, m, reason){
  const name = m.seat;
  if (!name) return null;

  const coins  = slCoinTotal(m) + m.bet;   // BET中のぶんも返す
  const medal  = coins * SL_COIN_VALUE;
  const invest = m.invested;
  const sid    = m.sid;

  /* 先に席を空ける。DBアクセス中に別の人が座れるようにしておく */
  const keep = { bb: m.bb, rb: m.rb, startG: m.startG, totalG: m.totalG,
                 setting: m.setting, dayKey: m.dayKey, bonusLog: m.bonusLog };
  Object.assign(m, makeSlotMachine(m.no), keep);

  let user = null;
  try {
    const u = await db.findUser(name);
    if (u){
      u.medal = Number(u.medal || 0) + medal;
      /* ランキングは精算時の収支(戻り - 投入)で1回だけ記録する */
      recordGain(u, medal - invest, 'slot');
      await db.saveUser(u);
      user = publicUser(u);
    }
  } catch (e){ console.error('[slot] 精算:', e.message); }

  if (sid){
    io.to(sid).emit('slot:cashout', {
      reason, coins, medal, invest, gain: medal - invest, user
    });
    const sock = io.sockets.sockets.get(sid);
    if (sock) sock.leave(SL_ROOM + ':' + m.no);
  } else if (reason === 'offline'){
    pushNotice(name, 'slot',
      'スロットを自動退席しました',
      'オフラインになって10分が経過したため、スロットは自動退席しました。' +
      'コイン ' + coins + '枚 を ' + medal + 'メダルとして精算しています。');
  }

  broadcastSlotLobby(io);
  return { coins, medal };
}

/* Renderがスリープして 0:00 のタイマーが飛んだ場合の保険 */
let slotResetting = false;
function slotDayGuard(){
  if (slotResetting) return;
  const key = jstDateKey();
  if (slotHall.every(m => m.dayKey === key)) return;
  slotResetting = true;
  resetSlotHall(io)
    .catch(e => console.error('[slot] 振り直しに失敗:', e.message))
    .finally(() => { slotResetting = false; });
}

/* 切断したまま10分たった人を降ろす見回り。
   ついでに、回したまま放置された台も元に戻す */
function slotSweep(io){
  const now = Date.now();
  for (const m of slotHall){
    /* 回しっぱなしで放置された台を戻す */
    if (m.spin && now - m.spin.at > SL_SPIN_TTL){
      m.spin = null;
      m.phase = 'idle';
      m.bet = 0;
      sendSlotState(io, m);
    }
    if (!m.seat || m.sid) continue;
    if (!m.offlineAt || now - m.offlineAt < SL_OFFLINE_MS) continue;
    cashOutSlot(io, m, 'offline').catch(e => console.error('[slot]', e.message));
  }
}

/* テストから内部の状態を確かめる入り口。
   SLOT_TEST_HOOKS=1 を付けて起動したときだけ有効。本番では触れない */
if (process.env.SLOT_TEST_HOOKS === '1'){
  global.__slotTestHooks = {
    hall:  () => slotHall,
    reset: () => resetSlotHall(io),
    sweep: () => slotSweep(io),
    core:  slotCore
  };
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

/* 大会用メダルを使うモード(チャンピオン / 早抜け)かどうか */
function isTourney(mode){ return mode === 'champion' || mode === 'sprint'; }

/* 部屋を作れるゲーム。マーブルレースは部屋を使わず
   常時開催の会場で遊ぶので、ここには含めない(v4.1) */
const ROOM_GAMES = ['bj'];

function createRoom(opts){
  /* v4.1: 部屋を持たないゲームが指定されたらブラックジャックとして扱う */
  const asked = normGame(opts.game);
  const game = ROOM_GAMES.includes(asked) ? asked : DEFAULT_GAME;
  const mode = ['champion', 'sprint'].includes(opts.mode) ? opts.mode : 'enjoy';
  const room = {
    id: makeRoomId(),
    game,
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
    /* 早抜けモード(v3.2): この枚数を「超える」と勝ち抜け */
    sprintGoal: mode === 'sprint'
      ? Math.min(Math.max(Number(opts.sprintGoal) || SPRINT_GOAL_DEFAULT,
                          SPRINT_GOAL_MIN), SPRINT_GOAL_MAX)
      : null,
    finishers: [],          // 勝ち抜けた順の名前(早抜けモード)
    hostName: null,
    players: [],            // {name, sid, cpu, level, medal, bet, hand, done, surrendered, ready, connected, eliminated}
    spectators: [],         // {name, sid, level, iconColor} 途中観戦(v3.0)
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

/* 部屋一覧(v3.0)
   ゲーム中の部屋も消さずに残し、「試合中」として観戦できるようにする */
function roomList(){
  const out = [];
  for (const r of rooms.values()){
    if (r.phase === 'champion_end') continue;
    const humanN = r.players.filter(p => !p.cpu).length;
    if (humanN === 0) continue;
    const playing = r.phase !== 'lobby';
    out.push({
      id: r.id, count: humanN, max: r.maxPlayers, host: r.hostName,
      game: r.game || DEFAULT_GAME,
      mode: r.mode, championRounds: r.championRounds, sprintGoal: r.sprintGoal, cpuFill: r.cpuFill,
      playing,
      full: humanN >= r.maxPlayers,
      spectators: r.spectators.length
    });
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

function findRoomBySid(sid){
  for (const r of rooms.values())
    if (r.players.some(p => p.sid === sid)) return r;
  return null;
}

/* 観戦者として入っている部屋 */
function findRoomBySpectator(sid){
  for (const r of rooms.values())
    if (r.spectators.some(s => s.sid === sid)) return r;
  return null;
}

/* プレイヤー・観戦者のどちらでも参加している部屋 */
function findAnyRoom(sid){
  return findRoomBySid(sid) || findRoomBySpectator(sid);
}

function humanCount(room){ return room.players.filter(p => !p.cpu).length; }

/* ホスト以外の参加者が全員「準備完了」を押しているか */
function guestsReady(room){
  const guests = room.players.filter(p => !p.cpu && p.name !== room.hostName);
  return guests.length > 0 && guests.every(p => p.lobbyReady);
}
function activePlayers(room){ return room.players.filter(p => !p.eliminated); }

/* 手札は自分以外にも見せる(ブラックジャックは公開情報) */
function roomState(room, forName, asSpectator){
  const dealerHand = room.dealer.hand.map((c, i) =>
    (room.dealer.hole && i === 1) ? null : c);

  return {
    id: room.id,
    game: room.game || DEFAULT_GAME,
    mode: room.mode,
    phase: room.phase,
    maxPlayers: room.maxPlayers,
    cpuFill: room.cpuFill,
    championRounds: room.championRounds,
    sprintGoal: room.sprintGoal,
    finishers: room.finishers ? room.finishers.slice() : [],
    hostName: room.hostName,
    isHost: !asSpectator && forName === room.hostName,
    isSpectator: !!asSpectator,
    spectatorCount: room.spectators.length,
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
      /* 早抜けモード(v3.2) */
      finished: !!p.finished,
      finishRank: p.finishRank || null,
      retired: !!p.retired,
      isYou: p.name === forName
    }))
  };
}

function broadcast(io, room){
  for (const p of room.players){
    if (!p.sid) continue;
    io.to(p.sid).emit('room:state', roomState(room, p.name));
  }
  /* 観戦者にも同じ盤面を送る(操作はできない)(v3.0) */
  for (const s of room.spectators){
    if (!s.sid) continue;
    io.to(s.sid).emit('room:state', roomState(room, s.name, true));
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
      if (isTourney(room.mode)){
        for (const p of room.players){
          p.medal = CHAMPION_START_MEDAL;
          p.eliminated = false;
          p.eliminatedAtRound = null;
          p.scoredRounds = 0;   // サレンダー以外で勝負したラウンド数
          p.finished = false;        // 早抜け: 条件を達成したか(v3.2)
          p.finishRank = null;
          p.retired = false;
        }
        room.finishers = [];
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
  for (const s of room.spectators){
    if (!s.sid) continue;
    io.to(s.sid).emit('room:countdown', { n });
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
          /* ランキング用の記録(v3.2)。純増分だけを数える。
             ログインボーナスや広告は対象外なのでここでは触らない */
          recordGain(u, p.result.payout - p.bet, 'bj');
          const up = applyEnjoyResult(u, p.result.kind);
          await db.saveUser(u);
          p.level = u.level;
          if (p.sid) io.to(p.sid).emit('account:update', { user: publicUser(u), levelUp: up });
        }
      } catch (e){ console.error('[result]', e.message); }
    }

    /* サレンダーはEXP計算の対象外。実際に勝負したラウンドだけ数える */
    if (isTourney(room.mode) && !p.surrendered && p.bet > 0){
      p.scoredRounds = (p.scoredRounds || 0) + 1;
    }

    if (isTourney(room.mode) && p.medal <= 0 && !p.eliminated){
      p.medal = 0;
      p.eliminated = true;
      p.eliminatedAtRound = room.round;
      if (room.mode === 'sprint') p.retired = true;   // 早抜けではリタイア扱い
    }
  }

  /* 早抜け: 目標を「超えた」人を、そのラウンドで抜けた扱いにする(v3.2)
     同じラウンドで複数人が達成したときは、そのラウンドのベット額が多い方が上位 */
  if (room.mode === 'sprint'){
    const cleared = room.players
      .filter(p => !p.finished && !p.eliminated && p.medal > room.sprintGoal)
      .sort((a, b) => (b.bet - a.bet) || String(a.name).localeCompare(String(b.name)));
    for (const p of cleared){
      p.finished = true;
      p.eliminated = true;                 // 以降は観戦にする
      p.eliminatedAtRound = room.round;
      p.finishRank = room.finishers.length + 1;
      room.finishers.push(p.name);
      chatSystem(io, room, p.name + ' さんが ' + room.sprintGoal +
                 ' メダルを突破! (' + p.finishRank + '抜け)');
    }
  }

  room.message = 'ラウンド終了';
  broadcast(io, room);

  if (room.mode === 'champion') await maybeEndChampionship(io, room);
  else if (room.mode === 'sprint') await maybeEndSprint(io, room);
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
   7.5 早抜けモードの終了判定・EXP付与(v3.2)

   ・目標を超えた人から順に勝ち抜け(勝ち抜けた時点で観戦になる)
   ・残りが1人になった瞬間に終了。その1人はリタイア扱いで順位は「-」
   ・メダルが尽きた人もリタイア
   ・EXPは抜けた順位で固定。ラウンド数や目標枚数では変わらない
   ・全員がリタイア(誰も抜けられなかった)ときは全員0EXP
   ========================================================= */
async function maybeEndSprint(io, room){
  /* まだ勝負を続けられる人 */
  const alive = room.players.filter(p => !p.eliminated);
  /* 残り1人になったら終了。全員抜けた/全滅した場合も終了 */
  if (alive.length > 1) return;
  if (room.players.length <= 1 && alive.length === 1) return;

  /* 最後まで残った1人はリタイア扱い */
  for (const p of alive){
    p.eliminated = true;
    p.retired = true;
    p.eliminatedAtRound = room.round;
  }

  const anyFinished = room.players.some(p => p.finished);

  /* 抜けた順 → リタイア(遅く落ちたほど上) の順に並べる */
  const ranked = [...room.players].sort((a, b) => {
    if (a.finished !== b.finished) return a.finished ? -1 : 1;
    if (a.finished) return a.finishRank - b.finishRank;
    return (b.eliminatedAtRound || 0) - (a.eliminatedAtRound || 0);
  });

  const results = [];
  for (const p of ranked){
    let expGain, rankKind, rank;
    if (p.finished){
      rank = p.finishRank;
      expGain = SPRINT_EXP[rank - 1] || SPRINT_EXP[SPRINT_EXP.length - 1];
      rankKind = rank === 1 ? 'win' : 'lose';
    } else {
      /* リタイアは順位なし。誰も抜けられなかった場合はEXPも0 */
      rank = null;
      expGain = anyFinished ? SPRINT_EXP_RETIRE : 0;
      rankKind = 'lose';
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
      } catch (e){ console.error('[sprint]', e.message); }
    }

    results.push({
      name: p.name, cpu: !!p.cpu, rank, medal: p.medal,
      eliminated: !p.finished, retired: !p.finished,
      expGain, rankKind, sprintGoal: room.sprintGoal
    });

    if (p.sid && userAfter) io.to(p.sid).emit('account:update', { user: userAfter, levelUp });
  }

  room.standings = results;
  room.phase = 'champion_end';
  room.message = anyFinished ? '早抜け終了' : '全員リタイアで終了';
  broadcast(io, room);
  broadcastLobby(io);
}

/* =========================================================
   8. HTTP API
   ========================================================= */
const app = express();
app.use(express.json({ limit: '16kb' }));
app.use(express.static(path.join(__dirname), { extensions: ['html'] }));

/* APIの応答が確実にJSONになるようにする(v3.2 修正)。
   静的配信が先に効いていると、/api/... のエラー時に
   HTMLのページが返ってしまい、外部cronから見ると
   「HTMLが返ってきた」「サイズが大きすぎる」という失敗になる。 */
app.use('/api', (req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});

/* 認証に失敗したときの返事。
   v4.2: 別の端末でログインされた場合は code を付けて画面側に知らせる。
   画面はこれを見て、強制的にログアウトしてタイトルへ戻す */
function authFail(res, msg){
  if (res.req && res.req.__sessionExpired){
    return res.status(401).json({
      error: '別の端末でログインされました', code: 'session'
    });
  }
  return res.status(401).json({ error: msg });
}

/* ログイン中のユーザーを返す。
   トークンが古い(別端末でログインし直された)ときは null を返しつつ、
   req に目印を付けて authFail が理由を出せるようにしている */
async function currentUser(req){
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : '';
  const t = readToken(token);
  if (!t) return null;
  const u = await db.findUser(t.name);
  if (!u) return null;
  if (!sessionValid(u, t.sid)){
    req.__sessionExpired = true;
    return null;
  }
  return u;
}

/* 最終ログイン時刻を更新する(短時間の連打では書き込まない) */
const TOUCH_INTERVAL_MS = 60 * 1000;
async function touchLogin(u){
  const prev = u.last_login ? new Date(u.last_login).getTime() : 0;
  if (Date.now() - prev < TOUCH_INTERVAL_MS) return;
  u.last_login = new Date();
  await db.saveUser(u);
}

/* =========================================================
   8.7 ログインボーナス(v3.2)
   その日はじめてアクセスすると500枚、広告を最後まで見るとさらに500枚。
   区切りはJSTの0:00。ランキングの集計対象には入れない。
   ========================================================= */
const BONUS_MEDAL    = 500;   // 基本
const BONUS_AD_MEDAL = 500;   // 広告視聴の追加分

/* ログイン日数の記録を更新する。受け取り可能かどうかも返す */
function updateLoginDays(u){
  const today = jstDateKey();
  const last = u.bonus_date || null;
  if (last === today) return false;   // 今日はもう数えた

  const yesterday = shiftDateKey(today, -1);
  u.login_streak = (last === yesterday) ? (u.login_streak || 0) + 1 : 1;
  u.login_days = (u.login_days || 0) + 1;
  return true;
}

/* 今日のボーナスの状況を返す */
function bonusState(u){
  const today = jstDateKey();
  return {
    date: today,
    claimed: u.bonus_date === today,
    adClaimed: u.bonus_ad_date === today,
    base: BONUS_MEDAL,
    ad: BONUS_AD_MEDAL
  };
}

app.get('/api/bonus', async (req, res) => {
  const u = await currentUser(req);
  if (!u) return authFail(res, '認証が必要です');
  res.json(bonusState(u));
});

app.post('/api/bonus', async (req, res) => {
  const u = await currentUser(req);
  if (!u) return authFail(res, '認証が必要です');

  const today = jstDateKey();
  if (u.bonus_date === today)
    return res.status(409).json({ error: '本日のログインボーナスは受け取り済みです' });

  updateLoginDays(u);
  u.bonus_date = today;
  u.medal += BONUS_MEDAL;
  await db.saveUser(u);

  await pushNotice(u.username, 'bonus', 'ログインボーナスを受け取りました',
    BONUS_MEDAL + ' メダルを獲得しました。連続ログイン ' + u.login_streak + '日目です。');

  res.json({
    user: publicUser(u), reward: BONUS_MEDAL,
    streak: u.login_streak, days: u.login_days,
    state: bonusState(u)
  });
});

/* 広告を最後まで見たときの追加分。基本ボーナスを受け取ってからでないと押せない */
app.post('/api/bonus/ad', async (req, res) => {
  const u = await currentUser(req);
  if (!u) return authFail(res, '認証が必要です');

  const today = jstDateKey();
  if (u.bonus_date !== today)
    return res.status(400).json({ error: '先にログインボーナスを受け取ってください' });
  if (u.bonus_ad_date === today)
    return res.status(409).json({ error: '本日の追加ボーナスは受け取り済みです' });

  u.bonus_ad_date = today;
  u.medal += BONUS_AD_MEDAL;
  await db.saveUser(u);

  res.json({ user: publicUser(u), reward: BONUS_AD_MEDAL, state: bonusState(u) });
});

/* 広告を見ずに閉じた場合。その日はもう案内しない(v3.2)
   受け取り済みと同じ扱いにして、タイトルのボタンも消す */
app.post('/api/bonus/skipad', async (req, res) => {
  const u = await currentUser(req);
  if (!u) return authFail(res, '認証が必要です');

  const today = jstDateKey();
  if (u.bonus_date !== today)
    return res.status(400).json({ error: 'ログインボーナスを受け取っていません' });

  if (u.bonus_ad_date !== today){
    u.bonus_ad_date = today;   // メダルは渡さず、案内だけ終了させる
    await db.saveUser(u);
  }
  res.json({ user: publicUser(u), state: bonusState(u) });
});

function blankUserRow(username, pass_hash){
  return {
    username, pass_hash, medal: INITIAL_MEDAL, level: 1, exp: 0,
    rounds: 0, wins: 0, losses: 0, pushes: 0, bj: 0,
    champ_plays: 0, champ_wins: 0, champ_losses: 0, champ_draws: 0,
    last_login: null, icon_color: DEFAULT_ICON_COLOR,
    /* ランキング・ログインボーナス(v3.2) */
    total_gain: 0, best_gain: 0, best_gain_at: null,
    day_key: null, day_gain: 0, day_best: 0,
    bonus_date: null, bonus_ad_date: null,
    login_streak: 0, login_days: 0,
    created_at: new Date(),
    /* マーブルレース(v4.1) */
    mr_total_gain: 0, mr_best_gain: 0, mr_best_gain_at: null,
    mr_day_key: null, mr_day_gain: 0, mr_day_best: 0,
    mr_races: 0, mr_hits: 0, mr_misses: 0,
    /* スロット(v5.0) */
    sl_total_gain: 0, sl_best_gain: 0, sl_best_gain_at: null,
    sl_day_key: null, sl_day_gain: 0, sl_day_best: 0,
    sl_games: 0, sl_bb: 0, sl_rb: 0,
    /* 同時ログイン制限(v4.2) */
    session_id: null
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
    row.session_id = newSessionId();          // v4.2
    await db.createUser(row);
    res.json({ token: makeToken(username, row.session_id), user: publicUser(row) });
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
    /* v4.2: ログインし直すと新しい識別子になるので、
       それまで使っていた端末のトークンは自動的に無効になる */
    const sid = newSessionId();
    u.session_id = sid;
    await db.saveUser(u);
    kickOtherSessions(u.username, sid);
    res.json({ token: makeToken(u.username, sid), user: publicUser(u) });
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

/* パスワード変更(v3.1)。現在のパスワードを確認してから差し替える */
app.post('/api/password', async (req, res) => {
  const u = await currentUser(req);
  if (!u) return authFail(res, '認証が必要です');

  const current = String(req.body?.current || '');
  const next = String(req.body?.next || '');

  if (!verifyPassword(current, u.pass_hash))
    return res.status(401).json({ error: '現在のパスワードが違います' });
  if (!PASS_RE.test(next))
    return res.status(400).json({ error: '新しいパスワードは英数字1〜8文字です' });
  if (current === next)
    return res.status(400).json({ error: '現在のパスワードと同じです' });

  try {
    u.pass_hash = hashPassword(next);
    /* 変更後は今のトークンだけを有効にし、他端末のセッションは切る */
    const sid = newSessionId();
    u.session_id = sid;
    await db.saveUser(u);
    kickOtherSessions(u.username, sid);
    const token = makeToken(u.username, sid);
    res.json({ ok: true, token, user: publicUser(u) });
  } catch (e){
    console.error('[password]', e);
    res.status(500).json({ error: 'パスワードの変更に失敗しました' });
  }
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
/* シングルプレイの結果反映
   v3.2: シングルは練習モードになり、アカウントのメダルは増減しない。
   EXPと戦績だけを記録する(practice=true)。
   旧クライアントからの bet/payout 付きリクエストも受け付けるが、
   メダルの更新は行わない。 */
app.post('/api/result', async (req, res) => {
  const u = await currentUser(req);
  if (!u) return authFail(res, '認証が必要です');

  const kind = String(req.body?.kind || '');
  if (!['win','lose','push','bj','surrender'].includes(kind))
    return res.status(400).json({ error: '不正な結果です' });

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

/* =========================================================
   8.4 フレンド機能(v3.0)
   関係は friends テーブルに1行で持ち、user_a < user_b に正規化する。
   status: 'pending'(申請中) | 'accepted'(成立)
   ========================================================= */
function linkKey(a, b){ return a < b ? { user_a: a, user_b: b } : { user_a: b, user_b: a }; }
function otherSide(link, me){ return link.user_a === me ? link.user_b : link.user_a; }

/* 相手がログイン中(Socket接続中)かどうか */
function isOnline(username){
  for (const [, sock] of io.of('/').sockets){
    if (sock.data && sock.data.name === username) return true;
  }
  return false;
}

function socketsOf(username){
  const out = [];
  for (const [, sock] of io.of('/').sockets){
    if (sock.data && sock.data.name === username) out.push(sock);
  }
  return out;
}

/* フレンド関係に変化があったことを本人たちに伝える */
function notifyFriends(names){
  for (const n of names){
    for (const s of socketsOf(n)) s.emit('friend:update');
  }
}

async function friendPayload(me){
  const links = await db.listLinks(me);
  const friends = [], incoming = [], outgoing = [];

  for (const l of links){
    const other = otherSide(l, me);
    const u = await db.findUser(other);
    if (!u) continue;
    const info = {
      username: u.username,
      level: u.level,
      iconColor: ICON_COLORS.includes(u.icon_color) ? u.icon_color : DEFAULT_ICON_COLOR,
      lastLogin: u.last_login ? new Date(u.last_login).toISOString() : null,
      online: isOnline(u.username)
    };
    if (l.status === 'accepted') friends.push(info);
    else if (l.requester === me) outgoing.push(info);
    else incoming.push(info);
  }

  const byName = (a, b) => String(a.username).localeCompare(String(b.username));
  /* ログイン中の人を上に出す */
  friends.sort((a, b) => (b.online - a.online) || byName(a, b));
  incoming.sort(byName);
  outgoing.sort(byName);
  return {
    friends, incoming, outgoing,
    onlineCount: friends.filter(f => f.online).length
  };
}

/* 自分をフレンドに持っている人へ「一覧を更新して」と伝える。
   ログイン・ログアウトでオンライン人数の表示を追従させるために使う(v3.1) */
async function notifyFriendPresence(username){
  try {
    const links = await db.listLinks(username);
    const names = links
      .filter(l => l.status === 'accepted')
      .map(l => otherSide(l, username));
    notifyFriends(names);
  } catch (e){ console.error('[presence]', e.message); }
}

app.get('/api/friends', async (req, res) => {
  const u = await currentUser(req);
  if (!u) return authFail(res, '認証が必要です');
  try {
    res.json(await friendPayload(u.username));
  } catch (e){
    console.error('[friends]', e);
    res.status(500).json({ error: 'フレンド情報の取得に失敗しました' });
  }
});

app.post('/api/friends/request', async (req, res) => {
  const u = await currentUser(req);
  if (!u) return authFail(res, '認証が必要です');
  const target = String(req.body?.username || '');
  if (target === u.username) return res.status(400).json({ error: '自分には申請できません' });

  const t = await db.findUser(target);
  if (!t) return res.status(404).json({ error: 'そのユーザーは見つかりません' });

  const existing = await db.findLink(u.username, target);
  if (existing){
    if (existing.status === 'accepted') return res.status(409).json({ error: 'すでにフレンドです' });
    if (existing.requester === u.username) return res.status(409).json({ error: 'すでに申請済みです' });
    /* 相手からの申請が来ていたら、その場で成立させる */
    existing.status = 'accepted';
    await db.saveLink(existing);
    notifyFriends([u.username, target]);
    await pushNotice(target, 'friend', 'フレンドになりました',
      u.username + ' さんとフレンドになりました。');
    for (const s of socketsOf(target)) s.emit('friend:accepted', { username: u.username });
    return res.json({ ok: true, accepted: true });
  }

  const link = Object.assign(linkKey(u.username, target), {
    status: 'pending', requester: u.username
  });
  await db.saveLink(link);
  notifyFriends([u.username, target]);
  await pushNotice(target, 'friend', 'フレンド申請が届きました',
    u.username + ' さんからフレンド申請が届いています。');
  for (const s of socketsOf(target)) s.emit('friend:request', { username: u.username });
  res.json({ ok: true, accepted: false });
});

app.post('/api/friends/accept', async (req, res) => {
  const u = await currentUser(req);
  if (!u) return authFail(res, '認証が必要です');
  const target = String(req.body?.username || '');

  const link = await db.findLink(u.username, target);
  if (!link || link.status !== 'pending') return res.status(404).json({ error: 'その申請は見つかりません' });
  if (link.requester === u.username) return res.status(400).json({ error: '自分が送った申請です' });

  link.status = 'accepted';
  await db.saveLink(link);
  notifyFriends([u.username, target]);
  await pushNotice(target, 'friend', 'フレンドになりました',
    u.username + ' さんがフレンド申請を承認しました。');
  for (const s of socketsOf(target)) s.emit('friend:accepted', { username: u.username });
  res.json({ ok: true });
});

app.post('/api/friends/reject', async (req, res) => {
  const u = await currentUser(req);
  if (!u) return authFail(res, '認証が必要です');
  const target = String(req.body?.username || '');

  const link = await db.findLink(u.username, target);
  if (!link || link.status !== 'pending') return res.status(404).json({ error: 'その申請は見つかりません' });

  await db.deleteLink(u.username, target);
  notifyFriends([u.username, target]);
  res.json({ ok: true });
});

app.delete('/api/friends', async (req, res) => {
  const u = await currentUser(req);
  if (!u) return authFail(res, '認証が必要です');
  const target = String(req.body?.username || '');

  const link = await db.findLink(u.username, target);
  if (!link) return res.status(404).json({ error: 'フレンドではありません' });

  await db.deleteLink(u.username, target);
  notifyFriends([u.username, target]);
  res.json({ ok: true });
});

/* =========================================================
   8.6 ランキング / 通知(v3.2)

   集計はJSTの0:00区切り。Renderの無料プランはスリープするので、
   「タイマーでの定時実行」と「アクセス時の取りこぼし確認」を
   二重に走らせて、どちらか片方が動けば必ず確定するようにしている。
   ========================================================= */
const RANK_LIMIT   = 100;   // 表示するのはTOP100まで
const RANK_KEEP_DAYS = 3;   // 日次ランキングの保存日数(前日分が見られれば十分)
const NOTICE_KEEP  = 50;    // 1人あたりの通知の保持件数

/* 通知を1件積む。接続中なら未読数の更新も伝える */
async function pushNotice(username, kind, title, body){
  try {
    await db.addNotice({ username, kind, title, body: body || '' });
    await db.trimNotices(username, NOTICE_KEEP);
    for (const s of socketsOf(username)) s.emit('notice:new');
  } catch (e){ console.error('[notice]', e.message); }
}

/* 勝ちで得たメダルを記録する。ログインボーナスや広告は対象外(v3.2)
   gain には「配当 - ベット」の純増分を渡すこと。
   v4.0: ランキングをゲームごとに分けたので、game('bj' | 'marble')も渡す */
function recordGain(user, gain, game){
  const g = Math.floor(Number(gain) || 0);
  if (g <= 0) return;
  const F = RANK_FIELDS[normGame(game)];

  /* DBから来た値が文字列だと加算が文字列連結になってしまうので、
     必ず数値に直してから足す(v3.2で発生した不具合の対策) */
  const num = (v) => {
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  };

  const key = jstDateKey();
  if (user[F.dayKey] !== key){
    user[F.dayKey] = key;
    user[F.dayGain] = 0;
    user[F.dayBest] = 0;
  }
  user[F.dayGain] = num(user[F.dayGain]) + g;
  if (g > num(user[F.dayBest])) user[F.dayBest] = g;

  user[F.total] = num(user[F.total]) + g;
  if (g > num(user[F.best])){
    user[F.best] = g;
    user[F.bestAt] = key;
  }
}

/* 同じ数字は同じ順位にし、次の順位は人数分飛ばす(1位,1位,3位) */
function withRanks(rows, valueOf){
  let rank = 0, prev = null;
  return rows.map((r, i) => {
    const v = valueOf(r);
    if (prev === null || v !== prev){ rank = i + 1; prev = v; }
    return Object.assign({ rank }, r);
  });
}

function sortByValue(rows, valueOf){
  return rows.slice().sort((a, b) =>
    (valueOf(b) - valueOf(a)) || String(a.username).localeCompare(String(b.username)));
}

/* 指定日のランキングを組み立てる。
   確定済みなら rank_daily から、当日進行中なら users から直接読む */
async function buildRanking(key, live, game){
  const rows = live
    ? (await db.liveDay(key, normGame(game), 5000)).map(r => ({
        username: r.username, level: r.level, icon_color: r.icon_color,
        total_gain: r.day_gain, best_gain: r.day_best
      }))
    : await db.getDailyRanks(key, normGame(game));

  const total = withRanks(
    sortByValue(rows.filter(r => r.total_gain > 0), r => r.total_gain),
    r => r.total_gain).slice(0, RANK_LIMIT);
  const best = withRanks(
    sortByValue(rows.filter(r => r.best_gain > 0), r => r.best_gain),
    r => r.best_gain).slice(0, RANK_LIMIT);

  const shape = (r) => ({
    rank: r.rank, username: r.username, level: r.level,
    iconColor: ICON_COLORS.includes(r.icon_color) ? r.icon_color : DEFAULT_ICON_COLOR
  });
  return {
    total: total.map(r => Object.assign(shape(r), { medal: Number(r.total_gain) })),
    best:  best.map(r => Object.assign(shape(r), { medal: Number(r.best_gain) }))
  };
}

/* 歴代の一撃ランキング */
async function buildAllTimeBest(game){
  const rows = await db.topAllTimeBest(normGame(game), RANK_LIMIT);
  return withRanks(rows, r => Number(r.best_gain)).map(r => ({
    rank: r.rank, username: r.username, level: r.level,
    iconColor: ICON_COLORS.includes(r.icon_color) ? r.icon_color : DEFAULT_ICON_COLOR,
    medal: Number(r.best_gain),
    date: r.best_gain_at || null
  }));
}

/* 指定日・指定ゲームの集計を確定し、入賞者に通知を送る(v4.0) */
async function settleDayGame(key, game){
  const g = normGame(game);
  const rows = await db.usersWithDay(key, g);
  if (!rows.length) return 0;

  await db.saveDailyRanks(key, g, rows);

  const total = withRanks(sortByValue(rows.filter(r => r.day_gain > 0), r => Number(r.day_gain)),
                          r => Number(r.day_gain)).slice(0, RANK_LIMIT);
  const best  = withRanks(sortByValue(rows.filter(r => r.day_best > 0), r => Number(r.day_best)),
                          r => Number(r.day_best)).slice(0, RANK_LIMIT);

  const label = shortDate(key) + ' ' + GAME_LABEL[g];
  for (const r of total){
    await pushNotice(r.username, 'rank',
      label + ' 総獲得枚数ランキング ' + r.rank + '位',
      '獲得メダル ' + Number(r.day_gain).toLocaleString() + ' 枚で ' + r.rank + '位に入賞しました。');
  }
  for (const r of best){
    await pushNotice(r.username, 'rank',
      label + ' 一撃獲得枚数ランキング ' + r.rank + '位',
      '一撃 ' + Number(r.day_best).toLocaleString() + ' 枚で ' + r.rank + '位に入賞しました。');
  }
  return rows.length;
}

/* 指定日の集計を全ゲームまとめて確定する。
   確定済みの目印(lastSettled)は日付だけで持つので、
   ここで必ず全ゲームを処理しきること */
async function settleDay(key){
  let n = 0;
  for (const g of GAMES) n += await settleDayGame(key, g);
  await db.setLastSettled(key);
  await db.purgeDailyRanks(shiftDateKey(jstDateKey(), -RANK_KEEP_DAYS));
  console.log('[rank] ' + key + ' を確定しました(のべ' + n + '人)');
}

/* まだ確定していない過去の日をまとめて処理する。
   スリープで定時実行を逃しても、次のアクセスでここが拾う */
let settling = false;
async function catchUpSettle(){
  if (settling) return;
  settling = true;
  try {
    const today = jstDateKey();
    const last = await db.lastSettled();
    if (!last){
      /* 初回起動時は前日までを確定済み扱いにする(過去分は集計対象外) */
      await db.setLastSettled(shiftDateKey(today, -1));
      return;
    }
    /* last の翌日から「昨日」までを順に確定する。当日はまだ確定しない */
    let key = shiftDateKey(last, 1);
    let guard = 0;
    while (key < today && guard++ < 400){
      await settleDay(key);
      key = shiftDateKey(key, 1);
    }
  } catch (e){
    console.error('[rank] 確定に失敗:', e.message);
  } finally {
    settling = false;
  }
}

/* JSTの0:00ちょうどに確定を走らせる。スリープで飛んだ場合は
   起動時と各アクセス時の catchUpSettle が肩代わりする */
function scheduleMidnight(){
  const wait = msUntilNextJstMidnight() + 3000;   // 日付が確実に変わってから
  setTimeout(async () => {
    /* ここで例外が漏れると、次回の予約がされず定時処理が二度と動かなくなる。
       何があっても必ず再予約する(v3.2 修正) */
    try {
      await catchUpSettle();
      /* スロットの設定を振り直す(v5.0)。座っている人は精算して降ろす */
      await resetSlotHall(io);
      /* 接続中の全員に日付が変わったことを伝える */
      for (const [, sock] of io.of('/').sockets) sock.emit('day:changed', { date: jstDateKey() });
    } catch (e){
      console.error('[rank] 定時処理でエラー:', e.message);
    } finally {
      scheduleMidnight();
    }
  }, wait);
}

/* 外部cronからの起こし用。ここを叩くとスリープから復帰して集計が走る。
   cron側は応答サイズの上限が小さいので、必ず短いJSONだけを返す(v3.2) */
app.get('/api/cron/tick', async (req, res) => {
  try {
    await catchUpSettle();
    res.json({ ok: true, today: jstDateKey(), lastSettled: await db.lastSettled() });
  } catch (e){
    /* ここで例外を投げると500になり、cron側は「HTTP error」で失敗扱いになる。
       集計は次のアクセス時にやり直せるので、200で状況だけ伝える */
    console.error('[cron]', e.message);
    res.json({ ok: false, today: jstDateKey(), error: 'retry' });
  }
});

app.get('/api/ranking', async (req, res) => {
  const which = String(req.query.day || 'today');
  const game = normGame(String(req.query.game || DEFAULT_GAME));
  const today = jstDateKey();
  try {
    await catchUpSettle();
    if (which === 'alltime'){
      return res.json({ day: 'alltime', game, owner: OWNER_NAME,
                        best: await buildAllTimeBest(game) });
    }
    const key = which === 'yesterday' ? shiftDateKey(today, -1) : today;
    const data = await buildRanking(key, key === today, game);
    res.json({ day: which, game, owner: OWNER_NAME, dateKey: key, label: shortDate(key),
               total: data.total, best: data.best });
  } catch (e){
    console.error('[ranking]', e);
    res.status(500).json({ error: 'ランキングの取得に失敗しました' });
  }
});

/* ---- 通知API ---- */
app.get('/api/notices', async (req, res) => {
  const u = await currentUser(req);
  if (!u) return authFail(res, '認証が必要です');
  try {
    const list = await db.listNotices(u.username, NOTICE_KEEP);
    res.json({
      notices: list.map(n => ({
        id: Number(n.id), kind: n.kind, title: n.title, body: n.body,
        read: !!n.is_read, at: new Date(n.created_at).toISOString()
      })),
      unread: await db.countUnread(u.username)
    });
  } catch (e){
    console.error('[notices]', e);
    res.status(500).json({ error: '通知の取得に失敗しました' });
  }
});

app.post('/api/notices/read', async (req, res) => {
  const u = await currentUser(req);
  if (!u) return authFail(res, '認証が必要です');
  await db.markNoticesRead(u.username);
  res.json({ ok: true, unread: 0 });
});

app.delete('/api/notices', async (req, res) => {
  const u = await currentUser(req);
  if (!u) return authFail(res, '認証が必要です');
  await db.clearNotices(u.username);
  res.json({ ok: true, unread: 0 });
});

app.get('/api/health', (req, res) => res.json({ ok: true, db: db.kind, rooms: rooms.size, version: APP_VERSION }));

/* =========================================================
   8.5 開発者モード(管理者API)
   v3.1: 「ownerアカウント(hiro)としてログイン済み」かつ「暗証番号が一致」の
   二重チェックにした。表示を隠すだけだと、PINを知っていれば
   他のアカウントからでも直接APIを叩けてしまうため。
   ADMIN_PIN / OWNER_NAME は環境変数で変更できる。
   ========================================================= */
const ADMIN_PIN  = process.env.ADMIN_PIN  || '20050223';

function isOwnerName(name){
  return typeof name === 'string' && name === OWNER_NAME;
}

/* 接続中のソケットからログイン中ユーザー名を集める */
function onlineUserNames(){
  const set = new Set();
  for (const [, sock] of io.of('/').sockets){
    if (sock.data && sock.data.name) set.add(sock.data.name);
  }
  return set;
}

function pinMatches(pin){
  const a = Buffer.from(String(pin || ''));
  const b = Buffer.from(ADMIN_PIN);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/* 管理APIの入口。owner本人かどうかをトークンで確かめてから暗証番号を見る */
async function checkAdmin(req, res){
  const u = await currentUser(req);
  if (!u || !isOwnerName(u.username)){
    res.status(403).json({ error: 'この操作は許可されていません' });
    return false;
  }
  const pin = String(req.headers['x-admin-pin'] || req.body?.pin || '');
  if (!pinMatches(pin)){
    res.status(401).json({ error: '暗証番号が違います' });
    return false;
  }
  return true;
}

app.post('/api/admin/auth', async (req, res) => {
  if (!await checkAdmin(req, res)) return;
  res.json({ ok: true });
});

app.post('/api/admin/users', async (req, res) => {
  if (!await checkAdmin(req, res)) return;
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

/* 指定アカウントの詳細(マイページ相当)を返す(v3.2) */
app.post('/api/admin/detail', async (req, res) => {
  if (!await checkAdmin(req, res)) return;
  const username = String(req.body?.username || '');
  try {
    const u = await db.findUser(username);
    if (!u) return res.status(404).json({ error: 'アカウントが見つかりません' });
    res.json({
      user: publicUser(u),
      online: onlineUserNames().has(u.username),
      lastLogin: u.last_login ? new Date(u.last_login).toISOString() : null,
      expNext: expToNext(u.level)
    });
  } catch (e){
    console.error('[admin/detail]', e);
    res.status(500).json({ error: '詳細の取得に失敗しました' });
  }
});

app.post('/api/admin/medal', async (req, res) => {
  if (!await checkAdmin(req, res)) return;
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
  if (!await checkAdmin(req, res)) return;
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
ioRef = io;   // v4.2: ログイン時に古い端末を切るために使う

io.use(async (socket, next) => {
  const t = readToken(socket.handshake.auth?.token);
  if (!t) return next(new Error('ログインが必要です'));
  const u = await db.findUser(t.name);
  if (!u) return next(new Error('アカウントが見つかりません'));
  /* v4.2: 別の端末でログインし直されていたら、この接続はもう無効 */
  if (!sessionValid(u, t.sid)) return next(new Error('別の端末でログインされました'));
  socket.data.sid = t.sid;
  socket.data.name = u.username;
  socket.data.level = u.level;
  socket.data.medal = u.medal;
  socket.data.iconColor = ICON_COLORS.includes(u.icon_color) ? u.icon_color : DEFAULT_ICON_COLOR;
  try { await touchLogin(u); } catch {}
  next();
});

io.on('connection', (socket) => {
  const name = socket.data.name;

  /* オーナー名を伝える(v4.6)。
     画面側はこれを見て、開発者の名前に👑を付ける */
  socket.emit('app:info', { owner: OWNER_NAME });

  socket.emit('room:list', roomList());
  /* ログインしたことをフレンドに知らせ、相手のオンライン人数表示を更新させる(v3.1) */
  notifyFriendPresence(name);

  socket.on('room:list', () => socket.emit('room:list', roomList()));

  socket.on('room:create', async ({ game, maxPlayers, mode, cpuFill, championRounds, sprintGoal } = {}) => {
    if (findAnyRoom(socket.id)) return;
    await refreshSocketUser(socket);
    if (findAnyRoom(socket.id)) return;

    const room = createRoom({ game, maxPlayers, mode, cpuFill, championRounds, sprintGoal });
    room.hostName = name;
    room.players.push(makePlayer(socket));
    socket.join(room.id);
    socket.emit('room:joined', { id: room.id });
    broadcast(io, room);
    broadcastLobby(io);
  });

  socket.on('room:join', async ({ id, via } = {}) => {
    /* via: 'invite'(フレンド招待) | 'url'(招待URL) | undefined(通常) */
    const fullMsg = via === 'invite'
      ? '現在、この部屋は満員のため参加出来ませんでした'
      : via === 'url'
        ? 'この部屋は満員のため参加出来ませんでした'
        : 'その部屋は満員です';
    const fail = (msg) => {
      if (via) socket.emit('room:joinFailed', { reason: msg, via });
      else socket.emit('room:error', msg);
    };

    const room = rooms.get(String(id || '').toUpperCase());
    if (!room) return fail('その部屋は存在しません');
    if (room.phase !== 'lobby') return fail('その部屋はすでにゲーム中です');
    if (humanCount(room) >= room.maxPlayers) return fail(fullMsg);
    if (room.players.some(p => p.name === name)) return fail('既に参加しています');
    if (findAnyRoom(socket.id)) return;

    await refreshSocketUser(socket);
    if (findAnyRoom(socket.id)) return;
    if (room.phase !== 'lobby') return fail('その部屋はすでにゲーム中です');
    if (humanCount(room) >= room.maxPlayers) return fail(fullMsg);

    room.players.push(makePlayer(socket));
    socket.join(room.id);
    socket.emit('room:joined', { id: room.id });
    chatSystem(io, room, name + ' さんが参加しました');
    broadcast(io, room);
    broadcastLobby(io);
  });

  /* 途中観戦(v3.0)。ゲーム中の部屋にだけ入れる。人数上限なし・操作不可・チャット閲覧不可 */
  socket.on('room:spectate', async ({ id } = {}) => {
    const room = rooms.get(String(id || '').toUpperCase());
    if (!room) return socket.emit('room:error', 'その部屋は存在しません');
    if (room.phase === 'lobby') return socket.emit('room:error', 'まだ試合が始まっていません');
    if (room.phase === 'champion_end') return socket.emit('room:error', 'その試合は終了しました');
    if (room.players.some(p => p.name === name))
      return socket.emit('room:error', 'その部屋には参加中です');
    if (findAnyRoom(socket.id)) return;

    await refreshSocketUser(socket);
    if (findAnyRoom(socket.id)) return;
    if (room.phase === 'lobby' || room.phase === 'champion_end')
      return socket.emit('room:error', 'その部屋は観戦できません');

    room.spectators.push({
      name, sid: socket.id,
      level: socket.data.level,
      iconColor: socket.data.iconColor || DEFAULT_ICON_COLOR
    });
    socket.join(room.id);
    socket.emit('room:spectating', { id: room.id });
    broadcast(io, room);
    broadcastLobby(io);
  });

  socket.on('room:stopSpectate', () => leaveSpectate(socket));

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

    if (isTourney(room.mode)){
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

    if (isTourney(room.mode)){
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
      /* 待機ルームに戻るので観戦者はいったんロビーへ戻す(v3.0) */
      clearSpectators(io, room, '試合が終了したため、観戦を終了しました');
      broadcast(io, room);
      broadcastLobby(io);
    }
  });

  /* =========================================================
     マーブルレース(v4.1)
     会場はサーバーに1つだけ。部屋を作らず、入ったらすぐ参加できる。
     ========================================================= */
  /* =========================================================
     スロット(v6.0)
     台は6台の早い者勝ち。1人が同時に座れるのは1台まで。

     やり取りの流れ:
       slot:spin  … サーバーが当たりと seed を決めて返す(ここで抽選)
       slot:stop  … ブラウザが押した位置3つを送る
                    → サーバーが同じ入力で計算し直して答え合わせ
                    → 払い出しもサーバーが決める
     ブラウザは slot:spin の返事を受けた時点で自分でも計算できるので、
     停止ボタンは通信を待たずに反応する。
     ========================================================= */

  /* ホールを覗く。座らなくても台データは見られる */
  socket.on('slot:lobby', () => {
    socket.join(SL_ROOM);
    socket.emit('slot:lobby', slotLobby());
    /* 切断前に座っていた台があれば、そのまま戻す(10分以内の復帰) */
    const mine = slotOf(name);
    if (mine){
      mine.sid = socket.id;
      mine.offlineAt = 0;
      socket.join(SL_ROOM + ':' + mine.no);
      socket.emit('slot:resume', slotState(mine));
      broadcastSlotLobby(io);
    }
  });

  socket.on('slot:leaveLobby', () => { socket.leave(SL_ROOM); });

  /* 着席する */
  socket.on('slot:sit', async (payload) => {
    const { no } = (payload || {});
    const m = slotById(no);
    if (!m) return socket.emit('room:error', 'その台はありません');

    /* 1人1台まで。別のタブや端末から座り直そうとした場合はここで弾く */
    const already = slotOf(name);
    if (already && already.no !== m.no)
      return socket.emit('room:error', already.no + '番台でプレイ中です');
    if (already && already.no === m.no){
      already.sid = socket.id;
      already.offlineAt = 0;
      socket.join(SL_ROOM + ':' + m.no);
      socket.emit('slot:sat', slotState(already));
      return broadcastSlotLobby(io);
    }
    if (m.seat) return socket.emit('room:error', 'その台は使用中です');

    /* ほかのゲームに参加中なら抜けてもらう */
    if (findAnyRoom(socket.id)) leaveRoom(socket);
    if (marble.watchers.has(name)){
      marble.watchers.delete(name);
      marble.tickets.delete(name);
      socket.leave(MR_ROOM);
      broadcastMarble(io);
    }
    await refreshSocketUser(socket);

    m.seat      = name;
    m.sid       = socket.id;
    m.offlineAt = 0;
    m.level     = socket.data.level;
    m.iconColor = socket.data.iconColor || DEFAULT_ICON_COLOR;

    socket.join(SL_ROOM);
    socket.join(SL_ROOM + ':' + m.no);
    socket.emit('slot:sat', slotState(m));
    broadcastSlotLobby(io);
  });

  /* 貸出。所持メダル1000枚 → コイン50枚 */
  socket.on('slot:rent', async () => {
    const m = slotOf(name);
    if (!m || m.sid !== socket.id) return;
    if (m.phase !== 'idle') return socket.emit('room:error', 'いまは貸出できません');
    if (slCoinTotal(m) >= 1000)
      return socket.emit('room:error', 'コインを持ちすぎています。精算してください');

    try {
      const u = await db.findUser(name);
      if (!u) return;
      if (Number(u.medal || 0) < SL_RENT_MEDAL)
        return socket.emit('room:error', 'メダルが足りません(' + SL_RENT_MEDAL + '枚必要です)');

      u.medal = Number(u.medal) - SL_RENT_MEDAL;
      await db.saveUser(u);

      slAddCoin(m, SL_RENT_COIN);
      m.invested += SL_RENT_MEDAL;

      socket.emit('account:update', { user: publicUser(u), levelUp: 0 });
      sendSlotState(io, m);
    } catch (e){
      console.error('[slot] 貸出:', e.message);
      socket.emit('room:error', '貸出に失敗しました');
    }
  });

  /* BET。n を省略するとMAXBET */
  socket.on('slot:bet', (payload) => {
    const { n } = (payload || {});
    const m = slotOf(name);
    if (!m || m.sid !== socket.id) return;
    if (m.phase !== 'idle') return;
    if (m.replayPending > 0) return;          // リプレイ中はBETできない

    const cap  = slBetCap(m);
    const want = (n === undefined || n === null) ? cap : Math.floor(Number(n) || 0);
    if (!Number.isFinite(want) || want < 1) return;
    if (m.inBonus && want < 2 && n !== undefined) return;

    const add = Math.min(want, cap - m.bet, slCoinTotal(m));
    if (add <= 0) return;
    slTakeCoin(m, add);
    m.bet += add;
    sendSlotState(io, m);
  });

  /* レバーON。★ここで当たりが決まる。
     ブラウザには「役のフラグ」と「seed」を返す。
     設定や確率は渡さないので、次に何が来るかは分からない */
  socket.on('slot:spin', () => {
    const m = slotOf(name);
    if (!m || m.sid !== socket.id) return;
    if (m.phase !== 'idle') return socket.emit('room:error', 'いま回しています');

    /* リプレイなら自動で同じ枚数が入る */
    if (m.replayPending > 0){
      m.bet = m.replayPending;
      m.replayPending = 0;
    }
    if (m.bet < 1) return socket.emit('room:error', 'メダルをBETしてください');
    if (m.inBonus && m.bet < 2) return socket.emit('room:error', 'MAXBETしてください');

    /* 実機の4.1秒サイクル。残っていればブラウザ側で待たせる */
    const waitMs = slSlotWaitLeft(m);

    const flags = slDrawGame(m);
    const seed  = crypto.randomInt(0, 2 ** 31);
    const id    = crypto.randomBytes(12).toString('hex');

    m.spin = { id, flags, seed, bet: m.bet, at: Date.now() + waitMs };
    m.phase = 'spin';
    m.totalG++;
    if (!m.inBonus) m.startG++;
    m.lastSpinAt = Date.now() + waitMs;

    socket.emit('slot:spin', {
      spinId: id,
      flags: { smallFlag: flags.smallFlag, bonusFlag: flags.bonusFlag, dupCherry: flags.dupCherry },
      seed,
      waitMs,
      bet: m.bet,
      peka: flags.peka,
      totalG: m.totalG,
      startG: m.startG
    });
    sendSlotState(io, m);
    broadcastSlotLobby(io);
  });

  /* 3リール止め終わった。押した位置を受け取り、サーバーが計算し直して確定させる */
  socket.on('slot:stop', async (payload) => {
    const p = payload || {};
    const m = slotOf(name);
    if (!m || m.sid !== socket.id) return;
    if (m.phase !== 'spin' || !m.spin) return socket.emit('room:error', 'まだ回していません');
    if (p.spinId !== m.spin.id) return socket.emit('room:error', 'ゲームが一致しません');

    /* 押した位置の検査。1つでもおかしければ受け付けない */
    const presses = Array.isArray(p.presses) ? p.presses : null;
    if (!presses || presses.length !== 3) return socket.emit('room:error', '停止操作が不正です');
    const seen = new Set();
    for (const pr of presses){
      if (!pr || !Number.isInteger(pr.reel) || pr.reel < 0 || pr.reel > 2)
        return socket.emit('room:error', '停止操作が不正です');
      if (seen.has(pr.reel)) return socket.emit('room:error', '同じリールを2回止めています');
      seen.add(pr.reel);
      if (!slotCore.validPress(pr.pos)) return socket.emit('room:error', '停止操作が不正です');
    }

    /* ★サーバーが同じ入力で計算し直す。これが正の出目 */
    const spin = m.spin;
    const res  = slotCore.runStops(spin.flags, presses, spin.seed);
    const wins = res.wins;
    const bet  = spin.bet;

    m.spin = null;
    m.phase = 'idle';

    /* ボーナス図柄が揃ったか */
    const bonusAligned = spin.flags.bonusFlag &&
      wins.some(w => w.role === spin.flags.bonusFlag);

    let pay = 0, started = null, ended = null;
    const hasReplay = wins.some(w => w.role === 'REPLAY');

    if (bonusAligned){
      /* ボーナス突入 */
      started = spin.flags.bonusFlag;
      m.inBonus   = true;
      m.bonusType = started;
      m.bonusPaid = 0;
      m.bonusFlag = null;
      m.lampLit   = false;
      m.lampPending = false;
      if (started === 'BB') m.bb++; else m.rb++;
      m.bonusLog.push({ type: started, at: m.startG, g: m.totalG });
      if (m.bonusLog.length > 200) m.bonusLog.shift();
      m.startG = 0;
    } else {
      const cUnit = slotCore.cherryUnitFor(bet, res.cols, m.inBonus);
      pay = slotCore.payoutFor(wins, bet, cUnit);
      if (pay > 0) slAddCoin(m, pay);

      /* ボーナス中の進行 */
      if (m.inBonus){
        m.bonusPaid += pay;
        const limit = m.bonusType === 'BB' ? slotCore.BB_LIMIT : slotCore.RB_LIMIT;
        if (m.bonusPaid > limit){
          ended = { type: m.bonusType, paid: m.bonusPaid };
          m.inBonus = false;
          m.bonusType = null;
          m.bonusPaid = 0;
          m.startG = 0;
        }
      }
    }

    /* 後ペカ。第3停止を離した時点で点灯する。
       単チェリー形が出たときは、抽選結果に関わらず必ず点灯させる(実機準拠) */
    let pekaNow = false;
    if (!m.inBonus && m.bonusFlag && !m.lampLit){
      if (m.lampPending) pekaNow = true;
      else if (slotCore.isSoloCherry(res.cols, res.pressOrder)) pekaNow = true;
    }
    if (pekaNow){ m.lampLit = true; m.lampPending = false; }

    m.replayPending = hasReplay ? bet : 0;
    m.bet = 0;

    socket.emit('slot:result', {
      spinId: spin.id,
      cols: res.cols,          // ★ブラウザはこの値で上書きすること
      stops: res.stops,
      wins, pay,
      replay: hasReplay,
      started,
      ended: ended ? ended.type : null,
      endedPaid: ended ? ended.paid : 0,
      peka: pekaNow,
      lampLit: m.lampLit,
      inBonus: m.inBonus,
      bonusPaid: m.bonusPaid
    });
    sendSlotState(io, m);
    broadcastSlotLobby(io);

    /* ボーナスを引いたときだけEXPを配る */
    if (started){
      try {
        const u = await db.findUser(name);
        if (!u) return;
        const up = addExp(u, started === 'BB' ? SL_EXP_BB : SL_EXP_RB);
        await db.saveUser(u);
        io.to(socket.id).emit('account:update', { user: publicUser(u), levelUp: up });
      } catch (e){ console.error('[slot] EXP:', e.message); }
    }
  });

  /* 精算して退席する */
  socket.on('slot:cashout', async () => {
    const m = slotOf(name);
    if (!m || m.sid !== socket.id) return;
    if (m.phase !== 'idle') return socket.emit('room:error', 'リールが回っています');
    await cashOutSlot(io, m, 'manual');
  });

  socket.on('marble:join', async () => {
    /* ほかのゲームの部屋にいるなら、そちらから抜けてもらう */
    if (findAnyRoom(socket.id)) leaveRoom(socket);
    await refreshSocketUser(socket);

    const wasEmpty = marble.watchers.size === 0;
    marble.watchers.set(name, {
      sid: socket.id, name,
      level: socket.data.level,
      iconColor: socket.data.iconColor || DEFAULT_ICON_COLOR
    });
    socket.join(MR_ROOM);

    /* 会場が完全に止まっているときだけ、新しいレースを始める(v4.6)。
       以前は「入ったとき無人だったら」で判定していたため、
       全員が抜けたあとに入り直すと出走表が作り直され、
       気に入らない出走表を引いてもやり直せてしまった。
       進行中(idle以外)なら、そのまま今のレースに合流する */
    if (marble.phase === 'idle') startMarbleBetting(io);
    else broadcastMarble(io);
    marbleChatSystem(io, name + ' さんが会場に入りました');
  });

  socket.on('marble:leave', () => {
    if (!marble.watchers.has(name)) return;
    marble.watchers.delete(name);
    marble.tickets.delete(name);
    socket.leave(MR_ROOM);
    /* v4.6: 途中で抜けても、いま動いているレースは最後まで進める。
       ここで止めてしまうと、入り直したときに出走表が作り直されて
       やり直し(リセマラ)ができてしまうため。
       無人のまま結果まで進めば、そこで次を始めずに停止する */
    maybeRushMarble(io);   // 抜けた結果、残り全員が投票済みになることがある
    broadcastMarble(io);
    marbleChatSystem(io, name + ' さんが退出しました');
  });

  /* 会場チャット(v4.5)。ルームのチャットとは宛先が違うので別に持つ */
  socket.on('marble:chat', ({ text, stamp, cheer } = {}) => {
    if (!marble.watchers.has(name)) return;

    const now = Date.now();
    const last = socket.data.lastMrChat || 0;
    if (now - last < 500) return;                 // 連投防止
    socket.data.lastMrChat = now;

    let body, kind;
    if (stamp){
      if (!CHAT_STAMPS.includes(String(stamp))) return;
      body = String(stamp); kind = 'stamp';
    } else if (cheer){
      if (!MR_CHEERS.includes(String(cheer))) return;
      body = String(cheer); kind = 'cheer';
    } else {
      body = String(text || '').replace(/\s+/g, ' ').trim().slice(0, 60);
      if (!body) return;
      kind = 'text';
    }
    marbleChat(io, { from: name, body, kind, at: now });
  });

  socket.on('marble:bet', async ({ type, picks, amount } = {}) => {
    if (!marble.watchers.has(name)) return;
    if (marble.phase !== 'bet') return socket.emit('room:error', 'いまは投票を受け付けていません');

    const def = MR_BET_TYPES[type];
    if (!def) return socket.emit('room:error', '不明な買い目です');

    /* 選んだ番号を検証する。重複や存在しない番号は弾く */
    const list = Array.isArray(picks) ? picks.map(n => Math.floor(Number(n))) : [];
    if (list.length !== def.picks) return socket.emit('room:error', '選ぶ数が正しくありません');
    if (list.some(n => !Number.isInteger(n) || n < 1 || n > MR_BALLS))
      return socket.emit('room:error', '存在しない番号です');
    if (new Set(list).size !== list.length)
      return socket.emit('room:error', '同じ番号は選べません');

    const amt = Math.floor(Number(amount) || 0);
    if (!Number.isFinite(amt) || amt < MR_MIN_BET)
      return socket.emit('room:error', '最低' + MR_MIN_BET + 'メダルから投票できます');
    if (amt > MR_MAX_BET)
      return socket.emit('room:error', '1回の投票は' + MR_MAX_BET.toLocaleString() + 'メダルまでです');

    /* v4.3: 1レースにつき1買い目だけ。買い直しもできない一発勝負にした */
    const mine = marble.tickets.get(name) || [];
    if (mine.length >= MR_MAX_TICKETS)
      return socket.emit('room:error',
        MR_MAX_TICKETS === 1
          ? 'このレースはすでに投票済みです(1レース1点まで)'
          : '1レースで買えるのは' + MR_MAX_TICKETS + '枚までです');

    /* オッズは投票した瞬間の値で固定する(あとで変動しない) */
    const odds = mrOddsOf(def.key, list);
    if (!odds) return socket.emit('room:error', 'オッズを取得できませんでした');

    let u;
    try { u = await db.findUser(name); }
    catch (e){ console.error('[marble:bet]', e.message); return socket.emit('room:error', '通信に失敗しました'); }
    if (!u) return socket.emit('room:error', 'アカウントが見つかりません');
    if (u.medal < amt) return socket.emit('room:error', 'メダルが足りません');

    /* 待っている間に締め切られていたら買わない */
    if (marble.phase !== 'bet') return socket.emit('room:error', '締め切られました');

    u.medal -= amt;
    try { await db.saveUser(u); }
    catch (e){ console.error('[marble:bet]', e.message); return socket.emit('room:error', '通信に失敗しました'); }

    const sorted = def.picks > 1 ? [...list].sort((a, b) => a - b) : list;
    mine.push({ type: def.key, label: def.label, picks: sorted, amount: amt, odds });
    marble.tickets.set(name, mine);

    socket.emit('account:update', { user: publicUser(u), levelUp: 0 });
    socket.emit('marble:bought', { type: def.key, label: def.label, picks: sorted, amount: amt, odds });
    maybeRushMarble(io);   // v4.6: 全員そろったら締め切りを早める
    broadcastMarble(io);
  });

  /* 大会を退出(観戦中でも可)。以降の経験値は加算されない */
  socket.on('room:leaveChampionship', () => leaveRoom(socket));

  /* ---- フレンド招待(v3.0) ---- */
  socket.on('room:invite', async ({ username } = {}) => {
    const room = findRoomBySid(socket.id);
    if (!room) return;
    if (room.phase !== 'lobby') return socket.emit('room:error', 'ゲーム中は招待できません');
    if (humanCount(room) >= room.maxPlayers) return socket.emit('room:error', 'この部屋は満員です');

    const target = String(username || '');
    if (target === name) return;
    if (room.players.some(p => p.name === target))
      return socket.emit('room:error', target + ' さんはすでに参加しています');

    /* フレンドであることをサーバー側でも確認する */
    let link;
    try { link = await db.findLink(name, target); }
    catch (e){ console.error('[invite]', e.message); return; }
    if (!link || link.status !== 'accepted')
      return socket.emit('room:error', 'フレンドにのみ招待を送れます');

    const socks = socketsOf(target);
    if (socks.length === 0) return socket.emit('room:error', target + ' さんはオフラインです');

    for (const s of socks){
      s.emit('room:invited', {
        from: name,
        roomId: room.id,
        mode: room.mode,
        championRounds: room.championRounds,
        sprintGoal: room.sprintGoal,
        count: humanCount(room),
        max: room.maxPlayers
      });
    }
    await pushNotice(target, 'invite', 'ルームに招待されました',
      name + ' さんがルーム ' + room.id + ' に招待しました。');
    socket.emit('room:inviteSent', { username: target });
  });

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
    /* マーブルレースの会場からも抜ける(v4.1)。
       別端末で入り直している場合があるので、sidが一致するときだけ消す */
    const w = marble.watchers.get(name);
    if (w && w.sid === socket.id){
      marble.watchers.delete(name);
      marble.tickets.delete(name);
      /* v4.6: 切断でも、いま動いているレースは止めない */
      maybeRushMarble(io);
      broadcastMarble(io);
    }
    /* スロット(v5.0): ここでは席を空けない。
       10分以内に戻ってくればそのまま続きから打てるようにするため、
       切断した時刻だけ記録しておく。実際に降ろすのは slotSweep() の役目 */
    const sm = slotOf(name);
    if (sm && sm.sid === socket.id){
      sm.sid = null;
      sm.offlineAt = Date.now();
      broadcastSlotLobby(io);
    }

    /* 切断した瞬間を最終ログインとして残す(次に見たとき「◯分前」が正しくなる) */
    try {
      const u = await db.findUser(name);
      if (u){ u.last_login = new Date(); await db.saveUser(u); }
    } catch {}
    /* このソケットが閉じたあとに判定したいので、少しだけ待ってから通知する */
    setTimeout(() => notifyFriendPresence(name), 60);
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
    result: null, connected: true, eliminated: false, eliminatedAtRound: null,
  };
}

/* 観戦者を全員ロビーへ戻す(v3.0) */
function clearSpectators(io, room, reason){
  for (const s of room.spectators){
    if (!s.sid) continue;
    io.to(s.sid).emit('room:closed', { reason });
    const sock = io.sockets.sockets.get(s.sid);
    if (sock) sock.leave(room.id);
  }
  room.spectators = [];
}

/* 観戦をやめる。プレイヤーの退出とは別扱い */
function leaveSpectate(socket, silent){
  const room = findRoomBySpectator(socket.id);
  if (!room) return false;
  room.spectators = room.spectators.filter(s => s.sid !== socket.id);
  socket.leave(room.id);
  if (!silent) broadcast(io, room);
  broadcastLobby(io);
  return true;
}

function leaveRoom(socket){
  /* 観戦者だった場合はこちらで処理する */
  if (leaveSpectate(socket)) return;

  const room = findRoomBySid(socket.id);
  if (!room) return;
  const idx = room.players.findIndex(p => p.sid === socket.id);
  if (idx < 0) return;
  const left = room.players[idx];
  const wasHost = room.hostName === left.name;
  room.players.splice(idx, 1);
  socket.leave(room.id);

  const remainingHumans = room.players.filter(p => !p.cpu);
  if (remainingHumans.length === 0){
    clearSpectators(io, room, '対戦していたプレイヤーがいなくなったため、観戦を終了しました');
    destroyRoom(room);
    return broadcastLobby(io);
  }

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
    clearSpectators(io, room, 'ホストが退出したため、このルームは解散されました');
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
/* ここまでのルートで処理されなかった /api/... は404をJSONで返す。
   これが無いと静的配信のHTMLが返り、外部cronが誤判定する(v3.2) */
app.use('/api', (req, res) => {
  res.status(404).json({ error: 'not found' });
});

/* ルート内で例外が漏れた場合も、HTMLではなく短いJSONで返す(v3.2) */
app.use((err, req, res, next) => {
  console.error('[api]', err && err.message ? err.message : err);
  if (res.headersSent) return next(err);
  if (req.path && req.path.startsWith('/api')){
    return res.status(500).json({ error: 'server error' });
  }
  res.status(500).send('server error');
});

/* 想定外の例外でプロセスごと落ちると、対戦中の全員が切断されてしまう。
   ログだけ残して動き続ける(v3.2 修正) */
process.on('unhandledRejection', (e) => {
  console.error('[fatal] 未処理のPromise拒否(継続します):', e && e.message ? e.message : e);
});
process.on('uncaughtException', (e) => {
  console.error('[fatal] 未処理の例外(継続します):', e && e.message ? e.message : e);
});

db.init()
  .then(async () => {
    /* スリープ中に日付をまたいでいた場合の取りこぼしをここで拾う(v3.2) */
    await catchUpSettle();
    scheduleMidnight();
    /* スロット(v5.0): 切断したまま10分たった人を降ろす見回りを回す。
       スリープから復帰したときに日付が変わっていたら設定も振り直す */
    slotDayGuard();
    setInterval(() => { slotSweep(io); slotDayGuard(); }, SL_SWEEP_MS);
    server.listen(PORT, () => console.log('[server] v' + APP_VERSION + ' listening on ' + PORT));
  })
  .catch((e) => { console.error('[db] 初期化に失敗:', e); process.exit(1); });
