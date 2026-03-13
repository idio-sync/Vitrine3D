/**
 * Export Controller Module
 *
 * Handles archive export, generic viewer download, and metadata manifest import/export.
 * Extracted from main.js — all functions receive dependencies via the deps pattern.
 */

import { captureScreenshot } from './archive-creator.js';
import { Logger, notify, escapeHtml } from './utilities.js';
import { dracoCompressGLB } from './mesh-decimator.js';
import { formatFileSize, getActiveProfile, VALIDATION_RULES } from './metadata-manager.js';
import { validateSIP, toManifestCompliance } from './sip-validator.js';
import type { SIPValidationResult } from './sip-validator.js';
import { getStore } from './asset-store.js';
import { captureWalkthroughForArchive } from './walkthrough-controller.js';
import { getAuthCredentials, getCsrfToken, fetchCsrfToken, refreshLibrary } from './library-panel.js';
import type { ExportDeps } from '@/types.js';
import type { TranscodeResponse, TranscodeError } from './workers/transcode-spz.worker.js';

const log = Logger.getLogger('export-controller');

/**
 * Run transcodeSpz in a Web Worker to avoid blocking the main thread.
 * Transfers the input buffer to the worker and receives the SPZ bytes back.
 */
function transcodeSpzInWorker(fileBytes: Uint8Array, fileType: string): Promise<Uint8Array> {
    return new Promise((resolve, reject) => {
        const worker = new Worker(
            new URL('./workers/transcode-spz.worker.ts', import.meta.url),
            { type: 'module' },
        );
        worker.onmessage = (e: MessageEvent<TranscodeResponse | TranscodeError>) => {
            worker.terminate();
            if (e.data.success === true) {
                resolve((e.data as TranscodeResponse).spzBytes);
            } else {
                reject(new Error((e.data as TranscodeError).error));
            }
        };
        worker.onerror = (e) => {
            worker.terminate();
            reject(new Error(`Worker error: ${e.message}`));
        };
        // Transfer the buffer to avoid a copy
        worker.postMessage({ fileBytes, fileType }, { transfer: [fileBytes.buffer] });
    });
}

const CHUNK_SIZE = 50 * 1024 * 1024; // 50 MB — safely under Cloudflare's 100 MB request limit
const CHUNK_CONCURRENCY = 1;          // sequential — concurrent uploads cause HTTP/2 potential errors behind Cloudflare

type Vec3 = [number, number, number];
const ZERO3: Vec3 = [0, 0, 0];
function pos(obj: { position: { x: number; y: number; z: number } } | null | undefined): Vec3 {
    return obj ? [obj.position.x, obj.position.y, obj.position.z] : ZERO3;
}
function rot(obj: { rotation: { x: number; y: number; z: number } } | null | undefined): Vec3 {
    return obj ? [obj.rotation.x, obj.rotation.y, obj.rotation.z] : ZERO3;
}
function scl(obj: { scale: { x: number } } | null | undefined): number {
    return obj ? obj.scale.x : 1;
}

/**
 * Show the export panel and sync asset checkboxes.
 */
export function showExportPanel(deps: ExportDeps): void {
    deps.ui.showExportPanelHandler();
    updateArchiveAssetCheckboxes(deps);
}

/**
 * Update archive asset checkboxes based on loaded state.
 */
function updateArchiveAssetCheckboxes(deps: ExportDeps): void {
    const { sceneRefs, state } = deps;
    const { annotationSystem } = sceneRefs;

    const checkboxes = [
        { id: 'archive-include-splat', loaded: state.splatLoaded },
        { id: 'archive-include-model', loaded: state.modelLoaded },
        { id: 'archive-include-pointcloud', loaded: state.pointcloudLoaded },
        { id: 'archive-include-annotations', loaded: annotationSystem && annotationSystem.hasAnnotations() }
    ];
    checkboxes.forEach(({ id, loaded }) => {
        const el = document.getElementById(id) as HTMLInputElement | null;
        if (el) {
            el.checked = !!loaded;
            el.disabled = !loaded;
        }
    });

    // Show Draco sub-row only when a GLB mesh is loaded
    const dracoHdRow = document.getElementById('export-draco-hd-row');
    if (dracoHdRow) {
        const fileName = (state._meshFileName || document.getElementById('model-filename')?.textContent || '').toLowerCase();
        const isGlb = fileName.endsWith('.glb');
        dracoHdRow.style.display = (state.modelLoaded && isGlb) ? '' : 'none';
    }
}

/**
 * Show the SIP compliance dialog and return true if user chooses to proceed with export.
 */
