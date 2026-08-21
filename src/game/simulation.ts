import {
  BOSS_DURATION_TARGET,
  DEVICE_COST,
  ENEMY_STATS,
  GRID_HEIGHT,
  GRID_WIDTH,
  REWARDS,
  WAVE_DURATION,
  cellToWorld,
  lanePointAt,
  rewardById
} from "./config";
import {
  buildTopology,
  distributeEnergy,
  findDeviceAt,
  validatePlacement
} from "./network";
import { SeededRandom } from "./random";
import {
  CORE_ID,
  type BuildTool,
  type DeviceKind,
  type DeviceState,
  type EnemyKind,
  type EnemyState,
  type Frequency,
  type GameEvent,
  type GameState,
  type GridCoord,
  type JamZone,
  type ProjectileState,
  type RewardDefinition,
  type RewardId,
  type Topology,
  type WorldPoint
} from "./types";

type EventListener = (event: GameEvent) => void;
type TowerKind = "needle" | "mortar" | "prism";

const STARTING_UNLOCKS: DeviceKind[] = ["wire", "splitter", "capacitor", "needle"];
const TOWER_KINDS = new Set<TowerKind>(["needle", "mortar", "prism"]);
const FREQUENCIES: Frequency[] = ["red", "blue", "yellow"];

function isTowerKind(kind: DeviceKind): kind is TowerKind {
  return TOWER_KINDS.has(kind as TowerKind);
}

function makeInitialState(seed: number): GameState {
  return {
    seed,
    phase: "ready",
    phaseBeforePause: "ready",
    elapsed: 0,
    wave: 1,
    waveElapsed: 0,
    waveClosing: false,
    spawnTimer: 3.5,
    preWaveDelay: 12,
    score: 0,
    kills: 0,
    coreHp: 100,
    coreMaxHp: 100,
    buildPoints: 88,
    buildPointCap: 120,
    selectedTool: "wire",
    selectedDeviceId: null,
    devices: [],
    pulses: [],
    enemies: [],
    projectiles: [],
    jamZones: [],
    unlocks: new Set(STARTING_UNLOCKS),
    upgrades: new Set(),
    rewardOptions: [],
    freeRerollAvailable: true,
    bossSpawned: false,
    activeLanes: [0],
    topologyVersion: 0,
    tutorialStep: 0
  };
}

function distanceSquared(a: WorldPoint, b: WorldPoint): number {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return dx * dx + dz * dz;
}

export class GameSimulation {
  state: GameState;
  topology: Topology;

  private random: SeededRandom;
  private listeners = new Set<EventListener>();
  private nextDeviceId = 1;
  private nextPulseId = 1;
  private nextEnemyId = 1;
  private nextProjectileId = 1;
  private nextJamId = 1;
  private corePulseTimer = 0;
  private bossJamTimer = 14;
  private bossElapsed = 0;

  constructor(seed = Date.now() & 0xffffffff) {
    this.state = makeInitialState(seed);
    this.topology = buildTopology(this.state.devices);
    this.random = new SeededRandom(seed);
  }

