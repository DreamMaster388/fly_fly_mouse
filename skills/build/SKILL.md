---
name: build
description: 按票实现，测试先行，不碰 git。
disable-model-invocation: true
---

# 实现

前提：有已确认的 spec 或票（`docs/sdlc/<branch>/`）。没有就先 `/spec` 或 `/tickets`。

## 测试先行

- **先红后绿**：先写会失败的测试，再写刚好通过的最少代码。
- **一次一片**：一个 seam、一条测试、一份实现。
- **重构不属于这个循环**，留给 `/review`。
- 只在**事先约定的 seam**（公开测试边界）上测；没约定先问。
- 测外部行为，不测实现细节；期望值来自独立事实（字面量、手算、规格），不要用代码同款算法重算。

## 收尾

跑类型检查、单测，最后跑全量，贴原始输出。

不出 git 写命令（add/commit/push/branch/merge）。告诉用户提交什么。

做完提示 `/review`。
