use std::collections::HashMap;
use std::fs::File;
use std::io::{Read, Seek, SeekFrom, Write};
use std::sync::Mutex;
use futures_util::StreamExt;
use tauri::{Emitter, Manager, State};
use uuid::Uuid;

// =============================================================================
// IPC FILE HANDLE STORE
// =============================================================================

struct FileHandle {
    file: File,
    #[allow(dead_code)]
    size: u64,
    /// Temp file path to clean up on close (used for Android content:// URI copies)
    temp_path: Option<String>,
}

#[derive(Default)]
struct FileHandleStore {
    handles: Mutex<HashMap<String, FileHandle>>,
}

/// Holds a file path passed via CLI on startup, to be injected into the webview
/// once the page finishes loading. Cleared after first use.
#[derive(Default)]
struct StartupFile(Mutex<Option<String>>);

// =============================================================================
// ANDROID CONTENT RESOLVER — read content:// URIs via JNI
// =============================================================================

/// On Android, copy a content:// URI to a temp file via ContentResolver,
/// then open the temp file as a regular file handle. This lets the existing
/// ipc_read_bytes/ipc_close_file commands work transparently.
#[cfg(target_os = "android")]
fn open_content_uri(uri: &str, store: &State<FileHandleStore>) -> Result<(String, u64), String> {
    use jni::objects::{JObject, JString, JValue};
    use std::io::Write;

    let ctx = ndk_context::android_context();
    let vm = unsafe { jni::JavaVM::from_raw(ctx.vm().cast()) }
        .map_err(|e| format!("JavaVM: {e}"))?;
    let mut env = vm.attach_current_thread()
        .map_err(|e| format!("JNI attach: {e}"))?;
    let activity = unsafe { JObject::from_raw(ctx.context().cast()) };

    // ContentResolver resolver = activity.getContentResolver();
    let resolver = env.call_method(&activity, "getContentResolver",
        "()Landroid/content/ContentResolver;", &[])
        .and_then(|v| v.l())
        .map_err(|e| format!("getContentResolver: {e}"))?;

    // Uri parsed = Uri.parse(uri);
    let uri_jstr = env.new_string(uri).map_err(|e| format!("new_string: {e}"))?;
    let uri_jobj: JObject = uri_jstr.into();
    let parsed_uri = env.call_static_method(
        "android/net/Uri", "parse",
        "(Ljava/lang/String;)Landroid/net/Uri;",
        &[JValue::Object(&uri_jobj)],
    )
        .and_then(|v| v.l())
        .map_err(|e| format!("Uri.parse: {e}"))?;

    // InputStream is = resolver.openInputStream(parsed);
    let input_stream = env.call_method(&resolver, "openInputStream",
        "(Landroid/net/Uri;)Ljava/io/InputStream;",
        &[JValue::Object(&parsed_uri)])
        .and_then(|v| v.l())
        .map_err(|e| format!("openInputStream: {e}"))?;

    if input_stream.is_null() {
        return Err("ContentResolver.openInputStream returned null".into());
    }

    // Get app cache dir for temp file
    let cache_dir = env.call_method(&activity, "getCacheDir",
        "()Ljava/io/File;", &[])
        .and_then(|v| v.l())
        .map_err(|e| format!("getCacheDir: {e}"))?;
    let cache_path_obj = env.call_method(&cache_dir, "getAbsolutePath",
        "()Ljava/lang/String;", &[])
        .and_then(|v| v.l())
        .map_err(|e| format!("getAbsolutePath: {e}"))?;
    let cache_path_jstring: JString = cache_path_obj.into();
    let cache_path: String = env.get_string(&cache_path_jstring)
        .map_err(|e| format!("get_string: {e}"))?
        .into();

    let temp_path = format!("{}/vitrine_import_{}", cache_path, Uuid::new_v4());

    // Copy InputStream → temp file using 64KB chunks
    let mut temp_file = File::create(&temp_path)
        .map_err(|e| format!("create temp file: {e}"))?;

    let jbuf = env.new_byte_array(65536)
        .map_err(|e| format!("new_byte_array: {e}"))?;

    loop {
        let n = env.call_method(&input_stream, "read", "([B)I",
            &[JValue::Object(&jbuf)])
            .and_then(|v| v.i())
            .map_err(|e| format!("InputStream.read: {e}"))?;
        if n <= 0 { break; }

        let mut chunk = vec![0i8; n as usize];
        env.get_byte_array_region(&jbuf, 0, &mut chunk)
            .map_err(|e| format!("get_byte_array_region: {e}"))?;

        // i8 → u8 (same bit pattern, safe transmute)
        let chunk_u8: &[u8] = unsafe {
            std::slice::from_raw_parts(chunk.as_ptr() as *const u8, chunk.len())
        };
        temp_file.write_all(chunk_u8)
            .map_err(|e| format!("write temp file: {e}"))?;
    }

    // Close InputStream (ignore errors — best effort)
    let _ = env.call_method(&input_stream, "close", "()V", &[]);
    drop(temp_file);

    // Open the temp file as a regular file handle
    let file = File::open(&temp_path)
        .map_err(|e| format!("open temp file: {e}"))?;
    let size = file.metadata().map_err(|e| e.to_string())?.len();
    let id = Uuid::new_v4().to_string();
    store.handles.lock().unwrap().insert(id.clone(), FileHandle {
        file,
        size,
        temp_path: Some(temp_path),
    });

    Ok((id, size))
}

