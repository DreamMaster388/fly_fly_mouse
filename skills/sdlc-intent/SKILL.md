---
name: sdlc-intent
description: 把新需求访谈成 docs/sdlc/<分支>/intent.md。
---

# Intent

1. 读分支 `git rev-parse --abbrev-ref HEAD`；main/master 或 detached → 停，请用户先建分支。
2. 目录 `docs/sdlc/<分支>/`；已有 intent.md → 问是否续写，不覆盖。
3. 访谈，一次问一两件：今天做不到什么、谁受影响、什么算好、约束、还没定的事。不替用户编答案。
4. 照模板写，≤ 40 行；只写当前状态，不写过程与历史。
5. 用户确认后标「已批准」，末行 `批准：<人> @ <日期>`（人取 `git config user.name`）。
6. 只读 git，不 add/commit/branch。

## 模板（照这个长度）

```markdown
# Intent: 理赔进度自助查询
作者：J. Ortiz（理赔运营）。状态：草稿。

## 问题
客户打电话问进度，坐席约三分之一的通话时间耗在这上面。

## 预期结果
客户在门户里自助看到进度、下一步和预计日期。

## 影响面
理赔坐席、门户团队、claims-core API。

## 约束
不新增 PII；只复用现有认证；校验必须在容器内做。

## 未定
公估人是否也需要访问。

下一步：/sdlc-spec
```
