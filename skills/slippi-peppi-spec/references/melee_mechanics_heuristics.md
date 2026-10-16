# Melee Advanced Mechanics & Controller Telemetry Heuristics

This reference details the state machines, action state IDs, frame timing windows, and trigonometric thresholds used to detect and evaluate advanced Super Smash Bros. Melee mechanics from raw `.slp` / Arrow frame streams.

---

## 1. Action State IDs & Constants

Key internal Melee action state IDs used in execution detection:

```
0x12: Turn (Turnaround)
0x14: Dash
0x15: Dash_Skid (Run turnaround skid)
0x16: Turn_Wait
0x18: Kneebend (Jumpsquat)
0x19: Wait (Teeter at edge)
0x1E: Fall
0x2B: Landing_Fall_Special (Wavedash / Waveland landing lag)
0x41: AttackAirN (Neutral Air)
0x42: AttackAirF (Forward Air)
0x43: AttackAirB (Back Air)
0x44: AttackAirU (Up Air)
0x45: AttackAirD (Down Air)
0x46: LandingAirN (Landing lag for Nair)
0x47: LandingAirF (Landing lag for Fair)
0x48: LandingAirB (Landing lag for Bair)
0x49: LandingAirU (Landing lag for Uair)
0x4A: LandingAirD (Landing lag for Dair)
0xBB: Down_Bound_U (Missed tech knockdown face up)
0xC7: Down_Reflect_U (Tech in place)
0xC8: Down_Reflect_F (Tech roll forward)
0xC9: Down_Reflect_B (Tech roll backward)
0x157: SpecialLw_Start (Fox / Falco Down-B Reflector grounded)
0x158: SpecialAirLw_Start (Fox / Falco Down-B Reflector aerial)
```

---

## 2. Wavedash & Waveland Detection

### Mechanics Description
- **Wavedash**: Performed by jumping from the ground, waiting out character-specific jumpsquat (`Kneebend`), and immediately executing a downward-diagonal airdodge into the ground. The character slides in the `Landing_Fall_Special` (`0x2B`) state while retaining horizontal momentum.
- **Waveland**: Performed while airborne by executing a downward-diagonal airdodge immediately before contacting a platform or stage surface.

### State Transition Model
```
[Grounded State]
      │
      ▼ (Jump input: X, Y, or Stick Up)
[Kneebend (0x18)] ──── Duration: 3-8 frames (Character Jumpsquat)
      │
      ▼ (Airborne: Frame 1 of jump)
[Diagonal Airdodge] ── Joystick |X| > 0.2, Y < -0.2 (Trigger pressed)
      │
      ▼ (Immediate ground collision)
[Landing_Fall_Special (0x2B)] ── Slides across stage
```

### Character Jumpsquat Reference Table
| Frames | Characters |
| :---: | :--- |
| **3 frames** | Fox, Sheik, Kirby, Pikachu, Pichu, Samus |
| **4 frames** | Falco, Captain Falcon, Marth, Luigi, Mario, Dr. Mario, Ice Climbers, Young Link |
| **5 frames** | Peach, Roy, Yoshi, Mewtwo, Ness |
| **6 frames** | Donkey Kong, Link, Zelda, Mr. Game & Watch |
| **8 frames** | Bowser |

### Execution Quality Metric
- **Perfect**: Wavedash initiated exactly on frame 1 of leaving jumpsquat (`jumpsquat duration == character baseline`).
- **Good**: 1 frame of airtime before airdodge (`jumpsquat duration == baseline + 1`).
- **Slow**: >2 frames of airtime before airdodge.

### Trigonometric Angle Variance
- Stick coordinates: `(X, Y)` where `X, Y ∈ [-1.0, 1.0]`.
- Wavedash Angle: `θ = arctan(|Y| / |X|) * (180 / π)`.
- **Ideal Maximum Distance Angle**: `θ ≈ 17.5°` (Shallowest diagonal notch, max horizontal speed).
- **Standard Notch**: `θ ≈ 19.5°` to `22.5°`.
- **Steep Wavedash**: `θ > 45°` (Short slide distance).

---

## 3. Waveshine Analysis (Fox & Falco)

### Mechanics Description
A character-defining technique for Fox and Falco where a Down-B Reflector (shine) is jump-cancelled on frame 4 (the earliest cancel frame) and immediately converted into a wavedash to continue combo pressure or reposition.

