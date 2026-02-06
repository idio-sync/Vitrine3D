/**
 * Kiosk Viewer Generator
 *
 * Generates a lightweight offline HTML viewer packaged alongside a separate
 * .a3z archive. The export produces a ZIP containing:
 *   - viewer.html (~1MB) with all JS dependencies inlined as base64
 *   - data.a3z — the compressed 3D archive
 *
 * When served via HTTP, the viewer auto-loads data.a3z from the same directory.
 * When opened from file://, it shows a file picker to select the archive.
 *
 * Architecture:
 * - Dependencies are fetched from CDN at export time as ES module source text
 * - Sources are base64-encoded and embedded in the HTML
 * - At runtime, the viewer decodes sources, creates blob URLs, rewrites
 *   internal `from "three"` imports to use the Three.js blob URL, then
 *   dynamically imports everything — ensuring a single shared Three.js instance
 * - fflate is used to decompress the .a3z archive
 */

import { zip, strToU8 } from 'fflate';
import { Logger } from './utilities.js';

const log = Logger.getLogger('kiosk-viewer');

const ARCHIVE_FILENAME = 'data.a3z';

// CDN URLs for dependencies to fetch and inline.
// Three.js core uses ?bundle to produce a standalone module.
// Addons use ?external=three so their `from "three"` imports can be rewritten
// to point at the Three.js blob URL at runtime.
const CDN_DEPS = {
    three: 'https://esm.sh/three@0.170.0?bundle',
    threeGLTFLoader: 'https://esm.sh/three@0.170.0/examples/jsm/loaders/GLTFLoader.js?external=three',
    threeOBJLoader: 'https://esm.sh/three@0.170.0/examples/jsm/loaders/OBJLoader.js?external=three',
    threeOrbitControls: 'https://esm.sh/three@0.170.0/examples/jsm/controls/OrbitControls.js?external=three',
    spark: 'https://sparkjs.dev/releases/spark/0.1.10/spark.module.js',
    fflate: 'https://esm.sh/fflate@0.8.2?bundle'
};

/**
 * Fetch a CDN URL as text with one retry.
 */
async function fetchDep(url) {
    for (let attempt = 0; attempt < 2; attempt++) {
        try {
            const resp = await fetch(url);
            if (!resp.ok) throw new Error(`HTTP ${resp.status} for ${url}`);
            return await resp.text();
        } catch (err) {
            if (attempt === 1) throw err;
            await new Promise(r => setTimeout(r, 1000));
        }
    }
}

/**
 * Fetch all CDN dependencies and return as base64-encoded strings.
 * @param {Function} onProgress - Progress callback (message string)
 * @returns {Object} Map of dependency name -> base64-encoded source
 */
export async function fetchDependencies(onProgress) {
    const deps = {};
    const entries = Object.entries(CDN_DEPS);
    for (let i = 0; i < entries.length; i++) {
        const [name, url] = entries[i];
        if (onProgress) onProgress(`Fetching ${name} (${i + 1}/${entries.length})...`);
        log.info(`[Kiosk] Fetching ${name} from ${url}`);
        const src = await fetchDep(url);
        // Base64-encode to safely embed in HTML without escaping issues
        deps[name] = btoa(unescape(encodeURIComponent(src)));
        log.info(`[Kiosk] Fetched ${name}: ${(src.length / 1024).toFixed(1)} KB source -> ${(deps[name].length / 1024).toFixed(1)} KB base64`);
    }
    return deps;
}

/**
 * Generate the kiosk viewer HTML string.
 *
 * The viewer loads its 3D data from a separate archive file (data.a3z)
 * rather than self-reading a polyglot file.
 *
 * @param {Object} options
 * @param {Object} options.deps - Base64-encoded dependency sources (from fetchDependencies)
 * @param {Object} options.manifest - The archive manifest.json object
 * @param {string} options.title - Project title for the page
 * @returns {string} Complete HTML string for the kiosk viewer
 */
