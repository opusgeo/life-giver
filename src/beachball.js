/**
 * beachball.js — Interactive beach ball system for BunchTownV2 level
 *
 * Loads Playable_Ball.fbx, swaps it into each BeachBall group in-place so the
 * ball keeps its correct world position AND remains paintable (interactable).
 *
 * State machine per ball:
 *   FREE      → stationary, character can approach freely
 *   DRIBBLING → touching; ball sticks to feet until kicked with [A]
 *
 * Boundary: ball is clamped inside Bunchtown_009 (football field) bounds.
 */

import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';

const KICK_RADIUS    = 1.4;    // world units — within this range E kicks the ball
const PROMPT_RADIUS  = 1.8;    // show [E] prompt from here
const KICK_FORCE     = 10.0;
const KICK_UP        = 2.5;
const GRAVITY        = -16;
const BOUNCE_DAMPING = 0.50;
const FRICTION       = 0.87;
const KICK_COOLDOWN  = 0.35;
const KICK_DOT_MIN   = 0.3;    // character must be roughly facing the ball (cos angle)
const SPIN_SCALE     = 3.0;
const KICK_KEY       = 'e';
const FBX_PATH       = '/models/029_BunchTownV2/Playable_Ball.fbx';

const _fbxLoader = new FBXLoader();

export class BeachBallSystem {
  constructor(walkMode) {
    this.walkMode    = walkMode;
    this.balls       = [];
    this.fieldBounds = null;

    this._eDown        = false;
    this._ePrev        = false;
    this._kickCooldown = 0;

    // Loaded FBX template — cloned for each ball instance
    this._fbxTemplate  = null;
    this._fbxLoadError = false;
    this._pendingInits = [];   // ball groups waiting for FBX

    this._prompt = this._createPrompt();
    document.body.appendChild(this._prompt);

    this._onKD = (e) => { if (e.key.toLowerCase() === KICK_KEY) this._eDown = true; };
    this._onKU = (e) => { if (e.key.toLowerCase() === KICK_KEY) this._eDown = false; };
    document.addEventListener('keydown', this._onKD);
    document.addEventListener('keyup',   this._onKU);

    // Start loading FBX immediately
    _fbxLoader.load(
      FBX_PATH,
      (fbx) => {
        // Normalise materials so they work with the cel/clay system
        fbx.traverse(n => {
          if (!n.isMesh) return;
          n.castShadow    = true;
          n.receiveShadow = true;
          const mats = Array.isArray(n.material) ? n.material : [n.material];
          mats.forEach(m => {
            if (m.emissive)              m.emissive.setScalar(0);
            if (m.metalness !== undefined) m.metalness = 0;
          });
          n.userData.originalMaterial = Array.isArray(n.material)
            ? n.material.map(m => m.clone())
            : n.material.clone();
        });

        // Auto-scale: normalise so the ball fits in ~0.25 world-unit radius
        const tmpBox  = new THREE.Box3().setFromObject(fbx);
        const fbxSize = new THREE.Vector3();
        tmpBox.getSize(fbxSize);
        const maxDim   = Math.max(fbxSize.x, fbxSize.y, fbxSize.z);
        const wantSize = 0.5;   // desired diameter in world units
        const fbxScale = maxDim > 0 ? wantSize / maxDim : 1.0;

        this._fbxTemplate = { scene: fbx, scale: fbxScale };
        console.log('[BeachBall] FBX loaded, scale factor:', fbxScale.toFixed(4));

        // Resolve any balls that were waiting for the FBX
        for (const pending of this._pendingInits) {
          this._swapVisuals(pending);
        }
        this._pendingInits = [];
      },
      undefined,
      (err) => {
        console.warn('[BeachBall] Failed to load FBX:', err);
        this._fbxLoadError = true;
        this._pendingInits = [];
      }
    );
  }

  _createPrompt() {
    const el = document.createElement('div');
    el.style.cssText = `
      position:fixed;bottom:140px;left:50%;transform:translateX(-50%);
      background:rgba(0,0,0,0.65);color:#7fff7f;
      padding:7px 20px;border-radius:20px;font-size:12px;font-weight:700;
      letter-spacing:0.09em;pointer-events:none;display:none;z-index:15002;
      backdrop-filter:blur(8px);border:1px solid rgba(80,255,80,0.38);
      box-shadow:0 0 14px rgba(80,255,80,0.28);font-family:monospace;
    `;
    el.textContent = '[ E ] Vur  ⚽';
    return el;
  }

