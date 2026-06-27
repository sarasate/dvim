import {
  AppState,
  PaneState,
  activePane,
  visibleEntries,
  visualRange,
} from "./state";
import { abbreviateHome, basename, formatMtime, formatSize, parentOf } from "./fs";

const esc = (s: string) =>
  s.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

export function render(state: AppState, root: HTMLElement): void {
  root.innerHTML = `
    <div class="app">
      <div class="vignette"></div>
      ${renderStatusStrip(state)}
      ${renderTape()}
      <div class="grid">
        ${renderPane(state, "L")}
        ${renderPane(state, "R")}
        ${renderRcol(state)}
      </div>
      ${renderStatusLine(state)}
      ${renderCmdBar(state)}
      ${renderOverlays(state)}
    </div>
  `;
}

function renderStatusStrip(s: AppState): string {
  const ap = activePane(s);
  const sel = ap.marked.size;
  const path = abbreviateHome(ap.cwd, s.home);
  const modeMap: Record<string, string> = {
    NORMAL: "NORMAL", VISUAL: "VISUAL", COMMAND: "COMMAND",
    SEARCH: "SEARCH", RENAME: "RENAME",
  };
  const modeClass =
    s.mode === "VISUAL" ? "visual" :
    s.mode === "COMMAND" || s.mode === "SEARCH" || s.mode === "RENAME" ? "command" : "";
  const now = new Date();
  const pad = (n: number) => n.toString().padStart(2, "0");
  const time = `${pad(now.getUTCHours())}:${pad(now.getUTCMinutes())}:${pad(now.getUTCSeconds())}`;
  const vol = abbreviateHome(s.home, s.home).replace("~", s.home);
  return `
    <div class="status-strip">
      <div class="brand"><span class="brand-dot"></span>BLACKSITE</div>
      <div class="status-center">
        <span>VOL <span class="v">${esc(vol)}</span></span>
        <span style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0">
          PATH <span class="path">${esc(path)}</span>
        </span>
        <span>SEL <span class="v">${sel}</span></span>
      </div>
      <div class="status-right">
        <span>MODE <span class="mode ${modeClass}"><b>${modeMap[s.mode]}</b></span></span>
        <span class="clock">${time}<span class="z">Z</span></span>
        <span class="link"><span class="led"></span>LINK SECURE</span>
      </div>
    </div>
  `;
}

function renderTape(): string {
  const seg = "// CLASSIFIED // EYES ONLY // VOLUME MOUNTED // CLEARANCE LVL-4 // OPERATOR: VEGA // FILESYSTEM ENCRYPTED ";
  return `<div class="tape">${seg.repeat(2)}</div>`;
}

function renderPane(s: AppState, id: "L" | "R"): string {
  const p = s.panes[id];
  const active = s.active === id;
  const entries = visibleEntries(p);
  const range = visualRange(p);
  const head = `▣ ${esc(abbreviateHome(p.cwd, s.home))}`;
  const rows = entries.map((e, i) => {
    const cursor = i === p.cursor;
    const inRange = range && i >= range[0] && i <= range[1];
    const marked = p.marked.has(e.path) || inRange;
    const cls = ["row"];
    if (e.is_dir) cls.push("dir");
    if (e.is_symlink) cls.push("link");
    else if (e.kind) cls.push(e.kind);
    if (marked) cls.push("marked");
    const size = e.is_dir ? "—" : formatSize(e.size, false);
    return `
      <div class="${cls.join(" ")}" data-idx="${i}" data-pane="${id}">
        ${cursor ? `<div class="cursor"></div>` : ""}
        ${marked ? `<div class="mark-bar"></div>` : ""}
        <div class="body">
          <span class="glyph">${esc(e.glyph)}</span>
          <span class="name">${esc(e.name)}${e.is_dir ? "/" : ""}</span>
          <span class="size">${size}</span>
        </div>
      </div>
    `;
  }).join("");
  const footLeft = `SORT ${p.sort.toUpperCase()}${p.sortDesc ? " ↓" : " ↑"}${p.filter ? "  ·  /" + esc(p.filter) : ""}`;
  const footRight = `${entries.length} item${entries.length === 1 ? "" : "s"}${p.marked.size ? "  ·  " + p.marked.size + " marked" : ""}`;
  return `
    <div class="pane ${active ? "active" : ""}" data-pane="${id}">
      ${active ? `<span class="corner tl"></span><span class="corner tr"></span><span class="corner bl"></span><span class="corner br"></span>` : ""}
      <div class="pane-head" data-pane-focus="${id}">
        <span class="title">${head}</span>
        <span class="count">${entries.length}</span>
      </div>
      <div class="rows" data-pane="${id}">
        ${rows || `<div class="preview-empty">— empty —</div>`}
      </div>
      <div class="pane-foot"><span>${esc(footLeft)}</span><span class="right">${esc(footRight)}</span></div>
    </div>
  `;
}