function showComplianceDialog(result: SIPValidationResult): Promise<boolean> {
    return new Promise(resolve => {
        const overlay = document.getElementById('export-validation-overlay');
        const errorList = document.getElementById('validation-error-list');
        const warningList = document.getElementById('validation-warning-list');
        const profileEl = document.getElementById('validation-profile-name');
        const scoreEl = document.getElementById('validation-score');
        const scoreBarEl = document.getElementById('validation-score-bar') as HTMLElement | null;
        const errorSection = document.getElementById('validation-error-section');
        const warningSection = document.getElementById('validation-warning-section');
        const passCountEl = document.getElementById('validation-pass-count');
        const backBtn = document.getElementById('btn-validation-back');
        const exportBtn = document.getElementById('btn-validation-export');
        const statusIcon = document.getElementById('validation-status-icon');

        if (!overlay || !backBtn || !exportBtn) {
            resolve(true);
            return;
        }

        // Profile name
        const profileLabels: Record<string, string> = { basic: 'Basic', standard: 'Standard', archival: 'Archival' };
        if (profileEl) profileEl.textContent = profileLabels[result.profile] || result.profile;

        // Score
        if (scoreEl) scoreEl.textContent = `${result.score}%`;
        if (scoreBarEl) {
            scoreBarEl.style.width = `${result.score}%`;
            scoreBarEl.className = 'validation-score-fill' +
                (result.score >= 80 ? ' score-good' : result.score >= 50 ? ' score-fair' : ' score-low');
        }

        // Pass count
        if (passCountEl) passCountEl.textContent = `${result.passCount} of ${result.totalChecked} fields passed`;

        // Errors
        if (errorSection) errorSection.classList.toggle('hidden', result.errors.length === 0);
        if (errorList) {
            errorList.innerHTML = result.errors
                .map(f => `<li><span class="finding-label">${escapeHtml(f.label)}</span><span class="finding-msg">${escapeHtml(f.message)}</span></li>`)
                .join('');
        }

        // Warnings
        if (warningSection) warningSection.classList.toggle('hidden', result.warnings.length === 0);
        if (warningList) {
            warningList.innerHTML = result.warnings
                .map(f => `<li><span class="finding-label">${escapeHtml(f.label)}</span><span class="finding-msg">${escapeHtml(f.message)}</span></li>`)
                .join('');
        }

        // Status icon
        if (statusIcon) {
            statusIcon.className = 'validation-status-icon ' +
                (result.errors.length > 0 ? 'status-error' :
                 result.warnings.length > 0 ? 'status-warning' : 'status-pass');
        }

        // Export button text
        if (result.errors.length > 0) {
            exportBtn.textContent = 'Export Anyway';
            exportBtn.classList.add('override-btn');
        } else {
            exportBtn.textContent = 'Continue Export';
            exportBtn.classList.remove('override-btn');
        }

        overlay.classList.remove('hidden');

        const cleanup = () => {
            overlay.classList.add('hidden');
            backBtn.removeEventListener('click', onBack);
            exportBtn.removeEventListener('click', onExport);
        };

        const onBack = () => { cleanup(); resolve(false); };
        const onExport = () => { cleanup(); resolve(true); };

        backBtn.addEventListener('click', onBack);
        exportBtn.addEventListener('click', onExport);
    });
}

interface PreparedArchive {
    filename: string;
    format: 'ddim' | 'zip';
    includeHashes: boolean;
}

/**
 * Shared archive preparation — validates metadata, adds assets, returns options.
 * Returns null if validation fails or user cancels.
 */
