import type {
  DeviceKind,
  EnemyKind,
  Frequency,
  GridCoord,
  RewardDefinition,
  RewardId,
  WorldPoint
} from "./types";

export const GRID_WIDTH = 12;
export const GRID_HEIGHT = 10;
export const CELL_SIZE = 1.18;
export const CORE_CELL: GridCoord = { x: 5, y: 5 };
export const WAVE_DURATION = 75;
export const BOSS_DURATION_TARGET = 100;

export const TUTORIAL_PLACEMENTS: ReadonlyArray<{
  tool: "wire" | "needle";
  cell: GridCoord;
  origin: GridCoord;
}> = [
  { tool: "wire", cell: { x: 4, y: 5 }, origin: CORE_CELL },
  { tool: "wire", cell: { x: 3, y: 5 }, origin: { x: 4, y: 5 } },
  { tool: "needle", cell: { x: 3, y: 6 }, origin: { x: 3, y: 5 } }
];

export const DEVICE_COST: Record<DeviceKind, number> = {
  wire: 2,
  splitter: 8,
  capacitor: 10,
  dyer: 10,
  switch: 9,
  needle: 24,
  mortar: 34,
  prism: 30
};

export const DEVICE_LABEL: Record<DeviceKind, string> = {
  wire: "导线",
  splitter: "分流器",
  capacitor: "电容器",
  dyer: "染色器",
  switch: "切换器",
  needle: "针刺塔",
  mortar: "迫击塔",
  prism: "棱镜塔"
};

export const FREQUENCY_LABEL: Record<Frequency, string> = {
  neutral: "中性",
  red: "红色燃烧",
  blue: "蓝色减速",
  yellow: "黄色连锁"
};

export const MAX_DEGREE: Record<DeviceKind, number> = {
  wire: 2,
  splitter: 3,
  capacitor: 2,
  dyer: 2,
  switch: 3,
  needle: 1,
  mortar: 1,
  prism: 1
};

export interface LaneDefinition {
  name: string;
  points: GridCoord[];
}

export const LANES: LaneDefinition[] = [
  {
    name: "西侧通道",
    points: [
      { x: -1, y: 2 },
      { x: 3, y: 2 },
      { x: 3, y: 5 },
      CORE_CELL
    ]
  },
  {
    name: "北侧通道",
    points: [
      { x: 8, y: -1 },
      { x: 8, y: 3 },
      { x: 5, y: 3 },
      CORE_CELL
    ]
  },
  {
    name: "东侧通道",
    points: [
      { x: 12, y: 7 },
      { x: 9, y: 7 },
      { x: 9, y: 5 },
      CORE_CELL
    ]
  }
];

export const ENEMY_STATS: Record<
  EnemyKind,
  { hp: number; speed: number; coreDamage: number; reward: number }
> = {
  swarm: { hp: 42, speed: 0.075, coreDamage: 6, reward: 0.75 },
  runner: { hp: 64, speed: 0.118, coreDamage: 9, reward: 1 },
  armored: { hp: 220, speed: 0.048, coreDamage: 18, reward: 2.4 },
  disruptor: { hp: 112, speed: 0.063, coreDamage: 12, reward: 1.8 },
  boss: { hp: 2500, speed: 0.018, coreDamage: 100, reward: 35 }
};