  // ── Swap original GLB visuals with FBX model ──────────────────────────────
  _swapVisuals(ballState) {
    const { group, groundY, ballR } = ballState;
    const { scene: fbx, scale } = this._fbxTemplate;

    // Remove the original GLB model children
    while (group.children.length) group.remove(group.children[0]);

    // Clone FBX and add at origin
    const clone = fbx.clone(true);
    clone.traverse(n => {
      if (n.isMesh) {
        n.castShadow = n.receiveShadow = true;
        n.userData.originalMaterial = Array.isArray(n.material)
          ? n.material.map(m => m.clone())
          : n.material.clone();
      }
    });
    clone.scale.setScalar(scale);

    // Centre the clone so its bottom sits at y=0 within the group
    const cBox = new THREE.Box3().setFromObject(clone);
    clone.position.y -= cBox.min.y;   // shift up so bottom = 0

    group.add(clone);
    ballState.fbxLoaded = true;
    console.log('[BeachBall] FBX visual swapped into ball group');
  }

  // ── Called once per level load ─────────────────────────────────────────────
  initLevel(ballGroups, fieldGroup, sheepballGroups = []) {
    this.balls       = [];
    this.fieldBounds = null;
    this._kickCooldown = 0;
    this._eDown      = false;
    this._ePrev      = false;
    this._pendingInits = [];

    // Field bounds
    if (fieldGroup) {
      fieldGroup.updateWorldMatrix(true, true);
      const box = new THREE.Box3().setFromObject(fieldGroup);
      const inset = 0.05;
      box.min.x += inset; box.min.z += inset;
      box.max.x -= inset; box.max.z -= inset;
      this.fieldBounds = box;
      console.log('[BeachBall] field bounds', box.min, '→', box.max);
    }

    // Sheepball: same physics, no FBX swap — keep original mesh
    for (const group of sheepballGroups) {
      group.updateWorldMatrix(true, true);
      const box    = new THREE.Box3().setFromObject(group);
      const ballH  = box.max.y - box.min.y;
      const ballR  = Math.max(ballH * 0.5, 0.15);
      const groundY = box.min.y;

      const initCenter = new THREE.Vector3(
        (box.min.x + box.max.x) * 0.5,
        groundY + ballR,
        (box.min.z + box.max.z) * 0.5
      );

      const parent = group.parent;
      if (parent) {
        parent.updateWorldMatrix(true, false);
        const invParent = new THREE.Matrix4().copy(parent.matrixWorld).invert();
        const localCenter = initCenter.clone().applyMatrix4(invParent);
        const delta = localCenter.clone().sub(group.position);
        group.position.copy(localCenter);
        group.children.forEach(c => c.position.sub(delta));
      }

      this.balls.push({
        group,
        worldPos:  initCenter.clone(),
        vel:       new THREE.Vector3(),
        groundY,
        ballR,
        fbxLoaded: true,   // no swap needed
      });
      console.log('[BeachBall] Sheepball registered at', initCenter);
    }

    for (const group of ballGroups) {
      group.updateWorldMatrix(true, true);

      // World-space bounding box of the original model → derive ground & radius
      const box    = new THREE.Box3().setFromObject(group);
      const ballH  = box.max.y - box.min.y;
      const ballR  = Math.max(ballH * 0.5, 0.15);
      const groundY = box.min.y;

      // Ball centre in world space
      const initCenter = new THREE.Vector3(
        (box.min.x + box.max.x) * 0.5,
        groundY + ballR,
        (box.min.z + box.max.z) * 0.5
      );

      // Reposition the group origin to the ball centre (parent-local space)
      // so pivot == ball centre → physics write-back is just group.position = localCenter
      const parent = group.parent;
      if (parent) {
        parent.updateWorldMatrix(true, false);
        const invParent = new THREE.Matrix4().copy(parent.matrixWorld).invert();
        const localCenter = initCenter.clone().applyMatrix4(invParent);

        // Move group to centre position; offset children so they don't jump
        const delta = localCenter.clone().sub(group.position);
        group.position.copy(localCenter);
        group.children.forEach(c => c.position.sub(delta));
      }

      const ballState = {
        group,
        worldPos:  initCenter.clone(),
        vel:       new THREE.Vector3(),
        groundY,
        ballR,
        fbxLoaded: false,
      };

      this.balls.push(ballState);

      // Swap visuals: immediately if FBX ready, otherwise queue
      if (this._fbxTemplate) {
        this._swapVisuals(ballState);
      } else {
        this._pendingInits.push(ballState);
      }
    }
  }

