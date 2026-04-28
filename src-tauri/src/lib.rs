use tauri::{
    menu::{CheckMenuItem, Menu, MenuItem},
    tray::{TrayIconBuilder, TrayIconEvent, MouseButton, MouseButtonState},
    Emitter,
    Manager,
};
use tauri_plugin_autostart::ManagerExt;
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};
use serde::{Deserialize, Serialize};
use std::fs;
use std::sync::Mutex;

// ─── Windows: встраивание окна в рабочий стол ────────────────────────────────
#[cfg(target_os = "windows")]
mod wallpaper {
    use std::ffi::OsStr;
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Foundation::*;
    use windows_sys::Win32::UI::WindowsAndMessaging::*;

    fn wstr(s: &str) -> Vec<u16> {
        OsStr::new(s).encode_wide().chain(Some(0)).collect()
    }

    static mut WORKER_W: HWND = 0;
    static mut IS_FALLBACK: bool = false;

    unsafe extern "system" fn find_worker_w(hwnd: HWND, _param: LPARAM) -> BOOL {
        let shell_view = FindWindowExW(
            hwnd, 0,
            wstr("SHELLDLL_DefView").as_ptr(),
            std::ptr::null(),
        );
        if shell_view != 0 {
            WORKER_W = FindWindowExW(0, hwnd, wstr("WorkerW").as_ptr(), std::ptr::null());
            return FALSE;
        }
        TRUE
    }

    pub fn is_fallback() -> bool { unsafe { IS_FALLBACK } }

    pub unsafe fn embed_in_desktop(hwnd: HWND) {
        IS_FALLBACK = false;

        let progman = FindWindowW(wstr("Progman").as_ptr(), std::ptr::null());
        if progman == 0 {
            eprintln!("[wallpaper] Ошибка: окно Progman не найдено");
            return;
        }

        let mut result: usize = 0;
        SendMessageTimeoutW(progman, 0x052C, 0, 0, SMTO_NORMAL, 1000, &mut result as *mut usize as *mut _);
        SendMessageTimeoutW(progman, 0x052C, 0xD, 1, SMTO_NORMAL, 1000, &mut result as *mut usize as *mut _);

        let screen_w = GetSystemMetrics(SM_CXSCREEN);
        let screen_h = GetSystemMetrics(SM_CYSCREEN);

        // Попытка 1: классический backdrop WorkerW (Win10 и большинство Win11).
        // 0x052C переместил SHELLDLL_DefView в отдельный WorkerW — ищем пустой WorkerW после него.
        WORKER_W = 0;
        EnumWindows(Some(find_worker_w), 0);
        if WORKER_W == 0 {
            std::thread::sleep(std::time::Duration::from_millis(300));
            EnumWindows(Some(find_worker_w), 0);
        }
        if WORKER_W == 0 {
            std::thread::sleep(std::time::Duration::from_millis(700));
            EnumWindows(Some(find_worker_w), 0);
        }
        if WORKER_W != 0 {
            SetParent(hwnd, WORKER_W);
            SetWindowPos(hwnd, HWND_BOTTOM, 0, 0, screen_w, screen_h, SWP_NOACTIVATE);
            ShowWindow(hwnd, SW_SHOWNOACTIVATE);
            println!("[wallpaper] Попытка1 WorkerW: {} ({}x{})", WORKER_W, screen_w, screen_h);
            return;
        }

        // Попытка 2: 0x052C создал WorkerW, но SHELLDLL_DefView остался в Progman (некоторые Win11).
        // Встраиваемся напрямую в Progman как дочернее окно, ниже SHELLDLL_DefView —
        // тогда иконки (дети SHELLDLL_DefView) гарантированно рисуются поверх нас.
        let shelldll = FindWindowExW(progman, 0, wstr("SHELLDLL_DefView").as_ptr(), std::ptr::null());
        if shelldll != 0 {
            SetParent(hwnd, progman);
            SetWindowPos(hwnd, shelldll, 0, 0, screen_w, screen_h, SWP_NOACTIVATE);
            ShowWindow(hwnd, SW_SHOWNOACTIVATE);
            println!("[wallpaper] Попытка2 Progman (ниже SHELLDLL_DefView {}x{})", screen_w, screen_h);
            return;
        }

        // Попытка 3: голый WorkerW без SHELLDLL_DefView (крайний случай).
        let mut w = FindWindowExW(0, 0, wstr("WorkerW").as_ptr(), std::ptr::null());
        while w != 0 {
            let sv = FindWindowExW(w, 0, wstr("SHELLDLL_DefView").as_ptr(), std::ptr::null());
            if sv == 0 { WORKER_W = w; break; }
            w = FindWindowExW(0, w, wstr("WorkerW").as_ptr(), std::ptr::null());
        }
        if WORKER_W != 0 {
            SetParent(hwnd, WORKER_W);
            SetWindowPos(hwnd, HWND_BOTTOM, 0, 0, screen_w, screen_h, SWP_NOACTIVATE);
            ShowWindow(hwnd, SW_SHOWNOACTIVATE);
            println!("[wallpaper] Попытка3 WorkerW: {} ({}x{})", WORKER_W, screen_w, screen_h);
            return;
        }

        // Fallback: последний резерв — позиционируем под Progman в z-order.
        IS_FALLBACK = true;
        SetParent(hwnd, 0);
        let style = GetWindowLongPtrW(hwnd, GWL_STYLE);
        SetWindowLongPtrW(hwnd, GWL_STYLE, style & !(WS_CHILD as isize));
        SetWindowPos(hwnd, progman, 0, 0, screen_w, screen_h, SWP_NOACTIVATE | SWP_SHOWWINDOW);
        println!("[wallpaper] Fallback: ниже Progman ({}x{})", screen_w, screen_h);
    }

    // Лёгкое восстановление z-order в fallback-режиме (без 0x052C и sleep)
    pub unsafe fn keep_below_progman(hwnd: HWND) {
        if !IS_FALLBACK { return; }
        let progman = FindWindowW(wstr("Progman").as_ptr(), std::ptr::null());
        if progman == 0 { return; }
        let screen_w = GetSystemMetrics(SM_CXSCREEN);
        let screen_h = GetSystemMetrics(SM_CYSCREEN);
        SetWindowPos(hwnd, progman, 0, 0, screen_w, screen_h, SWP_NOACTIVATE | SWP_SHOWWINDOW);
    }
}

// ─── Состояние трея ───────────────────────────────────────────────────────────
struct TrayState {
    autostart_item: Mutex<CheckMenuItem<tauri::Wry>>,
}

// ─── Состояние апдейтера ──────────────────────────────────────────────────────
struct UpdateState(Mutex<Option<String>>);

// ─── Подарки (Supabase) ───────────────────────────────────────────────────────
const SUPABASE_URL: &str = "https://jdqlsixroffweozmvrfa.supabase.co";
const SUPABASE_KEY: &str = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpkcWxzaXhyb2Zmd2Vvem12cmZhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcyNzkxNDEsImV4cCI6MjA5Mjg1NTE0MX0.mpQxVZxgXtlK_L05kOCHeq93siH3cTzu8swnbMuekcw";

struct MyCodeState(Mutex<String>);

#[derive(Serialize, Deserialize, Clone)]
struct Gift {
    id: String,
    from_id: String,
    #[serde(default)]
    from_name: String,
    to_id: String,
    image_url: String,
    #[serde(default)]
    name: String,
    #[serde(default)]
    creators: Vec<String>,
    #[serde(default)]
    source: String,
    #[serde(default)]
    message: String,
    #[serde(default = "default_pos")]
    pos_x: f32,
    #[serde(default = "default_pos")]
    pos_y: f32,
    #[serde(default = "default_width")]
    width_pct: f32,
    expires_at: String,
    #[serde(default)]
    created_at: String,
}

fn default_pos()   -> f32 { 0.5 }
fn default_width() -> f32 { 0.15 }

