// halo：极光环场——无 shader 的轻量效果（线框多面体壳 + 三层进动环 + 极光尘埃），
// 作为「添加一个新特效」的参考实现：单文件 ~120 行，只依赖宿主接口。
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  Group,
  IcosahedronGeometry,
  Mesh,
  MeshBasicMaterial,
  Points,
  PointsMaterial,
  TorusGeometry,
} from "three";
import type { OrbHost, OrbInstance, OrbPalette } from "./types";

export function createHaloEffect(host: OrbHost, palette: OrbPalette): OrbInstance {
  const { scene } = host;
  const group = new Group();
  scene.add(group);

  // 内核：低细分线框二十面体（呼吸缩放）
  const coreGeometry = new IcosahedronGeometry(1.5, 1);
  const coreMaterial = new MeshBasicMaterial({
    color: new Color(palette.accent),
    wireframe: true,
    transparent: true,
    opacity: 0.34,
    blending: AdditiveBlending,
  });
  const core = new Mesh(coreGeometry, coreMaterial);
  group.add(core);

  // 三层不同倾角的环（缓慢进动，各吃一个维度色）
  const ringSpecs: Array<{
    radius: number;
    tube: number;
    color: string;
    tilt: [number, number];
    speed: number;
  }> = [
    { radius: 2.0, tube: 0.006, color: palette.film, tilt: [1.35, 0.1], speed: 0.0022 },
    { radius: 2.3, tube: 0.005, color: palette.music, tilt: [0.4, 0.9], speed: -0.0016 },
    { radius: 2.6, tube: 0.004, color: palette.other, tilt: [1.05, -0.5], speed: 0.0011 },
  ];
  const rings = ringSpecs.map((spec) => {
    const mesh = new Mesh(
      new TorusGeometry(spec.radius, spec.tube, 8, 200),
      new MeshBasicMaterial({
        color: new Color(spec.color),
        transparent: true,
        opacity: 0.26,
        blending: AdditiveBlending,
        depthWrite: false,
      }),
    );
    mesh.rotation.set(spec.tilt[0], spec.tilt[1], 0);
    group.add(mesh);
    return { mesh, speed: spec.speed, baseTilt: spec.tilt };
  });

  // 极光尘埃：大半径薄盘星尘（颜色四维混合）
  const random = (() => {
    let state = 987654 >>> 0;
    return () => {
      state = (state * 1664525 + 1013904223) >>> 0;
      return state / 0x1_0000_0000;
    };
  })();
  const count = 900;
  const positions = new Float32Array(count * 3);
  const dustPalette = [palette.accent, palette.accent2, palette.music, palette.other].map(
    (hex) => new Color(hex),
  );
  const colors = new Float32Array(count * 3);
  for (let index = 0; index < count; index += 1) {
    const radius = 1.9 + Math.pow(random(), 1.4) * 2.6;
    const theta = random() * Math.PI * 2;
    const y = (random() - 0.5) * 1.1;
    positions[index * 3] = radius * Math.cos(theta);
    positions[index * 3 + 1] = y;
    positions[index * 3 + 2] = radius * Math.sin(theta);
    const color = dustPalette[Math.floor(random() * dustPalette.length)];
    colors.set([color.r, color.g, color.b], index * 3);
  }
  const dustGeometry = new BufferGeometry();
  dustGeometry.setAttribute("position", new BufferAttribute(positions, 3));
  dustGeometry.setAttribute("color", new BufferAttribute(colors, 3));
  const dustMaterial = new PointsMaterial({
    size: 0.026,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0.72,
    vertexColors: true,
    blending: AdditiveBlending,
    depthWrite: false,
  });
  const dust = new Points(dustGeometry, dustMaterial);
  group.add(dust);

  return {
    update(elapsed, pointer) {
      const t = host.reducedMotion ? 0.8 : elapsed;
      core.rotation.y = t * 0.1 + pointer.x;
      core.rotation.x = 0.2 + pointer.y;
      core.scale.setScalar(1 + Math.sin(t * 0.9) * 0.035);
      group.position.y = host.reducedMotion ? 0 : Math.sin(t * 0.8) * 0.08;
      rings.forEach(({ mesh, speed, baseTilt }, index) => {
        mesh.rotation.z = baseTilt[1] + t * speed * (index % 2 === 0 ? 1 : -1) * 10;
      });
      dust.rotation.y = t * -0.014;
      dust.rotation.x = Math.sin(t * 0.13) * 0.06;
    },
    resize(width) {
      group.position.x = width > 700 ? 0.68 : 0;
      group.scale.setScalar(width > 700 ? 1 : 0.88);
    },
    applyPalette(next) {
      coreMaterial.color.set(next.accent);
      const ringColors = [next.film, next.music, next.other];
      rings.forEach(({ mesh }, index) => {
        (mesh.material as MeshBasicMaterial).color.set(ringColors[index % ringColors.length]);
      });
      const fresh = [next.accent, next.accent2, next.music, next.other].map(
        (hex) => new Color(hex),
      );
      const attr = dustGeometry.getAttribute("color") as BufferAttribute;
      const seeded = (() => {
        let state = 987654 >>> 0;
        return () => {
          state = (state * 1664525 + 1013904223) >>> 0;
          return state / 0x1_0000_0000;
        };
      })();
      for (let index = 0; index < count; index += 1) {
        const color = fresh[Math.floor(seeded() * fresh.length)];
        attr.setXYZ(index, color.r, color.g, color.b);
      }
      attr.needsUpdate = true;
    },
    dispose() {
      scene.remove(group);
      coreGeometry.dispose();
      coreMaterial.dispose();
      rings.forEach(({ mesh }) => {
        mesh.geometry.dispose();
        (mesh.material as MeshBasicMaterial).dispose();
      });
      dustGeometry.dispose();
      dustMaterial.dispose();
      group.clear();
    },
  };
}
