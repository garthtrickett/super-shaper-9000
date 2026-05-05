import init, { WasmEngine } from '../wasm/surfer_wasm.js';
import type { BoardModel, BoardAction } from '../../../components/pages/board-builder-page.logic';
import type { RustMesh } from '../../../components/3d/board-viewport';

let engine: WasmEngine | null = null;

// Initialize the WASM module
init().then(() => {
    engine = new WasmEngine();
    console.info("[BoardWorker] Rust WASM Engine initialized.");
    
    // Post initial state back
    const initialState = engine.get_state() as BoardModel;
    const mesh = engine.get_mesh() as RustMesh;
    const curvatureCombs = engine.get_curvature_combs() as Float32Array;
    
        (self as unknown as Worker).postMessage({
        type: "STATE_UPDATED",
        state: initialState,
        mesh: mesh,
        curvatureCombs: curvatureCombs
    },[mesh.vertices.buffer, mesh.indices.buffer, mesh.uvs.buffer, mesh.colors.buffer, mesh.normals.buffer, curvatureCombs.buffer]);
}).catch((err: unknown) => {
    console.error("[BoardWorker] Failed to initialize WASM Engine:", err);
});

self.onmessage = (e: MessageEvent<{ type: string, action: BoardAction }>) => {
    if (!engine) {
        console.warn("[BoardWorker] Engine not ready, ignoring message.");
        return;
    }

    const msg = e.data;
    if (msg.type === "PROPOSE") {
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
            const mesh = engine.get_mesh() as RustMesh;
            const curvatureCombs = engine.get_curvature_combs() as Float32Array;

                        // 4. Send updated State and Mesh back to Main Thread
            (self as unknown as Worker).postMessage({
                type: "STATE_UPDATED",
                state,
                mesh,
                curvatureCombs
            },[mesh.vertices.buffer, mesh.indices.buffer, mesh.uvs.buffer, mesh.colors.buffer, mesh.normals.buffer, curvatureCombs.buffer]); // Transfer ownership of the buffers

        } catch (err) {
            console.error("[BoardWorker] Error during proposal:", err);
        }
    }
};
