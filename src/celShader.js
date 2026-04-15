import * as THREE from 'three';

// ─── CEL Defaults ─────────────────────────────────────────────────────────────
export const CEL_DEFAULTS = {
  enabled:          false,
  steps:            3,       // toon gradient bands (1-8)
  outlineEnabled:   true,
  outlineThickness: 0.03,   // 0.005 – 0.15
  outlineColor:     '#000000',
  brightness:       1.0,    // 0.2 – 2.0
  saturation:       1.0,    // 0.0 – 2.0
  useOriginalColors: true,
};

// ─── PBR Defaults ─────────────────────────────────────────────────────────────
export const PBR_DEFAULTS = {
  enabled:       true,
  roughnessMult: 1.0,   // 0.0 – 2.0
  metalnessMult: 0.0,   // 0.0 – 2.0
  emissiveAdd:   0.0,   // 0.0 – 1.0
  colorTint:     '#ffffff',
  tintStrength:  0.0,   // 0.0 – 1.0
};

// ─── Gradient map cache ───────────────────────────────────────────────────────
const _gradCache = {};
function makeGradMap(steps) {
  const key = Math.max(1, steps);
  if (_gradCache[key]) return _gradCache[key];
  const size = 256;
  const c = document.createElement('canvas');
  c.width = size; c.height = 1;
  const ctx = c.getContext('2d');
  for (let i = 0; i < key; i++) {
    const v = Math.round(((i + 1) / key) * 255);
    const x = Math.floor(i * size / key);
    const w = Math.ceil(size / key) + 1;
    ctx.fillStyle = `rgb(${v},${v},${v})`;
    ctx.fillRect(x, 0, w, 1);
  }
  const t = new THREE.CanvasTexture(c);
  t.minFilter = t.magFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  return (_gradCache[key] = t);
}

// ─── Outline helpers ──────────────────────────────────────────────────────────
export const OUTLINE_TAG = '__cel_outline__';

function removeOutlines(root) {
  const toRemove = [];
  root.traverse(n => { if (n.userData[OUTLINE_TAG]) toRemove.push(n); });
  toRemove.forEach(n => n.parent?.remove(n));
}

function addOutline(mesh, thickness, colorHex) {
  const mat = new THREE.MeshBasicMaterial({
    color: new THREE.Color(colorHex),
    side: THREE.BackSide,
    depthWrite: false,
  });
  const outMesh = new THREE.Mesh(mesh.geometry, mat);
  const s = 1 + thickness;
  outMesh.scale.set(s, s, s);
  outMesh.userData[OUTLINE_TAG] = true;
  outMesh.castShadow = false;
  outMesh.receiveShadow = false;
  mesh.add(outMesh);
  return outMesh;
}

// ─── Color adjustment ─────────────────────────────────────────────────────────
function adjustColor(hexColor, brightness, saturation) {
  const c = new THREE.Color(hexColor);
  const hsl = {};
  c.getHSL(hsl);
  c.setHSL(hsl.h, Math.min(1, hsl.s * saturation), Math.min(1, hsl.l * brightness));
  return c;
}

// ─── Interactable ancestor check ──────────────────────────────────────────────
function findInteractableAncestor(node) {
  let p = node.parent;
  while (p) {
    if (p.userData.interactable) return p;
    p = p.parent;
  }
  return null;
}

// ─── PBR apply ────────────────────────────────────────────────────────────────
/**
 * Apply PBR overrides to alive mesh nodes.
 * Does NOT touch unclicked (clay) meshes.
 */
