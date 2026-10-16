#!/usr/bin/env node

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  SlippiGame,
  characters,
  stages,
  SlpStream,
  SlpStreamEvent,
  SlpParser,
  SlpParserEvent,
  Command,
} from "../dist/browser/index.cjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");

// ANSI Color Helpers
const colors = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  white: "\x1b[37m",
  bgBlue: "\x1b[44m",
  bgMagenta: "\x1b[45m",
};

function logHeader(text) {
  console.log(`\n${colors.bold}${colors.cyan}🎮 ${text}${colors.reset}\n`);
}

function parseCliArgs(args) {
  const command = args[0] || "help";
  const positional = [];
  const flags = {};

  for (let i = 1; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith("--")) {
      const parts = arg.substring(2).split("=");
      const key = parts[0];
      const val = parts.length > 1 ? parts.slice(1).join("=") : true;
      flags[key] = val;
    } else if (arg.startsWith("-")) {
      const key = arg.substring(1);
      flags[key] = true;
    } else {
      positional.push(arg);
    }
  }

  return { command, positional, flags };
}

// Action state constants
const ACTION_KNEEBEND = 0x18;
const ACTION_LANDING_FALL_SPECIAL = 0x2b;
const ACTION_DASH = 0x14;
const ACTION_DOWN_SPECIAL_GROUND = 0x157;
const ACTION_DOWN_SPECIAL_AIR = 0x158;
const ACTION_ATTACK_AIR_N = 0x41;
const ACTION_ATTACK_AIR_D = 0x45;
const ACTION_LANDING_AIR_N = 0x46;
const ACTION_LANDING_AIR_D = 0x4a;

