// plasma：现行光球（呼吸玻璃球 + 线框壳 + 双环 + 星尘 + 辉光）。
// 自 OrbScene 宿主化迁移而来；原硬编码的三色改为 uColorA/B/C uniforms，
// applyPalette 用主题维度色（film/music/book）驱动——特效随主题变色。
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  Group,
  IcosahedronGeometry,
  Mesh,
  MeshBasicMaterial,
  Points,
  PointsMaterial,
  ShaderMaterial,
  Sprite,
  SpriteMaterial,
  TorusGeometry,
} from "three";
import type { OrbInstance, OrbPalette, OrbHost } from "./types";

const vertexShader = /* glsl */ `
  uniform float uTime;
  varying vec3 vNormal;
  varying vec3 vPosition;
  varying float vPulse;

  void main() {
    vNormal = normalize(normalMatrix * normal);
    float pulse = sin(position.y * 4.0 + uTime * 1.15) * 0.045;
    pulse += sin(position.x * 5.2 - uTime * 0.8) * 0.025;
    vec3 animated = position + normal * pulse;
    vPulse = pulse;
    vPosition = animated;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(animated, 1.0);
  }
`;

const fragmentShader = /* glsl */ `
  uniform float uTime;
  uniform vec3 uColorA;
  uniform vec3 uColorB;
  uniform vec3 uColorC;
  varying vec3 vNormal;
  varying vec3 vPosition;
  varying float vPulse;

  void main() {
    float fresnel = pow(1.0 - abs(dot(normalize(vNormal), vec3(0.0, 0.0, 1.0))), 2.6);
    float band = sin(vPosition.y * 3.4 + vPosition.x * 1.6 + uTime * 0.45) * 0.5 + 0.5;
    vec3 color = mix(uColorA, uColorB, band);
    color = mix(color, uColorC, smoothstep(0.55, 1.15, vPosition.x + vPulse * 5.0));
    color += fresnel * vec3(0.75, 0.95, 1.0) * 1.25;
    float alpha = 0.54 + fresnel * 0.42;
    gl_FragColor = vec4(color, alpha);
  }
`;

function seededRandom(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

function createGlowTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 128;
  const context = canvas.getContext("2d");
  if (context) {
    const gradient = context.createRadialGradient(64, 64, 0, 64, 64, 64);
    gradient.addColorStop(0, "rgba(255,255,255,0.95)");
    gradient.addColorStop(0.18, "rgba(150,255,226,0.45)");
    gradient.addColorStop(1, "rgba(100,215,230,0)");
    context.fillStyle = gradient;
    context.fillRect(0, 0, 128, 128);
  }
  return new CanvasTexture(canvas);
}

function hexToVector3(hex: string): [number, number, number] {
  const color = new Color(hex);
  return [color.r, color.g, color.b];
}

