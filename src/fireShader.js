import * as THREE from 'three';

// ─── Defaults ─────────────────────────────────────────────────────────────────
export const FIRE_DEFAULTS = {
  color1: '#ff5a00',
  color2: '#ff9a00',
  color3: '#ffce00',
  speed: 1.5,
  scale: 2.0,
  intensity: 1.5
};

// ═══════════════════════════════════════════════════════════════════════════════
// FIRE SHADER
// ═══════════════════════════════════════════════════════════════════════════════
const fireVert = /* glsl */`
  uniform float uTime;
  varying vec2 vUv;
  varying float vFireY;

  void main() {
    vUv = uv;
    vFireY = uv.y;
    
    // Spherical Billboarding: Mesh always faces camera
    // We take the world position of the object center and then add the local vertex positions in view space.
    vec4 mvPosition = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
    
    // position.x and position.y are the local coordinates of the PlaneGeometry.
    // We apply the local scales to these.
    mvPosition.xy += position.xy;
    
    gl_Position = projectionMatrix * mvPosition;
  }
`;

const fireFrag = /* glsl */`
  uniform float uTime;
  uniform vec3 uColor1;
  uniform vec3 uColor2;
  uniform vec3 uColor3;
  uniform float uSpeed;
  uniform float uScale;
  uniform float uIntensity;

  varying vec2 vUv;
  varying float vFireY;

  // procedural noise from IQ
  vec2 hash( vec2 p ) {
    p = vec2( dot(p,vec2(127.1,311.7)), dot(p,vec2(269.5,183.3)) );
    return -1.0 + 2.0*fract(sin(p)*43758.5453123);
  }

  float noise( in vec2 p ) {
    const float K1 = 0.366025404; 
    const float K2 = 0.211324865; 
    vec2 i = floor( p + (p.x+p.y)*K1 );
    vec2 a = p - i + (i.x+i.y)*K2;
    vec2 o = (a.x>a.y) ? vec2(1.0,0.0) : vec2(0.0,1.0);
    vec2 b = a - o + K2;
    vec2 c = a - 1.0 + 2.0*K2;
    vec3 h = max( 0.5-vec3(dot(a,a), dot(b,b), dot(c,c) ), 0.0 );
    vec3 n = h*h*h*h*vec3( dot(a,hash(i+0.0)), dot(b,hash(i+o)), dot(c,hash(i+1.0)));
    return dot( n, vec3(70.0) );
  }

  float fbm(vec2 uv) {
    float f;
    mat2 m = mat2( 1.6,  1.2, -1.2,  1.6 );
    f  = 0.5000*noise( uv ); uv = m*uv;
    f += 0.2500*noise( uv ); uv = m*uv;
    f += 0.1250*noise( uv ); uv = m*uv;
    f += 0.0625*noise( uv ); uv = m*uv;
    f = 0.5 + 0.5*f;
    return f;
  }

  void main() {
    float time = uTime * uSpeed;
    
    // Single centered flame logic (Tweaked for smooshed single fire look)
    vec2 q = vUv;
    q.x *= 1.0; 
    q.y *= 2.0;
    
    float strength = floor(q.x + 1.0) * uScale;
    float T3 = max(3.0, 1.25 * strength) * time;
    
    q.x = mod(q.x, 1.0) - 0.5;
    q.x *= 2.0; // Smoosh the fire
    q.y -= 0.25;
    
    float n = fbm(strength * q - vec2(0.0, T3));
    
    // Shaping the flame (The core Shadertoy math)
    float c = 1.0 - 16.0 * pow( max( 0.0, length(q * vec2(1.8 + q.y * 1.5, 0.75) ) - n * max( 0.0, q.y + 0.25 ) ), 1.2 );
    
    // Use the 1.25 exponent as specified for a smoother fade
    float c1 = n * c * (1.5 - pow(1.25 * vFireY, 4.0));
    c1 = clamp(c1, 0.0, 1.0);

    // Color mixing (Shadertoy values)
    vec3 col = vec3(1.5 * c1, 1.5 * c1 * c1 * c1, c1 * c1 * c1 * c1 * c1 * c1);
    
    // Blend with user-defined colors for customization
    vec3 tint = mix(uColor1, uColor2, vFireY);
    col *= tint * 2.0;
    
    float a = c * (1.1 - pow(vFireY, 2.5));
    a = clamp(a, 0.0, 1.0);
    
    if (a < 0.1) discard;

    gl_FragColor = vec4(col * uIntensity, a);
  }
`;

