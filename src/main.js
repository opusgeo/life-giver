import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Island } from './Island.js';
import { DIORAMA_LIST, FARMHOUSE_FILES } from './dioramas.js';
import { preloadModels } from './glbCache.js';
import {
  animateBloom, createSparkle,
  createCompletionRain, createShapeshiftEffect,
  createFlightClouds, createStarfield,
  createAtmosphere, createBackgroundClouds,
  createMoon
} from './effects.js';

// ════════════════════════════════════════════════════════════════════════════
// RENDERER
// ════════════════════════════════════════════════════════════════════════════

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;
document.body.appendChild(renderer.domElement);

// ════════════════════════════════════════════════════════════════════════════
// SAHNE
// ════════════════════════════════════════════════════════════════════════════

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x020a17);
scene.fog = new THREE.FogExp2(0x1a2a44, 0.02); // Gradyanla uyumlu loş sis

// Atmosferik Gökyüzü, Bulutlar ve Yıldızlar
scene.add(createAtmosphere());
scene.add(createStarfield());
const bgCloudsTick = createBackgroundClouds(scene);
const moonGroup    = createMoon(scene);

// ── Işıklar: Perfect Golden Hour ───────────────────────────────────────────
// Gökyüzü ve yerin yumuşak etkileşimi için HemisphereLight
const hemiLight = new THREE.HemisphereLight(0xffffff, 0x001d3d, 0.6);
scene.add(hemiLight);

// Ana Güneş Işığı: Altın Saat Turuncusu
const sun = new THREE.DirectionalLight(0xff9f43, 2.2);  // Daha yoğun altın turuncu
sun.position.set(12, 8, 10);
sun.castShadow = true;

// Yumuşak gölgeler için shadow ayarları
sun.shadow.mapSize.set(2048, 2048); // Daha yüksek çözünürlük
sun.shadow.camera.near = 0.5;
sun.shadow.camera.far  = 100;
sun.shadow.camera.left = sun.shadow.camera.bottom = -15;
sun.shadow.camera.right = sun.shadow.camera.top   =  15;
sun.shadow.bias = -0.0005; // Gölge hatalarını önlemek için
scene.add(sun);

// Dolgu Işığı (Fill): Gölgeleri yumuşatmak için hafif mor/mavi ton
const fill = new THREE.DirectionalLight(0xa8d8ea, 0.4); 
fill.position.set(-8, 5, -5);
scene.add(fill);

// Ambient: Çok hafif sıcaklık katmak için
const ambient = new THREE.AmbientLight(0xffffff, 0.2);
scene.add(ambient);

// ════════════════════════════════════════════════════════════════════════════
// KAMERA & CONTROLS
// ════════════════════════════════════════════════════════════════════════════

// perspektif kamera
const perspCamera = new THREE.PerspectiveCamera(38, window.innerWidth / window.innerHeight, 0.1, 150);
perspCamera.position.set(4.8, 3.5, 4.8); // Daha yakın çapraz

// ortografik (izometrik) kamera
const frustumSize = 4.0; // 5x daha yakın başlangıç (önceki 11.5'ti)
const aspect = window.innerWidth / window.innerHeight;
const orthoCamera = new THREE.OrthographicCamera(
  (frustumSize * aspect) / -2, (frustumSize * aspect) / 2,
  frustumSize / 2, frustumSize / -2,
  0.1, 1000
);
orthoCamera.position.set(15, 9, 15); // Daha eğik (less steep) bakış
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

// ════════════════════════════════════════════════════════════════════════════
// AUDIO
// ════════════════════════════════════════════════════════════════════════════

const listener = new THREE.AudioListener();
perspCamera.add(listener);
orthoCamera.add(listener);

const audioLoader = new THREE.AudioLoader();
const backgroundSound = new THREE.Audio(listener);
audioLoader.load('/bgm-kalimba.mp3', (buffer) => {
  backgroundSound.setBuffer(buffer);
  backgroundSound.setLoop(true);
  backgroundSound.setVolume(0.5);
});

