---
name: sdlc-plan
description: 从 spec.md 产出可执行的 plan.md，等人批准。
---

# Plan

1. 读 `docs/sdlc/<分支>/spec.md`（须已批准）。
2. 照模板写，≤ 40 行；标准：没看过对话的人能据此完成。
3. 批准行留「批准：待定。」，用户明确同意后才改；未批准不写代码。
4. 交付前删一遍：解释性的话删掉，只留能照做的。

## 模板（照这个长度）

```markdown
# Plan: 理赔进度自助查询（来自 spec.md）

## 改动文件
- portal/src/claims/StatusPanel.tsx（新增）
- claims-api/routes/status.py
- claims-api/tests/test_status.py

## 顺序
1. 只读接口，走现有认证。
2. 面板接接口。
3. 挂到门户导航。

## 风险
claims-core 限流 50 rps，面板必须缓存。

## 证明方式
R1 → tests/test_status.py::test_four_states
R2 → tests/test_status.py::test_no_pii

批准：待定。

下一步：/sdlc-build
```
