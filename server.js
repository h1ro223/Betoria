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
const APP_VERSION = '3.2.0';

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
    const ranks = new Map();     // dateKey -> Map(username -> row)
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
      /* ---- ランキング(v3.2) ---- */
      async lastSettled(){ return lastSettled; },
      async setLastSettled(key){ lastSettled = key; },
      async usersWithDay(key){
        return [...users.values()]
          .filter(u => u.day_key === key && ((u.day_gain || 0) > 0 || (u.day_best || 0) > 0))
          .map(u => ({
            username: u.username, level: u.level,
            icon_color: u.icon_color, day_gain: u.day_gain || 0, day_best: u.day_best || 0
          }));
      },
      async saveDailyRanks(key, rows){
        if (!ranks.has(key)) ranks.set(key, new Map());
        const m = ranks.get(key);
        for (const x of rows){
          m.set(x.username, {
            username: x.username, level: x.level, icon_color: x.icon_color,
            total_gain: x.day_gain, best_gain: x.day_best
          });
        }
      },
      async getDailyRanks(key){
        return ranks.has(key) ? [...ranks.get(key).values()] : [];
      },
      async purgeDailyRanks(before){
        for (const k of [...ranks.keys()]) if (k < before) ranks.delete(k);
      },
      async topAllTimeBest(limit){
        return [...users.values()]
          .filter(u => (u.best_gain || 0) > 0)
          .sort((a, b) => (b.best_gain - a.best_gain) ||
                          String(a.username).localeCompare(String(b.username)))
          .slice(0, limit)
          .map(u => ({
            username: u.username, level: u.level, icon_color: u.icon_color,
            best_gain: u.best_gain, best_gain_at: u.best_gain_at
          }));
      },
      async liveDay(key, limit){
        return [...users.values()]
          .filter(u => u.day_key === key && ((u.day_gain || 0) > 0 || (u.day_best || 0) > 0))
          .slice(0, limit)
          .map(u => ({
            username: u.username, level: u.level, icon_color: u.icon_color,
            day_gain: u.day_gain || 0, day_best: u.day_best || 0
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
    max: 5
  });

  const COLS = 'username, pass_hash, medal, level, exp, rounds, wins, losses, pushes, bj, ' +
               'champ_plays, champ_wins, champ_losses, champ_draws, last_login, icon_color, ' +
               'total_gain, best_gain, best_gain_at, day_key, day_gain, day_best, ' +
               'bonus_date, bonus_ad_date, login_streak, login_days, created_at';

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
          $17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27)`,
        [row.username, row.pass_hash, row.medal, row.level, row.exp,
         row.rounds, row.wins, row.losses, row.pushes, row.bj,
         row.champ_plays, row.champ_wins, row.champ_losses, row.champ_draws, row.last_login,
         row.icon_color || DEFAULT_ICON_COLOR,
         row.total_gain || 0, row.best_gain || 0, row.best_gain_at || null,
         row.day_key || null, row.day_gain || 0, row.day_best || 0,
         row.bonus_date || null, row.bonus_ad_date || null,
         row.login_streak || 0, row.login_days || 0,
         row.created_at || new Date()]);
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
         bonus_date=$22, bonus_ad_date=$23, login_streak=$24, login_days=$25
         WHERE username=$1`,
        [row.username, row.medal, row.level, row.exp,
         row.rounds, row.wins, row.losses, row.pushes, row.bj,
         row.champ_plays, row.champ_wins, row.champ_losses, row.champ_draws, row.last_login,
         row.icon_color || DEFAULT_ICON_COLOR,
         row.total_gain || 0, row.best_gain || 0, row.best_gain_at || null,
         row.day_key || null, row.day_gain || 0, row.day_best || 0,
         row.bonus_date || null, row.bonus_ad_date || null,
         row.login_streak || 0, row.login_days || 0]);
      return row;
    },
    async deleteUser(name){
      await pool.query(`DELETE FROM friends WHERE user_a=$1 OR user_b=$1`, [name]);
      await pool.query(`DELETE FROM notices WHERE username=$1`, [name]);
      await pool.query(`DELETE FROM rank_daily WHERE username=$1`, [name]);
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
    /* その日の成績を持つ人だけを確定用に取り出す */
    async usersWithDay(key){
      const r = await pool.query(
        `SELECT username, level, icon_color, day_gain, day_best FROM users
         WHERE day_key=$1 AND (day_gain > 0 OR day_best > 0)`, [key]);
      return r.rows;
    },
    async saveDailyRanks(key, rows){
      for (const x of rows){
        await pool.query(
          `INSERT INTO rank_daily(date_key, username, level, icon_color, total_gain, best_gain)
           VALUES($1,$2,$3,$4,$5,$6)
           ON CONFLICT (date_key, username) DO UPDATE SET
             level=EXCLUDED.level, icon_color=EXCLUDED.icon_color,
             total_gain=EXCLUDED.total_gain, best_gain=EXCLUDED.best_gain`,
          [key, x.username, x.level, x.icon_color, x.day_gain, x.day_best]);
      }
    },
    async getDailyRanks(key){
      const r = await pool.query(
        `SELECT username, level, icon_color, total_gain, best_gain
         FROM rank_daily WHERE date_key=$1`, [key]);
      return r.rows;
    },
    /* 保存期間を過ぎた日次ランキングを消す */
    async purgeDailyRanks(before){
      await pool.query(`DELETE FROM rank_daily WHERE date_key < $1`, [before]);
    },
    /* 歴代の一撃ランキング(usersテーブルから直接) */
    async topAllTimeBest(limit){
      const r = await pool.query(
        `SELECT username, level, icon_color, best_gain, best_gain_at FROM users
         WHERE best_gain > 0 ORDER BY best_gain DESC, username ASC LIMIT $1`, [limit]);
      return r.rows;
    },
    /* 進行中(本日)の集計をその場で読む */
    async liveDay(key, limit){
      const r = await pool.query(
        `SELECT username, level, icon_color, day_gain, day_best FROM users
         WHERE day_key=$1 AND (day_gain > 0 OR day_best > 0) LIMIT $2`, [key, limit]);
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
    iconColor: ICON_COLORS.includes(u.icon_color) ? u.icon_color : DEFAULT_ICON_COLOR,
    isOwner: u.username === (process.env.OWNER_NAME || 'hiro'),
    /* v3.2 */
    totalGain: Number(u.total_gain || 0),
    bestGain: Number(u.best_gain || 0),
    bestGainAt: u.best_gain_at || null,
    loginStreak: Number(u.login_streak || 0),
    loginDays: Number(u.login_days || 0),
    createdAt: u.created_at ? new Date(u.created_at).toISOString() : null,
    /* 今日のログインボーナスを受け取れるか(v3.2) */
    bonusReady: u.bonus_date !== jstDateKey(),
    bonusAdReady: u.bonus_date === jstDateKey() && u.bonus_ad_date !== jstDateKey()
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

function createRoom(opts){
  const mode = ['champion', 'sprint'].includes(opts.mode) ? opts.mode : 'enjoy';
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
          recordGain(u, p.result.payout - p.bet);
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
    created_at: new Date()
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
    await db.saveUser(u);
    /* 変更後は今のトークンだけを有効にし、他端末のセッションは切る */
    const token = makeToken(u.username);
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
   gain には「配当 - ベット」の純増分を渡すこと */
function recordGain(user, gain){
  const g = Math.floor(Number(gain) || 0);
  if (g <= 0) return;

  /* DBから来た値が文字列だと加算が文字列連結になってしまうので、
     必ず数値に直してから足す(v3.2で発生した不具合の対策) */
  const num = (v) => {
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  };

  const key = jstDateKey();
  if (user.day_key !== key){
    user.day_key = key;
    user.day_gain = 0;
    user.day_best = 0;
  }
  user.day_gain = num(user.day_gain) + g;
  if (g > num(user.day_best)) user.day_best = g;

  user.total_gain = num(user.total_gain) + g;
  if (g > num(user.best_gain)){
    user.best_gain = g;
    user.best_gain_at = key;
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
async function buildRanking(key, live){
  const rows = live
    ? (await db.liveDay(key, 5000)).map(r => ({
        username: r.username, level: r.level, icon_color: r.icon_color,
        total_gain: r.day_gain, best_gain: r.day_best
      }))
    : await db.getDailyRanks(key);

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
async function buildAllTimeBest(){
  const rows = await db.topAllTimeBest(RANK_LIMIT);
  return withRanks(rows, r => Number(r.best_gain)).map(r => ({
    rank: r.rank, username: r.username, level: r.level,
    iconColor: ICON_COLORS.includes(r.icon_color) ? r.icon_color : DEFAULT_ICON_COLOR,
    medal: Number(r.best_gain),
    date: r.best_gain_at || null
  }));
}

/* 指定日の集計を確定し、入賞者に通知を送る */
async function settleDay(key){
  const rows = await db.usersWithDay(key);
  if (rows.length){
    await db.saveDailyRanks(key, rows);

    const total = withRanks(sortByValue(rows.filter(r => r.day_gain > 0), r => Number(r.day_gain)),
                            r => Number(r.day_gain)).slice(0, RANK_LIMIT);
    const best  = withRanks(sortByValue(rows.filter(r => r.day_best > 0), r => Number(r.day_best)),
                            r => Number(r.day_best)).slice(0, RANK_LIMIT);

    const label = shortDate(key);
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
  }
  await db.setLastSettled(key);
  await db.purgeDailyRanks(shiftDateKey(jstDateKey(), -RANK_KEEP_DAYS));
  console.log('[rank] ' + key + ' を確定しました(' + rows.length + '人)');
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
    await catchUpSettle();
    /* 接続中の全員に日付が変わったことを伝える */
    for (const [, sock] of io.of('/').sockets) sock.emit('day:changed', { date: jstDateKey() });
    scheduleMidnight();
  }, wait);
}

/* 外部cronからの起こし用。ここを叩くとスリープから復帰して集計が走る */
app.get('/api/cron/tick', async (req, res) => {
  await catchUpSettle();
  res.json({ ok: true, today: jstDateKey(), lastSettled: await db.lastSettled() });
});

app.get('/api/ranking', async (req, res) => {
  const which = String(req.query.day || 'today');
  const today = jstDateKey();
  try {
    await catchUpSettle();
    if (which === 'alltime'){
      return res.json({ day: 'alltime', best: await buildAllTimeBest() });
    }
    const key = which === 'yesterday' ? shiftDateKey(today, -1) : today;
    const data = await buildRanking(key, key === today);
    res.json({ day: which, dateKey: key, label: shortDate(key), total: data.total, best: data.best });
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
const OWNER_NAME = process.env.OWNER_NAME || 'hiro';

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
  /* ログインしたことをフレンドに知らせ、相手のオンライン人数表示を更新させる(v3.1) */
  notifyFriendPresence(name);

  socket.on('room:list', () => socket.emit('room:list', roomList()));

  socket.on('room:create', async ({ maxPlayers, mode, cpuFill, championRounds, sprintGoal } = {}) => {
    if (findAnyRoom(socket.id)) return;
    await refreshSocketUser(socket);
    if (findAnyRoom(socket.id)) return;

    const room = createRoom({ maxPlayers, mode, cpuFill, championRounds, sprintGoal });
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
    result: null, connected: true, eliminated: false, eliminatedAtRound: null
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
db.init()
  .then(async () => {
    /* スリープ中に日付をまたいでいた場合の取りこぼしをここで拾う(v3.2) */
    await catchUpSettle();
    scheduleMidnight();
    server.listen(PORT, () => console.log('[server] v' + APP_VERSION + ' listening on ' + PORT));
  })
  .catch((e) => { console.error('[db] 初期化に失敗:', e); process.exit(1); });
