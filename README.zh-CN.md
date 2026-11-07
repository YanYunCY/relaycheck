<div align="center">

# relaycheck 验货

**你买的是这个模型，中转给你的到底是什么？**

一行命令，用统计检验验证 LLM 中转站 / 代理 / 网关：模型是不是真的、token 有没有多算、长上下文有没有被截。key 只发给你要测的中转。

[English](README.md) · [简体中文](README.zh-CN.md)

<img src="docs/demo.zh-CN.gif" alt="relaycheck 演示：诚实的模拟中转通过；换模型的中转 p=8.3e-6 判为不一致；偷加 token 的中转被抓到每请求多计 512 token" width="900">

<sub>动图用的是本地模拟中转（<code>scripts/demo-setup.sh</code>），不需要 key。真实运行截图见下。</sub>

</div>

```bash
export RELAY_KEY=sk-...    # 只从环境变量读取，不接受命令行明文
npx relaycheck https://relay.example.com --model gpt-6-luna --lang zh --card card.svg
```

身份检测要和该模型的**参考指纹**对比。目前内置：`gpt-6-luna`、`gpt-6.1-sol`、`gpt-6.1-terra`、`gpt-6-astra`、`gpt-5.3-codex`。**还没有 Claude 的参考指纹**（我只有 OpenAI 的 key）：测其他模型时身份结论为“存疑”，协议、计费、上下文照常检测。有官方 key 的话，[自己生成参考指纹](#自己生成参考指纹)大约花 1 美元，非常欢迎 PR 到 `refs/`。默认一次检测约 590 个短请求、约 6.5 万 input token（`--deep` 再加 10 万），需要几分钟。

**真实运行（2026-10-31，输出未改动）：** 官方 OpenAI API 判为一致；一个本地代理收到 `gpt-6.1-sol` 请求，实际转给 `gpt-6.1-terra`，并把返回里的模型名改回去，被抓到 p = 1.6·10⁻¹⁴。

<img src="docs/real-run-official.png" alt="对官方 OpenAI API 的真实运行：一致，p=0.722，四组检查全部通过" width="900">
<img src="docs/real-run-swap.png" alt="对偷换模型代理的真实运行：不一致，p=1.6e-14，疑似换模型" width="900">

<sub>由真实运行的终端输出（<code>calib/e2e/official-full.txt</code>、<code>calib/val/sol-swap-terra-1.txt</code>）经 <code>scripts/real-run-shot.py</code> 渲染；换模型代理见 <code>scripts/dishonest-proxy.mjs</code>。</sub>

## 为什么做这个

用 Claude Code、Codex 的国内开发者大多离不开中转，可“今天是不是降智了”“是不是掺了便宜模型”“怎么 token 用得这么快”一直没法证明。2026 年一项影子 API 审计（[arXiv 2603.01919](https://arxiv.org/abs/2603.01919)）测了 24 个端点，**11 个（45.8%）没通过指纹验证**。感觉不算证据，p 值才算。

## 测什么

| 组 | 方法 |
|---|---|
| **身份** | 24 个有限选项探针（探针集 v2），temperature=1 下各采样 N 次，与参考指纹逐题做蒙特卡洛置换卡方检验（mid-p、过离散校正），再用 Cauchy 组合检验合成一个总 p 值 |
| **协议** | coding agent 真正依赖的东西：工具调用往返、SSE 事件序列、stop_sequences、max_tokens 截断、model 回显、Anthropic thinking 块与签名 |
| **计费** | 用参考指纹里存的**官方** token 数逐 token 对比 usage，揪出隐藏注入。没有参考时退回中转自己的 count_tokens（只能发现中转没在 count_tokens 里同样加上的注入）或本地估算（标为“未校准”）。另查 prompt cache 是否真的命中 |
| **上下文** | 在 2k（对照）和 32k 文档的 10%/50%/90% 深度各埋一根针；`--deep` 加测 100k；漏针会先复测再判截断 |

支持 Anthropic Messages、OpenAI Chat Completions、OpenAI Responses（`--api auto` 自动识别）。

## 输出

- 终端一行结论 + 分组证据（`--lang zh|en`）
- `--json` 给 CI 用，`--html` 生成完整报告
- `--card` 生成 1200×630 中英双语分享卡（SVG），默认隐藏中转域名（`--show-host` 显示）。要 PNG：`rsvg-convert card.svg -o card.png`，或用浏览器打开 SVG 截图；relaycheck 保持零依赖，不内置栅格化。

<p align="center"><img src="docs/card-pass.png" alt="分享卡：一致" width="440"> <img src="docs/card-fail.png" alt="分享卡：不一致" width="440"></p>

退出码：`0` 一致 · `1` 不一致 · `2` 存疑 · `3` 运行错误。放进 CI，就能定时盯住团队在用的中转。

## 无需 key 先体验

```bash
git clone https://github.com/YanYunCY/relaycheck && cd relaycheck
npm install && npm run build
LANG_OPT=zh bash scripts/demo.sh    # 老实的假中转 vs 偷换模型的假中转
```

假中转类型：`honest`、`swap`（换模型）、`inject`（每次多计 512 token）、`truncate`（8k 之后全丢）。

## 真实测试

我们用 relaycheck 测了官方 OpenAI API。数字都来自 [docs/METHOD.zh-CN.md](docs/METHOD.zh-CN.md)，那里也写了怎么复现。

- **官方 gpt-6-luna 一致。** 对 `refs/gpt-6-luna.json` 做了 20 次独立的身份检测，每次 24 个探针 × 24 次采样，共 11,520 次请求。20 次全部通过：0 次不一致，0 次存疑，最小 p = 0.105。全组检查（含 `--deep` 100k）p = 0.722，计费与官方 token 数逐个一致。
- **冒充 gpt-6-luna 的其他模型被抓到。** gpt-5.6-luna（同一家族）10/10 次判为不一致（p 中位数 6.9·10⁻¹⁵），gpt-5-nano 5/5（中位数 1.8·10⁻¹⁸），gpt-5.4-nano 5/5（中位数 4.2·10⁻¹⁷）。
- **真实的换模型中转。** 本地代理把请求转给 gpt-5.6-luna，并把 `model` 字段改回 gpt-6-luna。relaycheck 判定 `不一致 p=7.2e-15`，而协议、计费、上下文全部看起来正常。
- **更多参考指纹（2026-10-31）。** 新增 gpt-6.1-sol、gpt-6.1-terra、gpt-6-astra、gpt-5.3-codex 的真实指纹。官方自测 7/7 一致（p 0.43–0.96；另有一次因本地计量代理崩溃中途失败，见 `calib/val/astra-honest-1.txt`）。拿 gpt-6-luna 冒充它们：7/7 抓到（p ≤ 1.2·10⁻⁵）。拿 gpt-6.1-terra 冒充 gpt-6.1-sol：抓到，p = 1.6·10⁻¹⁴。
- **我们自己找到的盲区。** 拿 gpt-6.1-sol 冒充 gpt-6-astra **没抓到**（p = 0.024，判为一致）。两者的回答分布几乎一样（平均 JS 0.017，相当于两次官方自测之间的噪声），tokenizer 计数也相同。目前的采样探针分不出这两个，需要加「能力型」探针。欢迎一起想办法。
- **隐藏提示注入。** 每次偷偷加一段系统提示的代理被精确抓到：*每请求多计 37 个 input token*。
- **校准。** 数千次模拟的零假设运行中，误报率不超过名义水平：不一致阈值（p < 0.001）为 0.05%，存疑阈值（p < 0.01）为 0.8%。

测不出来的：大部分时间转发真模型的中转（24 次采样时，80% 真货的混合只有 7.8% 判为不一致），厂商更新模型，以及几乎相同的变体。这些都是证据，不是铁证。详见[局限](docs/METHOD.zh-CN.md#7-局限relaycheck-测不出什么)。

## 自己生成参考指纹

```bash
RELAY_KEY=$ANTHROPIC_API_KEY npx relaycheck fingerprint https://api.anthropic.com --model claude-sonnet-4-5 --out refs/claude-sonnet-4-5.json
```

请用可信端点生成参考指纹，`--api` 和 `--reasoning-effort` 要与之后检测时一致。参考文件会记录探针集版本、采样设置、过离散估计，以及每种协议的精确计费基准。0.1 版（探针集 v1）的参考文件仍可读取，但会提示你重新生成。

## 隐私

key 只从环境变量读取，只发给你指定的地址，所有输出里都脱敏。没有遥测，没有服务器。

## 局限，说清楚

统计结论是证据，不是铁证。大部分时间给真货、或能识别 relaycheck 固定探针的中转可能通过检测。官方更新模型后指纹会漂移，需要用可信端点重新生成。计费只有在有参考基准时才精确；中转自己的 count_tokens 和本地估算较弱，会如实标注。完整方法与数据见 [docs/METHOD.zh-CN.md](docs/METHOD.zh-CN.md)。relaycheck 永远不做点名黑榜，分享与否由你决定。

业余维护。参考指纹目前手动重录（每月重录的 workflow 已写好，但还没有配维护者 key）；其他模型的指纹欢迎通过 PR 贡献到 `refs/`。

更多问题见 [常见问题](docs/FAQ.zh-CN.md)。

## 方法来源

DFA（[arXiv 2610.37086](https://arxiv.org/abs/2610.37086)）、API-TAIL（[arXiv 2610.36801](https://arxiv.org/abs/2610.36801)）、KBF（[arXiv 2605.29524](https://arxiv.org/abs/2605.29524)）；影子 API 审计见 [arXiv 2603.01919](https://arxiv.org/abs/2603.01919)。相关项目：relay-guard、RelayScope、fpverify、claude-detector。

MIT 许可证
