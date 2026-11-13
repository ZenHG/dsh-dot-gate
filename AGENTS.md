# AGENTS.md — working inside dsh-dot-gate

> 给**改这个仓库的 agent** 读。人类请看 README；准入门槛在 [SCOPE.md](./SCOPE.md)；
> 从"值得做"到"发出去"的完整路径在 [PROCESS.md](./PROCESS.md)。
> 🔴 **本文件不写任何"测试多少项 / 门多少条"这类数字** —— 写在这里的数字没有闸能守，必然漂。
> 要数字就跑命令。要命令看 §2。

---

## 0 · 30 秒版

1. **先跑基线，再读代码**：`npm run verify`。它红**不一定是你的错**，但一定是当前的起点。
2. **改行为之前先读 [PROCESS.md](./PROCESS.md)**：样例先行（step 1），最小改动（step 2）。
3. **禁止给闸接管道**：`npm run verify | tail` 会把退出码换成 `tail` 的。跑裸命令，读退出码。
4. **禁止把"没跑 / SKIP"写成"通过"**。退出码 `2` = 没能完整运行，不是绿。
5. **禁止提交 `.research/`**：它是本地调研，已在 `.gitignore` 里；绕过 `-f` 提交 = 把内部对标材料公开。

---

## 1 · 这个包在做什么

一个 DSH 插件：当模型把**否定性能力断言**（"某模型做不到 X"）写进知识库时，要求它先过一份
**可机检的证据闸**（来源数、同模型正例检索、量名登记、对照变量的活性、可复跑命令）。

它不是权限层，不判断断言的真假，只判断**这份断言有没有可指认的证据**。

两种动作模式：
- **soft（默认）**：写入照常，随后注入一条提醒；`steerAtTurnEnd` 打开时会在收尾边界 object 一次。
- **hard**：`tools/pre-execute` 直接 **deny** 这次写入，并把理由写给模型。

---

## 2 · 改什么 → 至少跑什么

| 你改了什么 | 至少跑 | 为什么 |
|---|---|---|
| 任意 `.js` / `.mjs` | `node --check <file>` + `npm test` | 语法与行为 |
| `src/verdict.mjs`（R1–R5） | `npm test` + `npm run crosscheck`（需 `VERDICT_GATE_PY`） | **双实现必须同结论**；不一致就是漂移 |
| `packs/*.json`（量名/活性/阈值） | `npm test` + `npm run crosscheck` | 包是**两个实现共读的同一份数据**；改包必须两边都验 |
| `src/pack.mjs`（包校验） | `npm test` | 坏包必须在加载时报出键名，不能等到规则里才炸 |
| `index.js` 的钩子 / 配置 | `npm test` + `node scripts/hygiene.mjs` | 配置错误必须抛可读异常，不能静默不装载 |
| `skills/dot/SKILL.md` 的 frontmatter | `node scripts/hygiene.mjs`（S18） | 缺 `name`/`description` 会让 provider 返回空目录 |
| `package.json` 的 `files`/`exports` | `npx publint` + `npm run gate:pack` | 打包面错 = 装到别人机器上才炸 |
| 公开文本（README 等） | `node scripts/hygiene.mjs` | 盘符路径 / 本机身份 / 凭据 |
| 准备发布 | `npm run verify` → `npm publish` → **`npm view` 复核** | 见 §4 |

---

## 3 · 铁律（每条都有过代价）

1. **闸门不接管道**。管道报的是最后一个命令的退出码，不是闸门的。
2. **`SKIP` 不是 `PASS`**。`2` = 没跑全；`--require-all` 把 SKIP 升成失败。
3. **配置错误必须在加载时报出来**，带键名和实参。静默不装载比报错更难查。
4. **不加运行时依赖**。要加就先在 `.out-of-scope/` 里删掉对应的拒绝条目，并写清为什么那条不再成立。
5. **一次性密码不由 agent 输入**。发布要 2FA 时，让人类在终端里完成。
6. **"改了磁盘" ≠ "生效"**。宿主加载的 Node 代码不热重载；配置项可能热加载，代码不会。
7. **规则只增不减 = 变成它要防的东西**。误报过 10% 就放宽，完全不触发就删，并记录原因。

---

## 4 · 发布（最容易出错的一步）

- 版本号**删过就永久作废**，不能复用。
- npm 11 是**暂存发布**：`npm publish` 出现成功行**不代表已发布**，registry 上只有 `0.0.0-stage` 占位符，
  要维护者 2FA 批准。
- **唯一判据**：`npm view <pkg> versions --json` 里出现了那个版本号。
- 批准之后再跑一次干净安装复核（`scripts/pack-verify.mjs` 的等价做法）。

---

## 5 · 报告纪律

结论必须带判据：**命令 + 观测值**。给不出就别说"已完成"。

- ✅ "闸门 exit 1，四条规则同时命中"
- ❌ "闸门已经能拦住错误结论了"

同一个量在两个实现里算出不同结果时，**先怀疑实现，不要先怀疑数据**——
这正是保留 Python/JS 双实现的意义（`npm run crosscheck`）。

---

## 6 · 目录

```
index.js              宿主半边：钩子与 skill provider
src/verdict.mjs       规则引擎（JS 实现）
src/pack.mjs          判据包加载与校验
packs/                判据包本体：量名 / 变量活性 / 阈值（只有数据，没有逻辑）
skills/dot/SKILL.md   随包分发的 skill
samples/              冻结样本，回归集的实体
scripts/              hygiene / cross-check / pack-verify
.out-of-scope/        被拒的方向（一个概念一个文件）
.research/            本地调研，不进 git、不进包
```
