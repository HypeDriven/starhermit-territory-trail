'use strict';

// Render: Three.js scene for the floating territory plane.
// Layers: 0 environment, 1 gameplay cells, 2 selection/ghost, 3 effects.
// Rendering consumes immutable snapshots; it never mutates rules state.
import * as THREE from 'three';

const LAYER_ENV = 0, LAYER_GAME = 1, LAYER_FX = 3;

export class Renderer {
  constructor(container) {
    this.container = container;
    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 200);
    this.camera.position.set(0, 42, 26);
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
    container.appendChild(this.renderer.domElement);
    this.renderer.domElement.setAttribute('aria-hidden', 'true');

    // PBR lighting: one dominant key, soft fill, grounding ambient.
    const key = new THREE.DirectionalLight(0xffffff, 2.2);
    key.position.set(18, 30, 12);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    this.keyLight = key;
    const fill = new THREE.HemisphereLight(0xbdd3ff, 0x1a2233, 0.9);
    this.scene.add(key, fill);

    // Quality tier state.
    this.quality = 'high';
    this.reducedMotion = false;

    // Board resources, rebuilt per round.
    this.board = null;
    this.cellMesh = null;
    this.trailMesh = null;
    this.pawns = [];
    this.fxPool = [];
    this.activeFx = [];
    this.theme = null;
    this.tmpColor = new THREE.Color();
    this.pawnPrev = [];
    this.frameCount = 0;
    this.lastSnapshot = null;
    this.onCellPick = null; // (x,y) => void

    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.pickPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

