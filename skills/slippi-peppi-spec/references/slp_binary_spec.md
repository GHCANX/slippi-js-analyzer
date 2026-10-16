# Slippi Replay (.slp) Binary Specification Reference

This document provides the authoritative binary layout, byte offsets, data types, and bitmasks for parsing Project Slippi replay files.

## 1. Container Structure (UBJSON Draft 12)

The `.slp` container is composed of two primary UBJSON keys:

```
[U][3][r][a][w][[][$][U][#][l][X][X][X][X]  <-- Binary stream (uint8 array, length XXXX)
[U][8][m][e][t][a][d][a][t][a][{]...        <-- UBJSON object
```

- **Endianness**: All integer and float values across both UBJSON and the internal game stream are strictly **Big-Endian**.
- **In-Progress Files**: When actively written during gameplay, the 32-bit raw length is initialized to `0x00000000` and updated upon match completion.
- **Header Parsing Shortcut**: To quickly extract metadata without parsing millions of frame bytes, a reader can skip the initial `raw` byte buffer using the 4-byte length prefix at offset `11` and immediately parse the `metadata` UBJSON dictionary.

---

## 2. Event Payloads (`0x35`)

The first event in the `raw` stream declares all supported commands and their payload lengths.

- **Formula**: Total payload size = `1 + 3 * n` bytes, where `n` is the number of command declarations.
- **Structure**:
  - `0x00`: `0x35` (Command byte)
  - `0x01`: Payload size (uint8)
  - `0x02 + 3*i`: Command byte (`0x36`, `0x37`, `0x38`, etc.)
  - `0x03 + 3*i`: Command payload size (uint16)

---

## 3. Game Start (`0x36`)

Occurs once immediately following `0x35`. Defines game rules, stage, characters, and player identities.

| Offset | Field Name | Type | Description |
| :---: | :--- | :---: | :--- |
| `0x00` | Command Byte | `uint8` | Always `0x36` |
| `0x01` | Version | `uint8[4]` | Extraction engine version: `major.minor.build.unused` |
| `0x05` | Game Info Block | `uint8[312]` | Native Melee game setup struct (see below) |
| `0x13D`| Random Seed | `uint32` | RNG seed initialized at match launch |
| `0x141 + 8*i` | Dashback Fix | `uint32` | Port `i` (0–3) UCF dashback: `0`=Off, `1`=UCF, `2`=Dween |
| `0x145 + 8*i` | Shield Drop Fix | `uint32` | Port `i` (0–3) UCF shield drop: `0`=Off, `1`=UCF, `2`=Dween |
| `0x161 + 16*i`| Nametag | `char16[8]` | Port `i` Shift-JIS encoded in-game nametag |
| `0x1A1`| PAL | `bool` | `1` = PAL version, `0` = NTSC |
| `0x1A2`| Frozen PS | `bool` | `1` = Frozen Pokémon Stadium |
| `0x1A3`| Minor Scene | `uint8` | Standard: `0x02` |
| `0x1A4`| Major Scene | `uint8` | `0x02` = Local VS, `0x08` = Online Netplay (Rollback active) |
| `0x1A5 + 31*i`| Display Name | `string` | Netplay display name (Shift-JIS, max 15 chars + null) |
| `0x221 + 10*i`| Connect Code | `string` | Slippi Connect Code (e.g. `ABCD#123`, max 10 bytes) |
| `0x249 + 29*i`| Slippi UID | `string` | Firebase user UID (max 28 chars + null) |
| `0x2BD`| Language | `uint8` | `0` = Japanese, `1` = English |
| `0x2BE`| Session ID | `string` | Unique match session ID (`mode.unranked-YYYY-MM-DD...`) |
| `0x2F1`| Game Number | `uint32` | Game counter for current session (starts at 1) |
| `0x2F5`| Tiebreak Number | `uint32` | Tiebreak index (0 if standard game) |

### Game Info Block (Offsets relative to `0x05`)

