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
