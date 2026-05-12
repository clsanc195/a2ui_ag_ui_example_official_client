"""LangGraph agent emitting AG-UI events via the official ag_ui Python SDK.

Each A2UI message embedded in a CUSTOM AG-UI event is validated against the
official ``a2ui-agent-sdk`` schema before being yielded (see ``a2ui_msgs``).
"""
from __future__ import annotations
import asyncio
import json
import uuid
from datetime import datetime, timedelta
from typing import AsyncIterator, TypedDict

from langgraph.graph import StateGraph, END

from ag_ui.core import (
    EventType,
    RunStartedEvent,
    RunFinishedEvent,
    TextMessageStartEvent,
    TextMessageContentEvent,
    TextMessageEndEvent,
    ToolCallStartEvent,
    ToolCallArgsEvent,
    ToolCallEndEvent,
    CustomEvent,
    BaseEvent,
)

import a2ui_msgs as msgs
from tools import find_restaurants, load_restaurant


def _id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:8]}"


# --------------------------------------------------------------------------
# State + routing
# --------------------------------------------------------------------------

class AgentState(TypedDict, total=False):
    messages: list[dict]
    route: str


KEYWORDS = ("restaurant", "restaurants", "find", "eat")


def _parse_action(content: str) -> dict | None:
    try:
        parsed = json.loads(content)
    except (json.JSONDecodeError, TypeError):
        return None
    if isinstance(parsed, dict) and "action" in parsed:
        return parsed
    return None


def router(state: AgentState) -> AgentState:
    last = state["messages"][-1] if state.get("messages") else {}
    content = last.get("content") or ""  # assistant messages may carry content=None
    action = _parse_action(content)
    if action and action.get("action") == "book_restaurant":
        route = "render_booking_form"
    elif action and action.get("action") == "submit_booking":
        route = "confirm_booking"
    elif any(kw in content.lower() for kw in KEYWORDS):
        route = "search_restaurants"
    else:
        route = "fallback"
    return {"route": route}


def _route_key(state: AgentState) -> str:
    return state["route"]


# --------------------------------------------------------------------------
# Streaming-text helper
# --------------------------------------------------------------------------

def _chunks(s: str, size: int = 4) -> list[str]:
    words = s.split(" ")
    out = []
    for i in range(0, len(words), size):
        chunk = " ".join(words[i:i + size])
        if i + size < len(words):
            chunk += " "
        out.append(chunk)
    return out


async def _stream_text(text: str) -> AsyncIterator[BaseEvent]:
    mid = _id("msg")
    yield TextMessageStartEvent(
        type=EventType.TEXT_MESSAGE_START, message_id=mid, role="assistant"
    )
    for chunk in _chunks(text):
        await asyncio.sleep(0.05)
        yield TextMessageContentEvent(
            type=EventType.TEXT_MESSAGE_CONTENT, message_id=mid, delta=chunk
        )
    yield TextMessageEndEvent(type=EventType.TEXT_MESSAGE_END, message_id=mid)


def _a2ui_custom(payload: dict) -> CustomEvent:
    return CustomEvent(type=EventType.CUSTOM, name="a2ui", value=payload)


# --------------------------------------------------------------------------
# Leaf nodes
# --------------------------------------------------------------------------

async def search_restaurants(state: AgentState) -> AsyncIterator[BaseEvent]:
    async for ev in _stream_text("Searching for 5-star spots within 5 miles..."):
        yield ev

    call_id = _id("tc")
    parent_mid = _id("msg")
    yield ToolCallStartEvent(
        type=EventType.TOOL_CALL_START,
        tool_call_id=call_id,
        tool_call_name="find_restaurants",
        parent_message_id=parent_mid,
    )
    yield ToolCallArgsEvent(
        type=EventType.TOOL_CALL_ARGS, tool_call_id=call_id, delta='{"min_rating":'
    )
    await asyncio.sleep(0.05)
    yield ToolCallArgsEvent(
        type=EventType.TOOL_CALL_ARGS, tool_call_id=call_id, delta=' 5, "radius_miles": 5}'
    )
    yield ToolCallEndEvent(type=EventType.TOOL_CALL_END, tool_call_id=call_id)

    surface = "results"
    yield _a2ui_custom(msgs.create_surface(surface))

    # Seed root container so children can attach incrementally.
    yield _a2ui_custom(msgs.update_components(surface, [
        msgs.column("root", []),
    ]))

    card_ids: list[str] = []
    idx = 0
    async for restaurant in find_restaurants(min_rating=5.0, radius_miles=5.0):
        key = f"restaurant_{idx}"
        meta_line = (
            f"★ {restaurant['rating']:.1f} · "
            f"{restaurant['review_count']:,} reviews · "
            f"{restaurant['distance_miles']} mi · "
            f"{restaurant['neighborhood']}"
        )

        # Push restaurant data into the surface's data model.
        yield _a2ui_custom(msgs.update_data_model(surface, f"/{key}", {
            "name": restaurant["name"],
            "image_url": restaurant["image_url"],
            "meta_line": meta_line,
        }))

        # Build the card components: Card → Row → [Image, Column → [name, meta, button]]
        card_id = f"card_{idx}"
        row_id = f"{card_id}_row"
        text_col_id = f"{card_id}_text"
        img_id = f"{card_id}_img"
        name_id = f"{card_id}_name"
        meta_id = f"{card_id}_meta"
        btn_text_id = f"{card_id}_btn_text"
        btn_id = f"{card_id}_btn"

        yield _a2ui_custom(msgs.update_components(surface, [
            msgs.card(card_id, row_id),
            msgs.row(row_id, [img_id, text_col_id]),
            msgs.image(img_id, msgs.path(f"/{key}/image_url")),
            msgs.column(text_col_id, [name_id, meta_id, btn_id]),
            msgs.text(name_id, msgs.path(f"/{key}/name"), usage_hint="h2"),
            msgs.text(meta_id, msgs.path(f"/{key}/meta_line")),
            msgs.text(btn_text_id, "Book a table"),
            msgs.button(btn_id, btn_text_id, "book_restaurant",
                        {"restaurantId": restaurant["id"]}),
        ]))

        # Replace root's children to include the new card.
        card_ids.append(card_id)
        yield _a2ui_custom(msgs.update_components(surface, [
            msgs.column("root", card_ids),
        ]))

        idx += 1

    async for ev in _stream_text("Found 5 spots. Tap one to book."):
        yield ev


