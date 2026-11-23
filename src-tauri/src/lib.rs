use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::SystemTime;

#[derive(Serialize)]
struct DirEntryDto {
    name: String,
    path: String,
    is_dir: bool,
    is_symlink: bool,
    size: u64,
    mtime: i64,
    mode: u32,
    glyph: String,
    kind: String,
}

#[derive(Serialize)]
struct StatDto {
    name: String,
    path: String,
    is_dir: bool,
    size: u64,
    mtime: i64,
    mode: u32,
    perms: String,
    owner: String,
}

fn mtime_unix(meta: &fs::Metadata) -> i64 {
    meta.modified()
        .ok()
        .and_then(|t| t.duration_since(SystemTime::UNIX_EPOCH).ok())
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

#[cfg(unix)]
fn mode_bits(meta: &fs::Metadata) -> u32 {
    use std::os::unix::fs::PermissionsExt;
    meta.permissions().mode()
}
#[cfg(not(unix))]
fn mode_bits(_meta: &fs::Metadata) -> u32 {
    0o644
}

fn glyph_for(name: &str, is_dir: bool, is_symlink: bool) -> (String, String) {
    if is_symlink {
        return ("↪".into(), "link".into());
    }
    if is_dir {
        return ("▸".into(), "dir".into());
    }
    let lower = name.to_lowercase();
    let ext = lower.rsplit_once('.').map(|(_, e)| e).unwrap_or("");
    let (g, k) = match ext {
        "md" | "txt" | "log" | "rst" => ("▤", "text"),
        "rs" | "go" | "py" | "ts" | "tsx" | "js" | "jsx" | "c" | "cpp" | "h" | "java" | "rb"
        | "swift" | "kt" | "sh" | "zsh" | "bash" | "lua" | "vim" | "html" | "css" | "json"
        | "yaml" | "yml" | "toml" => ("▦", "code"),
        "png" | "jpg" | "jpeg" | "gif" | "webp" | "bmp" | "svg" | "tiff" | "heic" => ("▣", "image"),
        "mp4" | "mov" | "mkv" | "avi" | "webm" => ("▶", "video"),
        "mp3" | "wav" | "flac" | "m4a" | "ogg" => ("♫", "audio"),
        "zip" | "tar" | "gz" | "xz" | "bz2" | "7z" | "rar" => ("▥", "archive"),
        "pdf" => ("▭", "pdf"),
        _ => ("·", "file"),
    };
    (g.into(), k.into())
}

fn perms_string(mode: u32, is_dir: bool) -> String {
    let mut s = String::with_capacity(10);
    s.push(if is_dir { 'd' } else { '-' });
    let rwx = |bits: u32| -> [char; 3] {
        [
            if bits & 0o4 != 0 { 'r' } else { '-' },
            if bits & 0o2 != 0 { 'w' } else { '-' },
            if bits & 0o1 != 0 { 'x' } else { '-' },
        ]
    };
    for &b in &rwx((mode >> 6) & 0o7) { s.push(b); }
    for &b in &rwx((mode >> 3) & 0o7) { s.push(b); }
    for &b in &rwx(mode & 0o7) { s.push(b); }
    s
}

#[cfg(unix)]
fn owner_of(meta: &fs::Metadata) -> String {
    use std::os::unix::fs::MetadataExt;
    let uid = meta.uid();
    unsafe {
        let pw = libc::getpwuid(uid);
        if pw.is_null() {
            return format!("{}", uid);
        }
        let name = std::ffi::CStr::from_ptr((*pw).pw_name);
        name.to_string_lossy().into_owned()
    }
}
#[cfg(not(unix))]
fn owner_of(_meta: &fs::Metadata) -> String {
    "user".into()
}

#[tauri::command]
fn home_dir() -> Result<String, String> {
    std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn list_dir(path: String, show_hidden: bool) -> Result<Vec<DirEntryDto>, String> {
    let p = PathBuf::from(&path);
    let canonical = p.canonicalize().unwrap_or(p.clone());
    let read = fs::read_dir(&canonical).map_err(|e| format!("{}: {}", path, e))?;
    let mut out = Vec::new();
    for entry in read.flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        if !show_hidden && name.starts_with('.') {
            continue;
        }
        let meta = match entry.metadata() {
            Ok(m) => m,
            Err(_) => continue,
        };
        let is_dir = meta.is_dir();
        let is_symlink = meta.file_type().is_symlink();
        let (glyph, kind) = glyph_for(&name, is_dir, is_symlink);
        out.push(DirEntryDto {
            path: entry.path().to_string_lossy().into_owned(),
            name,
            is_dir,
            is_symlink,
            size: if is_dir { 0 } else { meta.len() },
            mtime: mtime_unix(&meta),
            mode: mode_bits(&meta),
            glyph,
            kind,
        });
    }
    out.sort_by(|a, b| match (a.is_dir, b.is_dir) {
        (true, false) => std::cmp::Ordering::Less,
        (false, true) => std::cmp::Ordering::Greater,
        _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
    });
    Ok(out)
}

#[tauri::command]
fn stat_path(path: String) -> Result<StatDto, String> {
    let p = PathBuf::from(&path);
    let meta = fs::symlink_metadata(&p).map_err(|e| e.to_string())?;
    let is_dir = meta.is_dir();
    let mode = mode_bits(&meta);
    Ok(StatDto {
        name: p.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_else(|| path.clone()),
        path,
        is_dir,
        size: if is_dir { 0 } else { meta.len() },
        mtime: mtime_unix(&meta),
        mode,
        perms: perms_string(mode, is_dir),
        owner: owner_of(&meta),
    })
}

#[tauri::command]
fn read_text_preview(path: String, max_bytes: usize) -> Result<String, String> {
    let p = PathBuf::from(&path);
    let meta = fs::metadata(&p).map_err(|e| e.to_string())?;
    if meta.is_dir() {
        return Err("is a directory".into());
    }
    let cap = max_bytes.min(meta.len() as usize);
    let bytes = fs::read(&p).map_err(|e| e.to_string())?;
    let slice = &bytes[..cap.min(bytes.len())];
    if slice.iter().take(4096).any(|&b| b == 0) {
        return Err("binary".into());
    }
    Ok(String::from_utf8_lossy(slice).into_owned())
}

#[tauri::command]
fn mkdir_p(path: String) -> Result<(), String> {
    fs::create_dir_all(&path).map_err(|e| e.to_string())
}

#[tauri::command]
fn touch_file(path: String) -> Result<(), String> {
    fs::OpenOptions::new()
        .create(true)
        .write(true)
        .truncate(false)
        .open(&path)
        .map(|_| ())
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn rename_path(src: String, dst: String) -> Result<(), String> {
    fs::rename(&src, &dst).map_err(|e| e.to_string())
}

#[tauri::command]
fn remove_path(path: String) -> Result<(), String> {
    let p = Path::new(&path);
    let meta = fs::symlink_metadata(p).map_err(|e| e.to_string())?;
    if meta.is_dir() && !meta.file_type().is_symlink() {
        fs::remove_dir_all(p).map_err(|e| e.to_string())
    } else {
        fs::remove_file(p).map_err(|e| e.to_string())
    }
}

fn copy_recursive(src: &Path, dst: &Path) -> std::io::Result<()> {
    let meta = fs::symlink_metadata(src)?;
    if meta.is_dir() {
        fs::create_dir_all(dst)?;
        for entry in fs::read_dir(src)? {
            let entry = entry?;
            copy_recursive(&entry.path(), &dst.join(entry.file_name()))?;
        }
        Ok(())
    } else {
        fs::copy(src, dst).map(|_| ())
    }
}

fn unique_destination(dir: &Path, name: &str) -> PathBuf {
    let candidate = dir.join(name);
    if !candidate.exists() { return candidate; }
    let (stem, ext) = match name.rsplit_once('.') {
        Some((s, e)) if !s.is_empty() => (s.to_string(), format!(".{}", e)),
        _ => (name.to_string(), String::new()),
    };
    for i in 1..10000 {
        let c = dir.join(format!("{}_{}{}", stem, i, ext));
        if !c.exists() { return c; }
    }
    candidate
}

#[tauri::command]
fn copy_into(srcs: Vec<String>, dest_dir: String) -> Result<Vec<String>, String> {
    let dest = PathBuf::from(&dest_dir);
    if !dest.is_dir() { return Err("destination is not a directory".into()); }
    let mut out = Vec::new();
    for s in srcs {
        let src = PathBuf::from(&s);
        let name = src.file_name().map(|n| n.to_string_lossy().into_owned()).ok_or("bad src")?;
        let target = unique_destination(&dest, &name);
        copy_recursive(&src, &target).map_err(|e| format!("{}: {}", s, e))?;
        out.push(target.to_string_lossy().into_owned());
    }
    Ok(out)
}

#[tauri::command]
fn move_into(srcs: Vec<String>, dest_dir: String) -> Result<Vec<String>, String> {
    let dest = PathBuf::from(&dest_dir);
    if !dest.is_dir() { return Err("destination is not a directory".into()); }
    let mut out = Vec::new();
    for s in srcs {
        let src = PathBuf::from(&s);
        let name = src.file_name().map(|n| n.to_string_lossy().into_owned()).ok_or("bad src")?;
        let target = unique_destination(&dest, &name);
        if fs::rename(&src, &target).is_err() {
            copy_recursive(&src, &target).map_err(|e| format!("{}: {}", s, e))?;
            let meta = fs::symlink_metadata(&src).map_err(|e| e.to_string())?;
            if meta.is_dir() && !meta.file_type().is_symlink() {
                fs::remove_dir_all(&src).map_err(|e| e.to_string())?;
            } else {
                fs::remove_file(&src).map_err(|e| e.to_string())?;
            }
        }
        out.push(target.to_string_lossy().into_owned());
    }
    Ok(out)
}

#[tauri::command]
fn open_default(path: String) -> Result<(), String> {
    let p = PathBuf::from(&path);
    if !p.exists() {
        return Err(format!("not found: {}", path));
    }
    #[cfg(target_os = "macos")]
    let (cmd, args): (&str, Vec<&str>) = ("open", vec![&path]);
    #[cfg(target_os = "linux")]
    let (cmd, args): (&str, Vec<&str>) = ("xdg-open", vec![&path]);
    #[cfg(target_os = "windows")]
    let (cmd, args): (&str, Vec<&str>) = ("cmd", vec!["/C", "start", "", &path]);

    std::process::Command::new(cmd)
        .args(&args)
        .spawn()
        .map(|_| ())
        .map_err(|e| format!("{}: {}", cmd, e))
}

#[tauri::command]
fn reveal_in_finder(path: String) -> Result<(), String> {
    let p = PathBuf::from(&path);
    if !p.exists() {
        return Err(format!("not found: {}", path));
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .args(["-R", &path])
            .spawn()
            .map(|_| ())
            .map_err(|e| e.to_string())
    }
    #[cfg(target_os = "linux")]
    {
        let dir = if p.is_file() { p.parent().map(|x| x.to_path_buf()).unwrap_or(p) } else { p };
        std::process::Command::new("xdg-open")
            .arg(dir)
            .spawn()
            .map(|_| ())
            .map_err(|e| e.to_string())
    }
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .args(["/select,", &path])
            .spawn()
            .map(|_| ())
            .map_err(|e| e.to_string())
    }
}

#[tauri::command]
fn canonicalize(path: String) -> Result<String, String> {
    PathBuf::from(&path)
        .canonicalize()
        .map(|p| p.to_string_lossy().into_owned())
        .map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .invoke_handler(tauri::generate_handler![
            home_dir,
            list_dir,
            stat_path,
            read_text_preview,
            mkdir_p,
            touch_file,
            rename_path,
            remove_path,
            copy_into,
            move_into,
            open_default,
            reveal_in_finder,
            canonicalize
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
