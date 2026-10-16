const express = require("express");
const path = require("path");
const fs = require("fs");
const { execFile } = require("child_process");
const { SlippiGame, characters, stages } = require("./dist/browser/index.cjs");

const app = express();
const PORT = 3000;
const HOST = "0.0.0.0";

// Support raw body for binary .slp uploads and json
app.use(express.json({ limit: "150mb" }));
app.use(express.raw({ type: ["application/octet-stream", "application/x-slippi"], limit: "150mb" }));

// Serve static files from public
app.use(express.static(path.join(__dirname, "public")));
// Also serve slp files statically if requested directly
app.use("/slp", express.static(path.join(__dirname, "slp")));

// Helper to inspect replay directory
function getReplayFiles(dir, prefix = "") {
  const results = [];
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        results.push(...getReplayFiles(fullPath, relativePath));
      } else if (entry.name.endsWith(".slp")) {
        const stat = fs.statSync(fullPath);
        results.push({
          filename: relativePath,
          name: entry.name.replace(".slp", ""),
          size: stat.size,
          category: prefix || "Root",
        });
      }
    }
  } catch (err) {
    console.error("Error reading replays dir:", err);
  }
  return results;
}

// Replays catalog API
app.get("/api/replays", (req, res) => {
  const replaysDir = path.join(__dirname, "slp");
  const files = getReplayFiles(replaysDir);
  res.json({ replays: files });
});

// CLI schema definition for interactive Command Builder UI
app.get("/api/cli/schema", (req, res) => {
  res.json({
    commands: [
      {
        name: "mechanics",
        title: "Advanced Mechanics",
        badge: "Core",
        description: "Analyze advanced game mechanics (wavedashes, waveshines, dash dancing, L-cancels, edge-cancels)",
        arg: { name: "file", placeholder: "slp/wavedash-1.slp", required: true },
        flags: [
          { name: "player", type: "string", placeholder: "1, 2, P1", description: "Filter to specific player port" },
          { name: "tech", type: "select", options: ["all", "wavedash", "waveshine", "dashdance", "lcancel", "edgecancel"], default: "all", description: "Focus on specific mechanic" },
          { name: "details", type: "boolean", default: true, description: "Show granular frame-by-frame execution details" },
          { name: "format", type: "select", options: ["table", "json", "csv"], default: "table", description: "Output format" },
          { name: "export", type: "string", placeholder: "results.json", description: "Export output to file" }
        ]
      },
      {
        name: "inputs",
        title: "Input Telemetry & Scatter",
        badge: "Controller",
        description: "Analyze controller inputs, APM breakdown, and 2D analog stick coordinate quadrant density",
        arg: { name: "file", placeholder: "slp/wavedash-1.slp", required: true },
        flags: [
          { name: "player", type: "string", placeholder: "1, 2", description: "Filter to specific player port" },
          { name: "stick-scatter", type: "boolean", default: true, description: "Calculate 2D analog stick quadrant density" },
          { name: "format", type: "select", options: ["table", "json"], default: "table", description: "Output format" }
        ]
      },
      {
        name: "analyze",
        title: "Match Scorecard",
        badge: "Match",
        description: "Complete match scorecard, player damage, kills, neutral win %, and openings per kill",
        arg: { name: "file", placeholder: "slp/ranked_game1_tiebreak.slp", required: true },
        flags: [
          { name: "player", type: "string", placeholder: "1, 2", description: "Filter to specific player port" },
          { name: "format", type: "select", options: ["table", "json"], default: "table", description: "Output format" }
        ]
      },
      {
        name: "batch",
        title: "Batch Processing",
        badge: "Bulk",
        description: "Bulk scan directory of replays and compute aggregated statistics and mechanics",
        arg: { name: "directory", placeholder: "slp", required: true },
        flags: [
          { name: "include-mechanics", type: "boolean", default: true, description: "Include wavedashes, L-cancels, and APM in batch report" },
          { name: "format", type: "select", options: ["table", "json", "csv"], default: "table", description: "Output format" },
          { name: "out", type: "string", placeholder: "batch_summary.csv", description: "Write output to file" }
        ]
      },
      {
        name: "filter",
        title: "Replay Filter",
        badge: "Query",
        description: "Filter and query replays by stage, character, netplay code, or tech skill criteria",
        arg: { name: "directory", placeholder: "slp", required: true },
        flags: [
          { name: "stage", type: "string", placeholder: "Battlefield", description: "Filter by stage name" },
          { name: "character", type: "string", placeholder: "Fox, Falco, Marth", description: "Filter by character name" },
          { name: "player", type: "string", placeholder: "Connect code or tag", description: "Filter by player tag" },
          { name: "copy-to", type: "string", placeholder: "curated_replays", description: "Copy matched files to target folder" }
        ]
      },
      {
        name: "stream",
        title: "Streaming Simulation",
        badge: "Stream",
        description: "Simulate real-time replay stream parsing via SlpStream and SlpParser",
        arg: { name: "file", placeholder: "slp/wavedash-1.slp", required: true },
        flags: [
          { name: "chunk-size", type: "number", default: 1024, description: "Stream chunk size in bytes" },
          { name: "delay", type: "number", default: 5, description: "Chunk delay in milliseconds" }
        ]
      }
    ]
  });
});

