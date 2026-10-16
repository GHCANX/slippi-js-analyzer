# Slippi-JS Developer CLI & Advanced Mechanics Toolkit

A developer command-line interface and batch processing engine paired with a friendly browser-based command workbench to parse, inspect, filter, and export Super Smash Bros. Melee `.slp` replays. This revised architecture focuses deeply on **user control/input analysis and advanced Melee mechanics** (wavedashes, waveshines, dash dancing, L-cancels, edge-cancels), providing granular telemetry on input variance and execution patterns.

## User Review & Critical Decisions

> [!IMPORTANT]
> **Key Decisions & Confirmations (Revised)**:
> 1. **Local CLI Execution with Browser Interface**: The CLI runs locally (`bin/slippi.mjs`) with access to the local filesystem. The browser application acts as a clean, intuitive workbench featuring a direct terminal text-box prompt as well as a visual Command Builder with form fields, optional flags, and tooltips that constructs and executes commands on the local CLI.
> 2. **Advanced Mechanics & Input Variance Focus**: Rather than basic game summaries, the core analytical focus is placed on dissecting controller input variance and frame-by-frame patterns to identify high-level Melee mechanics:
>    - **Wavedashes & Wavelands**: Jumpsquat frame timing, diagonal airdodge angle variance, landing friction, and execution tightness.
>    - **Waveshines (Fox & Falco)**: Shine (Down-B) activation -> jump cancel frame -> diagonal airdodge landing -> follow-up latency.
>    - **Dash Dancing**: Left/Right dash state alternation without entering turn-skid; rhythm, frequency, and pivot accuracy.
>    - **L-Cancels & Edge-Cancels**: Shield inputs within 1-7 frames of landing vs. aerial landing lag; deliberate ledge edge-cancels distinguished from failed L-cancels.
> 3. **Catalog of Tools Revised**: Minigame tools (Home-Run Contest, Break the Targets) have been permanently removed from the scope and tool catalog.
> 4. **Future-Proof Optional Fields & Flags**: Every command is designed with modular, extensible flags (`--player`, `--tech`, `--window`, `--stick-scatter`, `--format`, `--details`, `--concurrency`, `--export`).

---

## 1. Focused Catalog of `slippi-js` Tools & Engines

| Category | Component / Tool | Core Functionality & Mechanics Role |
| :--- | :--- | :--- |
| **Replay Ingestion** | `SlippiGame` (Node & Browser) | Primary entrypoint for loading local `.slp` file paths and binary buffers; enables lazy access to frame trees, metadata, settings, and player inputs. |
| **Stream Engine** | `SlpStream` & `SlpParser` | Low-level event pipeline translating raw binary replay frames (`0x36` Pre-Frame, `0x37` Post-Frame, `0x35` Start, `0x38` End, `0x3C` Gecko Codes). Handles rollback frames and finalized frame sequencing. |
| **Input & Controller Telemetry** | `InputComputer` + Raw Frame Inputs | Extracts analog stick coordinates (X, Y), C-stick coordinates, trigger values (L/R analog 0.0–1.0 and digital clicks), button masks (A, B, X, Y, Z), and computes overall APM & digital APM. |
| **Tech Skill Engine** | `ActionsComputer` | Base detection for wavedashes, wavelands, L-cancels, dash attacks, defensive tech rolls/in-place, missed techs, and grabs. |
| **Custom Mechanics Analyzer** *(New Module)* | `MeleeMechanicsAnalyzer` | Custom heuristics built on top of `ActionsComputer` and raw frame trees to compute **waveshines**, **dash dancing strings**, **edge-cancel aerials**, and controller stick angle variance. |
| **Combat & Conversions** | `ConversionComputer` & `ComboComputer` | Evaluates punish strings, multi-hit combos, openings per kill, damage per opening, counter-hits, neutral win ratios, and command grabs. |
| **Stocks & Lifetimes** | `StockComputer` | Calculates stock duration, damage taken, death animations, and death blastzone directions (Top, Bottom, Left, Right). |
| **Match Resolution** | `getWinners` & `Placings` | Resolves match outcomes across 1v1, FFA, and Teams (2v2); detects timeout decisions and identifies LRAS (ragequit) initiators. |
| **Melee Game Data** | `characters`, `stages`, `moves`, `animations` | Enums and databases for characters, costumes, tournament-legal stages, blastzone dimensions, move names, and animation state IDs. |