function renderRcol(s: AppState): string {
  return `
    <div class="rcol">
      ${renderPreview(s)}
      ${renderRegister(s)}
    </div>
  `;
}

function renderPreview(s: AppState): string {
  const pv = s.preview;
  const kindBadge = pv.kind ? pv.kind.toUpperCase() : "—";
  const imageExts = ["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg", "tiff", "heic"];
  let body = "";
  if (pv.error === "binary") {
    body = `<div class="preview-bin">binary file — preview suppressed</div>`;
  } else if (pv.path && imageExts.includes((pv.path.split(".").pop() ?? "").toLowerCase())) {
    body = `
      <div class="preview-img-wrap">
        <div class="preview-img-box">
          <span class="preview-img-label">IMAGE · ${esc(kindBadge)}</span>
        </div>
      </div>
    `;
  } else if (pv.text != null) {
    const lines = pv.text.split("\n").slice(0, 200);
    body = lines.map((l, i) =>
      `<div class="preview-line"><span class="n">${(i + 1).toString().padStart(3, " ")}</span><span class="t">${esc(l) || " "}</span></div>`
    ).join("");
  } else if (pv.error) {
    body = `<div class="preview-empty">${esc(pv.error)}</div>`;
  } else {
    body = `<div class="preview-empty">— select an entry —</div>`;
  }
  return `
    <div class="preview">
      <div class="preview-head">
        <span class="t">▣ PREVIEW · ${esc(pv.name)}</span>
        <span class="kind">${esc(kindBadge)}</span>
      </div>
      <div class="preview-body">${body}</div>
    </div>
  `;
}

function renderRegister(s: AppState): string {
  const r = s.register;
  const badge =
    r.mode === "COPY" ? `<span class="badge copy">COPY</span>` :
    r.mode === "CUT" ? `<span class="badge cut">CUT</span>` :
    `<span class="badge" style="color:#5a6e72">EMPTY</span>`;
  const regRows = r.paths.length
    ? r.paths.map(p => `<div class="reg-row"><span class="g">▸</span><span class="n">${esc(basename(p))}</span></div>`).join("")
    : `<div class="reg-empty">— buffer empty —</div>`;
  const markRows = s.marks.size
    ? Array.from(s.marks.entries()).map(([k, v]) =>
        `<div class="mark-row" data-mark="${esc(k)}"><span class="k">${esc(k)}</span><span class="p">${esc(abbreviateHome(v, s.home))}</span></div>`
      ).join("")
    : `<div class="marks-empty">— set with <span class="k">m</span> + letter —</div>`;
  return `
    <div class="reg">
      <div class="reg-head"><span class="t">▣ REGISTER</span>${badge}</div>
      <div class="reg-body">${regRows}</div>
      <div class="marks-head"><span class="t">▣ MARKS</span></div>
      <div class="marks-body">${markRows}</div>
    </div>
  `;
}

