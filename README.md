# 广西十三张 · 独食

「十三张独食（横县找朋友 / 找朋友）」的可玩实现：**一套规则引擎 + 三个运行端**——微信小游戏、浏览器预览页、自建 WebSocket 联机服务端。
纯 Canvas 绘制（无 DOM、无第三方框架），音频全部程序合成，只有出牌播报用 25 个人声小片段。

- 玩法：4 人一桌，♠3 / ♠A 持有者组队；同一人拿两张 = **独食 1 打 3**
- 模式：联机统一入口——**快速开局**为 1 真人 + 3 机器人；**创建/加入房间**最多 4 真人，空位仍补机器人。不再提供独立单机模式
- 规则细节见 [`docs/规则书-十三张独食.md`](docs/规则书-十三张独食.md)，实现口径见 [`docs/设计文档-十三张独食-v1.md`](docs/设计文档-十三张独食-v1.md)

> 纯积分休闲牌类小游戏，不涉及现金、实物奖励、充值或兑换。

---

## 1. 架构

```
                 ┌────────────────────┐
                 │  engine/  规则引擎  │  纯函数、无平台依赖，Node 与小游戏都能跑
                 └─────────┬──────────┘
        ┌──────────────────┼───────────────────┐
        │                  │                   │
  minigame/js/engine   server/index.js     test/、tools/smoke-*
  （小游戏内副本）      （联机权威端）      （自战/回归脚本）
        │
  minigame/js/{app,views,audio,net,platform}.js
        ├── 微信小游戏（wx.* 适配）
        └── preview.html（浏览器适配，构建产物）
```

**关键约定：规则只有一份源码 `engine/`。** 小游戏打包无法引用工程外文件，所以 `minigame/js/engine/` 是它的副本：
改完 `engine/` 务必执行 `node tools/sync-engine.js`，否则小游戏和联机服务端会跑出不同判定。

| 层 | 位置 | 职责 |
|---|---|---|
| 规则引擎 | `engine/` 12 个模块 | 牌值/花色、牌型识别、合法出牌、身份与阵营、AI、结算、进贡；纯函数，无 I/O |
| 客户端（小游戏 + 浏览器） | `minigame/js/` | 状态机、点击热区、动效、音效与语音、联机传输、平台适配 |
| 联机服务端 | `server/` | 无依赖 ws 服务，房间、发牌、回合校验、进贡、计分全部在服务端；客户端只负责画和点 |
| 云函数 | `cloudfunctions/gx13/` | 仅链路自检桩（返回 openid/env），**没有房间逻辑**；实际联机走 WebSocket，微信云开发暂未启用 |
| 早期产物 | `ui/`、`dist/` | 网页原型稿与打包 zip，仅存档，不参与小游戏运行 |

---

## 2. 目录结构

```
guangxi_13/
├── engine/                 规则引擎（唯一源码）
│   ├── cards.js            牌值、花色、牌面文字
│   ├── rules.js            点数顺序、牌型判定、比较
│   ├── camp.js             ♠3/♠A 身份、组队、独食
│   ├── info.js             对局信息（谁亮牌、牌数）
│   ├── hand.js             手牌排序 / 选中维护
│   ├── moves.js            候选牌型枚举、最小合法牌
│   ├── table.js            一局流程：发牌、出牌、过牌、结算
│   ├── ai.js / ai2.js      新手/普通/高手 三档 AI
│   ├── settle.js           名次 → 分数
│   ├── tribute.js          进贡：配额、抽牌、还贡
│   └── index.js            统一导出 GX.*
├── minigame/               微信小游戏工程（用开发者工具导入这个目录）
│   ├── game.js             入口：require('./js/app.js').boot()
│   ├── game.json           横屏、无状态栏
│   ├── project.config.json AppID / 编译配置
│   ├── preview.html        浏览器预览（由 tools/build-mini-preview.js 生成，勿手改）
│   ├── audio/voice/*.wav   出牌播报 25 个原子词
│   ├── README.md           小游戏侧操作说明
│   └── js/
│       ├── app.js          状态机、触屏、计时、进贡交互、联机视图映射、昵称/发言
│       ├── views.js        绘制编排：draw() 产出 hits，按 phase 叠各层
│       ├── views/base.js   常量和 state（W/lastH/SKIN）+ 绘制原语 + 全部特效
│       ├── views/table.js  页头、座位、中央出牌区、手牌、操作条
│       ├── views/panels.js 进贡、结算、菜单、大厅、房间、聊天、工具抽屉、战绩、复盘、引导
│       ├── config.js       构建期默认服务器地址（上线填 wss://）
│       ├── audio.js        音效合成 + 语音播报队列
│       ├── net.js          传输层（wx.connectSocket / 浏览器 WebSocket）+ 心跳 + 重连
│       ├── platform.js     平台适配（设计宽 750、脏标记重绘、文字输入）
│       └── engine/         规则引擎副本（由 tools/sync-engine.js 同步）
├── server/
│   ├── index.js            房间与对局权威端（默认 ws://0.0.0.0:8787，配证书即 wss://）
│   └── ws.js               极简 WebSocket 实现（无第三方依赖，可选 TLS）
├── deploy/                 上线手册：systemd 单元、nginx 样例、环境变量
├── tools/                  开发脚本（见第 4 节）
├── test/                   自战与一致性校验
├── docs/                   规则书、设计文档、验证报告
├── cloudfunctions/gx13/    微信云函数桩
├── ui/                     早期网页原型（存档）
└── dist/                   打包 zip 输出目录
```

