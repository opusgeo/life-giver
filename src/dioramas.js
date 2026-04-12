import * as THREE from 'three';
import { getModel } from './glbCache.js';

// ─── Materyal ────────────────────────────────────────────────────────────────
// Clay: saf nötr gri — hiç renk ipucu yok, tamamen cansız
export const CLAY_COLOR = 0xa8a8a8;

export function clayMat() {
  return new THREE.MeshToonMaterial({ color: CLAY_COLOR });
}

// ─── Grup/mesh yardımcıları ──────────────────────────────────────────────────

/**
 * Mantıksal bir obje grubu oluşturur (ağaç, ev, kaya gibi).
 * islandGroup'a eklenir. objects dizisine push edilir.
 * Tek tıklama → bu grubun tüm mesh'leri boyanır.
 */
function makeObj(islandGroup, objects) {
  const g = new THREE.Group();
  g.userData.interactable = true;
  g.userData.isAlive = false;
  islandGroup.add(g);
  objects.push(g);
  return g;
}

/** Gruba mesh ekler. Her mesh kendi hedef rengini taşır. */
function m(group, geo, color, x, y, z, rotY = 0, rotX = 0, rotZ = 0) {
  const mesh = new THREE.Mesh(geo, clayMat());
  mesh.position.set(x, y, z);
  mesh.rotation.set(rotX, rotY, rotZ);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.userData.targetColor = color; // her mesh kendi Ghibli rengini bilir
  group.add(mesh);
  return mesh;
}

/** Dekoratif (tıklanamaz) mesh — direkt islandGroup'a */
function deco(islandGroup, geo, color, x, y, z, rotY = 0) {
  const mesh = new THREE.Mesh(geo, new THREE.MeshToonMaterial({ color }));
  mesh.position.set(x, y, z);
  mesh.rotation.y = rotY;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  islandGroup.add(mesh);
  return mesh;
}

// ─── Geometri kısaltmaları ───────────────────────────────────────────────────
const G = {
  box:  (w, h, d) => new THREE.BoxGeometry(w, h, d),
  cyl:  (rt, rb, h, s) => new THREE.CylinderGeometry(rt, rb, h, s),
  cone: (r, h, s)  => new THREE.ConeGeometry(r, h, s),
  sph:  (r, ws, hs) => new THREE.SphereGeometry(r, ws ?? 8, hs ?? 6),
};

// ─── Ada tabanı (sarkık kaya katmanları) — dekoratif ────────────────────────
function buildBase(islandGroup, objects, topColor) {
  const top = makeObj(islandGroup, objects);
  m(top, G.cyl(5.2, 5.4, 0.5, 12), topColor, 0, -0.25, 0);

  // Dekoratif alt katmanlar (tıklanamaz)
  deco(islandGroup, G.cyl(4.5, 3.6, 1.3, 9), 0x7a7a80, 0, -1.1, 0);
  deco(islandGroup, G.cyl(3.0, 1.2, 2.2, 7), 0x606068, 0, -2.7, 0);
  deco(islandGroup, G.cyl(1.0, 0.3, 1.0, 6), 0x505058, 0, -4.1, 0);
}

// ════════════════════════════════════════════════════════════════════════════
// ADA 1 — ORMAN KÖŞESİ  (Ghibli renk paleti)
// ════════════════════════════════════════════════════════════════════════════

