import {
  SlpStream,
  SlpStreamEvent,
  SlpParser,
  SlpParserEvent,
  stages,
  Command,
} from "../dist/browser/index.esm.js";

interface ReplaySummary {
  filename: string;
  name: string;
  size: number;
  category: string;
}

interface CliFlagSchema {
  name: string;
  type: "string" | "boolean" | "select" | "number";
  placeholder?: string;
  options?: string[];
  default?: any;
  description: string;
}

interface CliCommandSchema {
  name: string;
  title: string;
  badge: string;
  description: string;
  arg: { name: string; placeholder: string; required: boolean };
  flags: CliFlagSchema[];
}

// State
let selectedFile: File | null = null;
let selectedSamplePath: string = "ranked_game1_tiebreak.slp";
let isStreaming = false;
let isPaused = false;
let streamingAbortController: AbortController | null = null;
let startTime = 0;
let availableReplays: ReplaySummary[] = [];
let cliSchema: CliCommandSchema[] = [];
let activeCliCommand: string = "mechanics";
const commandHistory: string[] = [];
let historyIndex = -1;

const streamStats = {
  totalEvents: 0,
  framesProcessed: 0,
  finalizedFrames: 0,
  commandCounts: {} as Record<string, number>,
};

// DOM Elements
const sampleSelect = document.getElementById("sampleSelect") as HTMLSelectElement;
const loadSampleBtn = document.getElementById("loadSampleBtn") as HTMLButtonElement;
const fileInput = document.getElementById("fileInput") as HTMLInputElement;
const dropZone = document.getElementById("dropZone") as HTMLDivElement;
const activeFileName = document.getElementById("activeFileName") as HTMLSpanElement;

// CLI Workbench Elements
const cliCommandButtonsContainer = document.getElementById("cliCommandButtons") as HTMLDivElement;
const cliFormContainer = document.getElementById("cliFormContainer") as HTMLDivElement;
const cliPromptInput = document.getElementById("cliPromptInput") as HTMLInputElement;
const cliRunPromptBtn = document.getElementById("cliRunPromptBtn") as HTMLButtonElement;
const cliRunFormBtn = document.getElementById("cliRunFormBtn") as HTMLButtonElement;
const cliCommandPreview = document.getElementById("cliCommandPreview") as HTMLElement;
const cliTerminalOutput = document.getElementById("cliTerminalOutput") as HTMLElement;
const cliClearTerminalBtn = document.getElementById("cliClearTerminalBtn") as HTMLButtonElement;
const cliCopyTerminalBtn = document.getElementById("cliCopyTerminalBtn") as HTMLButtonElement;
const cliStatusBadge = document.getElementById("cliStatusBadge") as HTMLElement;
const stickCanvas = document.getElementById("stickCanvas") as HTMLCanvasElement;

// Stream controls
const startStreamBtn = document.getElementById("startStreamBtn") as HTMLButtonElement;
const pauseStreamBtn = document.getElementById("pauseStreamBtn") as HTMLButtonElement;
const stopStreamBtn = document.getElementById("stopStreamBtn") as HTMLButtonElement;
const analyzeNowBtn = document.getElementById("analyzeNowBtn") as HTMLButtonElement;
const clearLogBtn = document.getElementById("clearLogBtn") as HTMLButtonElement;
const chunkSizeInput = document.getElementById("chunkSize") as HTMLInputElement;
const chunkSizeValue = document.getElementById("chunkSizeValue") as HTMLSpanElement;
const delayMsInput = document.getElementById("delayMs") as HTMLInputElement;
const delayMsValue = document.getElementById("delayMsValue") as HTMLSpanElement;
const logFilter = document.getElementById("logFilter") as HTMLSelectElement;

// Stats display
const totalEventsEl = document.getElementById("totalEvents") as HTMLElement;
const framesProcessedEl = document.getElementById("framesProcessed") as HTMLElement;
const finalizedFramesEl = document.getElementById("finalizedFrames") as HTMLElement;
const elapsedTimeEl = document.getElementById("elapsedTime") as HTMLElement;
const progressBar = document.getElementById("progressBar") as HTMLElement;
const eventLog = document.getElementById("eventLog") as HTMLElement;

// Tabs
const tabButtons = document.querySelectorAll<HTMLButtonElement>(".tab-btn");
const tabPanes = document.querySelectorAll<HTMLDivElement>(".tab-pane");

async function init() {
  setupTabs();
  setupEventListeners();
  drawStickDeadzone();
  await fetchReplayCatalog();
  await fetchCliSchema();
  await loadAndAnalyzePreset("ranked_game1_tiebreak.slp");
  // Run initial mechanics command
  runCliPrompt("slippi mechanics slp/wavedash-1.slp --details");
}

function setupTabs() {
  tabButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      const target = btn.dataset.tab;
      tabButtons.forEach((b) => {
        b.classList.remove("active", "border-indigo-500", "text-indigo-400");
        b.classList.add("border-transparent", "text-zinc-400");
      });
      btn.classList.add("active", "border-indigo-500", "text-indigo-400");
      btn.classList.remove("border-transparent", "text-zinc-400");

      tabPanes.forEach((p) => {
        if (p.id === target) {
          p.classList.remove("hidden");
        } else {
          p.classList.add("hidden");
        }
      });
    });
  });
}

