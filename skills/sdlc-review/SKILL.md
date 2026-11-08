---
name: sdlc-review
description: 独立 subagent 评审变更并出 review.md。
---

# Review

1. 五份齐全才做：`docs/sdlc/<分支>/` 下 intent、spec、plan、test-report，加当前 diff；缺一 → 停。
2. 用 `subagent` 起新上下文，只读，给这几条：
   - 读四份工件 + `git diff`。
   - 三轮：bug 与逻辑、安全、对照 spec/plan。
   - 分级：阻塞 / 重要 / 建议；重要只给会坏行为、泄数据、违策略的；
     建议最多 5 条，其余只报数量。
   - 生成文件、CI 已强制的不报。
   - 查 R1…Rn 是否都有用例、测试是否被削弱。
   - 不改代码与测试。
3. 照模板写 review.md，≤ 30 行。
4. 结论三选一：通过 / 有条件通过 / 打回。

## 模板（照这个长度）

```markdown
# Review: 理赔进度自助查询
对照 intent / spec / plan 与当前 diff。

## 发现
阻塞：无。
重要：status.py:42 未处理上游超时。
建议：面板可复用现有错误组件。

## 测试
R1–R3 均有对应用例；测试文件未被改动。

## 结论
有条件通过：修掉超时分支即可合并。

下一步：人工提交、开 PR、合并。
```
