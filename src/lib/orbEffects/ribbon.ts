// ribbon：极光绸带——aurora 主题的默认开场特效（PLAN-ui-modernization P2）。
// 结构：柔光基座（双层 additive 球）+ 四条极光绸带（CatmullRomCurve3 → TubeGeometry，
// 沿 z 轴压扁成扁带）+ 上升柔光粒子。无 shader，遵守 ORB-EFFECTS §4 契约：
//   update/resize/applyPalette/dispose 四成员齐全；粒子 600（≤1200）；
//   additive 一律 depthWrite:false；不监听 window、不建第二 renderer、不读 localStorage；
//   reduced-motion 下宿主冻结时钟（t 恒 0.8）并停 rAF——效果内不再自增动画。
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  CatmullRomCurve3,
  Color,
  Group,
  Mesh,
  MeshBasicMaterial,
  Points,
  PointsMaterial,
  SphereGeometry,
  TubeGeometry,
  Vector3,
} from "three";
import type { OrbHost, OrbInstance, OrbPalette } from "./types";

/** 绸带规格：x0 静止位 / amp 摆幅 / phase 波形相位 / radius 管半径（沿 z 压扁成带）。 */
const RIBBON_SPECS = [
  { x0: -1.9, amp: 0.55, phase: 0.0, radius: 0.15, tiltY: 0.12, speed: 0.05, opacity: 0.66 },
  { x0: -0.7, amp: 0.7, phase: 1.7, radius: 0.12, tiltY: -0.08, speed: -0.04, opacity: 0.6 },
  { x0: 0.45, amp: 0.6, phase: 3.1, radius: 0.13, tiltY: 0.05, speed: 0.06, opacity: 0.58 },
  { x0: 1.5, amp: 0.5, phase: 4.4, radius: 0.11, tiltY: -0.1, speed: -0.05, opacity: 0.55 },
];
/** 调色板字段按 RIBBON_SPECS 顺序取色（applyPalette 同序刷新）——四条帘各自一个维度色。 */
const RIBBON_KEYS = ["film", "book", "music", "other"] as const;

/** 确定性 PRNG（与 halo/blackhole 同族）：粒子分布可复现，applyPalette 重染不重排。 */
function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

