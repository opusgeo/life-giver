const fs = require('fs');
const path = require('path');

const modelsDir = 'c:/Users/Burak/life-giver/dist/models';
const manifestPath = 'c:/Users/Burak/life-giver/dist/models/manifest.json';

const folders = fs.readdirSync(modelsDir).filter(f => {
    return fs.statSync(path.join(modelsDir, f)).isDirectory();
});

// Sort by prefix numeric value, then by name
folders.sort((a, b) => {
    const aNum = parseInt(a.match(/^(\d+)/)?.[1] || '999');
    const bNum = parseInt(b.match(/^(\d+)/)?.[1] || '999');
    if (aNum !== bNum) return aNum - bNum;
    return a.localeCompare(b);
});

const manifest = {};

folders.forEach(folder => {
    if (!folder.match(/^\d+_/)) return; // Only take folders starting with 000_ etc.
    
    const folderPath = path.join(modelsDir, folder);
    const files = fs.readdirSync(folderPath).filter(f => f.endsWith('.glb'));
    
    if (files.length > 0) {
        manifest[folder] = files.sort().map(f => `${folder}/${f}`);
    }
});

fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
console.log(`Manifest rebuilt with ${Object.keys(manifest).length} entries.`);
Object.keys(manifest).forEach((k, i) => console.log(`${i+1}: ${k}`));
