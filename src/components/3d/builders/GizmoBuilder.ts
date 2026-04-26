import * as THREE from "three";
import type { BoardModel, BezierCurveData } from "../../pages/board-builder-page.logic";
import { clientLog } from "../../../lib/client/clientLog";
import { runClientUnscoped } from "../../../lib/client/runtime";

export class GizmoBuilder {
  static build(
    group: THREE.Group, 
    boardState: BoardModel, 
    scale: number,
    matAnchor: THREE.Material,
    matHandle: THREE.Material
  ) {
    while (group.children.length > 0) {
        const child = group.children[0] as THREE.Mesh | THREE.Line;
        if (child.geometry) child.geometry.dispose();
        if (child.material) {
            if (Array.isArray(child.material)) child.material.forEach(m => m.dispose());
            else child.material.dispose();
        }
        group.remove(child);
    }

    runClientUnscoped(clientLog("info", "[GizmoBuilder] Rendering Bezier Gizmos"));

    const anchorGeo = new THREE.SphereGeometry(0.4 * scale, 16, 16);
    const handleGeo = new THREE.BoxGeometry(0.3 * scale, 0.3 * scale, 0.3 * scale);
    const lineMat = new THREE.LineDashedMaterial({ color: 0x52525b, dashSize: 0.5 * scale, gapSize: 0.5 * scale, depthTest: false });

    const drawGizmosForCurve = (curve: BezierCurveData | undefined, curveName: string, layerIndex: number) => {
        if (!curve) return;
        for (let i = 0; i < curve.controlPoints.length; i++) {
            const cp = curve.controlPoints[i]!;
            const t1 = curve.tangents1[i];
            const t2 = curve.tangents2[i];

            const anchorMesh = new THREE.Mesh(anchorGeo, matAnchor);
            anchorMesh.position.set(cp[0] * scale, cp[1] * scale, cp[2] * scale);
            anchorMesh.renderOrder = 999;
            anchorMesh.layers.set(layerIndex);
            anchorMesh.userData = { 
                isGizmo: true, 
                type: 'anchor', 
                curve: curveName, 
                index: i,
                maxIndex: curve.controlPoints.length - 1,
                origZ: cp[2]
            };
            group.add(anchorMesh);

            const drawHandle = (t:[number, number, number], handleType: string) => {
                if (Math.abs(t[0]-cp[0]) < 0.001 && Math.abs(t[1]-cp[1]) < 0.001 && Math.abs(t[2]-cp[2]) < 0.001) return;

                const handleMesh = new THREE.Mesh(handleGeo, matHandle);
                handleMesh.position.set(t[0] * scale, t[1] * scale, t[2] * scale);
                handleMesh.renderOrder = 999;
                handleMesh.layers.set(layerIndex);
                handleMesh.userData = { 
                    isGizmo: true, 
                    type: handleType, 
                    curve: curveName, 
                    index: i,
                    maxIndex: curve.controlPoints.length - 1,
                    origZ: t[2]
                };
                group.add(handleMesh);

                const lineGeo = new THREE.BufferGeometry().setFromPoints([
                    new THREE.Vector3(cp[0] * scale, cp[1] * scale, cp[2] * scale),
                    new THREE.Vector3(t[0] * scale, t[1] * scale, t[2] * scale)
                ]);
                const line = new THREE.Line(lineGeo, lineMat);
                line.computeLineDistances();
                line.renderOrder = 998;
                line.layers.set(layerIndex);
                group.add(line);
            };

            if (t1) drawHandle(t1, 'tangent1');
            if (t2) drawHandle(t2, 'tangent2');
        }
    };

    if (boardState.showOutline !== false) drawGizmosForCurve(boardState.outline, 'outline', 1);
    if (boardState.showRockerTop !== false) drawGizmosForCurve(boardState.rockerTop, 'rockerTop', 2);
    if (boardState.showRockerBottom !== false) drawGizmosForCurve(boardState.rockerBottom, 'rockerBottom', 2);
    if (boardState.showApexOutline !== false) drawGizmosForCurve(boardState.apexOutline, 'apexOutline', 1);
    if (boardState.showRailOutline !== false) drawGizmosForCurve(boardState.railOutline, 'railOutline', 1);
    if (boardState.showApexRocker !== false) drawGizmosForCurve(boardState.apexRocker, 'apexRocker', 2);
    
    if (boardState.showCrossSections !== false && boardState.crossSections) {
        boardState.crossSections.forEach((cs, idx) => {
            drawGizmosForCurve(cs, `crossSection_${idx}`, 3);
        });
    }
  }
}
