"use client";
import { useRef, type RefObject } from "react";
import { Billboard } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { RenderAgent } from "@/features/retro-office/core/types";
import { useThirdFloorDirector } from "@/features/sofia-ops/ThirdFloorDirector";
export function ThirdFloorStatusIcon({ agentId, agentLookupRef }: {
  agentId: string; agentLookupRef?: RefObject<Map<string, RenderAgent>>;
}) {
  const state = useThirdFloorDirector()[agentId];
  const group = useRef<THREE.Group>(null);
  useFrame(() => {
    const agent = agentLookupRef?.current?.get(agentId);
    if (group.current) group.current.visible = Boolean(state && agent && agent.y >= 1700 && !agentId.startsWith("remote:"));
  });
  if (!state) return null;
  const color = state.status === "workflow.running" ? "#38bdf8" : state.status === "workflow.completed" ? "#4ade80" : "#fb7185";
  return <group ref={group} position={[0, 1.22, 0]} visible={false}>
    <Billboard><mesh><circleGeometry args={[0.09, 12]} /><meshBasicMaterial color={color} depthTest={false} /></mesh></Billboard>
  </group>;
}
