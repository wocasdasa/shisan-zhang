# 联机 wss 就绪 + views.js 拆分 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans。步骤用 `- [ ]` 跟踪。

**Goal:** 让服务端可直接以 wss 提供服务、客户端能在真机上换服并自愈断线，同时把 97KB 的 `views.js` 拆成 4 层且画面与热区零变化。

**Architecture:** 服务端 `ws.js` 增加可选 TLS（PEM/PFX）与 `/health`，`server/index.js` 增加连接/房间上限、限流、死连接与空房回收；客户端 `net.js` 增加 25s 心跳与 60s 静默判定，新增 `js/config.js` 与大厅「服务器」入口；`views.js` 按 base/table/panels 三层 + 编排层拆开，依赖以同名局部变量注入，函数体逐字搬运。

**Tech Stack:** Node 22（零依赖）、纯 CommonJS、Canvas 2D、微信小游戏 `wx.*` 适配、PowerShell 生成自签证书、headless Chrome 截图回归。

**Spec:** `docs/superpowers/specs/2026-11-25-wss-and-views-split-design.md`

## Global Constraints

- 零第三方依赖，Node ≥ 18。
- `engine/` 不动；若动必须 `node tools/sync-engine.js`。
- `minigame/preview.html` 只能由 `node tools/build-mini-preview.js` 生成；新增模块必须登记 `FILES`。
- 提交前必须全绿：`test/selftest.js`（55/0）、`test/selfplay.js`（异常全 0）、`smoke-solo-tribute`、`smoke-lone-tribute`、`smoke-server-tribute`。
- 不实现云开发房间逻辑，不改玩法规则。

## Review Focus

- 心跳在**回合超时 20 秒**的空闲窗口里不能误判掉线（60s 阈值必须大于 20s + 网络抖动）。
- 服务端未配置证书时**行为必须与现在完全一致**（仍监听 `0.0.0.0:8787`，仍是 `ws://`）。
- 拆 views 后 `draw()` 返回的 `hits` 必须顺序一致：后渲染的浮层要压在先渲染的热区之上。
- 大厅「服务器」入口在**微信端**必须用 `P.askText`（系统键盘），不能用 `prompt`。
- 死连接清理不能打断正在等待进贡选牌的真人（该阶段可能长时间无消息，靠客户端心跳保活）。

---

### Task 1: 清理 tools/ 一次性脚本

**Files:**
- Delete: `tools/patch-*.js`（18 个）、`tools/cdp-direct.js`、`cdp-hitcheck.js`、`cdp-probe.js`、`cdp-sample.js`、`cdp-seq.js`、`cdp-solo.js`、`cdp-tap.js`
- Modify: `README.md` 第 4 节末尾说明

**Interfaces:**
- Produces: 无（纯删除）

- [ ] **Step 1: 确认没有脚本被引用**

Run: `Select-String -Path README.md,minigame\README.md,tools\*.js -Pattern 'patch-|cdp-direct|cdp-probe'`
Expected: 只有 README 里「可直接删除」那句命中。

- [ ] **Step 2: git rm 删除**

```powershell
git rm tools/patch-*.js tools/cdp-direct.js tools/cdp-hitcheck.js tools/cdp-probe.js tools/cdp-sample.js tools/cdp-seq.js tools/cdp-solo.js tools/cdp-tap.js
```

- [ ] **Step 3: 验证仍可构建与自检**

Run: `node tools/build-mini-preview.js; node test/selftest.js`
Expected: 生成 preview.html；`55 通过 / 0 失败`。

- [ ] **Step 4: Commit**

```
git commit -m "chore(tools): 删除 25 个一次性 patch/cdp 取证脚本"
```

---

### Task 2: 服务端 wss-ready

**Files:**
- Modify: `server/ws.js`
- Modify: `server/index.js`（文件末尾的 `WS.createServer` 与定时扫描处）

**Interfaces:**
- Produces:
  - `WS.createServer(port, onConn, opts)`，`opts = { host?, tls?: {key?,cert?,pfx?,passphrase?}, maxPayload?, onListen? }`
  - `Conn.lastSeen: number`（任意入站数据刷新）、`Conn.ip: string`
  - HTTP `GET /health` → `{ ok, rooms, conns, uptime }`
- Consumes: 现有 `GX.*`、`conns`、`rooms`

- [ ] **Step 1: ws.js 增加 TLS 与健康检查**

`createServer` 用 `tls && (tls.key||tls.pfx) ? https.createServer(tls, handler) : http.createServer(handler)`；`handler` 在 `/health` 返回 JSON，其余返回原文本。`drain()` 里 `len > maxPayload` 直接 `close()`；收到任意帧刷新 `lastSeen`；`opcode 0xA` 忽略。

- [ ] **Step 2: index.js 增加上限与清理**

