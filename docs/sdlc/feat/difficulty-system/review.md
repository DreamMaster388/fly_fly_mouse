# Review: 逐档提升的游戏难度（feat/difficulty-system）
对照 intent / spec / plan 与当前源码、独立验收套件（目录无 git，按文件核对）。

## 发现
阻塞：无。
重要：无。
建议：
- src/WeaponOrbit.js:32-38 升档重建补速定时器会清零当前进度，补镖最多晚一个新间隔；plan 已声明，若要求严格“立即”需按剩余时间折算。
- tests/difficulty.acceptance.test.js:160-163 通过替换 rollZombieSpeed 固定值验证刷出快照，未验证运行中真实采样；另一条 2 万次采样用例已覆盖分布。
- tests/difficulty.acceptance.test.js:242-254 只验证白银档 350ms 内补 1 枚，未逐档实测补满；间隔与 timer.delay 已全表比对。
- src/WorldScene.js:96 档位只在 update 后判定，后台长帧跨多档时 HUD 与参数直接跳到最终档；行为一致，但中间档不会留下痕迹。
- 颜色在 src/Difficulty.js 与测试 EXPECTED 中各写一份，属独立验收的预期复制，可接受。

## 测试
R1–R7 均有对应用例；R3/R4 分离了“刷出快照”与“旧僵尸保持”，R5 同时读 interval 与 timer.delay，R6 覆盖 7 档击杀分，R7 覆盖文本/颜色/位置/固定。未发现 skip、删断言或为通过而放宽。

## 结论
通过：无阻塞或重要问题，可进入提交流程。

## 变更（2026-11-12）
固定配装调整后，档位不再承载僵尸速度/血量、数量上限与飞镖补速，相关建议自动失效；难度模块现仅负责档名、颜色、击杀分与 HUD 切换。新规则（普通僵尸固定 30 速/10 血、人口 10、旋转飞镖 5 伤/0 初始/1 秒补 1/上限 8）由 loadout-population 套件独立验收，未发现阻塞问题。

下一步：人工提交、开 PR、合并。