// Ambient: Kuş Sesleri (Dinamik)
const ambientBirds = new THREE.Audio(listener);
audioLoader.load('/bird-voices.mp3', (buffer) => {
  ambientBirds.setBuffer(buffer);
  ambientBirds.setLoop(true);
  ambientBirds.setVolume(0.2);
});

// SFX: Kalimba (Melodik Ölçekli)
const sfxKalimba = new THREE.Audio(listener);
audioLoader.load('/sfx/kalimba.mp3', (buffer) => {
  sfxKalimba.setBuffer(buffer);
  sfxKalimba.setVolume(0.6);
});

// Regüle Edici Melodi Kütüphanesi
const MELODIES = [
  // 1. Twinkle Twinkle Little Star
  [1.0, 1.0, 1.5, 1.5, 1.66, 1.66, 1.5, 1.33, 1.33, 1.25, 1.25, 1.12, 1.12, 1.0],
  // 2. Canon in D (Basitleştirilmiş)
  [1.0, 0.75, 0.84, 0.63, 0.67, 0.5, 0.67, 0.75, 1.0, 1.12, 1.25, 1.33, 1.5, 1.66, 1.88, 2.0],
  // 3. Brahms' Lullaby / Cozy Ninni
  [1.25, 1.25, 1.5, 1.25, 1.25, 1.5, 1.25, 1.5, 2.0, 1.88, 1.66, 1.5, 1.12, 1.25, 1.33, 1],
  // 4. Meditative Arpeggio
  [1.0, 1.25, 1.5, 1.88, 2.0, 2.25, 2.5, 1.88, 1.5, 1.25, 1.0]
];

// Uygulama başladığında rastgele bir melodi seç
let selectedMelody = MELODIES[Math.floor(Math.random() * MELODIES.length)];
let melodyIndex = 0;

function playKalimba() {
  if (sfxKalimba.isPlaying) sfxKalimba.stop();

  // Seçili melodiden sıradaki notayı seç
  const pitch = selectedMelody[melodyIndex % selectedMelody.length];
  sfxKalimba.setPlaybackRate(pitch);
  sfxKalimba.play();

  melodyIndex++;
}

let audioStarted = false;
function startAudio() {
  if (!audioStarted && backgroundSound.buffer && ambientBirds.buffer) {
    backgroundSound.play();
    ambientBirds.play();
    audioStarted = true;
  }
}

// ════════════════════════════════════════════════════════════════════════════
// UI
// ════════════════════════════════════════════════════════════════════════════

const progressBar   = document.getElementById('progress-bar');
const islandLabel   = document.getElementById('island-label');
const hint          = document.getElementById('hint');
const completionOvl = document.getElementById('completion-overlay');
const completionTxt = document.getElementById('completion-text');
const nextBtn       = document.getElementById('next-btn');
const soundBtn      = document.getElementById('sound-toggle');
const blurSlider    = document.getElementById('blur-slider');
const blurTop       = document.getElementById('tilt-shift-top');
const blurBottom    = document.getElementById('tilt-shift-bottom');
const cameraBtn     = document.getElementById('camera-toggle');

const toolsBar    = document.getElementById('tools-bar');

setTimeout(() => { hint.style.opacity = '0'; }, 5000);

// UI elemanlarına tıklandığında oyunun (canvas'ın) algılamasını engelle
[toolsBar].forEach(el => {
  if (!el) return;
  el.addEventListener('pointerdown', (e) => e.stopPropagation());
  el.addEventListener('click', (e) => e.stopPropagation());
});

cameraBtn.addEventListener('click', () => {
  if (activeCamera === perspCamera) {
    activeCamera = orthoCamera;
    cameraBtn.classList.add('isometric');
    // Ortho modunda ayı ve bulutları aşağı çek
    if (moonGroup) {
      moonGroup.position.set(-15, 6, -30);
      moonGroup.scale.setScalar(0.5);
    }
  } else {
    activeCamera = perspCamera;
    cameraBtn.classList.remove('isometric');
    // Perspektif modunda ayı ve bulutları eski yerine al
    if (moonGroup) {
      moonGroup.position.set(-30, 18, -65);
      moonGroup.scale.setScalar(1.0);
    }
  }
  controls.object = activeCamera;
  controls.update();
});

