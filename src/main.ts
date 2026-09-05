import HavokPhysics from "@babylonjs/havok";
import {
  Engine, Scene, ArcRotateCamera, HemisphericLight, DirectionalLight,
  Vector3, MeshBuilder, Color3, Color4, StandardMaterial, HavokPlugin,
  PhysicsAggregate, PhysicsShapeType, GroundMesh, Ray, Mesh, TransformNode,
} from "@babylonjs/core";

// ============================================================
// CORE ENGINE SETUP
// ============================================================
const canvas = document.getElementById("renderCanvas") as HTMLCanvasElement;
const engine = new Engine(canvas, true);

// ============================================================
// WHEEL CONFIG
// ============================================================
interface WheelInfo {
  position: Vector3;
  isSteering: boolean;
  isDriven: boolean;
  radius: number;
}

const wheelInfos: WheelInfo[] = [
  { position: new Vector3(-0.9, -0.1, 1.4), isSteering: true, isDriven: false, radius: 0.4 },
  { position: new Vector3(0.9, -0.1, 1.4), isSteering: true, isDriven: false, radius: 0.4 },
  { position: new Vector3(-0.9, -0.1, -1.4), isSteering: false, isDriven: true, radius: 0.4 },
  { position: new Vector3(0.9, -0.1, -1.4), isSteering: false, isDriven: true, radius: 0.4 },
];

// Suspension tuning
const restLength = 0.6;
const springStiffness = 30000;
const damping = 3000;

// Drive tuning
const enginePower = 9000;
const turnForce = 4000;

// Tire friction tuning — THIS IS WHAT FIXES THE INFINITE SLIDING
const lateralGrip = 12000;      // higher = less sideways sliding (more "grippy")
const rollingResistance = 800;  // higher = car slows down faster when coasting

const inputMap: Record<string, boolean> = {};

// ============================================================
// TERRAIN HEIGHT GENERATION
// ============================================================
function smoothNoise(x: number, z: number, scale: number, amplitude: number): number {
  const ix = Math.floor(x / scale);
  const iz = Math.floor(z / scale);
  const fx = x / scale - ix;
  const fz = z / scale - iz;
  const rand = (a: number, b: number) => Math.abs(Math.sin(a * 127.1 + b * 311.7) * 43758.5453) % 1;
  const v00 = rand(ix, iz);
  const v10 = rand(ix + 1, iz);
  const v01 = rand(ix, iz + 1);
  const v11 = rand(ix + 1, iz + 1);
  const ux = fx * fx * (3 - 2 * fx);
  const uz = fz * fz * (3 - 2 * fz);
  return (v00 * (1 - ux) * (1 - uz) + v10 * ux * (1 - uz) + v01 * (1 - ux) * uz + v11 * ux * uz) * amplitude;
}

function terrainHeight(x: number, z: number): number {
  let h = 0;
  h += smoothNoise(x, z, 40, 6);
  h += smoothNoise(x, z, 15, 2);
  h += smoothNoise(x, z, 5, 0.5);
  const roadBlend = Math.min(1, Math.abs(x) / 5);
  return h * roadBlend;
}

// ============================================================
// WORLD BUILDING
// ============================================================
function buildTerrain(scene: Scene): GroundMesh {
  const ground = MeshBuilder.CreateGround(
    "ground",
    { width: 400, height: 400, subdivisions: 120, updatable: true },
    scene
  ) as GroundMesh;

  const positions = ground.getVerticesData("position") as Float32Array;
  for (let i = 0; i < positions.length; i += 3) {
    positions[i + 1] = terrainHeight(positions[i], positions[i + 2]);
  }
  ground.updateVerticesData("position", positions);
  ground.createNormals(true);

  // Vertex colour gradient: soil (low) → grass (mid) → rocky grey (peaks)
  const vCount = positions.length / 3;
  const colors = new Float32Array(vCount * 4);
  for (let v = 0; v < vCount; v++) {
    const h = positions[v * 3 + 1];
    let r: number, g: number, b: number;
    if (h < 1.0) {
      // Moist dark soil near road
      const t = Math.max(0, h);
      r = 0.28 + t * 0.06;  g = 0.20 + t * 0.18;  b = 0.09 + t * 0.05;
    } else if (h < 4.0) {
      // Lush grass
      const t = (h - 1.0) / 3.0;
      r = 0.20 + t * 0.18;  g = 0.46 - t * 0.04;  b = 0.11 + t * 0.08;
    } else {
      // Rocky grey on peaks
      const t = Math.min(1.0, (h - 4.0) / 3.5);
      r = 0.38 + t * 0.20;  g = 0.42 + t * 0.12;  b = 0.20 + t * 0.26;
    }
    colors[v * 4 + 0] = r;
    colors[v * 4 + 1] = g;
    colors[v * 4 + 2] = b;
    colors[v * 4 + 3] = 1.0;
  }
  ground.setVerticesData("color", colors);

  const mat = new StandardMaterial("terrainMat", scene);
  mat.diffuseColor  = new Color3(1, 1, 1); // white so vertex colours show through
  mat.specularColor = new Color3(0.02, 0.02, 0.02);
  ground.material = mat;

  new PhysicsAggregate(ground, PhysicsShapeType.MESH, { mass: 0, friction: 0.9, restitution: 0 }, scene);
  return ground;
}

