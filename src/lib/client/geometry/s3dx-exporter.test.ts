import { expect } from "@open-wc/testing";
import { Effect } from "effect";
import { translateToShape3d, exportS3dx } from "./s3dx-exporter";
import { parseS3dx } from "./s3dx-importer";
import { generateBoardCurves, type BoardCurves } from "./board-curves";
import { INITIAL_STATE, type BoardModel, type BezierCurveData } from "../../../components/pages/board-builder-page.logic";
import { runClientPromise } from "../runtime";

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
      const [x, y, z] = translateToShape3d([-W / 2, 0, 0], L, T);
      expect(y).to.be.closeTo((-W / 2) * 2.54, 0.0001);
    });
  });

  describe("exportS3dx (XML Generation Pipeline)", () => {
    it("generates a valid XML skeleton with accurate cm conversions", async () => {
      // Minimal mocked curves to bypass Rhino dependency in this test
      const mockCurves: BoardCurves = {
        outline: [[0, 0, -35],[9.375, 0, 0],[0, 0, 35]],
        rockerTop: [[0, 1.25, -35], [0, 1.25, 0],[0, 1.25, 35]],
        rockerBottom: [[0, -1.25, -35],[0, -1.25, 0],[0, -1.25, 35]]
      };

      const mockModel = {
        length: 70,
        width: 18.75,
        thickness: 2.5,
        volume: 30.5,
        finSetup: "quad",
        frontFinZ: 11.0,
        frontFinX: 1.25,
        rearFinZ: 6.0,
        rearFinX: 1.5,
        toeAngle: 1.5,
        cantAngle: 4.0,
        coreMaterial: "pu",
        glassingSchedule: "heavy",
        outline: { controlPoints:[[0, 0, -35],[9.375, 0, 0],[0, 0, 35]], tangents1: [[0, 0, -35], [9.375, 0, -10],[0, 0, 25]], tangents2: [[0, 0, -25],[9.375, 0, 10],[0, 0, 35]] },
        rockerTop: { controlPoints: [[0, 1.25, -35],[0, 1.25, 0],[0, 1.25, 35]], tangents1: [[0, 1.25, -35], [0, 1.25, -10],[0, 1.25, 25]], tangents2: [[0, 1.25, -25],[0, 1.25, 10],[0, 1.25, 35]] },
        rockerBottom: { controlPoints: [[0, -1.25, -35],[0, -1.25, 0],[0, -1.25, 35]], tangents1: [[0, -1.25, -35],[0, -1.25, -10],[0, -1.25, 25]], tangents2: [[0, -1.25, -25],[0, -1.25, 10],[0, -1.25, 35]] },
        crossSections:[{
          controlPoints: [[0, -1.25, 0],[6, -1.25, 0],[9.375, 0, 0],[6, 1.25, 0],[0, 1.25, 0]],
          tangents1: [[0, -1.25, 0],[4, -1.25, 0], [9.375, -0.5, 0],[8, 1.25, 0], [2, 1.25, 0]],
          tangents2: [[2, -1.25, 0],[8, -1.25, 0],[9.375, 0.5, 0],[4, 1.25, 0], [0, 1.25, 0]]
        }]
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

      // Verify Main Curves were injected
      expect(xml).to.include("<Otl>");
      expect(xml).to.include("<StrBot>");
      expect(xml).to.include("<StrDeck>");
      
      // Ensure the Bezier3d tag structure is correct and robust
      expect(xml).to.include("<Bezier3d>");
      expect(xml).to.include("<Tangents_1>");
      expect(xml).to.include("<Tangents_2>");
      expect(xml).to.include("<Tangents_m>");
      expect(xml).to.include("<Control_type_point_0> 32 </Control_type_point_0>");

      // Verify Step 3 Slices were injected using exact array length (1 mock slice)
      expect(xml).to.include("<Number_of_slices>1</Number_of_slices>");
      expect(xml).to.include("<Couples_0>");
    });
  });

  describe("Integration: Export-Import Round Trip", () => {
    const FIXTURES =["WitcherDaily.s3dx", "rounded pin 6'1.s3dx"];

    for (const fixture of FIXTURES) {
      it(`preserves geometric integrity of ${fixture} within tolerances after full round-trip`, async () => {
        // 1. Import canonical ground truth
        const response = await fetch(`/src/assets/fixtures/s3dx/${fixture}`);
        expect(response.ok).to.be.true;
        const originalXml = await response.text();
        const groundTruth = await runClientPromise(parseS3dx(originalXml));

        // 2. Create BoardModel
        const mockModel: BoardModel = {
          ...INITIAL_STATE,
          length: groundTruth.length,
          width: groundTruth.width,
          thickness: groundTruth.thickness,
          outline: groundTruth.outline,
          rockerTop: groundTruth.rockerTop,
          rockerBottom: groundTruth.rockerBottom,
          crossSections: groundTruth.crossSections,
          railOutline: groundTruth.railOutline,
          apexOutline: groundTruth.apexOutline,
          apexRocker: groundTruth.apexRocker,
        };

        // 3. Generate Curves and Export
        const curves = await generateBoardCurves(mockModel);
        const exportedXml = await runClientPromise(exportS3dx(mockModel, curves));

        // 4. Import the newly generated XML
        const roundTripData = await runClientPromise(parseS3dx(exportedXml));

        // 5. Tolerance-based assertions
        const TOLERANCE = 0.05; // 0.05 inches tolerance

        // Dimensions
        expect(roundTripData.length).to.be.closeTo(groundTruth.length, TOLERANCE, "Length mismatch");
        expect(roundTripData.width).to.be.closeTo(groundTruth.width, TOLERANCE, "Width mismatch");
        expect(roundTripData.thickness).to.be.closeTo(groundTruth.thickness, TOLERANCE, "Thickness mismatch");

        // Helper to check curve points
        const expectCurvesClose = (c1: BezierCurveData | undefined, c2: BezierCurveData | undefined, name: string) => {
          if (!c1 || !c2) {
            expect(!!c1).to.equal(!!c2, `${name} curve presence mismatch`);
            return;
          }
          expect(c2.controlPoints.length).to.equal(c1.controlPoints.length, `${name} point count mismatch`);
          for (let i = 0; i < c1.controlPoints.length; i++) {
            expect(c2.controlPoints[i]![0]).to.be.closeTo(c1.controlPoints[i]![0], TOLERANCE, `${name} CP[${i}].x mismatch`);
            expect(c2.controlPoints[i]![1]).to.be.closeTo(c1.controlPoints[i]![1], TOLERANCE, `${name} CP[${i}].y mismatch`);
            expect(c2.controlPoints[i]![2]).to.be.closeTo(c1.controlPoints[i]![2], TOLERANCE, `${name} CP[${i}].z mismatch`);
          }
        };

        expectCurvesClose(groundTruth.outline, roundTripData.outline, "Outline");
        expectCurvesClose(groundTruth.rockerTop, roundTripData.rockerTop, "RockerTop");
        expectCurvesClose(groundTruth.rockerBottom, roundTripData.rockerBottom, "RockerBottom");
        expectCurvesClose(groundTruth.railOutline, roundTripData.railOutline, "RailOutline");
        expectCurvesClose(groundTruth.apexOutline, roundTripData.apexOutline, "ApexOutline");
        expectCurvesClose(groundTruth.apexRocker, roundTripData.apexRocker, "ApexRocker");
        
        expect(roundTripData.crossSections.length).to.equal(groundTruth.crossSections.length, "CrossSections count mismatch");
        for (let j = 0; j < groundTruth.crossSections.length; j++) {
          expectCurvesClose(groundTruth.crossSections[j], roundTripData.crossSections[j], `CrossSection[${j}]`);
        }
      });
    }
  });
});
