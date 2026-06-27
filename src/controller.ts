import { fsApi, joinPath, parentOf, basename, Entry } from "./fs";
import {
  AppState, PaneId, PaneState, activePane, otherPane, visibleEntries, visualRange,
} from "./state";
import { filterPaletteRows } from "./render";

export class Controller {
  state: AppState;
  private rerender: () => void;

  constructor(state: AppState, rerender: () => void) {
    this.state = state;
    this.rerender = rerender;
  }

  /* ---------- loading ---------- */

  async loadPane(id: PaneId) {
    const p = this.state.panes[id];
    try {
      const canonical = await fsApi.canonicalize(p.cwd).catch(() => p.cwd);
      p.cwd = canonical;
      p.entries = await fsApi.listDir(p.cwd, this.state.showHidden);
      if (p.cursor >= p.entries.length) p.cursor = Math.max(0, p.entries.length - 1);
    } catch (e) {
      this.flash(`load: ${(e as Error).toString()}`, "err");
      p.entries = [];
    }
  }

  async loadBoth() {
    await Promise.all([this.loadPane("L"), this.loadPane("R")]);
    await this.refreshPreview();
  }

  async refreshPreview() {
    const ap = activePane(this.state);
    const entries = visibleEntries(ap);
    const cur = entries[ap.cursor];
    const pv = this.state.preview;
    if (!cur) {
      pv.path = null; pv.text = null; pv.kind = ""; pv.name = "—"; pv.error = null;
      return;
    }
    pv.path = cur.path; pv.kind = cur.kind; pv.name = cur.name;
    if (cur.is_dir) {
      try {
        const sub = await fsApi.listDir(cur.path, this.state.showHidden);
        pv.text = sub.map(e => `${e.glyph} ${e.name}${e.is_dir ? "/" : ""}`).join("\n");
        pv.error = null;
      } catch (e) {
        pv.text = null;
        pv.error = (e as Error).toString();
      }
    } else {
      try {
        pv.text = await fsApi.readPreview(cur.path, 16_384);
        pv.error = null;
      } catch (e) {
        pv.text = null;
        const msg = String(e);
        pv.error = msg.includes("binary") ? "binary" : msg;
      }
    }
  }

  /* ---------- ui helpers ---------- */

  flash(text: string, level: "ok" | "err" | "info" = "info") {
    this.state.output = { text, level };
    setTimeout(() => {
      if (this.state.output?.text === text) {
        this.state.output = null;
        this.rerender();
      }
    }, 4000);
  }

  /* ---------- navigation ---------- */

  move(delta: number) {
    const ap = activePane(this.state);
    const entries = visibleEntries(ap);
    if (!entries.length) return;
    ap.cursor = Math.max(0, Math.min(entries.length - 1, ap.cursor + delta));
  }
  gotoTop() { activePane(this.state).cursor = 0; }
  gotoBottom() {
    const ap = activePane(this.state);
    ap.cursor = Math.max(0, visibleEntries(ap).length - 1);
  }

  async enter() {
    const ap = activePane(this.state);
    const cur = visibleEntries(ap)[ap.cursor];
    if (!cur) return;
    if (cur.is_dir) {
      ap.cwd = cur.path;
      ap.cursor = 0;
      ap.marked.clear();
      ap.visualAnchor = null;
      ap.filter = "";
      await this.loadPane(ap.id);
      await this.refreshPreview();
    } else {
      try {
        await fsApi.openDefault(cur.path);
        this.flash(`opened ${cur.name}`, "ok");
      } catch (e) {
        this.flash(`open: ${e}`, "err");
      }
    }
  }
  async revealInFinder() {
    const ap = activePane(this.state);
    const cur = visibleEntries(ap)[ap.cursor];
    if (!cur) return;
    try {
      await fsApi.revealInFinder(cur.path);
    } catch (e) {
      this.flash(`reveal: ${e}`, "err");
    }
  }
  async up() {
    const ap = activePane(this.state);
    const prev = basename(ap.cwd);
    ap.cwd = parentOf(ap.cwd);
    ap.marked.clear();
    ap.visualAnchor = null;
    ap.filter = "";
    await this.loadPane(ap.id);
    const idx = visibleEntries(ap).findIndex(e => e.name === prev);
    ap.cursor = Math.max(0, idx);
    await this.refreshPreview();
  }
  async goHome() {
    const ap = activePane(this.state);
    ap.cwd = this.state.home;
    ap.cursor = 0;
    ap.marked.clear();
    ap.visualAnchor = null;
    ap.filter = "";
    await this.loadPane(ap.id);
    await this.refreshPreview();
  }