#[derive(Serialize, Deserialize, Clone)]
struct LayoutRect { x: f32, y: f32, w: f32, h: f32 }

// ─── Состояние горячих клавиш ─────────────────────────────────────────────────
struct HotkeyState {
    open:    Mutex<String>,
    left:    Mutex<String>,
    right:   Mutex<String>,
    desktop: Mutex<String>,
    up:      Mutex<String>,
    down:    Mutex<String>,
}

// ─── Структура токена ─────────────────────────────────────────────────────────
fn default_scale() -> f64 { 1.0 }

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ArtworkToken {
    pub id: String,
    pub name: String,
    pub contract: String,
    pub token_id: String,
    pub display_uri: String,
    pub creators: Vec<String>,
    #[serde(default = "default_scale")]
    pub wall_scale: f64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub dash_x: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub dash_y: Option<f64>,
    #[serde(default)]
    pub verified: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub verified_address: Option<String>,
    /// Unix-timestamp (сек) когда истекает пробный период; None = бессрочно
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub trial_expires_at: Option<u64>,
    /// Источник: "objkt" | "pinterest" | "web"
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source: Option<String>,
}

// ─── Настройки приложения ─────────────────────────────────────────────────────
fn unix_now() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

fn default_wall_bg()          -> String { "dark".to_string() }
fn default_card_frame()       -> String { "light".to_string() }
fn default_card_radius()      -> String { "L".to_string() }
fn default_glow_enabled()     -> bool   { true }
fn default_shortcut_open()    -> String { "ctrl+alt+z".to_string() }
fn default_shortcut_left()    -> String { "ctrl+alt+a".to_string() }
fn default_shortcut_right()   -> String { "ctrl+alt+d".to_string() }
fn default_shortcut_desktop() -> String { "ctrl+alt+h".to_string() }
fn default_shortcut_up()      -> String { "ctrl+alt+w".to_string() }
fn default_shortcut_down()    -> String { "ctrl+alt+s".to_string() }
fn default_trial_reset_at()      -> u64  { 0 }
fn default_trial_used()          -> u32  { 0 }
fn default_icon_underlays()      -> bool { true }

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct AppSettings {
    #[serde(default = "default_wall_bg")]
    pub wall_background: String,
    #[serde(default = "default_card_frame")]
    pub card_frame: String,
    #[serde(default = "default_card_radius")]
    pub card_radius: String,
    #[serde(default = "default_glow_enabled")]
    pub glow_enabled: bool,
    #[serde(default = "default_shortcut_open")]
    pub shortcut_open: String,
    #[serde(default = "default_shortcut_left")]
    pub shortcut_left: String,
    #[serde(default = "default_shortcut_right")]
    pub shortcut_right: String,
    #[serde(default = "default_shortcut_desktop")]
    pub shortcut_desktop: String,
    #[serde(default = "default_shortcut_up")]
    pub shortcut_up: String,
    #[serde(default = "default_shortcut_down")]
    pub shortcut_down: String,
    /// Сколько пробных добавлений использовано в текущем окне 30 дней
    #[serde(default = "default_trial_used")]
    pub trial_used_this_month: u32,
    /// Unix-timestamp конца текущего 30-дневного окна (0 = ещё не начато)
    #[serde(default = "default_trial_reset_at")]
    pub trial_reset_at: u64,
    #[serde(default = "default_icon_underlays")]
    pub icon_underlays_enabled: bool,
}

impl Default for AppSettings {
    fn default() -> Self {
        AppSettings {
            wall_background:       default_wall_bg(),
            card_frame:            default_card_frame(),
            card_radius:           default_card_radius(),
            glow_enabled:          default_glow_enabled(),
            shortcut_open:         default_shortcut_open(),
            shortcut_left:         default_shortcut_left(),
            shortcut_right:        default_shortcut_right(),
            shortcut_desktop:      default_shortcut_desktop(),
            shortcut_up:           default_shortcut_up(),
            shortcut_down:         default_shortcut_down(),
            trial_used_this_month: default_trial_used(),
            trial_reset_at:        default_trial_reset_at(),
            icon_underlays_enabled: default_icon_underlays(),
        }
    }
}

// ─── Парсинг строки шорткута ──────────────────────────────────────────────────
fn parse_shortcut_str(s: &str) -> Option<Shortcut> {
    let mut mods = Modifiers::empty();
    let mut key  = String::new();
    for part in s.split('+') {
        match part.trim().to_lowercase().as_str() {
            "ctrl" | "control" => mods |= Modifiers::CONTROL,
            "alt"              => mods |= Modifiers::ALT,
            "shift"            => mods |= Modifiers::SHIFT,
            k                  => { key = k.to_string(); }
        }
    }
    let code = match key.as_str() {
        "a" => Code::KeyA,  "b" => Code::KeyB,  "c" => Code::KeyC,
        "d" => Code::KeyD,  "e" => Code::KeyE,  "f" => Code::KeyF,
        "g" => Code::KeyG,  "h" => Code::KeyH,  "i" => Code::KeyI,
        "j" => Code::KeyJ,  "k" => Code::KeyK,  "l" => Code::KeyL,
        "m" => Code::KeyM,  "n" => Code::KeyN,  "o" => Code::KeyO,
        "p" => Code::KeyP,  "q" => Code::KeyQ,  "r" => Code::KeyR,
        "s" => Code::KeyS,  "t" => Code::KeyT,  "u" => Code::KeyU,
        "v" => Code::KeyV,  "w" => Code::KeyW,  "x" => Code::KeyX,
        "y" => Code::KeyY,  "z" => Code::KeyZ,
        "arrowleft"  | "left"  => Code::ArrowLeft,
        "arrowright" | "right" => Code::ArrowRight,
        "arrowup"    | "up"    => Code::ArrowUp,
        "arrowdown"  | "down"  => Code::ArrowDown,
        _ => return None,
    };
    Some(Shortcut::new(if mods.is_empty() { None } else { Some(mods) }, code))
}

// ─── Вспомогательные функции настроек ─────────────────────────────────────────
fn settings_path(app: &tauri::AppHandle) -> Option<std::path::PathBuf> {
    app.path().app_data_dir().ok().map(|d| d.join("settings.json"))
}

fn read_settings(app: &tauri::AppHandle) -> AppSettings {
    let Some(path) = settings_path(app) else { return AppSettings::default() };
    if !path.exists() { return AppSettings::default(); }
    let data = fs::read_to_string(&path).unwrap_or_default();
    serde_json::from_str(&data).unwrap_or_default()
}

// ─── Tauri команды: настройки ─────────────────────────────────────────────────
#[tauri::command]
fn load_settings(app: tauri::AppHandle) -> AppSettings {
    read_settings(&app)
}

#[tauri::command]
fn save_settings(app: tauri::AppHandle, settings: AppSettings) -> Result<(), String> {
    let path = settings_path(&app).ok_or("cannot get app data dir")?;
    let json = serde_json::to_string_pretty(&settings).map_err(|e| e.to_string())?;
    fs::create_dir_all(path.parent().unwrap()).ok();
    fs::write(&path, json).map_err(|e| e.to_string())
}

#[tauri::command]
fn update_shortcuts(app: tauri::AppHandle, settings: AppSettings) -> Result<(), String> {
    let state = app.state::<HotkeyState>();

    // Снимаем регистрацию старых шорткутов
    {
        let olds = [
            state.open.lock().unwrap().clone(),
            state.left.lock().unwrap().clone(),
            state.right.lock().unwrap().clone(),
            state.desktop.lock().unwrap().clone(),
            state.up.lock().unwrap().clone(),
            state.down.lock().unwrap().clone(),
        ];
        for s in &olds {
            if let Some(sc) = parse_shortcut_str(s) {
                let _ = app.global_shortcut().unregister(sc);
            }
        }
    }

    // Регистрируем новые
    let news = [
        settings.shortcut_open.as_str(),
        settings.shortcut_left.as_str(),
        settings.shortcut_right.as_str(),
        settings.shortcut_desktop.as_str(),
        settings.shortcut_up.as_str(),
        settings.shortcut_down.as_str(),
    ];
    for s in &news {
        if let Some(sc) = parse_shortcut_str(s) {
            app.global_shortcut().register(sc).map_err(|e| e.to_string())?;
        }
    }

    // Обновляем состояние
    *state.open.lock().unwrap()    = settings.shortcut_open;
    *state.left.lock().unwrap()    = settings.shortcut_left;
    *state.right.lock().unwrap()   = settings.shortcut_right;
    *state.desktop.lock().unwrap() = settings.shortcut_desktop;
    *state.up.lock().unwrap()      = settings.shortcut_up;
    *state.down.lock().unwrap()    = settings.shortcut_down;

    Ok(())
}

