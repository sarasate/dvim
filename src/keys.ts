import { Controller } from "./controller";
import { AppState } from "./state";

const PENDING_TIMEOUT_MS = 800;

export class Keymap {
  private c: Controller;
  private s: AppState;
  private rerender: () => void;
  private pendingTimer: number | null = null;

  constructor(c: Controller, rerender: () => void) {
    this.c = c;
    this.s = c.state;
    this.rerender = rerender;
  }

  bind(root: HTMLElement) {
    document.addEventListener("keydown", (e) => this.onKey(e));
    root.addEventListener("click", (e) => this.onClick(e));
    root.addEventListener("input", (e) => this.onInput(e));
  }

  private async onClick(e: Event) {
    const target = e.target as HTMLElement;
    const stopEl = target.closest("[data-stop]");
    const overlay = target.closest("[data-overlay]") as HTMLElement | null;
    if (overlay && !stopEl) {
      const which = overlay.getAttribute("data-overlay");
      if (which === "palette") this.c.closePalette();
      else if (which === "search") this.c.closeSearch(false);
      else if (which === "rename") this.c.closeRename();
      else if (which === "confirm") this.c.closeConfirm();
      else if (which === "cheat") this.c.toggleCheat();
      this.rerender();
      return;
    }
    const action = target.closest("[data-action]") as HTMLElement | null;
    if (action) {
      const a = action.getAttribute("data-action");
      if (a === "palette") this.c.openPalette();
      else if (a === "search") this.c.openSearch();
      else if (a === "cheat") this.c.toggleCheat();
      else if (a === "tab") this.c.togglePane();
      else if (a === "confirm-rename") await this.c.confirmRename();
      else if (a === "confirm-accept") await this.c.runConfirm();
      else if (a === "confirm-cancel") this.c.closeConfirm();
      this.rerender();
      return;
    }
    const focus = target.closest("[data-pane-focus]") as HTMLElement | null;
    if (focus) {
      const id = focus.getAttribute("data-pane-focus") as "L" | "R";
      this.c.focusPane(id);
      await this.c.refreshPreview();
      this.rerender();
      return;
    }
    const row = target.closest(".row") as HTMLElement | null;
    if (row) {
      const id = row.getAttribute("data-pane") as "L" | "R";
      const idx = parseInt(row.getAttribute("data-idx") ?? "0", 10);
      this.c.focusPane(id);
      this.s.panes[id].cursor = idx;
      await this.c.refreshPreview();
      this.rerender();
      return;
    }
    const mark = target.closest("[data-mark]") as HTMLElement | null;
    if (mark) {
      const key = mark.getAttribute("data-mark")!;
      await this.c.jumpMark(key);
      this.rerender();
    }
  }

  private onInput(e: Event) {
    const t = e.target as HTMLInputElement;
    if (t.id === "palette-input") {
      this.s.ui.palette.input = t.value;
      this.s.ui.palette.cursor = 0;
      this.rerender();
      const inp = document.getElementById("palette-input") as HTMLInputElement | null;
      if (inp) { inp.focus(); inp.setSelectionRange(t.value.length, t.value.length); }
    } else if (t.id === "search-input") {
      this.s.ui.search.input = t.value;
      this.s.panes[this.s.active].filter = t.value;
      this.s.panes[this.s.active].cursor = 0;
      this.rerender();
      const inp = document.getElementById("search-input") as HTMLInputElement | null;
      if (inp) { inp.focus(); inp.setSelectionRange(t.value.length, t.value.length); }
    } else if (t.id === "rename-input") {
      this.s.ui.rename.input = t.value;
    }
  }

  private resetPending() {
    this.s.pendingKey = "";
    this.s.pendingCount = "";
    if (this.pendingTimer) { clearTimeout(this.pendingTimer); this.pendingTimer = null; }
  }
  private armPending() {
    if (this.pendingTimer) clearTimeout(this.pendingTimer);
    this.pendingTimer = window.setTimeout(() => {
      this.s.pendingKey = "";
      this.s.pendingCount = "";
      this.rerender();
    }, PENDING_TIMEOUT_MS);
  }

