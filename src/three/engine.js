import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { STATES } from '../game/race.js';
import { SEGMENT_LENGTH } from '../game/track.js';
import { CameraRig } from './cameras.js';
import { createCar } from './car.js';
import { createEffects } from './effects.js';
import { buildObstacles } from './obstacles3d.js';
import { buildScenery } from './scenery3d.js';
import { buildTrack3D } from './track3d.js';
import { METERS_PER_UNIT, ROAD_HALF_M, buildCenterline, newPose, poseAt } from './world.js';

export const QUALITY = {
  low: { pixelRatio: 0.75, msaa: 0, shadows: 0, bloom: false, particles: 120, far: 450, density: 0.35, env: false, treeShadows: false },
  medium: { pixelRatio: 1, msaa: 4, shadows: 1024, bloom: false, particles: 360, far: 800, density: 0.6, env: true, treeShadows: false },
  // Instanced trees can't be culled per tree, so casting their shadows costs the whole forest every frame.
  high: { pixelRatio: 1.5, msaa: 4, shadows: 2048, bloom: true, particles: 700, far: 1300, density: 1, env: true, treeShadows: false },
  ultra: { pixelRatio: 2, msaa: 8, shadows: 4096, bloom: true, particles: 1400, far: 2000, density: 1.4, env: true, treeShadows: false },
};

export const ENVIRONMENTS = {
  day: { elevation: 38, azimuth: 150, turbidity: 3.5, rayleigh: 1.2, sun: 3.2, sunColor: 0xfff4e0, hemi: 0.9, fog: 0xa9c4dc, exposure: 0.62, lamps: 0.2, sky: true, clouds: 0.35 },
  sunset: { elevation: 3.5, azimuth: 240, turbidity: 8, rayleigh: 2.6, sun: 2.4, sunColor: 0xffa060, hemi: 0.55, fog: 0xc9967a, exposure: 0.55, lamps: 1.5, sky: true, clouds: 0.45 },
  night: { elevation: 30, azimuth: 60, turbidity: 2, rayleigh: 0.2, sun: 0.25, sunColor: 0x8aa4ff, hemi: 0.28, fog: 0x0b1020, exposure: 0.9, lamps: 6, sky: false, clouds: 0 },
};

export function webglSupport() {
  try {
    return Boolean(document.createElement('canvas').getContext('webgl2'));
  } catch {
    return false;
  }
}

const pose = newPose();
const SUN = new THREE.Vector3();

