import * as THREE from 'three';
import { clayMat } from './dioramas.js';

/**
 * Procedural Voronoi Ground Shader
 */
const groundVert = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vWorldPos;
  void main() {
    vUv = uv;
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorldPos = wp.xyz;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

const groundFrag = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vWorldPos;

  // Voronoi helper functions
  vec2 hash(vec2 p) {
    p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
    return fract(sin(p) * 43758.5453);
  }

  float voronoi(vec2 x) {
    vec2 n = floor(x);
    vec2 f = fract(x);
    float m = 8.0;
    for(int j=-1; j<=1; j++) {
      for(int i=-1; i<=1; i++) {
        vec2 g = vec2(float(i), float(j));
        vec2 o = hash(n + g);
        vec2 r = g + o - f;
        float d = dot(r, r);
        if(d < m) m = d;
      }
    }
    return sqrt(m);
  }

  void main() {
    // Ölçeği çimen yayılımına göre ayarlayalım
    vec2 uv = vWorldPos.xz * 0.35;
    float v = voronoi(uv);
    float v2 = voronoi(uv * 2.5 + 5.0); // İkinci bir katman doku için
    
    // Daha zengin ve canlı çimen paleti
    vec3 deepGrass  = vec3(0.08, 0.15, 0.06); 
    vec3 midGrass   = vec3(0.15, 0.25, 0.10);
    vec3 lightGrass = vec3(0.25, 0.35, 0.15);
    vec3 limeGlow   = vec3(0.35, 0.5, 0.20);
    
    // Voronoi sonucuna göre geçişler
    vec3 col = mix(deepGrass, midGrass, v);
    col = mix(col, lightGrass, smoothstep(0.4, 0.8, v));
    col = mix(col, limeGlow, (1.0 - smoothstep(0.0, 0.2, v)) * 0.4);
    
    // Mikro doku (ikinci voronoi katmanı ile pürüzlülük)
    col = mix(col, col * 1.15, v2 * 0.2);
    
    // Kenarlara doğru yumuşak karartma (vignette etkisi)
    float dist = length(vWorldPos.xz);
    float falloff = smoothstep(180.0, 45.0, dist);
    
    gl_FragColor = vec4(col * (0.9 + 0.1 * v) * falloff, 1.0);
    #include <colorspace_fragment>
  }
`;

export class Island {
  constructor(def, scene) {
    this.group = new THREE.Group();
    this.objects = [];       
    this.aliveCount = 0;
    this.floatPhase = Math.random() * Math.PI * 2;
    this._scene = scene;
    
    this.baseY = 0;

    this.objects = def.build(this.group);
    this.totalInteractable = this.objects.filter(o => o.userData.interactable).length;

    // ─── IMPROVED VORONOI GROUND ──────────────────────────────────────────────
    const groundGeo = new THREE.CircleGeometry(200, 32); // Optimize edildi
    const groundMat = new THREE.ShaderMaterial({
      vertexShader: groundVert,
      fragmentShader: groundFrag,
      transparent: true,
    });
    
    this.groundMesh = new THREE.Mesh(groundGeo, groundMat);
    this.groundMesh.rotation.x = -Math.PI / 2;
    this.groundMesh.position.y = (def.groundY ?? -0.01) - 0.02; // Çimenlerin biraz daha altında
    this.group.add(this.groundMesh);
    // groundMesh'i interactable listesine eklemiyoruz ki boyanmasın
    
    scene.add(this.group);
  }

  get isComplete() {
    return this.totalInteractable > 0 && this.aliveCount >= this.totalInteractable;
  }

  update(elapsed) {
    this.group.position.y = this.baseY;
    this.group.userData.waterTick?.(elapsed);
  }

  worldCenter() {
    const v = new THREE.Vector3();
    this.group.getWorldPosition(v);
    return v.add(new THREE.Vector3(0, 1, 0));
  }

  setPosition(x, y, z) {
    this.group.position.set(x, y, z);
    this.baseY = y; 
  }

  dispose() {
    this._scene.remove(this.group);
    this.objects.forEach(obj => {
      obj.geometry?.dispose();
      if (Array.isArray(obj.material)) obj.material.forEach(m => m.dispose());
      else obj.material?.dispose();
    });
    this.groundMesh.geometry.dispose();
    this.groundMesh.material.dispose();
    this.objects = [];
  }
}
