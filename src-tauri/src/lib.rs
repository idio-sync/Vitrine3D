use std::collections::HashMap;
use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::sync::Mutex;
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
// APP ENTRY
// =============================================================================

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default()
        .manage(FileHandleStore::default())
        .invoke_handler(tauri::generate_handler![
            ipc_open_file,
            ipc_read_bytes,
            ipc_close_file
        ]);

    // Single-instance plugin is desktop-only (not available on Android/iOS).
    // When a second instance is launched (e.g. via deep link), forward any
    // vitrine3d:// URLs to the frontend so the auth flow completes.
    #[cfg(desktop)]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_focus();
            }
            // Forward deep link URLs from the second instance's CLI args
            for arg in &args {
                if arg.starts_with("vitrine3d://") {
                    let _ = app.emit("deep-link-received", arg.clone());
                }
            }
        }));
    }

    builder
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_deep_link::init())
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
