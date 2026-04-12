import * as THREE from 'three';
import { CLAY_COLOR } from './dioramas.js';

// ─── Easing ──────────────────────────────────────────────────────────────────

function easeOutBack(t) {
  const c1 = 1.70158, c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}

export function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

// ─── Easing Yardımcıları ─────────────────────────────────────────────────────

function easeOutCubic(x) {
  return 1 - Math.pow(1 - x, 3);
}

export function animateBloom(target, onComplete) {
  target.userData.isAlive = true;

  const meshEntries = [];
  target.traverse(child => {
    if (!child.isMesh) return;
    const hasColor = child.userData.targetColor !== undefined;
    const hasOriginal = child.userData.originalMaterial !== undefined;
    if (!hasColor && !hasOriginal) return;

    const startColor = new THREE.Color(CLAY_COLOR);
    const endColor = hasColor ? new THREE.Color(child.userData.targetColor) : null;
    child.material = new THREE.MeshToonMaterial({ color: startColor.clone() });
    
    // Y pozisyonunu en alttaki noktaya göre normalize edip sakla (staggering için)
    meshEntries.push({ 
      child, 
      startColor, 
      endColor, 
      y: child.position.y // Basit stagger için local y'yi kullanıyoruz
    });
  });

  // Mesh'leri Y koordinatına göre sırala (alttan üste boyanma hissi için)
  meshEntries.sort((a, b) => a.y - b.y);

  const startScale = target.scale.clone();
  let t = 0;
  const dur = 0.7; // Daha hızlı ve tepkisel

  return (delta) => {
    t = Math.min(t + delta / dur, 1);
    
    // ── Local Pivot Scale Pop ──
    // Back-out benzeri bir büyüme efekti (0 -> 1.1 -> 1.0)
    const scaleEase = t < 0.5 
      ? Math.sin(t * Math.PI) * 1.2  // Hızlı büyüme
      : 1 + Math.sin(t * Math.PI) * 0.1 * (1 - t); // Hafif overshoot ve oturma

    // Not: Üstteki formül yerine basit bir lerp + sinus bazlı pop daha juicy olabilir
    const s = Math.min(1.0, 1.2 * Math.pow(t, 0.4)); // Hızlı başlangıç
    const pop = 1 + Math.sin(t * Math.PI) * 0.12 * (1 - t);
    
    target.scale.set(
      startScale.x * pop,
      startScale.y * pop,
      startScale.z * pop
    );

    meshEntries.forEach((entry) => {
      // Delay kaldırıldı, hepsi aynı anda başlar
      if (entry.endColor) {
        entry.child.material.color.lerpColors(entry.startColor, entry.endColor, ease);
      }
    });

    if (t >= 1) {
      target.scale.copy(startScale);
      meshEntries.forEach(({ child, endColor }) => {
        if (endColor) {
          child.material.color.copy(endColor);
        } else if (child.userData.originalMaterial) {
          child.material.dispose();
          child.material = child.userData.originalMaterial;
        }
      });
      onComplete?.();
      return true;
    }
    return false;
  };
}

// ─── Tıklama parıltısı ───────────────────────────────────────────────────────

