# Chunked RAD LOD Export — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add chunked `.rad` LOD as an archive export format, enabling streaming splat delivery in the kiosk viewer.

**Architecture:** A Rust WASM crate (`rad-encoder`) compiles `spark-lib`'s LOD + RAD encoding pipeline to run in a Web Worker at export time. Chunks are stored as separate files in the ZIP archive. A new meta-server endpoint serves individual chunks by UUID, and the kiosk viewer passes the URL to Spark's `SplatMesh` for on-demand streaming.

**Tech Stack:** Rust/wasm-pack (encoder), TypeScript (integration), Node.js (meta-server), Spark.js 2.0 (renderer)

**Design doc:** [2026-03-14-chunked-rad-lod-export-design.md](docs/plans/2026-03-14-chunked-rad-lod-export-design.md)

---

## Task 0: Scaffold the WASM RAD Encoder Crate

**Files:**
- Create: `src/wasm/rad-encoder/Cargo.toml`
- Create: `src/wasm/rad-encoder/src/lib.rs`
- Create: `src/wasm/rad-encoder/build.sh`

**Step 1: Create directory structure**

```bash
mkdir -p src/wasm/rad-encoder/src
```

**Step 2: Write Cargo.toml**

Create `src/wasm/rad-encoder/Cargo.toml`:

```toml
[package]
name = "rad-encoder"
version = "0.1.0"
edition = "2021"
rust-version = "1.82"

[lib]
crate-type = ["cdylib"]

[dependencies]
spark-lib = { git = "https://github.com/sparkjsdev/spark", tag = "v2.0.0-preview" }
wasm-bindgen = "0.2.100"
serde-wasm-bindgen = "0.6.5"
serde_json = "1"
js-sys = "0.3.77"
console_error_panic_hook = "0.1"

[profile.release]
opt-level = 3
lto = "fat"
codegen-units = 1
```

**Step 3: Write lib.rs with encode_rad_chunked**

Create `src/wasm/rad-encoder/src/lib.rs`. This is the glue that chains spark-lib's decode → LOD → chunk → RAD encode pipeline:

```rust
use wasm_bindgen::prelude::*;
use js_sys::{Array, Object, Uint8Array};

#[wasm_bindgen(start)]
pub fn init() {
    console_error_panic_hook::set_once();
}

/// Encode splat file bytes into chunked RAD format with pre-built LOD tree.
///
/// # Arguments
/// * `file_bytes` - Raw bytes of .ply, .spz, .splat, or .ksplat file
/// * `file_type` - One of "ply", "spz", "splat", "ksplat"
/// * `chunk_size` - Splats per chunk (default 65536)
/// * `lod_method` - "quality" (bhatt) or "tiny" (default "quality")
/// * `lod_base` - LOD base parameter (default 1.75 for quality, 1.5 for tiny)
/// * `max_sh` - Max spherical harmonics degree 0-3 (default 3)
///
/// # Returns
/// JsValue containing { meta: {...}, chunks: [{index, bytes}] }
#[wasm_bindgen]
pub fn encode_rad_chunked(
    file_bytes: &[u8],
    file_type: &str,
    chunk_size: Option<u32>,
    lod_method: Option<String>,
    lod_base: Option<f32>,
    max_sh: Option<u8>,
) -> Result<JsValue, JsValue> {
    let chunk_size = chunk_size.unwrap_or(65536) as usize;
    let method = lod_method.unwrap_or_else(|| "quality".to_string());
    let max_sh = max_sh.unwrap_or(3) as usize;

    let default_base = if method == "quality" { 1.75 } else { 1.5 };
    let base = lod_base.unwrap_or(default_base);

    // 1. Decode input to CsplatArray
    // Uses spark-lib's MultiDecoder to handle any supported format
    use spark_lib::decoder::MultiDecoder;
    use spark_lib::csplat::CsplatArray;
    use spark_lib::tsplat::TsplatArray;

    let file_type_enum = match file_type {
        "ply" => spark_lib::decoder::SplatFileType::Ply,
        "spz" => spark_lib::decoder::SplatFileType::Spz,
        "splat" => spark_lib::decoder::SplatFileType::AntiSplat,
        "ksplat" => spark_lib::decoder::SplatFileType::Ksplat,
        _ => return Err(JsValue::from_str(&format!("Unsupported file type: {}", file_type))),
    };

    let mut decoder = MultiDecoder::<CsplatArray>::new(file_type_enum, None);
    decoder.receive_chunks(file_bytes);
    let mut splats = decoder.finish()
        .map_err(|e| JsValue::from_str(&format!("Decode failed: {}", e)))?;

    // Clamp SH degree
    if max_sh < splats.sh_degree() {
        splats.set_max_sh(max_sh);
    }

    let initial_count = splats.len();

    // 2. Build LOD tree
    let root = 0;
    if method == "quality" {
        let base = base.max(1.1).min(2.0);
        spark_lib::bhatt_lod::compute_lod_tree(&mut splats, root, base);
    } else {
        let base = base.max(1.1).min(2.0);
        spark_lib::tiny_lod::compute_lod_tree(&mut splats, root, base, false);
    }

    // 3. Chunk the tree
    spark_lib::chunk_tree::chunk_tree(&mut splats, root, |_| {});

    // 4. RAD encode each chunk
    // Build RadMeta and encode with chunked output
    use spark_lib::rad::{RadEncoder, RadMeta};

    let encoder = RadEncoder::new(&splats, chunk_size);
    let chunks = encoder.encode_chunked()
        .map_err(|e| JsValue::from_str(&format!("RAD encode failed: {}", e)))?;

    // 5. Build JS result
    let result = Object::new();
    let js_chunks = Array::new();

    for (i, (chunk_meta, chunk_bytes)) in chunks.iter().enumerate() {
        let chunk_obj = Object::new();
        js_sys::Reflect::set(&chunk_obj, &"index".into(), &(i as u32).into())?;

        let bytes = Uint8Array::new_with_length(chunk_bytes.len() as u32);
        bytes.copy_from(chunk_bytes);
        js_sys::Reflect::set(&chunk_obj, &"bytes".into(), &bytes)?;

        js_chunks.push(&chunk_obj);
    }

    let meta = Object::new();
    js_sys::Reflect::set(&meta, &"version".into(), &1u32.into())?;
    js_sys::Reflect::set(&meta, &"count".into(), &(splats.len() as u32).into())?;
    js_sys::Reflect::set(&meta, &"initialCount".into(), &(initial_count as u32).into())?;
    js_sys::Reflect::set(&meta, &"maxSh".into(), &(max_sh as u32).into())?;
    js_sys::Reflect::set(&meta, &"chunkCount".into(), &(chunks.len() as u32).into())?;
    js_sys::Reflect::set(&meta, &"chunkSize".into(), &(chunk_size as u32).into())?;
    js_sys::Reflect::set(&meta, &"lodMethod".into(), &method.into())?;

    js_sys::Reflect::set(&result, &"meta".into(), &meta)?;
    js_sys::Reflect::set(&result, &"chunks".into(), &js_chunks)?;

    Ok(result.into())
}
```