export function makeFireMaterial(p) {
  return new THREE.ShaderMaterial({
    vertexShader:   fireVert,
    fragmentShader: fireFrag,
    uniforms: {
      uTime:      { value: 0 },
      uColor1:    { value: new THREE.Color(p.color1) },
      uColor2:    { value: new THREE.Color(p.color2) },
      uColor3:    { value: new THREE.Color(p.color3) },
      uSpeed:     { value: p.speed },
      uScale:     { value: p.scale },
      uIntensity: { value: p.intensity },
    },
    transparent: true,
    depthWrite:  false, 
    side:        THREE.DoubleSide,
    blending:    THREE.AdditiveBlending, 
  });
}

// ─── Generic apply / remove helpers ──────────────────────────────────────────
const FIRE_TAG = '__fire__';

export function applyFire(mesh, p) { 
  if (mesh.userData[FIRE_TAG]) return;
  mesh.userData[FIRE_TAG] = true;
  
  // Use a Plane for the billiard effect
  const geometry = new THREE.PlaneGeometry(0.8, 1.6);
  // Shift vertices so the bottom of the plane is at local (0,0,0)
  geometry.translate(0, 0.8, 0);

  const mat = makeFireMaterial(p);
  const fireMesh = new THREE.Mesh(geometry, mat);
  
  const light = new THREE.PointLight(p.color2, p.intensity * 2, 5.0);
  light.position.y = 0.5;
  
  const group = new THREE.Group();
  group.name = 'fireGroup_ext';
  group.add(fireMesh);
  group.add(light);
  
  // Try to place it nicely on top of the mesh
  if (mesh.geometry) {
    mesh.geometry.computeBoundingBox();
    const bb = mesh.geometry.boundingBox;
    if (bb) {
      const center = new THREE.Vector3();
      bb.getCenter(center);
      group.position.x = center.x;
      group.position.z = center.z;
      // sit on top
      group.position.y = bb.max.y;
    }
  }
  
  // Add an internal tag to the fireMesh to update its material later
  fireMesh.userData.__isFireMesh = true;
  
  mesh.add(group);
}

export function removeFire(mesh) { 
  if (!mesh.userData[FIRE_TAG]) return;
  
  const group = mesh.children.find(c => c.name === 'fireGroup_ext') || mesh.userData.__detachedFireGroup;
  if (group) {
    group.children.forEach(c => {
      if (c.isMesh) {
        c.material.dispose();
        c.geometry.dispose();
      } else if (c.isLight) {
        c.dispose();
      }
    });
    if (group.parent) group.parent.remove(group);
  }
  
  delete mesh.userData[FIRE_TAG];
  delete mesh.userData.__detachedFireGroup;
}

export function isFire(mesh) { 
  return !!mesh.userData[FIRE_TAG]; 
}

export function updateFireMaterials(meshSet, p, time) {
  for (const m of meshSet) {
    const group = m.children.find(c => c.name === 'fireGroup_ext');
    if (!group) continue;
    group.children.forEach(c => {
      if (c.userData.__isFireMesh && c.material?.uniforms) {
        const u = c.material.uniforms;
        u.uTime.value = time;
        u.uColor1.value.set(p.color1);
        u.uColor2.value.set(p.color2);
        u.uColor3.value.set(p.color3);
        u.uSpeed.value = p.speed;
        u.uScale.value = p.scale;
        u.uIntensity.value = p.intensity;
      } else if (c.isLight) {
        c.color.set(p.color2);
        c.intensity = p.intensity * 2;
      }
    });
  }
}