// =============================================================================
// IPC COMMANDS — byte-level random access to files on disk
// =============================================================================

/// Open a file and return a handle ID + file size.
/// The handle stays open until ipc_close_file is called.
/// On Android, content:// URIs are transparently copied to a temp file first.
#[tauri::command]
fn ipc_open_file(path: String, store: State<FileHandleStore>) -> Result<(String, u64), String> {
    #[cfg(target_os = "android")]
    if path.starts_with("content://") {
        return open_content_uri(&path, &store);
    }

    let file = File::open(&path).map_err(|e| format!("Failed to open {}: {}", path, e))?;
    let size = file.metadata().map_err(|e| e.to_string())?.len();
    let id = Uuid::new_v4().to_string();
    store.handles.lock().unwrap().insert(id.clone(), FileHandle { file, size, temp_path: None });
    Ok((id, size))
}

/// Read `length` bytes starting at `offset` from an open file handle.
/// Returns raw bytes via tauri::ipc::Response to avoid JSON serialization
/// (Vec<u8> would be serialized as a JSON array of numbers, which for a 150MB
/// file means ~600MB of JSON text — enough to crash the webview).
/// If compiled with VITRINE_ARCHIVE_KEY, XOR-decodes the bytes on the fly.
#[tauri::command]
fn ipc_read_bytes(
    handle_id: String,
    offset: u64,
    length: u32,
    store: State<FileHandleStore>,
) -> Result<tauri::ipc::Response, String> {
    let mut handles = store.handles.lock().unwrap();
    let entry = handles
        .get_mut(&handle_id)
        .ok_or_else(|| format!("Invalid file handle: {}", handle_id))?;
    entry
        .file
        .seek(SeekFrom::Start(offset))
        .map_err(|e| e.to_string())?;
    let mut buf = vec![0u8; length as usize];
    entry.file.read_exact(&mut buf).map_err(|e| e.to_string())?;

    // XOR-decode if this binary was compiled with an archive encryption key
    if let Some(key_hex) = option_env!("VITRINE_ARCHIVE_KEY") {
        if let Ok(key) = hex::decode(key_hex) {
            let key_len = key.len();
            for (i, byte) in buf.iter_mut().enumerate() {
                *byte ^= key[(offset as usize + i) % key_len];
            }
        }
    }

    Ok(tauri::ipc::Response::new(buf))
}

/// Close an open file handle and release its resources.
/// If the handle was created from a content:// URI, the temp file is deleted.
#[tauri::command]
fn ipc_close_file(handle_id: String, store: State<FileHandleStore>) -> Result<(), String> {
    if let Some(handle) = store.handles.lock().unwrap().remove(&handle_id) {
        if let Some(ref path) = handle.temp_path {
            let _ = std::fs::remove_file(path);
        }
    }
    Ok(())
}

// =============================================================================
// PUBLIC API FETCH — bypasses CORS for public endpoints (no browser sandbox)
// =============================================================================

/// Fetch a public API URL from Rust, bypassing the webview's CORS restrictions.
/// Used by the collections browser to reach /api/collections without CF Access
/// intercepting the request as it would for a browser fetch from tauri.localhost.
#[tauri::command]
async fn api_fetch_json(url: String) -> Result<String, String> {
    reqwest::get(&url)
        .await
        .map_err(|e| e.to_string())?
        .text()
        .await
        .map_err(|e| e.to_string())
}

/// Download a remote URL to a temp file using Rust-side reqwest, bypassing
/// the webview's CORS / CF Access restrictions. Returns (handle_id, file_size)
/// registered in FileHandleStore — use with ipc_read_bytes / ipc_close_file.
/// The temp file is deleted automatically when ipc_close_file is called.
#[tauri::command]
async fn api_download_to_temp(url: String, store: State<'_, FileHandleStore>) -> Result<(String, u64), String> {
    let response = reqwest::get(&url)
        .await
        .map_err(|e| e.to_string())?;

    if !response.status().is_success() {
        return Err(format!("HTTP {}", response.status()));
    }

    let temp_path = std::env::temp_dir().join(format!("vitrine_{}.tmp", Uuid::new_v4()));
    let temp_path_str = temp_path.to_str().unwrap_or("").to_string();

    // Stream response body to disk in chunks to avoid buffering the entire
    // archive in RAM (archives can be hundreds of MB).
    {
        let mut f = File::create(&temp_path).map_err(|e| format!("create temp: {e}"))?;
        let mut stream = response.bytes_stream();
        while let Some(chunk) = stream.next().await {
            let chunk = chunk.map_err(|e| format!("download stream: {e}"))?;
            f.write_all(&chunk).map_err(|e| format!("write temp: {e}"))?;
        }
    }

    let file = File::open(&temp_path).map_err(|e| format!("open temp: {e}"))?;
    let size = file.metadata().map_err(|e| e.to_string())?.len();
    let id = Uuid::new_v4().to_string();
    store.handles.lock().unwrap().insert(id.clone(), FileHandle { file, size, temp_path: Some(temp_path_str) });

    Ok((id, size))
}

