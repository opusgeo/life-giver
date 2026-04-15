import * as THREE from 'three';

// ─── Defaults ─────────────────────────────────────────────────────────────────
export const VOL_DEFAULTS = {
  color:        '#ffe8a0',
  intensity:    0.55,
  dustOpacity:  0.45,
  noiseScale:   3.5,
  edgeSoftness: 0.55,
  depthFade:    0.7,
};

// localStorage key for which mesh names are marked volumetric
const STORAGE_KEY_MESHES  = 'vol_meshes_v1';
const STORAGE_KEY_PARAMS  = 'vol_params_v1';

// ─── Shader ───────────────────────────────────────────────────────────────────
const vertexShader = /* glsl */`
  varying vec2 vUv;

  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const fragmentShader = /* glsl */`
  uniform vec3  uColor;
  uniform float uIntensity;
  uniform float uDustOpacity;
  uniform float uNoiseScale;
  uniform float uEdgeSoftness;
  uniform float uDepthFade;
  uniform float uTime;

  varying vec2 vUv;

  // Fast value noise
  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
  }
  float vnoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(hash(i),             hash(i + vec2(1.0, 0.0)), f.x),
      mix(hash(i + vec2(0.0,1.0)), hash(i + vec2(1.0, 1.0)), f.x),
      f.y
    );
  }
  float fbm(vec2 p) {
    return vnoise(p) * 0.6 + vnoise(p * 2.1 + 1.3) * 0.3 + vnoise(p * 4.7 + 5.1) * 0.1;
  }

  void main() {
    // Edge fade: 0 at edges, 1 at center
    float edgeDist = abs(vUv.x - 0.5) * 2.0;
    float edgeFade = 1.0 - smoothstep(1.0 - uEdgeSoftness, 1.0, edgeDist);

    // Depth / length fade (brighter near source at uv.y = 0)
    float depth = 1.0 - vUv.y;
    float depthFade = mix(1.0, depth * depth, uDepthFade);

    // Animated dust particles
    vec2 noiseUv = vUv * uNoiseScale + vec2(0.0, uTime * 0.08);
    float dust   = fbm(noiseUv);
    float dustFx = mix(1.0, dust * 1.8, uDustOpacity);

    float alpha = edgeFade * depthFade * uIntensity * dustFx;
    alpha = clamp(alpha, 0.0, 1.0);

    gl_FragColor = vec4(uColor * alpha, alpha);
  }
`;

// ─── Material factory ─────────────────────────────────────────────────────────
export function makeVolMaterial(params) {
  return new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms: {
      uColor:        { value: new THREE.Color(params.color) },
      uIntensity:    { value: params.intensity },
      uDustOpacity:  { value: params.dustOpacity },
      uNoiseScale:   { value: params.noiseScale },
      uEdgeSoftness: { value: params.edgeSoftness },
      uDepthFade:    { value: params.depthFade },
      uTime:         { value: 0 },
    },
    transparent:  true,
    depthWrite:   false,
    depthTest:    false,
    side:         THREE.DoubleSide,
    blending:     THREE.AdditiveBlending,
  });
}

// ─── Apply / Remove ───────────────────────────────────────────────────────────
const TAG = '__vol_light__';

export function applyVolumetric(mesh, params) {
  if (mesh.userData[TAG]) return; // already applied
  mesh.userData[TAG] = true;
  mesh.userData.__vol_origMat__ = mesh.material;
  mesh.material = makeVolMaterial(params);
  mesh.castShadow    = false;
  mesh.receiveShadow = false;
}

export function removeVolumetric(mesh) {
  if (!mesh.userData[TAG]) return;
  mesh.material.dispose();
  mesh.material = mesh.userData.__vol_origMat__;
  delete mesh.userData[TAG];
  delete mesh.userData.__vol_origMat__;
}

export function isVolumetric(mesh) {
  return !!mesh.userData[TAG];
}

// ─── Update all vol material uniforms ────────────────────────────────────────
export function updateVolMaterials(volMeshes, params, time) {
  for (const mesh of volMeshes) {
    const mat = mesh.material;
    if (!mat?.uniforms) continue;
    mat.uniforms.uColor.value.set(params.color);
    mat.uniforms.uIntensity.value    = params.intensity;
    mat.uniforms.uDustOpacity.value  = params.dustOpacity;
    mat.uniforms.uNoiseScale.value   = params.noiseScale;
    mat.uniforms.uEdgeSoftness.value = params.edgeSoftness;
    mat.uniforms.uDepthFade.value    = params.depthFade;
    mat.uniforms.uTime.value         = time;
  }
}

// ─── Persistence helpers ──────────────────────────────────────────────────────
/** Returns stable ID for a mesh (mesh.name, fallback to geometry uuid) */
export function meshId(mesh) {
  const parts = [];
  let node = mesh;
  while (node) {
    if (node.name) parts.unshift(node.name);
    node = node.parent;
  }
  return parts.length ? parts.join('/') : ('__mesh_' + mesh.uuid);
}

export function saveVolMeshIds(volMeshes, levelIdx = -1) {
  const ids = [...volMeshes].map(m => meshId(m));
  const key = levelIdx >= 0 ? `${STORAGE_KEY_MESHES}_lvl_${levelIdx}` : STORAGE_KEY_MESHES;
  localStorage.setItem(key, JSON.stringify(ids));
}

export function loadVolMeshIds(levelIdx = -1) {
  const key = levelIdx >= 0 ? `${STORAGE_KEY_MESHES}_lvl_${levelIdx}` : STORAGE_KEY_MESHES;
  try { return JSON.parse(localStorage.getItem(key) || '[]'); }
  catch { return []; }
}

export function saveVolParams(params, levelIdx = -1) {
  const key = levelIdx >= 0 ? `${STORAGE_KEY_PARAMS}_lvl_${levelIdx}` : STORAGE_KEY_PARAMS;
  localStorage.setItem(key, JSON.stringify(params));
}

export function loadVolParams(levelIdx = -1) {
  const key = levelIdx >= 0 ? `${STORAGE_KEY_PARAMS}_lvl_${levelIdx}` : STORAGE_KEY_PARAMS;
  try {
    const p = JSON.parse(localStorage.getItem(key) || 'null');
    return p ? { ...VOL_DEFAULTS, ...p } : { ...VOL_DEFAULTS };
  } catch { return { ...VOL_DEFAULTS }; }
}
