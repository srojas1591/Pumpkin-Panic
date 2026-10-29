import * as THREE from "three";
import { GameLoop } from "./engine";
import { Input } from "./input";
import { GameStateMachine } from "./state";
import { AudioSystem } from "./audio";
import { storage } from "./storage";
import { COLORS, GAME_CONFIG, QUALITY } from "./config";

type EnemyKind = "pumpkin" | "bat";
type EnemyState = "chase" | "windup" | "charge";

interface Enemy {
  group: THREE.Group;
  kind: EnemyKind;
  active: boolean;
  state: EnemyState;
  timer: number;
  phase: number;
  velocity: THREE.Vector3;
  warning: THREE.Mesh;
  bodyMaterial: THREE.MeshStandardMaterial;
  wingL?: THREE.Object3D;
  wingR?: THREE.Object3D;
}

interface CandyItem {
  group: THREE.Group;
  active: boolean;
  phase: number;
}

interface Particle {
  active: boolean;
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  life: number;
  maxLife: number;
  size: number;
}

interface GameDebug {
  win: () => void;
  lose: () => void;
  busy: () => void;
  timeScale: (value: number) => void;
  state: () => string;
  snapshot: () => {
    player: { x: number; z: number };
    candies: Array<{ x: number; z: number }>;
    enemies: Array<{ x: number; z: number; kind: EnemyKind }>;
    score: number;
    collected: number;
    hearts: number;
    dashCooldown: number;
    timeLeft: number;
  };
  stats: () => {
    fps: number;
    drawCalls: number;
    triangles: number;
    enemies: number;
    particles: number;
    renderer: string;
  };
}

declare global {
  interface Window {
    __gameProbe?: () => { x: number; y: number; z: number };
    __GAME_READY__?: boolean;
    __gameDebug?: GameDebug;
  }
}

let session: { dispose: () => void } | null = null;

