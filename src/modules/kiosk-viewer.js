/**
 * Kiosk Viewer Generator
 *
 * Generates a self-contained HTML file that embeds a read-only 3D viewer.
 * The generated file is a polyglot: valid HTML that also contains ZIP data
 * appended after </html>. The viewer reads itself, extracts the ZIP portion,
 * and renders the 3D assets offline.
 *
 * Architecture:
 * - Dependencies are fetched from CDN at export time as ES module source text
 * - Sources are base64-encoded and embedded in the HTML
 * - At runtime, the kiosk HTML decodes sources, creates blob URLs, rewrites
 *   internal `from "three"` imports to use the Three.js blob URL, then
 *   dynamically imports everything — ensuring a single shared Three.js instance
 * - fflate is used to extract the appended ZIP data containing 3D assets
 */

import { log } from './utilities.js';

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
 * @returns {Object} Map of dependency name → base64-encoded source
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
        log.info(`[Kiosk] Fetched ${name}: ${(src.length / 1024).toFixed(1)} KB source → ${(deps[name].length / 1024).toFixed(1)} KB base64`);
    }
    return deps;
}

/**
 * Generate the self-contained kiosk viewer HTML string.
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
<div id="drop-overlay" class="hidden">
    <div class="drop-content">
        <div class="drop-icon">&#128194;</div>
        <p>Drop this file here to view</p>
        <p class="drop-hint">Your browser requires drag-and-drop for local files.</p>
        <p class="drop-hint">Drag this same .html file onto this page.</p>
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
// Embedded data — deps as base64, manifest as JSON
window.__KIOSK_DEPS__ = ${depsLiteral};
window.__KIOSK_MANIFEST__ = ${manifestJSON};
</script>
<script type="module">
${KIOSK_BOOTSTRAP_JS}
</script>
</body>
</html>
<!-- KIOSK_ZIP_BOUNDARY -->`;
}

/**
 * Build the complete polyglot file (HTML + ZIP).
 *
 * @param {string} html - The kiosk HTML string (from generateKioskHTML)
 * @param {Uint8Array} zipData - The ZIP archive binary data
 * @returns {Blob} The polyglot file as a Blob
 */
