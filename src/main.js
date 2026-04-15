import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Island } from './Island.js';
import { DIORAMA_LIST, initDioramas } from './dioramas.js';
import { preloadModels } from './glbCache.js';
import {
  animateBloom, createSparkle, createWaterSplash, createWaterStream,
  createCompletionRain, createShapeshiftEffect,
  createFlightClouds, createStardust,
  createAtmosphere, createBackgroundClouds,
  createMoon, createCozyParticles, createAurora,
  createEmberParticles, createAshEffect, animateBurnDeath
} from './effects.js';
import {
  createComposer, resizeComposer, updateComposerCamera
} from './postprocessing.js';
import { applyCel, applyPBR, CEL_DEFAULTS, PBR_DEFAULTS } from './celShader.js';
import { clayMat } from './dioramas.js';
import { WalkMode } from './walkMode.js';
import { BeachBallSystem } from './beachball.js';
import { createGrassPatch } from './grass.js';
import {
  VOL_DEFAULTS, makeVolMaterial, applyVolumetric, removeVolumetric,
  isVolumetric, updateVolMaterials, meshId,
  saveVolMeshIds, loadVolMeshIds, saveVolParams, loadVolParams,
} from './volumetric.js';
import {
  GLASS_DEFAULTS, WATER_DEFAULTS,
  applyGlass, removeGlass, isGlass, updateGlassMaterials,
  saveGlassMeshIds, loadGlassMeshIds, saveGlassParams, loadGlassParams,
  applyWaterMesh, removeWaterMesh, isWaterMesh, updateWaterMeshMaterials,
  saveWaterMeshIds, loadWaterMeshIds, saveWaterParams, loadWaterParams,
} from './glassWater.js';
import {
  applyFire, removeFire, isFire, updateFireMaterials,
  saveFireMeshIds, loadFireMeshIds, saveFireParams, loadFireParams,
  startBurnTimer, clearBurnTimer, clearAllBurnTimers, updateBurnTimers,
} from './fireShader.js';
import confetti from 'canvas-confetti';


const el = id => document.getElementById(id);

// ─── GLOBAL STATE ───
let phase = 'PLAYING';
let dioramaIndex = 0;
let currentIsland = null;
let nextIsland = null;
const ticks = [];
let grassPickingMode = false;
let isPickingGlass = false;

// ─── PAINT ANIMATION PARAMS ───
export const PAINT_PARAMS = {
  type: 'RADIAL',
  stagger: 45,
  duration: 550,
  jumpScale: 0.12,
};

function savePaintParams() { localStorage.setItem('paint_params', JSON.stringify(PAINT_PARAMS)); }
function loadPaintParams() {
  const s = localStorage.getItem('paint_params');
  if (s) Object.assign(PAINT_PARAMS, JSON.parse(s));
}
loadPaintParams();

// ─── RENDERER SETUP ───
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
// Tone mapping is handled by OutputPass in the composer pipeline.
// Setting it here would apply it a second time during RenderPass → washed-out materials.
renderer.toneMapping = THREE.NoToneMapping;
renderer.toneMappingExposure = 1.1;
renderer.localClippingEnabled = true;
document.body.appendChild(renderer.domElement);

// ─── POST-PROCESSING ──────────────────────────────────────────────────────────
// Composer is created after cameras are ready; placeholder set here, replaced below.
let composer, renderPass, bloomPass, bokehPass, gradingPass;
let dofEnabled = false;
let isNight = false; // Default MORNING

// ─── SAHNE & ATMOSFER ───
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x020a1a);
scene.fog = new THREE.FogExp2(0x0a1128, 0.015);

const atmosphere = createAtmosphere();
scene.add(atmosphere);
const stardust = createStardust();
scene.add(stardust.mesh);
const aurora = createAurora();
aurora.mesh.position.y = 10;
scene.add(aurora.mesh);
aurora.mesh.visible = false;
const bgCloudsTick = createBackgroundClouds(scene);
const centralDust = createCozyParticles(scene);
ticks.push(centralDust);
const moonGroup = createMoon(scene);

// ─── IŞIKLAR ───
const hemiLight = new THREE.HemisphereLight(0x4444ff, 0x020a1a, 0.3);
scene.add(hemiLight);

const sun = new THREE.DirectionalLight(0xa2d2ff, 1.2);
sun.position.set(-15, 20, -15);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.bias = -0.0001;
sun.shadow.normalBias = 0.05;
sun.shadow.radius = 1;
scene.add(sun);
sun.shadow.camera.left = -12;
sun.shadow.camera.right = 12;
sun.shadow.camera.top = 12;
sun.shadow.camera.bottom = -12;
sun.shadow.camera.near = 0.5;
sun.shadow.camera.far = 100;

const rimLight = new THREE.DirectionalLight(0xffffff, 0.8);
rimLight.position.set(-10, 8, -10);
scene.add(rimLight);

const fill = new THREE.DirectionalLight(0x5a189a, 0.4);
fill.position.set(-8, 5, 5);
scene.add(fill);

const ambient = new THREE.AmbientLight(0xffffff, 0.2);
scene.add(ambient);

// ─── KAMERA SİSTEMİ (TEK VE TEMİZ) ───
const perspCamera = new THREE.PerspectiveCamera(35, window.innerWidth / window.innerHeight, 0.1, 150);
perspCamera.position.set(-6, 3.5, 6);

const frustumSize = 4.0;
const aspect = window.innerWidth / window.innerHeight;
const orthoCamera = new THREE.OrthographicCamera(
  (frustumSize * aspect) / -2, (frustumSize * aspect) / 2,
  frustumSize / 2, frustumSize / -2,
  0.1, 1000
);
orthoCamera.position.set(15, 9, 15);
orthoCamera.lookAt(0, 0, 0);

let activeCamera = perspCamera;

// ─── LENS / FOCAL LENGTH SYSTEM ───────────────────────────────────────────────
// Full-frame 35mm sensor, vertical FOV = 2·atan(12 / focalLength_mm)
let currentLensMM = 38; // default — roughly matches original 38° FOV

function mmToFov(mm) {
  return (2 * Math.atan(12 / mm) * 180) / Math.PI;
}
// At 50mm the comfortable viewing distance is ~7 units.
// Scale min/max and nudge camera proportionally when lens changes.
const LENS_REF_MM = 50;
let LENS_REF_DIST = 7; // updated dynamically based on scene bounding box

function setLensMM(mm) {
  const prevMM = currentLensMM;
  currentLensMM = mm;

  perspCamera.fov = mmToFov(mm);
  perspCamera.updateProjectionMatrix();

  // ── Sync Ortho Zoom ──────────────────────────────────────────────────────
  // We want the same framing. Higher focal length = higher zoom.
  // 38mm is our 'neutral' reference for ortho.
  orthoCamera.zoom = mm / 38.0;
  orthoCamera.updateProjectionMatrix();

  // ── Scale OrbitControls distance limits ──────────────────────────────────
  const scale = mm / LENS_REF_MM;
  const idealDist = LENS_REF_DIST * scale;
  controls.minDistance = Math.max(0.3, idealDist * 0.1);
  controls.maxDistance = idealDist * 2.5;

  // ── Nudge camera distance to stay in the valid range ────────────────────
  const dir = perspCamera.position.clone().sub(controls.target).normalize();
  const curDist = perspCamera.position.distanceTo(controls.target);
  const newDist = THREE.MathUtils.clamp(
    curDist * (mm / prevMM),           // scale current distance proportionally
    controls.minDistance,
    controls.maxDistance
  );
  perspCamera.position.copy(controls.target).addScaledVector(dir, newDist);
  controls.update();

  // ── UI sync ──────────────────────────────────────────────────────────────
  if (lensMmDisplay) lensMmDisplay.textContent = mm + 'mm';
  const sl = document.getElementById('lens-slider-el');
  if (sl) sl.value = mm;
  document.querySelectorAll('.lens-preset').forEach(btn => {
    const active = parseInt(btn.dataset.mm) === mm;
    btn.classList.toggle('active', active);
    btn.style.background = active ? '' : 'rgba(255,255,255,0.08)';
  });
}
let lensMmDisplay = null; // set after DOM creation below

