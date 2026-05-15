import * as THREE from "three";
import type { BoardModel, BezierCurveData } from "../../pages/board-builder-page.logic";
import { clientLog } from "../../../lib/client/clientLog";
import { runClientUnscoped } from "../../../lib/client/runtime";
import type { WasmEngine } from "../../../lib/client/wasm/surfer_wasm.js";

export class GizmoBuilder {
    static build(
    group: THREE.Group, 
    boardState: BoardModel,
    mathEngine: WasmEngine, 
    scale: number,
    matAnchor: THREE.Material,
    matHandle: THREE.Material,
    activeProfileSlice: number = 0
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

            const anchorGeo = new THREE.SphereGeometry(0.35 * scale, 16, 16);
    const handleGeo = new THREE.BoxGeometry(0.25 * scale, 0.25 * scale, 0.25 * scale);
    const lineMat = new THREE.LineDashedMaterial({ color: 0x94a3b8, dashSize: 0.5 * scale, gapSize: 0.5 * scale, depthTest: false });
    const lineMatCrossSection = new THREE.LineDashedMaterial({ color: 0x94a3b8, dashSize: (0.5 * scale) / 3.5, gapSize: (0.5 * scale) / 3.5, depthTest: false });


                                        const getZHeight = (curveName: string, yInches: number, zInches: number) => {
        const profile = mathEngine.get_profile_at_z(zInches) as { topY: number, botY: number, apexY: number, tuckY: number, shoulderY: number };
        if (['outline', 'apexOutline'].includes(curveName)) {
            return profile.apexY;
        }
        if (curveName === 'railOutline') {
            return profile.tuckY;
        }
        if (curveName === 'deckShoulder') {
            return profile.shoulderY;
        }
        if (curveName.startsWith('channel_') && curveName.endsWith('_outline')) {
            return profile.botY;
        }
                if (curveName.startsWith('channel_') && curveName.endsWith('_depth')) {
            // Vertically offset the depth curve gizmos slightly (-2.0 inches) so they don't visually overlap with the outline gizmos
            return profile.botY - 2.0 + yInches;
        }
                if (curveName.startsWith('crossSection_')) {
            const idx = parseInt(curveName.split('_')[1] || "0", 10);
            const cs = boardState.crossSections?.[idx];
            if (cs && cs.controlPoints.length > 0) {
                const rawBot = cs.controlPoints[0]![1];
                const rawTop = cs.controlPoints[cs.controlPoints.length - 1]![1];
                const rawH = Math.max(rawTop - rawBot, 0.0001);
                const worldH = Math.max(profile.topY - profile.botY, 0.0001);
                return profile.botY + ((yInches - rawBot) / rawH) * worldH;
            }
        }
        return yInches;
    };

                const getXOffset = (curveName: string, xInches: number, zInches: number) => {
            if (curveName === 'apexRocker') {
                const profile = mathEngine.get_profile_at_z(zInches) as { apexX: number };
                return profile.apexX;
            }
            return xInches;
        };

        const matLayerAnchor = new THREE.MeshBasicMaterial({ color: 0xf59e0b, depthTest: false });
    const matLayerHandle = new THREE.MeshBasicMaterial({ color: 0xfcd34d, depthTest: false });

                const drawGizmosForCurve = (curve: BezierCurveData | undefined, curveName: string, layerIndex: number, isLayer = false) => {
        const aMat = isLayer ? matLayerAnchor : matAnchor;
        const hMat = isLayer ? matLayerHandle : matHandle;
        if (!curve) return;

                const isCrossSection = curveName.startsWith('crossSection_');
        const isSideView = layerIndex === 2;
        const isTopView = layerIndex === 1;

        let scaleX = 1.0;
        let scaleY = 1.0;
        let scaleZ = 1.0;

        let userScale = 1.0;
        if (isCrossSection) {
            userScale = boardState.gizmoScaleProfile ?? 1.0;
        } else if (isSideView) {
            userScale = boardState.gizmoScaleSide ?? 1.0;
        } else if (isTopView) {
            userScale = boardState.gizmoScaleTop ?? 1.0;
        }

        if (isCrossSection) {
            scaleX = (1.0 / 3.5) * userScale;
            scaleY = (1.0 / 3.5) * userScale;
            scaleZ = (1.0 / 3.5) * userScale;
        } else if (isSideView) {
            scaleX = (1.0 / 3.0) * userScale;
            scaleY = ((1.0 / 3.0) / 2.5) * userScale; // Counter-stretch for 2.5x camera Y stretch
            scaleZ = (1.0 / 3.0) * userScale;
        } else {
            scaleX = userScale;
            scaleY = userScale;
            scaleZ = userScale;
        }

        for (let i = 0; i < curve.controlPoints.length; i++) {
            const cp = curve.controlPoints[i]!;
            const t1 = curve.tangents1[i];
            const t2 = curve.tangents2[i];
            
            const cpY = getZHeight(curveName, cp[1], cp[2]);
            const cpX = getXOffset(curveName, cp[0], cp[2]);

                        const anchorMesh = new THREE.Mesh(anchorGeo, aMat);
            anchorMesh.scale.set(scaleX, scaleY, scaleZ);
            anchorMesh.position.set(cpX * scale, cpY * scale, cp[2] * scale);
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

                const tY = getZHeight(curveName, t[1], t[2]);
                const tX = getXOffset(curveName, t[0], t[2]);
                                const handleMesh = new THREE.Mesh(handleGeo, hMat);
                handleMesh.scale.set(scaleX, scaleY, scaleZ);
                handleMesh.position.set(tX * scale, tY * scale, t[2] * scale);
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
                    new THREE.Vector3(cpX * scale, cpY * scale, cp[2] * scale),
                    new THREE.Vector3(tX * scale, tY * scale, t[2] * scale)
                ]);
                const line = new THREE.Line(lineGeo, isCrossSection ? lineMatCrossSection : lineMat);
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
    if (boardState.showDeckShoulder !== false) drawGizmosForCurve(boardState.deckShoulder, 'deckShoulder', 1);
    
            if (boardState.showCrossSections !== false && boardState.crossSections) {
        boardState.crossSections.forEach((cs, idx) => {
            // The active profile slice goes on layer 3 (visible to profile cam), others on layer 4 (only visible to perspective cam)
            drawGizmosForCurve(cs, `crossSection_${idx}`, idx === activeProfileSlice ? 3 : 4);
        });
    }

                if (boardState.showOutline !== false && boardState.outlineLayers) {
        boardState.outlineLayers.forEach((layer, idx) => {
            if (layer.active === false) return;
            if (layer.otlExt?.controlPoints?.length > 0) {
                drawGizmosForCurve(layer.otlExt, `outlineLayer_${idx}_ext`, 1, true);
            }
            if (layer.otlInt?.controlPoints?.length > 0) {
                drawGizmosForCurve(layer.otlInt, `outlineLayer_${idx}_int`, 1, true);
            }
        });
    }

        if (boardState.bottomChannels) {
        boardState.bottomChannels.forEach((channel, idx) => {
            if (channel.leftOutline?.controlPoints?.length > 0) {
                drawGizmosForCurve(channel.leftOutline, `channel_${idx}_left_outline`, 1, true);
            }
            if (channel.rightOutline?.controlPoints?.length > 0) {
                drawGizmosForCurve(channel.rightOutline, `channel_${idx}_right_outline`, 1, true);
            }
            if (channel.leftDepth?.controlPoints?.length > 0) {
                drawGizmosForCurve(channel.leftDepth, `channel_${idx}_left_depth`, 2, true);
            }
            if (channel.rightDepth?.controlPoints?.length > 0) {
                drawGizmosForCurve(channel.rightDepth, `channel_${idx}_right_depth`, 2, true);
            }
        });
    }
  }
}