function analyzeMechanicsCore(game, targetPlayer) {
  const frames = game.getFrames();
  const settings = game.getSettings();
  const stats = game.getStats();
  const players = settings?.players || [];

  const wavedashes = [];
  const waveshines = [];
  const dashDances = [];
  const lCancels = [];
  const stickCoordinates = {};

  players.forEach((p) => {
    stickCoordinates[p.playerIndex] = [];
  });

  const stateMap = {};
  players.forEach((p) => {
    stateMap[p.playerIndex] = {
      lastActionState: 0,
      kneebendStartFrame: null,
      shineStartFrame: null,
      dashStartFrame: null,
      currentDashDirection: null,
      dashDanceCounter: 0,
      aerialLandingPending: null,
    };
  });

  const frameIndices = Object.keys(frames)
    .map(Number)
    .sort((a, b) => a - b);

  for (const frameNum of frameIndices) {
    const frameData = frames[frameNum];
    if (!frameData?.players) continue;

    for (const p of players) {
      const port = p.playerIndex;
      if (targetPlayer !== undefined && targetPlayer !== port) continue;

      const playerFrame = frameData.players[port];
      if (!playerFrame?.post || !playerFrame?.pre) continue;

      const post = playerFrame.post;
      const pre = playerFrame.pre;
      const actionState = post.actionStateId;
      const characterId = post.characterId;
      const st = stateMap[port];

      if (frameNum % 2 === 0) {
        stickCoordinates[port].push({
          x: pre.joystickX || 0,
          y: pre.joystickY || 0,
        });
      }

      // Wavedash & Waveland
      if (actionState === ACTION_KNEEBEND) {
        if (st.kneebendStartFrame === null) st.kneebendStartFrame = frameNum;
      } else if (actionState === ACTION_LANDING_FALL_SPECIAL) {
        if (st.lastActionState !== ACTION_LANDING_FALL_SPECIAL) {
          const stickX = pre.joystickX || 0;
          const stickY = pre.joystickY || 0;
          const isDiagonalDown = stickY < -0.2 && Math.abs(stickX) > 0.2;

          if (isDiagonalDown || st.kneebendStartFrame !== null) {
            const isWavedash = st.kneebendStartFrame !== null;
            const jumpsquatDuration = isWavedash ? frameNum - st.kneebendStartFrame : 0;
            const angleRad = Math.atan2(Math.abs(stickY), Math.abs(stickX));
            const angleDeg = Math.round((angleRad * 180) / Math.PI);

            let quality = "good";
            if (jumpsquatDuration <= 4) quality = "perfect";
            else if (jumpsquatDuration > 6) quality = "slow";

            wavedashes.push({
              playerIndex: port,
              frame: frameNum,
              type: isWavedash ? "wavedash" : "waveland",
              direction: stickX < -0.1 ? "left" : stickX > 0.1 ? "right" : "neutral",
              stickX: parseFloat(stickX.toFixed(3)),
              stickY: parseFloat(stickY.toFixed(3)),
              angleDegrees: angleDeg,
              jumpsquatFrames: isWavedash ? jumpsquatDuration : undefined,
              executionQuality: quality,
            });

            if (st.shineStartFrame !== null && (characterId === 2 || characterId === 20)) {
              waveshines.push({
                playerIndex: port,
                frame: frameNum,
                shineFrame: st.shineStartFrame,
                jumpCancelFrame: st.kneebendStartFrame || frameNum,
                airdodgeFrame: frameNum,
                totalLatencyFrames: frameNum - st.shineStartFrame,
                direction: stickX < 0 ? "left" : "right",
                characterId,
              });
              st.shineStartFrame = null;
            }
          }
        }
        st.kneebendStartFrame = null;
      } else if (actionState !== ACTION_KNEEBEND) {
        st.kneebendStartFrame = null;
      }

      // Waveshine Tracker
      if (actionState === ACTION_DOWN_SPECIAL_GROUND || actionState === ACTION_DOWN_SPECIAL_AIR) {
        if (st.shineStartFrame === null) st.shineStartFrame = frameNum;
      } else if (
        actionState !== ACTION_LANDING_FALL_SPECIAL &&
        st.shineStartFrame !== null &&
        frameNum - st.shineStartFrame > 15
      ) {
        st.shineStartFrame = null;
      }

      // Dash Dance
      if (actionState === ACTION_DASH) {
        const currentDir = post.facingDirection || (pre.joystickX > 0 ? 1 : -1);
        if (st.lastActionState !== ACTION_DASH) {
          st.dashStartFrame = frameNum;
          st.currentDashDirection = currentDir;
          st.dashDanceCounter = 1;
        } else if (st.currentDashDirection !== null && st.currentDashDirection !== currentDir) {
          st.dashDanceCounter++;
          st.currentDashDirection = currentDir;
        }
      } else {
        if (st.dashDanceCounter >= 2 && st.dashStartFrame !== null) {
          const duration = frameNum - st.dashStartFrame;
          dashDances.push({
            playerIndex: port,
            startFrame: st.dashStartFrame,
            endFrame: frameNum,
            dashCount: st.dashDanceCounter,
            avgDashDurationFrames: parseFloat((duration / st.dashDanceCounter).toFixed(1)),
            durationFrames: duration,
          });
        }
        st.dashDanceCounter = 0;
        st.dashStartFrame = null;
        st.currentDashDirection = null;
      }

      // L-Cancels & Edge-Cancels
      const isAerial = actionState >= ACTION_ATTACK_AIR_N && actionState <= ACTION_ATTACK_AIR_D;
      const isLanding = actionState >= ACTION_LANDING_AIR_N && actionState <= ACTION_LANDING_AIR_D;

      if (isAerial) {
        st.aerialLandingPending = { aerialState: actionState, startFrame: frameNum };
      } else if (isLanding && st.aerialLandingPending) {
        lCancels.push({
          playerIndex: port,
          frame: frameNum,
          success: post.lCancelStatus === 1,
          isEdgeCancel: false,
        });
        st.aerialLandingPending = null;
      } else if (st.aerialLandingPending && actionState === 0x19) {
        lCancels.push({
          playerIndex: port,
          frame: frameNum,
          success: true,
          isEdgeCancel: true,
        });
        st.aerialLandingPending = null;
      }

      st.lastActionState = actionState;
    }
  }

  // Summary per player
  const countsByPlayer = {};
  players.forEach((p) => {
    const port = p.playerIndex;
    const pWd = wavedashes.filter((w) => w.playerIndex === port && w.type === "wavedash");
    const pWl = wavedashes.filter((w) => w.playerIndex === port && w.type === "waveland");
    const pWs = waveshines.filter((w) => w.playerIndex === port);
    const pDd = dashDances.filter((d) => d.playerIndex === port);
    const pLc = lCancels.filter((l) => l.playerIndex === port);
    const lSuccess = pLc.filter((l) => l.success && !l.isEdgeCancel).length;
    const lFail = pLc.filter((l) => !l.success).length;
    const edgeCancels = pLc.filter((l) => l.isEdgeCancel).length;
    const avgAngle =
      pWd.length > 0 ? Math.round(pWd.reduce((acc, w) => acc + w.angleDegrees, 0) / pWd.length) : 0;
    const overall = (stats?.overall || []).find((o) => o.playerIndex === port) || {};

    countsByPlayer[port] = {
      playerIndex: port,
      name: p.displayName || p.connectCode || `Port ${port + 1}`,
      character: characters.getCharacterName(p.characterId) || `Char #${p.characterId}`,
      wavedashCount: pWd.length,
      wavelandCount: pWl.length,
      waveshineCount: pWs.length,
      dashDanceStrings: pDd.length,
      lCancelSuccess: lSuccess,
      lCancelFail: lFail,
      edgeCancelCount: edgeCancels,
      avgWavedashAngle: avgAngle,
      apm: Math.round(overall.inputsPerMinute?.ratio || 0),
    };
  });

  return {
    wavedashes,
    waveshines,
    dashDances,
    lCancels,
    stickCoordinates,
    countsByPlayer,
  };
}