> **Note:** The exact `spark-lib` API (struct names, method signatures) must be verified against the actual Rust source at build time. The `build-lod/src/main.rs` reference implementation shows the correct calling pattern. If `spark-lib` doesn't expose types cleanly for the `rad` encoder, the glue may need to construct the RadEncoder differently. This is the highest-risk task — if `spark-lib`'s `zip` or `image` dependencies block WASM compilation, you'll need to feature-gate them or vendor just the needed modules.

**Step 4: Write build script**

Create `src/wasm/rad-encoder/build.sh`:

```bash
#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"
wasm-pack build --target web --release --out-dir pkg
echo "WASM build complete: pkg/"
```

```bash
chmod +x src/wasm/rad-encoder/build.sh
```

**Step 5: Attempt first WASM build**

```bash
cd src/wasm/rad-encoder && ./build.sh
```

Expected: Either succeeds (producing `pkg/` with `.wasm` + JS glue), or fails with specific dependency errors that need resolution. Document any failures and fix them before proceeding.

**Step 6: Commit**

```bash
git add src/wasm/rad-encoder/
git commit -m "feat(rad): scaffold WASM rad-encoder crate with spark-lib dependency"
```

---

## Task 1: Resolve WASM Compilation Issues

**Files:**
- Modify: `src/wasm/rad-encoder/Cargo.toml` (add feature gates if needed)
- Modify: `src/wasm/rad-encoder/src/lib.rs` (adjust API calls to match actual spark-lib)

**Step 1: Analyze build errors from Task 0**

If the build failed, the errors will typically be:
- `zip` crate using `std::fs` → needs feature-gating
- `image` crate pulling in platform-specific codecs → needs feature-gating
- Missing trait implementations for WASM target

**Step 2: Try feature-gating problematic deps**

Add to `Cargo.toml`:
```toml
[dependencies.spark-lib]
git = "https://github.com/sparkjsdev/spark"
tag = "v2.0.0-preview"
default-features = false
```

If `spark-lib` doesn't support `default-features = false`, you may need to:
1. Fork `spark-lib` and add feature gates for `zip`/`image`
2. Or vendor only the needed source files (`decoder.rs`, `bhatt_lod.rs`, `chunk_tree.rs`, `rad.rs`, `csplat.rs`, `tsplat.rs`, `splat_encode.rs`)

**Step 3: Verify lib.rs matches actual spark-lib API**

Read the actual Rust sources (fetched by cargo) to verify struct/method names:
```bash
ls ~/.cargo/git/checkouts/spark-*/*/spark-lib/src/
cat ~/.cargo/git/checkouts/spark-*/*/spark-lib/src/rad.rs | head -100
cat ~/.cargo/git/checkouts/spark-*/*/spark-lib/src/bhatt_lod.rs | head -50
```

Adjust `lib.rs` to match the real API signatures.

**Step 4: Successful build**

