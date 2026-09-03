import {
  Engine,
  Scene,
  ArcRotateCamera,
  HemisphericLight,
  DirectionalLight,
  Vector3,
  MeshBuilder,
  Color3,
  StandardMaterial,
} from "@babylonjs/core";

const canvas = document.getElementById("renderCanvas") as HTMLCanvasElement;
const engine = new Engine(canvas, true);

function createScene(): Scene {
  const scene = new Scene(engine);

  // Camera — just for now, we'll swap for a follow-camera on the car later
  const camera = new ArcRotateCamera(
    "camera",
    -Math.PI / 2,
    Math.PI / 3,
    20,
    Vector3.Zero(),
    scene
  );
  camera.attachControl(canvas, true);

  // Ambient fill light
  const hemiLight = new HemisphericLight("hemiLight", new Vector3(0, 1, 0), scene);
  hemiLight.intensity = 0.6;

  // Directional light for shadows later
  const dirLight = new DirectionalLight("dirLight", new Vector3(-1, -2, -1), scene);
  dirLight.intensity = 0.8;

  // Ground plane
  const ground = MeshBuilder.CreateGround("ground", { width: 200, height: 200 }, scene);
  const groundMat = new StandardMaterial("groundMat", scene);
  groundMat.diffuseColor = new Color3(0.3, 0.6, 0.3);
  ground.material = groundMat;

  // A test cube so we know things are rendering
  const box = MeshBuilder.CreateBox("box", { size: 2 }, scene);
  box.position.y = 1;

  return scene;
}

const scene = createScene();

engine.runRenderLoop(() => {
  scene.render();
});

window.addEventListener("resize", () => {
  engine.resize();
});