  subscribe(listener: EventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  start(seed = this.state.seed): void {
    this.reset(seed);
    this.state.phase = "running";
    this.state.phaseBeforePause = "running";
    this.emit({ type: "wave", wave: 1, lanes: [...this.state.activeLanes] });
    this.emit({ type: "tutorial", step: 0 });
  }

  reset(seed = (Date.now() ^ Math.floor(Math.random() * 0xffffffff)) >>> 0): void {
    this.state = makeInitialState(seed);
    this.topology = buildTopology(this.state.devices);
    this.random = new SeededRandom(seed);
    this.nextDeviceId = 1;
    this.nextPulseId = 1;
    this.nextEnemyId = 1;
    this.nextProjectileId = 1;
    this.nextJamId = 1;
    this.corePulseTimer = 0;
    this.bossJamTimer = 14;
    this.bossElapsed = 0;
  }

  update(delta: number): void {
    if (this.state.phase !== "running") {
      return;
    }

    const dt = Math.min(delta, 0.1);
    this.state.elapsed += dt;
    this.state.buildPoints = Math.min(
      this.state.buildPointCap,
      this.state.buildPoints + (this.state.upgrades.has("core-tempo") ? 3.25 : 3) * dt
    );

    this.updateJamZones();
    this.updateDeviceCooldowns(dt);
    this.updateNetwork(dt);
    this.updateTowers();
    this.updateProjectiles(dt);
    if (this.state.phase !== "running") {
      return;
    }
    this.updateEnemies(dt);
    if (this.state.phase !== "running") {
      return;
    }
    this.updateRunDirector(dt);
  }

  setTool(tool: BuildTool): void {
    this.state.selectedTool = tool;
    this.state.selectedDeviceId = null;
  }

  selectDevice(deviceId: number | null): void {
    this.state.selectedDeviceId = deviceId;
  }

  placeDevice(kind: DeviceKind, cell: GridCoord): boolean {
    if (this.state.phase !== "running") {
      this.emit({ type: "invalid", message: "战斗暂停时不能搭建", cell });
      return false;
    }

    const id = this.nextDeviceId;
    const result = validatePlacement(this.state, kind, cell, id);
    if (!result.ok || !result.topology) {
      this.emit({ type: "invalid", message: result.message, cell });
      return false;
    }

    const device: DeviceState = {
      id,
      kind,
      cell: { ...cell },
      frequency: "red",
      activeBranch: 0,
      autoAlternator: 0,
      energyStore: 0,
      bufferEnergy: 0,
      bufferFrequency: "neutral",
      cooldown: 0,
      disabledUntil: 0,
      offlineUntil: this.state.elapsed + 0.28,
      targetId: null,
      previousFrequency: "neutral"
    };

    this.nextDeviceId += 1;
    this.state.devices.push(device);
    this.state.buildPoints -= DEVICE_COST[kind];
    this.topology = result.topology;
    this.state.topologyVersion += 1;
    this.state.selectedDeviceId = device.id;
    this.emit({ type: "build", deviceId: id, kind, cell: { ...cell } });
    this.advanceTutorialAfterBuild(kind);
    return true;
  }

  moveDevice(deviceId: number, cell: GridCoord): boolean {
    if (this.state.phase !== "running") {
      this.emit({ type: "invalid", message: "战斗暂停时不能迁移装置", cell });
      return false;
    }

    const device = this.state.devices.find((entry) => entry.id === deviceId);
    if (!device) {
      return false;
    }

    const devicesWithout = this.state.devices.filter((entry) => entry.id !== deviceId);
    const temporaryState: GameState = {
      ...this.state,
      devices: devicesWithout,
      buildPoints: this.state.buildPoints + DEVICE_COST[device.kind]
    };
    const result = validatePlacement(temporaryState, device.kind, cell, device.id);
    if (!result.ok || !result.topology) {
      this.emit({ type: "invalid", message: result.message, cell });
      return false;
    }

    device.cell = { ...cell };
    device.offlineUntil =
      this.state.elapsed + (this.state.upgrades.has("field-repair") ? 0.35 : 0.75);
    this.topology = result.topology;
    this.state.topologyVersion += 1;
    this.pruneInvalidPulses();
    this.emit({ type: "build", deviceId, kind: device.kind, cell: { ...cell } });
    return true;
  }

  removeAt(cell: GridCoord): boolean {
    if (this.state.phase !== "running") {
      this.emit({ type: "invalid", message: "战斗暂停时不能拆除", cell });
      return false;
    }

    const device = findDeviceAt(this.state.devices, cell);
    if (!device) {
      return false;
    }

    this.state.devices = this.state.devices.filter((entry) => entry.id !== device.id);
    const refundRate = this.state.upgrades.has("field-repair") ? 0.95 : 0.8;
    this.state.buildPoints = Math.min(
      this.state.buildPointCap,
      this.state.buildPoints + DEVICE_COST[device.kind] * refundRate
    );
    this.topology = buildTopology(this.state.devices);
    this.state.topologyVersion += 1;
    this.state.selectedDeviceId =
      this.state.selectedDeviceId === device.id ? null : this.state.selectedDeviceId;
    this.pruneInvalidPulses();
    this.emit({
      type: "remove",
      deviceId: device.id,
      kind: device.kind,
      cell: { ...device.cell }
    });
    return true;
  }

  interactAt(cell: GridCoord): boolean {
    const device = findDeviceAt(this.state.devices, cell);
    if (!device) {
      this.state.selectedDeviceId = null;
      return false;
    }

    this.state.selectedDeviceId = device.id;
    if (device.kind === "dyer") {
      const index = FREQUENCIES.indexOf(device.frequency);
      device.frequency = FREQUENCIES[(index + 1) % FREQUENCIES.length];
      return true;
    }

    if (device.kind === "switch") {
      if (this.state.upgrades.has("sync-switch")) {
        for (const entry of this.state.devices) {
          if (entry.kind === "switch") {
            entry.activeBranch = entry.activeBranch === 0 ? 1 : 0;
          }
        }
      } else {
        device.activeBranch = device.activeBranch === 0 ? 1 : 0;
      }
      return true;
    }

    if (device.kind === "splitter" && this.state.upgrades.has("biased-split")) {
      device.activeBranch = device.activeBranch === 0 ? 1 : 0;
      return true;
    }

    return true;
  }

  togglePause(): void {
    if (this.state.phase === "running") {
      this.state.phaseBeforePause = "running";
      this.state.phase = "paused";
      return;
    }
    if (this.state.phase === "paused") {
      this.state.phase = this.state.phaseBeforePause;
    }
  }

  pauseForVisibility(): void {
    if (this.state.phase === "running") {
      this.state.phaseBeforePause = "running";
      this.state.phase = "paused";
    }
  }

  chooseReward(id: RewardId): boolean {
    if (this.state.phase !== "reward") {
      return false;
    }
    const reward = this.state.rewardOptions.find((entry) => entry.id === id);
    if (!reward) {
      return false;
    }

    this.applyReward(reward);
    this.emit({ type: "reward-picked", reward });
    this.state.rewardOptions = [];
    this.state.wave += 1;
    this.state.waveElapsed = 0;
    this.state.waveClosing = false;
    this.state.spawnTimer = 4;
    this.state.preWaveDelay = 4;
    this.state.activeLanes = this.lanesForWave(this.state.wave);
    this.state.phase = "running";
    this.emit({
      type: "wave",
      wave: this.state.wave,
      lanes: [...this.state.activeLanes]
    });
    return true;
  }

  rerollRewards(): boolean {
    if (this.state.phase !== "reward" || !this.state.freeRerollAvailable) {
      return false;
    }
    this.state.freeRerollAvailable = false;
    this.state.rewardOptions = this.generateRewardOptions(
      new Set(this.state.rewardOptions.map((reward) => reward.id))
    );
    return true;
  }

  getDeviceAt(cell: GridCoord): DeviceState | undefined {
    return findDeviceAt(this.state.devices, cell);
  }

  debugGrantBuildPoints(amount = 120): void {
    this.state.buildPoints = Math.min(this.state.buildPointCap, this.state.buildPoints + amount);
  }

  debugFinishWave(): void {
    if (this.state.phase !== "running") {
      return;
    }
    if (this.state.wave <= 5) {
      this.state.waveClosing = true;
      this.state.waveElapsed = WAVE_DURATION;
      this.state.enemies = [];
      this.openReward();
    }
  }

  debugDamageCore(amount: number): void {
    this.damageCore(amount);
  }

  debugDefeatBoss(): boolean {
    const boss = this.state.enemies.find((enemy) => enemy.kind === "boss");
    if (!boss) {
      return false;
    }
    this.damageEnemy(boss, boss.hp + 1, "neutral");
    return true;
  }

  private emit(event: GameEvent): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }

  private advanceTutorialAfterBuild(kind: DeviceKind): void {
    if (this.state.tutorialStep === 0 && kind === "wire") {
      this.state.tutorialStep = 1;
      this.emit({ type: "tutorial", step: 1 });
    }
    if (
      this.state.tutorialStep <= 1 &&
      (kind === "needle" || kind === "mortar" || kind === "prism")
    ) {
      this.state.tutorialStep = 2;
      this.emit({ type: "tutorial", step: 2 });
    }
  }

  private updateDeviceCooldowns(dt: number): void {
    for (const device of this.state.devices) {
      device.cooldown = Math.max(0, device.cooldown - dt);
    }
  }

  private updateNetwork(dt: number): void {
    const interval = this.state.upgrades.has("core-tempo") ? 0.69 : 0.82;
    this.corePulseTimer -= dt;
    if (this.corePulseTimer <= 0) {
      const root = this.topology.children.get(CORE_ID)?.[0];
      if (root !== undefined) {
        this.sendPulse(CORE_ID, root, 1, "neutral");
        this.corePulseTimer += interval;
      } else {
        this.corePulseTimer = Math.min(0.2, interval);
      }
    }

    const arrived: PulseStateLike[] = [];
    for (const pulse of this.state.pulses) {
      const target = this.state.devices.find((device) => device.id === pulse.toId);
      if (!target) {
        pulse.progress = 2;
        continue;
      }

      if (
        pulse.progress >= 0.96 &&
        (target.disabledUntil > this.state.elapsed || target.offlineUntil > this.state.elapsed)
      ) {
        pulse.progress = 0.96;
        continue;
      }

      pulse.progress += dt / 0.26;
      if (pulse.progress >= 1) {
        arrived.push({
          id: pulse.id,
          target,
          energy: pulse.energy,
          frequency: pulse.frequency
        });
      }
    }

    const arrivedIds = new Set(arrived.map((entry) => entry.id));
    this.state.pulses = this.state.pulses.filter(
      (pulse) => pulse.progress <= 1 && !arrivedIds.has(pulse.id)
    );

    for (const arrival of arrived) {
      this.processPulseArrival(arrival.target, arrival.energy, arrival.frequency);
    }

    for (const device of this.state.devices) {
      if (
        device.kind !== "capacitor" ||
        device.disabledUntil > this.state.elapsed ||
        device.offlineUntil > this.state.elapsed
      ) {
        continue;
      }
      this.flushCapacitor(device);
    }
  }

