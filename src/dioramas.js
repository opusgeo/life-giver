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
    flatShading: false
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

function buildBase(islandGroup, objects, topColor) {
  const meadowGroup = makeObj(islandGroup, objects);
  const topGeo = G.cyl(5.2, 5.2, 0.45, 32);
  const topMesh = new THREE.Mesh(topGeo, clayMat());
  topMesh.position.set(0, -0.22, 0);
  topMesh.castShadow = true;
  topMesh.receiveShadow = true;
  
  // Zemin boyama desteği
  topMesh.userData.originalMaterial = new THREE.MeshStandardMaterial({
    map: meadowMap,
    color: 0x999999,
    roughness: 0.8,
    metalness: 0.1
  });
  
  meadowGroup.add(topMesh);
  deco(islandGroup, G.cyl(4.8, 3.8, 1.2, 8), 0x5d4037, 0, -1.2, 0, 0.4); 
  deco(islandGroup, G.cyl(3.2, 0.5, 3.0, 6), 0x3e2723, 0, -2.8, 0, -0.2); 
}

// ════════════════════════════════════════════════════════════════════════════
// ADA 2 — GİZLİ KAYNAK (The Hidden Spring)
// ════════════════════════════════════════════════════════════════════════════

export function buildForestIsland(islandGroup) {
  const objects = [];
  buildBase(islandGroup, objects, 0x4caf50); 

  const pond = makeObj(islandGroup, objects);
  // shallow stone rim (clay, participates in bloom animation)
  m(pond, G.cyl(1.15, 1.15, 0.08, 24), 0x448aff, 0.2, 0.02, -0.2);
  m(pond, G.cyl(0.2, 0.2, 0.04, 8),    0x2e7d32, -0.2, 0.1, -0.3);
  m(pond, G.cyl(0.15, 0.15, 0.04, 8),  0x2e7d32, 0.4, 0.11, 0.1);
  // animated water surface (always visible, not clay)
  const _pondWater = createWater(1.05);
  _pondWater.mesh.position.set(0.2, 0.07, -0.2);
  islandGroup.add(_pondWater.mesh);
  islandGroup.userData.waterTick = _pondWater.tick;
  islandGroup.userData.waterSetNight = _pondWater.setNightMode;

  const ancientTree = makeObj(islandGroup, objects);
  m(ancientTree, G.cyl(0.35, 0.45, 1.8, 8), 0x5d4037, -2.2, 0.9, -1.8); 
  m(ancientTree, G.sph(1.2, 10, 8),           0x1b5e20, -2.2, 2.4, -1.8); 
  m(ancientTree, G.sph(0.9, 8, 8),            0x2e7d32, -2.5, 3.2, -1.5); 
  m(ancientTree, G.sph(0.8, 8, 8),            0x388e3c, -1.8, 3.1, -2.1); 

  const cozyHouse = makeObj(islandGroup, objects);
  m(cozyHouse, G.box(1.4, 1.2, 1.4),          0xfafafa,  2.4, 0.6, 0.0); 
  m(cozyHouse, G.cone(1.2, 1.0, 4),           0xd32f2f,  2.4, 1.7, 0.0, Math.PI / 4); 
  m(cozyHouse, G.box(0.2, 0.45, 0.05),        0x795548,  2.4, 0.22, 0.72); 

  const mushrooms = makeObj(islandGroup, objects);
  const mushPos = [[-2.5, 1.2], [-2.8, 0.8], [-2.2, 0.7]];
  mushPos.forEach(([x, z], i) => {
    const s = 1 - i * 0.15;
    m(mushrooms, G.cyl(0.1*s, 0.12*s, 0.3*s, 6), 0xfff3cd, x, 0.15*s, z);
    m(mushrooms, G.sph(0.25*s, 8, 6),             0xe91e63, x, 0.35*s, z);
  });

  const decoGroup = makeObj(islandGroup, objects);
  m(decoGroup, G.sph(0.4), 0x90a4ae, -1.2, 0.2, 1.8);
  m(decoGroup, G.sph(0.25), 0x78909c, 2.8, 0.1, -2.2);
  const flowers = [
    {c: 0xffeb3b, x: 0.8, z: 1.5}, {c: 0xe91e63, x: 1.1, z: 1.8},
    {c: 0x9c27b0, x: -1.5, z: -0.8}, {c: 0x03a9f4, x: -1.8, z: -0.5}
  ];
  flowers.forEach(f => {
    const fObj = makeObj(islandGroup, objects);
    m(fObj, G.cyl(0.03, 0.03, 0.4, 4), 0x388e3c, f.x, 0.2, f.z);
    m(fObj, G.sph(0.12, 6, 6),           f.c, f.x, 0.4, f.z);
  });

  return objects;
}

// ════════════════════════════════════════════════════════════════════════════
// ADA 3 — BUZLU YAMAÇ (The Hermit's Peak)
// ════════════════════════════════════════════════════════════════════════════

