# 小游戏界面重设计（主题 + 布局 + 特效） Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 小游戏界面换肤为暗夜墨蓝 + 鎏金 + 朱红主题，重排竖屏/横屏布局，升级牌型特效，新增 ♠3/♠A 身份特效与独食全屏揭示，修复进贡头像旁抽牌重叠 bug。

**Architecture:** 全部改动在 `minigame/js/views.js`（绘制/热区/特效）、`minigame/js/app.js`（状态与触发）、`minigame/js/audio.js`（合成音效）。纯 Canvas 程序化绘制，不引入素材；沿用 `S.fx.*` 时间戳 + `markDirty()` 重绘模式。

**Tech Stack:** 微信小游戏 Canvas API / 浏览器 preview.html（`node tools/build-mini-preview.js` 重建）；WebAudio 合成音效。

**Spec:** `docs/superpowers/specs/2026-11-20-minigame-ui-redesign-design.md`（配色表、布局参数、特效清单以该文档 §7 为准）

**依赖:** 本计划在「独食进贡规则」计划之后执行；其中 Task 3 的抽牌显示修复与进贡计划 Task 5 的 `rows[].cap/got` 字段兼容（无该字段时按现状显示）。

## Global Constraints

- 纯 Canvas，无 DOM、无图片/音频素材；设计宽 750 由 `platform.js` 缩放。
- `draw()` 返回的 hits 热区必须与视觉位置一一对应；任何布局改动后跑 `node tools/cdp-hitcheck.js`（或等效冒烟）。
- 竖屏与横屏（`layout()` 两分支）同步重做，横屏等比映射。
- 特效层只绘制、不新增热区；单个特效不长于 1.7 秒；同屏粒子不超过 60。
- 引擎三处副本本计划不动；`node test/selftest.js`、`node test/selfplay.js 200 8` 必须保持通过。
- 每个 Task 结束：`node tools/build-mini-preview.js` 重建 preview.html 并截图核对（用现有 `tools/cdp-shot.js` 等 CDP 工具或手动打开），随后 commit。

## Review Focus

1. **hits 热区错位**：布局改动后旧热区不跟随 → 每个布局 Task 的验证步骤含 hitcheck。
2. **横屏分支遗忘**：只改竖屏导致真机（landscape）错乱 → Task 8 专做横屏并截图验证。
3. **联机模式特效不触发**：identity/lone 触发必须基于 state 前后对比而非单机路径 → Task 6/7 钉住。
4. **脏检查漏新 fx 字段**：动画只画一帧就冻结 → Task 6/7 的验证含"动画完整播放"截图序列。
5. **进贡摊牌行与手牌/操作条重叠**：新布局下 pull 区位置需避开手牌区 → Task 4 验证。

---

### Task 1: 主题配色切换

**Files:**
- Modify: `minigame/js/views.js`（顶部 `C` 表 + 全文硬编码绿色值）

**Interfaces:**
- Produces: 新 `C` 表（键名不变，值替换）：`bg0:'#0a121f'`、`bg1:'#16273f'`、`felt:'#1a2f4d'`、`gold:'#d8b36a'`、`panel:'#0f1b2e'`、`btn:'#1c2f4a'`、`text:'#f2ead8'`、`dim:'#93a3ba'`、`red:'#c8452c'`；`paper/paper2` 不变。

- [ ] **Step 1: 替换 C 表值**，并全文检索 `#081d14`、`#143f2c`、`#14432f`、`#0e2a1f`、`#1b3a2b`、`#9db1a4`、`#b03a3f`、`rgba(6,26,18`、`rgba(20,40,30`、`rgba(8,30,22` 等旧绿色系硬编码，逐一替换为墨蓝对应值（面板类 `rgba(10,20,34,·)`、按钮禁用类 `rgba(16,28,46,·)`）。

- [ ] **Step 2: 验证**

Run: `node tools/build-mini-preview.js`，截图 `preview.html` 主界面。
Expected: 整体呈墨蓝调，无残留绿色块。

- [ ] **Step 3: Commit** `git commit -m "feat(ui): midnight-blue theme palette"`

---

### Task 2: 竖屏布局重排（layout + 页头胶囊）

**Files:**
- Modify: `minigame/js/views.js`（`layout()` 竖屏分支、`header()`）

**Interfaces:**
- Produces（后续 Task 依赖的新 layout 字段，竖屏）：
  - `headerH: 96`；胶囊按钮几何由 `header()` 内部统一计算：高 44、圆角 22、间距 8、文字 15，自右向左排列：重开(78) / 强度(86) / 进贡档(86) / 场次(78) / 音效(78) / 测进贡(78，保留)
  - `seats`: 各家 `w:176, h:64`；`north` 居中置顶排，`west/east` 左右、`south` 移至手牌区左上（`y = hand.y - 84`）
  - `center.y`：约 `H×0.40`（出牌区上移至视觉中心）
  - `hand`: `cardW:64, cardH:90, step:52, y: H-268`（以 13 张居中不溢出为准微调）
  - `actions`: `{ y: H-112, h:74 }`（保持不变量，按钮在 Task 4 重排）

