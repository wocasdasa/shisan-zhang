# 自建 WebSocket / wss 上线手册（备用）

> **当前项目已改用微信云开发联机，不需要公网服务器、域名、备案和证书。**
> 线上部署请直接看：[`deploy/cloud-dev.md`](./cloud-dev.md)。
>
> 本文保留给以后需要自建服务端的场景；`minigame/js/config.js` 默认已经在 `CLOUD_ON: true`，
> 微信端不会走这里。只有把 `gx13_cloud` 设成 `'0'` 才会回退到 WebSocket。

目标：让真机能连上 `wss://` 联机服务。代码侧已经就绪，剩下的是域名、证书、进程托管三件事。

> 前置硬条件（微信小游戏的规定，绕不过去）
> 1. **已备案域名**；
> 2. **受信任的证书**（自签证书真机不认）；
> 3. 微信后台「开发管理 → 开发设置 → 服务器域名 → socket 合法域名」里填这个域名；
> 4. 合法域名**不能带端口**，所以生产只能走 443。

---

## 0. 目录约定

服务端只需要三个东西，可以只上传这些：

```
server/index.js   server/ws.js
engine/           规则引擎（server 依赖它）
```

Node ≥ 18（推荐 22）。

---

## 1. 方案选择

| 方案 | 适用 | 说明 |
|---|---|---|
| A. nginx 反代（推荐生产） | 有域名、走 443 | TLS 交给 nginx，Node 只监听 `127.0.0.1:8787` |
| B. 服务端原生 TLS | 内网/联调/不想装 nginx | Node 自己监听 443（需要 `CAP_NET_BIND_SERVICE` 或 root） |

两者代码都支持，可以先用 B 跑通再换 A。

---

## 2. 证书

**Let's Encrypt（免费，推荐）**

```bash
sudo apt install -y certbot
sudo certbot certonly --standalone -d gx13.example.com
# 产物：/etc/letsencrypt/live/gx13.example.com/{fullchain.pem,privkey.pem}
```

续期后需要重载：`sudo certbot renew --deploy-hook "systemctl reload nginx || systemctl restart gx13"`。

**云厂商证书**：下载 Nginx 版（`.pem` + `.key`）即可，路径换成你的。

---

## 3. 方案 A：nginx 反代（推荐）

`/etc/nginx/conf.d/gx13.conf` 见本目录 `nginx-gx13.conf`，要点：

- `location /gx13/` + `proxy_pass http://127.0.0.1:8787/;`（**结尾的斜杠**会把 `/gx13` 前缀去掉，服务端的 `/health` 才能对上）
- 必须转发 `Upgrade` / `Connection`，否则 WebSocket 握手 400
- `proxy_read_timeout` 要放大，否则空闲连接会被 nginx 掐掉

启动 Node（只监听本机）：

```bash
HOST=127.0.0.1 PORT=8787 node server/index.js
```

验收：

```bash
curl https://gx13.example.com/gx13/health
# {"ok":true,"uptime":12,"secure":false,"rooms":0,"conns":0,"players":0}
node tools/wss-smoke.js wss://gx13.example.com/gx13
```

注意 `secure:false` 是对的：TLS 在 nginx 那层终止，Node 看到的是明文。

---

## 4. 方案 B：服务端原生 TLS

```bash
sudo setcap 'cap_net_bind_service=+ep' "$(which node)"   # 允许非 root 监听 443
TLS_KEY=/etc/letsencrypt/live/gx13.example.com/privkey.pem \
TLS_CERT=/etc/letsencrypt/live/gx13.example.com/fullchain.pem \
PORT=443 HOST=0.0.0.0 node server/index.js
```

- 也支持 PFX：`TLS_PFX=/path/cert.pfx TLS_PASS=密码`
- 启动日志会打印 `wss://…`；`curl https://域名/health` 应返回 `"secure":true`
- 证书读不到会**回退成 ws:// 并打错误日志**，上线前务必看日志确认

---

## 5. 进程托管（systemd）

