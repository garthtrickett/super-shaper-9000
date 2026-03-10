import { readFile } from "fs/promises";
import * as path from "path";

export interface BoardParams {
  length: number;
  width: number;
  thickness: number;
  tailType: string;
}

export const computeBoardMesh = async (params: BoardParams): Promise<{ mesh: string }> => {
  const computeUrl = process.env.RHINO_COMPUTE_URL;
  const apiKey = process.env.RHINO_COMPUTE_API_KEY;

  // Mock implementation for CI/CD or local dev without Rhino.Compute
  if (!computeUrl) {
    console.info("[Rhino Compute] No RHINO_COMPUTE_URL provided. Using mock data.");
    await new Promise(resolve => setTimeout(resolve, 500));
    return { mesh: "MOCK_BASE64_MESH_DATA" };
  }

  try {
    const ghFilePath = path.join(import.meta.dir, "../assets/board-generator.gh");
    const ghFileBuffer = await readFile(ghFilePath);
    const algoBase64 = ghFileBuffer.toString("base64");

    const payload = {
      algo: algoBase64,
      pointer: null,
      values:[
        {
          ParamName: "Length",
          InnerTree: { "{0;0}": [{ type: "System.Double", data: params.length }] }
        },
        {
          ParamName: "Width",
          InnerTree: { "{0;0}": [{ type: "System.Double", data: params.width }] }
        },
        {
          ParamName: "Thickness",
          InnerTree: { "{0;0}":[{ type: "System.Double", data: params.thickness }] }
        },
        {
          ParamName: "TailType", 
          InnerTree: { "{0;0}":[{ type: "System.String", data: params.tailType }] }
        }
      ]
    };

    const response = await fetch(`${computeUrl}/grasshopper`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(apiKey ? { "RhinoComputeKey": apiKey } : {})
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      throw new Error(`Rhino Compute failed: ${response.statusText}`);
    }

    interface ComputeValue {
      ParamName: string;
      InnerTree: Record<string, Array<{ data: string }>>;
    }

    interface ComputeResponse {
      values: ComputeValue[];
    }

    const result = (await response.json()) as ComputeResponse;
    
    // Extract the base64 mesh or standard format returned by the GH script
    const meshOutput = result.values?.find((v) => v.ParamName === "Mesh");
    const meshData = meshOutput?.InnerTree?.["{0;0}"]?.[0]?.data ?? "NO_MESH_FOUND";

    return { mesh: String(meshData) };
  } catch (error) {
    console.error("[Rhino Compute] Error calling compute server:", error);
    throw error;
  }
};
