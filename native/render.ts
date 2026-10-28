// The floating territory plane on starhermit:scene, as the browser build's
// js/render.js drew it with three.js r182: the island slab (a rounded,
// grain-textured slab with a rim trim and a jittered rocky underside when
// detailed; a plain box otherwise), one instanced tile per cell coloured by
// its owner (owned land a touch proud when detailed; claimed cells flash and
// throw sparks), the trails as instanced slabs glowing in their owner's
// colour, the pawns (cone, ring that grows and pulses white while the trail
// is exposed, a glowing beacon when detailed; they bob), the grid lines (plain
// tiles only), the claim ring FX, drifting motes, the radial backdrop and
// the fog. The title shows a rival-only board behind the menu with a slow
// camera sway. Graphics follow the runtime's quality tier (native/quality.ts:
// gfx.js's presets and budgets); the colour-vision palette swaps the player
// colours as main.js effectiveTheme did.
//
// Engine minor 23 is three.js r185's light units and shadows, so r182's
// physically based intensities (key 2.2, hemisphere fill 0.9) and the key
// light's shadow (its camera box fitted to the board, bias -0.0004, normal
// bias 0.02, PCF) are the page's own values. Reflections are set up as the
// page did: the RoomEnvironment (r163+: the renderer-lit room, so
// `new RoomEnvironment(renderer)` here) prefiltered with sigma 0.04 as
// scene.environment at environmentIntensity 0.32, detailed tiers only. The
// composer (half floats → GTAO → bloom at threshold 0.88 → the colour grade
// and vignette before OutputPass, i.e. in linear light → FXAA / SMAA, or the
// canvas MSAA on Low) is the runtime's renderer.ao / bloom / grade /
// antialias. The trail material's onBeforeCompile (emissive += base colour ×
// 0.7) is a surface hook. The grain textures are baked PNGs
// (tools/bake-grain.mjs). The old canvas sat between the status bar and the
// rails: the orthographic camera's view offset frames the board in that
// rectangle of the window.
import {
  ACESFilmicToneMapping, AdditiveBlending, BoxGeometry, BufferAttribute, BufferGeometry, CanvasTexture, Color, ConeGeometry,
  CylinderGeometry, DirectionalLight, DoubleSide, DynamicDrawUsage, Fog, Group, HemisphereLight, InstancedMesh, LineBasicMaterial,
  LineSegments, Matrix4, Mesh, MeshBasicMaterial, MeshLambertMaterial, MeshPhysicalMaterial, MeshStandardMaterial, OrthographicCamera,
  PCFShadowMap, PMREMGenerator, Plane, Points, PointsMaterial, Raycaster, RepeatWrapping, RingGeometry, RoomEnvironment,
  RoundedBoxGeometry, SphereGeometry, SRGBColorSpace, TextureLoader, TorusGeometry, Vector2, Vector3, pointerToNdc, renderer, scene,
  type Material, type Texture,
} from "starhermit:scene";
import { OffscreenCanvas } from "starhermit:canvas";
import type { State, Theme } from "./game.ts";
import { MOTE_MAX, type Look } from "./quality.ts";

export interface Rect { x: number; y: number; width: number; height: number }
const MAX_SPARKS = 900;
const CAM_POS = new Vector3(0, 42, 26);
const hex = (c: Color): string => "#" + c.getHex().toString(16).padStart(6, "0");