function buildRoad(scene: Scene): void {
  // ── Asphalt surface ───────────────────────────────────────────────
  const road = MeshBuilder.CreateGround(
    "road",
    { width: 10, height: 400, subdivisions: 80, updatable: true },
    scene
  ) as GroundMesh;

  const positions = road.getVerticesData("position") as Float32Array;
  for (let i = 0; i < positions.length; i += 3) {
    positions[i + 1] = smoothNoise(positions[i], positions[i + 2], 12, 0.25) + 0.02;
  }
  road.updateVerticesData("position", positions);
  road.createNormals(true);

  const roadMat = new StandardMaterial("roadMat", scene);
  roadMat.diffuseColor  = new Color3(0.18, 0.18, 0.20); // dark asphalt
  roadMat.specularColor = new Color3(0.06, 0.05, 0.04);
  roadMat.specularPower = 32;
  road.material = roadMat;

  // ── Dashed white centre line ──────────────────────────────────
  const dashMat = new StandardMaterial("dashMat", scene);
  dashMat.diffuseColor  = new Color3(0.96, 0.96, 0.93);
  dashMat.emissiveColor = new Color3(0.12, 0.12, 0.12);
  for (let z = -197; z < 197; z += 5) {
    const dash = MeshBuilder.CreateBox(`dash_${z}`, { width: 0.18, height: 0.02, depth: 2.5 }, scene);
    dash.position.set(0, 0.06, z + 1.25);
    dash.material   = dashMat;
    dash.isPickable = false;
  }

  // ── Yellow edge lines ────────────────────────────────────────
  const edgeMat = new StandardMaterial("edgeMat", scene);
  edgeMat.diffuseColor  = new Color3(0.96, 0.82, 0.05);
  edgeMat.emissiveColor = new Color3(0.10, 0.08, 0.0);
  for (const xOff of [-3.6, 3.6]) {
    const line = MeshBuilder.CreateBox(`edgeLine_${xOff}`, { width: 0.18, height: 0.02, depth: 400 }, scene);
    line.position.set(xOff, 0.06, 0);
    line.material   = edgeMat;
    line.isPickable = false;
  }

  // ── Concrete kerb strips ────────────────────────────────────
  const kerbMat = new StandardMaterial("kerbMat", scene);
  kerbMat.diffuseColor  = new Color3(0.74, 0.72, 0.68);
  kerbMat.specularColor = new Color3(0.08, 0.08, 0.08);
  for (const xOff of [-4.2, 4.2]) {
    const kerb = MeshBuilder.CreateBox(`kerb_${xOff}`, { width: 0.5, height: 0.14, depth: 400 }, scene);
    kerb.position.set(xOff, 0.06, 0);
    kerb.material   = kerbMat;
    kerb.isPickable = false;
  }
}

function addRocks(scene: Scene): void {
  const rng = (seed: number) => Math.abs(Math.sin(seed * 9301 + 49297) * 233280) % 1;
  for (let i = 0; i < 60; i++) {
    let rx = (rng(i * 3) - 0.5) * 370;
    const rz = (rng(i * 3 + 1) - 0.5) * 370;
    if (Math.abs(rx) < 10) rx = rx < 0 ? -12 : 12;
    const ry = terrainHeight(rx, rz);
    const w = 0.5 + rng(i * 3 + 2) * 2;
    const h = 0.4 + rng(i * 7) * 1.5;
    const d = 0.5 + rng(i * 11) * 2;

    // Non-uniformly scaled sphere = organic boulder (no more rectangular boxes!)
    const rock = MeshBuilder.CreateSphere(`rock_${i}`, { diameter: 1, segments: 4 }, scene);
    rock.scaling.set(w, h, d);
    rock.position.set(rx, ry + h / 2, rz);
    rock.rotation.y = rng(i * 5) * Math.PI;

    const shade = 0.28 + rng(i * 17) * 0.28;
    const tint  = rng(i * 23) * 0.06;
    const rockMat = new StandardMaterial(`rockMat_${i}`, scene);
    rockMat.diffuseColor  = new Color3(shade + tint, shade, shade - 0.04);
    rockMat.specularColor = new Color3(0.07, 0.07, 0.07);
    rock.material = rockMat;

    // Physics box is fine for static colliders
    new PhysicsAggregate(rock, PhysicsShapeType.BOX, { mass: 0, friction: 0.8, restitution: 0.1 }, scene);
  }
}

