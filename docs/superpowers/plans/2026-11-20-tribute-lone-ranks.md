# 独食局进贡规则（按独食者名次） Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 独食局进贡改为按上局独食者名次定方向与数量：独食第 1/2 名抽其他每人 4/2 张（重贡），独食第 3/4 名被其他每人抽 2/4 张（重贡），轻贡全部减半；同一人被抽满配额即封。

**Architecture:** 引擎 `rules.js` 新增独食配额表、`tribute.js` 的 `plan()` 产出 `pairQuota`（每配对配额）供四个执行端（引擎 run、单机 app.js、联机 server、云函数）统一遵守；2v2 逻辑零改动。

**Tech Stack:** 纯 JS（UMD 模块），Node 自带断言式测试（test/selftest.js），无第三方依赖。

**Spec:** 对话确认的独食进贡表（见下）；2v2 口径见 `docs/规则书-十三张独食.md` §F。

**独食进贡表（Spec 本体）：**

| 独食者名次 | 方向 | 重贡 | 轻贡 |
|---|---|---|---|
| 1 | 独食抽其他三人，每人 | 4 | 2 |
| 2 | 独食抽其他三人，每人 | 2 | 1 |
| 3 | 其他三人每人抽独食 | 2 | 1 |
| 4 | 其他三人每人抽独食 | 4 | 2 |

配套沿用现有口径：♠3/♠A 亮出→归还→重抽、不占配额；还贡等量还给对应被抽者；被抽最大牌的原主人先出；双方恒 13 张。

## Global Constraints

- 引擎三处副本必须同步：`engine/`、`minigame/js/engine/`、`minigame/cloudfunctions/gx13/engine/`（字节级一致）。
- 2v2 进贡行为零变化：`test/selftest.js` 现有断言（`tributeCount` 的 [1,2]/[1,3]/[1,4]）必须保持通过。
- 项目无 git 仓库；Task 0 建仓用于回滚保护，之后每个 Task 一提交。
- 身份牌判定统一用 `Tribute.isIdentity(card)`（`s===3 && (r===3||r===14)`）。
- 配额计数只计"成功抽走"的牌，身份牌亮出归还重抽不计数。

## Review Focus

1. **独食第 3/4 名方向反转**：`plan()` 返回 `winners=[三家]、losers=[独食]`，各端广播/视图映射不能假设独食恒为抽牌方 → Task 2 测试钉住。
2. **单人上限只限 lone 多败方方向**：2v2 允许两胜方抽同一人（规则书 §F 明确允许），不得误加 cap → Task 2 测试钉住。
3. **超时/AI 代抽也必须遵守单人上限**，否则人类配额可被 AI 绕过 → Task 3/4 各自验证步骤覆盖。
4. **身份牌重抽死循环**：理论上 13 张非身份牌充足，但 guard 循环必须保留上限（现有 40/60 次模式）→ 各实现点沿用。
5. **云函数 openTributePull 旧式 `T.total = T.count × targets`**：新 `plan.count` 语义变为 3×配额，若不改用配额计算会变成 9 倍 → Task 4 测试钉住。

---

### Task 0: git 基线（一次性）

**Files:**
- Create: `.git/`（`git init`）

- [ ] **Step 1: 建库并提交基线**

```powershell
cd E:\AAproject\guangxi_13
git init
git add -A
git commit -m "baseline: before lone tribute rule + ui redesign"
```

- [ ] **Step 2: 验证**

Run: `git log --oneline`
Expected: 一条 baseline 提交。

---

### Task 1: 引擎 —— 独食配额表与 plan()/run()

**Files:**
- Modify: `engine/rules.js`（`tributeCount`、exports）
- Modify: `engine/tribute.js`（`plan`、`run`）
- Test: `test/selftest.js`