// ---------------------------------------------------------------- materials and textures
type Kind = Look["budget"]["material"];
interface LitParams {
  color?: Color; roughness?: number; metalness?: number; clearcoat?: number; clearcoatRoughness?: number;
  emissive?: Color; emissiveIntensity?: number; flatShading?: boolean; map?: Texture | null;
}
/** render.js litMaterial: Lambert / Standard / Physical per budget; parameters a class doesn't have are dropped. */
function lit(kind: Kind, p: LitParams): Material {
  // colours are cloned: the engine's material keeps the Color object it is given (three.js copies it)
  const common = {
    ...(p.color ? { color: p.color.clone() } : {}), ...(p.emissive ? { emissive: p.emissive.clone() } : {}),
    ...(p.emissiveIntensity != null ? { emissiveIntensity: p.emissiveIntensity } : {}), ...(p.flatShading ? { flatShading: true } : {}),
    ...(p.map ? { map: p.map } : {}),
  };
  if (kind === "lambert") return new MeshLambertMaterial(common);
  const pbr = { ...common, ...(p.roughness != null ? { roughness: p.roughness } : {}), ...(p.metalness != null ? { metalness: p.metalness } : {}) };
  if (kind === "standard") return new MeshStandardMaterial(pbr);
  return new MeshPhysicalMaterial({ ...pbr, ...(p.clearcoat != null ? { clearcoat: p.clearcoat } : {}), ...(p.clearcoatRoughness != null ? { clearcoatRoughness: p.clearcoatRoughness } : {}) });
}
const loader = new TextureLoader();
function grain(seed: 94 | 7, size: number): Texture {
  const t = loader.load(`assets/grain-${seed}-${size}.png`);
  t.colorSpace = SRGBColorSpace;
  t.wrapS = t.wrapT = RepeatWrapping;
  return t;
}
function backdropTexture(base: string): Texture {
  const c = new OffscreenCanvas(256, 256);
  const g = c.getContext("2d")!;
  const b = new Color(base);
  const liftC = b.clone().lerp(new Color("#3b5b8a"), 0.28);
  const grad = g.createRadialGradient(128, 110, 10, 128, 128, 190);
  grad.addColorStop(0, hex(liftC));
  grad.addColorStop(1, hex(b));
  g.fillStyle = grad;
  g.fillRect(0, 0, 256, 256);
  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  return tex;
}
function dotTexture(): Texture {
  const c = new OffscreenCanvas(32, 32);
  const g = c.getContext("2d")!;
  const grad = g.createRadialGradient(16, 16, 0, 16, 16, 16);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(0.4, "rgba(255,255,255,0.6)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 32, 32);
  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  return tex;
}
/** The trail material's onBeforeCompile: totalEmissiveRadiance += diffuseColor.rgb * 0.7. */
const TRAIL_GLOW = /* wgsl */ `
fn surface(s: Surface) -> Surface {
  var o = s;
  o.emissive = s.emissive + s.base_color.rgb * 0.7;
  return o;
}`;

// ---------------------------------------------------------------- the scene
const camera = new OrthographicCamera(-1, 1, 1, -1, 0.1, 200);
camera.position.copy(CAM_POS);
camera.lookAt(0, 0, 0);
renderer.toneMapping = ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.type = PCFShadowMap;
const key = new DirectionalLight(0xfff4e6, 2.2);
key.position.set(18, 30, 12);
key.shadow.bias = -0.0004;
key.shadow.normalBias = 0.02;
scene.add(key.target);
const fill = new HemisphereLight(0xbdd3ff, 0x1a2233, 0.9);
scene.add(key, fill);

let look: Look | null = null;
let theme: Theme | null = null;
let reduced = false;
let attract = false;
let clock = 0;
let envTex: Texture | null = null;
let bgTex: Texture | null = null;
const tmpColor = new Color();
const tmpMat = new Matrix4();
const white = new Color("#ffffff");
const raycaster = new Raycaster();
const ndc = new Vector2();
const pickPlane = new Plane(new Vector3(0, 1, 0), 0);

interface Pawn { group: Group; ring: Mesh; body: Mesh; beacon: Mesh | null; phase: number }
interface Fx { mesh: Mesh; age: number; life: number }
interface Board {
  objects: { geometry?: { dispose(): void }; material?: Material | Material[] }[]; width: number; height: number;
  cells: InstancedMesh; trails: InstancedMesh; pawns: Pawn[]; colors: Color[]; cellColors: Color[];
}
let board: Board | null = null;
let lastBuild: { state: State; theme: Theme } | null = null;
let ownerCache: Int16Array | null = null;
let lastTick = -1;
const pawnPrev: { x: number; y: number }[] = [];
const flashes = new Map<number, number>();
let fxPool: Fx[] = [];
let activeFx: Fx[] = [];
let grainIsland: Texture | null = null, grainTile: Texture | null = null, grainSize = 0;

// claim sparks: one pooled Points buffer, additive
const dot = dotTexture();
const sparkPos = new Float32Array(MAX_SPARKS * 3), sparkCol = new Float32Array(MAX_SPARKS * 3), sparkVel = new Float32Array(MAX_SPARKS * 3);
const sparkLife = new Float32Array(MAX_SPARKS), sparkBase = new Float32Array(MAX_SPARKS * 3);
const sparkGeo = new BufferGeometry();
sparkGeo.setAttribute("position", new BufferAttribute(sparkPos, 3).setUsage(DynamicDrawUsage));
sparkGeo.setAttribute("color", new BufferAttribute(sparkCol, 3).setUsage(DynamicDrawUsage));
// three.js never attenuates points under an orthographic camera: sizeAttenuation off keeps their pixel size
const sparks = new Points(sparkGeo, new PointsMaterial({ size: 7, sizeAttenuation: false, map: dot, vertexColors: true, transparent: true, blending: AdditiveBlending, depthWrite: false }));
sparks.frustumCulled = false;
scene.add(sparks);
let sparkNext = 0, sparkActive = 0;
// ambient motes drifting around the island (pool for the largest budget; the budget sets the draw range)
const motePos = new Float32Array(MOTE_MAX * 3), moteSeed = new Float32Array(MOTE_MAX * 4);
{
  let s = 1234567;
  const rnd = (): number => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  for (let i = 0; i < MOTE_MAX; i++) {
    moteSeed[i * 4] = (rnd() - 0.5) * 70;
    moteSeed[i * 4 + 1] = rnd() * 30 - 14;
    moteSeed[i * 4 + 2] = (rnd() - 0.5) * 60;
    moteSeed[i * 4 + 3] = rnd() * Math.PI * 2;
  }
}
const moteGeo = new BufferGeometry();
moteGeo.setAttribute("position", new BufferAttribute(motePos, 3).setUsage(DynamicDrawUsage));
const moteMat = new PointsMaterial({ size: 5, sizeAttenuation: false, map: dot, color: 0xcfe3ff, transparent: true, opacity: 0.35, blending: AdditiveBlending, depthWrite: false });
const motes = new Points(moteGeo, moteMat);
motes.frustumCulled = false;
motes.visible = false;
scene.add(motes);
let moteCount = 0;
function updateMotes(t: number): void {
  for (let i = 0; i < moteCount; i++) {
    const ph = moteSeed[i * 4 + 3]!;
    motePos[i * 3] = moteSeed[i * 4]! + Math.sin(t * 0.21 + ph) * 1.6;
    motePos[i * 3 + 1] = ((moteSeed[i * 4 + 1]! + t * 0.35 + 14) % 30) - 14;
    motePos[i * 3 + 2] = moteSeed[i * 4 + 2]! + Math.cos(t * 0.17 + ph) * 1.6;
  }
  moteGeo.attributes.position!.needsUpdate = true;
}
updateMotes(0);
function emitSparks(x: number, z: number, color: Color, n: number): void {
  for (let k = 0; k < n; k++) {
    const i = sparkNext;
    sparkNext = (sparkNext + 1) % MAX_SPARKS;
    sparkPos[i * 3] = x + (Math.random() - 0.5) * 0.8;
    sparkPos[i * 3 + 1] = 0.25;
    sparkPos[i * 3 + 2] = z + (Math.random() - 0.5) * 0.8;
    const a = Math.random() * Math.PI * 2, sp = 0.6 + Math.random() * 1.6;
    sparkVel[i * 3] = Math.cos(a) * sp * 0.6;
    sparkVel[i * 3 + 1] = 2.5 + Math.random() * 3;
    sparkVel[i * 3 + 2] = Math.sin(a) * sp * 0.6;
    sparkLife[i] = 0.7 + Math.random() * 0.5;
    const c = tmpColor.copy(color).lerp(white, 0.35);
    sparkBase[i * 3] = c.r * 1.6; sparkBase[i * 3 + 1] = c.g * 1.6; sparkBase[i * 3 + 2] = c.b * 1.6;
  }
  sparkActive = MAX_SPARKS;
}
function updateSparks(dt: number): void {
  if (!sparkActive) return;
  let alive = 0;
  for (let i = 0; i < MAX_SPARKS; i++) {
    if (sparkLife[i]! <= 0) { sparkCol[i * 3] = sparkCol[i * 3 + 1] = sparkCol[i * 3 + 2] = 0; continue; }
    alive++;
    sparkLife[i] = sparkLife[i]! - dt;
    sparkVel[i * 3 + 1] = sparkVel[i * 3 + 1]! - 6 * dt;
    sparkPos[i * 3] = sparkPos[i * 3]! + sparkVel[i * 3]! * dt;
    sparkPos[i * 3 + 1] = Math.max(0.15, sparkPos[i * 3 + 1]! + sparkVel[i * 3 + 1]! * dt);
    sparkPos[i * 3 + 2] = sparkPos[i * 3 + 2]! + sparkVel[i * 3 + 2]! * dt;
    const f = Math.max(0, Math.min(1, sparkLife[i]! / 0.6));
    sparkCol[i * 3] = sparkBase[i * 3]! * f;
    sparkCol[i * 3 + 1] = sparkBase[i * 3 + 1]! * f;
    sparkCol[i * 3 + 2] = sparkBase[i * 3 + 2]! * f;
  }
  sparkGeo.attributes.position!.needsUpdate = true;
  sparkGeo.attributes.color!.needsUpdate = true;
  if (!alive) sparkActive = 0;
}

// ---------------------------------------------------------------- environment and background
function applyEnvironment(): void {
  const detailed = !!look?.detailed;
  if (detailed && !envTex) {
    try { envTex = new PMREMGenerator(renderer).fromScene(new RoomEnvironment(renderer), 0.04).texture; }
    catch (e) { console.warn(`environment: ${String(e)}`); envTex = null; }
  }
  scene.environment = detailed ? envTex : null;
  scene.environmentIntensity = 0.32;
  applyBackground();
}
function applyBackground(): void {
  if (!theme) return;
  if (bgTex) { bgTex.dispose(); bgTex = null; }
  if (look?.detailed) { bgTex = backdropTexture(theme.background); scene.background = bgTex; }
  else scene.background = new Color(theme.background);
}

// ---------------------------------------------------------------- the board
function disposeBoard(): void {
  if (!board) return;
  for (const o of board.objects) {
    scene.remove(o as unknown as Mesh);
    o.geometry?.dispose();
    const m = o.material;
    if (Array.isArray(m)) m.forEach((x) => x.dispose()); else m?.dispose();
  }
  for (const p of board.pawns) {
    scene.remove(p.group);
    p.group.traverse((o) => { const m = o as Mesh; if (m.geometry) m.geometry.dispose(); if (m.material) (m.material as Material).dispose(); });
  }
  for (const f of fxPool.concat(activeFx)) { scene.remove(f.mesh); f.mesh.geometry.dispose(); (f.mesh.material as Material).dispose(); }
  fxPool = []; activeFx = [];
  board = null;
}
/** A grid line overlay (three.js GridHelper: size × size, `divisions` cells, centred). */
function gridLines(size: number, divisions: number, color: Color): LineSegments {
  const half = size / 2, step = size / divisions;
  const pos: number[] = [];
  for (let i = 0; i <= divisions; i++) {
    const k = -half + i * step;
    pos.push(-half, 0, k, half, 0, k, k, 0, -half, k, 0, half);
  }
  const g = new BufferGeometry();
  g.setAttribute("position", new BufferAttribute(new Float32Array(pos), 3));
  return new LineSegments(g, new LineBasicMaterial({ color, transparent: true, opacity: 0.25 }));
}

export function buildBoard(state: State, th: Theme): void {
  theme = th;
  lastBuild = { state, theme: th };
  setAttract(false);
  disposeBoard();
  applyBackground();
  scene.fog = new Fog(th.background, 60, 140);
  const L = look!;
  const detailed = L.detailed;
  const B = L.budget, mat = (p: LitParams): Material => lit(B.material, p);
  moteMat.color.set(th.trailGlow);
  if (detailed && grainSize !== B.texture) {
    grainIsland?.dispose(); grainTile?.dispose();
    grainIsland = grain(94, B.texture); grainTile = grain(7, B.texture); grainSize = B.texture;
  }
  const w = state.width, h = state.height, n = w * h;
  const objects: Board["objects"] = [];
  const add = <T extends Mesh | LineSegments | InstancedMesh>(o: T): T => { scene.add(o); objects.push(o as unknown as Board["objects"][number]); return o; };

  // floating island base under the grid
  const baseGeo = detailed ? new RoundedBoxGeometry(w + 2.4, 1.2, h + 2.4, B.bevel + 1, 0.35) : new BoxGeometry(w + 2.4, 1.2, h + 2.4);
  const baseColor = new Color(th.grid);
  let baseMap: Texture | null = null;
  if (detailed && grainIsland) {
    baseMap = grain(94, B.texture);
    baseMap.repeat.set((w + 2.4) / 6, (h + 2.4) / 6);
    baseColor.multiplyScalar(1.25);
  }
  const base = add(new Mesh(baseGeo, mat({ color: baseColor, roughness: 0.9, metalness: 0.05, map: baseMap })));
  base.position.set(0, -0.75, 0);
  base.receiveShadow = true;

  if (detailed) {
    // rocky underside: an inverted, jittered pyramid that makes the plane float
    const depth = Math.max(w, h) * 0.42;
    const rockGeo = new CylinderGeometry(Math.SQRT2, 0.12, 1, 4, 5, false, Math.PI / 4);
    const pos = rockGeo.attributes.position!;
    let s = 9403;
    const rnd = (): number => { s = (s * 16807) % 2147483647; return s / 2147483647; };
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i);
      if (y < 0.49 && y > -0.49) {
        pos.setX(i, pos.getX(i) * (0.85 + rnd() * 0.3));
        pos.setZ(i, pos.getZ(i) * (0.85 + rnd() * 0.3));
      }
    }
    pos.needsUpdate = true;
    rockGeo.computeVertexNormals();
    const rockCol = new Color(th.grid).lerp(new Color(th.background), 0.35);
    const rock = add(new Mesh(rockGeo, mat({ color: rockCol, roughness: 1, metalness: 0, flatShading: true })));
    rock.scale.set((w + 2.2) / 2, depth, (h + 2.2) / 2);
    rock.position.set(0, -1.3 - depth / 2, 0);
    // soft rim trim around the plane edge
    const rim = add(new Mesh(new RoundedBoxGeometry(w + 0.5, 0.12, h + 0.5, B.bevel, 0.05),
      mat({ color: new Color(th.gridLine).multiplyScalar(1.4), roughness: 0.5, metalness: 0.3, emissive: new Color(th.gridLine), emissiveIntensity: 0.25 })));
    rim.position.set(0, -0.1, 0);
    rim.receiveShadow = true;
  }

  // cell tiles: one InstancedMesh, per-instance colour = owner
  const cellGeo = detailed ? new RoundedBoxGeometry(0.965, 0.22, 0.965, B.bevel, 0.05) : new BoxGeometry(0.96, 0.22, 0.96);
  const cellMat = detailed ? mat({ roughness: 0.5, metalness: 0.02, clearcoat: 0.55, clearcoatRoughness: 0.35, map: grainTile }) : mat({ roughness: 0.75, metalness: 0.08 });
  const cells = add(new InstancedMesh(cellGeo, cellMat, n));
  cells.receiveShadow = true;
  const empty = new Color(th.empty);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      tmpMat.makeTranslation(x - w / 2 + 0.5, 0, y - h / 2 + 0.5);
      cells.setMatrixAt(y * w + x, tmpMat);
      cells.setColorAt(y * w + x, empty);
    }
  }

  // trail markers: instanced glowing slabs; detailed trails glow in their owner's colour
  const trailGeo = detailed ? new RoundedBoxGeometry(0.7, 0.34, 0.7, B.bevel, 0.1) : new BoxGeometry(0.7, 0.34, 0.7);
  const trailMat = mat({ roughness: 0.4, metalness: 0.1, emissive: new Color(th.trailGlow), emissiveIntensity: detailed ? 0.08 : 0.35 });
  if (detailed) trailMat.hooks = { surface: TRAIL_GLOW };
  const trails = add(new InstancedMesh(trailGeo, trailMat, n));
  trails.castShadow = true;
  trails.count = 0;
  trails.visible = false;
  for (let i = 0; i < n; i++) trails.setColorAt(i, white);

  // player pawns: cone + ring (+ glowing beacon when detailed)
  const colors = state.players.map((_, i) => new Color(th.players[i % th.players.length]!));
  const cellColors = colors.map((c) => c.clone().multiplyScalar(0.85));
  const pawns: Pawn[] = [];
  pawnPrev.length = 0;
  for (let i = 0; i < state.players.length; i++) {
    const group = new Group();
    const color = colors[i]!;
    const bodyMat = detailed
      ? mat({ color, roughness: 0.25, metalness: 0.1, clearcoat: 1, clearcoatRoughness: 0.15, emissive: color, emissiveIntensity: 0.2 })
      : mat({ color, roughness: 0.35, metalness: 0.25, emissive: color, emissiveIntensity: 0.25 });
    const body = new Mesh(new ConeGeometry(0.42, 0.9, B.round), bodyMat);
    body.position.y = 0.6;
    body.castShadow = true;
    const ring = new Mesh(new TorusGeometry(0.55, 0.07, Math.max(6, Math.round(B.round / 3)), Math.max(16, B.round)), new MeshBasicMaterial({ color: color.clone() }));
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.12;
    group.add(body, ring);
    let beacon: Mesh | null = null;
    if (detailed) {
      beacon = new Mesh(new SphereGeometry(0.17, Math.max(10, Math.round(B.round * 0.6)), Math.max(7, Math.round(B.round * 0.4))),
        mat({ color, emissive: color, emissiveIntensity: 2.2, roughness: 0.3 }));
      beacon.position.y = 1.12;
      beacon.castShadow = true;
      group.add(beacon);
    }
    scene.add(group);
    pawns.push({ group, ring, body, beacon, phase: i * 1.7 });
    pawnPrev.push({ x: state.players[i]!.x, y: state.players[i]!.y });
  }

  // grid line overlay (bevelled tiles already delineate cells)
  if (!detailed) {
    const grid = add(gridLines(Math.max(w, h), Math.max(w, h), new Color(th.gridLine)));
    grid.position.y = 0.13;
  }

  board = { objects, width: w, height: h, cells, trails, pawns, colors, cellColors };
  ownerCache = null;
  lastTick = -1;
  flashes.clear();
  fitShadow(w, h);
  frameKey = "";
}

