import * as THREE from 'three';
import { EffectComposer }  from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass }      from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { BokehPass }       from 'three/addons/postprocessing/BokehPass.js';
import { OutputPass }      from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass }      from 'three/addons/postprocessing/ShaderPass.js';

const GradingShader = {
  uniforms: {
    'tDiffuse':   { value: null },
    'brightness': { value: 0.06 },
    'contrast':   { value: 1.22 },
    'saturation': { value: 1.07 },
    'gamma':      { value: 1.17 }
  },
  vertexShader: `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform float brightness;
    uniform float contrast;
    uniform float saturation;
    uniform float gamma;
    varying vec2 vUv;

    void main() {
      vec4 texel = texture2D(tDiffuse, vUv);
      vec3 color = texel.rgb;
      
      // Brightness
      color += brightness;
      
      // Contrast
      color = (color - 0.5) * max(0.0, contrast) + 0.5;
      
      // Saturation
      float gray = dot(color, vec3(0.299, 0.587, 0.114));
      color = mix(vec3(gray), color, saturation);
      
      // Gamma
      color = pow(max(color, 0.0), vec3(1.0 / max(0.001, gamma)));
      
      gl_FragColor = vec4(color, texel.a);
    }
  `
};

/**
 * Creates the post-processing pipeline:
 *   RenderPass → UnrealBloomPass → BokehPass (disabled by default) → OutputPass
 *
 * renderer.toneMapping must be set to THREE.NoToneMapping BEFORE calling this.
 * OutputPass is the single place where ACESFilmic tone-mapping + sRGB conversion
 * are applied — once, at the very end. This prevents the double-tone-mapping
 * artefact (washed-out materials) and ensures DOF on/off doesn't change brightness.
 *
 * @param {THREE.WebGLRenderer} renderer  (toneMapping must be NoToneMapping)
 * @param {THREE.Scene}         scene
 * @param {THREE.Camera}        camera
 */
export function createComposer(renderer, scene, camera) {
  // Tell OutputPass to use ACES + sRGB by temporarily setting these on the renderer.
  // OutputPass reads them once at first render; we restore NoToneMapping afterward.
  renderer.toneMapping = THREE.ACESFilmicToneMapping;

  const composer = new EffectComposer(renderer);

  // ── Base scene render ──────────────────────────────────────────────────────
  const renderPass = new RenderPass(scene, camera);
  composer.addPass(renderPass);

  // ── Bloom — soft glow on sparkles, emissives, moon glow ───────────────────
  // High threshold (0.92) so toon/clay materials don't accidentally bloom.
  const bloomPass = new UnrealBloomPass(
    new THREE.Vector2(window.innerWidth, window.innerHeight),
    0.35,   // strength
    0.85,   // radius
    0.85,   // threshold — allow bright emissives to bloom
  );
  composer.addPass(bloomPass);

  // ── Depth of Field ─────────────────────────────────────────────────────────
  const bokehPass = new BokehPass(scene, camera, {
    focus:    7.5,
    aperture: 0.006,
    maxblur:  0.012,
  });
  bokehPass.enabled = false;
  composer.addPass(bokehPass);

  // ── Color Grading ──────────────────────────────────────────────────────────
  const gradingPass = new ShaderPass(GradingShader);
  composer.addPass(gradingPass);

  // ── Output — single tone-mapping (ACES) + sRGB conversion ─────────────────
  // OutputPass reads renderer.toneMapping & outputColorSpace at first render.
  const outputPass = new OutputPass();
  composer.addPass(outputPass);

  // Restore NoToneMapping so RenderPass doesn't double-apply it.
  renderer.toneMapping = THREE.NoToneMapping;

  return { composer, renderPass, bloomPass, bokehPass, gradingPass };
}

/**
 * Call this on every window resize.
 */
export function resizeComposer(composer, w, h) {
  composer.setSize(w, h);
}

/**
 * Call when the active camera changes (e.g. PERSP ↔ ISO toggle).
 * BokehPass is supported for both Perspective and Orthographic cameras.
 *
 * @param {object}        passes      – { renderPass, bokehPass }
 * @param {THREE.Camera}  newCamera
 * @param {boolean}       dofEnabled  – current user DOF preference
 */
export function updateComposerCamera(passes, newCamera, dofEnabled) {
  passes.renderPass.camera = newCamera;

  passes.bokehPass.camera  = newCamera;
  passes.bokehPass.enabled = dofEnabled;
}