---

## 2. CLI Command Suite & Optional Flag Architecture

The CLI binary (`bin/slippi.mjs`) is invoked via terminal (`node bin/slippi.mjs <command>` or `npm run slippi -- <command>`). Every command features modular optional flags:

### 1. `slippi mechanics <file>`
Deep inspection of advanced execution mechanics and input variance.
- **Required**: `<file>` (Path to `.slp` file)
- **Optional Fields & Flags**:
  - `--player=<port|code>`: Filter analysis to a single player port (e.g. `1`, `P1`, `FAUST#123`). Default: all players.
  - `--tech=<all|wavedash|waveshine|dashdance|lcancel|edgecancel>`: Focus on specific mechanics. Default: `all`.
  - `--details` / `-d`: Display frame-by-frame breakdown of each mechanic execution (frame offset, stick angle, trigger value).
  - `--format=<table|json|csv>`: Output format. Default: `table`.
  - `--export=<path>`: Write results directly to a file.

### 2. `slippi inputs <file>`
Controller inputs, stick precision, and APM analysis.
- **Required**: `<file>` (Path to `.slp` file)
- **Optional Fields & Flags**:
  - `--player=<port|code>`: Filter to specific player.
  - `--stick-scatter`: Outputs 2D analog stick coordinate distribution across deadzones and rim notches.
  - `--window=<startFrame,endFrame>`: Inspect inputs during a specific frame range / interaction.
  - `--apm-breakdown`: Separates movement APM (stick flicks/dashes) from action APM (attacks/specials/shields).
  - `--format=<table|json>`: Default: `table`.

### 3. `slippi analyze <file>`
Complete match scorecard, player stats, and combat summary.
- **Required**: `<file>` (Path to `.slp` file)
- **Optional Fields & Flags**:
  - `--player=<port|code>`: Filter output to one player.
  - `--combos`: Include combo string details and damage progression.
  - `--summary-only`: Output high-level scorecard omitting stock tables.
  - `--format=<table|json|csv>`: Default: `table`.

### 4. `slippi batch <directory>`
Bulk processing of replay directories with multi-threaded performance.
- **Required**: `<directory>` (Path to folder containing `.slp` files)
- **Optional Fields & Flags**:
  - `--recursive` / `-r`: Scan subfolders recursively. Default: `true`.
  - `--concurrency=<N>`: Worker thread pool size. Default: `4`.
  - `--include-mechanics`: Include wavedash, L-cancel, and waveshine aggregates in batch report.
  - `--out=<path>`: Destination path for consolidated export (e.g. `report.csv` or `summary.json`).
  - `--format=<json|csv>`: Default: `json`.

### 5. `slippi filter <directory>`
Query and isolate specific replays matching mechanical or match criteria.
- **Required**: `<directory>`
- **Optional Fields & Flags**:
  - `--character=<name>`: Replays featuring Fox, Marth, Falco, Sheik, etc.
  - `--stage=<name>`: Specific stages (Battlefield, Dream Land, etc.).
  - `--player=<code>`: Filter by Netplay connect code.
  - `--winner=<code>`: Filter by winning player.
  - `--min-wavedashes=<N>`: Filter matches with high tech frequency.
  - `--min-l-cancel=<pct>`: e.g. `--min-l-cancel=80` for high execution matches.
  - `--copy-to=<path>`: Copy matched `.slp` files into a target folder.

