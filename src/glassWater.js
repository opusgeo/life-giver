import * as THREE from 'three';

// ─── Storage keys ─────────────────────────────────────────────────────────────
const SK_GLASS_MESHES  = 'glass_meshes_v1';
const SK_GLASS_PARAMS  = 'glass_params_v1';
const SK_WATER_MESHES  = 'water_meshes_v1';
const SK_WATER_PARAMS  = 'water_params_v1';

// ─── Defaults ─────────────────────────────────────────────────────────────────
export const GLASS_DEFAULTS = {
  color:        '#a8d8f0',  // pale cyan tint
  opacity:      0.18,       // base center transparency
  fresnelPow:   3.5,        // rim sharpness
  fresnelStr:   0.85,       // rim intensity
  iridescence:  0.25,       // rainbow shift amount
  rimColor:     '#ffffff',  // rim/reflection color
  thickness:    0.5,        // fake refraction offset intensity
};

export const WATER_DEFAULTS = {
  shallowColor: '#00d4b0',  // bright turquoise (dominant)
  deepColor:    '#008f78',  // darker teal for depth patches
  causticColor: '#6ffff0',  // bright caustic highlight
  opacity:      0.88,
  waveHeight:   0.012,      // very subtle — stylized is calm
  waveSpeed:    0.5,
  causticStr:   0.32,       // caustic blob intensity
  causticScale: 2.2,        // caustic pattern size
  specularStr:  0.55,       // sun sparkle
  edgeFoam:     0.18,       // soft edge brighten
  tiling:       3.0,
};

// ═══════════════════════════════════════════════════════════════════════════════
// GLASS
// ═══════════════════════════════════════════════════════════════════════════════
const glassVert = /* glsl */`
  varying vec3 vNormal;
  varying vec3 vViewDir;
  varying vec2 vUv;

  void main() {
    vUv = uv;
    vec4 worldPos  = modelMatrix * vec4(position, 1.0);
    vNormal        = normalize(mat3(modelMatrix) * normal);
    vViewDir       = normalize(cameraPosition - worldPos.xyz);
    gl_Position    = projectionMatrix * viewMatrix * worldPos;
  }
`;

const glassFrag = /* glsl */`
  uniform vec3  uColor;
  uniform float uOpacity;
  uniform float uFresnelPow;
  uniform float uFresnelStr;
  uniform float uIridescence;
  uniform vec3  uRimColor;

  varying vec3 vNormal;
  varying vec3 vViewDir;
  varying vec2 vUv;

  void main() {
    vec3  N     = normalize(vNormal);
    vec3  V     = normalize(vViewDir);
    float NdotV = clamp(dot(N, V), 0.0, 1.0);

    // Fresnel rim — edges are reflective
    float fresnel = pow(1.0 - NdotV, uFresnelPow);

    // Thin-film iridescence (angle-dependent hue shift)
    vec3 irid = vec3(
      0.5 + 0.5 * sin(NdotV * 6.28318 + 0.0),
      0.5 + 0.5 * sin(NdotV * 6.28318 + 2.094),
      0.5 + 0.5 * sin(NdotV * 6.28318 + 4.189)
    );

    vec3 base  = mix(uColor, irid, uIridescence * (1.0 - NdotV));
    vec3 rim   = uRimColor * fresnel * uFresnelStr;
    vec3 color = base + rim;

    // Alpha: transparent in center, opaque at rim
    float alpha = mix(uOpacity, min(uOpacity + 0.55, 1.0), fresnel * uFresnelStr);
    alpha = clamp(alpha, 0.0, 1.0);

    gl_FragColor = vec4(color, alpha);
  }
`;

