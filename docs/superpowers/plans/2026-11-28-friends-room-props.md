# 四人好友房：邀请、分享、房内道具 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让房主用分享卡片/房号把 4 个熟人拉进同一房，并在牌桌里提供砸蛋、西红柿、送花三个无冷却互动道具。

**Architecture:** 沿用现有微信云开发 `gx13` 云函数作为权威端；道具作为 `chat` 的一种房间事件广播，不引入库存或新集合；邀请走 `wx.shareAppMessage` 的 `room` query + 启动/onShow 自动 join；房主踢人新增 `kick` 动作。

**Tech Stack:** 微信小游戏 Canvas、wx.cloud.callFunction、Node 本地 fake DB 回归、现有 `views/panels.js`。

**Spec:** `docs/superpowers/specs/2026-11-28-friends-room-props-design.md`

## Global Constraints

- 只做熟人房；不做公开匹配、组队、任务、排位、赛事、观战、房间密码。
- 道具不设冷却；房间 `chats` 仅保留最近 30 条。
- 不做道具库存/数量/商城；不做真实小程序码。
- 牌局状态只信云函数；客户端只能发 `chat/kind=prop` 与 `kick`，不能本地改权威状态。
- 所有新增协议必须同时更新 `tools/cloud-feature-test.js` 与 `.tools/net-cloud-test.js`。
- 改完 `minigame/js/` 必须 `node tools/build-mini-preview.js`；改完云函数必须部署到 `cloud1-d7g8xcknn7afb1637`。

## Review Focus

- 分享卡片启动参数 `room` 不是 4 位数字 / 当前已在别的房间：不能误 join，回大厅并提示。
- 道具目标越界、目标是自己、prop 非法：云函数必须拒绝，不能写脏 `chats`。
- 无冷却连续点道具：不能报错或阻塞出牌；只受 30 条历史上限。
- 房主踢人：非房主、对局中、踢自己必须拒绝；被踢者下一次 state 必须收到 `notInRoom` 并回大厅。
- 分享图卡生成失败：必须退回 `wx.shareAppMessage` 默认图，不能阻断分享。

---

### Task 1: 云函数协议（prop + kick）

**Files:**
- Modify: `minigame/cloudfunctions/gx13/index.js`
- Test: `tools/cloud-feature-test.js`

**Interfaces:**
- Produces: `chat` 接受 `{t:'chat', kind:'prop', prop:'egg'|'tomato'|'flower', target:1..3}`；`viewFor.chat` 条目带 `{prop,target}`（target 为相对座位）。
- Produces: `kick` 接受 `{t:'kick', seat:1..3}`，仅房主、仅 `phase==='wait'`；成功返回 `state`，被踢者后续 `state` 返回 `{t:'err',code:'notInRoom'}`。

- [ ] **Step 1: 写失败测试**
  - quick 建房后，A 发 `prop:'egg', target:1`，断言 `chat[0].kind==='prop'`、`prop==='egg'`、`target===1`。
  - 发 `prop:'bomb'` 或 `target:0`，断言返回 `err` 且 `chats` 不增加。
  - 创建好友房，A 房主、B 加入；A 发 `kick seat:1`，断言房间 seats[1] 为空；B 再 `state` 得到 `notInRoom`。
  - 非房主 B 发 `kick`，断言拒绝；对局中 `kick` 也拒绝。
- [ ] **Step 2: 跑测试确认失败**
  - `node tools/cloud-feature-test.js` 当前应因未知 prop/kick 失败。
- [ ] **Step 3: 实现**
  - `cleanChat(kind, text, prop, target)` 或新增 `cleanProp`；只允许白名单。
  - `chat` 分支对 `kind==='prop'` 处理，写入 `{seat, kind:'prop', prop, target, ts}`。
  - `viewFor` 映射 `prop` 和 `target`：`target` 用 `rel()` 转相对。
  - 新增 `kick` 分支：`phase==='wait'`、`hostSeat` 校验、相对转绝对、清空座位、`lastEvent`、`saveRoom`。
- [ ] **Step 4: 跑测试确认通过**
  - `node tools/cloud-feature-test.js` 期望新增用例 PASS。
- [ ] **Step 5: 提交**
  - `git add minigame/cloudfunctions/gx13/index.js tools/cloud-feature-test.js`
  - `git commit -m "feat: 房间道具与房主踢人协议"`

### Task 2: 客户端协议（net.js）

**Files:**
- Modify: `minigame/js/net.js`
- Test: `.tools/net-cloud-test.js`

**Interfaces:**
- Consumes: Task 1 协议。
- Produces: `NET.send({t:'chat',kind:'prop',prop,target})` 映射为云函数 `action:'chat', kind:'prop', prop, target`；`NET.send({t:'kick',seat})` 映射为 `action:'kick', seat`。
- Produces: `viewFor.chat` 的 `prop/target` 原样进 `dispatchState`。

- [ ] **Step 1: 写失败测试**
  - fake wx 拦截 `callFunction`，发送 prop 与 kick，断言 data 字段。
  - 模拟服务端返回 prop chat，断言 `NET.on('state')` 收到 `chat[0].prop/target`。
- [ ] **Step 2: 跑测试确认失败**
  - `node .tools/net-cloud-test.js` 当前应缺 prop/kick 分支。
- [ ] **Step 3: 实现**
  - `cloudSend` 增加 `prop` 和 `target` 转发。
  - `kick` 不需要单独分支，走通用 `cloudCall('kick', {seat: obj.seat})`。
- [ ] **Step 4: 跑测试**
  - `node .tools/net-cloud-test.js` 输出 `NET-CLOUD-PASS`。