export function createSparkle(position, color, scene) {
  const count = 30;
  const positions = new Float32Array(count * 3);
  const velocities = Array.from({ length: count }, () => new THREE.Vector3(
    (Math.random() - 0.5) * 4,
    Math.random() * 4 + 0.5,
    (Math.random() - 0.5) * 4
  ));
  for (let i = 0; i < count; i++) {
    positions[i * 3] = position.x;
    positions[i * 3 + 1] = position.y;
    positions[i * 3 + 2] = position.z;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const mat = new THREE.PointsMaterial({
    color: new THREE.Color(color),
    size: 0.10,
    transparent: true,
    depthWrite: false,
  });
  const pts = new THREE.Points(geo, mat);
  scene.add(pts);
  let t = 0;

  return (delta) => {
    t += delta;
    const p = t / 1.2;
    if (p >= 1) { scene.remove(pts); geo.dispose(); mat.dispose(); return true; }
    const arr = geo.attributes.position.array;
    for (let i = 0; i < count; i++) {
      arr[i * 3]     += velocities[i].x * delta;
      arr[i * 3 + 1] += (velocities[i].y - 6 * t) * delta;
      arr[i * 3 + 2] += velocities[i].z * delta;
    }
    geo.attributes.position.needsUpdate = true;
    mat.opacity = 1 - p;
    return false;
  };
}

// ─── Tamamlama parıltı yağmuru ───────────────────────────────────────────────

export function createCompletionRain(scene) {
  const count = 200;
  const positions = new Float32Array(count * 3);
  const colorArr  = new Float32Array(count * 3);
  const vels = [];
  const palette = [0xa8edea, 0xfed6e3, 0xffd700, 0x81ecec, 0xff6b9d].map(h => new THREE.Color(h));

  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI * 2;
    const r = Math.random() * 4;
    positions[i * 3]     = Math.cos(angle) * r;
    positions[i * 3 + 1] = Math.random() * 3;
    positions[i * 3 + 2] = Math.sin(angle) * r;
    vels.push(new THREE.Vector3((Math.random() - 0.5) * 0.5, Math.random() * 2 + 0.5, (Math.random() - 0.5) * 0.5));
    const c = palette[i % palette.length];
    colorArr[i * 3] = c.r; colorArr[i * 3 + 1] = c.g; colorArr[i * 3 + 2] = c.b;
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('color',    new THREE.BufferAttribute(colorArr, 3));
  const mat = new THREE.PointsMaterial({ size: 0.14, vertexColors: true, transparent: true, depthWrite: false });
  const pts = new THREE.Points(geo, mat);
  scene.add(pts);
  let t = 0;

  return (delta) => {
    t += delta;
    const p = t / 3.8;
    if (p >= 1) { scene.remove(pts); geo.dispose(); mat.dispose(); return true; }
    const arr = geo.attributes.position.array;
    for (let i = 0; i < count; i++) {
      arr[i * 3]     += vels[i].x * delta;
      arr[i * 3 + 1] += vels[i].y * delta;
      arr[i * 3 + 2] += vels[i].z * delta;
    }
    geo.attributes.position.needsUpdate = true;
    mat.opacity = p < 0.5 ? 1 : 1 - (p - 0.5) / 0.5;
    return false;
  };
}

// ─── Shapeshift: objeler eriyip ruh doğar ───────────────────────────────────

export function createShapeshiftEffect(island, scene) {
  const objects   = island.objects;
  const islandPos = island.worldCenter();

  // Toz bulutu
  const dustCount = 130;
  const dustPos   = new Float32Array(dustCount * 3);
  const dustVel   = [];
  for (let i = 0; i < dustCount; i++) {
    dustPos[i * 3]     = islandPos.x + (Math.random() - 0.5) * 5;
    dustPos[i * 3 + 1] = islandPos.y + Math.random() * 2.5;
    dustPos[i * 3 + 2] = islandPos.z + (Math.random() - 0.5) * 5;
    dustVel.push(new THREE.Vector3(
      (Math.random() - 0.5) * 2, Math.random() * 2.5 + 0.5, (Math.random() - 0.5) * 2
    ));
  }
  const dustGeo = new THREE.BufferGeometry();
  dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPos, 3));
  const dustMat = new THREE.PointsMaterial({ color: 0xcccccc, size: 0.10, transparent: true, depthWrite: false });
  const dust = new THREE.Points(dustGeo, dustMat);
  scene.add(dust);

  // Ruh kristali
  const spirit = buildSpirit();
  spirit.position.copy(islandPos);
  spirit.scale.setScalar(0);
  scene.add(spirit);

  const startScales = objects.map(o => o.scale.clone());
  let t = 0;
  const phase1 = 0.9, phase2 = 1.7;

  function tick(delta) {
    t += delta;

    // Faz 1: gruplar küçülür
    if (t < phase1) {
      const p = easeInOutCubic(t / phase1);
      objects.forEach((o, i) => {
        const s = 1 - p;
        o.scale.set(startScales[i].x * s, startScales[i].y * s, startScales[i].z * s);
      });
    }

    // Faz 2: ruh açılır
    if (t >= phase1 && t < phase2) {
      objects.forEach(o => { o.visible = false; });
      const p = easeOutBack(Math.min((t - phase1) / (phase2 - phase1), 1));
      spirit.scale.setScalar(Math.max(0, p) * 1.3);
    }

    // Toz hareketi
    const dArr = dustGeo.attributes.position.array;
    for (let i = 0; i < dustCount; i++) {
      dArr[i * 3]     += dustVel[i].x * delta;
      dArr[i * 3 + 1] += dustVel[i].y * delta;
      dArr[i * 3 + 2] += dustVel[i].z * delta;
    }
    dustGeo.attributes.position.needsUpdate = true;
    dustMat.opacity = Math.max(0, 1 - t / 1.5);

    // Ruh animasyonu
    if (t >= phase1) {
      spirit.position.y = islandPos.y + 1.8 + Math.sin(t * 4) * 0.1;
      spirit.rotation.y += delta * 1.3;
      spirit.children.forEach((wing, i) => {
        if (wing.geometry?.type === 'ConeGeometry') {
          wing.rotation.z = (i === 0 ? 1 : -1) * (Math.PI / 2 + Math.sin(t * 6) * 0.45);
        }
      });
    }

    if (t >= phase2) {
      scene.remove(dust);
      dustGeo.dispose(); dustMat.dispose();
      return true;
    }
    return false;
  }

  return { tick, spirit };
}