export function buildForestIsland(islandGroup) {
  const objects = [];

  // ── Zemin ──────────────────────────────────────────────────────────────
  buildBase(islandGroup, objects, 0x52c41a); // canlı bahar yeşili

  // ── Büyük Ağaç ─────────────────────────────────────────────────────────
  const bigTree = makeObj(islandGroup, objects);
  m(bigTree, G.cyl(0.22, 0.30, 1.5, 7),  0x7b4f2e,  -2.0, 0.75, -1.6); // gövde — sıcak kahve
  m(bigTree, G.cone(1.05, 1.6, 7),        0x1b6b3a,  -2.0, 2.05, -1.6); // alt yaprak — koyu zümrüt
  m(bigTree, G.cone(0.80, 1.3, 7),        0x27ae60,  -2.0, 2.95, -1.6); // orta — parlak zümrüt
  m(bigTree, G.cone(0.52, 1.0, 7),        0x52d68a,  -2.0, 3.70, -1.6); // tepe — açık limon

  // ── Orta Boy Ağaç ───────────────────────────────────────────────────────
  const midTree = makeObj(islandGroup, objects);
  m(midTree, G.cyl(0.16, 0.22, 1.1, 7),  0x8b5e3c,  2.2, 0.55, -2.0);
  m(midTree, G.cone(0.82, 1.35, 7),       0x1e8449,  2.2, 1.75, -2.0);
  m(midTree, G.cone(0.60, 1.05, 7),       0x2ecc71,  2.2, 2.55, -2.0);

  // ── Ev ──────────────────────────────────────────────────────────────────
  const house = makeObj(islandGroup, objects);
  m(house, G.box(1.7, 1.1, 1.5),          0xf5a623,  0.3, 0.55, 0.2);   // duvar — altın turuncu
  m(house, G.cone(1.35, 0.95, 4),         0xc0392b,  0.3, 1.5,  0.2, Math.PI / 4); // çatı — zengin kırmızı
  m(house, G.box(0.30, 0.58, 0.06),       0x7b3f00,  0.3, 0.29, 0.98);  // kapı — koyu çikolata

  // ── Gölet ───────────────────────────────────────────────────────────────
  const pond = makeObj(islandGroup, objects);
  m(pond, G.cyl(0.78, 0.78, 0.07, 18),   0x2980b9, -0.2, 0.04, -0.5);  // zengin serüven mavisi

  // ── Kaya Grubu ──────────────────────────────────────────────────────────
  const rocks = makeObj(islandGroup, objects);
  m(rocks, G.sph(0.30, 7, 5),             0x7f8fa6, -1.0, 0.30,  1.2); // mavi-gri
  m(rocks, G.sph(0.20, 6, 5),             0x95a5a6, -0.6, 0.20,  1.6);
  m(rocks, G.sph(0.25, 7, 5),             0x6c7a89,  1.6, 0.25,  0.9);

  // ── Çiçek Tarlası ───────────────────────────────────────────────────────
  const flowerData = [
    { c: 0xff1493, x: -1.9, z: 0.9 },  // derin pembe
    { c: 0xffd700, x: -1.3, z: 1.3 },  // saf altın
    { c: 0xff6f00, x:  1.2, z: 1.5 },  // amber
    { c: 0x9b59b6, x:  1.7, z: 0.9 },  // ametist mor
    { c: 0xff1493, x:  0.0, z: 1.9 },
    { c: 0xffd700, x: -0.5, z: 2.0 },
  ];
  flowerData.forEach(({ c, x, z }) => {
    const flower = makeObj(islandGroup, objects);
    m(flower, G.cyl(0.035, 0.035, 0.34, 5), 0x27ae60, x, 0.17,  z); // sap
    m(flower, G.sph(0.14, 7, 6),             c,        x, 0.38,  z); // taç
  });

  // ── Mantar ──────────────────────────────────────────────────────────────
  const mush = makeObj(islandGroup, objects);
  m(mush, G.cyl(0.11, 0.14, 0.34, 7),    0xfff3cd, -2.8, 0.17, 0.6); // sap — krem
  // Şapka (yarım küre)
  const capGeo = new THREE.SphereGeometry(0.32, 9, 5, 0, Math.PI * 2, 0, Math.PI / 2);
  m(mush, capGeo,                          0xd32f2f, -2.8, 0.44, 0.6); // parlak kırmızı

  return objects;
}