// Execute CLI commands locally
app.post("/api/cli/run", (req, res) => {
  let { prompt, command, positional = [], flags = {} } = req.body || {};
  let args = [];

  if (prompt && typeof prompt === "string") {
    let cleanPrompt = prompt.trim();
    if (cleanPrompt.startsWith("slippi ")) {
      cleanPrompt = cleanPrompt.substring(7).trim();
    }
    const regex = /[^\s"']+|"([^"]*)"|'([^']*)'/g;
    let match;
    while ((match = regex.exec(cleanPrompt)) !== null) {
      args.push(match[1] || match[2] || match[0]);
    }
  } else if (command) {
    args.push(command);
    if (positional) {
      if (Array.isArray(positional)) args.push(...positional);
      else if (positional) args.push(positional);
    }
    for (const [k, v] of Object.entries(flags)) {
      if (v === true) {
        args.push(`--${k}`);
      } else if (v !== false && v !== undefined && v !== "") {
        args.push(`--${k}=${v}`);
      }
    }
  }

  const cliPath = path.join(__dirname, "bin", "slippi.mjs");
  execFile("node", [cliPath, ...args], { cwd: __dirname, timeout: 45000, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
    res.json({
      success: !err || err.code === 0,
      exitCode: err ? err.code || 1 : 0,
      stdout: stdout || "",
      stderr: stderr || (err ? err.message : ""),
      executedCommand: `slippi ${args.join(" ")}`,
    });
  });
});


// Single replay binary stream API
app.get("/api/replay-stream", (req, res) => {
  const relativePath = req.query.file || "";
  const safePath = path.normalize(relativePath).replace(/^(\.\.[\/\\])+/, "");
  const filePath = path.join(__dirname, "slp", safePath);

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: "Replay file not found" });
  }

  res.setHeader("Content-Type", "application/octet-stream");
  res.setHeader("Content-Disposition", `inline; filename="${path.basename(filePath)}"`);
  fs.createReadStream(filePath).pipe(res);
});


// Parse & analyze endpoint
app.post("/api/analyze", (req, res) => {
  try {
    let game;
    let fileName = "Uploaded replay";

    if (Buffer.isBuffer(req.body) && req.body.length > 0) {
      game = new SlippiGame(req.body);
    } else if (req.body && req.body.filename) {
      const safePath = path.normalize(req.body.filename).replace(/^(\.\.[\/\\])+/, "");
      const filePath = path.join(__dirname, "slp", safePath);
      if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: "Replay file not found" });
      }
      const buffer = fs.readFileSync(filePath);
      game = new SlippiGame(buffer);
      fileName = path.basename(filePath);
    } else {
      return res.status(400).json({ error: "No replay file provided" });
    }

    const settings = game.getSettings();
    if (!settings) {
      return res.status(400).json({ error: "Could not read replay settings. File may be corrupted." });
    }

    const metadata = game.getMetadata() || {};
    const stats = game.getStats() || {};
    const gameEnd = game.getGameEnd() || {};
    const winners = game.getWinners() || [];
    let stadiumStats = undefined;
    try {
      stadiumStats = game.getStadiumStats();
    } catch {
      // Ignored for non-stadium games
    }

    // Enhance players with Melee character info
    const enhancedPlayers = (settings.players || []).map((p) => {
      const charName = characters.getCharacterName(p.characterId) || `Character #${p.characterId}`;
      const charShort = characters.getCharacterShortName(p.characterId) || charName;
      const charColor = characters.getCharacterColorName(p.characterId, p.characterColor) || "Default";
      return {
        ...p,
        characterName: charName,
        characterShortName: charShort,
        characterColorName: charColor,
      };
    });

    const stageName = stages.getStageName(settings.stageId) || `Stage #${settings.stageId}`;
    const stageInfo = stages.getStageInfo(settings.stageId) || null;

    res.json({
      filename: fileName,
      stageName,
      stageInfo,
      settings: {
        ...settings,
        players: enhancedPlayers,
      },
      metadata,
      stats,
      gameEnd,
      winners,
      stadiumStats,
    });
  } catch (err) {
    console.error("Error analyzing replay:", err);
    res.status(500).json({ error: err.message || "Failed to analyze replay" });
  }
});

// Health check
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", app: "Slippi JS Analyzer", version: "9.1.3" });
});

// Fallback to index.html for SPA
app.use((req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});


app.listen(PORT, HOST, () => {
  console.log(`🎮 Slippi JS Analyzer dev server running at http://${HOST}:${PORT}`);
});