async function prepareArchive(deps: ExportDeps): Promise<PreparedArchive | null> {
    const { sceneRefs, state, ui, metadata: metadataFns } = deps;
    const { archiveCreator, renderer, scene, camera, controls, splatMesh, modelGroup, pointcloudGroup, cadGroup, flightPathGroup, annotationSystem } = sceneRefs;
    const assets = getStore();

    log.info(' prepareArchive called');
    if (!archiveCreator) {
        log.error(' archiveCreator is null');
        return null;
    }

    // Reset creator
    log.info(' Resetting archive creator');
    archiveCreator.reset();

    // Preserve original creation date when re-exporting a loaded archive
    if (state.archiveManifest?._creation_date) {
        archiveCreator.preserveCreationDate(state.archiveManifest._creation_date);
    }

    // Get metadata from metadata panel
    log.info(' Collecting metadata');
    const metadata = metadataFns.collectMetadata();
    log.info(' Metadata collected:', metadata);

    // Inject current measurement calibration into viewer settings
    const ms = deps.sceneRefs?.measurementSystem;
    if (ms && ms.isCalibrated && ms.isCalibrated()) {
        metadata.viewerSettings.measurementScale = ms.getScale();
        metadata.viewerSettings.measurementUnit = ms.getUnit();
    }

    // Inject current rendering preset into viewer settings
    if (deps.state.renderingPreset) {
        metadata.viewerSettings.renderingPreset = deps.state.renderingPreset;
    }

    // Get export options
    const formatRadio = document.querySelector('input[name="export-format"]:checked') as HTMLInputElement | null;
    const format = (formatRadio?.value === 'zip' ? 'zip' : 'ddim') as 'ddim' | 'zip';
    // Preview image and integrity hashes are always included
    const includePreview = true;
    const includeHashes = true;
    log.info(' Export options:', { format, includePreview, includeHashes });

    // Validate title is set
    if (!metadata.project.title) {
        log.info(' No title set, showing metadata panel');
        notify.warning('Please enter a project title in the metadata panel before exporting.');
        ui.showMetadataPanel();
        return null;
    }

    // SIP compliance validation
    const profile = getActiveProfile();
    const sipResult = validateSIP(metadata, profile, VALIDATION_RULES);

    if (sipResult.errors.length > 0 || sipResult.warnings.length > 0) {
        const proceed = await showComplianceDialog(sipResult);
        if (!proceed) {
            ui.showMetadataPanel();
            return null;
        }
    }
    const overridden = sipResult.errors.length > 0;
    const compliance = toManifestCompliance(sipResult, overridden);

    // Apply project info
    log.info(' Setting project info');
    archiveCreator.setProjectInfo(metadata.project);

    // Apply provenance
    log.info(' Setting provenance');
    archiveCreator.setProvenance(metadata.provenance);

    // Apply relationships
    log.info(' Setting relationships');
    archiveCreator.setRelationships(metadata.relationships);

    // Apply quality metrics
    log.info(' Setting quality metrics');
    archiveCreator.setQualityMetrics(metadata.qualityMetrics);

    // Apply archival record
    log.info(' Setting archival record');
    archiveCreator.setArchivalRecord(metadata.archivalRecord);

    // Apply material standard
    log.info(' Setting material standard');
    archiveCreator.setMaterialStandard(metadata.materialStandard);

    // Apply preservation
    log.info(' Setting preservation');
    archiveCreator.setPreservation(metadata.preservation);

    // Apply viewer settings
    log.info(' Setting viewer settings');
    archiveCreator.setViewerSettings(metadata.viewerSettings);

    // Apply custom fields
    if (Object.keys(metadata.customFields).length > 0) {
        log.info(' Setting custom fields');
        archiveCreator.setCustomFields(metadata.customFields);
    }

    // Apply version history
    if (metadata.versionHistory && metadata.versionHistory.length > 0) {
        log.info(' Setting version history');
        archiveCreator.setVersionHistory(metadata.versionHistory);
    }

    // Read which assets the user wants to include
    const includeSplat = (document.getElementById('archive-include-splat') as HTMLInputElement)?.checked;
    const includeModel = (document.getElementById('archive-include-model') as HTMLInputElement)?.checked;
    const includePointcloud = (document.getElementById('archive-include-pointcloud') as HTMLInputElement)?.checked;
    const includeAnnotations = (document.getElementById('archive-include-annotations') as HTMLInputElement)?.checked;

    // Add splat if loaded and selected
    log.info(' Checking splat:', { splatBlob: !!assets.splatBlob, splatLoaded: state.splatLoaded });
    // If the full-res blob is missing (SD proxy, or blob was reset), extract it on demand now
    if (includeSplat && state.splatLoaded && !assets.splatBlob && state.archiveLoader) {
        const sceneEntry = state.archiveLoader.getSceneEntry();
        if (sceneEntry) {
            const fullData = await state.archiveLoader.extractFile(sceneEntry.file_name);
            if (fullData) assets.splatBlob = fullData.blob;
        }
    }
    if (includeSplat && assets.splatBlob && state.splatLoaded) {
        const fileName = document.getElementById('splat-filename')?.textContent || 'scene.ply';
        const position = pos(splatMesh);
        const rotation = rot(splatMesh);
        const scale = scl(splatMesh);

        // Export-time LOD: transcode to LOD-ordered SPZ if enabled and format supports it
        const splatExt = fileName.split('.').pop()?.toLowerCase() || '';
        const lodCompatible = ['spz', 'ply', 'splat', 'ksplat'].includes(splatExt);
        let splatBlobToArchive = assets.splatBlob;
        let archiveFileName = fileName;

        if (state.splatLodEnabled && lodCompatible && splatExt !== 'spz') {
            try {
                log.info('Generating splat LOD for archive export...');
                deps.ui.showLoading('Generating splat LOD...', true);

                const fileBytes = new Uint8Array(await assets.splatBlob.arrayBuffer());
                const spzBytes = await transcodeSpzInWorker(fileBytes, splatExt);

                splatBlobToArchive = new Blob([spzBytes as BlobPart], { type: 'application/octet-stream' });
                // Change extension to .spz for the archive
                archiveFileName = fileName.replace(/\.[^.]+$/, '.spz');
                log.info(`Splat LOD generated: ${fileBytes.length} -> ${spzBytes.length} bytes (${archiveFileName})`);
            } catch (lodError: unknown) {
                const message = lodError instanceof Error ? lodError.message : String(lodError);
                log.warn('Splat LOD generation failed, using original file:', message);
                notify.warning('Splat LOD generation failed — exporting original file.');
            } finally {
                deps.ui.hideLoading();
            }
        } else if (state.splatLodEnabled && splatExt === 'spz') {
            log.info('Splat LOD skipped: input is already .spz');
        } else if (state.splatLodEnabled && !lodCompatible) {
            log.info(`Splat LOD skipped: .${splatExt} not supported (use .spz or .ply)`);
        }

        log.info(' Adding scene:', { fileName: archiveFileName, position, rotation, scale });
        archiveCreator.addScene(splatBlobToArchive, archiveFileName, {
            position, rotation, scale,
            created_by: metadata.splatMetadata.createdBy || 'unknown',
            created_by_version: metadata.splatMetadata.version || '',
            source_notes: metadata.splatMetadata.sourceNotes || '',
            role: metadata.splatMetadata.role || ''
        });
    }

    // Track the final mesh blob (post-compression if applied) for accurate quality stats
    let finalMeshBlob: Blob | null = null;

    // Add mesh if loaded and selected
    log.info(' Checking mesh:', { meshBlob: !!assets.meshBlob, modelLoaded: state.modelLoaded });
    // If the full-res blob is missing (SD proxy, or blob was reset), extract it on demand now
    if (includeModel && state.modelLoaded && !assets.meshBlob && state.archiveLoader) {
        const meshEntry = state.archiveLoader.getMeshEntry();
        if (meshEntry) {
            const fullData = await state.archiveLoader.extractFile(meshEntry.file_name);
            if (fullData) assets.meshBlob = fullData.blob;
        }
    }
    if (includeModel && assets.meshBlob && state.modelLoaded) {
        const fileName = state._meshFileName || document.getElementById('model-filename')?.textContent || 'mesh.glb';
        const position = pos(modelGroup);
        const rotation = rot(modelGroup);
        const scale = scl(modelGroup);

        let meshBlob = assets.meshBlob;
        const dracoHdEl = document.getElementById('export-draco-hd') as HTMLInputElement | null;
        const shouldDracoHD = dracoHdEl?.checked ?? false;
        if (shouldDracoHD && fileName.toLowerCase().endsWith('.glb')) {
            meshBlob = await dracoCompressGLB(meshBlob);
        }
        finalMeshBlob = meshBlob;

        log.info(' Adding mesh:', { fileName, position, rotation, scale });
        archiveCreator.addMesh(meshBlob, fileName, {
            position, rotation, scale,
            created_by: metadata.meshMetadata.createdBy || 'unknown',
            created_by_version: metadata.meshMetadata.version || '',
            source_notes: metadata.meshMetadata.sourceNotes || '',
            role: metadata.meshMetadata.role || '',
            parameters: state.meshOptimized && state.meshOptimizationSettings ? {
                web_optimization: {
                    originalFaces: state.meshOptimizationSettings.originalFaces,
                    resultFaces: state.meshOptimizationSettings.resultFaces,
                    dracoCompressed: state.meshOptimizationSettings.dracoEnabled,
                }
            } : undefined,
        });
    }

    // Re-extract proxy mesh blob from archive if not already in the store
    if (includeModel && !assets.proxyMeshBlob && state.archiveLoader) {
        const proxyMeshEntry = state.archiveLoader.getMeshProxyEntry();
        if (proxyMeshEntry) {
            const proxyData = await state.archiveLoader.extractFile(proxyMeshEntry.file_name);
            if (proxyData) assets.proxyMeshBlob = proxyData.blob;
        }
    }

    // Add display proxy mesh if available
    if (includeModel && assets.proxyMeshBlob) {
        const proxyFileName = document.getElementById('proxy-mesh-filename')?.textContent || 'mesh_proxy.glb';
        const position = pos(modelGroup);
        const rotation = rot(modelGroup);
        const scale = scl(modelGroup);

        log.info(' Adding mesh proxy:', { proxyFileName });
        archiveCreator.addMeshProxy(assets.proxyMeshBlob, proxyFileName, {
            position, rotation, scale,
            derived_from: 'mesh_0',
            face_count: state.proxyMeshFaceCount || undefined,
            decimation: state.proxyMeshSettings ? {
                preset: state.proxyMeshSettings.preset,
                targetRatio: state.proxyMeshSettings.targetRatio,
                errorThreshold: state.proxyMeshSettings.errorThreshold,
                textureMaxRes: state.proxyMeshSettings.textureMaxRes,
                textureFormat: state.proxyMeshSettings.textureFormat,
                originalFaces: state.meshFaceCount || 0,
                resultFaces: state.proxyMeshFaceCount || 0,
            } : undefined,
        });
    }

    // Re-extract proxy splat blob from archive if not already in the store
    if (!assets.proxySplatBlob && state.archiveLoader) {
        const proxySplatEntry = state.archiveLoader.getSceneProxyEntry();
        if (proxySplatEntry) {
            const proxyData = await state.archiveLoader.extractFile(proxySplatEntry.file_name);
            if (proxyData) assets.proxySplatBlob = proxyData.blob;
        }
    }

    // Add display proxy splat if available
    if (assets.proxySplatBlob) {
        const proxySplatFileName = document.getElementById('proxy-splat-filename')?.textContent || 'scene_proxy.spz';
        const splatPosition = pos(splatMesh);
        const splatRotation = rot(splatMesh);
        const splatScale = scl(splatMesh);

        log.info(' Adding splat proxy:', { proxySplatFileName });
        archiveCreator.addSceneProxy(assets.proxySplatBlob, proxySplatFileName, {
            position: splatPosition, rotation: splatRotation, scale: splatScale,
            derived_from: 'scene_0'
        });
    }

    // Add point cloud if loaded and selected
    log.info(' Checking pointcloud:', { pointcloudBlob: !!assets.pointcloudBlob, pointcloudLoaded: state.pointcloudLoaded });
    if (includePointcloud && assets.pointcloudBlob && state.pointcloudLoaded) {
        const fileName = document.getElementById('pointcloud-filename')?.textContent || 'pointcloud.e57';
        const position = pos(pointcloudGroup);
        const rotation = rot(pointcloudGroup);
        const scale = scl(pointcloudGroup);

        log.info(' Adding pointcloud:', { fileName, position, rotation, scale });
        archiveCreator.addPointcloud(assets.pointcloudBlob, fileName, {
            position, rotation, scale,
            created_by: metadata.pointcloudMetadata?.createdBy || 'unknown',
            created_by_version: metadata.pointcloudMetadata?.version || '',
            source_notes: metadata.pointcloudMetadata?.sourceNotes || '',
            role: metadata.pointcloudMetadata?.role || ''
        });
    }

    // Add CAD if loaded
    if (assets.cadBlob && state.cadLoaded) {
        const cadFileName = getStore().cadFileName || document.getElementById('cad-filename')?.textContent || 'model.step';
        const position = pos(cadGroup);
        const rotation = rot(cadGroup);
        const scale = scl(cadGroup);

        log.info(' Adding CAD:', { cadFileName, position, rotation, scale });
        archiveCreator.addCAD(assets.cadBlob, cadFileName, { position, rotation, scale });
    }

    // Add flight paths if loaded
    if (state.flightPathLoaded && assets.flightPathBlobs.length > 0) {
        log.info(` Adding ${assets.flightPathBlobs.length} flight path(s)`);
        for (let i = 0; i < assets.flightPathBlobs.length; i++) {
            const fp = assets.flightPathBlobs[i];
            const position = pos(flightPathGroup);
            const rotation = rot(flightPathGroup);
            const scale = scl(flightPathGroup);
            const flightMeta: Record<string, unknown> = {};
            if (fp.trimStart !== undefined) flightMeta.trim_start = fp.trimStart;
            if (fp.trimEnd !== undefined) flightMeta.trim_end = fp.trimEnd;
            archiveCreator.addFlightPath(fp.blob, fp.fileName, { position, rotation, scale, flightMeta });
        }
    }

    // Add colmap data if loaded and checkbox is checked
    const includeColmap = (document.getElementById('chk-export-camera-data') as HTMLInputElement)?.checked ?? false;
    const colmapGroup = sceneRefs.colmapGroup;
    if (state.colmapLoaded && assets.colmapBlobs.length > 0 && includeColmap) {
        log.info(` Adding ${assets.colmapBlobs.length} colmap SfM dataset(s)`);
        for (const { camerasBlob, imagesBlob, points3DBuffer } of assets.colmapBlobs) {
            const position = pos(colmapGroup);
            const rotation = rot(colmapGroup);
            const scale = scl(colmapGroup);
            const points3DBlob = points3DBuffer ? new Blob([points3DBuffer]) : undefined;
            archiveCreator.addColmap(camerasBlob, imagesBlob, { position, rotation, scale, points3DBlob });
        }
    }

    // Bundle HDR environment if one is loaded
    if (state.environmentBlob) {
        archiveCreator.addEnvironment(state.environmentBlob, 'environment_0.hdr');
        log.info(' Adding HDR environment');
    }

    // Save global alignment — definitive scene state for re-import
    archiveCreator.setAlignment({
        splat: splatMesh ? {
            position: [splatMesh.position.x, splatMesh.position.y, splatMesh.position.z],
            rotation: [splatMesh.rotation.x, splatMesh.rotation.y, splatMesh.rotation.z],
            scale: [splatMesh.scale.x, splatMesh.scale.y, splatMesh.scale.z]
        } : null,
        model: modelGroup ? {
            position: [modelGroup.position.x, modelGroup.position.y, modelGroup.position.z],
            rotation: [modelGroup.rotation.x, modelGroup.rotation.y, modelGroup.rotation.z],
            scale: [modelGroup.scale.x, modelGroup.scale.y, modelGroup.scale.z]
        } : null,
        pointcloud: pointcloudGroup ? {
            position: [pointcloudGroup.position.x, pointcloudGroup.position.y, pointcloudGroup.position.z],
            rotation: [pointcloudGroup.rotation.x, pointcloudGroup.rotation.y, pointcloudGroup.rotation.z],
            scale: [pointcloudGroup.scale.x, pointcloudGroup.scale.y, pointcloudGroup.scale.z]
        } : null,
        camera: [camera.position.x, camera.position.y, camera.position.z],
        target: controls ? [controls.target.x, controls.target.y, controls.target.z] : [0, 0, 0]
    });

    // Add annotations if selected
    if (includeAnnotations && annotationSystem && annotationSystem.hasAnnotations()) {
        log.info(' Adding annotations');
        archiveCreator.setAnnotations(annotationSystem.toJSON());
    }

    // Add walkthrough if present
    const walkthroughData = captureWalkthroughForArchive();
    if (walkthroughData) {
        log.info(' Adding walkthrough');
        archiveCreator.setWalkthrough(walkthroughData);
    }

    // Add embedded images
    if (state.imageAssets.size > 0) {
        log.info(` Adding ${state.imageAssets.size} embedded images`);
        for (const [path, asset] of state.imageAssets) {
            archiveCreator.addImage(asset.blob, path);
        }
    }

    // Add user-added source files (have blobs, not from archive)
    const sourceFilesWithBlobs = assets.sourceFiles.filter((sf: any) => sf.file && !sf.fromArchive);
    if (sourceFilesWithBlobs.length > 0) {
        const totalSourceSize = sourceFilesWithBlobs.reduce((sum: number, sf: any) => sum + sf.size, 0);
        if (totalSourceSize > 2 * 1024 * 1024 * 1024) {
            notify.warning(`Source files total ${formatFileSize(totalSourceSize)}. Very large archives may fail in the browser. Consider adding files to the ZIP after export using external tools.`);
        }
        log.info(` Adding ${sourceFilesWithBlobs.length} source files (${formatFileSize(totalSourceSize)})`);
        for (const sf of sourceFilesWithBlobs) {
            archiveCreator.addSourceFile(sf.file, sf.name, { category: sf.category });
        }
    }

    // Re-extract source files from the loaded archive (raw data retained for this purpose)
    if (state.archiveLoader && state.archiveLoader.hasSourceFiles()) {
        const archiveSourceEntries = state.archiveLoader.getSourceFileEntries();
        for (const { entry } of archiveSourceEntries) {
            try {
                const data = await state.archiveLoader.extractFile(entry.file_name);
                if (data) {
                    archiveCreator.addSourceFile(data.blob, entry.original_name || entry.file_name.split('/').pop(), {
                        category: entry.source_category || ''
                    });
                }
            } catch (e: any) {
                log.warn('Failed to re-extract source file:', entry.file_name, e.message);
            }
        }
    }

    // Re-extract detail models from the loaded archive
    if (state.archiveLoader && state.detailAssetIndex && state.detailAssetIndex.size > 0) {
        for (const [_key, { filename }] of state.detailAssetIndex) {
            try {
                const data = await state.archiveLoader.extractFile(filename);
                if (data) {
                    archiveCreator.addDetailModel(data.blob, filename.split('/').pop() || filename);
                }
            } catch (e: any) {
                log.warn('Failed to re-extract detail model:', filename, e.message);
            }
        }
    }

    // Apply metadata profile
    archiveCreator.setMetadataProfile(getActiveProfile());

    // Stamp SIP compliance record
    archiveCreator.setCompliance(compliance);

    // Set quality stats
    log.info(' Setting quality stats');
    archiveCreator.setQualityStats({
        splat_count: (includeSplat && state.splatLoaded) ? parseInt((document.getElementById('splat-vertices')?.textContent || '0').replace(/,/g, '')) || 0 : 0,
        mesh_polygons: (includeModel && state.modelLoaded) ? parseInt((document.getElementById('model-faces')?.textContent || '0').replace(/,/g, '')) || 0 : 0,
        mesh_vertices: (includeModel && state.modelLoaded) ? (state.meshVertexCount || 0) : 0,
        splat_file_size: (includeSplat && assets.splatBlob) ? assets.splatBlob.size : 0,
        mesh_file_size: (includeModel && finalMeshBlob) ? finalMeshBlob.size : 0,
        pointcloud_points: (includePointcloud && state.pointcloudLoaded) ? parseInt(document.getElementById('pointcloud-points')?.textContent?.replace(/,/g, '') || '0') || 0 : 0,
        pointcloud_file_size: (includePointcloud && assets.pointcloudBlob) ? assets.pointcloudBlob.size : 0,
        texture_count: (includeModel && state.modelLoaded && state.meshTextureInfo) ? state.meshTextureInfo.count : 0,
        texture_max_resolution: (includeModel && state.modelLoaded && state.meshTextureInfo) ? state.meshTextureInfo.maxResolution : 0,
        texture_maps: (includeModel && state.modelLoaded && state.meshTextureInfo) ? state.meshTextureInfo.maps : []
    });

    // Add preview/thumbnail
    if (includePreview && renderer) {
        // Hide grid helpers so they don't appear in preview images
        const hiddenGrids: any[] = [];
        for (const child of scene.children) {
            if (child.type === 'GridHelper' && child.visible) {
                child.visible = false;
                hiddenGrids.push(child);
            }
        }
        try {
            let previewBlob;
            if (state.manualPreviewBlob) {
                log.info(' Using manual preview');
                previewBlob = state.manualPreviewBlob;
            } else {
                log.info(' Auto-capturing preview screenshot');
                renderer.render(scene, camera);
                previewBlob = await captureScreenshot(renderer.domElement, { width: 512, height: 512 });
            }
            if (previewBlob) {
                log.info(' Preview captured, adding thumbnail');
                archiveCreator.addThumbnail(previewBlob, 'preview.jpg');
            }
        } catch (e) {
            log.warn(' Failed to capture preview:', e);
        } finally {
            for (const child of hiddenGrids) {
                child.visible = true;
            }
        }
    }

    // Add screenshots
    if (state.screenshots.length > 0) {
        log.info(` Adding ${state.screenshots.length} screenshot(s) to archive`);
        for (const screenshot of state.screenshots) {
            try {
                archiveCreator.addScreenshot(screenshot.blob, `screenshot_${screenshot.id}.jpg`);
            } catch (e) {
                log.warn(' Failed to add screenshot:', e);
            }
        }
    }

    // Validate
    log.info(' Validating archive');
    const validation = archiveCreator.validate();
    log.info(' Validation result:', validation);
    if (!validation.valid) {
        notify.error('Cannot create archive: ' + validation.errors.join('; '));
        return null;
    }

    // Strip any existing archive extension from the ID to prevent double extensions
    // (e.g., "project.ddim" → "project" so the final name is "project.ddim" not "project.ddim.ddim")
    const rawFilename = metadata.project.id || 'archive';
    const archiveExts = /\.(ddim|a3d|a3z|zip)$/i;
    const filename = rawFilename.replace(archiveExts, '');

    return {
        filename,
        format,
        includeHashes
    };
}

