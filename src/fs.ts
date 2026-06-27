import { invoke } from "@tauri-apps/api/core";

export interface Entry {
  name: string;
  path: string;
  is_dir: boolean;
  is_symlink: boolean;
  size: number;
  mtime: number;
  mode: number;
  glyph: string;
  kind: string;
}

export interface Stat {
  name: string;
  path: string;
  is_dir: boolean;
  size: number;
  mtime: number;
  mode: number;
  perms: string;
  owner: string;
}

export const fsApi = {
  homeDir: () => invoke<string>("home_dir"),
  listDir: (path: string, showHidden = false) =>
    invoke<Entry[]>("list_dir", { path, showHidden }),
  stat: (path: string) => invoke<Stat>("stat_path", { path }),
  readPreview: (path: string, maxBytes = 32_768) =>
    invoke<string>("read_text_preview", { path, maxBytes }),
  mkdir: (path: string) => invoke<void>("mkdir_p", { path }),
  touch: (path: string) => invoke<void>("touch_file", { path }),
  rename: (src: string, dst: string) => invoke<void>("rename_path", { src, dst }),
  remove: (path: string) => invoke<void>("remove_path", { path }),
  copyInto: (srcs: string[], destDir: string) =>
    invoke<string[]>("copy_into", { srcs, destDir }),
  moveInto: (srcs: string[], destDir: string) =>
    invoke<string[]>("move_into", { srcs, destDir }),
  canonicalize: (path: string) => invoke<string>("canonicalize", { path }),
};

export function joinPath(dir: string, name: string): string {
  if (dir.endsWith("/")) return dir + name;
  return dir + "/" + name;
}
export function parentOf(p: string): string {
  if (p === "/" || p === "") return "/";
  const trimmed = p.replace(/\/+$/, "");
  const idx = trimmed.lastIndexOf("/");
  if (idx <= 0) return "/";
  return trimmed.slice(0, idx);
}
export function basename(p: string): string {
  const trimmed = p.replace(/\/+$/, "");
  const idx = trimmed.lastIndexOf("/");
  return idx < 0 ? trimmed : trimmed.slice(idx + 1);
}

export function formatSize(n: number, isDir: boolean): string {
  if (isDir) return "—";
  if (n < 1024) return `${n} B`;
  const units = ["K", "M", "G", "T"];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(v >= 10 ? 0 : 1)}${units[i]}`;
}

export function formatMtime(unix: number): string {
  if (!unix) return "—";
  const d = new Date(unix * 1000);
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function abbreviateHome(path: string, home: string): string {
  if (home && path === home) return "~";
  if (home && path.startsWith(home + "/")) return "~" + path.slice(home.length);
  return path;
}
