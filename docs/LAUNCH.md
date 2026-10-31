# relaycheck 演示动图脚本 + 发布计划

## A. 演示动图脚本（目标 ≤ 25 秒，1200×700，vhs 录制）

工具：charmbracelet/vhs（`.tape` 文件可复现），终端字体 JetBrains Mono 16，主题深色。

| 秒 | 画面 | 字幕（中/英） |
|---|---|---|
| 0–3 | 标题帧：`relaycheck 验货` + 一句 slogan | 你买的是 Claude，拿到的是什么？ / You paid for Claude. What did you get? |
| 3–9 | 左右分屏。左：`npx relaycheck http://honest.local --model claude-x`；右：同命令打 `swap.local` | 同一条命令，两家中转 / Same command, two relays |
| 9–15 | 进度条跑 identity / protocol / billing / context 四组 | 24 个探针 × 24 次采样，key 不离开本机 |
| 15–20 | 左绿：`一致 p=0.62`；右红：`不一致 p=0.0003 · 每请求多计 512 token` | 统计检验，不是拍脑袋 / A p-value, not a vibe |
| 20–25 | 弹出 SVG 报告卡 + `npx relaycheck` 安装行 | 一行命令，开源 MIT |

录制源：`scripts/demo.sh`（mock honest / swap），不出现任何真实中转站名字。另出一张静态报告卡图做 README 首图和社交卡。

已产出：`docs/demo.gif` / `docs/demo.zh-CN.gif`（`vhs docs/demo.tape`、`vhs docs/demo.zh-CN.tape` 复现，1000×720、约 21 秒，mock honest / swap / inject），`docs/card-pass.png` / `docs/card-fail.png`（`bash scripts/cards.sh`），`docs/social-preview.png`（1280×640，源文件 `docs/social-preview.svg`，在 GitHub 仓库 Settings → Social preview 上传）。

## B. 发布计划

### 发布前（T-7 到 T-1）
- [x] 真实参考指纹 gpt-6-luna（其他模型靠社区 PR）。
- [ ] 找 5–10 位 V2EX / 群友内测真实中转，收集误报；目标同模型对照误报率 ≤ 1%。
- [x] README 双语、动图、报告卡图
- [x] FAQ：docs/FAQ.md / docs/FAQ.zh-CN.md。
- [ ] 公开后在 Settings → Social preview 上传 docs/social-preview.png（私有仓库没有这个选项）。
- [ ] 预写好各平台文案；GitHub topics：llm, claude, codex, api-relay, model-fingerprinting, claude-code。
- [ ] 经 Ted 同意后建仓 YanYunCY/relaycheck，发 npm v0.1.0。

### 发布日（建议周二或周三）
| 时间（北京时间） | 平台 | 角度 |
|---|---|---|
| 09:00 | V2EX「分享创造」+「程序员」 | 痛点叙事：降智/掺水怎么证明；附报告卡；强调不点名、key 不出本机 |
| 10:00 | 即刻、微信群、Telegram 中文 AI 群 | 截图 + 一句话 |
| 22:30（美东 09:30，11 月起美东冬令时差 13 小时） | Hacker News「Show HN」 | 标题：Show HN: Relaycheck – statistically test whether an LLM API relay serves the model it claims；正文讲 DFA/KBF 论文方法落地 + 影子 API 研究 45.8% 数据 |
| 22:00 | X（中英各一条线程） | 动图 + 报告卡；@ 论文作者、相关开发者 |
| 次日 | r/LocalLLaMA、r/ClaudeAI | 角度：OpenRouter/第三方提供商偷偷量化或换模型怎么查 |

### 发布后一周
- [ ] 每天回 issue，24 小时内修误报类 bug。
- [ ] 少数派 / 掘金长文：《用统计学给中转站“验货”》。
- [ ] 第 7 天发 v0.2 预告（watch 哨兵模式），二次传播。

### 红线
- 不发布点名的黑榜；用户自己分享报告时默认隐藏主机名。
- 任何建仓、推送、发帖、花钱前先问 Ted。