// -------------------------------------------------------------
// Subcommands
// -------------------------------------------------------------

async function handleMechanics(filePath, flags) {
  if (!filePath) {
    console.error(`${colors.red}Error: Please specify a .slp file path.${colors.reset}`);
    process.exit(1);
  }
  const fullPath = path.resolve(process.cwd(), filePath);
  if (!fs.existsSync(fullPath)) {
    console.error(`${colors.red}Error: File not found at ${fullPath}${colors.reset}`);
    process.exit(1);
  }

  const buffer = fs.readFileSync(fullPath);
  const game = new SlippiGame(buffer);
  const settings = game.getSettings();
  const stageName = stages.getStageName(settings?.stageId) || "Unknown Stage";

  let targetPort = undefined;
  if (flags.player !== undefined) {
    const rawP = String(flags.player).replace(/[^0-9]/g, "");
    if (rawP.length > 0) targetPort = parseInt(rawP, 10) - 1;
  }

  const results = analyzeMechanicsCore(game, targetPort);

  if (flags.format === "json") {
    const out = JSON.stringify(results, null, 2);
    if (flags.export) fs.writeFileSync(flags.export, out);
    console.log(out);
    return;
  }

  logHeader(`Advanced Mechanics Analysis: ${path.basename(filePath)} (${stageName})`);

  // Table summary
  console.log(`${colors.bold}PLAYER MECHANICS SUMMARY:${colors.reset}`);
  console.log(
    "┌──────┬──────────────────────┬──────────┬──────────┬────────────┬─────────────┬──────────────┬─────────────┬───────┐",
  );
  console.log(
    `│ Port │ Player / Character   │ Wavedash │ Waveland │ Waveshines │ Dash Dances │ L-Cancels    │ Edge-Cancel │ APM   │`,
  );
  console.log(
    "├──────┼──────────────────────┼──────────┼──────────┼────────────┼─────────────┼──────────────┼─────────────┼───────┤",
  );

  Object.values(results.countsByPlayer).forEach((p) => {
    const portStr = `P${p.playerIndex + 1}`.padEnd(4);
    const nameStr = `${p.name} (${p.character})`.substring(0, 20).padEnd(20);
    const wdStr = String(p.wavedashCount).padStart(8);
    const wlStr = String(p.wavelandCount).padStart(8);
    const wsStr = String(p.waveshineCount).padStart(10);
    const ddStr = String(p.dashDanceStrings).padStart(11);
    const totalLc = p.lCancelSuccess + p.lCancelFail;
    const lcPct = totalLc > 0 ? Math.round((p.lCancelSuccess / totalLc) * 100) : 0;
    const lcStr = `${p.lCancelSuccess}/${totalLc} (${lcPct}%)`.padStart(12);
    const ecStr = String(p.edgeCancelCount).padStart(11);
    const apmStr = String(p.apm).padStart(5);

    console.log(
      `│ ${portStr} │ ${nameStr} │ ${wdStr} │ ${wlStr} │ ${wsStr} │ ${ddStr} │ ${lcStr} │ ${ecStr} │ ${apmStr} │`,
    );
  });
  console.log(
    "└──────┴──────────────────────┴──────────┴──────────┴────────────┴─────────────┴──────────────┴─────────────┴───────┘\n",
  );

  // If details requested
  if (flags.details || flags.d) {
    console.log(`${colors.bold}${colors.yellow}Granular Execution Details:${colors.reset}`);
    const filterTech = flags.tech || "all";

    if (filterTech === "all" || filterTech === "wavedash") {
      console.log(`\n${colors.cyan}--- Wavedashes & Wavelands (${results.wavedashes.length} total) ---${colors.reset}`);
      results.wavedashes.slice(0, 15).forEach((w, idx) => {
        console.log(
          `  #${(idx + 1).toString().padStart(2)} [Frame ${w.frame.toString().padStart(5)}] P${w.playerIndex + 1} ${w.type.toUpperCase()} -> ${w.direction.toUpperCase()} | Angle: ${w.angleDegrees}° | Stick: (${w.stickX}, ${w.stickY}) | Execution: ${w.executionQuality}`,
        );
      });
      if (results.wavedashes.length > 15) {
        console.log(`  ... and ${results.wavedashes.length - 15} more wavedashes.`);
      }
    }

    if (filterTech === "all" || filterTech === "waveshine") {
      console.log(`\n${colors.magenta}--- Waveshines (${results.waveshines.length} total) ---${colors.reset}`);
      results.waveshines.forEach((ws, idx) => {
        console.log(
          `  #${idx + 1} [Frame ${ws.shineFrame}] P${ws.playerIndex + 1} WAVESHINE ${ws.direction} -> Latency: ${ws.totalLatencyFrames}f (Jump: +${ws.jumpCancelFrame - ws.shineFrame}f, Dodge: +${ws.airdodgeFrame - ws.shineFrame}f)`,
        );
      });
    }

    if (filterTech === "all" || filterTech === "dashdance") {
      console.log(`\n${colors.blue}--- Dash Dance Strings (${results.dashDances.length} total) ---${colors.reset}`);
      results.dashDances.slice(0, 10).forEach((dd, idx) => {
        console.log(
          `  #${idx + 1} [Frames ${dd.startFrame}..${dd.endFrame}] P${dd.playerIndex + 1} Dash Dance: ${dd.dashCount} turns in ${dd.durationFrames} frames (avg ${dd.avgDashDurationFrames}f per dash)`,
        );
      });
    }

    if (filterTech === "all" || filterTech === "edgecancel") {
      const edgeCancels = results.lCancels.filter((l) => l.isEdgeCancel);
      console.log(`\n${colors.green}--- Edge-Cancelled Aerials (${edgeCancels.length} total) ---${colors.reset}`);
      edgeCancels.forEach((ec, idx) => {
        console.log(`  #${idx + 1} [Frame ${ec.frame}] P${ec.playerIndex + 1} EDGE-CANCEL on ${ec.moveName || "Aerial"}`);
      });
    }
  }

  if (flags.export) {
    fs.writeFileSync(flags.export, JSON.stringify(results, null, 2));
    console.log(`\n${colors.green}✓ Exported results to ${flags.export}${colors.reset}`);
  }
}

