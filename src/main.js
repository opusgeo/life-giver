import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Island } from './Island.js';
import { DIORAMA_LIST, FARMHOUSE_FILES } from './dioramas.js';
import { preloadModels } from './glbCache.js';
import {
  animateBloom, createSparkle,
  createCompletionRain, createShapeshiftEffect,
  createFlightClouds, createStardust,
  createAtmosphere, createBackgroundClouds,
  createMoon, createCozyDust
} from './effects.js';
import {
  createComposer, resizeComposer, updateComposerCamera
} from './postprocessing.js';
import { applyCel, applyPBR, CEL_DEFAULTS, PBR_DEFAULTS } from './celShader.js';
import { clayMat } from './dioramas.js';

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
const bgCloudsTick = createBackgroundClouds(scene);
const moonGroup = createMoon(scene);

// ─── IŞIKLAR ───
const hemiLight = new THREE.HemisphereLight(0x4444ff, 0x020a1a, 0.3);
scene.add(hemiLight);

const sun = new THREE.DirectionalLight(0xa2d2ff, 1.2);
sun.position.set(-15, 20, -15); 
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.bias = -0.0005;
sun.shadow.radius = 2;
scene.add(sun);

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
const LENS_REF_MM   = 50;
const LENS_REF_DIST = 7;