  // ── Frame update ───────────────────────────────────────────────────────────
  update(delta) {
    if (!this.balls.length) return;
    if (this.walkMode.mode === 'orbit') {
      this._prompt.style.display = 'none';
      return;
    }

    if (this._kickCooldown > 0) this._kickCooldown -= delta;

    const charPos = new THREE.Vector3();
    this.walkMode.character.getWorldPosition(charPos);

    const yaw     = this.walkMode._yaw;
    const charFwd = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));

    let showPrompt = false;

    for (const ball of this.balls) {
      const { ballR, groundY } = ball;

      // 2D distance (ignore height)
      const dx   = charPos.x - ball.worldPos.x;
      const dz   = charPos.z - ball.worldPos.z;
      const dist = Math.sqrt(dx * dx + dz * dz);

      // ── Direction from character to ball (2D) ──────────────────────────────
      const toBallX = ball.worldPos.x - charPos.x;
      const toBallZ = ball.worldPos.z - charPos.z;
      const toBallLen = Math.sqrt(toBallX * toBallX + toBallZ * toBallZ) || 1;
      const dotFacing = (charFwd.x * toBallX + charFwd.z * toBallZ) / toBallLen;

      const canKick = dist < KICK_RADIUS && dotFacing > KICK_DOT_MIN;

      if (canKick) showPrompt = true;

      // ── Kick (E pressed, facing ball, within range) ─────────────────────────
      if (canKick && this._eDown && !this._ePrev && this._kickCooldown <= 0) {
        ball.vel.copy(charFwd).multiplyScalar(KICK_FORCE);
        ball.vel.y = KICK_UP;
        this._kickCooldown = KICK_COOLDOWN;
      }

      // ── Physics ─────────────────────────────────────────────────────────────
      ball.vel.y += GRAVITY * delta;
      ball.worldPos.x += ball.vel.x * delta;
      ball.worldPos.y += ball.vel.y * delta;
      ball.worldPos.z += ball.vel.z * delta;

      // Floor
      const floorY = groundY + ballR;
      if (ball.worldPos.y < floorY) {
        ball.worldPos.y = floorY;
        ball.vel.y = Math.abs(ball.vel.y) * BOUNCE_DAMPING;
        if (ball.vel.y < 0.3) ball.vel.y = 0;
        ball.vel.x *= FRICTION;
        ball.vel.z *= FRICTION;
      }

      // Field boundary (only constraint — no other colliders)
      if (this.fieldBounds) {
        const b = this.fieldBounds;
        const r = ballR;
        if (ball.worldPos.x < b.min.x + r) { ball.worldPos.x = b.min.x + r; ball.vel.x =  Math.abs(ball.vel.x) * 0.4; }
        else if (ball.worldPos.x > b.max.x - r) { ball.worldPos.x = b.max.x - r; ball.vel.x = -Math.abs(ball.vel.x) * 0.4; }
        if (ball.worldPos.z < b.min.z + r) { ball.worldPos.z = b.min.z + r; ball.vel.z =  Math.abs(ball.vel.z) * 0.4; }
        else if (ball.worldPos.z > b.max.z - r) { ball.worldPos.z = b.max.z - r; ball.vel.z = -Math.abs(ball.vel.z) * 0.4; }
      }

      // ── Visual spin ─────────────────────────────────────────────────────────
      const speed = ball.vel.length();
      if (speed > 0.05) {
        ball.group.rotation.x += ball.vel.z * delta * SPIN_SCALE;
        ball.group.rotation.z -= ball.vel.x * delta * SPIN_SCALE;
      }

      // ── Write ball centre → group local position ─────────────────────────
      // Group origin IS the ball centre now (after initLevel repositioning)
      const parent = ball.group.parent;
      if (parent) {
        parent.updateWorldMatrix(true, false);
        const invParent = new THREE.Matrix4().copy(parent.matrixWorld).invert();
        const localPos  = ball.worldPos.clone().applyMatrix4(invParent);
        ball.group.position.copy(localPos);
      }
    }

    this._ePrev = this._eDown;
    this._prompt.style.display = showPrompt ? 'block' : 'none';
  }

  dispose() {
    document.removeEventListener('keydown', this._onKD);
    document.removeEventListener('keyup',   this._onKU);
    this._prompt.remove();
    this.balls       = [];
    this.fieldBounds = null;
  }
}
