节点：分享创造
发布：2026-11-02（周一）09:00 CST

标题：
做了个给 API 中转「验货」的开源工具 relaycheck：用统计指纹查有没有偷换模型、偷加 token

正文：
买中转最怕三件事：标着 Sol/Astra 实际给你跑便宜模型，偷偷往 prompt 里塞东西多算钱，上下文被截断。以前只能凭感觉「好像降智了」，没法证明。

relaycheck 一条命令跑完：

npx relaycheck https://你的中转/v1 --model gpt-6.1-sol

它查四样东西：
• 身份：24 个开放式小问题各问 24 次，把回答分布和官方 API 录的参考指纹做统计检验（卡方 + Cauchy 合成），不看模型自报
• 计费：同样的 prompt，比对中转报的 input_tokens 和官方基线，能抓到隐藏注入
• 协议：工具调用、流式、stop、截断行为
• 上下文：32k / 100k 埋针

实测（都用官方 OpenAI API 录参考）：
• 官方自测：gpt-6-luna 20 轮 0 误报；sol、terra、astra、codex 共 7 轮全部判一致
• 拿 gpt-6-luna 冒充 sol / terra / astra / codex：7/7 抓到，p ≤ 1.2e-5
• 拿 terra 冒充 sol：抓到，p = 1.6e-14
• 本地搭了个「改 model 字段」的假中转：协议、计费都正常，指纹判不一致 p = 7.2e-15

也有测不出的，先说清楚：
• 拿 sol 冒充 astra 没抓到（p = 0.024）。这俩回答分布几乎一样，需要新的探针思路，欢迎一起想
• 80% 时间给真货的混合中转，24 次采样大概率测不出
• 目前只有 OpenAI 模型的参考指纹。没有官方 Claude key，Claude 指纹需要社区帮忙录一份（一条命令，约一美元以内）

key 只在你本机用，不上传；工具不点名任何中转，只给证据，不下结论。

GitHub：https://github.com/YanYunCY/relaycheck
方法和局限写在 docs/METHOD.zh-CN.md，欢迎拍砖、提 PR、贡献指纹。