blurSlider.addEventListener('input', () => {
  const val = blurSlider.value;
  const filter = `blur(${val}px)`;
  blurTop.style.backdropFilter = filter;
  blurTop.style.webkitBackdropFilter = filter;
  blurBottom.style.backdropFilter = filter;
  blurBottom.style.webkitBackdropFilter = filter;
});

let isMuted = false;
soundBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  isMuted = !isMuted;
  listener.setMasterVolume(isMuted ? 0 : 1);
  soundBtn.classList.toggle('muted', isMuted);
});

nextBtn.addEventListener('click', (e) => {
  e.stopPropagation(); // Diğer tıklama olaylarını engelle
  if (phase === 'PLAYING') {
    startShapeshift();
  }
});

function setProgress(ratio) {
  progressBar.style.width = (ratio * 100) + '%';
}

function setIslandLabel(name, index, total) {
  islandLabel.textContent = `✦ ${name}  ${index}/${total}`;
}

// ════════════════════════════════════════════════════════════════════════════
// OYUN DURUMU
// ════════════════════════════════════════════════════════════════════════════

// PLAYING → SHAPESHIFTING → FLYING → ARRIVING → PLAYING …
let phase = 'PLAYING';
let dioramaIndex = 0;

let currentIsland = null;
let nextIsland    = null;

// Uçuş için gerekli veriler
const NEXT_ISLAND_OFFSET = new THREE.Vector3(0, 0, -55);
let flightT        = 0;
const FLIGHT_DUR   = 4.0;   // saniye
let flightP0, flightP1, flightP2, flightP3;  // bezier kontrol noktaları
let flightLookStart, flightLookEnd;
let spirit         = null;
let flightClouds   = null;
let shapeshiftCtrl = null;

// Tick listesi (kısa ömürlü efektler)
const ticks = [];

// ─── İlk adayı yükle ────────────────────────────────────────────────────────

function loadIsland(index) {
  const def = DIORAMA_LIST[index % DIORAMA_LIST.length];
  const island = new Island(def.build, scene);
  if (def.scale) island.group.scale.setScalar(def.scale);
  setIslandLabel(def.name, index + 1, DIORAMA_LIST.length);
  setProgress(0);
  return island;
}

// Modeller yüklendikten sonra ilk adayı başlat
preloadModels(FARMHOUSE_FILES).then(() => {
  if (!currentIsland) {
    currentIsland = loadIsland(0);
  }
});

// ════════════════════════════════════════════════════════════════════════════
// RAYCASTER
// ════════════════════════════════════════════════════════════════════════════

const raycaster = new THREE.Raycaster();
const pointer   = new THREE.Vector2();

/** Tıklanan mesh'ten yukarı doğru interactable Group'u bul */
function findInteractableGroup(mesh) {
  let node = mesh;
  while (node) {
    if (node.userData.interactable) return node;
    node = node.parent;
  }
  return null;
}

/** Adaladaki tüm interactable group'ların içindeki mesh'leri döndür (raycaster için) */
function getAllMeshes(island) {
  const meshes = [];
  island.objects.forEach(group => {
    group.traverse(node => { if (node.isMesh) meshes.push(node); });
  });
  return meshes;
}

window.addEventListener('pointerdown', (e) => {
  startAudio();
  
  // UI üzerine tıklandıysa veya sağ tık ise işlem yapma
  if (e.target.closest('#tools-bar') || e.target.closest('#hud')) return;
  if (e.button !== 0 || phase !== 'PLAYING') return;

  pointer.x =  (e.clientX / window.innerWidth)  * 2 - 1;
  pointer.y = -(e.clientY / window.innerHeight) * 2 + 1;

  raycaster.setFromCamera(pointer, activeCamera);
  // Tüm mesh'lere (grup içindekiler dahil) karşı test et
  const hits = raycaster.intersectObjects(getAllMeshes(currentIsland), false);
  if (!hits.length) return;

  // Tıklanan mesh'ten en yakın interactable Group'u bul
  const group = findInteractableGroup(hits[0].object);
  if (!group || group.userData.isAlive) return;

  // Sparkle rengi: tıklanan mesh'in hedef rengini kullan
  const sparkleColor = hits[0].object.userData.targetColor ?? 0xffffff;

  playKalimba();

  ticks.push(animateBloom(group, () => {
    currentIsland.aliveCount++;
    setProgress(currentIsland.aliveCount / currentIsland.totalInteractable);

    if (currentIsland.isComplete) {
      setTimeout(startShapeshift, 300);
    }
  }));

  ticks.push(createSparkle(hits[0].point, sparkleColor, scene));
});