export function startGame(canvas: HTMLCanvasElement): void {
  stopGame();
  window.__GAME_READY__ = false;

  const el = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
  const hud = el("hud");
  const titleScreen = el("title-screen");
  const pauseScreen = el("pause-screen");
  const endScreen = el("end-screen");
  const dashWidget = el("dash-widget");
  const touchControls = el("touch-controls");
  const comboBadge = el("combo-badge");
  const footer = el("game-footer");
  const muteButton = el<HTMLButtonElement>("mute-btn");
  const dashButton = el<HTMLButtonElement>("dash-btn");
  const damageFlash = el("damage-flash");
  const toast = el("toast");

  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    preserveDrawingBuffer: true,
    powerPreference: "high-performance",
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.12;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(COLORS.background);
  scene.fog = new THREE.FogExp2(COLORS.background, 0.026);

  const camera = new THREE.PerspectiveCamera(46, window.innerWidth / window.innerHeight, 0.1, 120);
  camera.position.set(-2.5, 14.5, 14);
  const cameraTarget = new THREE.Vector3(-2.5, 0, -1.2);
  const cameraDesired = new THREE.Vector3();

  const hemi = new THREE.HemisphereLight(0xa89ce8, 0x21132e, 2.25);
  scene.add(hemi);
  scene.add(new THREE.AmbientLight(0x8f81bd, 0.42));
  const moonLight = new THREE.DirectionalLight(0xcbd5ff, 3.1);
  moonLight.position.set(-7, 13, 5);
  moonLight.castShadow = true;
  moonLight.shadow.mapSize.set(1024, 1024);
  moonLight.shadow.camera.left = -16;
  moonLight.shadow.camera.right = 16;
  moonLight.shadow.camera.top = 16;
  moonLight.shadow.camera.bottom = -16;
  moonLight.shadow.camera.near = 1;
  moonLight.shadow.camera.far = 40;
  moonLight.shadow.bias = -0.0008;
  scene.add(moonLight);
  const warmFill = new THREE.PointLight(0xff7a28, 14, 16, 2);
  warmFill.position.set(5, 4, 1);
  scene.add(warmFill);

  const decorRng = mulberry32(0x4a11);
  const groundMaterial = new THREE.MeshStandardMaterial({ color: COLORS.ground, roughness: 0.96, metalness: 0.02 });
  const ground = new THREE.Mesh(new THREE.CylinderGeometry(15, 15.5, 0.65, 64), groundMaterial);
  ground.position.y = -0.38;
  ground.receiveShadow = true;
  scene.add(ground);

  const innerGround = new THREE.Mesh(
    new THREE.CircleGeometry(12.35, 64),
    new THREE.MeshStandardMaterial({ color: 0x291c40, roughness: 1 }),
  );
  innerGround.rotation.x = -Math.PI / 2;
  innerGround.position.y = -0.045;
  innerGround.receiveShadow = true;
  scene.add(innerGround);

  const ringMaterial = new THREE.MeshBasicMaterial({ color: 0x65468c, transparent: true, opacity: 0.22, side: THREE.DoubleSide });
  for (const radius of [3.8, 8.2]) {
    const ring = new THREE.Mesh(new THREE.RingGeometry(radius - 0.035, radius + 0.035, 80), ringMaterial);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = -0.025;
    scene.add(ring);
  }
  const arenaRing = new THREE.Mesh(
    new THREE.TorusGeometry(12.45, 0.065, 6, 96),
    new THREE.MeshStandardMaterial({ color: 0x8258bd, emissive: 0x4d276f, emissiveIntensity: 1.3 }),
  );
  arenaRing.rotation.x = Math.PI / 2;
  arenaRing.position.y = 0.015;
  scene.add(arenaRing);

  // The moon and its generated halo need no downloaded texture.
  const moon = new THREE.Mesh(new THREE.SphereGeometry(2.25, 24, 18), new THREE.MeshBasicMaterial({ color: 0xffedc7 }));
  moon.position.set(-9, 11, -22);
  scene.add(moon);
  const haloCanvas = document.createElement("canvas");
  haloCanvas.width = haloCanvas.height = 128;
  const haloContext = haloCanvas.getContext("2d")!;
  const haloGradient = haloContext.createRadialGradient(64, 64, 8, 64, 64, 64);
  haloGradient.addColorStop(0, "rgba(255,235,190,.42)");
  haloGradient.addColorStop(0.35, "rgba(190,170,255,.14)");
  haloGradient.addColorStop(1, "rgba(120,90,200,0)");
  haloContext.fillStyle = haloGradient;
  haloContext.fillRect(0, 0, 128, 128);
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(haloCanvas), transparent: true, depthWrite: false }));
  halo.position.copy(moon.position);
  halo.scale.set(10, 10, 1);
  scene.add(halo);

  const starPositions = new Float32Array(150 * 3);
  for (let i = 0; i < 150; i++) {
    const angle = decorRng() * Math.PI * 2;
    const radius = 24 + decorRng() * 30;
    starPositions[i * 3] = Math.cos(angle) * radius;
    starPositions[i * 3 + 1] = 6 + decorRng() * 25;
    starPositions[i * 3 + 2] = Math.sin(angle) * radius - 8;
  }
  const starGeometry = new THREE.BufferGeometry();
  starGeometry.setAttribute("position", new THREE.BufferAttribute(starPositions, 3));
  scene.add(new THREE.Points(starGeometry, new THREE.PointsMaterial({ color: 0xc9c0ff, size: 0.11, transparent: true, opacity: 0.75, sizeAttenuation: true })));

  const dummy = new THREE.Object3D();
  const tombstones = new THREE.InstancedMesh(
    new THREE.CapsuleGeometry(0.43, 0.55, 3, 7),
    new THREE.MeshStandardMaterial({ color: 0x514664, roughness: 0.95 }),
    28,
  );
  for (let i = 0; i < 28; i++) {
    const angle = (i / 28) * Math.PI * 2 + (decorRng() - 0.5) * 0.13;
    const radius = 12.9 + decorRng() * 1.25;
    dummy.position.set(Math.cos(angle) * radius, 0.42, Math.sin(angle) * radius);
    dummy.rotation.set((decorRng() - 0.5) * 0.18, -angle + decorRng() * 0.5, (decorRng() - 0.5) * 0.15);
    dummy.scale.set(0.8 + decorRng() * 0.4, 0.75 + decorRng() * 0.65, 0.36);
    dummy.updateMatrix();
    tombstones.setMatrixAt(i, dummy.matrix);
  }
  tombstones.receiveShadow = true;
  scene.add(tombstones);

  const fence = new THREE.InstancedMesh(
    new THREE.BoxGeometry(0.13, 1.25, 0.13),
    new THREE.MeshStandardMaterial({ color: 0x241a35, roughness: 0.9 }),
    52,
  );
  for (let i = 0; i < 52; i++) {
    const angle = (i / 52) * Math.PI * 2;
    dummy.position.set(Math.cos(angle) * 14.65, 0.4, Math.sin(angle) * 14.65);
    dummy.rotation.set(0, -angle, (i % 2 ? 1 : -1) * 0.05);
    dummy.scale.set(1, 1, 1);
    dummy.updateMatrix();
    fence.setMatrixAt(i, dummy.matrix);
  }
  scene.add(fence);

  const grass = new THREE.InstancedMesh(
    new THREE.ConeGeometry(0.1, 0.72, 3),
    new THREE.MeshStandardMaterial({ color: 0x334038, roughness: 1 }),
    90,
  );
  for (let i = 0; i < 90; i++) {
    const angle = decorRng() * Math.PI * 2;
    const radius = 9.2 + decorRng() * 5.2;
    dummy.position.set(Math.cos(angle) * radius, 0.2, Math.sin(angle) * radius);
    dummy.rotation.set((decorRng() - 0.5) * 0.3, decorRng() * Math.PI, (decorRng() - 0.5) * 0.35);
    const scale = 0.55 + decorRng();
    dummy.scale.set(scale, scale, scale);
    dummy.updateMatrix();
    grass.setMatrixAt(i, dummy.matrix);
  }
  scene.add(grass);

  // Parametric dead trees, batched into one instanced draw call.
  const treeParts = new THREE.InstancedMesh(
    new THREE.CylinderGeometry(1, 1, 1, 6),
    new THREE.MeshStandardMaterial({ color: 0x21162d, roughness: 1 }),
    32,
  );
  const yAxis = new THREE.Vector3(0, 1, 0);
  const branchStart = new THREE.Vector3();
  const branchEnd = new THREE.Vector3();
  const branchDirection = new THREE.Vector3();
  let treePartIndex = 0;
  const setBranch = (ax: number, ay: number, az: number, bx: number, by: number, bz: number, radius: number) => {
    branchStart.set(ax, ay, az);
    branchEnd.set(bx, by, bz);
    branchDirection.subVectors(branchEnd, branchStart);
    const length = branchDirection.length();
    dummy.position.copy(branchStart).add(branchEnd).multiplyScalar(0.5);
    dummy.quaternion.setFromUnitVectors(yAxis, branchDirection.normalize());
    dummy.scale.set(radius, length, radius);
    dummy.updateMatrix();
    treeParts.setMatrixAt(treePartIndex++, dummy.matrix);
  };
  for (let i = 0; i < 8; i++) {
    const angle = (i / 8) * Math.PI * 2 + 0.2;
    const radius = 13.7;
    const x = Math.cos(angle) * radius;
    const z = Math.sin(angle) * radius;
    const height = 2.8 + decorRng() * 1.3;
    setBranch(x, 0, z, x + 0.15, height, z, 0.18);
    setBranch(x + 0.08, height * 0.55, z, x + Math.cos(angle + 1.2) * 1.15, height * 0.9, z + Math.sin(angle + 1.2) * 1.15, 0.1);
    setBranch(x + 0.1, height * 0.7, z, x + Math.cos(angle - 1.1) * 0.95, height * 1.07, z + Math.sin(angle - 1.1) * 0.95, 0.085);
    setBranch(x + 0.12, height * 0.84, z, x + 0.25, height * 1.25, z - 0.2, 0.07);
  }
  scene.add(treeParts);

  // Player: a tiny, expressive ghost made from reusable primitives.
  const player = new THREE.Group();
  const ghostMaterial = new THREE.MeshStandardMaterial({
    color: 0xb8ffe4,
    emissive: 0x43b895,
    emissiveIntensity: 0.68,
    roughness: 0.55,
    transparent: true,
  });
  const ghostGeometry = new THREE.SphereGeometry(0.64, 20, 16);
  const ghostBody = new THREE.Mesh(ghostGeometry, ghostMaterial);
  ghostBody.scale.set(1, 1.08, 0.94);
  ghostBody.position.y = 0.25;
  ghostBody.castShadow = true;
  player.add(ghostBody);
  for (let i = 0; i < 3; i++) {
    const tail = new THREE.Mesh(ghostGeometry, ghostMaterial);
    tail.scale.set(0.43, 0.35, 0.43);
    tail.position.set((i - 1) * 0.38, -0.28 + (i === 1 ? -0.08 : 0), 0);
    player.add(tail);
  }
  const eyeMaterial = new THREE.MeshBasicMaterial({ color: 0x10231f });
  const eyeGeometry = new THREE.SphereGeometry(0.095, 10, 8);
  for (const side of [-1, 1]) {
    const eye = new THREE.Mesh(eyeGeometry, eyeMaterial);
    eye.scale.set(0.82, 1.25, 0.5);
    eye.position.set(side * 0.22, 0.38, 0.57);
    player.add(eye);
    const arm = new THREE.Mesh(ghostGeometry, ghostMaterial);
    arm.scale.set(0.32, 0.18, 0.24);
    arm.position.set(side * 0.68, 0.08, 0);
    arm.rotation.z = side * -0.35;
    player.add(arm);
  }
  const mouth = new THREE.Mesh(new THREE.SphereGeometry(0.075, 10, 8), eyeMaterial);
  mouth.scale.set(0.8, 1.15, 0.45);
  mouth.position.set(0, 0.13, 0.6);
  player.add(mouth);
  player.position.set(0, 0.92, 0);
  scene.add(player);
  const playerGlow = new THREE.PointLight(COLORS.mint, 4.5, 5.5, 2);
  playerGlow.position.set(0, 1.2, 0);
  scene.add(playerGlow);
  const playerShadow = new THREE.Mesh(
    new THREE.CircleGeometry(0.66, 24),
    new THREE.MeshBasicMaterial({ color: 0x05030b, transparent: true, opacity: 0.32, depthWrite: false }),
  );
  playerShadow.rotation.x = -Math.PI / 2;
  playerShadow.position.y = 0.015;
  scene.add(playerShadow);

  // Shared candy geometry, with per-slot color variation.
  const candyCenterGeometry = new THREE.SphereGeometry(0.29, 12, 9);
  const candyWrapGeometry = new THREE.ConeGeometry(0.23, 0.35, 6);
  const candyMaterials = [
    new THREE.MeshStandardMaterial({ color: 0xffc94f, emissive: 0x8a3d08, emissiveIntensity: 0.55, roughness: 0.4 }),
    new THREE.MeshStandardMaterial({ color: 0xff719d, emissive: 0x741838, emissiveIntensity: 0.45, roughness: 0.4 }),
    new THREE.MeshStandardMaterial({ color: 0x9c84ff, emissive: 0x352178, emissiveIntensity: 0.5, roughness: 0.4 }),
  ];
  const candies: CandyItem[] = [];
  for (let i = 0; i < GAME_CONFIG.ACTIVE_CANDY; i++) {
    const group = new THREE.Group();
    const material = candyMaterials[i % candyMaterials.length];
    const center = new THREE.Mesh(candyCenterGeometry, material);
    center.scale.set(1.2, 0.82, 0.82);
    group.add(center);
    for (const side of [-1, 1]) {
      const wrap = new THREE.Mesh(candyWrapGeometry, material);
      wrap.position.x = side * 0.43;
      wrap.rotation.z = side * -Math.PI / 2;
      group.add(wrap);
    }
    group.visible = false;
    scene.add(group);
    candies.push({ group, active: false, phase: i * 0.9 });
  }

  const darkFaceMaterial = new THREE.MeshBasicMaterial({ color: 0x1b0b13 });
  const pumpkinLobeGeometry = new THREE.SphereGeometry(0.49, 12, 9);
  const pumpkinEyeGeometry = new THREE.ConeGeometry(0.115, 0.045, 3);
  const stemGeometry = new THREE.CylinderGeometry(0.07, 0.11, 0.27, 6);
  const stemMaterial = new THREE.MeshStandardMaterial({ color: 0x416030, roughness: 0.9 });
  const warningGeometry = new THREE.RingGeometry(0.66, 0.77, 32);

  const createPumpkin = (): Enemy => {
    const group = new THREE.Group();
    const bodyMaterial = new THREE.MeshStandardMaterial({ color: COLORS.orange, emissive: 0x6d1703, emissiveIntensity: 0.25, roughness: 0.72 });
    for (let i = 0; i < 5; i++) {
      const angle = (i / 5) * Math.PI * 2;
      const lobe = new THREE.Mesh(pumpkinLobeGeometry, bodyMaterial);
      lobe.position.set(Math.cos(angle) * 0.19, 0.52, Math.sin(angle) * 0.19);
      lobe.scale.set(0.83, 1, 0.83);
      lobe.castShadow = true;
      group.add(lobe);
    }
    const stem = new THREE.Mesh(stemGeometry, stemMaterial);
    stem.position.set(0.04, 1.03, 0);
    stem.rotation.z = -0.18;
    group.add(stem);
    for (const side of [-1, 1]) {
      const eye = new THREE.Mesh(pumpkinEyeGeometry, darkFaceMaterial);
      eye.position.set(side * 0.19, 0.64, 0.48);
      eye.rotation.set(Math.PI / 2, 0, side * 0.15);
      group.add(eye);
    }
    const mouthMesh = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.075, 0.035), darkFaceMaterial);
    mouthMesh.position.set(0, 0.39, 0.51);
    group.add(mouthMesh);
    const warning = new THREE.Mesh(warningGeometry, new THREE.MeshBasicMaterial({ color: 0xff9a38, transparent: true, opacity: 0.78, side: THREE.DoubleSide, depthWrite: false }));
    warning.rotation.x = -Math.PI / 2;
    warning.position.y = 0.035;
    warning.visible = false;
    group.add(warning);
    group.visible = false;
    scene.add(group);
    return { group, kind: "pumpkin", active: false, state: "chase", timer: 0, phase: 0, velocity: new THREE.Vector3(), warning, bodyMaterial };
  };

  const createBat = (): Enemy => {
    const group = new THREE.Group();
    const bodyMaterial = new THREE.MeshStandardMaterial({ color: 0x51346f, emissive: 0x271334, emissiveIntensity: 0.5, roughness: 0.68 });
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.36, 12, 9), bodyMaterial);
    body.scale.set(0.85, 1, 1.15);
    body.castShadow = true;
    group.add(body);
    const wingGeometry = new THREE.ConeGeometry(0.62, 0.13, 3);
    const wingL = new THREE.Mesh(wingGeometry, bodyMaterial);
    wingL.position.x = -0.58;
    wingL.rotation.z = Math.PI / 2;
    wingL.scale.z = 1.4;
    group.add(wingL);
    const wingR = new THREE.Mesh(wingGeometry, bodyMaterial);
    wingR.position.x = 0.58;
    wingR.rotation.z = -Math.PI / 2;
    wingR.scale.z = 1.4;
    group.add(wingR);
    const batEyeMaterial = new THREE.MeshBasicMaterial({ color: 0xffd76a });
    for (const side of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.055, 8, 6), batEyeMaterial);
      eye.position.set(side * 0.12, 0.1, 0.34);
      group.add(eye);
      const ear = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.27, 4), bodyMaterial);
      ear.position.set(side * 0.17, 0.35, 0);
      group.add(ear);
    }
    const warning = new THREE.Mesh(warningGeometry, new THREE.MeshBasicMaterial({ color: 0xcf80ff, transparent: true, opacity: 0.75, side: THREE.DoubleSide, depthWrite: false }));
    warning.rotation.x = -Math.PI / 2;
    warning.position.y = -0.88;
    warning.visible = false;
    group.add(warning);
    group.visible = false;
    scene.add(group);
    return { group, kind: "bat", active: false, state: "chase", timer: 0, phase: 0, velocity: new THREE.Vector3(), warning, bodyMaterial, wingL, wingR };
  };

  const enemies: Enemy[] = [];
  for (let i = 0; i < 8; i++) enemies.push(createPumpkin());
  for (let i = 0; i < 6; i++) enemies.push(createBat());

  // One instanced mesh renders the entire pooled particle budget.
  const particleMesh = new THREE.InstancedMesh(
    new THREE.IcosahedronGeometry(0.085, 0),
    new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.92, depthWrite: false }),
    GAME_CONFIG.MAX_PARTICLES,
  );
  particleMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  particleMesh.frustumCulled = false;
  scene.add(particleMesh);
  const particles: Particle[] = [];
  for (let i = 0; i < GAME_CONFIG.MAX_PARTICLES; i++) {
    particles.push({ active: false, position: new THREE.Vector3(), velocity: new THREE.Vector3(), life: 0, maxLife: 1, size: 1 });
    dummy.position.set(0, -20, 0);
    dummy.scale.setScalar(0);
    dummy.updateMatrix();
    particleMesh.setMatrixAt(i, dummy.matrix);
  }
  particleMesh.instanceMatrix.needsUpdate = true;

  const input = new Input(canvas);
  const audio = new AudioSystem();
  const machine = new GameStateMachine();
  let rng = mulberry32(0xca11);
  let runCount = 0;
  let elapsed = 0;
  let timeLeft: number = GAME_CONFIG.ROUND_TIME;
  let score = 0;
  let hearts: number = GAME_CONFIG.START_HEARTS;
  let collected = 0;
  let combo = 0;
  let comboTimer = 0;
  let spawnTimer = 3;
  let dashTimer = 0;
  let dashCooldown = 0;
  let invulnerable = 0;
  let shake = 0;
  let visualTime = 0;
  let debugTimeScale = 1;
  let toastTimer = 0;
  let trailTimer = 0;
  let particleCursor = 0;
  let lowQuality = false;
  let fps = 60;
  let fpsFrames = 0;
  let fpsSampleStart = performance.now();
  const playerVelocity = new THREE.Vector3();
  const dashDirection = new THREE.Vector3(0, 0, -1);
  const tempDirection = new THREE.Vector3();
  const tempPosition = new THREE.Vector3();
  const tempColor = new THREE.Color();
  let bestScore = Math.max(0, Number(storage.get<number>("pumpkinPanicBest", 0)) || 0);

  const formatScore = (value: number) => Math.max(0, Math.round(value)).toString().padStart(6, "0");
  const setText = (id: string, value: string) => {
    const node = el(id);
    if (node.textContent !== value) node.textContent = value;
  };
  const showToast = (message: string, duration = 1) => {
    toast.textContent = message;
    toast.classList.add("show");
    toastTimer = duration;
  };
  const updateMuteButton = () => {
    muteButton.classList.toggle("muted", audio.muted);
    muteButton.setAttribute("aria-label", audio.muted ? "Unmute audio" : "Mute audio");
  };
  updateMuteButton();
  setText("title-best", formatScore(bestScore));

  const syncUI = () => {
    const state = machine.state;
    const playing = state === "playing";
    const inRun = playing || state === "paused";
    titleScreen.classList.toggle("is-hidden", state !== "title");
    pauseScreen.classList.toggle("is-hidden", state !== "paused");
    endScreen.classList.toggle("is-hidden", state !== "gameover" && state !== "victory");
    hud.classList.toggle("is-hidden", !inRun);
    dashWidget.classList.toggle("is-hidden", !playing);
    touchControls.classList.toggle("is-hidden", !playing);
    footer.classList.toggle("is-hidden", !playing);
    if (!playing) comboBadge.classList.add("is-hidden");
  };

  const randomArenaPosition = (minPlayerDistance: number, maxRadius: number, out: THREE.Vector3) => {
    for (let attempt = 0; attempt < 12; attempt++) {
      const angle = rng() * Math.PI * 2;
      const radius = Math.sqrt(rng()) * maxRadius;
      out.set(Math.cos(angle) * radius, 0, Math.sin(angle) * radius);
      if (out.distanceToSquared(player.position) >= minPlayerDistance * minPlayerDistance) return out;
    }
    out.set(maxRadius * 0.7, 0, -maxRadius * 0.7);
    return out;
  };

  const spawnCandy = () => {
    const candy = candies.find((item) => !item.active);
    if (!candy) return;
    randomArenaPosition(2.2, 10.7, tempPosition);
    candy.group.position.set(tempPosition.x, 0.72, tempPosition.z);
    candy.group.rotation.y = rng() * Math.PI * 2;
    candy.phase = rng() * Math.PI * 2;
    candy.active = true;
    candy.group.visible = true;
  };

  const spawnEnemy = (requested?: EnemyKind) => {
    const kind = requested ?? (elapsed > 8 && rng() > 0.62 ? "bat" : "pumpkin");
    let enemy = enemies.find((item) => !item.active && item.kind === kind);
    if (!enemy) enemy = enemies.find((item) => !item.active);
    if (!enemy) return;
    randomArenaPosition(6, 10.9, tempPosition);
    enemy.group.position.set(tempPosition.x, enemy.kind === "bat" ? 1.05 : 0, tempPosition.z);
    enemy.group.scale.setScalar(1);
    enemy.group.visible = true;
    enemy.active = true;
    enemy.state = "chase";
    enemy.timer = enemy.kind === "bat" ? 2.1 : 1.8 + rng() * 1.3;
    enemy.phase = rng() * Math.PI * 2;
    enemy.velocity.set(0, 0, 0);
    enemy.warning.visible = false;
    enemy.bodyMaterial.emissiveIntensity = enemy.kind === "bat" ? 0.5 : 0.25;
  };

  const resetRun = () => {
    rng = mulberry32(0xca11 + runCount * 97);
    elapsed = 0;
    timeLeft = GAME_CONFIG.ROUND_TIME;
    score = 0;
    hearts = GAME_CONFIG.START_HEARTS;
    collected = 0;
    combo = 0;
    comboTimer = 0;
    spawnTimer = 5.2;
    dashTimer = 0;
    dashCooldown = 0;
    invulnerable = 0;
    shake = 0;
    trailTimer = 0;
    playerVelocity.set(0, 0, 0);
    dashDirection.set(0, 0, -1);
    player.position.set(0, 0.92, 0);
    player.rotation.set(0, 0, 0);
    player.scale.setScalar(1);
    ghostMaterial.opacity = 1;
    for (const enemy of enemies) {
      enemy.active = false;
      enemy.group.visible = false;
      enemy.warning.visible = false;
    }
    for (const candy of candies) {
      candy.active = false;
      candy.group.visible = false;
    }
    for (const particle of particles) particle.active = false;
    for (let i = 0; i < GAME_CONFIG.ACTIVE_CANDY; i++) spawnCandy();
    spawnEnemy("pumpkin");
    updateHUD();
  };

  const startRun = () => {
    if (machine.is("playing")) return;
    runCount++;
    resetRun();
    machine.transition("playing");
    audio.sfx("ui");
    audio.startMusic();
    syncUI();
    showToast("Collect 12 candies before moonset!", 2.1);
  };

  const pauseRun = () => {
    if (!machine.is("playing")) return;
    toastTimer = 0;
    toast.classList.remove("show");
    machine.transition("paused");
    audio.sfx("ui");
    syncUI();
  };

  const resumeRun = () => {
    if (!machine.is("paused")) return;
    machine.transition("playing");
    audio.sfx("ui");
    syncUI();
  };

  const backToTitle = () => {
    if (!machine.is("gameover", "victory", "paused", "playing")) return;
    machine.transition("title");
    audio.stopMusic();
    resetRun();
    setText("title-best", formatScore(bestScore));
    syncUI();
  };

  const endRun = (won: boolean) => {
    if (!machine.is("playing")) return;
    toastTimer = 0;
    toast.classList.remove("show");
    if (won) score += Math.ceil(timeLeft) * 25;
    const isNewBest = score > bestScore;
    if (isNewBest) {
      bestScore = score;
      storage.set("pumpkinPanicBest", bestScore);
    }
    machine.transition(won ? "victory" : "gameover");
    audio.stopMusic();
    audio.sfx(won ? "win" : "lose");
    setText("end-kicker", won ? "SUGAR RUSH" : timeLeft <= 0 ? "THE MOON HAS SET" : "SPIRIT DISPERSED");
    setText("end-title", won ? "HAUNT COMPLETE!" : timeLeft <= 0 ? "OUT OF TIME" : "GHOSTED!");
    setText("end-message", won ? "You got the goods and ghosted." : timeLeft <= 0 ? "So close! Candy adds precious moonlight." : "Those pumpkins have no manners.");
    setText("end-score", formatScore(score));
    setText("end-best", formatScore(bestScore));
    setText("end-candy", `${collected} / ${GAME_CONFIG.CANDY_TARGET}`);
    el("new-best").classList.toggle("is-hidden", !isNewBest);
    setText("title-best", formatScore(bestScore));
    syncUI();
  };

  const spawnBurst = (x: number, y: number, z: number, color: number, count: number, speed: number) => {
    const limit = lowQuality ? QUALITY.PARTICLES_LOW : QUALITY.PARTICLES_HIGH;
    tempColor.setHex(color);
    for (let n = 0; n < count; n++) {
      const index = particleCursor++ % limit;
      const particle = particles[index];
      const angle = rng() * Math.PI * 2;
      const horizontal = speed * (0.35 + rng() * 0.65);
      particle.active = true;
      particle.position.set(x, y, z);
      particle.velocity.set(Math.cos(angle) * horizontal, speed * (0.25 + rng() * 0.65), Math.sin(angle) * horizontal);
      particle.maxLife = particle.life = 0.4 + rng() * 0.45;
      particle.size = 0.65 + rng() * 1.25;
      particleMesh.setColorAt(index, tempColor);
    }
    if (particleMesh.instanceColor) particleMesh.instanceColor.needsUpdate = true;
  };

  const banishEnemy = (enemy: Enemy) => {
    enemy.active = false;
    enemy.group.visible = false;
    enemy.warning.visible = false;
    const bonus = 75 * Math.max(1, combo);
    score += bonus;
    spawnBurst(enemy.group.position.x, enemy.group.position.y + 0.6, enemy.group.position.z, enemy.kind === "bat" ? 0xbb82ff : COLORS.orange, 15, 4.5);
    audio.sfx("explosion");
    shake = Math.max(shake, 0.14);
    showToast(`BANISHED  +${bonus}`, 0.65);
  };

  const hitPlayer = (enemy: Enemy) => {
    hearts--;
    invulnerable = 2.15;
    combo = 0;
    comboTimer = 0;
    tempDirection.subVectors(player.position, enemy.group.position).setY(0);
    if (tempDirection.lengthSq() < 0.01) tempDirection.set(1, 0, 0);
    tempDirection.normalize();
    playerVelocity.addScaledVector(tempDirection, 7.5);
    enemy.group.position.addScaledVector(tempDirection, -2.2);
    enemy.velocity.copy(tempDirection).multiplyScalar(-4);
    enemy.state = "chase";
    enemy.timer = 2.2;
    enemy.warning.visible = false;
    shake = 0.5;
    audio.sfx("hit");
    spawnBurst(player.position.x, player.position.y + 0.3, player.position.z, 0xff5685, 18, 4);
    damageFlash.classList.remove("flash");
    void damageFlash.offsetWidth;
    damageFlash.classList.add("flash");
    showToast(hearts > 0 ? `${hearts} spirit ${hearts === 1 ? "heart" : "hearts"} left!` : "Spirit dispersed!", 1);
    if (hearts <= 0) endRun(false);
  };

  const collectCandy = (candy: CandyItem) => {
    candy.active = false;
    candy.group.visible = false;
    collected++;
    combo = comboTimer > 0 ? Math.min(5, combo + 1) : 1;
    comboTimer = 4;
    const pickupScore = 100 * combo;
    score += pickupScore;
    timeLeft = Math.min(GAME_CONFIG.ROUND_TIME + 12, timeLeft + 1.5);
    spawnBurst(candy.group.position.x, candy.group.position.y, candy.group.position.z, COLORS.gold, 13, 3.8);
    audio.sfx("pickup");
    showToast(combo > 1 ? `SWEET ×${combo}  ·  +1.5s` : `+${pickupScore}  ·  +1.5s`, 0.75);
    if (collected >= GAME_CONFIG.CANDY_TARGET) endRun(true);
    else spawnCandy();
  };

  const updateParticles = (dt: number) => {
    const limit = particles.length;
    for (let i = 0; i < limit; i++) {
      const particle = particles[i];
      if (!particle.active) continue;
      particle.life -= dt;
      if (particle.life <= 0) {
        particle.active = false;
        dummy.position.set(0, -20, 0);
        dummy.scale.setScalar(0);
      } else {
        particle.velocity.y -= 6.5 * dt;
        particle.position.addScaledVector(particle.velocity, dt);
        dummy.position.copy(particle.position);
        const scale = particle.size * Math.min(1, particle.life / (particle.maxLife * 0.45));
        dummy.scale.setScalar(scale);
        dummy.rotation.set(visualTime * 2 + i, visualTime + i * 0.4, 0);
      }
      dummy.updateMatrix();
      particleMesh.setMatrixAt(i, dummy.matrix);
    }
    particleMesh.instanceMatrix.needsUpdate = true;
  };

  const updateEnemy = (enemy: Enemy, dt: number) => {
    if (!enemy.active || elapsed < 2.8) return;
    const position = enemy.group.position;
    tempDirection.subVectors(player.position, position).setY(0);
    const distance = Math.max(0.001, tempDirection.length());
    tempDirection.multiplyScalar(1 / distance);
    enemy.timer -= dt;

    if (enemy.state === "chase") {
      if (enemy.kind === "pumpkin") {
        const speed = 1.3 + Math.min(1.05, elapsed * 0.015);
        enemy.velocity.lerp(tempDirection.multiplyScalar(speed), Math.min(1, dt * 5));
      } else {
        const orbitAngle = visualTime * 1.15 + enemy.phase;
        tempPosition.set(player.position.x + Math.cos(orbitAngle) * 3.8, position.y, player.position.z + Math.sin(orbitAngle) * 3.8);
        enemy.velocity.subVectors(tempPosition, position).setY(0).multiplyScalar(1.5);
        if (enemy.velocity.length() > 3.8) enemy.velocity.setLength(3.8);
      }
      if (enemy.timer <= 0) {
        enemy.state = "windup";
        enemy.timer = enemy.kind === "bat" ? 0.55 : 0.68;
        enemy.velocity.set(0, 0, 0);
        enemy.warning.visible = true;
      }
    } else if (enemy.state === "windup") {
      enemy.warning.visible = true;
      enemy.bodyMaterial.emissiveIntensity = 1.2 + Math.sin(visualTime * 24) * 0.35;
      if (enemy.timer <= 0) {
        enemy.state = "charge";
        enemy.timer = enemy.kind === "bat" ? 0.72 : 0.58;
        enemy.velocity.copy(tempDirection).multiplyScalar(enemy.kind === "bat" ? 7.4 : 6.35);
        enemy.warning.visible = false;
        enemy.bodyMaterial.emissiveIntensity = enemy.kind === "bat" ? 0.5 : 0.25;
      }
    } else if (enemy.timer <= 0) {
      enemy.state = "chase";
      enemy.timer = enemy.kind === "bat" ? 1.8 + rng() : 1.4 + rng() * 1.3;
      enemy.velocity.multiplyScalar(0.25);
    }

    position.addScaledVector(enemy.velocity, dt);
    const radius = Math.hypot(position.x, position.z);
    if (radius > 12.6) {
      position.x *= 12.6 / radius;
      position.z *= 12.6 / radius;
      if (enemy.state === "charge") enemy.timer = 0;
    }
    if (enemy.kind === "bat") {
      position.y = 1.08 + Math.sin(visualTime * 4 + enemy.phase) * 0.18;
      const flap = Math.sin(visualTime * 18 + enemy.phase) * 0.42;
      if (enemy.wingL) enemy.wingL.rotation.z = Math.PI / 2 + flap;
      if (enemy.wingR) enemy.wingR.rotation.z = -Math.PI / 2 - flap;
    }
    const targetScaleY = enemy.state === "windup" && enemy.kind === "pumpkin" ? 0.76 : 1;
    enemy.group.scale.y += (targetScaleY - enemy.group.scale.y) * Math.min(1, dt * 13);
    const targetScaleXZ = enemy.state === "windup" ? 1.12 : 1;
    enemy.group.scale.x += (targetScaleXZ - enemy.group.scale.x) * Math.min(1, dt * 13);
    enemy.group.scale.z = enemy.group.scale.x;
    if (enemy.warning.visible) {
      const pulse = 1 + Math.sin(visualTime * 20) * 0.16;
      enemy.warning.scale.setScalar(pulse);
    }
    enemy.group.rotation.y = Math.atan2(player.position.x - position.x, player.position.z - position.z);

    const hitRadius = enemy.kind === "bat" ? 0.9 : 1.02;
    const dx = player.position.x - position.x;
    const dz = player.position.z - position.z;
    if (dx * dx + dz * dz < hitRadius * hitRadius) {
      if (dashTimer > 0) banishEnemy(enemy);
      else if (invulnerable <= 0) hitPlayer(enemy);
    }
  };

  const updateHUD = () => {
    setText("candy-count", `${collected} / ${GAME_CONFIG.CANDY_TARGET}`);
    setText("score-count", formatScore(score));
    setText("timer-count", Math.max(0, timeLeft).toFixed(1));
    setText("hearts", hearts > 0 ? Array(hearts).fill("♥").join(" ") : "—");
    el("hearts").setAttribute("aria-label", `${hearts} hearts`);
    el("timer-fill").style.transform = `scaleX(${Math.max(0, Math.min(1, timeLeft / GAME_CONFIG.ROUND_TIME))})`;
    el("timer-count").style.color = timeLeft < 10 ? "#ff7195" : "";
    const dashProgress = 1 - Math.max(0, dashCooldown) / GAME_CONFIG.DASH_COOLDOWN;
    el("dash-fill").style.transform = `scaleX(${dashProgress})`;
    setText("dash-label", dashCooldown <= 0 ? "DASH READY" : "RECHARGING");
    dashButton.classList.toggle("cooling", dashCooldown > 0);
    const showCombo = machine.is("playing") && combo > 1 && comboTimer > 0;
    comboBadge.classList.toggle("is-hidden", !showCombo);
    if (showCombo) {
      setText("combo-count", `×${combo}`);
      el("combo-fill").style.transform = `scaleX(${comboTimer / 4})`;
    }
  };

  const loop = new GameLoop({
    update: (dt) => {
      dt *= debugTimeScale;
      visualTime += dt;
      if (toastTimer > 0) {
        toastTimer -= dt;
        if (toastTimer <= 0) toast.classList.remove("show");
      }
      if (input.consumeAction("KeyM")) {
        audio.toggleMute();
        updateMuteButton();
      }
      if (machine.is("title")) {
        if (input.consumeAction("Space")) startRun();
      } else if (machine.is("gameover", "victory")) {
        if (input.consumeAction("Space")) startRun();
        if (input.consumeAction("Escape")) backToTitle();
      } else if (machine.is("paused")) {
        if (input.consumeAction("Escape") || input.consumeAction("KeyP")) resumeRun();
      } else if (machine.is("playing")) {
        if (input.consumeAction("Escape") || input.consumeAction("KeyP")) {
          pauseRun();
          return;
        }

        elapsed += dt;
        timeLeft -= dt;
        if (timeLeft <= 0) {
          timeLeft = 0;
          endRun(false);
          return;
        }
        dashCooldown = Math.max(0, dashCooldown - dt);
        dashTimer = Math.max(0, dashTimer - dt);
        invulnerable = Math.max(0, invulnerable - dt);
        shake = Math.max(0, shake - dt * 1.9);
        comboTimer = Math.max(0, comboTimer - dt);
        if (comboTimer <= 0) combo = 0;

        const moveLength = Math.hypot(input.moveX, input.moveZ);
        if (input.consumeAction("Space") && dashCooldown <= 0) {
          if (moveLength > 0.1) dashDirection.set(input.moveX / moveLength, 0, -input.moveZ / moveLength);
          else dashDirection.set(Math.sin(player.rotation.y), 0, Math.cos(player.rotation.y));
          dashTimer = GAME_CONFIG.DASH_DURATION;
          dashCooldown = GAME_CONFIG.DASH_COOLDOWN;
          invulnerable = Math.max(invulnerable, GAME_CONFIG.DASH_DURATION + 0.08);
          audio.sfx("move");
          shake = Math.max(shake, 0.08);
        }

        if (dashTimer > 0) {
          playerVelocity.copy(dashDirection).multiplyScalar(GAME_CONFIG.DASH_SPEED);
          trailTimer -= dt;
          if (trailTimer <= 0) {
            trailTimer = 0.035;
            spawnBurst(player.position.x, player.position.y + 0.2, player.position.z, COLORS.mint, 2, 0.7);
          }
        } else {
          const normalization = moveLength > 1 ? 1 / moveLength : 1;
          const targetX = input.moveX * normalization * GAME_CONFIG.PLAYER_SPEED;
          const targetZ = -input.moveZ * normalization * GAME_CONFIG.PLAYER_SPEED;
          const responsiveness = Math.min(1, dt * (moveLength > 0.05 ? 12 : 8));
          playerVelocity.x += (targetX - playerVelocity.x) * responsiveness;
          playerVelocity.z += (targetZ - playerVelocity.z) * responsiveness;
        }
        player.position.addScaledVector(playerVelocity, dt);
        const playerRadius = Math.hypot(player.position.x, player.position.z);
        if (playerRadius > GAME_CONFIG.ARENA_RADIUS) {
          player.position.x *= GAME_CONFIG.ARENA_RADIUS / playerRadius;
          player.position.z *= GAME_CONFIG.ARENA_RADIUS / playerRadius;
          playerVelocity.multiplyScalar(0.65);
        }
        if (playerVelocity.lengthSq() > 0.2) player.rotation.y = Math.atan2(playerVelocity.x, playerVelocity.z);

        for (const candy of candies) {
          if (!candy.active) continue;
          const dx = player.position.x - candy.group.position.x;
          const dz = player.position.z - candy.group.position.z;
          if (dx * dx + dz * dz < 0.85 * 0.85) {
            collectCandy(candy);
            if (!machine.is("playing")) return;
          }
        }

        let activeEnemies = 0;
        for (const enemy of enemies) if (enemy.active) activeEnemies++;
        spawnTimer -= dt;
        const enemyCap = Math.min(GAME_CONFIG.MAX_ENEMIES, 3 + Math.floor(elapsed / 15));
        if (spawnTimer <= 0 && activeEnemies < enemyCap) {
          spawnEnemy();
          spawnTimer = Math.max(2.1, 5.1 - elapsed * 0.045);
        }
        for (const enemy of enemies) {
          updateEnemy(enemy, dt);
          if (!machine.is("playing")) return;
        }
        updateParticles(dt);
        updateHUD();
      }
      if (!machine.is("playing", "paused")) updateParticles(dt);
    },
    render: () => {
      player.position.y = 0.93 + Math.sin(visualTime * 3.2) * 0.09;
      playerShadow.position.set(player.position.x, 0.018, player.position.z);
      playerGlow.position.set(player.position.x, 1.3, player.position.z);
      const speedRatio = Math.min(1, playerVelocity.length() / GAME_CONFIG.DASH_SPEED);
      player.scale.y = 1 - speedRatio * 0.13;
      player.scale.x = player.scale.z = 1 + speedRatio * 0.08;
      ghostMaterial.opacity = invulnerable > 0 && dashTimer <= 0 && Math.floor(visualTime * 14) % 2 === 0 ? 0.32 : 1;
      for (const candy of candies) {
        if (!candy.active) continue;
        candy.group.position.y = 0.76 + Math.sin(visualTime * 3 + candy.phase) * 0.16;
        candy.group.rotation.y += 0.018;
        candy.group.rotation.z = Math.sin(visualTime * 2 + candy.phase) * 0.12;
      }
      if (machine.is("title")) {
        player.rotation.y = Math.sin(visualTime * 0.7) * 0.28;
        for (const enemy of enemies) {
          if (enemy.active && enemy.kind === "pumpkin") enemy.group.rotation.y += 0.003;
        }
      }

      const titleOffset = machine.is("title") && camera.aspect > 1 ? -2.8 : 0;
      const portrait = camera.aspect < 0.82;
      cameraTarget.set(player.position.x + titleOffset, 0.15, player.position.z - 1.25);
      cameraDesired.set(
        player.position.x + titleOffset,
        portrait ? 18.5 : 14.6,
        player.position.z + (portrait ? 16.8 : 13.7),
      );
      camera.position.lerp(cameraDesired, 0.075);
      if (shake > 0) {
        camera.position.x += Math.sin(visualTime * 71) * shake * 0.22;
        camera.position.y += Math.cos(visualTime * 83) * shake * 0.14;
      }
      camera.lookAt(cameraTarget);
      renderer.render(scene, camera);
      window.__GAME_READY__ = true;

      fpsFrames++;
      const now = performance.now();
      if (now - fpsSampleStart >= 2000) {
        fps = (fpsFrames * 1000) / (now - fpsSampleStart);
        fpsFrames = 0;
        fpsSampleStart = now;
        if (!lowQuality && fps < QUALITY.DEGRADE_FPS) {
          lowQuality = true;
          renderer.setPixelRatio(1);
          renderer.shadowMap.enabled = false;
        }
      }
    },
  });

  const listeners: Array<() => void> = [];
  const listen = (target: HTMLElement | Window | Document, type: string, handler: EventListener, options?: AddEventListenerOptions) => {
    target.addEventListener(type, handler, options);
    listeners.push(() => target.removeEventListener(type, handler, options));
  };
  listen(el("start-btn"), "click", () => startRun());
  listen(el("resume-btn"), "click", () => resumeRun());
  listen(el("restart-btn"), "click", () => startRun());
  listen(el("pause-restart-btn"), "click", () => startRun());
  listen(el("title-btn"), "click", () => backToTitle());
  listen(el("pause-btn"), "click", () => pauseRun());
  listen(muteButton, "click", () => { audio.toggleMute(); updateMuteButton(); });
  listen(dashButton, "pointerdown", (event) => { event.preventDefault(); input.actions.add("Space"); });
  listen(window, "resize", () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight, false);
  });
  listen(document, "visibilitychange", () => { if (document.hidden) pauseRun(); });

  window.__gameProbe = () => ({ x: player.position.x, y: player.position.y, z: player.position.z });
  window.__gameDebug = {
    win: () => { if (!machine.is("playing")) startRun(); endRun(true); },
    lose: () => { if (!machine.is("playing")) startRun(); hearts = 0; endRun(false); },
    busy: () => {
      if (!machine.is("playing")) startRun();
      elapsed = 38;
      for (let i = 0; i < 8; i++) spawnEnemy(i % 3 === 0 ? "bat" : "pumpkin");
      spawnBurst(player.position.x, 1, player.position.z, COLORS.gold, 40, 4);
    },
    timeScale: (value: number) => { debugTimeScale = Math.max(0.1, Math.min(1, value)); },
    state: () => machine.state,
    snapshot: () => ({
      player: { x: player.position.x, z: player.position.z },
      candies: candies.filter((item) => item.active).map((item) => ({ x: item.group.position.x, z: item.group.position.z })),
      enemies: enemies.filter((item) => item.active).map((item) => ({ x: item.group.position.x, z: item.group.position.z, kind: item.kind })),
      score,
      collected,
      hearts,
      dashCooldown,
      timeLeft,
    }),
    stats: () => {
      let activeEnemies = 0;
      let activeParticles = 0;
      for (const enemy of enemies) if (enemy.active) activeEnemies++;
      for (const particle of particles) if (particle.active) activeParticles++;
      const gl = renderer.getContext();
      const extension = gl.getExtension("WEBGL_debug_renderer_info");
      const rendererName = extension ? String(gl.getParameter(extension.UNMASKED_RENDERER_WEBGL)) : "WebGL";
      return { fps: Math.round(fps), drawCalls: renderer.info.render.calls, triangles: renderer.info.render.triangles, enemies: activeEnemies, particles: activeParticles, renderer: rendererName };
    },
  };

  resetRun();
  syncUI();
  loop.start();

  session = {
    dispose: () => {
      loop.stop();
      for (const off of listeners) off();
      input.dispose();
      audio.dispose();
      const geometries = new Set<THREE.BufferGeometry>();
      const materials = new Set<THREE.Material>();
      const textures = new Set<THREE.Texture>();
      scene.traverse((object) => {
        if (object instanceof THREE.Mesh || object instanceof THREE.Points || object instanceof THREE.Sprite) {
          if ("geometry" in object && object.geometry) geometries.add(object.geometry as THREE.BufferGeometry);
          const objectMaterials = Array.isArray(object.material) ? object.material : [object.material];
          for (const material of objectMaterials) {
            materials.add(material);
            for (const value of Object.values(material)) if (value instanceof THREE.Texture) textures.add(value);
          }
        }
      });
      for (const geometry of geometries) geometry.dispose();
      for (const texture of textures) texture.dispose();
      for (const material of materials) material.dispose();
      renderer.dispose();
      delete window.__gameProbe;
      delete window.__gameDebug;
      window.__GAME_READY__ = false;
    },
  };
}

export function stopGame(): void {
  session?.dispose();
  session = null;
}

function mulberry32(seed: number): () => number {
  return () => {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