// ─── Spirit (ruh kristali) ───────────────────────────────────────────────────

export function buildSpirit() {
  const group = new THREE.Group();

  const body = new THREE.Mesh(
    new THREE.SphereGeometry(0.23, 10, 8),
    new THREE.MeshToonMaterial({ color: 0xffffff, emissive: new THREE.Color(0x90caf9), emissiveIntensity: 0.9 })
  );
  group.add(body);

  const wingMat = new THREE.MeshToonMaterial({ color: 0xb3e5fc, transparent: true, opacity: 0.85 });
  [-1, 1].forEach(side => {
    const wing = new THREE.Mesh(new THREE.ConeGeometry(0.48, 0.18, 4), wingMat);
    wing.rotation.z = side * Math.PI / 2;
    wing.position.x = side * 0.46;
    group.add(wing);
  });

  const tail = new THREE.Mesh(
    new THREE.ConeGeometry(0.10, 0.42, 4),
    new THREE.MeshToonMaterial({ color: 0xe1f5fe, emissive: new THREE.Color(0x29b6f6), emissiveIntensity: 0.6 })
  );
  tail.position.y = -0.37;
  tail.rotation.x = Math.PI;
  group.add(tail);

  return group;
}

// ─── Uçuş bulutları ──────────────────────────────────────────────────────────

export function createFlightClouds(scene) {
  const clouds = [];
  const speeds = [];

  for (let i = 0; i < 22; i++) {
    const cloud = buildCloud();
    cloud.position.set(
      (Math.random() - 0.5) * 26,
      (Math.random() - 0.5) * 7 + 2,
      -Math.random() * 85 - 5
    );
    cloud.scale.setScalar(0.4 + Math.random() * 0.7);
    scene.add(cloud);
    clouds.push(cloud);
    speeds.push(7 + Math.random() * 5);
  }

  function tick(delta) {
    clouds.forEach((cloud, i) => {
      cloud.position.z += speeds[i] * delta;
      if (cloud.position.z > 8) cloud.position.z = -85;
    });
    return false;
  }

  function dispose() {
    clouds.forEach(c => {
      scene.remove(c);
      c.children.forEach(ch => { ch.geometry?.dispose(); ch.material?.dispose(); });
    });
  }

  return { tick, dispose };
}

function buildCloud() {
  const group = new THREE.Group();
  const mat = new THREE.MeshToonMaterial({ color: 0xd6eeff, transparent: true, opacity: 0.5 });
  [[0, 0, 0, 0.62], [-0.52, -0.1, 0, 0.42], [0.58, -0.1, 0, 0.46], [0.1, 0.32, 0, 0.38]].forEach(([x, y, z, r]) => {
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(r, 6, 5), mat);
    mesh.position.set(x, y, z);
    group.add(mesh);
  });
  return group;
}