function setupEventListeners() {
  chunkSizeInput?.addEventListener("input", () => {
    chunkSizeValue.textContent = chunkSizeInput.value;
  });

  delayMsInput?.addEventListener("input", () => {
    delayMsValue.textContent = delayMsInput.value;
  });

  loadSampleBtn?.addEventListener("click", async () => {
    const replayPath = sampleSelect.value;
    if (!replayPath) return;
    selectedSamplePath = replayPath;
    selectedFile = null;
    activeFileName.textContent = replayPath;
    await loadAndAnalyzePreset(replayPath);
    updateFormCommandPreview();
  });

  fileInput?.addEventListener("change", (e) => {
    const target = e.target as HTMLInputElement;
    if (target.files && target.files.length > 0 && target.files[0]) {
      handleUserFile(target.files[0]);
    }
  });

  // Drag and drop
  dropZone?.addEventListener("dragover", (e) => {
    e.preventDefault();
    dropZone.classList.add("border-indigo-500", "bg-indigo-950/20");
  });

  dropZone?.addEventListener("dragleave", () => {
    dropZone.classList.remove("border-indigo-500", "bg-indigo-950/20");
  });

  dropZone?.addEventListener("drop", (e) => {
    e.preventDefault();
    dropZone.classList.remove("border-indigo-500", "bg-indigo-950/20");
    if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]) {
      const file = e.dataTransfer.files[0];
      if (file.name.endsWith(".slp")) {
        handleUserFile(file);
      } else {
        addLog("WARN", "Please drop a valid .slp Slippi replay file.");
      }
    }
  });

  // CLI Prompt text-box execution
  cliRunPromptBtn?.addEventListener("click", () => {
    executeCurrentPrompt();
  });

  cliPromptInput?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      executeCurrentPrompt();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (commandHistory.length > 0) {
        historyIndex = Math.min(historyIndex + 1, commandHistory.length - 1);
        cliPromptInput.value = commandHistory[commandHistory.length - 1 - historyIndex];
      }
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      if (historyIndex > 0) {
        historyIndex--;
        cliPromptInput.value = commandHistory[commandHistory.length - 1 - historyIndex];
      } else if (historyIndex === 0) {
        historyIndex = -1;
        cliPromptInput.value = "";
      }
    }
  });

  cliRunFormBtn?.addEventListener("click", () => {
    const cmdString = buildCommandStringFromForm();
    cliPromptInput.value = cmdString;
    runCliPrompt(cmdString);
  });

  cliClearTerminalBtn?.addEventListener("click", () => {
    if (cliTerminalOutput) cliTerminalOutput.innerHTML = "";
  });

  cliCopyTerminalBtn?.addEventListener("click", () => {
    if (cliTerminalOutput) {
      navigator.clipboard.writeText(cliTerminalOutput.innerText);
      const originalText = cliCopyTerminalBtn.textContent;
      cliCopyTerminalBtn.textContent = "✓ Copied!";
      setTimeout(() => {
        cliCopyTerminalBtn.textContent = originalText;
      }, 1500);
    }
  });

  // Preset chip buttons
  document.querySelectorAll<HTMLButtonElement>(".cli-preset-btn").forEach((chip) => {
    chip.addEventListener("click", () => {
      const cmd = chip.dataset.cmd;
      if (cmd) {
        cliPromptInput.value = cmd;
        runCliPrompt(cmd);
      }
    });
  });

  // Stream controls
  startStreamBtn?.addEventListener("click", () => {
    startStreamingReplay();
  });

  pauseStreamBtn?.addEventListener("click", () => {
    isPaused = !isPaused;
    pauseStreamBtn.textContent = isPaused ? "▶ Resume" : "⏸ Pause";
    addLog("STREAM", isPaused ? "Stream paused by user" : "Stream resumed");
  });

  stopStreamBtn?.addEventListener("click", () => {
    stopStreamingReplay();
  });

  analyzeNowBtn?.addEventListener("click", () => {
    if (selectedFile) {
      analyzeRawFile(selectedFile);
    } else if (selectedSamplePath) {
      loadAndAnalyzePreset(selectedSamplePath);
    }
  });

  clearLogBtn?.addEventListener("click", () => {
    eventLog.innerHTML = "";
    resetStreamStats();
    updateStatsDisplay();
  });

  logFilter?.addEventListener("change", () => {
    const filter = logFilter.value;
    const entries = eventLog.querySelectorAll<HTMLDivElement>(".log-entry");
    entries.forEach((entry) => {
      if (filter === "all" || entry.dataset.type === filter) {
        entry.style.display = "block";
      } else {
        entry.style.display = "none";
      }
    });
  });
}

function executeCurrentPrompt() {
  const prompt = cliPromptInput.value.trim();
  if (!prompt) return;
  commandHistory.push(prompt);
  historyIndex = -1;
  runCliPrompt(prompt);
}

// CLI Schema & Form Builder
async function fetchCliSchema() {
  try {
    const res = await fetch("/api/cli/schema");
    const data = await res.json();
    cliSchema = data.commands || [];
    renderCliCommandButtons();
    renderCliForm(cliSchema[0]);
  } catch (err) {
    console.error("Failed to load CLI schema:", err);
  }
}

