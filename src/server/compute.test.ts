import { describe, expect, it } from "bun:test";
import { app } from "./index";

describe("POST /api/compute/board", () => {
  it("returns mock mesh data when RHINO_COMPUTE_URL is absent", async () => {
    const payload = {
      length: 72,
      width: 19.5,
      thickness: 2.5,
      tailType: "squash"
    };

    const req = new Request("http://localhost/api/compute/board", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    const res = await app.handle(req);
    expect(res.status).toBe(200);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const body = (await res.json()) as any;
    expect(body.status).toBe("success");
    expect(body.data.mesh).toBe("MOCK_BASE64_MESH_DATA");
  });

  it("validates the input parameters and rejects invalid types", async () => {
    const invalidPayload = {
      length: "seventy-two", // invalid type, should be number
      width: 19.5,
      thickness: 2.5,
      tailType: "squash"
    };

    const req = new Request("http://localhost/api/compute/board", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(invalidPayload)
    });

    const res = await app.handle(req);
    expect(res.status).toBe(422); // Unprocessable Entity (Elysia validation error)
  });
});
