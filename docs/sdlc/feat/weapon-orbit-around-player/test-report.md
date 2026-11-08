# Test Report: 角色周围八向飞镖环绕
运行：`node --test tests/weapon-orbit.acceptance.test.js`、`npm test`、`npm run build`（原始输出见对话）。

## 验收
R1 通过 —— R1 darts use the Vite-imported resource/weapon/武器-飞镖-透明.png and nothing else
R2 通过 —— R2 eight darts 45° apart, one at the top, r=90 about the player centre, 27px tall and undistorted
R3 通过 —— R3 orbit is 90°/s clockwise and unchanged at a 30 fps limit
R4 通过 —— R4 each dart spins 360°/s clockwise around its own centre, independent of the orbit
R5 通过 —— R5a formation follows the moving player rigidly, without easing or a frame of lag；R5b the formation stays rigid relative to the player once it stops
R6 通过 —— R6 flipping the player does not flip or re-orient the darts
R7 通过 —— R7 each dart has a circular, gravity-free, inert body sized from its 27px height
R8 通过 —— R8 darts render above the player
构建 通过 —— Build: npm run build succeeds and the production page loads the same dart PNG

## 失败
首轮 R5a 失败：移动中阵型固定落后角色 1 帧（300px/s 时 5px）。已回 /sdlc-build 修复（阵型改用本帧更新的 body 圆心加显示偏移定位），重跑 10/10 通过。
全量 `npm test`：28 条 23 通过 5 失败；失败均为旧套件（黑圆旧规格 R1/R4/R6/R7，及 R3 速度比 1.0301 的容差抖动，单独重跑通过），与本次功能无关，未修改旧测试。

## 未覆盖
R7“不造成伤害”无敌人与血量，仅以飞镖未注册碰撞器间接验证。
R1“唯一飞镖贴图”以 8 支共用单贴图键判定，未断言场景中不存在其他纹理。

## 结论
通过。

下一步：/sdlc-review