function renderCliCommandButtons() {
  if (!cliCommandButtonsContainer) return;
  cliCommandButtonsContainer.innerHTML = "";

  cliSchema.forEach((cmd, idx) => {
    const btn = document.createElement("button");
    const isActive = cmd.name === activeCliCommand;
    btn.className = `cmd-selector-btn px-3 py-2 rounded-lg text-left transition flex items-center justify-between border ${
      isActive
        ? "bg-indigo-600/20 border-indigo-500 text-indigo-300 font-bold"
        : "bg-zinc-900 border-zinc-800 text-zinc-400 hover:border-zinc-700 hover:text-zinc-200"
    }`;

    btn.innerHTML = `
      <div class="truncate">
        <div class="text-xs font-mono font-bold text-white flex items-center gap-1.5">
          <span>${cmd.name}</span>
          <span class="text-[9px] px-1.5 py-0.2 rounded font-sans uppercase font-bold ${
            cmd.badge === "Core" ? "bg-amber-500/20 text-amber-300 border border-amber-500/30" : "bg-zinc-800 text-zinc-400"
          }">${cmd.badge}</span>
        </div>
        <div class="text-[11px] text-zinc-500 truncate mt-0.5">${cmd.title}</div>
      </div>
    `;

    btn.addEventListener("click", () => {
      activeCliCommand = cmd.name;
      document.querySelectorAll(".cmd-selector-btn").forEach((b) => {
        b.classList.remove("bg-indigo-600/20", "border-indigo-500", "text-indigo-300", "font-bold");
        b.classList.add("bg-zinc-900", "border-zinc-800", "text-zinc-400");
      });
      btn.classList.add("bg-indigo-600/20", "border-indigo-500", "text-indigo-300", "font-bold");
      btn.classList.remove("bg-zinc-900", "border-zinc-800", "text-zinc-400");
      renderCliForm(cmd);
    });

    cliCommandButtonsContainer.appendChild(btn);
  });
}

function renderCliForm(cmd: CliCommandSchema) {
  if (!cliFormContainer) return;

  const replayOptions = availableReplays
    .map((r) => `<option value="slp/${r.filename}" ${r.filename === selectedSamplePath ? "selected" : ""}>slp/${r.filename}</option>`)
    .join("");

  let fieldsHtml = `
    <div class="mb-4">
      <div class="flex items-center justify-between mb-1">
        <label class="text-xs font-mono text-zinc-300 font-bold uppercase tracking-wider">
          ${cmd.arg.name.toUpperCase()} <span class="text-indigo-400">*required</span>
        </label>
        <span class="text-xs text-zinc-500 font-mono">${cmd.description}</span>
      </div>
      ${
        cmd.arg.name === "file"
          ? `
        <select id="cliArgValue" class="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2 text-xs font-mono text-zinc-200 outline-none focus:border-indigo-500">
          ${replayOptions}
        </select>
      `
          : `
        <input type="text" id="cliArgValue" value="${cmd.arg.placeholder}" class="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2 text-xs font-mono text-zinc-200 outline-none focus:border-indigo-500" />
      `
      }
    </div>
    <div class="border-t border-zinc-800/80 pt-4">
      <h4 class="text-xs font-bold font-mono text-zinc-400 uppercase tracking-wider mb-3">Optional Fields & Flags</h4>
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
  `;

  cmd.flags.forEach((flag) => {
    const flagId = `flag_${flag.name}`;
    if (flag.type === "boolean") {
      fieldsHtml += `
        <div class="bg-zinc-950/60 p-2.5 rounded-lg border border-zinc-800/80 flex items-center justify-between">
          <div>
            <label for="${flagId}" class="font-mono font-bold text-zinc-200 cursor-pointer">--${flag.name}</label>
            <p class="text-[10px] text-zinc-500 mt-0.5">${flag.description}</p>
          </div>
          <input type="checkbox" id="${flagId}" data-flag="${flag.name}" ${flag.default ? "checked" : ""} class="cli-flag-input w-4 h-4 accent-indigo-500 cursor-pointer" />
        </div>
      `;
    } else if (flag.type === "select") {
      const opts = (flag.options || [])
        .map((o) => `<option value="${o}" ${o === flag.default ? "selected" : ""}>${o}</option>`)
        .join("");
      fieldsHtml += `
        <div class="bg-zinc-950/60 p-2.5 rounded-lg border border-zinc-800/80">
          <label for="${flagId}" class="font-mono font-bold text-zinc-200 block mb-1">--${flag.name}</label>
          <select id="${flagId}" data-flag="${flag.name}" class="cli-flag-input w-full bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-xs font-mono text-zinc-300 outline-none">
            ${opts}
          </select>
          <p class="text-[10px] text-zinc-500 mt-1">${flag.description}</p>
        </div>
      `;
    } else {
      fieldsHtml += `
        <div class="bg-zinc-950/60 p-2.5 rounded-lg border border-zinc-800/80">
          <label for="${flagId}" class="font-mono font-bold text-zinc-200 block mb-1">--${flag.name}</label>
          <input type="text" id="${flagId}" data-flag="${flag.name}" placeholder="${flag.placeholder || ""}" class="cli-flag-input w-full bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-xs font-mono text-zinc-300 outline-none" />
          <p class="text-[10px] text-zinc-500 mt-1">${flag.description}</p>
        </div>
      `;
    }
  });

  fieldsHtml += `</div></div>`;
  cliFormContainer.innerHTML = fieldsHtml;

  // Listen to any input changes to update command preview
  cliFormContainer.querySelectorAll(".cli-flag-input, #cliArgValue").forEach((input) => {
    input.addEventListener("input", updateFormCommandPreview);
    input.addEventListener("change", updateFormCommandPreview);
  });

  updateFormCommandPreview();
}