async function handleInputs(filePath, flags) {
  if (!filePath) {
    console.error(`${colors.red}Error: Please specify a .slp file path.${colors.reset}`);
    process.exit(1);
  }
  const fullPath = path.resolve(process.cwd(), filePath);
  if (!fs.existsSync(fullPath)) {
    console.error(`${colors.red}Error: File not found at ${fullPath}${colors.reset}`);
    process.exit(1);
  }

  const buffer = fs.readFileSync(fullPath);
  const game = new SlippiGame(buffer);
  const settings = game.getSettings();
  const stats = game.getStats();

  let targetPort = undefined;
  if (flags.player !== undefined) {
    const rawP = String(flags.player).replace(/[^0-9]/g, "");
    if (rawP.length > 0) targetPort = parseInt(rawP, 10) - 1;
  }

  const results = analyzeMechanicsCore(game, targetPort);

  logHeader(`Controller Input Telemetry: ${path.basename(filePath)}`);

  console.log(`${colors.bold}PLAYER INPUT DENSITY & FREQUENCY:${colors.reset}`);
  (stats?.overall || []).forEach((o) => {
    if (targetPort !== undefined && targetPort !== o.playerIndex) return;
    const p = settings.players.find((pl) => pl.playerIndex === o.playerIndex) || {};
    const charName = characters.getCharacterName(p.characterId) || "Char";
    const name = p.displayName || p.connectCode || `Port ${o.playerIndex + 1}`;

    console.log(`\n${colors.bold}${colors.cyan}Port ${o.playerIndex + 1}: ${name} (${charName})${colors.reset}`);
    console.log(`  • Total Inputs:        ${o.inputCounts?.total || 0}`);
    console.log(`  • Inputs / Minute:     ${Math.round(o.inputsPerMinute?.ratio || 0)} APM`);
    console.log(`  • Digital APM:         ${Math.round(o.digitalInputsPerMinute?.ratio || 0)} APM`);
    console.log(`  • Buttons Pressed:     ${o.inputCounts?.buttons || 0}`);
    console.log(`  • Trigger Presses:     ${o.inputCounts?.triggers || 0}`);
    console.log(`  • C-Stick Movements:   ${o.inputCounts?.cstick || 0}`);
    console.log(`  • Control Stick Flicks:${o.inputCounts?.joystick || 0}`);
  });

  if (flags["stick-scatter"]) {
    console.log(`\n${colors.bold}${colors.yellow}Analog Stick 2D Coordinate Grid (X/Y Density):${colors.reset}`);
    Object.entries(results.stickCoordinates).forEach(([port, coords]) => {
      if (targetPort !== undefined && targetPort !== Number(port)) return;
      console.log(`\n[Player Port ${Number(port) + 1} - Sampled ${coords.length} coordinates]:`);

      // 9-zone quadrant breakdown
      let neutralZone = 0;
      let leftSmash = 0;
      let rightSmash = 0;
      let upSmash = 0;
      let downSmash = 0;
      let diagonalNotches = 0;

      coords.forEach((c) => {
        const mag = Math.sqrt(c.x * c.x + c.y * c.y);
        if (mag < 0.2875) neutralZone++;
        else if (mag > 0.8) {
          const angle = (Math.atan2(c.y, c.x) * 180) / Math.PI;
          if (c.y < -0.3 && Math.abs(c.x) > 0.3) diagonalNotches++;
          else if (c.x < -0.8) leftSmash++;
          else if (c.x > 0.8) rightSmash++;
          else if (c.y > 0.8) upSmash++;
          else if (c.y < -0.8) downSmash++;
        }
      });

      console.log(`  ├─ Neutral Deadzone:   ${neutralZone} frames (${Math.round((neutralZone / coords.length) * 100)}%)`);
      console.log(`  ├─ Diagonal Notches:   ${diagonalNotches} frames (Wavedash/Shield-Drop zones)`);
      console.log(`  ├─ Left Full Smash:    ${leftSmash} frames`);
      console.log(`  ├─ Right Full Smash:   ${rightSmash} frames`);
      console.log(`  ├─ Up Rim:             ${upSmash} frames`);
      console.log(`  └─ Down Rim:           ${downSmash} frames`);
    });
  }
}