// ============================================================
// TREES — tapered cylinder trunk + stacked sphere foliage
// ============================================================
function addTrees(scene: Scene): void {
  const rng = (seed: number) => Math.abs(Math.sin(seed * 6271 + 31337) * 99991) % 1;

  const trunkMat = new StandardMaterial("trunkMat", scene);
  trunkMat.diffuseColor  = new Color3(0.32, 0.20, 0.09);
  trunkMat.specularColor = new Color3(0.04, 0.04, 0.04);

  const foliagePalette = [
    new Color3(0.09, 0.38, 0.11),
    new Color3(0.13, 0.46, 0.09),
    new Color3(0.07, 0.32, 0.09),
    new Color3(0.15, 0.50, 0.12),
    new Color3(0.11, 0.42, 0.07),
  ].map((c, idx) => {
    const m = new StandardMaterial(`foliageMat_${idx}`, scene);
    m.diffuseColor  = c;
    m.specularColor = new Color3(0.02, 0.04, 0.02);
    return m;
  });

  for (let i = 0; i < 120; i++) {
    let rx = (rng(i * 7) - 0.5) * 380;
    const rz = (rng(i * 7 + 1) - 0.5) * 380;
    if (Math.abs(rx) < 10) rx = rx < 0 ? -13 : 13; // clear of road
    const ry = terrainHeight(rx, rz);

    const treeH     = 3.2 + rng(i * 3) * 4.5;
    const trunkBot  = 0.28 + rng(i * 2) * 0.22;
    const trunkTop  = 0.08 + rng(i) * 0.10;

    const trunk = MeshBuilder.CreateCylinder(`trunk_${i}`, {
      diameterTop: trunkTop, diameterBottom: trunkBot,
      height: treeH, tessellation: 7,
    }, scene);
    trunk.position.set(rx, ry + treeH / 2, rz);
    trunk.material  = trunkMat;
    trunk.isPickable = false;

    const fMat      = foliagePalette[Math.floor(rng(i * 13) * foliagePalette.length)];
    const blobCount = 2 + Math.floor(rng(i * 11) * 2);
    for (let b = 0; b < blobCount; b++) {
      const br = (1.7 - b * 0.3) * (0.7 + rng(i * b + 5) * 0.55);
      const bx = rx + (rng(i * b + 17) - 0.5) * 0.9;
      const bz = rz + (rng(i * b + 23) - 0.5) * 0.9;
      const by = ry + treeH * 0.70 + b * br * 0.85;
      const blob = MeshBuilder.CreateSphere(`foliage_${i}_${b}`, {
        diameter: br * 2, segments: 5,
      }, scene);
      blob.position.set(bx, by, bz);
      blob.material   = fMat;
      blob.isPickable = false;
    }
  }
}

// ============================================================
// SKY DOME — inside-out sphere + sun disc + horizon haze
// ============================================================
function addSkyDome(scene: Scene): void {
  // Giant sphere rendered from inside
  const sky = MeshBuilder.CreateSphere("skyDome", { diameter: 900, segments: 8 }, scene);
  sky.isPickable      = false;
  sky.sideOrientation = Mesh.BACKSIDE;

  const skyMat = new StandardMaterial("skyMat", scene);
  skyMat.diffuseColor    = new Color3(0.34, 0.56, 0.88);
  skyMat.emissiveColor   = new Color3(0.26, 0.48, 0.80);
  skyMat.disableLighting = true;
  skyMat.backFaceCulling = false;
  sky.material = skyMat;

  // Sun disc
  const sun = MeshBuilder.CreateSphere("sun", { diameter: 22, segments: 8 }, scene);
  sun.position.set(180, 340, -270);
  sun.isPickable = false;
  const sunMat = new StandardMaterial("sunMat", scene);
  sunMat.diffuseColor    = new Color3(1.0, 0.97, 0.70);
  sunMat.emissiveColor   = new Color3(1.0, 0.90, 0.52);
  sunMat.disableLighting = true;
  sun.material = sunMat;

  // Horizon haze disc to blend sky into ground
  const haze = MeshBuilder.CreateDisc("hazeDisc", { radius: 1000, tessellation: 32 }, scene);
  haze.rotation.x     = Math.PI / 2;
  haze.position.y     = -6;
  haze.isPickable     = false;
  const hazeMat = new StandardMaterial("hazeMat", scene);
  hazeMat.diffuseColor    = new Color3(0.62, 0.74, 0.86);
  hazeMat.emissiveColor   = new Color3(0.50, 0.62, 0.78);
  hazeMat.disableLighting = true;
  hazeMat.backFaceCulling = false;
  haze.material = hazeMat;
}