  togglePane() {
    this.state.active = this.state.active === "L" ? "R" : "L";
  }
  focusPane(id: PaneId) { this.state.active = id; }

  /* ---------- selection ---------- */

  toggleMark() {
    const ap = activePane(this.state);
    const cur = visibleEntries(ap)[ap.cursor];
    if (!cur) return;
    if (ap.marked.has(cur.path)) ap.marked.delete(cur.path);
    else ap.marked.add(cur.path);
    this.move(1);
  }
  startVisual() {
    const ap = activePane(this.state);
    ap.visualAnchor = ap.cursor;
    this.state.mode = "VISUAL";
  }
  exitVisual(commit: boolean) {
    const ap = activePane(this.state);
    if (commit) {
      const r = visualRange(ap);
      if (r) {
        const entries = visibleEntries(ap);
        for (let i = r[0]; i <= r[1]; i++) {
          ap.marked.add(entries[i].path);
        }
      }
    }
    ap.visualAnchor = null;
    this.state.mode = "NORMAL";
  }
  markAll() {
    const ap = activePane(this.state);
    visibleEntries(ap).forEach(e => ap.marked.add(e.path));
  }
  clearMarks() {
    activePane(this.state).marked.clear();
  }

  /* ---------- file ops ---------- */

  selected(p: PaneState): Entry[] {
    const v = visibleEntries(p);
    if (p.marked.size) return v.filter(e => p.marked.has(e.path));
    const cur = v[p.cursor];
    return cur ? [cur] : [];
  }

  yank() {
    const sel = this.selected(activePane(this.state));
    if (!sel.length) return;
    this.state.register = { mode: "COPY", paths: sel.map(e => e.path) };
    activePane(this.state).marked.clear();
    this.flash(`yanked ${sel.length} item${sel.length === 1 ? "" : "s"}`, "ok");
  }
  cut() {
    const sel = this.selected(activePane(this.state));
    if (!sel.length) return;
    this.state.register = { mode: "CUT", paths: sel.map(e => e.path) };
    activePane(this.state).marked.clear();
    this.flash(`cut ${sel.length} item${sel.length === 1 ? "" : "s"}`, "ok");
  }
  async moveToOther() {
    const ap = activePane(this.state);
    const op = otherPane(this.state);
    const sel = this.selected(ap);
    if (!sel.length) return;
    if (op.cwd === ap.cwd) { this.flash("other pane is same dir", "err"); return; }
    try {
      await fsApi.moveInto(sel.map(e => e.path), op.cwd);
      ap.marked.clear();
      this.flash(`moved ${sel.length} → ${op.cwd}`, "ok");
      await this.loadBoth();
    } catch (e) {
      this.flash(`move: ${e}`, "err");
    }
  }

  async copyToOther() {
    const ap = activePane(this.state);
    const op = otherPane(this.state);
    const sel = this.selected(ap);
    if (!sel.length) return;
    if (op.cwd === ap.cwd) { this.flash("other pane is same dir", "err"); return; }
    try {
      await fsApi.copyInto(sel.map(e => e.path), op.cwd);
      ap.marked.clear();
      this.flash(`copied ${sel.length} → ${op.cwd}`, "ok");
      await this.loadBoth();
    } catch (e) {
      this.flash(`copy: ${e}`, "err");
    }
  }

