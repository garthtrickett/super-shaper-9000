use crate::model::{BoardModel, BezierCurveData};
use glam::Vec3;

pub fn export_s3dx(model: &BoardModel) -> String {
    let mut xml = String::new();
    xml.push_str("<?xml version=\"1.0\" encoding=\"iso-8859-1\"?>\n<Shape3d_design>\n<Board>\n");
    xml.push_str("<Version>9</Version>\n<VersionNumber>9.1.0.4</VersionNumber>\n");
    xml.push_str(&format!("<Name>Super Shaper Export</Name>\n<Length>{:.3}</Length>\n<Width>{:.3}</Width>\n<Thickness>{:.3}</Thickness>\n", model.length, model.width, model.thickness));
    xml.push_str(&format!("<Volume>{:.3}</Volume>\n", model.volume));

    let format_bezier = |name: &str, tag_name: &str, curve: &Option<BezierCurveData>, symmetry: u8, plan: u8| -> String {
        if let Some(c) = curve {
            if c.control_points.is_empty() { return String::new(); }
            let mut b = String::new();
            b.push_str(&format!("<{}>\n<Bezier3d>\n<Name>{}</Name>\n<Degree>3</Degree>\n<Open>1</Open>\n<Symmetry>{}</Symmetry>\n<Plan>{}</Plan>\n", tag_name, name, symmetry, plan));
            
            let format_poly = |tag: &str, pts: &[Vec3]| -> String {
                if pts.is_empty() { return String::new(); }
                let mut p_str = String::new();
                p_str.push_str(&format!("<{}>\n<Polygone3d>\n<Nb_of_points>{}</Nb_of_points>\n<Open>1</Open>\n<Symmetry>{}</Symmetry>\n", tag, pts.len(), symmetry));
                p_str.push_str(&format!("<Symmetry_center>\n<Point3d>\n<x>0.0</x><y>0.0</y><z>0.0</z><u>-1.0</u><color>0</color>\n</Point3d>\n</Symmetry_center>\n<Plan>{}</Plan>\n", plan));
                for p in pts {
                    p_str.push_str(&format!("<Point3d>\n<x>{:.6}</x><y>{:.6}</y><z>{:.6}</z><u>-1.000000</u><color>0</color>\n</Point3d>\n", p.z, p.x, p.y));
                }
                p_str.push_str(&format!("</Polygone3d>\n</{}>\n", tag));
                p_str
            };

            b.push_str(&format_poly("Control_points", &c.control_points));
            b.push_str(&format_poly("Tangents_1", &c.tangents1));
            b.push_str(&format_poly("Tangents_2", &c.tangents2));
            
            let mut tm = String::new();
            tm.push_str("<Tangents_m>\n<Polygone3d>\n");
            tm.push_str(&format!("<Nb_of_points>{}</Nb_of_points>\n<Open>1</Open>\n<Symmetry>0</Symmetry>\n", c.control_points.len()));
            tm.push_str("<Symmetry_center>\n<Point3d>\n<x>0.0</x><y>0.0</y><z>0.0</z><u>-1.0</u><color>0</color>\n</Point3d>\n</Symmetry_center>\n<Plan>0</Plan>\n");
            for _ in &c.control_points {
                tm.push_str("<Point3d>\n<x>0.0</x><y>0.0</y><z>0.0</z><u>-1.0</u><color>0</color>\n</Point3d>\n");
            }
            tm.push_str("</Polygone3d>\n</Tangents_m>\n");
            b.push_str(&tm);

            for i in 0..c.control_points.len() {
                b.push_str(&format!("<Control_type_point_{}> 0</Control_type_point_{}>\n", i, i));
            }
            for i in 0..c.control_points.len() {
                b.push_str(&format!("<Tangent_type_point_{}> 0</Tangent_type_point_{}>\n", i, i));
            }
            
            b.push_str(&format!("</Bezier3d>\n</{}>\n", tag_name));
            b
        } else {
            String::new()
        }
    };

    let format_bezier_def = |tag_name: &str, top: u8, name: &str, curve: &Option<BezierCurveData>, symmetry: u8, plan: u8| -> String {
        if let Some(c) = curve {
            if c.control_points.is_empty() { return String::new(); }
            let b = format_bezier(name, "Bezier3d", &Some(c.clone()), symmetry, plan);
            format!("<{}>\n<BezierDef>\n<Top>{}</Top>\n<Displayed>1</Displayed>\n{}\n</BezierDef>\n</{}>\n", tag_name, top, b, tag_name)
        } else { String::new() }
    };

    xml.push_str(&format_bezier("", "Otl", &model.outline, 6, 1));
    xml.push_str(&format_bezier("Stringer Bot", "StrBot", &model.rocker_bottom, 0, 2));
    xml.push_str(&format_bezier("Stringer Top", "StrDeck", &model.rocker_top, 0, 2));
    
    xml.push_str(&format_bezier_def("curveDefTop1", 1, "Rail", &model.rail_outline, 6, 1));
    xml.push_str(&format_bezier_def("curveDefTop2", 1, "Apex", &model.apex_outline, 6, 1));
    xml.push_str(&format_bezier_def("curveDefSide0", 0, "Stringer Bot", &model.rocker_bottom, 0, 2));
    xml.push_str(&format_bezier_def("curveDefSide2", 0, "Apex", &model.apex_rocker, 0, 2));
    xml.push_str(&format_bezier_def("curveDefSide4", 0, "Stringer Top", &model.rocker_top, 0, 2));

    for (i, cs) in model.cross_sections.iter().enumerate() {
        let b = format_bezier("cpl", "Bezier3d", &Some(cs.clone()), 6, 3);
        xml.push_str(&format!("<Couples_{}>\n<Dessus>1</Dessus>\n<Dessous>1</Dessous>\n{}\n</Couples_{}>\n", i, b, i));
    }
    xml.push_str(&format!("<Number_of_slices>{}</Number_of_slices>\n", model.cross_sections.len()));
    
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
        model.volume = 34.5;

        let xml = export_s3dx(&model);

        // Verify XML header and root tags
        assert!(xml.contains("<?xml version=\"1.0\" encoding=\"iso-8859-1\"?>"));
        assert!(xml.contains("<Shape3d_design>"));
        assert!(xml.contains("<Board>"));

        // Verify numerical formatting (should be to 3 decimal places)
        assert!(xml.contains("<Length>72.500</Length>"));
        assert!(xml.contains("<Width>20.250</Width>"));
        assert!(xml.contains("<Thickness>2.625</Thickness>"));
        assert!(xml.contains("<Volume>34.500</Volume>"));
        
        // Ensure it successfully closes
        assert!(xml.contains("</Shape3d_design>"));
    }
}

