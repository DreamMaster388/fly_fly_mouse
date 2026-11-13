# Plan: 逐档提升的游戏难度（来自 spec.md）

## 改动文件
- src/Difficulty.js（新增）
- src/config.js、src/Zombie.js、src/ZombieManager.js、src/WeaponOrbit.js、src/Hud.js、src/WorldScene.js
- tests/difficulty.acceptance.test.js（/sdlc-test 新增）、tests/index.js

## 顺序
1. 新建 Difficulty.js：导出 7 档数组（name、speedMean、maxAlive、maxHp、killScore、refillIntervalMs、color），数值照 spec，refillIntervalMs 取 1000/支速（250、285.7、333.3、400、500、666.7、1000）；颜色为青铜 #9C6B30、白银 #8C8F94、黄金 #B8860B、翡翠 #14915B、钻石 #2F7FD1、大师 #7B3FBF、王者 #D02B2B。提供按已用毫秒取档（每 30000ms 一档，索引封顶 6）与速度采样（Phaser.Math.RND.frac 驱动 Box–Muller，u1∈(0,1]，σ=均值×0.2，结果与 30 取大）。
2. config.js：删除 ZOMBIES.walker 的 speed、maxHp、maxAlive，删除 WEAPONS.dart 的 refillIntervalMs，删除 GAMEPLAY.killScore；其余字段不变。
3. Zombie.js：构造时接收 { speed, maxHp } 快照，hp 初值取快照，update 用快照速度；不再读静态速度与血量。
4. ZombieManager.js：构造接收难度实例并在首次 spawn 前就绪；每次 spawn 取当前档，存活数达到该档 maxAlive 即返回；生成时采样速度并传入 { speed, maxHp }；刷新间隔仍 2000ms，刷点、接触与死亡回调不变。
5. WeaponOrbit.js：构造时用 250ms 建补速定时器；新增按毫秒重建 loop 定时器的方法，重建时只换计时器、不动 8 个槽位。
6. Hud.js：新增档位文本，位置 (MARGIN, TOP + 34)、字号 20px，提供 setDifficulty(name, color) 设文本与颜色；时间、分数、血量不动。
7. WorldScene.js：create 建难度实例并立即取第一档；用 250ms 建 WeaponOrbit、把难度实例传给 ZombieManager、HUD 设青铜；update 在 elapsedMs 累加后取档，档位变化时更新 HUD 并重建补速定时器；击杀得分改取当前档 killScore。
8. 跑 npm test 与 npm run build；npm run dev 实机跨 30 秒边界，确认档名、速度波动与下限、场上上限、补速、击杀分。

## 风险
- elapsedMs 只在 gameOver 前累加，档位随之冻结；不要改用 update 的 time 参数计时。
- 升档只影响后续刷新；已刷出的僵尸持有快照，不得读实时档位。
- 重建补速定时器会清零当前进度，最多推迟一个新间隔补镖。
- 青铜档约半数采样触底 30，属预期，不要改 σ 或换成截断分布外的修正。
- 3.5 支/秒用 285.7ms，不要取整成 300ms。

## 证明方式
R1/R2 → tests/difficulty.acceptance.test.js：0/29999/30000/…/180000 取档与封顶，7 档数值照表。
R3/R4 → 生成僵尸的速度/血量等于当前档；万次采样均值约等于档均值、≥30、无上限；达到上限不刷新。
R5 → 各档重建后的补速间隔与补镖数量。
R6 → 不同档击杀的加分。
R7 → HUD 文本与颜色随档。
构建与观感 → npm test、npm run build 通过，dev 实机跨档确认。

批准：lyd @ 2026-11-08。

变更记录：/sdlc-test 新增 tests/difficulty.acceptance.test.js 并挂到 tests/index.js；实测升档后 350ms 内只补 1 枚并随后补满。
变更记录（2026-11-12）：固定配装调整后，难度档只保留 name、color、killScore；speedMean、maxAlive、maxHp、refillIntervalMs 与高斯采样全部移除。僵尸固定 30 速/10 血，武器固定 5 伤/开局 0/1 秒补 1/上限 8，场上数量改由全局人口 10 控制。difficulty 套件删除速度采样、档位上限、档位补速用例，由 loadout-population 套件覆盖新规则。

下一步：/sdlc-build