**Interfaces:**
- Produces（后续所有任务依赖）：
  - `Rules.tributeLoneQuota(loneRank /*1..4*/, tier /*'heavy'|'light'*/) -> { quota: number, drawer: 'lone'|'others' }`
    - rank1: `{4|2, 'lone'}`；rank2: `{2|1, 'lone'}`；rank3: `{2|1, 'others'}`；rank4: `{4|2, 'others'}`（前为重贡值，后为轻贡值）
  - `Tribute.plan(lastResult, cfg)` 新增返回字段：
    - `pairQuota: number|null` —— 独食局为配额 q，2v2 为 `null`（不cap）
    - 独食局：`drawer==='lone'` → `winners=[lone]、losers=[三家]`；`drawer==='others'` → `winners=[三家]（按座位号升序）、losers=[lone]`；`count = quota*3`
    - 2v2：`winners/losers/count` 语义与现状完全一致
  - `Tribute.run(hands, plan, seed)`：独食抽牌方方向时按每个败方恰好 quota 张执行

- [ ] **Step 1: 写失败测试（追加到 test/selftest.js，放在现有 tributeCount 断言之后）**

```js
// —— 独食进贡（按独食者名次）——
ok('独食第1 重贡 抽每人4', R.tributeLoneQuota(1, 'heavy').quota === 4 && R.tributeLoneQuota(1, 'heavy').drawer === 'lone');
ok('独食第2 重贡 抽每人2', R.tributeLoneQuota(2, 'heavy').quota === 2 && R.tributeLoneQuota(2, 'heavy').drawer === 'lone');
ok('独食第3 重贡 被抽2', R.tributeLoneQuota(3, 'heavy').quota === 2 && R.tributeLoneQuota(3, 'heavy').drawer === 'others');
ok('独食第4 重贡 被抽4', R.tributeLoneQuota(4, 'heavy').quota === 4 && R.tributeLoneQuota(4, 'heavy').drawer === 'others');
ok('独食轻贡减半', R.tributeLoneQuota(1, 'light').quota === 2 && R.tributeLoneQuota(4, 'light').quota === 2);

// loneCamp 已存在（lone=2）；构造 lastResult：ranks 为名次→座位数组
var lr1 = { ranks: [2, 0, 1, 3], camp: loneCamp };   // 独食第1
var pl1 = T.plan(lr1, R.DEFAULT);
ok('独食第1 plan', pl1.pairQuota === 4 && pl1.count === 12 && pl1.winners.join() === '2' && pl1.losers.length === 3);
var lr4 = { ranks: [0, 1, 3, 2], camp: loneCamp };   // 独食第4
var pl4 = T.plan(lr4, R.DEFAULT);
ok('独食第4 plan', pl4.pairQuota === 4 && pl4.count === 12 && pl4.winners.length === 3 && pl4.losers.join() === '2');

// run()：独食第1 → 每个败方恰好被抽 4 张，交换后各家仍 13 张
var hands2 = handsFor(2, 2);
var out2 = T.run(hands2, pl1, 7);
var perLoser = {};
out2.draws.forEach(function (d) { perLoser[d.from] = (perLoser[d.from] || 0) + 1; });
ok('独食run 共12抽', out2.draws.length === 12);
ok('独食run 每人恰好4', [0, 1, 3].every(function (s) { return perLoser[s] === 4; }));
ok('独食run 交换后仍13', hands2.every(function (h) { return h.length === 13; }));
```

注：`handsFor`、`loneCamp`、`R`、`T`、`ok` 均为 selftest.js 现有名字；若现有变量名不同以文件实际为准。

- [ ] **Step 2: 跑测试确认失败**

Run: `node test/selftest.js`
Expected: FAIL（`tributeLoneQuota is not a function`）

- [ ] **Step 3: 实现 rules.js**

- 新增 `tributeLoneQuota(loneRank, tier)`，按上表返回值；加入 return 的 exports。
- `tributeCount`：删除 `set === '1'` 分支及其注释（独食改由 plan() 走新函数），保留 [1,2]/[1,3]/[1,4] 分支原样。

- [ ] **Step 4: 实现 tribute.js**

