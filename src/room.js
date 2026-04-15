import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader }    from 'three/addons/loaders/GLTFLoader.js';
import { animateBloom, createSparkle, createCompletionRain } from './effects.js';

// ════════════════════════════════════════════════════════════════════════════
// RENDERER
// ════════════════════════════════════════════════════════════════════════════

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.3;
document.body.appendChild(renderer.domElement);

// ════════════════════════════════════════════════════════════════════════════
// SAHNE
// ════════════════════════════════════════════════════════════════════════════

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1a1208);
scene.fog = new THREE.Fog(0x1a1208, 18, 35);

// Işıklar — sıcak ev içi ambiyansı
const ambient = new THREE.AmbientLight(0xfff5dc, 1.2);
scene.add(ambient);

const sun = new THREE.DirectionalLight(0xfff0c8, 1.8);
sun.position.set(8, 12, 6);
sun.castShadow = true;
sun.shadow.mapSize.set(4096, 4096);
sun.shadow.bias = -0.0001;
sun.shadow.normalBias = 0.05;
sun.shadow.camera.near = 0.5;
sun.shadow.camera.far = 50;
sun.shadow.camera.left = sun.shadow.camera.bottom = -12;
sun.shadow.camera.right = sun.shadow.camera.top = 12;
scene.add(sun);

// Sıcak pencere ışığı
const winLight = new THREE.PointLight(0xffd080, 2.5, 12);
winLight.position.set(-4, 5, -2);
scene.add(winLight);

// Mum/lamba ışığı simülasyonu
const lampLight = new THREE.PointLight(0xff9f43, 1.8, 8);
lampLight.position.set(1, 3, 0);
scene.add(lampLight);

// ════════════════════════════════════════════════════════════════════════════
// KAMERA & CONTROLS
// ════════════════════════════════════════════════════════════════════════════

const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 80);
camera.position.set(0, 6, 10);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.07;
controls.minDistance = 2;
controls.maxDistance = 18;
controls.maxPolarAngle = Math.PI / 2.0;
controls.target.set(0, 1, 0);
controls.update();

// ════════════════════════════════════════════════════════════════════════════
// UI
// ════════════════════════════════════════════════════════════════════════════

const loadingEl  = document.getElementById('loading');
const loadBarEl  = document.getElementById('load-bar');
const progressEl = document.getElementById('progress-bar');
const hintEl     = document.getElementById('hint');
const completionOverlay = document.getElementById('completion-overlay');

setTimeout(() => { hintEl.style.opacity = '0'; }, 6000);

// ════════════════════════════════════════════════════════════════════════════
// CLAY MATERYALİ
// ════════════════════════════════════════════════════════════════════════════

const CLAY_COLOR = 0xa8a8a8;

function clayMat() {
  return new THREE.MeshToonMaterial({ color: CLAY_COLOR });
}

// ════════════════════════════════════════════════════════════════════════════
// GLB MODELLER — tanım listesi
// Her obje: { file, name, pos, rot, scale, targetColor }
// targetColor: null → orijinal materyal geri yüklenir
// ════════════════════════════════════════════════════════════════════════════

