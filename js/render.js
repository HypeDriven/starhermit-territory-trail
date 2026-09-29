'use strict';

// Render: Three.js scene for the floating territory plane.
// Layers: 0 environment, 1 gameplay cells, 2 selection/ghost, 3 effects.
// Rendering consumes immutable snapshots; it never mutates rules state.
// Graphics quality (presets, per-effect overrides, adaptive resolution) is
// resolved by gfx.js; setGraphics() applies it live.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { FXAAShader } from 'three/addons/shaders/FXAAShader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { detectPreset, resolve, describe, SHADOW_MAP } from './gfx.js';

const LAYER_ENV = 0, LAYER_GAME = 1, LAYER_FX = 3;
const MAX_SPARKS = 900;
const MOTE_COUNT = 140;
const CAM_POS = new THREE.Vector3(0, 42, 26);

// Colour grade + vignette (display-space colours in, display-space out).
const GradeShader = {
  uniforms: { tDiffuse: { value: null }, uAmount: { value: 1.0 }, uVignette: { value: 0.26 } },
  vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float uAmount; uniform float uVignette;
    varying vec2 vUv;
    void main() {
      vec4 src = texture2D(tDiffuse, vUv);
      vec3 c = clamp(src.rgb, 0.0, 1.0);
      // Gentle S-curve contrast, slightly richer saturation, cool shadows / warm highlights.
      vec3 s = mix(c, c * c * (3.0 - 2.0 * c), 0.22);
      float l = dot(s, vec3(0.299, 0.587, 0.114));
      s = mix(vec3(l), s, 1.1);
      s *= mix(vec3(0.97, 0.99, 1.05), vec3(1.03, 1.0, 0.97), smoothstep(0.25, 0.85, l));
      c = mix(c, s, uAmount);
      float d = length(vUv - 0.5);
      c *= 1.0 - uVignette * smoothstep(0.38, 0.9, d);
      gl_FragColor = vec4(c, src.a);
    }`,
};

// Deterministic value-noise grain texture (visual seed, never touches rules).
function grainTexture(seed, lo, hi) {
  const size = 128;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);
  let s = seed >>> 0;
  const rnd = () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const coarse = [];
  for (let i = 0; i < 17 * 17; i++) coarse.push(rnd());
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const gx = x / 8, gy = y / 8, ix = gx | 0, iy = gy | 0, fx = gx - ix, fy = gy - iy;
      const a = coarse[iy * 17 + ix], b = coarse[iy * 17 + ix + 1], cc = coarse[(iy + 1) * 17 + ix], d = coarse[(iy + 1) * 17 + ix + 1];
      const v = (a * (1 - fx) + b * fx) * (1 - fy) + (cc * (1 - fx) + d * fx) * fy;
      const n = lo + (hi - lo) * (0.65 * v + 0.35 * rnd());
      const o = (y * size + x) * 4;
      img.data[o] = img.data[o + 1] = img.data[o + 2] = Math.round(n * 255);
      img.data[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

function backdropTexture(hex) {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const ctx = c.getContext('2d');
  const base = new THREE.Color(hex);
  const lift = base.clone().lerp(new THREE.Color('#3b5b8a'), 0.28);
  const g = ctx.createRadialGradient(128, 110, 10, 128, 128, 190);
  g.addColorStop(0, '#' + lift.getHexString());
  g.addColorStop(1, '#' + base.getHexString());
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 256, 256);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function dotTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.4, 'rgba(255,255,255,0.6)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 32, 32);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export class Renderer {
  constructor(container) {
    this.container = container;
    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 200);
    // the camera renders every layer: environment, gameplay pieces and FX
    this.camera.layers.enable(LAYER_GAME);
    this.camera.layers.enable(LAYER_FX);
    this.camera.position.copy(CAM_POS);
    this.camera.lookAt(0, 0, 0);

    let webglOk = true;
    try {
      this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    } catch (e) { webglOk = false; }
    if (!webglOk) {
      this.failed = true;
      return;
    }
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    container.appendChild(this.renderer.domElement);
    this.renderer.domElement.setAttribute('aria-hidden', 'true');

    this.gpu = Renderer.gpuName(this.renderer);
    const mobile = (typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches) || /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent || '');
    this.detected = detectPreset(this.gpu, mobile);

    // PBR lighting: one dominant key, soft hemisphere fill.
    const key = new THREE.DirectionalLight(0xfff4e6, 2.2);
    key.position.set(18, 30, 12);
    key.shadow.bias = -0.0004;
    key.shadow.normalBias = 0.02;
    this.keyLight = key;
    this.scene.add(key.target);
    const fill = new THREE.HemisphereLight(0xbdd3ff, 0x1a2233, 0.9);
    this.fillLight = fill;
    for (const l of [key, fill]) { l.layers.enable(LAYER_GAME); l.layers.enable(LAYER_FX); }
    this.scene.add(key, fill);

    this.reducedMotion = false;
    this.q = resolve({}, this.detected);
    this.size = [0, 0];
    this.pixelRatio = 1;
    this.adaptiveScale = 1;
    this._frames = [];
    this.postKey = null;
    this.composer = null;
    this.postFailed = false;
    this.envMap = null;
    this.attract = false;
    this.clock = 0;

    // Board resources, rebuilt per round.
    this.board = null;
    this.cellMesh = null;
    this.trailMesh = null;
    this.pawns = [];
    this.fxPool = [];
    this.activeFx = [];
    this.flashes = new Map(); // cell index → age (s)
    this.theme = null;
    this.tmpColor = new THREE.Color();
    this.tmpMat = new THREE.Matrix4();
    this.white = new THREE.Color('#ffffff');
    this.pawnPrev = [];
    this.frameCount = 0;
    this.lastSnapshot = null;
    this.onCellPick = null; // (x,y) => void

    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.pickPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

    this._initParticles();

    this.renderer.domElement.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      this.contextLost = true;
    });
    this.renderer.domElement.addEventListener('webglcontextrestored', () => {
      this.contextLost = false;
      this.postKey = null;
      if (this.lastBuild) this.buildBoard(this.lastBuild.state, this.lastBuild.theme);
    });
  }

  static gpuName(r) {
    try {
      const gl = r.getContext();
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      return String(gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER) || '');
    } catch (e) {
      return '';
    }
  }

  // ---------------------------------------------------------------- graphics settings

  /** Apply saved graphics settings ({preset, render_scale, adaptive, show_fps, <category>}). */
  setGraphics(saved, reducedMotion) {
    if (this.failed) return;
    const gkey = JSON.stringify(saved || {}) + '|' + !!reducedMotion;
    if (gkey === this._gfxKey) return; // unrelated settings changed
    this._gfxKey = gkey;
    const prev = this.q;
    const g = resolve(saved || {}, this.detected);
    this.q = g;
    this.reducedMotion = !!reducedMotion;
    const size = SHADOW_MAP[g.shadows];
    const shadowsChanged = this.renderer.shadowMap.enabled !== size > 0;
    this.renderer.shadowMap.enabled = size > 0;
    this.keyLight.castShadow = size > 0;
    if (size > 0 && this.keyLight.shadow.mapSize.x !== size) {
      this.keyLight.shadow.mapSize.set(size, size);
      if (this.keyLight.shadow.map) { this.keyLight.shadow.map.dispose(); this.keyLight.shadow.map = null; }
    }
    this._applyEnvironment();
    this.adaptiveScale = 1;
    this._frames = [];
    this.postKey = null; // rebuild the post chain on the next frame
    this._fpsVisible(g.showFps);
    this.motes.visible = g.background === 'animated';
    if (prev && prev.detail !== g.detail && this.lastBuild) {
      const att = this.attract;
      this.buildBoard(this.lastBuild.state, this.lastBuild.theme);
      this.attract = att;
      if (this.lastSnapshot) this.update(this.lastSnapshot, 1);
    } else if (shadowsChanged) {
      // Materials pick up shadow-map changes on recompile.
      this.scene.traverse((o) => { if (o.material) o.material.needsUpdate = true; });
    }
    document.body.setAttribute('data-gfx-preset', g.preset);
    this.renderer.domElement.setAttribute('data-gfx-preset', g.preset);
  }

  /** What the settings panel shows: GPU, auto choice, resolved tiers, cost and frame rate. */
  graphicsInfo(words) {
    const px = [Math.round(this.size[0] * this.pixelRatio), Math.round(this.size[1] * this.pixelRatio)];
    return {
      gpu: this.gpu || 'unknown GPU',
      detected: this.detected,
      resolved: this.q,
      summary: describe(this.q, px, words),
      fps: Math.round(this.fps || 0),
      adaptiveScale: Math.round(this.adaptiveScale * 100) / 100,
      postFailed: !!this.postFailed,
    };
  }

  _applyEnvironment() {
    const detailed = this.q.detail === 'detailed';
    if (detailed && !this.envMap) {
      try {
        const pmrem = new THREE.PMREMGenerator(this.renderer);
        const room = new RoomEnvironment();
        this.envMap = pmrem.fromScene(room, 0.04).texture;
        room.dispose && room.dispose();
        pmrem.dispose();
      } catch (e) { this.envMap = null; }
    }
    this.scene.environment = detailed ? this.envMap : null;
    this.scene.environmentIntensity = 0.32;
    this._applyBackground();
  }

  _applyBackground() {
    if (!this.theme) return;
    if (this.bgTexture) { this.bgTexture.dispose(); this.bgTexture = null; }
    if (this.q.detail === 'detailed') {
      this.bgTexture = backdropTexture(this.theme.background);
      this.scene.background = this.bgTexture;
    } else {
      this.scene.background = new THREE.Color(this.theme.background);
    }
  }

  _fpsVisible(on) {
    let el = document.getElementById('fps-meter');
    if (on && !el) {
      el = document.createElement('div');
      el.id = 'fps-meter';
      el.setAttribute('aria-hidden', 'true');
      el.textContent = '… fps';
      document.body.append(el);
    }
    if (el) el.hidden = !on;
  }

  /** Title backdrop mode: gentle camera sway over a demo board. */
  setAttract(on) {
    this.attract = !!on;
    if (!on) {
      this.camera.position.copy(CAM_POS);
      this.camera.lookAt(0, 0, 0);
    }
  }

  // ---------------------------------------------------------------- particles

  _initParticles() {
    // Claim sparks: one pooled Points buffer, additive, never raycast.
    this.dot = dotTexture();
    const geo = new THREE.BufferGeometry();
    this.sparkPos = new Float32Array(MAX_SPARKS * 3);
    this.sparkCol = new Float32Array(MAX_SPARKS * 3);
    this.sparkVel = new Float32Array(MAX_SPARKS * 3);
    this.sparkLife = new Float32Array(MAX_SPARKS);
    this.sparkBase = new Float32Array(MAX_SPARKS * 3);
    geo.setAttribute('position', new THREE.BufferAttribute(this.sparkPos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('color', new THREE.BufferAttribute(this.sparkCol, 3).setUsage(THREE.DynamicDrawUsage));
    const mat = new THREE.PointsMaterial({ size: 7, map: this.dot, vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
    this.sparks = new THREE.Points(geo, mat);
    this.sparks.frustumCulled = false;
    this.sparks.layers.set(LAYER_FX);
    this.sparks.raycast = () => {};
    this.sparkNext = 0;
    this.sparkActive = 0;
    this.scene.add(this.sparks);

    // Ambient motes drifting around the island.
    const mg = new THREE.BufferGeometry();
    this.motePos = new Float32Array(MOTE_COUNT * 3);
    this.moteSeed = new Float32Array(MOTE_COUNT * 4);
    let s = 1234567;
    const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
    for (let i = 0; i < MOTE_COUNT; i++) {
      this.moteSeed[i * 4] = (rnd() - 0.5) * 70;
      this.moteSeed[i * 4 + 1] = rnd() * 30 - 14;
      this.moteSeed[i * 4 + 2] = (rnd() - 0.5) * 60;
      this.moteSeed[i * 4 + 3] = rnd() * Math.PI * 2;
    }
    mg.setAttribute('position', new THREE.BufferAttribute(this.motePos, 3).setUsage(THREE.DynamicDrawUsage));
    this.moteMat = new THREE.PointsMaterial({ size: 5, map: this.dot, color: 0xcfe3ff, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false });
    this.motes = new THREE.Points(mg, this.moteMat);
    this.motes.frustumCulled = false;
    this.motes.layers.set(LAYER_FX);
    this.motes.raycast = () => {};
    this.motes.visible = false;
    this._updateMotes(0);
    this.scene.add(this.motes);
  }

  _updateMotes(t) {
    const p = this.motePos, sd = this.moteSeed;
    for (let i = 0; i < MOTE_COUNT; i++) {
      const ph = sd[i * 4 + 3];
      p[i * 3] = sd[i * 4] + Math.sin(t * 0.21 + ph) * 1.6;
      p[i * 3 + 1] = ((sd[i * 4 + 1] + t * 0.35 + 14) % 30) - 14;
      p[i * 3 + 2] = sd[i * 4 + 2] + Math.cos(t * 0.17 + ph) * 1.6;
    }
    this.motes.geometry.attributes.position.needsUpdate = true;
  }

  _emitSparks(x, z, color, n) {
    for (let k = 0; k < n; k++) {
      const i = this.sparkNext;
      this.sparkNext = (this.sparkNext + 1) % MAX_SPARKS;
      this.sparkPos[i * 3] = x + (Math.random() - 0.5) * 0.8;
      this.sparkPos[i * 3 + 1] = 0.25;
      this.sparkPos[i * 3 + 2] = z + (Math.random() - 0.5) * 0.8;
      const a = Math.random() * Math.PI * 2, sp = 0.6 + Math.random() * 1.6;
      this.sparkVel[i * 3] = Math.cos(a) * sp * 0.6;
      this.sparkVel[i * 3 + 1] = 2.5 + Math.random() * 3;
      this.sparkVel[i * 3 + 2] = Math.sin(a) * sp * 0.6;
      this.sparkLife[i] = 0.7 + Math.random() * 0.5;
      const c = this.tmpColor.copy(color).lerp(this.white, 0.35);
      this.sparkBase[i * 3] = c.r * 1.6; this.sparkBase[i * 3 + 1] = c.g * 1.6; this.sparkBase[i * 3 + 2] = c.b * 1.6;
    }
    this.sparkActive = MAX_SPARKS;
  }

  _updateSparks(dt) {
    if (!this.sparkActive) return;
    let alive = 0;
    for (let i = 0; i < MAX_SPARKS; i++) {
      if (this.sparkLife[i] <= 0) { this.sparkCol[i * 3] = this.sparkCol[i * 3 + 1] = this.sparkCol[i * 3 + 2] = 0; continue; }
      alive++;
      this.sparkLife[i] -= dt;
      this.sparkVel[i * 3 + 1] -= 6 * dt;
      this.sparkPos[i * 3] += this.sparkVel[i * 3] * dt;
      this.sparkPos[i * 3 + 1] = Math.max(0.15, this.sparkPos[i * 3 + 1] + this.sparkVel[i * 3 + 1] * dt);
      this.sparkPos[i * 3 + 2] += this.sparkVel[i * 3 + 2] * dt;
      const f = Math.max(0, Math.min(1, this.sparkLife[i] / 0.6));
      this.sparkCol[i * 3] = this.sparkBase[i * 3] * f;
      this.sparkCol[i * 3 + 1] = this.sparkBase[i * 3 + 1] * f;
      this.sparkCol[i * 3 + 2] = this.sparkBase[i * 3 + 2] * f;
    }
    this.sparks.geometry.attributes.position.needsUpdate = true;
    this.sparks.geometry.attributes.color.needsUpdate = true;
    if (!alive) this.sparkActive = 0;
  }

  // ---------------------------------------------------------------- board

  buildBoard(state, theme) {
    this.theme = theme;
    this.lastBuild = { state: state, theme: theme };
    this.setAttract(false);
    this.disposeBoard();
    this._applyBackground();
    this.scene.fog = new THREE.Fog(theme.background, 60, 140);
    const detailed = this.q.detail === 'detailed';
    this.moteMat.color.set(theme.trailGlow);

    const w = state.width, h = state.height;
    const n = w * h;
    const extra = [];

    // Floating island base under the grid.
    const baseGeo = detailed ? new RoundedBoxGeometry(w + 2.4, 1.2, h + 2.4, 3, 0.35) : new THREE.BoxGeometry(w + 2.4, 1.2, h + 2.4);
    const baseMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(theme.grid), roughness: 0.9, metalness: 0.05 });
    if (detailed) {
      this.grain = this.grain || grainTexture(94, 0.72, 1.0);
      baseMat.map = this.grain.clone();
      baseMat.map.needsUpdate = true;
      baseMat.map.repeat.set((w + 2.4) / 6, (h + 2.4) / 6);
      baseMat.color.multiplyScalar(1.25);
    }
    const base = new THREE.Mesh(baseGeo, baseMat);
    base.position.set(0, -0.75, 0);
    base.receiveShadow = true;
    base.layers.set(LAYER_ENV);
    this.scene.add(base);

    if (detailed) {
      // Rocky underside: an inverted, jittered pyramid that makes the plane float.
      const depth = Math.max(w, h) * 0.42;
      const rockGeo = new THREE.CylinderGeometry(Math.SQRT2, 0.12, 1, 4, 5, false, Math.PI / 4);
      const pos = rockGeo.attributes.position;
      let s = 9403;
      const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
      for (let i = 0; i < pos.count; i++) {
        const y = pos.getY(i);
        if (y < 0.49 && y > -0.49) {
          pos.setX(i, pos.getX(i) * (0.85 + rnd() * 0.3));
          pos.setZ(i, pos.getZ(i) * (0.85 + rnd() * 0.3));
        }
      }
      rockGeo.computeVertexNormals();
      const rockCol = new THREE.Color(theme.grid).lerp(new THREE.Color(theme.background), 0.35);
      const rock = new THREE.Mesh(rockGeo, new THREE.MeshStandardMaterial({ color: rockCol, roughness: 1, metalness: 0, flatShading: true }));
      rock.scale.set((w + 2.2) / 2, depth, (h + 2.2) / 2);
      rock.position.set(0, -1.3 - depth / 2, 0);
      rock.layers.set(LAYER_ENV);
      this.scene.add(rock);
      extra.push(rock);

      // Soft rim trim around the plane edge.
      const rimMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(theme.gridLine).multiplyScalar(1.4), roughness: 0.5, metalness: 0.3, emissive: new THREE.Color(theme.gridLine), emissiveIntensity: 0.25 });
      const rim = new THREE.Mesh(new RoundedBoxGeometry(w + 0.5, 0.12, h + 0.5, 2, 0.05), rimMat);
      rim.position.set(0, -0.1, 0);
      rim.receiveShadow = true;
      rim.layers.set(LAYER_ENV);
      this.scene.add(rim);
      extra.push(rim);
    }

    // Cell tiles: one InstancedMesh, per-instance color = owner.
    const cellGeo = detailed ? new RoundedBoxGeometry(0.965, 0.22, 0.965, 2, 0.05) : new THREE.BoxGeometry(0.96, 0.22, 0.96);
    const cellMat = detailed
      ? new THREE.MeshPhysicalMaterial({ roughness: 0.5, metalness: 0.02, clearcoat: 0.55, clearcoatRoughness: 0.35 })
      : new THREE.MeshStandardMaterial({ roughness: 0.75, metalness: 0.08 });
    if (detailed) {
      this.tileGrain = this.tileGrain || grainTexture(7, 0.9, 1.0);
      cellMat.map = this.tileGrain;
    }
    const cells = new THREE.InstancedMesh(cellGeo, cellMat, n);
    cells.receiveShadow = true;
    cells.layers.set(LAYER_GAME);
    cells.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    const m = this.tmpMat.identity();
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        m.setPosition(x - w / 2 + 0.5, 0, y - h / 2 + 0.5);
        cells.setMatrixAt(y * w + x, m);
        cells.setColorAt(y * w + x, this.tmpColor.set(theme.empty));
      }
    }
    cells.instanceColor.setUsage(THREE.DynamicDrawUsage);
    this.scene.add(cells);
    this.cellMesh = cells;

    // Trail markers: instanced glowing slabs; detailed trails glow in their owner's colour.
    const trailGeo = detailed ? new RoundedBoxGeometry(0.7, 0.34, 0.7, 2, 0.1) : new THREE.BoxGeometry(0.7, 0.34, 0.7);
    const trailMat = new THREE.MeshStandardMaterial({ roughness: 0.4, metalness: 0.1, emissive: new THREE.Color(theme.trailGlow), emissiveIntensity: detailed ? 0.08 : 0.35 });
    if (detailed) {
      trailMat.onBeforeCompile = (sh) => {
        sh.fragmentShader = sh.fragmentShader.replace('#include <emissivemap_fragment>',
          '#include <emissivemap_fragment>\n totalEmissiveRadiance += diffuseColor.rgb * 0.7;');
      };
    }
    const trails = new THREE.InstancedMesh(trailGeo, trailMat, n);
    trails.layers.set(LAYER_GAME);
    trails.castShadow = true;
    trails.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    trails.count = 0;
    for (let i = 0; i < n; i++) trails.setColorAt(i, this.tmpColor.set('#ffffff'));
    trails.instanceColor.setUsage(THREE.DynamicDrawUsage);
    this.scene.add(trails);
    this.trailMesh = trails;

    // Player pawns: original procedural marker = stacked cone+ring (+ glowing beacon when detailed).
    this.pawns = [];
    this.pawnPrev = [];
    for (let i = 0; i < state.players.length; i++) {
      const group = new THREE.Group();
      const color = new THREE.Color(theme.players[i % theme.players.length]);
      const bodyMat = detailed
        ? new THREE.MeshPhysicalMaterial({ color: color, roughness: 0.25, metalness: 0.1, clearcoat: 1, clearcoatRoughness: 0.15, emissive: color, emissiveIntensity: 0.2 })
        : new THREE.MeshStandardMaterial({ color: color, roughness: 0.35, metalness: 0.25, emissive: color, emissiveIntensity: 0.25 });
      const body = new THREE.Mesh(new THREE.ConeGeometry(0.42, 0.9, detailed ? 32 : 20), bodyMat);
      body.position.y = 0.6;
      body.castShadow = true;
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(0.55, 0.07, 10, 28),
        new THREE.MeshBasicMaterial({ color: color })
      );
      ring.rotation.x = Math.PI / 2;
      ring.position.y = 0.12;
      group.add(body, ring);
      let beacon = null;
      if (detailed) {
        beacon = new THREE.Mesh(new THREE.SphereGeometry(0.17, 20, 14),
          new THREE.MeshStandardMaterial({ color: color, emissive: color, emissiveIntensity: 2.2, roughness: 0.3 }));
        beacon.position.y = 1.12;
        beacon.castShadow = true;
        beacon.layers.set(LAYER_GAME);
        group.add(beacon);
      }
      group.layers.set(LAYER_GAME);
      body.layers.set(LAYER_GAME);
      ring.layers.set(LAYER_FX);
      this.scene.add(group);
      this.pawns.push({ group: group, ring: ring, body: body, beacon: beacon, phase: i * 1.7 });
      this.pawnPrev.push({ x: state.players[i].x, y: state.players[i].y });
    }

    // Grid line overlay.
    const gridHelper = new THREE.GridHelper(Math.max(w, h), Math.max(w, h), new THREE.Color(theme.gridLine), new THREE.Color(theme.gridLine));
    gridHelper.position.y = 0.13;
    gridHelper.material.transparent = true;
    gridHelper.material.opacity = 0.25;
    gridHelper.layers.set(LAYER_ENV);
    gridHelper.visible = !detailed; // bevelled tiles already delineate cells
    this.scene.add(gridHelper);

    this.board = { base: base, gridHelper: gridHelper, extra: extra, width: w, height: h };
    this.ownerCache = null; // force full recolor of the fresh instances
    this.flashes.clear();
    this._fitShadow(w, h);
    this.fitCamera(w, h);
    this.lastStateDims = { w: w, h: h };
  }

  // Key light + shadow frustum fitted tightly around the play area.
  _fitShadow(w, h) {
    const half = Math.hypot(w, h) / 2 + 1.5;
    const k = this.keyLight;
    const dir = new THREE.Vector3(0.45, 1, 0.3).normalize();
    k.position.copy(dir).multiplyScalar(half * 2.5);
    k.target.position.set(0, 0, 0);
    const cam = k.shadow.camera;
    cam.left = -half; cam.right = half; cam.top = half; cam.bottom = -half;
    cam.near = half * 2.5 - half - 4; cam.far = half * 2.5 + half + 4;
    cam.updateProjectionMatrix();
  }

  disposeBoard() {
    if (!this.board) return;
    for (const obj of [this.board.base, this.board.gridHelper, this.cellMesh, this.trailMesh].concat(this.board.extra || [])) {
      if (!obj) continue;
      this.scene.remove(obj);
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) {
        if (obj.material.map && obj.material.map !== this.tileGrain) obj.material.map.dispose();
        if (obj.material.dispose) obj.material.dispose();
      }
    }
    for (const p of this.pawns) {
      this.scene.remove(p.group);
      p.group.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material && o.material.dispose) o.material.dispose(); });
    }
    for (const f of this.fxPool.concat(this.activeFx)) {
      this.scene.remove(f.mesh);
      f.mesh.geometry.dispose(); f.mesh.material.dispose();
    }
    this.pawns = []; this.fxPool = []; this.activeFx = [];
    this.cellMesh = null; this.trailMesh = null; this.board = null;
  }

  fitCamera(w, h) {
    const aspect = this.container.clientWidth / Math.max(1, this.container.clientHeight);
    const span = Math.max(w, h) * 0.62 + 3;
    let halfH = span;
    let halfW = span * aspect;
    // ensure both dimensions fit
    if (halfW < w * 0.62 + 3) { halfW = w * 0.62 + 3; halfH = halfW / aspect; }
    this.camera.left = -halfW; this.camera.right = halfW;
    this.camera.top = halfH; this.camera.bottom = -halfH;
    this.camera.updateProjectionMatrix();
  }

  resize() {
    if (!this.renderer) return;
    const cw = this.container.clientWidth, ch = this.container.clientHeight;
    if (cw === 0 || ch === 0) return;
    if (this.lastStateDims) this.fitCamera(this.lastStateDims.w, this.lastStateDims.h);
    this.size = [0, 0]; // render() re-applies size + pixel ratio
  }

  playerColor(i) {
    return new THREE.Color(this.theme.players[i % this.theme.players.length]);
  }

  // Update from an immutable snapshot. alpha = interpolation between ticks.
  update(snapshot, alpha) {
    if (!this.board || this.failed) return;
    const state = snapshot.state;
    const w = state.width, h = state.height;
    const cells = this.cellMesh, trails = this.trailMesh;
    const detailed = this.q.detail === 'detailed';
    const flashOn = this.q.particles === 'high';

    // Recolor owner cells (only when changed relative to cached array).
    const fresh = !this.ownerCache || this.ownerCache.length !== state.cells.length;
    if (fresh) this.ownerCache = new Int16Array(state.cells.length).fill(-2);
    let dirty = false, moved = false;
    for (let i = 0; i < state.cells.length; i++) {
      if (this.ownerCache[i] !== state.cells[i]) {
        const wasSet = this.ownerCache[i] !== -2;
        this.ownerCache[i] = state.cells[i];
        const owner = state.cells[i];
        if (owner === 0) cells.setColorAt(i, this.tmpColor.set(this.theme.empty));
        else cells.setColorAt(i, this.tmpColor.copy(this.playerColor(owner - 1)).multiplyScalar(0.85));
        if (detailed) {
          // Owned land sits a touch proud of the empty plane.
          this.tmpMat.makeTranslation((i % w) - w / 2 + 0.5, owner === 0 ? 0 : 0.05, ((i / w) | 0) - h / 2 + 0.5);
          cells.setMatrixAt(i, this.tmpMat);
          moved = true;
        }
        if (wasSet && owner > 0 && flashOn) this.flashes.set(i, 0);
        dirty = true;
      }
    }
    if (dirty) cells.instanceColor.needsUpdate = true;
    if (moved) cells.instanceMatrix.needsUpdate = true;

    // Rebuild trail instances.
    let tc = 0;
    const m = this.tmpMat.identity();
    for (let i = 0; i < state.trailOf.length; i++) {
      const t = state.trailOf[i];
      if (t === 0) continue;
      const x = i % w, y = (i / w) | 0;
      m.makeTranslation(x - w / 2 + 0.5, 0.22, y - h / 2 + 0.5);
      trails.setMatrixAt(tc, m);
      trails.setColorAt(tc, this.tmpColor.copy(this.playerColor(t - 1)));
      tc++;
    }
    trails.count = tc;
    trails.instanceMatrix.needsUpdate = true;
    if (trails.instanceColor) trails.instanceColor.needsUpdate = true;

    // Pawns with interpolation.
    for (let i = 0; i < state.players.length; i++) {
      const p = state.players[i];
      const pawn = this.pawns[i];
      if (!pawn) continue;
      pawn.group.visible = p.alive;
      if (!p.alive) continue;
      const prev = this.pawnPrev[i];
      const ix = prev.x + (p.x - prev.x) * alpha;
      const iy = prev.y + (p.y - prev.y) * alpha;
      pawn.group.position.set(ix - w / 2 + 0.5, detailed ? 0.05 : 0, iy - h / 2 + 0.5);
      // Danger cue: exposed trail = ring pulses red-tinted scale (timing only, no color-only signal).
      const exposed = p.trail.length > 0;
      const pulse = exposed && !this.reducedMotion ? 1 + Math.sin(performance.now() * 0.012) * 0.18 : 1;
      pawn.ring.scale.setScalar(exposed ? 1.35 * pulse : 1);
      pawn.ring.material.color.copy(this.playerColor(i));
      if (exposed) pawn.ring.material.color.lerp(this.white, 0.4);
      if (this.q.bloom === 'on') pawn.ring.material.color.multiplyScalar(1.25);
    }

    // Events → pooled FX + external audio handled by caller.
    for (const ev of snapshot.events || []) {
      if (ev.kind === 'claim') this.spawnClaimFx(state, ev);
    }

    // Advance FX.
    for (let i = this.activeFx.length - 1; i >= 0; i--) {
      const fx = this.activeFx[i];
      fx.age += 1 / 60;
      const t = fx.age / fx.life;
      if (t >= 1) {
        this.scene.remove(fx.mesh);
        fx.mesh.visible = false;
        this.fxPool.push(fx);
        this.activeFx.splice(i, 1);
        continue;
      }
      fx.mesh.scale.setScalar(0.5 + t * 4);
      fx.mesh.material.opacity = 0.6 * (1 - t);
    }

    this.lastSnapshot = snapshot;
  }

  endTick(state) {
    // Called once per simulation tick to store interpolation origins.
    for (let i = 0; i < state.players.length; i++) {
      if (this.pawnPrev[i]) { this.pawnPrev[i].x = state.players[i].x; this.pawnPrev[i].y = state.players[i].y; }
    }
  }

  spawnClaimFx(state, ev) {
    if (this.reducedMotion || !this.board) return;
    // Identify the claiming player from the event; fall back to the first
    // player with a fresh (empty) trail when the event carries no identity.
    let i = -1;
    if (ev) {
      if (typeof ev.playerIndex === 'number') i = ev.playerIndex;
      else if (typeof ev.playerId === 'string') i = state.players.findIndex((p) => p.id === ev.playerId);
    }
    if (i < 0 || i >= state.players.length) i = Math.max(0, state.players.findIndex((p) => p.trail.length === 0));
    const p = state.players[i];
    let fx = this.fxPool.pop();
    if (!fx) {
      const mesh = new THREE.Mesh(
        new THREE.RingGeometry(0.4, 0.55, 32),
        new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.6, side: THREE.DoubleSide })
      );
      mesh.rotation.x = -Math.PI / 2;
      mesh.layers.set(LAYER_FX);
      mesh.raycast = () => {};
      fx = { mesh: mesh };
    }
    fx.mesh.material.color.copy(this.playerColor(i));
    fx.mesh.visible = true;
    fx.mesh.position.set(p.x - state.width / 2 + 0.5, 0.16, p.y - state.height / 2 + 0.5);
    fx.age = 0; fx.life = 0.7;
    this.scene.add(fx.mesh);
    this.activeFx.push(fx);
  }

  // Raycast to board cell from NDC pointer coords.
  pickCell(ndcX, ndcY) {
    if (!this.board) return null;
    this.pointer.set(ndcX, ndcY);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const pt = new THREE.Vector3();
    if (!this.raycaster.ray.intersectPlane(this.pickPlane, pt)) return null;
    const w = this.board.width, h = this.board.height;
    const x = Math.floor(pt.x + w / 2), y = Math.floor(pt.z + h / 2);
    if (x < 0 || y < 0 || x >= w || y >= h) return null;
    return { x: x, y: y };
  }

  // ---------------------------------------------------------------- per-frame

  // Ambient, time-based polish: pawn bob, claim flashes + sparks, motes, title sway.
  _animate(dt) {
    const moving = !this.reducedMotion;
    if (moving) this.clock += dt;
    const t = this.clock;
    for (const pawn of this.pawns) {
      const bob = moving ? Math.sin(t * 2.4 + pawn.phase) * 0.05 : 0;
      pawn.body.position.y = 0.6 + bob;
      if (pawn.beacon) pawn.beacon.position.y = 1.12 + bob * 1.6;
    }
    if (this.flashes.size && this.cellMesh && this.lastBuild) {
      const w = this.board.width, h = this.board.height;
      const life = moving ? 0.6 : 0.25;
      let n = 0;
      for (const [i, age] of this.flashes) {
        const a = age + dt;
        const owner = this.ownerCache ? this.ownerCache[i] : 0;
        if (owner <= 0) { this.flashes.delete(i); continue; }
        const base = this.tmpColor.copy(this.playerColor(owner - 1)).multiplyScalar(0.85);
        if (a >= life) {
          this.flashes.delete(i);
        } else {
          const k = 1 - a / life;
          base.lerp(this.white, 0.7 * k).multiplyScalar(1 + 0.6 * k);
          if (age === 0 && moving && n < 60) {
            this._emitSparks((i % w) - w / 2 + 0.5, ((i / w) | 0) - h / 2 + 0.5, this.playerColor(owner - 1), 3);
            n++;
          }
          this.flashes.set(i, a);
        }
        this.cellMesh.setColorAt(i, base);
      }
      this.cellMesh.instanceColor.needsUpdate = true;
    }
    this._updateSparks(dt);
    if (this.motes.visible && moving) this._updateMotes(t);
    if (this.attract && this.q.background === 'animated' && moving) {
      const a = Math.sin(t * 0.12) * 0.22;
      const r = Math.hypot(CAM_POS.x, CAM_POS.z);
      this.camera.position.set(Math.sin(a) * r, CAM_POS.y, Math.cos(a) * r);
      this.camera.lookAt(0, 0, 0);
    }
  }

  _postKey(w, h) {
    const g = this.q;
    return g.post ? [g.ao, g.bloom, g.grade, g.antialias, w, h, this.pixelRatio].join('|') : 'none';
  }

  _buildPost(w, h) {
    const g = this.q;
    if (this.composer) { this.composer.dispose(); this.composer = null; }
    if (!g.post) return;
    try {
      const pw = Math.max(1, Math.round(w * this.pixelRatio)), ph = Math.max(1, Math.round(h * this.pixelRatio));
      const target = new THREE.WebGLRenderTarget(pw, ph, { type: THREE.HalfFloatType, samples: g.antialias === 'msaa' ? 4 : 0 });
      const composer = new EffectComposer(this.renderer, target);
      composer.setPixelRatio(this.pixelRatio);
      composer.setSize(w, h);
      composer.addPass(new RenderPass(this.scene, this.camera));
      if (g.ao !== 'off') {
        const ao = new GTAOPass(this.scene, this.camera, pw, ph);
        ao.output = GTAOPass.OUTPUT.Default;
        ao.blendIntensity = 0.7;
        ao.updateGtaoMaterial({ radius: 0.6, distanceExponent: 1.4, thickness: 1.0, scale: 1.0, samples: g.ao === 'high' ? 16 : 8 });
        ao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: g.ao === 'high' ? 6 : 4, rings: 2, samples: g.ao === 'high' ? 16 : 8 });
        composer.addPass(ao);
      }
      if (g.bloom === 'on') {
        // High threshold: only beacons, glowing trails and sparks bloom.
        composer.addPass(new UnrealBloomPass(new THREE.Vector2(w, h), 0.5, 0.4, 0.88));
      }
      if (g.grade === 'on') composer.addPass(new ShaderPass(GradeShader));
      composer.addPass(new OutputPass());
      if (g.antialias === 'smaa') composer.addPass(new SMAAPass());
      if (g.antialias === 'fxaa') {
        const fxaa = new ShaderPass(FXAAShader);
        fxaa.material.uniforms.resolution.value.set(1 / pw, 1 / ph);
        composer.addPass(fxaa);
      }
      this.composer = composer;
      this.postFailed = false;
    } catch (e) {
      // Post-processing is an enhancement: render directly if the chain cannot be built.
      this.postFailed = true;
      this.composer = null;
    }
  }

  // Adaptive resolution: step the render scale down when frames are slow, back up when fast.
  _adapt(dt) {
    const f = this._frames;
    f.push(dt);
    if (f.length < 90) return false;
    const avg = f.reduce((a, b) => a + b, 0) / f.length;
    f.length = 0;
    this.fps = 1000 / avg;
    const el = document.getElementById('fps-meter');
    if (el && !el.hidden) el.textContent = Math.round(this.fps) + ' fps · ' + (Math.round(this.pixelRatio * 100) / 100) + '×';
    if (!this.q.adaptive) return false;
    const before = this.adaptiveScale;
    if (avg > 26) this.adaptiveScale = Math.max(0.6, this.adaptiveScale - 0.1);
    else if (avg < 14 && this.adaptiveScale < 1) this.adaptiveScale = Math.min(1, this.adaptiveScale + 0.05);
    return before !== this.adaptiveScale;
  }

  render() {
    if (this.failed || this.contextLost) return;
    const now = performance.now();
    const dt = this._last ? Math.min(250, now - this._last) : 16;
    this._last = now;
    const rescale = this._adapt(dt);
    this._animate(Math.min(0.1, dt / 1000));
    const w = this.container.clientWidth, h = this.container.clientHeight;
    if (w === 0 || h === 0) return;
    const ratio = Math.min(window.devicePixelRatio || 1, this.q.dprCap) * this.q.scale * this.adaptiveScale;
    if (w !== this.size[0] || h !== this.size[1] || ratio !== this.pixelRatio || rescale) {
      this.size = [w, h];
      this.pixelRatio = ratio;
      this.renderer.setPixelRatio(ratio);
      this.renderer.setSize(w, h, false);
    }
    const key = this._postKey(w, h);
    if (key !== this.postKey) {
      this.postKey = key;
      this._buildPost(w, h);
    }
    if (this.composer) {
      try { this.composer.render(dt / 1000); }
      catch (e) { this.postFailed = true; this.composer = null; this.renderer.render(this.scene, this.camera); }
    } else {
      this.renderer.render(this.scene, this.camera);
    }
    this.frameCount++;
  }
}