/**
 * Create and download an archive (.ddim/.zip) with all selected assets.
 */
export async function downloadArchive(deps: ExportDeps): Promise<void> {
    let prepared: PreparedArchive | null;
    try {
        prepared = await prepareArchive(deps);
    } catch (e: any) {
        log.error('Archive preparation failed:', e);
        notify.error('Archive preparation failed: ' + e.message);
        deps.ui.hideLoading();
        return;
    }
    if (!prepared) return;

    const { archiveCreator } = deps.sceneRefs;
    if (!archiveCreator) return;

    log.info(' Starting archive creation');
    deps.ui.showLoading('Creating archive...', true);
    try {
        await archiveCreator.downloadArchive(
            {
                filename: prepared.filename,
                format: prepared.format,
                includeHashes: prepared.includeHashes
            },
            (percent: number, stage: string) => {
                deps.ui.updateProgress(percent, stage);
            }
        );
        log.info(' Archive download complete');
        deps.ui.hideLoading();
        deps.ui.hideExportPanel();
    } catch (e: any) {
        deps.ui.hideLoading();
        log.error(' Error creating archive:', e);
        notify.error('Error creating archive: ' + e.message);
    }
}

/**
 * Create an archive and save it directly to the server library via /api/archives.
 */
export async function saveToLibrary(deps: ExportDeps): Promise<void> {
    let prepared: PreparedArchive | null;
    try {
        prepared = await prepareArchive(deps);
    } catch (e: any) {
        log.error('Archive preparation failed:', e);
        notify.error('Archive preparation failed: ' + e.message);
        deps.ui.hideLoading();
        return;
    }
    if (!prepared) return;

    const { archiveCreator } = deps.sceneRefs;
    if (!archiveCreator) return;

    const creds = getAuthCredentials();
    // Ensure we have a fresh CSRF token before starting the upload
    if (!getCsrfToken()) await fetchCsrfToken();

    log.info(' Starting save to library');
    deps.ui.showLoading('Creating archive...', true);

    try {
        // Create the archive blob (0-80% progress)
        const blob = await archiveCreator.createArchive(
            { format: prepared.format, includeHashes: prepared.includeHashes },
            (percent: number, stage: string) => {
                deps.ui.updateProgress(Math.round(percent * 0.8), stage);
            }
        );

        const filename = `${prepared.filename}.${prepared.format}`;
        deps.ui.updateProgress(82, 'Uploading to library...');

        // Upload via XHR for progress tracking
        const csrf = getCsrfToken();
        const csrfHeaders: Record<string, string> = {};
        if (creds) csrfHeaders['Authorization'] = 'Basic ' + creds;
        if (csrf) csrfHeaders['X-CSRF-Token'] = csrf;

        const chunkedEnabled = (window as unknown as { APP_CONFIG?: { chunkedUpload?: boolean } }).APP_CONFIG?.chunkedUpload;
        if (chunkedEnabled && blob.size > CHUNK_SIZE) {
            // Chunked upload — split into 50 MB pieces to stay under Cloudflare's 100 MB request limit
            const totalChunks = Math.ceil(blob.size / CHUNK_SIZE);
            const uploadId = crypto.randomUUID();

            const chunkBytes = new Array<number>(totalChunks).fill(0);
            const uploadChunk = (i: number) => new Promise<void>((resolve, reject) => {
                const start = i * CHUNK_SIZE;
                const end = Math.min(start + CHUNK_SIZE, blob.size);
                const chunk = blob.slice(start, end);
                const params = new URLSearchParams({
                    uploadId, chunkIndex: String(i), totalChunks: String(totalChunks), filename
                });
                const xhr = new XMLHttpRequest();
                xhr.upload.addEventListener('progress', (e) => {
                    if (e.lengthComputable) {
                        chunkBytes[i] = e.loaded;
                        const pct = Math.round((chunkBytes.reduce((s, b) => s + b, 0) / blob.size) * 100);
                        deps.ui.updateProgress(82 + Math.round(pct * 0.16), 'Uploading to library...');
                    }
                });
                xhr.addEventListener('load', () => {
                    if (xhr.status >= 200 && xhr.status < 300) {
                        chunkBytes[i] = end - start;
                        resolve();
                    } else {
                        let msg = `Chunk ${i + 1}/${totalChunks} failed`;
                        try { msg = JSON.parse(xhr.responseText).error || msg; } catch { /* ignore */ }
                        reject(new Error(msg));
                    }
                });
                xhr.addEventListener('error', () => reject(new Error('Network error during upload')));
                xhr.open('POST', '/api/archives/chunks?' + params.toString());
                xhr.withCredentials = true;
                if (creds) xhr.setRequestHeader('Authorization', 'Basic ' + creds);
                if (csrf) xhr.setRequestHeader('X-CSRF-Token', csrf);
                xhr.setRequestHeader('Content-Type', 'application/octet-stream');
                xhr.send(chunk);
            });
            let nextChunk = 0;
            const worker = async () => { while (nextChunk < totalChunks) await uploadChunk(nextChunk++); };
            await Promise.all(Array.from({ length: Math.min(CHUNK_CONCURRENCY, totalChunks) }, worker));

            // Trigger assembly; on 409 (file exists) delete and retry
            const doComplete = () => fetch('/api/archives/chunks/' + uploadId + '/complete', {
                method: 'POST', credentials: 'include',
                headers: csrfHeaders
            });
            let completeRes = await doComplete();
            if (completeRes.status === 409) {
                const delRes = await fetch('/api/archives/' + encodeURIComponent(filename), {
                    method: 'DELETE', credentials: 'include',
                    headers: csrfHeaders
                });
                if (!delRes.ok) throw new Error('Archive already exists and could not be overwritten');
                completeRes = await doComplete();
            }
            if (!completeRes.ok) {
                let msg = completeRes.statusText;
                try { const d = await completeRes.json(); msg = (d as { error?: string }).error || msg; } catch { /* ignore */ }
                throw new Error(msg);
            }
        } else {
            // Single upload
            await new Promise<void>((resolve, reject) => {
                const xhr = new XMLHttpRequest();
                const form = new FormData();
                form.append('file', blob, filename);

                xhr.upload.addEventListener('progress', (e) => {
                    if (e.lengthComputable) {
                        const uploadPct = Math.round((e.loaded / e.total) * 100);
                        deps.ui.updateProgress(82 + Math.round(uploadPct * 0.16), 'Uploading to library...');
                    }
                });

                xhr.addEventListener('load', () => {
                    if (xhr.status >= 200 && xhr.status < 300) {
                        resolve();
                    } else if (xhr.status === 409) {
                        // File exists — try overwrite (delete + re-upload)
                        const retryXhr = new XMLHttpRequest();
                        fetch('/api/archives/' + encodeURIComponent(filename), {
                            method: 'DELETE',
                            credentials: 'include',
                            headers: csrfHeaders
                        }).then(delRes => {
                            if (!delRes.ok) {
                                reject(new Error('Archive already exists and could not be overwritten'));
                                return;
                            }
                            // Re-upload after delete
                            const retryForm = new FormData();
                            retryForm.append('file', blob, filename);
                            retryXhr.addEventListener('load', () => {
                                if (retryXhr.status >= 200 && retryXhr.status < 300) resolve();
                                else reject(new Error('Re-upload failed: ' + retryXhr.statusText));
                            });
                            retryXhr.addEventListener('error', () => reject(new Error('Re-upload network error')));
                            retryXhr.open('POST', '/api/archives');
                            retryXhr.withCredentials = true;
                            if (creds) retryXhr.setRequestHeader('Authorization', 'Basic ' + creds);
                            if (csrf) retryXhr.setRequestHeader('X-CSRF-Token', csrf);
                            retryXhr.send(retryForm);
                        }).catch(reject);
                    } else {
                        let msg = xhr.statusText;
                        try { msg = JSON.parse(xhr.responseText).error || msg; } catch { /* ignore */ }
                        reject(new Error(msg));
                    }
                });

                xhr.addEventListener('error', () => reject(new Error('Network error during upload')));

                xhr.open('POST', '/api/archives');
                xhr.withCredentials = true;
                if (creds) xhr.setRequestHeader('Authorization', 'Basic ' + creds);
                if (csrf) xhr.setRequestHeader('X-CSRF-Token', csrf);
                xhr.send(form);
            });
        }

        deps.ui.updateProgress(100, 'Saved');
        deps.ui.hideLoading();
        deps.ui.hideExportPanel();
        notify.success(`Saved to library: ${filename}`);

        // Refresh library panel if it has been opened
        refreshLibrary().catch(() => { /* ignore if library not initialized */ });

    } catch (e: any) {
        deps.ui.hideLoading();
        log.error(' Error saving to library:', e);
        notify.error('Error saving to library: ' + e.message);
    }
}
/**
 * Toggle "Save to Library" button visibility based on selected export format.
 * .ddim shows it (if library is configured), .zip hides it (local download only).
 */