// ════════════════════════════════════════════════════════════════════════════
// PHASE: PLAYING → SHAPESHIFTING
// ════════════════════════════════════════════════════════════════════════════

function startShapeshift() {
  phase = 'SHAPESHIFTING';
  controls.enabled = false;

  // Tamamlama parıltı yağmuru
  ticks.push(createCompletionRain(scene));

  // Shapeshift efekti
  shapeshiftCtrl = createShapeshiftEffect(currentIsland, scene);

  ticks.push((delta) => {
    const done = shapeshiftCtrl.tick(delta);
    if (done) {
      spirit = shapeshiftCtrl.spirit;
      startFlight();
    }
    return done;
  });
}

// ════════════════════════════════════════════════════════════════════════════
// PHASE: SHAPESHIFTING → FLYING
// ════════════════════════════════════════════════════════════════════════════

function startFlight() {
  phase = 'FLYING';

  // Bir sonraki adayı sis içinde yükle
  dioramaIndex++;
  nextIsland = loadIsland(dioramaIndex);
  nextIsland.setPosition(NEXT_ISLAND_OFFSET.x, NEXT_ISLAND_OFFSET.y, NEXT_ISLAND_OFFSET.z);

  // Bulutlar
  flightClouds = createFlightClouds(scene);

  // Bezier uçuş eğrisi (kamera)
  flightT = 0;
  flightP0 = activeCamera.position.clone();
  flightP1 = new THREE.Vector3(flightP0.x * 0.3, flightP0.y + 6, -15);
  flightP2 = new THREE.Vector3(0, 6, -48);
  flightP3 = new THREE.Vector3(4.8, 3.5, -50.2); // Yakın çapraz iniş

  flightLookStart = controls.target.clone();
  flightLookEnd   = new THREE.Vector3(0, 0.5, -55);
}

function cubicBezier(p0, p1, p2, p3, t) {
  const mt = 1 - t;
  return new THREE.Vector3()
    .addScaledVector(p0, mt * mt * mt)
    .addScaledVector(p1, 3 * mt * mt * t)
    .addScaledVector(p2, 3 * mt * t * t)
    .addScaledVector(p3, t * t * t);
}

function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

// ════════════════════════════════════════════════════════════════════════════
// PHASE: FLYING → ARRIVING
// ════════════════════════════════════════════════════════════════════════════

function arrive() {
  phase = 'ARRIVING';

  // Sisi hafifçe artır (geçiş sırasında her şeyi gizle)
  scene.fog.density = 0.25;

  // Bir frame sonra dünyayı resetle
  requestAnimationFrame(() => {
    // Eski adayı kaldır
    currentIsland.dispose();
    scene.remove(shapeshiftCtrl?.spirit);

    // Ruh ve bulutları temizle
    if (flightClouds) flightClouds.dispose();
    flightClouds = null;

    // Yeni adayı (0,0,0)'a taşı
    currentIsland = nextIsland;
    nextIsland    = null;
    currentIsland.setPosition(0, 0, 0);

    // Kamerayı varsayılan konuma döndür (yakın çapraz)
    activeCamera.position.set(4.8, 3.5, 4.8);
    activeCamera.lookAt(0, 0.5, 0);
    controls.target.set(0, 0.5, 0);
    controls.update();

    // Sisi geri getir
    setTimeout(() => {
      scene.fog.density = 0.065;
      controls.enabled = true;
      phase = 'PLAYING';
    }, 150);
  });
}

// ════════════════════════════════════════════════════════════════════════════
// RESIZE
// ════════════════════════════════════════════════════════════════════════════

