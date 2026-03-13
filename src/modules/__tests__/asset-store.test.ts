// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { getStore, resetBlobs } from '../asset-store.js';

describe('asset-store', () => {
    beforeEach(() => {
        resetBlobs();
    });

    describe('getStore', () => {
        it('returns the same singleton on every call', () => {
            expect(getStore()).toBe(getStore());
        });

        it('has all expected keys with null defaults', () => {
            const store = getStore();
            expect(store.splatBlob).toBeNull();
            expect(store.meshBlob).toBeNull();
            expect(store.proxyMeshBlob).toBeNull();
            expect(store.proxySplatBlob).toBeNull();
            expect(store.pointcloudBlob).toBeNull();
            expect(store.cadBlob).toBeNull();
            expect(store.cadFileName).toBeNull();
            expect(store.sourceFiles).toEqual([]);
        });
    });

    describe('resetBlobs', () => {
        it('clears all blob references', () => {
            const store = getStore();
            store.splatBlob = new Blob(['test']);
            store.meshBlob = new Blob(['mesh']);
            store.cadBlob = new Blob(['cad']);
            store.cadFileName = 'model.step';
            store.sourceFiles = [{ file: null, name: 'test.obj', size: 100, category: 'mesh', fromArchive: false }];

            resetBlobs();

            expect(store.splatBlob).toBeNull();
            expect(store.meshBlob).toBeNull();
            expect(store.proxyMeshBlob).toBeNull();
            expect(store.proxySplatBlob).toBeNull();
            expect(store.pointcloudBlob).toBeNull();
            expect(store.cadBlob).toBeNull();
            expect(store.cadFileName).toBeNull();
            expect(store.sourceFiles).toEqual([]);
        });

        it('store reference remains the same after reset', () => {
            const storeBefore = getStore();
            storeBefore.splatBlob = new Blob(['data']);
            resetBlobs();
            expect(getStore()).toBe(storeBefore);
        });
    });

    describe('mutations', () => {
        it('mutations via getStore() are visible on subsequent calls', () => {
            const store = getStore();
            const blob = new Blob(['splat data']);
            store.splatBlob = blob;
            expect(getStore().splatBlob).toBe(blob);
        });
    });
});
