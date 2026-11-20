---
name: tickets
description: 把 spec 拆成可独立验收的票，写到 docs/sdlc/<branch>/issues/。
disable-model-invocation: true
---

# 拆票

前提：`docs/sdlc/<branch>/spec.md` 存在。

## 规则

每张票是**竖切**的曳光弹：

- 切穿所有层（schema、API、UI、测试），窄但完整；
- 做完能独立演示或验收；
- 体量放得进一个全新上下文；
- 声明 `阻塞于`：必须先完成的票；
- 预重构放最前。

**宽重构**（一处机械改动炸穿全库）不硬拆竖切，按 expand → migrate → contract 排序，迁移按影响范围分批。

## 先给用户看

编号列出每张票：标题、交付什么、阻塞于。问三件事：粒度、依赖、要不要合并拆分。确认后再写。

## 写什么

路径 `docs/sdlc/<branch>/issues/NN-<slug>.md`，从 01 按依赖顺序编号，一票一文件：

# <NN>: <标题>

**要构建什么：** 用户视角的端到端行为。

**阻塞于：** <票号或标题>，没有写「无（可立即开始）」。

**状态：** ready-for-agent

- [ ] 验收标准 1
- [ ] 验收标准 2

不写文件路径和代码片段。