### 6. `slippi stream <file>`
Live replay playback simulation via `SlpStream`.
- **Required**: `<file>`
- **Optional Fields & Flags**:
  - `--chunk-size=<bytes>`: Chunk size (256 - 8192). Default: `1024`.
  - `--delay=<ms>`: Millisecond pause between chunks. Default: `10`.
  - `--events=<command|settings|frame|end|all>`: Filter emitted console events.

---

## 3. Advanced Mechanics Pattern Recognition Architecture

To deliver genuine insight into user control and input variance, the `src/mechanics/` engine analyzes raw Slippi frame updates:

```
┌────────────────────────────────────────────────────────────────────────┐
│                        Melee Frame Input Stream                        │
│   Pre-Frame: Buttons, Joystick X/Y, C-Stick, Analog & Digital Triggers  │
│   Post-Frame: Action State ID, Character, Position, Velocity, Direction│
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
                                    ▼
       ┌────────────────────────────┼────────────────────────────┐
       │                            │                            │
       ▼                            ▼                            ▼
┌────────────────────────┐  ┌────────────────────────┐  ┌────────────────────────┐
│  Wavedash & Waveland   │  │  Waveshine Detection   │  │  Dash Dance Analysis   │
│ - Action State:        │  │ - Action State:        │  │ - State: Dash (0x14)   │
│   Kneebend (0x18)      │  │   Down-B / Reflector   │  │ - Stick X crosses 0    │
│   -> LandingFall (0x2B)│  │ - Jump Cancel frame    │  │   between +0.8 & -0.8  │
│ - Diagonal Airdodge:   │  │ - Kneebend -> Airdodge │  │ - No Turn_Wait (0x16)  │
│   Joystick Angle 15°-75│  │ - Time to next action  │  │ - Cadence & Pivot math │
└────────────────────────┘  └────────────────────────┘  └────────────────────────┘
       │                            │                            │
       ▼                            ▼                            ▼
┌────────────────────────┐  ┌────────────────────────┐  ┌────────────────────────┐
│ L-Cancel & Edge-Cancel │  │ Stick Precision Map    │  │ APM Breakdown          │
│ - Aerial Attack State  │  │ - 2D Coordinate bins   │  │ - Action Inputs        │
│ - Shield trigger -7..-1│  │ - Deadzone vs. Rim     │  │ - Movement Flicks      │
│ - Edge Teeter Override │  │ - Wavedash notch drift │  │ - Effective APM        │
└────────────────────────┘  └────────────────────────┘  └────────────────────────┘
```

---

## 4. Browser UI: Interactive Command Workbench & Terminal Prompt

The browser UI serves as the graphical control center for the local CLI, featuring two synchronized interaction modes:

1. **Interactive Command Builder (Friendly UI)**:
   - Visual command selector cards (`analyze`, `mechanics`, `inputs`, `batch`, `filter`, `stream`).
   - Form fields for required arguments (file pickers, directory selectors).
   - Toggles, dropdowns, and sliders for optional flags (Player select, Tech type, Format, Concurrency, Stick Scatter).
   - Dynamic Command Preview bar: updates the full CLI command string in real-time as the user toggles options.
2. **Terminal Prompt & Freeform Text-Box**:
   - An interactive terminal input line at the bottom where users can directly type or edit any command (e.g. `slippi mechanics slp/ranked_game1_tiebreak.slp --tech=wavedash --details`).
   - Command history navigation (Up/Down arrow keys).
   - Quick-preset execution chips for popular commands.
3. **Live Streaming Terminal Output**:
   - Web terminal viewport rendering real-time stdout/stderr from the local CLI execution with ANSI syntax highlighting and formatted tables.
4. **Visual Analytics Overlay**:
   - Alongside the terminal output, visual charts display the mechanics data:
     - 2D Controller Stick Scatter Plot showing wavedash input angles.
     - L-Cancel success vs. miss timeline and edge-cancel badges.
     - Wavedash / Waveshine execution consistency gauge (frame timing distribution).

---

## 5. Technical Implementation & Data Strategy

