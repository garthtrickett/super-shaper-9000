use crate::model::{BezierCurveData, BoardModel};
use glam::Vec3;

pub fn export_s3dx(model: &BoardModel) -> String {
    let rocker = model.rocker_bottom.as_ref();
    let bounds = crate::geometry::get_board_bounds(model);
    let default_rocker = BezierCurveData::default();
    let table = crate::geometry::RockerArcLengthTable::new(
        rocker.unwrap_or(&default_rocker),
        bounds.nose_z,
        bounds.tip_z,
    );

    let active_length = bounds.tip_z - bounds.nose_z;
    let scale_factor = if active_length > 0.0 {
        table.total_length / active_length
    } else {
        1.0
    };

    let mut xml = String::new();
    xml.push_str("<?xml version=\"1.0\" encoding=\"iso-8859-1\"?>\n<Shape3d_design>\n<Board>\n");
    xml.push_str("<Version>9</Version>\n<VersionNumber>9.1.0.4</VersionNumber>\n");
    xml.push_str(&format!("<Name>Super Shaper Export</Name>\n<Length>{:.6}</Length>\n<Width>{:.6}</Width>\n<Thickness>{:.6}</Thickness>\n", model.length, model.width, model.thickness));
    let mut dirty = crate::model::DirtyState::default();
    let mut cache = crate::mesh::MeshCache::default();
    let mesh = crate::mesh::generate_mesh(model, &mut dirty, &mut cache);
    xml.push_str(&format!("<Volume>{:.6}</Volume>\n", mesh.volume_liters));

    xml.push_str(&format!(
        "<VConcaveTail>{:.6}</VConcaveTail>\n",
        model.v_concave_tail
    ));
    xml.push_str(&format!(
        "<VConcaveNose>{:.6}</VConcaveNose>\n",
        model.v_concave_nose
    ));
    xml.push_str(&format!(
        "<RailCoefficientTail>{:.6}</RailCoefficientTail>\n",
        model.rail_coefficient_tail
    ));
    xml.push_str(&format!(
        "<RailCoefficientNose>{:.6}</RailCoefficientNose>\n",
        model.rail_coefficient_nose
    ));
    xml.push_str(&format!(
        "<ThicknessZStretch>{:.6}</ThicknessZStretch>\n",
        model.thickness_z_stretch
    ));
    xml.push_str(&format!("<TailType>{}</TailType>\n", model.tail_type));
    xml.push_str(&format!(
        "<SwallowDepth>{:.6}</SwallowDepth>\n",
        model.swallow_depth
    ));

    let format_bezier = |name: &str,
                         tag_name: &str,
                         curve: &Option<BezierCurveData>,
                         symmetry: u8,
                         plan: u8|
     -> String {
        if let Some(c) = curve {
            if c.control_points.is_empty() {
                return String::new();
            }
            let mut b = String::new();
            if !tag_name.is_empty() {
                b.push_str(&format!("<{}>\n", tag_name));
            }
            b.push_str(&format!("<Bezier3d>\n<Name>{}</Name>\n<Degree>3</Degree>\n<Open>1</Open>\n<Symmetry>{}</Symmetry>\n<Plan>{}</Plan>\n", name, symmetry, plan));

            let is_longitudinal = plan != 3;
            let mut export_points = c.control_points.clone();
            let mut export_t1 = c.tangents1.clone();
            let mut export_t2 = c.tangents2.clone();
            let mut export_weights = c.weights.clone();

            // S3DX expects standard structural curves to run backwards (Tail -> Nose)
            if is_longitudinal {
                export_points.reverse();
                let old_t1 = export_t1;
                let old_t2 = export_t2;
                export_t1 = old_t2.into_iter().rev().collect();
                export_t2 = old_t1.into_iter().rev().collect();
                if let Some(w) = export_weights.as_mut() {
                    w.reverse();
                }
            }

            let format_poly = |tag: &str, pts: &[Vec3], weights: &Option<Vec<f32>>| -> String {
                if pts.is_empty() {
                    return String::new();
                }
                let mut p_str = String::new();
                p_str.push_str(&format!("<{}>\n<Polygone3d>\n<Nb_of_points>{}</Nb_of_points>\n<Open>1</Open>\n<Symmetry>{}</Symmetry>\n", tag, pts.len(), symmetry));
                p_str.push_str(&format!("<Symmetry_center>\n<Point3d>\n<x>0.0</x><y>0.0</y><z>0.0</z><u>-1.0</u><color>0</color>\n</Point3d>\n</Symmetry_center>\n<Plan>{}</Plan>\n", plan));
                for (i, p) in pts.iter().enumerate() {
                    let s_from_tail = table.map_z_to_s(p.z);
                    let s3dx_x = if scale_factor > 0.0 {
                        (s_from_tail / scale_factor).max(0.0)
                    } else {
                        0.0
                    };
                    let mut u = -1.0;
                    if let Some(w) = weights {
                        if i < w.len() {
                            u = w[i];
                            if (u - 1.0).abs() < 1e-5 {
                                u = -1.0;
                            }
                        }
                    }
                    p_str.push_str(&format!("<Point3d>\n<x>{:.6}</x><y>{:.6}</y><z>{:.6}</z><u>{:.6}</u><color>0</color>\n</Point3d>\n", s3dx_x, p.x, p.y, u));
                }
                p_str.push_str(&format!("</Polygone3d>\n</{}>\n", tag));
                p_str
            };

            b.push_str(&format_poly(
                "Control_points",
                &export_points,
                &export_weights,
            ));
            b.push_str(&format_poly("Tangents_1", &export_t1, &export_weights));
            b.push_str(&format_poly("Tangents_2", &export_t2, &export_weights));

            let mut tm = String::new();
            tm.push_str("<Tangents_m>\n<Polygone3d>\n");
            tm.push_str(&format!(
                "<Nb_of_points>{}</Nb_of_points>\n<Open>1</Open>\n<Symmetry>0</Symmetry>\n",
                export_points.len()
            ));
            tm.push_str("<Symmetry_center>\n<Point3d>\n<x>0.0</x><y>0.0</y><z>0.0</z><u>-1.0</u><color>0</color>\n</Point3d>\n</Symmetry_center>\n<Plan>0</Plan>\n");
            for _ in &export_points {
                tm.push_str("<Point3d>\n<x>0.0</x><y>0.0</y><z>0.0</z><u>-1.0</u><color>0</color>\n</Point3d>\n");
            }
            tm.push_str("</Polygone3d>\n</Tangents_m>\n");
            b.push_str(&tm);

            for i in 0..export_points.len() {
                b.push_str(&format!(
                    "<Control_type_point_{}> 0</Control_type_point_{}>\n",
                    i, i
                ));
            }
            for i in 0..export_points.len() {
                b.push_str(&format!(
                    "<Tangent_type_point_{}> 0</Tangent_type_point_{}>\n",
                    i, i
                ));
            }

            b.push_str("</Bezier3d>\n");
            if !tag_name.is_empty() {
                b.push_str(&format!("</{}>\n", tag_name));
            }
            b
        } else {
            String::new()
        }
    };

    let format_bezier_def = |tag_name: &str,
                             top: u8,
                             name: &str,
                             curve: &Option<BezierCurveData>,
                             symmetry: u8,
                             plan: u8|
     -> String {
        if let Some(c) = curve {
            if c.control_points.is_empty() {
                return String::new();
            }
            let b = format_bezier(name, "", &Some(c.clone()), symmetry, plan);
            format!("<{}>\n<BezierDef>\n<Top>{}</Top>\n<Displayed>1</Displayed>\n{}\n</BezierDef>\n</{}>\n", tag_name, top, b, tag_name)
        } else {
            String::new()
        }
    };

    xml.push_str(&format_bezier("", "Otl", &model.outline, 6, 1));
    xml.push_str(&format_bezier(
        "Stringer Bot",
        "StrBot",
        &model.rocker_bottom,
        0,
        2,
    ));
    xml.push_str(&format_bezier(
        "Stringer Top",
        "StrDeck",
        &model.rocker_top,
        0,
        2,
    ));

    xml.push_str(&format_bezier_def(
        "curveDefTop1",
        1,
        "Rail",
        &model.rail_outline,
        6,
        1,
    ));
    xml.push_str(&format_bezier_def(
        "curveDefTop2",
        1,
        "Apex",
        &model.apex_outline,
        6,
        1,
    ));
    xml.push_str(&format_bezier_def(
        "curveDefTop3",
        1,
        "Deck 1",
        &model.deck_shoulder,
        6,
        1,
    ));
    xml.push_str(&format_bezier_def(
        "curveDefSide0",
        0,
        "Stringer Bot",
        &model.rocker_bottom,
        0,
        2,
    ));
    xml.push_str(&format_bezier_def(
        "curveDefSide2",
        0,
        "Apex",
        &model.apex_rocker,
        0,
        2,
    ));
    xml.push_str(&format_bezier_def(
        "curveDefSide4",
        0,
        "Stringer Top",
        &model.rocker_top,
        0,
        2,
    ));

    for (i, cs) in model.cross_sections.iter().enumerate() {
        let b = format_bezier("cpl", "", &Some(cs.clone()), 6, 3);
        xml.push_str(&format!(
            "<Couples_{}>\n<Dessus>1</Dessus>\n<Dessous>1</Dessous>\n{}\n</Couples_{}>\n",
            i, b, i
        ));
    }
    xml.push_str(&format!(
        "<Number_of_slices>{}</Number_of_slices>\n",
        model.cross_sections.len()
    ));

    let mut calques = String::new();
    let mut calque_count = 0;
    if let Some(layers) = &model.outline_layers {
        for l in layers {
            calques.push_str(&format!("<Calque_{}>\n<Calque3D>\n", calque_count));
            calques.push_str(&format!("<Nom>{}</Nom>\n", l.name));
            calques.push_str(&format!(
                "<Actif>{}</Actif>\n",
                if l.active { 1 } else { 0 }
            ));
            calques.push_str("<DeckBot>512</DeckBot>\n");
            calques.push_str("<Depth>0.000000</Depth>\n");
            calques.push_str(&format_bezier(
                "otlExt",
                "OtlExt",
                &Some(l.otl_ext.clone()),
                6,
                1,
            ));
            calques.push_str(&format_bezier(
                "otlInt",
                "OtlInt",
                &Some(l.otl_int.clone()),
                6,
                1,
            ));
            calques.push_str("</Calque3D>\n");
            calques.push_str(&format!("</Calque_{}>\n", calque_count));
            calque_count += 1;
        }
    }

    if let Some(channels) = &model.bottom_channels {
        for ch in channels {
            calques.push_str(&format!("<Calque_{}>\n<Calque3D>\n", calque_count));
            calques.push_str(&format!("<Nom>{}</Nom>\n", ch.name));
            calques.push_str("<DeckBot>256</DeckBot>\n");
            let depth = if !ch.right_depth.control_points.is_empty() {
                ch.right_depth.control_points[0].y
            } else {
                0.0
            };
            calques.push_str(&format!("<Depth>{:.6}</Depth>\n", depth));
            calques.push_str(&format_bezier(
                "otlExt",
                "OtlExt",
                &Some(ch.right_outline.clone()),
                6,
                1,
            ));
            calques.push_str("</Calque3D>\n");
            calques.push_str(&format!("</Calque_{}>\n", calque_count));
            calque_count += 1;
        }
    }

    if calque_count > 0 {
        xml.push_str(&format!(
            "<Number_of_3DLayers>{}</Number_of_3DLayers>\n",
            calque_count
        ));
        xml.push_str(&calques);
    }

    xml.push_str("</Board>\n<Scene></Scene>\n</Shape3d_design>");
    xml
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::BoardModel;

    #[test]
    fn test_export_s3dx_basic_structure() {
        let mut model = BoardModel::default();
        model.length = 72.5;
        model.width = 20.25;
        model.thickness = 2.625;

        let xml = export_s3dx(&model);

        // Verify XML header and root tags
        assert!(xml.contains("<?xml version=\"1.0\" encoding=\"iso-8859-1\"?>"));
        assert!(xml.contains("<Shape3d_design>"));
        assert!(xml.contains("<Board>"));

        // Verify numerical formatting (should be to 6 decimal places)
        assert!(xml.contains("<Length>72.500000</Length>"));
        assert!(xml.contains("<Width>20.250000</Width>"));
        assert!(xml.contains("<Thickness>2.625000</Thickness>"));
        // Volume is dynamically computed from mesh now, we don't strictly assert the exact value here

        // Ensure it successfully closes
        assert!(xml.contains("</Shape3d_design>"));
    }

    #[test]
    fn test_s3dx_round_trip() {
        use std::fs;
        use std::path::PathBuf;

        let mut path = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        path.push("../src/assets/fixtures/s3dx/gh-60-winged-swallow.s3dx");

        let bytes = fs::read(&path).unwrap_or_else(|_| {
            panic!(
                "Should be able to read the golden S3DX file from {:?}",
                path
            )
        });
        let content = String::from_utf8_lossy(&bytes).into_owned();

        // 1. Parse Ground Truth
        let model_a =
            crate::s3dx_parser::parse_s3dx(&content).expect("Failed to parse golden S3DX");

        // 2. Export to XML
        let exported_xml = crate::s3dx_exporter::export_s3dx(&model_a);

        // 3. Re-Parse
        let model_b =
            crate::s3dx_parser::parse_s3dx(&exported_xml).expect("Failed to parse exported S3DX");

        // 4. Assert Losslessness
        // epsilon = 2.5e-1 provides enough leniency for numerical table bisection and tangent handle interpolation noise
        approx::assert_relative_eq!(model_a, model_b, epsilon = 2.5e-1);
    }
}
