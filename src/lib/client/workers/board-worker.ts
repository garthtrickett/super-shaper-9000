/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-explicit-any */
import init, { WasmEngine, initThreadPool, create_wgpu_renderer } from '../wasm/surfer_wasm.js';
import { type BoardModel, INITIAL_STATE } from '../../../components/pages/board-builder-page.logic';

let engine: WasmEngine | null = null;
let isRendererReady = false;
const messageQueue: MessageEvent<any>[] = [];

console.info("[BoardWorker] Script loaded. Starting WASM initialization...");

// Initialize the WASM module
init().then(async (wasmInstance) => {
    console.info("[BoardWorker] WASM module init() promise resolved. wasmInstance details:", wasmInstance);
    
    const concurrency = navigator.hardwareConcurrency || 4;
    console.info(`[BoardWorker] Initializing Rayon thread pool with concurrency: ${concurrency}`);
    try {
        await initThreadPool(concurrency); 
        console.info("[BoardWorker] initThreadPool completed successfully.");
    } catch (err) {
        console.error("[BoardWorker] Thread pool init failed! Check if COOP/COEP headers are enabled and SharedArrayBuffer is available.", err);
        (self as unknown as Worker).postMessage({ type: "ERROR", error: String(err) });
        return;
    }

    console.info("[BoardWorker] Creating WasmEngine instance...");
    try {
        engine = new WasmEngine();
        console.info("[BoardWorker] Rust WasmEngine instance created successfully.");
    } catch (err) {
        console.error("[BoardWorker] Failed to instantiate WasmEngine!", err);
        (self as unknown as Worker).postMessage({ type: "ERROR", error: String(err) });
        return;
    }

    console.info("[BoardWorker] Loading default initial state into WasmEngine...");
    try {
        engine.propose({ type: "LOAD_DESIGN", state: INITIAL_STATE });
        console.info("[BoardWorker] Default initial state loaded successfully.");
    } catch (err) {
        console.error("[BoardWorker] WasmEngine failed to load default INITIAL_STATE!", err);
        (self as unknown as Worker).postMessage({ type: "ERROR", error: String(err) });
        return;
    }
    
        console.info("[BoardWorker] Retrieving initial state details from WasmEngine...");
    try {
        const initialState = engine.get_state() as BoardModel;
        console.info("[BoardWorker] Initial state retrieved:", initialState);
        const stats = engine.get_stats();
        console.info("[BoardWorker] Initial mesh stats retrieved:", stats);
        const foilData = engine.get_foil_stats() as Float32Array;
        console.info("[BoardWorker] Initial foil stats retrieved. Array size:", foilData.length);
        
        const transferList = [];
        if (foilData && foilData.buffer && typeof SharedArrayBuffer !== "undefined" && !(foilData.buffer instanceof SharedArrayBuffer)) {
            transferList.push(foilData.buffer);
        }

        console.info("[BoardWorker] Posting initial state back to the main thread...");
        (self as unknown as Worker).postMessage({
            type: "STATE_UPDATED",
            state: initialState,
            stats,
            foilData: foilData
        }, transferList);
        console.info("[BoardWorker] Initial state posted successfully.");
    } catch (err) {
        console.error("[BoardWorker] Failed during post-init state sync!", err);
        (self as unknown as Worker).postMessage({ type: "ERROR", error: String(err) });
        return;
    }

    console.info(`[BoardWorker] Processing ${messageQueue.length} queued messages...`);
        console.info("[BoardWorker] Beginning queue processing. messageQueue length is: " + messageQueue.length);
    for (const queuedMsg of messageQueue) {
        if (self.onmessage) {
            console.info("[BoardWorker] Dispatching queued message type:", queuedMsg.data?.type);
            try {
                await (self.onmessage as unknown as (e: MessageEvent) => Promise<void>)(queuedMsg);
                console.info("[BoardWorker] Queue successfully processed message:", queuedMsg.data?.type);
            } catch (err) {
                console.error("[BoardWorker] Queue failed to process message:", queuedMsg.data?.type, err);
            }
        }
    }
    messageQueue.length = 0;
    console.info("[BoardWorker] Queue processing finished. Worker is ready.");
}).catch((err: unknown) => {
    console.error("[BoardWorker] Failed to initialize WASM Engine entirely:", err);
    (self as unknown as Worker).postMessage({ type: "ERROR", error: String(err) });
});

let renderLoopActive = false;

