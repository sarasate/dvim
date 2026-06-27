import { fsApi } from "./fs";
import { initialState } from "./state";
import { Controller } from "./controller";
import { Keymap } from "./keys";
import { render, scrollCursorIntoView } from "./render";

async function boot() {
  const root = document.getElementById("root")!;
  let home = "/";
  try {
    home = await fsApi.homeDir();
  } catch {
    /* fall back to / */
  }
  const state = initialState(home);

  const rerender = () => {
    render(state, root);
    scrollCursorIntoView(state, root);
    refocusActiveInput(state);
  };
  const controller = new Controller(state, rerender);
  const keymap = new Keymap(controller, rerender);
  keymap.bind(root);

  await controller.loadBoth();
  rerender();

  setInterval(() => {
    if (state.mode === "NORMAL" || state.mode === "VISUAL") rerender();
  }, 1000);
}

function refocusActiveInput(state: ReturnType<typeof initialState>) {
  let id: string | null = null;
  if (state.ui.palette.open) id = "palette-input";
  else if (state.ui.search.open) id = "search-input";
  else if (state.ui.rename.open) id = "rename-input";
  if (!id) return;
  const el = document.getElementById(id) as HTMLInputElement | null;
  if (!el) return;
  if (document.activeElement !== el) {
    el.focus();
    const v = el.value;
    el.setSelectionRange(v.length, v.length);
  }
}

boot().catch(err => {
  document.body.innerHTML = `<pre style="color:#ff8a80;padding:24px;font-family:monospace">boot failed:\n${String(err)}</pre>`;
});
