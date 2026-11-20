// 云函数端到端自测 v2：1 真人 + 3 AI 打完整局，验证结算与第二局进贡
const Module = require('module')
const path = require('path')

const store = {}
let currentOpenid = 'openid_A'

const dbApi = {
  createCollection: async (name) => { if (!store[name]) store[name] = {} },
  collection: (name) => {
    if (!store[name]) store[name] = {}
    return {
      doc: (id) => ({
        get: async () => {
          const d = store[name][id]
          if (!d) throw new Error('document not exists')
          return { data: d }
        },
        set: async (arg) => { store[name][id] = arg.data },
        update: async (arg) => {
          const rec = store[name][id]
          if (!rec) return { stats: { updated: 0 } }
          Object.assign(rec, arg.data)
          return { stats: { updated: 1 } }
        },
        remove: async () => { delete store[name][id] }
      }),
      where: (cond) => ({
        update: async (arg) => {
          const id = String(cond._id)
          const rec = store[name][id]
          if (!rec) return { stats: { updated: 0 } }
          if ('lockAt' in cond && ((rec.lockAt === undefined ? 0 : rec.lockAt) !== cond.lockAt)) {
            return { stats: { updated: 0 } }
          }
          Object.assign(rec, arg.data)
          return { stats: { updated: 1 } }
        },
        get: async () => ({ data: [] })
      })
    }
  }
}

const origLoad = Module._load
Module._load = function (request) {
  if (request === 'wx-server-sdk') {
    return {
      DYNAMIC_CURRENT_ENV: 'test-env',
      init: () => {},
      database: () => dbApi,
      getWXContext: () => ({ OPENID: currentOpenid })
    }
  }
  return origLoad.apply(this, arguments)
}

process.env.GX_TURN_MS = '150'
process.env.GX_DEAL_MS = '300'
const fn = require(path.resolve(__dirname, '..', 'minigame', 'cloudfunctions', 'gx13', 'index.js'))
const log = (...a) => console.log(...a)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const t0 = Date.now()
const el = () => ((Date.now() - t0) / 1000).toFixed(1) + 's'

async function main() {
  currentOpenid = 'openid_A'
  const created = await fn.main({ action: 'create', name: '阿明', rounds: 8 })
  if (created.t !== 'joined') throw new Error('create failed: ' + JSON.stringify(created))
  const room = created.room
  log('[' + el() + '] 建房', room)

  currentOpenid = 'openid_B'
  const joined = await fn.main({ action: 'join', name: '阿强', room })
  log('[' + el() + '] 加入', joined.t, joined.state.seats.map((s) => s.name).join('|'))

  const left = await fn.main({ action: 'leave', room })
  log('[' + el() + '] 离开', left.t)

  currentOpenid = 'openid_A'
  const st = await fn.main({ action: 'start', room })
  log('[' + el() + '] 开局 round=' + st.round + ' seats=' + st.seats.map((s) => s.name + (s.ai ? '(AI)' : '')).join('|') + ' 我的牌=' + st.hand.length)

  let lastPhase = ''
  let roundsSeen = []
  let over = false
  for (let i = 0; i < 900; i++) {
    const v = await fn.main({ action: 'state', room })
    if (v.phase !== lastPhase) { log('[' + el() + '] phase ' + lastPhase + ' -> ' + v.phase + ' round ' + v.round + ' turn ' + v.turn + ' 桌面 ' + JSON.stringify(v.combo)); lastPhase = v.phase }
    if (v.phase === 'settle') {
      log('[' + el() + '] 结算 名次=' + (v.lastResult ? v.lastResult.ranks.join('>') : '?') + ' 分数=' + v.seats.map((s) => s.score).join('/') + ' 模式=' + (v.lastResult ? v.lastResult.mode : '?'))
      const nx = await fn.main({ action: 'next', room })
      log('[' + el() + '] 下一局 round=' + nx.round + ' phase=' + nx.phase)
      if (nx.round > 1) {
        await sleep(2600)
        const v2 = await fn.main({ action: 'state', room })
        log('[' + el() + '] 第2局 phase=' + v2.phase + ' 进贡=' + (v2.tribute ? JSON.stringify(v2.tribute.draws) + ' 提示:' + v2.tribute.log.map((l) => l.text).join(' / ') : '无') + ' 先出座位=' + v2.turn)
        over = true
        break
      }
    }
    if (v.phase === 'summary') { log('[' + el() + '] 全部打完'); over = true; break }
    await sleep(260)
  }
  if (!over) throw new Error('未在限制时间内跑完一局')
  log('[' + el() + '] OK')
}

main().catch((e) => { console.error('FAIL', e && e.message); process.exit(1) })