```bash
cd src/wasm/rad-encoder && ./build.sh
ls -la pkg/
```

Expected: `pkg/rad_encoder_bg.wasm`, `pkg/rad_encoder.js`, `pkg/rad_encoder.d.ts`

**Step 5: Commit**

```bash
git add src/wasm/rad-encoder/
git commit -m "fix(rad): resolve WASM compilation issues for spark-lib"
```

---

## Task 2: Verify WASM Encoder with Test Script

**Files:**
- Create: `src/wasm/rad-encoder/test.html` (manual browser test)

**Step 1: Create a minimal test page**

Create `src/wasm/rad-encoder/test.html`:

```html
<!DOCTYPE html>
<html>
<head><title>RAD Encoder Test</title></head>
<body>
<h1>RAD Encoder WASM Test</h1>
<input type="file" id="input" accept=".ply,.splat,.spz,.ksplat" />
<pre id="output"></pre>
<script type="module">
import init, { encode_rad_chunked } from './pkg/rad_encoder.js';

const output = document.getElementById('output');

document.getElementById('input').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    output.textContent = 'Initializing WASM...';
    await init();

    output.textContent = 'Reading file...';
    const bytes = new Uint8Array(await file.arrayBuffer());
    const ext = file.name.split('.').pop().toLowerCase();

    output.textContent = `Encoding ${bytes.length} bytes as ${ext}...`;
    const start = performance.now();

    try {
        const result = encode_rad_chunked(bytes, ext);
        const elapsed = (performance.now() - start).toFixed(0);
        output.textContent = JSON.stringify({
            elapsed: `${elapsed}ms`,
            meta: result.meta,
            chunks: result.chunks.map(c => ({
                index: c.index,
                bytes: c.bytes.length
            }))
        }, null, 2);
    } catch (err) {
        output.textContent = `Error: ${err}`;
    }
});
</script>
</body>
</html>
```

**Step 2: Serve and test**

```bash
cd src/wasm/rad-encoder && python3 -m http.server 8090
```

Open `http://localhost:8090/test.html`, load a `.ply` file, verify chunks are produced.

**Step 3: Commit**

```bash
git add src/wasm/rad-encoder/test.html
git commit -m "test(rad): add manual browser test for WASM encoder"
```

---

## Task 3: Update AppState Type — Replace splatLodEnabled with splatLodFormat

**Files:**
- Modify: `src/types.ts:155`
- Modify: `src/main.ts:333`
- Modify: `src/main.ts:1220-1224`
- Modify: `src/modules/export-controller.ts:338-360`

**Step 1: Update the type definition**

In `src/types.ts:155`, change:
```typescript
// OLD
splatLodEnabled: boolean;             // "Generate Splat LOD at archive export" checkbox
// NEW
splatLodFormat: 'rad' | 'spz' | 'none';  // Splat LOD format: rad (chunked streaming), spz (single file), none (disabled)
```

**Step 2: Update state initialization**

In `src/main.ts:333`, change:
```typescript
// OLD
splatLodEnabled: true,
// NEW
splatLodFormat: 'rad',
```

**Step 3: Update the checkbox wiring**

In `src/main.ts:1220-1224`, replace the checkbox handler with radio group handler:
```typescript
// OLD
const splatLodCheckbox = document.getElementById('chk-splat-lod') as HTMLInputElement | null;
if (splatLodCheckbox) {
    splatLodCheckbox.checked = state.splatLodEnabled;
    splatLodCheckbox.addEventListener('change', () => {
        state.splatLodEnabled = splatLodCheckbox.checked;
    });
}

// NEW
const splatLodRadios = document.querySelectorAll<HTMLInputElement>('input[name="splat-lod-format"]');
splatLodRadios.forEach(radio => {
    if (radio.value === state.splatLodFormat) radio.checked = true;
    radio.addEventListener('change', () => {
        state.splatLodFormat = radio.value as 'rad' | 'spz' | 'none';
    });
});
```

**Step 4: Update export-controller.ts references**

In `src/modules/export-controller.ts`, replace all `state.splatLodEnabled` checks (lines 338, 357, 359):

```typescript
// Line 338 — OLD
if (state.splatLodEnabled && lodCompatible && splatExt !== 'spz') {
// NEW
if (state.splatLodFormat === 'spz' && lodCompatible && splatExt !== 'spz') {

// Line 357 — OLD
} else if (state.splatLodEnabled && splatExt === 'spz') {
// NEW
} else if (state.splatLodFormat === 'spz' && splatExt === 'spz') {

// Line 359 — OLD
} else if (state.splatLodEnabled && !lodCompatible) {
// NEW
} else if (state.splatLodFormat !== 'none' && !lodCompatible) {
```

**Step 5: Build to verify no type errors**

```bash
npm run build
```

Expected: Clean build, no TypeScript errors.

**Step 6: Commit**

```bash
git add src/types.ts src/main.ts src/modules/export-controller.ts
git commit -m "refactor(state): replace splatLodEnabled with splatLodFormat enum"
```