- `plan()`：先判 `camp.mode === 'lone'`：
  - `loneRank = ranks.indexOf(camp.lone) + 1`；`var lq = Rules.tributeLoneQuota(loneRank, cfg.tributeTier)`；
  - `others = [0,1,2,3].filter(p => p !== camp.lone)`；
  - `drawer==='lone'` → `winners=[camp.lone], losers=others`；否则 `winners=others, losers=[camp.lone]`；
  - 返回 `{ count: lq.quota * 3, pairQuota: lq.quota, winners, losers, winnerRanks: [loneRank], tier, cfg, skip: false, loneRank: loneRank, drawer: lq.drawer }`。
  - 2v2 分支保持现状，补 `pairQuota: null`。
- `run()`：在 `p.pairQuota && p.winners.length === 1` 时改为：遍历 `p.losers`，对每个败方抽满 `p.pairQuota` 张（身份牌 → `reveals.push` 且不计数重抽，沿用现有 guard 模式）；其余路径（含 winners=3 单败方）走现有逻辑即可（shares 均分天然等于 quota）。
- 还贡与先出权逻辑不变。

- [ ] **Step 5: 跑测试确认通过**

Run: `node test/selftest.js`
Expected: 全部 PASS（含 2v2 旧断言）

- [ ] **Step 6: 同步三处引擎副本并全量回归**

```powershell
Copy-Item engine\rules.js, engine\tribute.js minigame\js\engine\ -Force
Copy-Item engine\rules.js, engine\tribute.js minigame\cloudfunctions\gx13\engine\ -Force
```

Run: `node test/selftest.js && node test/selfplay.js 200 8`
Expected: selftest 全 PASS；selfplay 200 局无报错完成。

- [ ] **Step 7: Commit**

```bash
git add engine minigame/js/engine minigame/cloudfunctions/gx13/engine test/selftest.js
git commit -m "feat(engine): lone tribute quota by lone rank, per-loser cap"
```

---

### Task 2: 单机 app.js —— 抽牌单人上限

**Files:**
- Modify: `minigame/js/app.js`（`finishDeal`、`drawFromSeat`、`pullOne`、`doTributeDraw`）

**Interfaces:**
- Consumes: Task 1 的 `plan.pairQuota` / `plan.drawer`。
- Produces:
  - `T.pairQuota: number|null`、`T.drawnFrom: { [seat]: number }`（本次进贡累计每个败方已被抽走张数，身份牌不计）
  - `T.pull.rows[i]` 增加 `cap`（=pairQuota）与 `got`（=drawnFrom[rel]）字段，供 Task 5 显示。

- [ ] **Step 1: 写失败测试**

单机流程无现成 harness，用 Node 直接断言纯逻辑：在 `test/selftest.js` 追加——

```js
// 单机配额辅助：freeLosers 语义（与 app.js 共用纯函数）
ok('配额未满可抽', GX.Tribute.freeLosers({ losers: [0, 1, 3], pairQuota: 4 }, { 0: 4, 1: 1 }).join() === '1,3');
ok('全部抽满返回空', GX.Tribute.freeLosers({ losers: [0], pairQuota: 2 }, { 0: 2 }).length === 0);
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node test/selftest.js`
Expected: FAIL（`freeLosers is not a function`）

- [ ] **Step 3: 实现**

- `engine/tribute.js`（及同步副本）新增纯函数：
  `freeLosers(planLike /*{losers,pairQuota}*/, drawnFrom)` → `pairQuota==null` 返回 `losers` 原样；否则返回 `losers.filter(s => (drawnFrom[s]||0) < pairQuota)`。