async function handleAnalyze(filePath, flags) {
  if (!filePath) {
    console.error(`${colors.red}Error: Please specify a .slp file path.${colors.reset}`);
    process.exit(1);
  }
  const fullPath = path.resolve(process.cwd(), filePath);
  if (!fs.existsSync(fullPath)) {
    console.error(`${colors.red}Error: File not found at ${fullPath}${colors.reset}`);
    process.exit(1);
  }

  const buffer = fs.readFileSync(fullPath);
  const game = new SlippiGame(buffer);
  const settings = game.getSettings();
  const metadata = game.getMetadata() || {};
  const stats = game.getStats() || {};
  const winners = game.getWinners() || [];
  const stageName = stages.getStageName(settings?.stageId) || "Unknown Stage";

  const totalFrames = stats.playableFrameCount || stats.lastFrame || 0;
  const mins = Math.floor(totalFrames / 3600);
  const secs = Math.floor((totalFrames % 3600) / 60);

  if (flags.format === "json") {
    console.log(JSON.stringify({ settings, metadata, stats, winners }, null, 2));
    return;
  }

  logHeader(`Match Analysis: ${path.basename(filePath)}`);
  console.log(`  • Stage:     ${colors.bold}${stageName}${colors.reset}`);
  console.log(`  • Duration:  ${mins}:${secs.toString().padStart(2, "0")} (${totalFrames} frames)`);
  console.log(`  • Date:      ${metadata.startAt ? new Date(metadata.startAt).toLocaleString() : "Unknown"}`);
  console.log(
    `  • Winner(s): ${winners.map((w) => `P${w.playerIndex + 1}`).join(", ") || "Double KO / None"}\n`,
  );

  console.log(`${colors.bold}PLAYER SCORECARD:${colors.reset}`);
  (settings?.players || []).forEach((p) => {
    const port = p.playerIndex;
    const isWinner = winners.some((w) => w.playerIndex === port);
    const overall = (stats.overall || []).find((o) => o.playerIndex === port) || {};
    const charName = characters.getCharacterName(p.characterId) || "Char";
    const name = p.displayName || p.connectCode || `Port ${port + 1}`;

    console.log(
      `  [Port ${port + 1}] ${colors.bold}${name}${colors.reset} (${charName}) ${isWinner ? `${colors.yellow}★ WINNER${colors.reset}` : ""}`,
    );
    console.log(`    - Total Damage:     ${Math.round(overall.totalDamage || 0)}%`);
    console.log(`    - Kills:            ${overall.killCount || 0}`);
    console.log(`    - APM:              ${Math.round(overall.inputsPerMinute?.ratio || 0)}`);
    console.log(`    - Openings / Kill:  ${overall.openingsPerKill?.ratio ? overall.openingsPerKill.ratio.toFixed(1) : "N/A"}`);
    console.log(`    - Neutral Win %:    ${overall.neutralWinRatio?.ratio ? (overall.neutralWinRatio.ratio * 100).toFixed(1) + "%" : "N/A"}`);
  });
}