// ============================================================
// GRASS TUFTS — crossed billboard quads near road edges
// ============================================================
function addGrassTufts(scene: Scene): void {
  const rng = (seed: number) => Math.abs(Math.sin(seed * 8191 + 65537) * 99991) % 1;

  const grassMats = [
    new Color3(0.20, 0.52, 0.12),
    new Color3(0.14, 0.42, 0.09),
    new Color3(0.24, 0.55, 0.16),
  ].map((c, idx) => {
    const m = new StandardMaterial(`grassMat_${idx}`, scene);
    m.diffuseColor    = c;
    m.specularColor   = new Color3(0.02, 0.04, 0.02);
    m.backFaceCulling = false;
    return m;
  });

  for (let i = 0; i < 500; i++) {
    const side = rng(i * 2) < 0.5 ? -1 : 1;
    const rx   = side * (5.5 + rng(i * 3) * 50);
    const rz   = (rng(i * 7) - 0.5) * 380;
    const ry   = terrainHeight(rx, rz);
    const h    = 0.25 + rng(i * 11) * 0.45;
    const w    = 0.20 + rng(i * 13) * 0.28;
    const mat  = grassMats[Math.floor(rng(i * 19) * grassMats.length)];

    // Two crossed planes = cheap billboard grass tuft
    for (let q = 0; q < 2; q++) {
      const quad = MeshBuilder.CreatePlane(`grass_${i}_${q}`, { width: w, height: h }, scene);
      quad.position.set(
        rx + (rng(i * q + 7) - 0.5) * 0.35,
        ry + h / 2,
        rz + (rng(i * q + 9) - 0.5) * 0.35
      );
      quad.rotation.y = q * (Math.PI / 2) + rng(i * 23) * 0.9;
      quad.material   = mat;
      quad.isPickable = false;
    }
  }
}

