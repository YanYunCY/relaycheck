用 Claude Code、Codex 走中转，怎么确认给你的真是你付费的那个模型？

我做了个开源小工具 relaycheck：一行命令给中转站「验货」，用 p 值说话，不靠感觉。

github.com/YanYunCY/relaycheck

=====

原理：24 道选择题式探针，temperature=1 多次采样，和官方 API 的参考指纹逐题做卡方检验，合成一个总 p 值。

顺带检查 token 有没有多算、工具调用和 SSE 是否正常、长上下文有没有被偷偷截断。

=====

用官方 OpenAI API 实测（花了约 3.6 美元）：
· 官方自测 7/7 判为一致
· Luna 冒充别的模型 7/7 抓到，p ≤ 1.2e-5
· Sol 冒充 Astra 没抓到（p=0.024），这个盲区写在 README 里

=====

npx relaycheck <中转地址> --model gpt-6-luna

TypeScript、零依赖、MIT，key 只从环境变量读，不出本机。
目前有 5 个 GPT 指纹，Claude 指纹还缺，有官方 key 的朋友欢迎来贡献 🙏