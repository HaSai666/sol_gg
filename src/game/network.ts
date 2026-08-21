import {
  CORE_CELL,
  DEVICE_COST,
  GRID_HEIGHT,
  GRID_WIDTH,
  MAX_DEGREE,
  isRoadCell,
  manhattan,
  sameCell
} from "./config";
import {
  CORE_ID,
  type DeviceKind,
  type DeviceState,
  type GameState,
  type GridCoord,
  type PlacementResult,
  type Topology
} from "./types";

function makeAdjacency(devices: DeviceState[]): Map<number, number[]> {
  const adjacency = new Map<number, number[]>();
  adjacency.set(CORE_ID, []);

  for (const device of devices) {
    adjacency.set(device.id, []);
  }

  for (const device of devices) {
    if (manhattan(device.cell, CORE_CELL) === 1) {
      adjacency.get(CORE_ID)?.push(device.id);
      adjacency.get(device.id)?.push(CORE_ID);
    }
  }

  for (let leftIndex = 0; leftIndex < devices.length; leftIndex += 1) {
    const left = devices[leftIndex];
    for (let rightIndex = leftIndex + 1; rightIndex < devices.length; rightIndex += 1) {
      const right = devices[rightIndex];
      if (manhattan(left.cell, right.cell) !== 1) {
        continue;
      }
      adjacency.get(left.id)?.push(right.id);
      adjacency.get(right.id)?.push(left.id);
    }
  }

  for (const neighbors of adjacency.values()) {
    neighbors.sort((a, b) => a - b);
  }

  return adjacency;
}

function findCycle(adjacency: Map<number, number[]>): number[] {
  const visited = new Set<number>();

  const walk = (node: number, parent: number): number[] => {
    visited.add(node);
    for (const neighbor of adjacency.get(node) ?? []) {
      if (neighbor === parent) {
        continue;
      }
      if (visited.has(neighbor)) {
        return [node, neighbor];
      }
      const conflict = walk(neighbor, node);
      if (conflict.length > 0) {
        return conflict;
      }
    }
    return [];
  };

  for (const node of adjacency.keys()) {
    if (visited.has(node)) {
      continue;
    }
    const conflict = walk(node, -1);
    if (conflict.length > 0) {
      return conflict;
    }
  }

  return [];
}

export function buildTopology(devices: DeviceState[]): Topology {
  const adjacency = makeAdjacency(devices);
  const deviceById = new Map(devices.map((device) => [device.id, device]));
  const parent = new Map<number, number>();
  const children = new Map<number, number[]>();
  const connected = new Set<number>([CORE_ID]);
  const queue: number[] = [CORE_ID];
  children.set(CORE_ID, []);

  const cycle = findCycle(adjacency);
  if (cycle.length > 0) {
    return {
      parent,
      children,
      connected,
      adjacency,
      valid: false,
      reason: "这条线路会形成回路",
      conflictIds: cycle
    };
  }

  if ((adjacency.get(CORE_ID)?.length ?? 0) > 1) {
    return {
      parent,
      children,
      connected,
      adjacency,
      valid: false,
      reason: "核心只有一个主输出口，请先连接分流器",
      conflictIds: adjacency.get(CORE_ID) ?? []
    };
  }

  for (const device of devices) {
    const degree = adjacency.get(device.id)?.length ?? 0;
    if (degree > MAX_DEGREE[device.kind]) {
      return {
        parent,
        children,
        connected,
        adjacency,
        valid: false,
        reason:
          device.kind === "splitter" || device.kind === "switch"
            ? "这个装置最多连接一个输入和两个输出"
            : device.kind === "needle" ||
                device.kind === "mortar" ||
                device.kind === "prism"
              ? "炮塔必须位于线路末端"
              : "这个装置不能连接更多线路",
        conflictIds: [device.id]
      };
    }
  }

  while (queue.length > 0) {
    const node = queue.shift();
    if (node === undefined) {
      break;
    }
    const nodeChildren: number[] = [];
    for (const neighbor of adjacency.get(node) ?? []) {
      if (connected.has(neighbor)) {
        continue;
      }
      connected.add(neighbor);
      parent.set(neighbor, node);
      nodeChildren.push(neighbor);
      queue.push(neighbor);
    }
    children.set(node, nodeChildren);
  }

  for (const deviceId of connected) {
    if (deviceId === CORE_ID) {
      continue;
    }
    const device = deviceById.get(deviceId);
    if (!device) {
      continue;
    }
    const outputs = children.get(deviceId)?.length ?? 0;
    const maxOutputs =
      device.kind === "splitter" || device.kind === "switch"
        ? 2
        : device.kind === "needle" || device.kind === "mortar" || device.kind === "prism"
          ? 0
          : 1;
    if (outputs > maxOutputs) {
      return {
        parent,
        children,
        connected,
        adjacency,
        valid: false,
        reason:
          maxOutputs === 0
            ? "炮塔必须位于线路末端"
            : "只有分流器和切换器可以产生两条支路",
        conflictIds: [deviceId, ...(children.get(deviceId) ?? [])]
      };
    }
  }

  for (const device of devices) {
    if (!children.has(device.id)) {
      children.set(device.id, []);
    }
  }

  return {
    parent,
    children,
    connected,
    adjacency,
    valid: true,
    reason: "",
    conflictIds: []
  };
}

