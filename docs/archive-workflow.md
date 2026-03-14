# Archive Creation Workflow

Visual documentation of the complete archive creation lifecycle in Vitrine3D's Editor mode — from loading assets through alignment, metadata, export, and sharing.

> **Rendering**: These charts use [Mermaid](https://mermaid.js.org/) syntax. They render natively on GitHub, in VS Code (with the Mermaid extension), or at [mermaid.live](https://mermaid.live).

---

## 1. Main Workflow Overview

End-to-end flow from opening the Editor through asset loading, editing, and export/sharing.

```mermaid
flowchart TD
    Start([Open Editor]) --> LoadAssets[Load Assets]

    LoadAssets --> InputMethod{Input Method?}
    InputMethod -->|File Picker| FilePick[Select File from Disk]
    InputMethod -->|URL Entry| URLEntry[Enter Asset URL]
    InputMethod -->|Drag & Drop| DragDrop[Drop File on Canvas]
    InputMethod -->|Tauri Dialog| TauriOpen[Native Open Dialog]
    InputMethod -->|Archive| LoadArchive[Load .ddim / .a3d / .a3z]

    FilePick --> DetectType
    URLEntry --> DetectType
    DragDrop --> DetectType
    TauriOpen --> DetectType

    DetectType{Asset Type?}
    DetectType -->|PLY/SPZ/SPLAT/KSPLAT/SOG| LoadSplat[Load Gaussian Splat]
    DetectType -->|GLB/OBJ/STL/DRC| LoadMesh[Load Mesh]
    DetectType -->|E57| LoadPC[Load Point Cloud]
    DetectType -->|STEP/IGES/BREP| LoadCAD[Load CAD Model]
    DetectType -->|CSV/KML/KMZ/SRT| LoadFlight[Load Flight Log]

    LoadSplat --> StoreBlob[Store in Asset Store]
    LoadMesh --> StoreBlob
    LoadPC --> StoreBlob
    LoadCAD --> StoreBlob
    LoadFlight --> StoreBlob
    LoadArchive --> ProcessArchive[Phase 1: Parse Manifest\nPhase 2: Load Primary Asset\nPhase 3: Lazy-load Remaining]

    ProcessArchive --> StoreBlob
    StoreBlob --> UpdateState[Update state.*Loaded flags\nUpdate display mode]

    UpdateState --> MultiAsset{Multiple assets\nloaded?}
    MultiAsset -->|Yes| AutoAlign[Auto-center align\n500ms delay]
    MultiAsset -->|No| SingleAsset[Center on grid]

    AutoAlign --> SceneReady
    SingleAsset --> SceneReady

    SceneReady[Scene Ready in Viewport]

    SceneReady --> EditPhase{Editing Phase}
    EditPhase --> Alignment[Align Assets]
    EditPhase --> Metadata[Fill Metadata\nDublin Core + CIDOC-CRM]
    EditPhase --> Annotations[Place 3D Annotations]
    EditPhase --> Screenshots[Capture Screenshots]
    EditPhase --> SourceFiles[Attach Source Files]
    EditPhase --> Walkthrough[Record Walkthrough]

    Alignment --> ReadyExport
    Metadata --> ReadyExport
    Annotations --> ReadyExport
    Screenshots --> ReadyExport
    SourceFiles --> ReadyExport
    Walkthrough --> ReadyExport

    ReadyExport[Ready for Export]
    ReadyExport --> ExportAction{Export Action}
    ExportAction -->|Download| ExportPipeline[Archive Export Pipeline]
    ExportAction -->|Save to Library| LibraryUpload[Chunked Upload to Server]
    ExportAction -->|Share| ShareDialog[Generate Share URL / Embed / QR]

    ExportPipeline --> Archive([.ddim Archive])
    LibraryUpload --> Library([Server Library])
    ShareDialog --> SharedLink([URL / Embed / QR Code])

    style Start fill:#2d5a27,stroke:#4a9,color:#fff
    style Archive fill:#1a3a5c,stroke:#4a9,color:#fff
    style Library fill:#1a3a5c,stroke:#4a9,color:#fff
    style SharedLink fill:#1a3a5c,stroke:#4a9,color:#fff
```

---

## 2. Asset Loading Detail

How different asset types flow through their respective loaders into the shared Asset Store.

```mermaid
flowchart TD
    subgraph InputMethods["Input Methods"]
        FP[File Picker<br/>event-wiring.ts]
        URL[URL Entry<br/>file-input-handlers.ts]
        DD[Drag & Drop<br/>event-wiring.ts]
        Tauri[Tauri Dialog<br/>file-input-handlers.ts]
    end

    FP --> FileObj[File Object]
    URL --> FetchURL["fetchWithProgress<br/>utilities.js"]
    DD --> FileObj
    Tauri --> FileObj

    FetchURL --> BlobURL[Blob URL]
    FileObj --> BlobURL

    BlobURL --> ExtDetect{Detect by Extension}

    ExtDetect -->|".ply .spz .splat .ksplat .sog"| SplatPath
    ExtDetect -->|".glb .gltf"| GLBPath
    ExtDetect -->|".obj"| OBJPath
    ExtDetect -->|".stl"| STLPath
    ExtDetect -->|".drc"| DRCPath
    ExtDetect -->|".e57"| E57Path
    ExtDetect -->|".step .iges .brep"| CADPath
    ExtDetect -->|".csv .kml .kmz .srt"| FlightPath
    ExtDetect -->|".ddim .a3d .a3z .zip"| ArchivePath

    subgraph SplatLoading["Splat Loading — splat-loader.ts"]
        SplatPath[loadSplatFromFile/Url]
        SplatPath --> SplatWASM[Await SplatMesh.staticInitialized<br/>Spark.js WASM init]
        SplatWASM --> SplatType{File type?}
        SplatType -->|".sog"| SOGDecode[unpackSplats via WASM<br/>PackedSplats decode]
        SplatType -->|other| SplatDirect[SplatMesh with URL + fileType]
        SOGDecode --> SplatInit[await splatMesh.initialized]
        SplatDirect --> SplatInit
        SplatInit --> RotFix["Apply rotation.x = PI<br/>Fix upside-down"]
        RotFix --> AddScene[scene.add splatMesh]
    end

    subgraph MeshLoading["Mesh Loading — mesh-loader.ts"]
        GLBPath[loadModelFromFile]
        OBJPath[loadModelFromFile]
        STLPath[loadSTLFile]
        DRCPath[loadDRC via DRACOLoader]
        GLBPath --> GLTFLoader[THREE.GLTFLoader]
        OBJPath --> OBJLoader[THREE.OBJLoader]
        STLPath --> STLLoader[THREE.STLLoader]
        DRCPath --> DRACOLoader[THREE.DRACOLoader]
        GLTFLoader --> MeshAdd[modelGroup.add]
        OBJLoader --> MeshAdd
        STLLoader --> MeshAdd
        DRACOLoader --> MeshAdd
        MeshAdd --> MeshShadow[Apply shadow properties<br/>Compute face count & textures]
    end

    subgraph PCLoading["Point Cloud — pointcloud-loader.ts"]
        E57Path[loadPointcloudFromFile]
        E57Path --> WASMLoad[web-e57 WASM decoder]
        WASMLoad --> PCAdd[pointcloudGroup.add]
    end

    subgraph CADLoading["CAD — cad-loader.ts"]
        CADPath[loadCADFromBlobUrl]
        CADPath --> CADAdd[cadGroup.add]
    end

    subgraph FlightLoading["Flight — flight-path.ts + flight-parsers.ts"]
        FlightPath[Parse flight log]
        FlightPath --> ParseType{Parser?}
        ParseType -->|DJI CSV| DJIParse["parseDJICSV<br/>column aliases + 'longtitude' typo"]
        ParseType -->|KML/KMZ| KMLParse[parseKML / unzip KMZ]
        ParseType -->|SRT| SRTParse[parseSRT subtitle GPS]
        DJIParse --> GPSConvert[GPS → local coords<br/>Flat-earth projection]
        KMLParse --> GPSConvert
        SRTParse --> GPSConvert
        GPSConvert --> FlightRender[THREE.Line + InstancedMesh markers]
    end

    subgraph ArchiveLoading["Archive — archive-pipeline.ts"]
        ArchivePath[ArchiveLoader.loadFromFile]
        ArchivePath --> Manifest[Parse manifest.json]
        Manifest --> ContentInfo["getContentInfo<br/>hasSplat / hasMesh / hasPointcloud"]
        ContentInfo --> LazyLoad[Lazy-load assets via<br/>ensureAssetLoaded]
    end

    AddScene --> AssetStore
    MeshShadow --> AssetStore
    PCAdd --> AssetStore
    CADAdd --> AssetStore
    FlightRender --> AssetStore
    LazyLoad --> AssetStore

    AssetStore["Asset Store Singleton<br/>asset-store.ts<br/>splatBlob / meshBlob / pointcloudBlob<br/>cadBlob / flightPathBlobs / sourceFiles"]

    AssetStore --> StateUpdate["state.splatLoaded = true<br/>state.modelLoaded = true<br/>state.pointcloudLoaded = true"]
    StateUpdate --> DisplayMode[Update display mode<br/>splat / model / combined / pointcloud]

    style AssetStore fill:#2d4a1c,stroke:#6b6,color:#fff
    style DisplayMode fill:#1a3a5c,stroke:#68b,color:#fff
```

---

## 3. Alignment & Transform

Four alignment methods available after loading multiple assets into the scene.

```mermaid
flowchart TD
    AssetsLoaded([Multiple Assets in Scene]) --> AlignChoice{Alignment Method}

    AlignChoice -->|Automatic| AutoCenter
    AlignChoice -->|Manual Gizmo| ManualGizmo
    AlignChoice -->|Landmark ICP| LandmarkAlign
    AlignChoice -->|Load from File| LoadAlign

    subgraph AutoCenterBlock["Auto-Center — alignment.ts"]
        AutoCenter[autoCenterAlign]
        AutoCenter --> GetSplatBounds[Compute splat bounding box]
        GetSplatBounds --> GetMeshCenter[Get mesh group center]
        GetMeshCenter --> MatchCenters[Move mesh center to<br/>match splat center]
        MatchCenters --> UpdateInputs[updateTransformInputs<br/>storeLastPositions]
    end

    subgraph GizmoBlock["Manual Transform — transform-controller.ts"]
        ManualGizmo[TransformControls Gizmo]
        ManualGizmo --> SelectObj{Select Object}
        SelectObj -->|Splat| SelSplat[splatMesh]
        SelectObj -->|Mesh| SelMesh[modelGroup]
        SelectObj -->|Point Cloud| SelPC[pointcloudGroup]
        SelectObj -->|Both| SelBoth[Synced pair]
        SelSplat --> GizmoMode
        SelMesh --> GizmoMode
        SelPC --> GizmoMode
        SelBoth --> GizmoMode
        GizmoMode{Mode?}
        GizmoMode -->|Translate| Translate[Drag XYZ axes]
        GizmoMode -->|Rotate| Rotate[Drag XYZ rings]
        GizmoMode -->|Scale| Scale[Uniform scale]
        Translate --> DeltaTrack[Track transform deltas<br/>Undo/redo support]
        Rotate --> DeltaTrack
        Scale --> DeltaTrack
        DeltaTrack --> ApplyTransform[Apply to selected object]
    end

    subgraph LandmarkBlock["Landmark ICP — alignment.ts"]
        LandmarkAlign[Start Landmark Mode]
        LandmarkAlign --> PickAnchor1["Click anchor point 1<br/>on reference object"]
        PickAnchor1 --> PickMover1["Click corresponding point 1<br/>on object to align"]
        PickMover1 --> PickAnchor2[Click anchor point 2]
        PickAnchor2 --> PickMover2[Click corresponding point 2]
        PickMover2 --> PickAnchor3[Click anchor point 3]
        PickAnchor3 --> PickMover3[Click corresponding point 3]
        PickMover3 --> ICPCompute[ICP Algorithm<br/>Iterative Closest Point]
        ICPCompute --> RMSEReport[Report RMSE error]
        RMSEReport --> AcceptReject{Accept?}
        AcceptReject -->|Accept| ApplyICP[Apply computed transform]
        AcceptReject -->|Reject| RestoreTransform[Restore saved transform]
    end

    subgraph SaveLoadBlock["Save / Load Alignment — alignment.ts"]
        LoadAlign[Load alignment.json]
        LoadAlign --> ParseJSON["Parse AlignmentData<br/>version + per-object transforms"]
        ParseJSON --> ApplyAll["Apply position / rotation / scale<br/>to splat, mesh, pointcloud"]
    end

    UpdateInputs --> FitView
    ApplyTransform --> FitView
    ApplyICP --> FitView
    ApplyAll --> FitView

    FitView[Fit to View<br/>Camera frames all objects]
    FitView --> AlignedScene([Aligned Scene])

    AlignedScene --> SaveAlign[Save alignment.json]
    SaveAlign --> CollectTransforms[Collect current transforms<br/>from all scene objects]
    CollectTransforms --> WriteJSON[Write AlignmentData JSON]

    style AssetsLoaded fill:#2d5a27,stroke:#4a9,color:#fff
    style AlignedScene fill:#1a3a5c,stroke:#68b,color:#fff
```

---

## 4. Archive Export Pipeline

Detailed export flow from clicking "Download Archive" through validation, asset processing, and output.

```mermaid
flowchart TD
    ExportClick([User Clicks Export]) --> ShowPanel["Show export pane<br/>Sync asset checkboxes<br/>based on state.*Loaded"]

    ShowPanel --> UserConfig["User configures:<br/>• Asset checkboxes — splat / mesh / pc / annotations<br/>• Format — .ddim or .zip<br/>• Draco HD compression<br/>• Splat LOD toggle"]

    UserConfig --> PrepareArchive["prepareArchive<br/>export-controller.ts"]

    PrepareArchive --> CollectMeta["collectMetadata<br/>from metadata panel"]
    CollectMeta --> InjectSettings["Inject measurement calibration<br/>and rendering preset<br/>into viewer settings"]

    InjectSettings --> ValidateTitle{Title set?}
    ValidateTitle -->|No| ShowMetaPanel["Show metadata panel<br/>with warning"]
    ShowMetaPanel --> Abort([Export Aborted])
    ValidateTitle -->|Yes| SIPCheck

    SIPCheck["SIP Compliance Validation<br/>validateSIP with active profile<br/>basic / standard / archival"]
    SIPCheck --> SIPResult{Errors or<br/>warnings?}
    SIPResult -->|None| ContinueExport
    SIPResult -->|Yes| ComplianceDialog["Show compliance dialog<br/>Score %, errors, warnings"]
    ComplianceDialog --> UserDecision{User decision?}
    UserDecision -->|Back| ShowMetaPanel
    UserDecision -->|Export Anyway| OverrideExport[Mark compliance as overridden]
    UserDecision -->|Continue| ContinueExport

    OverrideExport --> ContinueExport

    ContinueExport["Reset archive creator<br/>Set all metadata sections"]

    ContinueExport --> ProcessAssets

    subgraph ProcessAssets["Asset Processing"]
        direction TB
        CheckSplat{Splat included?}
        CheckSplat -->|Yes| SplatLOD{"LOD enabled &<br/>non-SPZ format?"}
        SplatLOD -->|Yes| TranscodeSPZ["Transcode to SPZ<br/>via Web Worker"]
        SplatLOD -->|No| SplatDirect[Use original blob]
        TranscodeSPZ --> AddSplat[addScene to archive]
        SplatDirect --> AddSplat

        CheckMesh{Mesh included?}
        CheckMesh -->|Yes| DracoCheck{"Draco HD checked<br/>& GLB format?"}
        DracoCheck -->|Yes| DracoCompress["dracoCompressGLB<br/>mesh-decimator.ts"]
        DracoCheck -->|No| MeshDirect[Use original blob]
        DracoCompress --> AddMesh[addMesh to archive]
        MeshDirect --> AddMesh

        CheckPC{Point cloud<br/>included?}
        CheckPC -->|Yes| AddPC[addPointcloud to archive]

        AddProxies["Re-extract & add proxy assets<br/>mesh proxy / splat proxy"]
        AddOther["Add remaining:<br/>CAD / flight paths / COLMAP /<br/>HDR environment"]
    end

    ProcessAssets --> AddAlignment["setAlignment<br/>splat / mesh / pointcloud transforms<br/>+ camera position + orbit target"]

    AddAlignment --> AddAnnotations{Annotations<br/>included?}
    AddAnnotations -->|Yes| SetAnnotations["setAnnotations — JSON array<br/>3D position + camera state + content"]
    AddAnnotations -->|No| AddExtras

    SetAnnotations --> AddExtras
    AddExtras["Add walkthrough, embedded images,<br/>source files, detail models"]

    AddExtras --> StampCompliance["Set metadata profile<br/>Stamp SIP compliance record<br/>Set quality stats"]

    StampCompliance --> CapturePreview{Manual preview<br/>set?}
    CapturePreview -->|Yes| UseManual[Use manual preview blob]
    CapturePreview -->|No| AutoCapture["captureScreenshot<br/>Hide grid helpers, render to PNG"]
    UseManual --> AddThumbnail[addThumbnail preview.jpg]
    AutoCapture --> AddThumbnail

    AddThumbnail --> AddScreenshots["Add screenshot list<br/>screenshot_N.jpg"]

    AddScreenshots --> Validate[archiveCreator.validate]
    Validate --> ValidResult{Valid?}
    ValidResult -->|No| ErrorNotify[notify.error with issues]
    ErrorNotify --> Abort2([Export Aborted])
    ValidResult -->|Yes| OutputChoice{Output target?}

    OutputChoice -->|Download| CreateZIP["Streaming ZIP via fflate<br/>with progress callback"]
    OutputChoice -->|Library| CreateBlob["createArchive as Blob<br/>0–80% progress"]

    CreateZIP --> BrowserDownload([Browser Download<br/>project.ddim])

    CreateBlob --> ChunkUpload["Chunked upload to /api/archives<br/>50MB chunks, sequential"]
    ChunkUpload --> ServerSave([Saved to Server Library])

    style ExportClick fill:#2d5a27,stroke:#4a9,color:#fff
    style BrowserDownload fill:#1a3a5c,stroke:#68b,color:#fff
    style ServerSave fill:#1a3a5c,stroke:#68b,color:#fff
    style Abort fill:#5c1a1a,stroke:#c66,color:#fff
    style Abort2 fill:#5c1a1a,stroke:#c66,color:#fff
```

---

## 5. Archive Loading & Sharing

How archives are loaded back (from file or URL), processed in phases, and shared.

```mermaid
flowchart TD
    subgraph LoadTrigger["Archive Load Triggers"]
        FileInput["File input<br/>handleArchiveFile"]
        URLParam["URL parameter<br/>?archive=URL"]
        URLPrompt[URL entry dialog]
        TauriFile[Tauri native file dialog]
    end

    FileInput --> FromFile[ArchiveLoader.loadFromFile]
    URLParam --> FromURL
    URLPrompt --> FromURL
    TauriFile --> FromFile

    FromURL{Load strategy}
    FromURL -->|Try first| RangeLoad["loadRemoteIndex<br/>HTTP Range request<br/>~64KB central directory only"]
    RangeLoad -->|Success| StreamMode["Streaming mode<br/>Extract files on demand<br/>via HTTP Range requests"]
    RangeLoad -->|No Range support| FallbackFull["Full download<br/>loadFromUrl with progress"]
    FallbackFull --> FullMode[Full ZIP in memory]

    FromFile --> FullMode
    StreamMode --> ProcessArchive
    FullMode --> ProcessArchive

    ProcessArchive["processArchive<br/>archive-pipeline.ts"]

    subgraph Phase1["Phase 1 — Manifest"]
        P1Parse[Parse manifest.json from ZIP]
        P1Parse --> P1State["Set state:<br/>archiveLoader, archiveManifest<br/>archiveFileName, archiveLoaded"]
        P1State --> P1Content["getContentInfo<br/>hasSplat / hasMesh / hasPointcloud<br/>hasCAD / hasMeshProxy / hasSceneProxy"]
        P1Content --> P1Meta[Prefill metadata panel<br/>from manifest]
        P1Meta --> P1UI["Update archive metadata UI<br/>Populate proxy filenames<br/>Restore decimation settings"]
        P1UI --> P1Sources["Index source files<br/>metadata only — no blob extraction"]
    end

    ProcessArchive --> Phase1

    Phase1 --> Phase2

    subgraph Phase2["Phase 2 — Primary Asset"]
        P2Detect["getPrimaryAssetType<br/>based on displayMode + contentInfo"]
        P2Detect --> P2Load[ensureAssetLoaded primaryType]
        P2Load --> P2Quality{Quality tier?}
        P2Quality -->|SD / Mobile| P2Proxy["Load proxy asset<br/>scene_proxy / mesh_proxy"]
        P2Quality -->|HD / Desktop| P2Full[Load full-res asset]
        P2Proxy --> P2Render[Add to scene<br/>Apply transform from manifest]
        P2Full --> P2Render

        P2Render --> P2Fallback{Primary loaded OK?}
        P2Fallback -->|No| TryFallback["Try fallback types:<br/>splat → mesh → pointcloud<br/>→ drawing → cad → flightpath"]
        P2Fallback -->|Yes| P2Done[Primary visible]
        TryFallback --> P2Done
    end

    Phase2 --> PostLoad

    subgraph PostLoad["Post-Load Setup"]
        ApplyAlign[Apply global alignment<br/>from manifest]
        ApplyAlign --> LoadAnnot[Load annotations]
        LoadAnnot --> LoadColmap[Load COLMAP SfM data]
        LoadColmap --> LoadWalk[Load walkthrough]
        LoadWalk --> ApplyViewer["Apply viewer settings<br/>camera constraints, post-processing"]
        ApplyViewer --> LoadEnv[Load HDR environment]
        LoadEnv --> ExtractImages[Extract embedded images]
    end

    PostLoad --> Phase3

    subgraph Phase3["Phase 3 — Background Loading"]
        P3Remaining["Load remaining asset types<br/>on demand via ensureAssetLoaded"]
        P3Remaining --> P3Flight["Extract flight path blobs<br/>Render flight lines"]
        P3Flight --> P3FitView[Fit camera to view<br/>all loaded objects]
    end

    Phase3 --> ViewReady([Scene Fully Loaded])

    subgraph QualitySwap["Quality Tier Switching — quality-tier.ts"]
        SDtoHD["User clicks 'Load Full Res'"]
        SDtoHD --> ExtractFull["Extract full-res from archive<br/>via Range request or cached ZIP"]
        ExtractFull --> SwapMesh["swapMeshChildren<br/>In-place geometry swap"]
        SwapMesh --> DisposePrev[Dispose old proxy resources]
    end

    ViewReady --> ShareAction{Share?}

    subgraph ShareFlow["Share Dialog — share-dialog.ts"]
        ShareAction -->|Yes| OpenShare[Open share dialog]
        OpenShare --> BuildURL[Build URL with parameters]
        BuildURL --> Params["?archive=URL<br/>?splat=URL&model=URL<br/>?theme=editorial<br/>?toolbar=show|hide<br/>?sidebar=closed|view|edit"]

        Params --> Tab{Output format?}
        Tab -->|Share URL| CopyURL[Copy URL to clipboard]
        Tab -->|Embed| EmbedCode["Generate iframe code<br/>UI presets: full / viewer / kiosk"]
        Tab -->|QR Code| QRGen["Generate SVG QR code<br/>Client-side, zero dependencies"]
    end

    style ViewReady fill:#2d5a27,stroke:#4a9,color:#fff
```

---

## Typical Configurations

### Splat Only
> File Picker → splat-loader.ts → Asset Store (`splatBlob`) → `state.splatLoaded = true` → `displayMode = splat` → center on grid → fill metadata → export (`addScene` only)

### Splat + Mesh (Aligned)
> Load splat → load mesh → **auto-center align** (500ms delay) → manual gizmo refinement _or_ landmark ICP → export (`addScene` + `addMesh` + `setAlignment` with both transforms)

### Full Scan Deliverable
> Load **splat + mesh + point cloud + flight log** → auto-center align → **landmark ICP** for precision → fill Dublin Core metadata (standard or archival profile) → place annotations → capture screenshots → export with **Draco compression** on GLB + **SPZ transcoding** on splat → `.ddim` archive containing `manifest.json`, `assets/`, `sources/`, `preview.png`