- `app.js finishDeal`：`T.pairQuota = plan.pairQuota || null; T.drawnFrom = {};`
- `app.js drawFromSeat`：多行摊开条件由 `winners.length===1` 改为 `T.pairQuota && T.plan.winners.length===1`；rows 每项带 `cap: T.pairQuota, got: T.drawnFrom[r]||0`；`total = T.pairQuota * rows.length`；点已抽满（`got>=cap`）的座位 → `toast('这家已抽满，换一家')` 且不进入 pull。
- `app.js pullOne`：抽前检查 `(T.drawnFrom[p]||0) >= T.pairQuota` → toast 同上并 return；成功抽走后 `T.drawnFrom[p]++` 并同步 row.got。
- `app.js doTributeDraw`（AI 抽）：目标从 `GX.Tribute.freeLosers(T.plan, T.drawnFrom)` 随机；为空则直接视为该胜方完成（`T.counts[wi] = T.shares[wi]`）后返回。

- [ ] **Step 4: 跑测试 + 冒烟**

Run: `node test/selftest.js`
Expected: PASS。
再跑 `node tools/build-mini-preview.js`，浏览器开 `preview.html?demo=tribute` 目测抽排流程无报错（Console 无红）。

- [ ] **Step 5: Commit**

```bash
git add engine minigame test/selftest.js
git commit -m "feat(solo): per-loser tribute cap in solo flow"
```

---

### Task 3: 联机 server/index.js —— 单人上限

**Files:**
- Modify: `server/index.js`（`afterDeal`、`tributeDrawOne`、`aiTributeDraw`、`advanceTribute` 超时回调、`draw` 消息处理、view 映射）

**Interfaces:**
- Consumes: Task 1 `plan.pairQuota`、Task 2 `Tribute.freeLosers`。
- Produces:
  - 房间 tribute 状态新增 `pairQuota`、`drawnFrom`；
  - 广播 `view.tribute` 新增 `pairQuota` 与 `pulledFrom`（对象，座位→已抽数），供客户端显示。

- [ ] **Step 1: 实现**

- `afterDeal`：tribute 对象加 `pairQuota: plan.pairQuota || null, drawnFrom: {}`。
- `tributeDrawOne(room, winner, loser)`：入口若 `T.pairQuota && (T.drawnFrom[loser]||0) >= T.pairQuota` 直接 `return false`；成功抽走后 `T.drawnFrom[loser]++`，返回 `true`。
- `aiTributeDraw` 与 `advanceTribute` 超时代抽：目标改从 `GX.Tribute.freeLosers(T.plan, T.drawnFrom)` 随机；为空则把 `T.drawsDone[w] = T.shares[idx]` 强制视为完成。
- `draw` 消息（人类选座）：若目标不在 `freeLosers` → `send(ws, { t:'err', msg:'这家已抽满' })`，不抽。
- view 映射（约 88-98 行）：`view.tribute` 增加 `pairQuota: T.pairQuota, pulledFrom: T.drawnFrom`。

- [ ] **Step 2: 验证**

Run: `node tools/test-lock.js`（若存在联机冒烟脚本，跑通即可）+ `node server/index.js` 启动后用 `node tools/netbot.js`（如支持进贡）或两个浏览器标签开 `preview.html?server=ws://127.0.0.1:8787` 打到第 2 局验证抽牌上限。
Expected: 独食赢局每人最多被抽 quota；抽满后选该座报错提示。

- [ ] **Step 3: Commit**

```bash
git add server/index.js
git commit -m "feat(server): per-loser tribute cap online"
```

---

### Task 4: 云函数 minigame/cloudfunctions/gx13/index.js —— 单人上限与 total 修正

**Files:**
- Modify: `minigame/cloudfunctions/gx13/index.js`（`startTribute`、`openTributePull`、`pullOne`、`autoTribute`、view 映射）

**Interfaces:**
- Consumes: Task 1 `plan.pairQuota`、Task 2 `Tribute.freeLosers`。
- Produces: `T.pairQuota`、`T.pulledFrom`（目标座位→本次已抽数）；`T.total = per × targets.length`，其中 `per = T.pairQuota || T.count`。

- [ ] **Step 1: 写失败检查（Node 静态断言）**