  private processPulseArrival(
    device: DeviceState,
    energy: number,
    frequency: Frequency
  ): void {
    if (isTowerKind(device.kind)) {
      device.bufferEnergy = Math.min(8, device.bufferEnergy + energy);
      device.bufferFrequency = frequency;
      return;
    }

    if (device.kind === "capacitor") {
      device.energyStore = Math.min(8, device.energyStore + energy);
      device.bufferFrequency = frequency;
      this.flushCapacitor(device);
      return;
    }

    const children = this.topology.children.get(device.id) ?? [];
    if (children.length === 0) {
      return;
    }

    if (device.kind === "wire") {
      this.sendPulse(device.id, children[0], energy, frequency);
      return;
    }

    if (device.kind === "dyer") {
      let outputFrequency = device.frequency;
      if (this.state.upgrades.has("dual-dye")) {
        const index = FREQUENCIES.indexOf(device.frequency);
        outputFrequency =
          device.autoAlternator % 2 === 0
            ? device.frequency
            : FREQUENCIES[(index + 1) % FREQUENCIES.length];
        device.autoAlternator += 1;
      }
      this.sendPulse(device.id, children[0], energy, outputFrequency);
      return;
    }

    if (device.kind === "switch") {
      const output = children[Math.min(device.activeBranch, children.length - 1)];
      this.sendPulse(device.id, output, energy, frequency);
      return;
    }

    if (device.kind === "splitter") {
      if (children.length === 1) {
        this.sendPulse(device.id, children[0], energy, frequency);
        return;
      }

      if (this.state.upgrades.has("alternating-split")) {
        const output = children[device.autoAlternator % children.length];
        device.autoAlternator += 1;
        this.sendPulse(device.id, output, energy, frequency);
        return;
      }

      const mainRatio = this.state.upgrades.has("biased-split") ? 0.7 : 0.5;
      const ratios =
        device.activeBranch === 0
          ? distributeEnergy(1, mainRatio)
          : distributeEnergy(1, 1 - mainRatio);
      children.forEach((child, index) => {
        this.sendPulse(device.id, child, energy * ratios[index], frequency);
      });
    }
  }

  private flushCapacitor(device: DeviceState): void {
    if (device.cooldown > 0) {
      return;
    }
    const children = this.topology.children.get(device.id) ?? [];
    if (children.length === 0) {
      return;
    }
    const threshold = this.state.upgrades.has("quick-capacitor")
      ? 2
      : this.state.upgrades.has("deep-capacitor")
        ? 5
        : 3;
    if (device.energyStore + 0.0001 < threshold) {
      return;
    }
    device.energyStore -= threshold;
    device.cooldown = 0.08;
    this.sendPulse(device.id, children[0], threshold, device.bufferFrequency);
  }

  private sendPulse(
    fromId: number,
    toId: number,
    energy: number,
    frequency: Frequency
  ): void {
    if (energy < 0.18) {
      return;
    }
    this.state.pulses.push({
      id: this.nextPulseId,
      fromId,
      toId,
      progress: 0,
      energy,
      frequency
    });
    this.nextPulseId += 1;
    this.emit({ type: "pulse", frequency, energy });
  }

