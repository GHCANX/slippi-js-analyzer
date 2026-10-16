# Peppi Replay Architecture & Apache Arrow Data Model

This document outlines the architecture, data representation, and toolchain of **Peppi** (`hohav/peppi-slp` and `hohav/peppi-py`), an alternative high-performance parser and format for Super Smash Bros. Melee replays.

## 1. Peppi Design Philosophy & Goals

While Project Slippi's `.slp` format was designed for low-overhead real-time writing during gameplay (UBJSON with raw event streaming), analyzing thousands of replays across large data pipelines introduces bottlenecks:
1. **Row-Oriented Bottlenecks**: Standard `.slp` interleaves pre-frame, post-frame, item, and bookend packets on a per-frame basis. Extracting a single variable (e.g., all joystick coordinates for Fox across 10,000 matches) requires parsing the entire binary file.
2. **Compression Inefficiencies**: Interleaved data structures compress poorly because different data types (floats, bitmasks, character IDs) alternate rapidly.
3. **Cross-Language Friction**: Custom binary deserializers must be written from scratch in each language (TypeScript, Python, C++, Julia).

**Peppi resolves these challenges by:**
- Adopting **Apache Arrow** (`frames.arrow`) for frame telemetry, enabling columnar memory layouts, SIMD vectorization, and ~2x better compression than `.slp`.
- Enabling **Zero-Copy Deserialization** between Rust and Python (`peppi-py`) without JSON serialization overhead.
- Providing seamless compatibility with analytical engines like **Pandas, Polars, DuckDB, and Apache Parquet**.

---

## 2. The Peppi Container Format (`.peppi`)

A Peppi replay can exist as a directory or tar/zip archive containing deconstructed, specialized files:

```
my_replay.peppi/
├── peppi.json       <-- Format specification, Peppi version
├── metadata.json    <-- Slippi metadata (startAt, lastFrame, netplay tags)
├── start.json       <-- Game start parameters, stage, character slots
├── end.json         <-- End method, LRAS initiator, final placements
└── frames.arrow     <-- High-density columnar Apache Arrow table
```

### Manifest Specifications

#### `peppi.json`
```json
{
  "version": "2.0.0",
  "slp_version": "3.14.0"
}
```

#### `start.json`
Deconstructs the 312-byte Melee Game Info Block and Slippi Online fields into structured JSON:
- Stage name and ID.
- Players: Port, character ID, costume, player type (Human/CPU), UCF controller fix status, connect code, and display name.
- Game rules: Timer type, starting stocks, friendly fire, item spawn behavior.

#### `end.json`
- Game end method: `TIME`, `GAME`, `NO_CONTEST`.
- LRAS initiator index.
- Ranked placements vector.

---

## 3. The Apache Arrow Frame Schema (`frames.arrow`)

In `frames.arrow`, each frame attribute is stored in a contiguous column vector rather than discrete per-frame objects.

### Columnar Hierarchy
```
frames: StructArray [
  id: Int32Array (Frame numbers from -123 upwards)
  ports: ListArray [
    // One sub-table per active port (0-3)
    leader: StructArray [
      pre: StructArray [
        position: StructArray [ x: Float32Array, y: Float32Array ],
        facing: Float32Array,
        joystick: StructArray [ x: Float32Array, y: Float32Array ],
        cstick: StructArray [ x: Float32Array, y: Float32Array ],
        trigger_logical: Float32Array,
        trigger_physical: StructArray [ l: Float32Array, r: Float32Array ],
        buttons_processed: UInt32Array,
        buttons_physical: UInt16Array,
        damage: Float32Array
      ],
      post: StructArray [
        character: UInt8Array,
        state: UInt16Array,
        position: StructArray [ x: Float32Array, y: Float32Array ],
        facing: Float32Array,
        damage: Float32Array,
        shield: Float32Array,
        stocks: UInt8Array,
        hitstun: Float32Array,
        airborne: BooleanArray,
        l_cancel: UInt8Array,
        flags: UInt64Array
      ]
    ],
    follower: StructArray [...] // Nana (Ice Climbers)
  ],
  items: ListArray [...]        // Dynamic projectile/item updates per frame
]
```

### Analytical Advantages
1. **Vectorized Queries**: Filtering for all frames where `post.state == 0x14` (Dash) executes at memory bandwidth speed (gigabytes per second) using SIMD instructions.
2. **Column Pruning**: When analyzing only controller inputs, analytical engines read exclusively the `joystick` and `buttons` columns, completely ignoring positions, velocities, and items.
3. **Parquet Export**: An Arrow table converts directly to Apache Parquet files for massive multi-terabyte dataset storage in cloud data warehouses.

---

## 4. `peppi-slp` CLI & Toolchain

The `peppi-slp` crate provides the official CLI tool (`slp`) for interacting with replays:

- **Format Conversion**:
  - `slp convert input.slp output.peppi`: Converts raw `.slp` into the optimized Peppi format.
  - `slp convert input.peppi output.slp`: Reconstructs valid `.slp` files from Peppi format.
- **Header & Metadata Extraction**:
  - `slp info input.slp`: Fast extraction of game start, player tags, and duration without decoding frame tables.
- **Data Export**:
  - `slp json input.slp`: Exports complete match data to JSON streams.
  - `slp arrow input.slp`: Extracts frame data directly into Arrow IPC / Feather files.

---

## 5. `peppi-py` Python Bindings

`peppi-py` brings Peppi's Rust parser into Python with zero-copy PyArrow integration:

```python
import peppi_py
import pyarrow.compute as pc

# Fast parse directly to PyArrow Table
game = peppi_py.read_slippi("match.slp")
print(f"Stage: {game.start.stage}, Characters: {[p.character for p in game.start.players]}")

# Zero-copy access to Arrow frame table
frames_table = game.frames

# Filter frames using PyArrow / Polars
dash_frames = frames_table.filter(
    pc.equal(frames_table["ports"][0]["leader"]["post"]["state"], 0x14)
)
```

## 6. Compression & Performance Comparison

| Metric | Project Slippi (.slp) | Peppi (.peppi / .arrow) |
| :--- | :--- | :--- |
| **Container Format** | UBJSON + Raw Stream | Apache Arrow + JSON |
| **Average File Size (8 min match)**| ~8.5 MB | ~3.8 MB (uncompressed Arrow) |
| **Zstandard Compressed Size** | ~2.1 MB | ~0.9 MB |
| **Full Parse Speed (10k frames)** | ~85 ms (Node.js) | ~12 ms (Rust / Arrow SIMD) |
| **Single Column Query Speed** | Requires parsing full file | Sub-millisecond (Memory mapped) |
| **Primary Use Case** | Real-time write / live streaming | Big data analytics, ML training |