### Frame-by-Frame Execution Sequence
1. **Frame 1**: Reflector begins (`ActionState 0x157`). Hitbox becomes active on frame 1.
2. **Frames 1–3**: Uncancellable shine active frames.
3. **Frame 4**: Earliest frame shine can be jump-cancelled. Fighter transitions to `Kneebend` (`0x18`).
4. **Frame 7 (Fox) / Frame 8 (Falco)**: Earliest frame leaving jumpsquat into diagonal airdodge.
5. **Frame 8 (Fox) / Frame 9 (Falco)**: Fighter enters `Landing_Fall_Special` (`0x2B`).

### Metric Calculation
- **Total Execution Latency**: `Frame(0x2B) - Frame(Shine_Start)`.
  - Frame-perfect Fox Waveshine: **7 frames total**.
  - Frame-perfect Falco Waveshine: **8 frames total**.
- **Execution Consistency**: Variance in frames above theoretical minimum across all match occurrences.

---

## 4. Dash Dance Pattern Recognition

### Mechanics Description
Rapidly alternating between left and right initial dash animations without entering the skid or turnaround animation, allowing fighters to maintain neutral spacing threat while keeping all grounded options available.

### Heuristic Algorithm
A Dash Dance string is recorded if and only if:
1. Fighter enters `Dash` (`0x14`).
2. Before the initial dash window expires (typically 12–16 frames depending on character dash length), the control stick crosses the neutral deadzone (`|X| < 0.2875`) to the opposite cardinal smash threshold (`X * facingDirection < -0.8`).
3. The fighter transitions directly into another `Dash` (`0x14`) in the opposite direction **without** triggering `Turn` (`0x12`), `Turn_Wait` (`0x16`), or `Dash_Skid` (`0x15`).
4. The sequence consists of `≥ 2` consecutive direction turns.

### Extracted Metrics
- **Dash Count**: Number of direction reversals in the string.
- **Rhythm / Cadence**: Average duration (in frames) spent in each dash state before turning.
- **Total String Length**: Duration in frames of the continuous spacing sequence.

---

## 5. L-Cancel vs. Edge-Cancel Disambiguation

### L-Cancel Heuristic
- **Trigger Window**: Physical `L`, `R`, or `Z` button input registered between **1 and 7 frames** prior to touching the ground during an aerial attack animation (`AttackAirN/F/B/U/D`, `0x41`–`0x45`).
- **Engine Flag**: On the frame of landing (`LandingAirN/F/B/U/D`, `0x46`–`0x4A`), Melee sets `PostFrame.lCancelStatus`:
  - `1`: Successful L-Cancel (Landing lag cut by 50%).
  - `2`: Missed L-Cancel (Full landing lag incurred).
  - `0`: Irrelevant / Non-aerial landing.

### Edge-Cancel Disambiguation
An aerial attack landing near a platform or stage ledge can bypass all landing lag by sliding off the perimeter into teeter or fall.
- **Edge-Cancel Signature**:
  1. Fighter is in an aerial attack state (`0x41`–`0x45`).
  2. Fighter contacts collision surface on frame `F`.
  3. Rather than entering landing lag (`0x46`–`0x4A`), the fighter immediately transitions on frame `F` or `F+1` to `Wait` teeter (`0x19`) or `Fall` (`0x1E`).
- **Correction**: Replay parsers must count this as a deliberate **Edge-Cancel** and not penalize the player with a failed L-cancel.

---

## 6. Controller Coordinate Geometry & Deadzones

### GameCube Analog Stick Calibration
```
                     +1.0 (Up)
                         │
          ┌──────────────┼──────────────┐
          │     \        │        /     │
          │       \      │      /       │
          │         \    │    /         │
          │  Zone 3   \  │  /   Zone 2  │
          │             \│/             │
-1.0 ─────┼──────────────●──────────────┼───── +1.0 (Right)
(Left)    │             /│\             │
          │  Zone 4   /  │  \   Zone 1  │
          │         /    │    \         │
          │       /      │      \       │
          │     /        │        \     │
          └──────────────┼──────────────┘
                         │
                     -1.0 (Down)
```

- **Neutral Deadzone**: Circular radius `r < 0.2875` around origin `(0, 0)`. Inputs within this circle produce zero in-game movement.
- **Smash Input Threshold**: Magnitude `r ≥ 0.8` reached within 2 frames from neutral.
- **Analog Gate Outer Octagon**: Maximum hardware coordinates bounded by GameCube octagonal shell rim notches (`r ≈ 1.0`).
- **Wavedash Angles**:
  - Right Wavedash (Quadrant 4): `X ∈ [0.70, 0.95]`, `Y ∈ [-0.70, -0.30]`.
  - Left Wavedash (Quadrant 3): `X ∈ [-0.95, -0.70]`, `Y ∈ [-0.70, -0.30]`.
  - Perfect Notch Angle: `17.5°` below horizontal (`X = ±0.9537, Y = -0.3000`).
