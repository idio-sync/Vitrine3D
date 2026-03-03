/// <reference types="vite/client" />

interface ImportMetaEnv {
    /** Spark.js renderer version: '2.0' (default) or '0.1' (legacy). */
    readonly VITE_SPARK_VERSION?: string;
}

interface ImportMeta {
    readonly env: ImportMetaEnv;
}
