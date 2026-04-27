import * as THREE from "three";
import type { BoardModel } from "../../pages/board-builder-page.logic";
import type { BoardCurves } from "../../../lib/client/geometry/board-curves";
import { MeshGeneratorService } from "../../../lib/client/geometry/mesh-generator";

export class FinBuilder {
  static build(group: THREE.Group, boardState: BoardModel, curves: BoardCurves, scale: number) {
    while (group.children.length > 0) {
        const child = group.children[0] as THREE.Mesh;
        if (child.geometry) child.geometry.dispose();
        if (child.material) (child.material as THREE.Material).dispose();
        group.remove(child);
    }

    const createFinMesh = (isSmall: boolean = false, isBlueprint: boolean = false) => {
        const shape = new THREE.Shape();
        const base = isSmall ? 3.5 * scale : 4.5 * scale;
        const height = isSmall ? 4.0 * scale : 4.75 * scale;
        const sweep = isSmall ? 2.0 * scale : 2.5 * scale; 
        
        // Draw realistic Swept Fin Profile
        const leadX = base / 2;
        const trailX = -base / 2;
        const tipX = trailX + sweep; // Sweep back towards tail
        
        shape.moveTo(trailX, 0); // Trailing edge base
        // Trailing edge curve (sweeping back and up to tip)
        shape.quadraticCurveTo(trailX + sweep * 0.8, height * 0.4, tipX, height);
        // Leading edge curve (sweeping from tip down to leading base)
        shape.quadraticCurveTo(leadX + sweep * 0.2, height * 0.5, leadX, 0);
        shape.lineTo(trailX, 0); // Close base

        // Extrude with thin core and bevel to create an aerodynamic foil
        const geom = new THREE.ExtrudeGeometry(shape, { 
            depth: 0.05 * scale, 
            bevelEnabled: true, 
            bevelThickness: 0.08 * scale, 
            bevelSize: 0.05 * scale, 
            bevelSegments: 4 
        });
        
        // Center the thickness perfectly
        geom.translate(0, 0, -0.025 * scale);
        
        let mat;
        if (isBlueprint) {
            mat = new THREE.MeshBasicMaterial({
                color: 0x09090b,
                depthWrite: true,
                polygonOffset: true,
                polygonOffsetFactor: 1,
                polygonOffsetUnits: 1
            });
        } else {
            mat = new THREE.MeshPhysicalMaterial({ 
                color: 0xf8fafc, 
                roughness: 0.15, 
                transmission: 0.9,
                thickness: 0.2,
                ior: 1.5
            });
        }
        
        const finMesh = new THREE.Mesh(geom, mat);
        
        if (isBlueprint) {
            finMesh.layers.set(5);
            const edgesGeo = new THREE.EdgesGeometry(geom, 15);
            const edgesMat = new THREE.LineBasicMaterial({
                color: 0x3b82f6,
                transparent: true,
                opacity: 0.6
            });
            const finEdges = new THREE.LineSegments(edgesGeo, edgesMat);
            finEdges.layers.set(5);
            finMesh.add(finEdges);
        } else {
            finMesh.castShadow = true;
            finMesh.layers.set(0);
        }
        
        // 1. Flip upside down so tip points down into the water (-Y)
        // 2. Rotate 90deg so leading edge (+X in shape) points towards the board's nose (-Z)
        finMesh.rotation.set(Math.PI, -Math.PI / 2, 0);
        return finMesh;
    };

    const mountFin = (zFromTail: number, railOffset: number, isRight: boolean, isCenter: boolean, isSmall: boolean) => {
        // 1. Create the perfectly oriented local fin meshes
        const finSolid = createFinMesh(isSmall, false);
        const finBlueprint = createFinMesh(isSmall, true);
        
        // 2. Wrap it in a container so Toe and Cant rotations don't conflict
        const finContainer = new THREE.Group();
        finContainer.add(finSolid);
        finContainer.add(finBlueprint);

        // 3. Position the container on the board
        const zLoc = (boardState.length / 2) - zFromTail;
        const profile = MeshGeneratorService.getBoardProfileAtZ(boardState, curves, zLoc);
        const xPos = isCenter ? 0 : (profile.halfWidth - railOffset);
        const actualX = isRight ? xPos : -xPos;
        const yPos = MeshGeneratorService.getBottomYAt(boardState, curves, actualX, zLoc);

        finContainer.position.set(actualX * scale, yPos * scale, zLoc * scale);
        
        // 4. Align to Rocker (pitch) but ignore local Concave/Channel slope for absolute Cant & Pitch control
        const delta = 0.5;
        const pitchYC = MeshGeneratorService.getBoardProfileAtZ(boardState, curves, zLoc).botY;
        const pitchYF = MeshGeneratorService.getBoardProfileAtZ(boardState, curves, zLoc - delta).botY;
        
        const pRockerC = new THREE.Vector3(actualX, pitchYC, zLoc);
        const pRockerF = new THREE.Vector3(actualX, pitchYF, zLoc - delta);
        
        const vForward = new THREE.Vector3().subVectors(pRockerF, pRockerC).normalize();
        const vBackward = vForward.clone().negate();
        
        const absoluteUp = new THREE.Vector3(0, 1, 0);
        const vRight = new THREE.Vector3().crossVectors(absoluteUp, vBackward).normalize();
        const vUp = new THREE.Vector3().crossVectors(vBackward, vRight).normalize();
        
        const rotationMatrix = new THREE.Matrix4().makeBasis(vRight, vUp, vBackward);
        finContainer.rotation.setFromRotationMatrix(rotationMatrix);
        
        // 5. Apply Toe and Cant locally to the perfectly flush container
        if (!box.isCenter) {
            const cantRad = box.cantAngle * Math.PI / 180;
            const toeRad = box.toeAngle * Math.PI / 180;
            
            finContainer.rotateZ(box.isRight ? cantRad : -cantRad);
            finContainer.rotateY(box.isRight ? toeRad : -toeRad);
        }
        
        group.add(finContainer);
    };

    // Render all fins in the parametric model
    boardState.boxes.forEach(box => {
        if (box.type === "fin") {
            mountFin(box);
        }
    });
  }
}
