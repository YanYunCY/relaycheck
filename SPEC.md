# relaycheck（验货）MVP 规格 v0.1

> v0.2 (2026-10-31): probe set v2 (24 probes), permutation mid-p test with over-dispersion correction, exact billing baselines in references. See docs/METHOD.md. The text below is the original v0.1 spec.

一句话：一行命令验证 LLM 中转站 / 代理 / 网关是否真的在提供你付费的模型，用 agent 的真实用法测，给出带 p 值的统计结论和一张可分享的双语报告卡。key 永不离开本机。

## CLI
```
npx relaycheck <base_url> --model <name> [--api anthropic|openai|responses|auto] [--key-env RELAY_KEY]
               [--samples 24] [--probes all|identity,protocol,billing,context] [--lang zh|en]
               [--json out.json] [--html report.html] [--card card.svg] [--ref refs/<model>.json]
npx relaycheck fingerprint <base_url> --model <name> --out refs/<model>.json   # 从可信端点生成参考指纹
npx relaycheck mock --kind honest|swap|inject|truncate --port 8787             # 本地假中转，用于演示与测试
```
- key 从环境变量读（默认 RELAY_KEY），不接受命令行明文，不写日志，报告里脱敏。
- 退出码：0 = 一致，1 = 不一致，2 = 存疑/无法判定，3 = 运行错误（方便 CI）。

## 探针组（每项输出 pass / warn / fail + 证据）
1. identity（统计指纹，核心）：一组有限选项的简单问题（随机数 0-9、选颜色、选字母等，约 16 个探针），每个采样 N 次（默认 24，temperature=1），得到类别分布；与参考指纹逐探针做卡方 / Jensen-Shannon 检验，探针级 p 值用 Cauchy 组合检验合成端点级 p 值（参考 DFA，arXiv 2610.37086）。无参考时退化为启发式（自报身份、知识截止、分词器长度特征）并标为“未校准”。
2. protocol（协议保真）：tool_use 往返（定义工具→模型调用→回传结果→最终答复）、SSE 事件序列完整性、stop_sequences、max_tokens 截断行为、响应 model 字段回显、Anthropic thinking 块与 signature 是否存在。
3. billing（计费）：Anthropic 用 count_tokens（若可用）或本地估算对比 usage.input_tokens，差值 > 阈值判为“隐藏注入 token”（报告注入量）；同一长前缀连续两次请求，检查 cache_read_input_tokens 是否出现、倍率是否合理。
4. context（上下文）：在约 32k/100k token 处埋 needle，检查能否找回，判断是否截断上下文窗口（默认只跑 32k，--deep 才跑大的，提示成本）。

## 输出
- 终端：彩色、中英双语（--lang），先给一行结论（例：「不一致：p=0.0003，行为不像 claude-sonnet-x；每请求多计 512 input token」），再列各项。
- JSON（机器可读，含原始证据）、HTML 报告、SVG 报告卡（1200×630，适合发 X/V2EX，自动隐藏 base_url 主机名，可 --show-host 显示）。

## 技术
- TypeScript，Node ≥ 20，零运行时依赖（fetch 原生），tsup 打包单文件，npx 分发。
- 统计纯 TS 实现：卡方、JS 散度、置换/近似 p 值、Cauchy 组合。
- 参考指纹文件格式 refs/<model>.json：{model, api, created, samples, probes:[{id, prompt, dist:{label:count}}]}。
- mock 服务器：honest（按内置分布作答）、swap（换成另一套分布）、inject（usage 多报 N token）、truncate（丢弃 8k 之后的内容），支持 Anthropic 与 OpenAI 两种协议。
- 测试：vitest，全部基于 mock，无需真实 key。

## 不做（v0.1）
- 公开点名的红黑榜；多租户服务；GUI。
- watch 哨兵模式（v0.2）。
