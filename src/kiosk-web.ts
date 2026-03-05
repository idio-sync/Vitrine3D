// Kiosk bundle entry point — imports viewer layer only.
// For the full editor, see src/editor/index.html → main.ts.
import { initCollectionPage } from './modules/collection-page.js';

// If this is a collection page, render the card grid instead of the 3D viewer
initCollectionPage().then(isCollection => {
    if (!isCollection) {
        // Normal kiosk viewer — lazy import to avoid loading viewer code for collection pages
        import('./modules/kiosk-main.js').then(m => m.init());
    }
});