export function createPlasmaEffect(host: OrbHost, palette: OrbPalette): OrbInstance {
  const { scene } = host;
  const orb = new Group();
  scene.add(orb);

  const sphereGeometry = new IcosahedronGeometry(1.35, 6);
  const sphereMaterial = new ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms: {
      uTime: { value: 0 },
      uColorA: { value: hexToVector3(palette.music) },
      uColorB: { value: hexToVector3(palette.film) },
      uColorC: { value: hexToVector3(palette.book) },
    },
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
  });
  const sphere = new Mesh(sphereGeometry, sphereMaterial);
  orb.add(sphere);

  const shellGeometry = new IcosahedronGeometry(1.47, 2);
  const shellMaterial = new MeshBasicMaterial({
    color: new Color(palette.accent),
    wireframe: true,
    transparent: true,
    opacity: 0.1,
    blending: AdditiveBlending,
  });
  const shell = new Mesh(shellGeometry, shellMaterial);
  orb.add(shell);

  const ringMaterial = new MeshBasicMaterial({
    color: new Color(palette.music),
    transparent: true,
    opacity: 0.2,
    blending: AdditiveBlending,
    depthWrite: false,
  });
  const rings = [
    new Mesh(new TorusGeometry(1.86, 0.008, 8, 180), ringMaterial),
    new Mesh(new TorusGeometry(2.16, 0.005, 8, 180), ringMaterial.clone()),
  ];
  rings[0].rotation.set(1.12, 0.22, -0.28);
  rings[1].rotation.set(0.32, 1.02, 0.34);
  rings.forEach((ring) => orb.add(ring));

  const random = seededRandom(23841);
  const particleCount = 620;
  const positions = new Float32Array(particleCount * 3);
  const particlePalette = [palette.accent, palette.music, palette.book, palette.other].map(
    (hex) => new Color(hex),
  );
  const colors = new Float32Array(particleCount * 3);
  for (let index = 0; index < particleCount; index += 1) {
    const radius = 1.65 + Math.pow(random(), 1.7) * 2.2;
    const theta = random() * Math.PI * 2;
    const phi = Math.acos(2 * random() - 1);
    positions[index * 3] = radius * Math.sin(phi) * Math.cos(theta);
    positions[index * 3 + 1] = radius * Math.cos(phi) * 0.78;
    positions[index * 3 + 2] = radius * Math.sin(phi) * Math.sin(theta);
    const color = particlePalette[Math.floor(random() * particlePalette.length)];
    colors.set([color.r, color.g, color.b], index * 3);
  }
  const particleGeometry = new BufferGeometry();
  particleGeometry.setAttribute("position", new BufferAttribute(positions, 3));
  particleGeometry.setAttribute("color", new BufferAttribute(colors, 3));
  const particleMaterial = new PointsMaterial({
    size: 0.032,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0.8,
    vertexColors: true,
    blending: AdditiveBlending,
    depthWrite: false,
  });
  const particles = new Points(particleGeometry, particleMaterial);
  scene.add(particles);

  const glowMaterial = new SpriteMaterial({
    map: createGlowTexture(),
    color: new Color(palette.accent2),
    transparent: true,
    opacity: 0.18,
    blending: AdditiveBlending,
    depthWrite: false,
  });
  const glow = new Sprite(glowMaterial);
  glow.scale.set(4.5, 4.5, 1);
  scene.add(glow);

  return {
    update(elapsed, pointer) {
      sphereMaterial.uniforms.uTime.value = host.reducedMotion ? 0.8 : elapsed;
      orb.rotation.y = elapsed * 0.13 + pointer.x;
      orb.rotation.x = -0.12 + pointer.y;
      orb.position.y = host.reducedMotion ? 0 : Math.sin(elapsed * 1.4) * 0.1;
      shell.rotation.x = elapsed * -0.08;
      shell.rotation.z = elapsed * 0.09;
      rings[0].rotation.z += host.reducedMotion ? 0 : 0.0018;
      rings[1].rotation.x += host.reducedMotion ? 0 : 0.0013;
      particles.rotation.y = elapsed * -0.018;
      particles.rotation.z = Math.sin(elapsed * 0.16) * 0.08;
    },
    resize(width, height) {
      orb.position.x = width > 700 ? 0.68 : 0;
      orb.scale.setScalar(width > 700 ? 1 : 0.9);
      glow.position.x = orb.position.x;
    },
    applyPalette(next) {
      sphereMaterial.uniforms.uColorA.value = hexToVector3(next.music);
      sphereMaterial.uniforms.uColorB.value = hexToVector3(next.film);
      sphereMaterial.uniforms.uColorC.value = hexToVector3(next.book);
      shellMaterial.color.set(next.accent);
      ringMaterial.color.set(next.music);
      rings[1].material = ringMaterial;
      const fresh = [next.accent, next.music, next.book, next.other].map((hex) => new Color(hex));
      const attr = particleGeometry.getAttribute("color") as BufferAttribute;
      const seeded = seededRandom(23841);
      for (let index = 0; index < 620; index += 1) {
        const color = fresh[Math.floor(seeded() * fresh.length)];
        attr.setXYZ(index, color.r, color.g, color.b);
      }
      attr.needsUpdate = true;
      glowMaterial.color.set(next.accent2);
    },
    dispose() {
      scene.remove(particles);
      scene.remove(glow);
      sphereGeometry.dispose();
      sphereMaterial.dispose();
      shellGeometry.dispose();
      shellMaterial.dispose();
      rings.forEach((ring) => {
        ring.geometry.dispose();
        (ring.material as MeshBasicMaterial).dispose();
      });
      particleGeometry.dispose();
      particleMaterial.dispose();
      glowMaterial.map?.dispose();
      glowMaterial.dispose();
      orb.clear();
    },
  };
}
