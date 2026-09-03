import HavokPhysics from "@babylonjs/havok";
import {
  Engine, Scene, ArcRotateCamera, HemisphericLight, DirectionalLight,
  Vector3, MeshBuilder, Color3, Color4, StandardMaterial, HavokPlugin,
  PhysicsAggregate, PhysicsShapeType, GroundMesh,
} from "@babylonjs/core";

const canvas = document.getElementById("renderCanvas") as HTMLCanvasElement;
const engine = new Engine(canvas, true);

async function createScene(): Promise<Scene> {
  const scene = new Scene(engine);

  scene.clearColor = new Color4(0.48, 0.42, 0.35, 1);
  scene.fogMode = Scene.FOGMODE_EXP2;
  scene.fogColor = new Color3(0.55, 0.5, 0.43);
  scene.fogDensity = 0.012;

  const havokInstance = await HavokPhysics();
  const physicsPlugin = new HavokPlugin(true, havokInstance);
  scene.enablePhysics(new Vector3(0, -9.81, 0), physicsPlugin);

  const camera = new ArcRotateCamera("camera", -Math.PI / 2, Math.PI / 4, 30, new Vector3(0, 2, 0), scene);
  camera.lowerRadiusLimit = 5;
  camera.upperRadiusLimit = 80;
  camera.attachControl(canvas, true);

  const hemiLight = new HemisphericLight("hemiLight", new Vector3(0, 1, 0), scene);
  hemiLight.intensity = 0.5;
  hemiLight.groundColor = new Color3(0.3, 0.25, 0.2);

  const dirLight = new DirectionalLight("dirLight", new Vector3(-1, -2, -1), scene);
  dirLight.intensity = 1.0;
  dirLight.diffuse = new Color3(1, 0.95, 0.8);

  buildTerrain(scene);
  buildRoad(scene);
  addRocks(scene);
  createCarChassis(scene);

  return scene;
}

function smoothNoise(x: number, z: number, scale: number, amplitude: number): number {
  const ix = Math.floor(x / scale);
  const iz = Math.floor(z / scale);
  const fx = x / scale - ix;
  const fz = z / scale - iz;
  const rand = (a: number, b: number) => Math.abs(Math.sin(a * 127.1 + b * 311.7) * 43758.5453) % 1;
  const v00 = rand(ix,     iz);
  const v10 = rand(ix + 1, iz);
  const v01 = rand(ix,     iz + 1);
  const v11 = rand(ix + 1, iz + 1);
  const ux = fx * fx * (3 - 2 * fx);
  const uz = fz * fz * (3 - 2 * fz);
  return (v00*(1-ux)*(1-uz) + v10*ux*(1-uz) + v01*(1-ux)*uz + v11*ux*uz) * amplitude;
}

function terrainHeight(x: number, z: number): number {
  let h = 0;
  h += smoothNoise(x, z, 40, 6);
  h += smoothNoise(x, z, 15, 2);
  h += smoothNoise(x, z, 5, 0.5);
  const roadBlend = Math.min(1, Math.abs(x) / 5);
  return h * roadBlend;
}

function buildTerrain(scene: Scene): GroundMesh {
  const ground = MeshBuilder.CreateGround(
    "ground",
    { width: 200, height: 200, subdivisions: 80, updatable: true },
    scene
  ) as GroundMesh;

  const positions = ground.getVerticesData("position") as Float32Array;
  for (let i = 0; i < positions.length; i += 3) {
    positions[i + 1] = terrainHeight(positions[i], positions[i + 2]);
  }
  ground.updateVerticesData("position", positions);
  ground.createNormals(true);

  const mat = new StandardMaterial("terrainMat", scene);
  mat.diffuseColor = new Color3(0.35, 0.28, 0.18);
  mat.specularColor = new Color3(0.05, 0.04, 0.03);
  ground.material = mat;

  new PhysicsAggregate(ground, PhysicsShapeType.MESH, { mass: 0, friction: 0.9, restitution: 0 }, scene);
  return ground;
}

function buildRoad(scene: Scene): void {
  const road = MeshBuilder.CreateGround(
    "road",
    { width: 8, height: 200, subdivisions: 60, updatable: true },
    scene
  ) as GroundMesh;

  const positions = road.getVerticesData("position") as Float32Array;
  for (let i = 0; i < positions.length; i += 3) {
    positions[i + 1] = smoothNoise(positions[i], positions[i + 2], 12, 0.25) + 0.02;
  }
  road.updateVerticesData("position", positions);
  road.createNormals(true);

  const roadMat = new StandardMaterial("roadMat", scene);
  roadMat.diffuseColor = new Color3(0.22, 0.17, 0.1);
  roadMat.specularColor = new Color3(0.08, 0.06, 0.04);
  road.material = roadMat;

  for (const xOff of [-1.5, 1.5]) {
    const track = MeshBuilder.CreateGround(`track_${xOff}`, { width: 0.6, height: 200, subdivisions: 1 }, scene);
    track.position.x = xOff;
    track.position.y = 0.03;
    const trackMat = new StandardMaterial(`trackMat_${xOff}`, scene);
    trackMat.diffuseColor = new Color3(0.14, 0.1, 0.06);
    track.material = trackMat;
  }
}

function addRocks(scene: Scene): void {
  const rng = (seed: number) => Math.abs(Math.sin(seed * 9301 + 49297) * 233280) % 1;
  for (let i = 0; i < 40; i++) {
    let rx = (rng(i * 3) - 0.5) * 180;
    const rz = (rng(i * 3 + 1) - 0.5) * 180;
    if (Math.abs(rx) < 8) rx = rx < 0 ? -10 : 10;
    const ry = terrainHeight(rx, rz);
    const w = 0.5 + rng(i * 3 + 2) * 2;
    const h = 0.4 + rng(i * 7) * 1.5;
    const d = 0.5 + rng(i * 11) * 2;

    const rock = MeshBuilder.CreateBox(`rock_${i}`, { width: w, height: h, depth: d }, scene);
    rock.position.set(rx, ry + h / 2, rz);
    rock.rotation.y = rng(i * 5) * Math.PI;
    rock.rotation.z = (rng(i * 13) - 0.5) * 0.4;

    const shade = 0.3 + rng(i * 17) * 0.3;
    const rockMat = new StandardMaterial(`rockMat_${i}`, scene);
    rockMat.diffuseColor = new Color3(shade, shade - 0.02, shade - 0.05);
    rockMat.specularColor = new Color3(0.1, 0.1, 0.1);
    rock.material = rockMat;

    new PhysicsAggregate(rock, PhysicsShapeType.BOX, { mass: 0, friction: 0.8, restitution: 0.1 }, scene);
  }
}

function createCarChassis(scene: Scene) {
  const chassis = MeshBuilder.CreateBox("chassis", { width: 2, height: 0.5, depth: 4 }, scene);
  chassis.position.set(0, 6, 0);

  const chassisMat = new StandardMaterial("chassisMat", scene);
  chassisMat.diffuseColor = new Color3(0.8, 0.15, 0.1);
  chassisMat.specularColor = new Color3(0.4, 0.2, 0.1);
  chassis.material = chassisMat;

  const chassisAggregate = new PhysicsAggregate(
    chassis,
    PhysicsShapeType.BOX,
    { mass: 300, friction: 0.5, restitution: 0.05 },
    scene
  );

  return { chassis, chassisAggregate };
}

(async () => {
  const scene = await createScene();

  engine.runRenderLoop(() => {
    scene.render();
  });

  window.addEventListener("resize", () => {
    engine.resize();
  });
})();
