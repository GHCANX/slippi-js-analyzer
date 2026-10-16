---
name: slippi-peppi-spec
description: >
  Comprehensive specification, binary event structures, parsing protocols,
  columnar Arrow data modeling, and advanced mechanics heuristics for Project
  Slippi (.slp) and Peppi Super Smash Bros. Melee replay ecosystems.
---

# Project Slippi (.slp) & Peppi Replay Specification Skill

This skill provides an authoritative, AI-readable guide to parsing, inspecting, transforming, and calculating statistics from Super Smash Bros. Melee replay files (`.slp`) and the Peppi columnar replay format.

## Overview of Replay Architectures

### 1. Slippi Replay Container (.slp)
A `.slp` replay is a binary container conforming to Draft 12 of the **UBJSON (Universal Binary JSON)** specification with two top-level keys in strict order:
1. `raw`: An optimized byte array `[$U#lXXXX]` containing discrete binary event packets emitted directly by the Melee game engine hook.
2. `metadata`: A standard UBJSON object containing game metadata (`startAt`, `lastFrame`, `players`, `playedOn`, `consoleNick`).

### 2. Peppi Replay Architecture (`peppi-slp` / `peppi-py`)
Developed by Hohav, **Peppi** introduces a high-performance alternative format and parsing model for Melee replays:
- **Columnar Arrow Representation**: Instead of row-oriented frame trees, frame updates are structured into **Apache Arrow (`frames.arrow`)** columnar tables, achieving ~2x higher compression and zero-copy queries across Rust, Python (`peppi-py`), and Julia.
- **Deconstructed JSON Manifests**: Splits game configuration into distinct JSON documents:
  - `peppi.json`: Format version and manifest.
  - `start.json`: Parsed game start, stage, character slots, and controller fixes.
  - `end.json`: Game conclusion method, LRAS initiator, and placements.
  - `metadata.json`: Replay timestamps and player netplay tags.

---

## Core Knowledge References

For granular binary specifications, bitfields, and algorithmic heuristics, refer to the documentation files in `references/`:

- **[SLP Binary Specification](references/slp_binary_spec.md)**:
  - Byte offsets, command headers (`0x10`, `0x35`–`0x41`), payload sizes, and big-endian encoding.
  - Game bitfields (Timers, modes, friendly fire, item spawn tables).
  - Pre-frame controller inputs (analog stick, C-stick, trigger values, physical/processed buttons).
  - Post-frame state flags (hitstun, shield, intangibility, hitlag, powershield, death, L-cancel status).
  - Environmental stage events (Fountain of Dreams platform heights, Whispy wind, Stadium transformations).

- **[Peppi Architecture & Arrow Data Model](references/peppi_architecture.md)**:
  - Columnar frame schema (FlatBuffers / Arrow RecordBatches).
  - Zero-copy deserialization and Python integration (`peppi-py` DataFrame queries).
  - Format conversion protocols between raw `.slp` and Peppi `.arrow` streams.

- **[Melee Advanced Mechanics Heuristics](references/melee_mechanics_heuristics.md)**:
  - Frame-state transition state machines for **Wavedashes & Wavelands** (Jumpsquat `0x18` -> `0x2b`).
  - **Waveshine Detection** (Fox/Falco Down-B -> Jump Cancel -> Airdodge).
  - **Dash Dance Analysis** (Dash `0x14` stick flick alternation without Turn `0x12` or Skid `0x15`).
  - **L-Cancel & Edge-Cancel** verification (Landing states `0x46`–`0x4a` vs. Ledge Teeter `0x19`).
  - Controller gate coordinate trigonometry and notch deadzones.

---

## Quick Reference: Slippi Event Commands

| Byte | Event Name | Frequency | Version | Key Data Contained |
| :---: | :--- | :--- | :---: | :--- |
| `0x35` | **Event Payloads** | Exactly once (first byte) | `0.1.0` | Command sizes mapping (`3n+1` bytes) |
| `0x36` | **Game Start** | Exactly once | `0.1.0` | Stage ID, characters, UCF fixes, connect codes, session ID |
| `0x37` | **Pre-Frame Update** | 1 per frame per port | `0.1.0` | Controller stick X/Y, C-stick X/Y, triggers, raw UCF analog, buttons |
| `0x38` | **Post-Frame Update** | 1 per frame per port | `0.1.0` | Action state ID, position, percent, shield, hitstun, L-cancel status |
| `0x39` | **Game End** | Exactly once (last byte) | `0.1.0` | Game end method (1=TIME, 2=GAME, 7=No Contest), LRAS player, placements |
| `0x3A` | **Frame Start** | 1 per frame | `2.2.0` | RNG seed, scene frame counter (detects pauses) |
| `0x3B` | **Item Update** | 0–15 per frame | `3.0.0` | Projectiles, turnip faces, charge shot, item positions |
| `0x3C` | **Frame Bookend** | 1 per frame | `3.0.0` | Latest finalized frame index (rollback safe boundary) |
| `0x3D` | **Gecko List** | In message splitters | `3.3.0` | Active Gecko codes loaded in Dolphin / console |
| `0x3F` | **FOD Platforms** | Variable | `3.18.0` | Fountain of Dreams left/right platform heights |
| `0x40` | **Whispy Wind** | Variable | `3.18.0` | Dream Land 64 wind blow direction (0=None, 1=Left, 2=Right) |
| `0x41` | **Stadium Transform**| Variable | `3.18.0` | Pokémon Stadium transformation subevents and types |
| `0x10` | **Message Splitter** | Variable | `3.3.0` | Chunked transport for oversized events (Gecko codes) |
