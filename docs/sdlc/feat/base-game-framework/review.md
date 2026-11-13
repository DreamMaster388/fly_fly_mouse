# Review: 开始界面与生存计分流程（feat/base-game-framework）
对照 intent / spec / plan 与当前源码、独立验收套件（目录无 git，按文件核对）。

## 发现
阻塞：无。
重要：无。
建议：
- spec C5 要求 BGM 保持默认音量，config.js:19 定为 0.4，base-flow R3 也按 0.4 断言；请确认是产品决定还是改回默认。
- R8/R9 以直接置 hp=1 并触发 handlePlayerHit 进入结算，未覆盖连续真实接触的时序；R6 已覆盖单次接触。
- tests/base-flow.acceptance.test.js:124 用 elapsedMs<2000 代表计时从零开始，受启动耗时影响；容差足够但非精确零。
- 测试直接读取 scene.hud 等内部字段，重构 HUD 结构会使套件失效；作为验收可接受。
- tests/base-flow.acceptance.test.js:111 把 bgm 音量 0.4 写死；若采纳上条修改需同步。

## 测试
R1–R11 均有对应用例；本次把 R6 的销毁断言收紧为 active=false 且移出 manager 存活集合；未发现 skip 或删断言。用例从规格回推，未按实现步骤裁剪。

## 结论
通过：无阻塞或重要问题，可进入提交流程。

下一步：人工提交、开 PR、合并。
