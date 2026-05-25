use crate::geometry::{get_board_bounds, ZRingContext};
use crate::model::{BoardModel, ImportedFinBox};

/// Dynamically synthesizes a virtual list of fin boxes from the board's parametric parameters.
pub fn synthesize_parametric_fins(model: &BoardModel) -> Vec<ImportedFinBox> {
    let mut fins = Vec::new();
    let bounds = get_board_bounds(model);

    // Front/Side fins: twin, thruster, and quad setups all feature front side fins.
    let has_front_fins =
        model.fin_setup == "twin" || model.fin_setup == "thruster" || model.fin_setup == "quad";
    if has_front_fins {
        let z_pos = bounds.tip_z - model.front_fin_z;
        let ctx = ZRingContext::new(model, z_pos);
        let x_pos = (ctx.profile.half_width - model.front_fin_x).max(0.0);
        let u = if ctx.profile.half_width > 1e-4 {
            (x_pos / ctx.profile.half_width).clamp(0.0, 1.0)
        } else {
            0.0
        };
        let pt = ctx.get_point_at_uv(u, 1.0);
        let y_pos = pt.y;

        fins.push(ImportedFinBox {
            name: "Fin_sides".to_string(),
            style: 3,
            length: 4.5,
            width: 0.75,
            height: 0.5,
            x: x_pos,
            y: y_pos,
            z: z_pos,
            angle_oz: model.toe_angle,
            even: true,
            central: false,
            tilt: None,
            cant: Some(model.cant_angle),
            pt_convergence: None,
        });
    }

    // Rear/Center/Quad fins:
    if model.fin_setup == "thruster" {
        // Center fin at rear_fin_z positioned along the stringer (X = 0.0)
        let z_pos = bounds.tip_z - model.rear_fin_z;
        let ctx = ZRingContext::new(model, z_pos);
        let x_pos = 0.0;
        let u = 0.0;
        let pt = ctx.get_point_at_uv(u, 1.0);
        let y_pos = pt.y;

        fins.push(ImportedFinBox {
            name: "Fin_center".to_string(),
            style: 5,
            length: 10.0,
            width: 1.0,
            height: 1.0,
            x: x_pos,
            y: y_pos,
            z: z_pos,
            angle_oz: 0.0, // Center fins have no toe-in angle
            even: false,
            central: true,
            tilt: None,
            cant: Some(0.0), // Center fins have no cant angle
            pt_convergence: None,
        });
    } else if model.fin_setup == "quad" {
        // Rear side fins at rear_fin_z offset off the rail
        let z_pos = bounds.tip_z - model.rear_fin_z;
        let ctx = ZRingContext::new(model, z_pos);
        let x_pos = (ctx.profile.half_width - model.rear_fin_x).max(0.0);
        let u = if ctx.profile.half_width > 1e-4 {
            (x_pos / ctx.profile.half_width).clamp(0.0, 1.0)
        } else {
            0.0
        };
        let pt = ctx.get_point_at_uv(u, 1.0);
        let y_pos = pt.y;

                    fins.push(ImportedFinBox {
                        name: "Fin_rears".to_string(),
                        style: 3,
                        length: 4.0, // Quad rear fins are conventionally smaller than the front templates
                        width: 0.75,
                        height: 0.5,
                        x: x_pos,
                        y: y_pos,
                        z: z_pos,
                        angle_oz: model.toe_angle,
                        even: true,
                        central: false,
                        tilt: None,
                        cant: Some(model.cant_angle),
                        pt_convergence: None,
                    });
                }

                fins
            }