  private updateTowers(): void {
    for (const tower of this.state.devices) {
      if (
        !isTowerKind(tower.kind) ||
        tower.cooldown > 0 ||
        tower.disabledUntil > this.state.elapsed ||
        tower.offlineUntil > this.state.elapsed
      ) {
        continue;
      }

      const threshold = tower.kind === "mortar" ? 2.5 : 0.18;
      if (tower.bufferEnergy < threshold) {
        continue;
      }
      const volley =
        tower.kind === "needle" &&
        this.state.upgrades.has("needle-volley") &&
        tower.bufferEnergy >= 3;
      const targets = this.findTowerTargets(tower, volley ? 3 : 1);
      if (targets.length === 0) {
        tower.targetId = null;
        continue;
      }

      const spend =
        tower.kind === "mortar"
          ? Math.min(5, tower.bufferEnergy)
          : volley
            ? 3
            : Math.min(1.5, tower.bufferEnergy);
      tower.bufferEnergy -= spend;
      tower.targetId = targets[0].id;
      const frequency = tower.bufferFrequency;
      const baseDamage =
        tower.kind === "needle" ? 25 : tower.kind === "mortar" ? 43 : 13;
      const wideFuse = tower.kind === "mortar" && this.state.upgrades.has("wide-fuse");
      const totalDamage = baseDamage * spend * (wideFuse ? 0.85 : 1);
      const resonance =
        tower.kind === "prism" &&
        frequency !== "neutral" &&
        this.state.upgrades.has("prism-resonance") &&
        tower.previousFrequency === frequency;
      const damagePerTarget = totalDamage / targets.length;
      const energyPerTarget = spend / targets.length;
      for (const target of targets) {
        const projectile: ProjectileState = {
          id: this.nextProjectileId,
          towerId: tower.id,
          targetId: target.id,
          towerKind: tower.kind,
          frequency,
          energy: energyPerTarget,
          damage: damagePerTarget,
          aoe: tower.kind === "mortar" ? (wideFuse ? 1.48 : 1.1) : 0,
          effectMultiplier: resonance ? 1.5 : 1,
          progress: 0,
          duration:
            tower.kind === "mortar" ? 0.58 : tower.kind === "prism" ? 0.28 : 0.16,
          start: cellToWorld(tower.cell, 0.72)
        };
        this.nextProjectileId += 1;
        this.state.projectiles.push(projectile);
      }
      tower.previousFrequency = frequency;
      tower.cooldown = tower.kind === "mortar" ? 0.72 : tower.kind === "prism" ? 0.34 : 0.2;
      this.emit({
        type: "shot",
        towerKind: tower.kind,
        frequency
      });
      if (this.state.tutorialStep === 2) {
        this.state.tutorialStep = 3;
        this.emit({ type: "tutorial", step: 3 });
      }
    }
  }

  private findTowerTargets(tower: DeviceState, limit: number): EnemyState[] {
    const center = cellToWorld(tower.cell);
    const range = tower.kind === "needle" ? 3.45 : tower.kind === "mortar" ? 4.35 : 3.75;
    return this.state.enemies
      .filter((enemy) => distanceSquared(center, lanePointAt(enemy.lane, enemy.pathProgress)) <= range * range)
      .sort((left, right) => right.pathProgress - left.pathProgress)
      .slice(0, limit);
  }

  private updateProjectiles(dt: number): void {
    const impacts: ProjectileState[] = [];
    for (const projectile of this.state.projectiles) {
      projectile.progress += dt / projectile.duration;
      if (projectile.progress >= 1) {
        impacts.push(projectile);
      }
    }
    const impactIds = new Set(impacts.map((projectile) => projectile.id));
    this.state.projectiles = this.state.projectiles.filter(
      (projectile) => !impactIds.has(projectile.id)
    );
    for (const projectile of impacts) {
      this.resolveProjectile(projectile);
    }
  }

  private resolveProjectile(projectile: ProjectileState): void {
    const target = this.state.enemies.find((enemy) => enemy.id === projectile.targetId);
    if (!target) {
      return;
    }
    const targetPosition = lanePointAt(target.lane, target.pathProgress);
    const targets =
      projectile.aoe > 0
        ? this.state.enemies.filter(
            (enemy) =>
              distanceSquared(
                targetPosition,
                lanePointAt(enemy.lane, enemy.pathProgress)
              ) <=
              projectile.aoe * projectile.aoe
          )
        : [target];

    for (const enemy of [...targets]) {
      this.applyFrequency(
        enemy,
        projectile.frequency,
        projectile.energy,
        projectile.towerKind,
        projectile.effectMultiplier
      );
      let damage = projectile.damage;
      if (
        this.state.upgrades.has("cryo-fracture") &&
        enemy.slowTime > 0 &&
        projectile.energy >= 2
      ) {
        damage *= 1.25;
      }
      this.damageEnemy(enemy, damage, projectile.frequency);
    }

    if (projectile.frequency === "yellow") {
      this.applyChainDamage(target, projectile);
    }
  }