    this.renderer.domElement.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      this.contextLost = true;
    });
    this.renderer.domElement.addEventListener('webglcontextrestored', () => {
      this.contextLost = false;
      if (this.lastSnapshot) this.buildBoard(this.lastSnapshot.state, this.theme);
    });
  }

  setQuality(q, reducedMotion) {
    this.quality = q;
    this.reducedMotion = !!reducedMotion;
    const dpr = window.devicePixelRatio || 1;
    const cap = q === 'low' ? 1 : q === 'medium' ? 1.5 : 2;
    this.renderer.setPixelRatio(Math.min(dpr, cap));
    this.keyLight.castShadow = q !== 'low';
    this.resize();
  }

  buildBoard(state, theme) {
    this.theme = theme;
    this.disposeBoard();
    this.scene.background = new THREE.Color(theme.background);
    this.scene.fog = new THREE.Fog(theme.background, 60, 140);

    const w = state.width, h = state.height;
    const n = w * h;

    // Floating island base under the grid.
    const baseGeo = new THREE.BoxGeometry(w + 2.4, 1.2, h + 2.4);
    const baseMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(theme.grid), roughness: 0.9, metalness: 0.05 });
    const base = new THREE.Mesh(baseGeo, baseMat);
    base.position.set(0, -0.75, 0);
    base.receiveShadow = true;
    base.layers.set(LAYER_ENV);
    this.scene.add(base);

    // Cell tiles: one InstancedMesh, per-instance color = owner.
    const cellGeo = new THREE.BoxGeometry(0.96, 0.22, 0.96);
    const cellMat = new THREE.MeshStandardMaterial({ roughness: 0.75, metalness: 0.08 });
    const cells = new THREE.InstancedMesh(cellGeo, cellMat, n);
    cells.receiveShadow = true;
    cells.layers.set(LAYER_GAME);
    cells.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    const m = new THREE.Matrix4();
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

    // Trail markers: instanced thin glowing slabs.
    const trailGeo = new THREE.BoxGeometry(0.7, 0.34, 0.7);
    const trailMat = new THREE.MeshStandardMaterial({ roughness: 0.4, metalness: 0.1, emissive: new THREE.Color(theme.trailGlow), emissiveIntensity: 0.35 });
    const trails = new THREE.InstancedMesh(trailGeo, trailMat, n);
    trails.layers.set(LAYER_GAME);
    trails.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    trails.count = 0;
    for (let i = 0; i < n; i++) trails.setColorAt(i, this.tmpColor.set('#ffffff'));
    trails.instanceColor.setUsage(THREE.DynamicDrawUsage);
    this.scene.add(trails);
    this.trailMesh = trails;

    // Player pawns: original procedural marker = stacked cone+ring.
    this.pawns = [];
    this.pawnPrev = [];
    for (let i = 0; i < state.players.length; i++) {
      const group = new THREE.Group();
      const color = new THREE.Color(theme.players[i % theme.players.length]);
      const bodyMat = new THREE.MeshStandardMaterial({ color: color, roughness: 0.35, metalness: 0.25, emissive: color, emissiveIntensity: 0.25 });
      const body = new THREE.Mesh(new THREE.ConeGeometry(0.42, 0.9, 20), bodyMat);
      body.position.y = 0.6;
      body.castShadow = true;
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(0.55, 0.07, 10, 28),
        new THREE.MeshBasicMaterial({ color: color })
      );
      ring.rotation.x = Math.PI / 2;
      ring.position.y = 0.12;
      group.add(body, ring);
      group.layers.set(LAYER_GAME);
      body.layers.set(LAYER_GAME);
      ring.layers.set(LAYER_FX);
      this.scene.add(group);
      this.pawns.push({ group: group, ring: ring });
      this.pawnPrev.push({ x: state.players[i].x, y: state.players[i].y });
    }

    // Grid line overlay.
    const gridHelper = new THREE.GridHelper(Math.max(w, h), Math.max(w, h), new THREE.Color(theme.gridLine), new THREE.Color(theme.gridLine));
    gridHelper.position.y = 0.13;
    gridHelper.material.transparent = true;
    gridHelper.material.opacity = 0.25;
    gridHelper.layers.set(LAYER_ENV);
    this.scene.add(gridHelper);

    this.board = { base: base, gridHelper: gridHelper, width: w, height: h };
    this.fitCamera(w, h);
    this.lastStateDims = { w: w, h: h };
  }

  disposeBoard() {
    if (!this.board) return;
    for (const obj of [this.board.base, this.board.gridHelper, this.cellMesh, this.trailMesh]) {
      if (!obj) continue;
      this.scene.remove(obj);
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) { if (obj.material.dispose) obj.material.dispose(); }
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
    this.renderer.setSize(cw, ch);
    if (this.lastStateDims) this.fitCamera(this.lastStateDims.w, this.lastStateDims.h);
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

    // Recolor owner cells (only when changed relative to cached array).
    if (!this.ownerCache || this.ownerCache.length !== state.cells.length) {
      this.ownerCache = new Int16Array(state.cells.length).fill(-2);
    }
    let dirty = false;
    for (let i = 0; i < state.cells.length; i++) {
      if (this.ownerCache[i] !== state.cells[i]) {
        this.ownerCache[i] = state.cells[i];
        const owner = state.cells[i];
        if (owner === 0) cells.setColorAt(i, this.tmpColor.set(this.theme.empty));
        else cells.setColorAt(i, this.tmpColor.copy(this.playerColor(owner - 1)).multiplyScalar(0.85));
        dirty = true;
      }
    }
    if (dirty) cells.instanceColor.needsUpdate = true;

    // Rebuild trail instances.
    let tc = 0;
    const m = new THREE.Matrix4();
    for (let i = 0; i < state.trailOf.length; i++) {
      const t = state.trailOf[i];
      if (t === 0) continue;
      const x = i % w, y = (i / w) | 0;
      m.setPosition(x - w / 2 + 0.5, 0.22, y - h / 2 + 0.5);
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
      pawn.group.position.set(ix - w / 2 + 0.5, 0, iy - h / 2 + 0.5);
      // Danger cue: exposed trail = ring pulses red-tinted scale (timing only, no color-only signal).
      const exposed = p.trail.length > 0;
      const pulse = exposed && !this.reducedMotion ? 1 + Math.sin(performance.now() * 0.012) * 0.18 : 1;
      pawn.ring.scale.setScalar(exposed ? 1.35 * pulse : 1);
      pawn.ring.material.color.copy(this.playerColor(i));
      if (exposed) pawn.ring.material.color.lerp(new THREE.Color('#ffffff'), 0.4);
    }

    // Events → pooled FX + external audio handled by caller.
    for (const ev of snapshot.events || []) {
      if (ev.kind === 'claim' && !this.reducedMotion) this.spawnClaimFx(state);
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

  spawnClaimFx(state) {
    const li = state.players.findIndex((p) => p.trail.length === 0);
    const i = Math.max(0, li);
    const p = state.players[i];
    let fx = this.fxPool.pop();
    if (!fx) {
      const mesh = new THREE.Mesh(
        new THREE.RingGeometry(0.4, 0.55, 32),
        new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.6, side: THREE.DoubleSide })
      );
      mesh.rotation.x = -Math.PI / 2;
      mesh.layers.set(LAYER_FX);
      fx = { mesh: mesh };
    }
    fx.mesh.material.color.copy(this.playerColor(i));
    fx.mesh.visible = true;
    fx.mesh.position.set(p.x - state.width / 2 + 0.5, 0.16, p.y - state.height / 2 + 0.5);
    fx.age = 0; fx.life = this.reducedMotion ? 0.01 : 0.7;
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

  render() {
    if (this.failed || this.contextLost) return;
    this.renderer.render(this.scene, this.camera);
    this.frameCount++;
  }
}