/// Translates absolute fin box coordinates into parametric fields on BoardModel.
pub fn translate_absolute_to_parametric_fins(model: &mut BoardModel, boxes: &[ImportedFinBox]) {
    if boxes.is_empty() {
        return;
    }

    let bounds = get_board_bounds(model);

    // 1. Identify side fins vs center/central fins
    let side_fins: Vec<&ImportedFinBox> = boxes
        .iter()
        .filter(|b| !b.central && b.x.abs() > 1e-3)
        .collect();

    let center_fins: Vec<&ImportedFinBox> = boxes
        .iter()
        .filter(|b| b.central || b.x.abs() <= 1e-3)
        .collect();

    // 2. Cluster side fins into rows along Z (using 1.5 inch threshold)
    let mut unique_rows: Vec<Vec<&ImportedFinBox>> = Vec::new();
    for fb in side_fins {
        let mut found = false;
        for row in &mut unique_rows {
            if (row[0].z - fb.z).abs() < 1.5 {
                row.push(fb);
                found = true;
                break;
            }
        }
        if !found {
            unique_rows.push(vec![fb]);
        }
    }

    // Sort unique rows by distance from tail (closest to tail first)
    unique_rows.sort_by(|a, b| {
        let dist_a = bounds.tip_z - a[0].z;
        let dist_b = bounds.tip_z - b[0].z;
        dist_a.partial_cmp(&dist_b).unwrap_or(std::cmp::Ordering::Equal)
    });

    // 3. Determine the fin setup
    let setup = if unique_rows.len() >= 2 {
        "quad"
    } else if unique_rows.len() == 1 {
        if !center_fins.is_empty() {
            "thruster"
        } else {
            "twin"
        }
    } else {
        if !center_fins.is_empty() {
            "thruster"
        } else {
            "twin"
        }
    };

    model.fin_setup = setup.to_string();

    // 4. Calculate front side fins parameters
    // In a quad setup, the front fins are the second row (further from the tail).
    // In twin or thruster, they are the first (and only) row.
    let front_row_opt = if setup == "quad" {
        unique_rows.get(1)
    } else {
        unique_rows.first()
    };

    if let Some(front_row) = front_row_opt {
        let front_z_avg = front_row.iter().map(|f| f.z).sum::<f32>() / front_row.len() as f32;
        let front_x_avg = front_row.iter().map(|f| f.x.abs()).sum::<f32>() / front_row.len() as f32;
        let front_toe_avg = front_row.iter().map(|f| f.angle_oz.abs()).sum::<f32>() / front_row.len() as f32;
        let front_cant_avg = front_row.iter().map(|f| f.cant.unwrap_or(0.0).abs()).sum::<f32>() / front_row.len() as f32;

        model.front_fin_z = (bounds.tip_z - front_z_avg).max(0.0);
        
        // Calculate distance off rail
        let hint_t = ((front_z_avg - bounds.nose_z) / model.length).clamp(0.0, 1.0);
        let outline_pt = crate::geometry::evaluate_composite_outline_at_z(model, front_z_avg, hint_t);
        let half_width = outline_pt.x.abs();
        model.front_fin_x = (half_width - front_x_avg).max(0.0);

        model.toe_angle = front_toe_avg;
        model.cant_angle = front_cant_avg;
    }

    // 5. Calculate rear / center fin parameters
    if setup == "quad" {
        if let Some(rear_row) = unique_rows.first() {
            let rear_z_avg = rear_row.iter().map(|f| f.z).sum::<f32>() / rear_row.len() as f32;
            let rear_x_avg = rear_row.iter().map(|f| f.x.abs()).sum::<f32>() / rear_row.len() as f32;

            model.rear_fin_z = (bounds.tip_z - rear_z_avg).max(0.0);

            let hint_t = ((rear_z_avg - bounds.nose_z) / model.length).clamp(0.0, 1.0);
            let outline_pt = crate::geometry::evaluate_composite_outline_at_z(model, rear_z_avg, hint_t);
            let half_width = outline_pt.x.abs();
            model.rear_fin_x = (half_width - rear_x_avg).max(0.0);
        }
    } else if setup == "thruster" {
        if let Some(center_fin) = center_fins.first() {
            model.rear_fin_z = (bounds.tip_z - center_fin.z).max(0.0);
            model.rear_fin_x = 0.0;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::BezierCurveData;
    use glam::Vec3;

    fn create_test_model() -> BoardModel {
        let mut model = BoardModel::default();
        model.length = 72.0;
        model.width = 20.0;
        model.thickness = 2.5;
        model.outline = Some(BezierCurveData {
            control_points: vec![
                Vec3::new(0.0, 0.0, -36.0),
                Vec3::new(10.0, 0.0, 0.0),
                Vec3::new(0.0, 0.0, 36.0),
            ],
            ..Default::default()
        });
        model.rocker_bottom = Some(BezierCurveData {
            control_points: vec![
                Vec3::new(0.0, -1.25, -36.0),
                Vec3::new(0.0, -1.25, 36.0),
            ],
            ..Default::default()
        });
        model
    }

    #[test]
    fn test_translate_twin_setup() {
        let mut model = create_test_model();
        
        let boxes = vec![
            ImportedFinBox {
                name: "Twin_R".to_string(),
                style: 3,
                length: 4.5,
                width: 0.75,
                height: 0.5,
                x: 8.0,
                y: -1.25,
                z: 25.0,
                angle_oz: 3.5,
                even: true,
                central: false,
                tilt: None,
                cant: Some(5.0),
                pt_convergence: None,
            },
            ImportedFinBox {
                name: "Twin_L".to_string(),
                style: 3,
                length: 4.5,
                width: 0.75,
                height: 0.5,
                x: -8.0,
                y: -1.25,
                z: 25.0,
                angle_oz: -3.5,
                even: true,
                central: false,
                tilt: None,
                cant: Some(-5.0),
                pt_convergence: None,
            }
        ];

        translate_absolute_to_parametric_fins(&mut model, &boxes);

        assert_eq!(model.fin_setup, "twin");
        approx::assert_relative_eq!(model.front_fin_z, 11.0, epsilon = 0.01);
        approx::assert_relative_eq!(model.front_fin_x, 8.943 - 8.0, epsilon = 0.1);
        approx::assert_relative_eq!(model.toe_angle, 3.5, epsilon = 0.01);
        approx::assert_relative_eq!(model.cant_angle, 5.0, epsilon = 0.01);
    }

    #[test]
    fn test_translate_thruster_setup() {
        let mut model = create_test_model();
        
        let boxes = vec![
            ImportedFinBox {
                name: "Side_R".to_string(),
                style: 3,
                length: 4.5,
                width: 0.75,
                height: 0.5,
                x: 8.0,
                y: -1.25,
                z: 25.0,
                angle_oz: 3.0,
                even: true,
                central: false,
                tilt: None,
                cant: Some(6.0),
                pt_convergence: None,
            },
            ImportedFinBox {
                name: "Center".to_string(),
                style: 5,
                length: 10.0,
                width: 1.0,
                height: 1.0,
                x: 0.0,
                y: -1.25,
                z: 32.5,
                angle_oz: 0.0,
                even: false,
                central: true,
                tilt: None,
                cant: Some(0.0),
                pt_convergence: None,
            }
        ];

        translate_absolute_to_parametric_fins(&mut model, &boxes);

        assert_eq!(model.fin_setup, "thruster");
        approx::assert_relative_eq!(model.front_fin_z, 11.0, epsilon = 0.01);
        approx::assert_relative_eq!(model.rear_fin_z, 3.5, epsilon = 0.01);
        approx::assert_relative_eq!(model.rear_fin_x, 0.0, epsilon = 0.01);
    }

    #[test]
    fn test_translate_quad_setup() {
        let mut model = create_test_model();
        
        let boxes = vec![
            ImportedFinBox {
                name: "Front_R".to_string(),
                style: 3,
                length: 4.5,
                width: 0.75,
                height: 0.5,
                x: 8.0,
                y: -1.25,
                z: 25.0,
                angle_oz: 3.0,
                even: true,
                central: false,
                tilt: None,
                cant: Some(6.0),
                pt_convergence: None,
            },
            ImportedFinBox {
                name: "Rear_R".to_string(),
                style: 3,
                length: 4.0,
                width: 0.75,
                height: 0.5,
                x: 7.5,
                y: -1.25,
                z: 30.5,
                angle_oz: 3.0,
                even: true,
                central: false,
                tilt: None,
                cant: Some(6.0),
                pt_convergence: None,
            }
        ];

        translate_absolute_to_parametric_fins(&mut model, &boxes);

        assert_eq!(model.fin_setup, "quad");
        approx::assert_relative_eq!(model.front_fin_z, 11.0, epsilon = 0.01);
        approx::assert_relative_eq!(model.rear_fin_z, 5.5, epsilon = 0.01);
    }
}