window.addEventListener('resize', () => {
  const width = window.innerWidth;
  const height = window.innerHeight;
  const aspect = width / height;

  perspCamera.aspect = aspect;
  perspCamera.updateProjectionMatrix();

  orthoCamera.left = (frustumSize * aspect) / -2;
  orthoCamera.right = (frustumSize * aspect) / 2;
  orthoCamera.top = frustumSize / 2;
  orthoCamera.bottom = frustumSize / -2;
  orthoCamera.updateProjectionMatrix();

  renderer.setSize(width, height);
});

// ════════════════════════════════════════════════════════════════════════════
// RENDER LOOP
// ════════════════════════════════════════════════════════════════════════════

const clock = new THREE.Clock();

function animate() {
  requestAnimationFrame(animate);
  const delta   = Math.min(clock.getDelta(), 0.05); // max 50ms (tab inactive koruması)
  const elapsed = clock.elapsedTime;

  // ── Adaların yüzmesi ──
  currentIsland?.update(elapsed);
  nextIsland?.update(elapsed);

  // Arka plan bulutlarını oynat
  bgCloudsTick(delta, elapsed);

  // Ay halesi her zaman kameraya bakmalı
  if (moonGroup) {
    moonGroup.children.forEach(child => {
      if (child.isMesh && child.geometry.type === 'PlaneGeometry') {
        child.lookAt(activeCamera.position);
      }
    });
  }

  // ── Kısa ömürlü ticks ──
  for (let i = ticks.length - 1; i >= 0; i--) {
    if (ticks[i](delta)) ticks.splice(i, 1);
  }

  // ── Uçuş kamera animasyonu ──
  if (phase === 'FLYING') {
    flightClouds?.tick(delta);

    flightT = Math.min(flightT + delta / FLIGHT_DUR, 1);
    const ease = easeInOutCubic(flightT);

    // Kamera bezier
    const pos = cubicBezier(flightP0, flightP1, flightP2, flightP3, ease);
    activeCamera.position.copy(pos);

    const targetPos = flightLookStart.clone().lerp(flightLookEnd, ease);
    controls.target.copy(targetPos);
    activeCamera.lookAt(targetPos);

    // Ruh karakteri kameradan biraz önde uçar
    if (spirit) {
      spirit.position.set(
        pos.x,
        pos.y + 0.4 + Math.sin(elapsed * 5) * 0.12,
        pos.z - 3
      );
      spirit.rotation.y += delta * 1.5;
      spirit.children.forEach((wing, i) => {
        if (wing.geometry?.type === 'ConeGeometry') {
          wing.rotation.z = (i === 0 ? 1 : -1) * (Math.PI / 2 + Math.sin(elapsed * 8) * 0.5);
        }
      });
    }

    // Arrival tetikleyici
    if (flightT >= 1) arrive();
  }

  // ── PLAYING: orbit controls + canlanmış obje nefesi ──
  if (phase === 'PLAYING') {
    // OrbitControls target'ı yüzen adayı takip eder
    const worldPos = new THREE.Vector3();
    currentIsland.group.getWorldPosition(worldPos);
    controls.target.set(worldPos.x, worldPos.y + 0.5, worldPos.z);
    controls.update();

    // Yaşayan gruplara hafif "nefes" animasyonu (grup local Y'de)
    currentIsland.objects.forEach(group => {
      if (group.userData.isAlive) {
        group.position.y += Math.sin(elapsed * 1.4 + group.id * 0.6) * 0.00018;
      }
    });
  }

  // ── Ses Dinamikleri (Kuş sesleri) ──
  if (audioStarted && ambientBirds.buffer && currentIsland) {
    const progress = currentIsland.aliveCount / currentIsland.totalInteractable;
    // %50 civarında pik yapan (bell curve) progress etkisi
    const progressEffect = 0.1 * Math.exp(-Math.pow(progress - 0.5, 2) / 0.02);
    // Hafif dalgalanma (sinus)
    const wavyEffect = Math.sin(elapsed * 0.4) * 0.03;
    
    ambientBirds.setVolume(Math.max(0, 0.2 + progressEffect + wavyEffect));
  }

  renderer.render(scene, activeCamera);
}

animate();
