import "./style.css";
import { GameAudio } from "./audio/GameAudio";
import {
  CORE_CELL,
  DEVICE_COST,
  DEVICE_LABEL,
  FREQUENCY_LABEL,
  LANES
} from "./game/config";
import { validatePlacement } from "./game/network";
import { GameSimulation } from "./game/simulation";
import type {
  BuildTool,
  DeviceKind,
  GameEvent,
  GridCoord,
  RewardId
} from "./game/types";
import { GameRenderer } from "./rendering/GameRenderer";

const TOOL_ORDER: DeviceKind[] = [
  "wire",
  "splitter",
  "capacitor",
  "dyer",
  "switch",
  "needle",
  "mortar",
  "prism"
];

const TOOL_SHORTCUT: Record<DeviceKind, string> = {
  wire: "1",
  splitter: "2",
  capacitor: "3",
  dyer: "4",
  switch: "5",
  needle: "6",
  mortar: "7",
  prism: "8"
};

const TUTORIAL_COPY = [
  "从核心旁边开始，沿网格拖出一条导线。",
  "继续延伸线路，在道路附近放置一座针刺塔。",
  "脉冲正在赶往炮塔。观察它第一次开火。",
  "线路已上线。入口变化时，及时把能量调向受威胁区域。"
];

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) {
  throw new Error("Application root is missing");
}

