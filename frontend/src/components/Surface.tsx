import React from "react";
import { useStore } from "../lib/store";
import { A2UIRenderer } from "./A2UIRenderer";

function describeEvent(ev: any): string {
  if (!ev) return "";
  if (ev.type === "TEXT_MESSAGE_CONTENT") return `TEXT · ${JSON.stringify(ev.delta)}`;
  if (ev.type === "TOOL_CALL_START") return `TOOL · ${ev.toolCallName}`;
  if (ev.type === "TOOL_CALL_ARGS") return `TOOL_ARGS · ${JSON.stringify(ev.delta)}`;
  if (ev.type === "CUSTOM" && ev.name === "a2ui") {
    const v = ev.value ?? {};
    const kind = Object.keys(v).find((k) => k !== "version");
    const sid = v?.[kind ?? ""]?.surfaceId;
    return `A2UI · ${kind}${sid ? ` · ${sid}` : ""}`;
  }
  return ev.type ?? "";
}

export function SurfacePanel() {
  const surfaces = useStore((s) => s.surfaces);
  const lastEvent = useStore((s) => s.eventLog[s.eventLog.length - 1]?.event);

  return (
    <div className="h-full overflow-y-auto px-6 py-5" style={{ background: "var(--bg)" }}>
      {surfaces.length === 0 && (
        <div className="text-sm text-stone-400 mt-12 text-center">
          A2UI surfaces will appear here as the agent generates them.
        </div>
      )}
      <div className="space-y-8">
        {surfaces.map((surface) => (
          <section key={surface.id}>
            <div className="flex items-center gap-3 mb-3">
              <div className="text-[10px] uppercase tracking-[0.15em] text-indigo-600 font-semibold">
                surface · {surface.id}
              </div>
              <div className="flex items-center gap-1.5 text-[10px] font-mono text-stone-500 truncate">
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                <span className="truncate">{describeEvent(lastEvent)}</span>
              </div>
            </div>
            <A2UIRenderer surface={surface} />
          </section>
        ))}
      </div>
    </div>
  );
}
