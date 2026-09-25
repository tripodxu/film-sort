// blackhole：呼吸中的类黑洞——中心锚定不漂移的对照实现。
// 结构：不透明事件视界（遮挡后方星尘形成"黑洞"）+ 光子环（引力透镜辉光）+
// 倾斜吸积盘（三层轨道环，粒子沿盘旋转）+ 外围被吸入的星尘。
// 呼吸 = 整体 scale 缓慢正弦（±3.5%），中心位置恒定——呼应"首屏漂移"反馈。
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  Group,
  Mesh,
  MeshBasicMaterial,
  Points,
  PointsMaterial,
  SphereGeometry,
  TorusGeometry,
} from "three";
import type { OrbHost, OrbInstance, OrbPalette } from "./types";

export function createBlackholeEffect(host: OrbHost, palette: OrbPalette): OrbInstance {
  const { scene } = host;
  const group = new Group();
  scene.add(group);

  // 事件视界：不透明纯黑球（depthWrite 开启，真实遮挡后方物体）
  const horizonGeometry = new SphereGeometry(1.05, 48, 32);
  const horizonMaterial = new MeshBasicMaterial({ color: 0x000000 });
  const horizon = new Mesh(horizonGeometry, horizonMaterial);
  group.add(horizon);

  // 光子环：贴重视界边缘的高亮细环（引力透镜的简化表达），随呼吸增亮
  const photonGeometry = new TorusGeometry(1.07, 0.014, 8, 220);
  const photonMaterial = new MeshBasicMaterial({
    color: new Color(palette.accent2),
    transparent: true,
    opacity: 0.85,
    blending: AdditiveBlending,
    depthWrite: false,
  });
  const photonRing = new Mesh(photonGeometry, photonMaterial);
  photonRing.rotation.x = Math.PI / 2;
  group.add(photonRing);

  // 吸积盘：三层不同倾角/半径的轨道环 + 沿轨道运动的亮粒子
  const diskSpecs = [
    { radius: 1.5, tube: 0.01, tiltX: 1.25, tiltZ: -0.18, speed: 0.5, color: palette.accent },
    { radius: 1.75, tube: 0.008, tiltX: 1.18, tiltZ: -0.1, speed: -0.34, color: palette.accent2 },
    { radius: 2.05, tube: 0.006, tiltX: 1.32, tiltZ: -0.26, speed: 0.22, color: palette.other },
  ];
  const diskRings = diskSpecs.map((spec) => {
    const mesh = new Mesh(
      new TorusGeometry(spec.radius, spec.tube, 8, 220),
      new MeshBasicMaterial({
        color: new Color(spec.color),
        transparent: true,
        opacity: 0.5,
        blending: AdditiveBlending,
        depthWrite: false,
      }),
    );
    mesh.rotation.x = spec.tiltX;
    mesh.rotation.z = spec.tiltZ;
    group.add(mesh);
    return { mesh, spec };
  });

  // 被吸入的星尘：粒子缓慢向内螺旋，到达视界后回到外圈重排
  const random = (() => {
    let state = 20260925 >>> 0;
    return () => {
      state = (state * 1664525 + 1013904223) >>> 0;
      return state / 0x1_0000_0000;
    };
  })();
  const count = 750;
  const radii = new Float32Array(count);
  const angles = new Float32Array(count);
  const tilts = new Float32Array(count);
  const speeds = new Float32Array(count);
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const dustPalette = [palette.accent, palette.accent2, palette.music, palette.other].map(
    (hex) => new Color(hex),
  );
  for (let index = 0; index < count; index += 1) {
    radii[index] = 1.35 + Math.pow(random(), 1.3) * 2.4;
    angles[index] = random() * Math.PI * 2;
    tilts[index] = 1.2 + (random() - 0.5) * 0.5; // 集中在吸积盘平面附近
    speeds[index] = 0.12 + random() * 0.3;
    const color = dustPalette[Math.floor(random() * dustPalette.length)];
    colors.set([color.r, color.g, color.b], index * 3);
  }
  const dustGeometry = new BufferGeometry();
  dustGeometry.setAttribute("position", new BufferAttribute(positions, 3));
  dustGeometry.setAttribute("color", new BufferAttribute(colors, 3));
  const dustMaterial = new PointsMaterial({
    size: 0.024,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0.7,
    vertexColors: true,
    blending: AdditiveBlending,
    depthWrite: false,
  });
  const dust = new Points(dustGeometry, dustMaterial);
  group.add(dust);

  return {
    update(elapsed, pointer) {
      const t = host.reducedMotion ? 0.8 : elapsed;
      // 呼吸：±3.5% 慢正弦；中心恒定（不随时间/指针平移——防漂移）
      const breathe = 1 + Math.sin(t * 0.55) * 0.035;
      group.scale.setScalar(breathe);
      group.rotation.y = 0.16 + pointer.x * 0.6;
      group.rotation.x = 0.1 + pointer.y * 0.4;
      photonRing.rotation.z = t * 0.4;
      photonMaterial.opacity = 0.7 + Math.sin(t * 0.55) * 0.2;
      diskRings.forEach(({ mesh, spec }, index) => {
        mesh.rotation.z = spec.tiltZ + t * spec.speed * 0.1;
        (mesh.material as MeshBasicMaterial).opacity =
          0.4 + Math.sin(t * 0.55 + index * 0.9) * 0.12;
      });
      // 星尘内旋：半径收缩，进入视界即回到外圈
      const attr = dustGeometry.getAttribute("position") as BufferAttribute;
      for (let index = 0; index < count; index += 1) {
        radii[index] -= host.reducedMotion ? 0 : speeds[index] * 0.004;
        if (radii[index] < 1.12) radii[index] = 3.6 + random() * 0.5;
        angles[index] += speeds[index] * 0.008;
        const r = radii[index];
        const a = angles[index];
        const tilt = tilts[index];
        positions[index * 3] = r * Math.cos(a);
        positions[index * 3 + 1] = r * Math.sin(a) * Math.cos(tilt) * 0.42;
        positions[index * 3 + 2] = r * Math.sin(a) * Math.sin(tilt);
        // 靠近视界时被"加热"变亮
        const heat = Math.max(0, 1 - (r - 1.12) / 2.4);
        attr.setXYZ(
          index,
          colors[index * 3] + heat * 0.5,
          colors[index * 3 + 1] + heat * 0.4,
          colors[index * 3 + 2] + heat * 0.3,
        );
      }
      attr.needsUpdate = true;
    },
    resize(width) {
      group.position.x = width > 700 ? 0.68 : 0;
      group.scale.multiplyScalar(1); // 呼吸 scale 在 update 里管理，这里不动
      const base = width > 700 ? 1 : 0.86;
      group.scale.setScalar(base);
    },
    applyPalette(next) {
      photonMaterial.color.set(next.accent2);
      diskRings[0].spec.color = next.accent;
      diskRings[1].spec.color = next.accent2;
      diskRings[2].spec.color = next.other;
      (diskRings[0].mesh.material as MeshBasicMaterial).color.set(next.accent);
      (diskRings[1].mesh.material as MeshBasicMaterial).color.set(next.accent2);
      (diskRings[2].mesh.material as MeshBasicMaterial).color.set(next.other);
      const fresh = [next.accent, next.accent2, next.music, next.other].map(
        (hex) => new Color(hex),
      );
      const attr = dustGeometry.getAttribute("color") as BufferAttribute;
      const seeded = (() => {
        let state = 20260925 >>> 0;
        return () => {
          state = (state * 1664525 + 1013904223) >>> 0;
          return state / 0x1_0000_0000;
        };
      })();
      for (let index = 0; index < count; index += 1) {
        const color = fresh[Math.floor(seeded() * fresh.length)];
        colors.set([color.r, color.g, color.b], index * 3);
        attr.setXYZ(index, color.r, color.g, color.b);
      }
      attr.needsUpdate = true;
    },
    dispose() {
      scene.remove(group);
      horizonGeometry.dispose();
      horizonMaterial.dispose();
      photonGeometry.dispose();
      photonMaterial.dispose();
      diskRings.forEach(({ mesh }) => {
        mesh.geometry.dispose();
        (mesh.material as MeshBasicMaterial).dispose();
      });
      dustGeometry.dispose();
      dustMaterial.dispose();
      group.clear();
    },
  };
}