const controls = new OrbitControls(activeCamera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.06;

// ── Zoom ─────────────────────────────────────────────────────────────────────
controls.minDistance = 3;
controls.maxDistance = 200;
controls.zoomSpeed = 1.2;

// ── Orbit ────────────────────────────────────────────────────────────────────
controls.rotateSpeed = 0.7;
controls.minPolarAngle = Math.PI / 12;    // can't look straight down
controls.maxPolarAngle = Math.PI / 2.05;  // can't go below island

// ── Pan — middle mouse or right drag ─────────────────────────────────────────
controls.enablePan = true;
controls.panSpeed = 0.6;
controls.screenSpacePanning = true;   // pan parallel to screen (intuitive)

// Mouse button mapping: LEFT=orbit, MIDDLE=dolly→remap to pan, RIGHT=pan
controls.mouseButtons = {
  LEFT: THREE.MOUSE.ROTATE,
  MIDDLE: THREE.MOUSE.PAN,
  RIGHT: THREE.MOUSE.PAN,
};

// Touch: 1-finger rotate, 2-finger pinch-zoom
controls.touches = {
  ONE: THREE.TOUCH.ROTATE,
  TWO: THREE.TOUCH.DOLLY_PAN,
};

controls.target.set(0, 0.5, 0);
controls.update();

// ─── WALK MODE ────────────────────────────────────────────────────────────────
const walkMode = new WalkMode(scene, perspCamera, renderer, controls);
// window.walkMode = walkMode; // expose for devtools (done below after devtools init)

// ─── BEACH BALL SİSTEMİ ──────────────────────────────────────────────────────
const beachBallSystem = new BeachBallSystem(walkMode);

// Init composer now that cameras exist
({ composer, renderPass, bloomPass, bokehPass, gradingPass } = createComposer(renderer, scene, activeCamera));

// ─── SES SİSTEMİ ───
const listener = new THREE.AudioListener();
perspCamera.add(listener);
orthoCamera.add(listener);

const audioLoader = new THREE.AudioLoader();
const ambientBirds = new THREE.Audio(listener);
audioLoader.load('/bird-voices.mp3', (buffer) => {
  ambientBirds.setBuffer(buffer);
  ambientBirds.setLoop(true);
  ambientBirds.setVolume(0.15);
});

const bgmAudio = new Audio('/bgm-mistik.mp3');
bgmAudio.loop = true;
bgmAudio.volume = 0.5;
bgmAudio.muted = true; // Default OFF

// ─── Harmonious Lullaby System ───
const sfxPool = Array.from({ length: 4 }, () => {
  const sfx = new THREE.Audio(listener);
  audioLoader.load('/sfx/kalimba.mp3', (buffer) => {
    sfx.setBuffer(buffer);
    sfx.setVolume(0.4);
  });
  return sfx;
});
let poolIdx = 0;

const PENTATONIC = [1.0, 1.125, 1.25, 1.5, 1.66, 2.0];
const MELODIES = [
  [0, 1, 2, 3, 4, 3, 2, 1], // Simple Ascent/Descent
  [0, 2, 4, 2, 0, 1, 3, 1], // Playful
  [4, 3, 2, 1, 0, 0, 0, 0], // Resolution
  [0, 2, 3, 5, 4, 2, 0]     // Long
];
let selectedMelody = MELODIES[Math.floor(Math.random() * MELODIES.length)];
let melodyIndex = 0;

function playKalimba() {
  const sfx = sfxPool[poolIdx % sfxPool.length];
  if (sfx.buffer) {
    if (sfx.isPlaying) sfx.stop();
    const noteIdx = selectedMelody[melodyIndex % selectedMelody.length];
    const pitch = PENTATONIC[noteIdx % PENTATONIC.length] || 1.0;
    sfx.setPlaybackRate(pitch);
    sfx.play();
    melodyIndex++;
    poolIdx++;

    // Occasionally change melody
    if (melodyIndex % 16 === 0)
      selectedMelody = MELODIES[Math.floor(Math.random() * MELODIES.length)];
  }
}

let audioStarted = false;
function startAudio() {
  if (!audioStarted) {
    if (ambientBirds.buffer) ambientBirds.play();
    bgmAudio.play().catch(e => console.log("BGM Error:", e));
    audioStarted = true;
  }
}

// ─── UI YOLLARI & ETKİLEŞİM ───
const progressBar = document.getElementById('progress-bar');
const islandLabel = document.getElementById('island-label');
const themeSelect = document.getElementById('theme-select');
const cameraBtn = document.getElementById('camera-toggle');
const blurSlider = document.getElementById('blur-slider');
const musicBtn = document.getElementById('music-toggle');
musicBtn.classList.add('muted'); // Visual default
const sfxBtn = document.getElementById('sfx-toggle');
const nextBtn = document.getElementById('next-btn');
if (nextBtn) {
  nextBtn.style.display = 'block'; // Always visible for quick skipping
  nextBtn.textContent = 'SKIP ✦';
  nextBtn.addEventListener('click', () => {
    if (phase === 'PLAYING') startShapeshift();
  });
}

cameraBtn.addEventListener('click', () => {
  if (activeCamera === perspCamera) {
    activeCamera = orthoCamera;
    cameraBtn.classList.add('isometric');
    // lensPanel.style.display = 'none'; // Keep visible to allow zoom control
  } else {
    activeCamera = perspCamera;
    cameraBtn.classList.remove('isometric');
    // lensPanel.style.display = '';
  }
  controls.object = activeCamera;
  controls.update();
  updateComposerCamera({ renderPass, bokehPass }, activeCamera, dofEnabled);
});

// ─── ENVIRONMENT PRESETS ───────────────────────────────────────────────────
const ENV_MODES = ['MORNING', 'NIGHT', 'AURORA', 'SUNSET', 'MIDNIGHT', 'FOGGY', 'CINEMATIC'];
let envIndex = parseInt(localStorage.getItem('current_env_index') || '0');
isNight = false;

const ENV_PRESETS = {
  MORNING: {
    bg: 0x003366, fog: 0x87ceeb, hemi: 0.5,
    sunCol: 0xfff4e0, sunInt: 2.0, fillCol: 0xfff0f0, fillInt: 0.4,
    stardust: false, aurora: false,
    atmoTop: 0x003366, atmoBottom: 0x87ceeb,
    vMoon: false, vSun: true, sunMeshCol: 0xffcc33, glowCol: 0xffcc33, glowMul: 3.0
  },
  NIGHT: {
    bg: 0x002147, fog: 0x011627, hemi: 0.2,
    sunCol: 0xa2d2ff, sunInt: 1.0, fillCol: 0x5a189a, fillInt: 0.3,
    stardust: true, aurora: false,
    atmoTop: 0x011627, atmoBottom: 0x002147,
    vMoon: true, vSun: false, moonMeshCol: 0xfff9e6, glowCol: 0xfff9e6, glowMul: 2.0
  },
  AURORA: {
    bg: 0x010c1e, fog: 0x020814, hemi: 0.25,
    sunCol: 0x80ffb0, sunInt: 1.2, fillCol: 0x3d1b5a, fillInt: 0.4,
    stardust: true, aurora: true,
    atmoTop: 0x04162e, atmoBottom: 0x010c1e,
    vMoon: true, vSun: false, moonMeshCol: 0xe0ffea, glowCol: 0x80ffb0, glowMul: 2.5,
    auroraInt: 1.0, auroraCol1: 0x00ff99, auroraCol2: 0x7c4dff
  },
  SUNSET: {
    bg: 0x4a1820, fog: 0xff7a59, hemi: 0.35,
    sunCol: 0xff5500, sunInt: 1.5, fillCol: 0x8a2be2, fillInt: 0.4,
    stardust: false, aurora: false,
    atmoTop: 0x221144, atmoBottom: 0xff7a59,
    vMoon: false, vSun: true, sunMeshCol: 0xff3300, glowCol: 0xff3300, glowMul: 2.2
  },
  MIDNIGHT: {
    bg: 0x00020a, fog: 0x00020a, hemi: 0.1,
    sunCol: 0x4a6ebf, sunInt: 0.8, fillCol: 0x0a0a2a, fillInt: 0.2,
    stardust: true, aurora: false,
    atmoTop: 0x000000, atmoBottom: 0x00020a,
    vMoon: true, vSun: false, moonMeshCol: 0xbbddff, glowCol: 0x4a6ebf, glowMul: 1.8
  },
  FOGGY: {
    bg: 0x7a8c99, fog: 0xaabbcc, hemi: 0.6,
    sunCol: 0xffffff, sunInt: 0.6, fillCol: 0x667788, fillInt: 0.4,
    stardust: false, aurora: false,
    atmoTop: 0x5a6c79, atmoBottom: 0xaabbcc,
    vMoon: false, vSun: false, sunMeshCol: 0xffffff, glowCol: 0xffffff, glowMul: 0.0
  },
  CINEMATIC: {
    bg: 0x0a111a, fog: 0x152233, hemi: 0.3,
    sunCol: 0xffb86c, sunInt: 2.0, fillCol: 0x0055ff, fillInt: 0.6,
    stardust: false, aurora: false,
    atmoTop: 0x050a10, atmoBottom: 0x152233,
    vMoon: false, vSun: true, sunMeshCol: 0xffa040, glowCol: 0xffa040, glowMul: 2.5
  }
};

function updateAtmosphere() {
  const mode = ENV_MODES[envIndex];
  const p = ENV_PRESETS[mode];
  isNight = mode !== 'MORNING';

  const vMoon = moonGroup?.getObjectByName('VisualMoon');
  const vSun = moonGroup?.getObjectByName('VisualSun');
  const glow = moonGroup?.getObjectByName('CelestialGlow');

  scene.background.set(p.bg);
  if (scene.fog) scene.fog.color.set(p.fog);

  hemiLight.intensity = p.hemi;
  sun.color.set(p.sunCol);
  sun.intensity = p.sunInt;
  fill.color.set(p.fillCol);
  fill.intensity = p.fillInt;

  if (stardust) stardust.mesh.visible = p.stardust;
  if (aurora) {
    aurora.mesh.visible = p.aurora;
    if (p.aurora) {
      aurora.mesh.material.uniforms.uIntensity.value = p.auroraInt;
      aurora.mesh.material.uniforms.uColor1.value.set(p.auroraCol1);
      aurora.mesh.material.uniforms.uColor2.value.set(p.auroraCol2);
    }
  }

  if (atmosphere) {
    atmosphere.material.uniforms.topColor.value.set(p.atmoTop);
    atmosphere.material.uniforms.bottomColor.value.set(p.atmoBottom);
  }

  if (vMoon) {
    vMoon.visible = p.vMoon;
    if (p.vMoon) vMoon.material.color.set(p.moonMeshCol).multiplyScalar(1.5);
  }
  if (vSun) {
    vSun.visible = p.vSun;
    if (p.vSun) vSun.material.color.set(p.sunMeshCol).multiplyScalar(2.5);
  }
  if (glow) {
    glow.material.color.set(p.glowCol).multiplyScalar(p.glowMul);
  }

  // Update button visual state
  if (themeSelect) {
    themeSelect.value = envIndex;
  }

  // Sync water
  currentIsland?.group.userData.waterSetNight?.(isNight);

  // Sync Dev UI if active
  if (typeof _syncDevUI === 'function') _syncDevUI(_captureSnapshot());
}
// updateAtmosphere initialized later



if (themeSelect) {
  themeSelect.addEventListener('change', (e) => {
    envIndex = parseInt(e.target.value);
    localStorage.setItem('current_env_index', envIndex);
    updateAtmosphere();
  });
}
// ─── AUDIO TOGGLES ───
musicBtn.addEventListener('click', () => {
  bgmAudio.muted = !bgmAudio.muted;
  musicBtn.classList.toggle('muted', bgmAudio.muted);
});

sfxBtn.addEventListener('click', () => {
  const sfxMuted = !sfxBtn.classList.contains('muted');
  sfxBtn.classList.toggle('muted', sfxMuted);
  // Control all Three.js sounds via master volume, or individually
  // For simplicity, we use the button state to filter play calls or use master
  // But since Music is HTML Audio and outside master, master volume now only affects SFX
  listener.setMasterVolume(sfxMuted ? 0 : 1);
});

// ─── LENS PANEL ───────────────────────────────────────────────────────────────
const LENS_PRESETS = [8, 18, 24, 35, 50, 70, 130, 180, 300, 450, 600];

const lensPanel = document.createElement('div');
lensPanel.id = 'lens-panel';
lensPanel.style.cssText = `
  position: fixed;
  bottom: 90px;
  left: 50%;
  transform: translateX(-50%);
  background: rgba(5, 5, 12, 0.9); /* Darker, more solid */
  border: 1.5px solid rgba(255,255,255,0.25); /* Stronger border */
  border-radius: 18px;
  padding: 14px 20px 12px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  z-index: 9999;
  backdrop-filter: blur(28px);
  box-shadow: 0 12px 48px rgba(0,0,0,0.7);
  user-select: none;
  min-width: 320px;
`;

// Header row: label + current mm display + slider
const lensHeader = document.createElement('div');
lensHeader.style.cssText = 'display:flex; align-items:center; gap:10px; width:100%;';

const lensLabel = document.createElement('span');
lensLabel.textContent = '⬤ LENS';
lensLabel.style.cssText = 'color:rgba(255,255,255,0.75); font-size:10px; font-weight:900; letter-spacing:0.12em; white-space:nowrap;';

const mmDisplay = document.createElement('span');
mmDisplay.textContent = currentLensMM + 'mm';
mmDisplay.style.cssText = 'color:#fff; font-size:13px; font-weight:700; letter-spacing:0.04em; min-width:52px; text-align:right;';
lensMmDisplay = mmDisplay;

const lensSlider = document.createElement('input');
lensSlider.type = 'range';
lensSlider.id = 'lens-slider-el';
lensSlider.min = 8; lensSlider.max = 600; lensSlider.step = 1;
lensSlider.value = currentLensMM;
lensSlider.style.cssText = 'flex:1; accent-color: rgba(255,255,255,0.7); cursor:pointer;';
lensSlider.addEventListener('input', () => setLensMM(parseInt(lensSlider.value)));

lensHeader.append(lensLabel, lensSlider, mmDisplay);

// Preset buttons row
const presetRow = document.createElement('div');
presetRow.style.cssText = 'display:flex; gap:5px; flex-wrap:wrap; justify-content:center;';

LENS_PRESETS.forEach(mm => {
  const btn = document.createElement('button');
  btn.className = 'lens-preset';
  btn.dataset.mm = mm;
  btn.textContent = mm < 100 ? mm + 'mm' : mm + 'mm';
  btn.style.cssText = `
    background: rgba(255,255,255,0.08);
    border: 1.5px solid rgba(255,255,255,0.2);
    color: rgba(255,255,255,0.7);
    border-radius: 12px;
    padding: 6px 14px;
    font-size: 11px;
    font-weight: 800;
    letter-spacing: 0.1em;
    cursor: pointer;
    transition: all 0.2s;
    backdrop-filter: blur(8px);
  `;
  btn.addEventListener('click', () => {
    setLensMM(mm);
    lensSlider.value = mm;
  });
  btn.addEventListener('mouseenter', () => { if (currentLensMM !== mm) btn.style.background = 'rgba(255,255,255,0.15)'; });
  btn.addEventListener('mouseleave', () => { if (currentLensMM !== mm) btn.style.background = 'rgba(255,255,255,0.08)'; });
  presetRow.appendChild(btn);
});

lensPanel.append(lensHeader, presetRow);
document.body.appendChild(lensPanel);

// Style for active preset
const lensStyle = document.createElement('style');
lensStyle.textContent = `.lens-preset.active { background: rgba(255,255,255,0.5) !important; }`;
document.head.appendChild(lensStyle);

// Set initial FOV to match currentLensMM
perspCamera.fov = mmToFov(currentLensMM);
perspCamera.updateProjectionMatrix();

// ─── DOF TOGGLE BUTTON ────────────────────────────────────────────────────────
const dofBtn = document.createElement('button');
dofBtn.id = 'dof-toggle';
dofBtn.title = 'Depth of Field';
dofBtn.textContent = 'DOF';
dofBtn.style.cssText = `
  background: rgba(255,255,255,0.08);
  border: 1.5px solid rgba(255,255,255,0.18);
  color: rgba(255,255,255,0.55);
  border-radius: 20px;
  padding: 6px 12px;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.05em;
  cursor: pointer;
  transition: all 0.2s;
  backdrop-filter: blur(6px);
`;
dofBtn.addEventListener('mouseenter', () => { if (!dofEnabled) dofBtn.style.color = 'rgba(255,255,255,0.8)'; });
dofBtn.addEventListener('mouseleave', () => { if (!dofEnabled) dofBtn.style.color = 'rgba(255,255,255,0.55)'; });
dofBtn.addEventListener('click', () => {
  dofEnabled = !dofEnabled;
  bokehPass.enabled = dofEnabled;
  dofBtn.style.color = dofEnabled ? '#fff' : 'rgba(255,255,255,0.55)';
  dofBtn.style.background = dofEnabled ? 'rgba(255,255,255,0.22)' : 'rgba(255,255,255,0.08)';
  dofBtn.style.borderColor = dofEnabled ? 'rgba(255,255,255,0.55)' : 'rgba(255,255,255,0.18)';
});

// Insert DOF button into the tools bar (before next-btn)
const toolsBar = document.getElementById('tools-bar');
if (toolsBar && nextBtn) {
  toolsBar.insertBefore(dofBtn, nextBtn);
} else if (toolsBar) {
  toolsBar.appendChild(dofBtn);
}

// ─── CEL / PBR STATE ──────────────────────────────────────────────────────────
const celParams = { ...CEL_DEFAULTS };
const pbrParams = { ...PBR_DEFAULTS };

function applyCelToIsland(island) {
  if (!island) return;
  applyCel(island.group, celParams, pbrParams, clayMat);
}

function applyPBRToIsland(island) {
  if (!island) return;
  applyPBR(island.group, pbrParams);
}

// ─── VOLUMETRIC LIGHT STATE ───────────────────────────────────────────────────
const volParams = loadVolParams();
const volMeshes = new Set(); // Set<THREE.Mesh>
let volPickMode = false;

// Refresh the mesh list UI inside the volumetric panel
function _refreshVolList() {
  const list = document.getElementById('vol-mesh-list');
  if (!list) return;
  list.innerHTML = '';
  if (volMeshes.size === 0) {
    list.innerHTML = '<span style="color:rgba(255,255,255,0.3); font-size:9px;">Henüz seçili mesh yok</span>';
    return;
  }
  for (const mesh of volMeshes) {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex; align-items:center; justify-content:space-between; gap:4px; font-size:9px; color:rgba(255,220,80,0.9);';
    const name = document.createElement('span');
    name.textContent = '💡 ' + (mesh.name || mesh.uuid.slice(0, 8));
    name.style.overflow = 'hidden';
    name.style.textOverflow = 'ellipsis';
    name.style.whiteSpace = 'nowrap';
    const rm = document.createElement('button');
    rm.textContent = '✕';
    rm.style.cssText = 'background:rgba(255,71,87,0.25); border:1px solid rgba(255,71,87,0.5); color:#ff4757; border-radius:4px; padding:1px 6px; cursor:pointer; font-size:9px; flex-shrink:0;';
    rm.onclick = () => {
      removeVolumetric(mesh);
      volMeshes.delete(mesh);
      saveVolMeshIds(volMeshes);
      _refreshVolList();
    };
    row.append(name, rm);
    list.appendChild(row);
  }
}

// Restore saved meshes after island loads (called from jumpToLevel)
function restoreVolMeshes(island) {
  if (!island) return;
  const ids = loadVolMeshIds(dioramaIndex);
  Object.assign(volParams, loadVolParams(dioramaIndex));
  if (!ids.length) return;
  island.group.traverse(n => {
    if (n.isMesh && ids.includes(meshId(n))) {
      applyVolumetric(n, volParams);
      volMeshes.add(n);
    }
  });
  _refreshVolList();
}

// ─── GLASS STATE ──────────────────────────────────────────────────────────────
const glassParams = loadGlassParams();
const glassMeshes = new Set();
let glassPickMode = false;

function _refreshGlassList() {
  const list = document.getElementById('glass-mesh-list');
  if (!list) return;
  list.innerHTML = '';
  if (glassMeshes.size === 0) {
    list.innerHTML = '<span style="color:rgba(255,255,255,0.3); font-size:9px;">Henüz seçili mesh yok</span>';
    return;
  }
  for (const mesh of glassMeshes) {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex; align-items:center; justify-content:space-between; gap:4px; font-size:9px; color:rgba(168,216,240,0.95);';
    const name = document.createElement('span');
    name.textContent = '🪟 ' + (mesh.name || mesh.uuid.slice(0, 8));
    name.style.cssText = 'overflow:hidden; text-overflow:ellipsis; white-space:nowrap;';
    const rm = document.createElement('button');
    rm.textContent = '✕';
    rm.style.cssText = 'background:rgba(255,71,87,0.25); border:1px solid rgba(255,71,87,0.5); color:#ff4757; border-radius:4px; padding:1px 6px; cursor:pointer; font-size:9px; flex-shrink:0;';
    rm.onclick = () => { removeGlass(mesh); glassMeshes.delete(mesh); saveGlassMeshIds(glassMeshes); _refreshGlassList(); };
    row.append(name, rm);
    list.appendChild(row);
  }
}

function restoreGlassMeshes(island) {
  if (!island) return;
  const ids = loadGlassMeshIds(dioramaIndex);
  Object.assign(glassParams, loadGlassParams(dioramaIndex));
  if (!ids.length) return;
  island.group.traverse(n => {
    if (n.isMesh && ids.includes(meshId(n))) {
      applyGlass(n, glassParams);
      glassMeshes.add(n);
    }
  });
  _refreshGlassList();
}

// ─── WATER (MESH) STATE ───────────────────────────────────────────────────────
const waterMeshParams = loadWaterParams();
const waterMeshSet = new Set();
let waterPickMode = false;

function _refreshWaterList() {
  const list = document.getElementById('watermesh-list');
  if (!list) return;
  list.innerHTML = '';
  if (waterMeshSet.size === 0) {
    list.innerHTML = '<span style="color:rgba(255,255,255,0.3); font-size:9px;">Henüz seçili mesh yok</span>';
    return;
  }
  for (const mesh of waterMeshSet) {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex; align-items:center; justify-content:space-between; gap:4px; font-size:9px; color:rgba(91,163,204,0.95);';
    const name = document.createElement('span');
    name.textContent = '💧 ' + (mesh.name || mesh.uuid.slice(0, 8));
    name.style.cssText = 'overflow:hidden; text-overflow:ellipsis; white-space:nowrap;';
    const rm = document.createElement('button');
    rm.textContent = '✕';
    rm.style.cssText = 'background:rgba(255,71,87,0.25); border:1px solid rgba(255,71,87,0.5); color:#ff4757; border-radius:4px; padding:1px 6px; cursor:pointer; font-size:9px; flex-shrink:0;';
    rm.onclick = () => { removeWaterMesh(mesh); waterMeshSet.delete(mesh); saveWaterMeshIds(waterMeshSet); _refreshWaterList(); };
    row.append(name, rm);
    list.appendChild(row);
  }
}

function restoreWaterMeshes(island) {
  if (!island) return;
  const ids = loadWaterMeshIds(dioramaIndex);
  Object.assign(waterMeshParams, loadWaterParams(dioramaIndex));
  if (!ids.length) return;
  island.group.traverse(n => {
    if (n.isMesh && ids.includes(meshId(n))) {
      applyWaterMesh(n, waterMeshParams);
      waterMeshSet.add(n);
    }
  });
  _refreshWaterList();
}

// ─── FIRE STATE ───────────────────────────────────────────────────────────────
const fireParams = loadFireParams();
const fireMeshSet = new Set();
let fireRepositionMode = false;
let fireRepositionTarget = null; // the fire group being repositioned

// Reposition overlay UI
const _fireRepoOverlay = document.createElement('div');
_fireRepoOverlay.style.cssText = `
  position:fixed; top:60px; left:50%; transform:translateX(-50%);
  background:rgba(255,90,0,0.85); color:#fff; padding:10px 24px;
  border-radius:14px; font-size:12px; font-weight:800;
  letter-spacing:0.06em; pointer-events:none; display:none; z-index:15002;
  backdrop-filter:blur(10px); border:1px solid rgba(255,200,80,0.5);
  box-shadow:0 0 20px rgba(255,90,0,0.5);
  text-align:center;
`;
_fireRepoOverlay.innerHTML = '🔥 FIRE REPOSITION<br><span style="font-size:10px;font-weight:600;opacity:0.85;">Arrow Keys: Taşı &nbsp;|&nbsp; Space: Yukarı &nbsp;|&nbsp; Ctrl: Aşağı &nbsp;|&nbsp; R: Bitir</span>';
document.body.appendChild(_fireRepoOverlay);

function restoreFireMeshes(island) {
  if (!island) return;
  const ids = loadFireMeshIds(dioramaIndex);
  Object.assign(fireParams, loadFireParams(dioramaIndex));
  if (!ids.length) return;
  const now = clock?.elapsedTime ?? 0;
  island.group.traverse(n => {
    if (n.isMesh && ids.includes(meshId(n))) {
      applyFire(n, fireParams);
      fireMeshSet.add(n);
      startBurnTimer(n, now); // Burn countdown resumes
    }
  });
}


// ─── UNDO / REDO HISTORY ──────────────────────────────────────────────────────
const _history = [];
let _histIdx = -1;
const HIST_MAX = 40;

function _captureSnapshot() {
  return {
    cel: { ...celParams },
    atmoBottom: atmosphere?.material.uniforms.bottomColor.value.getHexString() ?? null,
    atmoTop: atmosphere?.material.uniforms.topColor.value.getHexString() ?? null,
    fogCol: scene.fog ? scene.fog.color.getHexString() : null,
    sunInt: sun.intensity,
    sunCol: sun.color.getHexString(),
    sunX: sun.position.x, sunY: sun.position.y, sunZ: sun.position.z,
    rimInt: rimLight.intensity, rimCol: rimLight.color.getHexString(),
    fillInt: fill.intensity, fillCol: fill.color.getHexString(),
    celScale: (() => { const v = moonGroup?.getObjectByName('VisualSun'); return v ? v.scale.x : 1; })(),
    dofEnabled,
    dofFocus: bokehPass?.uniforms.focus.value ?? 7.5,
    dofAperture: bokehPass?.uniforms.aperture.value ?? 0.006,
    dofMaxblur: bokehPass?.uniforms.maxblur.value ?? 0.012,
    bloomStr: bloomPass?.strength ?? 0.35,
    bloomThr: bloomPass?.threshold ?? 0.85,
    pbr: { ...pbrParams },
    auroraInt: aurora?.mesh.material.uniforms.uIntensity.value ?? 1.0,
    auroraCol1: aurora?.mesh.material.uniforms.uColor1.value.getHexString() ?? '00ff99',
    auroraCol2: aurora?.mesh.material.uniforms.uColor2.value.getHexString() ?? '7c4dff',
  };
}

/** Call before any user-driven change to push current state onto stack. */
function histPush() {
  // Drop redo future
  if (_histIdx < _history.length - 1) _history.splice(_histIdx + 1);
  _history.push(_captureSnapshot());
  if (_history.length > HIST_MAX) _history.shift();
  _histIdx = _history.length - 1;
}

function _applySnapshot(snap) {
  // Cel
  Object.assign(celParams, snap.cel);
  applyCelToIsland(currentIsland);

  // Atmosphere
  if (snap.atmoBottom && atmosphere) {
    atmosphere.material.uniforms.bottomColor.value.set('#' + snap.atmoBottom);
    scene.background.set('#' + snap.atmoBottom);
  }
  if (snap.atmoTop && atmosphere)
    atmosphere.material.uniforms.topColor.value.set('#' + snap.atmoTop);
  if (snap.fogCol && scene.fog)
    scene.fog.color.set('#' + snap.fogCol);

  // Lights
  sun.intensity = snap.sunInt;
  sun.color.set('#' + snap.sunCol);
  sun.position.set(snap.sunX, snap.sunY, snap.sunZ);
  rimLight.intensity = snap.rimInt;
  rimLight.color.set('#' + snap.rimCol);
  fill.intensity = snap.fillInt;
  fill.color.set('#' + snap.fillCol);

  // Celestial size
  if (moonGroup) {
    ['VisualMoon', 'VisualSun', 'CelestialGlow'].forEach(n => {
      const o = moonGroup.getObjectByName(n); if (o) o.scale.setScalar(snap.celScale);
    });
  }

  // DOF / Bloom
  if (bokehPass) {
    dofEnabled = snap.dofEnabled;
    bokehPass.enabled = dofEnabled;
    bokehPass.uniforms.focus.value = snap.dofFocus;
    bokehPass.uniforms.aperture.value = snap.dofAperture;
    bokehPass.uniforms.maxblur.value = snap.dofMaxblur;
  }
  if (bloomPass) {
    bloomPass.strength = snap.bloomStr;
    bloomPass.threshold = snap.bloomThr;
  }

  // PBR
  if (snap.pbr) {
    Object.assign(pbrParams, snap.pbr);
    if (!celParams.enabled) applyPBRToIsland(currentIsland);
  }

  // Aurora
  if (aurora) {
    aurora.mesh.material.uniforms.uIntensity.value = snap.auroraInt;
    aurora.mesh.material.uniforms.uColor1.value.set('#' + snap.auroraCol1);
    aurora.mesh.material.uniforms.uColor2.value.set('#' + snap.auroraCol2);
  }

  // Sync dev-tools UI if open
  _syncDevUI(snap);
}

function _syncDevUI(snap) {
  const el = id => document.getElementById(id);
  const getEl = id => el(id);
  if (!getEl('p-bottom')) return; // panel not yet in DOM

  if (snap.atmoBottom) getEl('p-bottom').value = '#' + snap.atmoBottom;
  if (snap.atmoTop) getEl('p-top').value = '#' + snap.atmoTop;
  if (snap.fogCol) getEl('p-fog').value = '#' + snap.fogCol;
  getEl('s-int').value = snap.sunInt;
  getEl('s-col').value = '#' + snap.sunCol;
  getEl('s-posX').value = snap.sunX;
  getEl('s-posY').value = snap.sunY;
  getEl('s-posZ').value = snap.sunZ;
  getEl('r-int').value = snap.rimInt;
  getEl('r-col').value = '#' + snap.rimCol;
  getEl('f-int').value = snap.fillInt;
  getEl('f-col').value = '#' + snap.fillCol;
  if (getEl('s-size')) getEl('s-size').value = snap.celScale;

  // DOF
  const setBtn = (btn, on) => { if (!btn) return; btn.textContent = on ? 'ON' : 'OFF'; btn.style.background = on ? 'rgba(100,220,120,0.35)' : 'rgba(255,255,255,0.1)'; };
  setBtn(getEl('d-toggle'), snap.dofEnabled);
  if (getEl('d-focus')) { getEl('d-focus').value = snap.dofFocus; getEl('d-focus-val').textContent = snap.dofFocus.toFixed(1); }
  if (getEl('d-aperture')) { getEl('d-aperture').value = snap.dofAperture; getEl('d-aperture-val').textContent = snap.dofAperture.toFixed(3); }
  if (getEl('d-maxblur')) { getEl('d-maxblur').value = snap.dofMaxblur; getEl('d-maxblur-val').textContent = snap.dofMaxblur.toFixed(3); }
  if (getEl('b-strength')) { getEl('b-strength').value = snap.bloomStr; getEl('b-strength-val').textContent = snap.bloomStr.toFixed(2); }
  if (getEl('b-threshold')) { getEl('b-threshold').value = snap.bloomThr; getEl('b-threshold-val').textContent = snap.bloomThr.toFixed(2); }

  // Cel
  setBtn(getEl('cel-toggle'), snap.cel.enabled);
  setBtn(getEl('cel-origcol'), snap.cel.useOriginalColors);
  setBtn(getEl('cel-outline-toggle'), snap.cel.outlineEnabled);
  if (getEl('cel-steps')) { getEl('cel-steps').value = snap.cel.steps; getEl('cel-steps-val').textContent = snap.cel.steps; }
  if (getEl('cel-thick')) { getEl('cel-thick').value = snap.cel.outlineThickness; getEl('cel-thick-val').textContent = snap.cel.outlineThickness.toFixed(3); }
  if (getEl('cel-outline-color')) getEl('cel-outline-color').value = snap.cel.outlineColor;
  if (getEl('cel-bright')) { getEl('cel-bright').value = snap.cel.brightness; getEl('cel-bright-val').textContent = snap.cel.brightness.toFixed(2); }
  if (getEl('cel-sat')) { getEl('cel-sat').value = snap.cel.saturation; getEl('cel-sat-val').textContent = snap.cel.saturation.toFixed(2); }

  // PBR
  if (snap.pbr) {
    if (getEl('pbr-rough')) { getEl('pbr-rough').value = snap.pbr.roughnessMult; getEl('pbr-rough-val').textContent = snap.pbr.roughnessMult.toFixed(2); }
    if (getEl('pbr-metal')) { getEl('pbr-metal').value = snap.pbr.metalnessMult; getEl('pbr-metal-val').textContent = snap.pbr.metalnessMult.toFixed(2); }
    if (getEl('pbr-emissive')) { getEl('pbr-emissive').value = snap.pbr.emissiveAdd; getEl('pbr-emissive-val').textContent = snap.pbr.emissiveAdd.toFixed(2); }
    if (getEl('pbr-tint-color')) getEl('pbr-tint-color').value = snap.pbr.colorTint;
    if (getEl('pbr-tint')) { getEl('pbr-tint').value = snap.pbr.tintStrength; getEl('pbr-tint-val').textContent = snap.pbr.tintStrength.toFixed(2); }
  }

  // Aurora
  if (getEl('au-int')) {
    getEl('au-int').value = snap.auroraInt;
    getEl('au-int-val').textContent = snap.auroraInt.toFixed(1);
    getEl('au-col1').value = '#' + snap.auroraCol1;
    getEl('au-col2').value = '#' + snap.auroraCol2;
  }
}

window.addEventListener('keydown', (e) => {
  const isZ = e.key === 'z' || e.key === 'Z';
  if (!isZ || (!e.ctrlKey && !e.metaKey)) return;
  e.preventDefault();
  if (e.shiftKey) {
    // Redo
    if (_histIdx < _history.length - 1) { _histIdx++; _applySnapshot(_history[_histIdx]); }
  } else {
    // Undo — push current state first if we're at tip
    if (_histIdx === _history.length - 1 && _history.length > 0) {
      // make sure tip is current (might not have been pushed yet)
    }
    if (_histIdx > 0) { _histIdx--; _applySnapshot(_history[_histIdx]); }
  }
});

// ─── OYUN MANTIĞI & LEVEL YÜKLEME ───
function setProgress(ratio) { if (progressBar) progressBar.style.width = (ratio * 100) + '%'; }
function setIslandLabel(name, index, total) { if (islandLabel) islandLabel.textContent = `✦ ${name}  ${index}/${total}`; }

function fitCameraToIsland(island) {
  if (!island?.group) return;
  // Exclude the ground plane — it's radius 200 and skews the bounding box
  const box = new THREE.Box3();
  island.group.traverse(obj => {
    if (obj === island.groundMesh) return;
    if (obj.isMesh && obj.geometry) {
      const meshBox = new THREE.Box3().setFromObject(obj);
      box.union(meshBox);
    }
  });
  if (box.isEmpty()) return;
  const size = box.getSize(new THREE.Vector3());
  const diagonal = Math.sqrt(size.x * size.x + size.y * size.y + size.z * size.z);
  // comfortable viewing distance = ~half the diagonal
  LENS_REF_DIST = Math.max(1, diagonal * 0.5);
  setLensMM(currentLensMM);
}

function loadIsland(index) {
  const def = DIORAMA_LIST[index % DIORAMA_LIST.length];
  const island = new Island(def, scene);
  if (def.scale) island.group.scale.setScalar(def.scale);

  // Apply current ground visibility
  if (island.groundMesh) {
    island.groundMesh.visible = GRASS_PARAMS.groundVisible;
  }

  setIslandLabel(def.name, index + 1, DIORAMA_LIST.length);
  setProgress(0);
  return island;
}

function initLevelSelector() {
  const container = document.getElementById('level-selector');
  if (!container) return;
  container.innerHTML = '';
  DIORAMA_LIST.forEach((def, i) => {
    const item = document.createElement('div');
    item.className = 'level-item';
    if (i === dioramaIndex) item.classList.add('active');
    item.textContent = i + 1;
    item.onclick = (e) => {
      e.stopPropagation();
      jumpToLevel(i);
    };
    container.appendChild(item);
  });
}

function updateLevelSelector() {
  const items = document.querySelectorAll('.level-item');
  items.forEach((item, i) => {
    item.classList.toggle('active', i === dioramaIndex);
  });
}

async function jumpToLevel(index) {
  const def = DIORAMA_LIST[index % DIORAMA_LIST.length];
  if (!def) return;

  // Show a simple loading state?
  if (progressBar) progressBar.style.width = '0%';
  if (islandLabel) islandLabel.textContent = `✦ LOADING ${def.name}...`;

  await preloadModels(def.files);

  dioramaIndex = index;
  currentIsland?.dispose();
  // Clear effect meshes from old island
  volMeshes.forEach(m => removeVolumetric(m)); volMeshes.clear();
  glassMeshes.forEach(m => removeGlass(m)); glassMeshes.clear();
  waterMeshSet.forEach(m => removeWaterMesh(m)); waterMeshSet.clear();
  clearAllBurnTimers(); // Clear burn timers before removing fire
  fireMeshSet.forEach(m => removeFire(m)); fireMeshSet.clear();

  currentIsland = loadIsland(dioramaIndex);
  applyCelToIsland(currentIsland);
  fitCameraToIsland(currentIsland);
  updateLevelSelector();
  if (typeof window.loadGrassSettings === 'function') window.loadGrassSettings(dioramaIndex);
  restoreVolMeshes(currentIsland);
  restoreGlassMeshes(currentIsland);
  restoreWaterMeshes(currentIsland);
  restoreFireMeshes(currentIsland);
  if (typeof window.loadSaved === 'function') setTimeout(window.loadSaved, 100);

  if (nextBtn) {
    nextBtn.textContent = 'SKIP ✦';
    nextBtn.classList.remove('ready');
  }
  const ov = document.getElementById('completion-overlay');
  if (ov) ov.classList.remove('show');
  phase = 'PLAYING';
  controls.enabled = true;

  // Ensure WalkMode caches are populated
  refreshWalkModeMeshes();

  // ── BeachBall sistemi: level değişince bir kez init et ────────────────────
  {
    const ballGroups      = [];
    const sheepballGroups = [];
    let   fieldGroup      = null;
    currentIsland.group.traverse(n => {
      if (n.userData.isBall)      ballGroups.push(n);
      if (n.userData.isSheepball) sheepballGroups.push(n);
      if (n.userData.isField && !fieldGroup) fieldGroup = n;
    });
    beachBallSystem.initLevel(ballGroups, fieldGroup, sheepballGroups);
  }
}

fetch('/models/manifest.json')
  .then(r => r.json())
  .then(async (manifest) => {
    initDioramas(manifest);
    initLevelSelector();
    if (DIORAMA_LIST.length > 0) {
      await jumpToLevel(0);
    }
  });

// ─── ETKİLEŞİM (CLICK) ───
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();

window.addEventListener('pointerdown', (e) => {
  startAudio();
  if (e.target.closest('#tools-bar') || e.target.closest('#hud') || e.target.closest('#level-selector') || e.target.closest('#dev-tools-container') || phase !== 'PLAYING') return;

  // 3rd person uses E key to interact (unless paint mode is on)
  if (walkMode.mode === 'third' && document.pointerLockElement && !walkMode.paintMode) return;

  // In 1st person walk mode with pointer locked, raycast from screen center
  if (walkMode.mode === 'first' && document.pointerLockElement) {
    pointer.set(0, 0);
  } else {
    pointer.x = (e.clientX / window.innerWidth) * 2 - 1;
    pointer.y = -(e.clientY / window.innerHeight) * 2 + 1;
  }
  raycaster.setFromCamera(pointer, activeCamera);

  const meshes = [];
  currentIsland?.group.traverse(n => { if (n.isMesh) meshes.push(n); });
  const hits = raycaster.intersectObjects(meshes, false);

  // ── Pick modes ──────────────────────────────────────────────────────────────
  const anyPickMode = volPickMode || glassPickMode || waterPickMode;
  if (anyPickMode && hits.length > 0) {
    const mesh = hits[0].object;
    if (volPickMode) {
      if (isVolumetric(mesh)) { removeVolumetric(mesh); volMeshes.delete(mesh); }
      else { applyVolumetric(mesh, volParams); volMeshes.add(mesh); }
      saveVolMeshIds(volMeshes, dioramaIndex); _refreshVolList();
    } else if (glassPickMode) {
      if (isGlass(mesh)) { removeGlass(mesh); glassMeshes.delete(mesh); }
      else { applyGlass(mesh, glassParams); glassMeshes.add(mesh); }
      saveGlassMeshIds(glassMeshes, dioramaIndex); _refreshGlassList();
    } else if (waterPickMode) {
      if (isWaterMesh(mesh)) { removeWaterMesh(mesh); waterMeshSet.delete(mesh); }
      else { applyWaterMesh(mesh, waterMeshParams); waterMeshSet.add(mesh); }
      saveWaterMeshIds(waterMeshSet, dioramaIndex); _refreshWaterList();
    } else if (grassPickingMode && hits.length > 0) {
      const mesh = hits[0].object;
      const name = mesh.name;
      if (GRASS_PARAMS.hostMeshNames.includes(name)) {
        GRASS_PARAMS.hostMeshNames = GRASS_PARAMS.hostMeshNames.filter(n => n !== name);
      } else {
        GRASS_PARAMS.hostMeshNames.push(name);
      }

      if (el('grass-pick-btn')) el('grass-pick-btn').textContent = `🎯 PICK SURFACE (${GRASS_PARAMS.hostMeshNames.length})`;
      const hosts = [];
      GRASS_PARAMS.hostMeshNames.forEach(n => {
        currentIsland.group.traverse(obj => { if (obj.name === n && obj.isMesh) hosts.push(obj); });
      });
      grassPatch.rebuild({ surfaceMeshes: hosts });
    }
    return;
  }

  // Optimization: Use cached paint meshes instead of per-click traversal
  const iHits = raycaster.intersectObjects(cachedPaintMeshes, false);
  if (isPickingGlass && hits.length > 0) {
    if (typeof toggleGlassMesh === 'function') toggleGlassMesh(hits[0].object);
    return;
  }
  if (iHits.length > 0) {
    let group = iHits[0].object;
    while (group && !group.userData.interactable) group = group.parent;
    if (group && !group.userData.isAlive) {
      group.userData.isAlive = true;
      playKalimba();
      ticks.push(animateBloom(group, () => {
        currentIsland.aliveCount++;
        setProgress(currentIsland.aliveCount / currentIsland.totalInteractable);

        if (celParams.enabled) applyCelToIsland(currentIsland);
        else if (Object.values(pbrParams).some((v, i) => v !== Object.values(PBR_DEFAULTS)[i]))
          applyPBRToIsland(currentIsland);

        if (currentIsland.isComplete) {
          onLevelComplete();
        }
        refreshWalkModeMeshes();
      }, iHits[0].point, PAINT_PARAMS));
      refreshWalkModeMeshes();
      ticks.push(createSparkle(iHits[0].point, 0xffffff, scene));
    }
  }
});

// ─── LIVE SYNC / HOT RELOAD ──────────────────────────────────────────────────
const syncLogic = async () => {
  console.log("🔄 Live Refresh Triggered...");
  const btn = el('sync-btn');
  if (btn) btn.style.background = 'rgba(168,237,234,0.4)';
  
  try {
    const r = await fetch('/models/manifest.json?t=' + Date.now());
    const manifest = await r.json();
    initDioramas(manifest);
    console.log("Manifest reloaded. Re-loading level...");
    await jumpToLevel(dioramaIndex);
    if (btn) btn.style.background = 'rgba(255,255,255,0.06)';
  } catch (err) {
    console.warn("Sync failed:", err);
    if (btn) btn.style.background = 'rgba(255,100,100,0.3)';
    setTimeout(() => { if(btn) btn.style.background = 'rgba(255,255,255,0.06)'; }, 1000);
  }
};

window.addEventListener('keydown', (e) => {
  if (e.key.toLowerCase() === 'l' && !e.ctrlKey && !e.metaKey && !e.altKey) {
    syncLogic();
  }
});

const syncBtn = el('sync-btn');
if (syncBtn) syncBtn.onclick = syncLogic;

// ── Pick modes ──────────────────────────────────────────────────────────────

// Cache for performance
let cachedAllMeshes = [];
let cachedPaintMeshes = [];

function refreshWalkModeMeshes() {
  if (!currentIsland) return;
  cachedAllMeshes = [];
  cachedPaintMeshes = [];
  currentIsland.group.traverse(n => {
    if (n.isMesh) {
      cachedAllMeshes.push(n);
      let _p = n.parent;
      while (_p && !_p.userData?.interactable) _p = _p.parent;
      if (_p?.userData?.interactable) cachedPaintMeshes.push(n);
    }
  });
  walkMode.setFloorMeshes(cachedAllMeshes);
  walkMode.setPaintTargets(cachedPaintMeshes);
  walkMode._islandCenterX = currentIsland.group.position.x;
  walkMode._islandCenterZ = currentIsland.group.position.z;
}

function onLevelComplete() {
  if (currentIsland._confettiDone) return;
  currentIsland._confettiDone = true;

  if (nextBtn) {
    nextBtn.style.display = 'block';
    nextBtn.textContent = 'NEXT ✦';
    nextBtn.classList.add('ready');
  }

  const ov = document.getElementById('completion-overlay');
  if (ov) ov.classList.add('show');

  // Visual burst
  const duration = 4 * 1000;
  const animationEnd = Date.now() + duration;
  const defaults = { startVelocity: 35, spread: 360, ticks: 60, zIndex: 0, scalar: 1.5 };

  function randomInRange(min, max) {
    return Math.random() * (max - min) + min;
  }

  const interval = setInterval(function () {
    const timeLeft = animationEnd - Date.now();

    if (timeLeft <= 0) {
      return clearInterval(interval);
    }

    const particleCount = 70 * (timeLeft / duration);
    confetti({ ...defaults, particleCount, origin: { x: randomInRange(0.1, 0.3), y: Math.random() - 0.2 } });
    confetti({ ...defaults, particleCount, origin: { x: randomInRange(0.7, 0.9), y: Math.random() - 0.2 } });
  }, 150);

  // Big center burst
  confetti({
    particleCount: 250,
    spread: 90,
    origin: { y: 0.6 },
    scalar: 2.0,
    colors: ['#a8edea', '#fed6e3', '#ffd700']
  });
}

function startShapeshift() {
  phase = 'SHAPESHIFTING';
  controls.enabled = false;
  ticks.push(createCompletionRain(scene));
  const shapeshiftCtrl = createShapeshiftEffect(currentIsland, scene);
  ticks.push((delta) => {
    const done = shapeshiftCtrl.tick(delta);
    if (done) startFlight(shapeshiftCtrl.spirit);
    return done;
  });
}

async function startFlight(spiritRef) {
  phase = 'FLYING';
  const oldIndex = dioramaIndex;
  dioramaIndex++;
  updateLevelSelector();

  const nextDef = DIORAMA_LIST[dioramaIndex % DIORAMA_LIST.length];

  // Update UI to show we are loading
  if (islandLabel) islandLabel.textContent = `✦ FLYING TO: ${nextDef.name}...`;

  // Start preloading and animation concurrently
  const preloadPromise = preloadModels(nextDef.files, (ratio) => {
    setProgress(ratio);
  });

  // Animate spirit into camera
  let spiritDone = false;
  if (spiritRef) {
    const flightTicker = (delta) => {
      spiritRef.position.z += 25 * delta;
      spiritRef.position.y += 2 * delta;
      spiritRef.scale.setScalar(spiritRef.scale.x + 5 * delta);
      if (spiritRef.position.z > 15) {
        spiritDone = true;
        return true;
      }
      return false;
    };
    ticks.push(flightTicker);
  } else {
    spiritDone = true;
  }

  // Wait for assets and a bit of animation time
  await Promise.all([
    preloadPromise,
    new Promise(res => {
      const check = () => { if (spiritDone) res(); else setTimeout(check, 100); };
      check();
    })
  ]);

  // Once loaded, swap islands
  currentIsland?.dispose();
  if (spiritRef) scene.remove(spiritRef);

  currentIsland = loadIsland(dioramaIndex);
  currentIsland.setPosition(0, 0, 0);
  applyCelToIsland(currentIsland);
  fitCameraToIsland(currentIsland);

  // Optimization: Pre-cache meshes once after load
  refreshWalkModeMeshes();

  phase = 'PLAYING';
  controls.enabled = true;
  if (nextBtn) {
    nextBtn.textContent = 'SKIP ✦';
    nextBtn.classList.remove('ready');
  }
  const ov = document.getElementById('completion-overlay');
  if (ov) ov.classList.remove('show');
}

window.addEventListener('resize', () => {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w, h);
  resizeComposer(composer, w, h);
  perspCamera.aspect = w / h;
  perspCamera.updateProjectionMatrix();
  const aspect = w / h;
  orthoCamera.left = (frustumSize * aspect) / -2;
  orthoCamera.right = (frustumSize * aspect) / 2;
  orthoCamera.top = frustumSize / 2;
  orthoCamera.bottom = frustumSize / -2;
  orthoCamera.updateProjectionMatrix();
});

