"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { Bounds, OrbitControls } from "@react-three/drei";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import * as THREE from "three";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import { ThreeMFLoader } from "three/examples/jsm/loaders/3MFLoader.js";
import type { ModelLoaderKind } from "@/server/browse/model-preview";

type Props = {
  fileApi: string;
  fileSize: number;
  kind: ModelLoaderKind;
  fileName: string;
};

type LoadedModel =
  | { type: "stl"; geometry: THREE.BufferGeometry }
  | { type: "3mf"; group: THREE.Group };

export function ModelViewer({ fileApi, kind, fileName }: Props) {
  const [model, setModel] = useState<LoadedModel | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [wireframe, setWireframe] = useState(false);
  const controlsRef = useRef<OrbitControlsImpl | null>(null);

  useEffect(() => {
    const ac = new AbortController();
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(fileApi, { signal: ac.signal });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const buf = await res.arrayBuffer();
        if (cancelled) return;
        if (kind === "stl") {
          const geometry = new STLLoader().parse(buf);
          geometry.computeBoundingBox();
          if (geometry.boundingBox) {
            const c = new THREE.Vector3();
            geometry.boundingBox.getCenter(c);
            geometry.translate(-c.x, -c.y, -c.z);
          }
          geometry.computeVertexNormals();
          setModel({ type: "stl", geometry });
        } else {
          const group = new ThreeMFLoader().parse(buf);
          setModel({ type: "3mf", group });
        }
      } catch (e) {
        if (cancelled || (e as { name?: string }).name === "AbortError") return;
        console.error("ModelViewer load failed", fileName, e);
        setError("Could not load this file.");
      }
    })();
    return () => {
      cancelled = true;
      ac.abort();
    };
  }, [fileApi, kind, fileName]);

  // Push the wireframe flag down into every material inside a 3MF group.
  // For STL we toggle it via a prop on <meshStandardMaterial> directly.
  useEffect(() => {
    if (model?.type !== "3mf") return;
    model.group.traverse((obj) => {
      if (!(obj instanceof THREE.Mesh)) return;
      const materials = Array.isArray(obj.material) ? obj.material : [obj.material];
      for (const m of materials) {
        if (m && "wireframe" in m) {
          (m as THREE.Material & { wireframe: boolean }).wireframe = wireframe;
          m.needsUpdate = true;
        }
      }
    });
  }, [wireframe, model]);

  const stlMaterial = useMemo(
    () => <meshStandardMaterial color="#a3a3a3" wireframe={wireframe} />,
    [wireframe],
  );

  if (error) {
    return (
      <div className="flex h-[60vh] w-full items-center justify-center rounded-lg border border-dashed border-neutral-300 bg-neutral-50 text-sm text-neutral-500 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-400 md:h-[70vh]">
        {error} Use the Download button.
      </div>
    );
  }

  return (
    <div className="relative h-[60vh] w-full overflow-hidden rounded-lg border border-neutral-200 bg-neutral-100 dark:border-neutral-800 dark:bg-neutral-900 md:h-[70vh]">
      <Canvas camera={{ position: [0, 0, 100], fov: 45 }}>
        <ambientLight intensity={0.6} />
        <directionalLight position={[5, 5, 5]} intensity={0.8} />
        <Suspense fallback={null}>
          {model && (
            <Bounds fit clip observe margin={1.2}>
              {model.type === "stl" ? (
                <mesh geometry={model.geometry}>{stlMaterial}</mesh>
              ) : (
                <primitive object={model.group} />
              )}
            </Bounds>
          )}
        </Suspense>
        <OrbitControls ref={controlsRef} makeDefault enableDamping dampingFactor={0.1} />
      </Canvas>

      {/* Toolbar */}
      <div className="absolute right-2 top-2 flex gap-1">
        <button
          type="button"
          onClick={() => setWireframe((w) => !w)}
          aria-pressed={wireframe}
          className="rounded border border-neutral-300 bg-white/90 px-2 py-1 text-xs text-neutral-700 backdrop-blur hover:bg-white dark:border-neutral-700 dark:bg-neutral-950/80 dark:text-neutral-300 dark:hover:bg-neutral-900"
        >
          {wireframe ? "Solid" : "Wireframe"}
        </button>
        <button
          type="button"
          onClick={() => controlsRef.current?.reset()}
          className="rounded border border-neutral-300 bg-white/90 px-2 py-1 text-xs text-neutral-700 backdrop-blur hover:bg-white dark:border-neutral-700 dark:bg-neutral-950/80 dark:text-neutral-300 dark:hover:bg-neutral-900"
        >
          Reset
        </button>
      </div>

      {!model && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-neutral-500 dark:text-neutral-400">
          Loading model…
        </div>
      )}
    </div>
  );
}