export const REWARDS: RewardDefinition[] = [
  {
    id: "unlock-dyer",
    name: "频率注入",
    description: "解锁染色器，让脉冲附带燃烧、减速或连锁效果。",
    family: "unlock"
  },
  {
    id: "unlock-switch",
    name: "战术切换",
    description: "解锁切换器，在两条火力支路之间保留完整能量。",
    family: "unlock"
  },
  {
    id: "unlock-mortar",
    name: "重型投送",
    description: "解锁迫击塔。它只消耗高能脉冲，并造成范围伤害。",
    family: "unlock"
  },
  {
    id: "unlock-prism",
    name: "棱镜聚焦",
    description: "解锁棱镜塔，降低直接伤害并强化频率效果。",
    family: "unlock"
  },
  {
    id: "alternating-split",
    name: "交替分流",
    description: "分流器不切分能量，改为把完整脉冲轮流送向两侧。",
    family: "network",
    requires: ["splitter"],
    excludes: ["biased-split"]
  },
  {
    id: "biased-split",
    name: "偏置分流",
    description: "分流器改用 70/30 配比，点击装置可交换主支路。",
    family: "network",
    requires: ["splitter"],
    excludes: ["alternating-split"]
  },
  {
    id: "quick-capacitor",
    name: "快速电容",
    description: "电容器收集两份能量即释放，爆发频率更高。",
    family: "network",
    requires: ["capacitor"],
    excludes: ["deep-capacitor"]
  },
  {
    id: "deep-capacitor",
    name: "深层电容",
    description: "电容器改为收集五份能量，形成更大的单次脉冲。",
    family: "network",
    requires: ["capacitor"],
    excludes: ["quick-capacitor"]
  },
  {
    id: "dual-dye",
    name: "双色振荡",
    description: "染色器在当前颜色与下一种颜色之间交替输出。",
    family: "frequency",
    requires: ["dyer"]
  },
  {
    id: "sync-switch",
    name: "同步切换",
    description: "点击任意切换器时，所有切换器同步改变出口。",
    family: "network",
    requires: ["switch"]
  },
  {
    id: "ember-stack",
    name: "余烬叠加",
    description: "红色燃烧不再只刷新时间，最多累积三层伤害。",
    family: "frequency",
    requires: ["dyer"]
  },
  {
    id: "cryo-fracture",
    name: "低温脆化",
    description: "被蓝色减速的敌人受到高能攻击时承受额外伤害。",
    family: "frequency",
    requires: ["dyer", "capacitor"]
  },
  {
    id: "seeking-arc",
    name: "寻弧",
    description: "黄色连锁增加一次跳跃，并优先寻找未命中的目标。",
    family: "frequency",
    requires: ["dyer"]
  },
  {
    id: "needle-volley",
    name: "针刺齐射",
    description: "针刺塔收到高能脉冲时分裂成三枚总伤害相同的射击。",
    family: "tower",
    requires: ["needle"]
  },
  {
    id: "wide-fuse",
    name: "广域引信",
    description: "迫击塔爆炸范围扩大 35%，基础伤害降低 15%。",
    family: "tower",
    requires: ["mortar"]
  },
  {
    id: "prism-resonance",
    name: "棱镜共振",
    description: "连续接收同频脉冲时，第二次攻击的频率效果增强。",
    family: "tower",
    requires: ["prism", "dyer"]
  },
  {
    id: "core-tempo",
    name: "核心超频",
    description: "核心脉冲间隔缩短 16%，但不改变单次能量。",
    family: "core"
  },
  {
    id: "field-repair",
    name: "现场回收",
    description: "拆除返还提高到 95%，装置重定位离线时间缩短。",
    family: "core"
  }
];

export function cellKey(cell: GridCoord): string {
  return `${cell.x},${cell.y}`;
}

export function sameCell(a: GridCoord, b: GridCoord): boolean {
  return a.x === b.x && a.y === b.y;
}

export function manhattan(a: GridCoord, b: GridCoord): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

export function cellToWorld(cell: GridCoord, height = 0): WorldPoint {
  return {
    x: (cell.x - (GRID_WIDTH - 1) / 2) * CELL_SIZE,
    y: height,
    z: (cell.y - (GRID_HEIGHT - 1) / 2) * CELL_SIZE
  };
}

export function lanePointAt(laneIndex: number, progress: number): WorldPoint {
  const lane = LANES[laneIndex] ?? LANES[0];
  const clamped = Math.min(1, Math.max(0, progress));
  const segmentLengths: number[] = [];
  let total = 0;

  for (let index = 0; index < lane.points.length - 1; index += 1) {
    const from = lane.points[index];
    const to = lane.points[index + 1];
    const length = Math.hypot(to.x - from.x, to.y - from.y);
    segmentLengths.push(length);
    total += length;
  }

  let remaining = clamped * total;
  for (let index = 0; index < segmentLengths.length; index += 1) {
    const length = segmentLengths[index];
    if (remaining <= length || index === segmentLengths.length - 1) {
      const from = lane.points[index];
      const to = lane.points[index + 1];
      const t = length === 0 ? 0 : Math.min(1, remaining / length);
      return cellToWorld({
        x: from.x + (to.x - from.x) * t,
        y: from.y + (to.y - from.y) * t
      });
    }
    remaining -= length;
  }

  return cellToWorld(CORE_CELL);
}

export function isRoadCell(cell: GridCoord): boolean {
  return LANES.some((lane) =>
    lane.points.some((point, index) => {
      if (index === lane.points.length - 1) {
        return sameCell(cell, point);
      }
      const next = lane.points[index + 1];
      if (point.x === next.x && cell.y === point.y) {
        return cell.x >= Math.min(point.x, next.x) && cell.x <= Math.max(point.x, next.x);
      }
      if (point.y === next.y && cell.x === point.x) {
        return cell.y >= Math.min(point.y, next.y) && cell.y <= Math.max(point.y, next.y);
      }
      return false;
    })
  );
}

export function rewardById(id: RewardId): RewardDefinition {
  const reward = REWARDS.find((entry) => entry.id === id);
  if (!reward) {
    throw new Error(`Unknown reward: ${id}`);
  }
  return reward;
}