const clock = new THREE.Clock();
function animate() {
  requestAnimationFrame(animate);
  const delta = Math.min(clock.getDelta(), 0.05);
  const elapsed = clock.elapsedTime;

  currentIsland?.update(elapsed);
  nextIsland?.update(elapsed);
  grassPatch?.update(delta);

  // Feed island meshes only when island changes (moved to refreshWalkModeMeshes)
  // Logic removed from here to prevent per-frame traversal overhead
  walkMode.update(delta);
  beachBallSystem.update(delta);

  // ── 3rd-person E-key interact ──────────────────────────────────────────────
  if (phase === 'PLAYING') {
    const interactGroup = walkMode.consumeInteract();
    // Skip normal paint interaction when E was consumed by the ball system
    if (interactGroup && (interactGroup.userData.isBall || interactGroup.userData.isSheepball)) { /* ball/sheepball handles its own E */ }
    else if (interactGroup && !interactGroup.userData.isAlive) {
      interactGroup.userData.isAlive = true;
      playKalimba();

      const wp = walkMode.getCharacterPosition();
      ticks.push(animateBloom(interactGroup, () => {
        currentIsland.aliveCount++;
        setProgress(currentIsland.aliveCount / currentIsland.totalInteractable);
        if (celParams.enabled) applyCelToIsland(currentIsland);
        else if (Object.values(pbrParams).some((v, i) => v !== Object.values(PBR_DEFAULTS)[i]))
          applyPBRToIsland(currentIsland);
        if (currentIsland.isComplete) {
          onLevelComplete();
        }
        refreshWalkModeMeshes();
      }, wp, PAINT_PARAMS));

      // Immediate sync for split meshes
      refreshWalkModeMeshes();

      ticks.push(createSparkle(wp, 0xffd166, scene));
    }

    // ── 3rd-person F-key Fire Ignite ───────────────────────────────────────────
    const fireGroup = walkMode.consumeFire();
    if (fireGroup) {
      // Check if already has fire (skip if so)
      let hasFire = false;
      fireGroup.traverse(n => {
        if (n.isMesh && isFire(n)) hasFire = true;
      });

      if (!hasFire) {
        playKalimba();

        // Only apply to the first valid mesh
        let applied = false;
        fireGroup.traverse(n => {
          if (n.isMesh && !applied) {
            applyFire(n, fireParams);
            fireMeshSet.add(n);
            startBurnTimer(n, elapsed); // Start burn countdown
            applied = true;
          }
        });

        const wp = walkMode.getCharacterPosition();
        ticks.push(createSparkle(wp, 0xff5a00, scene));
      }

      saveFireMeshIds(fireMeshSet, dioramaIndex);
      refreshWalkModeMeshes();
    }

    // ── G-key Fire Remove ─────────────────────────────────────────────────────
    const removeGroup = walkMode.consumeFireRemove();
    if (removeGroup) {
      // Collect fire positions for splash effect before removing
      const splashPositions = [];
      removeGroup.traverse(n => {
        if (n.isMesh && isFire(n)) {
          const fireGrp = n.children.find(c => c.name === 'fireGroup_ext');
          if (fireGrp) {
            const wp = new THREE.Vector3();
            fireGrp.getWorldPosition(wp);
            splashPositions.push(wp);
          }
          clearBurnTimer(n); // Stop burn & restore material
          removeFire(n);
          fireMeshSet.delete(n);
        }
      });

      // Karakterden ateşe doğru su fışkırması
      const charWorldPos = new THREE.Vector3();
      walkMode.character.getWorldPosition(charWorldPos);
      charWorldPos.y += 0.8; // karakterin göğüs/el hizası

      for (const sp of splashPositions) {
        ticks.push(createWaterStream(charWorldPos, sp, scene));
      }

      saveFireMeshIds(fireMeshSet, dioramaIndex);
      refreshWalkModeMeshes();
    }

    // ── R-key Fire Reposition toggle ──────────────────────────────────────────
    const repoGroup = walkMode.consumeFireReposition();
    if (repoGroup) {
      // Find the fire group inside this mesh group
      let foundFireMesh = null;
      repoGroup.traverse(n => {
        if (n.isMesh && isFire(n) && !foundFireMesh) foundFireMesh = n;
      });

      if (foundFireMesh) {
        if (fireRepositionMode && fireRepositionTarget === foundFireMesh) {
          // Exit reposition mode (pressing R again on same fire)
          fireRepositionMode = false;
          fireRepositionTarget = null;
          _fireRepoOverlay.style.display = 'none';
          saveFireMeshIds(fireMeshSet, dioramaIndex);
        } else {
          // Enter reposition mode
          fireRepositionMode = true;
          fireRepositionTarget = foundFireMesh;
          _fireRepoOverlay.style.display = 'block';
        }
      }
    }

    // ── Arrow key nudging for fire reposition ────────────────────────────────
    if (fireRepositionMode && fireRepositionTarget) {
      const fireGrp = fireRepositionTarget.children.find(c => c.name === 'fireGroup_ext');
      if (fireGrp) {
        const speed = 2.0 * delta;
        const arrows = walkMode.getArrowKeys();
        if (arrows.left)     fireGrp.position.x -= speed;
        if (arrows.right)    fireGrp.position.x += speed;
        if (arrows.up)       fireGrp.position.z -= speed;
        if (arrows.down)     fireGrp.position.z += speed;
        if (arrows.pageUp)   fireGrp.position.y += speed;
        if (arrows.pageDown) fireGrp.position.y -= speed;
      }
    }
  }

  bgCloudsTick(delta, elapsed, activeCamera);
  stardust?.tick(delta, elapsed);
  aurora?.tick(delta, elapsed);
  if (volMeshes.size > 0) updateVolMaterials(volMeshes, volParams, elapsed);
  if (glassMeshes.size > 0) updateGlassMaterials(glassMeshes, glassParams);
  if (waterMeshSet.size > 0) updateWaterMeshMaterials(waterMeshSet, waterMeshParams, elapsed);
  if (fireMeshSet.size > 0) {
    updateFireMaterials(fireMeshSet, fireParams, elapsed);

    // ── Burn-to-ash system ────────────────────────────────────────────────
    const burnEvents = updateBurnTimers(elapsed);
    for (const ev of burnEvents) {
      if (ev.event === 'ember') {
        // Spawn floating ember particles
        ticks.push(createEmberParticles(ev.worldPos, scene));
      } else if (ev.event === 'collapse') {
        // Break apart and animate falling to the ground 
        // We do this concurrently while it continues to burn/turn to ash
        ticks.push(animateBurnDeath(ev.mesh, () => {
          // Animation complete callback (optional)
        }));
      } else if (ev.event === 'death') {
        // Mesh is fully consumed!
        // 1. Spawn ash disintegration burst
        ticks.push(createAshEffect(ev.worldPos, scene));
        // 2. Remove fire & burn timer
        clearBurnTimer(ev.mesh);
        removeFire(ev.mesh);
        fireMeshSet.delete(ev.mesh);
        // 3. The mesh was already hidden/destroyed by animateBurnDeath
        ev.mesh.userData.__burnedAway = true;
        // 4. Save state
        saveFireMeshIds(fireMeshSet, dioramaIndex);
        refreshWalkModeMeshes();
      }
    }
  }

  // AY HALESİ (Kameraya her zaman bakmalı)
  if (moonGroup) {
    moonGroup.children.forEach(child => {
      if (child.isMesh && child.geometry.type === 'PlaneGeometry') {
        child.lookAt(activeCamera.position);
      }
    });
  }

  for (let i = (ticks || []).length - 1; i >= 0; i--) {
    try {
      if (ticks[i] && ticks[i](delta)) ticks.splice(i, 1);
    } catch (e) {
      console.error("Tick error:", e);
      ticks.splice(i, 1);
    }
  }
  if (phase === 'PLAYING' && walkMode.mode === 'orbit' && currentIsland) {
    const worldPos = new THREE.Vector3();
    currentIsland.group.getWorldPosition(worldPos);
    controls.target.lerp(new THREE.Vector3(worldPos.x, worldPos.y + 0.5, worldPos.z), 0.1);
    controls.update();

    // Keep DOF focused on the island center
    if (dofEnabled && bokehPass.enabled) {
      const camDist = activeCamera.position.distanceTo(worldPos);
      bokehPass.uniforms.focus.value += (camDist - bokehPass.uniforms.focus.value) * 0.05;
    }
  }

  composer.render(delta);
}
// ─── GRASS ────────────────────────────────────────────────────────────────────
let grassPatch = null;

