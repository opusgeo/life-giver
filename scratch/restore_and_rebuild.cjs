const fs = require('fs');
const path = require('path');

const distDir = 'c:/Users/Burak/life-giver/dist/models';
const publicDir = 'c:/Users/Burak/life-giver/public/models';
const manifestPath = 'c:/Users/Burak/life-giver/public/models/manifest.json';

// Step 1: Sync from dist to public
if (fs.existsSync(distDir)) {
    const folders = fs.readdirSync(distDir);
    folders.forEach(f => {
        const fullDist = path.join(distDir, f);
        const fullPublic = path.join(publicDir, f);
        if (fs.statSync(fullDist).isDirectory()) {
             const distFiles = fs.readdirSync(fullDist).filter(file => file.endsWith('.glb'));
             if (distFiles.length > 0) {
                 if (!fs.existsSync(fullPublic)) {
                     fs.mkdirSync(fullPublic, { recursive: true });
                 }
                 const publicFiles = fs.existsSync(fullPublic) ? fs.readdirSync(fullPublic) : [];
                 if (publicFiles.length === 0) {
                     console.log(`Restoring folder: ${f}`);
                     distFiles.forEach(file => {
                         fs.copyFileSync(path.join(fullDist, file), path.join(fullPublic, file));
                     });
                 }
             }
        }
    });
}

// Step 2: Rebuild Manifest in PUBLIC (Ground Truth)
function rebuild() {
    const folders = fs.readdirSync(publicDir).filter(f => {
        const full = path.join(publicDir, f);
        return fs.statSync(full).isDirectory() && f.match(/^\d+_/);
    });

    folders.sort((a, b) => {
        const aNum = parseInt(a.match(/^(\d+)/)?.[1] || '999');
        const bNum = parseInt(b.match(/^(\d+)/)?.[1] || '999');
        if (aNum !== bNum) return aNum - bNum;
        return a.localeCompare(b);
    });

    const manifest = {};
    folders.forEach(folder => {
        const folderPath = path.join(publicDir, folder);
        const files = fs.readdirSync(folderPath).filter(f => f.endsWith('.glb'));
        if (files.length > 0) {
            manifest[folder] = files.sort().map(f => `${folder}/${f}`);
        }
    });

    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
    
    // Also update DIST manifest so the app sees it immediately
    const distManifest = 'c:/Users/Burak/life-giver/dist/models/manifest.json';
    if (fs.existsSync(path.dirname(distManifest))) {
        fs.writeFileSync(distManifest, JSON.stringify(manifest, null, 2));
    }

    console.log(`Manifest rebuilt with ${Object.keys(manifest).length} entries.`);
    Object.keys(manifest).forEach((k, i) => console.log(`${i+1}: ${k}`));
}

rebuild();
