"use client";

import { useEffect, useMemo, useRef } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { TIER_SETTINGS } from "./core-quality";
import { AdaptiveDpr, FrameDriver } from "./r3f-kit";

export interface AiCore3DProps {
  /** 0–1: real AI workload (running/queued tasks normalised). Drives rotation speed, pulse and signal traffic. */
  activity: number;
  /** Orbiting nodes (e.g. active AI employees), clamped to 3–24. */
  nodes: number;
  colors: { a: [number, number, number]; b: [number, number, number] };
  /** Pause rendering (off-screen / tab hidden). */
  paused?: boolean;
  /** "lite" on phones: fewer particles, 1–2 DPR, 30 fps. */
  quality?: "full" | "lite";
}

const c3 = ([r, g, b]: [number, number, number]) => new THREE.Color(r / 255, g / 255, b / 255);

function Particles({ color, activity, density }: { color: THREE.Color; activity: number; density: number }) {
  const ref = useRef<THREE.Points>(null);
  const geo = useMemo(() => {
    const n = Math.round(900 * density);
    const pos = new Float32Array(n * 3);
    let s = 1234567;
    const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < n; i++) {
      const u = r() * 2 - 1;
      const th = r() * Math.PI * 2;
      const rad = 2.1 + r() * 2.4;
      const q = Math.sqrt(1 - u * u);
      pos[i * 3] = Math.cos(th) * q * rad;
      pos[i * 3 + 1] = u * rad * 0.7;
      pos[i * 3 + 2] = Math.sin(th) * q * rad;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    return g;
  }, [density]);
  useEffect(() => () => geo.dispose(), [geo]);
  useFrame((_, dt) => {
    if (ref.current) ref.current.rotation.y += dt * (0.02 + activity * 0.06);
  });
  return (
    <points ref={ref} geometry={geo}>
      <pointsMaterial color={color} size={density < 1 ? 0.034 : 0.025} sizeAttenuation transparent opacity={0.7} depthWrite={false} blending={THREE.AdditiveBlending} />
    </points>
  );
}

function Orbits({ count, colorA, colorB, activity }: { count: number; colorA: THREE.Color; colorB: THREE.Color; activity: number }) {
  const group = useRef<THREE.Group>(null);
  const meshes = useRef<(THREE.Mesh | null)[]>([]);
  const lineGeo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(count * 6), 3));
    return g;
  }, [count]);
  useEffect(() => () => lineGeo.dispose(), [lineGeo]);
  const specs = useMemo(
    () =>
      Array.from({ length: count }, (_, i) => {
        const ring = i % 3;
        return {
          radius: 1.75 + ring * 0.42,
          phase: (i / count) * Math.PI * 2 * 3.1,
          speed: (0.35 + ring * 0.12) * (ring % 2 ? -1 : 1),
          size: 0.05 + ((i * 37) % 5) * 0.012,
          euler: new THREE.Euler([0.35, -0.6, 1.05][ring]!, [0, 1.1, 2.2][ring]!, 0),
        };
      }),
    [count],
  );
  const rings = useMemo(
    () =>
      [0, 1, 2].map((ring) => {
        const pts = Array.from({ length: 129 }, (_, k) => {
          const a = (k / 128) * Math.PI * 2;
          return new THREE.Vector3(Math.cos(a) * (1.75 + ring * 0.42), 0, Math.sin(a) * (1.75 + ring * 0.42));
        });
        return new THREE.BufferGeometry().setFromPoints(pts);
      }),
    [],
  );
  useEffect(() => () => rings.forEach((g) => g.dispose()), [rings]);
  const tmp = useMemo(() => new THREE.Vector3(), []);
  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();
    const pos = lineGeo.getAttribute("position") as THREE.BufferAttribute;
    specs.forEach((s, i) => {
      const a = s.phase + t * s.speed * (0.6 + activity * 1.4);
      tmp.set(Math.cos(a) * s.radius, 0, Math.sin(a) * s.radius);
      tmp.applyEuler(s.euler);
      const m = meshes.current[i];
      if (m) m.position.copy(tmp);
      pos.setXYZ(i * 2, 0, 0, 0);
      pos.setXYZ(i * 2 + 1, tmp.x, tmp.y, tmp.z);
    });
    pos.needsUpdate = true;
    if (group.current) group.current.rotation.y = t * 0.05;
  });
  return (
    <group ref={group}>
      {rings.map((g, ring) => (
        <lineLoop key={ring} geometry={g} rotation={[[0.35, -0.6, 1.05][ring]!, [0, 1.1, 2.2][ring]!, 0]}>
          <lineBasicMaterial color={ring % 2 ? colorB : colorA} transparent opacity={0.22} />
        </lineLoop>
      ))}
      <lineSegments geometry={lineGeo}>
        <lineBasicMaterial color={colorB} transparent opacity={0.12 + activity * 0.25} blending={THREE.AdditiveBlending} depthWrite={false} />
      </lineSegments>
      {specs.map((s, i) => (
        <mesh key={i} ref={(m) => void (meshes.current[i] = m)}>
          <sphereGeometry args={[s.size, 16, 16]} />
          <meshBasicMaterial color={i % 2 ? colorA : colorB} />
        </mesh>
      ))}
    </group>
  );
}