- [ ] **Step 5: 提交**
  - `git add minigame/js/net.js .tools/net-cloud-test.js`
  - `git commit -m "feat: 客户端转发道具与踢人"`

### Task 3: 等待房邀请/复制/踢人 UI

**Files:**
- Modify: `minigame/js/views/panels.js`
- Modify: `minigame/js/app.js`
- Test: 浏览器预览 + 截图矩阵

**Interfaces:**
- Produces: hits `netCopyRoom`、`netShareRoom`、`netKick`（seat 为相对 1..3）。
- Produces: `shareRoom()` 使用 `wx.shareAppMessage({title, query:'room='+S.room, imageUrl})`；浏览器退化为复制文案。
- Produces: `netKick(rel)` 发送 `{t:'kick',seat:rel}`。

- [ ] **Step 1: 写 UI 改造**
  - 房间号下方两枚胶囊：`复制房号`、`邀请好友`；房主座位行右侧 `移除`。
  - 点击复制：`wx.setClipboardData`，浏览器 `navigator.clipboard`；toast。
  - 点击邀请：分享；浏览器复制“房号 1234，打开小游戏加入”。
  - 点击移除：二次确认；发 kick。
- [ ] **Step 2: 运行预览**
  - `node tools/build-mini-preview.js`
  - `node tools/shot-matrix.js .tools/vis-room-a`，确认等待房无重叠。
- [ ] **Step 3: 提交**
  - `git add minigame/js/views/panels.js minigame/js/app.js minigame/preview.html`
  - `git commit -m "feat: 等待房复制/邀请/踢人"`

### Task 4: 发言面板道具页 + 飞行动画

**Files:**
- Modify: `minigame/js/views/panels.js`
- Modify: `minigame/js/views/table.js`
- Modify: `minigame/js/app.js`
- Test: 浏览器预览 `?demo=online&chat=1` + 真实 state

**Interfaces:**
- Produces: `chatTab==='prop'`；`S.chatTarget` 1..3；`S.propFx` `{from,target,kind,t0}`。
- Produces: `sendProp(prop,target)` 本地回显 `{rel:0,kind:'prop',prop,target,pending:true}`，`NET.send` 同字段。
- Produces: `drawPropFx(ctx,S,L)` 从 `SEAT_POS[from]` 到 `SEAT_POS[target]` 插值 700ms。

- [ ] **Step 1: 写 UI**
  - 三个页签：表情/短语/道具；道具页第一行目标 chip 西/北/东，第二行 3 个道具按钮。
  - 点击后 `sendProp`，本地回显并触发 `S.propFx`。
- [ ] **Step 2: 写动画**
  - `table.js` 里按 `L.seats` 算起终点，画 `🥚/🍅/💐`，带 8px 尾迹和 1.0→0.8 缩放。
  - 目标座位短抖动；目标是自己时 `vibrateShort`。
- [ ] **Step 3: 聊天显示**
  - `chatName + ' 砸了 ' + targetName + ' 一个蛋'` / `送了一束花`；最多保留 3 条气泡。
- [ ] **Step 4: 验证**
  - `node tools/build-mini-preview.js`
  - `WIN=1334,750 node tools/shot-matrix.js .tools/vis-chat-a`，确认面板不压手牌。
- [ ] **Step 5: 提交**
  - `git add minigame/js/views/panels.js minigame/js/views/table.js minigame/js/app.js minigame/preview.html`
  - `git commit -m "feat: 房内砸蛋/西红柿/送花"`

### Task 5: 分享图卡与 room query 自动进房

**Files:**
- Modify: `minigame/js/app.js`
- Modify: `minigame/js/platform.js`（如需要离屏 canvas）
- Test: 浏览器 `?room=1234` + 微信 `onShow` 模拟

**Interfaces:**
- Produces: `readRoomQuery()` 解析 `wx.getLaunchOptionsSync().query.room` / `wx.onShow` query / 浏览器 `?room=`。
- Produces: `makeShareCard(kind)` 返回临时图片路径或 `''`；失败不阻断分享。
- Produces: `shareRoom()` 带 `query:'room='+S.room`；`shareResult()` 带战绩 query。

- [ ] **Step 1: 启动参数**
  - `boot` 末尾和 `wx.onShow` 里读取 room；4 位数字且 `S.room !== code` 时 `openLobby(); netJoin(code)`。
  - 当前已在同房则忽略，避免重复 join。
- [ ] **Step 2: 分享图卡**
  - 用 `wx.createOffscreenCanvas({type:'2d',width:600,height:800})` 画房号/战绩；`toTempFilePath` 成功则传 `imageUrl`，失败传空。
  - 浏览器预览跳过图卡，复制文案。
- [ ] **Step 3: 验证**
  - `node tools/build-mini-preview.js`
  - 浏览器打开 `?room=1234` 应进入大厅并显示加入中。
- [ ] **Step 4: 提交**
  - `git add minigame/js/app.js minigame/js/platform.js minigame/preview.html`
  - `git commit -m "feat: 分享房卡与 room 自动进房"`

### Task 6: 构建、部署、双远端

- [ ] `node --check` 所有改动 JS
- [ ] `node tools/cloud-feature-test.js`、`node tools/cloud-selftest.js`、`.tools/net-cloud-test.js`
- [ ] `node tools/build-mini-preview.js`
- [ ] `cli cloud functions deploy --env cloud1-d7g8xcknn7afb1637 --names gx13 --remote-npm-install`
- [ ] `git status` 清洁；推送 origin/gitee
- [ ] 更新 `README.md` 与 `CHANGELOG.md` 的房内道具/邀请说明
