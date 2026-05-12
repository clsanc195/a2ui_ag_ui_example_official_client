import React from "react";
import { Chat } from "./components/Chat";
import { SurfacePanel } from "./components/Surface";
import { EventLog } from "./components/EventLog";

export default function App() {
  return (
    <div className="h-screen w-screen grid grid-cols-[320px_1fr_380px]">
      <Chat />
      <SurfacePanel />
      <EventLog />
    </div>
  );
}
