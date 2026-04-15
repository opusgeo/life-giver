import * as THREE from 'three';
import { CLAY_COLOR } from './dioramas.js';

// ─── Yardımcı Fonksiyonlar ───

/**
 * Splits a mesh into multiple smaller meshes based on vertex connectivity.
 * Useful for animating disconnected parts (like floor tiles) independently.
 */
export function splitByConnectivity(mesh) {
  const geom = mesh.geometry;
  if (!geom.index) return [mesh]; // Only handle indexed for now
  if (geom.groups && geom.groups.length > 1) return [mesh]; // Prevent multi-material explosion

  const indices = geom.index.array;
  const vertexCount = geom.attributes.position.count;

  // 1. Union-Find to group connected vertices
  const parent = new Int32Array(vertexCount);
  for (let i = 0; i < vertexCount; i++) parent[i] = i;

  function find(i) {
    while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; }
    return i;
  }
  function union(i, j) {
    const rI = find(i); const rJ = find(j);
    if (rI !== rJ) parent[rI] = rJ;
  }

  for (let i = 0; i < indices.length; i += 3) {
    union(indices[i], indices[i + 1]);
    union(indices[i + 1], indices[i + 2]);
  }

  // 2. Group faces by root vertex
  const groups = new Map();
  for (let i = 0; i < indices.length; i += 3) {
    const root = find(indices[i]);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(i / 3);
  }

  if (groups.size <= 1) return [mesh];

  // 3. Create sub-meshes
  const results = [];
  groups.forEach((faceIndices) => {
    const newGeom = new THREE.BufferGeometry();
    const usedVertices = new Set();
    faceIndices.forEach(fi => {
      usedVertices.add(indices[fi * 3]);
      usedVertices.add(indices[fi * 3 + 1]);
      usedVertices.add(indices[fi * 3 + 2]);
    });

    // --- FIX: Build mapping BEFORE attribute processing ---
    const mapping = new Map();
    let nIdx = 0;
    usedVertices.forEach(oldIdx => {
      mapping.set(oldIdx, nIdx++);
    });

    // Copy Attributes
    for (const name in geom.attributes) {
      const attr = geom.attributes[name];
      const newArr = new attr.array.constructor(usedVertices.size * attr.itemSize);
      let vIdx = 0;
      usedVertices.forEach(oldIdx => {
        for (let j = 0; j < attr.itemSize; j++) {
          newArr[vIdx * attr.itemSize + j] = attr.array[oldIdx * attr.itemSize + j];
        }
        vIdx++;
      });
      const newAttr = new THREE.BufferAttribute(newArr, attr.itemSize);
      newAttr.normalized = attr.normalized; // CRITICAL: Prevent shader explosions for normalized generic types (Uint8/Uint16)
      newGeom.setAttribute(name, newAttr);
    }

    // Copy Index
    const newIndices = new indices.constructor(faceIndices.length * 3);
    faceIndices.forEach((fi, i) => {
      newIndices[i * 3]     = mapping.get(indices[fi * 3]);
      newIndices[i * 3 + 1] = mapping.get(indices[fi * 3 + 1]);
      newIndices[i * 3 + 2] = mapping.get(indices[fi * 3 + 2]);
    });
    newGeom.setIndex(new THREE.BufferAttribute(newIndices, 1));

    const sub = new THREE.Mesh(newGeom, mesh.material);
    sub.name = mesh.name + '_sub';
    sub.userData = { ...mesh.userData };
    sub.castShadow = mesh.castShadow;
    sub.receiveShadow = mesh.receiveShadow;
    sub.position.copy(mesh.position);
    sub.rotation.copy(mesh.rotation);
    sub.scale.copy(mesh.scale);
    results.push(sub);
  });

  return results;
}

