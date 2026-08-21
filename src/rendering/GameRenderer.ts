import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import {
  CELL_SIZE,
  CORE_CELL,
  GRID_HEIGHT,
  GRID_WIDTH,
  LANES,
  cellToWorld,
  isRoadCell,
  lanePointAt
} from "../game/config";
import {
  CORE_ID,
  type BuildTool,
  type DeviceState,
  type EnemyKind,
  type Frequency,
  type GameEvent,
  type GameState,
  type GridCoord,
  type JamZone,
  type ProjectileState,
  type PulseState,
  type Topology,
  type WorldPoint
} from "../game/types";

const COLORS = {
  background: 0x0c1215,
  platform: 0x1b272c,
  plate: 0x28363b,
  plateAlt: 0x223137,
  road: 0x152024,
  roadEdge: 0x405158,
  metal: 0x344148,
  metalDark: 0x182227,
  cyan: 0x55d8cd,
  cyanDim: 0x266963,
  red: 0xef6b61,
  blue: 0x6e9ee8,
  yellow: 0xe5ba57,
  neutral: 0xa8e4df,
  text: 0xe9f3f1
} as const;

interface Particle {
  mesh: THREE.Mesh<THREE.IcosahedronGeometry, THREE.MeshBasicMaterial>;
  velocity: THREE.Vector3;
  life: number;
  maxLife: number;
}

interface EffectRing {
  mesh: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  life: number;
  maxLife: number;
}

interface PresentationEnemy {
  group: THREE.Group;
  offset: number;
  speed: number;
}

function colorForFrequency(frequency: Frequency): number {
  if (frequency === "red") {
    return COLORS.red;
  }
  if (frequency === "blue") {
    return COLORS.blue;
  }
  if (frequency === "yellow") {
    return COLORS.yellow;
  }
  return COLORS.neutral;
}

function worldVector(point: WorldPoint): THREE.Vector3 {
  return new THREE.Vector3(point.x, point.y, point.z);
}

function expLerp(current: number, target: number, speed: number, delta: number): number {
  return THREE.MathUtils.lerp(current, target, 1 - Math.exp(-speed * delta));
}

export class GameRenderer {
  readonly canvas: HTMLCanvasElement;

  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.OrthographicCamera;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly composer: EffectComposer;
  private readonly bloomPass: UnrealBloomPass;
  private readonly world = new THREE.Group();
  private readonly deviceLayer = new THREE.Group();
  private readonly cableLayer = new THREE.Group();
  private readonly enemyLayer = new THREE.Group();
  private readonly pulseLayer = new THREE.Group();
  private readonly projectileLayer = new THREE.Group();
  private readonly effectLayer = new THREE.Group();
  private readonly jamLayer = new THREE.Group();
  private readonly presentationLayer = new THREE.Group();
  private readonly pickPlane: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointer = new THREE.Vector2();
  private readonly deviceGroups = new Map<number, THREE.Group>();
  private readonly enemyGroups = new Map<number, THREE.Group>();
  private readonly pulseGroups = new Map<number, THREE.Group>();
  private readonly projectileGroups = new Map<number, THREE.Group>();
  private readonly jamGroups = new Map<number, THREE.Group>();
  private readonly gateGroups: THREE.Group[] = [];
  private readonly particles: Particle[] = [];
  private readonly rings: EffectRing[] = [];
  private readonly glowTexture: THREE.CanvasTexture;
  private readonly previewGroup = new THREE.Group();
  private readonly selectionRing: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  private readonly resizeObserver: ResizeObserver;
  private readonly reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  private readonly cameraLookTarget = new THREE.Vector3(-1.1, 0, 1.15);
  private readonly presentationPath: GridCoord[] = [
    CORE_CELL,
    { x: 6, y: 5 },
    { x: 7, y: 5 },
    { x: 8, y: 5 },
    { x: 8, y: 6 }
  ];
  private readonly presentationPulses: THREE.Group[] = [];
  private readonly presentationEnemies: PresentationEnemy[] = [];
  private presentationTowerHead: THREE.Group | null = null;
  private presentationProjectile: THREE.Group | null = null;

  private topologyVersion = -1;
  private lastFrameTime = performance.now() / 1000;
  private coreGroup!: THREE.Group;
  private coreInner!: THREE.Mesh<THREE.IcosahedronGeometry, THREE.MeshStandardMaterial>;
  private coreRingA!: THREE.Mesh<THREE.TorusGeometry, THREE.MeshStandardMaterial>;
  private coreRingB!: THREE.Mesh<THREE.TorusGeometry, THREE.MeshStandardMaterial>;
  private coreLight!: THREE.PointLight;
  private previewCell: GridCoord | null = null;
  private previewValid = true;
  private previewTool: BuildTool = "wire";
  private shake = 0;
  private flash = 0;
  private presentationMode = true;
  private presentationBlend = 1;