  private async onKey(e: KeyboardEvent) {
    const s = this.s;

    if (s.mode === "COMMAND") return this.onPaletteKey(e);
    if (s.mode === "SEARCH")  return this.onSearchKey(e);
    if (s.mode === "RENAME")  return this.onRenameKey(e);
    if (s.mode === "CONFIRM") return this.onConfirmKey(e);

    if (s.ui.cheatsheet) {
      if (e.key === "Escape" || e.key === "?") {
        e.preventDefault();
        this.c.toggleCheat();
        this.rerender();
      }
      return;
    }

    const k = e.key;
    if (e.metaKey || e.ctrlKey || e.altKey) {
      if ((e.metaKey || e.ctrlKey) && k.toLowerCase() === "r") {
        e.preventDefault();
        await this.c.loadBoth();
        this.rerender();
      }
      return;
    }

    e.preventDefault();

    if (s.pendingKey === "m" && /^[a-z]$/i.test(k)) {
      this.c.setMark(k);
      this.resetPending();
      this.rerender();
      return;
    }
    if (s.pendingKey === "'" && /^[a-z]$/i.test(k)) {
      await this.c.jumpMark(k);
      this.resetPending();
      this.rerender();
      return;
    }
    if (s.pendingKey === "g") {
      if (k === "g") { this.c.gotoTop(); this.resetPending(); await this.c.refreshPreview(); this.rerender(); return; }
      this.resetPending();
    }
    if (s.pendingKey === "y" && k === "y") { this.c.yank(); this.resetPending(); this.rerender(); return; }
    if (s.pendingKey === "d" && k === "d") { this.c.cut(); this.resetPending(); this.rerender(); return; }
    if (s.pendingKey === "c" && k === "w") { this.c.openRename(); this.resetPending(); this.rerender(); this.focusInput("rename-input"); return; }
    if (s.pendingKey === "z" && k === "h") { await this.c.toggleHidden(); this.resetPending(); this.rerender(); return; }
    if (s.pendingKey === "s") {
      const map: Record<string, "name" | "size" | "mtime" | "ext"> = { n: "name", s: "size", t: "mtime", e: "ext" };
      if (map[k]) { this.c.setSort(map[k]); this.resetPending(); this.rerender(); return; }
      if (k === "r") { this.c.toggleSortDesc(); this.resetPending(); this.rerender(); return; }
      this.resetPending();
    }

    if (/^[1-9]$/.test(k) || (s.pendingCount && k === "0")) {
      s.pendingCount += k;
      this.armPending();
      this.rerender();
      return;
    }
    const repeat = s.pendingCount ? parseInt(s.pendingCount, 10) : 1;
    s.pendingCount = "";

    switch (k) {
      case "j":
      case "ArrowDown":
        this.c.move(repeat); await this.c.refreshPreview(); break;
      case "k":
      case "ArrowUp":
        this.c.move(-repeat); await this.c.refreshPreview(); break;
      case "h":
      case "ArrowLeft":
        await this.c.up(); break;
      case "l":
      case "ArrowRight":
      case "Enter":
        await this.c.enter(); break;
      case "G":
        this.c.gotoBottom(); await this.c.refreshPreview(); break;
      case "Tab":
        this.c.togglePane(); await this.c.refreshPreview(); break;
      case " ":
        if (s.mode === "VISUAL") this.c.exitVisual(true);
        else this.c.toggleMark();
        await this.c.refreshPreview();
        break;
      case "v":
        if (s.mode === "VISUAL") this.c.exitVisual(true);
        else this.c.startVisual();
        break;
      case "V":
        this.c.markAll(); break;
      case "Escape":
        if (s.mode === "VISUAL") this.c.exitVisual(false);
        else if (activePane(s).marked.size) this.c.clearMarks();
        else if (activePane(s).filter) activePane(s).filter = "";
        else this.resetPending();
        break;
      case "p":
        await this.c.paste(); break;
      case "D":
        await this.c.deleteSelected(); break;
      case "M":
        await this.c.moveToOther(); break;
      case "C":
        await this.c.copyToOther(); break;
      case "R":
        await this.c.loadBoth(); break;
      case "~":
        await this.c.goHome(); break;
      case "%":
        this.c.openRename("file"); this.rerender(); this.focusInput("rename-input"); return;
      case ":":
        this.c.openPalette(); this.rerender(); this.focusInput("palette-input"); return;
      case "/":
        this.c.openSearch(); this.rerender(); this.focusInput("search-input"); return;
      case "?":
        this.c.toggleCheat(); break;
      case "g":
      case "y":
      case "c":
      case "z":
      case "s":
      case "m":
      case "'":
        s.pendingKey = k; this.armPending(); break;
      case "d":
        if (s.pendingKey === "") { s.pendingKey = "d"; this.armPending(); }
        break;
    }
    this.rerender();
  }

