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
      const [x, y, z] = translateToShape3d([0, T / 2, 0], L, T);
      expect(z).to.be.closeTo(T * 2.54, 0.0001);
    });
    
    it("translates the right rail to Y_s3d = Half Width in cm (Shape3d Y Axis)", () => {
      // SS9000 Right Rail is at X = W/2
      const [x, y, z] = translateToShape3d([W / 2, 0, 0], L, T);
      expect(y).to.be.closeTo((W / 2) * 2.54, 0.0001);
    });

    it("translates the left rail to Y_s3d = Negative Half Width in cm", () => {
      // SS9000 Left Rail is at X = -W/2
      const [x, y, z] = translateToShape3d([-W / 2, 0, 0], L, T);
      expect(y).to.be.closeTo((-W / 2) * 2.54, 0.0001);
    });
  });

  describe("exportS3dx (XML Generation Pipeline)", () => {
    it("generates a valid XML skeleton with accurate cm conversions", async () => {
      const mockModel = {
        length: 70,
        width: 18.75,
        thickness: 2.5,
        tailType: "squash"
      } as BoardModel;

      // Minimal mocked curves to bypass Rhino dependency in this test
      const mockCurves: BoardCurves = {
        outline: [[0, 0, -35], [9.375, 0, 0], [0, 0, 35]],
        rockerTop: [[0, 1.25, -35], [0, 1.25, 0], [0, 1.25, 35]],
        rockerBottom: [[0, -1.25, -35], [0, -1.25, 0], [0, -1.25, 35]]
      };

      const xml = await Effect.runPromise(exportS3dx(mockModel, mockCurves));
      
      // Verify XML Declarations
      expect(xml).to.include('<?xml version="1.0" encoding="iso-8859-1"?>');
      expect(xml).to.include("<Shape3d_design>");
      expect(xml).to.include("<Name>SuperShaper_70.0_squash</Name>");

      // Verify Unit Conversions (Inches to Centimeters)
      // 70 inches * 2.54 = 177.800 cm
      expect(xml).to.include("<Length>177.800</Length>");
      // 18.75 * 2.54 = 47.625 cm
      expect(xml).to.include("<Width>47.625</Width>");
      // 2.5 * 2.54 = 6.350 cm
      expect(xml).to.include("<Thickness>6.350</Thickness>");
    });
  });
});