  constructor(private readonly container: HTMLElement) {
    this.scene.background = new THREE.Color(COLORS.background);
    this.scene.fog = new THREE.FogExp2(COLORS.background, 0.032);
    this.scene.add(this.world);
    this.world.add(
      this.cableLayer,
      this.deviceLayer,
      this.enemyLayer,
      this.pulseLayer,
      this.projectileLayer,
      this.effectLayer,
      this.jamLayer,
      this.presentationLayer
    );

    const aspect = Math.max(1, container.clientWidth / Math.max(1, container.clientHeight));
    const viewHeight = 13.4;
    this.camera = new THREE.OrthographicCamera(
      (-viewHeight * aspect) / 2,
      (viewHeight * aspect) / 2,
      viewHeight / 2,
      -viewHeight / 2,
      0.1,
      80
    );
    this.camera.position.set(10.6, 14.8, 13.4);
    this.camera.lookAt(0, 0, 0.25);

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
      powerPreference: "high-performance"
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.7));
    this.renderer.setSize(container.clientWidth, container.clientHeight, false);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.94;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.canvas = this.renderer.domElement;
    this.canvas.className = "game-canvas";
    this.canvas.tabIndex = 0;
    this.canvas.setAttribute(
      "aria-label",
      "脉冲防线三维战场。使用底部工具栏选择装置，然后在网格上建造。"
    );
    container.append(this.canvas);

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloomPass = new UnrealBloomPass(
      new THREE.Vector2(container.clientWidth, container.clientHeight),
      0.5,
      0.44,
      0.78
    );
    this.composer.addPass(this.bloomPass);
    this.composer.addPass(new OutputPass());

    this.glowTexture = this.createGlowTexture();
    this.createLighting();
    this.createBoard();
    this.createRoads();
    this.createCore();
    this.createPresentationScene();
    this.createBackgroundDust();
    this.createEffectPools();

    const pickMaterial = new THREE.MeshBasicMaterial({
      transparent: true,
      opacity: 0,
      depthWrite: false,
      colorWrite: false
    });
    this.pickPlane = new THREE.Mesh(
      new THREE.PlaneGeometry(GRID_WIDTH * CELL_SIZE, GRID_HEIGHT * CELL_SIZE),
      pickMaterial
    );
    this.pickPlane.rotation.x = -Math.PI / 2;
    this.pickPlane.position.y = 0.36;
    this.world.add(this.pickPlane);

    this.createPreview();
    this.selectionRing = new THREE.Mesh(
      new THREE.RingGeometry(0.43, 0.5, 32),
      new THREE.MeshBasicMaterial({
        color: COLORS.cyan,
        transparent: true,
        opacity: 0.9,
        side: THREE.DoubleSide,
        depthWrite: false
      })
    );
    this.selectionRing.rotation.x = -Math.PI / 2;
    this.selectionRing.position.y = 0.18;
    this.selectionRing.visible = false;
    this.world.add(this.selectionRing);

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
  }

  dispose(): void {
    this.resizeObserver.disconnect();
    this.composer.dispose();
    this.renderer.dispose();
    this.glowTexture.dispose();
    this.container.replaceChildren();
  }

  setPresentationMode(enabled: boolean): void {
    this.presentationMode = enabled;
    if (enabled) {
      this.presentationLayer.visible = true;
    }
  }

  getCellFromPointer(clientX: number, clientY: number): GridCoord | null {
    const rect = this.canvas.getBoundingClientRect();
    this.pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hit = this.raycaster.intersectObject(this.pickPlane, false)[0];
    if (!hit) {
      return null;
    }
    const x = Math.round(hit.point.x / CELL_SIZE + (GRID_WIDTH - 1) / 2);
    const y = Math.round(hit.point.z / CELL_SIZE + (GRID_HEIGHT - 1) / 2);
    if (x < 0 || y < 0 || x >= GRID_WIDTH || y >= GRID_HEIGHT) {
      return null;
    }
    return { x, y };
  }

  getScreenPoint(cell: GridCoord): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect();
    const projected = worldVector(cellToWorld(cell, 0.38));
    projected.project(this.camera);
    return {
      x: rect.left + ((projected.x + 1) / 2) * rect.width,
      y: rect.top + ((1 - projected.y) / 2) * rect.height
    };
  }

  setBuildPreview(cell: GridCoord | null, valid: boolean, tool: BuildTool): void {
    this.previewCell = cell;
    this.previewValid = valid;
    this.previewTool = tool;
    this.previewGroup.visible = cell !== null;
    if (!cell) {
      return;
    }
    const position = cellToWorld(cell, 0.15);
    this.previewGroup.position.set(position.x, position.y, position.z);
    const color = tool === "remove" || !valid ? COLORS.red : COLORS.cyan;
    for (const child of this.previewGroup.children) {
      const mesh = child as THREE.Mesh;
      const material = mesh.material as THREE.MeshBasicMaterial;
      material.color.setHex(color);
    }
  }

  handleEvent(event: GameEvent): void {
    if (event.type === "build") {
      const position = cellToWorld(event.cell, 0.35);
      this.spawnParticles(position, COLORS.cyan, 12, 1.2);
      this.spawnRing(position, COLORS.cyan, 0.55);
    } else if (event.type === "remove") {
      this.spawnParticles(cellToWorld(event.cell, 0.3), COLORS.roadEdge, 8, 0.8);
    } else if (event.type === "hit") {
      this.spawnParticles(event.position, colorForFrequency(event.frequency), 3, 0.52);
    } else if (event.type === "kill") {
      const color = event.enemyKind === "boss" ? COLORS.cyan : COLORS.red;
      this.spawnParticles(event.position, color, event.enemyKind === "boss" ? 34 : 14, 1.8);
      this.spawnRing(event.position, color, event.enemyKind === "boss" ? 1.8 : 0.82);
      if (!this.reducedMotion.matches) {
        this.shake = Math.max(this.shake, event.enemyKind === "boss" ? 0.42 : 0.05);
      }
    } else if (event.type === "core-hit") {
      this.flash = 1;
      if (!this.reducedMotion.matches) {
        this.shake = Math.max(this.shake, Math.min(0.5, 0.12 + event.amount / 120));
      }
      this.spawnParticles(cellToWorld(CORE_CELL, 0.8), COLORS.red, 24, 1.5);
    } else if (event.type === "wave") {
      for (const lane of event.lanes) {
        const gate = this.gateGroups[lane];
        if (gate) {
          gate.userData.impact = 1;
        }
      }
    } else if (event.type === "jam-warning") {
      this.spawnRing(cellToWorld(event.zone.cell, 0.15), COLORS.yellow, 1.5);
    } else if (event.type === "jam-active") {
      this.spawnParticles(cellToWorld(event.zone.cell, 0.3), COLORS.red, 16, 1.2);
      if (!this.reducedMotion.matches) {
        this.shake = Math.max(this.shake, 0.11);
      }
    } else if (event.type === "boss") {
      this.shake = this.reducedMotion.matches ? 0 : 0.32;
      this.flash = 0.6;
    }
  }

  render(state: GameState, topology: Topology): void {
    const now = performance.now() / 1000;
    const delta = Math.min(0.05, now - this.lastFrameTime);
    this.lastFrameTime = now;

    this.syncDevices(state, topology, now, delta);
    this.syncEnemies(state, now, delta);
    this.syncPulses(state, now);
    this.syncProjectiles(state);
    this.syncJamZones(state, now);
    this.updatePresentation(now, delta);
    this.updateCore(state, now, delta);
    this.updateGates(state, now, delta);
    this.updateEffects(delta);
    this.updatePreview(now);
    this.updateSelection(state, now);

    if (this.topologyVersion !== state.topologyVersion) {
      this.rebuildCables(state, topology);
      this.topologyVersion = state.topologyVersion;
    }

    this.updateCamera(delta, now);
    this.bloomPass.strength = this.reducedMotion.matches
      ? 0.28
      : this.presentationMode
        ? 0.42
        : 0.36;
    this.composer.render();
  }

  private createLighting(): void {
    const hemisphere = new THREE.HemisphereLight(0xa9d4d0, 0x101619, 1.15);
    this.scene.add(hemisphere);

    const key = new THREE.DirectionalLight(0xe4f2ef, 2.7);
    key.position.set(-5, 13, 7);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.left = -10;
    key.shadow.camera.right = 10;
    key.shadow.camera.top = 10;
    key.shadow.camera.bottom = -10;
    key.shadow.bias = -0.0008;
    this.scene.add(key);

    const rim = new THREE.DirectionalLight(COLORS.cyan, 1.15);
    rim.position.set(9, 7, -8);
    this.scene.add(rim);
  }

  private createBoard(): void {
    const base = new THREE.Mesh(
      new RoundedBoxGeometry(
        GRID_WIDTH * CELL_SIZE + 1.3,
        0.52,
        GRID_HEIGHT * CELL_SIZE + 1.3,
        5,
        0.22
      ),
      new THREE.MeshStandardMaterial({
        color: COLORS.platform,
        roughness: 0.82,
        metalness: 0.6
      })
    );
    base.position.y = -0.43;
    base.receiveShadow = true;
    this.world.add(base);

    const plateGeometry = new RoundedBoxGeometry(
      CELL_SIZE * 0.91,
      0.13,
      CELL_SIZE * 0.91,
      3,
      0.08
    );
    for (let y = 0; y < GRID_HEIGHT; y += 1) {
      for (let x = 0; x < GRID_WIDTH; x += 1) {
        const road = isRoadCell({ x, y });
        const plate = new THREE.Mesh(
          plateGeometry,
          new THREE.MeshStandardMaterial({
            color: road
              ? COLORS.road
              : (x + y) % 2 === 0
                ? COLORS.plate
                : COLORS.plateAlt,
            roughness: road ? 0.9 : 0.72,
            metalness: road ? 0.45 : 0.68
          })
        );
        const position = cellToWorld({ x, y }, road ? -0.1 : -0.055);
        plate.position.set(position.x, position.y, position.z);
        plate.receiveShadow = true;
        this.world.add(plate);
      }
    }

    const borderMaterial = new THREE.MeshStandardMaterial({
      color: COLORS.roadEdge,
      metalness: 0.82,
      roughness: 0.42
    });
    const boardWidth = GRID_WIDTH * CELL_SIZE + 0.55;
    const boardDepth = GRID_HEIGHT * CELL_SIZE + 0.55;
    const horizontal = new THREE.BoxGeometry(boardWidth, 0.16, 0.1);
    const vertical = new THREE.BoxGeometry(0.1, 0.16, boardDepth);
    for (const z of [-boardDepth / 2, boardDepth / 2]) {
      const rail = new THREE.Mesh(horizontal, borderMaterial);
      rail.position.set(0, -0.04, z);
      this.world.add(rail);
    }
    for (const x of [-boardWidth / 2, boardWidth / 2]) {
      const rail = new THREE.Mesh(vertical, borderMaterial);
      rail.position.set(x, -0.04, 0);
      this.world.add(rail);
    }
  }

  private createRoads(): void {
    const roadMaterial = new THREE.MeshStandardMaterial({
      color: COLORS.road,
      emissive: 0x0d191b,
      emissiveIntensity: 0.35,
      roughness: 0.82,
      metalness: 0.48
    });

    for (const [laneIndex, lane] of LANES.entries()) {
      const points = lane.points.map((cell) => {
        const point = cellToWorld(cell, 0.02);
        return new THREE.Vector3(point.x, point.y, point.z);
      });
      const curve = new THREE.CatmullRomCurve3(points, false, "centripetal", 0.18);
      const road = new THREE.Mesh(
        new THREE.TubeGeometry(curve, 72, 0.36, 8, false),
        roadMaterial
      );
      road.scale.y = 0.12;
      road.receiveShadow = true;
      this.world.add(road);

      const gatePosition = points[0];
      const gate = new THREE.Group();
      gate.position.copy(gatePosition);
      gate.position.y = 0.16;
      const ringMaterial = new THREE.MeshStandardMaterial({
        color: COLORS.roadEdge,
        emissive: COLORS.cyanDim,
        emissiveIntensity: 0.25,
        metalness: 0.88,
        roughness: 0.28
      });
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.48, 0.08, 10, 32), ringMaterial);
      ring.rotation.x = Math.PI / 2;
      gate.add(ring);
      const light = new THREE.PointLight(COLORS.cyan, 0, 3);
      light.position.y = 0.42;
      gate.add(light);
      gate.userData.ring = ring;
      gate.userData.light = light;
      gate.userData.impact = 0;
      gate.userData.lane = laneIndex;
      this.gateGroups.push(gate);
      this.world.add(gate);
    }
  }

  private createCore(): void {
    const position = cellToWorld(CORE_CELL, 0.08);
    const group = new THREE.Group();
    group.position.set(position.x, position.y, position.z);

    const base = new THREE.Mesh(
      new RoundedBoxGeometry(0.94, 0.3, 0.94, 4, 0.12),
      new THREE.MeshStandardMaterial({
        color: COLORS.metalDark,
        metalness: 0.9,
        roughness: 0.3
      })
    );
    base.position.y = 0.12;
    base.castShadow = true;
    group.add(base);

    this.coreInner = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.34, 2),
      new THREE.MeshStandardMaterial({
        color: COLORS.cyan,
        emissive: COLORS.cyan,
        emissiveIntensity: 1.15,
        roughness: 0.2,
        metalness: 0.25
      })
    );
    this.coreInner.position.y = 0.64;
    group.add(this.coreInner);

    const ringMaterial = new THREE.MeshStandardMaterial({
      color: COLORS.neutral,
      emissive: COLORS.cyan,
      emissiveIntensity: 0.72,
      metalness: 0.85,
      roughness: 0.24
    });
    this.coreRingA = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.045, 10, 42), ringMaterial);
    this.coreRingA.position.y = 0.64;
    this.coreRingA.rotation.x = Math.PI / 2.4;
    group.add(this.coreRingA);

    this.coreRingB = new THREE.Mesh(
      new THREE.TorusGeometry(0.43, 0.035, 10, 42),
      ringMaterial.clone()
    );
    this.coreRingB.position.y = 0.64;
    this.coreRingB.rotation.z = Math.PI / 2.5;
    group.add(this.coreRingB);

    const glow = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: this.glowTexture,
        color: COLORS.cyan,
        blending: THREE.AdditiveBlending,
        transparent: true,
        opacity: 0.34,
        depthWrite: false
      })
    );
    glow.position.y = 0.64;
    glow.scale.setScalar(2.3);
    group.add(glow);

    this.coreLight = new THREE.PointLight(COLORS.cyan, 1.85, 5.5, 2);
    this.coreLight.position.y = 1;
    group.add(this.coreLight);
    this.coreGroup = group;
    this.world.add(group);
  }

  private createPresentationScene(): void {
    for (let index = 1; index < this.presentationPath.length; index += 1) {
      this.presentationLayer.add(
        this.createCable(this.presentationPath[index - 1], this.presentationPath[index])
      );
    }
    this.presentationLayer.add(this.createCable({ x: 7, y: 5 }, { x: 7, y: 4 }));

    const demoDevices: Array<{ kind: DeviceState["kind"]; cell: GridCoord }> = [
      { kind: "wire", cell: { x: 6, y: 5 } },
      { kind: "wire", cell: { x: 7, y: 5 } },
      { kind: "splitter", cell: { x: 8, y: 5 } },
      { kind: "capacitor", cell: { x: 7, y: 4 } },
      { kind: "needle", cell: { x: 8, y: 6 } }
    ];

    demoDevices.forEach(({ kind, cell }, index) => {
      const device: DeviceState = {
        id: 9000 + index,
        kind,
        cell,
        frequency: "neutral",
        activeBranch: 0,
        autoAlternator: 0,
        energyStore: kind === "capacitor" ? 2.2 : 0,
        bufferEnergy: 0,
        bufferFrequency: "neutral",
        cooldown: 0,
        disabledUntil: 0,
        offlineUntil: 0,
        targetId: kind === "needle" ? 9900 : null,
        previousFrequency: "neutral"
      };
      const group = this.createDeviceGroup(device);
      const position = cellToWorld(cell, 0.08);
      group.position.set(position.x, position.y, position.z);
      group.scale.setScalar(1);
      if (kind === "needle") {
        this.presentationTowerHead = group.userData.turretHead as THREE.Group;
      }
      this.presentationLayer.add(group);
    });

    for (let index = 0; index < 3; index += 1) {
      const pulse = this.createPulseGroup({
        id: 9100 + index,
        fromId: CORE_ID,
        toId: 9000,
        progress: 0,
        energy: 1.4,
        frequency: "neutral"
      });
      this.presentationPulses.push(pulse);
      this.presentationLayer.add(pulse);
    }

    const enemyKinds: EnemyKind[] = ["runner", "swarm", "armored"];
    enemyKinds.forEach((kind, index) => {
      const group = this.createEnemyGroup(kind);
      group.scale.setScalar(kind === "armored" ? 0.92 : 1);
      const healthRoot = group.userData.healthRoot as THREE.Group | undefined;
      if (healthRoot) {
        healthRoot.visible = false;
      }
      this.presentationEnemies.push({
        group,
        offset: index * 0.24,
        speed: 0.038 + index * 0.004
      });
      this.presentationLayer.add(group);
    });

    this.presentationProjectile = this.createPulseGroup({
      id: 9200,
      fromId: 9004,
      toId: 9900,
      progress: 0,
      energy: 0.8,
      frequency: "neutral"
    });
    this.presentationProjectile.scale.setScalar(0.72);
    this.presentationLayer.add(this.presentationProjectile);
  }

  private updatePresentation(now: number, delta: number): void {
    const target = this.presentationMode ? 1 : 0;
    this.presentationBlend = expLerp(this.presentationBlend, target, 5.6, delta);
    if (!this.presentationMode && this.presentationBlend < 0.018) {
      this.presentationLayer.visible = false;
      return;
    }

    this.presentationLayer.visible = true;
    const blend = this.presentationBlend;
    this.presentationLayer.scale.setScalar(0.93 + blend * 0.07);
    this.presentationLayer.position.y = (1 - blend) * -0.3;

    const motionTime = this.reducedMotion.matches ? 0 : now;
    for (const [index, pulse] of this.presentationPulses.entries()) {
      const pathProgress = (motionTime * 0.24 + index / this.presentationPulses.length) % 1;
      const scaled = pathProgress * (this.presentationPath.length - 1);
      const segment = Math.min(this.presentationPath.length - 2, Math.floor(scaled));
      const progress = scaled - segment;
      const from = cellToWorld(this.presentationPath[segment], segment === 0 ? 0.66 : 0.32);
      const to = cellToWorld(this.presentationPath[segment + 1], 0.32);
      pulse.position.lerpVectors(worldVector(from), worldVector(to), progress);
      pulse.position.y += Math.sin(progress * Math.PI) * 0.08;
      pulse.scale.setScalar(0.72 + Math.sin(motionTime * 5 + index) * 0.06);
    }

    for (const enemy of this.presentationEnemies) {
      const progress = 0.04 + ((motionTime * enemy.speed + enemy.offset) % 0.58);
      const position = lanePointAt(2, progress);
      const future = lanePointAt(2, Math.min(0.66, progress + 0.012));
      enemy.group.position.set(position.x, 0.3, position.z);
      enemy.group.rotation.y = Math.atan2(future.x - position.x, future.z - position.z);
      const body = enemy.group.userData.body as THREE.Object3D;
      body.position.y =
        (enemy.group.userData.baseBodyY as number) + Math.sin(motionTime * 6 + enemy.offset * 20) * 0.04;
    }

    const leadEnemy = this.presentationEnemies[0]?.group;
    if (leadEnemy && this.presentationTowerHead) {
      const towerPosition = cellToWorld({ x: 8, y: 6 }, 0.68);
      this.presentationTowerHead.rotation.y = Math.atan2(
        leadEnemy.position.x - towerPosition.x,
        leadEnemy.position.z - towerPosition.z
      );
    }

    if (leadEnemy && this.presentationProjectile) {
      const cycle = (motionTime * 0.72) % 1;
      this.presentationProjectile.visible = cycle < 0.62;
      if (this.presentationProjectile.visible) {
        const progress = THREE.MathUtils.smoothstep(cycle / 0.62, 0, 1);
        const from = worldVector(cellToWorld({ x: 8, y: 6 }, 0.68));
        const to = leadEnemy.position.clone().add(new THREE.Vector3(0, 0.32, 0));
        this.presentationProjectile.position.lerpVectors(from, to, progress);
      }
    }
  }

  private createBackgroundDust(): void {
    const count = 260;
    const positions = new Float32Array(count * 3);
    let seed = 0x73ab31;
    const random = (): number => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 0xffffffff;
    };
    for (let index = 0; index < count; index += 1) {
      positions[index * 3] = (random() - 0.5) * 30;
      positions[index * 3 + 1] = random() * 8 + 0.5;
      positions[index * 3 + 2] = (random() - 0.5) * 30;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const points = new THREE.Points(
      geometry,
      new THREE.PointsMaterial({
        color: 0x7aa39f,
        size: 0.025,
        transparent: true,
        opacity: 0.26,
        depthWrite: false
      })
    );
    points.userData.dust = true;
    this.scene.add(points);
  }

  private createEffectPools(): void {
    const geometry = new THREE.IcosahedronGeometry(0.045, 0);
    for (let index = 0; index < 180; index += 1) {
      const material = new THREE.MeshBasicMaterial({
        color: COLORS.cyan,
        transparent: true,
        opacity: 1,
        blending: THREE.AdditiveBlending,
        depthWrite: false
      });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.visible = false;
      this.effectLayer.add(mesh);
      this.particles.push({
        mesh,
        velocity: new THREE.Vector3(),
        life: 0,
        maxLife: 1
      });
    }

    for (let index = 0; index < 18; index += 1) {
      const mesh = new THREE.Mesh(
        new THREE.RingGeometry(0.25, 0.3, 36),
        new THREE.MeshBasicMaterial({
          color: COLORS.cyan,
          transparent: true,
          opacity: 0,
          blending: THREE.AdditiveBlending,
          side: THREE.DoubleSide,
          depthWrite: false
        })
      );
      mesh.rotation.x = -Math.PI / 2;
      mesh.visible = false;
      this.effectLayer.add(mesh);
      this.rings.push({ mesh, life: 0, maxLife: 1 });
    }
  }

  private createPreview(): void {
    const plate = new THREE.Mesh(
      new RoundedBoxGeometry(0.84, 0.05, 0.84, 3, 0.08),
      new THREE.MeshBasicMaterial({
        color: COLORS.cyan,
        transparent: true,
        opacity: 0.22,
        depthWrite: false
      })
    );
    const marker = new THREE.Mesh(
      new THREE.TorusGeometry(0.32, 0.028, 8, 24),
      new THREE.MeshBasicMaterial({
        color: COLORS.cyan,
        transparent: true,
        opacity: 0.9,
        depthWrite: false
      })
    );
    marker.rotation.x = Math.PI / 2;
    marker.position.y = 0.1;
    this.previewGroup.add(plate, marker);
    this.previewGroup.visible = false;
    this.world.add(this.previewGroup);
  }

  private createGlowTexture(): THREE.CanvasTexture {
    const canvas = document.createElement("canvas");
    canvas.width = 128;
    canvas.height = 128;
    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error("Canvas 2D context is unavailable");
    }
    const gradient = context.createRadialGradient(64, 64, 0, 64, 64, 64);
    gradient.addColorStop(0, "rgba(255,255,255,1)");
    gradient.addColorStop(0.16, "rgba(255,255,255,.72)");
    gradient.addColorStop(0.45, "rgba(255,255,255,.18)");
    gradient.addColorStop(1, "rgba(255,255,255,0)");
    context.fillStyle = gradient;
    context.fillRect(0, 0, 128, 128);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  }

  private syncDevices(
    state: GameState,
    topology: Topology,
    now: number,
    delta: number
  ): void {
    const liveIds = new Set(state.devices.map((device) => device.id));
    for (const [id, group] of this.deviceGroups) {
      if (!liveIds.has(id)) {
        this.deviceLayer.remove(group);
        this.disposeObject(group);
        this.deviceGroups.delete(id);
      }
    }

    for (const device of state.devices) {
      let group = this.deviceGroups.get(device.id);
      if (!group) {
        group = this.createDeviceGroup(device);
        this.deviceGroups.set(device.id, group);
        this.deviceLayer.add(group);
      }
      const position = cellToWorld(device.cell, 0.08);
      group.position.set(position.x, position.y, position.z);
      const powered =
        topology.connected.has(device.id) &&
        device.offlineUntil <= state.elapsed &&
        device.disabledUntil <= state.elapsed;
      const targetScale = 1;
      const scale = expLerp(group.scale.x, targetScale, 13, delta);
      group.scale.setScalar(scale);
      group.userData.powered = powered;
      this.updateDeviceGroup(group, device, state, now, powered);
    }
  }

  private createDeviceGroup(device: DeviceState): THREE.Group {
    const group = new THREE.Group();
    group.scale.setScalar(0.02);
    group.userData.kind = device.kind;
    group.userData.powerMaterials = [] as THREE.MeshStandardMaterial[];

    const baseMaterial = new THREE.MeshStandardMaterial({
      color: COLORS.metalDark,
      metalness: 0.84,
      roughness: 0.35
    });
    const base = new THREE.Mesh(
      new RoundedBoxGeometry(0.72, 0.16, 0.72, 3, 0.08),
      baseMaterial
    );
    base.position.y = 0.1;
    base.castShadow = true;
    base.receiveShadow = true;
    group.add(base);

    const powerMaterial = new THREE.MeshStandardMaterial({
      color: COLORS.cyan,
      emissive: COLORS.cyan,
      emissiveIntensity: 0.9,
      metalness: 0.52,
      roughness: 0.25
    });
    (group.userData.powerMaterials as THREE.MeshStandardMaterial[]).push(powerMaterial);

    if (device.kind === "wire") {
      const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.17, 0.12, 12), powerMaterial);
      hub.position.y = 0.23;
      group.add(hub);
    } else if (device.kind === "splitter") {
      const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.3, 0.24, 6), powerMaterial);
      hub.position.y = 0.31;
      hub.castShadow = true;
      group.add(hub);
      const rotor = new THREE.Mesh(
        new THREE.TorusGeometry(0.25, 0.035, 8, 24),
        powerMaterial.clone()
      );
      rotor.rotation.x = Math.PI / 2;
      rotor.position.y = 0.47;
      group.add(rotor);
      group.userData.rotor = rotor;
    } else if (device.kind === "capacitor") {
      const shell = new THREE.Mesh(
        new THREE.CylinderGeometry(0.27, 0.27, 0.52, 18, 1, true),
        new THREE.MeshStandardMaterial({
          color: COLORS.metal,
          transparent: true,
          opacity: 0.5,
          metalness: 0.7,
          roughness: 0.25,
          side: THREE.DoubleSide
        })
      );
      shell.position.y = 0.45;
      group.add(shell);
      const fill = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.36, 16), powerMaterial);
      fill.position.y = 0.31;
      fill.scale.y = 0.05;
      group.add(fill);
      group.userData.fill = fill;
      for (const height of [0.23, 0.45, 0.67]) {
        const ring = new THREE.Mesh(
          new THREE.TorusGeometry(0.29, 0.025, 8, 24),
          baseMaterial.clone()
        );
        ring.rotation.x = Math.PI / 2;
        ring.position.y = height;
        group.add(ring);
      }
    } else if (device.kind === "dyer") {
      const crystal = new THREE.Mesh(new THREE.OctahedronGeometry(0.28, 0), powerMaterial);
      crystal.position.y = 0.48;
      crystal.castShadow = true;
      group.add(crystal);
      group.userData.crystal = crystal;
      const halo = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: this.glowTexture,
          color: COLORS.red,
          transparent: true,
          opacity: 0.42,
          blending: THREE.AdditiveBlending,
          depthWrite: false
        })
      );
      halo.position.y = 0.48;
      halo.scale.setScalar(1.25);
      group.add(halo);
      group.userData.halo = halo;
    } else if (device.kind === "switch") {
      const pivot = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 0.22, 12), powerMaterial);
      pivot.position.y = 0.3;
      group.add(pivot);
      const lever = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.11, 0.48), powerMaterial.clone());
      lever.position.y = 0.48;
      lever.castShadow = true;
      group.add(lever);
      group.userData.lever = lever;
    } else {
      this.createTowerParts(group, device.kind, powerMaterial, baseMaterial);
    }

    const status = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: this.glowTexture,
        color: COLORS.cyan,
        transparent: true,
        opacity: 0.18,
        blending: THREE.AdditiveBlending,
        depthWrite: false
      })
    );
    status.position.y = 0.38;
    status.scale.setScalar(1.25);
    group.add(status);
    group.userData.status = status;
    return group;
  }

  private createTowerParts(
    group: THREE.Group,
    kind: "needle" | "mortar" | "prism",
    powerMaterial: THREE.MeshStandardMaterial,
    baseMaterial: THREE.MeshStandardMaterial
  ): void {
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.26, 0.38, 12), baseMaterial);
    stem.position.y = 0.37;
    stem.castShadow = true;
    group.add(stem);

    const head = new THREE.Group();
    head.position.y = 0.6;
    group.add(head);
    group.userData.turretHead = head;

    if (kind === "needle") {
      const body = new THREE.Mesh(
        new RoundedBoxGeometry(0.38, 0.23, 0.42, 3, 0.07),
        powerMaterial
      );
      body.castShadow = true;
      head.add(body);
      const barrelMaterial = powerMaterial.clone();
      const barrels = new THREE.Group();
      for (const offset of [-0.09, 0.09]) {
        const barrel = new THREE.Mesh(
          new THREE.CylinderGeometry(0.025, 0.035, 0.46, 8),
          barrelMaterial
        );
        barrel.rotation.x = Math.PI / 2;
        barrel.position.set(offset, 0, -0.31);
        barrels.add(barrel);
      }
      head.add(barrels);
    } else if (kind === "mortar") {
      const cradle = new THREE.Mesh(
        new RoundedBoxGeometry(0.48, 0.28, 0.42, 3, 0.08),
        baseMaterial.clone()
      );
      head.add(cradle);
      const barrel = new THREE.Mesh(
        new THREE.CylinderGeometry(0.1, 0.15, 0.55, 14),
        powerMaterial
      );
      barrel.rotation.x = Math.PI / 3.2;
      barrel.position.set(0, 0.2, -0.12);
      barrel.castShadow = true;
      head.add(barrel);
    } else {
      const prism = new THREE.Mesh(new THREE.OctahedronGeometry(0.31, 0), powerMaterial);
      prism.rotation.z = Math.PI / 4;
      prism.castShadow = true;
      head.add(prism);
      group.userData.crystal = prism;
      const orbit = new THREE.Mesh(
        new THREE.TorusGeometry(0.39, 0.025, 8, 30),
        powerMaterial.clone()
      );
      orbit.rotation.x = Math.PI / 2;
      head.add(orbit);
      group.userData.rotor = orbit;
    }
  }

  private updateDeviceGroup(
    group: THREE.Group,
    device: DeviceState,
    state: GameState,
    now: number,
    powered: boolean
  ): void {
    const jammed = device.disabledUntil > state.elapsed;
    const frequencyColor = colorForFrequency(device.frequency);
    for (const material of group.userData.powerMaterials as THREE.MeshStandardMaterial[]) {
      material.color.setHex(jammed ? COLORS.red : powered ? COLORS.cyan : COLORS.metal);
      material.emissive.setHex(jammed ? COLORS.red : powered ? COLORS.cyan : COLORS.cyanDim);
      material.emissiveIntensity = jammed
        ? 1.2 + Math.sin(now * 18) * 0.45
        : powered
          ? 0.82
          : 0.08;
    }

    const status = group.userData.status as THREE.Sprite | undefined;
    if (status) {
      const material = status.material as THREE.SpriteMaterial;
      material.color.setHex(jammed ? COLORS.red : COLORS.cyan);
      material.opacity = jammed ? 0.46 : powered ? 0.22 : 0.05;
    }

    const rotor = group.userData.rotor as THREE.Object3D | undefined;
    if (rotor && !this.reducedMotion.matches) {
      rotor.rotation.z += powered ? 0.016 : 0.003;
    }

    const fill = group.userData.fill as THREE.Mesh | undefined;
    if (fill) {
      const threshold = state.upgrades.has("quick-capacitor")
        ? 2
        : state.upgrades.has("deep-capacitor")
          ? 5
          : 3;
      const amount = Math.min(1, device.energyStore / threshold);
      fill.scale.y = Math.max(0.04, amount);
      fill.position.y = 0.22 + 0.18 * amount;
    }

    const crystal = group.userData.crystal as THREE.Mesh | undefined;
    if (crystal) {
      if (!this.reducedMotion.matches) {
        crystal.rotation.y = now * 1.1;
      }
      if (device.kind === "dyer") {
        const material = crystal.material as THREE.MeshStandardMaterial;
        material.color.setHex(frequencyColor);
        material.emissive.setHex(frequencyColor);
        const halo = group.userData.halo as THREE.Sprite | undefined;
        if (halo) {
          (halo.material as THREE.SpriteMaterial).color.setHex(frequencyColor);
        }
      }
    }

    const lever = group.userData.lever as THREE.Mesh | undefined;
    if (lever) {
      lever.rotation.y = expLerp(
        lever.rotation.y,
        device.activeBranch === 0 ? -0.62 : 0.62,
        12,
        1 / 60
      );
    }

    const head = group.userData.turretHead as THREE.Group | undefined;
    if (head && device.targetId !== null) {
      const enemy = state.enemies.find((entry) => entry.id === device.targetId);
      if (enemy) {
        const target = lanePointAt(enemy.lane, enemy.pathProgress);
        head.rotation.y = Math.atan2(target.x - group.position.x, target.z - group.position.z);
      }
    }

    group.position.y += jammed && !this.reducedMotion.matches ? Math.sin(now * 24) * 0.018 : 0;
  }

  private syncEnemies(state: GameState, now: number, delta: number): void {
    const liveIds = new Set(state.enemies.map((enemy) => enemy.id));
    for (const [id, group] of this.enemyGroups) {
      if (!liveIds.has(id)) {
        this.enemyLayer.remove(group);
        this.disposeObject(group);
        this.enemyGroups.delete(id);
      }
    }

    for (const enemy of state.enemies) {
      let group = this.enemyGroups.get(enemy.id);
      if (!group) {
        group = this.createEnemyGroup(enemy.kind);
        group.scale.setScalar(0.03);
        this.enemyGroups.set(enemy.id, group);
        this.enemyLayer.add(group);
      }
      const position = lanePointAt(enemy.lane, enemy.pathProgress);
      const future = lanePointAt(enemy.lane, Math.min(1, enemy.pathProgress + 0.01));
      group.position.set(position.x, 0.3, position.z);
      group.rotation.y = Math.atan2(future.x - position.x, future.z - position.z);
      const baseScale = enemy.kind === "boss" ? 1.55 : 1;
      const spawnScale = expLerp(group.scale.x, baseScale, 9, delta);
      group.scale.setScalar(spawnScale);
      const bob = this.reducedMotion.matches ? 0 : Math.sin(now * 6 + enemy.id) * 0.045;
      (group.userData.body as THREE.Object3D).position.y =
        (group.userData.baseBodyY as number) + bob;
      const rotor = group.userData.rotor as THREE.Object3D | undefined;
      if (rotor && !this.reducedMotion.matches) {
        rotor.rotation.z += delta * (enemy.kind === "boss" ? 1.2 : 3.4);
      }
      const bodyMaterial = group.userData.bodyMaterial as THREE.MeshStandardMaterial;
      if (enemy.burnTime > 0) {
        bodyMaterial.emissive.setHex(COLORS.red);
        bodyMaterial.emissiveIntensity = 0.65;
      } else if (enemy.slowTime > 0) {
        bodyMaterial.emissive.setHex(COLORS.blue);
        bodyMaterial.emissiveIntensity = 0.48;
      } else {
        bodyMaterial.emissive.setHex(enemy.kind === "boss" ? COLORS.red : 0x3c1715);
        bodyMaterial.emissiveIntensity = enemy.kind === "boss" ? 0.5 : 0.18;
      }
      const healthFill = group.userData.healthFill as THREE.Mesh | undefined;
      const healthRoot = group.userData.healthRoot as THREE.Group | undefined;
      if (healthFill && healthRoot) {
        const ratio = Math.max(0, enemy.hp / enemy.maxHp);
        healthFill.scale.x = ratio;
        healthFill.position.x = -0.28 * (1 - ratio);
        healthRoot.quaternion.copy(this.camera.quaternion);
        healthRoot.visible = ratio < 0.995 || enemy.kind === "boss";
      }
    }
  }

  private createEnemyGroup(kind: EnemyKind): THREE.Group {
    const group = new THREE.Group();
    const bodyColor =
      kind === "armored"
        ? 0x695047
        : kind === "disruptor"
          ? 0x664245
          : kind === "boss"
            ? 0x713832
            : 0x8a433b;
    const material = new THREE.MeshStandardMaterial({
      color: bodyColor,
      emissive: 0x3c1715,
      emissiveIntensity: 0.18,
      metalness: kind === "armored" || kind === "boss" ? 0.72 : 0.38,
      roughness: kind === "armored" ? 0.38 : 0.56
    });
    let body: THREE.Mesh;
    if (kind === "swarm") {
      body = new THREE.Mesh(new THREE.IcosahedronGeometry(0.22, 1), material);
    } else if (kind === "runner") {
      body = new THREE.Mesh(new THREE.ConeGeometry(0.25, 0.58, 5), material);
      body.rotation.x = Math.PI / 2;
    } else if (kind === "armored") {
      body = new THREE.Mesh(new RoundedBoxGeometry(0.5, 0.38, 0.64, 3, 0.1), material);
    } else if (kind === "disruptor") {
      body = new THREE.Mesh(new THREE.OctahedronGeometry(0.34, 0), material);
    } else {
      body = new THREE.Mesh(new THREE.DodecahedronGeometry(0.5, 1), material);
    }
    body.position.y = kind === "boss" ? 0.42 : 0.22;
    body.castShadow = true;
    group.add(body);
    group.userData.body = body;
    group.userData.baseBodyY = body.position.y;
    group.userData.bodyMaterial = material;

    if (kind === "swarm") {
      const legMaterial = new THREE.MeshStandardMaterial({
        color: 0x4a2825,
        metalness: 0.3,
        roughness: 0.7
      });
      for (const side of [-1, 1]) {
        for (const offset of [-0.13, 0.13]) {
          const leg = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.045, 0.045), legMaterial);
          leg.position.set(side * 0.22, 0.14, offset);
          leg.rotation.z = side * -0.38;
          group.add(leg);
        }
      }
    }

    if (kind === "disruptor" || kind === "boss") {
      const rotor = new THREE.Mesh(
        new THREE.TorusGeometry(kind === "boss" ? 0.68 : 0.43, 0.035, 8, 28),
        new THREE.MeshStandardMaterial({
          color: COLORS.yellow,
          emissive: COLORS.yellow,
          emissiveIntensity: 0.85,
          metalness: 0.7,
          roughness: 0.25
        })
      );
      rotor.position.y = kind === "boss" ? 0.44 : 0.24;
      rotor.rotation.x = Math.PI / 2.4;
      group.add(rotor);
      group.userData.rotor = rotor;
    }

    const healthRoot = new THREE.Group();
    healthRoot.position.set(0, kind === "boss" ? 1.08 : 0.65, 0);
    const healthBack = new THREE.Mesh(
      new THREE.PlaneGeometry(0.62, 0.055),
      new THREE.MeshBasicMaterial({
        color: 0x101719,
        transparent: true,
        opacity: 0.86,
        depthTest: false
      })
    );
    const healthFill = new THREE.Mesh(
      new THREE.PlaneGeometry(0.56, 0.032),
      new THREE.MeshBasicMaterial({
        color: kind === "boss" ? COLORS.yellow : COLORS.red,
        depthTest: false
      })
    );
    healthFill.position.z = 0.002;
    healthRoot.add(healthBack, healthFill);
    group.add(healthRoot);
    group.userData.healthRoot = healthRoot;
    group.userData.healthFill = healthFill;
    return group;
  }

  private syncPulses(state: GameState, now: number): void {
    const liveIds = new Set(state.pulses.map((pulse) => pulse.id));
    for (const [id, group] of this.pulseGroups) {
      if (!liveIds.has(id)) {
        this.pulseLayer.remove(group);
        this.disposeObject(group);
        this.pulseGroups.delete(id);
      }
    }

    const deviceById = new Map(state.devices.map((device) => [device.id, device]));
    for (const pulse of state.pulses) {
      let group = this.pulseGroups.get(pulse.id);
      if (!group) {
        group = this.createPulseGroup(pulse);
        this.pulseGroups.set(pulse.id, group);
        this.pulseLayer.add(group);
      }
      const fromCell = pulse.fromId === CORE_ID ? CORE_CELL : deviceById.get(pulse.fromId)?.cell;
      const toCell = deviceById.get(pulse.toId)?.cell;
      if (!fromCell || !toCell) {
        continue;
      }
      const from = cellToWorld(fromCell, pulse.fromId === CORE_ID ? 0.66 : 0.32);
      const to = cellToWorld(toCell, 0.32);
      group.position.lerpVectors(worldVector(from), worldVector(to), pulse.progress);
      group.position.y += this.reducedMotion.matches
        ? 0
        : Math.sin(pulse.progress * Math.PI) * 0.09 + Math.sin(now * 10 + pulse.id) * 0.015;
      const targetScale = Math.min(1.75, 0.62 + Math.sqrt(pulse.energy) * 0.34);
      group.scale.setScalar(targetScale);
    }
  }

  private createPulseGroup(pulse: PulseState): THREE.Group {
    const color = colorForFrequency(pulse.frequency);
    const group = new THREE.Group();
    const orb = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.075, 1),
      new THREE.MeshBasicMaterial({
        color,
        blending: THREE.AdditiveBlending,
        depthWrite: false
      })
    );
    const glow = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: this.glowTexture,
        color,
        transparent: true,
        opacity: 0.62,
        blending: THREE.AdditiveBlending,
        depthWrite: false
      })
    );
    glow.scale.setScalar(0.52);
    group.add(glow, orb);
    return group;
  }

  private syncProjectiles(state: GameState): void {
    const liveIds = new Set(state.projectiles.map((projectile) => projectile.id));
    for (const [id, group] of this.projectileGroups) {
      if (!liveIds.has(id)) {
        this.projectileLayer.remove(group);
        this.disposeObject(group);
        this.projectileGroups.delete(id);
      }
    }

    const enemyById = new Map(state.enemies.map((enemy) => [enemy.id, enemy]));
    for (const projectile of state.projectiles) {
      let group = this.projectileGroups.get(projectile.id);
      if (!group) {
        group = this.createProjectileGroup(projectile);
        this.projectileGroups.set(projectile.id, group);
        this.projectileLayer.add(group);
      }
      const enemy = enemyById.get(projectile.targetId);
      if (!enemy) {
        continue;
      }
      const target = lanePointAt(enemy.lane, enemy.pathProgress);
      target.y = 0.48;
      group.position.lerpVectors(
        worldVector(projectile.start),
        worldVector(target),
        projectile.progress
      );
      if (projectile.towerKind === "mortar") {
        group.position.y += Math.sin(projectile.progress * Math.PI) * 1.8;
        group.rotation.x += 0.18;
        group.rotation.z += 0.12;
      }
    }
  }

  private createProjectileGroup(projectile: ProjectileState): THREE.Group {
    const group = new THREE.Group();
    const color = colorForFrequency(projectile.frequency);
    const size = projectile.towerKind === "mortar" ? 0.13 : 0.055;
    const projectileMesh = new THREE.Mesh(
      new THREE.IcosahedronGeometry(size, 0),
      new THREE.MeshBasicMaterial({
        color,
        blending: THREE.AdditiveBlending,
        depthWrite: false
      })
    );
    if (projectile.towerKind === "needle") {
      projectileMesh.scale.set(0.5, 0.5, 2.6);
    }
    const glow = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: this.glowTexture,
        color,
        transparent: true,
        opacity: projectile.towerKind === "mortar" ? 0.65 : 0.42,
        blending: THREE.AdditiveBlending,
        depthWrite: false
      })
    );
    glow.scale.setScalar(projectile.towerKind === "mortar" ? 0.72 : 0.32);
    group.add(glow, projectileMesh);
    return group;
  }

  private syncJamZones(state: GameState, now: number): void {
    const liveIds = new Set(state.jamZones.map((zone) => zone.id));
    for (const [id, group] of this.jamGroups) {
      if (!liveIds.has(id)) {
        this.jamLayer.remove(group);
        this.disposeObject(group);
        this.jamGroups.delete(id);
      }
    }

    for (const zone of state.jamZones) {
      let group = this.jamGroups.get(zone.id);
      if (!group) {
        group = this.createJamGroup(zone);
        this.jamGroups.set(zone.id, group);
        this.jamLayer.add(group);
      }
      const centerCell = {
        x: zone.cell.x + (zone.size - 1) / 2,
        y: zone.cell.y + (zone.size - 1) / 2
      };
      const position = cellToWorld(centerCell, 0.12);
      group.position.set(position.x, position.y, position.z);
      const active = zone.activated;
      const border = group.userData.border as THREE.Mesh;
      const fill = group.userData.fill as THREE.Mesh;
      (border.material as THREE.MeshBasicMaterial).color.setHex(active ? COLORS.red : COLORS.yellow);
      (fill.material as THREE.MeshBasicMaterial).color.setHex(active ? COLORS.red : COLORS.yellow);
      (fill.material as THREE.MeshBasicMaterial).opacity = active
        ? 0.16 + Math.sin(now * 14) * 0.05
        : 0.07 + Math.sin(now * 8) * 0.03;
      const pulse = this.reducedMotion.matches ? 1 : 1 + Math.sin(now * 9) * 0.025;
      group.scale.set(pulse, 1, pulse);
    }
  }

  private createJamGroup(zone: JamZone): THREE.Group {
    const group = new THREE.Group();
    const size = zone.size * CELL_SIZE - 0.12;
    const fill = new THREE.Mesh(
      new THREE.PlaneGeometry(size, size),
      new THREE.MeshBasicMaterial({
        color: COLORS.yellow,
        transparent: true,
        opacity: 0.08,
        side: THREE.DoubleSide,
        depthWrite: false
      })
    );
    fill.rotation.x = -Math.PI / 2;
    const border = new THREE.Mesh(
      new THREE.BoxGeometry(size, 0.04, size),
      new THREE.MeshBasicMaterial({
        color: COLORS.yellow,
        transparent: true,
        opacity: 0.22,
        wireframe: true,
        depthWrite: false
      })
    );
    group.add(fill, border);
    group.userData.fill = fill;
    group.userData.border = border;
    return group;
  }

  private rebuildCables(state: GameState, topology: Topology): void {
    this.disposeObject(this.cableLayer);
    this.cableLayer.clear();
    const byId = new Map(state.devices.map((device) => [device.id, device]));
    for (const [childId, parentId] of topology.parent) {
      const child = byId.get(childId);
      const parentCell = parentId === CORE_ID ? CORE_CELL : byId.get(parentId)?.cell;
      if (!child || !parentCell) {
        continue;
      }
      this.cableLayer.add(this.createCable(parentCell, child.cell));
    }
  }

  private createCable(fromCell: GridCoord, toCell: GridCoord): THREE.Group {
    const from = worldVector(cellToWorld(fromCell, 0.2));
    const to = worldVector(cellToWorld(toCell, 0.2));
    const direction = to.clone().sub(from);
    const length = direction.length();
    const midpoint = from.clone().add(to).multiplyScalar(0.5);
    const quaternion = new THREE.Quaternion().setFromUnitVectors(
      new THREE.Vector3(0, 1, 0),
      direction.clone().normalize()
    );
    const group = new THREE.Group();

    const sheath = new THREE.Mesh(
      new THREE.CylinderGeometry(0.065, 0.065, length * 0.82, 8),
      new THREE.MeshStandardMaterial({
        color: COLORS.metalDark,
        metalness: 0.82,
        roughness: 0.38
      })
    );
    sheath.position.copy(midpoint);
    sheath.quaternion.copy(quaternion);
    sheath.castShadow = true;
    group.add(sheath);

    const filament = new THREE.Mesh(
      new THREE.CylinderGeometry(0.022, 0.022, length * 0.76, 7),
      new THREE.MeshStandardMaterial({
        color: COLORS.cyan,
        emissive: COLORS.cyan,
        emissiveIntensity: 1.15,
        metalness: 0.25,
        roughness: 0.2
      })
    );
    filament.position.copy(midpoint);
    filament.quaternion.copy(quaternion);
    group.add(filament);

    const arrow = new THREE.Mesh(
      new THREE.ConeGeometry(0.09, 0.18, 8),
      new THREE.MeshBasicMaterial({ color: COLORS.cyan })
    );
    arrow.position.copy(from).lerp(to, 0.63);
    arrow.quaternion.copy(quaternion);
    group.add(arrow);
    return group;
  }

  private updateCore(state: GameState, now: number, delta: number): void {
    const health = state.coreHp / state.coreMaxHp;
    const danger = health < 0.35;
    const targetColor = danger ? COLORS.red : COLORS.cyan;
    this.coreInner.material.color.lerp(new THREE.Color(targetColor), 0.08);
    this.coreInner.material.emissive.lerp(new THREE.Color(targetColor), 0.08);
    this.coreInner.material.emissiveIntensity = danger
      ? 1.15 + Math.sin(now * 11) * 0.34
      : 1.08 + Math.sin(now * 3.2) * 0.16;
    this.coreLight.color.lerp(new THREE.Color(targetColor), 0.08);
    this.coreLight.intensity = danger ? 1.8 + Math.sin(now * 10) * 0.5 : 1.85;

    if (!this.reducedMotion.matches) {
      this.coreInner.rotation.y += delta * 0.65;
      this.coreInner.rotation.x += delta * 0.28;
      this.coreRingA.rotation.z += delta * 0.65;
      this.coreRingB.rotation.x -= delta * 0.5;
      this.coreGroup.position.y = Math.sin(now * 1.8) * 0.018;
    }
  }

  private updateGates(state: GameState, now: number, delta: number): void {
    for (const [index, gate] of this.gateGroups.entries()) {
      const active = state.activeLanes.includes(index) && state.phase !== "ready";
      const ring = gate.userData.ring as THREE.Mesh<THREE.TorusGeometry, THREE.MeshStandardMaterial>;
      const light = gate.userData.light as THREE.PointLight;
      gate.userData.impact = Math.max(0, (gate.userData.impact as number) - delta * 1.8);
      const impact = gate.userData.impact as number;
      ring.material.emissiveIntensity = active
        ? 0.75 + Math.sin(now * 5 + index) * 0.2 + impact
        : 0.08;
      ring.material.emissive.setHex(active ? COLORS.red : COLORS.cyanDim);
      light.color.setHex(active ? COLORS.red : COLORS.cyan);
      light.intensity = active ? 1.1 + impact * 2 : 0;
      const scale = 1 + impact * 0.35;
      gate.scale.setScalar(scale);
      if (active && !this.reducedMotion.matches) {
        ring.rotation.z += delta * 0.45;
      }
    }
  }

  private updateEffects(delta: number): void {
    for (const particle of this.particles) {
      if (particle.life <= 0) {
        continue;
      }
      particle.life -= delta;
      particle.velocity.y -= delta * 1.35;
      particle.mesh.position.addScaledVector(particle.velocity, delta);
      const ratio = Math.max(0, particle.life / particle.maxLife);
      particle.mesh.scale.setScalar(0.35 + ratio * 0.8);
      particle.mesh.material.opacity = ratio;
      if (particle.life <= 0) {
        particle.mesh.visible = false;
      }
    }

    for (const ring of this.rings) {
      if (ring.life <= 0) {
        continue;
      }
      ring.life -= delta;
      const progress = 1 - Math.max(0, ring.life / ring.maxLife);
      ring.mesh.scale.setScalar(0.4 + progress * 2.2);
      ring.mesh.material.opacity = (1 - progress) * 0.72;
      if (ring.life <= 0) {
        ring.mesh.visible = false;
      }
    }
  }

  private updatePreview(now: number): void {
    if (!this.previewCell) {
      return;
    }
    const marker = this.previewGroup.children[1];
    if (!this.reducedMotion.matches) {
      marker.rotation.z = now * (this.previewTool === "remove" ? -1.6 : 1.2);
      const pulse = 1 + Math.sin(now * 5) * 0.04;
      this.previewGroup.scale.setScalar(pulse);
    } else {
      this.previewGroup.scale.setScalar(1);
    }
    this.previewGroup.visible = true;
    this.previewGroup.userData.valid = this.previewValid;
  }

  private updateSelection(state: GameState, now: number): void {
    const selected = state.devices.find((device) => device.id === state.selectedDeviceId);
    if (!selected) {
      this.selectionRing.visible = false;
      return;
    }
    const position = cellToWorld(selected.cell, 0.17);
    this.selectionRing.position.set(position.x, position.y, position.z);
    this.selectionRing.visible = true;
    this.selectionRing.material.opacity = this.reducedMotion.matches
      ? 0.85
      : 0.68 + Math.sin(now * 5) * 0.18;
  }

  private updateCamera(delta: number, now: number): void {
    const tacticalPosition = new THREE.Vector3(10.6, 14.8, 13.4);
    const presentationPosition = new THREE.Vector3(14.2, 10.6, 12.2);
    const base = tacticalPosition.lerp(presentationPosition, this.presentationBlend);
    if (this.presentationBlend > 0.01 && !this.reducedMotion.matches) {
      base.x += Math.sin(now * 0.18) * 0.42 * this.presentationBlend;
      base.z += Math.cos(now * 0.14) * 0.34 * this.presentationBlend;
      base.y += Math.sin(now * 0.11) * 0.16 * this.presentationBlend;
    }
    if (this.shake > 0 && !this.reducedMotion.matches) {
      const strength = this.shake;
      base.x += Math.sin(now * 91) * strength;
      base.y += Math.sin(now * 73 + 1) * strength * 0.35;
      base.z += Math.sin(now * 83 + 2) * strength;
      this.shake = Math.max(0, this.shake - delta * 1.7);
    }
    this.camera.position.lerp(base, 1 - Math.exp(-7.5 * delta));
    const targetLook = new THREE.Vector3(0, 0, 0.25).lerp(
      new THREE.Vector3(-1.1, 0, 1.15),
      this.presentationBlend
    );
    this.cameraLookTarget.lerp(targetLook, 1 - Math.exp(-7.5 * delta));
    this.camera.lookAt(this.cameraLookTarget);
    const targetZoom = THREE.MathUtils.lerp(1, 1.035, this.presentationBlend);
    this.camera.zoom = expLerp(this.camera.zoom, targetZoom, 7.5, delta);
    this.camera.updateProjectionMatrix();
    this.flash = Math.max(0, this.flash - delta * 2.2);
    this.renderer.toneMappingExposure = 0.94 + this.presentationBlend * 0.03 + this.flash * 0.1;
  }

  private spawnParticles(
    position: WorldPoint,
    color: number,
    count: number,
    force: number
  ): void {
    let spawned = 0;
    for (const particle of this.particles) {
      if (particle.life > 0) {
        continue;
      }
      const angle = Math.random() * Math.PI * 2;
      const horizontal = (0.35 + Math.random() * 0.65) * force;
      particle.mesh.visible = true;
      particle.mesh.position.set(position.x, position.y + 0.18, position.z);
      particle.mesh.material.color.setHex(color);
      particle.mesh.material.opacity = 1;
      particle.velocity.set(
        Math.cos(angle) * horizontal,
        (0.55 + Math.random() * 0.85) * force,
        Math.sin(angle) * horizontal
      );
      particle.life = 0.35 + Math.random() * 0.42;
      particle.maxLife = particle.life;
      spawned += 1;
      if (spawned >= count) {
        break;
      }
    }
  }

  private spawnRing(position: WorldPoint, color: number, size: number): void {
    const ring = this.rings.find((entry) => entry.life <= 0);
    if (!ring) {
      return;
    }
    ring.mesh.visible = true;
    ring.mesh.position.set(position.x, Math.max(0.18, position.y), position.z);
    ring.mesh.material.color.setHex(color);
    ring.mesh.scale.setScalar(size);
    ring.life = 0.55;
    ring.maxLife = 0.55;
  }

  private resize(): void {
    const width = Math.max(1, this.container.clientWidth);
    const height = Math.max(1, this.container.clientHeight);
    const aspect = width / height;
    const viewHeight = window.innerWidth < 760 ? 16.4 : 13.4;
    this.camera.left = (-viewHeight * aspect) / 2;
    this.camera.right = (viewHeight * aspect) / 2;
    this.camera.top = viewHeight / 2;
    this.camera.bottom = -viewHeight / 2;
    this.camera.updateProjectionMatrix();
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.7));
    this.renderer.setSize(width, height, false);
    this.composer.setSize(width, height);
    this.bloomPass.resolution.set(width, height);
  }

  private disposeObject(object: THREE.Object3D): void {
    object.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (mesh.geometry && !this.particles.some((particle) => particle.mesh.geometry === mesh.geometry)) {
        mesh.geometry.dispose();
      }
      const material = mesh.material;
      if (Array.isArray(material)) {
        material.forEach((entry) => entry.dispose());
      } else if (material && !this.rings.some((ring) => ring.mesh.material === material)) {
        material.dispose();
      }
    });
  }
}
