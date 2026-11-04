// Pooled particle systems (tyre smoke, sparks): one draw call each, no per-frame allocation.
import * as THREE from 'three';
import { mulberry32 } from '../data/dataset.js';
import { softSprite } from './textures.js';

const VERT = `
attribute float aSize;
attribute float aAlpha;
varying float vAlpha;
uniform float uScale;
void main() {
  vAlpha = aAlpha;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = aSize * uScale / -mv.z;
  gl_Position = projectionMatrix * mv;
}`;
const FRAG = `
uniform sampler2D uMap;
uniform vec3 uColor;
varying float vAlpha;
void main() {
  vec4 t = texture2D(uMap, gl_PointCoord);
  gl_FragColor = vec4(uColor * t.rgb, t.a * vAlpha);
  if (gl_FragColor.a < 0.01) discard;
}`;

class Particles {
  constructor(count, { color, additive, size, life, drag, gravity, grow }) {
    this.count = count;
    this.cfg = { size, life, drag, gravity, grow };
    this.pos = new Float32Array(count * 3);
    this.vel = new Float32Array(count * 3);
    this.age = new Float32Array(count).fill(Infinity);
    this.size = new Float32Array(count);
    this.alpha = new Float32Array(count);
    this.next = 0;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    this.points = new THREE.Points(
      geo,
      new THREE.ShaderMaterial({
        vertexShader: VERT,
        fragmentShader: FRAG,
        uniforms: { uMap: { value: softSprite() }, uColor: { value: new THREE.Color(color) }, uScale: { value: 600 } },
        transparent: true,
        depthWrite: false,
        blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      }),
    );
    this.points.frustumCulled = false;
  }

  emit(x, y, z, vx, vy, vz) {
    const i = this.next;
    this.next = (this.next + 1) % this.count;
    this.pos.set([x, y, z], i * 3);
    this.vel.set([vx, vy, vz], i * 3);
    this.age[i] = 0;
  }

  update(dt) {
    const { life, drag, gravity, size, grow } = this.cfg;
    const damp = Math.max(0, 1 - drag * dt);
    for (let i = 0; i < this.count; i++) {
      const a = (this.age[i] += dt);
      if (a >= life) {
        this.alpha[i] = 0;
        continue;
      }
      const k = i * 3;
      this.vel[k] *= damp;
      this.vel[k + 1] = this.vel[k + 1] * damp - gravity * dt;
      this.vel[k + 2] *= damp;
      this.pos[k] += this.vel[k] * dt;
      this.pos[k + 1] += this.vel[k + 1] * dt;
      this.pos[k + 2] += this.vel[k + 2] * dt;
      const t = a / life;
      this.size[i] = size * (1 + grow * t);
      this.alpha[i] = (1 - t) * (1 - t);
    }
    const g = this.points.geometry.attributes;
    g.position.needsUpdate = g.aSize.needsUpdate = g.aAlpha.needsUpdate = true;
  }
}

export function createEffects(budget) {
  const smoke = new Particles(budget, { color: 0xd0d4da, size: 1.4, life: 1.4, drag: 1.5, gravity: -0.6, grow: 3 });
  const sparks = new Particles(Math.max(64, budget >> 2), { color: 0xffb347, additive: true, size: 0.35, life: 0.5, drag: 0.5, gravity: 9.8, grow: -0.5 });
  const rand = mulberry32(99);
  const group = new THREE.Group();
  group.add(smoke.points, sparks.points);
  const W = new THREE.Vector3();
  return {
    group,
    smoke(object, localPoints, amount, fwdX, fwdZ) {
      const n = Math.min(3, Math.floor(amount * 3 + rand()));
      for (const lp of localPoints) {
        W.copy(lp);
        object.localToWorld(W);
        for (let i = 0; i < n; i++) smoke.emit(W.x + (rand() - 0.5) * 0.3, W.y + 0.1, W.z + (rand() - 0.5) * 0.3, -fwdX * 3 + (rand() - 0.5), 0.6 + rand(), -fwdZ * 3 + (rand() - 0.5));
      }
    },
    sparks(x, y, z, count, fwdX, fwdZ, speed) {
      for (let i = 0; i < count; i++) {
        sparks.emit(x + (rand() - 0.5) * 0.6, y + 0.15, z + (rand() - 0.5) * 0.6, fwdX * speed * 0.4 + (rand() - 0.5) * 6, 1 + rand() * 4, fwdZ * speed * 0.4 + (rand() - 0.5) * 6);
      }
    },
    update(dt, pixelScale) {
      smoke.points.material.uniforms.uScale.value = pixelScale;
      sparks.points.material.uniforms.uScale.value = pixelScale;
      smoke.update(dt);
      sparks.update(dt);
    },
    dispose() {
      for (const p of [smoke, sparks]) {
        p.points.geometry.dispose();
        p.points.material.uniforms.uMap.value.dispose();
        p.points.material.dispose();
      }
    },
  };
}