```
┌─────────────────────────────────────────────────────────────────────────┐
│                      Browser UI (Public / Client)                       │
│  - Command Builder (Forms & Flags)  - Freeform Terminal Prompt Textbox  │
│  - Live Terminal ANSI Viewer        - Mechanics & Scatter Visualizers   │
└────────────────────────────────────┬────────────────────────────────────┘
                                     │ HTTP POST /api/cli/run
                                     ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                           Node.js Express Server                        │
│  - Executes local CLI binary: `bin/slippi.mjs <args>`                   │
│  - Streams stdout/stderr chunks in real-time via Server-Sent Events/JSON│
│  - Direct access to local filesystem (`slp/` and uploaded replays)      │
└────────────────────────────────────┬────────────────────────────────────┘
                                     │
                                     ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                     Local CLI Engine (bin/slippi.mjs)                   │
│  - Argument parser: Commander / parseArgs with extensible flag schema   │
│  - Subcommands: mechanics, inputs, analyze, batch, filter, stream       │
└──────────────────┬──────────────────────────────────┬───────────────────┘
                   │                                  │
                   ▼                                  ▼
┌──────────────────────────────────┐┌─────────────────────────────────────┐
│  src/mechanics/                  ││  src/batch/                         │
│  - WavedashAnalyzer              ││  - MultiFileScanner                 │
│  - WaveshineAnalyzer             ││  - ConcurrencyPool                  │
│  - DashDanceAnalyzer             ││  - CSV/JSON Exporters               │
│  - LCancelEdgeCancelAnalyzer     ││  - FilterMatcher                    │
└──────────────────┬───────────────┘└─────────────────┬───────────────────┘
                   │                                  │
                   └─────────────────┬────────────────┘
                                     │
                                     ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                       @slippi/slippi-js Core SDK                        │
│  - SlippiGame (Binary Buffer/File)                                      │
│  - ActionsComputer, StatsComputer, StockComputer, ConversionComputer    │
│  - Melee Databases (characters, stages, moves, animations)              │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 6. Execution Plan & Phasing (Upon User Approval)

1. **Phase 1: Advanced Mechanics Engine (`src/mechanics/`)**:
   - Build `WavedashAnalyzer`: calculate jumpsquat timing, angle variance from ideal 17.5°/72.5° notch angles, and landing frame.
   - Build `WaveshineAnalyzer`: detect shine on-hit/whiff, jump cancel frame offset, and airdodge execution.
   - Build `DashDanceAnalyzer`: track directional stick flick frequency, dash state frames, and pivot quality.
   - Build `LCancelEdgeCancelAnalyzer`: evaluate landing frame vs. prior shield inputs and detect ledge teeter cancellations.
2. **Phase 2: CLI Binary & Commands (`bin/slippi.mjs`)**:
   - Implement CLI entry point with `mechanics`, `inputs`, `analyze`, `batch`, `filter`, and `stream` subcommands.
   - Implement formatted ASCII terminal tables and colored execution summaries.
   - Add CSV and JSON export output options for all commands.
3. **Phase 3: Backend CLI Runner API (`server.js`)**:
   - Add `/api/cli/run` endpoint to execute the local CLI with argument validation and stream real-time output.
   - Add `/api/cli/schema` returning all commands, arguments, optional flags, and descriptions.
4. **Phase 4: Browser UI Command Workbench (`public/index.html` & `client/app.ts`)**:
   - Build the interactive Command Builder form UI with dynamic flag toggles.
   - Build the freeform terminal prompt text-box with command history.
   - Build the live terminal output window with ANSI color rendering.
   - Build visual analytics cards for mechanics (stick scatter plot, wavedash timing gauges).
5. **Phase 5: Verification & Testing**:
   - Run CLI commands across test replays (`ranked_game1_tiebreak.slp`, `wavedash-1.slp`, `lCancel.slp`, `edge-cancel-1.slp`).
   - Run test suite and verify applet compilation via `compile_applet`.