---

## Task 4: Update Editor HTML — Radio Button Group

**Files:**
- Modify: `src/editor/index.html:1472-1475`

**Step 1: Replace checkbox with radio group**

In `src/editor/index.html`, replace lines 1472-1475:

```html
<!-- OLD -->
<input type="checkbox" id="chk-splat-lod" checked style="margin-top: 2px;" />
<span>Generate Splat LOD at archive export</span>
</label>
<span class="prop-hint" style="font-size: 9px; margin-left: 18px; display: block;">Requires .spz or .ply input. .sog files use runtime LOD instead.</span>

<!-- NEW -->
<div style="margin-top: 2px;">
    <span style="font-size: 10px; font-weight: 500;">Splat LOD Format</span>
    <div style="margin-top: 2px; margin-left: 2px;">
        <label style="display: block; font-size: 10px; cursor: pointer; margin-bottom: 2px;">
            <input type="radio" name="splat-lod-format" value="rad" checked style="margin-top: 1px;" />
            Chunked RAD <span class="prop-hint">(streaming LOD — recommended)</span>
        </label>
        <label style="display: block; font-size: 10px; cursor: pointer; margin-bottom: 2px;">
            <input type="radio" name="splat-lod-format" value="spz" style="margin-top: 1px;" />
            SPZ <span class="prop-hint">(single file LOD)</span>
        </label>
        <label style="display: block; font-size: 10px; cursor: pointer;">
            <input type="radio" name="splat-lod-format" value="none" style="margin-top: 1px;" />
            None <span class="prop-hint">(original format, no LOD preprocessing)</span>
        </label>
    </div>
    <span class="prop-hint" style="font-size: 9px; margin-left: 2px; display: block;">
        Requires .ply, .splat, or .ksplat input. .sog files use runtime LOD.
    </span>
</div>
```

**Step 2: Build and visually verify**

```bash
npm run dev
```

Open `http://localhost:8080/editor/`, load a splat, check the Optimization section shows radio buttons.

**Step 3: Commit**

```bash
git add src/editor/index.html
git commit -m "feat(ui): replace LOD checkbox with rad/spz/none radio group"
```

---

## Task 5: Create RAD Transcode Web Worker

**Files:**
- Create: `src/modules/workers/transcode-rad.worker.ts`

**Step 1: Write the worker**

Create `src/modules/workers/transcode-rad.worker.ts`:

```typescript
/**
 * Web Worker for RAD chunked LOD encoding — offloads CPU-heavy
 * LOD tree construction and RAD encoding off the main thread.
 */
import init, { encode_rad_chunked } from '../../wasm/rad-encoder/pkg/rad_encoder.js';

export interface RadTranscodeRequest {
    fileBytes: Uint8Array;
    fileType: string;
    chunkSize?: number;
    lodMethod?: 'tiny' | 'quality';
    lodBase?: number;
    maxSh?: number;
}

export interface RadChunkResult {
    index: number;
    bytes: Uint8Array;
}

export interface RadTranscodeResponse {
    success: true;
    meta: {
        version: number;
        count: number;
        initialCount: number;
        maxSh: number;
        chunkCount: number;
        chunkSize: number;
        lodMethod: string;
    };
    chunks: RadChunkResult[];
}

export interface RadTranscodeError {
    success: false;
    error: string;
}

let wasmInitialized = false;

self.onmessage = async (e: MessageEvent<RadTranscodeRequest>) => {
    try {
        if (!wasmInitialized) {
            await init();
            wasmInitialized = true;
        }

        const { fileBytes, fileType, chunkSize, lodMethod, lodBase, maxSh } = e.data;

        const result = encode_rad_chunked(
            fileBytes,
            fileType,
            chunkSize ?? undefined,
            lodMethod ?? undefined,
            lodBase ?? undefined,
            maxSh ?? undefined,
        );

        const response: RadTranscodeResponse = {
            success: true,
            meta: result.meta,
            chunks: result.chunks,
        };

        // Transfer chunk buffers to avoid copying
        const transfers = response.chunks
            .map(c => c.bytes.buffer)
            .filter((b): b is ArrayBuffer => b instanceof ArrayBuffer);

        self.postMessage(response, { transfer: transfers } as any);
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        self.postMessage({ success: false, error: message } satisfies RadTranscodeError);
    }
};
```

**Step 2: Build to verify imports resolve**

```bash
npm run build
```

Note: This may fail if the WASM pkg isn't properly set up yet. The worker import path (`../../wasm/rad-encoder/pkg/rad_encoder.js`) must match the actual output location.

**Step 3: Commit**

```bash
git add src/modules/workers/transcode-rad.worker.ts
git commit -m "feat(rad): add Web Worker for RAD chunked LOD encoding"
```

---

## Task 6: Add RAD Export Path to export-controller.ts

**Files:**
- Modify: `src/modules/export-controller.ts:26-47` (add transcodeRadInWorker)
- Modify: `src/modules/export-controller.ts:332-370` (add RAD branch)

