"use client";

import { Canvas } from "@react-three/fiber";

type Props = {
  fileApi: string;
  fileSize: number;
  kind: "stl" | "3mf";
  fileName: string;
};

export function ModelViewer(_props: Props) {
  return (
    <div className="relative h-[60vh] w-full overflow-hidden rounded-lg border border-neutral-200 bg-neutral-100 dark:border-neutral-800 dark:bg-neutral-900 md:h-[70vh]">
      <Canvas camera={{ position: [0, 0, 100], fov: 45 }}>
        <ambientLight intensity={0.6} />
        <directionalLight position={[5, 5, 5]} intensity={0.8} />
      </Canvas>
    </div>
  );
}