/** Key light + shadow frustum fitted tightly around the play area. */
function fitShadow(w: number, h: number): void {
  const half = Math.hypot(w, h) / 2 + 1.5;
  const dir = new Vector3(0.45, 1, 0.3).normalize();
  key.position.copy(dir).multiplyScalar(half * 2.5);
  key.target.position.set(0, 0, 0);
  const cam = key.shadow.camera as OrthographicCamera;
  cam.left = -half; cam.right = half; cam.top = half; cam.bottom = -half;
  cam.near = half * 2.5 - half - 4; cam.far = half * 2.5 + half + 4;
  cam.updateProjectionMatrix();
}

/** Update from a state. alpha = interpolation between ticks; `claims` the player indices that just claimed. */
export function update(state: State, alpha: number, claims: number[] = []): void {
  if (!board || !look || !theme) return;
  const w = state.width, h = state.height;
  const { cells, trails } = board;
  const detailed = look.detailed;
  const flashOn = look.particles === "high";
  if (state.tick !== lastTick || !ownerCache) {
    lastTick = state.tick;
    // recolour owner cells (only when changed)
    if (!ownerCache || ownerCache.length !== state.cells.length) ownerCache = new Int16Array(state.cells.length).fill(-2);
    let dirty = false, moved = false;
    const empty = tmpColor.set(theme.empty).clone();
    for (let i = 0; i < state.cells.length; i++) {
      if (ownerCache[i] === state.cells[i]) continue;
      const wasSet = ownerCache[i] !== -2;
      const owner = state.cells[i]!;
      ownerCache[i] = owner;
      cells.setColorAt(i, owner === 0 ? empty : board.cellColors[owner - 1]!);
      if (detailed) {
        // owned land sits a touch proud of the empty plane
        tmpMat.makeTranslation((i % w) - w / 2 + 0.5, owner === 0 ? 0 : 0.05, ((i / w) | 0) - h / 2 + 0.5);
        cells.setMatrixAt(i, tmpMat);
        moved = true;
      }
      if (wasSet && owner > 0 && flashOn) flashes.set(i, 0);
      dirty = true;
    }
    if (dirty && cells.instanceColor) cells.instanceColor.needsUpdate = true;
    if (moved) cells.instanceMatrix.needsUpdate = true;
    // rebuild trail instances
    let tc = 0;
    for (let i = 0; i < state.trailOf.length; i++) {
      const t = state.trailOf[i]!;
      if (t === 0) continue;
      tmpMat.makeTranslation((i % w) - w / 2 + 0.5, 0.22, ((i / w) | 0) - h / 2 + 0.5);
      trails.setMatrixAt(tc, tmpMat);
      trails.setColorAt(tc, board.colors[t - 1]!);
      tc++;
    }
    trails.count = tc;
    // an InstancedMesh drawing 0 instances fails the frame ("invalid mesh batch", reported): hide it instead
    trails.visible = tc > 0;
    if (tc > 0) {
      trails.instanceMatrix.needsUpdate = true;
      if (trails.instanceColor) trails.instanceColor.needsUpdate = true;
    }
  }
  // pawns with interpolation; exposed = the ring grows, pulses and whitens (timing, not colour only)
  for (let i = 0; i < state.players.length; i++) {
    const p = state.players[i]!;
    const pawn = board.pawns[i];
    if (!pawn) continue;
    pawn.group.visible = p.alive;
    if (!p.alive) continue;
    const prev = pawnPrev[i]!;
    const ix = prev.x + (p.x - prev.x) * alpha, iy = prev.y + (p.y - prev.y) * alpha;
    pawn.group.position.set(ix - w / 2 + 0.5, detailed ? 0.05 : 0, iy - h / 2 + 0.5);
    const exposed = p.trail.length > 0;
    const pulse = exposed && !reduced ? 1 + Math.sin(clock * 12) * 0.18 : 1;
    pawn.ring.scale.setScalar(exposed ? 1.35 * pulse : 1);
    const rc = (pawn.ring.material as MeshBasicMaterial).color.copy(board.colors[i]!);
    if (exposed) rc.lerp(white, 0.4);
    if (look.bloom) rc.multiplyScalar(1.25);
  }
  for (const i of claims) spawnClaimFx(state, i);
}
/** Once per simulation tick: the pawns' interpolation origins. */
export function endTick(state: State): void {
  for (let i = 0; i < state.players.length; i++) {
    const pp = pawnPrev[i];
    if (pp) { pp.x = state.players[i]!.x; pp.y = state.players[i]!.y; }
  }
}
function spawnClaimFx(state: State, i: number): void {
  if (reduced || !board || i < 0 || i >= state.players.length) return;
  const p = state.players[i]!;
  let fx = fxPool.pop();
  if (!fx) {
    const mesh = new Mesh(new RingGeometry(0.4, 0.55, 32), new MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.6, side: DoubleSide }));
    mesh.rotation.x = -Math.PI / 2;
    fx = { mesh, age: 0, life: 0.7 };
  }
  (fx.mesh.material as MeshBasicMaterial).color.copy(board.colors[i]!);
  fx.mesh.visible = true;
  fx.mesh.position.set(p.x - state.width / 2 + 0.5, 0.16, p.y - state.height / 2 + 0.5);
  fx.age = 0; fx.life = 0.7;
  scene.add(fx.mesh);
  activeFx.push(fx);
}

