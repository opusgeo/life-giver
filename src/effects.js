import * as THREE from 'three';
import { CLAY_COLOR } from './dioramas.js';

// ─── Yardımcı Fonksiyonlar ───

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
      gl_PointSize = (1.2 * sizeScale) * (300.0 / -mvPosition.z);
      gl_Position = projectionMatrix * mvPosition;
    }
  `,
  fragmentShader: `
    uniform sampler2D uMap;
    varying vec3 vColor;
    varying float vOpacity;
    void main() {
      vec4 tex = texture2D(uMap, gl_PointCoord);
      gl_FragColor = vec4(tex.rgb * vColor * 0.6, tex.a * vOpacity);
    }
  `
};

// ─── animateBloom ───

export function animateBloom(target, onComplete) {
  const meshEntries = [];
  target.traverse(child => {
    if (!child.isMesh) return;
    const originalMat = child.userData.originalMaterial;
    if (!originalMat) return;

    const cloneMat = (m) => {
      const nm = m.clone();
      nm.userData.uProgress = { value: 0 };
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
    const size = new THREE.Vector3();
    bbox.getSize(size);
    const maxDist = size.length() * 0.6;

    matArray.forEach(m => {
      m.onBeforeCompile = (shader) => {
        shader.uniforms.uProgress = m.userData.uProgress;
        shader.uniforms.uClayColor = { value: new THREE.Color(CLAY_COLOR) };
        shader.uniforms.uCenter = { value: center };
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
          float dist = distance(vWP, uCenter) / (uMaxDist + 0.0001);
          float radWave = sin(dist * 10.0 - uProgress * 4.0) * 0.03;
          float h = dist + radWave;
          float threshold = uProgress * 1.2 - 0.1;
          float isP = smoothstep(threshold + 0.12, threshold, h);
          float sh = smoothstep(threshold - 0.05, threshold, h) * (1.0 - step(threshold, h));
          float lum = dot(gl_FragColor.rgb, vec3(0.333)); 
          vec3 clayPure = uClayColor * clamp(lum * 1.5, 0.4, 1.2);
          gl_FragColor.rgb = mix(clayPure, gl_FragColor.rgb, isP);
          gl_FragColor.rgb += lum * sh * 0.1;
          #include <dithering_fragment>
          `
        );
      };
      m.needsUpdate = true;
    });

    child.material = mats;
    meshEntries.push({ child, matArray, startY: child.position.y, worldY: center.y });
  });

  if (meshEntries.length === 0) {
    onComplete?.();
    return () => true;
  }

  meshEntries.sort((a, b) => a.worldY - b.worldY);
  const duration = 480;
  const stagger = 15;
  let finishedCount = 0;

  meshEntries.forEach((entry, i) => {
    setTimeout(() => {
      const { child, matArray, startY } = entry;
      const startTime = Date.now();
      function loop() {
        const elapsed = Date.now() - startTime;
        const t = Math.min(1, elapsed / duration);
        const jump = Math.sin(t * Math.PI) * 0.07;
        child.position.y = startY + jump;
        matArray.forEach(m => { if(m.userData.uProgress) m.userData.uProgress.value = t; });
        if (t < 1) requestAnimationFrame(loop);
        else {
          child.position.y = startY;
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
    sizeScales[i] = 0.5 + Math.random() * 1.5;
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

export function createCozyDust(targetGroup, scene) {
  const count = 10;
  const positions = new Float32Array(count * 3);
  const sizeScales = new Float32Array(count);
  const colors = new Float32Array(count * 3);
  const opacities = new Float32Array(count);
  const vels = [];

  const bbox = new THREE.Box3().setFromObject(targetGroup);
  const center = bbox.getCenter(new THREE.Vector3());
  const size = bbox.getSize(new THREE.Vector3());
  const baseCol = new THREE.Color(0xfff3cd);

  for (let i = 0; i < count; i++) {
    positions[i * 3]     = center.x + (Math.random() - 0.5) * size.x * 1.2;
    positions[i * 3 + 1] = bbox.min.y + Math.random() * 0.5;
    positions[i * 3 + 2] = center.z + (Math.random() - 0.5) * size.z * 1.2;
    
    sizeScales[i] = 0.5 + Math.random() * 1.8;
    colors[i * 3] = baseCol.r; colors[i * 3 + 1] = baseCol.g; colors[i * 3 + 2] = baseCol.b;
    opacities[i] = 0.0;

    vels.push({ 
      x: (Math.random()-0.5)*0.5, 
      y: Math.random()*1.2+0.8, 
      z: (Math.random()-0.5)*0.5, 
      phase: Math.random()*Math.PI*2 
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

  let t = 0;
  return (delta) => {
    t += delta;
    const p = t / 2.2;
    if (p >= 1) { scene.remove(pts); geo.dispose(); mat.dispose(); return true; }
    
    const arr = geo.attributes.position.array;
    const opp = geo.attributes.opacity.array;
    
    for (let i = 0; i < count; i++) {
      const v = vels[i];
      arr[i * 3]     += (v.x + Math.sin(t * 5 + v.phase) * 0.2) * delta;
      arr[i * 3 + 1] += v.y * delta;
      arr[i * 3 + 2] += (v.z + Math.cos(t * 5 + v.phase) * 0.2) * delta;
      opp[i] = Math.sin(p * Math.PI) * 0.9;
    }
    geo.attributes.position.needsUpdate = true;
    geo.attributes.opacity.needsUpdate = true;
    return false;
  };
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
  const mat = new THREE.PointsMaterial({ size:0.14, vertexColors:true, transparent:true, depthWrite:false });
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
  const dustMat = new THREE.PointsMaterial({ color: 0xcccccc, size: 0.10, transparent: true, depthWrite: false });
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
    cloud.position.set((Math.random()-0.5)*26, (Math.random()-0.5)*7+2, -Math.random()*85-5);
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
    cloud.position.set(Math.cos(angle)*r, -3+Math.random()*4, Math.sin(angle)*r);
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
  const count = 800;
  const pos = new Float32Array(count*3);
  for (let i=0; i<count; i++) {
    const phi=Math.acos(2*Math.random()-1), theta=Math.random()*Math.PI*2, r=90+Math.random()*20;
    pos[i*3]=r*Math.sin(phi)*Math.cos(theta); pos[i*3+1]=r*Math.sin(phi)*Math.sin(theta); pos[i*3+2]=r*Math.cos(phi);
  }
  const geo=new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos,3));
  group.add(new THREE.Points(geo, new THREE.PointsMaterial({size:0.12, color:0xffffff, transparent:true, opacity:0.6})));
  return { mesh: group, tick: (el) => { group.rotation.y=el*0.02; } };
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