const startRenderLoop = () => {
    if (renderLoopActive) {
        console.info("[BoardWorker] Render loop is already active.");
        return;
    }
    if (!engine) {
        console.warn("[BoardWorker] Cannot start render loop: engine is null.");
        return;
    }
    if (!isRendererReady) {
        console.warn("[BoardWorker] Cannot start render loop: renderer is not ready.");
        return;
    }
    
    console.info("[BoardWorker] Starting WGPU render loop...");
    renderLoopActive = true;
    
    const loop = () => {
        try {
            engine!.render();
        } catch(e) {
            console.error("[BoardWorker] WGPU render loop crash:", e); 
        }
        requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
};

self.onmessage = async (e: MessageEvent<any>) => {
    const msg = e.data;
    const msgType = msg?.type;

    if (!engine) {
        console.warn(`[BoardWorker] Engine not ready yet. Queuing message of type: ${msgType}`);
        messageQueue.push(e);
        return;
    }

    console.debug(`[BoardWorker] Received message of type: ${msgType}`);

    if (msgType === "INIT_RENDERER") {
        console.info("[BoardWorker] Initializing WGPU renderer with OffscreenCanvas...", {
            width: msg.width,
            height: msg.height
        });
        try {
            const renderer = await create_wgpu_renderer(msg.canvas, msg.width, msg.height);
            console.info("[BoardWorker] WGPU renderer created successfully. Binding to engine...");
            engine.set_renderer(renderer);
            console.info("[BoardWorker] Resizing renderer configuration...");
            engine.resize_renderer(msg.width, msg.height);
            isRendererReady = true;
            console.info("[BoardWorker] Renderer setup complete. Initiating render loop...");
            startRenderLoop();
            (self as unknown as Worker).postMessage({ type: "RENDERER_READY" });
        } catch (err) {
            console.error("[BoardWorker] Failed to initialize WGPU renderer!", err); 
            (self as unknown as Worker).postMessage({ type: "ERROR", error: String(err) });
        }
        return;
    }

    if (msgType === "RESIZE_RENDERER") {
        if (isRendererReady) {
            console.info(`[BoardWorker] Resizing WGPU renderer to: ${msg.width}x${msg.height}`);
            engine.resize_renderer(msg.width, msg.height);
        } else {
            console.warn("[BoardWorker] Ignored RESIZE_RENDERER: renderer is not initialized.");
        }
        return;
    }

    if (msgType === "POINTER_EVENT") {
        if (isRendererReady) {
            engine.handle_pointer(msg.eventType, msg.x, msg.y, msg.quad);
        }
        return;
    }

    if (msgType === "WHEEL_EVENT") {
        if (isRendererReady) {
            engine.handle_wheel(msg.dy, msg.quad);
        }
        return;
    }

    if (msgType === "SET_VIEW_MODE") {
        console.info(`[BoardWorker] Setting view mode to: ${msg.mode}`);
        engine.set_view_mode(msg.mode); 
        return;
    }

    if (msgType === "SET_ORTHO") { 
        console.info(`[BoardWorker] Setting camera projection to ortho: ${msg.isOrtho}`);
        engine.set_ortho(msg.isOrtho);
        return;
    }

    if (msgType === "SET_SHOW_TANGENTS") {
        engine.set_show_tangents(msg.quad, msg.show);
        return;
    }

    if (msgType === "SET_MASKS") {
        type EngineExt = WasmEngine & { set_masks(quad: string, lineMask: number, gizmoMask: number): void };
        (engine as unknown as EngineExt).set_masks(msg.quad, msg.lineMask, msg.gizmoMask);
        return;
    }

    if (msgType === "SET_SHOW_SOLID_MESH") {
        type EngineExt = WasmEngine & { set_show_solid_mesh(show: boolean): void };
        (engine as unknown as EngineExt).set_show_solid_mesh(msg.show);
        return;
    }

    if (msgType === "SET_GIZMO_SCALE") {
        engine.set_gizmo_scale(msg.quad, msg.scale);
        return;
    }

    if (msgType === "SET_ACTIVE_PROFILE_SLICE") {
        console.info(`[BoardWorker] Setting active profile slice to index: ${msg.slice}`);
        engine.set_active_profile_slice(msg.slice);
        return;
    }

    if (msgType === "SET_HOVER_Z") {
        type EngineExt = WasmEngine & { set_hover_z(z?: number): void };
        (engine as unknown as EngineExt).set_hover_z(msg.z); 
        return;
    }

    if (msgType === "FLIP_CAMERA") {
        console.info("[BoardWorker] Flipping perspective camera layout...");
        type EngineExt = WasmEngine & { flip_camera(): void };
        if ((engine as unknown as EngineExt).flip_camera) {
            (engine as unknown as EngineExt).flip_camera();
        }
        return;
    }

    if (msgType === "DRAG_GIZMO") {
        console.debug(`[BoardWorker] Processing drag gizmo on curve "${msg.curve}" index ${msg.index}`);
        engine.handle_gizmo_drag(msg.curve, msg.index, msg.nodeType, msg.x, msg.y, msg.z, msg.continuity || "G0");
        (self as unknown as Worker).postMessage({ type: "GIZMO_DRAG_COMPLETE" });
        return;
    }

        if (msgType === "GET_SLICE_PROFILE") {
        console.info(`[BoardWorker] Computing 2D slice profile at Z position: ${msg.z}`);
        const profile = engine.get_slice_profile(msg.z) as Float32Array;
        const transferList = [];
        if (profile && profile.buffer && typeof SharedArrayBuffer !== "undefined" && !(profile.buffer instanceof SharedArrayBuffer)) {
            transferList.push(profile.buffer);
        }
        (self as unknown as Worker).postMessage({
            type: "SLICE_PROFILE_RESULT",
            id: msg.id,
            seq: msg.seq,
            profile
        }, transferList);
        return;
    }

    if (msgType === "EXPORT_S3DX") { 
        console.info("[BoardWorker] Generating .s3dx file XML payload...");
        const xml = engine.export_s3dx();
        (self as unknown as Worker).postMessage({ type: "EXPORT_S3DX_RESULT", id: msg.id, seq: msg.seq, xml });
        return;
    }

    if (msgType === "EXPORT_OBJ") {
        console.info("[BoardWorker] Computing mesh and generating .obj file payload...");
        const obj = engine.export_obj();
        (self as unknown as Worker).postMessage({ type: "EXPORT_OBJ_RESULT", id: msg.id, seq: msg.seq, obj });
        return;
    }

        if (msgType === "EXPORT_BRD") {
        console.info("[BoardWorker] Generating .brd encrypted binary file payload...");
        try {
            const brdBytes = engine.export_brd();
            const transferList = [];
            if (brdBytes && brdBytes.buffer && typeof SharedArrayBuffer !== "undefined" && !(brdBytes.buffer instanceof SharedArrayBuffer)) {
                transferList.push(brdBytes.buffer);
            }
            (self as unknown as Worker).postMessage(
                { type: "EXPORT_BRD_RESULT", id: msg.id, seq: msg.seq, brdBytes },
                transferList
            );
        } catch (err) {
            console.error("[BoardWorker] Failed to generate encrypted BRD file!", err);
            (self as unknown as Worker).postMessage({ type: "ERROR", seq: msg.seq, error: String(err) });
        }
        return;
    }

    if (msgType === "PROPOSE" && msg.action) {
        if (msg.action.type !== "LOAD_DESIGN") {
            console.info(`[BoardWorker] Processing action proposal: ${msg.action.type}`);
        }
        try {
            // 1. Propose action to Rust
            const result = engine.propose(msg.action) as { state: BoardModel, effects: { type: string, message?: string }[] };
            const state = result.state;
            const effects = result.effects;

            // 2. Execute Effects-as-Data (JS side execution)
            if (Array.isArray(effects)) {
                for (const effect of effects) {
                    if (effect.type === "LOG_INFO") {
                        console.info(`[Rust Effect] ${effect.message || ""}`);
                    }
                } 
            }

                                                                        // 3. Extract Mesh Buffer (Zero-Copy)
            const stats = engine.get_stats();
            const foilData = engine.get_foil_stats() as Float32Array;

            console.debug(`[BoardWorker] Propose completed. Posting STATE_UPDATED back for sequence ID: ${msg.seq}`);
                        const transferList = [];
            if (foilData && foilData.buffer && typeof SharedArrayBuffer !== "undefined" && !(foilData.buffer instanceof SharedArrayBuffer)) {
                transferList.push(foilData.buffer);
            }
            (self as unknown as Worker).postMessage({
                type: "STATE_UPDATED",
                seq: msg.seq,
                state,
                stats,
                foilData
            }, transferList);

        } catch (err) { 
            console.error("[BoardWorker] Error encountered during action proposal!", err);
            (self as unknown as Worker).postMessage({ type: "ERROR", seq: msg.seq, error: String(err) });
        }
    }
};