function buildCommandStringFromForm(): string {
  const cmd = cliSchema.find((c) => c.name === activeCliCommand);
  if (!cmd) return `slippi ${activeCliCommand}`;

  const argInput = document.getElementById("cliArgValue") as HTMLInputElement | HTMLSelectElement;
  const argVal = argInput?.value || cmd.arg.placeholder;

  const flagParts: string[] = [];
  cmd.flags.forEach((f) => {
    const el = document.getElementById(`flag_${f.name}`) as HTMLInputElement | HTMLSelectElement;
    if (!el) return;

    if (f.type === "boolean") {
      if ((el as HTMLInputElement).checked) {
        flagParts.push(`--${f.name}`);
      }
    } else {
      const val = el.value.trim();
      if (val && val !== "all" && val !== f.default) {
        flagParts.push(`--${f.name}=${val}`);
      }
    }
  });

  return `slippi ${cmd.name} ${argVal} ${flagParts.join(" ")}`.trim();
}

function updateFormCommandPreview() {
  const cmdString = buildCommandStringFromForm();
  if (cliCommandPreview) {
    cliCommandPreview.textContent = cmdString;
  }
}

// Run CLI Command through Server API
async function runCliPrompt(prompt: string) {
  if (!cliTerminalOutput) return;

  const commandLine = document.createElement("div");
  commandLine.className = "text-indigo-400 font-mono text-xs font-bold py-1 flex items-center gap-2 border-b border-zinc-800/80";
  commandLine.innerHTML = `<span>$</span> <span>${escapeHtml(prompt)}</span> <span class="text-[10px] text-zinc-500 font-normal">[running...]</span>`;
  cliTerminalOutput.appendChild(commandLine);

  if (cliStatusBadge) {
    cliStatusBadge.className = "px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40 animate-pulse";
    cliStatusBadge.textContent = "RUNNING";
  }

  const startTime = Date.now();

  try {
    const res = await fetch("/api/cli/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt }),
    });

    const data = await res.json();
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);

    const outputBlock = document.createElement("div");
    outputBlock.className = "py-2 text-xs font-mono text-zinc-300 whitespace-pre-wrap leading-relaxed";

    if (data.stdout) {
      outputBlock.innerHTML = convertAnsiToHtml(data.stdout);
    }

    if (data.stderr) {
      const errBlock = document.createElement("div");
      errBlock.className = "text-rose-400 font-mono text-xs py-1";
      errBlock.innerHTML = convertAnsiToHtml(data.stderr);
      outputBlock.appendChild(errBlock);
    }

    cliTerminalOutput.appendChild(outputBlock);
    cliTerminalOutput.scrollTop = cliTerminalOutput.scrollHeight;

    if (cliStatusBadge) {
      if (data.exitCode === 0) {
        cliStatusBadge.className = "px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/40";
        cliStatusBadge.textContent = `OK (${elapsed}s)`;
      } else {
        cliStatusBadge.className = "px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-rose-500/20 text-rose-400 border border-rose-500/40";
        cliStatusBadge.textContent = `EXIT ${data.exitCode}`;
      }
    }

    // If mechanics command, also render visual canvas data
    if (prompt.includes("mechanics") || prompt.includes("inputs")) {
      extractAndRenderScatterPlot(data.stdout);
    }
  } catch (err: any) {
    const errDiv = document.createElement("div");
    errDiv.className = "text-red-400 font-mono text-xs py-2";
    errDiv.textContent = `Failed to execute CLI command: ${err.message}`;
    cliTerminalOutput.appendChild(errDiv);

    if (cliStatusBadge) {
      cliStatusBadge.className = "px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-red-500/20 text-red-400";
      cliStatusBadge.textContent = "ERROR";
    }
  }
}

