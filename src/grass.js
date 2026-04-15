/**
 * grass.js — Grass3 optimized sway (Native Override + Live Rebuild)
 */

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const MODEL_URLS = ['/Grass3.glb']; 

export function createGrassMaterial(params = {}) {
  const {
    timeScale    = 1.0,
    swayStrength = 0.3,
    swaySpeed    = 2.0,
    color        = new THREE.Color(0x7fb35e)
  } = params;

  const mat = new THREE.MeshStandardMaterial({
    color: color,
    side: THREE.DoubleSide
  });

  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = { value: 0 };
    shader.uniforms.uTimeScale = { value: timeScale };
    shader.uniforms.uSwayStrength = { value: swayStrength };
    shader.uniforms.uSwaySpeed = { value: swaySpeed };

    shader.vertexShader = `
      uniform float uTime;
      uniform float uTimeScale;
      uniform float uSwayStrength;
      uniform float uSwaySpeed;
      attribute float aPhase;
    ` + shader.vertexShader;

    shader.vertexShader = shader.vertexShader.replace(
      '#include <begin_vertex>',
      `
        #include <begin_vertex>
        vec4 worldPos = modelMatrix * instanceMatrix * vec4(position, 1.0);
        float t = uTime * uTimeScale;
        float wave = sin(t * uSwaySpeed + (worldPos.x + worldPos.z) * 0.25 + aPhase) * uSwayStrength;
        float hf = clamp(position.y / 1.1, 0.0, 1.0);
        transformed.x += wave * hf;
      `
    );

    mat.userData.shader = shader;
  };

  return mat;
}

export async function createGrassPatch(parent, opts = {}) {
  let {
    count        = 150,
    spread       = 8,
    scale        = 1.0,
    shaderParams = {},
  } = opts;

  let geometries = [];
  const loader   = new GLTFLoader();

  // Modelleri yükle referans al
  const loaded = await Promise.all(
    MODEL_URLS.map(async url => {
      let geo = null;
      let modelColor = new THREE.Color(0x7fb35e);
      try {
        const gltf = await loader.loadAsync(url);
        gltf.scene.traverse(n => {
          if (n.isMesh && !geo) {
            geo = n.geometry.clone();
            if (n.material && n.material.color) modelColor = n.material.color.clone();
          }
        });
      } catch (err) {}
      if (!geo) {
        geo = new THREE.PlaneGeometry(0.2, 1);
        geo.translate(0, 0.5, 0); 
      }
      return { geo, color: modelColor };
    })
  );
  geometries = loaded;

  const mat = createGrassMaterial({ ...shaderParams, color: geometries[0]?.color });
  const group = new THREE.Group();
  parent.add(group);

  let meshes = [];

  function _initMeshes(targetCount) {
    // Eskileri temizle
    meshes.forEach(m => group.remove(m));
    meshes = [];

    geometries.forEach(({ geo }) => {
      const phases = new Float32Array(targetCount);
      for (let i = 0; i < targetCount; i++) phases[i] = Math.random() * Math.PI * 2;
      geo.setAttribute('aPhase', new THREE.InstancedBufferAttribute(phases, 1));

      const mesh = new THREE.InstancedMesh(geo, mat, targetCount);
      mesh.frustumCulled = false;
      group.add(mesh);
      meshes.push(mesh);
    });
  }

  _initMeshes(count);
  _place(meshes, [count], spread, scale);

  let elapsed = 0;
  function update(dt) {
    elapsed += dt;
    if (mat.userData.shader) {
      mat.userData.shader.uniforms.uTime.value = elapsed;
    }
  }

  function rebuild(newOpts = {}) {
    // Eğer sayı değiştiyse yeniden oluştur
    if (newOpts.count !== undefined && newOpts.count !== count) {
      count = newOpts.count;
      _initMeshes(count);
    }
    
    spread = newOpts.spread ?? spread;
    scale  = newOpts.scale ?? scale;
    surfaceMeshes = newOpts.surfaceMeshes ?? surfaceMeshes;
    
    _place(meshes, [count], spread, scale, surfaceMeshes);
  }

  return { meshes, group, material: mat, update, rebuild };
}

/**
 * @param {THREE.InstancedMesh[]} meshes 
 * @param {number[]} counts 
 * @param {number} spread 
 * @param {number} scale 
 * @param {THREE.Object3D[]} surfaceMeshes - Raycast edilecek modeller
 */
function _place(meshes, counts, spread, scale, surfaceMeshes = []) {
  const dummy = new THREE.Object3D();
  const PI2   = Math.PI * 2;
  const exclusionRadius = 2.2;
  const raycaster = new THREE.Raycaster();
  const downVec = new THREE.Vector3(0, -1, 0);

  meshes.forEach((mesh, mi) => {
    const c = counts[mi] || counts[0];
    for (let i = 0; i < c; i++) {
      let x, z, y = 0;
      let trials = 0;
      let foundSurface = false;

      if (surfaceMeshes && surfaceMeshes.length > 0) {
        // --- Modellerin üzerine yerleştirme ---
        while (trials < 50 && !foundSurface) {
          const targetMesh = surfaceMeshes[Math.floor(Math.random() * surfaceMeshes.length)];
          const worldBox = new THREE.Box3().setFromObject(targetMesh);
          
          x = worldBox.min.x + Math.random() * (worldBox.max.x - worldBox.min.x);
          z = worldBox.min.z + Math.random() * (worldBox.max.z - worldBox.min.z);
          
          raycaster.set(new THREE.Vector3(x, 100, z), downVec);
          const hits = raycaster.intersectObject(targetMesh, true);
          
          if (hits.length > 0) {
            const normal = hits[0].face.normal.clone();
            const normalMatrix = new THREE.Matrix3().getNormalMatrix(targetMesh.matrixWorld);
            normal.applyMatrix3(normalMatrix).normalize();
            
            if (normal.y > 0.5) { // 0.5: Eğik yüzeylerde de çıksın
              y = hits[0].point.y;
              foundSurface = true;
            }
          }
          trials++;
        }
      } else {
        // --- Standart zemin yerleştirmesi ---
        do {
          x = (Math.random() - 0.5) * spread * 2;
          z = (Math.random() - 0.5) * spread * 2;
          const dist = Math.sqrt(x*x + z*z);
          trials++;
        } while (Math.sqrt(x*x + z*z) < exclusionRadius && trials < 15);

        if (Math.sqrt(x*x + z*z) < exclusionRadius) {
          const angle = Math.random() * PI2;
          const pushout = exclusionRadius + Math.random() * 0.5;
          x = Math.cos(angle) * pushout;
          z = Math.sin(angle) * pushout;
        }
      }

      dummy.position.set(x, y, z);
      dummy.rotation.set(0, Math.random() * PI2, 0);
      dummy.scale.setScalar(scale * (0.8 + Math.random() * 0.4));
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
  });
}
