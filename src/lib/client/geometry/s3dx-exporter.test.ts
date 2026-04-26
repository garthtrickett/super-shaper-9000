import { expect } from "@open-wc/testing";
import { Effect } from "effect";
import { translateToShape3d, exportS3dx } from "./s3dx-exporter";
import type { BoardModel } from "../../../components/pages/board-builder-page.logic";
import type { BoardCurves } from "./board-curves";

describe("S3DX Exporter", () => {
  describe("translateToShape3d (World Coordinate Mapping)", () => {
    const L = 72;  // 6'0" board length in inches
    const W = 20;  // 20" width
    const T = 2.5; // 2.5" thickness

    it("translates the absolute tail to X_s3d = 0 (Shape3d X Origin)", () => {
      // SS9000 Tail is at Z = +L/2
      const [x, y, z] = translateToShape3d([0, 0, L / 2], L, T);
      expect(x).to.be.closeTo(0, 0.0001); // 0cm from tail
      expect(y).to.be.closeTo(0, 0.0001); // Stringer is 0
      expect(z).to.be.closeTo((T / 2) * 2.54, 0.0001); // Dead center of thickness
    });

    it("translates the absolute nose to X_s3d = Total Length in cm", () => {
      // SS9000 Nose is at Z = -L/2
      const [x, y, z] = translateToShape3d([0, 0, -L / 2], L, T);
      expect(x).to.be.closeTo(L * 2.54, 0.0001); // Full length away from tail
    });

    it("translates the stringer bottom to Z_s3d = 0 (Shape3d Z Origin)", () => {
      // SS9000 Bottom is at Y = -T/2
      const [x, y, z] = translateToShape3d([0, -T / 2, 0], L, T);
      expect(z).to.be.closeTo(0, 0.0001); // Bottom plane is 0cm
    });

    it("translates the stringer deck to Z_s3d = Total Thickness in cm", () => {
      // SS9000 Top is at Y = +T/2
      const[x, y, z] = translateToShape3d([0, T / 2, 0], L, T);
      expect(z).to.be.closeTo(T * 2.54, 0.0001);
    });
    
    it("translates the right rail to Y_s3d = Half Width in cm (Shape3d Y Axis)", () => {
      // SS9000 Right Rail is at X = W/2
      const [x, y, z] = translateToShape3d([W / 2, 0, 0], L, T);
      expect(y).to.be.closeTo((W / 2) * 2.54, 0.0001);
    });

    it("translates the left rail to Y_s3d = Negative Half Width in cm", () => {
      // SS9000 Left Rail is at X = -W/2
      const[x, y, z] = translateToShape3d([-W / 2, 0, 0], L, T);
      expect(y).to.be.closeTo((-W / 2) * 2.54, 0.0001);
    });
  });

  describe("exportS3dx (XML Generation Pipeline)", () => {
    it("generates a valid XML skeleton with accurate cm conversions", async () => {
      // Minimal mocked curves to bypass Rhino dependency in this test
      const mockCurves: BoardCurves = {
        outline: [[0, 0, -35], [9.375, 0, 0],[0, 0, 35]],
        rockerTop: [[0, 1.25, -35], [0, 1.25, 0],[0, 1.25, 35]],
        rockerBottom: [[0, -1.25, -35],[0, -1.25, 0], [0, -1.25, 35]]
      };

      const mockModel = {
        length: 70,
        width: 18.75,
        thickness: 2.5,
        volume: 30.5,
        finSetup: "quad",
        frontFinX: 1.25,
        frontFinZ: 11,
        rearFinX: 1.75,
        rearFinZ: 5.5,
        toeAngle: 3,
        cantAngle: 6,
        coreMaterial: "pu",
        glassingSchedule: "heavy",
        outline: { controlPoints:[], tangents1: [], tangents2: [] },
        rockerTop: { controlPoints: [], tangents1:[], tangents2: [] },
        rockerBottom: { controlPoints: [], tangents1: [], tangents2:[] },
        crossSections:[]
      } as unknown as BoardModel;

      const xml = await Effect.runPromise(exportS3dx(mockModel, mockCurves));
      
      // Verify XML Declarations & Metadata
      expect(xml).to.include('<?xml version="1.0" encoding="iso-8859-1"?>');
      expect(xml).to.include("<Shape3d_design>");
      expect(xml).to.include("<Name>SuperShaper_70.0</Name>");
      expect(xml).to.include("<Version>9</Version>");
      expect(xml).to.include("<Author>Super Shaper 9000</Author>");

      // Verify Unit Conversions (Inches to Centimeters)
      // 70 inches * 2.54 = 177.800 cm
      expect(xml).to.include("<Length>177.800</Length>");
      // 18.75 * 2.54 = 47.625 cm
      expect(xml).to.include("<Width>47.625</Width>");
      // 2.5 * 2.54 = 6.350 cm
      expect(xml).to.include("<Thickness>6.350</Thickness>");
      
      expect(xml).to.include("<Volume>30.500</Volume>");

      // Verify Step 2 Curve XML Tags were injected
      expect(xml).to.include("<Otl>");
      expect(xml).to.include("<StrBot>");
      expect(xml).to.include("<StrDeck>");
      
      // Ensure the Bezier3d tag structure is correct and robust
      expect(xml).to.include("<Bezier3d>");
      expect(xml).to.include("<Tangents_1>");
      expect(xml).to.include("<Tangents_2>");
      expect(xml).to.include("<Tangents_m>");
      expect(xml).to.include("<Control_type_point_0> 32 </Control_type_point_0>");

      // Verify Step 3 Slices were injected
      expect(xml).to.include("<Number_of_slices>8</Number_of_slices>");
      expect(xml).to.include("<Couples_0>");
      expect(xml).to.include("<Couples_7>");
    });
  });
});