- [ ] **Step 1: 重排 layout() 竖屏分支**，按上值；`header()` 按钮改为胶囊（圆角 22），顺序/宽度如上。

- [ ] **Step 2: 验证**

Run: 重建 preview，截图主界面 + 跑 `node tools/cdp-hitcheck.js`。
Expected: 视觉符合 spec §7.2；热区全部命中。

- [ ] **Step 3: Commit** `git commit -m "feat(ui): portrait layout rework + capsule header"`

---

### Task 3: 座位牌重绘 + 头像旁抽牌重叠修复

**Files:**
- Modify: `minigame/js/views.js`（`seatPlate()`、`seats()` 进贡段 571-578 行附近）

**Interfaces:**
- Consumes: 进贡 `TR.draws`（元素 `{from,to,card}`）。
- Produces:
  - 座位牌内部结构：左圆徽（直径 40）+ 名字 + 下行 `N 张 · +分`（分数并入，不再挂右端）；
  - 身份标记样式：黑金圆徽（♠3/♠A），独食者座位牌边框改朱红常驻（替代旧红 chip，「独食」字保留在牌右上角）；
  - 抽牌展示函数 `drawnFan(ctx, cards, x, y, dir)`：把某座位被抽走的牌扇形展开（每张错开至少 16px 横移，牌 30×42，最多显示 5 张，超出取最后 5 张），所有牌 rank/suit 角标完整可见。

- [ ] **Step 1: 重绘 seatPlate**（结构如上，保留 active 金边脉冲、进贡 dash 框等现有行为）。

- [ ] **Step 2: 修复重叠**：seats() 进贡段把 `got.slice(-3)` + `gi*6/gi*8` 叠放改为调用 `drawnFan`，`.slice(-5)`、错开至少 16px；东/西两侧按 `dir` 决定展开方向避免出屏。

- [ ] **Step 3: 验证**

Run: 重建 preview；`preview.html?demo=tribute` 截图对比（修复前后），主界面截图核对座位牌。
Expected: 每张被抽的牌点数花色清晰可读；座位牌信息完整。

- [ ] **Step 4: Commit** `git commit -m "feat(ui): seat plate rework + drawn cards fan fix"`

---

### Task 4: 手牌与操作条

**Files:**
- Modify: `minigame/js/views.js`（`hand()`、`actions()`、`pill()`/`btn()`）

**Interfaces:**
- Produces:
  - 手牌选中态：上移 22px + 金描边（现有选中逻辑保留，仅调参数）；
  - 操作条：`提示/过牌/出牌` 一行居中；倒计时由独立数字改为嵌在「出牌」按钮左侧的环形进度（复用 `clockChip` 画法，半径 14，剩余秒数字在环心）；`actions.y` 处不再有独立倒计时文本。

- [ ] **Step 1: 实现**；确认进贡 pull 区（`L.center.y` 附近）与新手牌区不重叠。

- [ ] **Step 2: 验证**

Run: 重建 + 截图（选中一张牌的状态、轮到你出牌的状态）+ hitcheck。
Expected: 选中反馈明显；倒计时随秒数走；热区命中。

- [ ] **Step 3: Commit** `git commit -m "feat(ui): hand + action bar with embedded countdown"`

---

### Task 5: 牌型横幅 + 牌型特效升级

**Files:**
- Modify: `minigame/js/views.js`（`kindFx()`、`fxOverlay()`，新增 `banner()`）

**Interfaces:**
- Produces:
  - `banner(ctx, text, p)`：居中偏上金色立体字，缩放 0.6→1.1→1.0 弹入（前 30%），停留，末段上移淡出；`p` 取值 0 到 1。
  - `kindFx()` 非单张牌型在原有粒子基础上叠加 `banner(ctx, 牌型名, p)`；牌型名由 `kindLabel(kind)` 提供（"对子/三个/顺子/同花/葫芦/四条/同花顺"）。
  - `flush`：粒子颜色按该手牌实际花色（♠ 银白 `226,232,240`、♥ 朱红 `224,90,70`、♣ 翠绿 `90,200,140`、♦ 鎏金 `255,216,140`）；`kindFx` 签名加 `cards` 参数（`fxOverlay` 从 `S.fx.cards` 传入，app.js 在 `fxPlayed` 记录该手牌数组）。
  - `four`：加全屏震动（绘制层 `ctx.translate` 随机正负 6px，300ms 线性衰减）+ 一道粗冲击波环。
  - `straightflush`：加一道从左到右满屏流光扫过（线性渐变带，400ms）。
  - `straight`：流线 5 条增至 7 条，首尾加辉光点。

- [ ] **Step 1: 实现 banner + kindFx 改造 + app.js `S.fx.cards` 记录。**

- [ ] **Step 2: 验证**

Run: 重建后逐个开 `preview.html?demo=fx&kind=four`、`kind=straightflush`、`kind=flush`（及 `?fx=0.3/0.6` 静态帧）截图。
Expected: 各牌型有横幅且效果区分明显；单张无横幅。

- [ ] **Step 3: Commit** `git commit -m "feat(fx): kind banner + upgraded per-kind effects"`