// ============================================================
// CAR VISUAL — multi-part mesh parented to physics chassis
// ============================================================
function buildCarVisual(chassis: Mesh, scene: Scene): TransformNode {
  const root = new TransformNode("carVisualRoot", scene);
  root.parent = chassis;

  // ── Materials ────────────────────────────────────────────────
  const bodyMat = new StandardMaterial("bodyMat", scene);
  bodyMat.diffuseColor  = new Color3(0.88, 0.12, 0.08);
  bodyMat.specularColor = new Color3(0.9, 0.5, 0.4);
  bodyMat.specularPower = 64;

  const glassMat = new StandardMaterial("glassMat", scene);
  glassMat.diffuseColor  = new Color3(0.4, 0.7, 0.9);
  glassMat.specularColor = new Color3(1, 1, 1);
  glassMat.specularPower = 128;
  glassMat.alpha         = 0.55;

  const darkMat = new StandardMaterial("darkMat", scene);
  darkMat.diffuseColor  = new Color3(0.1, 0.1, 0.12);
  darkMat.specularColor = new Color3(0.3, 0.3, 0.3);

  const chromeMat = new StandardMaterial("chromeMat", scene);
  chromeMat.diffuseColor  = new Color3(0.85, 0.85, 0.9);
  chromeMat.specularColor = new Color3(1, 1, 1);
  chromeMat.specularPower = 256;

  const headlightMat = new StandardMaterial("headlightMat", scene);
  headlightMat.diffuseColor  = new Color3(1, 1, 0.9);
  headlightMat.emissiveColor = new Color3(1, 0.95, 0.7);

  const taillightMat = new StandardMaterial("taillightMat", scene);
  taillightMat.diffuseColor  = new Color3(0.9, 0.05, 0.05);
  taillightMat.emissiveColor = new Color3(0.8, 0.0, 0.0);

  const attach = (mesh: Mesh) => { mesh.parent = root; return mesh; };

  // ── Lower body ────────────────────────────────────────────────
  const body = attach(MeshBuilder.CreateBox("carBody", { width: 1.9, height: 0.42, depth: 3.9 }, scene));
  body.position.set(0, 0, 0);
  body.material = bodyMat;

  // ── Cabin ─────────────────────────────────────────────────────
  const cabin = attach(MeshBuilder.CreateBox("cabin", { width: 1.5, height: 0.5, depth: 1.9 }, scene));
  cabin.position.set(0, 0.46, -0.15);
  cabin.material = bodyMat;

  // ── Windshield ────────────────────────────────────────────────
  const windshield = attach(MeshBuilder.CreateBox("windshield", { width: 1.42, height: 0.46, depth: 0.05 }, scene));
  windshield.position.set(0, 0.46, 0.8);
  windshield.rotation.x = 0.35;
  windshield.material = glassMat;

  // ── Rear windshield ───────────────────────────────────────────
  const rearWind = attach(MeshBuilder.CreateBox("rearWindshield", { width: 1.42, height: 0.42, depth: 0.05 }, scene));
  rearWind.position.set(0, 0.46, -1.08);
  rearWind.rotation.x = -0.3;
  rearWind.material = glassMat;

  // ── Side windows ──────────────────────────────────────────────
  for (const side of [-1, 1]) {
    const win = attach(MeshBuilder.CreateBox(`sideWin_${side}`, { width: 0.04, height: 0.34, depth: 0.95 }, scene));
    win.position.set(side * 0.78, 0.52, -0.15);
    win.material = glassMat;
  }

  // ── Hood ──────────────────────────────────────────────────────
  const hood = attach(MeshBuilder.CreateBox("hood", { width: 1.88, height: 0.08, depth: 1.1 }, scene));
  hood.position.set(0, 0.25, 1.4);
  hood.material = bodyMat;

  // ── Trunk ─────────────────────────────────────────────────────
  const trunk = attach(MeshBuilder.CreateBox("trunk", { width: 1.88, height: 0.07, depth: 0.8 }, scene));
  trunk.position.set(0, 0.22, -1.65);
  trunk.material = bodyMat;

  // ── Front bumper ──────────────────────────────────────────────
  const fBumper = attach(MeshBuilder.CreateBox("frontBumper", { width: 1.92, height: 0.22, depth: 0.18 }, scene));
  fBumper.position.set(0, -0.1, 1.98);
  fBumper.material = darkMat;

  // ── Rear bumper ───────────────────────────────────────────────
  const rBumper = attach(MeshBuilder.CreateBox("rearBumper", { width: 1.92, height: 0.22, depth: 0.18 }, scene));
  rBumper.position.set(0, -0.1, -1.98);
  rBumper.material = darkMat;

  // ── Front grille ──────────────────────────────────────────────
  const grille = attach(MeshBuilder.CreateBox("grille", { width: 1.0, height: 0.18, depth: 0.06 }, scene));
  grille.position.set(0, 0.02, 2.02);
  grille.material = darkMat;

  // ── Headlights ────────────────────────────────────────────────
  for (const side of [-1, 1]) {
    const hl = attach(MeshBuilder.CreateBox(`headlight_${side}`, { width: 0.32, height: 0.14, depth: 0.06 }, scene));
    hl.position.set(side * 0.72, 0.07, 2.02);
    hl.material = headlightMat;
  }

  // ── Tail lights ───────────────────────────────────────────────
  for (const side of [-1, 1]) {
    const tl = attach(MeshBuilder.CreateBox(`taillight_${side}`, { width: 0.35, height: 0.14, depth: 0.06 }, scene));
    tl.position.set(side * 0.7, 0.07, -2.02);
    tl.material = taillightMat;
  }

  // ── Side skirts ───────────────────────────────────────────────
  for (const side of [-1, 1]) {
    const skirt = attach(MeshBuilder.CreateBox(`skirt_${side}`, { width: 0.07, height: 0.12, depth: 3.5 }, scene));
    skirt.position.set(side * 0.98, -0.15, 0);
    skirt.material = darkMat;
  }

  // ── Roof strip ────────────────────────────────────────────────
  const roof = attach(MeshBuilder.CreateBox("roofStrip", { width: 1.5, height: 0.03, depth: 1.92 }, scene));
  roof.position.set(0, 0.72, -0.15);
  roof.material = darkMat;

  // ── Side mirrors ──────────────────────────────────────────────
  for (const side of [-1, 1]) {
    const mirror = attach(MeshBuilder.CreateBox(`mirror_${side}`, { width: 0.08, height: 0.1, depth: 0.22 }, scene));
    mirror.position.set(side * 1.02, 0.28, 0.55);
    mirror.material = chromeMat;
  }

  // ── Wheels with rims ──────────────────────────────────────────
  const wheelMat = new StandardMaterial("wheelMat", scene);
  wheelMat.diffuseColor  = new Color3(0.12, 0.12, 0.14);
  wheelMat.specularColor = new Color3(0.2, 0.2, 0.2);

  const rimMat = new StandardMaterial("rimMat", scene);
  rimMat.diffuseColor  = new Color3(0.8, 0.82, 0.88);
  rimMat.specularColor = new Color3(1, 1, 1);
  rimMat.specularPower = 200;

  const wPositions = [
    new Vector3(-1.02, -0.1,  1.4),
    new Vector3( 1.02, -0.1,  1.4),
    new Vector3(-1.02, -0.1, -1.4),
    new Vector3( 1.02, -0.1, -1.4),
  ];

  wPositions.forEach((pos, idx) => {
    const tyre = attach(MeshBuilder.CreateCylinder(`tyre_${idx}`, { diameter: 0.82, height: 0.36, tessellation: 20 }, scene));
    tyre.rotation.z = Math.PI / 2;
    tyre.position.copyFrom(pos);
    tyre.material = wheelMat;

    const rim = attach(MeshBuilder.CreateCylinder(`rim_${idx}`, { diameter: 0.52, height: 0.38, tessellation: 12 }, scene));
    rim.rotation.z = Math.PI / 2;
    rim.position.copyFrom(pos);
    rim.material = rimMat;

    const cap = attach(MeshBuilder.CreateCylinder(`cap_${idx}`, { diameter: 0.16, height: 0.4, tessellation: 8 }, scene));
    cap.rotation.z = Math.PI / 2;
    cap.position.copyFrom(pos);
    cap.material = chromeMat;
  });

  return root;
}

