// 补丁：还贡改为"先勾选（可取消）→ 点还贡按钮提交"，支持连续多选
const fs = require('fs')
const path = require('path')
const root = path.resolve(__dirname, '..', 'minigame')

// ---------- 1) 服务端：批量还贡 ----------
const cloud = path.join(root, 'cloudfunctions', 'gx13', 'index.js')
let c = fs.readFileSync(cloud, 'utf8')

const retBatch = `// 批量还贡：一次提交多张，按 retQueue 顺序逐张还给原主
function retBatch(room, cards) {
  const T = room.tributeShow
  if (!T || T.stage !== 'return') return { err: '不在还贡阶段' }
  const list = Array.isArray(cards) ? cards : []
  if (!list.length) return retOne(room, null)
  let done = 0
  for (let k = 0; k < list.length; k++) {
    if (T.stage !== 'return' || !T.retQueue || T.retIdx >= T.retQueue.length) break
    const r = retOne(room, [list[k]])
    if (r && r.err) return { err: r.err, done: done }
    done++
  }
  return { done: done }
}

function endTributeRound(room) {`

if (!c.includes('function retBatch(')) {
  c = c.replace('function endTributeRound(room) {', retBatch)
}

// handle retOne / return 两处都改走 retBatch
c = c.replace(
`      if (T && T.stage === 'return' && T.turnW === seat) {
        const r = retOne(room, event.cards || [])
        if (r && r.err) {
          await saveRoom(room)
          return { t: 'err', msg: r.err, state: viewFor(room, seat) }
        }
        if (T.retDone) endTributeRound(room)
        room.lastEvent = playerName(room, seat) + ' 还贡'
      }`,
`      if (T && T.stage === 'return' && T.turnW === seat) {
        const r = retBatch(room, event.cards || [])
        if (r && r.err && !r.done) {
          await saveRoom(room)
          return { t: 'err', msg: r.err, state: viewFor(room, seat) }
        }
        if (T.retDone) endTributeRound(room)
        room.lastEvent = playerName(room, seat) + ' 还贡'
      }`)

fs.writeFileSync(cloud, c, 'utf8')

// ---------- 2) 客户端 app.js：勾选 + 按钮提交 ----------
const appFile = path.join(root, 'js', 'app.js')
let a = fs.readFileSync(appFile, 'utf8')

const i0 = a.indexOf('  function returnTributeCard(c) {')
const i1 = a.indexOf('  // 进贡分步执行：一次抽一张，面板上逐条可见')
if (i0 < 0 || i1 < 0) throw new Error('app return block anchor missing')

const newBlock = `  function retRemaining() {
    var T = S.tribute;
    if (!T) return 0;
    if (T.ret) return Math.max(0, T.ret.total - T.ret.idx);
    return Math.max(0, (T.retQueue || []).length - (T.retIdx || 0));
  }

  // 还贡：点手牌只是勾选/取消，点「还贡」按钮才真正提交
  function toggleReturnSelect(c) {
    var T = S.tribute;
    if (!T || T.stage !== 'return' || !c) return;
    var at = -1;
    S.selected.forEach(function (x, i) { if (x.r === c.r && x.s === c.s) at = i; });
    if (at >= 0) {
      S.selected.splice(at, 1);
      S.hint = '已选 ' + S.selected.length + ' 张，点「还贡」提交';
      P.markDirty();
      return;
    }
    if (S.selected.length >= retRemaining()) {
      toast('还贡只剩 ' + retRemaining() + ' 张要还');
      return;
    }
    S.selected.push({ r: c.r, s: c.s });
    SFX.play('select');
    S.hint = '已选 ' + S.selected.length + ' 张，点「还贡」提交';
    P.markDirty();
  }

  // 本地逐张执行还贡（按 retQueue 顺序）
  function returnOneLocal(c) {
    var T = S.tribute;
    var cur = (T.retQueue || [])[T.retIdx];
    if (!cur) return;
    var hd = S.game.players[0].hand;
    var idx = hd.findIndex(function (x) { return x.r === c.r && x.s === c.s; });
    if (idx < 0) return;
    hd.splice(idx, 1);
    S.game.players[cur.from].hand.push({ r: c.r, s: c.s });
    sortHand(hd);
    T.returned.push({ from: 0, to: cur.from, card: { r: c.r, s: c.s } });
    T.log.push({ text: '还 ' + suitRank(c) + ' 给 ' + SEAT_NAMES[cur.from], kind: 'ret' });
    T.retIdx++;
  }

  function confirmReturn() {
    var T = S.tribute;
    if (!T || T.stage !== 'return') return;
    if (!S.selected.length) { toast('先选要还的牌，再点还贡'); return; }
    var left = retRemaining();
    if (S.selected.length > left) { toast('最多还能还 ' + left + ' 张'); return; }

    var cards = S.selected.slice();
    S.selected = [];
    if (S.mode === 'online') {
      NET.send({ t: 'retOne', cards: cards });
      P.markDirty();
      return;
    }
    cards.forEach(function (c) { returnOneLocal(c); });
    SFX.play('play');
    if (T.retIdx >= (T.retQueue || []).length) {
      T.stage = 'done';
      finishTribute();
    } else {
      S.hint = '还需要还 ' + retRemaining() + ' 张';
    }
    P.markDirty();
  }

`
a = a.slice(0, i0) + newBlock + a.slice(i1)

