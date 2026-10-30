#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::Duration;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIcon, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, RunEvent, WindowEvent};
use tauri_plugin_autostart::MacosLauncher;
use tauri_plugin_shell::{process::{CommandChild, CommandEvent}, ShellExt};

/// Must match API_BASE in frontend/src/services/api.js.
const BACKEND_PORT: &str = "17890";
/// Passed by the OS login item so the app starts hidden in the tray.
const AUTOSTART_ARG: &str = "--autostarted";

struct Backend(Mutex<Option<CommandChild>>);

/// .torrent files the OS asked us to open, waiting for the UI to pick them up.
/// Queued because a cold start delivers them before the webview has loaded.
#[derive(Default)]
struct PendingTorrents(Mutex<Vec<String>>);

/// Desktop-only preferences, kept by the shell because they act before/without the UI.
#[derive(serde::Serialize, serde::Deserialize, Clone)]
#[serde(rename_all = "camelCase", default)]
struct DesktopPrefs {
    /// Closing the window hides it to the tray so downloads keep running.
    close_to_tray: bool,
    /// While hidden to the tray, also drop the Dock icon (macOS) / taskbar button.
    hide_from_dock: bool,
}

impl Default for DesktopPrefs {
    fn default() -> Self {
        Self { close_to_tray: true, hide_from_dock: false }
    }
}

/// Shows or removes the app's Dock icon (macOS) and taskbar button (Windows/Linux).
fn set_dock_visible(app: &AppHandle, visible: bool) {
    #[cfg(target_os = "macos")]
    let _ = app.set_activation_policy(if visible {
        tauri::ActivationPolicy::Regular
    } else {
        tauri::ActivationPolicy::Accessory
    });
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.set_skip_taskbar(!visible);
    }
}

struct Prefs(Mutex<DesktopPrefs>);

/// Startup reveal: the window stays hidden until the UI has painted its first frame
/// (no blank/white window), unless the app was launched at login into the tray.
struct Startup {
    reveal_on_ready: bool,
    revealed: AtomicBool,
}

fn reveal_once(app: &AppHandle) {
    let startup = app.state::<Startup>();
    if startup.reveal_on_ready && !startup.revealed.swap(true, Ordering::SeqCst) {
        show_main_window(app);
    }
}

/// Called by the frontend after its first paint.
#[tauri::command]
fn app_ready(app: AppHandle) {
    reveal_once(&app);
}

fn prefs_path(app: &AppHandle) -> Option<PathBuf> {
    app.path().app_config_dir().ok().map(|d| d.join("desktop-prefs.json"))
}

fn load_prefs(app: &AppHandle) -> DesktopPrefs {
    prefs_path(app)
        .and_then(|p| std::fs::read(p).ok())
        .and_then(|b| serde_json::from_slice(&b).ok())
        .unwrap_or_default()
}

/// Extracts .torrent paths from launch arguments (Windows/Linux file association).
/// Linux desktop launchers may pass file:// URIs instead of plain paths.
fn torrent_paths<I: IntoIterator<Item = String>>(args: I) -> Vec<PathBuf> {
    args.into_iter()
        .filter_map(|arg| {
            let path = if arg.starts_with("file://") {
                tauri::Url::parse(&arg).ok()?.to_file_path().ok()?
            } else {
                PathBuf::from(arg)
            };
            let is_torrent = path
                .extension()
                .is_some_and(|ext| ext.eq_ignore_ascii_case("torrent"));
            (is_torrent && path.is_file()).then_some(path)
        })
        .collect()
}

/// Browser extension files: bundled as a resource; `tauri dev` doesn't copy resources, so
/// debug builds fall back to the repo's extension/ folder.
fn extension_dir(app: &AppHandle) -> PathBuf {
    let bundled = app.path().resource_dir().map(|d| d.join("extension")).unwrap_or_default();
    if cfg!(debug_assertions) && !bundled.join("manifest.json").exists() {
        return PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..").join("extension");
    }
    bundled
}

