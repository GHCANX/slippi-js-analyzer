# Slippi & Peppi Knowledge Base

This directory houses the comprehensive AI-readable and developer reference documentation for Super Smash Bros. Melee replay engineering, covering the official Project Slippi (`.slp`) binary format and the high-performance Peppi (`peppi-slp` / `peppi-py`) columnar Arrow architecture.

## Documents

1. **[SLP Binary Specification](slp_binary_spec.md)**
   - Complete byte offset map for all events: Event Payloads (`0x35`), Game Start (`0x36`), Pre-Frame (`0x37`), Post-Frame (`0x38`), Game End (`0x39`), Frame Start (`0x3A`), Item Update (`0x3B`), Frame Bookends (`0x3C`), Gecko Codes (`0x3D`), Stage Hazards (`0x3F`, `0x40`, `0x41`), and Message Splitters (`0x10`).
   - Bitfield masks for game rules, item spawn tables, and player state flags (hitstun, shield, intangibility, hitlag, powershield).

2. **[Peppi Architecture & Arrow Data Model](peppi_architecture.md)**
   - Hohav's Peppi format deconstructed manifest (`peppi.json`, `metadata.json`, `start.json`, `end.json`).
   - Apache Arrow columnar table structure (`frames.arrow`) for vectorized, SIMD-accelerated queries.
   - Zero-copy Python integration via `peppi-py` and Arrow/Polars/DuckDB data pipelines.
   - Compression and query performance benchmarks comparing `.slp` and `.peppi`.

3. **[Melee Mechanics & Controller Telemetry Heuristics](melee_mechanics_heuristics.md)**
   - Precise state transition models and action state IDs for Wavedashing, Wavelanding, Waveshining, Dash Dancing, L-cancelling, and Edge-cancelling.
   - Character jumpsquat tables and execution timing metrics (`perfect`, `good`, `slow`).
   - Trigonometric stick angle variance analysis and GameCube octagonal notch deadzone geometry.

---
*Created as part of the Slippi-JS Developer Toolkit & Knowledge Engine.*