function renderStatusLine(s: AppState): string {
  const ap = activePane(s);
  const entries = visibleEntries(ap);
  const cur = entries[ap.cursor];
  if (!cur) {
    return `
      <div class="statusline">
        <span class="perms">----------</span>
        <span class="owner">—</span>
        <span class="size">—</span>
        <span class="mtime">—</span>
        <span class="name">—</span>
        <span class="right">${entries.length} items · pane ${s.active}</span>
      </div>
    `;
  }
  const perms = permsString(cur.mode, cur.is_dir);
  return `
    <div class="statusline">
      <span class="perms">${esc(perms)}</span>
      <span class="owner">${esc(parentOf(cur.path).split("/").pop() || "/")}</span>
      <span class="size">${esc(formatSize(cur.size, cur.is_dir))}</span>
      <span class="mtime">${esc(formatMtime(cur.mtime))}</span>
      <span class="name">${esc(cur.name)}</span>
      <span class="right">${ap.cursor + 1} / ${entries.length} · pane ${s.active}</span>
    </div>
  `;
}

function permsString(mode: number, isDir: boolean): string {
  const triplet = (b: number) =>
    (b & 4 ? "r" : "-") + (b & 2 ? "w" : "-") + (b & 1 ? "x" : "-");
  return (isDir ? "d" : "-") +
    triplet((mode >> 6) & 7) +
    triplet((mode >> 3) & 7) +
    triplet(mode & 7);
}

function renderCmdBar(s: AppState): string {
  const out = s.output;
  const outClass = out?.level === "err" ? "err" : out?.level === "ok" ? "ok" : "";
  const pending = s.pendingCount + s.pendingKey;
  const outText = out?.text || (pending ? `pending: ${pending}` : "ready");
  return `
    <div class="cmdbar">
      <div class="cmdbar-left">
        <span class="cmdbtn" data-action="palette">CMD ▸</span>
        <span class="cmdbar-out ${outClass}">${esc(outText)}</span>
      </div>
      <div class="cmdbar-hints">
        <span><b>j/k</b> nav</span>
        <span><b>h/l</b> dir</span>
        <span data-action="tab"><b>tab</b> pane</span>
        <span><b>spc</b> mark</span>
        <span><b>yy/dd</b> yank/cut</span>
        <span><b>p</b> paste</span>
        <span><b>M</b> move→</span>
        <span><b>cw</b> rename</span>
        <span data-action="search"><b>/</b> find</span>
        <span data-action="palette"><b>:</b> cmd</span>
        <span data-action="cheat"><b>?</b> help</span>
      </div>
    </div>
  `;
}

function renderOverlays(s: AppState): string {
  return [
    s.ui.palette.open ? renderPalette(s) : "",
    s.ui.search.open ? renderSearch(s) : "",
    s.ui.rename.open ? renderRename(s) : "",
    s.ui.confirm.open ? renderConfirm(s) : "",
    s.ui.cheatsheet ? renderCheat() : "",
  ].join("");
}

function renderConfirm(s: AppState): string {
  const c = s.ui.confirm;
  const sigil = c.level === "danger" ? "⚠" : c.level === "warn" ? "▲" : "?";
  const details = c.details.length
    ? `<div class="confirm-list">${c.details.map(d => `<div>${esc(d)}</div>`).join("")}</div>`
    : "";
  return `
    <div class="overlay center" data-overlay="confirm">
      <div class="modal confirm ${c.level}" data-stop>
        <div class="head-row">
          <span class="head-title"><span class="sigil">${esc(sigil)}</span> ${esc(c.title)}</span>
          <span class="head-path">${esc(c.level.toUpperCase())}</span>
        </div>
        <div class="body-pad">
          <div class="confirm-msg">${esc(c.message)}</div>
          ${details}
          <div class="actions">
            <span class="search-hint"><b>⏎</b> / <b>y</b> confirm · <b>esc</b> / <b>n</b> cancel</span>
            <span class="confirm-btn-row">
              <span class="cancel" data-action="confirm-cancel">CANCEL</span>
              <span class="confirm" data-action="confirm-accept">${esc(c.confirmLabel)} ▸</span>
            </span>
          </div>
        </div>
      </div>
    </div>
  `;
}