---

## 3. 跑起来

环境：**Node ≥ 18**（本机验证 v22.23.2），不需要 `npm install`，工程零第三方依赖。

### 3.1 浏览器预览（最快）

```powershell
node tools/build-mini-preview.js       # 把 minigame 各模块打包成单文件 preview.html
node server/index.js                   # 只有要联机才需要
```

然后直接双击 `minigame/preview.html`，或起个静态服务（推荐，避免 `file://` 下部分浏览器限制）：

```powershell
node -e "const h=require('http'),f=require('fs'),p=require('path');h.createServer((q,s)=>{const u=q.url.split('?')[0];f.readFile(p.join('minigame',u==='/'?'preview.html':u),(e,d)=>{if(e){s.statusCode=404;return s.end()}s.end(d)})}).listen(8777,()=>console.log('http://127.0.0.1:8777/preview.html'))"
```

调试用的页面参数（预览专用，不影响真机）：

| 参数 | 作用 |
|---|---|
| `?demo=testHand` | 直接进测试模式：主视角 4×3 / 4×A / 4×2 + ♦4，方便看出牌与独食 |
| `?demo=pullTest` / `&stage=draw\|pull\|pull3\|return` | 冻结进贡各阶段（还贡/抽一排/三家同时抽/还贡选牌），核对交互 |
| `?demo=tribute` / `?demo=tributeSeq` | 进贡面板直渲 / 真实跑一遍第 2 局分步流程 |
| `?demo=fx` / `?demo=identity&seat=2&rank=3` / `?demo=lone&seat=2` | 冻结出牌飞行、身份亮牌、独食揭示特效 |
| `?demo=flight` | 冻结一圈牌飞行中的状态 |
| `?demo=lobby` / `?demo=cfg` / `?demo=keypad` | 大厅、配置面板、数字键盘 |
| `?demo=online` | 伪造一桌联机视图（含发言、身份徽标） |
| `?demo=online&wait=1` | 冻结在等待开局，核对房间面板（改名 / 发言） |
| `?demo=online&chat=1[&bubble=1]` | 打开右侧发言浮层；加 `bubble=1` 改成只看桌上气泡 |
| `?demo=online&tools=1` / `pause=1` / `stats=1` / `record=1` / `replay=1` / `guide=1` | 直接摊开工具抽屉 / 对局菜单 / 战绩 / 记牌器 / 复盘 / 新手引导 |
| `?demo=online&settle=1` | 冻结在结算页（带假战绩，核对分享、复盘、连胜光效） |
| `?demo=<任意>&skin=0\|1\|2` | 预览三套牌背皮肤 |
| `?auto=1&demo=testHand` | 南家也交给 AI，用来跑通整局（自测结算/战绩/复盘链路） |
| `?room=1000&server=ws://127.0.0.1:8787` | 直接进指定房间 |
| `?name=昵称` | 首次进房用的昵称 |

### 3.2 微信开发者工具

1. 开发者工具 → 导入项目 → 目录选 `minigame/`，项目类型必须 **小游戏**（不是小程序）
2. AppID 已填 `wx31c52de4c0526c31`（本项目的小游戏 AppID）
3. 编译即可；`project.config.json` 里 `urlCheck: false` 已关掉域名校验，方便连本地 `ws://`
4. 真机联机必须把 `ws://` 换成已备案的 **`wss://`** 域名（`wx.setStorageSync('gx13_server','wss://…')` 或 `?server=`）