// ─── Скрыть / показать ярлыки рабочего стола ─────────────────────────────────
#[cfg(target_os = "windows")]
unsafe fn do_toggle_desktop_icons() {
    use std::ffi::OsStr;
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::UI::WindowsAndMessaging::*;

    fn wstr(s: &str) -> Vec<u16> {
        OsStr::new(s).encode_wide().chain(Some(0)).collect()
    }

    let progman = FindWindowW(wstr("Progman").as_ptr(), std::ptr::null());
    let mut shell_view = if progman != 0 {
        FindWindowExW(progman, 0, wstr("SHELLDLL_DefView").as_ptr(), std::ptr::null())
    } else {
        0
    };

    if shell_view == 0 {
        let mut worker = FindWindowExW(0, 0, wstr("WorkerW").as_ptr(), std::ptr::null());
        while worker != 0 && shell_view == 0 {
            shell_view = FindWindowExW(worker, 0, wstr("SHELLDLL_DefView").as_ptr(), std::ptr::null());
            worker = FindWindowExW(0, worker, wstr("WorkerW").as_ptr(), std::ptr::null());
        }
    }

    if shell_view == 0 { return; }

    let list_view = FindWindowExW(shell_view, 0, wstr("SysListView32").as_ptr(), std::ptr::null());
    if list_view == 0 { return; }

    let visible = IsWindowVisible(list_view) != 0;
    ShowWindow(list_view, if visible { SW_HIDE } else { SW_SHOW });
    println!("[desktop] Ярлыки: {}", if visible { "скрыты" } else { "показаны" });
}

#[tauri::command]
fn toggle_desktop_icons() {
    #[cfg(target_os = "windows")]
    unsafe { do_toggle_desktop_icons(); }
}

// ─── Tauri команды: автозапуск ────────────────────────────────────────────────
#[tauri::command]
fn get_autostart_enabled(app: tauri::AppHandle) -> bool {
    app.autolaunch().is_enabled().unwrap_or(false)
}

#[tauri::command]
fn set_autostart_enabled(app: tauri::AppHandle, enabled: bool) -> Result<(), String> {
    let autolaunch = app.autolaunch();
    if enabled {
        autolaunch.enable().map_err(|e| e.to_string())?;
    } else {
        autolaunch.disable().map_err(|e| e.to_string())?;
    }
    if let Some(state) = app.try_state::<TrayState>() {
        if let Ok(item) = state.autostart_item.lock() {
            let _ = item.set_checked(enabled);
        }
    }
    Ok(())
}

// ─── IPFS → HTTP gateway ──────────────────────────────────────────────────────
fn resolve_uri(uri: &str) -> String {
    if uri.starts_with("ipfs://") {
        let hash = uri.trim_start_matches("ipfs://");
        format!("https://ipfs.io/ipfs/{}", hash)
    } else {
        uri.to_string()
    }
}

// ─── Парсинг ссылки objkt ─────────────────────────────────────────────────────
fn parse_objkt_url(url: &str) -> Option<(String, String)> {
    let url = url.trim();
    let parsed = reqwest::Url::parse(url).ok()?;
    if !parsed.host_str().unwrap_or("").contains("objkt.com") {
        return None;
    }
    let parts: Vec<&str> = parsed.path().split('/').filter(|s| !s.is_empty()).collect();
    let prefix_idx = parts.iter().position(|&p| {
        p == "tokens" || p == "o" || p == "asset" || p == "t"
    })?;
    if parts.len() < prefix_idx + 3 {
        return None;
    }
    let contract = parts[prefix_idx + 1].to_string();
    let token_id = parts[prefix_idx + 2].to_string();
    if token_id.parse::<u64>().is_err() {
        return None;
    }
    Some((contract, token_id))
}

// ─── Извлечь OG-тег из HTML ──────────────────────────────────────────────────
fn extract_meta_content(html: &str, property: &str) -> Option<String> {
    let lower = html.to_lowercase();
    let prop_pattern = format!("\"{}\"", property.to_lowercase());

    let mut search_from = 0;
    while search_from < lower.len() {
        let rel = lower[search_from..].find(&prop_pattern)?;
        let abs_pos = search_from + rel;

        // Откатываемся до открывающего <meta
        let tag_start = lower[..abs_pos].rfind("<meta")?;
        let tag_end   = lower[tag_start..].find('>')
            .map(|i| i + tag_start)
            .unwrap_or(lower.len().saturating_sub(1));
        let tag       = &html[tag_start..=tag_end.min(html.len() - 1)];
        let tag_lower = tag.to_lowercase();

        if let Some(c_pos) = tag_lower.find("content=\"") {
            let start = c_pos + 9;
            if start < tag.len() {
                if let Some(end) = tag[start..].find('"') {
                    let content = &tag[start..start + end];
                    if !content.is_empty() {
                        return Some(content
                            .replace("&amp;", "&")
                            .replace("&quot;", "\"")
                            .replace("&#39;", "'"));
                    }
                }
            }
        }

        search_from = abs_pos + prop_pattern.len();
    }
    None
}

// ─── Универсальный скрейпинг OG-тегов ────────────────────────────────────────
async fn fetch_og_token_inner(url: &str, source: &str) -> Result<ArtworkToken, String> {
    let client = reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36")
        .build()
        .map_err(|e| e.to_string())?;

    let resp = client.get(url).send().await
        .map_err(|e| format!("Ошибка сети: {}", e))?;
    let html = resp.text().await
        .map_err(|e| format!("Ошибка чтения страницы: {}", e))?;

    let image_url = extract_meta_content(&html, "og:image")
        .ok_or_else(|| "Не удалось найти изображение на странице".to_string())?;

    let title = extract_meta_content(&html, "og:title")
        .unwrap_or_else(|| "Без названия".to_string());

    let creator = extract_meta_content(&html, "og:site_name")
        .unwrap_or_default();

    // Генерируем уникальный id из URL
    let url_tail = if url.len() > 40 { &url[url.len() - 40..] } else { url };
    let id = format!("{}_{}", source, url_tail.replace(['/', ':', '?', '&', '='], "_"));

    Ok(ArtworkToken {
        id,
        name:             title,
        contract:         String::new(),
        token_id:         String::new(),
        display_uri:      image_url,
        creators:         if creator.is_empty() { vec![] } else { vec![creator] },
        wall_scale:       1.0,
        dash_x:           None,
        dash_y:           None,
        verified:         true, // веб-изображения не нуждаются в блокчейн-верификации
        verified_address: None,
        trial_expires_at: None,
        source:           Some(source.to_string()),
    })
}

