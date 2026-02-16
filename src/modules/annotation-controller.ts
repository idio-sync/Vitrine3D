/**
 * Annotation Controller Module
 *
 * Handles annotation creation, editing, selection, and UI management
 * for the main editor mode. Extracted from main.js for modularity.
 *
 * Deps shape: { annotationSystem, showAnnotationPopup(annotation), hideAnnotationPopup() }
 */

import { Logger } from './utilities.js';
import type { Annotation } from '@/types.js';

const log = Logger.getLogger('annotation-controller');

// =============================================================================
// TYPES
// =============================================================================

interface AnnotationControllerDeps {
    annotationSystem: any; // TODO: type when @types/three is installed
    showAnnotationPopup: (annotation: Annotation) => string;
    hideAnnotationPopup: () => void;
}

interface CameraState {
    position: { x: number; y: number; z: number };
    target: { x: number; y: number; z: number };
}

// =============================================================================
// MODULE STATE
// =============================================================================

let currentPopupAnnotationId: string | null = null;

// =============================================================================
// STATE ACCESSORS
// =============================================================================

/**
 * Get the ID of the annotation whose popup is currently shown.
 * Used by the animate loop for popup position updates.
 */
export function getCurrentPopupAnnotationId(): string | null {
    return currentPopupAnnotationId;
}

// =============================================================================
// POPUP MANAGEMENT
// =============================================================================

/**
 * Dismiss the current annotation popup and clear selection state.
 * Used by click-outside and Escape key handlers.
 */
export function dismissPopup(deps: AnnotationControllerDeps): void {
    deps.hideAnnotationPopup();
    currentPopupAnnotationId = null;
}

// =============================================================================
// ANNOTATION SYSTEM CALLBACKS
// =============================================================================

/**
 * Called when a new annotation is placed on the scene.
 */
export function onAnnotationPlaced(
    position: { x: number; y: number; z: number },
    cameraState: CameraState,
    deps: AnnotationControllerDeps
): void {
    const { annotationSystem } = deps;
    log.info('Annotation placed at:', position);

    // Show annotation panel for details entry
    const panel = document.getElementById('annotation-panel');
    if (panel) panel.classList.remove('hidden');

    // Pre-fill position display
    const posDisplay = document.getElementById('anno-pos-display');
    if (posDisplay) {
        posDisplay.textContent = `${position.x.toFixed(2)}, ${position.y.toFixed(2)}, ${position.z.toFixed(2)}`;
    }

    // Generate auto-ID
    const count = annotationSystem ? annotationSystem.getCount() + 1 : 1;
    const idInput = document.getElementById('anno-id') as HTMLInputElement | null;
    if (idInput) idInput.value = `anno_${count}`;

    // Focus title input
    const titleInput = document.getElementById('anno-title') as HTMLInputElement | null;
    if (titleInput) titleInput.focus();
}

/**
 * Called when an annotation marker is clicked/selected.
 */
export function onAnnotationSelected(annotation: Annotation, deps: AnnotationControllerDeps): void {
    const { annotationSystem, showAnnotationPopup, hideAnnotationPopup } = deps;
    log.info('Annotation selected:', annotation.id);

    // Toggle: if clicking already-open annotation, close popup and deselect
    if (currentPopupAnnotationId === annotation.id) {
        hideAnnotationPopup();
        currentPopupAnnotationId = null;
        annotationSystem.selectedAnnotation = null;
        document.querySelectorAll('.annotation-marker.selected').forEach(m => m.classList.remove('selected'));
        document.querySelectorAll('.annotation-chip.active').forEach(c => c.classList.remove('active'));
        return;
    }

    // Update annotations list highlighting
    document.querySelectorAll('.annotation-item').forEach(item => {
        item.classList.toggle('selected', (item as HTMLElement).dataset.annoId === annotation.id);
    });

    // Update annotation chips
    document.querySelectorAll('.annotation-chip').forEach(chip => {
        chip.classList.toggle('active', (chip as HTMLElement).dataset.annoId === annotation.id);
    });

    // Show editor panel (in controls - legacy)
    const editor = document.getElementById('selected-annotation-editor');
    if (editor) {
        editor.classList.remove('hidden');

        const titleInput = document.getElementById('edit-anno-title') as HTMLInputElement | null;
        const bodyInput = document.getElementById('edit-anno-body') as HTMLTextAreaElement | null;
        if (titleInput) titleInput.value = annotation.title || '';
        if (bodyInput) bodyInput.value = annotation.body || '';
    }

    // Update sidebar annotation editor
    showSidebarAnnotationEditor(annotation);

    // Update sidebar list selection
    document.querySelectorAll('#sidebar-annotations-list .annotation-item').forEach(item => {
        item.classList.toggle('selected', (item as HTMLElement).dataset.annoId === annotation.id);
    });

    // Show annotation info popup near the marker
    currentPopupAnnotationId = showAnnotationPopup(annotation);
}