app.innerHTML = `
  <main class="game-shell" aria-label="脉冲防线">
    <section class="scene-shell" id="scene-shell" aria-label="三维战场"></section>
    <div class="grain" aria-hidden="true"></div>

    <header class="command-bar" aria-label="战斗状态">
      <div class="brand-lockup">
        <span class="brand-mark" aria-hidden="true"></span>
        <div>
          <p>脉冲防线</p>
          <span id="network-status">等待启动</span>
        </div>
      </div>

      <div class="run-readout" aria-live="polite">
        <div>
          <span class="readout-label">攻势</span>
          <strong id="wave-value">1 / 5</strong>
        </div>
        <div>
          <span class="readout-label">计时</span>
          <strong id="timer-value">00:00</strong>
        </div>
        <div>
          <span class="readout-label">入口</span>
          <strong id="lane-value">西侧</strong>
        </div>
      </div>

      <div class="command-actions">
        <button class="icon-button" id="sound-button" type="button" aria-label="切换音效">音效 开</button>
        <button class="icon-button" id="help-button" type="button" aria-label="查看操作说明">操作</button>
        <button class="icon-button primary-control" id="pause-button" type="button">暂停</button>
      </div>
    </header>

    <aside class="core-panel" aria-label="核心状态">
      <div class="core-heading">
        <span>核心完整度</span>
        <strong id="core-value">100</strong>
      </div>
      <div class="meter" aria-hidden="true">
        <span id="core-meter"></span>
      </div>
      <div class="resource-line">
        <span>建造点</span>
        <strong id="build-value">88</strong>
      </div>
      <div class="meter resource-meter" aria-hidden="true">
        <span id="build-meter"></span>
      </div>
    </aside>

    <aside class="inspector is-empty" id="inspector" aria-live="polite">
      <span class="inspector-kicker">选中装置</span>
      <h2 id="inspector-title">选择一个装置</h2>
      <p id="inspector-copy">点击线路或炮塔查看状态。右键可以快速拆除。</p>
      <dl id="inspector-stats"></dl>
      <div class="inspector-actions" id="inspector-actions"></div>
    </aside>

    <div class="threat-banner" id="threat-banner" role="status" aria-live="assertive">
      <span id="threat-label">入口已更新</span>
      <strong id="threat-copy">西侧通道正在升温</strong>
    </div>

    <div class="tutorial-card" id="tutorial-card" aria-live="polite">
      <span id="tutorial-step">入网指引</span>
      <p id="tutorial-copy">${TUTORIAL_COPY[0]}</p>
    </div>

    <div class="toast-stack" id="toast-stack" aria-live="polite"></div>

    <nav class="build-dock" aria-label="建造工具">
      <div class="dock-tools" id="dock-tools"></div>
      <button class="tool-button remove-tool" type="button" data-tool="remove">
        <span class="tool-key">Del</span>
        <span class="tool-symbol" data-symbol="remove" aria-hidden="true"></span>
        <span class="tool-name">拆除</span>
        <span class="tool-cost">返还 80%</span>
      </button>
    </nav>

    <section class="overlay start-overlay is-visible" id="start-overlay" aria-labelledby="start-title">
      <div class="main-menu">
        <div class="game-title-lockup">
          <span class="title-core" aria-hidden="true"><i></i></span>
          <div>
            <h1 id="start-title"><span>脉冲</span><strong>防线</strong></h1>
            <p>实时网络塔防</p>
          </div>
        </div>

        <nav class="main-menu-actions" aria-label="主菜单">
          <button class="menu-action menu-action-primary" id="start-button" type="button">
            <span>开始游戏</span><kbd>Enter</kbd>
          </button>
          <button class="menu-action" id="start-help-button" type="button">
            <span>作战教学</span><kbd>H</kbd>
          </button>
          <button class="menu-action" id="menu-sound-button" type="button">
            <span>音效</span><em>开</em>
          </button>
        </nav>
      </div>
    </section>

    <section class="overlay-panel reward-overlay" id="reward-overlay" aria-labelledby="reward-title">
      <div class="panel-heading">
        <span>攻势间隙</span>
        <h2 id="reward-title">选择一条新规则</h2>
        <p>计时已经暂停。选择会立即作用于本局所有对应装置。</p>
      </div>
      <div class="reward-grid" id="reward-grid"></div>
      <button class="quiet-button reroll-button" id="reroll-button" type="button">免费刷新一次</button>
    </section>

    <section class="overlay-panel pause-overlay" id="pause-overlay" aria-labelledby="pause-title">
      <span>模拟暂停</span>
      <h2 id="pause-title">网络保持当前状态</h2>
      <p>暂停期间不能搭建。继续后所有脉冲从当前位置恢复。</p>
      <button class="start-button" id="resume-button" type="button">继续战斗</button>
    </section>

    <section class="overlay-panel result-overlay" id="result-overlay" aria-labelledby="result-title">
      <span id="result-kicker">运行结束</span>
      <h2 id="result-title">核心仍在运转</h2>
      <p id="result-copy">这条网络完成了防守。</p>
      <div class="result-stats">
        <div><span>得分</span><strong id="result-score">0</strong></div>
        <div><span>击破</span><strong id="result-kills">0</strong></div>
        <div><span>最佳</span><strong id="best-score">0</strong></div>
      </div>
      <button class="start-button" id="restart-button" type="button">新种子重开</button>
    </section>

    <section class="overlay-panel help-overlay" id="help-overlay" aria-labelledby="help-title">
      <div class="panel-heading">
        <span>操作说明</span>
        <h2 id="help-title">快速上手</h2>
      </div>
      <div class="help-layout">
        <div><strong>拖拽</strong><p>选择导线后，从核心旁边沿网格拖动。</p></div>
        <div><strong>点击</strong><p>点击染色器或切换器，改变当前规则。</p></div>
        <div><strong>右键</strong><p>拆除装置并返还大部分建造点。</p></div>
        <div><strong>快捷键</strong><p>数字键选工具，空格暂停，M 迁移所选装置。</p></div>
      </div>
      <button class="start-button" id="close-help-button" type="button">明白了</button>
    </section>

    <div class="boot-screen" id="boot-screen" aria-live="polite">
      <span class="boot-line"></span>
      <strong>正在校准核心</strong>
    </div>

    <section class="fatal-screen" id="fatal-screen" aria-labelledby="fatal-title">
      <div>
        <span>图形初始化失败</span>
        <h1 id="fatal-title">无法启动三维战场</h1>
        <p id="fatal-copy">请使用支持 WebGL 2 的新版浏览器，并确认硬件加速已经开启。</p>
      </div>
    </section>
  </main>
`;

function mustElement<T extends HTMLElement>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) {
    throw new Error(`Missing UI element: ${selector}`);
  }
  return element;
}