fn show_main_window(app: &AppHandle) {
    set_dock_visible(app, true);
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        // macOS: join every Space so the window appears on the one the user is on, instead of
        // staying (invisible) on the Space it was last shown on. Float it above the app the
        // user is in (set_focus alone may leave it behind), then undo both once it is up.
        #[cfg(target_os = "macos")]
        let _ = window.set_visible_on_all_workspaces(true);
        let _ = window.set_always_on_top(true);
        let _ = window.show();
        let _ = window.set_focus();
        let handle = app.clone();
        std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(800));
            let h = handle.clone();
            let _ = handle.run_on_main_thread(move || {
                if let Some(window) = h.get_webview_window("main") {
                    let _ = window.set_always_on_top(false);
                    #[cfg(target_os = "macos")]
                    let _ = window.set_visible_on_all_workspaces(false);
                }
            });
        });
    }
}

fn queue_torrents(app: &AppHandle, paths: Vec<PathBuf>) {
    if paths.is_empty() {
        return;
    }
    app.state::<PendingTorrents>()
        .0
        .lock()
        .unwrap()
        .extend(paths.iter().map(|p| p.to_string_lossy().into_owned()));
    let _ = app.emit("torrents-opened", ());
    show_main_window(app);
}

#[tauri::command]
fn take_pending_torrents(state: tauri::State<PendingTorrents>) -> Vec<String> {
    std::mem::take(&mut *state.0.lock().unwrap())
}

#[tauri::command]
fn get_desktop_prefs(state: tauri::State<Prefs>) -> DesktopPrefs {
    state.0.lock().unwrap().clone()
}

#[tauri::command]
fn set_desktop_prefs(app: AppHandle, state: tauri::State<Prefs>, prefs: DesktopPrefs) -> Result<(), String> {
    *state.0.lock().unwrap() = prefs.clone();
    let path = prefs_path(&app).ok_or("no config directory")?;
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    std::fs::write(path, serde_json::to_vec_pretty(&prefs).unwrap()).map_err(|e| e.to_string())
}

/// Live status from the UI, shown as the tray tooltip (e.g. "2 active · 3.4 MB/s").
#[tauri::command]
fn set_tray_status(app: AppHandle, text: String) {
    if let Some(tray) = app.try_state::<TrayIcon>() {
        let tooltip = if text.is_empty() { "Download Manager".to_string() } else { format!("Download Manager\n{text}") };
        let _ = tray.set_tooltip(Some(tooltip));
    }
}

fn build_tray(app: &AppHandle) -> tauri::Result<TrayIcon> {
    let show = MenuItem::with_id(app, "show", "Show Download Manager", true, None::<&str>)?;
    let pause_all = MenuItem::with_id(app, "pause-all", "Pause All", true, None::<&str>)?;
    let resume_all = MenuItem::with_id(app, "resume-all", "Resume All", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(
        app,
        &[
            &show,
            &PredefinedMenuItem::separator(app)?,
            &pause_all,
            &resume_all,
            &PredefinedMenuItem::separator(app)?,
            &quit,
        ],
    )?;

    // macOS menu bar: monochrome template tinted by the system. Elsewhere: brand-blue glyph.
    #[cfg(target_os = "macos")]
    let (icon, template) = (tauri::include_image!("icons/tray/tray-template.png"), true);
    #[cfg(not(target_os = "macos"))]
    let (icon, template) = (tauri::include_image!("icons/tray/tray.png"), false);

    TrayIconBuilder::with_id("main")
        .icon(icon)
        .icon_as_template(template)
        .tooltip("Download Manager")
        .menu(&menu)
        // Windows convention: left click opens the window, right click shows the menu.
        // macOS/Linux convention: any click shows the menu.
        .show_menu_on_left_click(!cfg!(target_os = "windows"))
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => show_main_window(app),
            // The frontend owns API calls; it stays alive while the window is hidden.
            "pause-all" | "resume-all" => {
                let _ = app.emit("tray-action", event.id.as_ref());
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                if cfg!(target_os = "windows") {
                    show_main_window(tray.app_handle());
                }
            }
        })
        .build(app)
}