function createParticleTexture() {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createRadialGradient(size/2, size/2, 0, size/2, size/2, size/2);
  gradient.addColorStop(0, 'rgba(255,255,255,1)');
  gradient.addColorStop(0.4, 'rgba(255,255,255,0.4)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(canvas);
}
const particleTexture = createParticleTexture();

// ─── Procedural Particle Shader ───
const proceduralShader = {
  uniforms: {
    uMap: { value: particleTexture }
  },
  vertexShader: `
    attribute float sizeScale;
    attribute vec3 color;
    attribute float opacity;
    varying vec3 vColor;
    varying float vOpacity;
    void main() {
      vColor = color;
      vOpacity = opacity;
      vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
      gl_PointSize = (0.6 * sizeScale) * (300.0 / -mvPosition.z);
      gl_Position = projectionMatrix * mvPosition;
    }
  `,
  fragmentShader: `
    uniform sampler2D uMap;
    varying vec3 vColor;
    varying float vOpacity;
    void main() {
      vec4 tex = texture2D(uMap, gl_PointCoord);
      gl_FragColor = vec4(tex.rgb * vColor * 0.3, tex.a * vOpacity);
    }
  `
};

// ─── animateBloom ───

export function animateBloom(target, onComplete, origin = null, settings = {}) {
  const meshEntries = [];
  
  // 1. Connectivity splitting (Re-enabled with fixes)
  const initialMeshes = [];
  target.traverse(child => { if (child.isMesh) initialMeshes.push(child); });

  const finalMeshes = [];
  initialMeshes.forEach(m => {
    // Note: connectivity splitting can mutate scene graph, invalidating external caches
    const parts = splitByConnectivity(m);
    if (parts.length > 1) {
      const parent = m.parent;
      parts.forEach(p => parent.add(p));
      parent.remove(m);
      finalMeshes.push(...parts);
    } else {
      finalMeshes.push(m);
    }
  });

  // Default parameters
  const type      = settings.type      || 'RADIAL';
  const duration  = settings.duration  || 550;
  let stagger     = settings.stagger   ?? (origin ? 45 : 15);
  const jumpScale = settings.jumpScale ?? 0.12;

  // 2. Prepare for animation
  finalMeshes.forEach(child => {
    const originalMat = child.userData.originalMaterial;
    if (!originalMat) return;

    const cloneMat = (m) => {
      const nm = m.clone();
      nm.userData.uProgress = { value: 0 };
      nm.transparent = false; // Ensure it's opaque during animation
      return nm;
    };
    const mats = Array.isArray(originalMat) ? originalMat.map(cloneMat) : cloneMat(originalMat);
    const matArray = Array.isArray(mats) ? mats : [mats];

    child.updateMatrixWorld(true);
    child.geometry.computeBoundingBox();
    const bbox = child.geometry.boundingBox;
    const center = new THREE.Vector3();
    bbox.getCenter(center);
    child.localToWorld(center);
    
    // Animation specific origin logic
    const animOrigin = origin || center;
    const size = new THREE.Vector3();
    bbox.getSize(size);
    // Covering mesh size plus the distance from click origin to center
    const distFromOrigin = center.distanceTo(animOrigin);
    const maxDist = Math.max(0.5, (size.length() * 0.5) + distFromOrigin);

    matArray.forEach(m => {
      m.onBeforeCompile = (shader) => {
        shader.uniforms.uProgress = m.userData.uProgress;
        shader.uniforms.uClayColor = { value: new THREE.Color(CLAY_COLOR) };
        shader.uniforms.uCenter = { value: animOrigin }; 
        shader.uniforms.uMaxDist = { value: maxDist };
        shader.uniforms.uShineColor = { value: new THREE.Color(0xffffff) };

        shader.vertexShader = `varying vec3 vWP;\n` + shader.vertexShader.replace(
          '#include <worldpos_vertex>',
          '#include <worldpos_vertex>\nvWP = worldPosition.xyz;'
        );

        shader.fragmentShader = `
          varying vec3 vWP;
          uniform float uProgress;
          uniform vec3 uCenter;
          uniform float uMaxDist;
          uniform vec3 uClayColor;
          uniform vec3 uShineColor;
        ` + shader.fragmentShader.replace(
          '#include <dithering_fragment>',
          `
          float d = distance(vWP, uCenter);
          // Standardized threshold range for reliable reveal
          float threshold = uProgress * (uMaxDist * 1.5) - (uMaxDist * 0.1);
          float isP = smoothstep(threshold + 0.15, threshold, d);
          
          if (uProgress > 0.98) isP = 1.0;

          float sh = smoothstep(threshold - 0.1, threshold, d) * (1.0 - step(threshold, d));
          
          float lum = clamp(dot(gl_FragColor.rgb, vec3(0.299, 0.587, 0.114)), 0.0, 1.0); 
          vec3 clayPure = uClayColor * (0.4 + lum * 0.6); 
          
          gl_FragColor.rgb = mix(clayPure, gl_FragColor.rgb, isP);
          gl_FragColor.rgb += uShineColor * sh * 0.05 * (1.0 - isP);

          #include <dithering_fragment>
          `
        );
      };
      m.needsUpdate = true;
    });

    child.material = mats;
    meshEntries.push({ 
      child, 
      matArray, 
      startY: child.position.y, 
      startRotX: child.rotation.x,
      worldPos: center.clone() 
    });
  });

  if (meshEntries.length === 0) {
    onComplete?.();
    return () => true;
  }

  // 3. Sorting logic based on preset types
  if (type === 'RADIAL' && origin) {
    meshEntries.sort((a, b) => a.worldPos.distanceTo(origin) - b.worldPos.distanceTo(origin));
  } else if (type === 'BOTTOM_UP') {
    meshEntries.sort((a, b) => a.worldPos.y - b.worldPos.y);
  } else if (type === 'RANDOM') {
    meshEntries.sort(() => Math.random() - 0.5);
  } else if (type === 'WAVE_X') {
    meshEntries.sort((a, b) => a.worldPos.x - b.worldPos.x);
  } else if (type === 'WAVE_Z') {
    meshEntries.sort((a, b) => a.worldPos.z - b.worldPos.z);
  } else {
    // Default to origin radial if nothing else
    if (origin) meshEntries.sort((a, b) => a.worldPos.distanceTo(origin) - b.worldPos.distanceTo(origin));
    else meshEntries.sort((a, b) => a.worldPos.y - b.worldPos.y);
  }

  // Auto-cap maximum animation duration for objects with hundreds of pieces
  const MAX_WAVE_DURATION = 1200; // max total stagger time in ms (1.2 seconds)
  if (meshEntries.length > 0) {
    const currentTotal = meshEntries.length * stagger;
    if (currentTotal > MAX_WAVE_DURATION) {
      stagger = MAX_WAVE_DURATION / meshEntries.length;
    }
  }

  let finishedCount = 0;

  meshEntries.forEach((entry, i) => {
    setTimeout(() => {
      const { child, matArray, startY, startRotX } = entry;
      const startTime = Date.now();
      
      function loop() {
        const elapsed = Date.now() - startTime;
        const t = Math.min(1, elapsed / duration);
        
        // Use configurable jump scale
        const jump = Math.sin(t * Math.PI) * jumpScale;
        child.position.y = startY + jump;
        
        // Domino rotation (tilt) for radial/wave types
        if (type !== 'BOTTOM_UP' && type !== 'RANDOM') {
           child.rotation.x = startRotX + Math.sin(t * Math.PI) * 0.1;
        }

        matArray.forEach(m => { if(m.userData.uProgress) m.userData.uProgress.value = t; });
        
        if (t < 1) requestAnimationFrame(loop);
        else {
          child.position.y = startY;
          child.rotation.x = startRotX;
          child.userData.isAlive = true;
          finishedCount++;
          if (finishedCount === meshEntries.length) setTimeout(() => onComplete?.(), 150);
        }
      }
      loop();
    }, i * stagger);
  });
  return () => finishedCount === meshEntries.length;
}

export function animateBurnDeath(target, onComplete) {
  const meshEntries = [];
  
  // Connectivity splitting 
  const initialMeshes = [];
  target.traverse(child => { if (child.isMesh) initialMeshes.push(child); });

  const finalMeshes = [];
  const fireGroups = []; // To hold and shrink the fire

  initialMeshes.forEach(m => {
    // Detach fire so it doesn't disappear when we remove the original mesh
    const fire = m.children.find(c => c.name === 'fireGroup_ext');
    const parent = m.parent;
    if (fire && parent) {
      // Put the fire in world space (relative to the old parent actually)
      const wp = new THREE.Vector3();
      fire.getWorldPosition(wp);
      m.remove(fire);
      parent.add(fire);
      m.userData.__detachedFireGroup = fire;
      fireGroups.push(fire);
    }

    // Break mesh down for pieces falling
    const parts = splitByConnectivity(m);
    if (parts.length > 1) {
      if (parent) {
        parts.forEach(p => parent.add(p));
        parent.remove(m);
      }
      finalMeshes.push(...parts);
    } else {
      finalMeshes.push(m);
    }
  });

  // Calculate distinct variables per sub-piece
  finalMeshes.forEach(child => {
    meshEntries.push({
      child,
      startX: child.position.x,
      startY: child.position.y,
      startZ: child.position.z,
      startRot: child.rotation.clone(),
      startScale: child.scale.clone(),
      delay: Math.random() * 1500, // delay between 0-1.5s to start falling
      duration: 2500 + Math.random() * 1000, // slow fall
      flyX: (Math.random() - 0.5) * 4.0, // horizontal spread
      flyZ: (Math.random() - 0.5) * 4.0,
      rotSpeedX: (Math.random() - 0.5) * 8.0,
      rotSpeedY: (Math.random() - 0.5) * 8.0,
      hitGround: false
    });
  });

  let finishedCount = 0;
  if(meshEntries.length === 0) {
    onComplete?.();
    return () => true;
  }

  // Also animate the fire groups shrinking
  fireGroups.forEach(fg => {
    const startScale = fg.scale.clone();
    const dur = 4000; // fire goes out in 4 seconds
    const start = Date.now();
    function loopFire() {
      const el = Date.now() - start;
      const t = Math.min(1, el / dur);
      const sc = 1.0 - t;
      fg.scale.set(startScale.x * sc, startScale.y * sc, startScale.z * sc);
      if (t < 1) requestAnimationFrame(loopFire);
    }
    loopFire();
  });

  meshEntries.forEach((entry) => {
    setTimeout(() => {
      const startTime = Date.now();
      const { child, startX, startY, startZ, startRot, startScale, duration, flyX, flyZ, rotSpeedX, rotSpeedY } = entry;
      // Change material to be able to turn fully transparent
      const mats = Array.isArray(child.material) ? child.material : [child.material];
      child.material = mats.map(m => {
        const cloned = m.clone();
        cloned.transparent = true;
        return cloned;
      });

      function loop() {
        const elapsed = Date.now() - startTime;
        const t = Math.min(1, Math.max(0, elapsed / duration));
        
        // Gravity easing (quadratic ease-in)
        const e = t * t; 

        // Apply motion
        const dropDist = e * 8.0; 
        const newY = startY - dropDist;
        const floorY = 0.05; // Slightly above zero to prevent Z-fighting

        if (newY <= floorY && !entry.hitGround) {
          entry.hitGround = true; // record hitting the floor to stop lateral movement
        }

        child.position.y = Math.max(floorY, newY);

        if (!entry.hitGround) {
          // Spread outwards while in air
          child.position.x = startX + flyX * Math.sqrt(e);
          child.position.z = startZ + flyZ * Math.sqrt(e);
          // Spin while in air
          child.rotation.x = startRot.x + rotSpeedX * e;
          child.rotation.y = startRot.y + rotSpeedY * e;
        }

        // Keep normal scale until the very end, then shrink slightly to emulate blowing away
        let scaleVal = 1.0;
        if (t > 0.8) {
          scaleVal = 1.0 - ((t - 0.8) * 5.0); // 1.0 -> 0.0
        }
        child.scale.set(startScale.x * Math.max(0, scaleVal), startScale.y * Math.max(0, scaleVal), startScale.z * Math.max(0, scaleVal));
        
        // Instantly darken to ash, fade out opacity only in the last phase
        child.material.forEach(m => {
          if (m.color) m.color.lerp(new THREE.Color(0x050505), 0.1); 
          if (t > 0.5) m.opacity = 1.0 - ((t - 0.5) * 2.0);
        });

        if (t < 1.0) {
          requestAnimationFrame(loop);
        } else {
           child.visible = false;
           child.parent?.remove(child);
           finishedCount++;
           if(finishedCount === meshEntries.length) onComplete?.();
        }
      }
      loop();
    }, entry.delay);
  });
  return () => finishedCount === meshEntries.length;
}

// ─── Diğer Efektler ───

export function createSparkle(position, color, scene) {
  const count = 30;
  const positions = new Float32Array(count * 3);
  const sizeScales = new Float32Array(count);
  const colors = new Float32Array(count * 3);
  const opacities = new Float32Array(count);

  const velocities = Array.from({ length: count }, () => new THREE.Vector3(
    (Math.random() - 0.5) * 2.0,
    Math.random() * 2.0 + 0.3, 
    (Math.random() - 0.5) * 2.0
  ));

  const baseCol = new THREE.Color(color);

  for (let i = 0; i < count; i++) {
    positions[i * 3] = position.x;
    positions[i * 3 + 1] = position.y;
    positions[i * 3 + 2] = position.z;
    sizeScales[i] = 0.25 + Math.random() * 0.75;
    colors[i * 3] = baseCol.r; colors[i * 3 + 1] = baseCol.g; colors[i * 3 + 2] = baseCol.b;
    opacities[i] = 1.0;
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('sizeScale', new THREE.BufferAttribute(sizeScales, 1));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.setAttribute('opacity', new THREE.BufferAttribute(opacities, 1));

  const mat = new THREE.ShaderMaterial({
    ...proceduralShader,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending
  });

  const pts = new THREE.Points(geo, mat);
  scene.add(pts);

  let t = 0;
  return (delta) => {
    t += delta;
    const p = t / 1.5;
    if (p >= 1) { scene.remove(pts); geo.dispose(); mat.dispose(); return true; }
    const arr = geo.attributes.position.array;
    const opp = geo.attributes.opacity.array;
    for (let i = 0; i < count; i++) {
      arr[i * 3]     += (velocities[i].x) * delta;
      arr[i * 3 + 1] += (velocities[i].y - 1.2 * t) * delta;
      arr[i * 3 + 2]     += (velocities[i].z) * delta;
      opp[i] = 1.0 - p;
    }
    geo.attributes.position.needsUpdate = true;
    geo.attributes.opacity.needsUpdate = true;
    return false;
  };
}

export function createWaterSplash(position, scene) {
  const count = 50;
  const positions = new Float32Array(count * 3);
  const sizeScales = new Float32Array(count);
  const colors = new Float32Array(count * 3);
  const opacities = new Float32Array(count);

  // Water droplet velocities — mostly upward, slight random spread
  const velocities = Array.from({ length: count }, () => new THREE.Vector3(
    (Math.random() - 0.5) * 1.5,
    Math.random() * 3.5 + 1.5,   // strong upward burst
    (Math.random() - 0.5) * 1.5
  ));

  // Blue water palette
  const waterColors = [
    new THREE.Color(0x00bfff),  // deep sky blue
    new THREE.Color(0x87ceeb),  // sky blue
    new THREE.Color(0x40e0d0),  // turquoise
    new THREE.Color(0xb0e0e6),  // powder blue
    new THREE.Color(0xffffff),  // white foam
  ];

  for (let i = 0; i < count; i++) {
    positions[i * 3]     = position.x + (Math.random() - 0.5) * 0.3;
    positions[i * 3 + 1] = position.y;
    positions[i * 3 + 2] = position.z + (Math.random() - 0.5) * 0.3;
    sizeScales[i] = 0.3 + Math.random() * 0.8;
    const c = waterColors[Math.floor(Math.random() * waterColors.length)];
    colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
    opacities[i] = 1.0;
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('sizeScale', new THREE.BufferAttribute(sizeScales, 1));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.setAttribute('opacity', new THREE.BufferAttribute(opacities, 1));

  const mat = new THREE.ShaderMaterial({
    ...proceduralShader,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending
  });

  const pts = new THREE.Points(geo, mat);
  scene.add(pts);

  let t = 0;
  const GRAVITY = 6.0;
  const DURATION = 1.8;

  return (delta) => {
    t += delta;
    const p = t / DURATION;
    if (p >= 1) { scene.remove(pts); geo.dispose(); mat.dispose(); return true; }

    const arr = geo.attributes.position.array;
    const opp = geo.attributes.opacity.array;
    for (let i = 0; i < count; i++) {
      const v = velocities[i];
      arr[i * 3]     += v.x * delta;
      arr[i * 3 + 1] += (v.y - GRAVITY * t) * delta;  // gravity pulls down
      arr[i * 3 + 2] += v.z * delta;
      opp[i] = Math.max(0, 1.0 - p * 1.2);
    }
    geo.attributes.position.needsUpdate = true;
    geo.attributes.opacity.needsUpdate = true;
    return false;
  };
}

/**
 * createWaterStream — Squirtle tarzı foşur foşur su fışkırması
 * Dairesel su bloblari bezier yayı boyunca akar, hedefe çarpar, sıçrar.
 */
export function createWaterStream(from, to, scene) {
  // ── Bezier yayı: hafif yerçekimi eğrisi ──
  const dist = from.distanceTo(to);
  const ctrl = from.clone().lerp(to, 0.5);
  ctrl.y += dist * 0.18; // yukarı bombe (Squirtle water arc)
  const curve = new THREE.QuadraticBezierCurve3(from, ctrl, to);

  const TOTAL_DURATION = 1.1; // toplam efekt süresi (saniye)
  const STREAM_SPEED   = 3.2; // phase/saniye — su akış hızı
  const STREAM_COUNT   = 180; // akan blob sayısı
  const SPRAY_COUNT    = 60;  // hedefte sıçrayan damla sayısı

  // Her blobu için rastgele sabit veriler
  const blobPhaseOffset = new Float32Array(STREAM_COUNT).map((_, i) =>
    (i / STREAM_COUNT)                       // eşit dağılım → kesintisiz akış
  );
  const blobSpread = Array.from({ length: STREAM_COUNT }, () => {
    const angle  = Math.random() * Math.PI * 2;
    const radius = Math.random() * Math.random() * 0.12; // merkeze daha yoğun
    return { angle, radius };
  });
  const blobSize = new Float32Array(STREAM_COUNT).map(() => 0.8 + Math.random() * 1.4);

  // ── Stream Points shader ── tamamen texture'sız, saf GLSL daire ──
  const streamPos  = new Float32Array(STREAM_COUNT * 3);
  const streamSize = new Float32Array(STREAM_COUNT);
  const streamOpacity = new Float32Array(STREAM_COUNT);

  const streamGeo = new THREE.BufferGeometry();
  streamGeo.setAttribute('position', new THREE.BufferAttribute(streamPos, 3));
  streamGeo.setAttribute('aSize',    new THREE.BufferAttribute(streamSize, 1));
  streamGeo.setAttribute('aOpacity', new THREE.BufferAttribute(streamOpacity, 1));

  const streamMat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: { uTime: { value: 0 } },
    vertexShader: /* glsl */`
      attribute float aSize;
      attribute float aOpacity;
      varying float vOpacity;
      void main() {
        vOpacity = aOpacity;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = aSize * (220.0 / -mv.z);
        gl_Position  = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */`
      uniform float uTime;
      varying float vOpacity;
      void main() {
        // Yumuşak daire
        vec2 uv = gl_PointCoord * 2.0 - 1.0;
        float d = dot(uv, uv);
        if (d > 1.0) discard;

        float core  = 1.0 - smoothstep(0.0, 0.35, d);
        float outer = 1.0 - smoothstep(0.35, 1.0, d);

        // Su rengi: ortası beyaz-cyan, dışı koyu mavi
        vec3 cCore  = vec3(0.85, 0.98, 1.00);
        vec3 cMid   = vec3(0.20, 0.75, 1.00);
        vec3 cEdge  = vec3(0.05, 0.35, 0.80);
        vec3 col    = mix(cEdge, cMid, outer);
        col         = mix(col, cCore, core);

        float alpha = outer * vOpacity;
        gl_FragColor = vec4(col, alpha);
      }
    `,
  });

  const streamPts = new THREE.Points(streamGeo, streamMat);
  scene.add(streamPts);

  // ── Spray (hedefte sıçrama) ──
  const sprayPos  = new Float32Array(SPRAY_COUNT * 3);
  const spraySize = new Float32Array(SPRAY_COUNT).map(() => 0.5 + Math.random() * 1.2);
  const sprayOp   = new Float32Array(SPRAY_COUNT);
  const sprayVel  = Array.from({ length: SPRAY_COUNT }, () => new THREE.Vector3(
    (Math.random() - 0.5) * 4.5,
    Math.random() * 5.5 + 1.0,
    (Math.random() - 0.5) * 4.5
  ));

  for (let i = 0; i < SPRAY_COUNT; i++) {
    sprayPos[i*3]=to.x; sprayPos[i*3+1]=to.y; sprayPos[i*3+2]=to.z;
  }

  const sprayGeo = new THREE.BufferGeometry();
  sprayGeo.setAttribute('position', new THREE.BufferAttribute(sprayPos,  3));
  sprayGeo.setAttribute('aSize',    new THREE.BufferAttribute(spraySize, 1));
  sprayGeo.setAttribute('aOpacity', new THREE.BufferAttribute(sprayOp,   1));

  // Spray aynı shader'ı paylaşır (clone ederek bağımsız uniform)
  const sprayMat = streamMat.clone();
  const sprayPts = new THREE.Points(sprayGeo, sprayMat);
  scene.add(sprayPts);

  let t = 0;
  const GRAVITY_SPRAY = 9.0;
  const _tmpPt = new THREE.Vector3();
  const _tmpFwd = new THREE.Vector3();

  function cleanup() {
    scene.remove(streamPts); streamGeo.dispose(); streamMat.dispose();
    scene.remove(sprayPts);  sprayGeo.dispose();  sprayMat.dispose();
  }

  return (delta) => {
    t += delta;
    if (t >= TOTAL_DURATION) { cleanup(); return true; }

    const globalFade = t < 0.08
      ? t / 0.08                                      // hızlı açılış
      : 1.0 - Math.max(0, (t - 0.85) / 0.25);        // son 0.25s'de söner

    streamMat.uniforms.uTime.value = t;

    // ── Stream blob'larını güncelle ──
    const sp  = streamGeo.attributes.position.array;
    const ss  = streamGeo.attributes.aSize.array;
    const sop = streamGeo.attributes.aOpacity.array;

    for (let i = 0; i < STREAM_COUNT; i++) {
      // phase: sürekli dönen kayan faz → kesintisiz akış
      let phase = (blobPhaseOffset[i] + t * STREAM_SPEED) % 1.0;

      // Henüz ateşlenmemiş bloblari gizle (ilk frame'de hepsi aynı anda çıkmasın)
      const launchDelay = blobPhaseOffset[i] * 0.15;
      if (t < launchDelay) { sop[i] = 0; continue; }

      // Bezier üzerindeki pozisyon
      curve.getPoint(phase, _tmpPt);
      // Teğet yönü → yan yayılma için local frame
      curve.getTangent(phase, _tmpFwd);
      const right = new THREE.Vector3(-_tmpFwd.z, 0, _tmpFwd.x).normalize();
      const up    = new THREE.Vector3().crossVectors(_tmpFwd, right).normalize();

      const { angle, radius } = blobSpread[i];
      sp[i*3]   = _tmpPt.x + right.x * Math.cos(angle) * radius + up.x * Math.sin(angle) * radius;
      sp[i*3+1] = _tmpPt.y + right.y * Math.cos(angle) * radius + up.y * Math.sin(angle) * radius;
      sp[i*3+2] = _tmpPt.z + right.z * Math.cos(angle) * radius + up.z * Math.sin(angle) * radius;

      // Baş ve kuyrukta solar (akış ucundaki şeffaflık)
      const headFade = 1.0 - Math.pow(Math.max(0, phase - 0.88) / 0.12, 2.0);
      const tailFade = Math.min(1.0, phase / 0.04);

      ss[i]  = blobSize[i];
      sop[i] = headFade * tailFade * globalFade;
    }

    streamGeo.attributes.position.needsUpdate = true;
    streamGeo.attributes.aSize.needsUpdate    = true;
    streamGeo.attributes.aOpacity.needsUpdate = true;

    // ── Spray güncelle ──
    const SPRAY_START = 0.25; // bezier'in bu kadarı geçince spray başlar
    const sprayDelay  = 1.0 / (STREAM_SPEED) * (1.0 - SPRAY_START); // ~ne zaman hedefe ulaşır
    const st  = Math.max(0, t - sprayDelay);
    const spa = sprayGeo.attributes.position.array;
    const soa = sprayGeo.attributes.aOpacity.array;
    for (let i = 0; i < SPRAY_COUNT; i++) {
      if (st <= 0) { soa[i] = 0; continue; }
      const v = sprayVel[i];
      spa[i*3]   = to.x + v.x * st;
      spa[i*3+1] = to.y + (v.y - GRAVITY_SPRAY * st) * st;
      spa[i*3+2] = to.z + v.z * st;
      soa[i] = Math.max(0, (1.0 - st / 0.9) * globalFade);
    }
    sprayGeo.attributes.position.needsUpdate = true;
    sprayGeo.attributes.aOpacity.needsUpdate = true;

    return false;
  };
}

export function createCozyParticles(scene) {
  const count = 100;
  const positions = new Float32Array(count * 3);
  const sizeScales = new Float32Array(count);
  const colors = new Float32Array(count * 3);
  const opacities = new Float32Array(count);
  const vels = [];

  const baseCol = new THREE.Color(0xfff3cd);

  for (let i = 0; i < count; i++) {
    // Spatial restriction: Only show in the middle of the level (radius 10)
    const angle = Math.random() * Math.PI * 2;
    const r = Math.random() * 8.0;
    positions[i * 3]     = Math.cos(angle) * r;
    positions[i * 3 + 1] = Math.random() * 6.0;
    positions[i * 3 + 2] = Math.sin(angle) * r;
    
    sizeScales[i] = 0.2 + Math.random() * 0.6;
    colors[i * 3] = baseCol.r; colors[i * 3 + 1] = baseCol.g; colors[i * 3 + 2] = baseCol.b;
    opacities[i] = 0.0;

    vels.push({ 
      x: (Math.random()-0.5)*0.3, 
      y: Math.random()*0.5+0.2, 
      z: (Math.random()-0.5)*0.3, 
      phase: Math.random()*Math.PI*2,
      originY: positions[i * 3 + 1]
    });
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('sizeScale', new THREE.BufferAttribute(sizeScales, 1));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.setAttribute('opacity', new THREE.BufferAttribute(opacities, 1));

  const mat = new THREE.ShaderMaterial({
    ...proceduralShader,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending
  });

  const pts = new THREE.Points(geo, mat);
  scene.add(pts);

  let totalTime = 0;
  return (delta) => {
    totalTime += delta;
    const arr = geo.attributes.position.array;
    const opp = geo.attributes.opacity.array;
    
    for (let i = 0; i < count; i++) {
      const v = vels[i];
      arr[i * 3]     += v.x * delta;
      arr[i * 3 + 1] += v.y * delta;
      arr[i * 3 + 2] += v.z * delta;

      // Loop particles back to bottom when they float too high
      if (arr[i * 3 + 1] > 6.0) {
        arr[i * 3 + 1] = -0.5;
      }

      // Breathing opacity
      opp[i] = (0.3 + 0.4 * Math.sin(totalTime * 0.5 + v.phase)) * 0.8;
    }
    geo.attributes.position.needsUpdate = true;
    geo.attributes.opacity.needsUpdate = true;
    return false; // Never finish
  };
}

export function createCozyDust(targetGroup, scene) {
  // Keeping this for compatibility but we will stop calling it from main.js as per user request
  // (or we can just leave it empty)
  return () => true; 
}

export function createCompletionRain(scene) {
  const count = 200;
  const positions = new Float32Array(count * 3);
  const colorArr  = new Float32Array(count * 3);
  const vels = [];
  const palette = [0xa8edea, 0xfed6e3, 0xffd700, 0x81ecec, 0xff6b9d].map(h => new THREE.Color(h));
  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI * 2;
    const r = Math.random() * 4;
    positions[i * 3] = Math.cos(angle) * r;
    positions[i * 3 + 1] = Math.random() * 3;
    positions[i * 3 + 2] = Math.sin(angle) * r;
    vels.push(new THREE.Vector3((Math.random()-0.5)*0.5, Math.random()*2+0.5, (Math.random()-0.5)*0.5));
    const c = palette[i % palette.length];
    colorArr[i * 3] = c.r; colorArr[i * 3 + 1] = c.g; colorArr[i * 3 + 2] = c.b;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(colorArr, 3));
  const mat = new THREE.PointsMaterial({ size:0.07, vertexColors:true, transparent:true, depthWrite:false });
  const pts = new THREE.Points(geo, mat);
  scene.add(pts);
  let t = 0;
  return (delta) => {
    t += delta;
    const p = t / 3.8;
    if (p >= 1) { scene.remove(pts); geo.dispose(); mat.dispose(); return true; }
    const arr = geo.attributes.position.array;
    for (let i = 0; i < count; i++) {
      arr[i * 3] += vels[i].x * delta;
      arr[i * 3 + 1] += vels[i].y * delta;
      arr[i * 3 + 2] += vels[i].z * delta;
    }
    geo.attributes.position.needsUpdate = true;
    mat.opacity = p < 0.5 ? 1 : 1 - (p-0.5)/0.5;
    return false;
  };
}

export function createShapeshiftEffect(island, scene) {
  const objects = island.objects;
  const islandPos = island.worldCenter();
  const dustCount = 130;
  const dustPos = new Float32Array(dustCount * 3);
  const dustVel = [];
  for (let i = 0; i < dustCount; i++) {
    dustPos[i * 3] = islandPos.x + (Math.random()-0.5)*5;
    dustPos[i * 3 + 1] = islandPos.y + Math.random()*2.5;
    dustPos[i * 3 + 2] = islandPos.z + (Math.random()-0.5)*5;
    dustVel.push(new THREE.Vector3((Math.random()-0.5)*2, Math.random()*2.5+0.5, (Math.random()-0.5)*2));
  }
  const dustGeo = new THREE.BufferGeometry();
  dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPos, 3));
  const dustMat = new THREE.PointsMaterial({ color: 0xcccccc, size: 0.05, transparent: true, depthWrite: false });
  const dust = new THREE.Points(dustGeo, dustMat);
  scene.add(dust);
  const spirit = buildSpirit();
  spirit.position.copy(islandPos);
  spirit.scale.setScalar(0);
  scene.add(spirit);
  const startScales = objects.map(o => o.scale.clone());
  let t = 0;
  return {
    tick: (delta) => {
      t += delta;
      if (t < 0.9) {
        const p = 1 - (t / 0.9);
        objects.forEach((o, i) => o.scale.set(startScales[i].x*p, startScales[i].y*p, startScales[i].z*p));
      }
      if (t >= 0.9 && t < 1.7) {
        objects.forEach(o => o.visible = false);
        const p = Math.min((t - 0.9) / 0.8, 1);
        spirit.scale.setScalar(p * 1.3);
      }
      const dArr = dustGeo.attributes.position.array;
      for (let i = 0; i < dustCount; i++) {
        dArr[i * 3] += dustVel[i].x * delta;
        dArr[i * 3 + 1] += dustVel[i].y * delta;
        dArr[i * 3+2] += dustVel[i].z * delta;
      }
      dustGeo.attributes.position.needsUpdate = true;
      dustMat.opacity = Math.max(0, 1 - t / 1.5);
      return t >= 1.7;
    },
    spirit
  };
}

function buildSpirit() {
  const group = new THREE.Group();
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.23, 10, 8), new THREE.MeshToonMaterial({ color: 0xffffff, emissive: new THREE.Color(0x90caf9), emissiveIntensity: 0.9 }));
  group.add(body);
  const wingMat = new THREE.MeshToonMaterial({ color: 0xb3e5fc, transparent: true, opacity: 0.85 });
  [-1, 1].forEach(side => {
    const wing = new THREE.Mesh(new THREE.ConeGeometry(0.48, 0.18, 4), wingMat);
    wing.rotation.z = side * Math.PI / 2;
    wing.position.x = side * 0.46;
    group.add(wing);
  });
  const tail = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.42, 4), new THREE.MeshToonMaterial({ color: 0xe1f5fe, emissive: new THREE.Color(0x29b6f6), emissiveIntensity: 0.6 }));
  tail.position.y = -0.37; tail.rotation.x = Math.PI; group.add(tail);
  return group;
}

export function createFlightClouds(scene) {
  const clouds = [];
  const speeds = []; 
  for (let i = 0; i < 22; i++) {
    const cloud = buildCloud();
    cloud.position.set((Math.random()-0.5)*26, Math.random()*8+6, -Math.random()*85-5);
    cloud.scale.setScalar(0.4+Math.random()*0.7);
    scene.add(cloud); clouds.push(cloud); speeds.push(7+Math.random()*5);
  }
  return { 
    tick: (delta, cam) => { 
      clouds.forEach((c,i)=>{
        c.position.z+=speeds[i]*delta; 
        if(c.position.z>8)c.position.z=-85;
        if(cam) c.lookAt(cam.position);
      }); return false; 
    },
    dispose: () => { clouds.forEach(c=>scene.remove(c)); }
  };
}

function buildCloud() {
  const group = new THREE.Group();
  const mat = new THREE.MeshToonMaterial({ color: 0xd6eeff, transparent: true, opacity: 0.5 });
  [[0,0,0,0.62],[-0.52,-0.1,0,0.42],[0.58,-0.1,0,0.46],[0.1,0.32,0,0.38]].forEach(([x,y,z,r])=>{
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(r,6,5), mat);
    mesh.position.set(x,y,z); group.add(mesh);
  });
  return group;
}

export function createBackgroundClouds(scene) {
  const clouds = [];
  for (let i = 0; i < 12; i++) {
    const cloud = buildCloud();
    const angle = (i/12)*Math.PI*2; const r = 25+Math.random()*10;
    cloud.position.set(Math.cos(angle)*r, 4+Math.random()*8, Math.sin(angle)*r);
    cloud.scale.setScalar(1.5+Math.random()*2);
    scene.add(cloud); clouds.push({mesh:cloud, speed:0.1+Math.random()*0.1, offset:Math.random()*Math.PI*2});
  }
  return (delta, elapsed, cam) => { 
    clouds.forEach(c=>{
      c.mesh.position.y+=Math.sin(elapsed*0.5+c.offset)*0.005; 
      if(cam) c.mesh.lookAt(cam.position);
    }); 
  };
}

export function createStardust() {
  const group = new THREE.Group();
  const count = 1500;
  const pos = new Float32Array(count*3);
  const sizeScales = new Float32Array(count);
  for (let i=0; i<count; i++) {
    const phi=Math.acos(2*Math.random()-1), theta=Math.random()*Math.PI*2, r=90+Math.random()*30;
    pos[i*3]=r*Math.sin(phi)*Math.cos(theta); pos[i*3+1]=r*Math.sin(phi)*Math.sin(theta); pos[i*3+2]=r*Math.cos(phi);
    sizeScales[i] = 0.25 + Math.random() * 1.0;
  }
  const geo=new THREE.BufferGeometry(); 
  geo.setAttribute('position', new THREE.BufferAttribute(pos,3));
  geo.setAttribute('sizeScale', new THREE.BufferAttribute(sizeScales, 1));

  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 } },
    vertexShader: `
      attribute float sizeScale;
      varying float vBlink;
      uniform float uTime;
      void main() {
        vBlink = 0.5 + 0.5 * sin(uTime * 2.0 + position.x * 0.1 + position.y * 0.1);
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = (sizeScale * vBlink) * (400.0 / -mvPosition.z);
        gl_Position = projectionMatrix * mvPosition;
      }
    `,
    fragmentShader: `
      varying float vBlink;
      void main() {
        float d = distance(gl_PointCoord, vec2(0.5));
        if (d > 0.5) discard;
        gl_FragColor = vec4(1.0, 1.0, 1.0, (0.2 + vBlink * 0.3) * smoothstep(0.5, 0.2, d));
      }
    `,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending
  });

  const points = new THREE.Points(geo, mat);
  group.add(points);
  return { 
    mesh: group, 
    tick: (delta, el) => { 
      group.rotation.y = el * 0.01; 
      mat.uniforms.uTime.value = el;
    } 
  };
}

export function createAurora() {
  const geo = new THREE.CylinderGeometry(85, 85, 60, 64, 16, true);
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uColor1: { value: new THREE.Color(0x00ff99) }, // Emerald Green
      uColor2: { value: new THREE.Color(0x7c4dff) }, // Deep Purple
      uIntensity: { value: 1.0 }
    },
    vertexShader: `
      varying vec2 vUv;
      varying vec3 vWorldPosition;
      void main() {
        vUv = uv;
        vWorldPosition = (modelMatrix * vec4(position, 1.0)).xyz;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform float uTime;
      uniform vec3 uColor1;
      uniform vec3 uColor2;
      uniform float uIntensity;
      varying vec2 vUv;
      varying vec3 vWorldPosition;

      // Simple Noise
      float noise(vec2 p) {
        return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
      }

      float smoothNoise(vec2 p) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        float a = noise(i);
        float b = noise(i + vec2(1.0, 0.0));
        float c = noise(i + vec2(0.0, 1.0));
        float d = noise(i + vec2(1.0, 1.0));
        return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
      }

      float fbm(vec2 p) {
        float v = 0.0;
        float a = 0.5;
        for (int i = 0; i < 4; i++) {
          v += a * smoothNoise(p);
          p *= 2.0;
          a *= 0.5;
        }
        return v;
      }

      void main() {
        // Vertical fade (bottom only to prevent sharp edge)
        float vFade = smoothstep(0.0, 0.15, vUv.y);
        
        // Aurora pattern
        vec2 p = vUv * vec2(8.0, 1.2);
        p.x += uTime * 0.1;
        p.y += uTime * 0.05;
        
        float n = fbm(p + fbm(p * 2.0 + uTime * 0.1));
        
        // Sharp ribbons
        float ribbon = smoothstep(0.4, 0.6, n);
        float ribbon2 = smoothstep(0.5, 0.7, fbm(p * 1.5 - uTime * 0.1));
        
        float colorMix = pow(vUv.y, 1.5); // Push the second color slightly higher
        vec3 finalColor = mix(uColor1, uColor2, colorMix);
        float alpha = (ribbon * 0.7 + ribbon2 * 0.3) * vFade * uIntensity;
        
        gl_FragColor = vec4(finalColor * alpha * 2.0, alpha);
      }
    `,
    transparent: true,
    side: THREE.BackSide,
    depthWrite: false,
    blending: THREE.AdditiveBlending
  });

  const mesh = new THREE.Mesh(geo, mat);
  mesh.rotation.x = 0.1; // Slight tilt
  return {
    mesh,
    tick: (delta, el) => {
      mat.uniforms.uTime.value = el;
    }
  };
}

export function createAtmosphere() {
  const geo = new THREE.SphereGeometry(95, 32, 32);
  const mat = new THREE.ShaderMaterial({
    uniforms: { topColor: {value:new THREE.Color(0x001d3d)}, bottomColor: {value:new THREE.Color(0x90e0ef)}, offset: {value:15}, exponent: {value:0.5} },
    vertexShader: `varying vec3 vWorldPosition; void main() { vWorldPosition=(modelMatrix*vec4(position,1.0)).xyz; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
    fragmentShader: `uniform vec3 topColor, bottomColor; uniform float offset, exponent; varying vec3 vWorldPosition; void main() { float h=normalize(vWorldPosition+offset).y; gl_FragColor=vec4(mix(bottomColor, topColor, max(pow(max(h,0.0), exponent), 0.0)), 1.0); }`,
    side: THREE.BackSide
  });
  return new THREE.Mesh(geo, mat);
}

export function createMoon(scene) {
  const group = new THREE.Group();
  group.name = 'CelestialGroup';

  // 1. AY (Night Visual)
  const moon = new THREE.Mesh(new THREE.SphereGeometry(8.0,32,32), new THREE.MeshBasicMaterial({color:0xfff9e6, fog: false}));
  moon.name = 'VisualMoon';
  group.add(moon);
  
  // 2. GÜNEŞ (Morning Visual)
  const sunMesh = new THREE.Mesh(new THREE.SphereGeometry(8.0,32,32), new THREE.MeshBasicMaterial({color:0xffcc33, fog: false}));
  sunMesh.name = 'VisualSun';
  sunMesh.visible = false; // Gündüz modunda açılacak
  group.add(sunMesh);

  const glowGeo = new THREE.PlaneGeometry(60, 60);
  const glowMat = new THREE.MeshBasicMaterial({ color: 0xfff9e6, transparent: true, opacity: 0.3, map: particleTexture, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false });
  const glow = new THREE.Mesh(glowGeo, glowMat);
  glow.name = 'CelestialGlow';
  group.add(glow);

  group.position.set(-30, 12, -60); // Ay aşağı indirildi ve küçültüldü
  scene.add(group);
  return group;
}

// ─── EMBER PARTICLES (float up from burning mesh) ────────────────────────────
export function createEmberParticles(position, scene) {
  const count = 25;
  const positions = new Float32Array(count * 3);
  const sizeScales = new Float32Array(count);
  const colors = new Float32Array(count * 3);
  const opacities = new Float32Array(count);

  const emberColors = [
    new THREE.Color(0xff4500),  // orange-red
    new THREE.Color(0xff6a00),  // ember orange
    new THREE.Color(0xffaa00),  // warm yellow
    new THREE.Color(0xff2200),  // deep red
  ];

  const velocities = Array.from({ length: count }, () => new THREE.Vector3(
    (Math.random() - 0.5) * 0.8,
    Math.random() * 1.5 + 0.8,   // float upward
    (Math.random() - 0.5) * 0.8
  ));

  for (let i = 0; i < count; i++) {
    positions[i * 3]     = position.x + (Math.random() - 0.5) * 0.5;
    positions[i * 3 + 1] = position.y + Math.random() * 0.3;
    positions[i * 3 + 2] = position.z + (Math.random() - 0.5) * 0.5;
    sizeScales[i] = 0.15 + Math.random() * 0.35;
    const c = emberColors[Math.floor(Math.random() * emberColors.length)];
    colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
    opacities[i] = 0.8 + Math.random() * 0.2;
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('sizeScale', new THREE.BufferAttribute(sizeScales, 1));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.setAttribute('opacity', new THREE.BufferAttribute(opacities, 1));

  const mat = new THREE.ShaderMaterial({
    ...proceduralShader,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending
  });

  const pts = new THREE.Points(geo, mat);
  scene.add(pts);

  let t = 0;
  const DURATION = 2.0;

  return (delta) => {
    t += delta;
    const p = t / DURATION;
    if (p >= 1) { scene.remove(pts); geo.dispose(); mat.dispose(); return true; }

    const arr = geo.attributes.position.array;
    const opp = geo.attributes.opacity.array;
    for (let i = 0; i < count; i++) {
      const v = velocities[i];
      arr[i * 3]     += v.x * delta * 0.5;
      arr[i * 3 + 1] += v.y * delta;
      arr[i * 3 + 2] += v.z * delta * 0.5;
      // Flicker opacity
      opp[i] = Math.max(0, (1.0 - p) * (0.6 + 0.4 * Math.sin(t * 12 + i)));
    }
    geo.attributes.position.needsUpdate = true;
    geo.attributes.opacity.needsUpdate = true;
    return false;
  };
}

// ─── ASH DISINTEGRATION EFFECT (mesh fully consumed) ─────────────────────────
export function createAshEffect(position, scene) {
  const count = 80;
  const positions = new Float32Array(count * 3);
  const sizeScales = new Float32Array(count);
  const colors = new Float32Array(count * 3);
  const opacities = new Float32Array(count);

  const ashColors = [
    new THREE.Color(0x333333),  // dark ash
    new THREE.Color(0x555555),  // medium ash
    new THREE.Color(0x222222),  // charcoal
    new THREE.Color(0x444444),  // gray
    new THREE.Color(0x1a1a1a),  // near black
  ];

  const velocities = Array.from({ length: count }, () => new THREE.Vector3(
    (Math.random() - 0.5) * 2.5,
    Math.random() * 2.0 + 0.5,
    (Math.random() - 0.5) * 2.5
  ));

  // Some particles have ember glow mixed in
  const emberChance = 0.3;

  for (let i = 0; i < count; i++) {
    positions[i * 3]     = position.x + (Math.random() - 0.5) * 0.6;
    positions[i * 3 + 1] = position.y + Math.random() * 0.4;
    positions[i * 3 + 2] = position.z + (Math.random() - 0.5) * 0.6;
    sizeScales[i] = 0.2 + Math.random() * 0.6;
    const isEmber = Math.random() < emberChance;
    const c = isEmber
      ? new THREE.Color(0xff4500).lerp(new THREE.Color(0xff8800), Math.random())
      : ashColors[Math.floor(Math.random() * ashColors.length)];
    colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
    opacities[i] = 1.0;
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('sizeScale', new THREE.BufferAttribute(sizeScales, 1));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.setAttribute('opacity', new THREE.BufferAttribute(opacities, 1));

  const mat = new THREE.ShaderMaterial({
    ...proceduralShader,
    transparent: true, depthWrite: false, blending: THREE.NormalBlending
  });

  const pts = new THREE.Points(geo, mat);
  scene.add(pts);

  let t = 0;
  const GRAVITY = 3.0;
  const DURATION = 3.0;

  return (delta) => {
    t += delta;
    const p = t / DURATION;
    if (p >= 1) { scene.remove(pts); geo.dispose(); mat.dispose(); return true; }

    const arr = geo.attributes.position.array;
    const opp = geo.attributes.opacity.array;
    for (let i = 0; i < count; i++) {
      const v = velocities[i];
      arr[i * 3]     += v.x * delta * 0.7;
      arr[i * 3 + 1] += (v.y - GRAVITY * t * 0.5) * delta;
      arr[i * 3 + 2] += v.z * delta * 0.7;
      // Slow fade out
      opp[i] = Math.max(0, 1.0 - p * 1.3);
    }
    geo.attributes.position.needsUpdate = true;
    geo.attributes.opacity.needsUpdate = true;
    return false;
  };
}