  async paste() {
    const r = this.state.register;
    if (!r.paths.length) { this.flash("register empty", "err"); return; }
    const ap = activePane(this.state);
    try {
      if (r.mode === "COPY") {
        await fsApi.copyInto(r.paths, ap.cwd);
        this.flash(`pasted ${r.paths.length} (copy)`, "ok");
      } else {
        await fsApi.moveInto(r.paths, ap.cwd);
        this.flash(`pasted ${r.paths.length} (move)`, "ok");
        this.state.register = { mode: "EMPTY", paths: [] };
      }
      await this.loadBoth();
    } catch (e) {
      this.flash(`paste: ${e}`, "err");
    }
  }
  async deleteSelected() {
    const ap = activePane(this.state);
    const sel = this.selected(ap);
    if (!sel.length) return;
    const n = sel.length;
    const preview = sel.slice(0, 8).map(e => `${e.is_dir ? "▸ " : "· "}${e.name}${e.is_dir ? "/" : ""}`);
    if (n > preview.length) preview.push(`… and ${n - preview.length} more`);
    this.openConfirm({
      title: "DELETE",
      message: `Permanently remove ${n} item${n === 1 ? "" : "s"}? This cannot be undone.`,
      details: preview,
      confirmLabel: "DELETE",
      level: "danger",
      onConfirm: async () => {
        try {
          for (const e of sel) await fsApi.remove(e.path);
          ap.marked.clear();
          this.flash(`deleted ${n}`, "ok");
          await this.loadBoth();
        } catch (e) {
          this.flash(`delete: ${e}`, "err");
        }
      },
    });
  }

  /* ---------- confirm modal ---------- */

  openConfirm(opts: {
    title: string;
    message: string;
    details?: string[];
    confirmLabel?: string;
    level?: "danger" | "warn" | "info";
    onConfirm: () => Promise<void> | void;
  }) {
    this.state.mode = "CONFIRM";
    this.state.ui.confirm = {
      open: true,
      title: opts.title,
      message: opts.message,
      details: opts.details ?? [],
      confirmLabel: opts.confirmLabel ?? "CONFIRM",
      level: opts.level ?? "danger",
      onConfirm: opts.onConfirm,
    };
  }
  closeConfirm() {
    this.state.ui.confirm = {
      open: false, title: "", message: "", details: [],
      confirmLabel: "CONFIRM", level: "danger", onConfirm: null,
    };
    this.state.mode = "NORMAL";
  }
  async runConfirm() {
    const cb = this.state.ui.confirm.onConfirm;
    this.closeConfirm();
    if (cb) await cb();
  }

  /* ---------- sort / view ---------- */

  setSort(k: PaneState["sort"]) {
    const ap = activePane(this.state);
    if (ap.sort === k) ap.sortDesc = !ap.sortDesc;
    else { ap.sort = k; ap.sortDesc = false; }
  }
  toggleSortDesc() {
    activePane(this.state).sortDesc = !activePane(this.state).sortDesc;
  }
  async toggleHidden() {
    this.state.showHidden = !this.state.showHidden;
    await this.loadBoth();
    this.flash(`hidden ${this.state.showHidden ? "on" : "off"}`, "ok");
  }

  /* ---------- marks ---------- */

  setMark(key: string) {
    const ap = activePane(this.state);
    const cur = visibleEntries(ap)[ap.cursor];
    if (!cur) return;
    this.state.marks.set(key, cur.is_dir ? cur.path : parentOf(cur.path));
    this.flash(`mark '${key}' → ${cur.path}`, "ok");
  }
  async jumpMark(key: string) {
    const target = this.state.marks.get(key);
    if (!target) { this.flash(`mark '${key}' unset`, "err"); return; }
    const ap = activePane(this.state);
    ap.cwd = target;
    ap.cursor = 0;
    ap.marked.clear();
    ap.filter = "";
    await this.loadPane(ap.id);
    await this.refreshPreview();
  }

  /* ---------- modals ---------- */

  openPalette() {
    this.state.mode = "COMMAND";
    this.state.ui.palette = { open: true, input: "", cursor: 0 };
  }
  closePalette() {
    this.state.ui.palette.open = false;
    this.state.mode = "NORMAL";
  }
  openSearch() {
    this.state.mode = "SEARCH";
    this.state.ui.search = { open: true, input: activePane(this.state).filter };
  }
  closeSearch(commit: boolean) {
    if (commit) {
      activePane(this.state).filter = this.state.ui.search.input;
      activePane(this.state).cursor = 0;
    } else {
      activePane(this.state).filter = "";
    }
    this.state.ui.search.open = false;
    this.state.mode = "NORMAL";
  }
  openRename(kind: false | "file" | "dir" = false) {
    const ap = activePane(this.state);
    const cur = kind ? null : visibleEntries(ap)[ap.cursor];
    if (!kind && !cur) return;
    this.state.mode = "RENAME";
    this.state.ui.rename = {
      open: true,
      input: cur?.name ?? "",
      target: cur?.path ?? null,
      isNew: kind,
    };
  }
  closeRename() {
    this.state.ui.rename = { open: false, input: "", target: null, isNew: false };
    this.state.mode = "NORMAL";
  }
  async confirmRename() {
    const r = this.state.ui.rename;
    const name = r.input.trim();
    if (!name) { this.closeRename(); return; }
    const ap = activePane(this.state);
    try {
      if (r.isNew === "file") {
        await fsApi.touch(joinPath(ap.cwd, name));
        this.flash(`touched ${name}`, "ok");
      } else if (r.isNew === "dir") {
        await fsApi.mkdir(joinPath(ap.cwd, name));
        this.flash(`mkdir ${name}`, "ok");
      } else if (r.target) {
        const dst = joinPath(parentOf(r.target), name);
        await fsApi.rename(r.target, dst);
        this.flash(`renamed → ${name}`, "ok");
      }
      this.closeRename();
      await this.loadBoth();
    } catch (e) {
      this.flash(`${e}`, "err");
    }
  }
  toggleCheat() {
    this.state.ui.cheatsheet = !this.state.ui.cheatsheet;
  }