// ─── Tauri команда: запросить токен с objkt ───────────────────────────────────
async fn fetch_objkt_token_inner(url: &str) -> Result<ArtworkToken, String> {
    let (contract_or_slug, token_id) = parse_objkt_url(url)
        .ok_or_else(|| "Неверная ссылка — вставьте адрес объекта с objkt.com".to_string())?;

    let where_clause = if contract_or_slug.starts_with("KT1") {
        format!(r#"fa_contract: {{ _eq: \"{}\" }}, token_id: {{ _eq: \"{}\" }}"#,
            contract_or_slug, token_id)
    } else {
        format!(r#"fa: {{ path: {{ _eq: \"{}\" }} }}, token_id: {{ _eq: \"{}\" }}"#,
            contract_or_slug, token_id)
    };

    let query = format!(
        r#"{{ "query": "{{ token(where: {{ {} }}) {{ name display_uri artifact_uri fa_contract token_id creators {{ holder {{ alias address }} }} }} }}" }}"#,
        where_clause
    );

    let client = reqwest::Client::new();
    let resp = client
        .post("https://data.objkt.com/v3/graphql")
        .header("Content-Type", "application/json")
        .body(query)
        .send()
        .await
        .map_err(|e| format!("Ошибка сети: {}", e))?;

    let json: serde_json::Value = resp.json().await
        .map_err(|e| format!("Ошибка ответа: {}", e))?;

    let token = json["data"]["token"].as_array()
        .and_then(|arr| arr.first())
        .ok_or_else(|| "Объект не найден на objkt.com".to_string())?;

    let name = token["name"].as_str().unwrap_or("Без названия").to_string();

    let raw_uri = token["display_uri"].as_str()
        .or_else(|| token["artifact_uri"].as_str())
        .unwrap_or("")
        .to_string();
    let display_uri = resolve_uri(&raw_uri);

    if display_uri.is_empty() {
        return Err("У объекта нет изображения".to_string());
    }

    let creators: Vec<String> = token["creators"].as_array()
        .map(|arr| arr.iter().filter_map(|c| {
            c["holder"]["alias"].as_str()
                .filter(|s| !s.is_empty())
                .map(|s| s.to_string())
                .or_else(|| c["holder"]["address"].as_str().map(|a| {
                    format!("{}…{}", &a[..4], &a[a.len()-4..])
                }))
        }).collect())
        .unwrap_or_default();

    let contract = token["fa_contract"].as_str()
        .unwrap_or(&contract_or_slug)
        .to_string();
    let token_id_final = token["token_id"].as_str()
        .unwrap_or(&token_id)
        .to_string();

    Ok(ArtworkToken {
        id:               format!("{}_{}", contract, token_id_final),
        name,
        contract,
        token_id:         token_id_final,
        display_uri,
        creators,
        wall_scale:       1.0,
        dash_x:           None,
        dash_y:           None,
        verified:         false,
        verified_address: None,
        trial_expires_at: None,
        source:           Some("objkt".to_string()),
    })
}

// ─── Tauri команда: универсальный импорт по URL ───────────────────────────────
#[tauri::command]
async fn fetch_token(url: String) -> Result<ArtworkToken, String> {
    let u = url.trim().to_lowercase();
    if u.contains("objkt.com") {
        fetch_objkt_token_inner(&url).await
    } else if u.contains("pinterest.") || u.contains("pin.it") {
        fetch_og_token_inner(&url, "pinterest").await
    } else {
        Err("Поддерживаемые платформы: objkt.com и Pinterest".to_string())
    }
}

// ─── (оставлен для обратной совместимости) ────────────────────────────────────
#[tauri::command]
async fn fetch_objkt_token(url: String) -> Result<ArtworkToken, String> {
    fetch_objkt_token_inner(&url).await
}

// ─── Tauri команда: сохранить токен ──────────────────────────────────────────
#[tauri::command]
fn save_token(app: tauri::AppHandle, token: ArtworkToken) -> Result<(), String> {
    let path = app.path().app_data_dir()
        .map_err(|e| e.to_string())?
        .join("tokens.json");

    let mut tokens: Vec<ArtworkToken> = if path.exists() {
        let data = fs::read_to_string(&path).unwrap_or_else(|_| "[]".to_string());
        serde_json::from_str(&data).unwrap_or_default()
    } else {
        vec![]
    };

    if !tokens.iter().any(|t| t.id == token.id) {
        tokens.push(token);
        let json = serde_json::to_string_pretty(&tokens)
            .map_err(|e| e.to_string())?;
        fs::create_dir_all(path.parent().unwrap()).ok();
        fs::write(&path, json).map_err(|e| e.to_string())?;
    }

    Ok(())
}

// ─── Tauri команда: загрузить все токены ─────────────────────────────────────
#[tauri::command]
fn load_tokens(app: tauri::AppHandle) -> Result<Vec<ArtworkToken>, String> {
    let path = app.path().app_data_dir()
        .map_err(|e| e.to_string())?
        .join("tokens.json");

    if !path.exists() {
        return Ok(vec![]);
    }

    let data = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let tokens: Vec<ArtworkToken> = serde_json::from_str(&data).unwrap_or_default();
    Ok(tokens)
}

// ─── Tauri команда: обновить список токенов ───────────────────────────────────
#[tauri::command]
fn update_tokens(app: tauri::AppHandle, tokens: Vec<ArtworkToken>) -> Result<(), String> {
    let path = app.path().app_data_dir()
        .map_err(|e| e.to_string())?
        .join("tokens.json");
    let json = serde_json::to_string_pretty(&tokens)
        .map_err(|e| e.to_string())?;
    fs::create_dir_all(path.parent().unwrap()).ok();
    fs::write(&path, json).map_err(|e| e.to_string())?;
    Ok(())
}

// ─── Квота пробных добавлений ─────────────────────────────────────────────────
const TRIAL_LIMIT:    u32 = 5;
const TRIAL_DURATION: u64 = 3 * 24 * 60 * 60;
const QUOTA_WINDOW:   u64 = 30 * 24 * 60 * 60;

#[tauri::command]
fn get_trial_quota(app: tauri::AppHandle) -> u32 {
    let settings = read_settings(&app);
    let now = unix_now();
    if now >= settings.trial_reset_at {
        TRIAL_LIMIT
    } else {
        TRIAL_LIMIT.saturating_sub(settings.trial_used_this_month)
    }
}

#[tauri::command]
fn add_trial_token(app: tauri::AppHandle, mut token: ArtworkToken) -> Result<(), String> {
    let mut settings = read_settings(&app);
    let now = unix_now();

    if now >= settings.trial_reset_at {
        settings.trial_used_this_month = 0;
        settings.trial_reset_at = now + QUOTA_WINDOW;
    }

    if settings.trial_used_this_month >= TRIAL_LIMIT {
        return Err(format!(
            "Достигнут лимит {} работ без подтверждения в месяц. Следующий сброс через {} ч.",
            TRIAL_LIMIT,
            (settings.trial_reset_at.saturating_sub(now)) / 3600
        ));
    }

    token.trial_expires_at = Some(now + TRIAL_DURATION);
    token.verified         = false;

    let path = app.path().app_data_dir()
        .map_err(|e| e.to_string())?
        .join("tokens.json");

    let mut tokens: Vec<ArtworkToken> = if path.exists() {
        let data = fs::read_to_string(&path).unwrap_or_else(|_| "[]".to_string());
        serde_json::from_str(&data).unwrap_or_default()
    } else {
        vec![]
    };

    if !tokens.iter().any(|t| t.id == token.id) {
        tokens.push(token);
        let json = serde_json::to_string_pretty(&tokens).map_err(|e| e.to_string())?;
        fs::create_dir_all(path.parent().unwrap()).ok();
        fs::write(&path, json).map_err(|e| e.to_string())?;
    }

    settings.trial_used_this_month += 1;
    save_settings(app, settings)?;

    Ok(())
}

#[tauri::command]
fn cleanup_expired_tokens(app: tauri::AppHandle) -> Result<Vec<String>, String> {
    let path = app.path().app_data_dir()
        .map_err(|e| e.to_string())?
        .join("tokens.json");

    if !path.exists() {
        return Ok(vec![]);
    }

    let data = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let tokens: Vec<ArtworkToken> = serde_json::from_str(&data).unwrap_or_default();

    let now = unix_now();
    let mut expired_ids = vec![];
    let valid: Vec<ArtworkToken> = tokens.into_iter().filter(|t| {
        if let Some(exp) = t.trial_expires_at {
            if now >= exp {
                expired_ids.push(t.id.clone());
                return false;
            }
        }
        true
    }).collect();

    if !expired_ids.is_empty() {
        let json = serde_json::to_string_pretty(&valid).map_err(|e| e.to_string())?;
        fs::write(&path, json).map_err(|e| e.to_string())?;
        println!("[trial] Удалено {} истёкших токенов: {:?}", expired_ids.len(), expired_ids);
    }

    Ok(expired_ids)
}