### 3.3 联机服务端

```powershell
node server/index.js            # 默认 8787，PORT/HOST 环境变量可改
```

- 客户端默认连 `ws://<当前host>:8787`，可 `?server=ws://192.168.1.5:8787` 覆盖；真机在联机大厅点「服务器」一行改地址
- 主界面只有「开始游戏」→ 联机大厅。**快速开局**发 `{t:'quick'}`，服务端一次完成建房、补 3 个机器人、发牌；**创建/加入房间**用于好友局，房主点「开始（空位补机器人）」，最多 4 真人
- 快速验证联机：`node tools/smoke-quick.js`（快速人机协议）、`node tools/wss-smoke.js ws://127.0.0.1:8787`（握手→建房→发言），或 `hostbot.js` / `netbot.js` 模拟客户端

**直接跑 wss**（不装 nginx，适合内网/联调）：

```powershell
# PEM：TLS_KEY / TLS_CERT；PFX：TLS_PFX / TLS_PASS
$env:TLS_KEY='privkey.pem'; $env:TLS_CERT='fullchain.pem'; $env:PORT='443'
node server/index.js
node tools/wss-smoke.js wss://127.0.0.1 --insecure   # 自签证书才需要 --insecure
```

- 健康检查：`GET /health` → `{"ok":true,"uptime":…,"secure":…,"rooms":…,"conns":…,"players":…}`
- 防护上限：`MAX_CONNS`/`MAX_ROOMS`/`RATE_MSGS`/`IDLE_CLOSE_MS`/`ROOM_IDLE_MS`，默认 400/200/60 条每 10 秒/90 秒/10 分钟
- **真机上线（备案域名 + 证书 + 微信后台 socket 域名 + 443）步骤见 [`deploy/README.md`](deploy/README.md)**

---

## 4. 常用命令

| 命令 | 作用 |
|---|---|
| `node tools/sync-engine.js` | **改完 `engine/` 必跑**：同步到 `minigame/js/engine/` |
| `node tools/build-mini-preview.js` | **改完 `minigame/js/` 必跑**：重建 `minigame/preview.html` |
| `node tools/shot-matrix.js .tools/vis-a` | **改完 `views/` 必跑**：采集 24 个 demo 模式的画布像素哈希 + 热区，冻结时间/随机数保证可复现 |
| `node tools/shot-matrix.js --compare .tools/vis-a .tools/vis-b` | 两套截图矩阵逐模式比对（`WIN=1334,750` 跑横屏，游戏真实朝向） |
| `node tools/wss-smoke.js ws://127.0.0.1:8787` | 联机冒烟：握手 → 建房 → 发言往返；`wss://` 与 `--insecure` 支持自签 |
| `node test/selftest.js` | 引擎自检（牌型、比较、计分） |
| `node test/selfplay.js` | 全 AI 自战若干局，检查规则不崩 |
| `node tools/smoke-quick.js` | 快速人机协议：一条 `quick` 完成建房 + 3 机器人 + 发牌（需先起服务端） |
| `node tools/smoke-solo-tribute.js` | 本地引擎进贡回归（仅无头测试用，产品已无单机入口） |
| `node tools/smoke-lone-tribute.js` | 独食局进贡冒烟 |
| `node tools/smoke-server-tribute.js` | 联机进贡冒烟（需先起服务端） |
| `node tools/pack-dist.js` | 打 `dist/十三张独食-小游戏工程.zip`（给非开发者交付用） |
| `node tools/voice-export.js` | 重新生成 `minigame/audio/voice/*.wav`（需豆包 TTS 接口，见第 7 节） |
| `node tools/cdp-shot.js` / `cdp-hit.js` | 用 Chrome DevTools Protocol 截图 / 命中测试（覆盖预览页的假命中问题） |

迭代过程中留下的一次性 `patch-*.js` / `cdp-*.js` 取证脚本已在 1.0.6 前的清理中删除（需要回溯可从 git 历史取）；`tools/` 里只保留上面这张表里在用的脚本。

---

## 5. 规则实现要点