export function buildWinterIsland(islandGroup) {
  const objects = [];
  buildBase(islandGroup, objects, 0xe3f2fd);

  const cliff = makeObj(islandGroup, objects);
  m(cliff, G.box(5.0, 1.8, 2.5),          0xffffff, -0.5, 0.8, -2.0); 
  m(cliff, G.box(2.0, 1.2, 1.5),          0xeeeeee, 2.0, 0.5, -1.8);

  const cabin = makeObj(islandGroup, objects);
  m(cabin, G.box(1.2, 1.0, 1.2),          0x795548, -0.5, 2.3, -2.0); 
  m(cabin, G.cone(1.1, 0.8, 4),           0x5d4037, -0.5, 3.2, -2.0, Math.PI / 4); 
  m(cabin, G.box(0.2, 0.2, 0.4),          0xffd54f, -0.5, 2.3, -1.4); 

  const frozenLake = makeObj(islandGroup, objects);
  m(frozenLake, G.cyl(1.4, 1.4, 0.05, 18), 0x90caf9, 1.0, 0.05, 1.2);
  m(frozenLake, G.sph(0.4),                0xffffff, -0.5, 0.1, 0.8);
  // animated ice sheen on top
  const _iceWater = createIce(1.35);
  _iceWater.mesh.position.set(1.0, 0.08, 1.2);
  islandGroup.add(_iceWater.mesh);
  islandGroup.userData.waterTick = _iceWater.tick;

  const forest = makeObj(islandGroup, objects);
  const pinePos = [[-3.2, 0.5], [2.8, 1.8], [3.2, 1.0]];
  pinePos.forEach(([x, z], i) => {
    const h = 1.0 + i * 0.2;
    const tree = makeObj(islandGroup, objects);
    m(tree, G.cyl(0.1, 0.15, h, 6),     0x3e2723, x, h/2, z); 
    m(tree, G.cone(0.8, 1.4, 6),        0x1b5e20, x, h+0.6, z); 
    m(tree, G.cone(0.6, 1.0, 6),        0xfafafa, x, h+1.2, z); 
  });

  const details = makeObj(islandGroup, objects);
  m(details, G.sph(0.35), 0xffffff, -1.8, 0.35, 1.5);
  m(details, G.sph(0.25), 0xffffff, -1.8, 0.85, 1.5);
  m(details, G.cone(0.06, 0.2, 6), 0xff9800, -1.8, 0.85, 1.75, Math.PI/2); 
  
  const lamp = makeObj(islandGroup, objects);
  m(lamp, G.cyl(0.06, 0.06, 1.8, 6), 0x263238, 3.5, 0.9, 0.5);
  m(lamp, G.sph(0.18, 6, 6),          0xfff176, 3.5, 1.8, 0.5);

  return objects;
}

// ════════════════════════════════════════════════════════════════════════════
// ADA 1 — FARMHOUSE ODASI
// ════════════════════════════════════════════════════════════════════════════

const FARMHOUSE_PROPS = [
  'Farmhouse_ROOM_base_v01.glb', 'Farmhouse_ROOM_bed_v01.glb', 'Farmhouse_ROOM_desk_v01.glb',
  'Farmhouse_ROOM_books_v01.glb', 'Farmhouse_ROOM_shelves01_v01.glb', 'Farmhouse_ROOM_shelves02_v01.glb',
  'Farmhouse_ROOM_rug_v01.glb', 'Farmhouse_ROOM_curtains_v01.glb', 'Farmhouse_ROOM_frame_v01.glb',
  'Farmhouse_ROOM_parchoment_v01.glb', 'Farmhouse_ROOM_floorplant_v01.glb', 'Farmhouse_ROOM_floorplant_v02.glb',
  'Farmhouse_ROOM_floorplant_v03.glb', 'Farmhouse_ROOM_flowerpot_v01.glb', 'Farmhouse_ROOM_flowerpot02_v01.glb',
  'Farmhouse_ROOM_flowerpot03_v01.glb', 'Farmhouse_ROOM_decorateflower_v01.glb', 'Farmhouse_ROOM_flowerivy_v01.glb',
  'Farmhouse_ROOM_flowerivy2_v01.glb', 'Farmhouse_ROOM_ivy03_v01.glb', 'Farmhouse_ROOM_basket_v01.glb',
  'Farmhouse_ROOM_pot_v01.glb', 'Farmhouse_ROOM_duck_v01.glb', 'Farmhouse_ROOM_kirby_v01.glb',
  'Farmhouse_ROOM_planks_v01.glb', 'Farmhouse_ROOM_wallstones_v01.glb', 'Farmhouse_ROOM_woodenstairs_v01.glb',
  'Farmhouse_ROOM_window_v01.glb', 'Farmhouse_ROOM_window02_v01.glb',
];

export const FARMHOUSE_FILES = FARMHOUSE_PROPS;

export function buildFarmhouseIsland(islandGroup) {
  const objects = [];
  buildBase(islandGroup, objects, 0x8d6e63);

  FARMHOUSE_PROPS.forEach(file => {
    const model = getModel(file);
    if (!model) return;
    const group = new THREE.Group();
    group.userData.interactable = true;
    group.userData.isAlive      = false;
    model.traverse(node => {
      if (!node.isMesh) return;
      node.castShadow = true; node.receiveShadow = true;
      const originalMat = Array.isArray(node.material) ? node.material.map(m => m.clone()) : node.material.clone();
      const mats = Array.isArray(originalMat) ? originalMat : [originalMat];
      mats.forEach(m => {
        if (m.emissive) m.emissive.setScalar(0);
        if ((file.includes('rug') || file.includes('base')) && m.color) {
          m.color.multiplyScalar(0.7); m.roughness = 1.0; m.metalness = 0.0;
        }
      });
      node.userData.originalMaterial = originalMat;
      node.material = clayMat();
    });
    group.add(model); islandGroup.add(group); objects.push(group);
  });
  return objects;
}

export const DIORAMA_LIST = [
  { build: buildFarmhouseIsland, name: 'Farmhouse Odası', scale: 0.45 },
  { build: buildForestIsland,   name: 'Orman Köşesi' },
  { build: buildWinterIsland,   name: 'Kış Köyü'     },
];
