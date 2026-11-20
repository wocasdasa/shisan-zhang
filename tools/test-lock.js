// 并发写锁自测：多请求同时打到同一房间，不应互相覆盖或卡死
const path = require('path')
const Module = require('module')

const store = { gx13_rooms: {} }
const fakeDb = {
  collection: (name) => ({
    doc: (id) => ({
      get: async () => ({ data: store[name][id] || null }),
      set: async (obj) => { store[name][id] = JSON.parse(JSON.stringify(obj.data)) },
      update: async (arg) => {
        if (!store[name][id]) return { updated: 0 }
        Object.assign(store[name][id], arg.data)
        return { updated: 1 }
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
    }),
    add: async (o) => { const id = 'r' + Date.now(); store[name][id] = o; return { id } }
  }),
  createCollection: async (n) => { if (!store[n]) store[n] = {} }
}

let currentOpenid = 'openid_A'
const origLoad = Module._load
Module._load = function (req) {
  if (req === 'wx-server-sdk') {
    return { init: () => {}, database: () => fakeDb, getWXContext: () => ({ OPENID: currentOpenid }), DYNAMIC_CURRENT_ENV: 'x' }
  }
  return origLoad.apply(this, arguments)
}

const fn = require(path.resolve(__dirname, '..', 'minigame', 'cloudfunctions', 'gx13', 'index.js'))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function main() {
  const created = await fn.main({ action: 'create', name: '阿明', rounds: 8 })
  const room = created.room
  await fn.main({ action: 'start', room })
  await sleep(2600)

  // 20 个并发 state：同一时刻抢同一把锁
  const rs = await Promise.all(Array.from({ length: 20 }, () => fn.main({ action: 'state', room })))
  const busy = rs.filter((r) => r.t === 'busy').length
  const errm = rs.filter((r) => r.t === 'err').length
  console.log('并发 20 次 state：busy=' + busy + ' err=' + errm + ' 成功=' + rs.filter((r) => r.t !== 'busy' && r.t !== 'err').length)

  const doc = store.gx13_rooms[room]
  console.log('锁已释放 = ' + (doc.lockAt === 0) + '（lockAt=' + doc.lockAt + '）')
  console.log('房间完整 = ' + (!!doc.data && doc.data.seats && doc.data.seats.length === 4 && !!doc.data.game))
  const v = await fn.main({ action: 'state', room })
  console.log('复位后 phase=' + v.phase + ' 手牌=' + (v.hand ? v.hand.length : '-') + ' 座位数=' + v.seats.length)
  if (doc.lockAt !== 0) throw new Error('锁没有释放，会卡死后续请求')
}

main().catch((e) => { console.error('FAIL', e.stack); process.exit(1) })