fn main() {
    let app = tauri::Builder::default()
        // Must be first: a second launch (double-clicking a .torrent while the app runs)
        // forwards its arguments here and exits instead of opening another window.
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            let paths = torrent_paths(argv.into_iter().skip(1));
            if paths.is_empty() {
                show_main_window(app); // plain relaunch: bring the hidden window back
            } else {
                queue_torrents(app, paths);
            }
        }))
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_autostart::init(MacosLauncher::LaunchAgent, Some(vec![AUTOSTART_ARG])))
        .manage(PendingTorrents::default())
        .invoke_handler(tauri::generate_handler![
            take_pending_torrents,
            app_ready,
            get_desktop_prefs,
            set_desktop_prefs,
            set_tray_status
        ])
        .setup(|app| {
            let data_dir = app.path().app_data_dir()?;
            let download_dir = app
                .path()
                .download_dir()
                .unwrap_or_else(|_| data_dir.clone())
                .join("Download Manager");
            std::fs::create_dir_all(&data_dir)?;
            std::fs::create_dir_all(&download_dir)?;

            let (mut rx, child) = app
                .shell()
                .sidecar("dm-backend")?
                .env("PORT", BACKEND_PORT)
                .env("DATA_DIR", &data_dir)
                .env("DOWNLOAD_PATH", &download_dir)
                // Enables adding torrents by local file path (desktop only).
                .env("DM_DESKTOP", "1")
                // Browser extension files, zipped by the backend for Settings > Browser.
                .env("DM_EXTENSION_DIR", extension_dir(app.handle()))
                .current_dir(&data_dir)
                .spawn()?;
            app.manage(Backend(Mutex::new(Some(child))));
            // The backend asks for the window (e.g. a browser download waiting for confirmation).
            let events_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                while let Some(event) = rx.recv().await {
                    if let CommandEvent::Stdout(line) = event {
                        if String::from_utf8_lossy(&line).trim() == "DM_EVENT:show-window" {
                            let h = events_handle.clone();
                            let _ = events_handle.run_on_main_thread(move || show_main_window(&h));
                        }
                    }
                }
            });
            app.manage(Prefs(Mutex::new(load_prefs(app.handle()))));

            let tray = build_tray(app.handle())?;
            app.manage(tray);

            // The window starts hidden (tauri.conf.json). It is revealed by app_ready once the
            // UI has painted; a login launch stays in the tray.
            let autostarted = std::env::args().any(|a| a == AUTOSTART_ARG);
            app.manage(Startup { reveal_on_ready: !autostarted, revealed: AtomicBool::new(false) });
            // Safety net: never leave the user without a window if the UI fails to report ready.
            let handle = app.handle().clone();
            std::thread::spawn(move || {
                std::thread::sleep(Duration::from_secs(3));
                let h = handle.clone();
                let _ = handle.run_on_main_thread(move || reveal_once(&h));
            });

            // Windows/Linux: the file arrives as a launch argument.
            queue_torrents(app.handle(), torrent_paths(std::env::args().skip(1)));
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                let prefs = window.app_handle().state::<Prefs>().0.lock().unwrap().clone();
                if prefs.close_to_tray {
                    api.prevent_close();
                    let _ = window.hide();
                    if prefs.hide_from_dock {
                        set_dock_visible(window.app_handle(), false);
                    }
                }
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|handle, event| match event {
        // macOS: files are delivered as an "open documents" event, at launch and while running.
        #[cfg(any(target_os = "macos", target_os = "ios"))]
        RunEvent::Opened { urls } => {
            let paths = urls
                .into_iter()
                .filter_map(|u| u.to_file_path().ok())
                .map(|p| p.to_string_lossy().into_owned());
            queue_torrents(handle, torrent_paths(paths));
        }
        // macOS: clicking the Dock icon while the window is hidden brings it back.
        #[cfg(target_os = "macos")]
        RunEvent::Reopen { has_visible_windows: false, .. } => show_main_window(handle),
        RunEvent::Exit => {
            if let Some(child) = handle.state::<Backend>().0.lock().unwrap().take() {
                let _ = child.kill();
            }
        }
        _ => {}
    });
}
