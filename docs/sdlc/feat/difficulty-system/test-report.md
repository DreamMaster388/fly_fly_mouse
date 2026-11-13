# Test Report: 逐档提升的游戏难度（feat/difficulty-system）
运行：npm test → 25/25 通过（45.3s），本套 7/7（11.1s）；npm run build → exit 0；vite preview 产物冒烟 HUD 显示「0:03 / 分数 0 / 血量 10/10 / 难度 青铜」。

## 验收
R1 通过 —— R1/R2（7 档；-1/0/29999/30000/…/180000/999999 边界正确，180s 后锁王者）
R2 通过 —— R1/R2（7 档 name/color/speedMean/maxAlive/maxHp/killScore/refillIntervalMs 全表比对）
R3 通过 —— R3（2 万次采样：青铜 min=30、mean∈[30,40)；王者 mean≈210、max>210、min≥30、均有限）
R3 通过 —— R3/R4（45s 生成 speed=123.5、hp=5；升到王者后旧僵尸仍保持 123.5/5）
R4 通过 —— R4（青铜场上最多 4 只；升白银后可补到 5 只；刷新仍每 2s 尝试）
R5 通过 —— R5（7 档 refillIntervalMs 与定时器 delay 逐一匹配；白银档 350ms 内只补 1 枚，随后补满）
R6 通过 —— R6（7 档击杀分 1–7，分数与 HUD 文本随档变化）
R7 通过 —— R7（「难度 X」、颜色随档、位置 (24,54)、20px、固定；时间/分数/血量格式不变）

## 失败
无。

## 未覆盖
- R5 未逐档真实等待补满，只验证间隔、定时器与白银档补镖行为，避免 7 档等待耗时。
- R3 快照用例用固定 rollZombieSpeed 值验证写入；实际分布由另一条 2 万次采样覆盖。
- 档位颜色只做字符串断言，未做像素取色。
- 未覆盖浏览器后台节流导致一次 update 跨多档时只应用最终档的时序。

## 结论
通过。

## 变更（2026-11-12）
固定配装调整后，原 R3 速度采样、R4 档位数量上限、R5 档位补速用例随规则删除；当前 difficulty 套件保留 3 条：档位边界与字段、击杀分、HUD。全量 npm test → 26/26 通过（49.1s），新增 loadout-population 套件 5/5 通过；npm run build → exit 0，vite preview 冒烟进入世界后 HUD 正常、飞镖按 1 秒/枚出现。

下一步：/sdlc-review