  private applyFrequency(
    enemy: EnemyState,
    frequency: Frequency,
    energy: number,
    towerKind: "needle" | "mortar" | "prism",
    effectMultiplier: number
  ): void {
    const prismMultiplier = (towerKind === "prism" ? 1.75 : 1) * effectMultiplier;
    if (frequency === "red") {
      const burn = 4.5 * energy * prismMultiplier;
      enemy.burnDps = this.state.upgrades.has("ember-stack")
        ? Math.min(burn * 3, enemy.burnDps + burn)
        : Math.max(enemy.burnDps, burn);
      enemy.burnTime = Math.max(enemy.burnTime, 2.7);
    } else if (frequency === "blue") {
      enemy.slowAmount = Math.min(0.62, Math.max(enemy.slowAmount, 0.18 * energy * prismMultiplier));
      enemy.slowTime = Math.max(enemy.slowTime, 2.6);
    }
  }

  private applyChainDamage(target: EnemyState, projectile: ProjectileState): void {
    const jumps = this.state.upgrades.has("seeking-arc") ? 3 : 2;
    const hit = new Set<number>([target.id]);
    let current = target;
    let damage = projectile.damage * 0.42 * projectile.effectMultiplier;
    for (let index = 0; index < jumps; index += 1) {
      const currentPosition = lanePointAt(current.lane, current.pathProgress);
      const next = this.state.enemies
        .filter(
          (enemy) =>
            !hit.has(enemy.id) &&
            distanceSquared(currentPosition, lanePointAt(enemy.lane, enemy.pathProgress)) < 2.2 * 2.2
        )
        .sort(
          (left, right) =>
            distanceSquared(currentPosition, lanePointAt(left.lane, left.pathProgress)) -
            distanceSquared(currentPosition, lanePointAt(right.lane, right.pathProgress))
        )[0];
      if (!next) {
        break;
      }
      hit.add(next.id);
      this.damageEnemy(next, damage, "yellow");
      current = next;
      damage *= this.state.upgrades.has("seeking-arc") ? 0.5 : 0.42;
    }
  }

  private damageEnemy(enemy: EnemyState, amount: number, frequency: Frequency): void {
    if (!this.state.enemies.some((entry) => entry.id === enemy.id)) {
      return;
    }
    enemy.hp -= amount;
    const position = lanePointAt(enemy.lane, enemy.pathProgress);
    this.emit({ type: "hit", position, frequency, amount });
    if (enemy.hp <= 0) {
      this.killEnemy(enemy);
    }
  }

  private killEnemy(enemy: EnemyState): void {
    this.state.enemies = this.state.enemies.filter((entry) => entry.id !== enemy.id);
    this.state.kills += 1;
    this.state.score += Math.round(enemy.maxHp + enemy.pathProgress * 50);
    this.state.buildPoints = Math.min(
      this.state.buildPointCap,
      this.state.buildPoints + enemy.reward
    );
    const position = lanePointAt(enemy.lane, enemy.pathProgress);
    this.emit({ type: "kill", position, enemyKind: enemy.kind });
    if (enemy.kind === "boss") {
      this.finishWin();
    }
  }

  private updateEnemies(dt: number): void {
    for (const enemy of [...this.state.enemies]) {
      if (!this.state.enemies.some((entry) => entry.id === enemy.id)) {
        continue;
      }
      if (enemy.burnTime > 0) {
        enemy.burnTime = Math.max(0, enemy.burnTime - dt);
        enemy.hp -= enemy.burnDps * dt;
        if (enemy.hp <= 0) {
          this.killEnemy(enemy);
          continue;
        }
      } else {
        enemy.burnDps = 0;
      }

      if (enemy.slowTime > 0) {
        enemy.slowTime = Math.max(0, enemy.slowTime - dt);
      } else {
        enemy.slowAmount = 0;
      }

      const speedFactor = 1 - enemy.slowAmount;
      enemy.pathProgress += enemy.speed * speedFactor * dt;

      if (
        enemy.kind === "disruptor" &&
        !enemy.jamTriggered &&
        enemy.pathProgress >= 0.48
      ) {
        enemy.jamTriggered = true;
        this.scheduleJam();
      }

      if (enemy.pathProgress >= 1) {
        this.state.enemies = this.state.enemies.filter((entry) => entry.id !== enemy.id);
        this.damageCore(enemy.coreDamage);
      }
    }
  }

