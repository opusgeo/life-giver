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

// ─── RENDERER SETUP ───
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap; 
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;
renderer.localClippingEnabled = true;
document.body.appendChild(renderer.domElement);

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
const perspCamera = new THREE.PerspectiveCamera(38, window.innerWidth / window.innerHeight, 0.1, 150);
perspCamera.position.set(4.8, 3.5, 4.8); 

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

const controls = new OrbitControls(activeCamera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.07;
controls.minDistance = 3; 
controls.maxDistance = 11;
controls.maxPolarAngle = Math.PI / 2.05;
controls.target.set(0, 0.5, 0);
controls.update();

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

const sfxKalimba = new THREE.Audio(listener);
audioLoader.load('/sfx/kalimba.mp3', (buffer) => {
  sfxKalimba.setBuffer(buffer);
  sfxKalimba.setVolume(0.6);
});

const MELODIES = [
  [1.0, 1.0, 1.5, 1.5, 1.66, 1.66, 1.5, 1.33, 1.33, 1.25, 1.25, 1.12, 1.12, 1.0],
  [1.0, 0.75, 0.84, 0.63, 0.67, 0.5, 0.67, 0.75, 1.0, 1.12, 1.25, 1.33, 1.5, 1.66, 1.88, 2.0],
  [1.25, 1.25, 1.5, 1.25, 1.25, 1.5, 1.25, 1.5, 2.0, 1.88, 1.66, 1.5, 1.12, 1.25, 1.33, 1]
];
let selectedMelody = MELODIES[Math.floor(Math.random() * MELODIES.length)];
let melodyIndex = 0;

function playKalimba() {
  if (sfxKalimba.isPlaying) sfxKalimba.stop();
  const pitch = selectedMelody[melodyIndex % selectedMelody.length];
  sfxKalimba.setPlaybackRate(pitch);
  sfxKalimba.play();
  melodyIndex++;
}

let audioStarted = false;
function startAudio() {
  if (!audioStarted && ambientBirds.buffer) {
    ambientBirds.play();
    audioStarted = true;
  }
}

// ─── UI YOLLARI & ETKİLEŞİM ───
const progressBar = document.getElementById('progress-bar');
const islandLabel = document.getElementById('island-label');
const themeBtn    = document.getElementById('theme-toggle');
const cameraBtn   = document.getElementById('camera-toggle');
const blurSlider  = document.getElementById('blur-slider');
const soundBtn    = document.getElementById('sound-toggle');
const nextBtn     = document.getElementById('next-btn');

cameraBtn.addEventListener('click', () => {
  if (activeCamera === perspCamera) {
    activeCamera = orthoCamera;
    cameraBtn.classList.add('isometric');
  } else {
    activeCamera = perspCamera;
    cameraBtn.classList.remove('isometric');
  }
  controls.object = activeCamera;
  controls.update();
});

let isNight = true; 
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
    if (vMoon) vMoon.visible = true;
    if (vSun) vSun.visible = false;
    if (glow) glow.material.color.set(0xfff9e6);
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
    if (vSun) vSun.visible = true;
    if (glow) glow.material.color.set(0xffcc33);
    if (atmosphere) {
      atmosphere.material.uniforms.topColor.value.set(0x003366);
      atmosphere.material.uniforms.bottomColor.value.set(0x87ceeb);
    }
  }
}
updateAtmosphere();

themeBtn.addEventListener('click', () => { isNight = !isNight; updateAtmosphere(); });
soundBtn.addEventListener('click', () => { 
  let isMuted = listener.getMasterVolume() === 0;
  listener.setMasterVolume(isMuted ? 1 : 0);
  soundBtn.classList.toggle('muted', !isMuted);
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
        if (currentIsland.isComplete) setTimeout(startShapeshift, 500);
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
    phase = 'PLAYING';
    controls.enabled = true;
  }, 2000);
}

window.addEventListener('resize', () => {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w, h);
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
  }
  
  renderer.render(scene, activeCamera);
}
animate();

