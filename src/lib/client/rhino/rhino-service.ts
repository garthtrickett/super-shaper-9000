/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable @typescript-eslint/no-redundant-type-constituents */
import rhino3dm from "rhino3dm";
// @ts-ignore - Vite handles this ?url import natively
import rhinoWasmUrl from "rhino3dm/rhino3dm.wasm?url";

// We use `any` for RhinoModule here to avoid heavy type imports,
// as the WASM module types can be complex and are primarily needed internally.
type RhinoModule = any;

let rhinoInstance: RhinoModule | null = null;
let initPromise: Promise<RhinoModule> | null = null;

export const getRhino = (): Promise<RhinoModule> => {
  if (rhinoInstance) return Promise.resolve(rhinoInstance);
  
  if (!initPromise) {
    // @ts-ignore - rhino3dm types do not declare the Emscripten module configuration argument
    initPromise = rhino3dm({
      locateFile: (file: string) => {
        if (file === "rhino3dm.wasm") {
          return rhinoWasmUrl;
        }
        return file;
      },
    }).then((m: RhinoModule) => {
      rhinoInstance = m;
      return m;
    });
  }
  
  return initPromise;
};