| 项 | 口径 |
|---|---|
| 点序 | `3 > 2 > A > K > Q > J > 10 … > 5 > 4`（3 最大、4 最小） |
| 花色 | `♠ > ♥ > ♣ > ♦`；对子/三条比「其中最大的那张」 |
| 出牌方向 | 逆时针：你（南）→ 东 → 北 → 西 |
| 首出 | 持 ♦4 者；第一手必须含 ♦4 |
| 身份 | 打出一张 ♠3 或 ♠A 就在该家标一个徽标；两张都被同一人打出才亮「独食」 |
| 名次计分 | 2v2：一二名 ±2、一三名 ±1、一四名 0；独食：+6 / +3 / −3 / −6 |
| 进贡 | 第 2 局起按上局名次发档（1&2 → 4/2 张、1&3 → 2/1 张、1&4 → 不抽）；抽到 ♠3/♠A 亮出→归还→重抽；还贡等量自选不公示；双方恒 13 张；被抽最大牌的原主人先出 |
| 超时 | 每步 20 秒：桌上有牌自动过牌；起手不得不出时替出最小合法牌 |

---

## 6. 联机协议（WebSocket JSON）

**客户端 → 服务端**

| `t` | 字段 | 说明 |
|---|---|---|
| `create` | `name, rounds, cfg` | 建房，自己坐 0 号位 |
| `quick` | `name, rounds, cfg` | 一键人机局：服务端一次完成建房、补 3 个机器人、直接发牌，不经过等待厅 |
| `join` | `room, name` | 加入房号，坐第一个空位 |
| `ready` | `v` | 准备/取消准备 |
| `start` | – | 房主开局（空位补机器人） |
| `play` | `cards[]` | 出牌，`{s,r}`；服务端校验牌型/顺序/是否在手上 |
| `pass` | – | 过牌 |
| `next` | – | 结算后进入下一局（房主） |
| `draw` | `from` | 进贡阶段：选一个败方座位抽牌 |
| `return` | `cards[]` | 进贡阶段：还贡 |
| `rename` | `name` | 改昵称（≤6 字，广播「旧 改名为 新」） |
| `chat` | `kind(text\|emoji), text` | 发言（文本 ≤16 字 / 表情 ≤4 字，单座位 500ms 节流，房间留最近 30 条） |
| `ping` | – | 心跳，回 `pong` |
| `rejoin` | `room, key` | 断线重连：带 `joined` 下发的 `key` 找回原座位（对局中也能回） |
| `leave` | – | 主动离开：等待中清空座位（还有人在线则房主移交下一位真人）；对局中座位转机器人托管，房间保留 |
| `dissolve` | – | 房主解散房间（唯一会删房的指令），所有人收到 `{t:'roomClosed'}`；非房主被拒 |

**服务端 → 客户端**：`hello`（握手）、`joined`（房间号 + 座位 + `key`；重连回来时带 `rejoin: true`）、`state`（整桌快照）、`err`（提示文案）、`roomClosed`（房主解散；房主回主界面，其他玩家回大厅）。

**掉线宽限**：WebSocket 断开时座位保留 90 秒（`droppedAt`），期间轮到他由 20 秒超时逻辑代打；90 秒内没带 `key` 回来则由机器人接管。服务端每 5 秒扫一次过期座位。

`state` 关键字段：`room, phase, round, rounds, seats[], hand[], trickPlays[], turn, combo, deadline, host, canStart, lastEvent, chat[]`。
**所有座位索引都是「相对座位」**：`rel(seat) = (seat - 你的座位 + 4) % 4`，你的位置恒为 0，逆时针依次 1/2/3。

### 6.1 辅助与留存功能（1.0.2）

页头第二排三个 chip + 结算页按钮，除断线重连外全部**本地实现、不依赖服务端**：

