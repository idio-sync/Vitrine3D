/**
 * Tauri Auth Module
 *
 * Stores the CF Access JWT obtained via deep-link auth flow.
 * Provides cfAuthFetch() which wraps fetch() with the JWT header
 * and prepends the library base URL for relative paths.
 */

import { Logger } from './utilities.js';

const log = Logger.getLogger('tauri-auth');

let cfToken: string | null = null;

const libraryBaseUrl = (import.meta.env.VITE_APP_LIBRARY_URL as string | undefined) || '';

export function setCfToken(token: string): void {
    cfToken = token;
    log.info('CF Access token stored');
}

export function getCfToken(): string | null {
    return cfToken;
}

export function hasCfToken(): boolean {
    return cfToken !== null && cfToken.length > 0;
}

export function clearCfToken(): void {
    cfToken = null;
    log.info('CF Access token cleared');
}

/**
 * Fetch wrapper that adds the CF Access JWT header and prepends
 * the library base URL for relative paths (e.g. /api/archives).
 * Falls back to plain fetch when no token is stored.
 */
export async function cfAuthFetch(url: string, opts: RequestInit = {}): Promise<Response> {
    const fullUrl = (url.startsWith('/') && libraryBaseUrl) ? libraryBaseUrl + url : url;

    const headers: Record<string, string> = {
        ...(opts.headers as Record<string, string> || {}),
    };
    if (cfToken) {
        headers['Cf-Access-Jwt-Assertion'] = cfToken;
    }

    const res = await fetch(fullUrl, { ...opts, headers });

    if (res.status === 401 && cfToken) {
        log.warn('API returned 401 — clearing expired CF token');
        clearCfToken();
    }

    return res;
}

/** Returns the configured library base URL (e.g. https://jakemarino.fyi) */
export function getLibraryBaseUrl(): string {
    return libraryBaseUrl;
}
