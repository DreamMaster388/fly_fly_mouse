# Plan: 2D 游戏基础——黑圆在大地图上按键盘移动（来自 spec.md）

## 改动文件
- `.gitignore`：白名单补 `!index.html`、`!src/`、`!src/**/*.js`（不写 `!src/` 会因目录被拒而进不去）
- `package.json`：加 `dev`/`build`/`preview` 脚本；`sharp` 依赖保留不动，浏览器产物不含它
- `index.html`（新）、`src/main.js`（新）、`src/WorldScene.js`（新）、`src/Player.js`（新）
- `vite.config.js`（新，仅需要覆盖输出目录时）
- `docs/sdlc/feat/game-engine/spec.md`：R8 的"引擎自带 FPS 面板"改为浏览器帧率工具

## 顺序
1. 改 `.gitignore` 与 `package.json` 脚本，`npm i` 后确认 phaser 4.2.1、vite 8.x 就位。
2. `Player.js`（R7 边界）：内部建 `physics.add.circle(0,0,20,0x000000)` 得黑色圆，键盘在构造里一次注册（cursor+WASD），更新时方向向量归一化后乘速度再乘 `delta/1000`，只写 body 速度不改其它模块。
3. `WorldScene.js`：白底 + `physics.world.setBounds(0,0,2000,2000)` + 玩家 `setCollideWorldBounds(true)` + `camera.startFollow(玩家)`；`Player` 是唯一可替换点。
4. `main.js`：`{ width:1280, height:720, scale:{mode:Phaser.Scale.FIT, autoCenter:Phaser.Scale.CENTER_BOTH}, physics:{default:'arcade'}, scene:WorldScene }`。
5. `npm run dev`，按下列验收手动过一遍并记结果。
6. `npm run build`，检查 `dist/` 实产物；再 `npm run preview -- --port 4174` 拉根路径资源确认 200。
7. Qoder Sites 上线：新站需先注册 `.qoder.site` 设计条目，`webDirectory: dist`、`spa: false`，prepare 后 publish。
8. 提交，spec.md 的 R8 修订一并带上。

## 验收对照
R2/R5 → 非 16:9 窗口有画布外黑边、世界可见范围不变、推到边缘不露地图外空区
R3 → 八方向手感一致、斜向不比直线快、松手立即停
R4/R6 → DevTools Console 读 `body.worldX/worldY` 四个极值 ∈ [20,1980]；Network 无 resource/ 请求且 Console 无报错
R7 → 仅改 `Player.js` 内部即可换成贴图
R8 → Chrome DevTools Rendering→Frame Rate 读数稳定；更新逻辑无每帧 new
R9 → 无痕窗口打开公网链接可玩

## 风险
- 4.2.1 已验证：`FPSConfig` 无 `debug`（v3 的 FPS 面板没了），`stopVelocityOnCollide`/`setMoveable` 不存在；Shape Circle 没有 collide 方法，碰撞体必须是 `physics.add.circle`。按 Phaser 3 教程写会直接报错。
- 打包限制：单文件 50 MiB、产物 50 MiB；`phaser.esm.js` 未压缩 8.4 MB，需以 `dist/` 实测为准。
- 本期不做触屏，手机打开链接玩不了是已确认结果，不是缺陷。

批准：lyd @ 2026-11-08。

下一步：/sdlc-build
