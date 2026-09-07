import { useEffect, useRef } from "react";
import {
  ACESFilmicToneMapping,
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Clock,
  Color,
  Group,
  IcosahedronGeometry,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  Points,
  PointsMaterial,
  Scene,
  ShaderMaterial,
  Sprite,
  SpriteMaterial,
  SRGBColorSpace,
  TorusGeometry,
  Vector2,
  WebGLRenderer,
  type Material,
} from "three";

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
  varying vec3 vNormal;
  varying vec3 vPosition;
  varying float vPulse;

  void main() {
    float fresnel = pow(1.0 - abs(dot(normalize(vNormal), vec3(0.0, 0.0, 1.0))), 2.6);
    float band = sin(vPosition.y * 3.4 + vPosition.x * 1.6 + uTime * 0.45) * 0.5 + 0.5;
    vec3 lime = vec3(0.72, 1.0, 0.32);
    vec3 cyan = vec3(0.18, 0.86, 0.91);
    vec3 coral = vec3(1.0, 0.47, 0.40);
    vec3 color = mix(cyan, lime, band);
    color = mix(color, coral, smoothstep(0.55, 1.15, vPosition.x + vPulse * 5.0));
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

export function OrbScene() {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    let renderer: WebGLRenderer;
    try {
      renderer = new WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
    } catch {
      host.classList.add("orb-scene-fallback");
      return;
    }

    const scene = new Scene();
    const camera = new PerspectiveCamera(38, 1, 0.1, 100);
    camera.position.set(0, 0, 6.2);
    renderer.setClearColor(0x000000, 0);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = SRGBColorSpace;
    renderer.toneMapping = ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;
    renderer.domElement.className = "orb-canvas";
    host.appendChild(renderer.domElement);

    const orb = new Group();
    scene.add(orb);

    const sphereGeometry = new IcosahedronGeometry(1.35, 6);
    const sphereMaterial = new ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: { uTime: { value: 0 } },
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
    });
    const sphere = new Mesh(sphereGeometry, sphereMaterial);
    orb.add(sphere);

    const shellGeometry = new IcosahedronGeometry(1.47, 2);
    const shellMaterial = new MeshBasicMaterial({
      color: 0xc8ff72,
      wireframe: true,
      transparent: true,
      opacity: 0.1,
      blending: AdditiveBlending,
    });
    const shell = new Mesh(shellGeometry, shellMaterial);
    orb.add(shell);

    const ringMaterial = new MeshBasicMaterial({
      color: 0xcdf7ed,
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
    const colors = new Float32Array(particleCount * 3);
    const palette = [new Color(0xc8ff72), new Color(0x62d8e5), new Color(0xff7668), new Color(0xf0f2ea)];
    for (let index = 0; index < particleCount; index += 1) {
      const radius = 1.65 + Math.pow(random(), 1.7) * 2.2;
      const theta = random() * Math.PI * 2;
      const phi = Math.acos(2 * random() - 1);
      positions[index * 3] = radius * Math.sin(phi) * Math.cos(theta);
      positions[index * 3 + 1] = radius * Math.cos(phi) * 0.78;
      positions[index * 3 + 2] = radius * Math.sin(phi) * Math.sin(theta);
      const color = palette[Math.floor(random() * palette.length)];
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
      color: 0x8beee7,
      transparent: true,
      opacity: 0.18,
      blending: AdditiveBlending,
      depthWrite: false,
    });
    const glow = new Sprite(glowMaterial);
    glow.scale.set(4.5, 4.5, 1);
    scene.add(glow);

    let width = 0;
    let height = 0;
    const resize = () => {
      const nextWidth = Math.max(host.clientWidth, 1);
      const nextHeight = Math.max(host.clientHeight, 1);
      if (nextWidth === width && nextHeight === height) return;
      width = nextWidth;
      height = nextHeight;
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height, false);
      orb.position.x = width > 700 ? 0.68 : 0;
      orb.scale.setScalar(width > 700 ? 1 : 0.9);
    };
    const observer = new ResizeObserver(resize);
    observer.observe(host);
    resize();

    const pointer = new Vector2();
    const pointerTarget = new Vector2();
    const onPointerMove = (event: PointerEvent) => {
      const rect = host.getBoundingClientRect();
      pointerTarget.set(
        ((event.clientX - rect.left) / rect.width - 0.5) * 0.5,
        ((event.clientY - rect.top) / rect.height - 0.5) * 0.34,
      );
    };
    const onPointerLeave = () => pointerTarget.set(0, 0);
    host.addEventListener("pointermove", onPointerMove);
    host.addEventListener("pointerleave", onPointerLeave);

    const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const clock = new Clock();
    let frame = 0;
    const render = () => {
      const elapsed = clock.getElapsedTime();
      pointer.lerp(pointerTarget, 0.035);
      sphereMaterial.uniforms.uTime.value = mediaQuery.matches ? 0.8 : elapsed;
      orb.rotation.y = elapsed * 0.13 + pointer.x;
      orb.rotation.x = -0.12 + pointer.y;
      orb.position.y = mediaQuery.matches ? 0 : Math.sin(elapsed * 1.4) * 0.1;
      shell.rotation.x = elapsed * -0.08;
      shell.rotation.z = elapsed * 0.09;
      rings[0].rotation.z += mediaQuery.matches ? 0 : 0.0018;
      rings[1].rotation.x += mediaQuery.matches ? 0 : 0.0013;
      particles.rotation.y = elapsed * -0.018;
      particles.rotation.z = Math.sin(elapsed * 0.16) * 0.08;
      renderer.render(scene, camera);
      if (!mediaQuery.matches) frame = requestAnimationFrame(render);
    };
    render();
    const onMotionChange = () => {
      cancelAnimationFrame(frame);
      clock.start();
      render();
    };
    mediaQuery.addEventListener("change", onMotionChange);

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      mediaQuery.removeEventListener("change", onMotionChange);
      host.removeEventListener("pointermove", onPointerMove);
      host.removeEventListener("pointerleave", onPointerLeave);
      sphereGeometry.dispose();
      sphereMaterial.dispose();
      shellGeometry.dispose();
      shellMaterial.dispose();
      rings.forEach((ring) => {
        ring.geometry.dispose();
        (ring.material as Material).dispose();
      });
      particleGeometry.dispose();
      particleMaterial.dispose();
      glowMaterial.map?.dispose();
      glowMaterial.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, []);

  return <div ref={hostRef} className="orb-scene" aria-hidden="true" />;
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
