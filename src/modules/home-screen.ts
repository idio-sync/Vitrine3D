/**
 * Home Screen Module — stub
 *
 * The home screen is now handled by the kiosk file picker in kiosk-main.ts.
 * When APP_CONFIG.home is true and VITE_APP_LIBRARY_URL is set, the file picker
 * shows a "Browse Library" button above the drop zone.
 *
 * This module exists to keep the kiosk-web.ts boot sequence working.
 */

/** Always returns false — home screen is rendered by kiosk-main's file picker. */
export async function initHomeScreen(): Promise<boolean> {
    return false;
}
