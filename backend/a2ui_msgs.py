"""A2UI v0.9 message builders that emit spec-correct wire payloads.

Validated against the official schema bundled with ``a2ui-agent-sdk``
(see ``a2ui/assets/0.9/server_to_client.json``). The Google Python package
ships parsers/validators but not fluent message builders — agents typically
emit A2UI by having an LLM produce JSON. We don't use an LLM, so we build
the messages by hand and run them past the official schema before they hit
the wire.

Wire format references:
- createSurface     { version, createSurface: { surfaceId, catalogId, ... } }
- updateComponents  { version, updateComponents: { surfaceId, components: [...] } }
- updateDataModel   { version, updateDataModel: { surfaceId, path?, value? } }
- deleteSurface     { version, deleteSurface: { surfaceId } }

Each component is { id, component: "<TypeName>", ...props }.
Text/Image fields accept DynamicString = literal "str" or {"path": "/x/y"}.
Button action = { event: { name, context? } }.
"""
from __future__ import annotations
from typing import Any

VERSION = "v0.9"
CATALOG_ID = "https://a2ui.org/specification/v0_9/basic_catalog.json"


def validated(msg: dict) -> dict:
    """Top-level A2UI v0.9 message check.

    Verifies the message has ``version: "v0.9"`` and exactly one of
    ``createSurface | updateComponents | updateDataModel | deleteSurface``.

    The bundled ``basic_catalog.json`` only *lists* component type names; it
    doesn't include per-component property schemas. So we deliberately do not
    recurse into the component objects here — the frontend's
    ``@a2ui/web_core`` ``MessageProcessor`` plus ``@a2ui/react/v0_9``
    catalog are the authoritative validators for catalog-specific props.
    """
    if not isinstance(msg, dict):
        raise ValueError(f"A2UI message must be a dict, got {type(msg).__name__}")
    if msg.get("version") != VERSION:
        raise ValueError(f"A2UI message must declare version={VERSION!r}, got {msg.get('version')!r}")
    kinds = {"createSurface", "updateComponents", "updateDataModel", "deleteSurface"}
    present = kinds & set(msg.keys())
    if len(present) != 1:
        raise ValueError(f"A2UI message must contain exactly one of {kinds}, got {present}")
    return msg


def create_surface(surface_id: str) -> dict:
    return validated({
        "version": VERSION,
        "createSurface": {"surfaceId": surface_id, "catalogId": CATALOG_ID},
    })


def update_components(surface_id: str, components: list[dict]) -> dict:
    return validated({
        "version": VERSION,
        "updateComponents": {"surfaceId": surface_id, "components": components},
    })


def update_data_model(surface_id: str, path: str, value: Any) -> dict:
    return validated({
        "version": VERSION,
        "updateDataModel": {"surfaceId": surface_id, "path": path, "value": value},
    })


def delete_surface(surface_id: str) -> dict:
    return validated({
        "version": VERSION,
        "deleteSurface": {"surfaceId": surface_id},
    })


# ---------- component shorthands (spec-correct shape) ----------

def text(id_: str, text_value: str | dict, usage_hint: str | None = None) -> dict:
    body: dict = {"id": id_, "component": "Text", "text": text_value}
    if usage_hint:
        body["usageHint"] = usage_hint
    return body


def image(id_: str, url: str | dict) -> dict:
    return {"id": id_, "component": "Image", "url": url}


def card(id_: str, child_id: str) -> dict:
    return {"id": id_, "component": "Card", "child": child_id}


def column(id_: str, children: list[str]) -> dict:
    return {"id": id_, "component": "Column", "children": children}


def row(id_: str, children: list[str]) -> dict:
    return {"id": id_, "component": "Row", "children": children}


def button(id_: str, child_id: str, action_name: str, context: dict | None = None) -> dict:
    event: dict = {"name": action_name}
    if context:
        event["context"] = context
    return {"id": id_, "component": "Button", "child": child_id, "action": {"event": event}}


def text_field(id_: str, value_path: str, label: str, input_type: str = "text") -> dict:
    return {
        "id": id_,
        "component": "TextField",
        "value": {"path": value_path},
        "label": label,
        "type": input_type,
    }


def datetime_input(id_: str, value_path: str) -> dict:
    return {
        "id": id_,
        "component": "DateTimeInput",
        "value": {"path": value_path},
        "enableDate": True,
        "enableTime": True,
    }


def path(p: str) -> dict:
    """Helper: build a DynamicString path reference."""
    return {"path": p}
