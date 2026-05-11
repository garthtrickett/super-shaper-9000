use crate::model::{BoardModel, RawGeometryData};

pub fn export_obj(model: &BoardModel, mesh: &RawGeometryData) -> String {
        let mut obj = String::new();
    obj.push_str("# Super Shaper 9000 OBJ Export\n");
    obj.push_str(&format!("# Length: {:.2}, Width: {:.2}\n", model.length, model.width));

    // Vertices
    for i in (0..mesh.vertices.len()).step_by(3) {
        obj.push_str(&format!(
            "v {:.6} {:.6} {:.6}\n",
            mesh.vertices[i],
            mesh.vertices[i + 1],
            mesh.vertices[i + 2]
        ));
    }

    // UVs
    for i in (0..mesh.uvs.len()).step_by(2) {
        obj.push_str(&format!("vt {:.6} {:.6}\n", mesh.uvs[i], mesh.uvs[i + 1]));
    }

    // Normals
    for i in (0..mesh.normals.len()).step_by(3) {
        obj.push_str(&format!(
            "vn {:.6} {:.6} {:.6}\n",
            mesh.normals[i],
            mesh.normals[i + 1],
            mesh.normals[i + 2]
        ));
    }

    // Faces (1-based indexing)
    for i in (0..mesh.indices.len()).step_by(3) {
        let i1 = mesh.indices[i] + 1;
        let i2 = mesh.indices[i + 1] + 1;
        let i3 = mesh.indices[i + 2] + 1;
        obj.push_str(&format!(
            "f {}/{}/{} {}/{}/{} {}/{}/{}\n",
            i1, i1, i1, i2, i2, i2, i3, i3, i3
        ));
    }

    obj
}