// Convert Terminal ANSI Escape codes into formatted HTML
function convertAnsiToHtml(text: string): string {
  const ansiMap: Record<string, string> = {
    "1": "font-weight: 700;",
    "2": "opacity: 0.7;",
    "31": "color: #f87171;",
    "32": "color: #4ade80;",
    "33": "color: #facc15;",
    "34": "color: #60a5fa;",
    "35": "color: #c084fc;",
    "36": "color: #38bdf8;",
    "37": "color: #f4f4f5;",
    "0": "",
  };

  const escaped = escapeHtml(text);
  return escaped.replace(/\x1b\[([0-9;]+)m/g, (_, codeStr) => {
    const codes = codeStr.split(";");
    if (codes.includes("0") || codes.length === 0) {
      return "</span>";
    }
    const styles = codes.map((c: string) => ansiMap[c] || "").join(" ");
    return `<span style="${styles}">`;
  });
}

// Draw GameCube Controller Analog Gate on Canvas
function drawStickDeadzone() {
  if (!stickCanvas) return;
  const ctx = stickCanvas.getContext("2d");
  if (!ctx) return;

  const w = stickCanvas.width;
  const h = stickCanvas.height;
  const cx = w / 2;
  const cy = h / 2;
  const r = w * 0.42;

  ctx.clearRect(0, 0, w, h);

  // Outer gate octagon
  ctx.strokeStyle = "#3f3f46";
  ctx.lineWidth = 3;
  ctx.beginPath();
  for (let i = 0; i < 8; i++) {
    const angle = (i * Math.PI) / 4 + Math.PI / 8;
    const x = cx + r * Math.cos(angle);
    const y = cy + r * Math.sin(angle);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fillStyle = "#18181b";
  ctx.fill();
  ctx.stroke();

  // Crosshairs
  ctx.strokeStyle = "#27272a";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(cx - r, cy);
  ctx.lineTo(cx + r, cy);
  ctx.moveTo(cx, cy - r);
  ctx.lineTo(cx, cy + r);
  ctx.stroke();

  // Neutral Deadzone circle (0.2875)
  ctx.strokeStyle = "#4f46e5";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.2875, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(79, 70, 229, 0.1)";
  ctx.fill();
  ctx.stroke();

  // Wavedash angle notch zones (bottom diagonal sectors)
  ctx.fillStyle = "rgba(234, 179, 8, 0.15)";
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.arc(cx, cy, r, Math.PI * 0.15, Math.PI * 0.4);
  ctx.closePath();
  ctx.fill();

  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.arc(cx, cy, r, Math.PI * 0.6, Math.PI * 0.85);
  ctx.closePath();
  ctx.fill();
}

function extractAndRenderScatterPlot(stdout: string) {
  if (!stickCanvas) return;
  drawStickDeadzone();
  const ctx = stickCanvas.getContext("2d");
  if (!ctx) return;

  const w = stickCanvas.width;
  const h = stickCanvas.height;
  const cx = w / 2;
  const cy = h / 2;
  const r = w * 0.42;

  // Extract sampled stick coordinates from stdout lines like:
  // Stick: (-0.738, -0.663)
  const regex = /Stick:\s*\((-?[0-9.]+),\s*(-?[0-9.]+)\)/g;
  let match;
  let pointsCount = 0;

  ctx.fillStyle = "#38bdf8";
  while ((match = regex.exec(stdout)) !== null) {
    const sx = parseFloat(match[1]);
    const sy = parseFloat(match[2]);
    const px = cx + sx * r;
    const py = cy - sy * r; // Invert Y for canvas

    ctx.beginPath();
    ctx.arc(px, py, 4, 0, Math.PI * 2);
    ctx.fill();
    pointsCount++;
  }

  const label = document.getElementById("scatterPointsCount");
  if (label) {
    label.textContent = `${pointsCount} wavedash angle points rendered`;
  }
}

function handleUserFile(file: File) {
  selectedFile = file;
  selectedSamplePath = "";
  activeFileName.textContent = `${file.name} (${formatBytes(file.size)})`;
  addLog("FILE", `Loaded local file: ${file.name} (${formatBytes(file.size)})`);
  startStreamBtn.disabled = false;
  analyzeRawFile(file);
}

async function fetchReplayCatalog() {
  try {
    const res = await fetch("/api/replays");
    const data = await res.json();
    availableReplays = data.replays || [];

    sampleSelect.innerHTML = "";
    const groups: Record<string, ReplaySummary[]> = {};

    availableReplays.forEach((r) => {
      const cat = r.category || "General";
      if (!groups[cat]) groups[cat] = [];
      groups[cat].push(r);
    });

    Object.entries(groups).forEach(([category, replays]) => {
      const optGroup = document.createElement("optgroup");
      optGroup.label = category;
      replays.forEach((r) => {
        const opt = document.createElement("option");
        opt.value = r.filename;
        opt.textContent = `${r.filename} (${formatBytes(r.size)})`;
        if (r.filename === selectedSamplePath) opt.selected = true;
        optGroup.appendChild(opt);
      });
      sampleSelect.appendChild(optGroup);
    });

    renderReplayGallery(availableReplays);
  } catch (err) {
    console.error("Failed to fetch replay list:", err);
    addLog("ERROR", "Could not fetch replays catalog from server.");
  }
}

function renderReplayGallery(replays: ReplaySummary[]) {
  const container = document.getElementById("replayGalleryGrid");
  if (!container) return;

  container.innerHTML = "";
  replays.forEach((r) => {
    const card = document.createElement("div");
    card.className =
      "bg-zinc-900/90 border border-zinc-800 rounded-lg p-3 hover:border-indigo-500/50 transition cursor-pointer flex flex-col justify-between";
    card.innerHTML = `
      <div>
        <div class="flex items-center justify-between mb-1">
          <span class="text-xs font-mono font-medium text-indigo-400 bg-indigo-950/60 px-2 py-0.5 rounded">${r.category}</span>
          <span class="text-xs text-zinc-500 font-mono">${formatBytes(r.size)}</span>
        </div>
        <div class="text-sm font-semibold text-zinc-200 truncate mt-1" title="${r.filename}">${r.name}</div>
        <div class="text-xs text-zinc-400 font-mono truncate mt-0.5">${r.filename}</div>
      </div>
      <div class="mt-3 flex gap-2">
        <button class="select-rep-btn text-xs bg-indigo-600 hover:bg-indigo-500 text-white font-medium px-2 py-1 rounded transition flex-1" data-path="${r.filename}">
          CLI Run
        </button>
        <button class="analyze-rep-btn text-xs bg-zinc-800 hover:bg-zinc-700 text-zinc-300 px-2 py-1 rounded transition" data-path="${r.filename}">
          Match
        </button>
      </div>
    `;

    card.querySelector(".select-rep-btn")?.addEventListener("click", (e) => {
      e.stopPropagation();
      selectedSamplePath = r.filename;
      selectedFile = null;
      sampleSelect.value = r.filename;
      activeFileName.textContent = r.filename;
      (document.querySelector('[data-tab="cliTab"]') as HTMLButtonElement)?.click();
      const prompt = `slippi mechanics slp/${r.filename} --details`;
      cliPromptInput.value = prompt;
      runCliPrompt(prompt);
    });

    card.querySelector(".analyze-rep-btn")?.addEventListener("click", (e) => {
      e.stopPropagation();
      selectedSamplePath = r.filename;
      selectedFile = null;
      sampleSelect.value = r.filename;
      activeFileName.textContent = r.filename;
      loadAndAnalyzePreset(r.filename);
      (document.querySelector('[data-tab="analysisTab"]') as HTMLButtonElement)?.click();
    });

    container.appendChild(card);
  });
}

// Server-side match analysis
async function loadAndAnalyzePreset(filename: string) {
  try {
    addLog("API", `Requesting server analysis for ${filename}...`);
    const res = await fetch("/api/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ filename }),
    });

    if (!res.ok) throw new Error(`Server returned ${res.status}`);
    const data = await res.json();
    renderAnalysisData(data);
    addLog("API", `Analysis complete for ${filename}!`);
  } catch (err: any) {
    console.error("Analysis failed:", err);
    addLog("ERROR", `Analysis failed: ${err.message}`);
  }
}

async function analyzeRawFile(file: File) {
  try {
    addLog("API", `Uploading and analyzing ${file.name}...`);
    const buffer = await file.arrayBuffer();
    const res = await fetch("/api/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream" },
      body: buffer,
    });

    if (!res.ok) throw new Error(`Server returned ${res.status}`);
    const data = await res.json();
    renderAnalysisData(data);
    addLog("API", `Analysis complete for ${file.name}!`);
  } catch (err: any) {
    console.error("Analysis failed:", err);
    addLog("ERROR", `Analysis failed: ${err.message}`);
  }
}

