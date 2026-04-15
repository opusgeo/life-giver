const fs = require('fs');
const path = require('path');

function findGLBs(dir, out = []) {
    const files = fs.readdirSync(dir);
    for (const file of files) {
        const full = path.join(dir, file);
        if (fs.statSync(full).isDirectory()) {
            if (file !== 'node_modules' && file !== '.git') {
                findGLBs(full, out);
            }
        } else if (file.endsWith('.glb')) {
            out.push(full);
        }
    }
    return out;
}

const allGlbs = findGLBs('c:/Users/Burak/life-giver');
const byFolder = {};

allGlbs.forEach(f => {
    const folder = path.dirname(f);
    if (!byFolder[folder]) byFolder[folder] = [];
    byFolder[folder].push(path.basename(f));
});

Object.entries(byFolder).forEach(([folder, files]) => {
    console.log(`${folder}: ${files.length} files`);
});