async def render_booking_form(state: AgentState) -> AsyncIterator[BaseEvent]:
    last = state["messages"][-1]
    payload = _parse_action(last["content"]) or {}
    restaurant = load_restaurant(payload.get("restaurantId", "")) or {"name": "this spot", "id": ""}

    async for ev in _stream_text(f"Let's book {restaurant['name']}. Pick a time:"):
        yield ev

    surface = "booking_form"
    yield _a2ui_custom(msgs.create_surface(surface))

    tomorrow_7pm = (datetime.now() + timedelta(days=1)).replace(hour=19, minute=0, second=0, microsecond=0)
    default_dt = tomorrow_7pm.strftime("%Y-%m-%dT%H:%M")

    yield _a2ui_custom(msgs.update_data_model(surface, "/form", {
        "heading": f"Book a table at {restaurant['name']}",
        "datetime": default_dt,
        "party": "2",
        "name": "",
    }))

    yield _a2ui_custom(msgs.update_components(surface, [
        msgs.column("root", ["heading", "datetime_input", "party_input", "name_input", "submit_btn"]),
        msgs.text("heading", msgs.path("/form/heading"), usage_hint="h1"),
        msgs.datetime_input("datetime_input", "/form/datetime"),
        msgs.text_field("party_input", "/form/party", label="Party size", input_type="number"),
        msgs.text_field("name_input", "/form/name", label="Your name"),
        msgs.text("submit_btn_text", "Confirm booking"),
        msgs.button("submit_btn", "submit_btn_text", "submit_booking",
                    {"restaurantId": restaurant["id"]}),
    ]))


async def confirm_booking(state: AgentState) -> AsyncIterator[BaseEvent]:
    last = state["messages"][-1]
    payload = _parse_action(last["content"]) or {}
    data = payload.get("data", {})
    restaurant = load_restaurant(payload.get("restaurantId", "")) or {"name": "your spot"}

    async for ev in _stream_text("Booked! Confirmation below."):
        yield ev

    surface = "confirmation"
    yield _a2ui_custom(msgs.create_surface(surface))

    yield _a2ui_custom(msgs.update_data_model(surface, "/conf", {
        "title": f"Confirmed: {restaurant['name']}",
        "when": f"When: {data.get('datetime', '—')}",
        "party": f"Party: {data.get('party', '—')}",
        "name_field": f"Name: {data.get('name', '—')}",
        "status": "Confirmed ✓",
    }))

    yield _a2ui_custom(msgs.update_components(surface, [
        msgs.card("root", "conf_col"),
        msgs.column("conf_col", ["conf_title", "conf_when", "conf_party", "conf_name", "conf_status"]),
        msgs.text("conf_title", msgs.path("/conf/title"), usage_hint="h1"),
        msgs.text("conf_when", msgs.path("/conf/when")),
        msgs.text("conf_party", msgs.path("/conf/party")),
        msgs.text("conf_name", msgs.path("/conf/name_field")),
        msgs.text("conf_status", msgs.path("/conf/status"), usage_hint="h2"),
    ]))


async def fallback(state: AgentState) -> AsyncIterator[BaseEvent]:
    async for ev in _stream_text("Try: 'find me 5-star restaurants nearby'"):
        yield ev


NODES = {
    "search_restaurants": search_restaurants,
    "render_booking_form": render_booking_form,
    "confirm_booking": confirm_booking,
    "fallback": fallback,
}


def _noop(_state: AgentState) -> AgentState:
    return {}


def build_graph():
    g = StateGraph(AgentState)
    g.add_node("router", router)
    for name in NODES:
        g.add_node(name, _noop)
    g.set_entry_point("router")
    g.add_conditional_edges("router", _route_key, {n: n for n in NODES})
    for name in NODES:
        g.add_edge(name, END)
    return g.compile()


GRAPH = build_graph()


async def run_agent(messages: list[dict]) -> AsyncIterator[BaseEvent]:
    state: AgentState = {"messages": messages}
    result = await GRAPH.ainvoke(state)
    route = result.get("route", "fallback")
    node = NODES[route]
    async for ev in node({"messages": messages, "route": route}):
        yield ev


def run_started(thread_id: str, run_id: str) -> BaseEvent:
    return RunStartedEvent(type=EventType.RUN_STARTED, thread_id=thread_id, run_id=run_id)


def run_finished(thread_id: str, run_id: str) -> BaseEvent:
    return RunFinishedEvent(type=EventType.RUN_FINISHED, thread_id=thread_id, run_id=run_id)