const MODEL_DEFS = [
  // Oda tabanı
  { file: 'Farmhouse_ROOM_base_v01.glb',       name: 'room',        pos: [0,0,0],       rot: [0,0,0],    scale: 1,    targetColor: null },

  // Mobilyalar
  { file: 'Farmhouse_ROOM_bed_v01.glb',         name: 'bed',         pos: [0,0,0],       rot: [0,0,0],    scale: 1,    targetColor: null },
  { file: 'Farmhouse_ROOM_desk_v01.glb',        name: 'desk',        pos: [0,0,0],       rot: [0,0,0],    scale: 1,    targetColor: null },
  { file: 'Farmhouse_ROOM_shelves01_v01.glb',   name: 'shelves',     pos: [0,0,0],       rot: [0,0,0],    scale: 1,    targetColor: null },
  { file: 'Farmhouse_ROOM_rug_v01.glb',         name: 'rug',         pos: [0,0,0],       rot: [0,0,0],    scale: 1,    targetColor: null },
  { file: 'Farmhouse_ROOM_planks_v01.glb',      name: 'planks',      pos: [0,0,0],       rot: [0,0,0],    scale: 1,    targetColor: null },

  // Pencere / Perde
  { file: 'Farmhouse_ROOM_window_v01.glb',      name: 'window',      pos: [0,0,0],       rot: [0,0,0],    scale: 1,    targetColor: null },
  { file: 'Farmhouse_ROOM_curtains_v01.glb',    name: 'curtains',    pos: [0,0,0],       rot: [0,0,0],    scale: 1,    targetColor: null },

  // Kitaplar / Çerçeve
  { file: 'Farmhouse_ROOM_books_v01.glb',       name: 'books',       pos: [0,0,0],       rot: [0,0,0],    scale: 1,    targetColor: null },
  { file: 'Farmhouse_ROOM_frame_v01.glb',       name: 'frame',       pos: [0,0,0],       rot: [0,0,0],    scale: 1,    targetColor: null },
  { file: 'Farmhouse_ROOM_parchoment_v01.glb',  name: 'parchment',   pos: [0,0,0],       rot: [0,0,0],    scale: 1,    targetColor: null },

  // Bitkiler / Çiçekler
  { file: 'Farmhouse_ROOM_floorplant_v01.glb',  name: 'plant1',      pos: [0,0,0],       rot: [0,0,0],    scale: 1,    targetColor: null },
  { file: 'Farmhouse_ROOM_floorplant_v02.glb',  name: 'plant2',      pos: [0,0,0],       rot: [0,0,0],    scale: 1,    targetColor: null },
  { file: 'Farmhouse_ROOM_flowerpot_v01.glb',   name: 'pot1',        pos: [0,0,0],       rot: [0,0,0],    scale: 1,    targetColor: null },
  { file: 'Farmhouse_ROOM_flowerpot02_v01.glb', name: 'pot2',        pos: [0,0,0],       rot: [0,0,0],    scale: 1,    targetColor: null },
  { file: 'Farmhouse_ROOM_decorateflower_v01.glb', name: 'deco',     pos: [0,0,0],       rot: [0,0,0],    scale: 1,    targetColor: null },
  { file: 'Farmhouse_ROOM_flowerivy_v01.glb',   name: 'ivy1',        pos: [0,0,0],       rot: [0,0,0],    scale: 1,    targetColor: null },
  { file: 'Farmhouse_ROOM_basket_v01.glb',      name: 'basket',      pos: [0,0,0],       rot: [0,0,0],    scale: 1,    targetColor: null },
  { file: 'Farmhouse_ROOM_pot_v01.glb',         name: 'pot3',        pos: [0,0,0],       rot: [0,0,0],    scale: 1,    targetColor: null },

  // Dekoratifler
  { file: 'Farmhouse_ROOM_duck_v01.glb',        name: 'duck',        pos: [0,0,0],       rot: [0,0,0],    scale: 1,    targetColor: null },
  { file: 'Farmhouse_ROOM_kirby_v01.glb',       name: 'kirby',       pos: [0,0,0],       rot: [0,0,0],    scale: 1,    targetColor: null },
  { file: 'Farmhouse_ROOM_wallstones_v01.glb',  name: 'stones',      pos: [0,0,0],       rot: [0,0,0],    scale: 1,    targetColor: null },
  { file: 'Farmhouse_ROOM_woodenstairs_v01.glb', name: 'stairs',     pos: [0,0,0],       rot: [0,0,0],    scale: 1,    targetColor: null },
];

// ════════════════════════════════════════════════════════════════════════════
// YÜKLEME SİSTEMİ
// ════════════════════════════════════════════════════════════════════════════

const loader = new GLTFLoader();
const interactableGroups = []; // animateBloom için gruplar
const allSceneMeshes    = [];  // raycaster için mesh'ler
let aliveCount = 0;
let totalGroups = 0;

const ticks = [];

/**
 * Bir GLB modelini yükler:
 * 1. Her mesh'in orijinal materyalini userData.originalMaterial'e saklar
 * 2. Clay materyali uygular
 * 3. Grubu interactableGroups'a ekler
 */
