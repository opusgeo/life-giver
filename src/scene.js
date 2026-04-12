import * as THREE from 'three';

// Clay material (başlangıç — gri/beyaz)
export function clayMaterial() {
  return new THREE.MeshToonMaterial({ color: 0xc8c8c8 });
}

// Renkli materyal (canlandırılmış hali)
function coloredMaterial(color) {
  return new THREE.MeshToonMaterial({ color });
}

// Her "canlandırılabilir" objeye eklediğimiz veri
function makeInteractable(mesh, targetColor) {
  mesh.userData.isAlive = false;
  mesh.userData.targetColor = targetColor;
  mesh.userData.interactable = true;
  mesh.material = clayMaterial();
  return mesh;
}

// ─── Primitif Yardımcılar ────────────────────────────────────────────────────

function box(w, h, d, color, x, y, z) {
  const geo = new THREE.BoxGeometry(w, h, d);
  const mesh = new THREE.Mesh(geo, clayMaterial());
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return makeInteractable(mesh, color);
}

function cylinder(rt, rb, h, seg, color, x, y, z) {
  const geo = new THREE.CylinderGeometry(rt, rb, h, seg);
  const mesh = new THREE.Mesh(geo, clayMaterial());
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  return makeInteractable(mesh, color);
}

function cone(r, h, seg, color, x, y, z) {
  const geo = new THREE.ConeGeometry(r, h, seg);
  const mesh = new THREE.Mesh(geo, clayMaterial());
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  return makeInteractable(mesh, color);
}

function sphere(r, color, x, y, z) {
  const geo = new THREE.SphereGeometry(r, 8, 6);
  const mesh = new THREE.Mesh(geo, clayMaterial());
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  return makeInteractable(mesh, color);
}

// ─── Diorama 1: Orman Köşesi ─────────────────────────────────────────────────

export function buildDiorama(scene) {
  const objects = [];

  // Zemin platformu (interactable değil — arka plan)
  const groundGeo = new THREE.CylinderGeometry(5.5, 5.5, 0.4, 32);
  const groundMat = new THREE.MeshToonMaterial({ color: 0xc8c8c8 });
  const ground = new THREE.Mesh(groundGeo, groundMat);
  ground.position.y = -0.2;
  ground.receiveShadow = true;
  ground.userData.interactable = true;
  ground.userData.isAlive = false;
  ground.userData.targetColor = 0x7ec850;
  scene.add(ground);
  objects.push(ground);

  // ── Ağaç 1 (sol arka) ──
  const trunk1 = cylinder(0.18, 0.22, 1.2, 7, 0x8B5E3C, -2.2, 0.6, -1.8);
  const leaves1a = cone(0.9, 1.4, 7, 0x3a8a3a, -2.2, 1.9, -1.8);
  const leaves1b = cone(0.7, 1.1, 7, 0x4caf50, -2.2, 2.6, -1.8);
  scene.add(trunk1, leaves1a, leaves1b);
  objects.push(trunk1, leaves1a, leaves1b);

  // ── Ağaç 2 (sağ arka) ──
  const trunk2 = cylinder(0.14, 0.18, 1.0, 7, 0x8B5E3C, 2.0, 0.5, -2.0);
  const leaves2a = cone(0.75, 1.2, 7, 0x2d7a2d, 2.0, 1.6, -2.0);
  const leaves2b = cone(0.55, 0.9, 7, 0x52b152, 2.0, 2.2, -2.0);
  scene.add(trunk2, leaves2a, leaves2b);
  objects.push(trunk2, leaves2a, leaves2b);

  // ── Küçük kulübe ──
  const houseBase = box(1.6, 1.0, 1.4, 0xf5deb3, 0.4, 0.5, 0.2);
  const houseRoof = new THREE.Mesh(
    new THREE.ConeGeometry(1.2, 0.8, 4),
    clayMaterial()
  );
  houseRoof.position.set(0.4, 1.4, 0.2);
  houseRoof.rotation.y = Math.PI / 4;
  houseRoof.castShadow = true;
  houseRoof.userData.interactable = true;
  houseRoof.userData.isAlive = false;
  houseRoof.userData.targetColor = 0xe74c3c;
  scene.add(houseBase, houseRoof);
  objects.push(houseBase, houseRoof);

  // Kapı
  const door = box(0.28, 0.5, 0.05, 0x8B4513, 0.4, 0.25, 0.93);
  scene.add(door);
  objects.push(door);

  // ── Kayalar ──
  const rock1 = sphere(0.28, 0x9e9e9e, -1.0, 0.28, 1.2);
  const rock2 = sphere(0.18, 0xbdbdbd, -0.6, 0.18, 1.5);
  const rock3 = sphere(0.22, 0x757575, 1.5, 0.22, 0.8);
  scene.add(rock1, rock2, rock3);
  objects.push(rock1, rock2, rock3);

  // ── Çiçekler ──
  const flowerColors = [0xff6b9d, 0xffcc02, 0xff8c42, 0xa855f7];
  const flowerPositions = [
    [-1.8, 0.3, 0.8], [-1.4, 0.3, 1.2], [1.2, 0.3, 1.4],
    [1.6, 0.3, 0.9], [0.0, 0.3, 1.8], [-0.5, 0.3, 1.9]
  ];
  flowerPositions.forEach(([x, y, z], i) => {
    const stem = cylinder(0.03, 0.03, 0.3, 5, 0x4caf50, x, y, z);
    const bloom = sphere(0.12, flowerColors[i % flowerColors.length], x, y + 0.2, z);
    scene.add(stem, bloom);
    objects.push(stem, bloom);
  });

  // ── Gölet ──
  const pondGeo = new THREE.CylinderGeometry(0.7, 0.7, 0.08, 16);
  const pond = new THREE.Mesh(pondGeo, clayMaterial());
  pond.position.set(-0.3, 0.04, -0.6);
  pond.userData.interactable = true;
  pond.userData.isAlive = false;
  pond.userData.targetColor = 0x4dd0e1;
  scene.add(pond);
  objects.push(pond);

  // ── Mantar ──
  const mushStem = cylinder(0.1, 0.12, 0.3, 7, 0xfff8e7, -2.8, 0.15, 0.5);
  const mushCap = new THREE.Mesh(
    new THREE.SphereGeometry(0.28, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2),
    clayMaterial()
  );
  mushCap.position.set(-2.8, 0.38, 0.5);
  mushCap.userData.interactable = true;
  mushCap.userData.isAlive = false;
  mushCap.userData.targetColor = 0xf44336;
  scene.add(mushStem, mushCap);
  objects.push(mushStem, mushCap);

  return objects;
}
