# 联机 wss 就绪 + views.js 拆分 · 设计

日期：2026-11-25
状态：按用户「按推荐的来」执行；用户离开键盘，未选定的项由我按下述「我的决定」落地。

## 1. 意图

让 1.0.5 这个可玩版本具备**上线真机联机**的工程条件，并把已经长到 97KB 的绘图模块拆开，避免后续加功能时继续在同一个文件里叠。

两件事互不依赖，先做联机（用户价值最高），再做重构（风险最高，需要回归手段）。

## 2. 目标

- 服务端能**不依赖 nginx** 直接以 `wss://` 提供服务（也支持被 nginx 反代），零第三方依赖不变。
- 客户端在**真机上不需要改代码**就能指向 `wss://` 地址（游戏内入口 + 构建期默认值）。
- 公网长连接**不会被 NAT 静默掐断**（心跳 + 无应答判定 + 自动重连已有）。
- 服务端具备最低限度的**公网防护**：连接/房间上限、单连接消息限流、死连接清理、空房回收、优雅退出。
- `views.js` 拆为 4 个文件，**画面像素与点击热区完全不变**（用截图 + 热区快照双重验证）。

## 3. 非目标

- 不实现微信云开发房间逻辑（保留现状：桩 + 默认关闭）。
- 不做全服榜、战绩上云、观战、战绩海报。
- 不改任何玩法规则、计分、AI、进贡逻辑。
- 不引入第三方依赖（不加 ws、express、dotenv）。

## 4. 反面目标（做了就算失败）

- 拆完 views 后任何一个 demo 模式的截图出现像素差异，或 hits 数组长度/坐标/顺序变化。
- 服务端为了 TLS 引入新依赖，或默认行为变成必须配证书才能起。
- 心跳导致正常对局被误判掉线（例如把 20 秒回合超时当成断线）。

## 5. 约束

- `engine/` 是唯一规则源码，本次不碰；若碰必须 `node tools/sync-engine.js`。
- `minigame/preview.html` 是构建产物，只能由 `tools/build-mini-preview.js` 生成；新增模块要登记进它的 `FILES` 列表。
- 小游戏侧走 `require()`，浏览器预览走同一套 `define/require` 垫片，两边路径解析都必须成立。
- 所有改动保持零依赖，Node ≥ 18。
- 提交前必须通过：`node test/selftest.js`、`node test/selfplay.js`、三个 tribute 冒烟（联机冒烟需起服务端）。

## 6. 方案对比（联机）

**A. 服务端原生 TLS（选定）**
`ws.js` 的 `createServer` 增加第三个参数：有证书就用 `https.createServer`，否则维持 `http.createServer`。证书来源支持 PEM（`TLS_KEY`/`TLS_CERT`）与 PFX（`TLS_PFX`/`TLS_PASS`）两种。
- 优点：单进程单端口，certbot 续期后重启即可；本地能用自签 PFX 做端到端验证；保持零依赖。
- 代价：Node 自己管证书，没有 nginx 的 HSTS/限流/日志生态。

**B. 只做 nginx 反代**
服务端仍是 `ws://127.0.0.1:8787`，TLS 交给 nginx。
- 优点：运维标准做法，防护能力强。
- 代价：用户必须多装一个组件；本地无法验证 wss 链路（只能验 nginx 配置语法）。

**结论：A 为默认能力，B 作为部署文档里的推荐生产形态同时给出 nginx 样例。** 两者不冲突：原生 TLS 可以先跑通，再上 nginx。

**客户端地址来源（选定）**：新建 `minigame/js/config.js`，导出 `{ SERVER_URL: '' }`。优先级 `本地存储 gx13_server > config.js > 按当前 host 推导 > ws://127.0.0.1:8787`。游戏内大厅把原来只读的「服务器 …」一行改成可点击，走已有的 `P.askText`，写回存储。

**心跳（选定）**：客户端每 25s 发 `{t:'ping'}`，服务端已有 `pong` 分支；超过 60s 没收到任何消息就主动 `close`，交给现有 1.5s×8 次重连。服务端每 5s 扫一次，90s 无任何数据的连接直接关闭（与现有 90s 掉线宽限同量级，不会误杀正在对局的客户端）。

## 7. 方案对比（views.js 拆分）

**A. 逐函数搬进模块，调用点不变（选定）**
每个模块导出工厂函数，父层把依赖以**同名局部变量**注入：
```js
module.exports = function (B) {
  var W = B.W, C = B.C, txt = B.txt, drawCard = B.drawCard, /* … */;
  function hand(ctx, S, L, hits) { /* 原样搬过来，函数体一字不改 */ }
  return { hand: hand, /* … */ };
};
```
- 优点：函数体保持逐字不变，调用点不需要重写，语义风险最小。
- 代价：每个模块开头要列一遍依赖（机械但显式）。

**B. 改成 `V.drawCard(...)` 命名空间调用**
- 优点：无需依赖注入。
- 代价：需要全量重写调用点，字符串/局部变量遮蔽都可能误伤，回归风险最高。

**C. 构建期拼接（源码分块、运行时仍是单文件）**
- 优点：零风险。
- 代价：小游戏端没有构建步骤，`require('./views.js')` 拿到的仍是单文件，等于只改了开发体验，不解决真实问题。

**结论：A。** 分四层，依赖单向：

| 文件 | 职责 | 依赖 |
|---|---|---|
| `views/base.js` | 常量、`layout`、绘制原语（rr/box/txt/bg/drawCard/drawBack/pill/btn/clockChip/overlay）、特效（banner/identity/lone/kind/fxOverlay/confetti） | 无 |
| `views/table.js` | 牌桌主体：header、seats、seatPlate、drawnFan、center、dealTable、dealState、hand、actions、chatEntry | base |
| `views/panels.js` | 弹层：tribute、settle、menu、summary、lobby、room、chat、tools、stats、replay、guide、pause、ask、toast、testPanel | base（必要时 table） |
| `views.js` | `draw()` 编排 + 导出 `{draw, layout, C, SEAT_NAMES}` | 以上三者 |

`lastH` 是唯一的可变共享状态（`draw()` 写、`banner()` 读）：base 暴露 `setLastH/getLastH`，`draw()` 改调 `setLastH`，`banner()` 改读 `getLastH()`——这是拆分中仅有的两处语义改动点，其余全是搬运。

## 8. 我的决定（用户未回，按最保守默认）

1. 联机：**先做代码侧 wss-ready + 本地自签端到端验证**，真实域名留一行 TODO，不猜用户的域名和服务器。
2. 重构：**只拆 `views.js`**，`app.js` 本轮不动（80KB 的状态机拆分回归面太大，等下一轮）。
3. `tools/` 清理：**用 `git rm` 删除**，历史可找回；只保留 README 里点名在用的脚本。
4. 提交粒度：按任务分开提交，最后一条汇总文档。

## 9. 留给实施者的空间

- 证书环境变量名、上限的具体默认值（连接 400 / 房间 200 / 单连接 60 条每 10 秒）可按实现调整，但必须可通过环境变量覆盖。
- 截图回归的具体 demo 组合由实施者选定，但必须覆盖：竖屏手牌、进贡四阶段、身份/独食特效、结算、菜单/工具抽屉、大厅/配置/键盘、联机聊天。
- 部署文档的具体云厂商不限定，只给通用 Linux + systemd + nginx 步骤。
