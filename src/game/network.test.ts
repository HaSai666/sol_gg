import { describe, expect, it } from "vitest";
import { buildTopology, distributeEnergy } from "./network";
import type { DeviceKind, DeviceState } from "./types";

function device(id: number, kind: DeviceKind, x: number, y: number): DeviceState {
  return {
    id,
    kind,
    cell: { x, y },
    frequency: "neutral",
    activeBranch: 0,
    autoAlternator: 0,
    energyStore: 0,
    bufferEnergy: 0,
    bufferFrequency: "neutral",
    cooldown: 0,
    disabledUntil: 0,
    offlineUntil: 0,
    targetId: null,
    previousFrequency: "neutral"
  };
}

describe("network topology", () => {
  it("directs a splitter tree away from the core", () => {
    const topology = buildTopology([
      device(1, "splitter", 5, 6),
      device(2, "wire", 4, 6),
      device(3, "wire", 6, 6)
    ]);

    expect(topology.valid).toBe(true);
    expect(topology.parent.get(1)).toBe(0);
    expect(topology.children.get(1)).toEqual([2, 3]);
    expect(topology.connected.size).toBe(4);
  });

  it("rejects an undirected cycle before it enters simulation", () => {
    const topology = buildTopology([
      device(1, "wire", 0, 0),
      device(2, "wire", 1, 0),
      device(3, "wire", 1, 1),
      device(4, "wire", 0, 1)
    ]);

    expect(topology.valid).toBe(false);
    expect(topology.reason).toContain("回路");
  });

  it("keeps a tower at the end of a branch", () => {
    const topology = buildTopology([
      device(1, "wire", 5, 6),
      device(2, "needle", 5, 7),
      device(3, "wire", 6, 7)
    ]);

    expect(topology.valid).toBe(false);
    expect(topology.reason).toContain("炮塔");
  });
});

describe("energy distribution", () => {
  it("conserves total energy at an even split", () => {
    const branches = distributeEnergy(3, 0.5);
    expect(branches).toEqual([1.5, 1.5]);
    expect(branches[0] + branches[1]).toBeCloseTo(3, 10);
  });

  it("conserves total energy at a biased split", () => {
    const branches = distributeEnergy(5, 0.7);
    expect(branches[0]).toBeCloseTo(3.5, 10);
    expect(branches[1]).toBeCloseTo(1.5, 10);
    expect(branches[0] + branches[1]).toBeCloseTo(5, 10);
  });
});