function renderAnalysisData(data: any) {
  const container = document.getElementById("matchAnalysisView");
  if (!container) return;

  const { settings, metadata, stats, gameEnd, winners, stageName, filename } = data;
  const players = settings?.players || [];
  const winnerIndices = new Set((winners || []).map((w: any) => w.playerIndex));

  const totalFrames = stats?.playableFrameCount || stats?.lastFrame || 0;
  const minutes = Math.floor(totalFrames / 3600);
  const seconds = Math.floor((totalFrames % 3600) / 60);
  const formattedDuration = `${minutes}:${seconds.toString().padStart(2, "0")}`;

  const playersHtml = players
    .map((p: any) => {
      const isWinner = winnerIndices.has(p.playerIndex);
      const overall = (stats?.overall || []).find((o: any) => o.playerIndex === p.playerIndex) || {};
      const actionCount = (stats?.actionCounts || []).find((a: any) => a.playerIndex === p.playerIndex) || {};

      const portColors = ["border-red-500", "border-blue-500", "border-yellow-500", "border-emerald-500"];
      const badgeBg = ["bg-red-600", "bg-blue-600", "bg-yellow-600", "bg-emerald-600"];

      const port = p.playerIndex;
      const borderClass = portColors[port] || "border-zinc-700";
      const bColor = badgeBg[port] || "bg-zinc-700";

      return `
      <div class="bg-zinc-900/90 border ${borderClass} rounded-xl p-5 relative overflow-hidden flex flex-col justify-between">
        ${isWinner ? `<div class="absolute top-2 right-2 bg-amber-500/20 text-amber-300 border border-amber-500/40 text-xs font-bold px-2.5 py-1 rounded-full flex items-center gap-1">👑 Winner</div>` : ""}
        <div>
          <div class="flex items-center gap-3 mb-3">
            <span class="${bColor} text-white font-black text-xs px-2 py-0.5 rounded">P${port + 1}</span>
            <div>
              <h3 class="text-lg font-bold text-zinc-100 flex items-center gap-2">
                ${p.displayName || p.connectCode || p.characterName}
              </h3>
              <p class="text-xs text-zinc-400 font-mono">${p.characterName} (${p.characterColorName || "Default"})</p>
            </div>
          </div>

          <div class="grid grid-cols-2 gap-2 text-xs font-mono my-4">
            <div class="bg-zinc-950/70 p-2.5 rounded border border-zinc-800">
              <span class="text-zinc-500 block">Total Damage</span>
              <span class="text-zinc-200 text-base font-bold">${Math.round(overall.totalDamage || 0)}%</span>
            </div>
            <div class="bg-zinc-950/70 p-2.5 rounded border border-zinc-800">
              <span class="text-zinc-500 block">Kills</span>
              <span class="text-zinc-200 text-base font-bold">${overall.killCount || 0}</span>
            </div>
            <div class="bg-zinc-950/70 p-2.5 rounded border border-zinc-800">
              <span class="text-zinc-500 block">APM</span>
              <span class="text-zinc-200 text-base font-bold">${Math.round(overall.inputsPerMinute?.ratio || 0)}</span>
            </div>
            <div class="bg-zinc-950/70 p-2.5 rounded border border-zinc-800">
              <span class="text-zinc-500 block">Openings / Kill</span>
              <span class="text-zinc-200 text-base font-bold">${overall.openingsPerKill?.ratio ? overall.openingsPerKill.ratio.toFixed(1) : "N/A"}</span>
            </div>
          </div>

          <div class="space-y-1.5 text-xs text-zinc-400 font-mono border-t border-zinc-800 pt-3">
            <div class="flex justify-between">
              <span>Wavedashes:</span>
              <span class="text-zinc-200 font-bold">${actionCount.wavedashCount || 0}</span>
            </div>
            <div class="flex justify-between">
              <span>Wavelands:</span>
              <span class="text-zinc-200 font-bold">${actionCount.wavelandCount || 0}</span>
            </div>
            <div class="flex justify-between">
              <span>Grabs / Throws:</span>
              <span class="text-zinc-200 font-bold">${actionCount.grabCount || 0} / ${actionCount.throwCount || 0}</span>
            </div>
            <div class="flex justify-between">
              <span>L-Cancel Success:</span>
              <span class="text-zinc-200 font-bold">
                ${
                  actionCount.lCancelCount
                    ? `${actionCount.lCancelCount.success} / ${actionCount.lCancelCount.success + actionCount.lCancelCount.fail}`
                    : "N/A"
                }
              </span>
            </div>
          </div>
        </div>
      </div>
    `;
    })
    .join("");

  const stocks = stats?.stocks || [];
  let stockTimelineHtml = "";
  if (stocks.length > 0) {
    stockTimelineHtml = `
      <div class="bg-zinc-900/90 border border-zinc-800 rounded-xl p-5 mt-6">
        <h4 class="text-sm font-bold text-zinc-200 uppercase tracking-wider mb-4 flex items-center gap-2">
          <span>🕒 Stock Loss Timeline</span>
        </h4>
        <div class="overflow-x-auto">
          <table class="w-full text-left text-xs font-mono">
            <thead>
              <tr class="text-zinc-500 border-b border-zinc-800 pb-2">
                <th class="py-2">Player</th>
                <th>Stock #</th>
                <th>Start Frame</th>
                <th>End Frame</th>
                <th>Final %</th>
                <th>Duration</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-zinc-800/60">
              ${stocks
                .map((s: any) => {
                  const durationSeconds = s.endFrame ? ((s.endFrame - s.startFrame) / 60).toFixed(1) : "Alive";
                  return `
                  <tr class="hover:bg-zinc-800/30">
                    <td class="py-2.5 font-bold text-zinc-300">P${s.playerIndex + 1}</td>
                    <td>${s.count}</td>
                    <td>${s.startFrame}</td>
                    <td>${s.endFrame != null ? s.endFrame : "Still Alive"}</td>
                    <td class="text-amber-400 font-bold">${Math.round(s.currentPercent || 0)}%</td>
                    <td>${durationSeconds}s</td>
                  </tr>
                `;
                })
                .join("")}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }

  container.innerHTML = `
    <div class="bg-gradient-to-r from-zinc-900 via-indigo-950/40 to-zinc-900 border border-zinc-800 rounded-xl p-6 mb-6">
      <div class="flex flex-wrap items-center justify-between gap-4">
        <div>
          <div class="flex items-center gap-2 mb-1">
            <span class="bg-indigo-600/30 text-indigo-300 border border-indigo-500/30 text-xs font-mono px-2 py-0.5 rounded">
              ${filename}
            </span>
            <span class="text-zinc-500 text-xs font-mono">
              ${metadata?.startAt ? new Date(metadata.startAt).toLocaleString() : ""}
            </span>
          </div>
          <h2 class="text-2xl font-black text-white tracking-tight flex items-center gap-3">
            <span>🏟️ ${stageName}</span>
          </h2>
        </div>
        <div class="flex items-center gap-4 text-right">
          <div class="bg-zinc-950/60 border border-zinc-800/80 px-4 py-2 rounded-lg">
            <span class="text-xs text-zinc-500 block uppercase">Match Length</span>
            <span class="text-lg font-mono font-bold text-indigo-400">${formattedDuration}</span>
            <span class="text-xs text-zinc-500 font-mono">(${totalFrames} frames)</span>
          </div>
          ${
            gameEnd?.gameEndMethod
              ? `
            <div class="bg-zinc-950/60 border border-zinc-800/80 px-4 py-2 rounded-lg">
              <span class="text-xs text-zinc-500 block uppercase">End Method</span>
              <span class="text-sm font-mono font-bold text-zinc-300">Method #${gameEnd.gameEndMethod}</span>
              ${gameEnd.lrasInitiatorIndex != null && gameEnd.lrasInitiatorIndex !== -1 ? `<span class="text-xs text-red-400 block">LRAS: P${gameEnd.lrasInitiatorIndex + 1}</span>` : ""}
            </div>
          `
              : ""
          }
        </div>
      </div>
    </div>

    <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
      ${playersHtml}
    </div>

    ${stockTimelineHtml}
  `;
}

// Browser streaming simulation
async function startStreamingReplay() {
  if (isStreaming) return;

  isStreaming = true;
  isPaused = false;
  streamingAbortController = new AbortController();

  startStreamBtn.disabled = true;
  pauseStreamBtn.disabled = false;
  stopStreamBtn.disabled = false;
  pauseStreamBtn.textContent = "⏸ Pause";

  resetStreamStats();
  startTime = Date.now();
  updateStatsDisplay();

  const chunkSize = parseInt(chunkSizeInput.value, 10) || 1024;
  const delayMs = parseInt(delayMsInput.value, 10) || 10;

  addLog("STREAM", `Starting stream simulation with ${chunkSize}B chunks and ${delayMs}ms delay...`);

  try {
    let uint8Array: Uint8Array;

    if (selectedFile) {
      const buffer = await selectedFile.arrayBuffer();
      uint8Array = new Uint8Array(buffer);
    } else {
      const url = `/api/replay-stream?file=${encodeURIComponent(selectedSamplePath)}`;
      addLog("STREAM", `Fetching binary data from ${url}...`);
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Failed to load replay file: ${res.statusText}`);
      const buffer = await res.arrayBuffer();
      uint8Array = new Uint8Array(buffer);
    }

    const slpStream = new SlpStream();
    const slpParser = new SlpParser();

    slpStream.on(SlpStreamEvent.COMMAND, (data: any) => {
      streamStats.totalEvents++;
      const cmdName = (Command as any)[data.command] || `0x${data.command.toString(16)}`;
      streamStats.commandCounts[cmdName] = (streamStats.commandCounts[cmdName] || 0) + 1;
      slpParser.handleCommand(data.command, data.payload);
    });

    slpParser.on(SlpParserEvent.SETTINGS, (settings: any) => {
      const stage = stages.getStageName(settings.stageId) || `Stage #${settings.stageId}`;
      addLog("SETTINGS", `Game Started | Stage: ${stage} | Players: ${settings.players?.length || 0}`, "settings");
    });

    slpParser.on(SlpParserEvent.FRAME, () => {
      streamStats.framesProcessed++;
    });

    slpParser.on(SlpParserEvent.FINALIZED_FRAME, (frame: any) => {
      streamStats.finalizedFrames++;
      if (streamStats.finalizedFrames % 60 === 0 || streamStats.finalizedFrames <= 5) {
        addLog("FRAME", `Finalized frame #${frame?.frame ?? "unknown"}`, "frame");
      }
      updateStatsDisplay();
    });

    slpParser.on(SlpParserEvent.END, (gameEnd: any) => {
      addLog("END", `Game Ended! Method: ${gameEnd.gameEndMethod}, LRAS: ${gameEnd.lrasInitiatorIndex ?? "None"}`, "end");
      updateStatsDisplay();
    });

    let offset = 0;
    const totalSize = uint8Array.length;

    while (offset < totalSize && !streamingAbortController.signal.aborted) {
      if (isPaused) {
        await sleep(100);
        continue;
      }

      const chunk = uint8Array.slice(offset, offset + chunkSize);
      slpStream.process(chunk);
      offset += chunk.length;

      const progress = Math.min(100, Math.round((offset / totalSize) * 100));
      updateProgress(progress);

      if (delayMs > 0) {
        await sleep(delayMs);
      }
    }

    if (!streamingAbortController.signal.aborted) {
      updateProgress(100);
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
      addLog(
        "STREAM",
        `🎉 Stream complete in ${elapsed}s! Processed ${streamStats.totalEvents} events, ${streamStats.framesProcessed} frames (${streamStats.finalizedFrames} finalized).`,
        "complete",
      );
    }
  } catch (err: any) {
    console.error("Streaming error:", err);
    addLog("ERROR", `Stream error: ${err.message}`);
  } finally {
    isStreaming = false;
    isPaused = false;
    startStreamBtn.disabled = false;
    pauseStreamBtn.disabled = true;
    stopStreamBtn.disabled = true;
    updateStatsDisplay();
  }
}

