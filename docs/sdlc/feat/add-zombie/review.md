# Review: 镜头外刷新追踪僵尸
对照 intent / spec / plan 与当前 diff（含未跟踪的 Zombie.js、ZombieManager.js 与验收套件）。

## 发现
阻塞：无。
重要：无。
建议：
- src/Zombie.js:19 的 setCollideWorldBounds 会被 ZombieManager.js:58 group.add 的默认值覆盖为 false（plan 步骤 2 未生效，当前无可见影响）。
- tests/zombie.acceptance.test.js:776-789 R5 同时接受瞄准 body 中心（比显示中心低约 30px）的候选，未严格锁定“显示中心”。
- tests/zombie.acceptance.test.js:702-703 R4 在物理暂停、玩家静止下采样，未覆盖镜头移动时的生成点。
- resource/Plants-vs-zombies/ 含嵌套 .git，git add resource/ 会以 embedded repo 入库，与 spec C4 不符；提交时只加具体文件或补 ignore。

## 测试
R1–R10 均有对应用例；R3/R4/R7/R9 的修复保留 spec 边界，未发现为通过而放宽。
R9 探针实测只捕获 onReachPlayer，能区分专用接触回调。

## 结论
通过：无阻塞或重要问题，可进入提交流程；建议项可随后处理。

下一步：人工提交、开 PR、合并。