export function generateKioskHTML({ deps, manifest, title }) {
    const safeTitle = (title || 'Offline Viewer').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

    // Safely embed manifest JSON — escape </script> sequences
    const manifestJSON = JSON.stringify(manifest).replace(/<\//g, '<\\/');

    // Build the base64 deps object literal for embedding
    const depsLiteral = JSON.stringify(deps);

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${safeTitle} - Offline Viewer</title>
<style>
${KIOSK_CSS}
</style>
</head>
<body>
<div id="loading">
    <div class="spinner"></div>
    <div id="loading-text">Initializing viewer...</div>
</div>
<div id="file-picker" class="hidden">
    <div class="picker-content">
        <h1 id="picker-title">${safeTitle}</h1>
        <p id="picker-desc"></p>
        <div class="picker-box" id="picker-drop-zone">
            <div class="picker-icon">&#128194;</div>
            <p>Select <strong>${ARCHIVE_FILENAME}</strong> from the same folder</p>
            <button id="picker-btn" type="button">Select Archive File</button>
            <p class="picker-hint">or drag and drop it here</p>
            <p class="picker-hint">Accepts .a3z or .a3d archive files</p>
        </div>
        <input type="file" id="picker-input" accept=".a3z,.a3d" style="display:none">
    </div>
</div>
<div id="viewer" class="hidden">
    <canvas id="canvas"></canvas>
    <div id="info-panel">
        <h2 id="info-title"></h2>
        <p id="info-description"></p>
        <div id="info-details"></div>
    </div>
    <div id="controls-hint">Click and drag to rotate &middot; Scroll to zoom &middot; Right-click to pan</div>
</div>
<script>
// Embedded data
var __KIOSK_DEPS__ = ${depsLiteral};
var __KIOSK_MANIFEST__ = ${manifestJSON};
var __ARCHIVE_FILENAME__ = '${ARCHIVE_FILENAME}';

${KIOSK_BOOTSTRAP_JS}
<\/script>
</body>
</html>`;
}

/**
 * Build the viewer package as a ZIP containing viewer.html + data.a3z.
 *
 * @param {string} html - The viewer HTML string (from generateKioskHTML)
 * @param {Uint8Array} archiveBytes - The .a3z archive binary data
 * @returns {Promise<Blob>} The package ZIP as a Blob
 */
export async function buildViewerPackage(html, archiveBytes) {
    const htmlBytes = strToU8(html);

    // Both files stored without additional compression:
    // - HTML is small (~1MB) and compresses poorly (base64 content)
    // - Archive is already compressed (.a3z)
    const zipData = {};
    zipData['viewer.html'] = [htmlBytes, { level: 0 }];
    zipData[ARCHIVE_FILENAME] = [archiveBytes, { level: 0 }];

    const result = await new Promise((resolve, reject) => {
        zip(zipData, (err, data) => {
            if (err) reject(err);
            else resolve(data);
        });
    });

    return new Blob([result], { type: 'application/zip' });
}

// =============================================================================
// KIOSK CSS (embedded in the generated HTML)
// =============================================================================

const KIOSK_CSS = `
* { margin: 0; padding: 0; box-sizing: border-box; }
html, body { width: 100%; height: 100%; overflow: hidden; background: #1a1a2e; color: #eee; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }

#loading {
    position: fixed; inset: 0; display: flex; flex-direction: column;
    align-items: center; justify-content: center; background: #1a1a2e; z-index: 100;
}
.spinner {
    width: 48px; height: 48px; border: 4px solid #333;
    border-top-color: #4ecdc4; border-radius: 50%;
    animation: spin 0.8s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }
#loading-text { margin-top: 16px; color: #888; font-size: 14px; }

#file-picker {
    position: fixed; inset: 0; display: flex; align-items: center;
    justify-content: center; background: #1a1a2e; z-index: 200;
}
#file-picker.hidden { display: none; }
.picker-content { text-align: center; max-width: 480px; padding: 40px; }
.picker-content h1 { color: #4ecdc4; font-size: 22px; margin-bottom: 8px; }
.picker-content > p { color: #888; font-size: 14px; margin-bottom: 24px; line-height: 1.5; }
.picker-box {
    border: 2px dashed #3a3a5a; border-radius: 12px; padding: 32px 24px;
    transition: border-color 0.2s, background 0.2s;
}
.picker-box.drag-over { border-color: #4ecdc4; background: rgba(78, 205, 196, 0.05); }
.picker-icon { font-size: 48px; margin-bottom: 12px; }
.picker-box p { font-size: 15px; margin-bottom: 8px; color: #ccc; }
.picker-box p strong { color: #4ecdc4; }
.picker-hint { font-size: 12px; color: #666; margin-top: 4px; }
#picker-btn {
    margin: 16px auto 8px; padding: 10px 28px; border: none; border-radius: 8px;
    background: #4ecdc4; color: #1a1a2e; font-size: 14px; font-weight: 600;
    cursor: pointer; transition: background 0.2s;
}
#picker-btn:hover { background: #45b7af; }

#viewer { width: 100%; height: 100%; position: relative; }
#viewer.hidden { display: none; }
#canvas { width: 100%; height: 100%; display: block; }

#info-panel {
    position: fixed; top: 16px; left: 16px; max-width: 360px; padding: 16px 20px;
    background: rgba(26, 26, 46, 0.85); border: 1px solid #3a3a5a;
    border-radius: 10px; backdrop-filter: blur(8px); z-index: 10;
    transition: opacity 0.3s;
}
#info-panel h2 { font-size: 16px; color: #4ecdc4; margin-bottom: 6px; }
#info-panel p { font-size: 13px; color: #aaa; line-height: 1.4; }
#info-details { margin-top: 8px; font-size: 12px; color: #666; }
#info-details .row { display: flex; justify-content: space-between; padding: 2px 0; }
#info-details .row .label { color: #888; }
#info-details .row .value { color: #ccc; }

#controls-hint {
    position: fixed; bottom: 16px; left: 50%; transform: translateX(-50%);
    padding: 8px 16px; background: rgba(0,0,0,0.5); border-radius: 20px;
    font-size: 12px; color: #888; pointer-events: none; z-index: 10;
    opacity: 1; transition: opacity 2s;
}
#controls-hint.fade { opacity: 0; }

.anno-marker {
    background: rgba(78, 205, 196, 0.9); color: #fff; padding: 4px 10px;
    border-radius: 12px; font-size: 11px; white-space: nowrap;
    pointer-events: auto; cursor: pointer; border: 1px solid rgba(255,255,255,0.2);
}
.anno-popup {
    position: fixed; padding: 12px 16px; background: rgba(26, 26, 46, 0.95);
    border: 1px solid #4ecdc4; border-radius: 8px; max-width: 280px;
    z-index: 50; font-size: 13px;
}
.anno-popup h4 { color: #4ecdc4; margin-bottom: 4px; }
.anno-popup p { color: #bbb; line-height: 1.4; }
`;

// =============================================================================
// KIOSK BOOTSTRAP JS
//
// This is the script embedded in the generated HTML. It:
// 1. Decodes base64 dependency sources
// 2. Creates blob URLs, rewriting internal `from "three"` to the Three.js blob
// 3. Dynamically imports all deps (single Three.js instance)
// 4. Loads the separate .a3z archive file (auto-fetch or file picker)
// 5. Extracts assets and renders in a read-only viewer
// =============================================================================

const KIOSK_BOOTSTRAP_JS = `
console.log('[Kiosk] Script executing');

(async function() {
    var loadingText = document.getElementById('loading-text');
    function setStatus(msg) {
        console.log('[Kiosk] ' + msg);
        if (loadingText) loadingText.textContent = msg;
    }

    try {
        // =====================================================================
        // PHASE 1: Load dependencies from embedded base64 sources
        // =====================================================================
        setStatus('Loading libraries...');

        var deps = __KIOSK_DEPS__;
        if (!deps || !deps.three) throw new Error('Embedded dependency data is missing');

        function decode(b64) { return decodeURIComponent(escape(atob(b64))); }
        function makeBlob(src) { return URL.createObjectURL(new Blob([src], { type: 'application/javascript' })); }

        // Rewrite imports from "three" (bare specifier) to use the Three.js blob URL.
        // Also handles esm.sh internal URLs that reference three.
        function rewriteThreeImports(src, threeUrl) {
            return src
                .replace(/from\\s*["']three["']/g, 'from "' + threeUrl + '"')
                .replace(/from\\s*["']\\/v\\d+\\/three@[^"']*["']/g, 'from "' + threeUrl + '"')
                .replace(/from\\s*["']https?:\\/\\/esm\\.sh\\/[^"']*three@[^"']*["']/g, 'from "' + threeUrl + '"');
        }

        // 1. Three.js core (standalone bundle, no external imports)
        setStatus('Loading Three.js...');
        var threeSrc = decode(deps.three);
        var threeUrl = makeBlob(threeSrc);
        console.log('[Kiosk] Three.js blob URL created, importing...');
        var THREE = await import(threeUrl);
        console.log('[Kiosk] Three.js loaded, exports: ' + Object.keys(THREE).length + ' symbols');

        // 2. Addons (rewrite their "three" imports to our blob URL)
        setStatus('Loading controls and loaders...');
        var orbitSrc = rewriteThreeImports(decode(deps.threeOrbitControls), threeUrl);
        var OrbitControls = (await import(makeBlob(orbitSrc))).OrbitControls;
        console.log('[Kiosk] OrbitControls loaded');

        var gltfSrc = rewriteThreeImports(decode(deps.threeGLTFLoader), threeUrl);
        var GLTFLoader = (await import(makeBlob(gltfSrc))).GLTFLoader;
        console.log('[Kiosk] GLTFLoader loaded');

        var objSrc = rewriteThreeImports(decode(deps.threeOBJLoader), threeUrl);
        var OBJLoader = (await import(makeBlob(objSrc))).OBJLoader;
        console.log('[Kiosk] OBJLoader loaded');

        // 3. Spark.js (rewrite three imports if present)
        var SplatMesh = null;
        try {
            setStatus('Loading Spark.js...');
            var sparkSrc = rewriteThreeImports(decode(deps.spark), threeUrl);
            var sparkMod = await import(makeBlob(sparkSrc));
            SplatMesh = sparkMod.SplatMesh;
            console.log('[Kiosk] Spark.js loaded, SplatMesh:', !!SplatMesh);
        } catch (e) {
            console.warn('[Kiosk] Spark.js failed to load (splats will not render):', e.message);
        }

        // 4. fflate (standalone, no three dependency)
        setStatus('Loading decompression library...');
        var fflateSrc = decode(deps.fflate);
        var fflate = await import(makeBlob(fflateSrc));
        console.log('[Kiosk] fflate loaded');

        // =====================================================================
        // PHASE 2: Load the archive file
        // =====================================================================
        setStatus('Loading archive...');
        var archiveBytes = null;

        // Try fetching the archive from the same directory (works when served via HTTP)
        try {
            var resp = await fetch('./' + __ARCHIVE_FILENAME__);
            if (resp.ok) {
                archiveBytes = new Uint8Array(await resp.arrayBuffer());
                console.log('[Kiosk] Archive loaded via fetch: ' + archiveBytes.length + ' bytes');
            }
        } catch (e) {
            console.log('[Kiosk] Could not fetch ' + __ARCHIVE_FILENAME__ + ' (expected on file://): ' + e.message);
        }

        // If fetch failed (file:// protocol), show file picker
        if (!archiveBytes) {
            document.getElementById('loading').style.display = 'none';

            // Populate picker with project info from embedded manifest
            var pickerDesc = document.getElementById('picker-desc');
            if (pickerDesc && __KIOSK_MANIFEST__ && __KIOSK_MANIFEST__.project) {
                var desc = __KIOSK_MANIFEST__.project.description || '';
                if (desc) pickerDesc.textContent = desc;
            }

            archiveBytes = await waitForArchiveFile();
            document.getElementById('loading').style.display = '';
        }

        // =====================================================================
        // PHASE 3: Extract archive contents
        // =====================================================================
        setStatus('Extracting assets...');

        // Use async unzip to avoid blocking the main thread
        var files;
        try {
            files = await new Promise(function(resolve, reject) {
                fflate.unzip(archiveBytes, function(err, data) {
                    if (err) reject(err);
                    else resolve(data);
                });
            });
        } catch (e) {
            console.warn('[Kiosk] Async unzip failed, trying sync:', e.message);
            files = fflate.unzipSync(archiveBytes);
        }

        var fileNames = Object.keys(files);
        console.log('[Kiosk] Extracted ' + fileNames.length + ' files: ' + fileNames.join(', '));
        var decoder = new TextDecoder();

        // Parse manifest (prefer from archive, fall back to embedded)
        var manifest = __KIOSK_MANIFEST__;
        if (files['manifest.json']) {
            manifest = JSON.parse(decoder.decode(files['manifest.json']));
            console.log('[Kiosk] Using manifest from archive');
        }
        if (!manifest) throw new Error('No manifest found.');

        // =====================================================================
        // PHASE 4: Initialize viewer and load assets
        // =====================================================================
        setStatus('Loading 3D content...');

        var canvas = document.getElementById('canvas');
        var renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        renderer.setSize(window.innerWidth, window.innerHeight);
        renderer.outputColorSpace = THREE.SRGBColorSpace;

        var scene = new THREE.Scene();
        scene.background = new THREE.Color(0x1a1a2e);

        var camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.01, 1000);
        camera.position.set(0, 1, 3);

        var controls = new OrbitControls(camera, renderer.domElement);
        controls.enableDamping = true;
        controls.dampingFactor = 0.1;

        // Lighting
        scene.add(new THREE.AmbientLight(0xffffff, 0.6));
        var dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
        dirLight.position.set(5, 10, 7);
        scene.add(dirLight);

        // Grid
        scene.add(new THREE.GridHelper(10, 10, 0x3a3a5a, 0x2a2a3a));

        // Load assets
        var entries = manifest.data_entries || {};
        var boundingBox = new THREE.Box3();
        var hasContent = false;

        var entryKeys = Object.keys(entries);
        for (var i = 0; i < entryKeys.length; i++) {
            var key = entryKeys[i];
            var entry = entries[key];
            var filePath = entry.file_name;
            var fileData = files[filePath];
            if (!fileData) {
                console.warn('[Kiosk] File not found in archive: ' + filePath);
                continue;
            }

            var assetBlob = new Blob([fileData]);
            var assetUrl = URL.createObjectURL(assetBlob);
            var params = entry._parameters || {};

            try {
                if (key.indexOf('scene_') === 0 && SplatMesh) {
                    console.log('[Kiosk] Loading splat: ' + filePath);
                    var splatMesh = new SplatMesh({ url: assetUrl });
                    splatMesh.rotation.x = Math.PI;
                    applyTransform(splatMesh, params);
                    scene.add(splatMesh);
                    hasContent = true;

                } else if (key.indexOf('mesh_') === 0) {
                    console.log('[Kiosk] Loading mesh: ' + filePath);
                    var ext = filePath.split('.').pop().toLowerCase();
                    var object = null;

                    if (ext === 'glb' || ext === 'gltf') {
                        var gltfLoader = new GLTFLoader();
                        var gltf = await new Promise(function(res, rej) { gltfLoader.load(assetUrl, res, undefined, rej); });
                        object = gltf.scene;
                    } else if (ext === 'obj') {
                        var objLoader = new OBJLoader();
                        object = await new Promise(function(res, rej) { objLoader.load(assetUrl, res, undefined, rej); });
                    }

                    if (object) {
                        applyTransform(object, params);
                        scene.add(object);
                        hasContent = true;
                        boundingBox.expandByObject(object);
                        console.log('[Kiosk] Mesh loaded: ' + filePath);
                    }

                } else if (key.indexOf('pointcloud_') === 0) {
                    console.warn('[Kiosk] Point cloud display requires E57 WASM (not available offline)');
                }
            } catch (err) {
                console.warn('[Kiosk] Failed to load ' + key + ':', err);
            }
        }

        // Fit camera to content
        if (!boundingBox.isEmpty()) {
            var center = boundingBox.getCenter(new THREE.Vector3());
            var size = boundingBox.getSize(new THREE.Vector3());
            var maxDim = Math.max(size.x, size.y, size.z);
            camera.position.copy(center);
            camera.position.z += maxDim * 1.5;
            camera.position.y += maxDim * 0.5;
            controls.target.copy(center);
        }

        // Load annotations
        var annotations = manifest.annotations || [];
        var annoSprites = [];
        for (var a = 0; a < annotations.length; a++) {
            var anno = annotations[a];
            if (!anno.position) continue;
            var el = document.createElement('div');
            el.className = 'anno-marker';
            el.textContent = anno.title || anno.id || 'Note';
            el.addEventListener('click', showAnnoPopup.bind(null, anno, el));
            document.body.appendChild(el);
            annoSprites.push({
                pos: new THREE.Vector3(anno.position[0], anno.position[1], anno.position[2]),
                el: el
            });
        }

        // Populate info panel
        populateInfo(manifest);

        // Show viewer
        document.getElementById('loading').style.display = 'none';
        document.getElementById('viewer').classList.remove('hidden');
        console.log('[Kiosk] Viewer ready, content loaded: ' + hasContent);
        setTimeout(function() {
            var hint = document.getElementById('controls-hint');
            if (hint) hint.classList.add('fade');
        }, 5000);

        // Resize
        window.addEventListener('resize', function() {
            camera.aspect = window.innerWidth / window.innerHeight;
            camera.updateProjectionMatrix();
            renderer.setSize(window.innerWidth, window.innerHeight);
        });

        // Render loop
        (function animate() {
            requestAnimationFrame(animate);
            controls.update();

            for (var s = 0; s < annoSprites.length; s++) {
                var sp = annoSprites[s].pos.clone().project(camera);
                var ael = annoSprites[s].el;
                if (sp.z > 1) { ael.style.display = 'none'; continue; }
                ael.style.display = '';
                ael.style.position = 'fixed';
                ael.style.left = ((sp.x * 0.5 + 0.5) * window.innerWidth) + 'px';
                ael.style.top = ((-sp.y * 0.5 + 0.5) * window.innerHeight) + 'px';
                ael.style.transform = 'translate(-50%, -50%)';
                ael.style.zIndex = '20';
            }

            renderer.render(scene, camera);
        })();

    } catch (err) {
        setStatus('Error: ' + err.message);
        console.error('[Kiosk Viewer] Fatal error:', err);
    }
})();

// =========================================================================
// Helper functions
// =========================================================================

function waitForArchiveFile() {
    return new Promise(function(resolve) {
        var picker = document.getElementById('file-picker');
        var btn = document.getElementById('picker-btn');
        var input = document.getElementById('picker-input');
        var dropZone = document.getElementById('picker-drop-zone');

        picker.classList.remove('hidden');

        function handleFile(file) {
            if (!file) return;
            picker.classList.add('hidden');
            var reader = new FileReader();
            reader.onload = function() { resolve(new Uint8Array(reader.result)); };
            reader.readAsArrayBuffer(file);
        }

        // Button click opens native file picker
        btn.addEventListener('click', function() { input.click(); });
        input.addEventListener('change', function() {
            if (input.files && input.files[0]) handleFile(input.files[0]);
        });

        // Drag-and-drop
        dropZone.addEventListener('dragover', function(e) {
            e.preventDefault();
            dropZone.classList.add('drag-over');
        });
        dropZone.addEventListener('dragleave', function() {
            dropZone.classList.remove('drag-over');
        });
        dropZone.addEventListener('drop', function(e) {
            e.preventDefault();
            dropZone.classList.remove('drag-over');
            if (e.dataTransfer.files && e.dataTransfer.files[0]) {
                handleFile(e.dataTransfer.files[0]);
            }
        });

        // Also allow drop anywhere on the page
        document.addEventListener('dragover', function(e) { e.preventDefault(); });
        document.addEventListener('drop', function(e) {
            e.preventDefault();
            if (e.dataTransfer.files && e.dataTransfer.files[0]) {
                handleFile(e.dataTransfer.files[0]);
            }
        });
    });
}

function applyTransform(object, params) {
    if (params.position) object.position.set(params.position[0] || 0, params.position[1] || 0, params.position[2] || 0);
    if (params.rotation) object.rotation.set(params.rotation[0] || 0, params.rotation[1] || 0, params.rotation[2] || 0);
    if (params.scale !== undefined) {
        var s = typeof params.scale === 'number' ? params.scale : 1;
        object.scale.set(s, s, s);
    }
}

function showAnnoPopup(anno, marker) {
    var old = document.querySelector('.anno-popup');
    if (old) old.remove();

    var popup = document.createElement('div');
    popup.className = 'anno-popup';
    var title = (anno.title || 'Annotation').replace(/</g, '&lt;');
    var body = (anno.body || anno.description || '').replace(/</g, '&lt;');
    popup.innerHTML = '<h4>' + title + '</h4><p>' + body + '</p>';

    var rect = marker.getBoundingClientRect();
    popup.style.left = (rect.right + 8) + 'px';
    popup.style.top = rect.top + 'px';
    document.body.appendChild(popup);

    setTimeout(function() {
        document.addEventListener('click', function handler(e) {
            if (!popup.contains(e.target) && e.target !== marker) {
                popup.remove();
                document.removeEventListener('click', handler);
            }
        });
    }, 10);
}

function populateInfo(manifest) {
    var titleEl = document.getElementById('info-title');
    var descEl = document.getElementById('info-description');
    var detailsEl = document.getElementById('info-details');

    if (titleEl) titleEl.textContent = manifest.project && manifest.project.title ? manifest.project.title : 'Untitled';
    if (descEl) {
        var desc = manifest.project && manifest.project.description ? manifest.project.description : '';
        descEl.textContent = desc;
        if (!desc) descEl.style.display = 'none';
    }
    if (detailsEl) {
        var rows = [];
        if (manifest.provenance && manifest.provenance.operator) rows.push(['Creator', manifest.provenance.operator]);
        if (manifest.provenance && manifest.provenance.capture_date) {
            rows.push(['Captured', new Date(manifest.provenance.capture_date).toLocaleDateString()]);
        }
        if (manifest.provenance && manifest.provenance.location) rows.push(['Location', manifest.provenance.location]);
        if (manifest.project && manifest.project.license) rows.push(['License', manifest.project.license]);
        var ac = (manifest.annotations || []).length;
        if (ac > 0) rows.push(['Annotations', ac.toString()]);

        detailsEl.innerHTML = rows.map(function(r) {
            return '<div class="row"><span class="label">' + r[0] + '</span><span class="value">' + r[1] + '</span></div>';
        }).join('');
        if (!rows.length) detailsEl.style.display = 'none';
    }
}
`;