export function makeGlassMaterial(p) {
  return new THREE.ShaderMaterial({
    vertexShader:   glassVert,
    fragmentShader: glassFrag,
    uniforms: {
      uColor:       { value: new THREE.Color(p.color) },
      uOpacity:     { value: p.opacity },
      uFresnelPow:  { value: p.fresnelPow },
      uFresnelStr:  { value: p.fresnelStr },
      uIridescence: { value: p.iridescence },
      uRimColor:    { value: new THREE.Color(p.rimColor) },
    },
    transparent: true,
    depthWrite:  false,
    side:        THREE.DoubleSide,
    blending:    THREE.NormalBlending,
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// WATER — Stylized cel / cozy-game look  (ref: Animal Crossing / Cozy Grove)
// ═══════════════════════════════════════════════════════════════════════════════
const waterVert = /* glsl */`
  uniform float uTime;
  uniform float uWaveHeight;
  uniform float uWaveSpeed;
  uniform float uTiling;

  varying vec2  vUv;
  varying vec2  vUvRaw;   // un-tiled, for edge foam
  varying vec3  vNormal;
  varying vec3  vViewDir;
  varying vec3  vWorldPos;

  void main() {
    vUvRaw = uv;
    vUv    = uv * uTiling;

    vec3  pos = position;
    float t   = uTime * uWaveSpeed;

    // Very gentle normal-direction ripple — keeps silhouette calm
    float wave = sin(position.x * 6.0 + t * 1.1) * 0.5
               + cos(position.z * 5.3 + t * 0.9) * 0.5;
    pos += normal * wave * uWaveHeight;

    vec4 worldPos   = modelMatrix * vec4(pos, 1.0);
    vWorldPos       = worldPos.xyz;
    vNormal         = normalize(mat3(modelMatrix) * normal);
    vViewDir        = normalize(cameraPosition - worldPos.xyz);
    gl_Position     = projectionMatrix * viewMatrix * worldPos;
  }
`;

const waterFrag = /* glsl */`
  uniform float uTime;
  uniform vec3  uShallowColor;
  uniform vec3  uDeepColor;
  uniform vec3  uCausticColor;
  uniform float uOpacity;
  uniform float uCausticStr;
  uniform float uCausticScale;
  uniform float uSpecularStr;
  uniform float uEdgeFoam;

  varying vec2  vUv;
  varying vec2  vUvRaw;
  varying vec3  vNormal;
  varying vec3  vViewDir;
  varying vec3  vWorldPos;

  // ── Smooth value noise ──────────────────────────────────────────────────────
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float vnoise(vec2 p) {
    vec2 i = floor(p); vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i),            hash(i + vec2(1.0, 0.0)), f.x),
               mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
  }

  // ── Stylized caustic blobs (two rotated noise layers multiplied) ────────────
  float causticBlob(vec2 uv, float t) {
    vec2 a = uv + vec2( t * 0.07,  t * 0.05);
    vec2 b = uv + vec2(-t * 0.04,  t * 0.09);
    float n1 = vnoise(a * 1.0) * vnoise(a * 1.7 + 1.3);
    float n2 = vnoise(b * 1.1) * vnoise(b * 1.5 + 2.1);
    // sharpen into bright blobs — characteristic caustic look
    float c = pow(n1 * n2 * 4.0, 1.8);
    return clamp(c, 0.0, 1.0);
  }

  void main() {
    vec3  N     = normalize(vNormal);
    vec3  V     = normalize(vViewDir);
    float NdotV = clamp(dot(N, V), 0.0, 1.0);

    // ── Base color: shallow ↔ deep by view angle ───────────────────────────
    // Flat / top-down = NdotV≈1 → shallow (bright); grazing = deeper tint
    float depthT = 1.0 - NdotV;
    vec3 baseColor = mix(uShallowColor, uDeepColor, smoothstep(0.0, 0.65, depthT));

    // ── Caustics ──────────────────────────────────────────────────────────
    float t = uTime;
    vec2  cUv = vUv * uCausticScale;
    float caustic = causticBlob(cUv, t);
    // Second layer offset for layered depth
    float caustic2 = causticBlob(cUv * 0.7 + vec2(3.1, 1.7), t * 0.8) * 0.5;
    float totalCaustic = caustic + caustic2;

    baseColor = mix(baseColor, uCausticColor, totalCaustic * uCausticStr);

    // ── Specular highlight (fake sun) ──────────────────────────────────────
    // Simple blinn-phong against a fixed "sun" direction
    vec3 L = normalize(vec3(0.4, 1.0, 0.3));
    vec3 H = normalize(V + L);
    float spec = pow(max(dot(N, H), 0.0), 48.0);
    baseColor += vec3(1.0) * spec * uSpecularStr;

    // ── Edge brighten (contact foam / shoreline) ──────────────────────────
    // Use view-grazing angle as a proxy for edges
    float edge = pow(1.0 - NdotV, 4.0);
    baseColor = mix(baseColor, vec3(0.88, 1.0, 0.97), edge * uEdgeFoam);

    // ── Subtle scroll lines (gives water surface movement feel) ───────────
    float lineA = sin(vUv.x * 8.0 + t * 0.6 + vUv.y * 2.0) * 0.5 + 0.5;
    float lineB = cos(vUv.y * 7.0 + t * 0.5 + vUv.x * 1.5) * 0.5 + 0.5;
    float lines = smoothstep(0.78, 1.0, lineA * lineB) * 0.06;
    baseColor += vec3(lines);

    // ── Alpha: slightly more opaque at edges / grazing ─────────────────────
    float alpha = clamp(uOpacity + edge * 0.08, 0.0, 1.0);

    gl_FragColor = vec4(baseColor, alpha);
  }
`;

export function makeWaterMaterial(p) {
  return new THREE.ShaderMaterial({
    vertexShader:   waterVert,
    fragmentShader: waterFrag,
    uniforms: {
      uTime:         { value: 0 },
      uShallowColor: { value: new THREE.Color(p.shallowColor) },
      uDeepColor:    { value: new THREE.Color(p.deepColor) },
      uCausticColor: { value: new THREE.Color(p.causticColor) },
      uOpacity:      { value: p.opacity },
      uWaveHeight:   { value: p.waveHeight },
      uWaveSpeed:    { value: p.waveSpeed },
      uCausticStr:   { value: p.causticStr },
      uCausticScale: { value: p.causticScale },
      uSpecularStr:  { value: p.specularStr },
      uEdgeFoam:     { value: p.edgeFoam },
      uTiling:       { value: p.tiling },
    },
    transparent: true,
    depthWrite:  false,
    side:        THREE.DoubleSide,
    blending:    THREE.NormalBlending,
  });
}

// ─── Generic apply / remove helpers ──────────────────────────────────────────
const GLASS_TAG = '__glass__';
const WATER_TAG = '__water__';

function _apply(mesh, mat, tag) {
  if (mesh.userData[tag]) return;
  mesh.userData[tag]           = true;
  mesh.userData[tag + '_orig'] = mesh.material;
  mesh.material = mat;
}
function _remove(mesh, tag) {
  if (!mesh.userData[tag]) return;
  mesh.material.dispose();
  mesh.material = mesh.userData[tag + '_orig'];
  delete mesh.userData[tag];
  delete mesh.userData[tag + '_orig'];
}

export function applyGlass(mesh, p)  { _apply(mesh, makeGlassMaterial(p), GLASS_TAG); }
export function removeGlass(mesh)    { _remove(mesh, GLASS_TAG); }
export function isGlass(mesh)        { return !!mesh.userData[GLASS_TAG]; }

export function applyWaterMesh(mesh, p) { _apply(mesh, makeWaterMaterial(p), WATER_TAG); }
export function removeWaterMesh(mesh)   { _remove(mesh, WATER_TAG); }
export function isWaterMesh(mesh)       { return !!mesh.userData[WATER_TAG]; }

// ─── Bulk update ─────────────────────────────────────────────────────────────
export function updateGlassMaterials(meshSet, p) {
  for (const m of meshSet) {
    const u = m.material?.uniforms;
    if (!u || !u.uColor) continue;
    u.uColor.value.set(p.color);
    u.uOpacity.value     = p.opacity;
    u.uFresnelPow.value  = p.fresnelPow;
    u.uFresnelStr.value  = p.fresnelStr;
    u.uIridescence.value = p.iridescence;
    u.uRimColor.value.set(p.rimColor);
  }
}

export function updateWaterMeshMaterials(meshSet, p, time) {
  for (const m of meshSet) {
    const u = m.material?.uniforms;
    if (!u) continue;
    u.uTime.value          = time;
    u.uShallowColor.value.set(p.shallowColor);
    u.uDeepColor.value.set(p.deepColor);
    u.uCausticColor.value.set(p.causticColor);
    u.uOpacity.value       = p.opacity;
    u.uWaveHeight.value    = p.waveHeight;
    u.uWaveSpeed.value     = p.waveSpeed;
    u.uCausticStr.value    = p.causticStr;
    u.uCausticScale.value  = p.causticScale;
    u.uSpecularStr.value   = p.specularStr;
    u.uEdgeFoam.value      = p.edgeFoam;
    u.uTiling.value        = p.tiling;
  }
}

// ─── Persistence ─────────────────────────────────────────────────────────────
export function meshId(mesh) {
  // Build a stable path-based ID from the mesh's ancestor names.
  // UUID is NOT stable across getModel() clones, but names are preserved by clone().
  const parts = [];
  let node = mesh;
  while (node) {
    if (node.name) parts.unshift(node.name);
    node = node.parent;
  }
  return parts.length ? parts.join('/') : ('__m_' + mesh.uuid);
}

function _save(key, data) { localStorage.setItem(key, JSON.stringify(data)); }
function _load(key, def)  { try { return JSON.parse(localStorage.getItem(key) || 'null') ?? def; } catch { return def; } }

export const saveGlassMeshIds  = (s, lvl = -1) => _save(lvl >= 0 ? `${SK_GLASS_MESHES}_lvl_${lvl}` : SK_GLASS_MESHES, [...s].map(meshId));
export const loadGlassMeshIds  = (lvl = -1)  => _load(lvl >= 0 ? `${SK_GLASS_MESHES}_lvl_${lvl}` : SK_GLASS_MESHES, []);
export const saveGlassParams   = (p, lvl = -1) => _save(lvl >= 0 ? `${SK_GLASS_PARAMS}_lvl_${lvl}` : SK_GLASS_PARAMS, p);
export const loadGlassParams   = (lvl = -1)  => ({ ...GLASS_DEFAULTS, ..._load(lvl >= 0 ? `${SK_GLASS_PARAMS}_lvl_${lvl}` : SK_GLASS_PARAMS, {}) });

export const saveWaterMeshIds  = (s, lvl = -1) => _save(lvl >= 0 ? `${SK_WATER_MESHES}_lvl_${lvl}` : SK_WATER_MESHES, [...s].map(meshId));
export const loadWaterMeshIds  = (lvl = -1)  => _load(lvl >= 0 ? `${SK_WATER_MESHES}_lvl_${lvl}` : SK_WATER_MESHES, []);
export const saveWaterParams   = (p, lvl = -1) => _save(lvl >= 0 ? `${SK_WATER_PARAMS}_lvl_${lvl}` : SK_WATER_PARAMS, p);
export const loadWaterParams   = (lvl = -1)  => ({ ...WATER_DEFAULTS, ..._load(lvl >= 0 ? `${SK_WATER_PARAMS}_lvl_${lvl}` : SK_WATER_PARAMS, {}) });