// Mevcut parametreler (UI tarafından güncellenir)
export const GRASS_PARAMS = {
  count: 1500,
  spread: 8,
  scale: 0.1,
  timeScale: 1.0,
  swayStrength: 0.3,
  swaySpeed: 2.0,
  posX: 0,
  posY: 0.05,
  posZ: 0,
  visible: false,
  groundVisible: false,
  hostMeshNames: [], // Seçilen objelerin isimleri
};

createGrassPatch(scene, {
  count: GRASS_PARAMS.count,
  spread: GRASS_PARAMS.spread,
  scale: GRASS_PARAMS.scale,
  shaderParams: {
    timeScale: GRASS_PARAMS.timeScale,
    swayStrength: GRASS_PARAMS.swayStrength,
    swaySpeed: GRASS_PARAMS.swaySpeed,
  }
}).then(g => {
  grassPatch = g;
  if (g && g.group) {
    g.group.position.set(GRASS_PARAMS.posX, GRASS_PARAMS.posY, GRASS_PARAMS.posZ);
    // Explicitly enforce the default parameter at initialization
    g.group.visible = GRASS_PARAMS.visible;
    console.log('[Grass] loaded');
    // Ensure initial settings are loaded once grass is ready
    if (typeof window.loadGrassSettings === 'function' && typeof dioramaIndex !== 'undefined') {
      window.loadGrassSettings(dioramaIndex);
    }
  }
}).catch(err => {
  console.warn('[Grass] Could not load grass, but level will continue.', err);
});

animate();