export function buildPolyglotFile(html, zipData) {
    const encoder = new TextEncoder();
    const htmlBytes = encoder.encode(html);

    const combined = new Uint8Array(htmlBytes.length + zipData.length);
    combined.set(htmlBytes, 0);
    combined.set(zipData, htmlBytes.length);

    return new Blob([combined], { type: 'text/html' });
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

#drop-overlay {
    position: fixed; inset: 0; display: flex; align-items: center;
    justify-content: center; background: rgba(26, 26, 46, 0.95); z-index: 200;
}
#drop-overlay.hidden { display: none; }
.drop-content { text-align: center; padding: 40px; }
.drop-icon { font-size: 64px; margin-bottom: 16px; }
.drop-content p { font-size: 18px; margin-bottom: 8px; }
.drop-content .drop-hint { font-size: 13px; color: #888; }

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
// This is the module script embedded in the generated HTML. It:
// 1. Decodes base64 dependency sources
// 2. Creates blob URLs, rewriting internal `from "three"` to the Three.js blob
// 3. Dynamically imports all deps (single Three.js instance)
// 4. Reads itself to extract the appended ZIP data
// 5. Extracts assets and renders in a read-only viewer
// =============================================================================

const KIOSK_BOOTSTRAP_JS = `
(async function() {
    const loadingText = document.getElementById('loading-text');
    const setStatus = (msg) => { if (loadingText) loadingText.textContent = msg; };

    try {
        // =====================================================================
        // PHASE 1: Load dependencies from embedded base64 sources
        // =====================================================================
        setStatus('Loading libraries...');

        const deps = window.__KIOSK_DEPS__;
        const decode = (b64) => decodeURIComponent(escape(atob(b64)));
        const makeBlob = (src) => URL.createObjectURL(new Blob([src], { type: 'application/javascript' }));

        // Rewrite imports from "three" (bare specifier) to use the Three.js blob URL.
        // Also handles esm.sh internal URLs that reference three.
        const rewriteThreeImports = (src, threeUrl) => {
            return src
                .replace(/from\\s*["']three["']/g, 'from "' + threeUrl + '"')
                .replace(/from\\s*["']\\/v\\d+\\/three@[^"']*["']/g, 'from "' + threeUrl + '"')
                .replace(/from\\s*["']https?:\\/\\/esm\\.sh\\/[^"']*three@[^"']*["']/g, 'from "' + threeUrl + '"');
        };

        // 1. Three.js core (standalone bundle, no external imports)
        const threeSrc = decode(deps.three);
        const threeUrl = makeBlob(threeSrc);
        const THREE = await import(threeUrl);

        // 2. Addons (rewrite their "three" imports to our blob URL)
        const orbitSrc = rewriteThreeImports(decode(deps.threeOrbitControls), threeUrl);
        const { OrbitControls } = await import(makeBlob(orbitSrc));

        const gltfSrc = rewriteThreeImports(decode(deps.threeGLTFLoader), threeUrl);
        const { GLTFLoader } = await import(makeBlob(gltfSrc));

        const objSrc = rewriteThreeImports(decode(deps.threeOBJLoader), threeUrl);
        const { OBJLoader } = await import(makeBlob(objSrc));

        // 3. Spark.js (rewrite three imports if present)
        let SplatMesh = null;
        try {
            const sparkSrc = rewriteThreeImports(decode(deps.spark), threeUrl);
            const sparkMod = await import(makeBlob(sparkSrc));
            SplatMesh = sparkMod.SplatMesh;
        } catch (e) {
            console.warn('[Kiosk] Spark.js failed to load:', e.message);
        }

        // 4. fflate (standalone, no three dependency)
        const fflateSrc = decode(deps.fflate);
        const fflate = await import(makeBlob(fflateSrc));

        // =====================================================================
        // PHASE 2: Read ourselves and extract ZIP data
        // =====================================================================
        setStatus('Reading archive data...');
        let fileBytes = null;

        try {
            const resp = await fetch(window.location.href);
            if (resp.ok) {
                fileBytes = new Uint8Array(await resp.arrayBuffer());
            }
        } catch (e) {
            // fetch failed (likely Firefox file://) — show drag-and-drop
        }

        if (!fileBytes) {
            setStatus('Waiting for file...');
            document.getElementById('loading').style.display = 'none';
            fileBytes = await waitForFileDrop();
            document.getElementById('loading').style.display = '';
            setStatus('Extracting assets...');
        }

        // Find the ZIP boundary
        const zipStart = findZipBoundary(fileBytes);
        if (zipStart === -1) {
            throw new Error('No archive data found in this file.');
        }

        const zipData = fileBytes.slice(zipStart);
        const files = fflate.unzipSync(zipData);
        const decoder = new TextDecoder();

        // Parse manifest (prefer embedded in ZIP, fall back to inline)
        let manifest = window.__KIOSK_MANIFEST__;
        if (files['manifest.json']) {
            manifest = JSON.parse(decoder.decode(files['manifest.json']));
        }
        if (!manifest) throw new Error('No manifest found in archive.');

        // =====================================================================
        // PHASE 3: Initialize viewer and load assets
        // =====================================================================
        setStatus('Loading 3D content...');

        const canvas = document.getElementById('canvas');
        const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        renderer.setSize(window.innerWidth, window.innerHeight);
        renderer.outputColorSpace = THREE.SRGBColorSpace;
        renderer.toneMapping = THREE.ACESFilmicToneMapping;

        const scene = new THREE.Scene();
        scene.background = new THREE.Color(0x1a1a2e);

        const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.01, 1000);
        camera.position.set(0, 1, 3);

        const controls = new OrbitControls(camera, renderer.domElement);
        controls.enableDamping = true;
        controls.dampingFactor = 0.1;

        // Lighting
        scene.add(new THREE.AmbientLight(0xffffff, 0.6));
        const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
        dirLight.position.set(5, 10, 7);
        scene.add(dirLight);

        // Grid
        scene.add(new THREE.GridHelper(10, 10, 0x3a3a5a, 0x2a2a3a));

        // Load assets
        const entries = manifest.data_entries || {};
        const boundingBox = new THREE.Box3();
        let hasContent = false;

        for (const [key, entry] of Object.entries(entries)) {
            const filePath = entry.file_name;
            const fileData = files[filePath];
            if (!fileData) continue;

            const assetBlob = new Blob([fileData]);
            const assetUrl = URL.createObjectURL(assetBlob);
            const params = entry._parameters || {};

            try {
                if (key.startsWith('scene_') && SplatMesh) {
                    const splatMesh = new SplatMesh({ url: assetUrl });
                    splatMesh.rotation.x = Math.PI;
                    applyTransform(splatMesh, params);
                    scene.add(splatMesh);
                    hasContent = true;

                } else if (key.startsWith('mesh_')) {
                    const ext = filePath.split('.').pop().toLowerCase();
                    let object = null;

                    if (ext === 'glb' || ext === 'gltf') {
                        const loader = new GLTFLoader();
                        const gltf = await new Promise((res, rej) => loader.load(assetUrl, res, undefined, rej));
                        object = gltf.scene;
                    } else if (ext === 'obj') {
                        const loader = new OBJLoader();
                        object = await new Promise((res, rej) => loader.load(assetUrl, res, undefined, rej));
                    }

                    if (object) {
                        applyTransform(object, params);
                        scene.add(object);
                        hasContent = true;
                        boundingBox.expandByObject(object);
                    }

                } else if (key.startsWith('pointcloud_')) {
                    console.warn('[Kiosk] Point cloud display requires E57 WASM (not available offline)');
                }
            } catch (err) {
                console.warn('[Kiosk] Failed to load ' + key + ':', err);
            }
        }

        // Fit camera to content
        if (!boundingBox.isEmpty()) {
            const center = boundingBox.getCenter(new THREE.Vector3());
            const size = boundingBox.getSize(new THREE.Vector3());
            const maxDim = Math.max(size.x, size.y, size.z);
            camera.position.copy(center);
            camera.position.z += maxDim * 1.5;
            camera.position.y += maxDim * 0.5;
            controls.target.copy(center);
        }

        // Load annotations
        const annotations = manifest.annotations || [];
        const annoSprites = [];
        annotations.forEach(anno => {
            if (!anno.position) return;
            const el = document.createElement('div');
            el.className = 'anno-marker';
            el.textContent = anno.title || anno.id || 'Note';
            el.addEventListener('click', () => showAnnoPopup(anno, el));
            document.body.appendChild(el);
            annoSprites.push({
                pos: new THREE.Vector3(anno.position[0], anno.position[1], anno.position[2]),
                el
            });
        });

        // Populate info panel
        populateInfo(manifest);

        // Show viewer
        document.getElementById('loading').style.display = 'none';
        document.getElementById('viewer').classList.remove('hidden');
        setTimeout(() => {
            const hint = document.getElementById('controls-hint');
            if (hint) hint.classList.add('fade');
        }, 5000);

        // Resize
        window.addEventListener('resize', () => {
            camera.aspect = window.innerWidth / window.innerHeight;
            camera.updateProjectionMatrix();
            renderer.setSize(window.innerWidth, window.innerHeight);
        });

        // Render loop
        (function animate() {
            requestAnimationFrame(animate);
            controls.update();

            annoSprites.forEach(({ pos, el }) => {
                const sp = pos.clone().project(camera);
                if (sp.z > 1) { el.style.display = 'none'; return; }
                el.style.display = '';
                el.style.position = 'fixed';
                el.style.left = ((sp.x * 0.5 + 0.5) * window.innerWidth) + 'px';
                el.style.top = ((-sp.y * 0.5 + 0.5) * window.innerHeight) + 'px';
                el.style.transform = 'translate(-50%, -50%)';
                el.style.zIndex = '20';
            });

            renderer.render(scene, camera);
        })();

    } catch (err) {
        setStatus('Error: ' + err.message);
        console.error('[Kiosk Viewer]', err);
    }
})();

// =========================================================================
// Helper functions
// =========================================================================

function findZipBoundary(bytes) {
    const marker = new TextEncoder().encode('<!-- KIOSK_ZIP_BOUNDARY -->');
    let pos = -1;

    // Search for boundary marker
    outer:
    for (let i = 0; i < bytes.length - marker.length; i++) {
        for (let j = 0; j < marker.length; j++) {
            if (bytes[i + j] !== marker[j]) continue outer;
        }
        pos = i + marker.length;
        break;
    }

    if (pos !== -1) {
        // Skip whitespace after marker
        while (pos < bytes.length && (bytes[pos] === 10 || bytes[pos] === 13 || bytes[pos] === 32)) pos++;
        // Verify ZIP local file header magic (PK\\x03\\x04)
        if (pos + 3 < bytes.length && bytes[pos] === 0x50 && bytes[pos+1] === 0x4B && bytes[pos+2] === 0x03 && bytes[pos+3] === 0x04) {
            return pos;
        }
    }

    // Fallback: find end-of-central-directory, then first local file header
    for (let i = bytes.length - 22; i >= 0; i--) {
        if (bytes[i] === 0x50 && bytes[i+1] === 0x4B && bytes[i+2] === 0x05 && bytes[i+3] === 0x06) {
            for (let j = 0; j < i; j++) {
                if (bytes[j] === 0x50 && bytes[j+1] === 0x4B && bytes[j+2] === 0x03 && bytes[j+3] === 0x04) {
                    return j;
                }
            }
        }
    }
    return -1;
}

function waitForFileDrop() {
    return new Promise((resolve) => {
        const overlay = document.getElementById('drop-overlay');
        overlay.classList.remove('hidden');

        const handleDrop = (e) => {
            e.preventDefault();
            overlay.classList.add('hidden');
            const file = e.dataTransfer.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = () => resolve(new Uint8Array(reader.result));
            reader.readAsArrayBuffer(file);
        };

        document.addEventListener('dragover', (e) => e.preventDefault());
        document.addEventListener('drop', handleDrop);
    });
}

function applyTransform(object, params) {
    if (params.position) object.position.set(params.position[0] || 0, params.position[1] || 0, params.position[2] || 0);
    if (params.rotation) object.rotation.set(params.rotation[0] || 0, params.rotation[1] || 0, params.rotation[2] || 0);
    if (params.scale !== undefined) {
        const s = typeof params.scale === 'number' ? params.scale : 1;
        object.scale.set(s, s, s);
    }
}

function showAnnoPopup(anno, marker) {
    const old = document.querySelector('.anno-popup');
    if (old) old.remove();

    const popup = document.createElement('div');
    popup.className = 'anno-popup';
    const title = (anno.title || 'Annotation').replace(/</g, '&lt;');
    const body = (anno.body || anno.description || '').replace(/</g, '&lt;');
    popup.innerHTML = '<h4>' + title + '</h4><p>' + body + '</p>';

    const rect = marker.getBoundingClientRect();
    popup.style.left = (rect.right + 8) + 'px';
    popup.style.top = rect.top + 'px';
    document.body.appendChild(popup);

    setTimeout(() => {
        document.addEventListener('click', function handler(e) {
            if (!popup.contains(e.target) && e.target !== marker) {
                popup.remove();
                document.removeEventListener('click', handler);
            }
        });
    }, 10);
}

function populateInfo(manifest) {
    const titleEl = document.getElementById('info-title');
    const descEl = document.getElementById('info-description');
    const detailsEl = document.getElementById('info-details');

    if (titleEl) titleEl.textContent = manifest.project?.title || 'Untitled';
    if (descEl) {
        descEl.textContent = manifest.project?.description || '';
        if (!manifest.project?.description) descEl.style.display = 'none';
    }
    if (detailsEl) {
        const rows = [];
        if (manifest.provenance?.operator) rows.push(['Creator', manifest.provenance.operator]);
        if (manifest.provenance?.capture_date) {
            rows.push(['Captured', new Date(manifest.provenance.capture_date).toLocaleDateString()]);
        }
        if (manifest.provenance?.location) rows.push(['Location', manifest.provenance.location]);
        if (manifest.project?.license) rows.push(['License', manifest.project.license]);
        const ac = (manifest.annotations || []).length;
        if (ac > 0) rows.push(['Annotations', ac.toString()]);

        detailsEl.innerHTML = rows.map(([l, v]) =>
            '<div class="row"><span class="label">' + l + '</span><span class="value">' + v + '</span></div>'
        ).join('');
        if (!rows.length) detailsEl.style.display = 'none';
    }
}
`;
