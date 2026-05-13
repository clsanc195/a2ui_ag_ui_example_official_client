// Custom React renderer that consumes the official @a2ui/web_core SurfaceModel
// but produces our own DOM/Tailwind so the cards look the way we want.
//
// The state management (createSurface / updateComponents / updateDataModel
// merging, path resolution, action dispatch) all happens inside the SDK's
// MessageProcessor — this file only handles the rendering layer.
//
// Reactivity: we subscribe to the surface's component and data signals and
// bump a local counter to re-render on any change.

import React, { useEffect, useState } from "react";
import type { SurfaceModel } from "@a2ui/web_core/v0_9";
import type { ReactComponentImplementation } from "@a2ui/react/v0_9";
import { effect } from "@a2ui/web_core/v0_9";
import { useStore } from "../lib/store";

export type Surface = SurfaceModel<ReactComponentImplementation>;

type ComponentNode = {
  id: string;
  type: string;
  properties: Record<string, any>;
};

function useSurfaceVersion(surface: Surface): number {
  const [version, setVersion] = useState(0);
  useEffect(() => {
    const bump = () => setVersion((v) => v + 1);

    const u1 = surface.componentsModel.onCreated.subscribe(bump);
    const u2 = surface.componentsModel.onDeleted.subscribe(bump);

    // Re-render whenever any data-model signal changes. effect() runs once
    // immediately and re-runs whenever any signal it reads changes.
    let first = true;
    const dispose = effect(() => {
      // Touch the whole data tree so the effect tracks every signal.
      JSON.stringify((surface.dataModel as any).data);
      if (!first) bump();
      first = false;
    });

    return () => {
      u1.unsubscribe();
      u2.unsubscribe();
      dispose();
    };
  }, [surface]);
  return version;
}

function resolvePath(data: any, path: string): any {
  if (!path) return undefined;
  const parts = path.split("/").filter(Boolean);
  let cur = data;
  for (const p of parts) {
    if (cur == null) return undefined;
    cur = cur[p];
  }
  return cur;
}

function resolveDynamic(val: any, data: any): string {
  if (val == null) return "";
  if (typeof val === "string") return val;
  if (typeof val === "object" && typeof val.path === "string") {
    const v = resolvePath(data, val.path);
    return v == null ? "" : String(v);
  }
  return String(val);
}

export function A2UIRenderer({ surface }: { surface: Surface }) {
  useSurfaceVersion(surface);
  const comp = (surface.componentsModel as any).components.get("root");
  if (!comp) return <div className="text-sm text-stone-400">Waiting for render…</div>;
  return <Node surface={surface} component={comp as any} />;
}