// ─── Позиции ярлыков рабочего стола ──────────────────────────────────────────
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct DesktopIcon {
    pub x: i32,
    pub y: i32,
    pub w: i32,
    pub h: i32,
}

#[tauri::command]
fn get_desktop_icons() -> Vec<DesktopIcon> {
    #[cfg(target_os = "windows")]
    unsafe { get_desktop_icons_win() }
    #[cfg(not(target_os = "windows"))]
    vec![]
}

#[cfg(target_os = "windows")]
unsafe fn get_desktop_icons_win() -> Vec<DesktopIcon> {
    use std::ffi::OsStr;
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Foundation::{CloseHandle, FALSE, RECT};
    use windows_sys::Win32::System::Diagnostics::Debug::{ReadProcessMemory, WriteProcessMemory};
    use windows_sys::Win32::System::Memory::{
        VirtualAllocEx, VirtualFreeEx, MEM_COMMIT, MEM_RELEASE, PAGE_READWRITE,
    };
    use windows_sys::Win32::System::Threading::{
        OpenProcess, PROCESS_VM_OPERATION, PROCESS_VM_READ, PROCESS_VM_WRITE,
    };
    use windows_sys::Win32::UI::WindowsAndMessaging::*;

    fn wstr(s: &str) -> Vec<u16> {
        OsStr::new(s).encode_wide().chain(Some(0)).collect()
    }

    const LVM_GETITEMCOUNT: u32 = 0x1000 + 4;
    const LVM_GETITEMRECT:  u32 = 0x1000 + 14;
    const LVIR_SELECTBOUNDS: i32 = 3;

    // Находим SysListView32 (тот же путь, что и в toggle_desktop_icons)
    let progman = FindWindowW(wstr("Progman").as_ptr(), std::ptr::null());
    let mut shell_view = if progman != 0 {
        FindWindowExW(progman, 0, wstr("SHELLDLL_DefView").as_ptr(), std::ptr::null())
    } else {
        0
    };
    if shell_view == 0 {
        let mut worker = FindWindowExW(0, 0, wstr("WorkerW").as_ptr(), std::ptr::null());
        while worker != 0 && shell_view == 0 {
            shell_view = FindWindowExW(worker, 0, wstr("SHELLDLL_DefView").as_ptr(), std::ptr::null());
            worker = FindWindowExW(0, worker, wstr("WorkerW").as_ptr(), std::ptr::null());
        }
    }
    if shell_view == 0 { return vec![]; }

    let list_view = FindWindowExW(shell_view, 0, wstr("SysListView32").as_ptr(), std::ptr::null());
    if list_view == 0 { return vec![]; }

    let count = SendMessageW(list_view, LVM_GETITEMCOUNT, 0, 0);
    if count <= 0 { return vec![]; }

    // Открываем процесс Explorer для кросс-процессного чтения памяти
    let mut pid: u32 = 0;
    GetWindowThreadProcessId(list_view, &mut pid);
    let proc = OpenProcess(
        PROCESS_VM_READ | PROCESS_VM_WRITE | PROCESS_VM_OPERATION,
        FALSE,
        pid,
    );
    if proc == 0 { return vec![]; }

    // Выделяем один RECT в памяти Explorer — переиспользуем для всех иконок
    let remote_rect = VirtualAllocEx(
        proc,
        std::ptr::null(),
        std::mem::size_of::<RECT>(),
        MEM_COMMIT,
        PAGE_READWRITE,
    );
    if remote_rect.is_null() {
        CloseHandle(proc);
        return vec![];
    }

    let mut icons = Vec::with_capacity(count as usize);
    for i in 0..count {
        // Записываем код LVIR в поле left перед отправкой сообщения
        let code_bytes = LVIR_SELECTBOUNDS.to_ne_bytes();
        WriteProcessMemory(
            proc, remote_rect,
            code_bytes.as_ptr() as _,
            4,
            std::ptr::null_mut(),
        );

        let ok = SendMessageW(list_view, LVM_GETITEMRECT, i as usize, remote_rect as isize);
        if ok != 0 {
            let mut rc = RECT { left: 0, top: 0, right: 0, bottom: 0 };
            ReadProcessMemory(
                proc, remote_rect,
                &mut rc as *mut RECT as _,
                std::mem::size_of::<RECT>(),
                std::ptr::null_mut(),
            );
            if rc.right > rc.left && rc.bottom > rc.top {
                icons.push(DesktopIcon {
                    x: rc.left,
                    y: rc.top,
                    w: rc.right  - rc.left,
                    h: rc.bottom - rc.top,
                });
            }
        }
    }

    VirtualFreeEx(proc, remote_rect, 0, MEM_RELEASE);
    CloseHandle(proc);
    icons
}

// ─── Снять выделение / фокус с ярлыков рабочего стола ────────────────────────
#[tauri::command]
fn clear_icon_selection() {
    #[cfg(target_os = "windows")]
    unsafe { clear_icon_selection_win(); }
}

#[cfg(target_os = "windows")]
unsafe fn clear_icon_selection_win() {
    use std::ffi::OsStr;
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Foundation::{CloseHandle, FALSE};
    use windows_sys::Win32::System::Diagnostics::Debug::WriteProcessMemory;
    use windows_sys::Win32::System::Memory::{
        VirtualAllocEx, VirtualFreeEx, MEM_COMMIT, MEM_RELEASE, PAGE_READWRITE,
    };
    use windows_sys::Win32::System::Threading::{
        OpenProcess, PROCESS_VM_OPERATION, PROCESS_VM_WRITE,
    };
    use windows_sys::Win32::UI::WindowsAndMessaging::*;

    fn wstr(s: &str) -> Vec<u16> {
        OsStr::new(s).encode_wide().chain(Some(0)).collect()
    }

    const LVM_SETITEMSTATE: u32 = 0x1000 + 43;
    const LVIF_STATE:        u32 = 0x0008;
    const LVIS_FOCUSED:      u32 = 0x0001;
    const LVIS_SELECTED:     u32 = 0x0002;

    let progman = FindWindowW(wstr("Progman").as_ptr(), std::ptr::null());
    let mut shell_view = if progman != 0 {
        FindWindowExW(progman, 0, wstr("SHELLDLL_DefView").as_ptr(), std::ptr::null())
    } else { 0 };
    if shell_view == 0 {
        let mut worker = FindWindowExW(0, 0, wstr("WorkerW").as_ptr(), std::ptr::null());
        while worker != 0 && shell_view == 0 {
            shell_view = FindWindowExW(worker, 0, wstr("SHELLDLL_DefView").as_ptr(), std::ptr::null());
            worker = FindWindowExW(0, worker, wstr("WorkerW").as_ptr(), std::ptr::null());
        }
    }
    if shell_view == 0 { return; }

    let list_view = FindWindowExW(shell_view, 0, wstr("SysListView32").as_ptr(), std::ptr::null());
    if list_view == 0 { return; }

    let mut pid: u32 = 0;
    GetWindowThreadProcessId(list_view, &mut pid);
    let proc = OpenProcess(PROCESS_VM_OPERATION | PROCESS_VM_WRITE, FALSE, pid);
    if proc == 0 { return; }

    // LVITEM: только первые 5 полей нужны для смены состояния
    #[repr(C)]
    struct LvItem { mask: u32, i_item: i32, i_sub_item: i32, state: u32, state_mask: u32 }
    let item = LvItem {
        mask:       LVIF_STATE,
        i_item:     0,
        i_sub_item: 0,
        state:      0,  // сбросить
        state_mask: LVIS_FOCUSED | LVIS_SELECTED,
    };

    let remote = VirtualAllocEx(
        proc, std::ptr::null(),
        std::mem::size_of::<LvItem>(),
        MEM_COMMIT, PAGE_READWRITE,
    );
    if remote.is_null() { CloseHandle(proc); return; }

    WriteProcessMemory(
        proc, remote,
        &item as *const LvItem as _,
        std::mem::size_of::<LvItem>(),
        std::ptr::null_mut(),
    );

    // wParam = usize::MAX (то есть -1) означает «применить ко всем элементам»
    SendMessageW(list_view, LVM_SETITEMSTATE, usize::MAX, remote as isize);

    VirtualFreeEx(proc, remote, 0, MEM_RELEASE);
    CloseHandle(proc);
}

