const fs = require('fs');
const { execSync } = require('child_process');
const path = require('path');

// --- Configuration ---
const SOURCE_DIR = "C:\\Users\\Burak\\Github\\bunchverse-assets\\Source\\Maps\\Scenes\\Threejs1\\";
const BLENDER_PATH = "C:\\Program Files\\Blender Foundation\\Blender 4.5\\blender.exe";
const EXPORT_SCRIPT = "scratch/export_instanced_level.py";
const INTERVAL_MS = 2000;

// Auto-resolve manifest and output path relative to workspace
const workspaceRoot = process.cwd();
const outputRoot = path.join(workspaceRoot, "public/models");
const manifestPath = path.join(workspaceRoot, "public/models/manifest.json");

const mtimes = new Map();

console.log(`\n🚀 GLOBAL Blender Live Sync Started!`);
console.log(`Watching Folder: ${SOURCE_DIR}`);
console.log(`Any saved .blend file will be auto-exported.\n`);

function checkAndSync() {
  try {
    if (!fs.existsSync(SOURCE_DIR)) {
      console.error(`❌ Source directory not found: ${SOURCE_DIR}`);
      return;
    }

    const files = fs.readdirSync(SOURCE_DIR).filter(f => f.endsWith('.blend'));
    
    for (const file of files) {
      const fullPath = path.join(SOURCE_DIR, file);
      const stats = fs.statSync(fullPath);
      const mtime = stats.mtimeMs;

      if (!mtimes.has(file)) {
        mtimes.set(file, mtime);
        continue;
      }

      if (mtime > mtimes.get(file)) {
        console.log(`\n[${new Date().toLocaleTimeString()}] 💾 Change detected in: ${file}`);
        mtimes.set(file, mtime);

        // Call export script with "AUTO" for scene name (it will use the active scene in blend)
        const cmd = `"${BLENDER_PATH}" -b "${fullPath}" -P "${EXPORT_SCRIPT}" -- "AUTO" "${outputRoot}" "${manifestPath}"`;
        console.log(`Syncing level...`);

        try {
          execSync(cmd, { stdio: 'inherit' });
          console.log(`✅ Sync Complete for ${file}!`);
        } catch (err) {
          console.error(`❌ Export Failed!`);
        }
      }
    }
  } catch (err) {
    console.error(`Error during watch:`, err.message);
  }
}

// Check every few seconds
setInterval(checkAndSync, INTERVAL_MS);

// Clean exit
process.on('SIGINT', () => {
  console.log("\nStopping Global Live Sync...");
  process.exit();
});