function setLensMM(mm) {
  const prevMM = currentLensMM;
  currentLensMM = mm;

  perspCamera.fov = mmToFov(mm);
  perspCamera.updateProjectionMatrix();

  // ── Scale OrbitControls distance limits ──────────────────────────────────
  const scale       = mm / LENS_REF_MM;
  const idealDist   = LENS_REF_DIST * scale;
  controls.minDistance = Math.max(0.4,  idealDist * 0.35);
  controls.maxDistance = Math.min(300,  idealDist * 3.5);

  // ── Nudge camera distance to stay in the valid range ────────────────────
  const dir     = perspCamera.position.clone().sub(controls.target).normalize();
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
controls.enableDamping  = true;
controls.dampingFactor  = 0.06;

// ── Zoom ─────────────────────────────────────────────────────────────────────
controls.minDistance = 3;
controls.maxDistance = 11;
controls.zoomSpeed   = 1.2;

// ── Orbit ────────────────────────────────────────────────────────────────────
controls.rotateSpeed     = 0.7;
controls.minPolarAngle   = Math.PI / 12;    // can't look straight down
controls.maxPolarAngle   = Math.PI / 2.05;  // can't go below island

// ── Pan — middle mouse or right drag ─────────────────────────────────────────
controls.enablePan        = true;
controls.panSpeed         = 0.6;
controls.screenSpacePanning = true;   // pan parallel to screen (intuitive)

// Mouse button mapping: LEFT=orbit, MIDDLE=dolly→remap to pan, RIGHT=pan
controls.mouseButtons = {
  LEFT:   THREE.MOUSE.ROTATE,
  MIDDLE: THREE.MOUSE.PAN,
  RIGHT:  THREE.MOUSE.PAN,
};

// Touch: 1-finger rotate, 2-finger pinch-zoom
controls.touches = {
  ONE: THREE.TOUCH.ROTATE,
  TWO: THREE.TOUCH.DOLLY_PAN,
};

controls.target.set(0, 0.5, 0);
controls.update();

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
const themeBtn    = document.getElementById('theme-toggle');
const cameraBtn   = document.getElementById('camera-toggle');
const blurSlider  = document.getElementById('blur-slider');
const musicBtn   = document.getElementById('music-toggle');
musicBtn.classList.add('muted'); // Visual default
const sfxBtn     = document.getElementById('sfx-toggle');
const nextBtn     = document.getElementById('next-btn');
if (nextBtn) {
  nextBtn.style.display = 'none'; // Hide by default
  nextBtn.addEventListener('click', () => {
    if (phase === 'PLAYING') startShapeshift();
  });
}

cameraBtn.addEventListener('click', () => {
  if (activeCamera === perspCamera) {
    activeCamera = orthoCamera;
    cameraBtn.classList.add('isometric');
    lensPanel.style.display = 'none';
  } else {
    activeCamera = perspCamera;
    cameraBtn.classList.remove('isometric');
    lensPanel.style.display = '';
  }
  controls.object = activeCamera;
  controls.update();
  updateComposerCamera({ renderPass, bokehPass }, activeCamera, dofEnabled);
});

function updateAtmosphere() {
  const vMoon = moonGroup?.getObjectByName('VisualMoon');
  const vSun  = moonGroup?.getObjectByName('VisualSun');
  const glow = moonGroup?.getObjectByName('CelestialGlow');

  if (isNight) {
    scene.background = new THREE.Color(0x002147);
    if (scene.fog) scene.fog.color.set(0x011627);
    hemiLight.intensity = 0.2;
    sun.color.set(0xa2d2ff); sun.intensity = 1.0;
    fill.color.set(0x5a189a); fill.intensity = 0.3;
    if (stardust) stardust.mesh.visible = true;
    if (moonGroup) moonGroup.visible = true;
    if (vMoon) {
      vMoon.visible = true;
      vMoon.material.color.set(0xfff9e6).multiplyScalar(1.5);
    }
    if (vSun) vSun.visible = false;
    if (glow) glow.material.color.set(0xfff9e6).multiplyScalar(2.0);
    if (atmosphere) {
      atmosphere.material.uniforms.topColor.value.set(0x011627);
      atmosphere.material.uniforms.bottomColor.value.set(0x002147);
    }
  } else {
    scene.background = new THREE.Color(0x003366);
    if (scene.fog) scene.fog.color.set(0x87ceeb);
    hemiLight.intensity = 0.5;
    sun.color.set(0xfff4e0); sun.intensity = 2.0;
    fill.color.set(0xfff0f0); fill.intensity = 0.4;
    if (stardust) stardust.mesh.visible = false;
    if (moonGroup) moonGroup.visible = true;
    if (vMoon) vMoon.visible = false;
    if (vSun) {
      vSun.visible = true;
      vSun.material.color.set(0xffcc33).multiplyScalar(2.5);
    }
    if (glow) {
      glow.material.color.set(0xffcc33).multiplyScalar(3.0);
    }
    if (atmosphere) {
      atmosphere.material.uniforms.topColor.value.set(0x003366);
      atmosphere.material.uniforms.bottomColor.value.set(0x87ceeb);
    }
  }
}
updateAtmosphere();

themeBtn.addEventListener('click', () => {
  isNight = !isNight;
  updateAtmosphere();
  // Sync water colour with day/night mode
  currentIsland?.group.userData.waterSetNight?.(isNight);
});
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
  background: rgba(10, 10, 20, 0.72);
  border: 1.5px solid rgba(255,255,255,0.13);
  border-radius: 18px;
  padding: 12px 18px 10px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  z-index: 9999;
  backdrop-filter: blur(18px);
  box-shadow: 0 8px 32px rgba(0,0,0,0.45);
  user-select: none;
  min-width: 320px;
`;

// Header row: label + current mm display + slider
const lensHeader = document.createElement('div');
lensHeader.style.cssText = 'display:flex; align-items:center; gap:10px; width:100%;';

const lensLabel = document.createElement('span');
lensLabel.textContent = '⬤ LENS';
lensLabel.style.cssText = 'color:rgba(255,255,255,0.45); font-size:10px; font-weight:700; letter-spacing:0.1em; white-space:nowrap;';

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
    border: 1px solid rgba(255,255,255,0.15);
    color: rgba(255,255,255,0.6);
    border-radius: 12px;
    padding: 4px 9px;
    font-size: 10px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.15s;
    letter-spacing: 0.02em;
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
lensStyle.textContent = `.lens-preset.active { background: rgba(255,255,255,0.25) !important; color: #fff !important; border-color: rgba(255,255,255,0.5) !important; }`;
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
  bokehPass.enabled = dofEnabled && activeCamera.isPerspectiveCamera;
  dofBtn.style.color      = dofEnabled ? '#fff'                        : 'rgba(255,255,255,0.55)';
  dofBtn.style.background = dofEnabled ? 'rgba(255,255,255,0.22)'      : 'rgba(255,255,255,0.08)';
  dofBtn.style.borderColor = dofEnabled ? 'rgba(255,255,255,0.55)'     : 'rgba(255,255,255,0.18)';
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

// ─── UNDO / REDO HISTORY ──────────────────────────────────────────────────────
const _history = [];
let _histIdx   = -1;
const HIST_MAX = 40;

function _captureSnapshot() {
  return {
    cel: { ...celParams },
    atmoBottom: atmosphere?.material.uniforms.bottomColor.value.getHexString() ?? null,
    atmoTop:    atmosphere?.material.uniforms.topColor.value.getHexString()    ?? null,
    fogCol:     scene.fog ? scene.fog.color.getHexString() : null,
    sunInt:     sun.intensity,
    sunCol:     sun.color.getHexString(),
    sunX: sun.position.x, sunY: sun.position.y, sunZ: sun.position.z,
    rimInt: rimLight.intensity, rimCol: rimLight.color.getHexString(),
    fillInt: fill.intensity,   fillCol: fill.color.getHexString(),
    celScale: (() => { const v = moonGroup?.getObjectByName('VisualSun'); return v ? v.scale.x : 1; })(),
    dofEnabled,
    dofFocus:    bokehPass?.uniforms.focus.value    ?? 7.5,
    dofAperture: bokehPass?.uniforms.aperture.value ?? 0.006,
    dofMaxblur:  bokehPass?.uniforms.maxblur.value  ?? 0.012,
    bloomStr:    bloomPass?.strength  ?? 0.35,
    bloomThr:    bloomPass?.threshold ?? 0.92,
    pbr: { ...pbrParams },
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
    ['VisualMoon','VisualSun','CelestialGlow'].forEach(n => {
      const o = moonGroup.getObjectByName(n); if (o) o.scale.setScalar(snap.celScale);
    });
  }

  // DOF / Bloom
  if (bokehPass) {
    dofEnabled = snap.dofEnabled;
    bokehPass.enabled = dofEnabled && activeCamera.isPerspectiveCamera;
    bokehPass.uniforms.focus.value    = snap.dofFocus;
    bokehPass.uniforms.aperture.value = snap.dofAperture;
    bokehPass.uniforms.maxblur.value  = snap.dofMaxblur;
  }
  if (bloomPass) {
    bloomPass.strength  = snap.bloomStr;
    bloomPass.threshold = snap.bloomThr;
  }

  // PBR
  if (snap.pbr) {
    Object.assign(pbrParams, snap.pbr);
    if (!celParams.enabled) applyPBRToIsland(currentIsland);
  }

  // Sync dev-tools UI if open
  _syncDevUI(snap);
}

function _syncDevUI(snap) {
  const el = id => document.getElementById(id);
  const getEl = id => el(id);
  if (!getEl('p-bottom')) return; // panel not yet in DOM

  if (snap.atmoBottom) getEl('p-bottom').value = '#' + snap.atmoBottom;
  if (snap.atmoTop)    getEl('p-top').value    = '#' + snap.atmoTop;
  if (snap.fogCol)     getEl('p-fog').value    = '#' + snap.fogCol;
  getEl('s-int').value  = snap.sunInt;
  getEl('s-col').value  = '#' + snap.sunCol;
  getEl('s-posX').value = snap.sunX;
  getEl('s-posY').value = snap.sunY;
  getEl('s-posZ').value = snap.sunZ;
  getEl('r-int').value  = snap.rimInt;
  getEl('r-col').value  = '#' + snap.rimCol;
  getEl('f-int').value  = snap.fillInt;
  getEl('f-col').value  = '#' + snap.fillCol;
  if (getEl('s-size')) getEl('s-size').value = snap.celScale;

  // DOF
  const setBtn = (btn, on) => { if (!btn) return; btn.textContent = on ? 'ON' : 'OFF'; btn.style.background = on ? 'rgba(100,220,120,0.35)' : 'rgba(255,255,255,0.1)'; };
  setBtn(getEl('d-toggle'), snap.dofEnabled);
  if (getEl('d-focus'))    { getEl('d-focus').value    = snap.dofFocus;    getEl('d-focus-val').textContent    = snap.dofFocus.toFixed(1); }
  if (getEl('d-aperture')) { getEl('d-aperture').value = snap.dofAperture; getEl('d-aperture-val').textContent = snap.dofAperture.toFixed(3); }
  if (getEl('d-maxblur'))  { getEl('d-maxblur').value  = snap.dofMaxblur;  getEl('d-maxblur-val').textContent  = snap.dofMaxblur.toFixed(3); }
  if (getEl('b-strength')) { getEl('b-strength').value  = snap.bloomStr;   getEl('b-strength-val').textContent  = snap.bloomStr.toFixed(2); }
  if (getEl('b-threshold')){ getEl('b-threshold').value = snap.bloomThr;   getEl('b-threshold-val').textContent = snap.bloomThr.toFixed(2); }

  // Cel
  setBtn(getEl('cel-toggle'),         snap.cel.enabled);
  setBtn(getEl('cel-origcol'),        snap.cel.useOriginalColors);
  setBtn(getEl('cel-outline-toggle'), snap.cel.outlineEnabled);
  if (getEl('cel-steps'))  { getEl('cel-steps').value  = snap.cel.steps;             getEl('cel-steps-val').textContent  = snap.cel.steps; }
  if (getEl('cel-thick'))  { getEl('cel-thick').value  = snap.cel.outlineThickness;  getEl('cel-thick-val').textContent  = snap.cel.outlineThickness.toFixed(3); }
  if (getEl('cel-outline-color')) getEl('cel-outline-color').value = snap.cel.outlineColor;
  if (getEl('cel-bright')) { getEl('cel-bright').value = snap.cel.brightness;        getEl('cel-bright-val').textContent = snap.cel.brightness.toFixed(2); }
  if (getEl('cel-sat'))    { getEl('cel-sat').value    = snap.cel.saturation;        getEl('cel-sat-val').textContent    = snap.cel.saturation.toFixed(2); }

  // PBR
  if (snap.pbr) {
    if (getEl('pbr-rough'))    { getEl('pbr-rough').value    = snap.pbr.roughnessMult; getEl('pbr-rough-val').textContent   = snap.pbr.roughnessMult.toFixed(2); }
    if (getEl('pbr-metal'))    { getEl('pbr-metal').value    = snap.pbr.metalnessMult; getEl('pbr-metal-val').textContent   = snap.pbr.metalnessMult.toFixed(2); }
    if (getEl('pbr-emissive')) { getEl('pbr-emissive').value = snap.pbr.emissiveAdd;   getEl('pbr-emissive-val').textContent= snap.pbr.emissiveAdd.toFixed(2); }
    if (getEl('pbr-tint-color')) getEl('pbr-tint-color').value = snap.pbr.colorTint;
    if (getEl('pbr-tint'))     { getEl('pbr-tint').value     = snap.pbr.tintStrength;  getEl('pbr-tint-val').textContent    = snap.pbr.tintStrength.toFixed(2); }
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
let phase = 'PLAYING';
let dioramaIndex = 0;
let currentIsland = null;
let nextIsland    = null;
const ticks = [];

function setProgress(ratio) { if(progressBar) progressBar.style.width = (ratio * 100) + '%'; }
function setIslandLabel(name, index, total) { if(islandLabel) islandLabel.textContent = `✦ ${name}  ${index}/${total}`; }

function loadIsland(index) {
  const def = DIORAMA_LIST[index % DIORAMA_LIST.length];
  const island = new Island(def.build, scene);
  if (def.scale) island.group.scale.setScalar(def.scale);
  setIslandLabel(def.name, index + 1, DIORAMA_LIST.length);
  setProgress(0);
  return island;
}

preloadModels(FARMHOUSE_FILES).then(() => {
  currentIsland = loadIsland(0);
  applyCelToIsland(currentIsland);
});

// ─── ETKİLEŞİM (CLICK) ───
const raycaster = new THREE.Raycaster();
const pointer   = new THREE.Vector2();

window.addEventListener('pointerdown', (e) => {
  startAudio();
  if (e.target.closest('#tools-bar') || e.target.closest('#hud') || phase !== 'PLAYING') return;
  pointer.x = (e.clientX / window.innerWidth) * 2 - 1;
  pointer.y = -(e.clientY / window.innerHeight) * 2 + 1;
  raycaster.setFromCamera(pointer, activeCamera);
  
  const meshes = [];
  currentIsland?.objects.forEach(group => { group.traverse(n => { if(n.isMesh) meshes.push(n); }); });
  const hits = raycaster.intersectObjects(meshes, false);
  if (hits.length > 0) {
    let group = hits[0].object;
    while(group && !group.userData.interactable) group = group.parent;
    if (group && !group.userData.isAlive) {
      group.userData.isAlive = true;
      playKalimba();
      ticks.push(createCozyDust(group, scene));
      ticks.push(animateBloom(group, () => {
        currentIsland.aliveCount++;
        setProgress(currentIsland.aliveCount / currentIsland.totalInteractable);
        // After paint animation, re-apply active shader style to this group only
        if (celParams.enabled) applyCelToIsland(currentIsland);
        else if (Object.values(pbrParams).some((v, i) => v !== Object.values(PBR_DEFAULTS)[i]))
          applyPBRToIsland(currentIsland);
        
        if (currentIsland.isComplete) {
          if (nextBtn) {
            nextBtn.style.display = 'block';
            nextBtn.textContent = 'NEXT ✦';
          }
        }
      }));
      ticks.push(createSparkle(hits[0].point, 0xffffff, scene));
    }
  }
});

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

function startFlight(spiritRef) {
  phase = 'FLYING';
  dioramaIndex++;
  nextIsland = loadIsland(dioramaIndex);
  nextIsland.setPosition(0, 0, -55);
  // ... Uçuş mantığı buraya eklenebilir, şimdilik direkt geçiş:
  setTimeout(() => {
    currentIsland.dispose();
    currentIsland = nextIsland;
    nextIsland = null;
    currentIsland.setPosition(0, 0, 0);
    applyCelToIsland(currentIsland);
    phase = 'PLAYING';
    controls.enabled = true;
    if (nextBtn) nextBtn.style.display = 'none';
  }, 2000);
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
  bgCloudsTick(delta, elapsed, activeCamera);
  
  // AY HALESİ (Kameraya her zaman bakmalı)
  if (moonGroup) {
    moonGroup.children.forEach(child => {
      if (child.isMesh && child.geometry.type === 'PlaneGeometry') {
        child.lookAt(activeCamera.position);
      }
    });
  }

  for (let i = ticks.length - 1; i >= 0; i--) { if (ticks[i](delta)) ticks.splice(i, 1); }
  if (phase === 'PLAYING') {
    const worldPos = new THREE.Vector3();
    currentIsland?.group.getWorldPosition(worldPos);
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
    p.style.cssText = 'border:2px solid #ff4757; background:rgba(0,0,0,0.85); color:#fff; padding:15px; border-radius:12px; font-family:sans-serif; backdrop-filter:blur(10px); min-width:200px; box-shadow:0 8px 32px rgba(0,0,0,0.5);';
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
        <input type="range" id="d-focus" min="1" max="20" step="0.1" value="7.5" style="width:100%">
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

    container.appendChild(createPanel('ATMOSPHERE', atmoContent));
    container.appendChild(createPanel('LIGHTING', lightContent));
    container.appendChild(createPanel('LENS & GLOW', dofContent));
    container.appendChild(createPanel('GRADING', gradingContent));
    container.appendChild(createPanel('CAMERA', cameraContent));
    container.appendChild(createPanel('MATERIAL SHADER', matContent));

  // --- LOGIC ---
  const el = (id) => document.getElementById(id);
  const getHex = (c) => '#' + (c ? c.getHexString() : 'ffffff');

  // ── CEL SHADER logic ──────────────────────────────────────────────────────
  setTimeout(() => {
    const celToggle        = el('cel-toggle');
    const celOrigCol       = el('cel-origcol');
    const celSteps         = el('cel-steps');
    const celStepsVal      = el('cel-steps-val');
    const celOutlineToggle = el('cel-outline-toggle');
    const celThick         = el('cel-thick');
    const celThickVal      = el('cel-thick-val');
    const celOutlineColor  = el('cel-outline-color');
    const celBright        = el('cel-bright');
    const celBrightVal     = el('cel-bright-val');
    const celSat           = el('cel-sat');
    const celSatVal        = el('cel-sat-val');
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
    const tabCel  = el('mat-tab-cel');
    const tabPbr  = el('mat-tab-pbr');
    const paneCel = el('mat-pane-cel');
    const panePbr = el('mat-pane-pbr');
    const activateTab = (tab) => {
      const isCel = tab === 'cel';
      tabCel.style.background  = isCel ? 'rgba(120,200,255,0.18)' : 'rgba(255,255,255,0.05)';
      tabCel.style.color       = isCel ? '#7cf' : 'rgba(255,255,255,0.4)';
      tabPbr.style.background  = isCel ? 'rgba(255,255,255,0.05)' : 'rgba(255,160,80,0.18)';
      tabPbr.style.color       = isCel ? 'rgba(255,255,255,0.4)' : '#fa8';
      paneCel.style.display    = isCel ? 'flex' : 'none';
      panePbr.style.display    = isCel ? 'none' : 'flex';
    };
    tabCel.onclick = () => activateTab('cel');
    tabPbr.onclick = () => activateTab('pbr');

    // ── PBR controls ────────────────────────────────────────────────────────
    const pbrToggle  = el('pbr-toggle');
    const pbrRough   = el('pbr-rough');
    const pbrRoughV  = el('pbr-rough-val');
    const pbrMetal   = el('pbr-metal');
    const pbrMetalV  = el('pbr-metal-val');
    const pbrEmissive= el('pbr-emissive');
    const pbrEmissiveV=el('pbr-emissive-val');
    const pbrTintCol = el('pbr-tint-color');
    const pbrTint    = el('pbr-tint');
    const pbrTintV   = el('pbr-tint-val');

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
      pbrRough.value    = PBR_DEFAULTS.roughnessMult; pbrRoughV.textContent   = PBR_DEFAULTS.roughnessMult.toFixed(2);
      pbrMetal.value    = PBR_DEFAULTS.metalnessMult; pbrMetalV.textContent   = PBR_DEFAULTS.metalnessMult.toFixed(2);
      pbrEmissive.value = PBR_DEFAULTS.emissiveAdd;   pbrEmissiveV.textContent= PBR_DEFAULTS.emissiveAdd.toFixed(2);
      pbrTintCol.value  = PBR_DEFAULTS.colorTint;
      pbrTint.value     = PBR_DEFAULTS.tintStrength;  pbrTintV.textContent    = PBR_DEFAULTS.tintStrength.toFixed(2);
    };

    // ── Global Scene Tools ──────────────────────────────────────────────────
    el('paint-all-btn').onclick = () => {
      if (!currentIsland) return;
      histPush();
      currentIsland.objects.forEach(group => {
        if (group.userData.interactable && !group.userData.isAlive) {
          group.userData.isAlive = true;
          currentIsland.aliveCount++;
          ticks.push(createCozyDust(group, scene));
          ticks.push(animateBloom(group));
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
        el('g-sat').value = u.saturation.value;    el('g-sat-val').textContent = u.saturation.value.toFixed(2);
        el('g-gamma').value = u.gamma.value;       el('g-gamma-val').textContent = u.gamma.value.toFixed(2);
      }
    }

    if (el('c-fov')) {
      el('c-fov').value = perspCamera.fov; el('c-fov-val').textContent = Math.round(perspCamera.fov);
      el('c-px').value = perspCamera.position.x; el('c-px-val').textContent = perspCamera.position.x.toFixed(1);
      el('c-py').value = perspCamera.position.y; el('c-py-val').textContent = perspCamera.position.y.toFixed(1);
      el('c-pz').value = perspCamera.position.z; el('c-pz-val').textContent = perspCamera.position.z.toFixed(1);
      el('c-tx').value = controls.target.x;      el('c-tx-val').textContent = controls.target.x.toFixed(1);
      el('c-ty').value = controls.target.y;      el('c-ty-val').textContent = controls.target.y.toFixed(1);
      el('c-tz').value = controls.target.z;      el('c-tz-val').textContent = controls.target.z.toFixed(1);
    }
  };

  // ── DOF & Bloom controls (wired after DOM is ready) ──────────────────────
  setTimeout(() => {
    const dToggle = el('d-toggle');
    const dFocus     = el('d-focus');
    const dAperture  = el('d-aperture');
    const dMaxblur   = el('d-maxblur');
    const bStrength  = el('b-strength');
    const bThreshold = el('b-threshold');
    if (!dToggle) return;

    const refreshDofToggle = () => {
      const on = bokehPass.enabled;
      dToggle.textContent = on ? 'ON' : 'OFF';
      dToggle.style.background = on ? 'rgba(100,220,120,0.35)' : 'rgba(255,255,255,0.1)';
      // also sync the toolbar DOF button
      if (dofBtn) {
        dofBtn.style.color       = on ? '#fff'                   : 'rgba(255,255,255,0.55)';
        dofBtn.style.background  = on ? 'rgba(255,255,255,0.22)' : 'rgba(255,255,255,0.08)';
        dofBtn.style.borderColor = on ? 'rgba(255,255,255,0.55)' : 'rgba(255,255,255,0.18)';
      }
    };

    dToggle.onclick = () => {
      histPush();
      dofEnabled = !dofEnabled;
      bokehPass.enabled = dofEnabled && activeCamera.isPerspectiveCamera;
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
    const gBright   = el('g-bright');
    const gContrast = el('g-contrast');
    const gSat      = el('g-sat');
    const gGamma    = el('g-gamma');

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
      gradingPass.uniforms.contrast.value   = 1.22;
      gradingPass.uniforms.saturation.value = 1.07;
      gradingPass.uniforms.gamma.value      = 1.17;
      gBright.value = 0.06;   el('g-bright-val').textContent = '0.06';
      gContrast.value = 1.22; el('g-contrast-val').textContent = '1.22';
      gSat.value = 1.07;      el('g-sat-val').textContent = '1.07';
      gGamma.value = 1.17;    el('g-gamma-val').textContent = '1.17';
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
    cPx.oninput  = (e) => { el('c-px-val').textContent = parseFloat(e.target.value).toFixed(1); updateCam(); };
    cPy.oninput  = (e) => { el('c-py-val').textContent = parseFloat(e.target.value).toFixed(1); updateCam(); };
    cPz.oninput  = (e) => { el('c-pz-val').textContent = parseFloat(e.target.value).toFixed(1); updateCam(); };
    cTx.oninput  = (e) => { el('c-tx-val').textContent = parseFloat(e.target.value).toFixed(1); updateCam(); };
    cTy.oninput  = (e) => { el('c-ty-val').textContent = parseFloat(e.target.value).toFixed(1); updateCam(); };
    cTz.oninput  = (e) => { el('c-tz-val').textContent = parseFloat(e.target.value).toFixed(1); updateCam(); };
    
    el('cam-reset').onclick = () => {
      histPush();
      cFov.value = 35; cPx.value = -6; cPy.value = 3.5; cPz.value = 6;
      cTx.value = 0; cTy.value = 0.5; cTz.value = 0;
      ['c-fov','c-px','c-py','c-pz','c-tx','c-ty','c-tz'].forEach(id => el(id+'-val').textContent = el(id).value);
      updateCam();
    };
    el('cam-save').onclick = () => el('dev-save').click();
  }, 200);

  const loadSaved = () => {
    const key = isNight ? 'diorama_night_settings' : 'diorama_morning_settings';
    const saved = localStorage.getItem(key);
    if (!saved) {
      // No saved data — just sync UI to reflect the current scene values (set by updateAtmosphere)
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

    rimLight.intensity = data.rimInt;
    if (data.rimCol) rimLight.color.set(data.rimCol);
    fill.intensity = data.fillInt;
    if (data.fillCol) fill.color.set(data.fillCol);

    if (data.gBright !== undefined && gradingPass) {
      gradingPass.uniforms.brightness.value = data.gBright;
      gradingPass.uniforms.contrast.value   = data.gContrast;
      gradingPass.uniforms.saturation.value = data.gSat;
      gradingPass.uniforms.gamma.value      = data.gGamma;
    }

    if (data.cFov !== undefined) {
      perspCamera.fov = data.cFov;
      perspCamera.position.set(data.cPx, data.cPy, data.cPz);
      if (data.cTx !== undefined) controls.target.set(data.cTx, data.cTy, data.cTz);
      
      perspCamera.updateProjectionMatrix();
      controls.update();
    }

    if (data.atmoOffset !== undefined && atmosphere) {
      atmosphere.material.uniforms.offset.value   = data.atmoOffset;
      atmosphere.material.uniforms.exponent.value = data.atmoExp;
    }
    syncUI();
  };

  // helpers: live update on oninput, push history on pointerup/change
  const withHist = (inputEl, fn) => {
    inputEl.oninput   = (e) => fn(e);
    inputEl.onchange  = () => histPush(); // fires after color picker closes OR slider released
  };

  withHist(el('p-bottom'), (e) => {
    if (atmosphere) atmosphere.material.uniforms.bottomColor.value.set(e.target.value);
    scene.background.set(e.target.value);
  });
  withHist(el('p-top'),  (e) => { if (atmosphere) atmosphere.material.uniforms.topColor.value.set(e.target.value); });
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
  withHist(el('p-fog'),  (e) => { if (scene.fog) scene.fog.color.set(e.target.value); });
  withHist(el('s-int'),  (e) => { sun.intensity = parseFloat(e.target.value); });
  withHist(el('s-col'),  (e) => { sun.color.set(e.target.value); });
  withHist(el('s-size'), (e) => {
    if (moonGroup) {
      const val = parseFloat(e.target.value);
      ['VisualMoon','VisualSun','CelestialGlow'].forEach(n => {
        const o = moonGroup.getObjectByName(n); if (o) o.scale.setScalar(val);
      });
    }
  });
  withHist(el('s-posX'), (e) => { sun.position.x = parseFloat(e.target.value); });
  withHist(el('s-posY'), (e) => { sun.position.y = parseFloat(e.target.value); });
  withHist(el('s-posZ'), (e) => { sun.position.z = parseFloat(e.target.value); });
  withHist(el('r-int'),  (e) => { rimLight.intensity = parseFloat(e.target.value); });
  withHist(el('r-col'),  (e) => { rimLight.color.set(e.target.value); });
  withHist(el('f-int'),  (e) => { fill.intensity = parseFloat(e.target.value); });
  withHist(el('f-col'),  (e) => { fill.color.set(e.target.value); });

    el('dev-save').onclick = () => {
      const key = isNight ? 'diorama_night_settings' : 'diorama_morning_settings';
      const settings = {
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
        atmoOffset: parseFloat(el('p-atmo-offset').value),
        atmoExp: parseFloat(el('p-atmo-exp').value),
        gBright: parseFloat(el('g-bright').value),
        gContrast: parseFloat(el('g-contrast').value),
        gSat: parseFloat(el('g-sat').value),
        gGamma: parseFloat(el('g-gamma').value),
        // Live camera capture
        cFov: perspCamera.fov,
        cPx: perspCamera.position.x,
        cPy: perspCamera.position.y,
        cPz: perspCamera.position.z,
        cTx: controls.target.x,
        cTy: controls.target.y,
        cTz: controls.target.z
      };
      localStorage.setItem(key, JSON.stringify(settings));
      alert(`${isNight ? 'NIGHT' : 'MORNING'} Viewport Settings Saved!`);
    };

  el('dev-reset').onclick = () => {
    if (confirm('Are you sure you want to WIPE settings?')) {
      localStorage.removeItem('diorama_morning_settings');
      localStorage.removeItem('diorama_night_settings');
      location.reload();
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
      ['VisualMoon','VisualSun','CelestialGlow'].forEach(n => {
        const o = moonGroup.getObjectByName(n); if (o) o.scale.setScalar(1);
      });
    }
    syncUI();
  };

  el('dof-reset').onclick = () => {
    // DOF
    dofEnabled = false;
    bokehPass.enabled = true;
    bokehPass.uniforms['focus'].value    = 7.5;
    bokehPass.uniforms['aperture'].value = 0.006;
    bokehPass.uniforms['maxblur'].value  = 0.012;
    // Bloom
    bloomPass.strength   = 0.35;
    bloomPass.threshold  = 0.92;
    // UI sync
    el('d-toggle').textContent = 'OFF';
    el('d-toggle').style.background = 'rgba(255,255,255,0.1)';
    el('d-focus').value      = 7.5;   el('d-focus-val').textContent    = '7.5';
    el('d-aperture').value   = 0.006; el('d-aperture-val').textContent = '0.006';
    el('d-maxblur').value    = 0.012; el('d-maxblur-val').textContent  = '0.012';
    el('b-strength').value   = 0.35;  el('b-strength-val').textContent = '0.35';
    el('b-threshold').value  = 0.92;  el('b-threshold-val').textContent = '0.92';
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
    setToggleBtn(el('cel-toggle'),         celParams.enabled);
    setToggleBtn(el('cel-origcol'),        celParams.useOriginalColors);
    setToggleBtn(el('cel-outline-toggle'), celParams.outlineEnabled);
    el('cel-steps').value         = celParams.steps;
    el('cel-steps-val').textContent = celParams.steps;
    el('cel-thick').value         = celParams.outlineThickness;
    el('cel-thick-val').textContent = celParams.outlineThickness.toFixed(3);
    el('cel-outline-color').value = celParams.outlineColor;
    el('cel-bright').value        = celParams.brightness;
    el('cel-bright-val').textContent = celParams.brightness.toFixed(2);
    el('cel-sat').value           = celParams.saturation;
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

  // Mod değiştikçe ayarları yükle
  themeBtn.addEventListener('click', () => { setTimeout(loadSaved, 100); });

  setTimeout(() => { loadSaved(); }, 1000);
}
setupDevTools();
