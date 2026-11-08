---
name: sdlc-test
description: 独立 subagent 写验收测试并出 test-report.md。
---

# Test

1. 读 `docs/sdlc/<分支>/plan.md`（须已批准）与代码现状。
2. 用 `subagent` 起新上下文，给这几条：
   - 读 `docs/sdlc/<分支>/spec.md`，按 R 列验收项，再写测试。
   - spec 里的验证描述只当线索，边界自己补。
   - 先不看 diff；写完再核对代码。
   - 测试放现有测试目录，只改测试文件。
   - 跑全量测试与构建，贴原始输出。
   - 失败只报不修；规格有歧义就停。
3. 主会话照模板写 test-report.md，≤ 30 行。
4. 结论三选一：通过 / 有条件通过 / 打回。
5. 打回 → 回 /sdlc-build 修，重跑，最多 3 轮；超限或规格冲突 → 停，升级给人。

## 模板（照这个长度）

```markdown
# Test Report: 理赔进度自助查询
运行：make test、make itest（输出见下）。

## 验收
R1 通过 —— test_status.py::test_four_states
R2 通过 —— test_status.py::test_no_pii
R3 通过 —— test_status.py::test_upstream_timeout

## 失败
无。

## 未覆盖
C1 授权路径需预发人工验证。

## 结论
通过。

下一步：/sdlc-review
```
