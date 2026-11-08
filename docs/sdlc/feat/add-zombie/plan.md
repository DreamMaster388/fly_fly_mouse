# Plan: 镜头外刷新追踪僵尸（来自 spec.md）

## 改动文件
- resource/enemy/zombie-walk-spritesheet.png（新增，一次性生成）
- src/Zombie.js（新增）
- src/ZombieManager.js（新增）
- src/WorldScene.js
- tests/zombie.acceptance.test.js（新增）、tests/index.js

## 顺序
1. 生成贴图：sharp 按 `{page:i,pages:1}` 逐页解码 22 帧（各 166×144，抽样核实无残影），横向拼成 3652×144 PNG 存 resource/enemy/；生成脚本一次性执行，不入库。
2. Zombie.js：用 `zombie` 纹理建 sprite，scale=110/144；`physics.world.enable` 后 `setCircle(33, 50, 89)`（源像素，脚部圆），`setCollideWorldBounds(true)`、depth -1；配置只含 `{speed:150}`；update 每帧归一化朝向主角显示中心的向量并写 velocity×150；|vx|≥1 时 setFlipX(vx>0)，否则保持上次朝向。
3. ZombieManager.js：create 注册 `zombie-walk` 动画，0–21 帧按索引交替 90/180ms 逐帧 duration，repeat -1；建 Arcade group；构造时立即 spawn，再 `time.addEvent({delay:2000,loop:true})` 周期 spawn。
4. spawn：存活 ≥5 直接返回；最多 20 次在 x/y ∈ [64, 1936] 随机取点，落在相机 `worldView` 外扩 80px 的矩形内则重试；成功建 Zombie 入 group，失败跳过。
5. update：遍历存活僵尸调用 `zombie.update(player)`。
6. 接触：`physics.add.overlap(player.gameObject, group, …)`；僵尸 active 时先调空方法 `onReachPlayer(zombie)` 再 destroy；不注册僵尸间 collider。
7. WorldScene：preload 导入并 `load.spritesheet('zombie', url, {frameWidth:166,frameHeight:144})`；create 在 Player 后建 ZombieManager 并挂到 `this.zombieManager`；update 末尾更新管理器。
8. 新增验收套件并挂到 tests/index.js；跑 `npm run build`、`npm run dev` 实机确认刷新点、动画与镜像。

## 风险
- 相机 `worldView` 随主角变化，一次 spawn 内只取一次判定。
- 逐帧 duration 必须写进帧数据，仅设 frameRate 会丢掉 90/180 差异。
- overlap 可能同帧重复回调，销毁前判 active。
- 旧套件 acceptance.test.js 仍按早期场景断言，本次不作为回归基线。

## 证明方式
R1/R2 → tests/zombie.acceptance.test.js：纹理键、帧尺寸 166×144、22 帧、逐帧时长为 90/180 交替且循环。
R3/R4 → 采样刷新节奏约 2s、存活上限 5、生成点在地图内且距 worldView ≥80px。
R5/R7/R8 → 速度模长 150 且指向主角、左右移动时 flipX 正确、显示高 110、层级低于玩家与飞镖。
R6 → `zombieManager.config` 仅含 speed=150。
R9/R10 → 主角靠近后僵尸销毁且空回调被调用、body 圆形、无僵尸间 collider。
构建与观感 → npm run build 成功，dev 实机截图确认。

批准：lyd @ 2026-11-08。

变更记录：Phaser 4 的 Arcade Body 无 `id` 字段，旧 `tests/weapon-orbit.acceptance.test.js` R7 用 body.id 识别飞镖会误判任意 collider；改为按 body 引用识别（并递归 Set 形式的 group children），「飞镖无碰撞」断言不变。
变更记录：验收发现脚部圆超出显示框底部约 8px，`BODY_OFFSET_Y` 89→78；首刷前先 `centerOn` 主角，避免生成判定使用尚未跟随的相机视口。

下一步：/sdlc-build
