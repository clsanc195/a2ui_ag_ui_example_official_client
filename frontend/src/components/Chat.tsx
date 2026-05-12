import React, { useEffect, useRef, useState } from "react";
import { useStore } from "../lib/store";

export function Chat() {
  const messages = useStore((s) => s.messages);
  const running = useStore((s) => s.running);
  const status = useStore((s) => s.status);
  const sendUserMessage = useStore((s) => s.sendUserMessage);
  const [input, setInput] = useState("find me 5-star restaurants nearby");
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim()) return;
    sendUserMessage(input.trim());
    setInput("");
  };

  return (
    <div className="flex flex-col h-full border-r border-stone-200 bg-white">
      <div className="px-4 py-3 border-b border-stone-200 bg-gradient-to-b from-white to-stone-50">
        <h1 className="text-sm font-semibold text-stone-900">Chat</h1>
        <p className="text-xs text-stone-500">Try: "find me 5-star restaurants nearby"</p>
        <p className="text-[10px] text-indigo-600 mt-1 font-mono truncate">status · {status}</p>
      </div>
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        {messages.map((m) => {
          // Hide raw JSON action messages from chat view
          const isAction = m.role === "user" && m.content.startsWith("{");
          if (isAction) {
            try {
              const parsed = JSON.parse(m.content);
              return (
                <Bubble key={m.id} role="user">
                  <span className="italic text-indigo-100">↳ action: {parsed.action}</span>
                </Bubble>
              );
            } catch {
              /* fallthrough */
            }
          }
          return (
            <Bubble key={m.id} role={m.role}>
              {m.content}
            </Bubble>
          );
        })}
      </div>
      <form onSubmit={submit} className="border-t border-stone-200 p-3 flex gap-2 bg-stone-50">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask the agent…"
          className="flex-1 rounded-md border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900 focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:border-indigo-400"
        />
        <button
          type="submit"
          disabled={running}
          className="rounded-md bg-indigo-600 text-white px-3 py-2 text-sm font-semibold hover:bg-indigo-700 active:bg-indigo-800 disabled:opacity-50 disabled:hover:bg-indigo-600 shadow-sm transition-colors"
        >
          {running ? "…" : "Send"}
        </button>
      </form>
    </div>
  );
}

function Bubble({ role, children }: { role: string; children: React.ReactNode }) {
  const isUser = role === "user";
  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm shadow-sm ${
          isUser
            ? "bg-indigo-600 text-white rounded-br-sm"
            : "bg-white border border-stone-200 text-stone-800 rounded-bl-sm"
        }`}
      >
        {children}
      </div>
    </div>
  );
}