| 功能 | 入口 | 口径 |
|---|---|---|
| 托管 | 页头「托管」chip | 轮到你 1.1 秒后自动出最小合法牌 / 压不过自动过牌；主动选牌或点「不出」即收回；联机走 `play/pass` 消息 |
| 记牌器 | 页头「记牌」chip | 手牌下方 13 格，显示各点数（14→2）在外面还剩几张（52 − 我的牌 − 桌上已出 − 进贡抽走） |
| 提示多候选 | 操作条「提示」 | 同一牌型只留最小一手，按牌力升序轮换，文案「提示 i/n：牌型（再点换一换）」 |
| 战绩 | 更多 →「我的战绩」 | 本地存档 `gx13_stats`：场次/胜率/当前连胜/最佳连胜/最佳单局 + 最近 5 局 + **本机排行榜**（单局分前 5） |
| 复盘 | 结算页「复盘」/ 更多 | 本局出牌序列（含过牌），最多 240 手；联机用服务端 `trickPlays` 重建（不含过牌） |
| 新手引导 | 页头「引导」chip / 对局菜单 / 更多 | 3 页：认牌与大小 / 牌型与出牌 / 朋友与独食；**只在点开时出现，不自动弹** |
| 对局菜单 | **左上角「菜单」chip** | 一屏收纳：返回主界面、托管开关、记牌器、引导、战绩、复盘、分享、音乐、震动、皮肤；房主在联机局内多一项「解散房间」；底部「继续游戏」 |
| 主界面按钮 | **左上角「主界面」chip**（菜单左侧，单独一枚） | 点了先弹「退出本局？」确认框：退出 / 取消。退出联机＝座位转机器人托管、断开本局连接并**回主界面**（不再停在联机大厅）；没有任何本地单机分支 |
| 解散房间 | 对局菜单（联机+房主）/ 等待厅（房主） | 二次确认后才真散桌：服务端 `{t:'dissolve'}` 删房间并给所有人推 `{t:'roomClosed'}`；房主回主界面，其他玩家回大厅；非房主会被拒 |
| 分享战绩 | 结算页「分享战绩」/ 更多 | 微信 `wx.shareAppMessage` 带本场分与连胜；浏览器退化到复制文案 |
| 震动 | 更多 →「震动反馈」 | 出牌 `vibrateShort`，结算轻震；开关存 `gx13_vib` |
| 背景音乐 | 更多 →「背景音乐」 | `audio.js` 程序合成 D 宫五声循环（无音频文件），首次点击后启动；开关存 `gx13_music` |
| 牌背皮肤 | 更多 →「牌背皮肤」 | 经典红 / 青竹 / 鎏金三套（`drawBack` 取 `SKINS`），存 `gx13_skin` |
| 连胜光效 | 结算页 | 连胜 ≥3 且本局得分为正时，面板外描一圈呼吸金光 |
| 快捷语音 | 发言面板 | 16 表情 + 8 短语 + 「✎ 打字发言」（≤16 字，微信 `wx.showKeyboard` / 浏览器 prompt）；自己发的话**本地即时回显**，不用等服务端回包；别人发言时一声轻「叮」（`SFX.play('chat')`）；联机面板从右侧滑入、只占右栏，不压手牌/操作条，打开后可继续选牌出牌 |
| 断线重连 | 自动 | 掉线后 1.5 秒一次、最多 8 次，成功后带 `key` 发 `rejoin`；期间操作条上方显示「正在重连 n/8」 |

---

## 7. 语音播报

- 资源：`minigame/audio/voice/*.wav`，25 个**原子词**（8 个牌型 `k_*` + 4 个花色 `s_0..s_3`=♦♣♥♠ + 13 个点数 `r_2..r_14`），16k 单声道 16bit，单条 0.6~0.9s
- 播报内容：单张 → 「花色+点数」（梅花2）；对子/三个 → 牌型+点数（对子K / 三个3）；其余牌型 → 只报牌型
- 播放：`audio.js` 里严格排队——**一手念完再念下一手**，绝不打断正在念的；句间 90ms 换气；单句 1600ms 看门狗防回调丢失；队列上限 4 手（满了丢最早，保持接近实时）
- 重新生成：`tools/voice-export.js` → 豆包 TTS 逐词合成；`voice-seg.js`/`voice-speed.js`/`voice-stretch.js` 是切段与变速工具
- **已知做不通的路子**（别再试）：一次合成多词靠静音切分（25 词会连读成 1 段）；用参考音做「克隆 + 提速」。稳定方案就是一调一词，再按需变速

---

## 8. 开发约定与踩坑

