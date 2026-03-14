import { readFileSync } from 'fs';
import { describe, expect, it } from 'vitest';

describe('version sync', () => {
    it('all version sources match', () => {
        const pkg = JSON.parse(readFileSync('package.json', 'utf-8'));
        const tauriConf = JSON.parse(
            readFileSync('src-tauri/tauri.conf.json', 'utf-8')
        );
        const cargoToml = readFileSync('src-tauri/Cargo.toml', 'utf-8');
        const archiveCreator = readFileSync(
            'src/modules/archive-creator.ts',
            'utf-8'
        );

        const cargoVersion = cargoToml.match(
            /^version = "(.+)"$/m
        )?.[1];
        const packerVersion = archiveCreator.match(
            /packer_version: "(.+?)"/
        )?.[1];

        expect(pkg.version).toBe(tauriConf.version);
        expect(pkg.version).toBe(cargoVersion);
        expect(pkg.version).toBe(packerVersion);
    });
});