/** Three.js presentation of a Race. Reads simulation state; never changes it. */
export class Engine {
  constructor(canvas, { quality = 'high', environment = 'day', reducedMotion = false } = {}) {
    this.canvas = canvas;
    this.reducedMotion = reducedMotion;
    const renderer = (this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' }));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.shadowMap.type = THREE.PCFShadowMap;

    const scene = (this.scene = new THREE.Scene());
    this.camera = new THREE.PerspectiveCamera(62, 16 / 9, 0.1, 1500);
    this.rig = new CameraRig(this.camera);

    this.sky = new Sky();
    this.sky.scale.setScalar(45000);
    // The sun disc is ~1000x HDR; clamp it so bloom doesn't flood the frame when looking sunward.
    this.sky.material.onBeforeCompile = (s) => {
      s.fragmentShader = s.fragmentShader.replace('gl_FragColor = vec4( texColor, 1.0 );', 'gl_FragColor = vec4( min( texColor, vec3( 1.4 ) ), 1.0 );');
    };
    // Clamp the HDR sun disc so bloom doesn't smear it across the frame.
    this.sky.material.fragmentShader = this.sky.material.fragmentShader.replace('gl_FragColor = vec4( texColor, 1.0 );', 'gl_FragColor = vec4( min( texColor, vec3( 1.5 ) ), 1.0 );');
    this.sky.material.uniforms.cloudCoverage.value = 0.45;
    scene.add(this.sky);
    this.sun = new THREE.DirectionalLight(0xffffff, 3);
    const sc = this.sun.shadow.camera;
    sc.left = sc.bottom = -45;
    sc.right = sc.top = 45;
    sc.near = 1;
    sc.far = 400;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.03;
    scene.add(this.sun, this.sun.target);
    this.hemi = new THREE.HemisphereLight(0xcfe3ff, 0x3d5a2a, 0.9);
    scene.add(this.hemi);
    this.envMap = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
    scene.fog = new THREE.Fog(0xb9d3e6, 120, 1300);

    this.car = createCar();
    scene.add(this.car.object);
    this.headlight = new THREE.SpotLight(0xfff2d6, 0, 140, 0.45, 0.6, 1.2);
    this.headlight.position.set(0, 0.6, 1.5);
    this.headlight.target.position.set(0, 0, 30);
    this.car.object.add(this.headlight, this.headlight.target);

    this.resScale = 1;
    this.frameTimes = [];
    this.lastAdapt = 0;
    this.time = 0;
    this.setQuality(quality);
    this.setEnvironment(environment);
  }

  setQuality(name) {
    const q = (this.quality = QUALITY[name] ? name : 'high');
    const Q = (this.q = QUALITY[q]);
    const r = this.renderer;
    r.shadowMap.enabled = Q.shadows > 0;
    this.sun.castShadow = Q.shadows > 0;
    if (Q.shadows) {
      this.sun.shadow.mapSize.set(Q.shadows, Q.shadows);
      this.sun.shadow.map?.dispose();
      this.sun.shadow.map = null;
    }
    this.scene.environment = Q.env ? this.envMap : null;
    this.scene.environmentIntensity = 0.35; // reflections only; the sky + sun do the lighting
    this.camera.far = Q.far + 200;
    this.scene.fog.near = Q.far * 0.35;
    this.scene.fog.far = Q.far;
    this.composer?.dispose();
    this.composer = null;
    if (Q.msaa || Q.bloom) {
      const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: Q.msaa });
      this.composer = new EffectComposer(r, target);
      this.composer.addPass(new RenderPass(this.scene, this.camera));
      // high threshold: only emissive lights/flames bloom, not the sunlit HDR sky
      if (Q.bloom) this.composer.addPass(new UnrealBloomPass(new THREE.Vector2(256, 256), 0.5, 0.4, 1.6));
      this.composer.addPass(new OutputPass());
    }
    if (this.effects) {
      this.scene.remove(this.effects.group);
      this.effects.dispose();
    }
    this.effects = createEffects(Q.particles);
    this.scene.add(this.effects.group);
    this.resScale = 1;
    this.applySize();
    if (this.race) this.setRace(this.race); // rebuild scenery at the new density
  }

  setEnvironment(name) {
    const e = (this.env = ENVIRONMENTS[name] ?? ENVIRONMENTS.day);
    this.envName = ENVIRONMENTS[name] ? name : 'day';
    const u = this.sky.material.uniforms;
    u.turbidity.value = e.turbidity;
    u.rayleigh.value = e.rayleigh;
    u.mieCoefficient.value = 0.004;
    u.mieDirectionalG.value = 0.78;
    u.cloudCoverage.value = e.clouds;
    SUN.setFromSphericalCoords(1, THREE.MathUtils.degToRad(90 - e.elevation), THREE.MathUtils.degToRad(e.azimuth));
    u.sunPosition.value.copy(SUN);
    this.sky.visible = e.sky;
    this.scene.background = e.sky ? null : new THREE.Color(0x05070d);
    this.sun.color.setHex(e.sunColor);
    this.sun.intensity = e.sun;
    this.hemi.intensity = e.hemi;
    this.scene.fog.color.setHex(e.fog);
    this.renderer.toneMappingExposure = e.exposure;
    this.headlight.intensity = name === 'night' ? 900 : 0;
    if (this.scenery) this.scenery.lampMat.emissiveIntensity = e.lamps;
  }

  /** Build the circuit, scenery and obstacles for a race (disposes the previous one). */
  setRace(race) {
    this.disposeContent();
    this.race = race;
    this.line = buildCenterline(race.track);
    const year = race.dataset.year;
    this.track3d = buildTrack3D(this.line, race.track, { year });
    this.scenery = buildScenery(this.line, race.track, { year, density: this.q.density, treeShadows: this.q.treeShadows, seed: race.seed });
    this.obstacles = buildObstacles(this.line, race);
    this.scene.add(this.track3d.group, this.scenery.group, this.obstacles.group);
    this.scenery.lampMat.emissiveIntensity = this.env.lamps;
    this.rig.cut();
    this.prevSpeed = 0;
  }

  /** Point the existing scene at another race of the same season (replay/export). */
  attach(race) {
    this.race = race;
    this.obstacles.attach(race);
    this.rig.cut();
  }

  /** Visual reactions to simulation events. */
  onRaceEvent(type) {
    if (!this.race || !this.line) return;
    if (type === 'collision' || type === 'wall') {
      poseAt(this.line, this.race.z, this.race.car.x, pose);
      this.effects.sparks(pose.x, pose.y, pose.z, type === 'collision' ? 40 : 18, Math.sin(pose.yaw), Math.cos(pose.yaw), this.race.speed * METERS_PER_UNIT);
      this.rig.bump(type === 'collision' ? 0.9 : 0.4);
    }
  }

  resize(width, height) {
    this.cssW = Math.max(1, width);
    this.cssH = Math.max(1, height);
    this.applySize();
  }

  applySize(w = this.cssW ?? 1280, h = this.cssH ?? 720, pixelRatio) {
    const pr = pixelRatio ?? Math.min(window.devicePixelRatio || 1, this.q.pixelRatio) * this.resScale;
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(w, h, false);
    this.composer?.setPixelRatio(pr);
    this.composer?.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  /** Adaptive resolution: keep frame time near budget by scaling the render resolution. */
  adapt(dt) {
    if (this.exporting) return;
    this.frameTimes.push(dt);
    if (this.frameTimes.length < 45 || this.time - this.lastAdapt < 2) return;
    const avg = this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length;
    this.frameTimes.length = 0;
    this.lastAdapt = this.time;
    const budget = 1 / 55;
    const next = avg > budget * 1.2 ? Math.max(0.5, this.resScale - 0.1) : avg < budget * 0.75 ? Math.min(1, this.resScale + 0.05) : this.resScale;
    if (Math.abs(next - this.resScale) > 0.01) {
      this.resScale = next;
      this.applySize();
    }
  }

  get fps() {
    return this.measuredFps ?? 0;
  }

  /**
   * Render one frame of the race.
   * @param {number} dt seconds since last frame (visual smoothing only)
   * @param {{cameraMode?: string}} opts
   */
  frame(dt, { cameraMode = 'chase' } = {}) {
    const race = this.race;
    if (!race) return;
    this.time += dt;
    this.adapt(dt);
    const line = this.line;
    const car = race.car;
    poseAt(line, race.z, car.x, pose);
    const obj = this.car.object;
    const speedMs = car.speed * METERS_PER_UNIT;
    const slipYaw = speedMs > 1 ? Math.max(-0.45, Math.min(0.45, Math.atan2(-car.vLat * ROAD_HALF_M, speedMs) * 0.8)) : 0;
    obj.position.set(pose.x, pose.y, pose.z);
    obj.rotation.set(pose.pitch, pose.yaw + slipYaw, 0, 'YXZ');
    const accel = dt > 0 ? (speedMs - (this.prevSpeed ?? speedMs)) / dt : 0;
    this.prevSpeed = speedMs;
    const nitro = race.nitroLevel;
    const seg = Math.min(race.track.count - 1, Math.floor(race.z / SEGMENT_LENGTH));
    const curve = race.track.curve[seg] / 5;
    this.car.animate(dt, {
      speedMs,
      steer: car.steer,
      braking: race.input.brake > 0 && speedMs > 1,
      accel,
      lateral: car.vLat,
      nitro,
      time: this.time,
      rainOn: race.state !== STATES.READY && Math.floor(this.time * 4) % 2 === 0,
    });

    if (speedMs > 4 && car.slip > 0.35) this.effects.smoke(obj, this.car.rearWheels, Math.min(1, car.slip), Math.sin(pose.yaw), Math.cos(pose.yaw));
    this.effects.update(dt, this.renderer.getDrawingBufferSize(V2).y * 0.6);

    // sun + shadow frustum follow the car
    SUN.copy(this.sky.material.uniforms.sunPosition.value).multiplyScalar(180);
    this.sun.position.set(pose.x + SUN.x, pose.y + SUN.y, pose.z + SUN.z);
    this.sun.target.position.set(pose.x, pose.y, pose.z);

    const lights = this.track3d.startLights;
    for (let i = 0; i < lights.length; i++) lights[i].emissiveIntensity = i < race.lightsOn ? 4 : 0;
    if (!this.reducedMotion) this.sky.material.uniforms.time.value += dt;
    this.obstacles.update(this.time, this.reducedMotion);
    this.rig.update(dt, line, race, { speed01: car.speed / race.cruiseSpeed, steer: car.steer, curve, nitro, reducedMotion: this.reducedMotion, mode: cameraMode });

    if (this.composer) this.composer.render(dt);
    else this.renderer.render(this.scene, this.camera);
    this.measuredFps = this.measuredFps ? this.measuredFps * 0.95 + (dt > 0 ? 1 / dt : 0) * 0.05 : 60;
  }

  /** Switch to a fixed export resolution (1:1 pixels); returns a restore function. */
  beginExport(width, height) {
    this.exporting = true;
    this.applySize(width, height, 1);
    this.rig.cut();
    return () => {
      this.exporting = false;
      this.applySize();
      this.rig.cut();
    };
  }

  disposeContent() {
    for (const part of [this.track3d, this.scenery, this.obstacles]) {
      if (!part) continue;
      this.scene.remove(part.group);
      part.dispose ? part.dispose() : disposeTree(part.group);
    }
    this.track3d = this.scenery = this.obstacles = null;
  }

  dispose() {
    this.disposeContent();
    this.car.dispose();
    this.effects.dispose();
    this.composer?.dispose();
    this.envMap.dispose();
    this.renderer.dispose();
  }
}

const V2 = new THREE.Vector2();

export function disposeTree(root) {
  root.traverse((o) => {
    o.geometry?.dispose();
    const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
    for (const m of mats) {
      m.map?.dispose();
      m.dispose();
    }
  });
}
