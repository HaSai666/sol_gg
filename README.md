# 脉冲防线

基于 Three.js 的实时自动防御 Roguelite。玩家把核心脉冲送入分流器、电容器和炮塔，在持续敌潮中实时改造网络。

在线游玩：<https://hasai666.github.io/sol_gg/>

## 本地运行

```powershell
npm install
npm run dev
```

默认地址：<http://127.0.0.1:4173>

## 操作

核心会持续产生能量，导线负责输送，接在线路末端的炮塔收到能量后自动攻击。首次开始游戏会进入冻结敌潮的分步教学，完成第一次开火后才正式计时。

- 鼠标拖拽：铺设导线
- 鼠标左键：放置或操作装置
- 鼠标右键：拆除装置
- 数字键 1-8：切换建造工具
- M：迁移选中的装置
- Delete：拆除选中的装置
- Space：暂停或继续

## 验证

```powershell
npm test
npm run build
```

完整设计规格位于 [docs/specs/2026-08-21-pulse-defense-game-design.html](docs/specs/2026-08-21-pulse-defense-game-design.html)。