**Step 1: Add transcodeRadInWorker function**

In `src/modules/export-controller.ts`, after the existing `transcodeSpzInWorker` function (line ~47), add:

```typescript
import type { RadTranscodeResponse, RadTranscodeError } from './workers/transcode-rad.worker.js';

/**
 * Run RAD chunked LOD encoding in a Web Worker.
 * Returns chunk metadata and individual chunk byte arrays.
 */
function transcodeRadInWorker(
    fileBytes: Uint8Array,
    fileType: string,
    options?: { chunkSize?: number; lodMethod?: 'tiny' | 'quality'; maxSh?: number }
): Promise<RadTranscodeResponse> {
    return new Promise((resolve, reject) => {
        const worker = new Worker(
            new URL('./workers/transcode-rad.worker.ts', import.meta.url),
            { type: 'module' },
        );
        worker.onmessage = (e: MessageEvent<RadTranscodeResponse | RadTranscodeError>) => {
            worker.terminate();
            if (e.data.success === true) {
                resolve(e.data as RadTranscodeResponse);
            } else {
                reject(new Error((e.data as RadTranscodeError).error));
            }
        };
        worker.onerror = (e) => {
            worker.terminate();
            reject(new Error(`Worker error: ${e.message}`));
        };
        worker.postMessage(
            { fileBytes, fileType, ...options },
            { transfer: [fileBytes.buffer] },
        );
    });
}
```

**Step 2: Add RAD branch in the LOD section**

In `src/modules/export-controller.ts`, the splat LOD section (around line 332-370). Add a new branch BEFORE the SPZ branch:

```typescript
// Export-time LOD: RAD chunked format
if (state.splatLodFormat === 'rad' && lodCompatible && splatExt !== 'rad') {
    try {
        log.info('Generating chunked RAD LOD for archive export...');
        deps.ui.showLoading('Generating chunked RAD LOD...', true);

        const fileBytes = new Uint8Array(await assets.splatBlob.arrayBuffer());
        const radResult = await transcodeRadInWorker(fileBytes, splatExt);

        log.info(`RAD LOD generated: ${radResult.meta.chunkCount} chunks, ${radResult.meta.count} splats`);

        // Add chunks to archive instead of single blob
        const baseName = fileName.replace(/\.[^.]+$/, '');
        archiveCreator.addSceneChunked(radResult.chunks, baseName, radResult.meta, {
            position, rotation, scale,
            created_by: metadata.splatMetadata.createdBy || 'unknown',
            created_by_version: metadata.splatMetadata.version || '',
            source_notes: metadata.splatMetadata.sourceNotes || '',
            role: metadata.splatMetadata.role || ''
        });

        // Skip the normal addScene below
        splatBlobToArchive = null;
    } catch (radError: unknown) {
        const message = radError instanceof Error ? radError.message : String(radError);
        log.warn('RAD LOD generation failed, falling back to original file:', message);
        notify.warning('RAD LOD generation failed — exporting original file.');
    } finally {
        deps.ui.hideLoading();
    }
}
```

The existing SPZ branch remains but is gated by `state.splatLodFormat === 'spz'`.

After both branches, skip `addScene` if chunks were already added:

```typescript
// Only add as single scene if RAD chunked wasn't used
if (splatBlobToArchive) {
    archiveCreator.addScene(splatBlobToArchive, archiveFileName, { ... });
}
```

**Step 3: Build**

```bash
npm run build
```

**Step 4: Commit**

```bash
git add src/modules/export-controller.ts
git commit -m "feat(rad): add RAD chunked LOD export path in export controller"
```

---

## Task 7: Add addSceneChunked to archive-creator.ts

**Files:**
- Modify: `src/modules/archive-creator.ts` (after `addScene` method, around line 1263)

**Step 1: Add the ChunkedLodMeta type and addSceneChunked method**

After the existing `addScene` method in `archive-creator.ts`:

```typescript
interface ChunkedLodMeta {
    version: number;
    count: number;
    initialCount: number;
    maxSh: number;
    chunkCount: number;
    chunkSize: number;
    lodMethod: string;
}

/**
 * Add a splat scene as multiple chunked RAD files with LOD metadata.
 * Each chunk becomes a separate file in the archive: assets/{baseName}-lod-{N}.rad
 * The manifest entry includes chunked_lod metadata for the kiosk loader.
 */
addSceneChunked(
    chunks: Array<{ index: number; bytes: Uint8Array }>,
    baseName: string,
    meta: ChunkedLodMeta,
    options: AddAssetOptions = {}
): string {
    const index = this._countEntriesOfType('scene_');
    const entryKey = `scene_${index}`;

    // Build chunk file list
    const chunkFiles: Array<{ file_name: string; index: number; bytes: number }> = [];

    for (const chunk of chunks) {
        const chunkFileName = `assets/${baseName}-lod-${chunk.index}.rad`;
        const blob = new Blob([chunk.bytes], { type: 'application/octet-stream' });

        // Store each chunk as a separate file in the archive
        this._addRawFile(chunkFileName, blob);

        chunkFiles.push({
            file_name: chunkFileName,
            index: chunk.index,
            bytes: chunk.bytes.length,
        });
    }

    // Root chunk is file_name for backward compat (older viewers load chunk 0)
    const rootFileName = chunkFiles[0]?.file_name || `assets/${baseName}-lod-0.rad`;

    // Create manifest entry
    this._addManifestEntry(entryKey, {
        file_name: rootFileName,
        type: 'scene',
        format: 'rad',
        transform: {
            position: options.position || [0, 0, 0],
            rotation: options.rotation || [0, 0, 0],
            scale: options.scale || 1,
        },
        created_by: options.created_by || 'unknown',
        created_by_version: options.created_by_version || '',
        source_notes: options.source_notes || '',
        role: options.role || '',
        chunked_lod: {
            chunk_count: meta.chunkCount,
            total_splats: meta.count,
            chunk_size: meta.chunkSize,
            lod_method: meta.lodMethod,
            max_sh: meta.maxSh,
            chunks: chunkFiles,
        },
    });

    return entryKey;
}
```