function createCarChassis(scene: Scene): { chassis: Mesh; chassisAggregate: PhysicsAggregate } {
  // Physics box is invisible — the visual car is parented to it
  const chassis = MeshBuilder.CreateBox("chassis", { width: 2, height: 0.5, depth: 4 }, scene);
  chassis.position.set(0, 6, 0);
  chassis.isVisible = false;

  const chassisAggregate = new PhysicsAggregate(
    chassis,
    PhysicsShapeType.BOX,
    { mass: 300, friction: 0.5, restitution: 0.05 },
    scene
  );

  chassisAggregate.body.setLinearDamping(0.1);
  chassisAggregate.body.setAngularDamping(0.6);

  buildCarVisual(chassis, scene);

  return { chassis, chassisAggregate };
}

// ============================================================
// VEHICLE PHYSICS: SUSPENSION
// ============================================================
function groundFilter(mesh: Mesh): boolean {
  return mesh.name === "ground" || mesh.name === "road" || mesh.name.startsWith("rock_");
}

function applySuspension(chassis: Mesh, chassisAggregate: PhysicsAggregate, scene: Scene): void {
  const body = chassisAggregate.body;

  for (const wheel of wheelInfos) {
    const worldPos = Vector3.TransformCoordinates(wheel.position, chassis.getWorldMatrix());
    const ray = new Ray(worldPos, new Vector3(0, -1, 0), restLength + wheel.radius);
    const hit = scene.pickWithRay(ray, groundFilter);

    if (hit?.hit && hit.distance !== undefined) {
      const currentLength = hit.distance - wheel.radius;
      const compression = restLength - currentLength;

      if (compression > 0) {
        const springForce = compression * springStiffness;
        const velocity = body.getLinearVelocity() ?? Vector3.Zero();
        const dampingForce = velocity.y * damping;
        const suspensionForce = springForce - dampingForce;
        body.applyForce(new Vector3(0, suspensionForce, 0), worldPos);
      }
    }
  }
}

// ============================================================
// VEHICLE PHYSICS: TIRE FRICTION (fixes infinite sliding)
// ============================================================
function applyTireFriction(chassis: Mesh, chassisAggregate: PhysicsAggregate, scene: Scene): void {
  const body = chassisAggregate.body;
  const linVel = body.getLinearVelocity() ?? Vector3.Zero();
  const angVel = body.getAngularVelocity() ?? Vector3.Zero();
  const forward = chassis.getDirection(new Vector3(0, 0, 1));
  const right = chassis.getDirection(new Vector3(1, 0, 0));
  const chassisCenter = chassis.getAbsolutePosition();

  for (const wheel of wheelInfos) {
    const worldPos = Vector3.TransformCoordinates(wheel.position, chassis.getWorldMatrix());
    const ray = new Ray(worldPos, new Vector3(0, -1, 0), restLength + wheel.radius);
    const hit = scene.pickWithRay(ray, groundFilter);

    // Only apply tire friction if this wheel is actually near/touching the ground
    if (hit?.hit) {
      // Velocity at this specific wheel point = linear velocity + (angular velocity × radius offset)
      const r = worldPos.subtract(chassisCenter);
      const pointVel = linVel.add(Vector3.Cross(angVel, r));

      const lateralSpeed = Vector3.Dot(pointVel, right);
      const forwardSpeed = Vector3.Dot(pointVel, forward);

      // Grip: strong force cancelling sideways slide — this is what stops the "ice skating" feel
      const lateralForce = right.scale(-lateralSpeed * lateralGrip * 0.016);
      body.applyForce(lateralForce, worldPos);

      // Rolling resistance: gently slows the car down when coasting, like real tire/road friction
      const rollingForce = forward.scale(-forwardSpeed * rollingResistance * 0.016);
      body.applyForce(rollingForce, worldPos);
    }
  }
}

