# Plan: 开始界面与生存计分流程（来自 spec.md）

## 改动文件
- resource/audio/chomp.mp3、2.75.mp3（从 `E:\lyd\code\pvz\663\audio\` 复制，新增）
- src/StartScene.js、src/Hud.js、src/ResultOverlay.js（新增）
- src/config.js、src/ZombieManager.js、src/WorldScene.js、src/main.js
- tests/base-flow.acceptance.test.js（新增）、tests/index.js

## 顺序
1. 复制 chomp.mp3、2.75.mp3 到 resource/audio/；.gitignore 白名单已覆盖 `resource/**/*.mp3`。
2. config.js：GAMEPLAY 常量 `{initialHp:10, contactDamage:1, killScore:1}`；AUDIO 常量导入两个 mp3 的 Vite URL，键为 `chomp`、`bgm`。
3. StartScene：preload 加载两段音频；create 设白底，仅放中央「开始游戏」文本按钮；pointerdown 内若无 bgm 实例则 `sound.add('bgm',{loop:true}).play()`，再 `scene.start('world')`；BGM 只此一处启动。
4. main.js：`scene: [StartScene, WorldScene]`，开始场景为默认入口。
5. Hud：顶部固定三块文本——左计时 mm:ss、中「分数 n」、右「血量 n/10」，均 `setScrollFactor(0)`、depth 1000；暴露 setTime/setScore/setHp。
6. WorldScene.create：初始化 hp=10、score=0、elapsedMs=0、gameOver=false；建 Hud；给 ZombieManager 构造函数传接触回调与击杀回调；相机、玩家、飞镖逻辑不变。
7. ZombieManager：接触时先调 onReachPlayer（WorldScene 扣 1 血并 `sound.play('chomp')`）再销毁；die() 已有 onDeath 链路，WorldScene 击杀回调在此加分并刷新 HUD。
8. WorldScene.update：gameOver 时直接 return；否则正常更新各模块，`elapsedMs += delta` 并刷新计时。
9. 扣血后 hp<=0：置 gameOver、`physics.pause()`、移除刷怪定时器、创建 ResultOverlay（遮罩 + 居中面板，显示分数、存活时间、「再来一局」）。
10. ResultOverlay 的按钮回调 `scene.restart()`：create 重建状态、HUD、结算层与敌人，BGM 不重启，不回开始场景。
11. 新增验收套件并挂到 tests/index.js；跑 `npm run build` 与 dev 实机走通开始→受伤→击杀→归零→重开。

## 风险
- 结算后 Arcade overlap 仍会回调：gameOver 时暂停物理，并在接触回调入口再判 gameOver。
- BGM 叠加：只 add 一次，启动前检查已有 bgm 实例是否在播放；WorldScene 不调用 play。
- 场景 restart 会重跑 preload/create：状态、HUD、结算层全部在 create 内重建，旧定时器随场景 shutdown 清理。
- 碰触销毁与飞镖击杀共用回调链：计分只挂在 die() 的 onDeath 上，避免碰触误加分。
- 浏览器音频解锁依赖首次点击：BGM 启动必须放在按钮 pointerdown 内。

## 证明方式
R1/R11 → 开始场景为默认入口、只有一个按钮、点击后进入 world。
R2/R3 → 两个 mp3 位于 resource/audio；bgm loop 开启，切场景与重开仍是同一实例。
R4/R5 → 初始血量 10/10、分数 0、计时 0:00；HUD 固定在顶部不随相机移动。
R6 → 接触一次扣 1 血、播 chomp、僵尸销毁；连续两次扣 2。
R7 → 飞镖致死 +1 分，碰触销毁不计分。
R8/R9 → 归零后计时停止、刷怪与战斗停止，遮罩显示最终分数与存活时间。
R10 → 再来一局直接回 world，血量/分数/计时/敌人全部重置，BGM 继续。

批准：lyd @ 2026-11-08。

变更记录：验收套件交由 /sdlc-test 独立编写，本次 build 不新增 tests/base-flow.acceptance.test.js，tests/index.js 保持不变。
变更记录：实测发现 Container 的 scrollFactor 不传递给子元素，结算面板子元素需各自 setScrollFactor(0)，否则「再来一局」命中测试偏移、无法点击。

下一步：/sdlc-build