- `0x00` (Bitfield 1):
  - Bits 1–2 (`0x03`): Timer Mode (`0`=No timer, `2`=Count Down, `3`=Count Up)
  - Bits 6–8 (`0xE0`): Game Mode (`0`=Time, `1`=Stock, `2`=Coin, `3`=Bonus)
- `0x01` (Bitfield 2):
  - Bit 1 (`0x01`): Friendly Fire enabled
- `0x06`: Bomb Rain (`0`=Off, `>0`=Bombs drop after 20 seconds)
- `0x08`: Is Teams (`bool`)
- `0x0E`: Stage ID (`uint16`)
- `0x10`: Timer Seconds (`uint32`)
- `0x60 + 36*i`: Character ID (`uint8`, Port `i`)
- `0x61 + 36*i`: Player Type (`0`=Human, `1`=CPU, `2`=Demo, `3`=Empty)
- `0x62 + 36*i`: Starting Stocks (`uint8`, standard = 4)
- `0x63 + 36*i`: Costume Index (`uint8`)
- `0x69 + 36*i`: Team ID (`0`=Red, `1`=Blue, `2`=Green)

---

## 4. Pre-Frame Update (`0x37`)

Collected immediately prior to controller input processing. Contains all physical and processed inputs required to reconstruct the replay.

| Offset | Field Name | Type | Description |
| :---: | :--- | :---: | :--- |
| `0x00` | Command Byte | `uint8` | Always `0x37` |
| `0x01` | Frame Number | `int32` | Starts at `-123`. Frame `0` is game GO |
| `0x05` | Player Index | `uint8` | `0`–`3` (Port = Index + 1) |
| `0x06` | Is Follower | `bool` | `1` for Nana (Ice Climbers), `0` for primary |
| `0x07` | Random Seed | `uint32` | Frame RNG state |
| `0x0B` | Action State ID | `uint16` | Action state before inputs are applied |
| `0x0D` | X Position | `float` | World coordinate X |
| `0x11` | Y Position | `float` | World coordinate Y |
| `0x15` | Facing Direction | `float` | `-1.0` = Left, `+1.0` = Right |
| `0x19` | Joystick X | `float` | Processed analog stick X (`-1.0` to `+1.0`) |
| `0x1D` | Joystick Y | `float` | Processed analog stick Y (`-1.0` to `+1.0`) |
| `0x21` | C-Stick X | `float` | Processed C-stick X (`-1.0` to `+1.0`) |
| `0x25` | C-Stick Y | `float` | Processed C-stick Y (`-1.0` to `+1.0`) |
| `0x29` | Trigger | `float` | Processed analog trigger (`0.0` to `1.0`) |
| `0x2D` | Processed Buttons | `uint32` | Logical button bitfield |
| `0x31` | Physical Buttons | `uint16` | Raw physical controller buttons |
| `0x33` | Physical L Trigger | `float` | Physical L analog travel (`0.0` to `1.0`) |
| `0x37` | Physical R Trigger | `float` | Physical R analog travel (`0.0` to `1.0`) |
| `0x3B` | Raw Analog X | `int8` | Unprocessed hardware stick X (used for UCF) |
| `0x3C` | Damage Percent | `float` | Fighter damage at start of frame |

### Physical Button Bitmasks (`uint16`)
- `0x0001`: D-pad Left | `0x0002`: D-pad Right | `0x0004`: D-pad Down | `0x0008`: D-pad Up
- `0x0010`: Z button | `0x0020`: R digital click | `0x0040`: L digital click
- `0x0100`: A button | `0x0200`: B button | `0x0400`: X button | `0x0800`: Y button | `0x1000`: Start

---

## 5. Post-Frame Update (`0x38`)

Collected after collision detection, physics, and damage calculation. Primary data source for combat analytics, combos, and tech statistics.

