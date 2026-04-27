import { expect } from "@open-wc/testing";
import { Effect } from "effect";
import { translateFromShape3d, parseS3dx } from "./s3dx-importer";
import type { BezierCurveData, Point3D, BoardModel } from "../../../components/pages/board-builder-page.logic";
import { evaluateCompositeOutlineAtZ } from "./mesh-generator";
import { INITIAL_STATE } from "../../../components/pages/board-builder-page.logic";

describe("S3DX Importer", () => {
  describe("translateFromShape3d (Coordinate Inversion)", () => {
    const L = 72;  // 6'0" board length in inches
    const T = 2.5; // 2.5" thickness
    const CM_TO_INCHES = 1 / 2.54;

    it("translates Shape3D origin (Tail, Stringer, Bottom) to SS9000 coordinates", () => {
      // S3D Origin:[0, 0, 0] (Tail, Stringer, Bottom)
      const [x, y, z] = translateFromShape3d([0, 0, 0], L, T);
      expect(x).to.be.closeTo(0, 0.0001);          // Stringer is still 0
      expect(y).to.be.closeTo(-T / 2, 0.0001);     // Bottom is at -T/2 in SS9000
      expect(z).to.be.closeTo(L / 2, 0.0001);      // Tail is at +L/2 in SS9000
    });

    it("translates Shape3D Nose to SS9000 Nose", () => {
      // S3D Nose is at X = L * 2.54
      const s3dLengthCm = L * 2.54;
      const[x, y, z] = translateFromShape3d([s3dLengthCm, 0, 0], L, T);
      expect(z).to.be.closeTo(-L / 2, 0.0001);     // Nose is at -L/2 in SS9000
    });

    it("translates Shape3D Width to SS9000 Width", () => {
      const widthCm = 10 * 2.54; // 10 inches off stringer
      const [x, y, z] = translateFromShape3d([0, widthCm, 0], L, T);
      expect(x).to.be.closeTo(10, 0.0001);         // SS9000 X is width
    });
  });

  describe("parseS3dx (XML DOM Parsing)", () => {
    it("correctly extracts dimensions and Bezier curves from a real s3dx payload", async () => {
      // A minimal representation of a real .s3dx file
      const mockS3dx = `<?xml version="1.0" encoding="iso-8859-1"?>
      <Shape3d_design>
        <Board>
          <Length>177.800</Length> <!-- 70 inches -->
          <Width>47.625</Width>    <!-- 18.75 inches -->
          <Thickness>6.350</Thickness> <!-- 2.5 inches -->
          
          <Otl>
            <Bezier3d>
              <Control_points>
                <Polygone3d>
                  <Point3d><x>0.000000</x><y>0.000000</y><z>0.000000</z></Point3d>
                  <Point3d><x>88.900000</x><y>23.812500</y><z>0.000000</z></Point3d>
                  <Point3d><x>177.800000</x><y>0.000000</y><z>0.000000</z></Point3d>
                </Polygone3d>
              </Control_points>
            </Bezier3d>
          </Otl>

          <StrBot>
            <Bezier3d>
              <Control_points>
                <Polygone3d>
                  <Point3d><x>0.000000</x><y>0.000000</y><z>0.000000</z></Point3d>
                </Polygone3d>
              </Control_points>
            </Bezier3d>
          </StrBot>

          <StrDeck>
            <Bezier3d>
              <Control_points>
                <Polygone3d>
                  <Point3d><x>0.000000</x><y>0.000000</y><z>6.350000</z></Point3d>
                </Polygone3d>
              </Control_points>
            </Bezier3d>
          </StrDeck>

          <Couples_0>
            <Bezier3d>
              <Control_points>
                <Polygone3d>
                  <Point3d><x>0.000000</x><y>0.000000</y><z>0.000000</z></Point3d>
                  <Point3d><x>0.000000</x><y>5.000000</y><z>0.000000</z></Point3d>
                </Polygone3d>
              </Control_points>
            </Bezier3d>
          </Couples_0>
        </Board>
      </Shape3d_design>`;

      const result = await Effect.runPromise(parseS3dx(mockS3dx));

      // Verify Extracted Metadata
      expect(result.length).to.be.closeTo(70, 0.001);
      expect(result.width).to.be.closeTo(18.75, 0.001);
      expect(result.thickness).to.be.closeTo(2.5, 0.001);

      // Verify Outline Extracted and mapped to SS9000 coordinates
      expect(result.outline.controlPoints.length).to.equal(3);
      // Nose anchor (Reversed so index 0 is Nose)
      expect(result.outline.controlPoints[0]![2]).to.be.closeTo(-35, 0.001); // -L/2
      expect(result.outline.controlPoints[0]![0]).to.be.closeTo(0, 0.001);
      // Wide point
      expect(result.outline.controlPoints[1]![2]).to.be.closeTo(0, 0.001);
      expect(result.outline.controlPoints[1]![0]).to.be.closeTo(18.75 / 2, 0.001); // Half width
      // Tail anchor
      expect(result.outline.controlPoints[2]![2]).to.be.closeTo(35, 0.001); // +L/2

      // Verify Rocker Extracted
      expect(result.rockerBottom.controlPoints.length).to.equal(1);
      expect(result.rockerTop.controlPoints.length).to.equal(1);
      
      // Verify Deck point Z (thickness mapping)
      // S3D Deck at tail: [0, 0, 6.35 cm]
      // SS9000: Y = (6.35 * cmToInches) - 1.25 = 2.5 - 1.25 = +1.25 (Top Plane)
      expect(result.rockerTop.controlPoints[0]![1]).to.be.closeTo(1.25, 0.001);

      // Verify Slices Extracted
      expect(result.crossSections.length).to.equal(1);
      expect(result.crossSections[0]!.controlPoints.length).to.equal(2);
    });

    const FIXTURES =["WitcherDaily.s3dx", "rounded-pin-6-1.s3dx", "wildcat-fixed-winged-pin.s3dx", "gh-60-winged-swallow.s3dx", "TomoLike.s3dx", "FISH.s3dx"];

    for (const fixture of FIXTURES) {
      it(`can parse a full, real-world .s3dx file (${fixture})`, async () => {
        console.info(`[s3dx-importer.test] Parsing: ${fixture}`);
        // Web Test Runner serves the project directory, so we can fetch the fixture natively!
        const response = await fetch(`/src/assets/fixtures/s3dx/${fixture}`);
        expect(response.ok).to.be.true;
        
        const xml = await response.text();
        const result = await Effect.runPromise(parseS3dx(xml));
        
        if (fixture === "WitcherDaily.s3dx") {
          // Verify Metric to Imperial Conversion
          // WitcherDaily is 193.04 cm -> 76 inches (6'4")
          expect(result.length).to.be.closeTo(76, 0.1);
          
          // 51.435 cm -> 20.25 inches
          expect(result.width).to.be.closeTo(20.25, 0.1);
          
          // 6.983 cm -> ~2.75 inches
          expect(result.thickness).to.be.closeTo(2.75, 0.1);
          
          // Verify Complex Curve Extraction
          // The WitcherDaily file has 4 anchor points for its outline
          expect(result.outline.controlPoints.length).to.equal(4);

          // It has standard 3-point rockers
          expect(result.rockerBottom.controlPoints.length).to.equal(3);
          expect(result.rockerTop.controlPoints.length).to.equal(3);
          
          // It has 8 cross-section couples. We now keep all of them (including microscopic tips)
          // to ensure a 1:1 accurate import and smooth mesh closure.
          expect(result.crossSections.length).to.equal(8);
        } else {
          expect(result.length).to.be.greaterThan(0);
          expect(result.width).to.be.greaterThan(0);
          expect(result.thickness).to.be.greaterThan(0);
          expect(result.outline.controlPoints.length).to.be.greaterThan(1);
          expect(result.rockerBottom.controlPoints.length).to.be.greaterThan(1);
          expect(result.rockerTop.controlPoints.length).to.be.greaterThan(1);
          expect(result.crossSections.length).to.be.greaterThan(0);
        }

        // Verify reversal applied: First point must be the nose (Negative Z)
        expect(result.outline.controlPoints[0]![2]).to.be.lessThan(0);
        expect(result.crossSections[0]!.controlPoints[0]![2]).to.be.lessThan(0);
      });

      it(`ensures ${fixture} outline has no negative widths after import`, async () => {
        console.info(`[s3dx-importer.test] Checking for negative widths: ${fixture}`);
        const response = await fetch(`/src/assets/fixtures/s3dx/${fixture}`);
        const xml = await response.text();
        const result = await Effect.runPromise(parseS3dx(xml));
        
        const { outline, railOutline, apexOutline } = result;

        const checkCurve = (curve: BezierCurveData, name: string) => {
          let hasNegative = false;
          curve.controlPoints.forEach((p: Point3D) => {
            if (p[0] < 0) hasNegative = true;
          });
          curve.tangents1.forEach((p: Point3D) => {
            if (p[0] < 0) hasNegative = true;
          });
          curve.tangents2.forEach((p: Point3D) => {
            if (p[0] < 0) hasNegative = true;
          });
          expect(hasNegative, `Curve '${name}' should not have negative X (width) values`).to.be.false;
        };
    
        checkCurve(outline, "outline");
        if (railOutline) checkCurve(railOutline, "railOutline");
        if (apexOutline) checkCurve(apexOutline, "apexOutline");
      });

      it("should detect and merge 3D Outline Layers (Wings) from gh-60-winged-swallow.s3dx", async () => {
        const response = await fetch("/src/assets/fixtures/s3dx/gh-60-winged-swallow.s3dx");
        const xml = await response.text();
        const result = await Effect.runPromise(parseS3dx(xml));

        // In gh-60-winged-swallow.s3dx, Calque_1 (Layer 2) defines a wing.
        // At Shape3D X = 25.02cm (Length from tail), the wing width is 18.946cm.
        // The main outline at that same Z has a width of only 16.931cm.
        // 18.946cm / 2.54 = ~7.458 inches.

        const boardLengthInches = result.length;
        const targetZ_ss = boardLengthInches / 2 - (25.02 / 2.54);

        // Construct a mock model to pass to the composite evaluator
        const mockModel: BoardModel = {
          ...INITIAL_STATE,
          ...result
        };

        const pointAtZ = evaluateCompositeOutlineAtZ(mockModel, targetZ_ss);
        const actualWidth = pointAtZ[0]; // Width is the x-component of the composite point
        const wingWidth = 18.946 / 2.54;

        expect(actualWidth).to.be.closeTo(wingWidth, 0.1, 
          "The imported outline should reflect the 3D Layer (Wing) width, not the base outline."
        );
      });
    }

    it("fails gracefully if the XML is malformed or missing metadata", async () => {
      const badXml = `<Shape3d_design><Board><Length>100</Length></Board></Shape3d_design>`; // Missing Thickness
      
      try {
        await Effect.runPromise(parseS3dx(badXml));
        expect.fail("Should have thrown an error");
      } catch (err) {
        expect((err as Error).message).to.include("Missing core dimensions");
      }
    });
  });
});