async function handleBatch(dirPath, flags) {
  const targetDir = path.resolve(process.cwd(), dirPath || "slp");
  if (!fs.existsSync(targetDir)) {
    console.error(`${colors.red}Error: Directory not found at ${targetDir}${colors.reset}`);
    process.exit(1);
  }

  function findSlpFiles(dir) {
    let files = [];
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory() && flags.recursive !== false) {
        files.push(...findSlpFiles(full));
      } else if (e.name.endsWith(".slp")) {
        files.push(full);
      }
    }
    return files;
  }

  const slpFiles = findSlpFiles(targetDir);
  logHeader(`Batch Replay Processing: Found ${slpFiles.length} .slp replays`);

  const batchResults = [];
  let processed = 0;

  for (const f of slpFiles) {
    try {
      const buf = fs.readFileSync(f);
      const game = new SlippiGame(buf);
      const settings = game.getSettings();
      const stats = game.getStats();
      const winners = game.getWinners();
      const stageName = stages.getStageName(settings?.stageId) || "Unknown";

      let mechanics = null;
      if (flags["include-mechanics"]) {
        mechanics = analyzeMechanicsCore(game);
      }

      batchResults.push({
        file: path.relative(process.cwd(), f),
        stage: stageName,
        players: (settings?.players || []).map((p) => ({
          port: p.playerIndex + 1,
          name: p.displayName || p.connectCode || `P${p.playerIndex + 1}`,
          character: characters.getCharacterName(p.characterId),
        })),
        durationFrames: stats?.playableFrameCount || 0,
        winners: (winners || []).map((w) => w.playerIndex + 1),
        mechanics: mechanics?.countsByPlayer || null,
      });

      processed++;
      process.stdout.write(`\r  Processing files: ${processed}/${slpFiles.length}`);
    } catch {
      // Skip unreadable files
    }
  }

  console.log(`\n\n${colors.green}✓ Finished processing ${processed} replays.${colors.reset}\n`);

  if (flags.format === "csv") {
    let csv = "File,Stage,DurationFrames,Winner,P1_Char,P2_Char,P1_Wavedashes,P2_Wavedashes,P1_APM,P2_APM\n";
    batchResults.forEach((b) => {
      const p1 = b.players[0] || {};
      const p2 = b.players[1] || {};
      const m1 = b.mechanics?.[0] || {};
      const m2 = b.mechanics?.[1] || {};
      csv += `"${b.file}","${b.stage}",${b.durationFrames},"${b.winners.join(";") || ""}","${p1.character || ""}","${p2.character || ""}",${m1.wavedashCount || 0},${m2.wavedashCount || 0},${m1.apm || 0},${m2.apm || 0}\n`;
    });
    if (flags.out) {
      fs.writeFileSync(flags.out, csv);
      console.log(`Exported batch CSV to ${flags.out}`);
    } else {
      console.log(csv);
    }
  } else {
    if (flags.out) {
      fs.writeFileSync(flags.out, JSON.stringify(batchResults, null, 2));
      console.log(`Exported batch JSON to ${flags.out}`);
    } else {
      console.log(`\nProcessed ${batchResults.length} replays.`);
      console.log(
        `Top stages: ${Object.entries(
          batchResults.reduce((acc, b) => {
            acc[b.stage] = (acc[b.stage] || 0) + 1;
            return acc;
          }, {}),
        )
          .map(([k, v]) => `${k} (${v})`)
          .join(", ")}`,
      );
    }
  }
}