---

### Task 6: ♠3/♠A 身份特效

**Files:**
- Modify: `minigame/js/views.js`（新增 `drawSpade()`、`identityFx()`、`fxOverlay()` 分支）
- Modify: `minigame/js/app.js`（`fxPlayed`、online state 处理、脏检查、demo 入口）

**Interfaces:**
- Produces:
  - `drawSpade(ctx, x, y, size, fill)`：Canvas 路径画 ♠。
  - `identityFx(ctx, S, L, p, seat, rank)`：三幕——落点黑金光柱（0-0.2）、12 枚 ♠ 粒子炸开（全程）、身份徽标（黑金圆章，内嵌 ♠3/♠A）自桌中央沿二次贝塞尔飞入 `L.seats[seat]`（0.35-1.0）。
  - `app.js`：`fxPlayed` 检测本手含 ♠3/♠A（`s===3&&(r===3||r===14)`）→ 置 `S.fx.identityT0/identitySeat/identityRank`；online 模式在 state 更新处对比前后 `revealedCards` 增量触发同组字段；脏检查（约 70-75 行）加 `identityT0`（小于 1000ms）；`demoFx()` 支持 `?demo=identity`。

- [ ] **Step 1: 实现**（先 app.js 触发与字段，后 views.js 绘制）。

- [ ] **Step 2: 验证**

Run: 重建；`?demo=identity` 连截 3 帧（约 0.2/0.5/0.9 进度）。
Expected: 光柱→粒子→徽标飞入座位的完整动画；徽标落点与座位牌吻合。

- [ ] **Step 3: Commit** `git commit -m "feat(fx): spade identity card reveal effect"`

---

### Task 7: 独食全屏揭示 + 音效三件套

**Files:**
- Modify: `minigame/js/views.js`（新增 `loneRevealFx()`、`fxOverlay()` 分支、`seatPlate()` 朱红边框）
- Modify: `minigame/js/app.js`（触发、脏检查、demo 入口）
- Modify: `minigame/js/audio.js`（`bank` 新增 `identity`、`lone`，必要时 `bomb`）

**Interfaces:**
- Produces:
  - `loneRevealFx(ctx, S, L, H, p, seat)`：桌面压暗至 40%（全程）→ ♠3/♠A 双牌面自两侧飞入中央合并放大至 1.6 倍（0-0.45）→「独食」朱红大字 2.2→1.0 砸下 + 震屏 + 黑红粒子爆发（0.45-1.0）；总时长约 1600ms。
  - `app.js`：出牌后若某座位 `revealedCards` 同时含 3 与 14（单机直接判、online 对比增量）→ `S.fx.loneRevealT0/loneSeat`；脏检查加 `loneRevealT0`（小于 1700ms）；`demoFx()` 支持 `?demo=lone`。
  - `seatPlate()`：该座位 revealedCards 含 3 和 14 → 边框 `C.red` 常驻 + 右上角「独食」朱红小字。
  - `audio.js bank`：`identity`（220Hz 正弦 0.5s 指数衰减 + 440 泛音）、`lone`（低通噪声鼓点两下、间隔 0.18s + 高通噪声锣 0.4s）；four 的轰声已由 `playKind('four')` 覆盖，不重复新增。

- [ ] **Step 1: 实现触发与绘制、音效。**

- [ ] **Step 2: 验证**

Run: 重建；`?demo=lone` 连截 4 帧；`?demo=fx&kind=four` 目测确认。
Expected: 压暗、合并、砸字、震屏完整；独食者座位朱红边框常驻。

- [ ] **Step 3: Commit** `git commit -m "feat(fx): lone reveal cinematic + identity sfx"`

---

### Task 8: 横屏布局同步

**Files:**
- Modify: `minigame/js/views.js`（`layout()` 横屏分支、依赖坐标的各视图）

**Interfaces:**
- Consumes: Task 2 的竖屏几何语义（座位牌 176×64、中央区上移、手牌宽松化）。
- Produces: 横屏分支同等语义的几何：座位牌同尺寸贴桌边、出牌区居中偏上、手牌底排居中、操作条右下成组。

- [ ] **Step 1: 实现横屏分支重排。**

- [ ] **Step 2: 验证**

Run: 重建；preview 窗口拉横（或 `tools/cdp-shot.js` 横屏尺寸）截图主界面/进贡/结算。
Expected: 与竖屏同风格、无重叠错位；hitcheck 通过。

- [ ] **Step 3: Commit** `git commit -m "feat(ui): landscape layout parity"`

---

### Task 9: 全场景回归

**Files:**
- 无新增（纯验证）

- [ ] **Step 1: 回归**

Run:
```
node test/selftest.js
node test/selfplay.js 200 8
node tools/build-mini-preview.js
node tools/cdp-hitcheck.js
```
并截图清单：主界面（竖/横）、出牌特效（four、straightflush）、`demo=identity`、`demo=lone`、进贡 pull（含已满行）、结算、联机大厅。

Expected: 全部通过；截图无破版。

- [ ] **Step 2: Commit** `git commit -m "chore: ui redesign regression pass"`（如有修补）
