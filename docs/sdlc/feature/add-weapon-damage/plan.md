# Plan: 武器伤害与僵尸死亡（来自 spec.md）

## 改动文件
- resource/enemy/zombie-die-spritesheet.png（新增）、resource/audio/zombie-hit.mp3、zombie-die.mp3（复制 splat1/splat3）、.gitignore（放行 mp3）
- src/config.js、src/Combat.js（新增）
- src/WeaponOrbit.js、src/Zombie.js、src/ZombieManager.js、src/WorldScene.js
- tests/weapon-damage.acceptance.test.js（/sdlc-test 新增）、tests/index.js
- tests/weapon-orbit.acceptance.test.js、tests/zombie.acceptance.test.js（保留文件，停止执行）

## 顺序
1. 生成死亡贴图：sharp 读 ZombieDie.gif（10 页、166×144、页高 144），逐页横向拼成 1660×144 PNG 存 resource/enemy/；复制 splat1/splat3 为 resource/audio/zombie-hit.mp3、zombie-die.mp3；.gitignore 增加 `!resource/**/*.mp3`；拆帧脚本一次性执行，不入库。
2. 新建 config.js：WEAPONS.dart（damage 1、8 槽、补充 1000ms、镖高 27、半径 90、公转 90°/s、自转 360°/s、body 半径比 0.35）与 ZOMBIES.walker（maxHp 10、speed 150、上限 5、刷新 2000ms、行走/死亡 sheet 与帧时序、显示高 110、body 半径 33/偏移 50,78、刷新内缩 64、镜头余量 80、尝试 20、翻转阈值 1、闪烁 120ms、音频 URL）；键为 dart/zombie/zombie-die 与 zombie-hit/zombie-die。
3. WeaponOrbit 槽位化：8 槽各存飞镖或空，初始满槽；update 用全局时间摆位与自转；提供活动飞镖列表与 consume（销毁并置空）；每 1000ms 从游标后首个空槽补 1 枚，游标前移，满槽跳过。
4. Zombie：读取配置；takeDamage 在 dead 时忽略，扣血后 ≤0 走 die，否则未闪烁则 setTint(0xff0000) 并在 120ms 后 clearTint（不重置），存活时 scene.sound.play('zombie-hit')；die 停速、body.enable=false、clearTint、play('zombie-die') 且只播死亡音、动画完成销毁并通知管理器；死亡后 update 返回。
5. ZombieManager：按配置注册行走（repeat -1）与死亡（repeat 0）动画；存活集合只含未死亡僵尸，死亡当帧移出集合与 physics group；暴露存活迭代；接触保持直接 destroy + 空回调且不播音效。
6. 新建 Combat：每帧逐飞镖用圆形 body 圆心距 ≤ 半径和收集存活僵尸，非空则各 takeDamage(damage) 后 consume；同帧多飞镖独立结算。
7. WorldScene：preload 遍历配置加载贴图与音频；create 按类型 id 建 WeaponOrbit/ZombieManager/Combat；update 顺序 player→weaponOrbit→zombieManager→combat。
8. tests/index.js 移除两个冲突套件；/sdlc-test 新增 weapon-damage 套件后加入 require。
9. npm run build 通过；npm run dev 先点击 canvas 解锁音频，再确认命中音、死亡音、染红、死亡动画与补充节奏。

## 风险
- 死亡动画精灵同为 166×144，统计必须按死亡标记/body.enable 区分存活，不能只看纹理帧。
- 补充的新飞镖必须用同一全局时间计算槽位角度，否则会跳变。
- 补充计时基于 scene.time，物理暂停时仍会补，验收利用这一点做确定性测试。
- 死亡动画期间不占刷新名额但仍是场景对象，密集击杀时精灵可短时多于 5。
- 浏览器音频需首次交互解锁；多只同时受击会叠加音量（默认 1.0），必要时后续调低。
- 染红用 setTint；旧套件退役后刷新、追踪、接触的回归由新套件覆盖，不得漏测。

## 证明方式
R1 → 类型表、贴图与音频 200 响应、模块使用同一类型 id。
R2/R3/R6/R7 → 单镖同帧群伤各扣 1 后销毁、第二枚可叠加、10 次伤害死亡；染红约 120ms、连续受伤不重启、致死帧不闪。
R4/R5 → 消耗后空槽与数量下降；约每 1s 补 1 枚沿槽轮转，满 8 停止。
R8/R9/R11 → 死亡帧停速、body 关闭、名额释放；10 帧/2s、朝向保持、播完销毁。
R10/R14 → PNG 1660×144、无 GIF、无新依赖；受伤播 zombie-hit、致死只播 zombie-die、多只独立重叠、接触静音。
R12/R13 → 接触仍直接销毁不扣血；主角/相机/刷新/追踪不变；npm run build 通过，dev 实机确认。

批准：lyd @ 2026-11-08。

下一步：/sdlc-build