// ---------------------------------------------------------------- camera, framing, picking
let view: Rect = { x: 0, y: 0, width: 1, height: 1 };
let win = { w: 1, h: 1 };
let frameKey = "";
/** render.js fitCamera: the board fitted into the playfield's aspect. */
function fitCamera(): void {
  if (!board) return;
  const w = board.width, h = board.height;
  const aspect = view.width / Math.max(1, view.height);
  let halfH = Math.max(w, h) * 0.62 + 3;
  let halfW = halfH * aspect;
  if (halfW < w * 0.62 + 3) { halfW = w * 0.62 + 3; halfH = halfW / aspect; }
  camera.left = -halfW; camera.right = halfW; camera.top = halfH; camera.bottom = -halfH;
  camera.setViewOffset(view.width, view.height, -view.x, -view.y, win.w, win.h);
  camera.updateProjectionMatrix();
}
/** C / Camera: refit the board (render.js resize). */
export function resetCamera(): void { frameKey = ""; }
export function setAttract(on: boolean): void {
  attract = on;
  if (!on) { camera.position.copy(CAM_POS); camera.lookAt(0, 0, 0); }
}
export function setActive(on: boolean): void { renderer.camera = on ? camera : null; }
/** The board cell under a window point (render.js pickCell: the ray on the y = 0 plane). */
export function pickCell(x: number, y: number): { x: number; y: number } | null {
  if (!board) return null;
  pointerToNdc(x, y, ndc);
  raycaster.setFromCamera(ndc, camera);
  const pt = new Vector3();
  if (!raycaster.ray.intersectPlane(pickPlane, pt)) return null;
  const cx = Math.floor(pt.x + board.width / 2), cy = Math.floor(pt.z + board.height / 2);
  if (cx < 0 || cy < 0 || cx >= board.width || cy >= board.height) return null;
  return { x: cx, y: cy };
}
const corner = new Vector3();
/** A board cell's centre on screen (window px). */
export function cellCenter(cx: number, cy: number): { x: number; y: number } | null {
  if (!board) return null;
  corner.set(cx - board.width / 2 + 0.5, 0.1, cy - board.height / 2 + 0.5).project(camera);
  return { x: ((corner.x + 1) / 2) * win.w, y: ((1 - corner.y) / 2) * win.h };
}
export function hasBoard(): boolean { return !!board; }