  private damageCore(amount: number): void {
    if (this.state.phase === "won" || this.state.phase === "lost") {
      return;
    }
    this.state.coreHp = Math.max(0, this.state.coreHp - amount);
    this.emit({ type: "core-hit", amount });
    if (this.state.coreHp <= 0) {
      this.state.phase = "lost";
      this.state.score += Math.round(this.state.elapsed);
      this.emit({ type: "lose", score: this.state.score });
    }
  }

  private updateRunDirector(dt: number): void {
    if (this.state.preWaveDelay > 0) {
      this.state.preWaveDelay = Math.max(0, this.state.preWaveDelay - dt);
      return;
    }

    if (this.state.wave <= 5) {
      this.state.waveElapsed += dt;
      if (!this.state.waveClosing) {
        this.state.spawnTimer -= dt;
        if (this.state.spawnTimer <= 0) {
          this.spawnWaveEnemy();
          const base = Math.max(1.05, 2.8 - this.state.wave * 0.2);
          this.state.spawnTimer = base * (0.78 + this.random.next() * 0.48);
        }
        if (this.state.waveElapsed >= WAVE_DURATION) {
          this.state.waveClosing = true;
        }
      }

      if (this.state.waveClosing && this.state.enemies.length === 0) {
        this.openReward();
      }
      return;
    }

    this.bossElapsed += dt;
    if (!this.state.bossSpawned) {
      this.spawnEnemy("boss", this.random.pick(this.state.activeLanes));
      this.state.bossSpawned = true;
      this.state.spawnTimer = 6;
      this.emit({ type: "boss" });
    }

    this.state.spawnTimer -= dt;
    if (this.state.spawnTimer <= 0) {
      const kind: EnemyKind = this.random.next() < 0.55 ? "swarm" : "runner";
      this.spawnEnemy(kind, this.random.pick([0, 1, 2]));
      this.state.spawnTimer = 5.5 + this.random.next() * 2.5;
    }

    this.bossJamTimer -= dt;
    if (this.bossJamTimer <= 0) {
      this.scheduleJam();
      this.bossJamTimer = 15 + this.random.next() * 5;
    }

    if (this.bossElapsed > BOSS_DURATION_TARGET + 40) {
      const boss = this.state.enemies.find((enemy) => enemy.kind === "boss");
      if (boss) {
        boss.speed *= 1 + dt * 0.04;
      }
    }
  }

  private spawnWaveEnemy(): void {
    const roll = this.random.next();
    let kind: EnemyKind;
    if (this.state.wave === 1) {
      kind = "swarm";
    } else if (this.state.wave === 2) {
      kind = roll < 0.34 ? "runner" : "swarm";
    } else if (this.state.wave === 3) {
      kind = roll < 0.22 ? "armored" : roll < 0.55 ? "runner" : "swarm";
    } else if (this.state.wave === 4) {
      kind =
        roll < 0.14 ? "disruptor" : roll < 0.34 ? "armored" : roll < 0.62 ? "runner" : "swarm";
    } else {
      kind =
        roll < 0.18 ? "disruptor" : roll < 0.42 ? "armored" : roll < 0.7 ? "runner" : "swarm";
    }
    this.spawnEnemy(kind, this.random.pick(this.state.activeLanes));
  }

  private spawnEnemy(kind: EnemyKind, lane: number): void {
    const base = ENEMY_STATS[kind];
    const scale = kind === "boss" ? 1 : 1 + Math.max(0, this.state.wave - 1) * 0.15;
    const enemy: EnemyState = {
      id: this.nextEnemyId,
      kind,
      lane,
      pathProgress: 0,
      hp: base.hp * scale,
      maxHp: base.hp * scale,
      speed: base.speed,
      coreDamage: base.coreDamage,
      reward: base.reward,
      burnDps: 0,
      burnTime: 0,
      slowAmount: 0,
      slowTime: 0,
      jamTriggered: false,
      spawnedAt: this.state.elapsed
    };
    this.nextEnemyId += 1;
    this.state.enemies.push(enemy);
  }

  private lanesForWave(wave: number): number[] {
    if (wave <= 1) {
      return [0];
    }
    if (wave === 2) {
      return [1];
    }
    if (wave === 3) {
      return [0, 2];
    }
    if (wave === 4) {
      return [1, 2];
    }
    return [0, 1, 2];
  }

  private openReward(): void {
    if (this.state.phase !== "running") {
      return;
    }
    this.state.phase = "reward";
    this.state.rewardOptions = this.generateRewardOptions();
    this.emit({ type: "reward", wave: this.state.wave });
  }

