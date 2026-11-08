# Review: 2D 游戏基础（feat/game-engine）
对照 intent / spec / plan 与当前 diff（含未跟踪文件）。

## 发现
阻塞：
- `.gitignore:2` 的 `*` 吞掉了 `vite.config.mjs`，白名单未放行；新 clone/CI 会丢失 `base: './'`（vite.config.mjs:4），R9 子路径回到 404，而根路径测试仍绿会掩盖问题。
重要：
- 公网 `.飞飞鼠.qoder.site` 仍指向修复前的 `index-CIvKKTKj.js`，当前产物为 `index-oJp2KRq0.js`；不重新发布，线上拿不到 R11/R9 修复。
- tests/acceptance.test.js:20 硬编码 Edge 绝对路径，且无浏览器自举，换机器或 CI 无法复现验收。
建议：
- tests:22-24 三个固定端口改动态端口，避免占用即整套失败。
- tests:217/1346 的 off-canvas 点击只记录 `fellBackToCanvas` 不断言，画布铺满时 R11 被静默弱化。
- tests:1051/1063 强制 Player 含 `0x000000`，与 R7 换 PNG 目标冲突。
- package.json:7 `sharp` 仅测试用却列 dependencies；缺 `private: true`。
- plan.md:7 仍写 `vite.config.js`（实为 `.mjs`），也未记 gitignore 放行步骤。
（另有 2 条低优先：favicon 404 靠过滤、index.html 的 `/src/main.js` 仅 dev 有效。）

## 测试
R1–R6、R8–R11 均有可执行断言；R7 仅结构推断，R8“每帧不新建”用显示列表数量代理，R9 公网未自动覆盖。无 skip 或删断言；plan 变更记录与实现一致。

## 结论
打回：先放行 `vite.config.mjs` 并重新构建/复测，再重新发布线上版本。

下一步：回 /sdlc-build 修复，重跑 /sdlc-test，再审查。
