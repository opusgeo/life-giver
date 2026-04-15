/**
 * walkMode.js — First-person & Third-person navigation
 *
 * MODES:
 *   'orbit'  — default OrbitControls
 *   'first'  — WASD + mouse look, 1st person
 *   'third'  — WASD + 3rd person follow camera
 *
 * Floor detection: downward raycast against all island meshes every frame
 * so character sticks to the floating island surface.
 */

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// ── Character GLB loader ──────────────────────────────────────────────────────
const _gltfLoader = new GLTFLoader();

// ── Keyboard state ────────────────────────────────────────────────────────────
const keys = { w:false, a:false, s:false, d:false, ' ':false, e:false, q:false, f:false, g:false, r:false, v:false, p:false, shift:false, arrowup:false, arrowdown:false, arrowleft:false, arrowright:false, control:false };
const _normalise = k => {
  if (k === ' ') return ' ';
  if (k === 'Control') return 'control';
  if (k === 'Shift') return 'shift';
  return k.toLowerCase();
};
const onKeyDown = e => { 
  const k = _normalise(e.key); 
  if (k in keys) { 
    // Do not prevent default for browser shortcuts (Ctrl/Alt/Meta)
    if (!e.ctrlKey && !e.altKey && !e.metaKey) e.preventDefault();
    keys[k] = true; 
  } 
};
const onKeyUp   = e => { const k = _normalise(e.key); if (k in keys) keys[k] = false; };

// ── Constants ─────────────────────────────────────────────────────────────────
const SPEED    = 2.25;
const JUMP_VEL = 6.0;
const GRAVITY  = -20;
const ARM_MIN  = 1.5;   // 3rd person min zoom
const ARM_MAX  = 12.0;  // 3rd person max zoom
const ZOOM_SENS = 0.002; 
const EYE_H    = 0.72;  // 1st person eye height above feet
const SNAP_UP   = 5.0;   // Increased to detect floors from deeper immersion
const SNAP_DN   = 5.0;   
const STEP_MAX  = 2.5;   // Increased significantly to allow stepping onto the island from the lower ground plane (-1.2)
const MOUSE_SENS  = 0.00126; // 0.0018 × 0.7
const CAM_SMOOTH  = 0.004; // lerp base — lower = smoother, higher = snappier