  private generateRewardOptions(excluded = new Set<RewardId>()): RewardDefinition[] {
    const available = REWARDS.filter((reward) => {
      if (excluded.has(reward.id) || this.state.upgrades.has(reward.id)) {
        return false;
      }
      if (reward.id.startsWith("unlock-")) {
        const kind = reward.id.replace("unlock-", "") as DeviceKind;
        return !this.state.unlocks.has(kind);
      }
      if (reward.requires?.some((kind) => !this.state.unlocks.has(kind))) {
        return false;
      }
      if (reward.excludes?.some((id) => this.state.upgrades.has(id))) {
        return false;
      }
      return true;
    });

    const shuffled = this.random.shuffle(available);
    if (shuffled.length >= 3) {
      return shuffled.slice(0, 3);
    }

    const fallbackIds: RewardId[] = ["core-tempo", "field-repair"];
    const fallback = fallbackIds
      .map(rewardById)
      .filter(
        (reward) =>
          !this.state.upgrades.has(reward.id) &&
          !shuffled.some((entry) => entry.id === reward.id)
      );
    return [...shuffled, ...fallback].slice(0, 3);
  }

  private applyReward(reward: RewardDefinition): void {
    this.state.upgrades.add(reward.id);
    const unlockMap: Partial<Record<RewardId, DeviceKind>> = {
      "unlock-dyer": "dyer",
      "unlock-switch": "switch",
      "unlock-mortar": "mortar",
      "unlock-prism": "prism"
    };
    const kind = unlockMap[reward.id];
    if (kind) {
      this.state.unlocks.add(kind);
    }
    if (reward.id === "field-repair") {
      this.state.coreHp = Math.min(this.state.coreMaxHp, this.state.coreHp + 12);
    }
  }

  private scheduleJam(): void {
    const candidates = this.state.devices.filter(
      (device) => this.topology.connected.has(device.id) && device.kind !== "wire"
    );
    const fallback = this.state.devices.filter((device) => this.topology.connected.has(device.id));
    const targetPool = candidates.length > 0 ? candidates : fallback;
    if (targetPool.length === 0) {
      return;
    }
    const target = this.random.pick(targetPool);
    const cell = {
      x: Math.max(0, Math.min(GRID_WIDTH - 2, target.cell.x - this.random.integer(0, 1))),
      y: Math.max(0, Math.min(GRID_HEIGHT - 2, target.cell.y - this.random.integer(0, 1)))
    };
    const zone: JamZone = {
      id: this.nextJamId,
      cell,
      size: 2,
      warnUntil: this.state.elapsed + 2.6,
      activeUntil: this.state.elapsed + 7.4,
      activated: false
    };
    this.nextJamId += 1;
    this.state.jamZones.push(zone);
    this.emit({ type: "jam-warning", zone: { ...zone, cell: { ...zone.cell } } });
  }

  private updateJamZones(): void {
    for (const zone of this.state.jamZones) {
      if (!zone.activated && this.state.elapsed >= zone.warnUntil) {
        zone.activated = true;
        for (const device of this.state.devices) {
          if (
            device.cell.x >= zone.cell.x &&
            device.cell.x < zone.cell.x + zone.size &&
            device.cell.y >= zone.cell.y &&
            device.cell.y < zone.cell.y + zone.size
          ) {
            device.disabledUntil = Math.max(device.disabledUntil, zone.activeUntil);
          }
        }
        this.emit({ type: "jam-active", zone: { ...zone, cell: { ...zone.cell } } });
      }
    }
    this.state.jamZones = this.state.jamZones.filter(
      (zone) => zone.activeUntil > this.state.elapsed
    );
  }

  private pruneInvalidPulses(): void {
    const ids = new Set(this.state.devices.map((device) => device.id));
    this.state.pulses = this.state.pulses.filter(
      (pulse) =>
        (pulse.fromId === CORE_ID || ids.has(pulse.fromId)) &&
        ids.has(pulse.toId) &&
        this.topology.parent.get(pulse.toId) === pulse.fromId
    );
  }

  private finishWin(): void {
    if (this.state.phase === "won") {
      return;
    }
    this.state.phase = "won";
    this.state.score +=
      Math.round(this.state.coreHp * 25) +
      Math.round(Math.max(0, BOSS_DURATION_TARGET - this.bossElapsed) * 10);
    this.emit({ type: "win", score: this.state.score });
  }
}

interface PulseStateLike {
  id: number;
  target: DeviceState;
  energy: number;
  frequency: Frequency;
}
