# Test Report: 开始界面与生存计分流程（feat/base-game-framework）
运行：npm test → 3 suites / 25 tests / 25 pass / 0 fail（45.3s）；npm run build → exit 0（621ms，index-Cc0wRGlL.js 1,382.78 kB / gzip 362.43 kB）；vite preview 产物冒烟 → canvas 1280×720、js/png/mp3 全部 200、点击进入世界后 HUD 正常，仅 favicon 404。

## 验收
R1 通过 —— base-flow R1（默认 start 场景、白底、唯一「开始游戏」按钮、点击进 world）
R2 通过 —— R2（chomp/2.75 均来自 resource/audio、200、audio cache 已解码）
R3 通过 —— R3（bgm 仅 1 个实例、loop=true、playing、volume 0.4）
R4 通过 —— R4/R5（初始 10/10、分数 0、计时 0:00；0:07/2:35/59:59 格式）
R5 通过 —— R4/R5（三块 HUD scrollFactor=0、depth 1000、左中右位置正确）
R6 通过 —— R6（接触后 hp=9、chomp 恰好 1 次、该僵尸 active=false 且移出存活集合）
R7 通过 —— R7（致死 +1 分并刷新 HUD；接触销毁后分数不变）
R8 通过 —— R8/R9（计时/物理/刷怪冻结，600ms 后 elapsedMs 不变）
R9 通过 —— R8/R9（「本局结束」「分数 7」「存活时间 …」「再来一局」且全部固定）
R10 通过 —— R10（直接重开并重置状态，bgm 仍是同一实例且继续播放）
R11 通过 —— R1（场景顺序 start→world，仅 start 活跃）

## 失败
无。

## 未覆盖
- BGM 只验证实例唯一与播放状态，无头浏览器静音，未做听感连续性断言。
- 结算由运行时状态注入进入，未走 10 次真实接触；单次接触链路由 R6 覆盖。
- spec C5 要求 BGM 默认音量，实现与用例锁定 0.4，已交评审确认。
- R9 只校验文本与结构，未做像素级布局比对。

## 结论
通过。

下一步：/sdlc-review
