use tauri::Manager;
use std::path::PathBuf;
use std::fs;

// ─── File System Commands ─────────────────────────────────────────────────────

#[tauri::command]
fn read_file_bytes(path: String) -> Result<Vec<u8>, String> {
    fs::read(&path).map_err(|e| format!("Failed to read file: {}", e))
}

#[tauri::command]
fn write_file_bytes(path: String, data: Vec<u8>) -> Result<(), String> {
    if let Some(parent) = PathBuf::from(&path).parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create directory: {}", e))?;
    }
    fs::write(&path, data).map_err(|e| format!("Failed to write file: {}", e))
}

#[tauri::command]
fn file_exists(path: String) -> bool {
    PathBuf::from(&path).exists()
}

#[tauri::command]
fn delete_file(path: String) -> Result<(), String> {
    fs::remove_file(&path).map_err(|e| format!("Failed to delete file: {}", e))
}

#[tauri::command]
fn delete_directory(path: String) -> Result<(), String> {
    let p = PathBuf::from(&path);
    if !p.exists() { return Ok(()); }
    fs::remove_dir_all(&p).map_err(|e| format!("Failed to delete directory: {}", e))
}

#[tauri::command]
fn get_app_data_dir(app: tauri::AppHandle) -> Result<String, String> {
    app.path()
        .app_data_dir()
        .map(|p| p.to_string_lossy().to_string())
        .map_err(|e| format!("Failed to get app data dir: {}", e))
}

#[tauri::command]
fn copy_file_to_app_data(
    app: tauri::AppHandle,
    source_path: String,
    relative_dest: String,
) -> Result<String, String> {
    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;

    let dest = app_data.join(&relative_dest);

    if let Some(parent) = dest.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create directory: {}", e))?;
    }

    fs::copy(&source_path, &dest)
        .map_err(|e| format!("Failed to copy file: {}", e))?;

    Ok(dest.to_string_lossy().to_string())
}

// ─── API Key Storage via tauri-plugin-store ───────────────────────────────────

#[tauri::command]
async fn store_api_key(
    app: tauri::AppHandle,
    key_name: String,
    key_value: String,
) -> Result<(), String> {
    use tauri_plugin_store::StoreExt;

    let store = app
        .store("lumina-keys.json")
        .map_err(|e| format!("Failed to open store: {}", e))?;

    store.set(key_name, serde_json::Value::String(key_value));
    store.save().map_err(|e| format!("Failed to save store: {}", e))?;

    Ok(())
}

#[tauri::command]
async fn get_api_key(
    app: tauri::AppHandle,
    key_name: String,
) -> Result<Option<String>, String> {
    use tauri_plugin_store::StoreExt;

    let store = app
        .store("lumina-keys.json")
        .map_err(|e| format!("Failed to open store: {}", e))?;

    let value = store.get(&key_name);
    Ok(value.and_then(|v| v.as_str().map(|s| s.to_string())))
}

#[tauri::command]
async fn delete_api_key(
    app: tauri::AppHandle,
    key_name: String,
) -> Result<(), String> {
    use tauri_plugin_store::StoreExt;

    let store = app
        .store("lumina-keys.json")
        .map_err(|e| format!("Failed to open store: {}", e))?;

    store.delete(&key_name);
    store.save().map_err(|e| format!("Failed to save store: {}", e))?;

    Ok(())
}

// ─── App Entry ────────────────────────────────────────────────────────────────

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_sql::Builder::default().build())
        .invoke_handler(tauri::generate_handler![
            read_file_bytes,
            write_file_bytes,
            file_exists,
            delete_file,
            delete_directory,
            get_app_data_dir,
            copy_file_to_app_data,
            store_api_key,
            get_api_key,
            delete_api_key,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