环境变量与默认值：`HOST=0.0.0.0`、`MAX_CONNS=400`、`MAX_ROOMS=200`、`RATE_MSGS=60 / RATE_WIN_MS=10000`、`IDLE_CLOSE_MS=90000`、`ROOM_IDLE_MS=600000`。
在 `WS.createServer` 的 onConn 里：超上限直接 `conn.close()`；每条消息推入 `conn.msgTimes` 并按窗口裁剪，超限即关闭；`conn.on('close')` 保留现有 `leaveRoom`。
新增 5 秒扫描：`lastSeen` 超 `IDLE_CLOSE_MS` 关闭；房间无人且 `lastActivity` 超 `ROOM_IDLE_MS` 删除。
`SIGINT`/`SIGTERM`：停止接受新连接、关闭所有 conn、`process.exit(0)`。

- [ ] **Step 3: 不配证书时行为不变**

Run: `node server/index.js`（后台），`node tools/wsclient.js` 或 `node tools/netbot.js`
Expected: 仍打印 `ws://0.0.0.0:8787`，建房/进房正常。

- [ ] **Step 4: /health 可用**

Run: `curl http://127.0.0.1:8787/health`
Expected: `{"ok":true,"rooms":0,"conns":0,...}`。

- [ ] **Step 5: Commit**

```
git commit -m "feat(server): 可选 TLS(wss) + /health + 连接/房间上限与空闲回收"
```

---

### Task 3: 客户端心跳与地址配置

**Files:**
- Create: `minigame/js/config.js`
- Modify: `minigame/js/net.js`（`defaultUrl()` 与 `wsConnect`）
- Modify: `minigame/js/views.js`（`lobbyPanel` entry 分支的服务器一行）
- Modify: `minigame/js/app.js`（`handleAct` 增加 `netServer`）
- Modify: `tools/build-mini-preview.js`（`FILES` 增加 `js/config.js`）

**Interfaces:**
- Produces:
  - `CONFIG = { SERVER_URL: '' }`，空串表示不覆盖
  - `NET.defaultUrl()` 优先级：`wx` 存储 `gx13_server` → `CONFIG.SERVER_URL` → 现有推导
  - 热区 `{ act: 'netServer' }`

- [ ] **Step 1: config.js**

```js
module.exports = { SERVER_URL: '' }; // 上线时填 wss://your-domain/gx13
```

- [ ] **Step 2: net.js 心跳**

`wsConnect` 成功 open 后启动 25s `setInterval`，用 `rawSend({t:'ping'})`；记录 `lastMsgAt`（任何入站消息刷新）；每拍检查 `Date.now()-lastMsgAt > 60000` 则 `fire('close')` 并 `close()`。`close()` 里清定时器。

- [ ] **Step 3: 大厅入口**

`lobbyPanel` 把 `txt('服务器 ' + S.lobby.url)` 改为带下划线的可点行，`hits.push({x:px+40,y:py+100,w:pw-80,h:28,act:'netServer'})`；`app.js` 分支：

```js
if (h.act === 'netServer') {
  P.askText('联机服务器地址', NET.defaultUrl(), 64, function (v) {
    if (!v) return;
    try { wx.setStorageSync('gx13_server', v); } catch (e) {}
    S.lobby = { kind: 'entry', url: v, err: '', code: '' };
    P.markDirty();
  });
  return;
}
```
浏览器端 `P.askText` 走 `prompt`，微信端走系统键盘。

- [ ] **Step 4: 构建并人工确认**

Run: `node tools/build-mini-preview.js`，打开 `?demo=lobby`
Expected: 「服务器 …」一行可点，点击弹输入框；输入 `wss://x` 后该行文案更新。

- [ ] **Step 5: Commit**

```
git commit -m "feat(net): 客户端心跳(25s/60s) + 可配置服务器地址 + 构建期默认值"
```

---

### Task 4: 本地自签 wss 端到端验证

**Files:**
- Create: `tools/wss-smoke.js`
- Create: `deploy/`（本任务只产出验证所需，文档在 Task 6）

**Interfaces:**
- Produces: `node tools/wss-smoke.js wss://127.0.0.1:8788 [--insecure]` → 打印 `joined room=xxxx` 后退出码 0

- [ ] **Step 1: 生成自签 PFX**

```powershell
$c = New-SelfSignedCertificate -DnsName localhost,127.0.0.1 -CertStoreLocation Cert:\CurrentUser\My -KeySpec KeyExchange
$pw = ConvertTo-SecureString -String 'gx13' -AsPlainText -Force
Export-PfxCertificate -Cert $c -FilePath .tools\dev-selfsigned.pfx -Password $pw | Out-Null
Remove-Item ("Cert:\CurrentUser\My\" + $c.Thumbprint)
```

- [ ] **Step 2: 写 wss-smoke.js**

用 Node 22 全局 `WebSocket`；`--insecure` 时 `NODE_TLS_REJECT_UNAUTHORIZED=0`；发 `create`，等 `joined` 打印房号，再发 `chat` 验证往返，3 秒超时退出码 1。

- [ ] **Step 3: 起 TLS 服务端**

```powershell
$env:TLS_PFX='.tools\dev-selfsigned.pfx'; $env:TLS_PASS='gx13'; $env:PORT='8788'; node server/index.js
```