function stopStreamingReplay() {
  if (streamingAbortController) {
    streamingAbortController.abort();
  }
  isStreaming = false;
  isPaused = false;
  startStreamBtn.disabled = false;
  pauseStreamBtn.disabled = true;
  stopStreamBtn.disabled = true;
  addLog("STREAM", "Stream stopped by user.");
}

function resetStreamStats() {
  streamStats.totalEvents = 0;
  streamStats.framesProcessed = 0;
  streamStats.finalizedFrames = 0;
  streamStats.commandCounts = {};
  startTime = 0;
}

function updateStatsDisplay() {
  totalEventsEl.textContent = streamStats.totalEvents.toLocaleString();
  framesProcessedEl.textContent = streamStats.framesProcessed.toLocaleString();
  finalizedFramesEl.textContent = streamStats.finalizedFrames.toLocaleString();

  if (startTime > 0) {
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    elapsedTimeEl.textContent = `${elapsed}s`;
  } else {
    elapsedTimeEl.textContent = "0s";
  }
}

function updateProgress(percent: number) {
  progressBar.style.width = `${percent}%`;
  progressBar.textContent = `${percent}%`;
}

function addLog(type: string, message: string, category: string = "info") {
  const timestamp = new Date().toISOString().substring(11, 23);
  const entry = document.createElement("div");
  entry.className = "log-entry font-mono text-xs py-1 border-b border-zinc-800/60 flex items-start gap-2";
  entry.dataset.type = category;

  const typeColors: Record<string, string> = {
    STREAM: "text-indigo-400 bg-indigo-950/60 border-indigo-800/40",
    SETTINGS: "text-amber-400 bg-amber-950/60 border-amber-800/40",
    FRAME: "text-cyan-400 bg-cyan-950/60 border-cyan-800/40",
    END: "text-rose-400 bg-rose-950/60 border-rose-800/40",
    API: "text-emerald-400 bg-emerald-950/60 border-emerald-800/40",
    FILE: "text-blue-400 bg-blue-950/60 border-blue-800/40",
    WARN: "text-yellow-400 bg-yellow-950/60 border-yellow-800/40",
    ERROR: "text-red-400 bg-red-950/60 border-red-800/40",
  };

  const badgeClass = typeColors[type] || "text-zinc-400 bg-zinc-800 border-zinc-700";

  entry.innerHTML = `
    <span class="text-zinc-500 shrink-0">[${timestamp}]</span>
    <span class="px-1.5 py-0.2 rounded border text-[10px] font-bold tracking-wider shrink-0 ${badgeClass}">${type}</span>
    <span class="text-zinc-300 break-all">${escapeHtml(message)}</span>
  `;

  const currentFilter = logFilter.value;
  if (currentFilter !== "all" && category !== currentFilter) {
    entry.style.display = "none";
  }

  eventLog.appendChild(entry);
  eventLog.scrollTop = eventLog.scrollHeight;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

function escapeHtml(text: string): string {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

window.addEventListener("DOMContentLoaded", init);