/**
 * Called when placement mode changes.
 */
export function onPlacementModeChanged(active: boolean): void {
    log.info('Placement mode:', active);

    const indicator = document.getElementById('annotation-mode-indicator');
    const btn = document.getElementById('btn-annotate');

    if (indicator) indicator.classList.toggle('hidden', !active);
    if (btn) btn.classList.toggle('active', active);
}

// =============================================================================
// ANNOTATION ACTIONS
// =============================================================================

/**
 * Toggle annotation placement mode.
 */
export function toggleAnnotationMode(deps: AnnotationControllerDeps): void {
    const { annotationSystem } = deps;
    log.info('toggleAnnotationMode called, annotationSystem:', !!annotationSystem);
    if (annotationSystem) {
        annotationSystem.togglePlacementMode();
    } else {
        log.error('annotationSystem is not initialized!');
    }
}

/**
 * Save the pending annotation.
 */
export function saveAnnotation(deps: AnnotationControllerDeps): void {
    const { annotationSystem } = deps;
    if (!annotationSystem) return;

    const idInput = document.getElementById('anno-id') as HTMLInputElement | null;
    const titleInput = document.getElementById('anno-title') as HTMLInputElement | null;
    const bodyInput = document.getElementById('anno-body') as HTMLTextAreaElement | null;

    const id = idInput?.value || '';
    const title = titleInput?.value || '';
    const body = bodyInput?.value || '';

    const annotation = annotationSystem.confirmAnnotation(id, title, body);
    if (annotation) {
        log.info('Annotation saved:', annotation);
        updateAnnotationsUI(deps);
    }

    // Hide panel and clear inputs
    const panel = document.getElementById('annotation-panel');
    if (panel) panel.classList.add('hidden');

    if (idInput) idInput.value = '';
    if (titleInput) titleInput.value = '';
    if (bodyInput) bodyInput.value = '';

    // Disable placement mode after saving
    annotationSystem.disablePlacementMode();
}

/**
 * Cancel annotation placement.
 */
export function cancelAnnotation(deps: AnnotationControllerDeps): void {
    const { annotationSystem } = deps;
    if (annotationSystem) {
        annotationSystem.cancelAnnotation();
    }

    const panel = document.getElementById('annotation-panel');
    if (panel) panel.classList.add('hidden');

    const idInput = document.getElementById('anno-id') as HTMLInputElement | null;
    const titleInput = document.getElementById('anno-title') as HTMLInputElement | null;
    const bodyInput = document.getElementById('anno-body') as HTMLTextAreaElement | null;

    if (idInput) idInput.value = '';
    if (titleInput) titleInput.value = '';
    if (bodyInput) bodyInput.value = '';
}

/**
 * Update camera position for the selected annotation.
 */
export function updateSelectedAnnotationCamera(deps: AnnotationControllerDeps): void {
    const { annotationSystem } = deps;
    if (!annotationSystem || !annotationSystem.selectedAnnotation) return;

    annotationSystem.updateAnnotationCamera(annotationSystem.selectedAnnotation.id);
    log.info('Updated camera for annotation:', annotationSystem.selectedAnnotation.id);
}

/**
 * Delete the selected annotation.
 */
export function deleteSelectedAnnotation(deps: AnnotationControllerDeps): void {
    const { annotationSystem } = deps;
    if (!annotationSystem || !annotationSystem.selectedAnnotation) return;

    const id = annotationSystem.selectedAnnotation.id;
    if (confirm(`Delete annotation "${annotationSystem.selectedAnnotation.title}"?`)) {
        annotationSystem.deleteAnnotation(id);
        updateAnnotationsUI(deps);

        // Hide editor (legacy)
        const editor = document.getElementById('selected-annotation-editor');
        if (editor) editor.classList.add('hidden');

        // Hide sidebar editor
        const sidebarEditor = document.getElementById('sidebar-annotation-editor');
        if (sidebarEditor) sidebarEditor.classList.add('hidden');
    }
}

// =============================================================================
// ANNOTATION UI
// =============================================================================

/**
 * Update annotations UI (list, chips, sidebar).
 */