// ─── Arka Plan Bulutları (Floating Island Hissi) ─────────────────────────────

export function createBackgroundClouds(scene) {
  const group = new THREE.Group();
  const count = 12;
  const clouds = [];

  for (let i = 0; i < count; i++) {
    const cloud = buildCloud();
    const angle = (i / count) * Math.PI * 2;
    const r = 25 + Math.random() * 10;
    cloud.position.set(
      Math.cos(angle) * r,
      -3 + Math.random() * 4,
      Math.sin(angle) * r
    );
    cloud.scale.setScalar(1.5 + Math.random() * 2);
    cloud.rotation.y = Math.random() * Math.PI;
    group.add(cloud);
    clouds.push({
      mesh: cloud,
      speed: 0.1 + Math.random() * 0.1,
      offset: Math.random() * Math.PI * 2
    });
  }
  scene.add(group);

  return (delta, elapsed) => {
    clouds.forEach(c => {
      c.mesh.position.y += Math.sin(elapsed * 0.5 + c.offset) * 0.005;
      c.mesh.rotation.y += delta * c.speed * 0.2;
    });
  };
}

// ─── Yıldız alanı ────────────────────────────────────────────────────────────

export function createStarfield() {
  const count = 2000;
  const positions = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const phi = Math.acos(2 * Math.random() - 1);
    const theta = Math.random() * Math.PI * 2;
    const r = 80 + Math.random() * 25;
    positions[i * 3]     = r * Math.sin(phi) * Math.cos(theta);
    positions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
    positions[i * 3 + 2] = r * Math.cos(phi);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const mat = new THREE.PointsMaterial({ color: 0xffffff, size: 0.15, transparent: true, opacity: 0.8 });
  return new THREE.Points(geo, mat);
}

// ─── Atmosferik Gökyüzü (Gradient) ───────────────────────────────────────────

export function createAtmosphere() {
  const geo = new THREE.SphereGeometry(95, 32, 32);
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      topColor:    { value: new THREE.Color(0x020a17) }, // Ana gece rengi
      bottomColor: { value: new THREE.Color(0x1a2a44) }, // Daha belirgin ama loş gradyan altı
      offset:      { value: 5 }, // Gradyanı vizöre yaklaştır
      exponent:    { value: 0.3 } // Daha yumuşak dağılım
    },
    vertexShader: `
      varying vec3 vWorldPosition;
      void main() {
        vec4 worldPosition = modelMatrix * vec4(position, 1.0);
        vWorldPosition = worldPosition.xyz;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 topColor;
      uniform vec3 bottomColor;
      uniform float offset;
      uniform float exponent;
      varying vec3 vWorldPosition;
      void main() {
        float h = normalize(vWorldPosition + offset).y;
        gl_FragColor = vec4(mix(bottomColor, topColor, max(pow(max(h, 0.0), exponent), 0.0)), 1.0);
      }
    `,
    side: THREE.BackSide
  });

  return new THREE.Mesh(geo, mat);
}

// ─── Ay (Glow Effect ile) ────────────────────────────────────────────────────

export function createMoon(scene) {
  const group = new THREE.Group();

  // Ay Küresi
  const moonGeo = new THREE.SphereGeometry(3.5, 32, 32);
  const moonMat = new THREE.MeshBasicMaterial({ color: 0xffffee });
  const moon = new THREE.Mesh(moonGeo, moonMat);
  group.add(moon);

  // Ay Halesi (Glow)
  const glowGeo = new THREE.PlaneGeometry(15, 15);
  const glowMat = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.15,
    map: createGlowTexture(),
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide
  });
  const glow = new THREE.Mesh(glowGeo, glowMat);
  group.add(glow);

  group.position.set(-30, 18, -65);
  scene.add(group);

  return group;
}

function createGlowTexture() {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createRadialGradient(size/2, size/2, 0, size/2, size/2, size/2);
  gradient.addColorStop(0, 'rgba(255,255,255,1)');
  gradient.addColorStop(0.2, 'rgba(255,255,255,0.6)');
  gradient.addColorStop(0.5, 'rgba(255,255,255,0.1)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(canvas);
}
