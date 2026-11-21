"use client";

import { useEffect, useMemo, useRef, type MutableRefObject } from "react";
import { Canvas, useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { hueOf, SIZE, type NetLayout } from "./network-layout";
import { PULSE_COLOR, type Pulse } from "./network-signals";

export interface NetworkScene3DProps {
  layout: NetLayout;
  pulsesRef: MutableRefObject<Pulse[]>;
  selected: number | null;
  onSelect: (index: number) => void;
  onHover: (index: number | null, x: number, y: number) => void;
  reduced: boolean;
  paused: boolean;
  dark: boolean;
}

const PULSE_POOL = 96;
const PULSE_MS = 1600;

function nodeColor(c: THREE.Color, department: string, status: string, human: boolean, dark: boolean) {
  if (status === "paused") return c.setHSL(0, 0, dark ? 0.35 : 0.65);
  const h = hueOf(department) / 360;
  if (human) return c.setHSL(h, 0.25, dark ? 0.78 : 0.45);
  return c.setHSL(h, status === "busy" ? 0.9 : 0.65, status === "busy" ? (dark ? 0.66 : 0.5) : dark ? 0.55 : 0.45);
}

function Controls({ radius, reduced }: { radius: number; reduced: boolean }) {
  const { camera, gl } = useThree();
  const ref = useRef<OrbitControls | null>(null);
  useEffect(() => {
    camera.position.set(0, radius * 0.85 + 4, radius * 1.45 + 6);
    camera.lookAt(0, 0, 0);
    const c = new OrbitControls(camera, gl.domElement);
    c.enableDamping = true;
    c.dampingFactor = 0.08;
    c.autoRotate = !reduced;
    c.autoRotateSpeed = 0.25;
    c.maxDistance = radius * 5 + 30;
    c.minDistance = 2;
    ref.current = c;
    return () => c.dispose();
  }, [camera, gl, radius, reduced]);
  useFrame(() => ref.current?.update());
  return null;
}

function Nodes({ layout, selected, onSelect, onHover, reduced, dark }: Omit<NetworkScene3DProps, "pulsesRef" | "paused">) {
  const mesh = useRef<THREE.InstancedMesh>(null);
  const count = layout.placed.length;
  // LOD: fewer sphere segments for big organizations.
  const geometry = useMemo(() => new THREE.IcosahedronGeometry(1, count > 800 ? 0 : count > 250 ? 1 : 3), [count]);
  const busy = useMemo(() => layout.placed.flatMap((p, i) => (p.node.status === "busy" ? [i] : [])), [layout]);
  const tmp = useMemo(() => new THREE.Object3D(), []);
  useEffect(() => {
    const m = mesh.current;
    if (!m) return;
    const c = new THREE.Color();
    layout.placed.forEach((p, i) => {
      tmp.position.set(p.x, p.y, p.z);
      tmp.scale.setScalar(SIZE[p.node.level]);
      tmp.updateMatrix();
      m.setMatrixAt(i, tmp.matrix);
      m.setColorAt(i, nodeColor(c, p.node.department, p.node.status, p.node.kind === "human", dark));
    });
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
    m.computeBoundingSphere();
  }, [layout, tmp, dark]);
  // Busy employees breathe (only their instances are touched each frame).
  useFrame(({ clock }) => {
    const m = mesh.current;
    if (!m || reduced || !busy.length) return;
    const t = clock.getElapsedTime();
    for (const i of busy) {
      const p = layout.placed[i]!;
      tmp.position.set(p.x, p.y, p.z);
      tmp.scale.setScalar(SIZE[p.node.level] * (1 + 0.18 * Math.sin(t * 3 + i)));
      tmp.updateMatrix();
      m.setMatrixAt(i, tmp.matrix);
    }
    m.instanceMatrix.needsUpdate = true;
  });
  const sel = selected !== null ? layout.placed[selected] : null;
  return (
    <>
      <instancedMesh
        ref={mesh}
        args={[geometry, undefined, count]}
        onClick={(e: ThreeEvent<MouseEvent>) => {
          e.stopPropagation();
          if (e.instanceId !== undefined) onSelect(e.instanceId);
        }}
        onPointerMove={(e: ThreeEvent<PointerEvent>) => {
          e.stopPropagation();
          onHover(e.instanceId ?? null, e.nativeEvent.offsetX, e.nativeEvent.offsetY);
        }}
        onPointerOut={() => onHover(null, 0, 0)}
      >
        <meshStandardMaterial roughness={0.35} metalness={0.2} emissiveIntensity={0.5} toneMapped={false} />
      </instancedMesh>
      {sel ? (
        <mesh position={[sel.x, sel.y, sel.z]} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[SIZE[sel.node.level] * 1.9, 0.03, 8, 48]} />
          <meshBasicMaterial color={dark ? "#ffffff" : "#111827"} transparent opacity={0.85} />
        </mesh>
      ) : null}
    </>
  );
}