const sceneShell = mustElement<HTMLElement>("#scene-shell");
const dockTools = mustElement<HTMLElement>("#dock-tools");
const bootScreen = mustElement<HTMLElement>("#boot-screen");
const fatalScreen = mustElement<HTMLElement>("#fatal-screen");
const startOverlay = mustElement<HTMLElement>("#start-overlay");
const rewardOverlay = mustElement<HTMLElement>("#reward-overlay");
const pauseOverlay = mustElement<HTMLElement>("#pause-overlay");
const resultOverlay = mustElement<HTMLElement>("#result-overlay");
const helpOverlay = mustElement<HTMLElement>("#help-overlay");
const rewardGrid = mustElement<HTMLElement>("#reward-grid");
const rerollButton = mustElement<HTMLButtonElement>("#reroll-button");
const threatBanner = mustElement<HTMLElement>("#threat-banner");
const threatLabel = mustElement<HTMLElement>("#threat-label");
const threatCopy = mustElement<HTMLElement>("#threat-copy");
const tutorialCard = mustElement<HTMLElement>("#tutorial-card");
const tutorialCopy = mustElement<HTMLElement>("#tutorial-copy");
const toastStack = mustElement<HTMLElement>("#toast-stack");
const inspector = mustElement<HTMLElement>("#inspector");
const inspectorTitle = mustElement<HTMLElement>("#inspector-title");
const inspectorCopy = mustElement<HTMLElement>("#inspector-copy");
const inspectorStats = mustElement<HTMLElement>("#inspector-stats");
const inspectorActions = mustElement<HTMLElement>("#inspector-actions");
const startButton = mustElement<HTMLButtonElement>("#start-button");
const hudSoundButton = mustElement<HTMLButtonElement>("#sound-button");
const menuSoundButton = mustElement<HTMLButtonElement>("#menu-sound-button");

for (const kind of TOOL_ORDER) {
  const button = document.createElement("button");
  button.className = "tool-button";
  button.type = "button";
  button.dataset.tool = kind;
  button.innerHTML = `
    <span class="tool-key">${TOOL_SHORTCUT[kind]}</span>
    <span class="tool-symbol" data-symbol="${kind}" aria-hidden="true"></span>
    <span class="tool-name">${DEVICE_LABEL[kind]}</span>
    <span class="tool-cost">${DEVICE_COST[kind]} 点</span>
  `;
  dockTools.append(button);
}

const simulation = new GameSimulation();
const audio = new GameAudio();
let gameRenderer: GameRenderer;

try {
  gameRenderer = new GameRenderer(sceneShell);
  requestAnimationFrame(() => bootScreen.classList.add("is-hidden"));
} catch (error) {
  fatalScreen.classList.add("is-visible");
  bootScreen.classList.add("is-hidden");
  const message = error instanceof Error ? error.message : "未知图形错误";
  mustElement<HTMLElement>("#fatal-copy").textContent =
    `请使用支持 WebGL 2 的新版浏览器，并确认硬件加速已经开启。错误信息：${message}`;
  throw error;
}

let drawingWire = false;
let lastWireCell: GridCoord | null = null;
let hoveredCell: GridCoord | null = null;
let movingDeviceId: number | null = null;
let rewardRenderKey = "";
let lastUiUpdate = 0;
let bannerTimer = 0;
let toastCounter = 0;
let helpPausedGame = false;
let isStarting = false;

function sameCell(left: GridCoord | null, right: GridCoord | null): boolean {
  return Boolean(left && right && left.x === right.x && left.y === right.y);
}

function showToast(message: string, tone: "neutral" | "danger" | "success" = "neutral"): void {
  const toast = document.createElement("div");
  toast.className = `toast toast-${tone}`;
  toast.textContent = message;
  toast.dataset.toastId = String(++toastCounter);
  toastStack.append(toast);
  window.setTimeout(() => toast.classList.add("is-leaving"), 2200);
  window.setTimeout(() => toast.remove(), 2600);
}

function showBanner(label: string, copy: string, danger = false): void {
  threatLabel.textContent = label;
  threatCopy.textContent = copy;
  threatBanner.classList.toggle("is-danger", danger);
  threatBanner.classList.add("is-visible");
  bannerTimer = 3.6;
}

function handleGameEvent(event: GameEvent): void {
  gameRenderer.handleEvent(event);
  audio.handleEvent(event);
  if (event.type === "invalid") {
    showToast(event.message, "danger");
  } else if (event.type === "wave") {
    const names = event.lanes.map((lane) => LANES[lane]?.name ?? "未知入口").join("、");
    showBanner(event.wave === 6 ? "Boss 接近" : `攻势 ${event.wave}`, `${names}正在升温`, event.wave === 6);
  } else if (event.type === "reward-picked") {
    showToast(`规则已接入：${event.reward.name}`, "success");
  } else if (event.type === "jam-warning") {
    showBanner("干扰预警", "一个 2 x 2 区域即将离线", true);
  } else if (event.type === "jam-active") {
    showBanner("网络受扰", "改线或等待装置恢复", true);
  } else if (event.type === "core-hit") {
    showToast(`核心受到 ${event.amount} 点冲击`, "danger");
  } else if (event.type === "tutorial") {
    tutorialCopy.textContent = TUTORIAL_COPY[event.step] ?? TUTORIAL_COPY[3];
    tutorialCard.classList.add("is-visible");
    if (event.step === 3) {
      window.setTimeout(() => tutorialCard.classList.remove("is-visible"), 6500);
    }
  } else if (event.type === "win" || event.type === "lose") {
    persistBest(event.score);
  }
}