- [ ] **Step 4: 跑一次**

Run: `node tools/wss-smoke.js wss://127.0.0.1:8788 --insecure`
Expected: `joined room=1000` + `chat ok`，退出码 0。

- [ ] **Step 5: Commit**

```
git commit -m "test(server): wss 冒烟脚本 + 自签验证流程"
```

---

### Task 5: 拆分 views.js

**Files:**
- Create: `minigame/js/views/base.js`、`minigame/js/views/table.js`、`minigame/js/views/panels.js`
- Modify: `minigame/js/views.js`（只剩 `layout` 转发、`draw()`、导出）
- Modify: `tools/build-mini-preview.js`（`FILES` 增加三个新模块，位置在 `js/views.js` 之前）
- Create: `tools/shot-matrix.js`（截图 + 热区快照采集/比对）

**Interfaces:**
- Produces:
  - `require('./views/base.js')() -> B`，`B = {W,C,SEAT_NAMES,layout,setLastH,getLastH,rr,box,txt,bg,drawCard,drawBack,pill,btn,clockChip,overlay,banner,identityFx,loneRevealFx,kindFx,fxOverlay,fxProgress,confetti,flushRgb,fxShake,drawSpade,easeOut,ring,burst,cardTxt,kindLabel,rankText,isRed}`
  - `require('./views/table.js')(B, getLastH) -> T`，`T = {header,seats,seatPlate,drawnFan,center,dealTable,dealState,hand,actions,chatEntry}`
  - `require('./views/panels.js')(B, T) -> P`，`P = {tribute,settle,menu,summary,testPanel,toast,lobbyPanel,roomPanel,chatPanel,chatBubbles,recordStrip,toolsDrawer,statsPanel,replayPanel,guidePanel,pausePanel,askPanel}`
  - `views.js` 导出不变：`{ draw, layout, C, SEAT_NAMES }`

- [ ] **Step 1: 加调试钩子并采集基线**

`draw()` 末尾 `if (typeof window !== 'undefined') window.__lastHits = hits;`（真机无 window，不影响）。重建 preview，用 `tools/shot-matrix.js` 对 16 个 demo 模式采集 `baseline/<mode>.png` 与 `<mode>.hits.json`。

- [ ] **Step 2: 抽取 base.js**

把原文件 1–27 行的常量、`layout`、绘制原语与全部特效函数搬入；`lastH` 保留在 base 内，暴露 `setLastH/getLastH`。删掉第 95–110 行那份**被同名覆盖的死代码** `drawBack`（运行时从未生效）。

- [ ] **Step 3: 抽取 table.js 与 panels.js**

按函数行号范围整段搬运，函数体不改；每个模块顶部以同名局部变量接住依赖。跨模块调用只在 `table→base`、`panels→base` 两个方向，若出现反向引用则把该函数上移到 base。

- [ ] **Step 4: 重写 views.js 编排层**

`draw()` 里 `lastH = H` 改为 `B.setLastH(H)`；其余调用名不变（由同名局部变量接住）。

- [ ] **Step 5: 重建并回归**

Run: `node tools/build-mini-preview.js; node tools/shot-matrix.js --compare`
Expected: 16 个模式 PNG 逐字节一致，`hits.json` 深度相等；页面标题无 `JSERROR`。

- [ ] **Step 6: 引擎与自检全绿**

Run: `node test/selftest.js; node test/selfplay.js`
Expected: `55 通过 / 0 失败`；自战异常全 0。

- [ ] **Step 7: Commit**

```
git commit -m "refactor(views): 拆为 base/table/panels 三层，像素与热区零变化"
```

---

### Task 6: 部署文档与收尾

**Files:**
- Create: `deploy/README.md`、`deploy/gx13-server.service`、`deploy/nginx-gx13.conf`
- Modify: `README.md`（第 3.3、9、10 节）、`CHANGELOG.md`（1.0.6）

**Interfaces:**
- Consumes: Task 2 的环境变量、Task 3 的 `config.js`

- [ ] **Step 1: 部署文档**

写清：域名备案 → 证书（certbot 或云厂商）→ `TLS_KEY/TLS_CERT` 或 `TLS_PFX` → systemd → 微信后台「socket 合法域名」→ `config.js` 填 `wss://` → 验收命令（`/health`、`wss-smoke`、真机建房）。

- [ ] **Step 2: 更新 README / CHANGELOG**

README 增「联机上线（wss）」小节与新的环境变量表；CHANGELOG 记 1.0.6 用户可感知变化（服务器地址可在游戏内改、断线自愈更快、公网长连接不再假死）。

- [ ] **Step 3: 全套验证**

Run: `node test/selftest.js; node test/selfplay.js; node tools/smoke-solo-tribute.js; node tools/smoke-lone-tribute.js`
Expected: 全绿。

- [ ] **Step 4: Commit**

```
git commit -m "docs: wss 部署手册 + 1.0.6 更新记录"
```