> **Note:** This assumes `archive-creator.ts` has internal methods `_addRawFile` and `_addManifestEntry` or equivalent. Check the actual implementation — if files are stored via a different pattern (e.g., `this.files` Map), adapt accordingly. The existing `addScene` method shows the pattern.

**Step 2: Build**

```bash
npm run build
```

**Step 3: Commit**

```bash
git add src/modules/archive-creator.ts
git commit -m "feat(rad): add addSceneChunked method to archive creator"
```

---

## Task 8: Meta-Server Asset Proxy Endpoint

**Files:**
- Modify: `docker/meta-server.js` (add endpoint + route, near line 3255)

**Step 1: Add ZIP file extraction helper**

Add near the top of `meta-server.js` (after existing requires):

```javascript
const zlib = require('zlib');

/**
 * Parse a ZIP central directory and return a Map of filename → { offset, size, method }.
 * Only reads the last ~64KB of the file to find the End of Central Directory record.
 */
function parseZipCentralDirectory(filePath) {
    const fd = fs.openSync(filePath, 'r');
    const stat = fs.fstatSync(fd);
    const fileSize = stat.size;

    // Read last 64KB to find EOCD
    const tailSize = Math.min(65536, fileSize);
    const tail = Buffer.alloc(tailSize);
    fs.readSync(fd, tail, 0, tailSize, fileSize - tailSize);

    // Find EOCD signature (0x06054b50)
    let eocdPos = -1;
    for (let i = tailSize - 22; i >= 0; i--) {
        if (tail.readUInt32LE(i) === 0x06054b50) {
            eocdPos = i;
            break;
        }
    }
    if (eocdPos === -1) {
        fs.closeSync(fd);
        throw new Error('Not a valid ZIP file');
    }

    let cdOffset = tail.readUInt32LE(eocdPos + 16);
    let cdSize = tail.readUInt32LE(eocdPos + 12);

    // Check for ZIP64
    if (cdOffset === 0xFFFFFFFF || cdSize === 0xFFFFFFFF) {
        // ZIP64 EOCD locator is 20 bytes before EOCD
        const locPos = eocdPos - 20;
        if (locPos >= 0 && tail.readUInt32LE(locPos) === 0x07064b50) {
            const z64Offset = Number(tail.readBigUInt64LE(locPos + 8));
            const z64Buf = Buffer.alloc(56);
            fs.readSync(fd, z64Buf, 0, 56, z64Offset);
            cdSize = Number(z64Buf.readBigUInt64LE(40));
            cdOffset = Number(z64Buf.readBigUInt64LE(48));
        }
    }

    // Read central directory
    const cd = Buffer.alloc(cdSize);
    fs.readSync(fd, cd, 0, cdSize, cdOffset);
    fs.closeSync(fd);

    const entries = new Map();
    let pos = 0;
    while (pos < cdSize) {
        if (cd.readUInt32LE(pos) !== 0x02014b50) break;
        const method = cd.readUInt16LE(pos + 10);
        const compSize = cd.readUInt32LE(pos + 20);
        const nameLen = cd.readUInt16LE(pos + 28);
        const extraLen = cd.readUInt16LE(pos + 30);
        const commentLen = cd.readUInt16LE(pos + 32);
        let localOffset = cd.readUInt32LE(pos + 42);

        const name = cd.slice(pos + 46, pos + 46 + nameLen).toString('utf8');

        // ZIP64 extended info
        if (localOffset === 0xFFFFFFFF || compSize === 0xFFFFFFFF) {
            let ePos = pos + 46 + nameLen;
            const eEnd = ePos + extraLen;
            while (ePos < eEnd) {
                const id = cd.readUInt16LE(ePos);
                const sz = cd.readUInt16LE(ePos + 2);
                if (id === 0x0001) {
                    let off = 4;
                    // Fields appear in order: uncompressed, compressed, localOffset
                    if (compSize === 0xFFFFFFFF) off += 8; // skip uncompressed
                    if (compSize === 0xFFFFFFFF) off += 8; // skip compressed
                    if (localOffset === 0xFFFFFFFF) {
                        localOffset = Number(cd.readBigUInt64LE(ePos + off));
                    }
                    break;
                }
                ePos += 4 + sz;
            }
        }

        entries.set(name, { offset: localOffset, size: compSize, method });
        pos += 46 + nameLen + extraLen + commentLen;
    }

    return entries;
}

// Cache parsed ZIP directories (invalidated when file mtime changes)
const zipDirCache = new Map();

function getCachedZipDir(filePath) {
    const stat = fs.statSync(filePath);
    const key = filePath + ':' + stat.mtimeMs;
    if (zipDirCache.has(key)) return zipDirCache.get(key);
    const dir = parseZipCentralDirectory(filePath);
    zipDirCache.set(key, dir);
    return dir;
}
```