// ─────────────────────────────────────────────────────────────────────────────
export class WalkMode {
  constructor(scene, camera, renderer, orbitControls) {
    this.scene    = scene;
    this.camera   = camera;
    this.renderer = renderer;
    this.orbit    = orbitControls;
    this.mode     = 'orbit';

    // Character — placeholder group until GLB loads
    this.character = new THREE.Group();
    this.character.name = 'WalkCharacter';
    this.character.visible = false;
    this._charScale = 0.5;
    this._mixer = null;
    this._animIdle = null;
    this._animWalk = null;
    this._isWalking = false;
    scene.add(this.character);

    this._isBird = false;
    this._bunnyModel = null;
    this._birdModel = null;
    this._birdMixer = null;
    this._birdAnimFly = null;
    this._birdAltitude = 1.5; // persistent altitude above ground (Space/Ctrl adjusts this)
    this._qPrevDown = false;

    // Load bunny GLB
    _gltfLoader.load(
      '/models/bunny.glb',
      (gltf) => {
        this._bunnyModel = gltf.scene;
        this._bunnyModel.traverse(node => { if (node.isMesh) node.castShadow = true; });
        this._bunnyModel.scale.setScalar(this._charScale);
        this.character.add(this._bunnyModel);

        this._mixer = new THREE.AnimationMixer(this._bunnyModel);
        const clips = gltf.animations;
        const find = (name) => clips.find(c => c.name.toLowerCase().includes(name));
        const idleClip = find('idle') ?? clips[0];
        const walkClip = find('walk') ?? clips[1];

        if (idleClip) this._animIdle = this._mixer.clipAction(idleClip);
        if (walkClip) {
          this._animWalk = this._mixer.clipAction(walkClip);
          this._animWalk.timeScale = 1.5;
        }
        if (this._animIdle) this._animIdle.play();
        
        // Hide if starting as bird (unlikely but safe)
        if (this._isBird) this._bunnyModel.visible = false;
      },
      undefined,
      (err) => console.warn('[WalkMode] bunny.glb yüklenemedi:', err)
    );

    // Load bird GLB
    _gltfLoader.load(
      '/models/Lila_Bird.glb',
      (gltf) => {
        this._birdModel = gltf.scene;
        this._birdModel.traverse(node => { if (node.isMesh) node.castShadow = true; });
        this._birdModel.scale.setScalar(this._charScale * 0.75); 
        this._birdModel.visible = false;
        this._birdModel.position.y = 0.2; // slight offset 
        this.character.add(this._birdModel);

        this._birdMixer = new THREE.AnimationMixer(this._birdModel);
        const clips = gltf.animations;
        if (clips.length > 0) {
          console.log('[WalkMode] Bird animations:', clips.map(c => c.name));
          const flyClip = clips.find(c => {
            const n = c.name.toLowerCase();
            return n.includes('fly') || n.includes('flap') || n.includes('wing');
          }) ?? clips[0];

          if (flyClip) {
            this._birdAnimFly = this._birdMixer.clipAction(flyClip);
            this._birdAnimFly.play();
          }
        }
      },
      undefined,
      (err) => console.warn('[WalkMode] Lila_Bird.glb yüklenemedi:', err)
    );

    // Locomotion state
    this._velY      = 0;
    this._onGround  = true;
    this._yaw       = 0;   // smoothed camera horizontal angle
    this._pitch     = 0;   // smoothed 1st person vertical angle
    this._armPitch  = 0.3; // smoothed 3rd person arm elevation
    this._yawTarget      = 0;
    this._pitchTarget    = 0;
    this._armPitchTarget = 0.3;
    this._armLen         = 3.5; // current smoothed distance
    this._armLenTarget   = 3.5;

    // Smooth camera position for 3rd person
    this._camTarget = new THREE.Vector3();

    // Floor raycaster (downward)
    this._floorRay = new THREE.Raycaster();
    this._floorRay.far = SNAP_UP + SNAP_DN;
    this._floorMeshes  = []; // all island meshes (set each frame from main.js)
    this._groundY = 0;       // current floor Y (world space)

    // Paint crosshair raycaster (screen center — 1st person only)
    this._paintRay     = new THREE.Raycaster();
    this._paintTargets = [];
    this._crosshairHit = false;
    this._lastHitPoint = null;

    // Mouse NDC for 3rd-person free-mouse highlight
    this._mouseNDC = new THREE.Vector2(0, 0);

    // 3rd person highlight / interact
    this._highlightedObject   = null;
    this._highlightMeshData   = []; // [{mesh, origEmissive, origIntensity}]
    this._interactPending     = false;
    this._ePrevDown           = false;
    this._fireMode            = false;
    this._firePending         = false;
    this._fPrevDown           = false;
    this._fireRemovePending   = false;
    this._gPrevDown           = false;
    this._fireRepositionPending = false;
    this._rPrevDown           = false;

    // Ghost mode (V key — no collision, fly freely)
    this._ghostMode     = false;
    this._ghostAltitude = 1.5;
    this._vPrevDown     = false;

    // Paint mode (P key — enables hover highlight & click painting)
    this._paintMode  = false;
    this._pPrevDown  = false;

    // Bird free-camera (right-drag to orbit when bird mode active)
    this._birdDragActive = false;

    // Pointer lock
    this._locked = false;
    this._boundMouseMove  = this._onMouseMove.bind(this);
    this._boundClick      = this._onClick.bind(this);
    this._boundWheel      = this._onWheel.bind(this);
    this._boundMouseDown  = this._onMouseDown.bind(this);
    this._boundMouseUp    = this._onMouseUp.bind(this);

    this._boundContextMenu = (e) => { if (this._paintMode) e.preventDefault(); };
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('keyup',   onKeyUp);
    document.addEventListener('mousedown', this._boundMouseDown);
    document.addEventListener('mouseup',   this._boundMouseUp);
    document.addEventListener('contextmenu', this._boundContextMenu);
    document.addEventListener('pointerlockchange', () => {
      this._locked = document.pointerLockElement === this.renderer.domElement;
      if (!this._locked && this.mode !== 'orbit' && !this._paintMode) this._showHint();
    });

    // UI elements
    this._hint           = this._mkHint();
    this._badge          = this._mkBadge();
    this._crosshair      = this._mkCrosshair();
    this._interactPrompt = this._mkInteractPrompt();
    document.body.append(this._hint, this._badge, this._crosshair, this._interactPrompt);
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  setMode(mode) {
    if (mode === this.mode) return;
    const prev = this.mode;
    this.mode = mode;

    if (prev !== 'orbit') {
      if (document.pointerLockElement) document.exitPointerLock();
      this.renderer.domElement.removeEventListener('click', this._boundClick);
      document.removeEventListener('mousemove', this._boundMouseMove);
      document.removeEventListener('wheel',     this._boundWheel);
    }

    if (mode === 'orbit') {
      this.orbit.enabled = true;
      this.character.visible = false;
      this._hint.style.display = 'none';
      this._badge.style.display = 'none';
      this._crosshair.style.display = 'none';
      this._interactPrompt.style.display = 'none';
      this._clearHighlight();
      Object.keys(keys).forEach(k => keys[k] = false);
      if (prev === 'first' && this._prevFov != null) {
        this.camera.fov = this._prevFov;
        this.camera.updateProjectionMatrix();
      }
      return;
    }

    // Entering walk mode
    this.orbit.enabled = false;
    this._badge.style.display = 'block';
    this._updateBadge();
    // Crosshair only for 1st person (not bird); 3rd person / bird use world highlight
    this._crosshair.style.display = (mode === 'first' && !this._isBird) ? 'block' : 'none';

    // Place character at island center, high enough to land on base
    const cx = this._islandCenterX ?? 0;
    const cz = this._islandCenterZ ?? 0;
    this._groundY = (this._islandCenterX != null)
      ? this.orbit.target.y        // will be corrected by raycast immediately
      : this.orbit.target.y;
    this.character.position.set(cx, this._groundY + 2, cz); // +2 so we fall onto base
    this._velY = 0;
    this._onGround = false;
    this._spawnFrames = 5; // skip STEP_MAX filter for first N frames

    // Derive initial yaw from camera direction
    const dir = new THREE.Vector3();
    this.camera.getWorldDirection(dir);
    this._yaw = this._yawTarget = Math.atan2(dir.x, dir.z);
    this._pitch = this._pitchTarget = 0;

    this.character.visible = mode === 'third';

    // Widen FOV for 1st person, restore for 3rd / orbit
    if (mode === 'first') {
      this._prevFov = this.camera.fov;
      this.camera.fov = 72; // ~18mm equivalent — natural walking view
      this.camera.updateProjectionMatrix();
    } else if (prev === 'first') {
      if (this._prevFov != null) {
        this.camera.fov = this._prevFov;
        this.camera.updateProjectionMatrix();
      }
    }

    document.addEventListener('mousemove', this._boundMouseMove);
    document.addEventListener('wheel',     this._boundWheel, { passive: false });
    this.renderer.domElement.addEventListener('click', this._boundClick);
    this._showHint();
  }

  /** Feed all island meshes (for floor collision). Call before update(). */
  setFloorMeshes(meshList) { this._floorMeshes = meshList; }

  /** Feed paintable meshes (for crosshair). Call before update(). */
  setPaintTargets(meshList) { this._paintTargets = meshList; }

  getCharacterPosition() {
    return this.character.position.clone();
  }

  setCharacterPosition(x, z) {
    this.character.position.x = x;
    this.character.position.z = z;
  }

  /** Reset character to island center, drop onto base. */
  resetPosition() {
    const cx = this._islandCenterX ?? 0;
    const cz = this._islandCenterZ ?? 0;
    this.character.position.set(cx, this._groundY + 2, cz);
    this._velY = 0;
    this._onGround = false;
    this._spawnFrames = 5;
  }

  setCharacterScale(s) {
    this._charScale = s;
    // Scale the inner model if loaded, otherwise just store for later
    const model = this.character.children[0];
    if (model) model.scale.setScalar(s);
  }

  get crosshairOnTarget() { return this._crosshairHit; }
  get crosshairPoint()    { return this._lastHitPoint;  }

  /** 3rd person: returns the highlighted interactable group and resets the flag, or null */
  consumeInteract() {
    if (this._interactPending && this._highlightedObject) {
      this._interactPending = false;
      return this._highlightedObject;
    }
    this._interactPending = false;
    return null;
  }

  consumeFire() {
    if (this._firePending && this._highlightedObject) {
      this._firePending = false;
      return this._highlightedObject;
    }
    this._firePending = false;
    return null;
  }

  consumeFireRemove() {
    if (this._fireRemovePending && this._highlightedObject) {
      this._fireRemovePending = false;
      return this._highlightedObject;
    }
    this._fireRemovePending = false;
    return null;
  }

  consumeFireReposition() {
    if (this._fireRepositionPending && this._highlightedObject) {
      this._fireRepositionPending = false;
      return this._highlightedObject;
    }
    this._fireRepositionPending = false;
    return null;
  }

  /** Returns arrow key state for fire repositioning */
  getArrowKeys() {
    return {
      up: keys.arrowup,
      down: keys.arrowdown,
      left: keys.arrowleft,
      right: keys.arrowright,
      pageUp: keys[' '],      // space = move fire up
      pageDown: keys.control,  // ctrl = move fire down
    };
  }

  // ── Per-frame update ─────────────────────────────────────────────────────────
  update(delta) {
    if (this.mode === 'orbit') return;

    const pos = this.character.position;

    // ── Shapeshift (Q) ────────────────────────────────────────────────────────
    const qDown = keys.q;
    if (qDown && !this._qPrevDown) {
      this._isBird = !this._isBird;
      if (this._bunnyModel) this._bunnyModel.visible = !this._isBird;
      if (this._birdModel)  this._birdModel.visible  =  this._isBird;

      if (this._isBird) {
        this._birdAltitude = Math.max(1.5, pos.y - this._groundY);
        this._velY = 0;
        this._onGround = false;
        // Release pointer lock → free mouse for painting
        if (document.pointerLockElement) document.exitPointerLock();
        this._crosshair.style.display = 'none'; // use free-mouse highlight instead
      } else {
        // Returning to normal — restore crosshair if 1st person
        if (this.mode === 'first') this._crosshair.style.display = 'block';
        // Auto-lock pointer when returning to character
        this.renderer.domElement.requestPointerLock();
      }
      this._updateBadge();
    }

    // ── Ghost mode (V) ────────────────────────────────────────────────────────
    const vDown = keys.v;
    if (vDown && !this._vPrevDown) {
      this._ghostMode = !this._ghostMode;
      if (this._ghostMode) {
        this._ghostAltitude = Math.max(1.0, pos.y - this._groundY);
        this._velY = 0;
      }
      this._updateBadge();
    }
    this._vPrevDown = vDown;
    this._qPrevDown = qDown;

    // ── Paint mode (P) ───────────────────────────────────────────────────────
    const pDown = keys.p;
    if (pDown && !this._pPrevDown) {
      this._paintMode = !this._paintMode;
      this._updateBadge();
    }
    this._pPrevDown = pDown;

    // ── Animation mixer ──────────────────────────────────────────────────────
    if (this._mixer && !this._isBird) this._mixer.update(delta);
    if (this._birdMixer && this._isBird) this._birdMixer.update(delta);

    // ── Smooth camera angles ─────────────────────────────────────────────────
    const camLerp = 1 - Math.pow(CAM_SMOOTH, delta);
    this._yaw      += (this._yawTarget      - this._yaw)      * camLerp;
    this._pitch    += (this._pitchTarget    - this._pitch)    * camLerp;
    this._armPitch += (this._armPitchTarget - this._armPitch) * camLerp;
    this._armLen   += (this._armLenTarget   - this._armLen)   * camLerp;



    // ── Floor detection (downward raycast) — skip in ghost mode ─────────────
    if (!this._ghostMode) {
      this._floorRay.set(
        new THREE.Vector3(pos.x, pos.y + SNAP_UP, pos.z),
        new THREE.Vector3(0, -1, 0)
      );
      if (this._floorMeshes.length > 0) {
        const hits = this._floorRay.intersectObjects(this._floorMeshes, false);
        if (hits.length > 0) {
          const hitY = hits[0].point.y;
          const spawning = this._spawnFrames > 0;
          if (spawning) this._spawnFrames--;
          if (spawning || hitY <= this._groundY + STEP_MAX) {
            const diff = hitY - this._groundY;
            const speed = diff < 0
              ? 1 - Math.pow(0.0001, delta)
              : 1 - Math.pow(0.001,  delta);
            this._groundY += diff * (spawning ? 1 : speed);
          }
        }
      }
    }

    // ── Gravity / Jump / Fly ─────────────────────────────────────────────────
    if (this._ghostMode) {
      // Ghost: altitude-based noclip flight (same controls as bird)
      const CLIMB = 4.0, SINK = 3.0, MIN_ALT = -50, MAX_ALT = 100;
      if (keys[' '])        this._ghostAltitude += CLIMB * delta;
      else if (keys['control']) this._ghostAltitude -= SINK  * delta;
      this._ghostAltitude = THREE.MathUtils.clamp(this._ghostAltitude, MIN_ALT, MAX_ALT);
      const wave = Math.sin(performance.now() * 0.0015) * 0.015;
      const targetY = this._groundY + this._ghostAltitude + wave;
      this._velY = THREE.MathUtils.lerp(this._velY, (targetY - pos.y) * 6, 5 * delta);
      pos.y += this._velY * delta;
      this._velY *= Math.pow(0.90, delta * 60);
    } else if (this._isBird) {
      // BIRD PHYSICS: Altitude-based flying
      // Space = gain altitude, Ctrl = lose altitude, otherwise hold altitude
      const CLIMB_SPEED = 4.0;  // units/sec altitude gain
      const SINK_SPEED  = 3.0;  // units/sec altitude loss
      const MIN_ALT     = 0.5;  // minimum altitude above ground
      const MAX_ALT     = 25.0; // maximum altitude above ground

      if (keys[' ']) {
        // Climb
        this._birdAltitude += CLIMB_SPEED * delta;
        this._onGround = false;
      } else if (keys['control']) {
        // Descend
        this._birdAltitude -= SINK_SPEED * delta;
      }
      // Clamp altitude
      this._birdAltitude = THREE.MathUtils.clamp(this._birdAltitude, MIN_ALT, MAX_ALT);

      // Subtle hover wave
      const wave = Math.sin(performance.now() * 0.0015) * 0.025;

      // Target Y = ground + altitude + wave
      const targetY = this._groundY + this._birdAltitude + wave;

      // Spring towards target (smooth, no sudden falls)
      const springStrength = 6.0;
      const diff = targetY - pos.y;
      this._velY = THREE.MathUtils.lerp(this._velY, diff * springStrength, 5 * delta);

      pos.y += this._velY * delta;

      // Air friction
      this._velY *= Math.pow(0.90, delta * 60);

      // Hard floor clamp
      if (pos.y < this._groundY + 0.3) {
        pos.y = this._groundY + 0.3;
        this._velY = Math.max(0, this._velY);
        this._birdAltitude = Math.max(MIN_ALT, this._birdAltitude);
        this._onGround = true;
      } else {
        this._onGround = false;
      }
    } else {
      // BUNNY PHYSICS
      if (this._onGround && keys[' ']) {
        this._velY = JUMP_VEL;
        this._onGround = false;
      }
      if (!this._onGround) {
        this._velY += GRAVITY * delta;
        pos.y += this._velY * delta;
        if (pos.y <= this._groundY) {
          pos.y = this._groundY;
          this._velY = 0;
          this._onGround = true;
        }
      } else {
        // Stick to ground (island floats)
        pos.y = this._groundY;
      }
    }

    // ── Horizontal movement ──────────────────────────────────────────────────
    const fwd = (keys.s ? 1 : 0) - (keys.w ? 1 : 0);
    const str = (keys.d ? 1 : 0) - (keys.a ? 1 : 0);
    const moving = fwd !== 0 || str !== 0;

    // Idle ↔ Walk animation switch (Bunny only)
    if (!this._isBird && moving !== this._isWalking) {
      this._isWalking = moving;
      const FADE = 0.2;
      if (moving && this._animWalk) {
        this._animIdle?.fadeOut(FADE);
        this._animWalk.reset().fadeIn(FADE).play();
      } else if (!moving && this._animIdle) {
        this._animWalk?.fadeOut(FADE);
        this._animIdle.reset().fadeIn(FADE).play();
      }
    }

    // Walk animation speed — 2x when sprinting
    if (!this._isBird && this._animWalk && this._isWalking) {
      this._animWalk.timeScale = keys.shift ? 3.0 : 1.5;
    }

    // Bird animation frequency adjustment based on movement
    if (this._isBird && this._birdAnimFly) {
      this._birdAnimFly.timeScale = moving ? (keys.shift ? 3.6 : 1.8) : 1.0;
    }

    if (fwd !== 0 || str !== 0) {
      // Movement is always relative to camera yaw
      const moveAngle = Math.atan2(str, fwd);
      const worldAngle = this._yaw + moveAngle;
      const speedMult = (this._isBird ? 1.5 : 1.0) * (keys.shift ? 2.0 : 1.0);
      pos.x += Math.sin(worldAngle) * SPEED * speedMult * delta;
      pos.z += Math.cos(worldAngle) * SPEED * speedMult * delta;

      // Clamp to island base radius
      const BASE_RADIUS = 150.0; // Increased to allow walking on the big ground plane
      const cx = this._islandCenterX ?? 0;
      const cz = this._islandCenterZ ?? 0;
      const dx = pos.x - cx;
      const dz = pos.z - cz;
      const dist = Math.sqrt(dx * dx + dz * dz);
      if (dist > BASE_RADIUS) {
        const ratio = BASE_RADIUS / dist;
        pos.x = cx + dx * ratio;
        pos.z = cz + dz * ratio;
      }

      // Rotate character body to face movement dir (3rd person)
      if (this.mode === 'third') {
        this.character.rotation.y = THREE.MathUtils.lerp(
          this.character.rotation.y, worldAngle, 12 * delta
        );
      }
    }

    // ── Camera positioning ───────────────────────────────────────────────────
    // Bird mode always uses 3rd-person orbit camera so mouse is free for painting
    if (this.mode === 'first' && !this._isBird) {
      this.camera.position.set(pos.x, pos.y + EYE_H, pos.z);
      this.camera.quaternion.setFromEuler(new THREE.Euler(this._pitch, this._yaw, 0, 'YXZ'));

    } else {
      // 3rd person (or bird mode override): camera orbits behind character at _yaw / _armPitch
      const sinY = Math.sin(this._yaw);
      const cosY = Math.cos(this._yaw);
      const cosP = Math.cos(this._armPitch);
      const sinP = Math.sin(this._armPitch);
      const ideal = new THREE.Vector3(
        pos.x + sinY * this._armLen * cosP,
        pos.y + sinP * this._armLen + 0.5,
        pos.z + cosY * this._armLen * cosP
      );
      // Smooth follow
      if (!this._camTarget.lengthSq()) this._camTarget.copy(ideal);
      this._camTarget.lerp(ideal, 1 - Math.pow(0.001, delta));
      this.camera.position.copy(this._camTarget);

      // Smooth look target
      if (!this._camLookTarget) this._camLookTarget = new THREE.Vector3(pos.x, pos.y + 0.45, pos.z);
      const idealLook = new THREE.Vector3(pos.x, pos.y + 0.45, pos.z);
      this._camLookTarget.lerp(idealLook, 1 - Math.pow(0.001, delta));
      this.camera.lookAt(this._camLookTarget);
    }

    // ── Crosshair / highlight ────────────────────────────────────────────────
    // Bird mode: always free-mouse highlight (pointer not locked)
    if (this.mode === 'first' && !this._isBird) {
      if (this._paintMode) this._updateCrosshair();
      else { this._clearHighlight(); this._setCH('idle'); }
    } else {
      // 3rd person (or bird mode): world-space highlight + interact
      if (this._paintMode) this._updateHighlight(delta);
      else { this._clearHighlight(); this._interactPrompt.style.display = 'none'; }
      const eDown = keys.e;
      if (eDown && !this._ePrevDown && this._highlightedObject) {
        this._interactPending = true;
      }
      this._ePrevDown = eDown;

      const fDown = keys.f;
      if (fDown && !this._fPrevDown && this._highlightedObject) {
        this._firePending = true;
      }
      this._fPrevDown = fDown;

      // G key → remove fire
      const gDown = keys.g;
      if (gDown && !this._gPrevDown && this._highlightedObject) {
        this._fireRemovePending = true;
      }
      this._gPrevDown = gDown;

      // R key → reposition fire
      const rDown = keys.r;
      if (rDown && !this._rPrevDown && this._highlightedObject) {
        this._fireRepositionPending = true;
      }
      this._rPrevDown = rDown;
    }
  }

  // ── Mouse / pointer ──────────────────────────────────────────────────────────
  _onMouseDown(e) {
    // Left-drag on empty space in bird mode rotates camera.
    // If there's a highlighted paintable target, skip drag — main.js will paint.
    if (this._isBird && e.button === 0 && !this._highlightedObject) {
      this._birdDragActive = true;
    }

  }

  _onMouseUp(e) {
    if (e.button === 0 || e.button === 2) this._birdDragActive = false;
  }

  _onMouseMove(e) {
    // Always track mouse NDC for free-mouse hover highlight
    this._mouseNDC.x = (e.clientX / window.innerWidth)  *  2 - 1;
    this._mouseNDC.y = -(e.clientY / window.innerHeight) * 2 + 1;

    // Bird mode / paint mode: drag rotates camera
    if (this._birdDragActive) {
      this._yawTarget -= e.movementX * MOUSE_SENS;
      this._armPitchTarget += e.movementY * MOUSE_SENS * 0.6;
      this._armPitchTarget = THREE.MathUtils.clamp(this._armPitchTarget, 0.05, Math.PI * 0.45);
      return;
    }

    if (!this._locked) return;
    this._yawTarget -= e.movementX * MOUSE_SENS;
    if (this.mode === 'first') {
      this._pitchTarget -= e.movementY * MOUSE_SENS;
      this._pitchTarget = THREE.MathUtils.clamp(this._pitchTarget, -Math.PI * 0.45, Math.PI * 0.45);
    } else {
      this._armPitchTarget += e.movementY * MOUSE_SENS * 0.6;
      this._armPitchTarget = THREE.MathUtils.clamp(this._armPitchTarget, 0.05, Math.PI * 0.45);
    }
  }

  _onWheel(e) {
    // Bird mode: scroll zooms arm length
    if (this._isBird) {
      this._armLenTarget += e.deltaY * ZOOM_SENS;
      this._armLenTarget = THREE.MathUtils.clamp(this._armLenTarget, ARM_MIN, ARM_MAX);
      e.preventDefault();
      return;
    }
    if (!this._locked || this.mode !== 'third') return;
    this._armLenTarget += e.deltaY * ZOOM_SENS;
    this._armLenTarget = THREE.MathUtils.clamp(this._armLenTarget, ARM_MIN, ARM_MAX);
    e.preventDefault();
  }

  _onClick() {
    if (!this._locked) {
      // Bird mode or 3rd person with highlighted target: let main.js handle paint
      if (this._isBird) return;
      if (this.mode === 'third' && this._highlightedObject) return;
      this.renderer.domElement.requestPointerLock();
      this._hint.style.display = 'none';
    }
  }

  // ── Crosshair (1st person) ────────────────────────────────────────────────────
  _updateCrosshair() {
    if (!this._paintTargets.length) {
      this._crosshairHit = false; this._lastHitPoint = null;
      this._setCH('idle');
      this._clearHighlight();
      return;
    }
    this._paintRay.setFromCamera(new THREE.Vector2(0, 0), this.camera);
    const hits = this._paintRay.intersectObjects(this._paintTargets, false);
    if (hits.length) {
      let g = hits[0].object;
      while (g && !g.userData.interactable) g = g.parent;
      const unpainted = g && !g.userData.isAlive;
      this._lastHitPoint = hits[0].point;
      this._crosshairHit = !!unpainted;
      this._setCH(unpainted ? 'paintable' : 'painted');

      // Apply glow highlight to unpainted targets only
      if (unpainted && g !== this._highlightedObject) {
        this._clearHighlight();
        this._highlightedObject = g;
        this._applyHighlight(g);
      } else if (!unpainted && this._highlightedObject) {
        this._clearHighlight();
      }
    } else {
      this._crosshairHit = false; this._lastHitPoint = null;
      this._setCH('idle');
      this._clearHighlight();
    }

    // Pulse the highlight (shared with 3rd person)
    if (this._highlightedObject) this._pulseHighlight();
  }

  // ── Shared pulse helper ───────────────────────────────────────────────────────
  _pulseHighlight() {
    const t = performance.now() * 0.0008;
    const pulse = 0.25 + 0.2 * Math.sin(t * Math.PI * 2);
    for (const d of this._highlightMeshData) {
      if (!d.mat) continue;
      if (d.isToon) {
        d.mat.color.lerpColors(d.origColor, new THREE.Color(0xffd166), pulse);
      } else {
        d.mat.emissiveIntensity = pulse;
      }
    }
  }

  // ── 3rd-person world-space highlight ─────────────────────────────────────────
  _updateHighlight(delta) {
    if (!this._paintTargets.length) {
      this._clearHighlight();
      this._interactPrompt.style.display = 'none';
      return;
    }

    let best = null;

    if (!this._locked || this._paintMode) {
      // Free mouse (or paint mode): raycast from cursor position (center if locked)
      const ndc = this._locked ? new THREE.Vector2(0, 0) : this._mouseNDC;
      this._paintRay.setFromCamera(ndc, this.camera);
      const hits = this._paintRay.intersectObjects(this._paintTargets, false);
      if (hits.length) {
        let g = hits[0].object;
        while (g && !g.userData.interactable) g = g.parent;
        // Only highlight unpainted objects
        if (g && !g.userData.isAlive) best = g;
      }
    } else {
      // Pointer-locked (no paint mode): proximity + facing direction
      const pos = this.character.position;
      const charFwdX = -Math.sin(this._yaw);
      const charFwdZ = -Math.cos(this._yaw);
      const charFwd  = new THREE.Vector3(charFwdX, 0, charFwdZ);
      let bestScore = -Infinity;
      const _wp = new THREE.Vector3();

      for (const mesh of this._paintTargets) {
        let g = mesh.parent;
        while (g && !g.userData.interactable) g = g.parent;
        if (!g || g.userData.isAlive) continue; // skip painted

        mesh.getWorldPosition(_wp);
        const toObj = _wp.clone().sub(pos);
        toObj.y = 0;
        const dist = toObj.length();
        if (dist > 5.0) continue;
        toObj.normalize();
        const dot = toObj.dot(charFwd);
        if (dot < -0.2) continue;
        const score = dot * 0.4 - dist * 0.6;
        if (score > bestScore) { bestScore = score; best = g; }
      }
    }

    if (best !== this._highlightedObject) {
      this._clearHighlight();
      this._highlightedObject = best;
      if (best) this._applyHighlight(best);
    }

    if (this._highlightedObject) {
      this._pulseHighlight();
      this._interactPrompt.style.display = 'block';
    } else {
      this._interactPrompt.style.display = 'none';
    }
  }

  _applyHighlight(group) {
    this._highlightMeshData = [];
    group.traverse(node => {
      if (!node.isMesh || node.userData.__cel_outline__) return;
      const mats = Array.isArray(node.material) ? node.material : [node.material];
      for (const mat of mats) {
        if (!mat) continue;
        // MeshToonMaterial (cel shader) doesn't support emissive — swap to a lit copy
        if (mat.isMeshToonMaterial) {
          // Just brighten the color instead
          const origColor = mat.color.clone();
          this._highlightMeshData.push({ mat, origColor, isToon: true });
          mat.color.set(0xffd166);
          continue;
        }
        // MeshStandardMaterial / MeshPhysicalMaterial
        if (!mat.emissive) continue;
        this._highlightMeshData.push({
          mat,
          origEmissive:  mat.emissive.clone(),
          origIntensity: mat.emissiveIntensity ?? 1,
          isToon: false,
        });
        mat.emissive.set(0xffd166);
        mat.emissiveIntensity = 0.8;
        mat.needsUpdate = true;
      }
    });
    console.log('[Highlight] applied to', group.name || group.uuid, '— mats stored:', this._highlightMeshData.length);
  }

  _clearHighlight() {
    for (const d of this._highlightMeshData) {
      if (!d.mat) continue;
      if (d.isToon) {
        d.mat.color.copy(d.origColor);
      } else {
        if (d.mat.emissive) d.mat.emissive.copy(d.origEmissive);
        d.mat.emissiveIntensity = d.origIntensity;
        d.mat.needsUpdate = true;
      }
    }
    this._highlightMeshData   = [];
    this._highlightedObject   = null;
  }

  _setCH(state) {
    const ring = this._crosshair.querySelector('.ch-ring');
    const dot  = this._crosshair.querySelector('.ch-dot');
    if (!ring) return;
    const styles = {
      paintable: { border:'rgba(255,210,80,0.95)', shadow:'0 0 10px rgba(255,200,60,0.65)', scale:'scale(1.3)', dot:'#ffd166', dotShadow:'0 0 6px rgba(255,200,60,0.8)' },
      painted:   { border:'rgba(140,220,140,0.7)', shadow:'none',                            scale:'scale(1.0)', dot:'rgba(140,220,140,0.8)', dotShadow:'none' },
      idle:      { border:'rgba(255,255,255,0.4)', shadow:'none',                            scale:'scale(1.0)', dot:'rgba(255,255,255,0.55)', dotShadow:'none' },
    };
    const s = styles[state];
    ring.style.borderColor = s.border;
    ring.style.boxShadow   = s.shadow;
    ring.style.transform   = `translate(-50%,-50%) ${s.scale}`;
    dot.style.background   = s.dot;
    dot.style.boxShadow    = s.dotShadow;
  }

  // ── UI builders ──────────────────────────────────────────────────────────────
  _showHint() {
    this._hint.style.display = 'flex';
    clearTimeout(this._hintTimer);
    this._hintTimer = setTimeout(() => { this._hint.style.display = 'none'; }, 4000);
  }

  _mkHint() {
    const el = document.createElement('div');
    el.style.cssText = `
      position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);
      background:rgba(0,0,0,0.72);color:#fff;padding:14px 24px;
      border-radius:14px;font-size:13px;letter-spacing:0.05em;
      pointer-events:none;display:none;z-index:20000;
      backdrop-filter:blur(10px);border:1px solid rgba(255,255,255,0.18);
      text-align:center;line-height:1.8;
    `;
    el.innerHTML = `<b>Click to capture mouse</b><br>WASD · Space jump · Mouse look / Scroll zoom<br><small style="color:#ffd166">Form → <b>[ Q ]</b> &nbsp; Ghost → <b>[ V ]</b> &nbsp; Paint Mode → <b>[ P ]</b></small><br><small style="opacity:0.6">3rd: yaklaş <b style="color:#ffd166">[ E ]</b> boya &nbsp; Bird: sol sürükle kamera, objede tık boya</small><br><small style="opacity:0.45">ESC to release</small>`;
    return el;
  }

  _mkBadge() {
    const el = document.createElement('div');
    el.style.cssText = `
      position:fixed;bottom:130px;left:50%;transform:translateX(-50%);
      background:rgba(0,0,0,0.5);color:rgba(255,255,255,0.8);
      padding:5px 14px;border-radius:20px;font-size:11px;font-weight:700;
      letter-spacing:0.08em;pointer-events:none;display:none;z-index:10000;
      backdrop-filter:blur(8px);border:1px solid rgba(255,255,255,0.13);
    `;
    return el;
  }

  _mkCrosshair() {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'position:fixed;top:50%;left:50%;pointer-events:none;display:none;z-index:15000;';

    const ring = document.createElement('div');
    ring.className = 'ch-ring';
    ring.style.cssText = `
      position:absolute;top:50%;left:50%;
      width:22px;height:22px;
      border:1.5px solid rgba(255,255,255,0.4);border-radius:50%;
      transform:translate(-50%,-50%) scale(1.0);
      transition:border-color 0.1s,box-shadow 0.1s,transform 0.1s;
    `;
    const dot = document.createElement('div');
    dot.className = 'ch-dot';
    dot.style.cssText = `
      position:absolute;top:50%;left:50%;
      width:4px;height:4px;
      background:rgba(255,255,255,0.55);border-radius:50%;
      transform:translate(-50%,-50%);
      transition:background 0.1s,box-shadow 0.1s;
    `;
    wrap.append(ring, dot);
    return wrap;
  }

  _mkInteractPrompt() {
    const el = document.createElement('div');
    el.style.cssText = `
      position:fixed;bottom:100px;left:50%;transform:translateX(-50%);
      background:rgba(0,0,0,0.62);color:#ffd166;
      padding:7px 18px;border-radius:20px;font-size:12px;font-weight:700;
      letter-spacing:0.08em;pointer-events:none;display:none;z-index:15001;
      backdrop-filter:blur(8px);border:1px solid rgba(255,210,80,0.35);
      box-shadow:0 0 14px rgba(255,210,80,0.25);
    `;
    el.innerHTML = '[ Click / E ] Boyama &nbsp; [ F ] Fire &nbsp; [ G ] Sil &nbsp; [ R ] Taşı &nbsp; [ P ] Paint Mode';
    return el;
  }

  get paintMode() { return this._paintMode; }

  _updateBadge() {
    if (this.mode === 'orbit') return;
    const form = this._isBird ? '🐦 BIRD' : '🐰 3RD';
    const ghost = this._ghostMode ? ' · 👻 GHOST' : '';
    const paint = this._paintMode ? ' · 🖌 PAINT' : '';
    this._badge.textContent = (this.mode === 'first' && !this._isBird ? '👁 1ST PERSON' : form) + ghost + paint;
  }

  dispose() {
    document.removeEventListener('keydown',      onKeyDown);
    document.removeEventListener('keyup',        onKeyUp);
    document.removeEventListener('mousemove',    this._boundMouseMove);
    document.removeEventListener('wheel',        this._boundWheel);
    document.removeEventListener('mousedown',    this._boundMouseDown);
    document.removeEventListener('mouseup',      this._boundMouseUp);
    document.removeEventListener('contextmenu',  this._boundContextMenu);
    this._clearHighlight();
    this._hint.remove(); this._badge.remove(); this._crosshair.remove(); this._interactPrompt.remove();
    if (this._mixer) this._mixer.stopAllAction();
    this.scene.remove(this.character);
  }
}