// ─── Tauri команда: проверить владение токеном через TzKT ────────────────────
#[tauri::command]
async fn verify_ownership(contract: String, token_id: String, wallet: String) -> Result<bool, String> {
    if !wallet.starts_with("tz1") && !wallet.starts_with("tz2") && !wallet.starts_with("tz3") && !wallet.starts_with("KT1") {
        return Err("Неверный формат адреса. Адрес должен начинаться с tz1, tz2 или tz3.".to_string());
    }
    if wallet.len() < 36 {
        return Err("Адрес кошелька слишком короткий.".to_string());
    }

    let url = format!(
        "https://api.tzkt.io/v1/tokens/balances?token.contract={}&token.tokenId={}&account={}&balance.gt=0&limit=1",
        contract, token_id, wallet
    );

    let client = reqwest::Client::new();
    let resp = client
        .get(&url)
        .header("Accept", "application/json")
        .send()
        .await
        .map_err(|e| format!("Ошибка сети: {}", e))?;

    let json: serde_json::Value = resp.json().await
        .map_err(|e| format!("Ошибка ответа: {}", e))?;

    Ok(json.as_array().map_or(false, |arr| !arr.is_empty()))
}

// ─── Обновления ──────────────────────────────────────────────────────────────
#[tauri::command]
fn get_update_version(state: tauri::State<UpdateState>) -> Option<String> {
    state.0.lock().unwrap().clone()
}

#[tauri::command]
async fn check_for_updates(app: tauri::AppHandle) -> Result<Option<String>, String> {
    use tauri_plugin_updater::UpdaterExt;
    let updater = app.updater().map_err(|e| e.to_string())?;
    match updater.check().await.map_err(|e| e.to_string())? {
        Some(update) => {
            let v = update.version.to_string();
            if let Some(s) = app.try_state::<UpdateState>() {
                *s.0.lock().unwrap() = Some(v.clone());
            }
            let _ = app.emit("update-available", v.clone());
            Ok(Some(v))
        }
        None => {
            if let Some(s) = app.try_state::<UpdateState>() {
                *s.0.lock().unwrap() = None;
            }
            Ok(None)
        }
    }
}

#[tauri::command]
async fn install_update(app: tauri::AppHandle) -> Result<(), String> {
    use tauri_plugin_updater::UpdaterExt;
    let updater = app.updater().map_err(|e| e.to_string())?;
    if let Some(update) = updater.check().await.map_err(|e| e.to_string())? {
        update.download_and_install(|_, _| {}, || {}).await.map_err(|e| e.to_string())?;
    }
    Ok(())
}

// ─── Первый запуск ────────────────────────────────────────────────────────────
fn first_run_path(app: &tauri::AppHandle) -> Option<std::path::PathBuf> {
    app.path().app_data_dir().ok().map(|d| d.join("first_run.txt"))
}

#[tauri::command]
fn is_first_run(app: tauri::AppHandle) -> bool {
    let Some(path) = first_run_path(&app) else { return true };
    if path.exists() {
        return fs::read_to_string(&path).map(|s| s.trim() == "yes").unwrap_or(true);
    }
    // Файла нет: считаем что новый пользователь только если ещё нет settings.json
    let already_used = settings_path(&app).map_or(false, |p| p.exists());
    let value = if already_used { "no" } else { "yes" };
    let _ = fs::write(&path, value);
    value == "yes"
}

#[tauri::command]
fn mark_first_run_complete(app: tauri::AppHandle) -> Result<(), String> {
    let Some(path) = first_run_path(&app) else { return Ok(()) };
    fs::write(&path, "no").map_err(|e| e.to_string())
}

// ─── Подарки: утилиты ────────────────────────────────────────────────────────
fn user_id_path(app: &tauri::AppHandle) -> Option<std::path::PathBuf> {
    app.path().app_data_dir().ok().map(|d| d.join("user_id.txt"))
}

fn load_or_create_user_id(app: &tauri::AppHandle) -> String {
    if let Some(path) = user_id_path(app) {
        if path.exists() {
            if let Ok(id) = fs::read_to_string(&path) {
                let id = id.trim().to_string();
                if id.len() == 36 { return id; }
            }
        }
        let id = gen_user_id();
        let _ = fs::write(&path, &id);
        id
    } else {
        gen_user_id()
    }
}

fn gen_user_id() -> String {
    use std::sync::atomic::{AtomicU64, Ordering};
    static CTR: AtomicU64 = AtomicU64::new(0);
    let t = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos() as u64;
    let c = CTR.fetch_add(1, Ordering::Relaxed);
    let p = std::process::id() as u64;
    let a = t & 0xFFFF_FFFF;
    let b = (t >> 32) & 0xFFFF;
    let cv = 0x4000u64 | ((t >> 48) & 0x0FFF);
    let d = 0x8000u64 | ((p ^ c) & 0x3FFF);
    let e = p.wrapping_mul(0x9e37_79b9_7f4a_7c15).wrapping_add(c) & 0xFFFF_FFFF_FFFF;
    format!("{:08x}-{:04x}-{:04x}-{:04x}-{:012x}", a, b, cv, d, e)
}