export function applyPBR(islandGroup, pbrParams) {
  islandGroup.traverse(node => {
    if (!node.isMesh || node.userData[OUTLINE_TAG] || hasCustomMat(node)) return;

    const ancestor = findInteractableAncestor(node);
    const isAlive  = ancestor?.userData?.isAlive ?? false;
    if (!isAlive) return;

    const origRaw = node.userData.originalMaterial;
    if (!origRaw) return;
    const origList = Array.isArray(origRaw) ? origRaw : [origRaw];

    const tintColor = new THREE.Color(pbrParams.colorTint);

    origList.forEach(orig => {
      // Save base values on first run to prevent feedback loops
      if (orig.userData._baseRoughness === undefined && orig.roughness !== undefined) 
        orig.userData._baseRoughness = orig.roughness;
      if (orig.userData._baseMetalness === undefined && orig.metalness !== undefined) 
        orig.userData._baseMetalness = orig.metalness;
      if (orig.userData._baseColor === undefined && orig.color) 
        orig.userData._baseColor = orig.color.getHex();

      if (!pbrParams.enabled) {
        // Restore defaults
        if (orig.userData._baseRoughness !== undefined) orig.roughness = orig.userData._baseRoughness;
        if (orig.userData._baseMetalness !== undefined) orig.metalness = orig.userData._baseMetalness;
        if (orig.userData._baseColor !== undefined) orig.color.setHex(orig.userData._baseColor);
        if (orig.emissive) orig.emissive.setHex(0x000000);
      } else {
        // Apply multipliers/overrides
        if (orig.roughness !== undefined)
          orig.roughness = THREE.MathUtils.clamp(orig.userData._baseRoughness * pbrParams.roughnessMult, 0, 1);
        if (orig.metalness !== undefined)
          orig.metalness = THREE.MathUtils.clamp(orig.userData._baseMetalness * pbrParams.metalnessMult, 0, 1);
        
        // emissive
        if (orig.emissive) {
          const glowCol = new THREE.Color(pbrParams.colorTint);
          orig.emissive.copy(glowCol).multiplyScalar(pbrParams.emissiveAdd);
        }
        
        // color tint
        if (orig.color) {
          const baseCol = new THREE.Color(orig.userData._baseColor);
          orig.color.copy(baseCol).lerp(tintColor, pbrParams.tintStrength);
        }
      }
      orig.needsUpdate = true;
      orig.side = THREE.DoubleSide;
    });

    // Ensure mesh is showing original material (not clay or toon)
    node.material = origRaw;
  });
}

// ─── Main CEL apply function ──────────────────────────────────────────────────
/**
 * Apply or remove cel shader, respecting alive state.
 * - isAlive=false meshes always stay as clay (unchanged by this call).
 * - isAlive=true meshes: cel ON → toon; cel OFF → original PBR.
 */
// Tags that indicate a mesh has a custom-managed material — cel/PBR must not override these.
const CUSTOM_MAT_TAGS = ['__vol_light__', '__glass__', '__water__', '__fire__'];
function hasCustomMat(node) {
  return CUSTOM_MAT_TAGS.some(t => node.userData[t]);
}

export function applyCel(islandGroup, celParams, pbrParams, clayMatFn) {
  removeOutlines(islandGroup);
  const gradMap = makeGradMap(celParams.steps);

  islandGroup.traverse(node => {
    if (!node.isMesh || node.userData[OUTLINE_TAG] || hasCustomMat(node)) return;

    const ancestor = findInteractableAncestor(node);
    const isAlive  = ancestor?.userData?.isAlive ?? false;

    if (!isAlive) {
      // Dead / unclicked — always pure clay (grey).
      node.material = clayMatFn();
      return;
    }

    if (celParams.enabled) {
      // ── Toon material ────────────────────────────────────────────────────────
      const processMat = (orig) => {
        let baseColor = 0xcccccc;
        let hasVertexColors = !!orig?.vertexColors;

        if (celParams.useOriginalColors && orig) {
          const col = orig?.userData?._baseColor
            ? new THREE.Color(orig.userData._baseColor)
            : orig?.color;
          if (col) baseColor = col.getHex();
        }

        const finalColor = hasVertexColors ? 0xffffff : baseColor;
        const color = adjustColor(finalColor, celParams.brightness, celParams.saturation);
        
        const toon = new THREE.MeshToonMaterial({ 
          color, 
          gradientMap: gradMap,
          vertexColors: hasVertexColors,
          side: THREE.DoubleSide
        });
        // Copy map if exists (for ground items etc)
        if (orig?.map) toon.map = orig.map;
        return toon;
      };

      if (Array.isArray(node.userData.originalMaterial)) {
        node.material = node.userData.originalMaterial.map(processMat);
      } else {
        node.material = processMat(node.userData.originalMaterial);
      }
      
      if (celParams.outlineEnabled) addOutline(node, celParams.outlineThickness, celParams.outlineColor);
    } else {
      // ── Restore original PBR ─────────────────────────────────────────────────
      const orig = node.userData.originalMaterial;
      if (orig) {
        node.material = orig;
        // Re-apply PBR overrides if any
        if (pbrParams) applyPBR(islandGroup, pbrParams);
      } else {
        node.material = clayMatFn();
      }
    }
  });
}