  private async onPaletteKey(e: KeyboardEvent) {
    const k = e.key;
    if (k === "Escape") { e.preventDefault(); this.c.closePalette(); this.rerender(); return; }
    if (k === "Enter")  {
      e.preventDefault();
      const input = (document.getElementById("palette-input") as HTMLInputElement | null)?.value ?? this.s.ui.palette.input;
      const sel = this.c.paletteSelect();
      const cmd = (sel && (sel.endsWith(" ") || input === "")) ? sel + (input.startsWith(sel) ? input.slice(sel.length) : "") : (sel ?? input);
      const final = input.trim() ? input : cmd;
      await this.c.runCommand(final);
      this.rerender();
      return;
    }
    if (k === "ArrowDown" || (e.ctrlKey && k === "n")) { e.preventDefault(); this.c.paletteMove(1); this.rerender(); return; }
    if (k === "ArrowUp"   || (e.ctrlKey && k === "p")) { e.preventDefault(); this.c.paletteMove(-1); this.rerender(); return; }
    if (k === "Tab") {
      e.preventDefault();
      const sel = this.c.paletteSelect();
      if (sel) {
        this.s.ui.palette.input = sel;
        this.rerender();
        this.focusInput("palette-input", sel.length);
      }
    }
  }

  private async onSearchKey(e: KeyboardEvent) {
    const k = e.key;
    if (k === "Escape") { e.preventDefault(); this.c.closeSearch(false); await this.c.refreshPreview(); this.rerender(); return; }
    if (k === "Enter")  { e.preventDefault(); this.c.closeSearch(true);  await this.c.refreshPreview(); this.rerender(); return; }
  }

  private async onConfirmKey(e: KeyboardEvent) {
    const k = e.key;
    if (k === "Escape" || k === "n" || k === "N") {
      e.preventDefault();
      this.c.closeConfirm();
      this.rerender();
      return;
    }
    if (k === "Enter" || k === "y" || k === "Y") {
      e.preventDefault();
      await this.c.runConfirm();
      this.rerender();
      return;
    }
  }

  private async onRenameKey(e: KeyboardEvent) {
    const k = e.key;
    if (k === "Escape") { e.preventDefault(); this.c.closeRename(); this.rerender(); return; }
    if (k === "Enter")  { e.preventDefault(); await this.c.confirmRename(); this.rerender(); return; }
  }

  focusInput(id: string, caretAt?: number) {
    requestAnimationFrame(() => {
      const el = document.getElementById(id) as HTMLInputElement | null;
      if (!el) return;
      el.focus();
      const pos = caretAt ?? el.value.length;
      el.setSelectionRange(pos, pos);
    });
  }
}

function activePane(s: AppState) {
  return s.panes[s.active];
}