1. **改 `engine/` → 跑 `node tools/sync-engine.js`**；改 `minigame/js/` → 跑 `node tools/build-mini-preview.js`。两条都忘了就会出现「预览是对的、真机是旧的」。
2. `minigame/preview.html` 是**构建产物**，不要手改，改了下次构建会被覆盖。
3. **绘制分层**：`views.js` 只做编排（`draw()` 按 phase 叠层并产出 `hits`）；原语与特效在 `views/base.js`，牌桌在 `views/table.js`，弹层在 `views/panels.js`。层间依赖是单向的（base ← table ← panels ← draw），新增绘制函数要放进合适那层，别往下层反向调。
4. **跨函数可变状态只有 `state` 一个**：`state.W`（横屏宽）、`state.lastH`（画布高，供 banner 定位）、`state.SKIN`（牌背皮肤）。新增共享状态加进 `base.js` 的 `state`，不要再定义模块级可变变量——拆模块后会变成各自副本。
5. 布局集中在 `views/base.js` 的 `layout()`（设计宽 750，横竖屏两套座位/手牌/操作条坐标），点击热区由 `draw()` 返回的 `hits` 驱动；新增按钮必须 `hits.push({x,y,w,h,act})` 并在 `app.js` 的 `handleAct` 里接分支。
6. **改完 `views/` 必须做像素回归**：`node tools/shot-matrix.js .tools/vis-a` 采基线 → 改 → 再采 → `--compare`。它冻结 `Date.now`/`Math.random`，比的是画布像素哈希 + 完整 `hits` 数组；横屏要加 `$env:WIN='1334,750'`（游戏是横屏）。
7. 语音/音效：`audio.js` 合成音不依赖文件；语音必须走队列，**不要**在播放中间 `stop()`，否则会截断上一手。
8. 头像/昵称：昵称存在本地 `gx13_myname`，进房时随 `create/join` 上报，房内改名走 `rename`。
9. 联机地址：构建期看 `minigame/js/config.js` 的 `SERVER_URL`，运行期看存储 `gx13_server`（游戏内大厅可改），**存储优先**。
10. 截图、日志、试听 wav、二维码等产出**不要提交**（见 `.gitignore`），放本地 `tools/` 或临时目录即可。
11. 微信侧打开文档/链接一律走飞书/Lark 工具，不要用浏览器打开 `larkoffice` 链接（工具约定）。

---

## 9. 发布

```powershell
# 开发者工具 CLI（Windows 默认安装位置）
D:\Tencent\微信web开发者工具\cli.bat islogin          # 确认已登录（返回 {"login":true}）
D:\Tencent\微信web开发者工具\cli.bat preview --project E:\AAproject\guangxi_13\minigame
D:\Tencent\微信web开发者工具\cli.bat upload --project E:\AAproject\guangxi_13\minigame -v 1.0.1 -d "更新说明"

# 打包给非开发者
node tools/pack-dist.js
```

- 开发者工具只能「预览 / 真机调试 / 上传」，**发布与设为体验版**要在 [mp.weixin.qq.com](https://mp.weixin.qq.com) → 管理 → 版本管理里操作
- 正式提审前需先在「设置 → 基本设置」补齐小程序基本信息与游戏类目
- 当前已上传版本见 `CHANGELOG.md`；体验版二维码有效期以后台为准
- 注意：登录后先核对右上角 AppID 是不是 `wx31c52de4c0526c31`，别传到公众号或测试号上

---

## 10. 已知限制 / 待办

- 联机只在**自建 WebSocket** 上可用；微信云开发链路（`net.js` 的 `hasCloud` 分支）没有实现房间逻辑，**默认关闭**（要真用得先 `wx.setStorageSync('gx13_cloud','1')` 并把云函数补齐），别误开
- **代码侧 wss 已就绪**（服务端可选 TLS、客户端 25s 心跳、游戏内可改地址、部署手册齐备），但还没有备案域名与证书：默认地址仍是 `ws://127.0.0.1:8787`，大厅会用红字提示真机不可用。上线只差 [`deploy/README.md`](deploy/README.md) 里那几步
- 真机必须 `wss://` 且域名已在小游戏后台配置（socket 合法域名，不能带端口）
- AI 三档难度只影响候选筛选激进程度，不是搜索型 AI
- 断线重连只覆盖自建 WebSocket；云开发分支没实现房间逻辑，也就没有 rejoin
- 战绩 / 排行 / 复盘都只存在本机（`gx13_stats`、`gx13_skin` 等），换设备不迁移；暂不上云、无全服榜
- 待做：观战、分享图卡（现在是分享文案 + 标题，没有生成战绩海报）
- 待做：`app.js`（80KB）仍是单文件状态机，本轮只拆了 `views.js`；下一轮可按 `state / actions / online` 再拆