function setupDevTools() {
  const toggleBtn = document.createElement('button');
  toggleBtn.innerHTML = '🪄';
  toggleBtn.style.cssText = 'position:fixed; top:100px; right:20px; z-index:10001; background:rgba(0,0,0,0.6); border:none; border-radius:50%; width:40px; height:40px; color:white; cursor:pointer; font-size:20px; display:none; backdrop-filter:blur(5px); box-shadow: 0 4px 12px rgba(0,0,0,0.3);';
  document.body.appendChild(toggleBtn);

  const container = document.createElement('div');
  container.id = 'dev-tools-container';
  container.style.cssText = 'position:fixed; top:100px; right:20px; display:flex; flex-direction:column; gap:15px; z-index:10000; pointer-events:auto;';
  document.body.appendChild(container);

  const createPanel = (title, content) => {
    const p = document.createElement('div');
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
        <button id="dev-reset" style="background:#ff4757; color:white; border:none; padding:6px; border-radius:4px; cursor:pointer; font-weight:bold; font-size:9px; opacity:0.8;">RESET SETTINGS (WIPE)</button>
      </div>
    </div>
  `;

  container.appendChild(createPanel('ATMOSPHERE TOOLS', atmoContent));
  container.appendChild(createPanel('LIGHT TOOLS', lightContent));

  // --- LOGIC ---
  const el = (id) => document.getElementById(id);
  const getHex = (c) => '#' + (c ? c.getHexString() : 'ffffff');

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

    el('r-int').value = rimLight.intensity;
    el('r-col').value = getHex(rimLight.color);
    el('f-int').value = fill.intensity;
    el('f-col').value = getHex(fill.color);
  };

  const loadSaved = () => {
    const key = isNight ? 'diorama_night_settings' : 'diorama_morning_settings';
    const saved = localStorage.getItem(key);
    if (!saved) return;
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
    syncUI();
  };

  el('p-bottom').oninput = (e) => { 
    if (atmosphere) atmosphere.material.uniforms.bottomColor.value.set(e.target.value);
    scene.background.set(e.target.value);
  };
  el('p-top').oninput    = (e) => { if (atmosphere) atmosphere.material.uniforms.topColor.value.set(e.target.value); };
  el('p-fog').oninput    = (e) => { if (scene.fog) scene.fog.color.set(e.target.value); };
  el('s-int').oninput    = (e) => { sun.intensity = parseFloat(e.target.value); };
  el('s-col').oninput    = (e) => { sun.color.set(e.target.value); };
  el('s-size').oninput   = (e) => {
    if (moonGroup) {
      const val = parseFloat(e.target.value);
      const vMoon = moonGroup.getObjectByName('VisualMoon');
      const vSun = moonGroup.getObjectByName('VisualSun');
      const glow = moonGroup.getObjectByName('CelestialGlow');
      if (vMoon) vMoon.scale.setScalar(val);
      if (vSun) vSun.scale.setScalar(val);
      if (glow) glow.scale.setScalar(val);
    }
  };
  el('s-posX').oninput    = (e) => { sun.position.x = parseFloat(e.target.value); };
  el('s-posY').oninput    = (e) => { sun.position.y = parseFloat(e.target.value); };
  el('s-posZ').oninput    = (e) => { sun.position.z = parseFloat(e.target.value); };
  el('r-int').oninput    = (e) => { rimLight.intensity = parseFloat(e.target.value); };
  el('r-col').oninput    = (e) => { rimLight.color.set(e.target.value); };
  el('f-int').oninput    = (e) => { fill.intensity = parseFloat(e.target.value); };
  el('f-col').oninput    = (e) => { fill.color.set(e.target.value); };

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
      fillCol: el('f-col').value
    };
    localStorage.setItem(key, JSON.stringify(settings));
    alert(`${isNight ? 'NIGHT' : 'MORNING'} Settings Saved!`);
  };

  el('dev-reset').onclick = () => {
    if (confirm('Are you sure you want to WIPE settings?')) {
      localStorage.removeItem('diorama_morning_settings');
      localStorage.removeItem('diorama_night_settings');
      location.reload();
    }
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