const PALETTE_COMMANDS: { cmd: string; desc: string; needsArg?: boolean }[] = [
  { cmd: "cd ", desc: "change directory", needsArg: true },
  { cmd: "mkdir ", desc: "create directory", needsArg: true },
  { cmd: "touch ", desc: "create file", needsArg: true },
  { cmd: "yank", desc: "copy marked / cursor to register" },
  { cmd: "cut", desc: "cut marked / cursor to register" },
  { cmd: "paste", desc: "paste register into current dir" },
  { cmd: "move", desc: "move marked / cursor to other pane" },
  { cmd: "copy", desc: "copy marked / cursor to other pane" },
  { cmd: "delete", desc: "delete marked / cursor" },
  { cmd: "sort name", desc: "sort by name" },
  { cmd: "sort size", desc: "sort by size" },
  { cmd: "sort mtime", desc: "sort by mtime" },
  { cmd: "sort ext", desc: "sort by extension" },
  { cmd: "swap", desc: "swap pane cwds" },
  { cmd: "sync", desc: "set other pane to active cwd" },
  { cmd: "hidden", desc: "toggle hidden files" },
  { cmd: "reload", desc: "refresh both panes" },
  { cmd: "quit", desc: "exit" },
];

export function filterPaletteRows(input: string) {
  const q = input.trim().toLowerCase();
  if (!q) return PALETTE_COMMANDS;
  return PALETTE_COMMANDS.filter(c =>
    c.cmd.toLowerCase().includes(q) || c.desc.toLowerCase().includes(q)
  );
}

function renderPalette(s: AppState): string {
  const rows = filterPaletteRows(s.ui.palette.input);
  const cur = Math.min(s.ui.palette.cursor, Math.max(0, rows.length - 1));
  const list = rows.map((r, i) => `
    <div class="modal-row ${i === cur ? "sel" : ""}" data-cmd="${esc(r.cmd)}">
      <span class="cmd"><b>:</b>${esc(r.cmd)}</span>
      <span class="desc">${esc(r.desc)}</span>
    </div>
  `).join("");
  return `
    <div class="overlay" data-overlay="palette">
      <div class="modal" data-stop>
        <div class="modal-head">
          <span class="sigil">:</span>
          <input id="palette-input" class="modal-input" value="${esc(s.ui.palette.input)}"
                 placeholder="cd src · mkdir ops · touch log.txt · yank · paste · sort size · swap …" />
        </div>
        <div class="modal-list">${list}</div>
      </div>
    </div>
  `;
}

function renderSearch(s: AppState): string {
  return `
    <div class="overlay bottom" data-overlay="search">
      <div class="search-bar" data-stop>
        <span class="sigil">/</span>
        <input id="search-input" class="modal-input" value="${esc(s.ui.search.input)}"
               placeholder="filter files in active pane…" />
        <span class="search-hint"><b>⏎</b> apply · <b>esc</b> clear</span>
      </div>
    </div>
  `;
}

function renderRename(s: AppState): string {
  const ap = activePane(s);
  const which = s.ui.rename.isNew;
  const title = which === "file" ? "TOUCH NEW FILE" :
                which === "dir" ? "MKDIR NEW DIR" : "RENAME";
  const btn = which ? "CREATE" : "RENAME";
  return `
    <div class="overlay center" data-overlay="rename">
      <div class="modal rename" data-stop>
        <div class="head-row">
          <span class="head-title">${esc(title)}</span>
          <span class="head-path">${esc(abbreviateHome(ap.cwd, s.home))}</span>
        </div>
        <div class="body-pad">
          <input id="rename-input" class="row" value="${esc(s.ui.rename.input)}" placeholder="name…" />
          <div class="actions">
            <span class="search-hint"><b>⏎</b> confirm · <b>esc</b> cancel</span>
            <span class="confirm" data-action="confirm-rename">${esc(btn)} ▸</span>
          </div>
        </div>
      </div>
    </div>
  `;
}