// ─── Persistence ─────────────────────────────────────────────────────────────
export function meshId(mesh) {
  const parts = [];
  let node = mesh;
  while (node) {
    if (node.name) parts.unshift(node.name);
    node = node.parent;
  }
  return parts.length ? parts.join('/') : ('__m_' + mesh.uuid);
}
const SK_FIRE_MESHES  = 'fire_meshes_v1';
const SK_FIRE_PARAMS  = 'fire_params_v1';

function _save(key, data) { localStorage.setItem(key, JSON.stringify(data)); }
function _load(key, def)  { try { return JSON.parse(localStorage.getItem(key) || 'null') ?? def; } catch { return def; } }

export const saveFireMeshIds  = (s, lvl = -1) => _save(lvl >= 0 ? `${SK_FIRE_MESHES}_lvl_${lvl}` : SK_FIRE_MESHES, [...s].map(meshId));
export const loadFireMeshIds  = (lvl = -1)  => _load(lvl >= 0 ? `${SK_FIRE_MESHES}_lvl_${lvl}` : SK_FIRE_MESHES, []);
export const saveFireParams   = (p, lvl = -1) => _save(lvl >= 0 ? `${SK_FIRE_PARAMS}_lvl_${lvl}` : SK_FIRE_PARAMS, p);
export const loadFireParams   = (lvl = -1)  => ({ ...FIRE_DEFAULTS, ..._load(lvl >= 0 ? `${SK_FIRE_PARAMS}_lvl_${lvl}` : SK_FIRE_PARAMS, {}) });

// ═══════════════════════════════════════════════════════════════════════════════
// BURN-TO-ASH SYSTEM
// ═══════════════════════════════════════════════════════════════════════════════
//
// Phases:
//   CHAR   (0–10s)  → mesh gradually darkens from original color to charcoal
//   ASH    (10–15s) → mesh shrinks, turns gray, embers intensify
//   DEATH  (15s)    → mesh is removed, ash particle burst
//
const BURN_CHAR_DURATION  = 10.0;  // seconds before ash phase starts
const BURN_ASH_DURATION   = 5.0;   // seconds of ash phase
const BURN_TOTAL          = BURN_CHAR_DURATION + BURN_ASH_DURATION; // 15s total
const EMBER_INTERVAL      = 2.5;   // spawn ember particles every N seconds

// Map<THREE.Mesh, { startTime, originalMaterials[], originalScale, lastEmberTime, charApplied }>
const burnTimers = new Map();

/**
 * Start tracking burn time for a mesh that just caught fire.
 * Call this right after applyFire().
 */
export function startBurnTimer(mesh, currentTime) {
  if (burnTimers.has(mesh)) return;

  // Store original materials for charring effect
  const originalMaterials = [];
  if (mesh.material) {
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    mats.forEach(m => {
      if (m.color) {
        originalMaterials.push({
          mat: m,
          origColor: m.color.clone(),
          origEmissive: m.emissive ? m.emissive.clone() : new THREE.Color(0x000000),
          origEmissiveIntensity: m.emissiveIntensity || 0,
        });
      }
    });
  }

  burnTimers.set(mesh, {
    startTime: currentTime,
    originalMaterials,
    originalScale: mesh.scale.clone(),
    lastEmberTime: currentTime,
    charApplied: false,
  });
}

/**
 * Stop burn timer (e.g., fire was extinguished in time).
 * Restores original material colors.
 */
export function clearBurnTimer(mesh) {
  const data = burnTimers.get(mesh);
  if (!data) return;

  // Restore original colors
  for (const entry of data.originalMaterials) {
    entry.mat.color.copy(entry.origColor);
    if (entry.mat.emissive) {
      entry.mat.emissive.copy(entry.origEmissive);
      entry.mat.emissiveIntensity = entry.origEmissiveIntensity;
    }
  }

  // Restore scale
  mesh.scale.copy(data.originalScale);

  burnTimers.delete(mesh);
}

/**
 * Clear all burn timers (e.g., on level switch).
 */
