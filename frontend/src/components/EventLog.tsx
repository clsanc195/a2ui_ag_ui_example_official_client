import React, { useEffect, useRef, useState } from "react";
import { useStore } from "../lib/store";

const COLORS: Record<string, string> = {
  RUN_STARTED: "text-purple-700 bg-purple-50",
  RUN_FINISHED: "text-purple-700 bg-purple-50",
  TEXT_MESSAGE_START: "text-emerald-700 bg-emerald-50",
  TEXT_MESSAGE_CONTENT: "text-emerald-700 bg-emerald-50",
  TEXT_MESSAGE_END: "text-emerald-700 bg-emerald-50",
  TOOL_CALL_START: "text-amber-700 bg-amber-50",
  TOOL_CALL_ARGS: "text-amber-700 bg-amber-50",
  TOOL_CALL_END: "text-amber-700 bg-amber-50",
  CUSTOM: "text-sky-700 bg-sky-50",
  USER_MESSAGE: "text-rose-700 bg-rose-50",
  USER_ACTION: "text-rose-700 bg-rose-50",
};

function preview(ev: any): string {
  if (ev.type === "TEXT_MESSAGE_CONTENT") return JSON.stringify(ev.delta);
  if (ev.type === "TOOL_CALL_START") return ev.toolCallName;
  if (ev.type === "TOOL_CALL_ARGS") return JSON.stringify(ev.delta);
  if (ev.type === "CUSTOM" && ev.name === "a2ui") {
    const v = ev.value ?? {};
    const kind = Object.keys(v).find((k) => k !== "version");
    const sid = v?.[kind ?? ""]?.surfaceId;
    return `a2ui · ${kind}${sid ? ` · ${sid}` : ""}`;
  }
  if (ev.type === "USER_MESSAGE") return JSON.stringify(ev.content);
  if (ev.type === "USER_ACTION") {
    const ctx = ev.context ? ` · ${JSON.stringify(ev.context)}` : "";
    return `${ev.name}${ctx}`;
  }
  return "";
}

export function EventLog() {
  const events = useStore((s) => s.eventLog);
  const ref = useRef<HTMLDivElement>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    ref.current?.scrollTo({ top: ref.current.scrollHeight });
  }, [events]);

  return (
    <div className="h-full flex flex-col border-l border-stone-200 bg-white">
      <div className="px-4 py-3 border-b border-stone-200 bg-gradient-to-b from-white to-stone-50">
        <h1 className="text-sm font-semibold text-stone-900">AG-UI events</h1>
        <p className="text-xs text-stone-500">{events.length} total · tap any row to expand</p>
        <div className="mt-2 flex gap-1.5 text-[11px]">
          <span className="inline-flex items-center gap-1 rounded-md border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-emerald-700">
            <span className="font-mono font-bold">←</span>
            <span className="font-medium">backend → UI</span>
          </span>
          <span className="inline-flex items-center gap-1 rounded-md border border-rose-200 bg-rose-50 px-2 py-0.5 text-rose-700">
            <span className="font-mono font-bold">→</span>
            <span className="font-medium">UI → backend</span>
          </span>
        </div>
      </div>
      <div ref={ref} className="flex-1 overflow-y-auto font-mono text-[11px]">
        {events.slice(-100).map((entry) => {
          const ev = entry.event;
          const isOut = entry.direction === "out";
          const color = COLORS[ev.type] ?? "text-gray-700 bg-gray-50";
          const isOpen = openId === entry.id;
          return (
            <div key={entry.id} className="border-b border-gray-100">
              <button
                onClick={() => setOpenId(isOpen ? null : entry.id)}
                className={`w-full text-left px-3 py-1.5 hover:bg-gray-50 flex gap-2 items-center ${color}`}
              >
                <span
                  className={`font-mono font-bold w-3 shrink-0 text-center ${
                    isOut ? "text-rose-600" : "text-emerald-600"
                  }`}
                  title={isOut ? "UI → backend" : "backend → UI"}
                >
                  {isOut ? "→" : "←"}
                </span>
                <span className="font-semibold">{ev.type}</span>
                <span className="text-gray-500 truncate">{preview(ev)}</span>
              </button>
              {isOpen && (
                <pre className="px-3 py-2 bg-gray-900 text-gray-100 overflow-x-auto text-[10px] leading-snug">
                  {JSON.stringify(ev, null, 2)}
                </pre>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
