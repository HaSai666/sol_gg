import { describe, expect, it } from "vitest";
import { GameSimulation } from "./simulation";

function advance(game: GameSimulation, seconds: number): void {
  const step = 1 / 30;
  const ticks = Math.ceil(seconds / step);
  for (let index = 0; index < ticks; index += 1) {
    game.update(step);
  }
}

describe("game simulation", () => {
  it("freezes the first wave until the guided network fires", () => {
    const game = new GameSimulation(314);
    game.start(314, true);

    advance(game, 2);
    expect(game.state.tutorialActive).toBe(true);
    expect(game.state.tutorialStep).toBe(0);
    expect(game.state.elapsed).toBe(0);
    expect(game.state.enemies).toHaveLength(0);
    expect(game.placeDevice("wire", { x: 6, y: 5 })).toBe(false);

    expect(game.placeDevice("wire", { x: 4, y: 5 })).toBe(true);
    expect(game.state.tutorialStep).toBe(1);
    expect(game.placeDevice("wire", { x: 3, y: 5 })).toBe(true);
    expect(game.state.tutorialStep).toBe(2);
    expect(game.state.selectedTool).toBe("needle");
    expect(game.placeDevice("needle", { x: 3, y: 6 })).toBe(true);
    expect(game.state.tutorialStep).toBe(3);
    expect(game.state.enemies.some((enemy) => enemy.training)).toBe(true);

    advance(game, 3);

    expect(game.state.tutorialActive).toBe(false);
    expect(game.state.tutorialStep).toBe(4);
    expect(game.state.elapsed).toBeGreaterThan(0);
    expect(game.state.enemies.some((enemy) => enemy.training)).toBe(false);
    expect(game.state.kills).toBe(0);
    expect(game.state.score).toBe(0);
  });

  it("can skip the guided tutorial without advancing its frozen clock", () => {
    const game = new GameSimulation(2718);
    game.start(2718, true);

    expect(game.skipTutorial()).toBe(true);
    expect(game.skipTutorial()).toBe(false);
    expect(game.state.tutorialActive).toBe(false);
    expect(game.state.tutorialStep).toBe(4);
    expect(game.state.elapsed).toBe(0);

    advance(game, 0.5);
    expect(game.state.elapsed).toBeGreaterThan(0);
  });

  it("moves stored energy through a capacitor into a tower", () => {
    const game = new GameSimulation(1234);
    game.start(1234);

    expect(game.placeDevice("capacitor", { x: 5, y: 6 })).toBe(true);
    expect(game.placeDevice("wire", { x: 5, y: 7 })).toBe(true);
    expect(game.placeDevice("needle", { x: 5, y: 8 })).toBe(true);

    advance(game, 5);

    const tower = game.state.devices.find((device) => device.kind === "needle");
    expect(tower).toBeDefined();
    expect(tower?.bufferEnergy).toBeGreaterThan(0);
    expect(game.topology.connected.size).toBe(4);
  });

  it("generates deterministic reward choices for the same seed", () => {
    const first = new GameSimulation(99);
    const second = new GameSimulation(99);
    first.start(99);
    second.start(99);

    first.debugFinishWave();
    second.debugFinishWave();

    expect(first.state.phase).toBe("reward");
    expect(first.state.rewardOptions.map((reward) => reward.id)).toEqual(
      second.state.rewardOptions.map((reward) => reward.id)
    );
    expect(first.state.rewardOptions).toHaveLength(3);
  });

  it("applies a reward and advances to the next attack", () => {
    const game = new GameSimulation(71);
    game.start(71);
    game.debugFinishWave();
    const reward = game.state.rewardOptions[0];

    expect(reward).toBeDefined();
    expect(game.chooseReward(reward.id)).toBe(true);
    expect(game.state.phase).toBe("running");
    expect(game.state.wave).toBe(2);
    expect(game.state.upgrades.has(reward.id)).toBe(true);
  });

  it("pauses without advancing active time", () => {
    const game = new GameSimulation(8);
    game.start(8);
    advance(game, 1);
    game.togglePause();
    const elapsed = game.state.elapsed;

    advance(game, 2);

    expect(game.state.elapsed).toBe(elapsed);
    expect(game.state.phase).toBe("paused");
  });

  it("enters the loss state when core integrity reaches zero", () => {
    const game = new GameSimulation(18);
    game.start(18);
    game.debugDamageCore(100);

    expect(game.state.phase).toBe("lost");
    expect(game.state.coreHp).toBe(0);
  });

  it("reaches the victory state after the boss is defeated", () => {
    const game = new GameSimulation(404);
    game.start(404);

    for (let wave = 1; wave <= 5; wave += 1) {
      game.debugFinishWave();
      const reward = game.state.rewardOptions[0];
      expect(reward).toBeDefined();
      game.chooseReward(reward.id);
    }

    advance(game, 5);
    expect(game.state.enemies.some((enemy) => enemy.kind === "boss")).toBe(true);
    expect(game.debugDefeatBoss()).toBe(true);
    expect(game.state.phase).toBe("won");
    expect(game.state.coreHp).toBeGreaterThan(0);
  });

  it("allows exactly one reward reroll per run", () => {
    const game = new GameSimulation(207);
    game.start(207);
    game.debugFinishWave();
    const original = game.state.rewardOptions.map((reward) => reward.id);

    expect(game.rerollRewards()).toBe(true);
    expect(game.state.freeRerollAvailable).toBe(false);
    expect(game.state.rewardOptions.map((reward) => reward.id)).not.toEqual(original);
    expect(game.rerollRewards()).toBe(false);
  });
});
