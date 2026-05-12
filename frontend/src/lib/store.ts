// Zustand store wired to:
//   • @ag-ui/client HttpAgent (AG-UI protocol transport)
//   • @a2ui/web_core MessageProcessor (A2UI v0.9 state model)
//   • @a2ui/react basicCatalog + A2uiSurface (rendering)
//
// AG-UI CustomEvent payloads with name "a2ui" are forwarded straight into the
// official MessageProcessor — no hand-rolled A2UI reducer is involved.

import { create } from "zustand";
import type { BaseEvent, CustomEvent as AGUICustomEvent } from "@ag-ui/core";
import { MessageProcessor } from "@a2ui/web_core/v0_9";
import { basicCatalog, type ReactComponentImplementation } from "@a2ui/react/v0_9";
import type { SurfaceModel } from "@a2ui/web_core/v0_9";
import { agent, addUserMessage } from "./agent";

export type ChatMessage = { id: string; role: string; content: string };
export type Direction = "in" | "out"; // in = backend→frontend, out = frontend→backend
export type LoggedEvent = { id: string; ts: number; event: any; direction: Direction };
export type Surface = SurfaceModel<ReactComponentImplementation>;

type StoreState = {
  messages: ChatMessage[];
  surfaces: Surface[];
  eventLog: LoggedEvent[];
  running: boolean;
  status: string;

  setStatus: (s: string) => void;
  recordEvent: (ev: BaseEvent) => void;
  recordOutgoing: (ev: any) => void;
  upsertAssistantMessage: (id: string, content: string) => void;
  appendUserMessage: (msg: ChatMessage) => void;
  setRunning: (b: boolean) => void;
  addSurface: (s: Surface) => void;

  sendUserMessage: (content: string) => Promise<void>;
  sendAction: (action: { name: string; context?: Record<string, any> }) => Promise<void>;
};

let logCounter = 0;

// --------------------------------------------------------------------------
// MessageProcessor: the official A2UI v0.9 state container.
// --------------------------------------------------------------------------

export const processor = new MessageProcessor([basicCatalog], (action) => {
  console.log("[a2ui] action from surface:", action);
  // Buttons in any rendered surface emit actions via this listener. We forward
  // them straight back to the AG-UI agent as a fresh user turn.
  useStore.getState().sendAction({ name: action.name, context: action.context });
});

processor.onSurfaceCreated((surface) => {
  console.log("[a2ui] surface created:", surface.id, surface);
  useStore.getState().addSurface(surface as Surface);
});

// --------------------------------------------------------------------------
// Store
// --------------------------------------------------------------------------

export const useStore = create<StoreState>((set, get) => ({
  messages: [],
  surfaces: [],
  eventLog: [],
  running: false,
  status: "idle",

  setStatus: (s) => set({ status: s }),
  setRunning: (b) => set({ running: b }),

  recordEvent: (ev) =>
    set((state) => ({
      eventLog: [
        ...state.eventLog,
        { id: `e${++logCounter}`, ts: Date.now(), event: ev, direction: "in" as const },
      ].slice(-200),
    })),

  recordOutgoing: (ev) =>
    set((state) => ({
      eventLog: [
        ...state.eventLog,
        { id: `e${++logCounter}`, ts: Date.now(), event: ev, direction: "out" as const },
      ].slice(-200),
    })),

  upsertAssistantMessage: (id, content) =>
    set((state) => {
      const existing = state.messages.find((m) => m.id === id);
      const messages = existing
        ? state.messages.map((m) => (m.id === id ? { ...m, content } : m))
        : [...state.messages, { id, role: "assistant", content }];
      return { messages };
    }),

  appendUserMessage: (msg) => set((state) => ({ messages: [...state.messages, msg] })),

  addSurface: (s) =>
    set((state) =>
      state.surfaces.some((existing) => existing.id === s.id)
        ? state
        : { surfaces: [...state.surfaces, s] }
    ),

  sendUserMessage: async (content) => {
    const msg = addUserMessage(content);
    get().appendUserMessage({ id: msg.id, role: "user", content });
    get().recordOutgoing({ type: "USER_MESSAGE", content });
    await runOnce();
  },

  sendAction: async (action) => {
    const payload: any = { action: action.name, ...action.context };
    const serialized = JSON.stringify(payload);
    const msg = addUserMessage(serialized);
    get().appendUserMessage({ id: msg.id, role: "user", content: serialized });
    get().recordOutgoing({ type: "USER_ACTION", name: action.name, context: action.context });
    await runOnce();
  },
}));

// --------------------------------------------------------------------------
// AG-UI subscriber: bridges the typed events into the store and the A2UI
// MessageProcessor.
// --------------------------------------------------------------------------

const subscriber = {
  onRunInitialized: () => {
    useStore.getState().setRunning(true);
    useStore.getState().setStatus("POST /agent");
  },
  onRunFinalized: () => {
    useStore.getState().setRunning(false);
    useStore.getState().setStatus("done");
  },
  onRunFailed: ({ error }: { error: Error }) => {
    useStore.getState().setRunning(false);
    useStore.getState().setStatus(`error: ${error.message}`);
  },
  onEvent: ({ event }: { event: BaseEvent }) => {
    useStore.getState().recordEvent(event);
  },
  onTextMessageContentEvent: ({
    event,
    textMessageBuffer,
  }: {
    event: any;
    textMessageBuffer: string;
  }) => {
    useStore.getState().upsertAssistantMessage(event.messageId, textMessageBuffer);
  },
  onCustomEvent: ({ event }: { event: AGUICustomEvent }) => {
    if (event.name === "a2ui") {
      console.log("[a2ui] forwarding to processor:", event.value);
      try {
        processor.processMessages([event.value as any]);
      } catch (err) {
        console.error("[a2ui] processMessages failed:", err, event.value);
      }
    }
  },
} as const;

agent.subscribe(subscriber as any);

async function runOnce(): Promise<void> {
  useStore.getState().setStatus("POST /agent");
  try {
    await agent.runAgent();
    useStore.getState().setStatus("done");
  } catch (err: any) {
    console.error("agent.runAgent failed:", err);
    useStore.getState().setStatus(`error: ${err?.message ?? err}`);
    useStore.getState().setRunning(false);
  }
}