export function clearAllBurnTimers() {
  for (const [mesh, data] of burnTimers) {
    // Restore materials
    for (const entry of data.originalMaterials) {
      entry.mat.color.copy(entry.origColor);
      if (entry.mat.emissive) {
        entry.mat.emissive.copy(entry.origEmissive);
        entry.mat.emissiveIntensity = entry.origEmissiveIntensity;
      }
    }
    mesh.scale.copy(data.originalScale);
  }
  burnTimers.clear();
}

/**
 * Get burn progress for a mesh (0 = just ignited, 1 = fully consumed).
 */
export function getBurnProgress(mesh) {
  const data = burnTimers.get(mesh);
  if (!data) return 0;
  return 0; // Only meaningful when called with elapsed time
}

/**
 * Main burn system update — call every frame.
 * Returns an array of { mesh, event } where event is:
 *   'ember'  → time to spawn ember particles
 *   'death'  → mesh fully consumed, remove it
 *
 * @param {number} elapsed - current elapsed time (from clock)
 * @returns {{ mesh: THREE.Mesh, event: string, worldPos: THREE.Vector3 }[]}
 */
export function updateBurnTimers(elapsed) {
  const events = [];
  const _wp = new THREE.Vector3();

  for (const [mesh, data] of burnTimers) {
    const burnTime = elapsed - data.startTime;
    const totalProgress = Math.min(burnTime / BURN_TOTAL, 1.0); // 0..1

    // ── CHAR PHASE (0..BURN_CHAR_DURATION) ─────────────────────────────────
    if (burnTime <= BURN_CHAR_DURATION) {
      const charProgress = burnTime / BURN_CHAR_DURATION; // 0..1

      for (const entry of data.originalMaterials) {
        // Gradually darken: original → dark brown → charcoal
        const charColor = new THREE.Color();
        if (charProgress < 0.5) {
          // First half: original → dark brown
          const t = charProgress * 2;
          charColor.copy(entry.origColor).lerp(new THREE.Color(0x3d1c02), t);
        } else {
          // Second half: dark brown → charcoal
          const t = (charProgress - 0.5) * 2;
          charColor.set(0x3d1c02).lerp(new THREE.Color(0x111111), t);
        }
        entry.mat.color.copy(charColor);

        // Add glowing emissive as it chars
        if (entry.mat.emissive) {
          const glowIntensity = Math.sin(charProgress * Math.PI) * 0.4;
          entry.mat.emissive.set(0xff4500);
          entry.mat.emissiveIntensity = glowIntensity;
        }
      }
    }

    // ── ASH PHASE (BURN_CHAR_DURATION..BURN_TOTAL) ─────────────────────────
    if (burnTime > BURN_CHAR_DURATION && burnTime <= BURN_TOTAL) {
      const ashProgress = (burnTime - BURN_CHAR_DURATION) / BURN_ASH_DURATION; // 0..1

      // Trigger collapse animation once
      if (!data.collapseTriggered) {
        data.collapseTriggered = true;
        events.push({ mesh, event: 'collapse' });
      }

      // Turn to ash gray
      for (const entry of data.originalMaterials) {
        const ashColor = new THREE.Color(0x111111).lerp(new THREE.Color(0x2a2a2a), ashProgress * 0.5);
        entry.mat.color.copy(ashColor);

        // Fade emissive
        if (entry.mat.emissive) {
          entry.mat.emissiveIntensity = Math.max(0, 0.2 * (1 - ashProgress));
        }
      }
    }

    // ── EMBER SPAWNING ─────────────────────────────────────────────────────
    if (elapsed - data.lastEmberTime >= EMBER_INTERVAL && burnTime < BURN_TOTAL) {
      data.lastEmberTime = elapsed;
      mesh.getWorldPosition(_wp);
      events.push({ mesh, event: 'ember', worldPos: _wp.clone() });
    }

    // ── DEATH ──────────────────────────────────────────────────────────────
    if (burnTime >= BURN_TOTAL) {
      mesh.getWorldPosition(_wp);
      events.push({ mesh, event: 'death', worldPos: _wp.clone() });
    }
  }

  return events;
}