**Step 2: Add the endpoint handler**

```javascript
/**
 * GET /api/asset/{uuid}/{filename} — serve individual files from a ZIP archive.
 * Used by Spark.js SplatMesh to stream chunked RAD LOD on demand.
 */
function handleAssetProxy(req, res, uuid, filename) {
    // Sanitize filename — prevent path traversal
    if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
        res.writeHead(400, { 'Content-Type': 'text/plain' });
        res.end('Invalid filename');
        return;
    }

    const row = db.prepare('SELECT * FROM archives WHERE uuid = ?').get(uuid);
    if (!row) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Archive not found');
        return;
    }

    const filePath = path.join(ARCHIVES_DIR, row.filename);
    if (!fs.existsSync(filePath)) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Archive file not found');
        return;
    }

    let zipDir;
    try {
        zipDir = getCachedZipDir(filePath);
    } catch (e) {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('Failed to parse archive');
        return;
    }

    const entryName = 'assets/' + filename;
    const entry = zipDir.get(entryName);
    if (!entry) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('File not found in archive');
        return;
    }

    // Only STORE (method 0) supported for direct streaming
    if (entry.method !== 0) {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('Compressed entries not supported');
        return;
    }

    // Read local file header to compute data offset
    const fd = fs.openSync(filePath, 'r');
    const localHeader = Buffer.alloc(30);
    fs.readSync(fd, localHeader, 0, 30, entry.offset);
    fs.closeSync(fd);

    if (localHeader.readUInt32LE(0) !== 0x04034b50) {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('Invalid local file header');
        return;
    }

    const localNameLen = localHeader.readUInt16LE(26);
    const localExtraLen = localHeader.readUInt16LE(28);
    const dataOffset = entry.offset + 30 + localNameLen + localExtraLen;

    // Stream the file bytes
    res.writeHead(200, {
        'Content-Type': 'application/octet-stream',
        'Content-Length': entry.size,
        'Cache-Control': 'public, max-age=31536000, immutable',
        'Access-Control-Allow-Origin': '*',
    });

    const stream = fs.createReadStream(filePath, {
        start: dataOffset,
        end: dataOffset + entry.size - 1,
    });
    stream.pipe(res);
}
```

**Step 3: Add the route**

In the HTTP server routing section (around line 3255), add BEFORE the archive-stream route:

```javascript
// Asset proxy endpoint (chunked RAD streaming)
const assetMatch = pathname.match(/^\/api\/asset\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/(.+)$/i);
if (assetMatch && req.method === 'GET') {
    return handleAssetProxy(req, res, assetMatch[1], assetMatch[2]);
}
```

**Step 4: Add to nginx proxy config**

Check `docker/nginx.conf` — the `/api/` prefix should already be proxied to meta-server. Verify:

```bash
grep -n '/api/' docker/nginx.conf
```

If `/api/asset/` isn't covered by an existing rule, add one.

**Step 5: Commit**

```bash
git add docker/meta-server.js
git commit -m "feat(server): add /api/asset/{uuid}/{filename} endpoint for chunked RAD streaming"
```

---

## Task 9: Kiosk Viewer — Chunked RAD Loading Path

**Files:**
- Modify: `src/modules/archive-pipeline.ts` (around line 361-403)
- Modify: `src/modules/kiosk-main.ts` (splat accepted formats)
- Modify: `src/modules/loaders/splat-loader.ts` (already has `.rad` support — verify)

**Step 1: Add .rad to supported archive formats**

In `src/modules/archive-loader.ts:30`, verify `.rad` is in the splat formats list:

```typescript
splat: ['.ply', '.spz', '.ksplat', '.sog', '.splat', '.rad'],
```

**Step 2: Detect chunked_lod in archive-pipeline.ts**

In `src/modules/archive-pipeline.ts`, in the splat loading section (around line 361), add a branch for chunked RAD before the existing blob extraction:

```typescript
const sceneEntry = archiveLoader.getSceneEntry();

// Check for chunked RAD — stream via meta-server proxy instead of blob extraction
if (sceneEntry?.chunked_lod && state.archiveUrl) {
    // Extract UUID from the archive URL (e.g., /view/{uuid} or /api/archive-stream/{hash})
    const uuidMatch = state.archiveUrl.match(
        /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i
    );

    if (uuidMatch) {
        const uuid = uuidMatch[1];
        const rootChunk = sceneEntry.chunked_lod.chunks[0];
        const rootFileName = rootChunk.file_name.replace('assets/', '');
        const rootUrl = `/api/asset/${uuid}/${rootFileName}`;

        log.info(`Loading chunked RAD: ${sceneEntry.chunked_lod.chunk_count} chunks via ${rootUrl}`);

        // SplatMesh handles chunk streaming natively via URL resolution
        const splatMesh = await createSplatMesh(rootUrl, 'rad');

        // Apply transform from manifest
        const transform = archiveLoader.getEntryTransform(sceneEntry);
        if (transform) {
            // Apply position, rotation, scale from manifest
        }

        // Continue with normal post-load flow...
    } else {
        // Fallback: no UUID available (local file) — assemble monolithic RAD
        log.info('Chunked RAD: no server proxy available, assembling in memory');
        // Extract all chunks from archive, concatenate, create blob URL
        // (implementation deferred — local files are less common)
    }
}
```

> **Note:** The exact integration point depends on how `archive-pipeline.ts` is structured. Read the full splat loading flow and find where `loadSplatFromBlobUrl` is called — the chunked RAD path replaces this with `createSplatMesh(rootUrl, 'rad')`.

**Step 3: Update kiosk splat format list**

In `src/modules/kiosk-main.ts:259`, verify `.rad` is included:

```typescript
splat: ['.ply', '.splat', '.ksplat', '.spz', '.sog', '.rad'],
```

**Step 4: Build and test**

```bash
npm run build
```

**Step 5: Commit**

```bash
git add src/modules/archive-pipeline.ts src/modules/archive-loader.ts src/modules/kiosk-main.ts
git commit -m "feat(kiosk): add chunked RAD streaming loader via meta-server proxy"
```

---

## Task 10: End-to-End Integration Test

**Files:** None created — manual testing workflow

**Step 1: Build everything**

```bash
npm run build
```

**Step 2: Test export flow**

1. Open editor at `http://localhost:8080/editor/`
2. Load a `.ply` splat file
3. Verify the Optimization section shows the RAD/SPZ/None radio buttons
4. Select "Chunked RAD" (should be default)
5. Export as `.ddim`
6. Verify the export progress shows "Generating chunked RAD LOD..."
7. Inspect the resulting `.ddim` — unzip and verify:
   - `manifest.json` has `chunked_lod` field on `scene_0`
   - Multiple `assets/scene_0-lod-*.rad` files exist

**Step 3: Test kiosk loading**

1. Upload the exported `.ddim` to the Docker deployment
2. Open the kiosk view URL (`/view/{uuid}`)
3. Open browser DevTools Network tab
4. Verify:
   - Initial request fetches `scene_0-lod-0.rad` via `/api/asset/{uuid}/...`
   - Moving the camera triggers additional chunk fetches
   - Splat renders progressively (coarse → detailed)

**Step 4: Test backward compatibility**

1. Load an existing archive (with `.spz` LOD) in the kiosk — verify it still works
2. Export with "SPZ" selected — verify old flow still works
3. Export with "None" selected — verify original format preserved

**Step 5: Commit any fixes discovered during testing**

```bash
git add -A
git commit -m "fix(rad): integration fixes from end-to-end testing"
```

---

## Summary of All Files

### New files
| File | Purpose |
|------|---------|
| `src/wasm/rad-encoder/Cargo.toml` | WASM crate config |
| `src/wasm/rad-encoder/src/lib.rs` | Rust → WASM glue (decode → LOD → chunk → RAD) |
| `src/wasm/rad-encoder/build.sh` | Build script |
| `src/wasm/rad-encoder/test.html` | Manual browser test |
| `src/modules/workers/transcode-rad.worker.ts` | Web Worker for RAD encoding |

### Modified files
| File | Change |
|------|--------|
| `src/types.ts` | `splatLodEnabled: boolean` → `splatLodFormat: 'rad' \| 'spz' \| 'none'` |
| `src/main.ts` | State init + radio group wiring |
| `src/editor/index.html` | Replace checkbox with radio group |
| `src/modules/export-controller.ts` | Add `transcodeRadInWorker`, RAD export branch |
| `src/modules/archive-creator.ts` | Add `addSceneChunked` method |
| `src/modules/archive-loader.ts` | Add `.rad` to supported splat formats |
| `src/modules/archive-pipeline.ts` | Detect `chunked_lod`, construct proxy URL |
| `src/modules/kiosk-main.ts` | Add `.rad` to accepted formats |
| `docker/meta-server.js` | Add `/api/asset/{uuid}/{filename}` endpoint |

### Deferred
- VDIM scrambling for RAD chunks
- Editor RAD preview
- Local/Tauri fallback (monolithic RAD assembly)
