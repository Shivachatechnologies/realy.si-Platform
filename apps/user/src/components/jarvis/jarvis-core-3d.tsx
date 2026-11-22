"use client";

import { useEffect, useMemo, useRef } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { DEPARTMENTS } from "@/server/modules/voiceos/catalog";
import { TIER_SETTINGS } from "@/components/graphics/core-quality";
import { AdaptiveDpr, FrameDriver } from "@/components/graphics/r3f-kit";
import { STATE_TUNING, type CoreVisualProps } from "./core-state";

type RGB = [number, number, number];
export interface CorePalette {
  a: RGB;
  b: RGB;
  warning: RGB;
  success: RGB;
  danger: RGB;
}

const c3 = ([r, g, b]: RGB) => new THREE.Color(r / 255, g / 255, b / 255);
const PULSE_MS = 4_500;
const NODE_RADIUS = 2.55;

interface SceneProps extends CoreVisualProps {
  palette: CorePalette;
  /** "lite" on phones: fewer particles, 1–2 DPR, 30 fps (components/graphics/core-quality.ts). */
  quality?: "full" | "lite";
  /** Decorative heartbeat (public site): a slow energy wave every few seconds while idle. Not a signal. */
  ambient?: boolean;
}

function Scene({ state, level, pulses, activity, palette, quality = "full", ambient = false }: SceneProps) {
  const colA = useMemo(() => c3(palette.a), [palette.a]);
  const colB = useMemo(() => c3(palette.b), [palette.b]);
  const toneColor = useMemo(() => ({ accent: c3(palette.a), warning: c3(palette.warning), success: c3(palette.success), danger: c3(palette.danger) }), [palette]);
  const core = useRef<THREE.Mesh>(null);
  const coreMat = useRef<THREE.MeshStandardMaterial>(null);
  const halo = useRef<THREE.Mesh>(null);
  const haloMat = useRef<THREE.MeshBasicMaterial>(null);
  const shell = useRef<THREE.Mesh>(null);
  const rings = useRef<(THREE.Mesh | null)[]>([]);
  const ringMats = useRef<(THREE.MeshBasicMaterial | null)[]>([]);
  const points = useRef<THREE.Points>(null);
  const waves = useRef<(THREE.Mesh | null)[]>([]);
  const waveMats = useRef<(THREE.MeshBasicMaterial | null)[]>([]);
  const nodes = useRef<(THREE.Mesh | null)[]>([]);
  const nodeMats = useRef<(THREE.MeshBasicMaterial | null)[]>([]);
  const beamGeo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(DEPARTMENTS.length * 6), 3));
    return g;
  }, []);
  const beamMat = useRef<THREE.LineBasicMaterial>(null);
  const live = useRef({ level: 0, peak: 0, waveIdx: 0, lastWave: 0, spin: 0.15, spread: 1, glow: 0.55, color: new THREE.Color() });
  const waveState = useRef(Array.from({ length: 6 }, () => ({ born: -10, strength: 0 })));
  const lastPulseSeen = useRef<Record<string, number>>({});

  const particleGeo = useMemo(() => {
    const n = Math.round(1100 * TIER_SETTINGS[quality].particles);
    const pos = new Float32Array(n * 3);
    const base = new Float32Array(n * 3);
    let s = 987654321;
    const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < n; i++) {
      const u = r() * 2 - 1;
      const th = r() * Math.PI * 2;
      const rad = 1.9 + r() * 2.3;
      const q = Math.sqrt(1 - u * u);
      base[i * 3] = Math.cos(th) * q * rad;
      base[i * 3 + 1] = u * rad * 0.65;
      base[i * 3 + 2] = Math.sin(th) * q * rad;
    }
    pos.set(base);
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.userData.base = base;
    return g;
  }, [quality]);
  useEffect(() => () => particleGeo.dispose(), [particleGeo]);
  useEffect(() => () => beamGeo.dispose(), [beamGeo]);

  const nodePositions = useMemo(
    () => DEPARTMENTS.map((_, i) => {
      const a = (i / DEPARTMENTS.length) * Math.PI * 2;
      return new THREE.Vector3(Math.cos(a) * NODE_RADIUS, Math.sin(a * 2) * 0.35, Math.sin(a) * NODE_RADIUS);
    }),
    [],
  );

  useFrame(({ clock }, dt) => {
    const t = clock.getElapsedTime();
    const L = live.current;
    const tune = STATE_TUNING[state];
    // Smooth toward the state's tuning so transitions glide.
    const k = Math.min(1, dt * 3);
    L.spin += (tune.spin + activity * 0.3 - L.spin) * k;
    L.spread += (tune.spread - L.spread) * k;
    L.glow += (tune.glow - L.glow) * k;
    L.color.lerp(toneColor[tune.tone], Math.min(1, dt * 4));
    const raw = state === "LISTENING" || state === "SPEAKING" ? level() : 0;
    L.level += (raw - L.level) * Math.min(1, dt * 14);

    // Energy waves: a new ring on each real audio peak (and on department events below).
    const now = t;
    if (L.level > 0.22 && L.level > L.peak * 1.15 && now - L.lastWave > 0.28) {
      const w = waveState.current[L.waveIdx % 6]!;
      w.born = now;
      w.strength = Math.min(1, L.level * 1.4);
      L.waveIdx++;
      L.lastWave = now;
    }
    L.peak = Math.max(L.level, L.peak * 0.94);
    if (ambient && state === "IDLE" && now - L.lastWave > 3.4) {
      const w = waveState.current[L.waveIdx % 6]!;
      w.born = now;
      w.strength = 0.6;
      L.waveIdx++;
      L.lastWave = now;
    }

    if (core.current) {
      core.current.rotation.y += dt * L.spin;
      core.current.rotation.x += dt * L.spin * 0.35;
      const breathe = state === "IDLE" ? Math.sin(t * 1.1) * 0.03 : 0;
      core.current.scale.setScalar(1 + breathe + L.level * 0.38 + (state === "THINKING" ? Math.sin(t * 6) * 0.025 : state === "TRANSCRIBING" ? Math.sin(t * 10) * 0.018 : 0));
    }
    if (coreMat.current) {
      coreMat.current.emissive.copy(L.color);
      coreMat.current.color.copy(L.color);
      coreMat.current.emissiveIntensity = L.glow + L.level * 1.2;
    }
    if (halo.current) halo.current.scale.setScalar(1.12 + L.level * 0.6 + Math.sin(t * 0.9) * 0.04);
    if (haloMat.current) {
      haloMat.current.color.copy(L.color);
      haloMat.current.opacity = 0.1 + L.level * 0.25 + (state === "ALERT" ? (Math.sin(t * 8) + 1) * 0.08 : state === "ERROR" ? (Math.sin(t * 3) + 1) * 0.06 : 0);
    }
    if (shell.current) {
      shell.current.rotation.y -= dt * L.spin * 0.4;
      shell.current.rotation.z += dt * 0.04;
    }
    rings.current.forEach((ring, i) => {
      if (!ring) return;
      const dir = i % 2 ? -1 : 1;
      ring.rotation.z += dt * L.spin * (0.6 + i * 0.25) * dir;
      ring.rotation.x = [1.2, 0.5, -0.4][i]! + (state === "LISTENING" ? Math.sin(t * 2 + i) * 0.12 * (0.4 + L.level) : 0);
      const s = 1 + L.level * 0.12 * (i + 1) + (state === "THINKING" ? Math.sin(t * 4 + i) * 0.02 : 0);
      ring.scale.setScalar(s);
      const m = ringMats.current[i];
      if (m) {
        m.color.copy(i === 1 ? colB : L.color);
        m.opacity = 0.25 + L.glow * 0.25 + L.level * 0.3;
      }
    });
    if (points.current) {
      points.current.rotation.y += dt * (0.03 + L.spin * 0.12);
      const pos = particleGeo.getAttribute("position") as THREE.BufferAttribute;
      const base = particleGeo.userData.base as Float32Array;
      const spread = L.spread + L.level * 0.35;
      const arr = pos.array as Float32Array;
      for (let i = 0; i < arr.length; i++) arr[i] = base[i]! * spread;
      pos.needsUpdate = true;
    }
    // Department nodes light up from real stream events (and fire a wave + beam).
    const beam = beamGeo.getAttribute("position") as THREE.BufferAttribute;
    const nowMs = Date.now();
    DEPARTMENTS.forEach((d, i) => {
      const at = pulses[d] ?? 0;
      if (at && lastPulseSeen.current[d] !== at) {
        lastPulseSeen.current[d] = at;
        if (nowMs - at < 3_000) {
          const w = waveState.current[L.waveIdx % 6]!;
          w.born = now;
          w.strength = 0.55;
          L.waveIdx++;
        }
      }
      const heat = at ? Math.max(0, 1 - (nowMs - at) / PULSE_MS) : 0;
      const n = nodes.current[i];
      const p = nodePositions[i]!;
      const orbit = t * 0.08;
      const x = p.x * Math.cos(orbit) - p.z * Math.sin(orbit);
      const z = p.x * Math.sin(orbit) + p.z * Math.cos(orbit);
      if (n) {
        n.position.set(x, p.y, z);
        n.scale.setScalar(0.8 + heat * 0.9);
      }
      const nm = nodeMats.current[i];
      if (nm) {
        nm.color.copy(heat > 0.02 ? colB : colA);
        nm.opacity = 0.35 + heat * 0.65;
      }
      beam.setXYZ(i * 2, 0, 0, 0);
      beam.setXYZ(i * 2 + 1, heat > 0.02 ? x : 0, heat > 0.02 ? p.y : 0, heat > 0.02 ? z : 0);
    });
    beam.needsUpdate = true;
    if (beamMat.current) beamMat.current.opacity = 0.5;
    waveState.current.forEach((w, i) => {
      const mesh = waves.current[i];
      const mat = waveMats.current[i];
      if (!mesh || !mat) return;
      const age = now - w.born;
      if (age > 1.6) {
        mesh.visible = false;
        return;
      }
      mesh.visible = true;
      const s = 1 + age * 2.2;
      mesh.scale.setScalar(s);
      mat.color.copy(L.color);
      mat.opacity = Math.max(0, (1 - age / 1.6) * 0.45 * w.strength);
    });
  });

  return (
    <group>
      <mesh ref={core}>
        <icosahedronGeometry args={[0.78, 5]} />
        <meshStandardMaterial ref={coreMat} color={colA} emissive={colA} emissiveIntensity={0.8} roughness={0.35} metalness={0.3} />
      </mesh>
      <mesh ref={halo}>
        <sphereGeometry args={[0.95, 48, 48]} />
        <meshBasicMaterial ref={haloMat} color={colB} transparent opacity={0.14} blending={THREE.AdditiveBlending} depthWrite={false} />
      </mesh>
      <mesh>
        <sphereGeometry args={[1.12, 48, 48]} />
        <meshBasicMaterial color={colA} transparent opacity={0.06} blending={THREE.AdditiveBlending} depthWrite={false} />
      </mesh>
      <mesh ref={shell}>
        <icosahedronGeometry args={[1.3, 2]} />
        <meshBasicMaterial color={colB} wireframe transparent opacity={0.12} />
      </mesh>
      {[1.65, 1.95, 2.25].map((r, i) => (
        <mesh key={r} ref={(m) => void (rings.current[i] = m)}>
          <torusGeometry args={[r, 0.008 + i * 0.003, 6, 160]} />
          <meshBasicMaterial ref={(m) => void (ringMats.current[i] = m)} color={i === 1 ? colB : colA} transparent opacity={0.35} blending={THREE.AdditiveBlending} depthWrite={false} />
        </mesh>
      ))}
      {Array.from({ length: 6 }, (_, i) => (
        <mesh key={i} ref={(m) => void (waves.current[i] = m)} rotation={[Math.PI / 2, 0, 0]} visible={false}>
          <ringGeometry args={[1.0, 1.04, 96]} />
          <meshBasicMaterial ref={(m) => void (waveMats.current[i] = m)} color={colA} transparent opacity={0} side={THREE.DoubleSide} blending={THREE.AdditiveBlending} depthWrite={false} />
        </mesh>
      ))}
      <points ref={points} geometry={particleGeo}>
        <pointsMaterial color={colB} size={quality === "lite" ? 0.034 : 0.024} sizeAttenuation transparent opacity={0.65} depthWrite={false} blending={THREE.AdditiveBlending} />
      </points>
      {DEPARTMENTS.map((d, i) => (
        <mesh key={d} ref={(m) => void (nodes.current[i] = m)}>
          <sphereGeometry args={[0.075, 16, 16]} />
          <meshBasicMaterial ref={(m) => void (nodeMats.current[i] = m)} color={colA} transparent opacity={0.4} />
        </mesh>
      ))}
      <lineSegments geometry={beamGeo}>
        <lineBasicMaterial ref={beamMat} color={colB} transparent opacity={0.5} blending={THREE.AdditiveBlending} depthWrite={false} />
      </lineSegments>
    </group>
  );
}

/** The Realy AI Core scene (React Three Fiber). Load only through <JarvisCore> (dynamic, client-only, with fallbacks). */
export default function JarvisCore3D(props: SceneProps) {
  const q = TIER_SETTINGS[props.quality ?? "full"];
  return (
    <Canvas
      frameloop={props.paused ? "never" : "demand"}
      dpr={q.dpr}
      camera={{ position: [0, 0.9, 6.2], fov: 45 }}
      gl={{ antialias: q.antialias, alpha: true, powerPreference: "low-power" }}
      style={{ background: "transparent" }}
      aria-hidden
    >
      <FrameDriver fps={q.fps} paused={props.paused} />
      <AdaptiveDpr min={q.dpr[0]} max={q.dpr[1]} fps={q.fps} />
      <ambientLight intensity={0.45} />
      <pointLight position={[3, 3, 4]} intensity={28} color={c3(props.palette.b)} />
      <pointLight position={[-4, -2, 2]} intensity={16} color={c3(props.palette.a)} />
      <Scene {...props} />
    </Canvas>
  );
}