// 点手牌：还贡阶段 = 勾选，不再直接还
a = a.replace(
  `          if (c0 && S.tribute && S.tribute.stage === 'return') { returnTributeCard(c0); return; }`,
  `          if (c0 && S.tribute && S.tribute.stage === 'return') { toggleReturnSelect(c0); return; }`
)

fs.writeFileSync(appFile, a, 'utf8')

// ---------- 3) 视图：还贡按钮（带已选张数）+ 状态文案 ----------
const viewFile = path.join(root, 'js', 'views.js')
let v = fs.readFileSync(viewFile, 'utf8')

const oldBtn = `    // 还贡：逐张点手牌就还，条右侧给出胶囊提示
    if (T.stage === 'return') {
      var bww = 132, bhh = 32;
      var bxx = barX + barW - bww - 8, byy = barY + (barH - bhh) / 2;
      var gd2 = ctx.createLinearGradient(0, byy, 0, byy + bhh);
      gd2.addColorStop(0, '#f7dc86');
      gd2.addColorStop(0.55, '#e9b84d');
      gd2.addColorStop(1, '#cf9a2f');
      ctx.save();
      ctx.shadowColor = 'rgba(0,0,0,0.28)';
      ctx.shadowBlur = 8;
      box(ctx, bxx, byy, bww, bhh, bhh / 2, gd2, 'rgba(255,255,255,0.4)');
      ctx.restore();
      txt(ctx, '点手牌还贡', bxx + bww / 2, byy + bhh / 2 + 1, 13.5, '#3b2a08', 'center', 700);
    }`

const newBtn = `    // 还贡按钮（做出牌那种胶囊）：勾选完点这里才提交
    if (T.stage === 'return') {
      var selN = (S.selected || []).length;
      var bww = 148, bhh = 32;
      var bxx = barX + barW - bww - 8, byy = barY + (barH - bhh) / 2;
      var gd2 = ctx.createLinearGradient(0, byy, 0, byy + bhh);
      if (selN > 0) {
        gd2.addColorStop(0, '#f7dc86');
        gd2.addColorStop(0.55, '#e9b84d');
        gd2.addColorStop(1, '#cf9a2f');
      } else {
        gd2.addColorStop(0, '#9fb3a8');
        gd2.addColorStop(1, '#7d9188');
      }
      ctx.save();
      ctx.shadowColor = 'rgba(0,0,0,0.28)';
      ctx.shadowBlur = 8;
      box(ctx, bxx, byy, bww, bhh, bhh / 2, gd2, 'rgba(255,255,255,0.4)');
      ctx.restore();
      txt(ctx, selN > 0 ? ('还贡 (' + selN + ')') : '还贡', bxx + bww / 2, byy + bhh / 2 + 1, 14.5,
        selN > 0 ? '#3b2a08' : '#26352d', 'center', 700);
      hits.push({ x: bxx, y: byy, w: bww, h: bhh, act: 'confirmReturn' });
    }`

if (!v.includes(oldBtn)) throw new Error('return button anchor missing')
v = v.replace(oldBtn, newBtn)

// 状态条文案：带已选张数
v = v.replace(
  `    else if (T.stage === 'return') prog = '还贡 ' + (retIdx + 1) + '/' + retTotal + ' → 还给 ' + (retFrom >= 0 ? SEAT_NAMES[retFrom] : '');`,
  `    else if (T.stage === 'return') {
      prog = '还贡 ' + Math.min(retIdx + 1, retTotal) + '/' + retTotal + ' → 还给 ' + (retFrom >= 0 ? SEAT_NAMES[retFrom] : '')
        + ((S.selected || []).length ? ' · 已选 ' + S.selected.length + ' 张' : '');
    }`
)

fs.writeFileSync(viewFile, v, 'utf8')
console.log('patched: return selection + batch confirm')