function Edges({ layout, dark }: { layout: NetLayout; dark: boolean }) {
  const geometry = useMemo(() => {
    const pos = new Float32Array(layout.edges.length * 6);
    layout.edges.forEach(([a, b], i) => {
      const p = layout.placed[a]!;
      const q = layout.placed[b]!;
      pos.set([p.x, p.y, p.z, q.x, q.y, q.z], i * 6);
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    return g;
  }, [layout]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  return (
    <lineSegments geometry={geometry}>
      <lineBasicMaterial color={dark ? "#8ea2ff" : "#4f5fbf"} transparent opacity={dark ? 0.28 : 0.35} depthWrite={false} />
    </lineSegments>
  );
}

function Pulses({ layout, pulsesRef, reduced }: { layout: NetLayout; pulsesRef: MutableRefObject<Pulse[]>; reduced: boolean }) {
  const mesh = useRef<THREE.InstancedMesh>(null);
  const tmp = useMemo(() => new THREE.Object3D(), []);
  const color = useMemo(() => new THREE.Color(), []);
  useFrame(() => {
    const m = mesh.current;
    if (!m) return;
    const now = performance.now();
    pulsesRef.current = pulsesRef.current.filter((p) => now - p.start < PULSE_MS && p.from < layout.placed.length && p.to < layout.placed.length);
    const active = pulsesRef.current.slice(-PULSE_POOL);
    for (let i = 0; i < PULSE_POOL; i++) {
      const p = active[i];
      if (!p) {
        tmp.scale.setScalar(0);
        tmp.updateMatrix();
        m.setMatrixAt(i, tmp.matrix);
        continue;
      }
      const t = Math.min(1, (now - p.start) / PULSE_MS);
      const a = layout.placed[p.from]!;
      const b = layout.placed[p.to]!;
      if (p.from === p.to) {
        // A single-node event: a flash that swells and settles at the node.
        tmp.position.set(a.x, a.y, a.z);
        tmp.scale.setScalar(SIZE[a.node.level] * (reduced ? 1.4 : 1 + t * 1.6) * (1 - t * 0.6));
      } else {
        const k = reduced ? 1 : t;
        tmp.position.set(a.x + (b.x - a.x) * k, a.y + (b.y - a.y) * k + Math.sin(k * Math.PI) * 0.6, a.z + (b.z - a.z) * k);
        tmp.scale.setScalar(0.12);
      }
      tmp.updateMatrix();
      m.setMatrixAt(i, tmp.matrix);
      m.setColorAt(i, color.set(PULSE_COLOR[p.kind]));
    }
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  });
  return (
    <instancedMesh ref={mesh} args={[undefined, undefined, PULSE_POOL]} frustumCulled={false} raycast={() => null}>
      <sphereGeometry args={[1, 10, 10]} />
      <meshBasicMaterial transparent opacity={0.9} toneMapped={false} depthWrite={false} blending={THREE.AdditiveBlending} />
    </instancedMesh>
  );
}

function Grid({ radius, dark }: { radius: number; dark: boolean }) {
  return (
    <group position={[0, -3.25, 0]}>
      <gridHelper args={[Math.ceil(radius * 2.4 + 8), 24, dark ? "#2b3358" : "#c7cde8", dark ? "#1c2240" : "#e3e7f5"]} />
    </group>
  );
}

/** The holographic company network (React Three Fiber, instanced meshes: one draw call for all nodes and edges). */
export default function NetworkScene3D(props: NetworkScene3DProps) {
  const { layout, paused, reduced, dark } = props;
  return (
    <Canvas frameloop={paused ? "never" : "always"} dpr={[1, 1.75]} gl={{ antialias: layout.placed.length < 1500, alpha: true }} camera={{ fov: 45, near: 0.1, far: 2000 }} onPointerMissed={() => props.onHover(null, 0, 0)}>
      <fog attach="fog" args={[dark ? "#070a18" : "#eef1fb", layout.radius * 1.8 + 10, layout.radius * 4.5 + 40]} />
      <ambientLight intensity={dark ? 0.55 : 0.8} />
      <pointLight position={[0, 12, 0]} intensity={dark ? 60 : 40} distance={layout.radius * 4 + 40} />
      <directionalLight position={[8, 14, 6]} intensity={0.7} />
      <Edges layout={layout} dark={dark} />
      <Nodes {...props} />
      <Pulses layout={layout} pulsesRef={props.pulsesRef} reduced={reduced} />
      <Grid radius={layout.radius} dark={dark} />
      <Controls radius={layout.radius} reduced={reduced} />
    </Canvas>
  );
}