// ============================================================
// VEHICLE PHYSICS: DRIVE INPUT
// ============================================================
function applyDriveForces(chassis: Mesh, chassisAggregate: PhysicsAggregate): void {
  const body = chassisAggregate.body;
  const forward = chassis.getDirection(new Vector3(0, 0, 1));
  const right = chassis.getDirection(new Vector3(1, 0, 0));

  let throttle = 0;
  if (inputMap["w"] || inputMap["arrowup"]) throttle = 1;
  if (inputMap["s"] || inputMap["arrowdown"]) throttle = -0.5;

  let steer = 0;
  if (inputMap["a"] || inputMap["arrowleft"]) steer = -1;
  if (inputMap["d"] || inputMap["arrowright"]) steer = 1;

  if (throttle !== 0) {
    for (const wheel of wheelInfos) {
      if (wheel.isDriven) {
        const worldPos = Vector3.TransformCoordinates(wheel.position, chassis.getWorldMatrix());
        body.applyForce(forward.scale(enginePower * throttle), worldPos);
      }
    }
  }

  if (steer !== 0) {
    const frontPos = chassis.getAbsolutePosition().add(forward.scale(1.4));
    body.applyForce(right.scale(steer * turnForce), frontPos);
  }
}

// ============================================================
// VEHICLE PHYSICS: AUTO-UPRIGHT TORQUE
// ============================================================
// Every frame, push the car back toward wheels-down.
// Uses the cross product of carUp vs worldUp to find the exact
// rotation axis, then blends corrective spin into angular velocity.
function applyUprightTorque(chassis: Mesh, chassisAggregate: PhysicsAggregate): void {
  const body    = chassisAggregate.body;
  const carUp   = chassis.getDirection(new Vector3(0, 1, 0));
  const worldUp = new Vector3(0, 1, 0);

  // 1 = perfectly upright, 0 = 90° tilted, -1 = fully flipped
  const uprightness = Vector3.Dot(carUp, worldUp);

  // Only act when tilted more than ~8 degrees (cos 8° ≈ 0.99)
  if (uprightness >= 0.99) return;

  // Axis to spin around to become upright
  const correctionAxis = Vector3.Cross(carUp, worldUp);
  const axisLen = correctionAxis.length();
  if (axisLen < 0.001) return; // already upright or exactly inverted

  // tiltFactor: 0 when upright, 1 when fully flipped
  const tiltFactor = 1.0 - uprightness;

  // Cubic curve: gentle at small angles, very strong when flipped
  const strength = tiltFactor * tiltFactor * tiltFactor * 14.0;

  const correction = correctionAxis.normalize().scale(strength);
  const angVel     = body.getAngularVelocity() ?? Vector3.Zero();

  // Dampen existing roll/pitch, inject corrective spin
  body.setAngularVelocity(angVel.scale(0.80).add(correction));
}

// ============================================================
// INPUT LISTENERS
// ============================================================
function initInput(): void {
  window.addEventListener("keydown", (e) => (inputMap[e.key.toLowerCase()] = true));
  window.addEventListener("keyup",   (e) => (inputMap[e.key.toLowerCase()] = false));
}

