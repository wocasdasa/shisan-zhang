// 广西十三张 · 联机云函数（CloudBase / 微信云开发）
// 先做链路自检：返回调用者 openid 与环境信息
const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

exports.main = async (event) => {
  const ctx = cloud.getWXContext()
  return {
    ok: true,
    action: event && event.action ? event.action : 'ping',
    openid: ctx.OPENID || '',
    appid: ctx.APPID || '',
    env: process.env.TCB_ENV || '',
    now: Date.now(),
  }
}