export function setupExportFormatToggle(): void {
    const radios = document.querySelectorAll('input[name="export-format"]');
    const saveBtn = document.getElementById('btn-save-to-library');
    if (!saveBtn) return;

    radios.forEach(radio => {
        radio.addEventListener('change', () => {
            const selected = (document.querySelector('input[name="export-format"]:checked') as HTMLInputElement)?.value;
            if (selected === 'zip') {
                saveBtn.dataset.hiddenByFormat = saveBtn.style.display !== 'none' ? 'true' : '';
                saveBtn.style.display = 'none';
            } else if (saveBtn.dataset.hiddenByFormat === 'true') {
                saveBtn.style.display = '';
                delete saveBtn.dataset.hiddenByFormat;
            }
        });
    });
}

/**
 * Export metadata as a standalone JSON manifest file.
 */
export async function exportMetadataManifest(deps: ExportDeps): Promise<void> {
    const { sceneRefs, state, tauriBridge, metadata: metadataFns } = deps;
    const { annotationSystem } = sceneRefs;

    // Use a temporary ArchiveCreator to produce consistent snake_case output
    const { ArchiveCreator } = await import('./archive-creator.js');
    const tempCreator = new ArchiveCreator();

    // Preserve original creation date if re-exporting
    if (state.archiveManifest?._creation_date) {
        tempCreator.preserveCreationDate(state.archiveManifest._creation_date);
    }

    const metadata = metadataFns.collectMetadata();

    // Inject current measurement calibration into viewer settings
    const ms = deps.sceneRefs?.measurementSystem;
    if (ms && ms.isCalibrated && ms.isCalibrated()) {
        metadata.viewerSettings.measurementScale = ms.getScale();
        metadata.viewerSettings.measurementUnit = ms.getUnit();
    }

    // Inject current rendering preset into viewer settings
    if (deps.state.renderingPreset) {
        metadata.viewerSettings.renderingPreset = deps.state.renderingPreset;
    }

    tempCreator.applyMetadata(metadata);
    tempCreator.setMetadataProfile(getActiveProfile());

    // Include annotations if present
    if (annotationSystem && annotationSystem.hasAnnotations()) {
        tempCreator.setAnnotations(annotationSystem.toJSON());
    }

    const json = tempCreator.generateManifest();
    const blob = new Blob([json], { type: 'application/json' });
    if (tauriBridge) {
        await tauriBridge.download(blob, 'manifest.json', { name: 'JSON Files', extensions: ['json'] });
    } else {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'manifest.json';
        a.click();
        URL.revokeObjectURL(url);
    }
    notify.success('Manifest exported');
}

/**
 * Import metadata from a JSON manifest file.
 */
export function importMetadataManifest(deps: ExportDeps): void {
    const { metadata: metadataFns } = deps;

    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.addEventListener('change', (e: Event) => {
        const file = (e.target as HTMLInputElement).files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (event) => {
            try {
                const manifest = JSON.parse(event.target!.result as string);
                metadataFns.prefillMetadataFromArchive(manifest);

                // Load annotations if present in manifest
                if (manifest.annotations && Array.isArray(manifest.annotations) && manifest.annotations.length > 0) {
                    metadataFns.loadAnnotationsFromArchive(manifest.annotations);
                }

                metadataFns.populateMetadataDisplay();
                notify.success('Manifest imported');
            } catch (err: any) {
                log.error('Failed to parse manifest:', err);
                notify.error('Invalid manifest file: ' + err.message);
            }
        };
        reader.readAsText(file);
    });
    input.click();
}
