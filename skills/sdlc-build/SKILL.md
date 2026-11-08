---
name: sdlc-build
description: 按已批准的 plan.md 改代码并自检。
---

# Build

1. 读 `docs/sdlc/<分支>/plan.md`，无批准行 → 停。
2. 按顺序实现，只做计划内的事。
   偏离 → 在 plan.md 加一行「变更记录」；范围变大 → 先问。
3. 单测可以写，但只算自检。
4. 跑构建与测试，原始输出贴进对话。
5. 收尾一行：测试命令 + 结果，再写 `下一步：/sdlc-test`。
6. 只读 git，不 add/commit/push。

规则：测试失败修代码，不修测试。