export function createRibbonEffect(host: OrbHost, palette: OrbPalette): OrbInstance {
  const { scene } = host;
  const group = new Group();
  scene.add(group);

  // ---- 柔光基座：两层大半径低不透明度 additive 球（ACES 色调映射下呈辉光） ----
  const coreGeometry = new SphereGeometry(1.05, 32, 24);
  const coreMaterial = new MeshBasicMaterial({
    color: new Color(palette.accent),
    transparent: true,
    opacity: 0.07,
    blending: AdditiveBlending,
    depthWrite: false,
  });
  const core = new Mesh(coreGeometry, coreMaterial);
  group.add(core);

  const glowGeometry = new SphereGeometry(1.75, 32, 24);
  const glowMaterial = new MeshBasicMaterial({
    color: new Color(palette.accent2),
    transparent: true,
    opacity: 0.045,
    blending: AdditiveBlending,
    depthWrite: false,
  });
  const glow = new Mesh(glowGeometry, glowMaterial);
  group.add(glow);

  // ---- 四条极光绸带：波浪控制点 → 闭管 → z 向压扁成扁带 ----
  const POINTS = 9;
  const ribbons = RIBBON_SPECS.map((spec, specIndex) => {
    const points: Vector3[] = [];
    for (let index = 0; index < POINTS; index += 1) {
      const y = -2.3 + (index / (POINTS - 1)) * 4.6;
      points.push(
        new Vector3(
          spec.x0 + Math.sin(spec.phase + y * 0.9) * spec.amp,
          y,
          Math.cos(spec.phase * 1.3 + y * 0.7) * spec.amp * 0.55,
        ),
      );
    }
    const curve = new CatmullRomCurve3(points, false, "catmullrom", 0.5);
    const geometry = new TubeGeometry(curve, 140, spec.radius, 8, false);
    const material = new MeshBasicMaterial({
      color: new Color(palette[RIBBON_KEYS[specIndex]]),
      transparent: true,
      opacity: spec.opacity,
      blending: AdditiveBlending,
      depthWrite: false,
    });
    const mesh = new Mesh(geometry, material);
    mesh.scale.set(1, 1, 0.32); // 圆管压扁 → 绸带断面
    mesh.rotation.y = spec.tiltY;
    group.add(mesh);
    return { mesh, material, spec };
  });

  // ---- 上升柔光粒子：帷幕体积内生成，缓速上漂 + 横向摇曳，出顶回绕 ----
  const random = seededRandom(20260928);
  const count = 600;
  const baseX = new Float32Array(count);
  const baseY = new Float32Array(count);
  const baseZ = new Float32Array(count);
  const speed = new Float32Array(count);
  const phase = new Float32Array(count);
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const dustPalette = [
    palette.accent,
    palette.accent2,
    palette.film,
    palette.music,
    palette.other,
  ].map((hex) => new Color(hex));
  for (let index = 0; index < count; index += 1) {
    baseX[index] = (random() - 0.5) * 5.4;
    baseY[index] = (random() - 0.5) * 5;
    baseZ[index] = (random() - 0.5) * 2.4;
    speed[index] = 0.05 + random() * 0.16;
    phase[index] = random() * Math.PI * 2;
    positions[index * 3] = baseX[index];
    positions[index * 3 + 1] = baseY[index];
    positions[index * 3 + 2] = baseZ[index];
    const color = dustPalette[Math.floor(random() * dustPalette.length)];
    colors.set([color.r, color.g, color.b], index * 3);
  }
  const dustGeometry = new BufferGeometry();
  dustGeometry.setAttribute("position", new BufferAttribute(positions, 3));
  dustGeometry.setAttribute("color", new BufferAttribute(colors, 3));
  const dustMaterial = new PointsMaterial({
    size: 0.03,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0.66,
    vertexColors: true,
    blending: AdditiveBlending,
    depthWrite: false,
  });
  const dust = new Points(dustGeometry, dustMaterial);
  group.add(dust);

  return {
    update(elapsed, pointer) {
      const t = host.reducedMotion ? 0.8 : elapsed;
      // 基座呼吸 + 指针视差（宿主传入，效果内不读 window）
      core.scale.setScalar(1 + Math.sin(t * 0.6) * 0.04);
      coreMaterial.opacity = 0.06 + Math.sin(t * 0.6) * 0.022;
      glow.scale.setScalar(1 + Math.sin(t * 0.4 + 1.2) * 0.05);
      group.position.y = host.reducedMotion ? 0 : Math.sin(t * 0.35) * 0.1;
      group.rotation.y = pointer.x * 0.35;
      group.rotation.x = pointer.y * 0.2;
      // 绸带：慢旋 + 微风横移 + 透明度呼吸（只动 transform/opacity，不重建几何）
      ribbons.forEach(({ mesh, material, spec }, index) => {
        mesh.rotation.y = spec.tiltY + (host.reducedMotion ? 0 : t * spec.speed);
        mesh.rotation.z = host.reducedMotion ? 0 : Math.sin(t * 0.22 + index * 1.9) * 0.06;
        mesh.position.x = host.reducedMotion ? 0 : Math.sin(t * 0.3 + index * 2.1) * 0.07;
        material.opacity =
          spec.opacity + (host.reducedMotion ? 0 : Math.sin(t * 0.5 + index * 1.3) * 0.1);
      });
      // 粒子上漂（reduced-motion 下静止——宿主已停 rAF，此处也不再自增）
      if (!host.reducedMotion) {
        const attr = dustGeometry.getAttribute("position") as BufferAttribute;
        for (let index = 0; index < count; index += 1) {
          baseY[index] += speed[index] * 0.0022;
          if (baseY[index] > 2.6) baseY[index] = -2.6;
          attr.setXYZ(
            index,
            baseX[index] + Math.sin(t * 0.5 + phase[index]) * 0.05,
            baseY[index],
            baseZ[index] + Math.cos(t * 0.4 + phase[index]) * 0.04,
          );
        }
        attr.needsUpdate = true;
      }
    },
    resize(width) {
      // 与 plasma/halo/blackhole 一致的桌面偏移；移动端居中缩放 0.88（契约 0.88–0.9）
      group.position.x = width > 700 ? 0.68 : 0;
      group.scale.setScalar(width > 700 ? 1 : 0.88);
    },
    applyPalette(next) {
      coreMaterial.color.set(next.accent);
      glowMaterial.color.set(next.accent2);
      ribbons.forEach(({ material }, index) => {
        material.color.set(next[RIBBON_KEYS[index]]);
      });
      const fresh = [next.accent, next.accent2, next.film, next.music, next.other].map(
        (hex) => new Color(hex),
      );
      const attr = dustGeometry.getAttribute("color") as BufferAttribute;
      const seeded = seededRandom(20260928);
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
      glowGeometry.dispose();
      glowMaterial.dispose();
      ribbons.forEach(({ mesh, material }) => {
        mesh.geometry.dispose();
        material.dispose();
      });
      dustGeometry.dispose();
      dustMaterial.dispose();
      group.clear();
    },
  };
}