// ════════════════════════════════════════════════════════════════════════════
// ADA 2 — KIŞ KÖYÜ  (Ghibli renk paleti)
// ════════════════════════════════════════════════════════════════════════════

export function buildWinterIsland(islandGroup) {
  const objects = [];

  buildBase(islandGroup, objects, 0xddeeff); // buz mavisi kar

  // ── Çam Ağaçları ────────────────────────────────────────────────────────
  [[-2.1, -1.8], [2.3, -1.9], [-3.0, 0.2]].forEach(([x, z], i) => {
    const h = [1.3, 1.1, 0.9][i];
    const tree = makeObj(islandGroup, objects);
    m(tree, G.cyl(0.14, 0.18, h, 7),     0x7d5a3c,  x, h / 2, z);
    m(tree, G.cone(0.85, 1.5, 7),        0x1b5e20,  x, h + 0.75, z);  // koyu çam
    m(tree, G.cone(0.65, 1.1, 7),        0x2e7d32,  x, h + 1.50, z);
    m(tree, G.cone(0.42, 0.6, 7),        0xb3e5ff,  x, h + 1.95, z);  // kar — buz mavisi
  });

  // ── Igloo ───────────────────────────────────────────────────────────────
  const igloo = makeObj(islandGroup, objects);
  const iglooGeo = new THREE.SphereGeometry(0.92, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2);
  m(igloo, iglooGeo,                      0x85c1e9,  0.5, 0.92,  0.3); // buz mavisi
  m(igloo, G.box(0.30, 0.38, 0.30),       0x5dade2,  0.5, 0.19,  1.2); // giriş — derin mavi

  // ── Kardan Adam ─────────────────────────────────────────────────────────
  const snowman = makeObj(islandGroup, objects);
  m(snowman, G.sph(0.40),                 0xf0f4ff, -0.8, 0.40, 0.8); // gövde — buz beyazı
  m(snowman, G.sph(0.28),                 0xf0f4ff, -0.8, 0.98, 0.8); // baş
  m(snowman, G.sph(0.10, 6, 5),           0xff6f00, -0.8, 0.98, 1.06); // havuç burun — amber
  m(snowman, G.sph(0.07, 5, 4),           0x1a237e, -0.87, 1.05, 1.03); // sol göz — lacivert
  m(snowman, G.sph(0.07, 5, 4),           0x1a237e, -0.73, 1.05, 1.03); // sağ göz
  m(snowman, G.cyl(0.22, 0.22, 0.32, 8), 0x1a237e, -0.8,  1.37, 0.8); // şapka silindir
  m(snowman, G.cyl(0.34, 0.34, 0.06, 8), 0x1a237e, -0.8,  1.22, 0.8); // şapka ağzı

  // ── Donmuş Göl ──────────────────────────────────────────────────────────
  const lake = makeObj(islandGroup, objects);
  m(lake, G.cyl(1.05, 1.05, 0.07, 18),   0x4fc3f7,  1.8, 0.04,  0.5); // canlı buz mavisi

  // ── Fener Direği ────────────────────────────────────────────────────────
  const lamp = makeObj(islandGroup, objects);
  m(lamp, G.cyl(0.05, 0.06, 1.6, 7),     0x546e7a, -3.5, 0.80, -0.8); // çelik mavi
  m(lamp, G.sph(0.16, 7, 6),             0xffd54f, -3.5, 1.68, -0.8); // amber ışık

  // ── Kar Topları ─────────────────────────────────────────────────────────
  const snowBalls = makeObj(islandGroup, objects);
  m(snowBalls, G.sph(0.20, 6, 5),         0xf0f4ff, 2.8, 0.20, 1.5);
  m(snowBalls, G.sph(0.14, 6, 5),         0xddeeff, 3.1, 0.14, 0.8);

  // ── Kayalar ─────────────────────────────────────────────────────────────
  const winterRocks = makeObj(islandGroup, objects);
  m(winterRocks, G.sph(0.28, 7, 5),       0x546e7a, 2.0, 0.28, -0.5); // çelik mavi-gri
  m(winterRocks, G.sph(0.20, 6, 5),       0x607d8b, 2.4, 0.20, -1.0);

  return objects;
}