  /* ---------- palette commands ---------- */

  paletteMove(delta: number) {
    const rows = filterPaletteRows(this.state.ui.palette.input);
    if (!rows.length) return;
    let c = this.state.ui.palette.cursor + delta;
    if (c < 0) c = rows.length - 1;
    if (c >= rows.length) c = 0;
    this.state.ui.palette.cursor = c;
  }
  paletteSelect(): string | null {
    const rows = filterPaletteRows(this.state.ui.palette.input);
    const r = rows[this.state.ui.palette.cursor];
    return r?.cmd ?? null;
  }
  async runCommand(raw: string) {
    const line = raw.trim();
    if (!line) { this.closePalette(); return; }
    const [head, ...rest] = line.split(/\s+/);
    const arg = rest.join(" ");
    const ap = activePane(this.state);
    try {
      switch (head) {
        case "cd": {
          if (!arg) { ap.cwd = this.state.home; }
          else if (arg.startsWith("/")) ap.cwd = arg;
          else if (arg.startsWith("~")) ap.cwd = this.state.home + arg.slice(1);
          else ap.cwd = joinPath(ap.cwd, arg);
          ap.cursor = 0; ap.marked.clear(); ap.filter = "";
          await this.loadPane(ap.id);
          await this.refreshPreview();
          break;
        }
        case "mkdir":
          if (!arg) throw new Error("name required");
          await fsApi.mkdir(joinPath(ap.cwd, arg));
          await this.loadBoth();
          this.flash(`mkdir ${arg}`, "ok");
          break;
        case "touch":
          if (!arg) throw new Error("name required");
          await fsApi.touch(joinPath(ap.cwd, arg));
          await this.loadBoth();
          this.flash(`touched ${arg}`, "ok");
          break;
        case "yank": this.yank(); break;
        case "cut":  this.cut(); break;
        case "paste": await this.paste(); break;
        case "move":
        case "mv": await this.moveToOther(); break;
        case "copy":
        case "cp": await this.copyToOther(); break;
        case "delete": await this.deleteSelected(); break;
        case "sort": {
          const k = (arg || "name") as PaneState["sort"];
          if (!["name","size","mtime","ext"].includes(k)) throw new Error("sort: name|size|mtime|ext");
          this.setSort(k);
          break;
        }
        case "swap": {
          const a = this.state.panes.L.cwd;
          this.state.panes.L.cwd = this.state.panes.R.cwd;
          this.state.panes.R.cwd = a;
          await this.loadBoth();
          break;
        }
        case "sync": {
          const other = otherPane(this.state);
          other.cwd = ap.cwd; other.cursor = 0;
          await this.loadPane(other.id);
          break;
        }
        case "hidden": await this.toggleHidden(); break;
        case "reload": await this.loadBoth(); break;
        case "quit": {
          this.closePalette();
          this.openConfirm({
            title: "QUIT",
            message: "Close BLACKSITE?",
            confirmLabel: "QUIT",
            level: "warn",
            onConfirm: async () => {
              const { getCurrentWindow } = await import("@tauri-apps/api/window");
              await getCurrentWindow().close();
            },
          });
          return;
        }
        default: throw new Error(`unknown: ${head}`);
      }
      this.closePalette();
    } catch (e) {
      this.flash(`${e}`, "err");
    }
  }
}