function Node({ surface, component }: { surface: Surface; component: ComponentNode }) {
  const data = (surface.dataModel as any).data;
  const { type, properties: p } = component;

  switch (type) {
    case "Text":
      return renderText(resolveDynamic(p.text, data), p.usageHint);

    case "Image": {
      const url = resolveDynamic(p.url, data);
      if (!url) return null;
      return (
        <img
          src={url}
          alt=""
          className="w-24 h-24 object-cover rounded-lg bg-stone-100 shrink-0 ring-1 ring-stone-200"
        />
      );
    }

    case "Card": {
      const childIds = childIdsOf(p);
      return (
        <div className="bg-white rounded-xl border border-stone-200 shadow-sm hover:shadow-md hover:border-indigo-200 transition p-3 overflow-hidden">
          {childIds.map((id) => (
            <ChildById key={id} surface={surface} id={id} />
          ))}
        </div>
      );
    }

    case "Row":
      return (
        <div className="flex flex-row gap-3 items-center min-w-0">
          {childIdsOf(p).map((id) => (
            <ChildById key={id} surface={surface} id={id} />
          ))}
        </div>
      );

    case "Column": {
      const children = childIdsOf(p);
      const allCards =
        children.length > 1 &&
        children.every((id) => (surface.componentsModel as any).components.get(id)?.type === "Card");
      if (allCards) {
        return (
          <div className="grid gap-3 grid-cols-1 md:grid-cols-2 xl:grid-cols-3">
            {children.map((id) => (
              <ChildById key={id} surface={surface} id={id} />
            ))}
          </div>
        );
      }
      return (
        <div className="flex flex-col gap-1 min-w-0">
          {children.map((id) => (
            <ChildById key={id} surface={surface} id={id} />
          ))}
        </div>
      );
    }

    case "Button": {
      const childIds = childIdsOf(p);
      const action = p.action;
      const onClick = () => {
        const event = action?.event;
        if (!event?.name) return;
        // Include the surface's current form data so submit-style actions
        // see what the user typed (otherwise context only carries whatever
        // the agent declared on the Button itself).
        const context: Record<string, any> = { ...(event.context ?? {}) };
        const formData = (surface.dataModel as any)?.data?.form;
        if (formData) context.data = formData;
        useStore.getState().sendAction({ name: event.name, context });
      };
      return (
        <button
          onClick={onClick}
          className="mt-2 self-start inline-flex items-center justify-center rounded-md bg-indigo-600 text-xs font-semibold tracking-wide px-3 py-1.5 hover:bg-indigo-700 active:bg-indigo-800 shadow-sm transition-colors text-white [&_*]:text-white"
        >
          {childIds.map((id) => (
            <ChildById key={id} surface={surface} id={id} />
          ))}
        </button>
      );
    }

    case "TextField": {
      const path = p.text?.path ?? p.value?.path;
      const initial = path ? String(resolvePath(data, path) ?? "") : "";
      const label = resolveDynamic(p.label, data);
      const inputType = p.textFieldType ?? p.type ?? "text";
      return (
        <ControlledInput
          key={path ?? ""}
          surface={surface}
          path={path}
          initial={initial}
          label={label}
          inputType={inputType}
        />
      );
    }

    case "DateTimeInput": {
      const path = p.value?.path;
      const initial = path ? String(resolvePath(data, path) ?? "") : "";
      return (
        <ControlledInput
          key={path ?? ""}
          surface={surface}
          path={path}
          initial={initial}
          label="When"
          inputType="datetime-local"
        />
      );
    }

    default:
      return <span className="text-xs text-red-500">unsupported: {type}</span>;
  }
}

// Controlled input that keeps its own React state for the typed value and
// pushes each keystroke into the surface's data model. The DataModel's `set`
// fires per-path signals; our top-level useSurfaceVersion hook doesn't track
// those signals, so without local state the input would be stuck at the
// initial value (controlled-input semantics).
function ControlledInput({
  surface,
  path,
  initial,
  label,
  inputType,
}: {
  surface: Surface;
  path: string | undefined;
  initial: string;
  label: string;
  inputType: string;
}) {
  const [value, setValue] = useState(initial);
  // Sync local state when the backend pushes new defaults (e.g., when the
  // booking form is freshly created with tomorrow 7pm + party=2).
  useEffect(() => {
    setValue(initial);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial]);
  return (
    <label className="flex flex-col text-xs gap-1 text-stone-600 font-medium">
      {label && <span>{label}</span>}
      <input
        type={inputType}
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          if (path) surface.dataModel.set(path, e.target.value);
        }}
        className="rounded-md border border-stone-300 px-2 py-1.5 text-sm text-stone-900 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:border-indigo-400"
      />
    </label>
  );
}

function ChildById({ surface, id }: { surface: Surface; id: string }) {
  const comp = (surface.componentsModel as any).components.get(id);
  if (!comp) return <span className="text-xs text-red-500">missing: {id}</span>;
  return <Node surface={surface} component={comp as any} />;
}

function childIdsOf(props: Record<string, any>): string[] {
  if (Array.isArray(props.children)) return props.children;
  if (props.child) return [props.child];
  return [];
}

function renderText(text: string, hint: string | undefined) {
  if (hint === "h1") return <h1 className="text-xl font-semibold text-stone-900">{text}</h1>;
  if (hint === "h2") return <h2 className="text-[15px] font-semibold text-stone-900 truncate">{text}</h2>;
  if (hint === "p") return <p className="text-sm leading-relaxed text-stone-700">{text}</p>;
  return <span className="text-xs text-stone-500">{text}</span>;
}