// ---------------------------------------------------------------- quality, motion
/** The runtime's quality tier applied live: rebuild what the budget bakes in (render.js setGraphics). */
export function applyLook(next: Look): void {
  if (look && JSON.stringify(look) === JSON.stringify(next)) return;
  const prev = look;
  look = next;
  renderer.shadowMap.enabled = next.shadows > 0;
  key.castShadow = next.shadows > 0;
  if (next.shadows > 0) key.shadow.mapSize = next.shadows;
  // high threshold: only beacons, glowing trails and sparks bloom
  renderer.bloom = next.bloom ? { strength: 0.5, radius: 0.4, threshold: 0.88, resolution: next.budget.bloomRes } : null;
  renderer.ao = next.ao === "off" ? null : {
    blendIntensity: 0.7, radius: 0.6, distanceExponent: 1.4, thickness: 1.0, scale: 1.0, samples: next.ao === "high" ? 16 : 8,
    resolution: next.budget.aoRes,
    denoise: { lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: next.ao === "high" ? 6 : 4, rings: 2, samples: next.ao === "high" ? 16 : 8 },
  };
  // GradeShader before OutputPass (linear light): a 0.22 S-curve, saturation 1.1, cool shadows / warm highlights by a
  // smoothstep of luma 0.25–0.85, a 0.26 vignette from 0.38 to 0.9
  renderer.grade = next.grade ? {
    space: "linear", contrast: 0.22, saturation: 1.1, split: [0.25, 0.85], shadows: [0.97, 0.99, 1.05], highlights: [1.03, 1.0, 0.97],
    vignette: { amount: 0.26, inner: 0.38, outer: 0.9 },
  } : null;
  renderer.antialias = next.antialias;
  moteCount = next.budget.motes;
  moteGeo.setDrawRange(0, moteCount);
  motes.visible = next.animated;
  applyEnvironment();
  const pb = prev?.budget, b = next.budget;
  const lookChanged = !prev || prev.detailed !== next.detailed || pb!.material !== b.material || pb!.bevel !== b.bevel || pb!.round !== b.round || pb!.texture !== b.texture;
  if (lastBuild && lookChanged) {
    const att = attract;
    buildBoard(lastBuild.state, lastBuild.theme);
    attract = att;
    update(lastBuild.state, 1);
  }
}
export function setReducedMotion(v: boolean): void { reduced = v; }
export function current(): Look | null { return look; }