export function updateAnnotationsUI(deps: AnnotationControllerDeps): void {
    const { annotationSystem, hideAnnotationPopup } = deps;
    if (!annotationSystem) return;

    const annotations: Annotation[] = annotationSystem.getAnnotations();
    const count = annotations.length;

    // Update count badge
    const badge = document.getElementById('annotation-count-badge');
    if (badge) {
        badge.textContent = String(count);
        badge.classList.toggle('hidden', count === 0);
    }

    // Update annotations list
    const list = document.getElementById('annotations-list');
    if (list) {
        list.replaceChildren(); // Clear safely without innerHTML

        if (count === 0) {
            const noAnno = document.createElement('p');
            noAnno.className = 'no-annotations';
            noAnno.textContent = 'No annotations yet. Click "Add Annotation" to create one.';
            list.appendChild(noAnno);
        } else {
            annotations.forEach((anno, index) => {
                const item = document.createElement('div');
                item.className = 'annotation-item';
                item.dataset.annoId = anno.id;

                const number = document.createElement('span');
                number.className = 'annotation-number';
                number.textContent = String(index + 1);

                const title = document.createElement('span');
                title.className = 'annotation-title';
                title.textContent = anno.title || 'Untitled';

                item.appendChild(number);
                item.appendChild(title);

                item.addEventListener('click', () => {
                    annotationSystem.goToAnnotation(anno.id);
                });

                list.appendChild(item);
            });
        }
    }

    // Update annotation bar
    const bar = document.getElementById('annotation-bar');
    const chipsContainer = document.getElementById('annotation-chips');
    if (bar && chipsContainer) {
        bar.classList.toggle('hidden', count === 0);
        chipsContainer.replaceChildren(); // Clear safely without innerHTML

        annotations.forEach((anno, index) => {
            const chip = document.createElement('button');
            chip.className = 'annotation-chip';
            chip.dataset.annoId = anno.id;
            chip.textContent = String(index + 1);
            chip.title = anno.title || 'Untitled';

            chip.addEventListener('click', () => {
                if (currentPopupAnnotationId === anno.id) {
                    hideAnnotationPopup();
                    currentPopupAnnotationId = null;
                    annotationSystem.selectedAnnotation = null;
                    document.querySelectorAll('.annotation-marker.selected').forEach(m => m.classList.remove('selected'));
                    document.querySelectorAll('.annotation-chip.active').forEach(c => c.classList.remove('active'));
                } else {
                    annotationSystem.goToAnnotation(anno.id);
                }
            });

            chipsContainer.appendChild(chip);
        });
    }

    // Also update sidebar annotations list
    updateSidebarAnnotationsList(deps);
}

/**
 * Update sidebar annotations list.
 */
export function updateSidebarAnnotationsList(deps: AnnotationControllerDeps): void {
    const { annotationSystem } = deps;
    if (!annotationSystem) return;

    const annotations: Annotation[] = annotationSystem.getAnnotations();
    const list = document.getElementById('sidebar-annotations-list');
    const editor = document.getElementById('sidebar-annotation-editor');
    const selectedAnno = annotationSystem.selectedAnnotation;

    if (!list) return;

    list.replaceChildren(); // Clear safely without innerHTML

    if (annotations.length === 0) {
        const noAnno = document.createElement('p');
        noAnno.className = 'no-annotations';
        noAnno.textContent = 'No annotations yet. Click "Add Annotation" to place a new marker.';
        list.appendChild(noAnno);
        if (editor) editor.classList.add('hidden');
    } else {
        annotations.forEach((anno, index) => {
            const item = document.createElement('div');
            item.className = 'annotation-item';
            item.dataset.annoId = anno.id;

            if (selectedAnno && selectedAnno.id === anno.id) {
                item.classList.add('selected');
            }

            const number = document.createElement('span');
            number.className = 'annotation-number';
            number.textContent = String(index + 1);

            const title = document.createElement('span');
            title.className = 'annotation-title';
            title.textContent = anno.title || 'Untitled';

            item.appendChild(number);
            item.appendChild(title);

            item.addEventListener('click', () => {
                annotationSystem.goToAnnotation(anno.id);
                // Update selection state
                list.querySelectorAll('.annotation-item').forEach(el => el.classList.remove('selected'));
                item.classList.add('selected');
                // Show editor with selected annotation data
                showSidebarAnnotationEditor(anno);
            });

            list.appendChild(item);
        });

        // Show editor if there's a selection
        if (selectedAnno) {
            showSidebarAnnotationEditor(selectedAnno);
        } else if (editor) {
            editor.classList.add('hidden');
        }
    }
}

/**
 * Show sidebar annotation editor with annotation data.
 */
export function showSidebarAnnotationEditor(annotation: Annotation): void {
    const editor = document.getElementById('sidebar-annotation-editor');
    const titleInput = document.getElementById('sidebar-edit-anno-title') as HTMLInputElement | null;
    const bodyInput = document.getElementById('sidebar-edit-anno-body') as HTMLTextAreaElement | null;

    if (!editor) return;

    if (titleInput) titleInput.value = annotation.title || '';
    if (bodyInput) bodyInput.value = annotation.body || '';

    editor.classList.remove('hidden');
}

/**
 * Load annotations from archive data.
 */
export function loadAnnotationsFromArchive(annotations: Annotation[], deps: AnnotationControllerDeps): void {
    const { annotationSystem } = deps;
    if (!annotationSystem || !annotations || !Array.isArray(annotations)) return;

    log.info('Loading', annotations.length, 'annotations from archive');
    annotationSystem.setAnnotations(annotations);
    updateAnnotationsUI(deps);
    updateSidebarAnnotationsList(deps);
}