simulation.subscribe(handleGameEvent);

function persistBest(score: number): void {
  try {
    const current = Number(localStorage.getItem("pulse-defense-best") ?? 0);
    if (score > current) {
      localStorage.setItem("pulse-defense-best", String(score));
    }
  } catch {
    showToast("本地成绩无法保存，本局仍可继续", "danger");
  }
}

function bestScore(): number {
  try {
    return Number(localStorage.getItem("pulse-defense-best") ?? 0);
  } catch {
    return 0;
  }
}

function beginRun(seed: number): void {
  simulation.start(seed);
  gameRenderer.setPresentationMode(false);
  startOverlay.classList.remove("is-visible", "is-departing");
  document.body.classList.remove("is-entering");
  startButton.disabled = false;
  isStarting = false;
  resultOverlay.classList.remove("is-visible");
  helpOverlay.classList.remove("is-visible");
  tutorialCard.classList.add("is-visible");
  movingDeviceId = null;
  rewardRenderKey = "";
  updateUi(true);
  gameRenderer.canvas.focus();
}

function startRun(useNewSeed = false): void {
  if (isStarting) {
    return;
  }
  void audio.unlock();
  const seed = useNewSeed
    ? (Date.now() ^ Math.floor(Math.random() * 0xffffffff)) >>> 0
    : simulation.state.seed;

  if (!startOverlay.classList.contains("is-visible")) {
    beginRun(seed);
    return;
  }

  isStarting = true;
  startButton.disabled = true;
  document.body.classList.add("is-entering");
  startOverlay.classList.add("is-departing");
  gameRenderer.setPresentationMode(false);
  const delay = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 720;
  window.setTimeout(() => beginRun(seed), delay);
}

function formatTime(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const remaining = Math.floor(seconds % 60);
  return `${String(minutes).padStart(2, "0")}:${String(remaining).padStart(2, "0")}`;
}

function updateUi(force = false): void {
  const state = simulation.state;
  mustElement<HTMLElement>("#wave-value").textContent =
    state.wave <= 5 ? `${state.wave} / 5` : "Boss";
  mustElement<HTMLElement>("#timer-value").textContent = formatTime(state.elapsed);
  mustElement<HTMLElement>("#lane-value").textContent = state.activeLanes
    .map((lane) => LANES[lane]?.name.replace("通道", "") ?? "?")
    .join("、");
  mustElement<HTMLElement>("#core-value").textContent = String(Math.ceil(state.coreHp));
  mustElement<HTMLElement>("#core-meter").style.transform =
    `scaleX(${Math.max(0, state.coreHp / state.coreMaxHp)})`;
  mustElement<HTMLElement>("#build-value").textContent = String(Math.floor(state.buildPoints));
  mustElement<HTMLElement>("#build-meter").style.transform =
    `scaleX(${Math.min(1, state.buildPoints / state.buildPointCap)})`;
  mustElement<HTMLElement>("#network-status").textContent =
    state.phase === "ready"
      ? "等待启动"
      : state.phase === "running"
        ? simulation.topology.connected.size > 1
          ? `${simulation.topology.connected.size - 1} 个节点在线`
          : "核心等待接线"
        : state.phase === "paused"
          ? "模拟已暂停"
          : state.phase === "reward"
            ? "规则选择中"
            : "运行结束";

  mustElement<HTMLButtonElement>("#pause-button").textContent =
    state.phase === "paused" ? "继续" : "暂停";
  pauseOverlay.classList.toggle("is-visible", state.phase === "paused");
  rewardOverlay.classList.toggle("is-visible", state.phase === "reward");
  resultOverlay.classList.toggle("is-visible", state.phase === "won" || state.phase === "lost");

  if (state.phase === "reward") {
    renderRewards();
  }
  if (state.phase === "won" || state.phase === "lost") {
    renderResult();
  }

  for (const button of document.querySelectorAll<HTMLButtonElement>("[data-tool]")) {
    const tool = button.dataset.tool as BuildTool;
    const unlocked = tool === "remove" || state.unlocks.has(tool);
    button.disabled = !unlocked;
    button.classList.toggle("is-locked", !unlocked);
    button.classList.toggle("is-active", state.selectedTool === tool && movingDeviceId === null);
    button.setAttribute("aria-pressed", String(state.selectedTool === tool));
    if (tool !== "remove") {
      const cost = button.querySelector<HTMLElement>(".tool-cost");
      if (cost) {
        cost.textContent = unlocked ? `${DEVICE_COST[tool]} 点` : "未解锁";
      }
    }
  }

  updateInspector();
  updatePreview();

  if (force) {
    document.body.classList.toggle("is-playing", state.phase !== "ready");
  }
}

