import type { Entry } from "./fs";

export type PaneId = "L" | "R";
export type Mode = "NORMAL" | "VISUAL" | "COMMAND" | "SEARCH" | "RENAME" | "CONFIRM";
export type RegisterMode = "COPY" | "CUT" | "EMPTY";
export type SortKey = "name" | "size" | "mtime" | "ext";

export interface PaneState {
  id: PaneId;
  cwd: string;
  entries: Entry[];
  cursor: number;
  marked: Set<string>;
  visualAnchor: number | null;
  filter: string;
  sort: SortKey;
  sortDesc: boolean;
  scrollOffset: number;
}

export interface Register {
  mode: RegisterMode;
  paths: string[];
}

export interface ConfirmDialog {
  open: boolean;
  title: string;
  message: string;
  details: string[];
  confirmLabel: string;
  level: "danger" | "warn" | "info";
  onConfirm: (() => Promise<void> | void) | null;
}

export interface UiOverlays {
  palette: { open: boolean; input: string; cursor: number };
  search: { open: boolean; input: string };
  rename: { open: boolean; input: string; target: string | null; isNew: false | "file" | "dir" };
  cheatsheet: boolean;
  confirm: ConfirmDialog;
}

export interface AppState {
  home: string;
  mode: Mode;
  active: PaneId;
  panes: Record<PaneId, PaneState>;
  register: Register;
  marks: Map<string, string>;
  pendingKey: string;
  pendingCount: string;
  preview: {
    path: string | null;
    text: string | null;
    kind: string;
    name: string;
    error: string | null;
  };
  output: { text: string; level: "ok" | "err" | "info" } | null;
  ui: UiOverlays;
  showHidden: boolean;
}

export const initialState = (home: string): AppState => ({
  home,
  mode: "NORMAL",
  active: "L",
  panes: {
    L: makePane("L", home),
    R: makePane("R", home),
  },
  register: { mode: "EMPTY", paths: [] },
  marks: new Map(),
  pendingKey: "",
  pendingCount: "",
  preview: { path: null, text: null, kind: "", name: "—", error: null },
  output: null,
  ui: {
    palette: { open: false, input: "", cursor: 0 },
    search: { open: false, input: "" },
    rename: { open: false, input: "", target: null, isNew: false },
    cheatsheet: false,
    confirm: {
      open: false,
      title: "",
      message: "",
      details: [],
      confirmLabel: "CONFIRM",
      level: "danger",
      onConfirm: null,
    },
  },
  showHidden: false,
});

function makePane(id: PaneId, cwd: string): PaneState {
  return {
    id,
    cwd,
    entries: [],
    cursor: 0,
    marked: new Set(),
    visualAnchor: null,
    filter: "",
    sort: "name",
    sortDesc: false,
    scrollOffset: 0,
  };
}

export function activePane(s: AppState): PaneState {
  return s.panes[s.active];
}
export function otherPane(s: AppState): PaneState {
  return s.panes[s.active === "L" ? "R" : "L"];
}

export function visibleEntries(p: PaneState): Entry[] {
  let list = p.entries;
  if (p.filter) {
    const f = p.filter.toLowerCase();
    list = list.filter(e => e.name.toLowerCase().includes(f));
  }
  const sorted = [...list].sort((a, b) => {
    if (a.is_dir !== b.is_dir) return a.is_dir ? -1 : 1;
    let v = 0;
    switch (p.sort) {
      case "size": v = a.size - b.size; break;
      case "mtime": v = a.mtime - b.mtime; break;
      case "ext": {
        const ax = a.name.split(".").pop() ?? "";
        const bx = b.name.split(".").pop() ?? "";
        v = ax.localeCompare(bx);
        if (v === 0) v = a.name.localeCompare(b.name);
        break;
      }
      default: v = a.name.toLowerCase().localeCompare(b.name.toLowerCase());
    }
    return p.sortDesc ? -v : v;
  });
  return sorted;
}

export function visualRange(p: PaneState): [number, number] | null {
  if (p.visualAnchor == null) return null;
  const a = Math.min(p.visualAnchor, p.cursor);
  const b = Math.max(p.visualAnchor, p.cursor);
  return [a, b];
}

export function selectedEntries(p: PaneState): Entry[] {
  const v = visibleEntries(p);
  if (p.marked.size > 0) return v.filter(e => p.marked.has(e.path));
  const cur = v[p.cursor];
  return cur ? [cur] : [];
}
