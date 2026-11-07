标题：【开源自荐】relaycheck：一行命令给 LLM 中转站「验货」，用 p 值判断模型有没有被偷换

## relaycheck

用 Claude Code、Codex 离不开中转，但"是不是掺了便宜模型""token 怎么用得这么快"一直只能靠感觉。relaycheck 把它变成统计检验：

- 身份：24 个有限选项探针在 temperature=1 下多次采样，和官方 API 测出的参考指纹逐题做置换卡方检验，合成一个总 p 值
- 计费：用指纹里存的官方 token 数逐个对比 usage，揪出隐藏注入
- 协议与上下文：工具调用、SSE、截断，以及 32k 文档里埋针测是否被截

```bash
export RELAY_KEY=sk-...
npx relaycheck https://relay.example.com --model gpt-6-luna --lang zh
```

用官方 OpenAI API 实测（花了约 3.6 美元）：官方自测 7/7 判为一致；Luna 冒充其他模型 7/7 抓到（p ≤ 1.2e-5）。也有抓不到的情况：Sol 冒充 Astra 时 p=0.024，没达到判定线，README 里写明了这个盲区。

TypeScript、零依赖、MIT，key 只从环境变量读、不离开本机。目前有 5 个 GPT 参考指纹，Claude 指纹欢迎有官方 key 的朋友贡献。

https://github.com/YanYunCY/relaycheck