function renderRewards(): void {
  const state = simulation.state;
  const key = state.rewardOptions.map((reward) => reward.id).join("|");
  if (key === rewardRenderKey) {
    rerollButton.disabled = !state.freeRerollAvailable;
    return;
  }
  rewardRenderKey = key;
  rewardGrid.replaceChildren();
  const familyLabel = {
    unlock: "新装置",
    network: "网络规则",
    frequency: "频率规则",
    tower: "炮塔规则",
    core: "核心规则"
  } as const;
  for (const [index, reward] of state.rewardOptions.entries()) {
    const button = document.createElement("button");
    button.className = "reward-card";
    button.type = "button";
    button.dataset.reward = reward.id;
    button.style.setProperty("--reward-index", String(index));
    button.innerHTML = `
      <span class="reward-family">${familyLabel[reward.family]}</span>
      <strong>${reward.name}</strong>
      <p>${reward.description}</p>
      <span class="reward-action">接入规则</span>
    `;
    rewardGrid.append(button);
  }
  rerollButton.disabled = !state.freeRerollAvailable;
}

function renderResult(): void {
  const state = simulation.state;
  const won = state.phase === "won";
  mustElement<HTMLElement>("#result-kicker").textContent = won ? "防线稳定" : "核心离线";
  mustElement<HTMLElement>("#result-title").textContent = won ? "网络撑过了敌潮" : "线路需要重新设计";
  mustElement<HTMLElement>("#result-copy").textContent = won
    ? "这套构筑完成了闭环。换一个种子，看看它是否仍然可靠。"
    : "检查断供位置和火力分配，然后用新种子重建。";
  mustElement<HTMLElement>("#result-score").textContent = state.score.toLocaleString("zh-CN");
  mustElement<HTMLElement>("#result-kills").textContent = String(state.kills);
  mustElement<HTMLElement>("#best-score").textContent = bestScore().toLocaleString("zh-CN");
}

function updateInspector(): void {
  const state = simulation.state;
  const device = state.devices.find((entry) => entry.id === state.selectedDeviceId);
  inspector.classList.toggle("is-empty", !device);
  inspector.setAttribute("aria-hidden", String(!device));
  if (!device) {
    inspectorTitle.textContent = movingDeviceId ? "选择新的落点" : "选择一个装置";
    inspectorCopy.textContent = movingDeviceId
      ? "迁移不会改变装置类型，落地后会短暂离线。"
      : "点击线路或炮塔查看状态。右键可以快速拆除。";
    inspectorStats.replaceChildren();
    inspectorActions.replaceChildren();
    return;
  }

  const connected = simulation.topology.connected.has(device.id);
  const disabled = device.disabledUntil > state.elapsed || device.offlineUntil > state.elapsed;
  inspectorTitle.textContent = DEVICE_LABEL[device.kind];
  inspectorCopy.textContent =
    device.kind === "dyer"
      ? "点击装置可以循环切换频率。"
      : device.kind === "switch"
        ? "点击装置，把完整脉冲切向另一支路。"
        : device.kind === "splitter" && state.upgrades.has("biased-split")
          ? "点击装置，交换 70% 能量所在的主支路。"
          : connected
            ? "装置已接入核心网络。"
            : "当前支路与核心断开。";

  inspectorStats.innerHTML = `
    <div><dt>状态</dt><dd class="${disabled ? "status-danger" : connected ? "status-good" : ""}">${disabled ? "离线" : connected ? "在线" : "断开"}</dd></div>
    <div><dt>储能</dt><dd>${(device.energyStore + device.bufferEnergy).toFixed(1)}</dd></div>
    <div><dt>频率</dt><dd>${FREQUENCY_LABEL[device.kind === "dyer" ? device.frequency : device.bufferFrequency]}</dd></div>
  `;

  inspectorActions.replaceChildren();
  if (
    device.kind === "dyer" ||
    device.kind === "switch" ||
    (device.kind === "splitter" && state.upgrades.has("biased-split"))
  ) {
    const interact = document.createElement("button");
    interact.type = "button";
    interact.dataset.inspectorAction = "interact";
    interact.textContent = device.kind === "dyer" ? "切换频率" : "切换支路";
    inspectorActions.append(interact);
  }
  const move = document.createElement("button");
  move.type = "button";
  move.dataset.inspectorAction = "move";
  move.textContent = movingDeviceId === device.id ? "取消迁移" : "迁移";
  const remove = document.createElement("button");
  remove.type = "button";
  remove.dataset.inspectorAction = "remove";
  remove.textContent = "拆除";
  inspectorActions.append(move, remove);
}

