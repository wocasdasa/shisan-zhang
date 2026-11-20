// 补丁：开局即进贡（测试模式）+ 独食档位抽牌数
const fs = require('fs')
const path = require('path')

const root = path.resolve(__dirname, '..', 'minigame')

// 1) rules.js 三份：独食胜 → 每家抽 tier 张
const rulesFiles = [
  path.join(root, 'js', 'engine', 'rules.js'),
  path.join(root, 'cloudfunctions', 'gx13', 'engine', 'rules.js')
]
rulesFiles.forEach((f) => {
  let s = fs.readFileSync(f, 'utf8')
  const old = `    if (set === '1,3') return tier === 'light' ? 1 : 2;`
  const add = `    if (set === '1,3') return tier === 'light' ? 1 : 2;
    if (set === '1') return tier === 'light' ? 1 : 2;   // 独食胜：每家抽 1/2 张（三家共 3N）`
  if (!s.includes(old)) throw new Error('rules anchor missing: ' + f)
  if (!s.includes("set === '1'")) s = s.replace(old, add)
  fs.writeFileSync(f, s, 'utf8')
})

// 2) 云端：cfg 白名单 + 开局强制进贡
const cloud = path.join(root, 'cloudfunctions', 'gx13', 'index.js')
let c = fs.readFileSync(cloud, 'utf8')

c = c.replace(
  `const CFG_KEYS = ['tributeEnabled', 'tributeTier', 'turnSeconds', 'teamHint', 'loneAnnounce']`,
  `const CFG_KEYS = ['tributeEnabled', 'tributeTier', 'turnSeconds', 'teamHint', 'loneAnnounce', 'testTribute']`
)
c = c.replace(
  `  if (typeof input.loneAnnounce === 'boolean') out.loneAnnounce = input.loneAnnounce`,
  `  if (typeof input.loneAnnounce === 'boolean') out.loneAnnounce = input.loneAnnounce
  if (typeof input.testTribute === 'boolean') out.testTribute = input.testTribute`
)

const oldAfter = `function afterDeal(room) {
  room.deadline = 0
  if (room.round >= 2 && room.cfg.tributeEnabled && room.lastResult) {
    const plan = GX.Tribute.plan(room.lastResult, room.cfg)
    if (!plan.skip && plan.count > 0) {
      startTribute(room, plan)
      return
    }
  }
  room.phase = 'play'
  scheduleTurn(room)
}`

const newAfter = `function afterDeal(room) {
  room.deadline = 0
  // 测试模式：房主开了「开局即进贡」，第 1 局也直接进贡（把房主当上一局第一名）
  if (room.cfg && room.cfg.testTribute && room.game && room.game.camp) {
    const fake = { ranks: [0, 1, 2, 3], camp: room.game.camp, scores: [0, 0, 0, 0] }
    const p2 = GX.Tribute.plan(fake, room.cfg)
    if (!p2.skip && p2.count > 0) {
      room.lastResult = fake
      startTribute(room, p2)
      return
    }
  }
  if (room.round >= 2 && room.cfg.tributeEnabled && room.lastResult) {
    const plan = GX.Tribute.plan(room.lastResult, room.cfg)
    if (!plan.skip && plan.count > 0) {
      startTribute(room, plan)
      return
    }
  }
  room.phase = 'play'
  scheduleTurn(room)
}`

if (!c.includes(oldAfter)) throw new Error('afterDeal anchor missing')
c = c.replace(oldAfter, newAfter)
fs.writeFileSync(cloud, c, 'utf8')

// 3) 客户端 roomCfg + cfgSet
const appFile = path.join(root, 'js', 'app.js')
let a = fs.readFileSync(appFile, 'utf8')
a = a.replace(
  `    roomCfg: { tributeTier: 'heavy', turnSeconds: 20, teamHint: 'none' },`,
  `    roomCfg: { tributeTier: 'heavy', turnSeconds: 20, teamHint: 'none', testTribute: false },`
)
a = a.replace(
  `      else if (h.key === 'hint') S.roomCfg.teamHint = h.v;`,
  `      else if (h.key === 'hint') S.roomCfg.teamHint = h.v;
      else if (h.key === 'testTribute') S.roomCfg.testTribute = h.v;`
)
fs.writeFileSync(appFile, a, 'utf8')

// 4) 创建房间面板：加"开局即进贡（测试）"开关
const viewFile = path.join(root, 'js', 'views.js')
let v = fs.readFileSync(viewFile, 'utf8')
const oldNote = `      txt(ctx, '局数与规则由房主设定，其他人进房后沿用', W / 2, py + 258, 12, C.dim, 'center');`
const newNote = `      // 测试开关：开局直接进贡，方便检验抽牌流程
      var tOn = !!RC.testTribute;
      var tcw = 268, tcx = (W - tcw) / 2, tcy = py + 256;
      box(ctx, tcx, tcy, tcw, 32, 8, tOn ? C.gold : C.btn, tOn ? null : C.panelLine);
      txt(ctx, (tOn ? '● ' : '○ ') + '开局即进贡（测试）', tcx + tcw / 2, tcy + 16, 12.5,
        tOn ? '#132018' : C.text, 'center', tOn ? 600 : 400);
      hits.push({ x: tcx, y: tcy, w: tcw, h: 32, act: 'cfgSet', key: 'testTribute', v: !tOn });`
if (!v.includes(oldNote)) throw new Error('note anchor missing')
v = v.replace(oldNote, newNote)
fs.writeFileSync(viewFile, v, 'utf8')

console.log('patched: testTribute + lone tribute count')
