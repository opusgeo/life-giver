import * as THREE from 'three';
import { getModel } from './glbCache.js';
import { createWater, createIce } from './water.js';

// ─── Materyal ────────────────────────────────────────────────────────────────
// Clay: Bej/açık taş tonu — Gündüz modunda turuncu görünmemesi için nötrleştirildi
export const CLAY_COLOR = 0xb4b2a8;

export function clayMat() {
  return new THREE.MeshStandardMaterial({ 
    color: CLAY_COLOR,
    roughness: 0.85,
    metalness: 0.1,
    flatShading: false,
    side: THREE.DoubleSide
  });
}

// ─── Grup/mesh yardımcıları ──────────────────────────────────────────────────

function makeObj(islandGroup, objects) {
  const g = new THREE.Group();
  g.userData.interactable = true;
  g.userData.isAlive = false;
  islandGroup.add(g);
  objects.push(g);
  return g;
}

/** Gruba mesh ekler ve boyama shader'ı için gerekli originalMaterial bilgisini saklar. */
function m(group, geo, color, x, y, z, rotY = 0, rotX = 0, rotZ = 0) {
  const mesh = new THREE.Mesh(geo, clayMat());
  mesh.position.set(x, y, z);
  mesh.rotation.set(rotX, rotY, rotZ);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  
  // ÖNEMLİ: Boyama shader'ının hedef alacağı orijinal materyal
  mesh.userData.originalMaterial = new THREE.MeshToonMaterial({ 
    color: color,
    transparent: false
  });
  
  group.add(mesh);
  return mesh;
}

function deco(islandGroup, geo, color, x, y, z, rotY = 0) {
  const mesh = new THREE.Mesh(geo, new THREE.MeshToonMaterial({ color }));
  mesh.position.set(x, y, z);
  mesh.rotation.y = rotY;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  islandGroup.add(mesh);
  return mesh;
}

const G = {
  box:  (w, h, d) => new THREE.BoxGeometry(w, h, d),
  cyl:  (rt, rb, h, s) => new THREE.CylinderGeometry(rt, rb, h, s),
  cone: (r, h, s)  => new THREE.ConeGeometry(r, h, s),
  sph:  (r, ws, hs) => new THREE.SphereGeometry(r, ws ?? 8, hs ?? 6),
};

function createMeadowTexture() {
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const grad = ctx.createRadialGradient(size/2, size/2, 0, size/2, size/2, size/2);
  grad.addColorStop(0, '#a3ff70'); 
  grad.addColorStop(0.4, '#52c41a'); 
  grad.addColorStop(1, '#1b5e20');   
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(canvas);
}
const meadowMap = createMeadowTexture();

function buildBase(islandGroup, objects, topColor, yOffset = 0) {
  const meadowGroup = makeObj(islandGroup, objects);
  const topGeo = G.cyl(5.2, 5.2, 0.45, 32);
  const topMesh = new THREE.Mesh(topGeo, clayMat());
  topMesh.position.set(0, -0.22 + yOffset, 0);
  topMesh.castShadow = true;
  topMesh.receiveShadow = true;
  
  // Zemin boyama desteği
  topMesh.userData.originalMaterial = new THREE.MeshStandardMaterial({
    map: meadowMap,
    color: 0x999999,
    roughness: 0.8,
    metalness: 0.0
  });
  
  meadowGroup.add(topMesh);
  deco(islandGroup, G.cyl(4.8, 3.8, 1.2, 8), 0x5d4037, 0, -1.2 + yOffset, 0, 0.4); 
  deco(islandGroup, G.cyl(3.2, 0.5, 3.0, 6), 0x3e2723, 0, -2.8 + yOffset, 0, -0.2); 
}

// ════════════════════════════════════════════════════════════════════════════
// ADA 2 — GİZLİ KAYNAK (The Hidden Spring)
// ════════════════════════════════════════════════════════════════════════════

// ─── Manifest-based Builder ───────────────────────────────────────────────────

/**
 * Builds an island from a list of GLB paths.
 * No platform/base is added as requested (bunlara platform ekleme).
 */
export function buildLevelFromManifest(islandGroup, files) {
  const objects = [];
  
  files.forEach(fileEntry => {
    // Port: support "file.glb|px,py,pz|rx,ry,rz|sx,sy,sz"
    const [file, posStr, rotStr, scaleStr] = fileEntry.split('|');
    
    const model = getModel(file);
    if (!model) return;

    const isBall      = file.includes('Backpack_Model_BeachBall');
    const isField     = file.includes('Bunchtown_009');
    const isSheepball = file.includes('sheepball');

    const group = new THREE.Group();
    group.userData.interactable = true;
    group.userData.isAlive      = false;
    if (isBall)      group.userData.isBall      = true;
    if (isField)     group.userData.isField     = true;
    if (isSheepball) group.userData.isSheepball = true;

    // Apply external transforms if present
    if (posStr) {
      const p = posStr.split(',').map(Number);
      group.position.set(p[0], p[1], p[2]);
    }
    if (rotStr) {
      const r = rotStr.split(',').map(Number);
      group.rotation.set(r[0], r[1], r[2]);
    }
    if (scaleStr) {
      const s = scaleStr.split(',').map(Number);
      group.scale.set(s[0], s[1], s[2]);
    }
    
    model.traverse(node => {
      if (!node.isMesh) return;
      node.castShadow = true; 
      node.receiveShadow = true;

      const hasVertexColors = node.geometry.hasAttribute('color') || node.geometry.hasAttribute('Color');
      
      const originalMat = Array.isArray(node.material) ? node.material.map(m => m.clone()) : node.material.clone();
      const mats = Array.isArray(originalMat) ? originalMat : [originalMat];
      
      mats.forEach(m => {
        if (hasVertexColors) {
          m.vertexColors = true;
          if (m.color) m.color.set(0xffffff);
        }
        if (m.emissive) m.emissive.setScalar(0);
        if (m.metalness !== undefined) m.metalness = 0;
      });

      node.userData.originalMaterial = originalMat;
      const customClay = clayMat();
      if (hasVertexColors) customClay.vertexColors = true;
      node.material = customClay;
    });

    group.add(model);
    islandGroup.add(group);
    objects.push(group);
  });
  
  return objects;
}

/** 
 * DIORAMA_LIST populated by initDioramas
 */
export let DIORAMA_LIST = [];

/**
 * Populates DIORAMA_LIST from the manifest data.
 */
export function initDioramas(manifest) {
  DIORAMA_LIST = Object.entries(manifest).map(([name, files], index) => {
    // Generate a human-readable name from the folder name
    // e.g. "008_TerraceRoom_Small" -> "Terrace Room Small"
    const displayName = name
      .replace(/^\d+_/, '') // Remove "008_" prefix
      .replace(/_/g, ' ');

    const def = {
      name: displayName,
      folder: name,
      files: files,
      build: (group) => buildLevelFromManifest(group, files),
      scale: 0.4,
      groundY: -0.01 // Default ground position
    };

    // Level-specific overrides by folder name (robust against index shifts)
    if (name.includes('008_TerraceRoom_Small')) {
      def.groundY = -1.2;
    }
    if (name.includes('012_FishingIsland')) {
      def.groundY = -1.2;
    }

    return def;
  });
}