function Core({ colorA, colorB, activity }: { colorA: THREE.Color; colorB: THREE.Color; activity: number }) {
  const core = useRef<THREE.Mesh>(null);
  const shell = useRef<THREE.Mesh>(null);
  const halo = useRef<THREE.Mesh>(null);
  const mat = useRef<THREE.MeshStandardMaterial>(null);
  useFrame(({ clock }, dt) => {
    const t = clock.getElapsedTime();
    const speed = 0.15 + activity * 0.6;
    if (core.current) {
      core.current.rotation.y += dt * speed;
      core.current.rotation.x += dt * speed * 0.4;
    }
    if (shell.current) {
      shell.current.rotation.y -= dt * speed * 0.35;
      shell.current.rotation.z += dt * 0.03;
    }
    const pulse = 1 + Math.sin(t * (1.2 + activity * 2.5)) * (0.03 + activity * 0.05);
    core.current?.scale.setScalar(pulse);
    if (halo.current) halo.current.scale.setScalar(1.15 + Math.sin(t * 0.9) * 0.05 + activity * 0.15);
    if (mat.current) mat.current.emissiveIntensity = 0.55 + activity * 0.9 + Math.sin(t * 2) * 0.1;
  });
  return (
    <group>
      <mesh ref={core}>
        <icosahedronGeometry args={[0.82, 5]} />
        <meshStandardMaterial ref={mat} color={colorA} emissive={colorA} emissiveIntensity={0.8} roughness={0.35} metalness={0.35} />
      </mesh>
      <mesh ref={halo}>
        <sphereGeometry args={[0.95, 32, 32]} />
        <meshBasicMaterial color={colorB} transparent opacity={0.14} blending={THREE.AdditiveBlending} depthWrite={false} />
      </mesh>
      <mesh ref={shell}>
        <icosahedronGeometry args={[1.38, 2]} />
        <meshBasicMaterial color={colorB} wireframe transparent opacity={0.16} />
      </mesh>
    </group>
  );
}

/** Procedural intelligence core (Three.js). Load only through <AiCoreStage> (dynamic, client-only, with fallbacks). */
export default function AiCore3D({ activity, nodes, colors, paused, quality = "full" }: AiCore3DProps) {
  const q = TIER_SETTINGS[quality];
  const a = c3(colors.a);
  const b = c3(colors.b);
  const n = Math.max(3, Math.min(24, Math.round(nodes)));
  const act = Math.max(0, Math.min(1, activity));
  return (
    <Canvas
      frameloop={paused ? "never" : "demand"}
      dpr={q.dpr}
      camera={{ position: [0, 0.4, 5.4], fov: 45 }}
      gl={{ antialias: q.antialias, alpha: true, powerPreference: "low-power" }}
      style={{ background: "transparent" }}
      aria-hidden
    >
      <FrameDriver fps={q.fps} paused={paused} />
      <AdaptiveDpr min={q.dpr[0]} max={q.dpr[1]} fps={q.fps} />
      <ambientLight intensity={0.5} />
      <pointLight position={[3, 3, 4]} intensity={30} color={b} />
      <pointLight position={[-4, -2, 2]} intensity={18} color={a} />
      <Core colorA={a} colorB={b} activity={act} />
      <Orbits count={n} colorA={a} colorB={b} activity={act} />
      <Particles color={b} activity={act} density={q.particles} />
    </Canvas>
  );
}