// ---------------------------------------------------------------- each frame
/** render.js _animate + resize: pawn bob, claim flashes + sparks, motes, FX rings, title sway; framing to `rect` (window px). */
export function frame(dt: number, w: number, h: number, rect: Rect): void {
  dt = Math.min(0.1, dt);
  if (w > 0 && h > 0 && rect.width > 0 && rect.height > 0) {
    const fk = `${w}x${h}:${Math.round(rect.x)}:${Math.round(rect.y)}:${Math.round(rect.width)}:${Math.round(rect.height)}`;
    if (fk !== frameKey) { frameKey = fk; win = { w, h }; view = { ...rect }; fitCamera(); }
  }
  const moving = !reduced;
  if (moving) clock += dt;
  const t = clock;
  if (board) {
    for (const pawn of board.pawns) {
      const bob = moving ? Math.sin(t * 2.4 + pawn.phase) * 0.05 : 0;
      pawn.body.position.y = 0.6 + bob;
      if (pawn.beacon) pawn.beacon.position.y = 1.12 + bob * 1.6;
    }
    if (flashes.size && ownerCache) {
      const bw = board.width, bh = board.height;
      const life = moving ? 0.6 : 0.25;
      let n = 0;
      for (const [i, age] of flashes) {
        const a = age + dt;
        const owner = ownerCache[i]!;
        if (owner <= 0) { flashes.delete(i); continue; }
        const base = tmpColor.copy(board.cellColors[owner - 1]!);
        if (a >= life) flashes.delete(i);
        else {
          const k = 1 - a / life;
          base.lerp(white, 0.7 * k).multiplyScalar(1 + 0.6 * k);
          if (age === 0 && moving && n < 60) { emitSparks((i % bw) - bw / 2 + 0.5, ((i / bw) | 0) - bh / 2 + 0.5, board.colors[owner - 1]!, look!.budget.sparks); n++; }
          flashes.set(i, a);
        }
        board.cells.setColorAt(i, base);
      }
      if (board.cells.instanceColor) board.cells.instanceColor.needsUpdate = true;
    }
    for (let i = activeFx.length - 1; i >= 0; i--) {
      const fx = activeFx[i]!;
      fx.age += dt;
      const k = fx.age / fx.life;
      if (k >= 1) { scene.remove(fx.mesh); fx.mesh.visible = false; fxPool.push(fx); activeFx.splice(i, 1); continue; }
      fx.mesh.scale.setScalar(0.5 + k * 4);
      (fx.mesh.material as MeshBasicMaterial).opacity = 0.6 * (1 - k);
    }
  }
  updateSparks(dt);
  if (motes.visible && moving) updateMotes(t);
  if (attract && look?.animated && moving) {
    const a = Math.sin(t * 0.12) * 0.22;
    const r = Math.hypot(CAM_POS.x, CAM_POS.z);
    camera.position.set(Math.sin(a) * r, CAM_POS.y, Math.cos(a) * r);
    camera.lookAt(0, 0, 0);
  }
}
