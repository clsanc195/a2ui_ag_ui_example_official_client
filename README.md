# Restaurant Finder — Official AG-UI + A2UI SDKs

End-to-end demo composing two open protocols using **official libraries on
the wire** on both ends:

| Protocol | Where    | Library                                                                                          |
| -------- | -------- | ------------------------------------------------------------------------------------------------ |
| AG-UI    | Backend  | [`ag-ui-protocol`](https://pypi.org/project/ag-ui-protocol/) — Pydantic event models + `EventEncoder` for SSE |
| AG-UI    | Frontend | [`@ag-ui/client`](https://www.npmjs.com/package/@ag-ui/client) — `HttpAgent` + `AgentSubscriber` |
| A2UI     | Backend  | [`a2ui-agent-sdk`](https://pypi.org/project/a2ui-agent-sdk/) — schema assets used for validation |
| A2UI     | Frontend | [`@a2ui/web_core`](https://www.npmjs.com/package/@a2ui/web_core) — `MessageProcessor` (state model) |

The visible cards in the middle column are rendered by a small **custom
React renderer** that walks `@a2ui/web_core`'s `SurfaceModel` and produces
its own Tailwind DOM — a documented extension path (web_core is
framework-agnostic and ships separately from the renderer packages
`@a2ui/react`, `@a2ui/lit`, `@a2ui/angular`). The protocol layer remains
fully official.

## Requirements

- Python 3.11 or newer
- Node 20 or newer

## Quick start

Two terminals, both started from the repo root.

### Terminal 1 — backend (port 8766)

One-liner (creates venv, installs deps, runs server):

```bash
cd backend && python3.11 -m venv .venv && source .venv/bin/activate && python -m pip install -r requirements.txt && uvicorn main:app --reload --port 8766
```

Step-by-step:

```bash
cd backend
python3.11 -m venv .venv         # first time only
source .venv/bin/activate         # every new shell — venv lives in backend/.venv
python -m pip install -r requirements.txt   # first time + whenever requirements change
uvicorn main:app --reload --port 8766
```

### Terminal 2 — frontend (port 5174)

```bash
cd frontend
npm install                       # first time + whenever package.json changes
npm run dev
```

Then open <http://localhost:5174> and send *"find me 5-star restaurants nearby"*.

### Common gotchas

- `source: no such file or directory: .venv/bin/activate` — you're not in `backend/`. `cd backend` first, or `source backend/.venv/bin/activate` from the root.
- `pip: command not found` — venv isn't activated. After `source .venv/bin/activate`, either `pip` or `python -m pip` works. Without activation, use `.venv/bin/pip`.
- To target a different backend URL, set `VITE_BACKEND_URL=http://host:port npm run dev` and add the new origin to `allow_origins` in `backend/main.py`.

## What's in the UI

Three columns:

| Column | Contents                                                                                                       |
| ------ | -------------------------------------------------------------------------------------------------------------- |
| Left   | Chat log + input. Tiny `status · ...` line under the title tracks the current AG-UI request lifecycle.        |
| Middle | Active A2UI surface(s). Result cards tile into a responsive grid. The booking form is its own surface.        |
| Right  | Every event flowing through the system, color-coded. A legend at the top explains the arrow direction.        |

### Event log legend

| Arrow | Direction      | Source                                                                       |
| ----- | -------------- | ---------------------------------------------------------------------------- |
| `←`   | backend → UI   | AG-UI events from the SSE stream (`RUN_STARTED`, `TEXT_MESSAGE_*`, `TOOL_CALL_*`, `CUSTOM` with `a2ui` payloads, `RUN_FINISHED`) |
| `→`   | UI → backend   | Synthetic `USER_MESSAGE` (chat input) or `USER_ACTION` (button click) — the POST body the frontend sends to `/agent` |

Click any row to expand the full JSON.

## Architecture

```
Browser                                          Backend
────────────────────────────────────────         ───────────────────────────────────────
Chat input                                       FastAPI  POST /agent
  └─ store.sendUserMessage                          └─ LangGraph router
       └─ HttpAgent.runAgent()  ─── HTTP POST ─►       ├─ search_restaurants
                                                       ├─ render_booking_form
                                                       ├─ confirm_booking
                                                       └─ fallback
                                                            │
                                                            ▼  yields typed events
                          ◄── SSE: ag_ui.encoder.encode(event) ──
HttpAgent → AgentSubscriber
  ├─ onTextMessageContentEvent → chat bubble update
  ├─ onCustomEvent (name="a2ui") → processor.processMessages([msg])
  └─ onRunInitialized/Finalized → status indicator

MessageProcessor (@a2ui/web_core/v0_9)
  ├─ Validates each A2UI message against the official Google schemas
  ├─ Maintains SurfaceModel.componentsModel (component tree)
  └─ Maintains SurfaceModel.dataModel (reactive signals)
        │
        ▼
Custom React renderer (A2UIRenderer.tsx)
  └─ Walks the SurfaceModel, renders Tailwind DOM, dispatches button
     actions back through store.sendAction → HttpAgent
```

## What is and isn't hand-built

| Concern                                  | Implementation                                          |
| ---------------------------------------- | ------------------------------------------------------- |
| AG-UI event construction (backend)       | Official: `ag_ui.core` event classes                    |
| AG-UI SSE encoding                       | Official: `ag_ui.encoder.EventEncoder`                  |
| AG-UI client transport (frontend)        | Official: `new HttpAgent({url})`                        |
| AG-UI event dispatch (frontend)          | Official: `agent.subscribe({onCustomEvent, ...})`       |
| A2UI v0.9 message wire format            | Spec-correct (`createSurface`, `updateComponents`, `updateDataModel`); accepted by the official `MessageProcessor` |
| A2UI state (component tree + data model) | Official: `MessageProcessor` from `@a2ui/web_core/v0_9` |
| A2UI button action dispatch              | Official: `MessageProcessor` action handler             |
| **Backend A2UI message builders**        | Thin helpers in `backend/a2ui_msgs.py` (the official Python SDK is parser-oriented, designed for LLM-generated A2UI). Top-level message shape is validated against Google's bundled `server_to_client.json` schema. |
| **A2UI component rendering**             | Custom React renderer (`A2UIRenderer.tsx`) walking the SDK's `SurfaceModel`. Uses Tailwind instead of `<A2uiSurface>`'s theme classes. |
| LangGraph routing                        | Hand-rolled deterministic router (no LLM)               |
| Restaurant data                          | Mocked JSON in `backend/data/restaurants.json`          |

## A2UI v0.9 wire format used

```jsonc
// createSurface
{"version":"v0.9","createSurface":{"surfaceId":"results","catalogId":"https://a2ui.org/specification/v0_9/basic_catalog.json"}}

// updateComponents (component is a string type-name; props live alongside)
{"version":"v0.9","updateComponents":{"surfaceId":"results","components":[
  {"id":"root","component":"Column","children":["card_0"]},
  {"id":"card_0","component":"Card","child":"card_0_row"},
  {"id":"card_0_row","component":"Row","children":["card_0_img","card_0_text"]},
  {"id":"card_0_img","component":"Image","url":{"path":"/restaurant_0/image_url"}},
  {"id":"card_0_text","component":"Column","children":["card_0_name","card_0_meta","card_0_btn"]},
  {"id":"card_0_name","component":"Text","text":{"path":"/restaurant_0/name"},"usageHint":"h2"},
  {"id":"card_0_meta","component":"Text","text":{"path":"/restaurant_0/meta_line"}},
  {"id":"card_0_btn_text","component":"Text","text":"Book a table"},
  {"id":"card_0_btn","component":"Button","child":"card_0_btn_text","action":{"event":{"name":"book_restaurant","context":{"restaurantId":"r_001"}}}}
]}}

// updateDataModel (path + value; value may be a nested object)
{"version":"v0.9","updateDataModel":{"surfaceId":"results","path":"/restaurant_0","value":{
  "name":"Joe's Stone Crab","image_url":"https://…","meta_line":"★ 5.0 · 4,821 reviews · 3.2 mi · South Beach"
}}}
```

A2UI v0.9 requires that exactly one component in the message has `id: "root"` — that's the entry point the renderer renders from.

## Demo guide

The three-column layout is intentionally a teaching aid: **the same A2UI
JSON is visible on the right and rendered as cards in the middle.** During
a live demo you can walk through both at once.

### What to point at, in order

1. **Send the search query** (`"find me 5-star restaurants nearby"`). Cards
   land one at a time in the middle column. Note that the right panel
   tracks each event as it arrives, color-coded.
2. **Pause and click a `CUSTOM · a2ui · updateComponents · results` row**
   on the right. The full JSON expands. Point out:
   - `version: "v0.9"`
   - Each component is `{id, component: "Card" | "Row" | "Column" | "Text" | "Image" | "Button", …props}` — `component` is a *string type-name*.
   - Path bindings like `{"path": "/restaurant_0/name"}` — data is referenced, not embedded.
3. **Click the matching `updateDataModel · results` row above it** — point
   out that the actual restaurant data is delivered separately, at
   `path: "/restaurant_0"`. This is what those `{path: …}` bindings
   resolve against.
4. **Click *Book a table* on one of the cards.** Right panel shows:
   - `→ USER_ACTION · book_restaurant · {restaurantId: r_001}` (UI → backend)
   - `← createSurface · booking_form` followed by `← updateComponents · booking_form` (backend → UI)
   - The middle column now has a second surface — the booking form — with the same shape: a Column root → TextField / DateTimeInput / Button children, all driven by a separate `/form` data model.
5. **Edit the form and click *Confirm booking*.** The form's data model is
   serialized and posted back as another `USER_ACTION`, and the agent
   responds with a confirmation card surface.

### The three-layer interpretation

The single JSON payload is read by three layers, each consuming the layer above:

| Layer                                  | Input                                                  | Output                                                          | Code                              |
| -------------------------------------- | ------------------------------------------------------ | --------------------------------------------------------------- | --------------------------------- |
| **AG-UI transport** (`@ag-ui/client`)  | SSE frames `data: {…}\n\n`                             | Typed event object (e.g. `CustomEvent`)                         | `frontend/src/lib/agent.ts`       |
| **A2UI state** (`@a2ui/web_core`)      | The `value` field of a CUSTOM event (an A2UI message)  | Mutations to `SurfaceModel.componentsModel` + reactive `dataModel` (`@preact/signals-core`) | `frontend/src/lib/store.ts` (the `processor.processMessages(...)` call) |
| **Renderer** (custom React)            | The `SurfaceModel`                                     | DOM                                                             | `frontend/src/components/A2UIRenderer.tsx` |

That split is the demo punchline: **the agent never names a React
component, never sets a pixel, never knows Tailwind exists.** It just
declares intent (a component graph + a data model) in A2UI v0.9 JSON, and
the frontend interprets that intent in stages. Swapping any one layer
(say, replacing the custom renderer with `<A2uiSurface>` from
`@a2ui/react/v0_9`, or pointing the AG-UI client at a different
backend) doesn't require changing the others.

## Layout

```
backend/
  main.py                 FastAPI + EventEncoder + StreamingResponse
  agent.py                LangGraph router + 4 streaming nodes (typed AG-UI events)
  a2ui_msgs.py            Thin A2UI v0.9 builders w/ top-level schema validation
  tools.py                find_restaurants async generator
  data/restaurants.json   20 real Miami restaurants
  requirements.txt        ag-ui-protocol, a2ui-agent-sdk, fastapi, langgraph

frontend/
  src/
    main.tsx
    App.tsx               Three-column layout
    index.css             Tailwind + a few CSS vars
    lib/
      agent.ts            HttpAgent singleton (@ag-ui/client)
      store.ts            Zustand store, AgentSubscriber bridge,
                          MessageProcessor singleton (@a2ui/web_core/v0_9)
    components/
      Chat.tsx            Left column
      Surface.tsx         Middle column — calls custom renderer
      A2UIRenderer.tsx    Walks the SDK's SurfaceModel, emits Tailwind DOM
      EventLog.tsx        Right column with direction-arrow legend
```

## How a click closes the loop

1. User types a query → `Chat.tsx` calls `store.sendUserMessage(content)`.
2. `agent.addMessage(...)` then `agent.runAgent()` (from `@ag-ui/client`) opens the SSE stream to `/agent`.
3. Backend's LangGraph router picks `search_restaurants` and yields typed AG-UI events (`RunStartedEvent`, `TextMessageContentEvent`, `ToolCall*Event`, `CustomEvent` carrying A2UI v0.9 messages, `RunFinishedEvent`).
4. `EventEncoder.encode(event)` produces SSE bytes.
5. `@ag-ui/client` parses each frame and fires the matching subscriber callback (`onCustomEvent` for the A2UI payloads).
6. `MessageProcessor.processMessages([event.value])` validates and applies each A2UI message; surface state lives in `SurfaceModel.componentsModel` + `SurfaceModel.dataModel`.
7. The custom React renderer reads from those models and produces DOM.
8. Clicking *Book a table* fires the surface's action listener (configured at `MessageProcessor` construction time), which forwards the action through `store.sendAction()` → `HttpAgent` → backend, where the router picks `render_booking_form`, and the cycle repeats.
# a2ui_ag_ui_example_official_client