function updatePreview(): void {
  if (!hoveredCell) {
    gameRenderer.setBuildPreview(null, true, simulation.state.selectedTool);
    return;
  }
  const state = simulation.state;
  let valid = true;
  let tool = state.selectedTool;
  if (movingDeviceId !== null) {
    const device = state.devices.find((entry) => entry.id === movingDeviceId);
    if (device) {
      tool = device.kind;
      valid = !state.devices.some(
        (entry) =>
          entry.id !== movingDeviceId &&
          entry.cell.x === hoveredCell?.x &&
          entry.cell.y === hoveredCell?.y
      );
    }
  } else if (tool === "remove") {
    valid = Boolean(simulation.getDeviceAt(hoveredCell));
  } else if (simulation.getDeviceAt(hoveredCell)) {
    valid = true;
  } else {
    valid = validatePlacement(state, tool, hoveredCell, -999999).ok;
  }
  gameRenderer.setBuildPreview(hoveredCell, valid, tool);
}

function selectTool(tool: BuildTool): void {
  if (tool !== "remove" && !simulation.state.unlocks.has(tool)) {
    showToast("这项技术尚未接入", "danger");
    return;
  }
  movingDeviceId = null;
  simulation.setTool(tool);
  updateUi();
}

function placeWirePath(from: GridCoord, to: GridCoord): void {
  let current = { ...from };
  const attempt = (cell: GridCoord): void => {
    if (
      (cell.x === CORE_CELL.x && cell.y === CORE_CELL.y) ||
      simulation.getDeviceAt(cell)
    ) {
      return;
    }
    simulation.placeDevice("wire", cell);
  };
  while (current.x !== to.x) {
    current.x += Math.sign(to.x - current.x);
    attempt(current);
  }
  while (current.y !== to.y) {
    current.y += Math.sign(to.y - current.y);
    attempt(current);
  }
}

function handleCanvasAction(cell: GridCoord, button: number): void {
  const state = simulation.state;
  if (button === 2) {
    simulation.removeAt(cell);
    return;
  }
  if (button !== 0) {
    return;
  }

  if (movingDeviceId !== null) {
    if (simulation.moveDevice(movingDeviceId, cell)) {
      showToast("装置已迁移", "success");
      movingDeviceId = null;
    }
    return;
  }

  if (state.selectedTool === "remove") {
    simulation.removeAt(cell);
    return;
  }

  if (state.selectedTool === "wire") {
    drawingWire = true;
    lastWireCell = cell;
    if (
      !(cell.x === CORE_CELL.x && cell.y === CORE_CELL.y) &&
      !simulation.getDeviceAt(cell)
    ) {
      simulation.placeDevice("wire", cell);
    }
    return;
  }

  const existing = simulation.getDeviceAt(cell);
  if (existing) {
    simulation.interactAt(cell);
    return;
  }

  simulation.placeDevice(state.selectedTool, cell);
}

gameRenderer.canvas.addEventListener("pointerdown", (event) => {
  const cell = gameRenderer.getCellFromPointer(event.clientX, event.clientY);
  if (!cell) {
    return;
  }
  gameRenderer.canvas.setPointerCapture(event.pointerId);
  handleCanvasAction(cell, event.button);
  updateUi();
});