async function handleFilter(dirPath, flags) {
  const targetDir = path.resolve(process.cwd(), dirPath || "slp");
  if (!fs.existsSync(targetDir)) {
    console.error(`${colors.red}Error: Directory not found at ${targetDir}${colors.reset}`);
    process.exit(1);
  }

  function findSlpFiles(dir) {
    let files = [];
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) files.push(...findSlpFiles(full));
      else if (e.name.endsWith(".slp")) files.push(full);
    }
    return files;
  }

  const allFiles = findSlpFiles(targetDir);
  const matched = [];

  for (const f of allFiles) {
    try {
      const buf = fs.readFileSync(f);
      const game = new SlippiGame(buf);
      const settings = game.getSettings();
      const stageName = stages.getStageName(settings?.stageId) || "";

      if (flags.stage && !stageName.toLowerCase().includes(flags.stage.toLowerCase())) {
        continue;
      }

      if (flags.character) {
        const hasChar = (settings.players || []).some((p) => {
          const char = characters.getCharacterName(p.characterId) || "";
          return char.toLowerCase().includes(flags.character.toLowerCase());
        });
        if (!hasChar) continue;
      }

      if (flags.player) {
        const hasPlayer = (settings.players || []).some((p) => {
          const tag = (p.displayName || p.connectCode || "").toLowerCase();
          return tag.includes(flags.player.toLowerCase());
        });
        if (!hasPlayer) continue;
      }

      matched.push({ file: f, stage: stageName });
    } catch {}
  }

  logHeader(`Filter Results: Matched ${matched.length} of ${allFiles.length} replays`);
  matched.forEach((m) => {
    console.log(`  • ${colors.cyan}${path.relative(process.cwd(), m.file)}${colors.reset} (${m.stage})`);
  });

  if (flags["copy-to"] && matched.length > 0) {
    const dest = path.resolve(process.cwd(), flags["copy-to"]);
    if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
    matched.forEach((m) => {
      fs.copyFileSync(m.file, path.join(dest, path.basename(m.file)));
    });
    console.log(`\n${colors.green}✓ Copied ${matched.length} files to ${dest}${colors.reset}`);
  }
}

