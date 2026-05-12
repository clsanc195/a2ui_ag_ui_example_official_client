"""FastAPI app exposing POST /agent as an AG-UI SSE stream.

Uses `ag_ui.encoder.EventEncoder` from the official Python SDK to serialize
typed event objects to the wire format.
"""
from __future__ import annotations
from typing import Any

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from ag_ui.encoder import EventEncoder

from agent import run_agent, run_started, run_finished

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:5174"],
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["*"],
)


class Message(BaseModel):
    # @ag-ui/client accumulates assistant messages between runs, and assistant
    # messages can have content=None plus extra fields like toolCalls. Keep
    # this model permissive so a follow-up turn (e.g., the booking action
    # after a search) doesn't 422.
    model_config = {"extra": "allow"}
    id: str
    role: str
    content: str | None = None


class RunAgentInput(BaseModel):
    model_config = {"extra": "allow"}
    threadId: str
    runId: str
    messages: list[Message] = Field(default_factory=list)
    tools: list[Any] = Field(default_factory=list)
    context: list[Any] = Field(default_factory=list)
    state: dict = Field(default_factory=dict)
    forwardedProps: dict = Field(default_factory=dict)


@app.post("/agent")
async def agent_endpoint(req: RunAgentInput):
    messages = [m.model_dump() for m in req.messages]
    encoder = EventEncoder()

    async def event_stream():
        yield encoder.encode(run_started(req.threadId, req.runId))
        async for ev in run_agent(messages):
            yield encoder.encode(ev)
        yield encoder.encode(run_finished(req.threadId, req.runId))

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )


@app.get("/")
async def health():
    return {"ok": True, "sdk": "ag-ui-protocol"}