| Offset | Field Name | Type | Description |
| :---: | :--- | :---: | :--- |
| `0x00` | Command Byte | `uint8` | Always `0x38` |
| `0x01` | Frame Number | `int32` | Frame index |
| `0x05` | Player Index | `uint8` | `0`–`3` |
| `0x06` | Is Follower | `bool` | `1` for Nana |
| `0x07` | Internal Character ID| `uint8` | Distinguishes Zelda (`0x12`) vs. Sheik (`0x13`) |
| `0x08` | Action State ID | `uint16` | Current action state |
| `0x0A` | X Position | `float` | World position X |
| `0x0E` | Y Position | `float` | World position Y |
| `0x12` | Facing Direction | `float` | `-1.0`=Left, `+1.0`=Right |
| `0x16` | Percent | `float` | Updated damage percent |
| `0x1A` | Shield Size | `float` | Health of shield (`0.0` to `60.0`) |
| `0x1E` | Last Hitting Attack | `uint8` | Move ID that hit fighter (used for staling) |
| `0x1F` | Combo Count | `uint8` | In-game combo counter |
| `0x20` | Last Hit By | `uint8` | Port index of attacker |
| `0x21` | Stocks Remaining | `uint8` | Current stocks count |
| `0x22` | State Frame Counter | `float` | Frame duration within current action state |
| `0x26` | State Flags 1 | `uint8` | Bit 2 (`0x02`)=Absorber, Bit 5 (`0x10`)=Reflector |
| `0x27` | State Flags 2 | `uint8` | Bit 3 (`0x04`)=Invincible, Bit 4 (`0x08`)=Fastfalling, Bit 6 (`0x20`)=Hitlag |
| `0x28` | State Flags 3 | `uint8` | Bit 3 (`0x04`)=Holding grab, Bit 8 (`0x80`)=Shield active |
| `0x29` | State Flags 4 | `uint8` | Bit 2 (`0x02`)=In hitstun, Bit 6 (`0x20`)=Powershield active |
| `0x2A` | State Flags 5 | `uint8` | Bit 7 (`0x40`)=Is dead, Bit 8 (`0x80`)=Offscreen |
| `0x2B` | Hitstun Remaining | `float` | Frames of hitstun remaining (`>0` = hitstun) |
| `0x2F` | Ground/Air State | `bool` | `0` = Grounded, `1` = Airborne |
| `0x30` | Last Ground ID | `uint16` | Collision line ID |
| `0x32` | Jumps Remaining | `uint8` | Midair jumps left |
| `0x33` | L-Cancel Status | `uint8` | `0`=None, `1`=Successful L-Cancel, `2`=Missed |
| `0x34` | Hurtbox State | `uint8` | `0`=Vulnerable, `1`=Invulnerable, `2`=Intangible |
| `0x35` | Air X Velocity | `float` | Self-induced air speed X |
| `0x39` | Air Y Velocity | `float` | Self-induced air speed Y |
| `0x3D` | Attack X Velocity | `float` | Knockback velocity X |
| `0x41` | Attack Y Velocity | `float` | Knockback velocity Y |
| `0x45` | Ground X Velocity | `float` | Self-induced ground friction speed X |
| `0x49` | Hitlag Frames | `float` | Hitlag duration remaining (`0` = free) |
| `0x4D` | Animation Index | `uint32` | Subaction animation ID |
| `0x53` | Instance ID | `uint16` | Unique ID generated per state change |

---

## 6. Game End (`0x39`)

Marks the termination of the replay.

| Offset | Field Name | Type | Description |
| :---: | :--- | :---: | :--- |
| `0x00` | Command Byte | `uint8` | Always `0x39` |
| `0x01` | End Method | `uint8` | `1` = TIME!, `2` = GAME!, `7` = No Contest (LRAS) |
| `0x02` | LRAS Initiator | `int8` | Port index that triggered LRAS (`-1` if normal end) |
| `0x03` | Placements | `int8[4]` | 0-indexed ranking per player (`0`=1st, `1`=2nd, `-1`=none) |
