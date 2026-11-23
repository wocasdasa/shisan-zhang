// 回归验证：还贡提交后必须推进 retIdx，还满后进入出牌阶段，且牌张一一对应回到原主
// 用法：先以 CDP 端口打开 preview.html?demo=pullTest&stage=return，再跑本脚本
const http = require('http');
const Client = require('./wsclient.js');
const PORT = Number(process.env.CDP_PORT || 9351);

function getJSON(p) {
  return new Promise((res, rej) => {
    http.get({ host: '127.0.0.1', port: PORT, path: p }, (r) => {
      let b = ''; r.on('data', (d) => b += d); r.on('end', () => { try { res(JSON.parse(b)); } catch (e) { rej(e); } });
    }).on('error', rej);
  });
}

(async () => {
  const list = await getJSON('/json/list');
  const page = list.find((x) => x.type === 'page');
  const c = new Client(page.webSocketDebuggerUrl);
  let id = 0; const pend = new Map();
  const opened = new Promise((r) => c.on('open', r));
  c.on('message', (m) => { if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } });
  await opened;
  const send = (m, p) => new Promise((r) => { const i = ++id; pend.set(i, r); c.send({ id: i, method: m, params: p || {} }); });
  const ev = async (e) => {
    const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
    return r.result && r.result.result && r.result.result.value;
  };
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  // 重载页面，回到干净的演示进贡局面
  await send('Page.reload', {});
  await wait(1400);

  // 构造确定性进贡局面：从 1 号位抽 2 张真牌给 0 号位，retQueue 指向这两笔
  const before = JSON.parse(await ev(`(function(){
    var S=window.__gx.S;
    S.phase='tribute'; S.selected=[];
    var p1=S.game.players[1].hand, p0=S.game.players[0].hand;
    var got=[p1[0],p1[1]];
    got.forEach(function(cd){ var i2=p1.indexOf(cd); p1.splice(i2,1); p0.push({r:cd.r,s:cd.s}); });
    S.tribute={plan:{count:2,winners:[0,2],losers:[1,3],winnerRanks:[1,3],skip:false},
      draws:[{from:1,to:0,card:{r:got[0].r,s:got[0].s}},{from:1,to:0,card:{r:got[1].r,s:got[1].s}}],
      reveals:[], log:[], shares:[2,2], need:2, stage:'return', canDraw:[1,3], turnW:0,
      picks:[], returned:[], drawnFrom:{}, humanIsWinner:true, humanDrawn:[], pairQuota:null,
      retQueue:[{from:1,to:0,card:{r:got[0].r,s:got[0].s}},{from:1,to:0,card:{r:got[1].r,s:got[1].s}}], retIdx:0};
    window.__gx.P.markDirty();
    return JSON.stringify({human:p0.length, p1:p1.length, p2:S.game.players[2].hand.length, p3:S.game.players[3].hand.length, retTotal:2});
  })()`));
  console.log('before', JSON.stringify(before));

  // 先只还 1 张：必须推进 retIdx、牌落到原主手里、阶段仍留在 return（AI 尚未出牌，张数可精确断言）
  await ev(`(function(){var S=window.__gx.S,T=S.tribute;
    S.selected=S.game.players[0].hand.slice(0,1).map(function(x){return {r:x.r,s:x.s};});
    window.__gx.P.markDirty(); return S.selected.length;})()`);
  await wait(150);

  const scale = Number(await ev('window.innerHeight')) / 750;
  const hits = JSON.parse(await ev('JSON.stringify(window.__gx.S.hits)'));
  const h = hits.filter((x) => x.act === 'confirmReturn')[0];
  if (!h) { console.log('FAIL: 找不到还贡按钮热区'); process.exit(1); }
  const tapReturn = async () => {
    const x = Math.round((h.x + h.w / 2) * scale);
    const y = Math.round((h.y + h.h / 2) * scale);
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
  };
  await tapReturn();
  await wait(250);

  const step1 = JSON.parse(await ev(`(function(){var S=window.__gx.S,T=S.tribute;
    return JSON.stringify({stage:T&&T.stage, retIdx:T&&T.retIdx,
      human:S.game.players[0].hand.length, p1:S.game.players[1].hand.length});})()`));
  console.log('step1 ', JSON.stringify(step1));
  const step1Ok = step1.stage === 'return' && step1.retIdx === 1 &&
    step1.human === before.human - 1 && step1.p1 === before.p1 + 1;

  // 再还最后 1 张：应还满进入出牌阶段
  await ev(`(function(){var S=window.__gx.S,T=S.tribute;
    S.selected=S.game.players[0].hand.slice(0,1).map(function(x){return {r:x.r,s:x.s};});
    window.__gx.P.markDirty(); return S.selected.length;})()`);
  await wait(150);
  await tapReturn();
  await wait(900);

  const after = JSON.parse(await ev(`(function(){var S=window.__gx.S,T=S.tribute;
    return JSON.stringify({phase:S.phase, tribute:T?T.stage:null, human:S.game.players[0].hand.length});})()`));
  console.log('after ', JSON.stringify(after));

  const good = step1Ok && after.tribute === null && after.phase === 'play' &&
    after.human === before.human - 2;
  console.log(good ? 'TRIBUTE-RETURN-OK' : 'TRIBUTE-RETURN-FAIL');
  process.exit(good ? 0 : 1);
})().catch((e) => { console.log('ERR', e && e.message); process.exit(1); });
