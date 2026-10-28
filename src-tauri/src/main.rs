#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::sync::Mutex;
use tauri::{Manager, RunEvent};
use tauri_plugin_shell::{process::CommandChild, ShellExt};

/// Must match API_BASE in frontend/src/services/api.js.
const BACKEND_PORT: &str = "17890";

struct Backend(Mutex<Option<CommandChild>>);

fn main() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let data_dir = app.path().app_data_dir()?;
            let download_dir = app
                .path()
                .download_dir()
                .unwrap_or_else(|_| data_dir.clone())
                .join("Download Manager");
            std::fs::create_dir_all(&data_dir)?;
            std::fs::create_dir_all(&download_dir)?;

            let (_rx, child) = app
                .shell()
                .sidecar("dm-backend")?
                .env("PORT", BACKEND_PORT)
                .env("DATA_DIR", &data_dir)
                .env("DOWNLOAD_PATH", &download_dir)
                .current_dir(&data_dir)
                .spawn()?;
            app.manage(Backend(Mutex::new(Some(child))));
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|handle, event| {
        if let RunEvent::Exit = event {
            if let Some(child) = handle.state::<Backend>().0.lock().unwrap().take() {
                let _ = child.kill();
            }
        }
    });
}