`openTributePull` 旧式 `T.total = T.count * T.targets.length` 在新 count=12、targets=3 时会得 36。在 `tools/test-tribute-quick.js`（如覆盖进贡）或新增小段 Node 断言：

```js
// 云函数导出不便直接 require 时，改为静态源码检查 + 运行期冒烟
```

若云函数无法本地直接跑（依赖 wx-server-sdk），此 Task 的"测试"= 静态检查 + 与 server 版逐行对照评审。

- [ ] **Step 2: 实现**

- `startTribute`：`T.pairQuota = plan.pairQuota || null; T.pulledFrom = {};`
- `openTributePull`：`var per = T.pairQuota || T.count; T.total = per * T.targets.length;`
- `pullOne`：若 `T.pairQuota && (T.pulledFrom[target]||0) >= T.pairQuota` 直接返回；成功抽走后 `T.pulledFrom[target]++`。
- `autoTribute`：目标从 `GX.Tribute.freeLosers({ losers: T.targets || T.losers, pairQuota: T.pairQuota }, T.pulledFrom)` 选取；为空则结束本轮。
- view 映射：`view.tribute` 增加 `pairQuota`、`pulledFrom`。

- [ ] **Step 3: 验证**

Run: 对照 `server/index.js` 同名函数逐段 diff，确认逻辑等价；`node -e "require('./minigame/cloudfunctions/gx13/engine/tribute.js')"` 确认模块可加载。
Expected: 逻辑等价、模块可加载。

- [ ] **Step 4: Commit**

```bash
git add minigame/cloudfunctions/gx13
git commit -m "feat(cloud): per-loser tribute cap + pull total fix"
```

---

### Task 5: 客户端 online 映射 + 抽排"已满"显示

**Files:**
- Modify: `minigame/js/app.js`（online state → S.tribute 映射，约 420-490 行）
- Modify: `minigame/js/views.js`（`tribute()` 的 pull rows 绘制，约 950-969 行）

**Interfaces:**
- Consumes: Task 3/4 广播的 `pairQuota`、`pulledFrom`；Task 2 的 row.cap/got 字段。
- Produces: pull rows 每项最终字段 `{ rel, n, cap, got }`；`got>=cap` 时该行置灰且热区移除。

- [ ] **Step 1: 实现**

- `app.js` online 映射：把服务端 `pulledFrom` 映射到 `S.tribute.drawnFrom`，pull rows 构造时带 `cap/got`（与 Task 2 单机同构）。
- `views.js tribute()`：row 标签区第二行由 `'N 张'` 改为 `'剩 X/Y'`（X=cap-got 剩余可抽，Y=cap）；`got>=cap` 的行：整行牌背降透明度至 0.35、标签显示"已满"，且不再 push `pullCard` 热区。`pairQuota==null`（2v2）时保持现状显示。

- [ ] **Step 2: 验证**

Run: `node tools/build-mini-preview.js`，开 `preview.html?demo=tribute`（若 demo 不支持配额数据，用单机模拟一局到第 2 局）目测。
Expected: 抽满的行置灰且不可点；2v2 显示不变。

- [ ] **Step 3: Commit**

```bash
git add minigame/js
git commit -m "feat(ui): tribute row cap display and sold-out state"
```

---

### Task 6: 规则书更新 + 全量回归

**Files:**
- Modify: `docs/规则书-十三张独食.md`（§F 追加独食局小节）

- [ ] **Step 1: 文档**

§F 追加「独食局进贡（按独食者名次）」小节：上表（4 行名次×重/轻）、单人抽满即封、身份牌不占名额、2v2 不变；配置键不变（仍由 `tributeTier` 控重/轻）。

- [ ] **Step 2: 全量回归**

Run:
```
node test/selftest.js
node test/selfplay.js 200 8
node tools/build-mini-preview.js
```
Expected: 全 PASS；preview.html 重建成功。

- [ ] **Step 3: Commit**

```bash
git add docs test
git commit -m "docs: lone tribute table in rulebook"
```
