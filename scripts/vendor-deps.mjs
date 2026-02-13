#!/usr/bin/env node
/**
 * vendor-deps.mjs — Download CDN dependencies and produce an offline dist/ folder.
 *
 * Modeled on the fetchResolved() pattern from src/modules/kiosk-viewer.js.
 * This script:
 *   1. Cleans and creates dist/
 *   2. Copies src/ into dist/
 *   3. Downloads all CDN dependencies to dist/vendor/
 *   4. Rewrites the import map in dist/index.html to use local ./vendor/ paths
 *   5. Removes the CSP <meta> tag (Tauri manages CSP via tauri.conf.json)
 *
 * Usage: node scripts/vendor-deps.mjs
 */

import { readFileSync, writeFileSync, mkdirSync, cpSync, rmSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const SRC = join(ROOT, 'src');
const DIST = join(ROOT, 'dist');
const VENDOR = join(DIST, 'vendor');

// =============================================================================
// CDN DEPENDENCY MAP
// =============================================================================
// Maps import specifiers to { url, localFile }.
// Uses jsdelivr for three core and fflate (proven reliable for offline use,
// same as kiosk-viewer.js). Uses esm.sh for addons and other deps.

const CDN_DEPS = [
    {
        specifier: 'three',
        url: 'https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.js',
        localFile: 'three.js',
        needsResolve: false,
    },
    {
        specifier: 'three/addons/controls/OrbitControls.js',
        url: 'https://esm.sh/three@0.170.0/examples/jsm/controls/OrbitControls.js?external=three',
        localFile: 'OrbitControls.js',
        needsResolve: true,
    },
    {
        specifier: 'three/addons/controls/TransformControls.js',
        url: 'https://esm.sh/three@0.170.0/examples/jsm/controls/TransformControls.js?external=three',
        localFile: 'TransformControls.js',
        needsResolve: true,
    },
    {
        specifier: 'three/addons/loaders/GLTFLoader.js',
        url: 'https://esm.sh/three@0.170.0/examples/jsm/loaders/GLTFLoader.js?external=three',
        localFile: 'GLTFLoader.js',
        needsResolve: true,
    },
    {
        specifier: 'three/addons/loaders/OBJLoader.js',
        url: 'https://esm.sh/three@0.170.0/examples/jsm/loaders/OBJLoader.js?external=three',
        localFile: 'OBJLoader.js',
        needsResolve: true,
    },
    {
        specifier: 'three/addons/loaders/MTLLoader.js',
        url: 'https://esm.sh/three@0.170.0/examples/jsm/loaders/MTLLoader.js?external=three',
        localFile: 'MTLLoader.js',
        needsResolve: true,
    },
    {
        specifier: 'three/addons/loaders/RGBELoader.js',
        url: 'https://esm.sh/three@0.170.0/examples/jsm/loaders/RGBELoader.js?external=three',
        localFile: 'RGBELoader.js',
        needsResolve: true,
    },
    {
        specifier: 'three/addons/loaders/STLLoader.js',
        url: 'https://esm.sh/three@0.170.0/examples/jsm/loaders/STLLoader.js?external=three',
        localFile: 'STLLoader.js',
        needsResolve: true,
    },
    {
        specifier: '@sparkjsdev/spark',
        url: 'https://sparkjs.dev/releases/spark/0.1.10/spark.module.js',
        localFile: 'spark.module.js',
        needsResolve: false,
    },
    {
        specifier: 'fflate',
        url: 'https://cdn.jsdelivr.net/npm/fflate@0.8.2/esm/browser.js',
        localFile: 'fflate.js',
        needsResolve: false,
    },
    {
        specifier: 'three-e57-loader',
        url: 'https://esm.sh/three-e57-loader@1.2.0?external=three',
        localFile: 'three-e57-loader.js',
        needsResolve: true,
    },
    {
        specifier: 'web-e57',
        url: 'https://esm.sh/web-e57@1.2.0',
        localFile: 'web-e57.js',
        needsResolve: true,
    },
];

// =============================================================================
// HELPERS
// =============================================================================

/**
 * Fetch a URL as text with one retry.
 * Ported from kiosk-viewer.js fetchText().
 */
async function fetchText(url) {
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
 * Fetch a URL as text, following esm.sh re-export wrappers.
 * Ported from kiosk-viewer.js fetchResolved().
 *
 * esm.sh returns tiny wrappers like:
 *   export * from "/three@0.170.0/X-.../Module.mjs"
 * The actual bundled module is at that internal path on the same origin.
 */
async function fetchResolved(url) {
    const src = await fetchText(url);
    if (src.length < 500) {
        const match = src.match(/export\s*\*\s*from\s*["'](\/[^"']+)["']/);
        if (match) {
            const origin = new URL(url).origin;
            console.log(`  Following esm.sh redirect: ${match[1]}`);
            return await fetchText(origin + match[1]);
        }
    }
    return src;
}

// =============================================================================
// MAIN
// =============================================================================

async function main() {
    console.log('=== vendor-deps: Building offline dist/ ===\n');

    // Step 1: Clean dist/
    if (existsSync(DIST)) {
        console.log('Cleaning existing dist/...');
        rmSync(DIST, { recursive: true, force: true });
    }

    // Step 2: Copy src/ to dist/ (excluding large asset directories)
    console.log('Copying src/ -> dist/...');
    const EXCLUDE_DIRS = ['models'];
    cpSync(SRC, DIST, {
        recursive: true,
        filter: (src) => {
            const rel = src.replace(SRC, '').replace(/\\/g, '/');
            return !EXCLUDE_DIRS.some(dir => rel === `/${dir}` || rel.startsWith(`/${dir}/`));
        },
    });

    // Step 3: Create vendor/
    mkdirSync(VENDOR, { recursive: true });

    // Step 4: Download CDN dependencies
    console.log(`\nDownloading ${CDN_DEPS.length} CDN dependencies...\n`);

    const importMapEntries = {};

    for (const dep of CDN_DEPS) {
        process.stdout.write(`  Fetching ${dep.specifier}... `);
        try {
            const src = dep.needsResolve
                ? await fetchResolved(dep.url)
                : await fetchText(dep.url);

            const outPath = join(VENDOR, dep.localFile);
            writeFileSync(outPath, src, 'utf8');
            importMapEntries[dep.specifier] = `./vendor/${dep.localFile}`;

            const sizeKB = (Buffer.byteLength(src, 'utf8') / 1024).toFixed(1);
            console.log(`OK (${sizeKB} KB)`);
        } catch (err) {
            console.log(`FAILED: ${err.message}`);
            throw new Error(`Failed to download ${dep.specifier}: ${err.message}`);
        }
    }

    // Step 4b: Download esm.sh polyfills referenced by vendored modules
    // three-e57-loader imports from "/node/buffer.mjs" (esm.sh's Node polyfill)
    console.log('\nDownloading esm.sh polyfills...');
    {
        process.stdout.write('  Fetching /node/buffer.mjs polyfill... ');
        try {
            const bufferSrc = await fetchResolved('https://esm.sh/node/buffer.mjs');
            writeFileSync(join(VENDOR, 'node-buffer.mjs'), bufferSrc, 'utf8');
            const sizeKB = (Buffer.byteLength(bufferSrc, 'utf8') / 1024).toFixed(1);
            console.log(`OK (${sizeKB} KB)`);
        } catch (err) {
            console.log(`FAILED: ${err.message}`);
            console.log('  (E57 point cloud loading may not work offline)');
        }

        // Patch the import path in three-e57-loader.js
        const e57LoaderPath = join(VENDOR, 'three-e57-loader.js');
        if (existsSync(e57LoaderPath)) {
            let e57Src = readFileSync(e57LoaderPath, 'utf8');
            if (e57Src.includes('"/node/buffer.mjs"')) {
                e57Src = e57Src.replace('"/node/buffer.mjs"', '"./node-buffer.mjs"');
                writeFileSync(e57LoaderPath, e57Src, 'utf8');
                console.log('  Patched three-e57-loader.js: /node/buffer.mjs -> ./node-buffer.mjs');
            }
        }
    }

    // Step 5: Rewrite import map in dist/index.html
    console.log('\nRewriting import map in dist/index.html...');

    const indexPath = join(DIST, 'index.html');
    let html = readFileSync(indexPath, 'utf8');

    // Build new import map JSON
    const newImportMap = JSON.stringify({ imports: importMapEntries }, null, 8);
    const importMapBlock = `<script type="importmap">\n    ${newImportMap}\n    </script>`;

    // Replace existing import map
    html = html.replace(
        /<script type="importmap">[\s\S]*?<\/script>/,
        importMapBlock
    );

    // Step 6: Remove CSP meta tag (Tauri manages CSP via tauri.conf.json)
    console.log('Removing CSP meta tag (Tauri manages CSP)...');
    html = html.replace(
        /\s*<!-- Content Security Policy[\s\S]*?-->\s*\n\s*<!-- Note:.*?-->\s*\n\s*<!-- Note:.*?-->\s*\n\s*<meta http-equiv="Content-Security-Policy"[\s\S]*?">\s*\n/,
        '\n'
    );

    writeFileSync(indexPath, html, 'utf8');

    console.log('\n=== vendor-deps: Done! ===');
    console.log(`  Output: ${DIST}`);
    console.log(`  Vendor: ${VENDOR} (${CDN_DEPS.length} dependencies)`);
    console.log('  Ready for: npx tauri build');
}

main().catch(err => {
    console.error('\nFATAL:', err.message);
    process.exit(1);
});