gameRenderer.canvas.addEventListener("pointermove", (event) => {
  const cell = gameRenderer.getCellFromPointer(event.clientX, event.clientY);
  if (!sameCell(cell, hoveredCell)) {
    hoveredCell = cell;
    updatePreview();
  }
  if (
    drawingWire &&
    cell &&
    lastWireCell &&
    simulation.state.phase === "running" &&
    simulation.state.selectedTool === "wire"
  ) {
    placeWirePath(lastWireCell, cell);
    lastWireCell = { ...cell };
    updateUi();
  }
});

const endPointerAction = (): void => {
  drawingWire = false;
  lastWireCell = null;
};
gameRenderer.canvas.addEventListener("pointerup", endPointerAction);
gameRenderer.canvas.addEventListener("pointercancel", endPointerAction);
gameRenderer.canvas.addEventListener("pointerleave", () => {
  endPointerAction();
  hoveredCell = null;
  updatePreview();
});
gameRenderer.canvas.addEventListener("contextmenu", (event) => event.preventDefault());

document.addEventListener("click", (event) => {
  const target = event.target as HTMLElement;
  const toolButton = target.closest<HTMLButtonElement>("[data-tool]");
  if (toolButton?.dataset.tool) {
    selectTool(toolButton.dataset.tool as BuildTool);
    return;
  }

  const rewardButton = target.closest<HTMLButtonElement>("[data-reward]");
  if (rewardButton?.dataset.reward) {
    simulation.chooseReward(rewardButton.dataset.reward as RewardId);
    rewardRenderKey = "";
    updateUi(true);
    return;
  }

  const action = target.closest<HTMLButtonElement>("[data-inspector-action]");
  if (action?.dataset.inspectorAction) {
    const device = simulation.state.devices.find(
      (entry) => entry.id === simulation.state.selectedDeviceId
    );
    if (!device) {
      return;
    }
    if (action.dataset.inspectorAction === "interact") {
      simulation.interactAt(device.cell);
    } else if (action.dataset.inspectorAction === "move") {
      movingDeviceId = movingDeviceId === device.id ? null : device.id;
    } else if (action.dataset.inspectorAction === "remove") {
      simulation.removeAt(device.cell);
    }
    updateUi();
  }
});

startButton.addEventListener("click", () => startRun(false));
mustElement<HTMLButtonElement>("#restart-button").addEventListener("click", () => startRun(true));
mustElement<HTMLButtonElement>("#pause-button").addEventListener("click", () => {
  simulation.togglePause();
  updateUi();
});
mustElement<HTMLButtonElement>("#resume-button").addEventListener("click", () => {
  simulation.togglePause();
  updateUi();
});
async function toggleSound(): Promise<void> {
  await audio.unlock();
  const muted = audio.toggleMuted();
  hudSoundButton.textContent = muted ? "音效 关" : "音效 开";
  menuSoundButton.querySelector<HTMLElement>("em")!.textContent = muted ? "关" : "开";
}

hudSoundButton.addEventListener("click", () => void toggleSound());
menuSoundButton.addEventListener("click", () => void toggleSound());
function openHelp(): void {
  helpPausedGame = simulation.state.phase === "running";
  if (helpPausedGame) {
    simulation.togglePause();
  }
  helpOverlay.classList.add("is-visible");
  updateUi();
}

function closeHelp(): void {
  helpOverlay.classList.remove("is-visible");
  if (helpPausedGame && simulation.state.phase === "paused") {
    simulation.togglePause();
  }
  helpPausedGame = false;
  updateUi();
}

mustElement<HTMLButtonElement>("#help-button").addEventListener("click", openHelp);
mustElement<HTMLButtonElement>("#start-help-button").addEventListener("click", openHelp);
mustElement<HTMLButtonElement>("#close-help-button").addEventListener("click", closeHelp);
rerollButton.addEventListener("click", () => {
  if (simulation.rerollRewards()) {
    rewardRenderKey = "";
    renderRewards();
    showToast("候选规则已刷新");
  }
});