// ════════════════════════════════════════════════════════════════════════════
// ADA 3 — FARMHOUSE ODASI  (GLB modeller floating island üzerinde)
// ════════════════════════════════════════════════════════════════════════════

// Farmhouse'da yüklenecek GLB dosyaları ve ada içindeki offsets
const FARMHOUSE_PROPS = [
  'Farmhouse_ROOM_base_v01.glb',
  'Farmhouse_ROOM_bed_v01.glb',
  'Farmhouse_ROOM_desk_v01.glb',
  'Farmhouse_ROOM_books_v01.glb',
  'Farmhouse_ROOM_shelves01_v01.glb',
  'Farmhouse_ROOM_shelves02_v01.glb',
  'Farmhouse_ROOM_rug_v01.glb',
  'Farmhouse_ROOM_curtains_v01.glb',
  'Farmhouse_ROOM_frame_v01.glb',
  'Farmhouse_ROOM_parchoment_v01.glb',
  'Farmhouse_ROOM_floorplant_v01.glb',
  'Farmhouse_ROOM_floorplant_v02.glb',
  'Farmhouse_ROOM_floorplant_v03.glb',
  'Farmhouse_ROOM_flowerpot_v01.glb',
  'Farmhouse_ROOM_flowerpot02_v01.glb',
  'Farmhouse_ROOM_flowerpot03_v01.glb',
  'Farmhouse_ROOM_decorateflower_v01.glb',
  'Farmhouse_ROOM_flowerivy_v01.glb',
  'Farmhouse_ROOM_flowerivy2_v01.glb',
  'Farmhouse_ROOM_ivy03_v01.glb',
  'Farmhouse_ROOM_basket_v01.glb',
  'Farmhouse_ROOM_pot_v01.glb',
  'Farmhouse_ROOM_duck_v01.glb',
  'Farmhouse_ROOM_kirby_v01.glb',
  'Farmhouse_ROOM_planks_v01.glb',
  'Farmhouse_ROOM_wallstones_v01.glb',
  'Farmhouse_ROOM_woodenstairs_v01.glb',
  'Farmhouse_ROOM_window_v01.glb',
  'Farmhouse_ROOM_window02_v01.glb',
];

export const FARMHOUSE_FILES = FARMHOUSE_PROPS; // main.js preload için

export function buildFarmhouseIsland(islandGroup) {
  const objects = [];

  // Sıcak ahşap tonlu zemin
  buildBase(islandGroup, objects, 0x8d6e63);

  FARMHOUSE_PROPS.forEach(file => {
    const model = getModel(file);
    if (!model) return; // henüz yüklenmemişse atla

    // Her GLB dosyası = 1 interactable grup
    const group = new THREE.Group();
    group.name = file;
    group.userData.interactable = true;
    group.userData.isAlive      = false;

    model.traverse(node => {
      if (!node.isMesh) return;
      node.castShadow    = true;
      node.receiveShadow = true;

      // Orijinal materyali sakla
      node.userData.originalMaterial = Array.isArray(node.material)
        ? node.material.map(mat => mat.clone())
        : node.material.clone();

      // Clay uygula
      node.material = clayMat();
    });

    group.add(model);
    islandGroup.add(group);
    objects.push(group);
  });

  return objects;
}

// ─── Diorama listesi ─────────────────────────────────────────────────────────
export const DIORAMA_LIST = [
  { build: buildFarmhouseIsland, name: 'Farmhouse Odası', scale: 0.45 },
  { build: buildForestIsland,   name: 'Orman Köşesi' },
  { build: buildWinterIsland,   name: 'Kış Köyü'     },
];
