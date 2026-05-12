// Singleton HttpAgent from the official @ag-ui/client SDK.
// The agent owns the message history; this module wires it to the Zustand store.

import { HttpAgent, AgentSubscriber } from "@ag-ui/client";
import type { Message } from "@ag-ui/core";

const BACKEND_URL = (import.meta as any).env?.VITE_BACKEND_URL ?? "http://localhost:8766";

export const agent = new HttpAgent({
  url: `${BACKEND_URL}/agent`,
});

let msgCounter = 0;
export function newMessageId(): string {
  return `u_${Date.now().toString(36)}_${++msgCounter}`;
}

export function addUserMessage(content: string): Message {
  const msg: Message = { id: newMessageId(), role: "user", content };
  agent.addMessage(msg);
  return msg;
}

export type Subscriber = AgentSubscriber;