fn unix_to_iso8601(unix: u64) -> String {
    let mut r = unix;
    let sec  = r % 60; r /= 60;
    let min  = r % 60; r /= 60;
    let hour = r % 24; r /= 24;
    let mut y = 1970u32;
    loop {
        let dy = if y % 4 == 0 && (y % 100 != 0 || y % 400 == 0) { 366u64 } else { 365u64 };
        if r < dy { break; }
        r -= dy; y += 1;
    }
    let leap = y % 4 == 0 && (y % 100 != 0 || y % 400 == 0);
    let dm: [u64; 12] = [31, if leap { 29 } else { 28 }, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    let mut mo = 1u32;
    for &d in &dm { if r < d { break; } r -= d; mo += 1; }
    format!("{:04}-{:02}-{:02}T{:02}:{:02}:{:02}Z", y, mo, r + 1, hour, min, sec)
}

fn now_iso8601() -> String {
    unix_to_iso8601(
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs(),
    )
}

fn future_iso8601(hours: u32) -> String {
    unix_to_iso8601(
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs()
            + hours as u64 * 3600,
    )
}

async fn supabase_get_gifts(user_id: &str) -> Result<Vec<Gift>, String> {
    let now = now_iso8601();
    let client = reqwest::Client::new();
    let resp = client
        .get(format!("{}/rest/v1/gifts", SUPABASE_URL))
        .query(&[
            ("to_id",      format!("eq.{}", user_id)),
            ("expires_at", format!("gt.{}", now)),
            ("select",     "*".to_string()),
            ("order",      "created_at.desc".to_string()),
        ])
        .header("Authorization", format!("Bearer {}", SUPABASE_KEY))
        .header("apikey", SUPABASE_KEY)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    resp.json::<Vec<Gift>>().await.map_err(|e| e.to_string())
}

async fn supabase_register_user(user_id: &str) {
    let client = reqwest::Client::new();
    let _ = client
        .post(format!("{}/rest/v1/users", SUPABASE_URL))
        .header("Authorization", format!("Bearer {}", SUPABASE_KEY))
        .header("apikey", SUPABASE_KEY)
        .header("Content-Type", "application/json")
        .header("Prefer", "return=minimal,resolution=ignore-duplicates")
        .json(&serde_json::json!({ "id": user_id }))
        .send()
        .await;
}

// ─── Подарки: команды ─────────────────────────────────────────────────────────
#[tauri::command]
fn get_my_code(state: tauri::State<MyCodeState>) -> String {
    state.0.lock().unwrap().clone()
}

#[tauri::command]
async fn get_incoming_gifts(state: tauri::State<'_, MyCodeState>) -> Result<Vec<Gift>, String> {
    let user_id = state.0.lock().unwrap().clone();
    supabase_get_gifts(&user_id).await
}

#[tauri::command]
async fn dismiss_gift(gift_id: String) -> Result<(), String> {
    let client = reqwest::Client::new();
    client
        .delete(format!("{}/rest/v1/gifts", SUPABASE_URL))
        .query(&[("id", format!("eq.{}", gift_id))])
        .header("Authorization", format!("Bearer {}", SUPABASE_KEY))
        .header("apikey", SUPABASE_KEY)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
async fn send_gift(
    state: tauri::State<'_, MyCodeState>,
    to_id: String,
    from_name: String,
    name: String,
    creators: Vec<String>,
    image_url: String,
    source: String,
    message: String,
    expires_hours: u32,
    pos_x: f32,
    pos_y: f32,
    width_pct: f32,
) -> Result<(), String> {
    let from_id = state.0.lock().unwrap().clone();
    let client = reqwest::Client::new();
    let resp = client
        .post(format!("{}/rest/v1/gifts", SUPABASE_URL))
        .header("Authorization", format!("Bearer {}", SUPABASE_KEY))
        .header("apikey", SUPABASE_KEY)
        .header("Content-Type", "application/json")
        .header("Prefer", "return=minimal")
        .json(&serde_json::json!({
            "from_id":    from_id,
            "from_name":  from_name,
            "to_id":      to_id,
            "name":       name,
            "creators":   creators,
            "image_url":  image_url,
            "source":     source,
            "message":    message,
            "pos_x":      pos_x,
            "pos_y":      pos_y,
            "width_pct":  width_pct,
            "expires_at": future_iso8601(expires_hours.max(1)),
        }))
        .send()
        .await
        .map_err(|e| format!("Ошибка записи: {}", e))?;
    if !resp.status().is_success() {
        return Err(format!("DB {}: {}", resp.status(), resp.text().await.unwrap_or_default()));
    }
    Ok(())
}

// ─── Раскладка пользователя для превью у отправителя ────────────────────────
#[tauri::command]
async fn publish_my_layout(
    state: tauri::State<'_, MyCodeState>,
    positions: Vec<LayoutRect>,
) -> Result<(), String> {
    let user_id = state.0.lock().unwrap().clone();
    let client = reqwest::Client::new();
    let resp = client
        .post(format!("{}/rest/v1/user_layouts", SUPABASE_URL))
        .header("Authorization", format!("Bearer {}", SUPABASE_KEY))
        .header("apikey", SUPABASE_KEY)
        .header("Content-Type", "application/json")
        .header("Prefer", "return=minimal,resolution=merge-duplicates")
        .json(&serde_json::json!({
            "user_id":    user_id,
            "layout":     positions,
            "updated_at": now_iso8601(),
        }))
        .send().await.map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("layout {}: {}", resp.status(), resp.text().await.unwrap_or_default()));
    }
    Ok(())
}

#[tauri::command]
async fn get_user_layout(user_id: String) -> Result<Vec<LayoutRect>, String> {
    let client = reqwest::Client::new();
    let resp = client
        .get(format!("{}/rest/v1/user_layouts", SUPABASE_URL))
        .query(&[
            ("user_id", format!("eq.{}", user_id)),
            ("select",  "layout".to_string()),
        ])
        .header("Authorization", format!("Bearer {}", SUPABASE_KEY))
        .header("apikey", SUPABASE_KEY)
        .send().await.map_err(|e| e.to_string())?;
    let arr: Vec<serde_json::Value> = resp.json().await.map_err(|e| e.to_string())?;
    if arr.is_empty() { return Ok(vec![]); }
    let layout: Vec<LayoutRect> =
        serde_json::from_value(arr[0]["layout"].clone()).unwrap_or_default();
    Ok(layout)
}

