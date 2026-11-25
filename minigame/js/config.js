// 联机服务器默认地址（构建期配置）
// 上线时把 SERVER_URL 填成已备案域名的 wss 地址，例如：
//   module.exports = { SERVER_URL: 'wss://gx13.example.com/gx13' };
// 留空则沿用原来的逻辑：本地存储 gx13_server > 按当前 host 推导 > ws://127.0.0.1:8787
// 游戏内也可以在「联机对战」大厅点「服务器」一行临时改地址（写进本地存储，优先于本文件）
//
// 心跳调参（一般不用动；联调时可调短）：
//   HB_MS       发 ping 的间隔，默认 25000
//   HB_DEAD_MS  多久没有任何入站消息算断线，默认 60000（必须大于回合超时 20000）
module.exports = { SERVER_URL: '' };
