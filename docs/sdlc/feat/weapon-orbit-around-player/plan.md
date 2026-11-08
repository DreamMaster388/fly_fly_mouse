# Plan: 角色周围八向飞镖环绕（来自 spec.md）

## 改动文件
- src/WeaponOrbit.js（新增）
- src/WorldScene.js

## 顺序
1. 新建 WeaponOrbit：常量 8 支、半径 90、镖高 27、公转 180°/s、自转 720°/s。
2. 每支飞镖用 `dart` 纹理创建，按镖高等比缩放，开启 Arcade body，圆形半径取显示高度的 0.35 倍，关闭重力，不注册碰撞。
3. 每帧按 update(time) 的累计秒数计算：角度 = -90° + i×45° + 秒数×180°，坐标 = 角色显示中心 + 半径上的三角函数；rotation = 秒数×720°。屏幕坐标系下角度增大即顺时针。
4. 飞镖逐帧 setPosition，不做缓动；飞镖为独立对象，不读取角色 flipX。
5. 飞镖深度设为角色深度 +1。
6. WorldScene：preload 用 Vite URL 导入加载飞镖贴图；create 在 Player 之后实例化 WeaponOrbit；update(time) 先 player.update() 再 weaponOrbit.update(time)。
7. `npm run build` 通过；`npm run dev` 实机查看公转/自转观感与跟随。

## 风险
- Arcade 圆形 body 的 offset 要按缩放后尺寸换算，否则 body 偏离镖身。
- 用 update(time) 而非自累加 delta，避免暂停或帧率变化造成转速漂移。
- 旧验收套件仍按黑圆断言，已过时，不能作为本次回归基线。
- 飞镖贴图约 2.5MB，构建产物会增大，本期无体积上限要求。

## 证明方式
R1/R2 → 新验收测试读取运行时状态：纹理键、飞镖数量、显示尺寸、初始角度、轨道半径。
R3/R4/R5 → 按时间采样位置与 rotation，断言 180°/s 公转、720°/s 自转、角色移动/停止后阵型刚性跟随。
R6 → 角色 flipX 前后飞镖位置与 rotation 不变。
R7/R8 → 每支飞镖有圆形 body 且无碰撞注册；飞镖 depth 高于角色。
构建与观感 → `npm run build` 成功，`npm run dev` 手动确认。

批准：lyd @ 2026-11-08。

变更记录：构建时发现角色贴图已被移动到 `resource/character/`（工作区未提交），WorldScene 的角色贴图导入同步改为 `../resource/character/飞飞鼠完整-透明.png`，仅为解除既有构建失败。
变更记录：按用户要求转速整体减半，公转 90°/s、自转 360°/s，同步更新 intent 与 spec。

下一步：/sdlc-build
