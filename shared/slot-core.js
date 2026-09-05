/* =========================================================
   Betoria - shared/slot-core.js  (v6.0)
   made by hiro/ヒロ   https://github.com/h1ro223
   ---------------------------------------------------------
   スロット(アイムジャグラーEX 6号機準拠)の中核。
   ★このファイルはサーバー(server.js)とブラウザ(script.js)が
     まったく同じものを読む。1文字でも違うと検証が通らなくなる。

   ここに入れてよいもの:
     図柄・リール配列・有効ライン・停止制御・役判定・払い出し
   ここに入れてはいけないもの:
     設定別の確率テーブル(SETTINGS)、中段チェリー確率、重複率
     → これらはサーバー専用。ブラウザに渡すと設定が読まれてしまう。

   なぜ共有するのか:
     ブラウザは押した瞬間に自分で停止位置を計算して即座に止める(遅延ゼロ)。
     サーバーは同じ入力(フラグ・押した位置・seed)で同じ計算をやり直し、
     結果が一致するか確かめる。だから同じコードである必要がある。
   ========================================================= */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;  // Node
  else root.SlotCore = api;                                                   // ブラウザ
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ---- 図柄 ---- */
  const SYM = { GRAPE: 1, CHERRY: 2, CLOWN: 3, BELL: 4, REPLAY: 5, BAR: 6, SEVEN: 7 };

  /* ---- リール配列(21コマ×3) ----
     index 0 が窓の上段に見える。逆順にしないこと。 */
  const KOMA = 21;
  const REEL_DATA = [
    [4,7,5,1,5,1,6,2,1,5,1,7,3,1,5,1,2,6,1,5,1], // 左
    [5,7,1,2,5,4,1,2,5,6,1,2,5,4,1,2,5,6,1,2,3], // 中
    [1,7,6,4,5,1,3,4,5,1,3,4,5,1,3,4,5,1,3,4,5]  // 右
  ];

  /* ---- 有効5ライン。[左の行, 中の行, 右の行] 0=上 1=中 2=下 ---- */
  const LINES = [
    [0,0,0], [1,1,1], [2,2,2], [0,1,2], [2,1,0]
  ];

  const MAX_SLIP = 4;   // 最大4コマ引き込み

  /* ---- 停止の目標図柄。null は不問 ---- */
  const TARGETS = {
    GRAPE:      [1, 1, 1],
    BELL:       [4, 4, 4],
    CLOWN:      [3, 3, 3],
    REPLAY:     [5, 5, 5],
    CHERRY:     [2, null, null],   // チェリーは左リールだけで決まる
    RARECHERRY: [2, null, null],   // 中段ラインのみ
    BB:         [7, 7, 7],
    RB:         [7, 7, 6]
  };

  const PAY_CAP    = 15;   // 1ゲームの払い出し上限
  const BB_LIMIT   = 280;  // これを「超える」払い出しでBB終了(=総294枚/21G)
  const RB_LIMIT   = 98;   // 同上(=総112枚/8G)

  const mod  = (n, m) => ((n % m) + m) % m;
  const modK = n => mod(Math.round(n), KOMA);

  /* 位置posで止めたときに窓に見える3コマ */
  function windowCol(reelIdx, pos){
    const d = REEL_DATA[reelIdx];
    return [d[modK(pos)], d[modK(pos + 1)], d[modK(pos + 2)]];
  }

  /* ---- 役判定 ---- */
  function evalWins(cols){
    const wins = [];
    LINES.forEach((rows, i) => {
      const s = [cols[0][rows[0]], cols[1][rows[1]], cols[2][rows[2]]];
      if (s[0] === SYM.CHERRY) wins.push({ role: 'CHERRY', line: i });
      if (s[0] === s[1] && s[1] === s[2]){
        if      (s[0] === SYM.GRAPE)  wins.push({ role: 'GRAPE',  line: i });
        else if (s[0] === SYM.BELL)   wins.push({ role: 'BELL',   line: i });
        else if (s[0] === SYM.CLOWN)  wins.push({ role: 'CLOWN',  line: i });
        else if (s[0] === SYM.REPLAY) wins.push({ role: 'REPLAY', line: i });
        else if (s[0] === SYM.SEVEN)  wins.push({ role: 'BB',     line: i });
      }
      if (s[0] === SYM.SEVEN && s[1] === SYM.SEVEN && s[2] === SYM.BAR)
        wins.push({ role: 'RB', line: i });
    });
    return wins;
  }

  /* ---- 払い出し。ブドウは複数ライン成立でも1回分だけ ---- */
  function payoutFor(wins, bet, cherryUnit){
    let total = 0, grapePaid = false;
    const cUnit = (cherryUnit === undefined) ? (bet === 3 ? 1 : 7) : cherryUnit;
    for (const w of wins){
      switch (w.role){
        case 'GRAPE':
          if (!grapePaid){ total += (bet === 2 ? 14 : 8); grapePaid = true; }
          break;
        case 'BELL':   total += 14;    break;
        case 'CLOWN':  total += 10;    break;
        case 'CHERRY': total += cUnit; break;
      }
    }
    return Math.min(total, PAY_CAP);
  }

  /* チェリー1ラインあたりの払い出し枚数 */
  function cherryUnitFor(bet, cols, inBonus){
    if (bet === 3) return 1;
    if (bet === 1 && !inBonus && centerCherryLinked(cols[0], cols[1])) return 1;
    return 7;
  }

  /* ---- 単チェリー判定 ----
     順押しで左にチェリーが出ているのに、中リールと繋がっていない形。
     この形が出た時点でボーナス成立が確定する。 */
  function cherryRows(col){
    const rows = [];
    if (!col) return rows;
    for (let r = 0; r < 3; r++) if (col[r] === SYM.CHERRY) rows.push(r);
    return rows;
  }
  function centerCherryLinked(col0, col1){
    if (!col0 || !col1) return false;
    const c0 = cherryRows(col0), c1 = cherryRows(col1);
    return c0.some(r => c1.some(r2 => Math.abs(r2 - r) <= 1));
  }
  function isSoloCherry(cols, order){
    if (!cols || !cols[0] || !cols[1]) return false;
    if (!order || order.length !== 3) return false;
    if (!(order[0] === 0 && order[1] === 1 && order[2] === 2)) return false;  // 順押し限定
    if (!cols[0].includes(SYM.CHERRY)) return false;
    return !centerCherryLinked(cols[0], cols[1]);
  }

  /* ---- 停止制御の補助 ---- */
  function alignSet(reelIdx, sym, row, avoidCherry){
    const set = [];
    for (let t = 0; t < KOMA; t++){
      if (REEL_DATA[reelIdx][t] !== sym) continue;
      const p = modK(t - row);
      if (avoidCherry && reelIdx === 0 && windowCol(0, p).includes(SYM.CHERRY)) continue;
      set.push(p);
    }
    return set;
  }
  /* どのタイミングで押しても4コマ以内に引き込めるか(円環上の最大間隔<=5) */
  function coversAllPresses(setArr){
    if (setArr.length === 0) return false;
    const s = [...setArr].sort((a, b) => a - b);
    for (let i = 0; i < s.length; i++){
      const gap = (i === s.length - 1) ? (s[0] + KOMA - s[i]) : (s[i + 1] - s[i]);
      if (gap > MAX_SLIP + 1) return false;
    }
    return true;
  }

  /* ---- 停止位置の決定(本体) ----
     ctx: { cols, pressOrder, smallFlag, bonusFlag, dupCherry }
     rng: 決定論的な乱数。ブドウの出目を散らすときだけ使う。
          Math.random を使うとサーバーと結果が食い違うので絶対に使わないこと。 */
  function chooseStopPosition(ctx, reelIdx, curPos, rng){
    const stopped = ctx.cols;
    const nStopped = stopped.filter(Boolean).length;

    const aimableBonus = ctx.bonusFlag;
    const flagRole = ctx.smallFlag || aimableBonus || null;

    /* 揃えてよい役。これ以外が揃う形は蹴飛ばす */
    const allowed = new Set();
    if (ctx.smallFlag){
      allowed.add(ctx.smallFlag);
      if (ctx.smallFlag === 'RARECHERRY') allowed.add('CHERRY');
    } else if (aimableBonus) allowed.add(aimableBonus);

    const target = flagRole ? TARGETS[flagRole] : null;

    let base = Math.floor(curPos);
    if (curPos - base < 0.2) base = base - 1;   // 最低限の移動距離を確保
    const candidates = [];
    for (let s = 0; s <= MAX_SLIP; s++) candidates.push({ slip: s, p: modK(base - s) });

    const scoreOf = (cand) => {
      const col = windowCol(reelIdx, cand.p);
      const cols = stopped.slice();
      cols[reelIdx] = col;

      /* 第3停止: 完成形を厳密に見る */
      if (nStopped === 2){
        const wins = evalWins(cols);
        const badWins = wins.filter(w => !allowed.has(w.role));
        const flagHit = flagRole && wins.some(w =>
          flagRole === 'RARECHERRY' ? (w.role === 'CHERRY' && w.line === 1) : w.role === flagRole);
        if (badWins.length > 0) return 1000 + badWins.length * 10;   // 蹴飛ばす
        if (flagHit) return 0;
        return 10;
      }

      /* 第1・第2停止 */
      let penalty = 0;

      /* 単チェリー制御。重複なら繋がらない形、非重複なら繋がる形を優先する */
      if (reelIdx === 1 && cols[0] && cols[0].includes(SYM.CHERRY) &&
          ctx.pressOrder.length === 1 && ctx.pressOrder[0] === 0 &&
          (ctx.smallFlag === 'CHERRY' || ctx.smallFlag === 'RARECHERRY')){
        if (centerCherryLinked(cols[0], col) === !!ctx.dupCherry) penalty += 40;
      }
      /* チェリー非成立なら、左リールで必ず蹴飛ばす */
      if (!allowed.has('CHERRY') && cols[0]){
        if (cols[0].includes(SYM.CHERRY)) penalty = 500;
      }
      if (!target) return penalty + 10;

      const avoidCherry = !allowed.has('CHERRY');
      let live = 0, guaranteed = 0;
      const lineSet = (flagRole === 'RARECHERRY') ? [LINES[1]] : LINES;

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
          if (!coversAllPresses(alignSet(c, t, rows[c], avoidCherry))){ sure = false; break; }
        }
        if (sure) guaranteed++;
      });

      if (flagRole === 'GRAPE') return penalty + (guaranteed > 0 ? 0 : 100);
      return penalty + (guaranteed > 0 ? 0 : 100) + (10 - live);
    };

    let bestScore = Infinity;
    for (const cand of candidates){
      cand.score = scoreOf(cand);
      if (cand.score < bestScore) bestScore = cand.score;
    }
    const bestList = candidates.filter(c => c.score === bestScore);
    /* ブドウは引き込める形が複数あるので、出目を散らす。ここだけ rng を使う */
    if (flagRole === 'GRAPE' && bestList.length > 1){
      return bestList[Math.floor(rng() * bestList.length)].p;
    }
    return bestList[0].p;
  }

  /* ---- 決定論的PRNG(mulberry32) ----
     seedが同じなら必ず同じ数列を返す。だからサーバーで再現できる。 */
  function makeRng(seed){
    let a = seed >>> 0;
    return function (){
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* ---- 1ゲーム分の停止制御をまとめて実行 ----
     サーバーもブラウザもこの関数を呼ぶ。rngを呼ぶ回数と順序を揃えるため。
     presses は「押した順」に並んでいること。 */
  function runStops(flags, presses, seed){
    const ctx = {
      cols: [null, null, null], pressOrder: [],
      smallFlag: flags.smallFlag, bonusFlag: flags.bonusFlag, dupCherry: flags.dupCherry
    };
    const rng = makeRng(seed);
    const stops = [];
    for (const pr of presses){
      const p = chooseStopPosition(ctx, pr.reel, pr.pos, rng);
      ctx.cols[pr.reel] = windowCol(pr.reel, p);
      ctx.pressOrder.push(pr.reel);
      stops.push({ reel: pr.reel, stop: p });
    }
    return { cols: ctx.cols, stops, wins: evalWins(ctx.cols), pressOrder: ctx.pressOrder };
  }

  /* 押した位置として受け付けてよい値か */
  function validPress(p){
    return typeof p === 'number' && isFinite(p) && p >= 0 && p < KOMA;
  }

  return {
    SYM, KOMA, REEL_DATA, LINES, MAX_SLIP, TARGETS,
    PAY_CAP, BB_LIMIT, RB_LIMIT,
    mod, modK, windowCol,
    evalWins, payoutFor, cherryUnitFor,
    cherryRows, centerCherryLinked, isSoloCherry,
    alignSet, coversAllPresses, chooseStopPosition,
    makeRng, runStops, validPress
  };
});
