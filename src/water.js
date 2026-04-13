import * as THREE from 'three';

/**
 * Animated water surface using a custom ShaderMaterial.
 * - Vertex: ripple displacement via two overlapping sine waves
 * - Fragment: depth gradient + caustic shimmer + edge foam
 */
export function createWater(radius = 1.1) {
  const geo = new THREE.CircleGeometry(radius, 40);
  geo.rotateX(-Math.PI / 2); // lie flat on XZ plane

  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uTime:         { value: 0 },
      uDeepColor:    { value: new THREE.Color(0x1a4a6e) },
      uShallowColor: { value: new THREE.Color(0x5599cc) },
    },
    vertexShader: /* glsl */`
      uniform float uTime;
      varying vec2 vUv;

      void main() {
        vUv = uv;
        vec3 pos = position;
        pos.y += sin(pos.x * 4.0 + uTime * 2.0)  * 0.012
               + cos(pos.z * 3.5 + uTime * 1.7)  * 0.008;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
      }
    `,
    fragmentShader: /* glsl */`
      uniform float uTime;
      uniform vec3  uDeepColor;
      uniform vec3  uShallowColor;
      varying vec2  vUv;

      void main() {
        float dist = length(vUv - 0.5) * 2.0;

        // Two-layer caustic shimmer
        float c1 = sin(vUv.x * 18.0 + uTime * 3.0  + vUv.y * 5.0) * 0.5 + 0.5;
        float c2 = cos(vUv.y * 15.0 + uTime * 2.5  + vUv.x * 4.0) * 0.5 + 0.5;
        float caustic = c1 * c2 * 0.25;

        // Edge foam ring
        float foam = smoothstep(0.78, 1.0, dist) * 0.35;

        vec3 color = mix(uDeepColor, uShallowColor, dist * 0.6);
        color += caustic * 0.18;
        color  = mix(color, vec3(0.92, 0.96, 1.0), foam);

        float alpha = mix(0.92, 0.55, dist);
        gl_FragColor = vec4(color, alpha);
      }
    `,
    transparent: true,
    depthWrite:  false,
    side: THREE.DoubleSide,
  });

  const mesh = new THREE.Mesh(geo, mat);

  return {
    mesh,
    tick: (elapsed) => {
      mat.uniforms.uTime.value = elapsed;
    },
    setNightMode: (night) => {
      mat.uniforms.uDeepColor.value.set(night    ? 0x1a4a6e : 0x2e7aaa);
      mat.uniforms.uShallowColor.value.set(night ? 0x5599cc : 0x7ec8e3);
    },
  };
}

/**
 * Frozen lake surface: static ice sheen, no vertex displacement.
 */
export function createIce(radius = 1.4) {
  const geo = new THREE.CircleGeometry(radius, 32);
  geo.rotateX(-Math.PI / 2);

  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
    },
    vertexShader: /* glsl */`
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */`
      uniform float uTime;
      varying vec2  vUv;

      void main() {
        float dist = length(vUv - 0.5) * 2.0;

        // Slow-moving crack/vein pattern
        float vein1 = abs(sin(vUv.x * 12.0 + vUv.y * 7.0 + uTime * 0.1)) * 0.5 + 0.5;
        float vein2 = abs(cos(vUv.y * 10.0 - vUv.x * 5.0 + uTime * 0.08)) * 0.5 + 0.5;
        float cracks = smoothstep(0.85, 1.0, vein1 * vein2) * 0.25;

        float edge = smoothstep(0.85, 1.0, dist) * 0.3;

        vec3 iceColor = vec3(0.78, 0.91, 1.0);
        vec3 color = iceColor + cracks * 0.15;
        color = mix(color, vec3(1.0), edge);

        float alpha = mix(0.82, 0.45, dist);
        gl_FragColor = vec4(color, alpha);
      }
    `,
    transparent: true,
    depthWrite:  false,
    side: THREE.DoubleSide,
  });

  const mesh = new THREE.Mesh(geo, mat);

  return {
    mesh,
    tick: (elapsed) => {
      mat.uniforms.uTime.value = elapsed;
    },
  };
}
