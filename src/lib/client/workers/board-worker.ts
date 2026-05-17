/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-explicit-any */
import init, { WasmEngine, initThreadPool, create_wgpu_renderer } from '../wasm/surfer_wasm.js';
import { type BoardModel, INITIAL_STATE } from '../../../components/pages/board-builder-page.logic';

let engine: WasmEngine | null = null;
let isRendererReady = false;
const messageQueue: MessageEvent<any>[] = [];

// Initialize the WASM module
init().then(async () => {
    try {
        await initThreadPool(navigator.hardwareConcurrency);
    } catch (err) {
        console.error("[BoardWorker] Thread pool init failed:", err);
        (self as unknown as Worker).postMessage({ type: "ERROR", error: String(err) });
        return;
    }

    engine = new WasmEngine();
    console.info("[BoardWorker] Rust WASM Engine initialized.");

    // Load the default initial state into the Rust engine
    engine.propose({ type: "LOAD_DESIGN", state: INITIAL_STATE });
    
        // Post initial state back
    const initialState = engine.get_state() as BoardModel;
    const stats = engine.get_stats();
    const curvatureCombs = engine.get_curvature_combs() as Float32Array;
    const foilData = engine.get_foil_stats() as Float32Array;
    
                    (self as unknown as Worker).postMessage({
        type: "STATE_UPDATED",
        state: initialState,
        stats,
        curvatureCombs: curvatureCombs,
        foilData: foilData
    },[curvatureCombs.buffer, foilData.buffer]);

                // Process queued messages sequentially to prevent &mut self borrow panics
    for (const queuedMsg of messageQueue) {
        if (self.onmessage) {
            await (self.onmessage as unknown as (e: MessageEvent) => Promise<void>)(queuedMsg);
        }
    }
    messageQueue.length = 0;
}).catch((err: unknown) => {
    console.error("[BoardWorker] Failed to initialize WASM Engine:", err);
    (self as unknown as Worker).postMessage({ type: "ERROR", error: String(err) });
});

let renderLoopActive = false;

const startRenderLoop = () => {
    if (renderLoopActive || !engine || !isRendererReady) return;
    renderLoopActive = true;
    
    const loop = () => {
        try {
            engine!.render();
        } catch(e) {
            console.error("Render loop error", e);
        }
        requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
};

self.onmessage = async (e: MessageEvent<any>) => {
    if (!engine) {
        console.warn("[BoardWorker] Engine not ready, queuing message.");
        messageQueue.push(e);
        return;
    }

    const msg = e.data;

                if (msg.type === "INIT_RENDERER") {
        try {
            const renderer = await create_wgpu_renderer(msg.canvas, msg.width, msg.height);
            engine.set_renderer(renderer);
            engine.resize_renderer(msg.width, msg.height);
            isRendererReady = true;
            startRenderLoop();
            (self as unknown as Worker).postMessage({ type: "RENDERER_READY" });
        } catch (err) {
            console.error("[BoardWorker] Failed to init WGPU", err);
            (self as unknown as Worker).postMessage({ type: "ERROR", error: String(err) });
        }
        return;
    }

        if (msg.type === "RESIZE_RENDERER") {
        if (isRendererReady) {
            engine.resize_renderer(msg.width, msg.height);
        }
        return;
    }

    if (msg.type === "POINTER_EVENT") {
        if (isRendererReady) {
            engine.handle_pointer(msg.eventType, msg.x, msg.y);
        }
        return;
    }
        if (msg.type === "WHEEL_EVENT") {
        if (isRendererReady) {
            engine.handle_wheel(msg.dy);
        }
        return;
    }

    if (msg.type === "DRAG_GIZMO") {
        if (engine) {
            engine.handle_gizmo_drag(msg.curve, msg.index, msg.nodeType, msg.x, msg.y, msg.z);
        }
        return;
    }

                if (msg.type === "GET_SLICE_PROFILE") {
        const profile = engine.get_slice_profile(msg.z) as Float32Array;
                (self as unknown as Worker).postMessage({
            type: "SLICE_PROFILE_RESULT",
            id: msg.id,
            seq: msg.seq,
            profile
        },[profile.buffer]);
        return;
    }

                if (msg.type === "EXPORT_S3DX") {
        const xml = engine.export_s3dx();
        (self as unknown as Worker).postMessage({ type: "EXPORT_S3DX_RESULT", id: msg.id, seq: msg.seq, xml });
        return;
    }

        if (msg.type === "EXPORT_OBJ") {
        const obj = engine.export_obj();
        (self as unknown as Worker).postMessage({ type: "EXPORT_OBJ_RESULT", id: msg.id, seq: msg.seq, obj });
        return;
    }

    if (msg.type === "EXPORT_BRD") {
        try {
            const brdBytes = engine.export_brd();
            (self as unknown as Worker).postMessage(
                { type: "EXPORT_BRD_RESULT", id: msg.id, seq: msg.seq, brdBytes },
                [brdBytes.buffer]
            );
        } catch (err) {
            console.error("[BoardWorker] Failed to export BRD", err);
            (self as unknown as Worker).postMessage({ type: "ERROR", seq: msg.seq, error: String(err) });
        }
        return;
    }

                if (msg.type === "PROPOSE" && msg.action) {
        if (msg.action.type !== "LOAD_DESIGN") {
            console.info("[BoardWorker] Action received:", msg.action.type);
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
            const curvatureCombs = engine.get_curvature_combs() as Float32Array;
            const foilData = engine.get_foil_stats() as Float32Array;

            (self as unknown as Worker).postMessage({
                type: "STATE_UPDATED",
                seq: msg.seq,
                state,
                stats,
                curvatureCombs,
                foilData
            }, [curvatureCombs.buffer, foilData.buffer]); // Transfer ownership of the buffers

                } catch (err) {
            console.error("[BoardWorker] Error during proposal:", err);
            (self as unknown as Worker).postMessage({ type: "ERROR", seq: msg.seq, error: String(err) });
        }
    }
};