function renderCheat(): string {
  return `
    <div class="overlay cheat" data-overlay="cheat">
      <div class="cheat" data-stop>
        <div class="cheat-head">
          <span class="t">KEYBINDINGS // OPERATOR MANUAL</span>
          <span class="esc">ESC TO CLOSE</span>
        </div>
        <div class="cheat-body">
          <div class="cheat-section">
            <div class="h">NAVIGATION</div>
            <div class="l">
              <div><span>move down / up</span><span>j / k</span></div>
              <div><span>enter dir / open</span><span>l / ⏎</span></div>
              <div><span>up a directory</span><span>h</span></div>
              <div><span>top / bottom</span><span>gg / G</span></div>
              <div><span>switch pane</span><span>tab</span></div>
              <div><span>go home</span><span>~</span></div>
            </div>
          </div>
          <div class="cheat-section">
            <div class="h">SELECTION</div>
            <div class="l">
              <div><span>mark / unmark</span><span>space</span></div>
              <div><span>visual mode</span><span>v</span></div>
              <div><span>mark all</span><span>V</span></div>
              <div><span>clear marks</span><span>esc</span></div>
              <div><span>set mark</span><span>m + a–z</span></div>
              <div><span>jump to mark</span><span>' + a–z</span></div>
            </div>
          </div>
          <div class="cheat-section">
            <div class="h">FILE OPS</div>
            <div class="l">
              <div><span>yank (copy)</span><span>yy</span></div>
              <div><span>cut</span><span>dd</span></div>
              <div><span>paste</span><span>p</span></div>
              <div><span>delete</span><span>D</span></div>
              <div><span>move to other</span><span>M</span></div>
              <div><span>copy to other</span><span>C</span></div>
              <div><span>rename</span><span>cw</span></div>
              <div><span>new file</span><span>%</span></div>
            </div>
          </div>
          <div class="cheat-section">
            <div class="h">VIEW &amp; SORT</div>
            <div class="l">
              <div><span>toggle hidden</span><span>zh</span></div>
              <div><span>sort by name</span><span>sn</span></div>
              <div><span>sort by size</span><span>ss</span></div>
              <div><span>sort by mtime</span><span>st</span></div>
              <div><span>sort by ext</span><span>se</span></div>
              <div><span>reverse sort</span><span>sr</span></div>
              <div><span>reload</span><span>R</span></div>
            </div>
          </div>
          <div class="cheat-section">
            <div class="h">MODES</div>
            <div class="l">
              <div><span>command palette</span><span>:</span></div>
              <div><span>find / filter</span><span>/</span></div>
              <div><span>clear filter</span><span>esc</span></div>
              <div><span>help</span><span>?</span></div>
            </div>
          </div>
          <div class="cheat-section">
            <div class="h">PANES</div>
            <div class="l">
              <div><span>sync to active</span><span>:sync</span></div>
              <div><span>swap cwds</span><span>:swap</span></div>
              <div><span>focus left / right</span><span>click pane</span></div>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;
}

export function scrollCursorIntoView(state: AppState, root: HTMLElement) {
  const ap = activePane(state);
  scrollPaneCursor(root, ap, state.active);
  const other = state.active === "L" ? "R" : "L";
  scrollPaneCursor(root, state.panes[other], other);
}

function scrollPaneCursor(root: HTMLElement, p: PaneState, id: "L" | "R") {
  const rows = root.querySelector(`.rows[data-pane="${id}"]`) as HTMLElement | null;
  if (!rows) return;
  const row = rows.querySelector(`.row[data-idx="${p.cursor}"]`) as HTMLElement | null;
  if (!row) return;
  const r = row.getBoundingClientRect();
  const c = rows.getBoundingClientRect();
  if (r.top < c.top) rows.scrollTop -= (c.top - r.top) + 4;
  else if (r.bottom > c.bottom) rows.scrollTop += (r.bottom - c.bottom) + 4;
}