export function validatePlacement(
  state: GameState,
  kind: DeviceKind,
  cell: GridCoord,
  temporaryId: number
): PlacementResult {
  if (
    cell.x < 0 ||
    cell.y < 0 ||
    cell.x >= GRID_WIDTH ||
    cell.y >= GRID_HEIGHT
  ) {
    return { ok: false, message: "超出建造区域" };
  }

  if (sameCell(cell, CORE_CELL)) {
    return { ok: false, message: "核心位置不能建造" };
  }

  if (state.devices.some((device) => sameCell(device.cell, cell))) {
    return { ok: false, message: "这个格子已经被占用" };
  }

  if (kind !== "wire" && isRoadCell(cell)) {
    return { ok: false, message: "道路上只能铺设地下导线" };
  }

  if (!state.unlocks.has(kind)) {
    return { ok: false, message: "这个装置尚未解锁" };
  }

  if (state.buildPoints < DEVICE_COST[kind]) {
    return {
      ok: false,
      message: `建造点不足，还需要 ${Math.ceil(DEVICE_COST[kind] - state.buildPoints)}`
    };
  }

  const temporary: DeviceState = {
    id: temporaryId,
    kind,
    cell,
    frequency: "red",
    activeBranch: 0,
    autoAlternator: 0,
    energyStore: 0,
    bufferEnergy: 0,
    bufferFrequency: "neutral",
    cooldown: 0,
    disabledUntil: 0,
    offlineUntil: state.elapsed,
    targetId: null,
    previousFrequency: "neutral"
  };

  const topology = buildTopology([...state.devices, temporary]);
  if (!topology.valid) {
    return { ok: false, message: topology.reason, topology };
  }

  const neighbors = topology.adjacency.get(temporaryId) ?? [];
  if (neighbors.length === 0) {
    return { ok: false, message: "装置必须与现有线路相邻", topology };
  }

  return { ok: true, message: "", topology };
}

export function findDeviceAt(devices: DeviceState[], cell: GridCoord): DeviceState | undefined {
  return devices.find((device) => sameCell(device.cell, cell));
}

export function hasConnectedConsumer(
  topology: Topology,
  devices: DeviceState[]
): boolean {
  const byId = new Map(devices.map((device) => [device.id, device]));
  return [...topology.connected].some((id) => {
    const kind = byId.get(id)?.kind;
    return kind === "needle" || kind === "mortar" || kind === "prism";
  });
}

export function distributeEnergy(
  totalEnergy: number,
  primaryRatio = 0.5
): [number, number] {
  if (!Number.isFinite(totalEnergy) || totalEnergy < 0) {
    throw new Error("Energy must be a finite non-negative number");
  }
  if (!Number.isFinite(primaryRatio) || primaryRatio < 0 || primaryRatio > 1) {
    throw new Error("Split ratio must stay between zero and one");
  }
  return [totalEnergy * primaryRatio, totalEnergy * (1 - primaryRatio)];
}
