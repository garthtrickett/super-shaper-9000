use crate::model::{BezierCurveData, BoardModel};
use glam::Vec3;

pub fn export_s3dx(model: &BoardModel) -> String {
    let mut xml = String::new();
    xml.push_str("<?xml version=\"1.0\" encoding=\"iso-8859-1\"?>\n<Shape3d_design>\n<Board>\n");
    xml.push_str("<Version>9</Version>\n<VersionNumber>9.1.0.4</VersionNumber>\n");
    xml.push_str(&format!("<Name>Super Shaper Export</Name>\n<Length>{:.3}</Length>\n<Width>{:.3}</Width>\n<Thickness>{:.3}</Thickness>\n", model.length, model.width, model.thickness));
    let mesh = crate::mesh::generate_mesh(model);
    xml.push_str(&format!("<Volume>{:.3}</Volume>\n", mesh.volume_liters));

    xml.push_str(&format!(
        "<VConcaveTail>{:.3}</VConcaveTail>\n",
        model.v_concave_tail
    ));
    xml.push_str(&format!(
        "<VConcaveNose>{:.3}</VConcaveNose>\n",
        model.v_concave_nose
    ));
    xml.push_str(&format!(
        "<RailCoefficientTail>{:.3}</RailCoefficientTail>\n",
        model.rail_coefficient_tail
    ));
    xml.push_str(&format!(
        "<RailCoefficientNose>{:.3}</RailCoefficientNose>\n",
        model.rail_coefficient_nose
    ));
    xml.push_str(&format!(
        "<ThicknessZStretch>{:.3}</ThicknessZStretch>\n",
        model.thickness_z_stretch
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
                let half_len = model.length / 2.0;
                for (i, p) in pts.iter().enumerate() {
                    let s3dx_x = (half_len - p.z).max(0.0);
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

        // Verify numerical formatting (should be to 3 decimal places)
        assert!(xml.contains("<Length>72.500</Length>"));
        assert!(xml.contains("<Width>20.250</Width>"));
        assert!(xml.contains("<Thickness>2.625</Thickness>"));
        // Volume is dynamically computed from mesh now, we don't strictly assert the exact value here

        // Ensure it successfully closes
        assert!(xml.contains("</Shape3d_design>"));
    }

    #[test]
    fn test_s3dx_round_trip() {
        use crate::model::{BezierCurveData, ChannelLayer, OutlineLayer};
        use glam::Vec3;

        let mut model = BoardModel::default();
        model.length = 72.0;
        model.width = 20.0;
        model.thickness = 2.5;
        model.v_concave_tail = 0.5;
        model.v_concave_nose = -0.5;
        model.rail_coefficient_tail = 0.9;
        model.rail_coefficient_nose = 1.1;
        model.thickness_z_stretch = 1.2;

                let curve = BezierCurveData {
            control_points: vec![Vec3::new(10.0, 0.0, -36.0), Vec3::new(10.0, 0.0, 36.0)],
            tangents1: vec![Vec3::new(10.0, 0.0, -36.0), Vec3::new(10.0, 0.0, 0.0)],
            tangents2: vec![Vec3::new(10.0, 0.0, 0.0), Vec3::new(10.0, 0.0, 36.0)],
            weights: Some(vec![1.5, 2.5]),
        };

        let cs_curve = BezierCurveData {
            control_points: vec![Vec3::new(0.0, 1.0, 10.0), Vec3::new(10.0, 1.0, 10.0)],
            tangents1: vec![Vec3::new(0.0, 1.0, 10.0), Vec3::new(5.0, 1.0, 10.0)],
            tangents2: vec![Vec3::new(5.0, 1.0, 10.0), Vec3::new(10.0, 1.0, 10.0)],
            weights: None,
        };

        model.outline = Some(curve.clone());
        model.rocker_top = Some(curve.clone());
        model.rocker_bottom = Some(curve.clone());
        model.rail_outline = Some(curve.clone());
        model.apex_outline = Some(curve.clone());
        model.apex_rocker = Some(curve.clone());
        model.deck_shoulder = Some(curve.clone());

        model.cross_sections = vec![cs_curve.clone(), cs_curve.clone()];

        model.outline_layers = Some(vec![OutlineLayer {
            name: "Wing1".to_string(),
            otl_ext: curve.clone(),
            otl_int: curve.clone(),
        }]);

        let depth_curve = BezierCurveData {
            control_points: vec![Vec3::new(0.0, 1.5, -36.0), Vec3::new(0.0, 1.5, 36.0)],
            tangents1: vec![Vec3::new(0.0, 1.5, -36.0), Vec3::new(0.0, 1.5, 0.0)],
            tangents2: vec![Vec3::new(0.0, 1.5, 0.0), Vec3::new(0.0, 1.5, 36.0)],
            weights: None,
        };

        let mut left_outline = curve.clone();
        for p in &mut left_outline.control_points {
            p.x = -p.x;
        }
        for p in &mut left_outline.tangents1 {
            p.x = -p.x;
        }
        for p in &mut left_outline.tangents2 {
            p.x = -p.x;
        }

        model.bottom_channels = Some(vec![ChannelLayer {
            name: "Channel1".to_string(),
            is_symmetric: true,
            left_outline: left_outline.clone(),
            right_outline: curve.clone(),
            left_depth: depth_curve.clone(),
            right_depth: depth_curve.clone(),
        }]);

        let xml = super::export_s3dx(&model);
        let parsed_model =
            crate::s3dx_parser::parse_s3dx(&xml).expect("Failed to parse back the generated XML");

        approx::assert_relative_eq!(model, parsed_model, epsilon = 1e-3);
    }
}
