/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-return */
import rhino3dm from "rhino3dm";

// We use `any` for RhinoModule here to avoid heavy type imports,
// as the WASM module types can be complex and are primarily needed internally.
type RhinoModule = any;

let rhinoInstance: RhinoModule | null = null;
let initPromise: Promise<RhinoModule> | null = null;

export const getRhino = (): Promise<RhinoModule> => {
  if (rhinoInstance) return Promise.resolve(rhinoInstance);
  
  if (!initPromise) {
    initPromise = rhino3dm().then((m: RhinoModule) => {
      rhinoInstance = m;
      return m;
    });
  }
  
  return initPromise;
};