// ============================================================
// BOUNDARY WALLS — invisible physics barriers at terrain edge
// ============================================================
function addBoundaryWalls(scene: Scene): void {
  const HALF  = 202;           // terrain half-width (200) + small buffer
  const THICK =   5;
  const HIGH  =  15;           // tall enough the car can't jump over
  const SPAN  = HALF * 2 + THICK;

  const CEILING_Y = 20;       // max height car can reach (~8 units = tallest terrain peak)
  const wallDefs = [
    { name: "wall_N",      pos: new Vector3(0,      HIGH / 2,        HALF), w: SPAN,  h: HIGH,      d: THICK },
    { name: "wall_S",      pos: new Vector3(0,      HIGH / 2,       -HALF), w: SPAN,  h: HIGH,      d: THICK },
    { name: "wall_E",      pos: new Vector3( HALF,  HIGH / 2,        0   ), w: THICK, h: HIGH,      d: SPAN  },
    { name: "wall_W",      pos: new Vector3(-HALF,  HIGH / 2,        0   ), w: THICK, h: HIGH,      d: SPAN  },
    // Ceiling slab — prevents car going above CEILING_Y
    { name: "wall_CEIL",   pos: new Vector3(0,      CEILING_Y + 1,   0   ), w: SPAN,  h: THICK,     d: SPAN  },
  ];

  for (const wd of wallDefs) {
    const wall = MeshBuilder.CreateBox(wd.name, { width: wd.w, height: wd.h, depth: wd.d }, scene);
    wall.position.copyFrom(wd.pos);
    wall.isVisible  = false;
    wall.isPickable = false;
    new PhysicsAggregate(wall, PhysicsShapeType.BOX, { mass: 0, friction: 0.2, restitution: 0.5 }, scene);
  }
}

// ============================================================
// SCENE ASSEMBLY
// ============================================================
async function createScene(): Promise<{ scene: Scene; chassis: Mesh; chassisAggregate: PhysicsAggregate; camera: ArcRotateCamera }> {
  const scene = new Scene(engine);

  scene.clearColor = new Color4(0.34, 0.56, 0.88, 1); // matches sky dome
  scene.fogMode    = Scene.FOGMODE_EXP2;
  scene.fogColor   = new Color3(0.52, 0.64, 0.80);
  scene.fogDensity = 0.003;

  const havokInstance = await HavokPhysics();
  const physicsPlugin = new HavokPlugin(true, havokInstance);
  scene.enablePhysics(new Vector3(0, -9.81, 0), physicsPlugin);

  // Camera — target is updated every frame to follow the car
  const camera = new ArcRotateCamera("camera", -Math.PI / 2, Math.PI / 3.5, 14, Vector3.Zero(), scene);
  camera.lowerRadiusLimit = 5;
  camera.upperRadiusLimit = 50;
  camera.lowerBetaLimit   = 0.2;
  camera.upperBetaLimit   = Math.PI / 2.1;
  camera.attachControl(canvas, true);

  const hemiLight = new HemisphericLight("hemiLight", new Vector3(0, 1, 0), scene);
  hemiLight.intensity   = 0.90;
  hemiLight.diffuse     = new Color3(0.86, 0.92, 1.00);  // sky-bounce blue-white
  hemiLight.specular    = new Color3(0.20, 0.20, 0.22);
  hemiLight.groundColor = new Color3(0.26, 0.20, 0.12);  // warm earth bounce

  // Main sun — warm angled light
  const dirLight = new DirectionalLight("dirLight", new Vector3(-0.5, -1.4, -0.7), scene);
  dirLight.intensity = 1.3;
  dirLight.diffuse   = new Color3(1.00, 0.91, 0.68);
  dirLight.specular  = new Color3(1.00, 0.95, 0.78);

  addSkyDome(scene);      // first — behind everything
  buildTerrain(scene);
  buildRoad(scene);
  addRocks(scene);
  addTrees(scene);
  addGrassTufts(scene);
  addBoundaryWalls(scene);   // invisible walls at map edge

  const { chassis, chassisAggregate } = createCarChassis(scene);

  initInput();

  return { scene, chassis, chassisAggregate, camera };
}

// ============================================================
// ENTRY POINT
// ============================================================
(async () => {
  const { scene, chassis, chassisAggregate, camera } = await createScene();

  // Smooth camera follow — lerp target toward car each frame
  const cameraTarget = chassis.getAbsolutePosition().clone();

  engine.runRenderLoop(() => {
    applySuspension(chassis, chassisAggregate, scene);
    applyTireFriction(chassis, chassisAggregate, scene);
    applyDriveForces(chassis, chassisAggregate);
    applyUprightTorque(chassis, chassisAggregate);  // always land on wheels

    // Smooth lag follow
    const carPos   = chassis.getAbsolutePosition();
    const lerpSpeed = 0.10;
    cameraTarget.x += (carPos.x - cameraTarget.x) * lerpSpeed;
    cameraTarget.y += (carPos.y - cameraTarget.y) * lerpSpeed;
    cameraTarget.z += (carPos.z - cameraTarget.z) * lerpSpeed;
    camera.target.copyFrom(cameraTarget);

    scene.render();
  });

  window.addEventListener("resize", () => engine.resize());
})();