document.addEventListener("keydown", (event) => {
  if (
    event.target instanceof HTMLInputElement ||
    event.target instanceof HTMLTextAreaElement ||
    event.target instanceof HTMLSelectElement
  ) {
    return;
  }
  if (
    simulation.state.phase === "ready" &&
    !helpOverlay.classList.contains("is-visible") &&
    event.key === "Enter"
  ) {
    event.preventDefault();
    startRun(false);
    return;
  }
  if (event.key.toLowerCase() === "h") {
    event.preventDefault();
    if (helpOverlay.classList.contains("is-visible")) {
      closeHelp();
    } else {
      openHelp();
    }
    return;
  }
  const toolIndex = Number(event.key) - 1;
  if (toolIndex >= 0 && toolIndex < TOOL_ORDER.length) {
    selectTool(TOOL_ORDER[toolIndex]);
    return;
  }
  if (event.code === "Space") {
    event.preventDefault();
    simulation.togglePause();
    updateUi();
    return;
  }
  if (event.key.toLowerCase() === "m") {
    movingDeviceId =
      movingDeviceId === simulation.state.selectedDeviceId
        ? null
        : simulation.state.selectedDeviceId;
    updateUi();
    return;
  }
  if (event.key === "Delete" || event.key === "Backspace") {
    const device = simulation.state.devices.find(
      (entry) => entry.id === simulation.state.selectedDeviceId
    );
    if (device) {
      simulation.removeAt(device.cell);
      updateUi();
    }
    return;
  }
  if (event.key === "Escape") {
    movingDeviceId = null;
    if (helpOverlay.classList.contains("is-visible")) {
      closeHelp();
    }
    updateUi();
  }
});

document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    simulation.pauseForVisibility();
    updateUi();
  }
});

let lastFrame = performance.now();
let accumulator = 0;
const fixedStep = 1 / 30;

function frame(now: number): void {
  const delta = Math.min(0.1, (now - lastFrame) / 1000);
  lastFrame = now;
  accumulator += delta;
  while (accumulator >= fixedStep) {
    simulation.update(fixedStep);
    accumulator -= fixedStep;
  }
  gameRenderer.render(simulation.state, simulation.topology);
  if (now - lastUiUpdate >= 100) {
    lastUiUpdate = now;
    if (bannerTimer > 0) {
      bannerTimer -= 0.1;
      if (bannerTimer <= 0) {
        threatBanner.classList.remove("is-visible");
      }
    }
    updateUi();
  }
  requestAnimationFrame(frame);
}

updateUi(true);
requestAnimationFrame(frame);

declare global {
  interface Window {
    __pulseDefenseDebug?: {
      snapshot: () => Record<string, unknown>;
      start: (seed?: number) => void;
      grantBuild: (amount?: number) => void;
      finishWave: () => void;
      damageCore: (amount: number) => void;
      defeatBoss: () => boolean;
      place: (kind: DeviceKind, x: number, y: number) => boolean;
      chooseReward: (id: RewardId) => boolean;
      cellScreen: (x: number, y: number) => { x: number; y: number };
    };
  }
}

if (import.meta.env.DEV) {
  window.__pulseDefenseDebug = {
    snapshot: () => ({
      phase: simulation.state.phase,
      wave: simulation.state.wave,
      elapsed: simulation.state.elapsed,
      coreHp: simulation.state.coreHp,
      buildPoints: simulation.state.buildPoints,
      score: simulation.state.score,
      kills: simulation.state.kills,
      devices: simulation.state.devices.map((device) => ({
        id: device.id,
        kind: device.kind,
        cell: { ...device.cell },
        connected: simulation.topology.connected.has(device.id)
      })),
      enemies: simulation.state.enemies.length,
      pulses: simulation.state.pulses.length,
      projectiles: simulation.state.projectiles.length,
      rewardOptions: simulation.state.rewardOptions.map((reward) => reward.id)
    }),
    start: (seed?: number) => {
      simulation.start(seed);
      gameRenderer.setPresentationMode(false);
      startOverlay.classList.remove("is-visible", "is-departing");
      document.body.classList.remove("is-entering");
      updateUi(true);
    },
    grantBuild: (amount?: number) => simulation.debugGrantBuildPoints(amount),
    finishWave: () => {
      simulation.debugFinishWave();
      updateUi(true);
    },
    damageCore: (amount: number) => {
      simulation.debugDamageCore(amount);
      updateUi(true);
    },
    defeatBoss: () => {
      const result = simulation.debugDefeatBoss();
      updateUi(true);
      return result;
    },
    place: (kind: DeviceKind, x: number, y: number) =>
      simulation.placeDevice(kind, { x, y }),
    chooseReward: (id: RewardId) => {
      const result = simulation.chooseReward(id);
      updateUi(true);
      return result;
    },
    cellScreen: (x: number, y: number) => gameRenderer.getScreenPoint({ x, y })
  };
}