```bash
sudo cp deploy/gx13-server.service /etc/systemd/system/gx13.service
sudo cp deploy/gx13.env.example /etc/gx13.env      # 按需改
sudo systemctl daemon-reload
sudo systemctl enable --now gx13
sudo systemctl status gx13 --no-pager
journalctl -u gx13 -n 50 --no-pager
```

---

## 6. 客户端指向 wss

两种方式，**存储里的值优先于构建期配置**：

1. **构建期**（推荐，玩家无感）：`minigame/js/config.js`
   ```js
   module.exports = { SERVER_URL: 'wss://gx13.example.com/gx13' };
   ```
   改完跑 `node tools/build-mini-preview.js` 并重新上传小游戏。
2. **游戏内**：联机大厅点「服务器 ws://…」那一行 → 输入新地址（微信走系统键盘）。
   适合临时联调，写进本地 `gx13_server`。

---

## 7. 微信后台

1. 「开发管理 → 开发设置 → 服务器域名 → socket 合法域名」添加 `wss://gx13.example.com`（不带端口、不带路径）；
2. 体验版/正式版都要重新编译上传（改了 `config.js` 或域名后必须重新上传）；
3. 真机上如果仍显示 `ws://127.0.0.1:8787`，说明 `config.js` 没生效或没重新构建。

> 开发期想在开发者工具里连本机，`project.config.json` 已关域名校验；真机不行。
> 手机和电脑在同一局域网时，可在游戏内把服务器改成 `ws://192.168.x.x:8787` 做局域网联调（微信真机允许 ws:// 仅限调试开关打开时）。

---

## 8. 环境变量一览

| 变量 | 默认 | 作用 |
|---|---|---|
| `PORT` | `8787` | 监听端口 |
| `HOST` | `0.0.0.0` | 绑定地址；反代模式建议 `127.0.0.1` |
| `TLS_KEY` / `TLS_CERT` | 空 | PEM 证书；两个都给才启用 TLS |
| `TLS_PFX` / `TLS_PASS` | 空 | PFX 证书（Windows 导出常用） |
| `MAX_CONNS` | `400` | 同时在线连接上限 |
| `MAX_ROOMS` | `200` | 房间数上限 |
| `RATE_MSGS` / `RATE_WIN_MS` | `60` / `10000` | 单连接每窗口消息上限（防刷） |
| `IDLE_CLOSE_MS` | `90000` | 多久没有入站数据就断开（客户端 25s 心跳，正常不会触发） |
| `ROOM_IDLE_MS` | `600000` | 无人在线且 10 分钟无操作则回收房间 |
| `DEBUG` | 空 | 打 `[rate]` / `[gc]` 诊断日志 |

---

## 9. 上线验收清单

- [ ] `curl https://域名/health`（反代加 `/gx13`）返回 `ok:true`
- [ ] `node tools/wss-smoke.js wss://域名[/路径]` 打印 `PASS`
- [ ] 微信后台 socket 合法域名已加、版本已重新上传
- [ ] 真机建房 → 另一台手机输房号进房 → 四家发牌正常
- [ ] 真机等 60 秒不动，连接不断（心跳生效）
- [ ] 真机杀进程/切飞行模式 10 秒再切回，自动重连回原座位（服务端 90 秒宽限）
- [ ] 房主「解散房间」后四人回大厅；非房主点被拒

---

## 10. 常见故障

| 现象 | 原因 |
|---|---|
| 真机一直「连接失败」 | 域名没备案 / 证书不受信任 / 后台没加 socket 域名 / 用了 ws:// |
| 握手 400 或一直 connecting | nginx 没转发 `Upgrade`、`Connection` |
| 能进房，一分钟左右全员掉线 | 心跳没跑（旧版本）或中间层空闲超时（放大 `proxy_read_timeout`） |
| `curl /health` 404 | 反代路径没剥前缀（`proxy_pass` 少了结尾斜杠） |
| 启动日志还是 `ws://` | `TLS_KEY/TLS_CERT` 没读到，日志里有 `[tls] 证书读取失败` |
| 房间号被占用/房间越积越多 | `IDLE_CLOSE_MS` 太大或客户端不发心跳；空房 10 分钟会自动回收 |