async function loadModel(def) {
  return new Promise((resolve) => {
    loader.load(
      `/models/${def.file}`,
      (gltf) => {
        const group = gltf.scene;
        group.name = def.name;

        // Pozisyon / rotasyon / scale
        group.position.set(...def.pos);
        group.rotation.set(...def.rot);
        group.scale.setScalar(def.scale);

        // Orijinal materyalleri sakla, clay uygula
        let hasMesh = false;
        group.traverse(node => {
          if (!node.isMesh) return;
          hasMesh = true;
          node.castShadow    = true;
          node.receiveShadow = true;

          // Orijinali sakla (single veya array)
          node.userData.originalMaterial = Array.isArray(node.material)
            ? node.material.map(m => m.clone())
            : node.material.clone();

          // Clay materyali uygula
          node.material = clayMat();

          allSceneMeshes.push(node);
        });

        if (hasMesh) {
          group.userData.interactable = true;
          group.userData.isAlive      = false;
          interactableGroups.push(group);
        }

        scene.add(group);
        resolve(group);
      },
      undefined,
      (err) => {
        console.warn(`[room] GLB yüklenemedi: ${def.file}`, err);
        resolve(null); // hata olsa bile devam et
      }
    );
  });
}

// Modelleri sırayla yükle (paralel açmak RAM'i patlatabilir)
async function loadAll() {
  const total = MODEL_DEFS.length;
  for (let i = 0; i < total; i++) {
    await loadModel(MODEL_DEFS[i]);
    const pct = ((i + 1) / total) * 100;
    loadBarEl.style.width = pct + '%';
  }

  totalGroups = interactableGroups.length;

  // Loading ekranını gizle
  loadingEl.classList.add('hide');
  setTimeout(() => { loadingEl.style.display = 'none'; }, 900);
}

loadAll();

// ════════════════════════════════════════════════════════════════════════════
// RAYCASTER
// ════════════════════════════════════════════════════════════════════════════

const raycaster = new THREE.Raycaster();
const pointer   = new THREE.Vector2();

function findInteractableGroup(mesh) {
  let node = mesh;
  while (node) {
    if (node.userData.interactable) return node;
    node = node.parent;
  }
  return null;
}

window.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;

  pointer.x =  (e.clientX / window.innerWidth)  * 2 - 1;
  pointer.y = -(e.clientY / window.innerHeight) * 2 + 1;

  raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObjects(allSceneMeshes, false);
  if (!hits.length) return;

  const group = findInteractableGroup(hits[0].object);
  if (!group || group.userData.isAlive) return;

  // Sparkle rengi için dominant mesh rengini örnekle
  const sparkleColor = sampleColor(group);

  ticks.push(animateBloom(group, () => {
    aliveCount++;
    progressEl.style.width = ((aliveCount / totalGroups) * 100) + '%';
    if (aliveCount >= totalGroups) onComplete();
  }));

  ticks.push(createSparkle(hits[0].point, sparkleColor, scene));
});

/** Grubun ilk mesh'inden renk örnekle (orijinal materyal) */
function sampleColor(group) {
  let color = 0xffd080;
  group.traverse(node => {
    if (!node.isMesh || color !== 0xffd080) return;
    const orig = node.userData.originalMaterial;
    if (!orig) return;
    const mat = Array.isArray(orig) ? orig[0] : orig;
    if (mat?.color) color = mat.color.getHex();
  });
  return color;
}

function onComplete() {
  setTimeout(() => {
    completionOverlay.classList.add('show');
    ticks.push(createCompletionRain(scene));
  }, 300);
}

// ════════════════════════════════════════════════════════════════════════════
// RESIZE
// ════════════════════════════════════════════════════════════════════════════

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ════════════════════════════════════════════════════════════════════════════
// RENDER LOOP
// ════════════════════════════════════════════════════════════════════════════

const clock = new THREE.Clock();

// Canlanmış gruplara hafif nefes animasyonu
function breatheGroups(elapsed) {
  interactableGroups.forEach(group => {
    if (group.userData.isAlive) {
      group.position.y += Math.sin(elapsed * 1.3 + group.id * 0.8) * 0.00015;
    }
  });
}

function animate() {
  requestAnimationFrame(animate);
  const delta   = Math.min(clock.getDelta(), 0.05);
  const elapsed = clock.elapsedTime;

  controls.update();

  // Mum titremesi
  lampLight.intensity = 1.8 + Math.sin(elapsed * 7.3) * 0.15 + Math.sin(elapsed * 13.1) * 0.07;

  breatheGroups(elapsed);

  for (let i = ticks.length - 1; i >= 0; i--) {
    if (ticks[i](delta)) ticks.splice(i, 1);
  }

  renderer.render(scene, camera);
}

animate();
