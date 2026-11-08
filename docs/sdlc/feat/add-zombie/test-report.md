# Test Report: 镜头外刷新追踪僵尸
运行：node --test tests/zombie.acceptance.test.js → 11/11 通过；npm test → 39 tests / pass 34 / fail 5（均为过期基线）；npm run build → exit 0。

## 验收
R1 通过 —— zombie.acceptance.test.js R1（22 帧 166×144，运行无 GIF 请求）
R2 通过 —— R2（90/180ms 交替，整轮 2970ms，循环播放）
R3 通过 —— R3（create 完成时已有 1 只，此后间隔 2s，上限 5、不排队）
R4 通过 —— R4（全部生成点在地图内且距相机 ≥80px）
R5 通过 —— R5（恒定 150px/s，方向误差 ≤0.97°，主角实测 303.3px/s）
R6 通过 —— R6（config 仅 {speed:150}，实例无差异化）
R7 通过 —— R7（vx>0 翻转、vx<0 默认、|vx|<1 保持，8/8 采样一致）
R8 通过 —— R8（高 110px、等比、层级低于主角与飞镖）
R9 通过 —— R9（45.93px 处销毁，空回调被调用，玩家无位移、无伤）
R10 通过 —— R10（圆 body 落在显示框内、无僵尸间 collider）

## 失败
旧 acceptance.test.js 5 项（R1/R4/R6/R7/R8）为过期基线，plan 已声明不作回归基线。

## 未覆盖
无。

## 结论
通过。

下一步：/sdlc-review