// =============================================================================
// APP ENTRY
// =============================================================================

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default()
        .manage(FileHandleStore::default())
        .manage(StartupFile::default())
        .invoke_handler(tauri::generate_handler![
            ipc_open_file,
            ipc_read_bytes,
            ipc_close_file,
            api_fetch_json,
            api_download_to_temp
        ]);

    // Single-instance plugin is desktop-only (not available on Android/iOS).
    // When a second instance is launched (e.g. via deep link or file association),
    // inject URLs/file paths directly into the webview via eval().
    #[cfg(desktop)]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_focus();
                for arg in &args {
                    if arg.starts_with("vitrine3d://") {
                        // Deep link URL
                        let _ = app.emit("deep-link-received", arg.clone());
                        let escaped = arg.replace('\\', "\\\\").replace('\"', "\\\"");
                        let js = format!(
                            concat!(
                                "try{{",
                                "var _dl=\"{0}\";",
                                "if(window.__vitrine3dDeepLink){{window.__vitrine3dDeepLink(_dl)}}",
                                "else{{window.dispatchEvent(new CustomEvent('vitrine3d:deep-link',{{detail:_dl}}))}}",
                                "}}catch(_e){{console.error('deep-link eval:',_e)}}"
                            ),
                            escaped
                        );
                        let _ = window.eval(&js);
                    } else if is_supported_file(arg) {
                        // File association — forward path to webview
                        let escaped = arg.replace('\\', "\\\\").replace('\"', "\\\"");
                        let js = format!(
                            concat!(
                                "try{{",
                                "window.dispatchEvent(new CustomEvent('vitrine3d:file-open',{{detail:\"{0}\"}}));",
                                "}}catch(_e){{console.error('file-open eval:',_e)}}"
                            ),
                            escaped
                        );
                        let _ = window.eval(&js);
                    }
                }
            }
        }));
    }

    builder
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_deep_link::init())
        // Inject the startup file path into the webview once the page is ready.
        // on_page_load is only available on plugin::Builder (not on WebviewWindow directly).
        .plugin(
            tauri::plugin::Builder::<_, ()>::new("startup-file")
                .on_page_load(|webview, payload| {
                    if matches!(payload.event(), tauri::webview::PageLoadEvent::Finished) {
                        let state = webview.app_handle().state::<StartupFile>();
                        let path = state.0.lock().unwrap().take();
                        if let Some(file_path) = path {
                            let escaped = file_path.replace('\\', "\\\\").replace('"', "\\\"");
                            let js = format!(
                                concat!(
                                    "try{{",
                                    "window.dispatchEvent(new CustomEvent('vitrine3d:file-open',{{detail:\"{0}\"}}));",
                                    "}}catch(_e){{console.error('file-open eval:',_e)}}"
                                ),
                                escaped
                            );
                            let _ = webview.eval(&js);
                        }
                    }
                })
                .build(),
        )
        .setup(|app| {
            // On first launch, check CLI args for file associations.
            // The OS passes the file path as a CLI argument when a .ddim/.a3d/.a3z
            // file is double-clicked.
            let args: Vec<String> = std::env::args().collect();
            let file_args: Vec<String> = args.iter()
                .skip(1) // skip executable path
                .filter(|a| is_supported_file(a))
                .cloned()
                .collect();

            if !file_args.is_empty() {
                // Store the path — the startup-file plugin's on_page_load will inject it
                // into the webview once the page finishes loading.
                *app.state::<StartupFile>().0.lock().unwrap() = Some(file_args[0].clone());
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

/// Check if a CLI argument looks like a supported file path.
/// Matches all file types the app can open: archives, splats, models, point clouds, CAD.
fn is_supported_file(path: &str) -> bool {
    let lower = path.to_lowercase();
    // Archives
    lower.ends_with(".ddim") || lower.ends_with(".a3d") || lower.ends_with(".a3z")
    // 3D models
    || lower.ends_with(".glb") || lower.ends_with(".gltf") || lower.ends_with(".obj") || lower.ends_with(".stl")
    // Gaussian splats
    || lower.ends_with(".ply") || lower.ends_with(".splat") || lower.ends_with(".ksplat")
    || lower.ends_with(".spz") || lower.ends_with(".sog")
    // Point clouds
    || lower.ends_with(".e57")
}