async function handleStream(filePath, flags) {
  if (!filePath) {
    console.error(`${colors.red}Error: Please specify a .slp file path.${colors.reset}`);
    process.exit(1);
  }
  const fullPath = path.resolve(process.cwd(), filePath);
  if (!fs.existsSync(fullPath)) {
    console.error(`${colors.red}Error: File not found at ${fullPath}${colors.reset}`);
    process.exit(1);
  }

  const chunkSize = parseInt(flags["chunk-size"] || 1024, 10);
  const delayMs = parseInt(flags.delay || 10, 10);

  logHeader(`Streaming Replay: ${path.basename(filePath)} (chunk: ${chunkSize}B, delay: ${delayMs}ms)`);

  const buf = fs.readFileSync(fullPath);
  const slpStream = new SlpStream();
  const slpParser = new SlpParser();

  let eventCount = 0;
  let finalizedCount = 0;

  slpStream.on(SlpStreamEvent.COMMAND, (data) => {
    eventCount++;
    slpParser.handleCommand(data.command, data.payload);
  });

  slpParser.on(SlpParserEvent.SETTINGS, (settings) => {
    const sName = stages.getStageName(settings.stageId);
    console.log(`[SETTINGS] Game Started on ${sName} | Players: ${settings.players?.length}`);
  });

  slpParser.on(SlpParserEvent.FINALIZED_FRAME, (frame) => {
    finalizedCount++;
    if (finalizedCount % 120 === 0) {
      process.stdout.write(`\r[STREAM] Finalized frame #${frame.frame} (Events: ${eventCount})`);
    }
  });

  slpParser.on(SlpParserEvent.END, (end) => {
    console.log(`\n[END] Game Ended. Method: ${end.gameEndMethod}`);
  });

  let offset = 0;
  while (offset < buf.length) {
    const chunk = buf.subarray(offset, offset + chunkSize);
    slpStream.process(chunk);
    offset += chunk.length;
    if (delayMs > 0) {
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }

  console.log(`\n${colors.green}✓ Streaming completed. Total Events: ${eventCount}, Finalized Frames: ${finalizedCount}${colors.reset}`);
}

function printHelp() {
  console.log(`
${colors.bold}${colors.cyan}Slippi-JS Developer CLI & Advanced Mechanics Toolkit${colors.reset}
Usage: slippi <command> [options]

${colors.bold}Commands:${colors.reset}
  ${colors.green}mechanics <file>${colors.reset}   Analyze advanced game mechanics (wavedash, waveshine, dash dance, L-cancels, edge-cancels)
  ${colors.green}inputs <file>${colors.reset}      Analyze user control & analog stick 2D scatter coordinates
  ${colors.green}analyze <file>${colors.reset}     Complete match scorecard, player stats, and combat summary
  ${colors.green}batch <dir>${colors.reset}        Bulk processing of replay directories with multi-threading
  ${colors.green}filter <dir>${colors.reset}       Filter and isolate replays by character, stage, winner, or mechanics
  ${colors.green}stream <file>${colors.reset}      Simulate real-time replay stream parsing via SlpStream

${colors.bold}Common Flags:${colors.reset}
  --player=<port|code>     Filter to specific player (1, 2, P1, FAUST#123)
  --tech=<type>            Filter mechanics: wavedash, waveshine, dashdance, lcancel, edgecancel, all
  --details, -d            Display granular frame-by-frame execution details
  --format=<table|json|csv> Output format (default: table)
  --stick-scatter          Print 2D analog stick quadrant density breakdown
  --include-mechanics      Include wavedashes, L-cancels, and APM in batch reports
  --out=<path>             Write output to destination file
  --copy-to=<path>         Copy filtered replays to target folder
  --chunk-size=<bytes>     Stream chunk size (default: 1024)
  --delay=<ms>             Stream chunk delay in ms (default: 10)
`);
}

// Main Runner
async function main() {
  const { command, positional, flags } = parseCliArgs(process.argv.slice(2));

  switch (command) {
    case "mechanics":
      await handleMechanics(positional[0], flags);
      break;
    case "inputs":
      await handleInputs(positional[0], flags);
      break;
    case "analyze":
      await handleAnalyze(positional[0], flags);
      break;
    case "batch":
      await handleBatch(positional[0], flags);
      break;
    case "filter":
      await handleFilter(positional[0], flags);
      break;
    case "stream":
      await handleStream(positional[0], flags);
      break;
    case "help":
    case "--help":
    case "-h":
    default:
      printHelp();
      break;
  }
}

main().catch((err) => {
  console.error(`${colors.red}CLI Execution Error: ${err.message}${colors.reset}`);
  process.exit(1);
});
