// 云函数新协议回归：快速开局 / 发言 / 改名 / 解散 / 重连 / 准备
// 用法：node tools/cloud-feature-test.js
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
          if ('lockAt' in cond && rec.lockAt !== cond.lockAt) {
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
process.env.GX_DEAL_MS = '120'
const fn = require(path.resolve(__dirname, '..', 'minigame', 'cloudfunctions', 'gx13', 'index.js'))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let passed = 0

function ok(cond, name, detail) {
  if (!cond) throw new Error('FAIL ' + name + (detail ? ' :: ' + detail : ''))
  passed++
  console.log('PASS ' + name)
}

async function as(openid, event) {
  currentOpenid = openid
  return await fn.main(event)
}

async function main() {
  // 1. 快速开局：1 真人 + 3 机器人，直接开局
  const quick = await as('openid_A', {
    action: 'quick', name: '阿明', rounds: 8,
    cfg: { tributeTier: 'heavy', turnSeconds: 20, teamHint: 'none', testTribute: false }
  })
  ok(quick.t === 'joined' && quick.room, 'quick joined', JSON.stringify(quick))
  ok(quick.state && quick.state.hand.length === 13, 'quick hand 13', quick.state && quick.state.hand.length)
  ok(quick.state.seats.filter((s) => s.ai).length === 3, 'quick 3 AI')
  ok(quick.state.phase === 'deal' || quick.state.phase === 'play', 'quick phase', quick.state.phase)
  const quickRoom = quick.room
  ok(store.gx13_rooms[quickRoom] && store.gx13_rooms[quickRoom].lockAt === 0, 'quick lockAt initialized')

  // 2. 发言与改名
  const chat = await as('openid_A', { action: 'chat', room: quickRoom, kind: 'text', text: '快点吧' })
  ok(chat.t === 'state' && chat.chat && chat.chat.length === 1, 'chat stored', JSON.stringify(chat.chat))
  const renamed = await as('openid_A', { action: 'rename', room: quickRoom, name: '新阿明' })
  ok(renamed.seats[0].name === '新阿明', 'rename applied')

  // 3. 快速房主离开：只剩机器人，房间应删除
  const leftQuick = await as('openid_A', { action: 'leave', room: quickRoom })
  ok(leftQuick.t === 'left', 'quick leave left', JSON.stringify(leftQuick))
  const gone = await as('openid_A', { action: 'state', room: quickRoom })
  ok(gone.t === 'err' && gone.code === 'roomMissing', 'quick room removed', JSON.stringify(gone))

  // 4. 好友房：准备、加入方发言、非房主解散被拒、房主解散成功
  const created = await as('openid_A', { action: 'create', name: '房主', rounds: 8 })
  ok(created.t === 'joined', 'create joined')
  const room = created.room
  const joined = await as('openid_B', { action: 'join', name: '阿强', room })
  ok(joined.t === 'joined' && joined.seat === 1, 'join seat 1', JSON.stringify(joined))
  const ready = await as('openid_B', { action: 'ready', room, v: true })
  ok(ready.t === 'state' && ready.seats[0].ready === true, 'ready state')
  const chatB = await as('openid_B', { action: 'chat', room, kind: 'emoji', text: '😭' })
  ok(chatB.chat && chatB.chat.some((c) => c.rel === 0 && c.kind === 'emoji'), 'chat own rel')
  const renameB = await as('openid_B', { action: 'rename', room, name: '强哥' })
  ok(renameB.seats[0].name === '强哥', 'rename B')

  const badDissolve = await as('openid_B', { action: 'dissolve', room })
  ok(badDissolve.t === 'err' && badDissolve.code === 'notHost', 'non-host dissolve rejected', JSON.stringify(badDissolve))
  const dissolved = await as('openid_A', { action: 'dissolve', room })
  ok(dissolved.t === 'roomClosed', 'host dissolve', JSON.stringify(dissolved))
  const afterDissolve = await as('openid_A', { action: 'state', room })
  ok(afterDissolve.t === 'err' && afterDissolve.code === 'roomMissing', 'dissolved room missing')

  // 5. 重连：云函数按 openid 找回座位
  const c2 = await as('openid_A', { action: 'create', name: '重连测试', rounds: 8 })
  const r2 = c2.room
  await as('openid_B', { action: 'join', name: 'B', room: r2 })
  const rejoin = await as('openid_A', { action: 'rejoin', room: r2 })
  ok(rejoin.t === 'joined' && rejoin.rejoin === true && rejoin.seat === 0, 'rejoin host', JSON.stringify(rejoin))
  const rejoinB = await as('openid_B', { action: 'rejoin', room: r2 })
  ok(rejoinB.t === 'joined' && rejoinB.seat === 1, 'rejoin guest')

  // 6. 房主离开等待房：房主转给下一位真人
  const leaveA = await as('openid_A', { action: 'leave', room: r2 })
  ok(leaveA.t === 'state' && leaveA.host === false, 'host left, guest stays', JSON.stringify(leaveA))
  const leaveB = await as('openid_B', { action: 'leave', room: r2 })
  ok(leaveB.t === 'left', 'last human leaves removes room', JSON.stringify(leaveB))

  await sleep(50)
  console.log('\nCLOUD-FEATURE-PASS ' + passed + ' checks')
}

main().catch((e) => { console.error(e && e.stack || e); process.exit(1) })