// ─── Точка входа ─────────────────────────────────────────────────────────────
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            // Повторный запуск — фокусируем существующее окно вместо создания нового процесса
            if let Some(w) = app.get_webview_window("welcome") {
                let _ = w.show();
                let _ = w.set_focus();
            }
        }))
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec![]),
        ))
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, shortcut, event| {
                    if event.state() != ShortcutState::Pressed {
                        return;
                    }
                    let Some(state) = app.try_state::<HotkeyState>() else { return };

                    let sc_open    = state.open.lock().unwrap().clone();
                    let sc_left    = state.left.lock().unwrap().clone();
                    let sc_right   = state.right.lock().unwrap().clone();
                    let sc_desktop = state.desktop.lock().unwrap().clone();
                    let sc_up      = state.up.lock().unwrap().clone();
                    let sc_down    = state.down.lock().unwrap().clone();

                    let is_left    = parse_shortcut_str(&sc_left)   .map_or(false, |s| s == *shortcut);
                    let is_right   = parse_shortcut_str(&sc_right)  .map_or(false, |s| s == *shortcut);
                    let is_open    = parse_shortcut_str(&sc_open)   .map_or(false, |s| s == *shortcut);
                    let is_desktop = parse_shortcut_str(&sc_desktop).map_or(false, |s| s == *shortcut);
                    let is_up      = parse_shortcut_str(&sc_up)     .map_or(false, |s| s == *shortcut);
                    let is_down    = parse_shortcut_str(&sc_down)   .map_or(false, |s| s == *shortcut);

                    if is_left {
                        if let Some(w) = app.get_webview_window("main") {
                            let _ = w.eval("window.scrollWall('left')");
                        }
                    } else if is_right {
                        if let Some(w) = app.get_webview_window("main") {
                            let _ = w.eval("window.scrollWall('right')");
                        }
                    } else if is_up {
                        if let Some(w) = app.get_webview_window("main") {
                            let _ = w.eval("window.scrollWallV('up')");
                        }
                    } else if is_down {
                        if let Some(w) = app.get_webview_window("main") {
                            let _ = w.eval("window.scrollWallV('down')");
                        }
                    } else if is_open {
                        if let Some(w) = app.get_webview_window("welcome") {
                            let visible = w.is_visible().unwrap_or(false);
                            if visible { let _ = w.hide(); }
                            else { let _ = w.show(); let _ = w.set_focus(); }
                        }
                    } else if is_desktop {
                        #[cfg(target_os = "windows")]
                        unsafe { do_toggle_desktop_icons(); }
                    }
                })
                .build(),
        )
        .invoke_handler(tauri::generate_handler![
            fetch_token,
            fetch_objkt_token,
            save_token,
            load_tokens,
            update_tokens,
            load_settings,
            save_settings,
            update_shortcuts,
            toggle_desktop_icons,
            get_autostart_enabled,
            set_autostart_enabled,
            verify_ownership,
            get_trial_quota,
            add_trial_token,
            cleanup_expired_tokens,
            get_desktop_icons,
            clear_icon_selection,
            get_update_version,
            check_for_updates,
            install_update,
            get_my_code,
            send_gift,
            get_incoming_gifts,
            dismiss_gift,
            publish_my_layout,
            get_user_layout,
            is_first_run,
            mark_first_run_complete,
        ])
        .setup(|app| {
            // ── Встраиваем главное окно в рабочий стол ───────────────────────
            // Запускаем в фоновом потоке: WebView2 на Windows 11 инициализирует
            // compositor асинхронно, вызов из setup() слишком ранний.
            #[cfg(target_os = "windows")]
            {
                let handle = app.handle().clone();
                std::thread::spawn(move || {
                    // Ждём инициализации WebView2 compositor (критично на Windows 11)
                    std::thread::sleep(std::time::Duration::from_millis(1500));
                    if let Some(w) = handle.get_webview_window("main") {
                        if let Ok(hwnd_tauri) = w.hwnd() {
                            let hwnd = hwnd_tauri.0 as isize;
                            unsafe { wallpaper::embed_in_desktop(hwnd); }
                            // Периодически проверяем встраивание
                            loop {
                                std::thread::sleep(std::time::Duration::from_secs(30));
                                if wallpaper::is_fallback() {
                                    // В fallback-режиме просто поддерживаем z-order ниже Progman
                                    unsafe { wallpaper::keep_below_progman(hwnd); }
                                } else {
                                    // В нормальном режиме проверяем, что WorkerW всё ещё наш родитель
                                    use windows_sys::Win32::UI::WindowsAndMessaging::GetParent;
                                    if unsafe { GetParent(hwnd) } == 0 {
                                        println!("[wallpaper] Переподключение к рабочему столу...");
                                        unsafe { wallpaper::embed_in_desktop(hwnd); }
                                    }
                                }
                            }
                        }
                    }
                });
            }

            // ── Код пользователя + фоновый опрос подарков ────────────────────
            let my_id = load_or_create_user_id(&app.handle());
            app.manage(MyCodeState(Mutex::new(my_id.clone())));
            {
                let handle = app.handle().clone();
                tauri::async_runtime::spawn(async move {
                    supabase_register_user(&my_id).await;
                    let mut known: std::collections::HashSet<String> = std::collections::HashSet::new();
                    loop {
                        tokio::time::sleep(std::time::Duration::from_secs(30)).await;
                        if let Ok(gifts) = supabase_get_gifts(&my_id).await {
                            for g in gifts {
                                if known.insert(g.id.clone()) {
                                    println!("[gifts] Новый подарок от {}", g.from_id);
                                    let _ = handle.emit("gift-received", &g);
                                }
                            }
                        }
                    }
                });
            }

            // ── Состояние апдейтера + фоновая проверка ───────────────────────
            app.manage(UpdateState(Mutex::new(None)));
            {
                let handle = app.handle().clone();
                tauri::async_runtime::spawn(async move {
                    use tauri_plugin_updater::UpdaterExt;
                    // Первая проверка через 3 сек после старта, затем каждые 30 минут
                    tokio::time::sleep(std::time::Duration::from_secs(3)).await;
                    loop {
                        if let Ok(updater) = handle.updater() {
                            match updater.check().await {
                                Ok(Some(update)) => {
                                    println!("[updater] Доступно: {}", update.version);
                                    let v = update.version.to_string();
                                    if let Some(s) = handle.try_state::<UpdateState>() {
                                        *s.0.lock().unwrap() = Some(v.clone());
                                    }
                                    let _ = handle.emit("update-available", v);
                                }
                                Ok(None) => println!("[updater] Обновлений нет"),
                                Err(e)  => eprintln!("[updater] Ошибка: {}", e),
                            }
                        }
                        tokio::time::sleep(std::time::Duration::from_secs(1800)).await;
                    }
                });
            }

            // ── Загружаем настройки и регистрируем горячие клавиши ────────────
            let settings = read_settings(&app.handle());

            let all_shortcuts = [
                &settings.shortcut_open,
                &settings.shortcut_left,
                &settings.shortcut_right,
                &settings.shortcut_desktop,
                &settings.shortcut_up,
                &settings.shortcut_down,
            ];
            for s in &all_shortcuts {
                if let Some(sc) = parse_shortcut_str(s) {
                    if let Err(e) = app.global_shortcut().register(sc) {
                        eprintln!("[shortcuts] Не удалось зарегистрировать {}: {}", s, e);
                    }
                }
            }
            println!("[shortcuts] Зарегистрировано {} шорткутов", all_shortcuts.len());

            app.manage(HotkeyState {
                open:    Mutex::new(settings.shortcut_open.clone()),
                left:    Mutex::new(settings.shortcut_left.clone()),
                right:   Mutex::new(settings.shortcut_right.clone()),
                desktop: Mutex::new(settings.shortcut_desktop.clone()),
                up:      Mutex::new(settings.shortcut_up.clone()),
                down:    Mutex::new(settings.shortcut_down.clone()),
            });

            // ── Системный трей ────────────────────────────────────────────────
            let is_autostart = app.autolaunch().is_enabled().unwrap_or(false);

            let open_item      = MenuItem::with_id(app, "open",      "Открыть управление", true, None::<&str>)?;
            let autostart_item = CheckMenuItem::with_id(app, "autostart", "Автозапуск", true, is_autostart, None::<&str>)?;
            let quit_item      = MenuItem::with_id(app, "quit",      "Выход",              true, None::<&str>)?;

            let menu = Menu::with_items(app, &[&open_item, &autostart_item, &quit_item])?;

            TrayIconBuilder::with_id("main-tray")
                .icon(app.default_window_icon().unwrap().clone())
                .menu(&menu)
                .show_menu_on_left_click(false)
                .tooltip("ХОЛСТ")
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click { button, button_state, .. } = event {
                        if button == MouseButton::Left && button_state == MouseButtonState::Up {
                            let app = tray.app_handle();
                            if let Some(w) = app.get_webview_window("welcome") {
                                let _ = w.show();
                                let _ = w.set_focus();
                            }
                        }
                    }
                })
                .on_menu_event(|app, event| {
                    match event.id.as_ref() {
                        "open" => {
                            if let Some(w) = app.get_webview_window("welcome") {
                                if w.is_visible().unwrap_or(false) {
                                    let _ = w.set_focus();
                                } else {
                                    let _ = w.show();
                                    let _ = w.set_focus();
                                }
                            }
                        }
                        "autostart" => {
                            let autolaunch = app.autolaunch();
                            let was_enabled = autolaunch.is_enabled().unwrap_or(false);
                            if was_enabled {
                                let _ = autolaunch.disable();
                            } else {
                                let _ = autolaunch.enable();
                            }
                            if let Some(state) = app.try_state::<TrayState>() {
                                if let Ok(item) = state.autostart_item.lock() {
                                    let _ = item.set_checked(!was_enabled);
                                }
                            }
                            println!("[tray] Автозапуск: {}", if was_enabled { "выкл" } else { "вкл" });
                        }
                        "quit" => {
                            println!("[tray] Выход");
                            #[cfg(target_os = "windows")]
                            if let Some(w) = app.get_webview_window("main") {
                                if let Ok(hwnd_tauri) = w.hwnd() {
                                    use windows_sys::Win32::UI::WindowsAndMessaging::*;
                                    use windows_sys::Win32::Graphics::Gdi::*;
                                    unsafe {
                                        let hwnd = hwnd_tauri.0 as isize;
                                        ShowWindow(hwnd, SW_HIDE);
                                        SetParent(hwnd, 0);
                                        // Force full desktop repaint to clear WebView2 compositor artifact
                                        let desktop = GetDesktopWindow();
                                        InvalidateRect(desktop, std::ptr::null(), 1);
                                        RedrawWindow(desktop, std::ptr::null(), 0, RDW_INVALIDATE | RDW_ALLCHILDREN | RDW_UPDATENOW);
                                    }
                                }
                            }
                            app.exit(0);
                        }
                        _ => {}
                    }
                })
                .build(app)?;

            app.manage(TrayState {
                autostart_item: Mutex::new(autostart_item),
            });

            println!("[tray] Системный трей создан");

            // Если это первый запуск — сразу показываем окно ХОЛСТ
            if is_first_run(app.handle().clone()) {
                if let Some(w) = app.get_webview_window("welcome") {
                    let _ = w.show();
                    let _ = w.set_focus();
                }
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
