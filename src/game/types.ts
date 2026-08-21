export const CORE_ID = 0;

export type DeviceKind =
  | "wire"
  | "splitter"
  | "capacitor"
  | "dyer"
  | "switch"
  | "needle"
  | "mortar"
  | "prism";

export type BuildTool = DeviceKind | "remove";
export type Frequency = "neutral" | "red" | "blue" | "yellow";
export type EnemyKind = "swarm" | "runner" | "armored" | "disruptor" | "boss";
export type RunPhase = "ready" | "running" | "paused" | "reward" | "won" | "lost";

export interface GridCoord {
  x: number;
  y: number;
}

export interface WorldPoint {
  x: number;
  y: number;
  z: number;
}

export interface DeviceState {
  id: number;
  kind: DeviceKind;
  cell: GridCoord;
  frequency: Frequency;
  activeBranch: number;
  autoAlternator: number;
  energyStore: number;
  bufferEnergy: number;
  bufferFrequency: Frequency;
  cooldown: number;
  disabledUntil: number;
  offlineUntil: number;
  targetId: number | null;
  previousFrequency: Frequency;
}

export interface PulseState {
  id: number;
  fromId: number;
  toId: number;
  progress: number;
  energy: number;
  frequency: Frequency;
}

export interface EnemyState {
  id: number;
  kind: EnemyKind;
  lane: number;
  pathProgress: number;
  hp: number;
  maxHp: number;
  speed: number;
  coreDamage: number;
  reward: number;
  burnDps: number;
  burnTime: number;
  slowAmount: number;
  slowTime: number;
  jamTriggered: boolean;
  spawnedAt: number;
}

export interface ProjectileState {
  id: number;
  towerId: number;
  targetId: number;
  towerKind: "needle" | "mortar" | "prism";
  frequency: Frequency;
  energy: number;
  damage: number;
  aoe: number;
  effectMultiplier: number;
  progress: number;
  duration: number;
  start: WorldPoint;
}

export interface JamZone {
  id: number;
  cell: GridCoord;
  size: number;
  warnUntil: number;
  activeUntil: number;
  activated: boolean;
}

export type RewardId =
  | "unlock-dyer"
  | "unlock-switch"
  | "unlock-mortar"
  | "unlock-prism"
  | "alternating-split"
  | "biased-split"
  | "quick-capacitor"
  | "deep-capacitor"
  | "dual-dye"
  | "sync-switch"
  | "ember-stack"
  | "cryo-fracture"
  | "seeking-arc"
  | "needle-volley"
  | "wide-fuse"
  | "prism-resonance"
  | "core-tempo"
  | "field-repair";

export interface RewardDefinition {
  id: RewardId;
  name: string;
  description: string;
  family: "unlock" | "network" | "frequency" | "tower" | "core";
  requires?: DeviceKind[];
  excludes?: RewardId[];
}

export interface GameState {
  seed: number;
  phase: RunPhase;
  phaseBeforePause: "ready" | "running";
  elapsed: number;
  wave: number;
  waveElapsed: number;
  waveClosing: boolean;
  spawnTimer: number;
  preWaveDelay: number;
  score: number;
  kills: number;
  coreHp: number;
  coreMaxHp: number;
  buildPoints: number;
  buildPointCap: number;
  selectedTool: BuildTool;
  selectedDeviceId: number | null;
  devices: DeviceState[];
  pulses: PulseState[];
  enemies: EnemyState[];
  projectiles: ProjectileState[];
  jamZones: JamZone[];
  unlocks: Set<DeviceKind>;
  upgrades: Set<RewardId>;
  rewardOptions: RewardDefinition[];
  freeRerollAvailable: boolean;
  bossSpawned: boolean;
  activeLanes: number[];
  topologyVersion: number;
  tutorialStep: number;
}

export interface Topology {
  parent: Map<number, number>;
  children: Map<number, number[]>;
  connected: Set<number>;
  adjacency: Map<number, number[]>;
  valid: boolean;
  reason: string;
  conflictIds: number[];
}

export type GameEvent =
  | { type: "build"; deviceId: number; kind: DeviceKind; cell: GridCoord }
  | { type: "remove"; deviceId: number; kind: DeviceKind; cell: GridCoord }
  | { type: "invalid"; message: string; cell?: GridCoord }
  | { type: "pulse"; frequency: Frequency; energy: number }
  | { type: "shot"; towerKind: "needle" | "mortar" | "prism"; frequency: Frequency }
  | { type: "hit"; position: WorldPoint; frequency: Frequency; amount: number }
  | { type: "kill"; position: WorldPoint; enemyKind: EnemyKind }
  | { type: "core-hit"; amount: number }
  | { type: "wave"; wave: number; lanes: number[] }
  | { type: "reward"; wave: number }
  | { type: "reward-picked"; reward: RewardDefinition }
  | { type: "jam-warning"; zone: JamZone }
  | { type: "jam-active"; zone: JamZone }
  | { type: "boss" }
  | { type: "win"; score: number }
  | { type: "lose"; score: number }
  | { type: "tutorial"; step: number };

export interface PlacementResult {
  ok: boolean;
  message: string;
  topology?: Topology;
}