function setupDevTools() {
  const toggleBtn = document.createElement('button');
  toggleBtn.innerHTML = '🪄';
  toggleBtn.style.cssText = 'position:fixed; top:100px; right:20px; z-index:10001; background:rgba(0,0,0,0.6); border:none; border-radius:50%; width:40px; height:40px; color:white; cursor:pointer; font-size:20px; display:none; backdrop-filter:blur(5px); box-shadow: 0 4px 12px rgba(0,0,0,0.3);';
  document.body.appendChild(toggleBtn);

  // Premium slider styling
  const sliderStyle = document.createElement('style');
  sliderStyle.textContent = `
    #dev-tools-container input[type="range"] {
      -webkit-appearance: none;
      width: 100%;
      height: 4px;
      background: rgba(255, 255, 255, 0.1);
      border-radius: 2px;
      outline: none;
      margin: 10px 0;
      cursor: pointer;
    }
    #dev-tools-container input[type="range"]::-webkit-slider-thumb {
      -webkit-appearance: none;
      width: 14px;
      height: 14px;
      background: #ff4757;
      border-radius: 50%;
      cursor: pointer;
      box-shadow: 0 0 10px rgba(255, 71, 87, 0.4);
      transition: transform 0.1s;
    }
    #dev-tools-container input[type="range"]:active::-webkit-slider-thumb {
      transform: scale(1.3);
      filter: brightness(1.2);
    }
    #dev-tools-container input[type="range"]::-moz-range-thumb {
      width: 14px;
      height: 14px;
      background: #ff4757;
      border: none;
      border-radius: 50%;
      cursor: pointer;
    }
  `;
  document.head.appendChild(sliderStyle);

  const container = document.createElement('div');
  container.id = 'dev-tools-container';
  container.style.cssText = `
    position: fixed;
    top: 100px;
    right: 20px;
    bottom: 20px;
    display: flex;
    flex-direction: column;
    gap: 15px;
    z-index: 10000;
    pointer-events: auto;
    overflow-y: auto;
    overflow-x: hidden;
    padding-right: 4px;
    scrollbar-width: thin;
    scrollbar-color: rgba(255,255,255,0.2) transparent;
  `;
  // Prevent scene orbit when interacting inside the panel
  container.addEventListener('wheel', e => e.stopPropagation(), { passive: false });
  container.addEventListener('pointerdown', e => e.stopPropagation());
  container.addEventListener('mousedown', e => e.stopPropagation());
  document.body.appendChild(container);

  const createPanel = (title, content) => {
    const p = document.createElement('div');
    p.className = 'dev-panel';
    p.style.cssText = 'border:2px solid #ff4757; background:rgba(0,0,0,0.92); color:#fff; padding:15px; border-radius:12px; font-family:sans-serif; backdrop-filter:blur(20px); min-width:215px; box-shadow:0 12px 64px rgba(0,0,0,0.8);';
    p.innerHTML = `
      <div style="font-weight:bold; font-size:12px; border-bottom:1px solid #444; padding-bottom:8px; display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
        <span>${title}</span>
        <span style="cursor:pointer; color:#ff4757; font-size:10px;" class="hide-trigger">[HIDE ALL]</span>
      </div>
      <div class="panel-body">${content}</div>
    `;
    return p;
  };

  const atmoContent = `
    <div style="font-size:11px; display:flex; flex-direction:column; gap:8px;">
      <div>Bottom (BG):<br><input type="color" id="p-bottom" style="width:100%; height:25px; border:none; background:none;"></div>
      <div>Top (Sky):<br><input type="color" id="p-top" style="width:100%; height:25px; border:none; background:none;"></div>
      <div>Fog Color:<br><input type="color" id="p-fog" style="width:100%; height:25px; border:none; background:none;"></div>
      <div>Horizon Offset: <span id="p-atmo-offset-val">15</span><br><input type="range" id="p-atmo-offset" min="-100" max="100" step="1" value="15" style="width:100%"></div>
      <div>Smoothness (Exp): <span id="p-atmo-exp-val">0.5</span><br><input type="range" id="p-atmo-exp" min="0.1" max="4.0" step="0.05" value="0.5" style="width:100%"></div>
      <button id="atmo-reset" style="margin-top:4px; background:rgba(255,180,50,0.18); border:1px solid rgba(255,180,50,0.4); color:rgba(255,200,80,0.9); border-radius:6px; padding:5px; font-size:10px; font-weight:700; cursor:pointer; letter-spacing:0.05em;">↺ RESET ATMOSPHERE</button>
    </div>
  `;

  const lightContent = `
    <div style="font-size:11px; display:flex; flex-direction:column; gap:8px;">
      <div>Sun Intensity:<br><input type="range" id="s-int" min="0" max="5" step="0.1" style="width:100%"></div>
      <div>Sun Color:<br><input type="color" id="s-col" style="width:100%; height:20px; border:none; background:none;"></div>
      
      <div style="margin-top:5px; padding:5px; background:rgba(255,255,255,0.05); border-radius:4px;">
        <div style="color:#aaa; margin-bottom:4px; font-weight:bold;">Sun Position (Shadows):</div>
        X: <input type="range" id="s-posX" min="-50" max="50" step="1" style="width:100%"><br>
        Y: <input type="range" id="s-posY" min="0" max="60" step="1" style="width:100%"><br>
        Z: <input type="range" id="s-posZ" min="-50" max="50" step="1" style="width:100%">
      </div>

      <div style="border-top:1px solid #333; margin:4px 0;"></div>
      <div>Celestial Size (Sun/Moon):<br><input type="range" id="s-size" min="0.1" max="5" step="0.1" style="width:100%"></div>

      <div style="border-top:1px solid #333; margin:4px 0;"></div>
      <div style="display:flex; gap:10px;">
        <div style="flex:1">Rim Int:<br><input type="range" id="r-int" min="0" max="3" step="0.1" style="width:100%"></div>
        <div style="flex:1">Rim Col:<br><input type="color" id="r-col" style="width:100%; height:20px; border:none; background:none;"></div>
      </div>
      <div style="display:flex; gap:10px;">
        <div style="flex:1">Fill Int:<br><input type="range" id="f-int" min="0" max="3" step="0.1" style="width:100%"></div>
        <div style="flex:1">Fill Col:<br><input type="color" id="f-col" style="width:100%; height:20px; border:none; background:none;"></div>
      </div>

      <div style="margin-top:10px; display:flex; flex-direction:column; gap:5px;">
        <div style="display:flex; gap:5px;">
          <button id="dev-save" style="flex:1; background:#2ed573; color:white; border:none; padding:6px; border-radius:4px; cursor:pointer; font-weight:bold; font-size:10px;">SAVE</button>
          <button id="dev-code" style="flex:1; background:#4a90e2; color:white; border:none; padding:6px; border-radius:4px; cursor:pointer; font-weight:bold; font-size:10px;">CODE</button>
        </div>
        <button id="light-reset" style="background:rgba(255,180,50,0.18); border:1px solid rgba(255,180,50,0.4); color:rgba(255,200,80,0.9); border-radius:6px; padding:5px; font-size:10px; font-weight:700; cursor:pointer; letter-spacing:0.05em;">↺ RESET LIGHTS</button>
        <button id="dev-reset" style="background:#ff4757; color:white; border:none; padding:6px; border-radius:4px; cursor:pointer; font-weight:bold; font-size:9px; opacity:0.8;">RESET SETTINGS (WIPE)</button>
      </div>
    </div>
  `;

  const dofContent = `
    <div style="font-size:11px; display:flex; flex-direction:column; gap:8px;">
      <div style="display:flex; align-items:center; justify-content:space-between;">
        <span>Enabled:</span>
        <button id="d-toggle" style="background:rgba(255,255,255,0.1); border:1px solid rgba(255,255,255,0.3); color:white; padding:3px 10px; border-radius:10px; cursor:pointer; font-size:10px; font-weight:bold;">OFF</button>
      </div>
      <div>Focus Distance: <span id="d-focus-val">7.5</span><br>
        <input type="range" id="d-focus" min="1" max="100" step="0.1" value="7.5" style="width:100%">
      </div>
      <div>Aperture: <span id="d-aperture-val">0.006</span><br>
        <input type="range" id="d-aperture" min="0.001" max="0.03" step="0.001" value="0.006" style="width:100%">
      </div>
      <div>Max Blur: <span id="d-maxblur-val">0.012</span><br>
        <input type="range" id="d-maxblur" min="0.002" max="0.04" step="0.001" value="0.012" style="width:100%">
      </div>
      <div style="border-top:1px solid #333; padding-top:6px;">Bloom Strength: <span id="b-strength-val">0.35</span><br>
        <input type="range" id="b-strength" min="0" max="1.5" step="0.01" value="0.35" style="width:100%">
      </div>
      <div>Bloom Threshold: <span id="b-threshold-val">0.92</span><br>
        <input type="range" id="b-threshold" min="0.5" max="1.0" step="0.01" value="0.92" style="width:100%">
      </div>
      <button id="dof-reset" style="margin-top:4px; background:rgba(255,180,50,0.18); border:1px solid rgba(255,180,50,0.4); color:rgba(255,200,80,0.9); border-radius:6px; padding:5px; font-size:10px; font-weight:700; cursor:pointer; letter-spacing:0.05em;">↺ RESET DOF & BLOOM</button>
    </div>
  `;

  const gradingContent = `
    <div style="font-size:11px; display:flex; flex-direction:column; gap:8px;">
      <div>Brightness: <span id="g-bright-val">0.06</span><br>
        <input type="range" id="g-bright" min="-0.5" max="0.5" step="0.01" value="0.06" style="width:100%">
      </div>
      <div>Contrast: <span id="g-contrast-val">1.22</span><br>
        <input type="range" id="g-contrast" min="0.5" max="2.0" step="0.01" value="1.22" style="width:100%">
      </div>
      <div>Saturation: <span id="g-sat-val">1.07</span><br>
        <input type="range" id="g-sat" min="0.0" max="2.0" step="0.01" value="1.07" style="width:100%">
      </div>
      <div>Gamma: <span id="g-gamma-val">1.17</span><br>
        <input type="range" id="g-gamma" min="0.5" max="2.0" step="0.01" value="1.17" style="width:100%">
      </div>
      <div style="display:flex; gap:5px; margin-top:5px;">
        <button id="grading-save" style="flex:1; background:#2ed573; color:white; border:none; padding:6px; border-radius:4px; cursor:pointer; font-weight:bold; font-size:10px;">SAVE ALL</button>
        <button id="grading-reset" style="flex:1; background:rgba(255,180,50,0.18); border:1px solid rgba(255,180,50,0.4); color:rgba(255,200,80,0.9); border-radius:6px; padding:5px; font-size:10px; font-weight:700; cursor:pointer; letter-spacing:0.05em;">↺ RESET</button>
      </div>
    </div>
  `;

  const cameraContent = `
    <div style="font-size:11px; display:flex; flex-direction:column; gap:8px;">
      <div>FOV: <span id="c-fov-val">35</span><br><input type="range" id="c-fov" min="10" max="100" step="1" value="35" style="width:100%"></div>
      <div style="border-top:1px solid #333; padding-top:4px;">Position X: <span id="c-px-val">-6.0</span><br><input type="range" id="c-px" min="-20" max="20" step="0.1" value="-6.0" style="width:100%"></div>
      <div>Position Y: <span id="c-py-val">3.5</span><br><input type="range" id="c-py" min="1" max="15" step="0.1" value="3.5" style="width:100%"></div>
      <div>Position Z: <span id="c-pz-val">6.0</span><br><input type="range" id="c-pz" min="-20" max="20" step="0.1" value="6.0" style="width:100%"></div>
      <div style="border-top:1px solid #333; padding-top:4px; color:#aaa; font-weight:bold;">Focus Target:</div>
      <div>Target X: <span id="c-tx-val">0.0</span><br><input type="range" id="c-tx" min="-10" max="10" step="0.1" value="0.0" style="width:100%"></div>
      <div>Target Y: <span id="c-ty-val">0.5</span><br><input type="range" id="c-ty" min="-10" max="10" step="0.1" value="0.5" style="width:100%"></div>
      <div>Target Z: <span id="c-tz-val">0.0</span><br><input type="range" id="c-tz" min="-10" max="10" step="0.1" value="0.0" style="width:100%"></div>
      <div style="display:flex; gap:5px; margin-top:5px;">
        <button id="cam-save" style="flex:1; background:#2ed573; color:white; border:none; padding:6px; border-radius:4px; cursor:pointer; font-weight:bold; font-size:10px;">SAVE ALL</button>
        <button id="cam-reset" style="flex:1; background:rgba(255,180,50,0.18); border:1px solid rgba(255,180,50,0.4); color:rgba(255,200,80,0.9); border-radius:6px; padding:5px; font-size:10px; font-weight:700; cursor:pointer; letter-spacing:0.04em;">↺ RESET</button>
      </div>
    </div>
  `;

  // ── MATERIAL SHADER panel (CEL + PBR tabbed) ─────────────────────────────
  const matContent = `
    <div style="font-size:11px; display:flex; flex-direction:column; gap:0;">
      <!-- Tab bar -->
      <div style="display:flex; gap:4px; margin-bottom:10px;">
        <button id="mat-tab-cel" style="flex:1; padding:5px; border-radius:7px 7px 0 0; border:1px solid rgba(255,255,255,0.25); border-bottom:none; background:rgba(120,200,255,0.18); color:#7cf; font-size:10px; font-weight:800; cursor:pointer; letter-spacing:0.06em;">CEL</button>
        <button id="mat-tab-pbr" style="flex:1; padding:5px; border-radius:7px 7px 0 0; border:1px solid rgba(255,255,255,0.1); border-bottom:none; background:rgba(255,255,255,0.05); color:rgba(255,255,255,0.4); font-size:10px; font-weight:800; cursor:pointer; letter-spacing:0.06em;">PBR</button>
      </div>

      <!-- CEL tab -->
      <div id="mat-pane-cel" style="display:flex; flex-direction:column; gap:8px;">
        <div style="display:flex; align-items:center; justify-content:space-between;">
          <span style="font-weight:bold;">Cel Shading:</span>
          <button id="cel-toggle" style="background:rgba(255,255,255,0.1); border:1px solid rgba(255,255,255,0.3); color:white; padding:3px 10px; border-radius:10px; cursor:pointer; font-size:10px; font-weight:bold;">OFF</button>
        </div>
        <div style="display:flex; align-items:center; justify-content:space-between;">
          <span>Original Colors:</span>
          <button id="cel-origcol" style="background:rgba(100,220,120,0.35); border:1px solid rgba(255,255,255,0.3); color:white; padding:3px 10px; border-radius:10px; cursor:pointer; font-size:10px; font-weight:bold;">ON</button>
        </div>
        <div>
          Gradient Steps: <span id="cel-steps-val">3</span>
          <input type="range" id="cel-steps" min="1" max="8" step="1" value="3" style="width:100%">
        </div>
        <div style="border-top:1px solid #333; padding-top:6px; display:flex; align-items:center; justify-content:space-between;">
          <span>Outline:</span>
          <button id="cel-outline-toggle" style="background:rgba(100,220,120,0.35); border:1px solid rgba(255,255,255,0.3); color:white; padding:3px 10px; border-radius:10px; cursor:pointer; font-size:10px; font-weight:bold;">ON</button>
        </div>
        <div>
          Thickness: <span id="cel-thick-val">0.030</span>
          <input type="range" id="cel-thick" min="0.005" max="0.15" step="0.005" value="0.03" style="width:100%">
        </div>
        <div>
          Outline Color:<br>
          <input type="color" id="cel-outline-color" value="#000000" style="width:100%; height:25px; border:none; background:none; cursor:pointer;">
        </div>
        <div style="border-top:1px solid #333; padding-top:6px;">
          Brightness: <span id="cel-bright-val">1.00</span>
          <input type="range" id="cel-bright" min="0.2" max="2.0" step="0.05" value="1.0" style="width:100%">
        </div>
        <div>
          Saturation: <span id="cel-sat-val">1.00</span>
          <input type="range" id="cel-sat" min="0.0" max="2.0" step="0.05" value="1.0" style="width:100%">
        </div>
        <button id="cel-reset" style="margin-top:4px; background:rgba(255,180,50,0.18); border:1px solid rgba(255,180,50,0.4); color:rgba(255,200,80,0.9); border-radius:6px; padding:5px; font-size:10px; font-weight:700; cursor:pointer; letter-spacing:0.05em;">↺ RESET CEL</button>
      </div>

      <!-- PBR tab -->
      <div id="mat-pane-pbr" style="display:none; flex-direction:column; gap:8px;">
        <div style="display:flex; align-items:center; justify-content:space-between;">
           <span style="font-weight:bold;">PBR Overrides:</span>
           <button id="pbr-toggle" style="background:rgba(100,220,120,0.35); border:1px solid rgba(255,255,255,0.3); color:white; padding:3px 10px; border-radius:10px; cursor:pointer; font-size:10px; font-weight:bold;">ON</button>
        </div>
        <div style="color:rgba(255,255,255,0.45); font-size:10px; padding:4px 0;">Affects painted (revealed) objects in PBR mode.</div>
        <div>
          Roughness ×: <span id="pbr-rough-val">1.00</span>
          <input type="range" id="pbr-rough" min="0" max="2" step="0.05" value="1.0" style="width:100%">
        </div>
        <div>
          Metalness ×: <span id="pbr-metal-val">1.00</span>
          <input type="range" id="pbr-metal" min="0" max="2" step="0.05" value="1.0" style="width:100%">
        </div>
        <div style="border-top:1px solid #333; padding-top:6px;">
          Emissive Add: <span id="pbr-emissive-val">0.00</span>
          <input type="range" id="pbr-emissive" min="0" max="1" step="0.02" value="0" style="width:100%">
        </div>
        <div style="border-top:1px solid #333; padding-top:6px;">
          Color Tint:<br>
          <input type="color" id="pbr-tint-color" value="#ffffff" style="width:100%; height:25px; border:none; background:none; cursor:pointer;">
        </div>
        <div>
          Tint Strength: <span id="pbr-tint-val">0.00</span>
          <input type="range" id="pbr-tint" min="0" max="1" step="0.02" value="0" style="width:100%">
        </div>
        <button id="pbr-reset" style="margin-top:4px; background:rgba(255,180,50,0.18); border:1px solid rgba(255,180,50,0.4); color:rgba(255,200,80,0.9); border-radius:6px; padding:5px; font-size:10px; font-weight:700; cursor:pointer; letter-spacing:0.05em;">↺ RESET PBR</button>
      </div>

      <!-- Presets & Scene Tools -->
      <div style="border-top:2px solid #555; margin-top:12px; padding-top:10px; display:flex; flex-direction:column; gap:8px;">
        <div style="color:rgba(255,255,255,0.4); font-size:9px; font-weight:bold; letter-spacing:0.1em; text-align:center;">QUICK PRESETS</div>
        <div style="display:flex; gap:5px;">
          <button id="preset-cel-pbr" style="flex:1; background:linear-gradient(135deg, #1e90ff, #70a1ff); color:white; border:none; padding:8px; border-radius:8px; cursor:pointer; font-weight:bold; font-size:10px; box-shadow:0 4px 10px rgba(0,0,0,0.3);">CEL PBR</button>
          <button id="preset-clay" style="flex:1; background:linear-gradient(135deg, #666, #999); color:white; border:none; padding:8px; border-radius:8px; cursor:pointer; font-weight:bold; font-size:10px; box-shadow:0 4px 10px rgba(0,0,0,0.3);">CLAY</button>
        </div>
        
        <div style="border-top:1px solid #333; margin:5px 0;"></div>
        <button id="paint-all-btn" style="background:#ffa502; color:white; border:none; padding:10px; border-radius:8px; cursor:pointer; font-weight:900; font-size:11px; letter-spacing:0.05em; box-shadow:0 4px 15px rgba(255,165,2,0.3);">🖌 PAINT ALL ISLAND</button>
      </div>
    </div>
  `;

  const auroraContent = `
    <div style="font-size:11px; display:flex; flex-direction:column; gap:8px;">
      <div>Intensity: <span id="au-int-val">1.0</span><br>
        <input type="range" id="au-int" min="0" max="3" step="0.1" value="1.0" style="width:100%">
      </div>
      <div>Color 1:<br><input type="color" id="au-col1" value="#00ff99" style="width:100%; height:25px; border:none; background:none;"></div>
      <div>Color 2:<br><input type="color" id="au-col2" value="#7c4dff" style="width:100%; height:25px; border:none; background:none;"></div>
      <button id="au-reset" style="margin-top:4px; background:rgba(255,180,50,0.18); border:1px solid rgba(255,180,50,0.4); color:rgba(255,200,80,0.9); border-radius:6px; padding:5px; font-size:10px; font-weight:700; cursor:pointer; letter-spacing:0.05em;">↺ RESET AURORA</button>
    </div>
  `;

  const grassContent = `
      <div style="font-size:11px; display:flex; flex-direction:column; gap:8px;">
        <div style="display:flex; align-items:center; justify-content:space-between; padding:4px; background:rgba(255,255,255,0.05); border-radius:6px; gap:8px;">
          <div style="flex:1; display:flex; flex-direction:column; gap:2px;">
            <span style="font-size:9px; font-weight:bold; color:rgba(255,255,255,0.5);">GRASS:</span>
            <button id="grass-visible-toggle" style="background:rgba(100,220,120,0.35); border:1px solid rgba(100,220,120,0.5); color:#fff; border-radius:6px; padding:4px; font-size:10px; font-weight:bold; cursor:pointer;">ON</button>
          </div>
          <div style="flex:1; display:flex; flex-direction:column; gap:2px;">
            <span style="font-size:9px; font-weight:bold; color:rgba(255,255,255,0.5);">GROUND:</span>
            <button id="ground-visible-toggle" style="background:rgba(100,220,120,0.35); border:1px solid rgba(100,220,120,0.5); color:#fff; border-radius:6px; padding:4px; font-size:10px; font-weight:bold; cursor:pointer;">ON</button>
          </div>
        </div>
        <button id="grass-pick-btn" style="width:100%; background:rgba(200,150,255,0.15); border:1px solid rgba(200,150,255,0.4); color:rgba(220,180,255,1); border-radius:8px; padding:6px; font-size:10px; font-weight:bold; cursor:pointer; margin-bottom:4px;">🎯 PICK SURFACE (0)</button>
        <div>Count: <span id="grass-count-val">1500</span><br><input type="range" id="grass-count" min="100" max="10000" step="100" value="1500" style="width:100%"></div>
        <div>Spread: <span id="grass-spread-val">8.0</span><br><input type="range" id="grass-spread" min="1" max="30" step="0.5" value="8" style="width:100%"></div>
        <div>Scale: <span id="grass-scale-val">0.10</span><br><input type="range" id="grass-scale" min="0.01" max="1.5" step="0.01" value="0.1" style="width:100%"></div>
        
        <div style="border-top:1px solid #333; padding-top:6px; font-weight:bold; color:#aaa;">── Sway ──</div>
        <div>Strength: <span id="grass-sway-str-val">0.30</span><br><input type="range" id="grass-sway-str" min="0" max="2" step="0.01" value="0.3" style="width:100%"></div>
        <div>Speed: <span id="grass-sway-spd-val">2.00</span><br><input type="range" id="grass-sway-spd" min="0" max="10" step="0.1" value="2" style="width:100%"></div>
        <div>Time Scale: <span id="grass-timescale-val">1.00</span><br><input type="range" id="grass-timescale" min="0" max="4" step="0.05" value="1" style="width:100%"></div>
        
        <div style="border-top:1px solid #333; padding-top:6px; font-weight:bold; color:#aaa;">── Position ──</div>
        <div>X: <span id="grass-px-val">0.0</span><br><input type="range" id="grass-px" min="-20" max="20" step="0.1" value="0" style="width:100%"></div>
        <div>Y: <span id="grass-py-val">0.0</span><br><input type="range" id="grass-py" min="-10" max="10" step="0.1" value="0" style="width:100%"></div>
        <div>Z: <span id="grass-pz-val">0.0</span><br><input type="range" id="grass-pz" min="-20" max="20" step="0.1" value="0" style="width:100%"></div>
        
        <div style="display:flex; gap:5px; margin-top:5px;">
          <button id="grass-save" style="flex:1; background:#2ed573; color:white; border:none; padding:8px; border-radius:8px; cursor:pointer; font-weight:bold; font-size:10px; box-shadow:0 4px 10px rgba(0,0,0,0.3);">SAVE SETTINGS</button>
          <button id="grass-rebuild" style="flex:1; background:rgba(100,180,255,0.2); border:1px solid rgba(100,180,255,0.5); color:rgba(150,210,255,0.9); border-radius:8px; padding:8px; font-size:10px; font-weight:700; cursor:pointer; letter-spacing:0.05em;">↺ REBUILD</button>
        </div>
      </div>
    `;
  container.appendChild(createPanel('🌿 GRASS', grassContent));
  container.appendChild(createPanel('ATMOSPHERE', atmoContent));
  container.appendChild(createPanel('NORTHERN LIGHTS', auroraContent));
  container.appendChild(createPanel('LIGHTING', lightContent));
  container.appendChild(createPanel('LENS & GLOW', dofContent));

  const paintAnimContent = `
      <div style="font-size:11px; display:flex; flex-direction:column; gap:8px;">
        <div style="background:rgba(255,255,255,0.05); padding:6px; border-radius:8px; border:1px solid rgba(255,255,255,0.1);">
           Preset:
           <select id="anim-type" style="width:100%; margin-top:4px; background:#1a1a1a; color:#fff; border:1px solid #444; border-radius:5px; padding:4px;">
             <option value="RADIAL">Radial (Domino)</option>
             <option value="BOTTOM_UP">Bottom Up</option>
             <option value="RANDOM">Random</option>
             <option value="WAVE_X">Wave (X Axis)</option>
             <option value="WAVE_Z">Wave (Z Axis)</option>
           </select>
        </div>
        <div>Stagger: <span id="anim-stagger-val">45</span>ms<br>
          <input type="range" id="anim-stagger" min="0" max="250" step="5" value="45" style="width:100%">
        </div>
        <div>Duration: <span id="anim-dur-val">550</span>ms<br>
          <input type="range" id="anim-dur" min="100" max="2000" step="50" value="550" style="width:100%">
        </div>
        <div>Jump Height: <span id="anim-jump-val">0.12</span><br>
          <input type="range" id="anim-jump" min="0" max="1.0" step="0.01" value="0.12" style="width:100%">
        </div>
        <button id="anim-reset" style="margin-top:4px; background:rgba(255,180,50,0.18); border:1px solid rgba(255,180,50,0.4); color:rgba(255,200,80,0.9); border-radius:6px; padding:5px; font-size:10px; font-weight:700; cursor:pointer; letter-spacing:0.05em;">↺ RESET ANIM</button>
      </div>
    `;
  container.appendChild(createPanel('🎨 PAINT ANIM', paintAnimContent));

  // ── Volumetric Light panel ──────────────────────────────────────────────
  const _vd = volParams; // current (possibly restored) params
  const volContent = `
      <div style="font-size:11px; display:flex; flex-direction:column; gap:8px;">
        <div style="display:flex; align-items:center; justify-content:space-between; gap:6px;">
          <span style="font-weight:bold; color:#ffe08a;">Pick Mode:</span>
          <button id="vol-pick-btn" style="background:rgba(255,255,255,0.1); border:1px solid rgba(255,255,255,0.3); color:white; padding:3px 10px; border-radius:10px; cursor:pointer; font-size:10px; font-weight:bold;">OFF</button>
        </div>
        <div style="color:rgba(255,255,255,0.45); font-size:9px; line-height:1.5em;">
          Pick ON → sahneye tıklanan mesh volumetric ışığa döner. Tekrar tıklayınca geri alınır.
        </div>
        <div id="vol-mesh-list" style="display:flex; flex-direction:column; gap:4px; max-height:80px; overflow-y:auto; border:1px solid rgba(255,255,255,0.1); border-radius:6px; padding:4px; scrollbar-width:thin;"></div>
        <div style="border-top:1px solid #333; padding-top:6px;">
          Color:<br><input type="color" id="vol-color" value="${_vd.color}" style="width:100%; height:25px; border:none; background:none; cursor:pointer;">
        </div>
        <div>Intensity: <span id="vol-int-val">${_vd.intensity.toFixed(2)}</span><br>
          <input type="range" id="vol-int" min="0" max="2" step="0.01" value="${_vd.intensity}" style="width:100%">
        </div>
        <div>Dust Opacity: <span id="vol-dust-val">${_vd.dustOpacity.toFixed(2)}</span><br>
          <input type="range" id="vol-dust" min="0" max="1" step="0.01" value="${_vd.dustOpacity}" style="width:100%">
        </div>
        <div>Noise Scale: <span id="vol-noise-val">${_vd.noiseScale.toFixed(1)}</span><br>
          <input type="range" id="vol-noise" min="0.5" max="12" step="0.1" value="${_vd.noiseScale}" style="width:100%">
        </div>
        <div>Edge Softness: <span id="vol-edge-val">${_vd.edgeSoftness.toFixed(2)}</span><br>
          <input type="range" id="vol-edge" min="0.05" max="1" step="0.01" value="${_vd.edgeSoftness}" style="width:100%">
        </div>
        <div>Depth Fade: <span id="vol-depth-val">${_vd.depthFade.toFixed(2)}</span><br>
          <input type="range" id="vol-depth" min="0" max="1" step="0.01" value="${_vd.depthFade}" style="width:100%">
        </div>
        <div style="display:flex; gap:5px; margin-top:4px;">
          <button id="vol-save" style="flex:1; background:#2ed573; color:white; border:none; padding:6px; border-radius:4px; cursor:pointer; font-weight:bold; font-size:10px;">SAVE</button>
          <button id="vol-reset" style="flex:1; background:rgba(255,180,50,0.18); border:1px solid rgba(255,180,50,0.4); color:rgba(255,200,80,0.9); border-radius:6px; padding:5px; font-size:10px; font-weight:700; cursor:pointer; letter-spacing:0.05em;">↺ RESET</button>
        </div>
      </div>
    `;

  container.appendChild(createPanel('GRADING', gradingContent));
  container.appendChild(createPanel('CAMERA', cameraContent));
  container.appendChild(createPanel('MATERIAL SHADER', matContent));
  container.appendChild(createPanel('💡 VOLUMETRIC LIGHT', volContent));

  const fireContent = `
    <div style="font-size:11px; display:flex; flex-direction:column; gap:8px;">
      <div style="color:rgba(255,255,255,0.45); font-size:9px; line-height:1.5em;">
        F tuşu ile eklenen ateşleri buradan silebilirsiniz.
      </div>
      <button id="fire-reset" style="background:#ff4757; color:white; border:none; padding:6px; border-radius:4px; cursor:pointer; font-weight:bold; font-size:10px;">🔥 TÜM ATEŞLERİ TEMİZLE</button>
    </div>
  `;
  container.appendChild(createPanel('🔥 FIRE', fireContent));

  setTimeout(() => {
    const fireResetBtn = el('fire-reset');
    if (fireResetBtn) {
      fireResetBtn.onclick = () => {
        fireMeshSet.forEach(m => removeFire(m));
        fireMeshSet.clear();
        saveFireMeshIds(fireMeshSet, dioramaIndex);
        refreshWalkModeMeshes();
      };
    }
  }, 100);

  // ── Glass panel ─────────────────────────────────────────────────────────
  const _gd = glassParams;
  const glassContent = `
      <div style="font-size:11px; display:flex; flex-direction:column; gap:8px;">
        <div style="display:flex; align-items:center; justify-content:space-between; gap:6px;">
          <span style="font-weight:bold; color:#a8d8f0;">Pick Mode:</span>
          <button id="glass-pick-btn" style="background:rgba(255,255,255,0.1); border:1px solid rgba(255,255,255,0.3); color:white; padding:3px 10px; border-radius:10px; cursor:pointer; font-size:10px; font-weight:bold;">OFF</button>
        </div>
        <div style="color:rgba(255,255,255,0.45); font-size:9px; line-height:1.5em;">
          Pick ON → tıklanan mesh cam efektine dönüşür.
        </div>
        <div id="glass-mesh-list" style="display:flex; flex-direction:column; gap:4px; max-height:72px; overflow-y:auto; border:1px solid rgba(255,255,255,0.1); border-radius:6px; padding:4px; scrollbar-width:thin;"></div>
        <div style="border-top:1px solid #333; padding-top:6px;">
          Tint Color:<br><input type="color" id="glass-color" value="${_gd.color}" style="width:100%; height:25px; border:none; background:none; cursor:pointer;">
        </div>
        <div>
          Rim Color:<br><input type="color" id="glass-rim-color" value="${_gd.rimColor}" style="width:100%; height:25px; border:none; background:none; cursor:pointer;">
        </div>
        <div>Opacity: <span id="glass-opacity-val">${_gd.opacity.toFixed(2)}</span><br>
          <input type="range" id="glass-opacity" min="0" max="1" step="0.01" value="${_gd.opacity}" style="width:100%">
        </div>
        <div>Fresnel Power: <span id="glass-fpow-val">${_gd.fresnelPow.toFixed(1)}</span><br>
          <input type="range" id="glass-fpow" min="0.5" max="8" step="0.1" value="${_gd.fresnelPow}" style="width:100%">
        </div>
        <div>Fresnel Strength: <span id="glass-fstr-val">${_gd.fresnelStr.toFixed(2)}</span><br>
          <input type="range" id="glass-fstr" min="0" max="2" step="0.01" value="${_gd.fresnelStr}" style="width:100%">
        </div>
        <div>Iridescence: <span id="glass-irid-val">${_gd.iridescence.toFixed(2)}</span><br>
          <input type="range" id="glass-irid" min="0" max="1" step="0.01" value="${_gd.iridescence}" style="width:100%">
        </div>
        <div style="display:flex; gap:5px; margin-top:4px;">
          <button id="glass-save" style="flex:1; background:#2ed573; color:white; border:none; padding:6px; border-radius:4px; cursor:pointer; font-weight:bold; font-size:10px;">SAVE</button>
          <button id="glass-reset" style="flex:1; background:rgba(255,180,50,0.18); border:1px solid rgba(255,180,50,0.4); color:rgba(255,200,80,0.9); border-radius:6px; padding:5px; font-size:10px; font-weight:700; cursor:pointer;">↺ RESET</button>
        </div>
      </div>
    `;
  container.appendChild(createPanel('🪟 GLASS', glassContent));

  // ── Water (mesh) panel ───────────────────────────────────────────────────
  const _wd = waterMeshParams;
  const waterMeshContent = `
      <div style="font-size:11px; display:flex; flex-direction:column; gap:8px;">
        <div style="display:flex; align-items:center; justify-content:space-between; gap:6px;">
          <span style="font-weight:bold; color:#00d4b0;">Pick Mode:</span>
          <button id="watermesh-pick-btn" style="background:rgba(255,255,255,0.1); border:1px solid rgba(255,255,255,0.3); color:white; padding:3px 10px; border-radius:10px; cursor:pointer; font-size:10px; font-weight:bold;">OFF</button>
        </div>
        <div style="color:rgba(255,255,255,0.45); font-size:9px; line-height:1.5em;">
          Pick ON → tıklanan mesh stylized su shader'ına dönüşür.
        </div>
        <div id="watermesh-list" style="display:flex; flex-direction:column; gap:4px; max-height:72px; overflow-y:auto; border:1px solid rgba(255,255,255,0.1); border-radius:6px; padding:4px; scrollbar-width:thin;"></div>
        <div style="border-top:1px solid #333; padding-top:6px;">
          Shallow Color:<br><input type="color" id="wm-shallow-color" value="${_wd.shallowColor}" style="width:100%; height:25px; border:none; background:none; cursor:pointer;">
        </div>
        <div>
          Deep Color:<br><input type="color" id="wm-deep-color" value="${_wd.deepColor}" style="width:100%; height:25px; border:none; background:none; cursor:pointer;">
        </div>
        <div>
          Caustic Color:<br><input type="color" id="wm-caustic-color" value="${_wd.causticColor}" style="width:100%; height:25px; border:none; background:none; cursor:pointer;">
        </div>
        <div>Opacity: <span id="wm-opacity-val">${_wd.opacity.toFixed(2)}</span><br>
          <input type="range" id="wm-opacity" min="0" max="1" step="0.01" value="${_wd.opacity}" style="width:100%">
        </div>
        <div>Wave Height: <span id="wm-wave-val">${_wd.waveHeight.toFixed(3)}</span><br>
          <input type="range" id="wm-wave" min="0" max="0.15" step="0.001" value="${_wd.waveHeight}" style="width:100%">
        </div>
        <div>Wave Speed: <span id="wm-speed-val">${_wd.waveSpeed.toFixed(1)}</span><br>
          <input type="range" id="wm-speed" min="0" max="4" step="0.05" value="${_wd.waveSpeed}" style="width:100%">
        </div>
        <div>Caustic Strength: <span id="wm-caustic-val">${_wd.causticStr.toFixed(2)}</span><br>
          <input type="range" id="wm-caustic" min="0" max="1" step="0.01" value="${_wd.causticStr}" style="width:100%">
        </div>
        <div>Caustic Scale: <span id="wm-cscale-val">${_wd.causticScale.toFixed(1)}</span><br>
          <input type="range" id="wm-cscale" min="0.5" max="8" step="0.1" value="${_wd.causticScale}" style="width:100%">
        </div>
        <div>Specular: <span id="wm-spec-val">${_wd.specularStr.toFixed(2)}</span><br>
          <input type="range" id="wm-spec" min="0" max="2" step="0.01" value="${_wd.specularStr}" style="width:100%">
        </div>
        <div>Edge Foam: <span id="wm-foam-val">${_wd.edgeFoam.toFixed(2)}</span><br>
          <input type="range" id="wm-foam" min="0" max="1" step="0.01" value="${_wd.edgeFoam}" style="width:100%">
        </div>
        <div>UV Tiling: <span id="wm-tiling-val">${_wd.tiling.toFixed(1)}</span><br>
          <input type="range" id="wm-tiling" min="0.5" max="16" step="0.5" value="${_wd.tiling}" style="width:100%">
        </div>
        <div style="display:flex; gap:5px; margin-top:4px;">
          <button id="watermesh-save" style="flex:1; background:#2ed573; color:white; border:none; padding:6px; border-radius:4px; cursor:pointer; font-weight:bold; font-size:10px;">SAVE</button>
          <button id="watermesh-reset" style="flex:1; background:rgba(255,180,50,0.18); border:1px solid rgba(255,180,50,0.4); color:rgba(255,200,80,0.9); border-radius:6px; padding:5px; font-size:10px; font-weight:700; cursor:pointer;">↺ RESET</button>
        </div>
      </div>
    `;
  container.appendChild(createPanel('💧 WATER MESH', waterMeshContent));

  // --- LOGIC ---
  const getHex = (c) => '#' + (c ? c.getHexString() : 'ffffff');

  // ── CEL SHADER logic ──────────────────────────────────────────────────────
  setTimeout(() => {
    const celToggle = el('cel-toggle');
    const celOrigCol = el('cel-origcol');
    const celSteps = el('cel-steps');
    const celStepsVal = el('cel-steps-val');
    const celOutlineToggle = el('cel-outline-toggle');
    const celThick = el('cel-thick');
    const celThickVal = el('cel-thick-val');
    const celOutlineColor = el('cel-outline-color');
    const celBright = el('cel-bright');
    const celBrightVal = el('cel-bright-val');
    const celSat = el('cel-sat');
    const celSatVal = el('cel-sat-val');
    if (!celToggle) return;

    const reapply = () => applyCelToIsland(currentIsland);

    const setToggleBtn = (btn, on) => {
      btn.textContent = on ? 'ON' : 'OFF';
      btn.style.background = on ? 'rgba(100,220,120,0.35)' : 'rgba(255,255,255,0.1)';
    };

    celToggle.onclick = () => {
      histPush();
      celParams.enabled = !celParams.enabled;
      setToggleBtn(celToggle, celParams.enabled);
      reapply();
    };

    celOrigCol.onclick = () => {
      histPush();
      celParams.useOriginalColors = !celParams.useOriginalColors;
      setToggleBtn(celOrigCol, celParams.useOriginalColors);
      reapply();
    };

    celSteps.oninput = (e) => {
      celParams.steps = parseInt(e.target.value);
      celStepsVal.textContent = celParams.steps;
      reapply();
    };
    celSteps.onchange = () => histPush();

    celOutlineToggle.onclick = () => {
      histPush();
      celParams.outlineEnabled = !celParams.outlineEnabled;
      setToggleBtn(celOutlineToggle, celParams.outlineEnabled);
      reapply();
    };

    celThick.oninput = (e) => {
      celParams.outlineThickness = parseFloat(e.target.value);
      celThickVal.textContent = celParams.outlineThickness.toFixed(3);
      reapply();
    };
    celThick.onchange = () => histPush();

    celOutlineColor.oninput = (e) => {
      celParams.outlineColor = e.target.value;
      reapply();
    };
    celOutlineColor.onchange = () => histPush();

    celBright.oninput = (e) => {
      celParams.brightness = parseFloat(e.target.value);
      celBrightVal.textContent = celParams.brightness.toFixed(2);
      reapply();
    };
    celBright.onchange = () => histPush();

    celSat.oninput = (e) => {
      celParams.saturation = parseFloat(e.target.value);
      celSatVal.textContent = celParams.saturation.toFixed(2);
      reapply();
    };
    celSat.onchange = () => histPush();

    // ── Tab switching ───────────────────────────────────────────────────────
    const tabCel = el('mat-tab-cel');
    const tabPbr = el('mat-tab-pbr');
    const paneCel = el('mat-pane-cel');
    const panePbr = el('mat-pane-pbr');
    const activateTab = (tab) => {
      const isCel = tab === 'cel';
      tabCel.style.background = isCel ? 'rgba(120,200,255,0.18)' : 'rgba(255,255,255,0.05)';
      tabCel.style.color = isCel ? '#7cf' : 'rgba(255,255,255,0.4)';
      tabPbr.style.background = isCel ? 'rgba(255,255,255,0.05)' : 'rgba(255,160,80,0.18)';
      tabPbr.style.color = isCel ? 'rgba(255,255,255,0.4)' : '#fa8';
      paneCel.style.display = isCel ? 'flex' : 'none';
      panePbr.style.display = isCel ? 'none' : 'flex';
    };
    tabCel.onclick = () => activateTab('cel');
    tabPbr.onclick = () => activateTab('pbr');

    // ── PBR controls ────────────────────────────────────────────────────────
    const pbrToggle = el('pbr-toggle');
    const pbrRough = el('pbr-rough');
    const pbrRoughV = el('pbr-rough-val');
    const pbrMetal = el('pbr-metal');
    const pbrMetalV = el('pbr-metal-val');
    const pbrEmissive = el('pbr-emissive');
    const pbrEmissiveV = el('pbr-emissive-val');
    const pbrTintCol = el('pbr-tint-color');
    const pbrTint = el('pbr-tint');
    const pbrTintV = el('pbr-tint-val');

    const reapplyPBR = () => { if (!celParams.enabled) applyPBRToIsland(currentIsland); };

    pbrToggle.onclick = () => {
      histPush();
      pbrParams.enabled = !pbrParams.enabled;
      setToggleBtn(pbrToggle, pbrParams.enabled);
      reapplyPBR();
    };

    pbrRough.oninput = (e) => { pbrParams.roughnessMult = parseFloat(e.target.value); pbrRoughV.textContent = pbrParams.roughnessMult.toFixed(2); reapplyPBR(); };
    pbrRough.onchange = () => histPush();
    pbrMetal.oninput = (e) => { pbrParams.metalnessMult = parseFloat(e.target.value); pbrMetalV.textContent = pbrParams.metalnessMult.toFixed(2); reapplyPBR(); };
    pbrMetal.onchange = () => histPush();
    pbrEmissive.oninput = (e) => { pbrParams.emissiveAdd = parseFloat(e.target.value); pbrEmissiveV.textContent = pbrParams.emissiveAdd.toFixed(2); reapplyPBR(); };
    pbrEmissive.onchange = () => histPush();
    pbrTintCol.oninput = (e) => { pbrParams.colorTint = e.target.value; reapplyPBR(); };
    pbrTintCol.onchange = () => histPush();
    pbrTint.oninput = (e) => { pbrParams.tintStrength = parseFloat(e.target.value); pbrTintV.textContent = pbrParams.tintStrength.toFixed(2); reapplyPBR(); };
    pbrTint.onchange = () => histPush();

    el('pbr-reset').onclick = () => {
      Object.assign(pbrParams, PBR_DEFAULTS);
      setToggleBtn(pbrToggle, pbrParams.enabled);
      reapplyPBR();
      pbrRough.value = PBR_DEFAULTS.roughnessMult; pbrRoughV.textContent = PBR_DEFAULTS.roughnessMult.toFixed(2);
      pbrMetal.value = PBR_DEFAULTS.metalnessMult; pbrMetalV.textContent = PBR_DEFAULTS.metalnessMult.toFixed(2);
      pbrEmissive.value = PBR_DEFAULTS.emissiveAdd; pbrEmissiveV.textContent = PBR_DEFAULTS.emissiveAdd.toFixed(2);
      pbrTintCol.value = PBR_DEFAULTS.colorTint;
      pbrTint.value = PBR_DEFAULTS.tintStrength; pbrTintV.textContent = PBR_DEFAULTS.tintStrength.toFixed(2);
    };

    // ── Global Scene Tools ──────────────────────────────────────────────────
    el('paint-all-btn').onclick = () => {
      if (!currentIsland) return;
      histPush();
      currentIsland.objects.forEach(group => {
        if (group.userData.interactable && !group.userData.isAlive) {
          group.userData.isAlive = true;
          currentIsland.aliveCount++;
          // Start the domino effect from a central point for Paint All
          ticks.push(animateBloom(group, null, new THREE.Vector3(0, 0, 0), PAINT_PARAMS));
        }
      });
      setProgress(currentIsland.aliveCount / currentIsland.totalInteractable);
      playKalimba();
      reapply();
      if (currentIsland.isComplete) {
        if (nextBtn) {
          nextBtn.style.display = 'block';
          nextBtn.textContent = 'NEXT ✦';
        }
      }
    };

    el('preset-cel-pbr').onclick = () => {
      histPush();
      // Setup Cel
      Object.assign(celParams, CEL_DEFAULTS);
      celParams.enabled = true;
      celParams.outlineEnabled = true;
      celParams.steps = 3;
      // Setup PBR (disable overrides so it looks sharp)
      Object.assign(pbrParams, PBR_DEFAULTS);
      pbrParams.enabled = false;

      // Update UI
      setToggleBtn(el('cel-toggle'), true);
      setToggleBtn(el('cel-outline-toggle'), true);
      setToggleBtn(el('pbr-toggle'), false);
      activateTab('cel');
      reapply();
    };

    el('preset-clay').onclick = () => {
      histPush();
      celParams.enabled = false;
      pbrParams.enabled = false;
      setToggleBtn(el('cel-toggle'), false);
      setToggleBtn(el('pbr-toggle'), false);
      reapply();
    };

    // ─── Paint Anim Listeners ───
    const syncAnimUI = () => {
      if (el('anim-type')) el('anim-type').value = PAINT_PARAMS.type;
      if (el('anim-stagger')) { el('anim-stagger').value = PAINT_PARAMS.stagger; el('anim-stagger-val').textContent = PAINT_PARAMS.stagger; }
      if (el('anim-dur')) { el('anim-dur').value = PAINT_PARAMS.duration; el('anim-dur-val').textContent = PAINT_PARAMS.duration; }
      if (el('anim-jump')) { el('anim-jump').value = PAINT_PARAMS.jumpScale; el('anim-jump-val').textContent = PAINT_PARAMS.jumpScale.toFixed(2); }
    };
    syncAnimUI();

    el('anim-type').onchange = e => { PAINT_PARAMS.type = e.target.value; savePaintParams(); };
    el('anim-stagger').oninput = e => { PAINT_PARAMS.stagger = parseInt(e.target.value); el('anim-stagger-val').textContent = e.target.value; savePaintParams(); };
    el('anim-dur').oninput = e => { PAINT_PARAMS.duration = parseInt(e.target.value); el('anim-dur-val').textContent = e.target.value; savePaintParams(); };
    el('anim-jump').oninput = e => { PAINT_PARAMS.jumpScale = parseFloat(e.target.value); el('anim-jump-val').textContent = PAINT_PARAMS.jumpScale.toFixed(2); savePaintParams(); };
    el('anim-reset').onclick = () => {
      Object.assign(PAINT_PARAMS, { type: 'RADIAL', stagger: 45, duration: 550, jumpScale: 0.12 });
      savePaintParams(); syncAnimUI();
    };
  }, 300);

  const syncUI = () => {
    if (atmosphere) {
      el('p-bottom').value = getHex(atmosphere.material.uniforms.bottomColor.value);
      el('p-top').value = getHex(atmosphere.material.uniforms.topColor.value);
    }
    if (scene.fog) el('p-fog').value = '#' + scene.fog.color.getHexString();
    el('s-int').value = sun.intensity;
    el('s-col').value = getHex(sun.color);
    el('s-posX').value = sun.position.x;
    el('s-posY').value = sun.position.y;
    el('s-posZ').value = sun.position.z;

    if (moonGroup) {
      const vSun = moonGroup.getObjectByName('VisualSun');
      if (vSun) el('s-size').value = vSun.scale.x;
    }

    el('r-col').value = getHex(rimLight.color);
    el('f-int').value = fill.intensity;
    el('f-col').value = getHex(fill.color);

    if (atmosphere) {
      el('p-atmo-offset').value = atmosphere.material.uniforms.offset.value;
      el('p-atmo-offset-val').textContent = atmosphere.material.uniforms.offset.value;
      el('p-atmo-exp').value = atmosphere.material.uniforms.exponent.value;
      el('p-atmo-exp-val').textContent = atmosphere.material.uniforms.exponent.value.toFixed(2);
    }

    if (gradingPass) {
      const u = gradingPass.uniforms;
      if (el('g-bright')) {
        el('g-bright').value = u.brightness.value; el('g-bright-val').textContent = u.brightness.value.toFixed(2);
        el('g-contrast').value = u.contrast.value; el('g-contrast-val').textContent = u.contrast.value.toFixed(2);
        el('g-sat').value = u.saturation.value; el('g-sat-val').textContent = u.saturation.value.toFixed(2);
        el('g-gamma').value = u.gamma.value; el('g-gamma-val').textContent = u.gamma.value.toFixed(2);
      }
    }

    if (el('c-fov')) {
      el('c-fov').value = perspCamera.fov; el('c-fov-val').textContent = Math.round(perspCamera.fov);
      el('c-px').value = perspCamera.position.x; el('c-px-val').textContent = perspCamera.position.x.toFixed(1);
      el('c-py').value = perspCamera.position.y; el('c-py-val').textContent = perspCamera.position.y.toFixed(1);
      el('c-pz').value = perspCamera.position.z; el('c-pz-val').textContent = perspCamera.position.z.toFixed(1);
      el('c-tx').value = controls.target.x; el('c-tx-val').textContent = controls.target.x.toFixed(1);
      el('c-ty').value = controls.target.y; el('c-ty-val').textContent = controls.target.y.toFixed(1);
      el('c-tz').value = controls.target.z; el('c-tz-val').textContent = controls.target.z.toFixed(1);
    }
  };

  // ── DOF & Bloom controls (wired after DOM is ready) ──────────────────────
  setTimeout(() => {
    const dToggle = el('d-toggle');
    const dFocus = el('d-focus');
    const dAperture = el('d-aperture');
    const dMaxblur = el('d-maxblur');
    const bStrength = el('b-strength');
    const bThreshold = el('b-threshold');
    if (!dToggle) return;

    const refreshDofToggle = () => {
      const on = bokehPass.enabled;
      dToggle.textContent = on ? 'ON' : 'OFF';
      dToggle.style.background = on ? 'rgba(100,220,120,0.35)' : 'rgba(255,255,255,0.1)';
      // also sync the toolbar DOF button
      if (dofBtn) {
        dofBtn.style.color = on ? '#fff' : 'rgba(255,255,255,0.55)';
        dofBtn.style.background = on ? 'rgba(255,255,255,0.22)' : 'rgba(255,255,255,0.08)';
        dofBtn.style.borderColor = on ? 'rgba(255,255,255,0.55)' : 'rgba(255,255,255,0.18)';
      }
    };

    dToggle.onclick = () => {
      histPush();
      dofEnabled = !dofEnabled;
      bokehPass.enabled = dofEnabled;
      refreshDofToggle();
    };

    dFocus.oninput = (e) => {
      const v = parseFloat(e.target.value);
      bokehPass.uniforms['focus'].value = v;
      el('d-focus-val').textContent = v.toFixed(1);
    };
    dFocus.onchange = () => histPush();
    dAperture.oninput = (e) => {
      const v = parseFloat(e.target.value);
      bokehPass.uniforms['aperture'].value = v;
      el('d-aperture-val').textContent = v.toFixed(3);
    };
    dAperture.onchange = () => histPush();
    dMaxblur.oninput = (e) => {
      const v = parseFloat(e.target.value);
      bokehPass.uniforms['maxblur'].value = v;
      el('d-maxblur-val').textContent = v.toFixed(3);
    };
    dMaxblur.onchange = () => histPush();
    bStrength.oninput = (e) => {
      const v = parseFloat(e.target.value);
      bloomPass.strength = v;
      el('b-strength-val').textContent = v.toFixed(2);
    };
    bStrength.onchange = () => histPush();
    bThreshold.oninput = (e) => {
      const v = parseFloat(e.target.value);
      bloomPass.threshold = v;
      el('b-threshold-val').textContent = v.toFixed(2);
    };
    bThreshold.onchange = () => histPush();

    refreshDofToggle(); // Initial sync

    // ── Grading controls ──
    const gBright = el('g-bright');
    const gContrast = el('g-contrast');
    const gSat = el('g-sat');
    const gGamma = el('g-gamma');

    gBright.oninput = (e) => {
      const v = parseFloat(e.target.value);
      gradingPass.uniforms.brightness.value = v;
      el('g-bright-val').textContent = v.toFixed(2);
    };
    gBright.onchange = () => histPush();

    gContrast.oninput = (e) => {
      const v = parseFloat(e.target.value);
      gradingPass.uniforms.contrast.value = v;
      el('g-contrast-val').textContent = v.toFixed(2);
    };
    gContrast.onchange = () => histPush();

    gSat.oninput = (e) => {
      const v = parseFloat(e.target.value);
      gradingPass.uniforms.saturation.value = v;
      el('g-sat-val').textContent = v.toFixed(2);
    };
    gSat.onchange = () => histPush();

    gGamma.oninput = (e) => {
      const v = parseFloat(e.target.value);
      gradingPass.uniforms.gamma.value = v;
      el('g-gamma-val').textContent = v.toFixed(2);
    };
    gGamma.onchange = () => histPush();

    el('grading-reset').onclick = () => {
      histPush();
      gradingPass.uniforms.brightness.value = 0.06;
      gradingPass.uniforms.contrast.value = 1.22;
      gradingPass.uniforms.saturation.value = 1.07;
      gradingPass.uniforms.gamma.value = 1.17;
      gBright.value = 0.06; el('g-bright-val').textContent = '0.06';
      gContrast.value = 1.22; el('g-contrast-val').textContent = '1.22';
      gSat.value = 1.07; el('g-sat-val').textContent = '1.07';
      gGamma.value = 1.17; el('g-gamma-val').textContent = '1.17';
    };
    el('grading-save').onclick = () => el('dev-save').click();

    // ── Camera controls ──
    const cFov = el('c-fov'), cPx = el('c-px'), cPy = el('c-py'), cPz = el('c-pz');
    const cTx = el('c-tx'), cTy = el('c-ty'), cTz = el('c-tz');

    const updateCam = () => {
      perspCamera.fov = parseFloat(cFov.value);
      perspCamera.updateProjectionMatrix();
      perspCamera.position.set(parseFloat(cPx.value), parseFloat(cPy.value), parseFloat(cPz.value));
      controls.target.set(parseFloat(cTx.value), parseFloat(cTy.value), parseFloat(cTz.value));
      controls.update();
    };
    cFov.oninput = (e) => { el('c-fov-val').textContent = e.target.value; updateCam(); };
    cPx.oninput = (e) => { el('c-px-val').textContent = parseFloat(e.target.value).toFixed(1); updateCam(); };
    cPy.oninput = (e) => { el('c-py-val').textContent = parseFloat(e.target.value).toFixed(1); updateCam(); };
    cPz.oninput = (e) => { el('c-pz-val').textContent = parseFloat(e.target.value).toFixed(1); updateCam(); };
    cTx.oninput = (e) => { el('c-tx-val').textContent = parseFloat(e.target.value).toFixed(1); updateCam(); };
    cTy.oninput = (e) => { el('c-ty-val').textContent = parseFloat(e.target.value).toFixed(1); updateCam(); };
    cTz.oninput = (e) => { el('c-tz-val').textContent = parseFloat(e.target.value).toFixed(1); updateCam(); };

    el('cam-reset').onclick = () => {
      histPush();
      cFov.value = 35; cPx.value = -6; cPy.value = 3.5; cPz.value = 6;
      cTx.value = 0; cTy.value = 0.5; cTz.value = 0;
      ['c-fov', 'c-px', 'c-py', 'c-pz', 'c-tx', 'c-ty', 'c-tz'].forEach(id => el(id + '-val').textContent = el(id).value);
      updateCam();
    };
    el('cam-save').onclick = () => el('dev-save').click();
  }, 200);

  // ── GRASS panel logic ──────────────────────────────────────────────────────
  setTimeout(() => {
    const gCount = el('grass-count'); const gCountV = el('grass-count-val');
    const gSpread = el('grass-spread'); const gSpreadV = el('grass-spread-val');
    const gScale = el('grass-scale'); const gScaleV = el('grass-scale-val');
    const gStr = el('grass-sway-str'); const gStrV = el('grass-sway-str-val');
    const gSpd = el('grass-sway-spd'); const gSpdV = el('grass-sway-spd-val');
    const gTs = el('grass-timescale'); const gTsV = el('grass-timescale-val');
    const gPx = el('grass-px'); const gPxV = el('grass-px-val');
    const gPy = el('grass-py'); const gPyV = el('grass-py-val');
    const gPz = el('grass-pz'); const gPzV = el('grass-pz-val');
    const gRebuild = el('grass-rebuild');
    const gVisibleBtn = el('grass-visible-toggle');
    if (!gCount || !gVisibleBtn) return;

    // Uniform güncelleme — anlık
    const syncUniforms = () => {
      if (!grassPatch || !grassPatch.material.userData.shader) return;
      const u = grassPatch.material.userData.shader.uniforms;
      u.uSwayStrength.value = parseFloat(gStr.value);
      u.uSwaySpeed.value = parseFloat(gSpd.value);
      u.uTimeScale.value = parseFloat(gTs.value);
    };

    const syncPos = () => {
      if (!grassPatch) return;
      grassPatch.group.position.set(
        parseFloat(gPx.value),
        parseFloat(gPy.value),
        parseFloat(gPz.value)
      );
    };

    const syncVisibility = (on) => {
      if (!grassPatch) return;
      grassPatch.group.visible = on;
      GRASS_PARAMS.visible = on;
      gVisibleBtn.textContent = on ? 'ON' : 'OFF';
      gVisibleBtn.style.background = on ? 'rgba(100,220,120,0.35)' : 'rgba(255,71,87,0.35)';
      gVisibleBtn.style.borderColor = on ? 'rgba(100,220,120,0.5)' : 'rgba(255,71,87,0.5)';
    };

    gVisibleBtn.onclick = () => {
      const next = !grassPatch.group.visible;
      syncVisibility(next);
    };

    const gGroundToggle = el('ground-visible-toggle');
    const syncGroundVisibility = (on) => {
      if (currentIsland && currentIsland.groundMesh) {
        currentIsland.groundMesh.visible = on;
      }
      GRASS_PARAMS.groundVisible = on;
      if (gGroundToggle) {
        gGroundToggle.textContent = on ? 'ON' : 'OFF';
        gGroundToggle.style.background = on ? 'rgba(100,220,120,0.35)' : 'rgba(255,71,87,0.35)';
        gGroundToggle.style.borderColor = on ? 'rgba(100,220,120,0.5)' : 'rgba(255,71,87,0.5)';
      }
    };
    if (gGroundToggle) {
      gGroundToggle.onclick = () => {
        syncGroundVisibility(!GRASS_PARAMS.groundVisible);
      };
    }
    const gPickBtn = el('grass-pick-btn');
    if (gPickBtn) {
      gPickBtn.onclick = () => {
        grassPickingMode = !grassPickingMode;
        gPickBtn.style.background = grassPickingMode ? 'rgba(200,150,255,0.45)' : 'rgba(200,150,255,0.15)';
        gPickBtn.style.border = grassPickingMode ? '2px solid #fff' : '1px solid rgba(200,150,255,0.4)';
        if (grassPickingMode) {
          isPickingGlass = false;
        }
      };
    }

    const bindSlider = (sl, valEl, decimals, cb) => {
      if (!sl || !valEl) return;
      sl.addEventListener('input', () => {
        valEl.textContent = parseFloat(sl.value).toFixed(decimals);
        cb();
      });
    };

    bindSlider(gStr, gStrV, 2, syncUniforms);
    bindSlider(gSpd, gSpdV, 2, syncUniforms);
    bindSlider(gTs, gTsV, 2, syncUniforms);
    bindSlider(gPx, gPxV, 1, syncPos);
    bindSlider(gPy, gPyV, 1, syncPos);
    bindSlider(gPz, gPzV, 1, syncPos);
    bindSlider(gCount, gCountV, 0, () => { });
    bindSlider(gSpread, gSpreadV, 1, () => { });
    bindSlider(gScale, gScaleV, 2, () => { });
    bindSlider(gSpread, gSpreadV, 1, () => { });
    bindSlider(gScale, gScaleV, 2, () => { });


    // Rebuild: count/spread/scale değişince tıkla
    gRebuild.onclick = () => {
      if (!grassPatch) return;
      const newCount = parseInt(gCount.value);
      const newSpread = parseFloat(gSpread.value);
      const newScale = parseFloat(gScale.value);

      const hosts = [];
      if (currentIsland) {
        GRASS_PARAMS.hostMeshNames.forEach(n => {
          currentIsland.group.traverse(obj => { if (obj.name === n && obj.isMesh) hosts.push(obj); });
        });
      }
      grassPatch.rebuild({ count: newCount, spread: newSpread, scale: newScale, surfaceMeshes: hosts });
      syncUniforms();
    };

    el('grass-save').onclick = () => {
      const gSettings = {
        count: parseInt(gCount.value),
        spread: parseFloat(gSpread.value),
        scale: parseFloat(gScale.value),
        swayStr: parseFloat(gStr.value),
        swaySpd: parseFloat(gSpd.value),
        timeScale: parseFloat(gTs.value),
        posX: parseFloat(gPx.value),
        posY: parseFloat(gPy.value),
        posZ: parseFloat(gPz.value),
        visible: grassPatch ? grassPatch.group.visible : GRASS_PARAMS.visible,
        groundVisible: GRASS_PARAMS.groundVisible,
        hostMeshNames: GRASS_PARAMS.hostMeshNames
      };
      // Level bazlı key kullanımı
      localStorage.setItem(`grass_settings_lvl_${dioramaIndex}`, JSON.stringify(gSettings));

      const btn = el('grass-save');
      btn.textContent = 'SAVED ✓';
      btn.style.background = '#27ae60';
      setTimeout(() => {
        btn.textContent = 'SAVE SETTINGS';
        btn.style.background = '#2ed573';
      }, 2000);
    };

    // UI yüklendiği ve bağlamalar (bindings) bittiği için,
    // eğer bir seviye yüklenmişse (dioramaIndex) çimen ayarlarını çekelim.
    if (typeof window.loadGrassSettings === 'function' && typeof dioramaIndex !== 'undefined') {
      window.loadGrassSettings(dioramaIndex);
    }
  }, 300);

  window.loadGrassSettings = (idx) => {
    if (!grassPatch) return;
    const gSaved = localStorage.getItem(`grass_settings_lvl_${idx}`);
    if (gSaved) {
      try {
        const gd = JSON.parse(gSaved);
        gd.count = Math.min(gd.count || 1500, 10000);
        GRASS_PARAMS.hostMeshNames = gd.hostMeshNames || [];

        // Host meshleri bulup rebuild'e paslayalım
        const hosts = [];
        if (currentIsland) {
          GRASS_PARAMS.hostMeshNames.forEach(name => {
            currentIsland.group.traverse(obj => { if (obj.name === name && obj.isMesh) hosts.push(obj); });
          });
        }
        if (el('grass-pick-btn')) el('grass-pick-btn').textContent = `🎯 PICK SURFACE (${GRASS_PARAMS.hostMeshNames.length})`;

        // UI Sync
        if (el('grass-count')) {
          el('grass-count').value = gd.count; el('grass-count-val').textContent = gd.count;
          el('grass-spread').value = gd.spread; el('grass-spread-val').textContent = gd.spread.toFixed(1);
          el('grass-scale').value = gd.scale; el('grass-scale-val').textContent = gd.scale.toFixed(2);
          el('grass-sway-str').value = gd.swayStr; el('grass-sway-str-val').textContent = gd.swayStr.toFixed(2);
          el('grass-sway-spd').value = gd.swaySpd; el('grass-sway-spd-val').textContent = gd.swaySpd.toFixed(2);
          el('grass-timescale').value = gd.timeScale; el('grass-timescale-val').textContent = gd.timeScale.toFixed(2);
          el('grass-px').value = gd.posX; el('grass-px-val').textContent = gd.posX.toFixed(1);
          el('grass-py').value = gd.posY; el('grass-py-val').textContent = gd.posY.toFixed(1);
          el('grass-pz').value = gd.posZ; el('grass-pz-val').textContent = gd.posZ.toFixed(1);
        }

        // Apply
        grassPatch.rebuild({
          count: gd.count,
          spread: gd.spread,
          scale: gd.scale,
          surfaceMeshes: hosts
        });
        grassPatch.group.position.set(gd.posX, gd.posY, gd.posZ);
        // Default to true if undefined
        const isGrassVis = gd.visible !== false;
        grassPatch.group.visible = isGrassVis;
        GRASS_PARAMS.visible = isGrassVis;
        if (el('grass-visible-toggle')) {
          el('grass-visible-toggle').textContent = isGrassVis ? 'ON' : 'OFF';
          el('grass-visible-toggle').style.background = isGrassVis ? 'rgba(100,220,120,0.35)' : 'rgba(255,71,87,0.35)';
        }

        // Ground Visibility
        const gv = gd.groundVisible !== false; // Default true
        GRASS_PARAMS.groundVisible = gv;
        if (currentIsland && currentIsland.groundMesh) {
          currentIsland.groundMesh.visible = gv;
        }
        if (el('ground-visible-toggle')) {
          el('ground-visible-toggle').textContent = gv ? 'ON' : 'OFF';
          el('ground-visible-toggle').style.background = gv ? 'rgba(100,220,120,0.35)' : 'rgba(255,71,87,0.35)';
        }
        if (grassPatch.material.userData.shader) {
          const u = grassPatch.material.userData.shader.uniforms;
          u.uSwayStrength.value = gd.swayStr;
          u.uSwaySpeed.value = gd.swaySpd;
          u.uTimeScale.value = gd.timeScale;
        }
      } catch (e) { console.warn("Lvl settings load failed", e); }
    } else {
      // Safely ensure grass starts OFF if no save data exists at all
      grassPatch.group.visible = false;
      GRASS_PARAMS.visible = false;
      if (el('grass-visible-toggle')) {
        el('grass-visible-toggle').textContent = 'OFF';
        el('grass-visible-toggle').style.background = 'rgba(255,71,87,0.35)';
      }
    }
  };

  window.loadSaved = async () => {
    const key = `diorama_settings_lvl_${dioramaIndex}_env_${envIndex}`;

    // ── 1. Try project file first (most reliable) ────────────────────────────
    let saved = null;
    try {
      const r = await fetch('/settings.json?_=' + Date.now());
      if (r.ok) {
        const all = await r.json();
        if (all[key]) saved = JSON.stringify(all[key]);
        // Legacy key fallbacks inside the file
        if (!saved && envIndex === 0) saved = JSON.stringify(all[`diorama_settings_lvl_${dioramaIndex}_morning`]);
        if (!saved && envIndex === 1) saved = JSON.stringify(all[`diorama_settings_lvl_${dioramaIndex}_night`]);
      }
    } catch (_) { /* dev server not running or file missing */ }

    // ── 2. Fall back to localStorage ────────────────────────────────────────
    if (!saved) saved = localStorage.getItem(key);
    if (!saved && envIndex === 0) saved = localStorage.getItem(`diorama_settings_lvl_${dioramaIndex}_morning`);
    if (!saved && envIndex === 1) saved = localStorage.getItem(`diorama_settings_lvl_${dioramaIndex}_night`);
    if (!saved && envIndex === 0) saved = localStorage.getItem('diorama_morning_settings');
    if (!saved && envIndex === 1) saved = localStorage.getItem('diorama_night_settings');

    if (!saved) {
      syncUI();
      return;
    }
    const data = JSON.parse(saved);
    if (atmosphere) {
      atmosphere.material.uniforms.bottomColor.value.set(data.atmoBottom);
      atmosphere.material.uniforms.topColor.value.set(data.atmoTop);
      scene.background.set(data.atmoBottom);
    }
    if (scene.fog) scene.fog.color.set(data.fogCol);
    sun.intensity = data.sunInt;
    sun.color.set(data.sunCol);
    if (data.sunX !== undefined) sun.position.set(data.sunX, data.sunY, data.sunZ);

    if (data.celScale && moonGroup) {
      const vMoon = moonGroup.getObjectByName('VisualMoon');
      const vSun = moonGroup.getObjectByName('VisualSun');
      const glow = moonGroup.getObjectByName('CelestialGlow');
      if (vMoon) vMoon.scale.setScalar(data.celScale);
      if (vSun) vSun.scale.setScalar(data.celScale);
      if (glow) glow.scale.setScalar(data.celScale);
    }

    if (aurora && data.auroraInt !== undefined) {
      aurora.mesh.material.uniforms.uIntensity.value = data.auroraInt;
      aurora.mesh.material.uniforms.uColor1.value.set(data.auroraCol1);
      aurora.mesh.material.uniforms.uColor2.value.set(data.auroraCol2);
    }

    rimLight.intensity = data.rimInt;
    if (data.rimCol) rimLight.color.set(data.rimCol);
    fill.intensity = data.fillInt;
    if (data.fillCol) fill.color.set(data.fillCol);

    if (data.gBright !== undefined && gradingPass) {
      gradingPass.uniforms.brightness.value = data.gBright;
      gradingPass.uniforms.contrast.value = data.gContrast;
      gradingPass.uniforms.saturation.value = data.gSat;
      gradingPass.uniforms.gamma.value = data.gGamma;
    }

    if (data.cFov !== undefined) {
      perspCamera.fov = data.cFov;
      perspCamera.position.set(data.cPx, data.cPy, data.cPz);
      if (data.cTx !== undefined) controls.target.set(data.cTx, data.cTy, data.cTz);

      perspCamera.updateProjectionMatrix();
      controls.update();
    }

    if (data.atmoOffset !== undefined && atmosphere) {
      atmosphere.material.uniforms.offset.value = data.atmoOffset;
      atmosphere.material.uniforms.exponent.value = data.atmoExp;
    }
    syncUI();
  };

  // helpers: live update on oninput, push history on pointerup/change
  const withHist = (inputEl, fn) => {
    inputEl.oninput = (e) => fn(e);
    inputEl.onchange = () => histPush(); // fires after color picker closes OR slider released
  };

  withHist(el('p-bottom'), (e) => {
    if (atmosphere) atmosphere.material.uniforms.bottomColor.value.set(e.target.value);
    scene.background.set(e.target.value);
  });
  withHist(el('p-top'), (e) => { if (atmosphere) atmosphere.material.uniforms.topColor.value.set(e.target.value); });
  withHist(el('p-atmo-offset'), (e) => {
    const v = parseFloat(e.target.value);
    if (atmosphere) atmosphere.material.uniforms.offset.value = v;
    el('p-atmo-offset-val').textContent = v;
  });
  withHist(el('p-atmo-exp'), (e) => {
    const v = parseFloat(e.target.value);
    if (atmosphere) atmosphere.material.uniforms.exponent.value = v;
    el('p-atmo-exp-val').textContent = v.toFixed(2);
  });
  withHist(el('p-fog'), (e) => { if (scene.fog) scene.fog.color.set(e.target.value); });
  withHist(el('s-int'), (e) => { sun.intensity = parseFloat(e.target.value); });
  withHist(el('s-col'), (e) => { sun.color.set(e.target.value); });
  withHist(el('s-size'), (e) => {
    if (moonGroup) {
      const val = parseFloat(e.target.value);
      ['VisualMoon', 'VisualSun', 'CelestialGlow'].forEach(n => {
        const o = moonGroup.getObjectByName(n); if (o) o.scale.setScalar(val);
      });
    }
  });
  withHist(el('s-posX'), (e) => { sun.position.x = parseFloat(e.target.value); });
  withHist(el('s-posY'), (e) => { sun.position.y = parseFloat(e.target.value); });
  withHist(el('s-posZ'), (e) => { sun.position.z = parseFloat(e.target.value); });
  withHist(el('r-int'), (e) => { rimLight.intensity = parseFloat(e.target.value); });
  withHist(el('r-col'), (e) => { rimLight.color.set(e.target.value); });
  withHist(el('f-int'), (e) => { fill.intensity = parseFloat(e.target.value); });
  withHist(el('f-col'), (e) => { fill.color.set(e.target.value); });

  withHist(el('au-int'), (e) => {
    const v = parseFloat(e.target.value);
    if (aurora) aurora.mesh.material.uniforms.uIntensity.value = v;
    el('au-int-val').textContent = v.toFixed(1);
  });
  withHist(el('au-col1'), (e) => { if (aurora) aurora.mesh.material.uniforms.uColor1.value.set(e.target.value); });
  withHist(el('au-col2'), (e) => { if (aurora) aurora.mesh.material.uniforms.uColor2.value.set(e.target.value); });

  el('au-reset').onclick = () => {
    if (aurora) {
      aurora.mesh.material.uniforms.uIntensity.value = 1.0;
      aurora.mesh.material.uniforms.uColor1.value.set(0x00ff99);
      aurora.mesh.material.uniforms.uColor2.value.set(0x7c4dff);
      syncUI();
    }
  };

  // ── Shared: build settings object from current UI / scene state ─────────────
  function _buildSettings() {
    return {
      atmoBottom: el('p-bottom').value,
      atmoTop: el('p-top').value,
      fogCol: el('p-fog').value,
      sunInt: parseFloat(el('s-int').value),
      sunCol: el('s-col').value,
      celScale: parseFloat(el('s-size').value),
      sunX: parseFloat(el('s-posX').value),
      sunY: parseFloat(el('s-posY').value),
      sunZ: parseFloat(el('s-posZ').value),
      rimInt: parseFloat(el('r-int').value),
      rimCol: el('r-col').value,
      fillInt: parseFloat(el('f-int').value),
      fillCol: el('f-col').value,
      auroraInt: aurora ? parseFloat(el('au-int').value) : 1.0,
      auroraCol1: aurora ? el('au-col1').value : '#00ff99',
      auroraCol2: aurora ? el('au-col2').value : '#7c4dff',
      atmoOffset: parseFloat(el('p-atmo-offset').value),
      atmoExp: parseFloat(el('p-atmo-exp').value),
      gBright: parseFloat(el('g-bright').value),
      gContrast: parseFloat(el('g-contrast').value),
      gSat: parseFloat(el('g-sat').value),
      gGamma: parseFloat(el('g-gamma').value),
      cFov: perspCamera.fov,
      cPx: perspCamera.position.x,
      cPy: perspCamera.position.y,
      cPz: perspCamera.position.z,
      cTx: controls.target.x,
      cTy: controls.target.y,
      cTz: controls.target.z,
    };
  }

  // ── Write settings to both localStorage and public/settings.json ─────────────
  async function _persistSettings(key, settings) {
    // 1. localStorage (instant, works offline)
    localStorage.setItem(key, JSON.stringify(settings));

    // 2. project file via dev-server endpoint (survives cache clears)
    try {
      // Load existing file (or start fresh)
      let all = {};
      try {
        const r = await fetch('/settings.json');
        if (r.ok) all = await r.json();
      } catch (_) { /* file doesn't exist yet */ }

      all[key] = settings;

      await fetch('/api/save-settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(all),
      });
    } catch (e) {
      console.warn('[Settings] Could not write to file (dev server needed):', e);
    }
  }

  el('dev-save').onclick = async () => {
    const key = `diorama_settings_lvl_${dioramaIndex}_env_${envIndex}`;
    const settings = _buildSettings();
    await _persistSettings(key, settings);

    // Also trigger save for other systems
    if (el('grass-save')) el('grass-save').click();
    if (el('vol-save')) el('vol-save').click();
    if (el('glass-save')) el('glass-save').click();
    if (el('watermesh-save')) el('watermesh-save').click();

    alert(`Level ${dioramaIndex + 1} Settings Saved!`);
  };

  el('dev-reset').onclick = () => {
    if (confirm('Are you sure you want to WIPE settings?')) {
      localStorage.removeItem('diorama_morning_settings');
      localStorage.removeItem('diorama_night_settings');
      location.reload();
    }
  };

  // ── Migrate all localStorage diorama keys → settings.json (one-time rescue) ─
  el('dev-save').insertAdjacentHTML('afterend', `
    <button id="migrate-btn" style="background:#27ae60;color:white;border:none;padding:10px;border-radius:8px;cursor:pointer;font-weight:900;font-size:11px;letter-spacing:0.05em;margin-top:6px;width:100%;">
      💾 MIGRATE localStorage → FILE
    </button>
  `);
  document.getElementById('migrate-btn').onclick = async () => {
    const all = {};
    for (const k of Object.keys(localStorage)) {
      if (k.includes('diorama') || k.includes('settings') || k.includes('paint') || k.includes('grass') || k.includes('vol') || k.includes('glass') || k.includes('water') || k.includes('fire')) {
        try { all[k] = JSON.parse(localStorage.getItem(k)); } catch { all[k] = localStorage.getItem(k); }
      }
    }
    try {
      await fetch('/api/save-settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(all),
      });
      alert(`✅ ${Object.keys(all).length} kayıt dosyaya yazıldı!`);
    } catch (e) {
      alert('❌ Dev server çalışmıyor olabilir: ' + e);
    }
  };

  // ── Per-panel reset buttons ───────────────────────────────────────────────
  el('atmo-reset').onclick = () => {
    updateAtmosphere();
    syncUI();
  };

  el('light-reset').onclick = () => {
    // Night defaults
    if (isNight) {
      sun.color.set(0xa2d2ff); sun.intensity = 1.0;
      sun.position.set(-15, 20, -15);
      rimLight.color.set(0xffffff); rimLight.intensity = 0.8;
      fill.color.set(0x5a189a); fill.intensity = 0.4;
    } else {
      sun.color.set(0xfff4e0); sun.intensity = 2.0;
      sun.position.set(-15, 20, -15);
      rimLight.color.set(0xffffff); rimLight.intensity = 0.8;
      fill.color.set(0xfff0f0); fill.intensity = 0.4;
    }
    if (moonGroup) {
      ['VisualMoon', 'VisualSun', 'CelestialGlow'].forEach(n => {
        const o = moonGroup.getObjectByName(n); if (o) o.scale.setScalar(1);
      });
    }
    syncUI();
  };

  el('dof-reset').onclick = () => {
    // DOF
    dofEnabled = false;
    bokehPass.enabled = false;
    bokehPass.uniforms['focus'].value = 7.5;
    bokehPass.uniforms['aperture'].value = 0.006;
    bokehPass.uniforms['maxblur'].value = 0.012;
    // Bloom
    bloomPass.strength = 0.35;
    bloomPass.threshold = 0.85;
    // UI sync
    el('d-toggle').textContent = 'OFF';
    el('d-toggle').style.background = 'rgba(255,255,255,0.1)';
    el('d-focus').value = 7.5; el('d-focus-val').textContent = '7.5';
    el('d-aperture').value = 0.006; el('d-aperture-val').textContent = '0.006';
    el('d-maxblur').value = 0.012; el('d-maxblur-val').textContent = '0.012';
    el('b-strength').value = 0.35; el('b-strength-val').textContent = '0.35';
    el('b-threshold').value = 0.85; el('b-threshold-val').textContent = '0.85';
    if (dofBtn) {
      dofBtn.style.color = 'rgba(255,255,255,0.55)';
      dofBtn.style.background = 'rgba(255,255,255,0.08)';
      dofBtn.style.borderColor = 'rgba(255,255,255,0.18)';
    }
  };

  el('cel-reset').onclick = () => {
    Object.assign(celParams, CEL_DEFAULTS);
    applyCelToIsland(currentIsland);
    // UI sync
    const setToggleBtn = (btn, on) => {
      if (!btn) return;
      btn.textContent = on ? 'ON' : 'OFF';
      btn.style.background = on ? 'rgba(100,220,120,0.35)' : 'rgba(255,255,255,0.1)';
    };
    setToggleBtn(el('cel-toggle'), celParams.enabled);
    setToggleBtn(el('cel-origcol'), celParams.useOriginalColors);
    setToggleBtn(el('cel-outline-toggle'), celParams.outlineEnabled);
    el('cel-steps').value = celParams.steps;
    el('cel-steps-val').textContent = celParams.steps;
    el('cel-thick').value = celParams.outlineThickness;
    el('cel-thick-val').textContent = celParams.outlineThickness.toFixed(3);
    el('cel-outline-color').value = celParams.outlineColor;
    el('cel-bright').value = celParams.brightness;
    el('cel-bright-val').textContent = celParams.brightness.toFixed(2);
    el('cel-sat').value = celParams.saturation;
    el('cel-sat-val').textContent = celParams.saturation.toFixed(2);
  };

  el('dev-code').onclick = () => {
    const code = `
// Atmosphere / Light Settings (${isNight ? 'NIGHT' : 'MORNING'})
isNight?
  scene.background.set("${el('p-bottom').value}");
  scene.fog.color.set("${el('p-fog').value}");
  sun.intensity = ${el('s-int').value};
  sun.color.set("${el('s-col').value}");
  sun.position.set(${el('s-posX').value}, ${el('s-posY').value}, ${el('s-posZ').value});

  if (moonGroup) {
    const vMoon = moonGroup.getObjectByName('VisualMoon');
    const vSun = moonGroup.getObjectByName('VisualSun');
    const glow = moonGroup.getObjectByName('CelestialGlow');
    const sc = ${el('s-size').value};
    if (vMoon) vMoon.scale.setScalar(sc);
    if (vSun) vSun.scale.setScalar(sc);
    if (glow) glow.scale.setScalar(sc);
  }

  rimLight.intensity = ${el('r-int').value};
  rimLight.color.set("${el('r-col').value}");
  fill.intensity = ${el('f-int').value};
  fill.color.set("${el('f-col').value}");
    `;
    console.log(code);
    alert('Code generated in console!');
  };

  document.querySelectorAll('.hide-trigger').forEach(btn => {
    btn.onclick = () => { container.style.display = 'none'; toggleBtn.style.display = 'block'; };
  });
  toggleBtn.onclick = () => { container.style.display = 'flex'; toggleBtn.style.display = 'none'; };

  // ── Walk Mode Panel ──────────────────────────────────────────────────────
  const walkPanel = document.createElement('div');
  walkPanel.style.cssText = `
    background: rgba(10, 10, 20, 0.9); 
    border: 1.5px solid rgba(255, 255, 255, 0.18);
    border-radius: 16px; padding: 16px; margin-bottom: 12px;
    box-shadow: 0 12px 48px rgba(0,0,0,0.6);
  `;
  walkPanel.innerHTML = `
    <div style="color:rgba(255,255,255,0.9); font-size:11px; font-weight:900; letter-spacing:0.12em; margin-bottom:14px; border-left:3px solid #ff4757; padding-left:8px;">⬤ NAVIGATION MODE</div>
    
    <div style="display:flex; gap:6px; margin-bottom:16px;">
      <button id="wm-orbit"  style="flex:1; padding:10px 4px; border-radius:10px; font-size:10px; font-weight:800; cursor:pointer; border:1.5px solid rgba(255,255,255,0.15); background:rgba(255,255,255,0.05); color:rgba(255,255,255,0.45); transition:all 0.2s;">ORBIT</button>
      <button id="wm-first"  style="flex:1; padding:10px 4px; border-radius:10px; font-size:10px; font-weight:800; cursor:pointer; border:1.5px solid rgba(255,255,255,0.15); background:rgba(255,255,255,0.05); color:rgba(255,255,255,0.45); transition:all 0.2s;">1ST PRSN</button>
      <button id="wm-third"  style="flex:1; padding:10px 4px; border-radius:10px; font-size:10px; font-weight:800; cursor:pointer; border:1.5px solid rgba(255,255,255,0.15); background:rgba(255,255,255,0.05); color:rgba(255,255,255,0.45); transition:all 0.2s;">3RD PRSN</button>
    </div>

    <div style="display:grid; grid-template-columns:50px 1fr 36px; align-items:center; gap:6px 8px; row-gap:10px; background:rgba(255,255,255,0.03); padding:10px; border-radius:10px;">
      <span style="color:rgba(255,255,255,0.4); font-size:10px; font-weight:700;">POS X</span>
      <input id="wm-px" type="range" min="-20" max="20" step="0.1" value="0" style="width:100%; accent-color:#ff4757; cursor:pointer;">
      <span id="wm-px-v" style="color:#fff; font-size:10px; font-weight:800; text-align:right;">0.0</span>

      <span style="color:rgba(255,255,255,0.4); font-size:10px; font-weight:700;">POS Z</span>
      <input id="wm-pz" type="range" min="-20" max="20" step="0.1" value="0" style="width:100%; accent-color:#ff4757; cursor:pointer;">
      <span id="wm-pz-v" style="color:#fff; font-size:10px; font-weight:800; text-align:right;">0.0</span>

      <span style="color:rgba(255,255,255,0.4); font-size:10px; font-weight:700;">SIZE</span>
      <input id="wm-scale" type="range" min="0.05" max="3" step="0.05" value="0.3" style="width:100%; accent-color:#ff4757; cursor:pointer;">
      <span id="wm-scale-v" style="color:#fff; font-size:10px; font-weight:800; text-align:right;">0.30</span>
    </div>

    <div style="display:flex; gap:6px; margin-top:12px;">
      <button id="wm-reset" style="flex:1; padding:8px; border-radius:10px; font-size:10px; font-weight:800; cursor:pointer; border:1.5px solid rgba(255,100,100,0.4); background:rgba(255,80,80,0.12); color:rgba(255,160,160,0.9); letter-spacing:0.04em; transition:all 0.2s;">↩ RESET POS</button>
    </div>

    <div style="background:rgba(255,180,50,0.1); border-radius:10px; padding:10px; margin-top:12px; border:1px solid rgba(255,180,50,0.2);">
      <div style="color:rgba(255,180,50,0.9); font-size:9px; font-weight:900; letter-spacing:0.06em; margin-bottom:5px;">KEYBOARD LEGEND</div>
      <div style="color:rgba(255,255,255,0.7); font-size:10px; line-height:1.5; font-weight:600;">WASD · Move<br>SPACE · Jump<br>MOUSE · Rotation</div>
    </div>
  `;
  // Insert at top of container (before first child)
  container.insertBefore(walkPanel, container.firstChild);

  // ── Main Save Panel ─────────────────────────────────────────────────────────
  const mainSavePanel = document.createElement('div');
  mainSavePanel.style.cssText = `
    background: rgba(10, 25, 15, 0.95);
    border: 2px solid #2ed573;
    border-radius: 12px; padding: 12px; margin-bottom: 12px;
    box-shadow: 0 4px 15px rgba(46, 213, 115, 0.4);
  `;
  mainSavePanel.innerHTML = `
    <button id="global-main-save" style="width:100%; background:linear-gradient(135deg, #2ed573, #7bed9f); color:#000; border:none; padding:12px; border-radius:8px; cursor:pointer; font-weight:900; font-size:12px; letter-spacing:0.05em; text-shadow:0 1px 2px rgba(255,255,255,0.5);">
      💾 SAVE LEVEL SETTINGS
    </button>
    <div style="text-align:center; color:rgba(255,255,255,0.7); font-size:9px; margin-top:8px;">
      Saves ALL settings (Light, PP, Grass, Glass, Volumetric) for Level <span id="main-save-lvl-id">1</span>
    </div>
  `;
  container.insertBefore(mainSavePanel, container.firstChild);

  // Sync the level id display in the save panel
  setInterval(() => {
    const lvlSpan = document.getElementById('main-save-lvl-id');
    if (lvlSpan) lvlSpan.textContent = (typeof dioramaIndex !== 'undefined' ? dioramaIndex + 1 : '?');
  }, 500);

  setTimeout(() => {
    const mainBtn = document.getElementById('global-main-save');
    if (mainBtn) {
      mainBtn.onclick = () => {
        // Trigger the lighting/PP save which also triggers the rest
        const devSave = document.getElementById('dev-save');
        if (devSave) devSave.click();

        mainBtn.textContent = 'SAVED ✓';
        mainBtn.style.background = '#1dd1a1';
        setTimeout(() => {
          mainBtn.innerHTML = '💾 SAVE LEVEL SETTINGS';
          mainBtn.style.background = 'linear-gradient(135deg, #2ed573, #7bed9f)';
        }, 2000);
      };
    }
  }, 1000);

  window._updateWalkBtns = function _updateWalkBtns() {
    const m = walkMode.mode;
    ['wm-orbit', 'wm-first', 'wm-third'].forEach(id => {
      const btn = document.getElementById(id);
      const active = (id === 'wm-' + m);
      if (active) {
        btn.style.background = m === 'orbit' ? 'rgba(100, 220, 120, 0.25)' :
          m === 'first' ? 'rgba(80, 180, 255, 0.25)' :
            'rgba(255, 160, 80, 0.25)';
        btn.style.borderColor = m === 'orbit' ? 'rgba(100, 220, 120, 0.6)' :
          m === 'first' ? 'rgba(80, 180, 255, 0.6)' :
            'rgba(255, 160, 80, 0.6)';
        btn.style.color = '#fff';
        btn.style.boxShadow = '0 0 15px rgba(255,255,255,0.1)';
      } else {
        btn.style.background = 'rgba(255,255,255,0.05)';
        btn.style.borderColor = 'rgba(255,255,255,0.15)';
        btn.style.color = 'rgba(255,255,255,0.45)';
        btn.style.boxShadow = 'none';
      }
    });
  }
  document.getElementById('wm-orbit').onclick = () => { walkMode.setMode('orbit'); window._updateWalkBtns(); };
  document.getElementById('wm-first').onclick = () => { walkMode.setMode('first'); window._updateWalkBtns(); };
  document.getElementById('wm-third').onclick = () => { walkMode.setMode('third'); window._updateWalkBtns(); };

  // Character position & scale sliders
  document.getElementById('wm-px').addEventListener('input', e => {
    const v = parseFloat(e.target.value);
    document.getElementById('wm-px-v').textContent = v.toFixed(1);
    walkMode.setCharacterPosition(v, walkMode.character.position.z);
  });
  document.getElementById('wm-pz').addEventListener('input', e => {
    const v = parseFloat(e.target.value);
    document.getElementById('wm-pz-v').textContent = v.toFixed(1);
    walkMode.setCharacterPosition(walkMode.character.position.x, v);
  });
  document.getElementById('wm-scale').addEventListener('input', e => {
    const v = parseFloat(e.target.value);
    document.getElementById('wm-scale-v').textContent = v.toFixed(2);
    walkMode.setCharacterScale(v);
  });
  document.getElementById('wm-reset').onclick = () => {
    walkMode.resetPosition();
    document.getElementById('wm-px').value = 0; document.getElementById('wm-px-v').textContent = '0.0';
    document.getElementById('wm-pz').value = 0; document.getElementById('wm-pz-v').textContent = '0.0';
  };

  // Expose globally for quick console switching
  window.setWalkMode = (m) => { walkMode.setMode(m); window._updateWalkBtns(); };

  // Mod değiştikçe ayarları yükle
  if (typeof themeSelect !== 'undefined' && themeSelect) {
    themeSelect.addEventListener('change', () => { setTimeout(window.loadSaved, 100); });
  }

  setTimeout(() => { window.loadSaved(); }, 500);

  // ── Volumetric Light logic ─────────────────────────────────────────────────
  setTimeout(() => {
    const volPickBtn = document.getElementById('vol-pick-btn');
    const volColorEl = document.getElementById('vol-color');
    const volIntEl = document.getElementById('vol-int');
    const volIntVal = document.getElementById('vol-int-val');
    const volDustEl = document.getElementById('vol-dust');
    const volDustVal = document.getElementById('vol-dust-val');
    const volNoiseEl = document.getElementById('vol-noise');
    const volNoiseVal = document.getElementById('vol-noise-val');
    const volEdgeEl = document.getElementById('vol-edge');
    const volEdgeVal = document.getElementById('vol-edge-val');
    const volDepthEl = document.getElementById('vol-depth');
    const volDepthVal = document.getElementById('vol-depth-val');
    const volSaveBtn = document.getElementById('vol-save');
    const volResetBtn = document.getElementById('vol-reset');
    if (!volPickBtn) return;

    // Sync UI to current (possibly saved) params
    volColorEl.value = volParams.color;
    volIntEl.value = volParams.intensity;
    volIntVal.textContent = volParams.intensity.toFixed(2);
    volDustEl.value = volParams.dustOpacity;
    volDustVal.textContent = volParams.dustOpacity.toFixed(2);
    volNoiseEl.value = volParams.noiseScale;
    volNoiseVal.textContent = volParams.noiseScale.toFixed(1);
    volEdgeEl.value = volParams.edgeSoftness;
    volEdgeVal.textContent = volParams.edgeSoftness.toFixed(2);
    volDepthEl.value = volParams.depthFade;
    volDepthVal.textContent = volParams.depthFade.toFixed(2);

    const setPickBtn = (on) => {
      volPickBtn.textContent = on ? 'ON' : 'OFF';
      volPickBtn.style.background = on ? 'rgba(255,220,80,0.35)' : 'rgba(255,255,255,0.1)';
      volPickBtn.style.color = on ? '#ffe08a' : 'white';
      document.body.style.cursor = on ? 'crosshair' : '';
    };
    volPickBtn.onclick = () => {
      volPickMode = !volPickMode;
      setPickBtn(volPickMode);
    };

    volColorEl.oninput = (e) => {
      volParams.color = e.target.value;
      updateVolMaterials(volMeshes, volParams, 0);
    };
    volIntEl.oninput = (e) => {
      volParams.intensity = parseFloat(e.target.value);
      volIntVal.textContent = volParams.intensity.toFixed(2);
    };
    volDustEl.oninput = (e) => {
      volParams.dustOpacity = parseFloat(e.target.value);
      volDustVal.textContent = volParams.dustOpacity.toFixed(2);
    };
    volNoiseEl.oninput = (e) => {
      volParams.noiseScale = parseFloat(e.target.value);
      volNoiseVal.textContent = volParams.noiseScale.toFixed(1);
    };
    volEdgeEl.oninput = (e) => {
      volParams.edgeSoftness = parseFloat(e.target.value);
      volEdgeVal.textContent = volParams.edgeSoftness.toFixed(2);
    };
    volDepthEl.oninput = (e) => {
      volParams.depthFade = parseFloat(e.target.value);
      volDepthVal.textContent = volParams.depthFade.toFixed(2);
    };

    volSaveBtn.onclick = () => {
      saveVolParams(volParams, dioramaIndex);
      saveVolMeshIds(volMeshes, dioramaIndex);
      volSaveBtn.textContent = 'SAVED ✓';
      setTimeout(() => { volSaveBtn.textContent = 'SAVE'; }, 1500);
    };

    volResetBtn.onclick = () => {
      Object.assign(volParams, VOL_DEFAULTS);
      // Reset UI
      volColorEl.value = volParams.color;
      volIntEl.value = volParams.intensity; volIntVal.textContent = volParams.intensity.toFixed(2);
      volDustEl.value = volParams.dustOpacity; volDustVal.textContent = volParams.dustOpacity.toFixed(2);
      volNoiseEl.value = volParams.noiseScale; volNoiseVal.textContent = volParams.noiseScale.toFixed(1);
      volEdgeEl.value = volParams.edgeSoftness; volEdgeVal.textContent = volParams.edgeSoftness.toFixed(2);
      volDepthEl.value = volParams.depthFade; volDepthVal.textContent = volParams.depthFade.toFixed(2);
      updateVolMaterials(volMeshes, volParams, 0);
    };

    _refreshVolList();
  }, 200);

  // ── Glass logic ────────────────────────────────────────────────────────────
  setTimeout(() => {
    const gPickBtn = document.getElementById('glass-pick-btn');
    const gColor = document.getElementById('glass-color');
    const gRimColor = document.getElementById('glass-rim-color');
    const gOpacity = document.getElementById('glass-opacity');
    const gOpacVal = document.getElementById('glass-opacity-val');
    const gFpow = document.getElementById('glass-fpow');
    const gFpowVal = document.getElementById('glass-fpow-val');
    const gFstr = document.getElementById('glass-fstr');
    const gFstrVal = document.getElementById('glass-fstr-val');
    const gIrid = document.getElementById('glass-irid');
    const gIridVal = document.getElementById('glass-irid-val');
    const gSave = document.getElementById('glass-save');
    const gReset = document.getElementById('glass-reset');
    if (!gPickBtn) return;

    // Sync UI
    gColor.value = glassParams.color;
    gRimColor.value = glassParams.rimColor;
    gOpacity.value = glassParams.opacity; gOpacVal.textContent = glassParams.opacity.toFixed(2);
    gFpow.value = glassParams.fresnelPow; gFpowVal.textContent = glassParams.fresnelPow.toFixed(1);
    gFstr.value = glassParams.fresnelStr; gFstrVal.textContent = glassParams.fresnelStr.toFixed(2);
    gIrid.value = glassParams.iridescence; gIridVal.textContent = glassParams.iridescence.toFixed(2);

    const setPickBtn = (btn, on, col) => {
      btn.textContent = on ? 'ON' : 'OFF';
      btn.style.background = on ? `rgba(${col},0.3)` : 'rgba(255,255,255,0.1)';
      btn.style.color = on ? `rgb(${col})` : 'white';
      document.body.style.cursor = (volPickMode || glassPickMode || waterPickMode) ? 'crosshair' : '';
    };

    gPickBtn.onclick = () => {
      glassPickMode = !glassPickMode;
      setPickBtn(gPickBtn, glassPickMode, '168,216,240');
    };

    gColor.oninput = (e) => { glassParams.color = e.target.value; updateGlassMaterials(glassMeshes, glassParams); };
    gRimColor.oninput = (e) => { glassParams.rimColor = e.target.value; updateGlassMaterials(glassMeshes, glassParams); };
    gOpacity.oninput = (e) => { glassParams.opacity = parseFloat(e.target.value); gOpacVal.textContent = glassParams.opacity.toFixed(2); };
    gFpow.oninput = (e) => { glassParams.fresnelPow = parseFloat(e.target.value); gFpowVal.textContent = glassParams.fresnelPow.toFixed(1); };
    gFstr.oninput = (e) => { glassParams.fresnelStr = parseFloat(e.target.value); gFstrVal.textContent = glassParams.fresnelStr.toFixed(2); };
    gIrid.oninput = (e) => { glassParams.iridescence = parseFloat(e.target.value); gIridVal.textContent = glassParams.iridescence.toFixed(2); };

    gSave.onclick = () => {
      saveGlassParams(glassParams, dioramaIndex); saveGlassMeshIds(glassMeshes, dioramaIndex);
      gSave.textContent = 'SAVED ✓'; setTimeout(() => { gSave.textContent = 'SAVE'; }, 1500);
    };
    gReset.onclick = () => {
      Object.assign(glassParams, GLASS_DEFAULTS);
      gColor.value = glassParams.color; gRimColor.value = glassParams.rimColor;
      gOpacity.value = glassParams.opacity; gOpacVal.textContent = glassParams.opacity.toFixed(2);
      gFpow.value = glassParams.fresnelPow; gFpowVal.textContent = glassParams.fresnelPow.toFixed(1);
      gFstr.value = glassParams.fresnelStr; gFstrVal.textContent = glassParams.fresnelStr.toFixed(2);
      gIrid.value = glassParams.iridescence; gIridVal.textContent = glassParams.iridescence.toFixed(2);
      updateGlassMaterials(glassMeshes, glassParams);
    };
    _refreshGlassList();
  }, 200);

  // ── Water (mesh) logic ─────────────────────────────────────────────────────
  setTimeout(() => {
    const wPickBtn = document.getElementById('watermesh-pick-btn');
    const wShallowCol = document.getElementById('wm-shallow-color');
    const wDeepCol = document.getElementById('wm-deep-color');
    const wCausticCol = document.getElementById('wm-caustic-color');
    const wOpacity = document.getElementById('wm-opacity');
    const wOpacVal = document.getElementById('wm-opacity-val');
    const wWave = document.getElementById('wm-wave');
    const wWaveVal = document.getElementById('wm-wave-val');
    const wSpeed = document.getElementById('wm-speed');
    const wSpeedVal = document.getElementById('wm-speed-val');
    const wCaustic = document.getElementById('wm-caustic');
    const wCausticVal = document.getElementById('wm-caustic-val');
    const wCscale = document.getElementById('wm-cscale');
    const wCscaleVal = document.getElementById('wm-cscale-val');
    const wSpec = document.getElementById('wm-spec');
    const wSpecVal = document.getElementById('wm-spec-val');
    const wFoam = document.getElementById('wm-foam');
    const wFoamVal = document.getElementById('wm-foam-val');
    const wTiling = document.getElementById('wm-tiling');
    const wTilingVal = document.getElementById('wm-tiling-val');
    const wSave = document.getElementById('watermesh-save');
    const wReset = document.getElementById('watermesh-reset');
    if (!wPickBtn) return;

    const syncWUI = () => {
      const p = waterMeshParams;
      wShallowCol.value = p.shallowColor;
      wDeepCol.value = p.deepColor;
      wCausticCol.value = p.causticColor;
      wOpacity.value = p.opacity; wOpacVal.textContent = p.opacity.toFixed(2);
      wWave.value = p.waveHeight; wWaveVal.textContent = p.waveHeight.toFixed(3);
      wSpeed.value = p.waveSpeed; wSpeedVal.textContent = p.waveSpeed.toFixed(1);
      wCaustic.value = p.causticStr; wCausticVal.textContent = p.causticStr.toFixed(2);
      wCscale.value = p.causticScale; wCscaleVal.textContent = p.causticScale.toFixed(1);
      wSpec.value = p.specularStr; wSpecVal.textContent = p.specularStr.toFixed(2);
      wFoam.value = p.edgeFoam; wFoamVal.textContent = p.edgeFoam.toFixed(2);
      wTiling.value = p.tiling; wTilingVal.textContent = p.tiling.toFixed(1);
    };
    syncWUI();

    wPickBtn.onclick = () => {
      waterPickMode = !waterPickMode;
      wPickBtn.textContent = waterPickMode ? 'ON' : 'OFF';
      wPickBtn.style.background = waterPickMode ? 'rgba(0,212,176,0.3)' : 'rgba(255,255,255,0.1)';
      wPickBtn.style.color = waterPickMode ? '#00d4b0' : 'white';
      document.body.style.cursor = (volPickMode || glassPickMode || waterPickMode) ? 'crosshair' : '';
    };

    wShallowCol.oninput = (e) => { waterMeshParams.shallowColor = e.target.value; };
    wDeepCol.oninput = (e) => { waterMeshParams.deepColor = e.target.value; };
    wCausticCol.oninput = (e) => { waterMeshParams.causticColor = e.target.value; };
    wOpacity.oninput = (e) => { waterMeshParams.opacity = parseFloat(e.target.value); wOpacVal.textContent = waterMeshParams.opacity.toFixed(2); };
    wWave.oninput = (e) => { waterMeshParams.waveHeight = parseFloat(e.target.value); wWaveVal.textContent = waterMeshParams.waveHeight.toFixed(3); };
    wSpeed.oninput = (e) => { waterMeshParams.waveSpeed = parseFloat(e.target.value); wSpeedVal.textContent = waterMeshParams.waveSpeed.toFixed(1); };
    wCaustic.oninput = (e) => { waterMeshParams.causticStr = parseFloat(e.target.value); wCausticVal.textContent = waterMeshParams.causticStr.toFixed(2); };
    wCscale.oninput = (e) => { waterMeshParams.causticScale = parseFloat(e.target.value); wCscaleVal.textContent = waterMeshParams.causticScale.toFixed(1); };
    wSpec.oninput = (e) => { waterMeshParams.specularStr = parseFloat(e.target.value); wSpecVal.textContent = waterMeshParams.specularStr.toFixed(2); };
    wFoam.oninput = (e) => { waterMeshParams.edgeFoam = parseFloat(e.target.value); wFoamVal.textContent = waterMeshParams.edgeFoam.toFixed(2); };
    wTiling.oninput = (e) => { waterMeshParams.tiling = parseFloat(e.target.value); wTilingVal.textContent = waterMeshParams.tiling.toFixed(1); };

    wSave.onclick = () => {
      saveWaterParams(waterMeshParams, dioramaIndex); saveWaterMeshIds(waterMeshSet, dioramaIndex);
      wSave.textContent = 'SAVED ✓'; setTimeout(() => { wSave.textContent = 'SAVE'; }, 1500);
    };
    wReset.onclick = () => {
      Object.assign(waterMeshParams, WATER_DEFAULTS);
      syncWUI();
    };
    _refreshWaterList();
  }, 200);
}
setupDevTools();
updateAtmosphere();

// ── Walk mode toolbar button ──────────────────────────────────────────────────
{
  const WALK_CYCLE = ['orbit', 'first', 'third'];
  const WALK_LABELS = { orbit: '🌐 ORBIT', first: '👁 1ST', third: '🧍 3RD' };
  const wmBtn = document.getElementById('walk-mode-btn');
  const wmLabel = document.getElementById('walk-mode-label');
  if (wmBtn && wmLabel) {
    function _syncWalkBtn() {
      wmLabel.textContent = WALK_LABELS[walkMode.mode];
      wmBtn.style.color = walkMode.mode !== 'orbit' ? '#fff' : '';
      wmBtn.style.background = walkMode.mode !== 'orbit' ? 'rgba(255,255,255,0.18)' : '';
    }
    wmBtn.addEventListener('click', () => {
      const idx = WALK_CYCLE.indexOf(walkMode.mode);
      const next = WALK_CYCLE[(idx + 1) % WALK_CYCLE.length];
      walkMode.setMode(next);
      _syncWalkBtn();
      // Sync devtools buttons if panel is open
      if (typeof window._updateWalkBtns === 'function') window._updateWalkBtns();
    });
  }
}

