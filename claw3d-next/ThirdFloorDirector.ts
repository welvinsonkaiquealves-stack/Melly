"use client";
import { useSyncExternalStore } from "react";
export type ThirdFloorEvent = {
  id: string; source: "n8n"; floorId: "dev-third"; agentId: string;
  runId: string; sequence: number;
  status: "workflow.running" | "workflow.completed" | "workflow.failed";
};
const listeners = new Set<() => void>();
let view: Readonly<Record<string, ThirdFloorEvent>> = Object.freeze({});
const empty: Readonly<Record<string, ThirdFloorEvent>> = Object.freeze({});
const runs = new Map<string, ThirdFloorEvent>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();
const id = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9_.:-]{1,120}$/.test(value);
const statuses = new Set(["workflow.running", "workflow.completed", "workflow.failed"]);
let preview: ThirdFloorEvent | null = null;
let previewTimer: ReturnType<typeof setTimeout> | undefined;
let snapshot = view;
const notify = () => {
  snapshot = preview && !view[preview.agentId]
    ? Object.freeze({ ...view, [preview.agentId]: preview }) : view;
  listeners.forEach(listener => listener());
};
export const thirdFloorDirector = {
  ingest(raw: unknown): boolean {
    const frame = raw as { type?: unknown; event?: unknown; payload?: unknown } | null;
    if (frame?.type !== "event" || frame.event !== "sofia.ops") return false;
    const event = frame.payload as ThirdFloorEvent | null;
    if (!event || event.source !== "n8n" || event.floorId !== "dev-third" || !statuses.has(event.status) ||
        !id(event.id) || !id(event.agentId) || !id(event.runId) || !Number.isSafeInteger(event.sequence) || event.sequence < 1) return true;
    const key = JSON.stringify([event.agentId, event.runId]);
    const previous = runs.get(key);
    if (previous && (event.sequence <= previous.sequence || event.id === previous.id ||
        (previous.status !== "workflow.running" && event.status === "workflow.running"))) return true;
    const active = view[event.agentId];
    if (active && active.runId !== event.runId && event.status !== "workflow.running") return true;
    const safe: ThirdFloorEvent = Object.freeze({ id: event.id, source: "n8n", floorId: "dev-third",
      agentId: event.agentId, runId: event.runId, sequence: event.sequence, status: event.status });
    runs.delete(key); runs.set(key, safe);
    while (runs.size > 100) runs.delete(runs.keys().next().value!);
    if (Object.keys(view).length >= 100 && !view[safe.agentId]) return true;
    clearTimeout(timers.get(safe.agentId));
    view = Object.freeze({ ...view, [safe.agentId]: safe });
    timers.set(safe.agentId, setTimeout(() => {
      if (view[safe.agentId] !== safe) return;
      const next = { ...view }; delete next[safe.agentId]; view = Object.freeze(next);
      timers.delete(safe.agentId); notify();
    }, safe.status === "workflow.running" ? 300000 : 30000));
    notify(); return true;
  },
  subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
  preview(status: unknown) {
    if (status !== null && !statuses.has(status as string)) return false;
    clearTimeout(previewTimer);
    preview = status === null ? null : Object.freeze({ id: "visual-preview", source: "n8n",
      floorId: "dev-third", agentId: "main", runId: "visual-preview", sequence: 1,
      status: status as ThirdFloorEvent["status"] });
    if (preview) previewTimer = setTimeout(() => { preview = null; notify(); }, 300000);
    notify(); return true;
  },
  getSnapshot: () => snapshot,
  getServerSnapshot: () => empty,
};
export const useThirdFloorDirector = () => useSyncExternalStore(
  thirdFloorDirector.subscribe, thirdFloorDirector.getSnapshot, thirdFloorDirector.getServerSnapshot,
);

// Local visual test only: no socket send, HTTP request, workflow or LLM invocation.
if (typeof window !== "undefined") {
  window.addEventListener("sofia-third-floor-preview", ((event: CustomEvent) => {
    const accepted = thirdFloorDirector.preview(event.detail);
    if (!accepted) return;
    const busy = Boolean(view.main);
    window.dispatchEvent(new CustomEvent("sofia-third-floor-preview-result", {
      detail: event.detail === null ? "ended" : busy ? "busy" : "active",
    }));
  }) as EventListener);
}
