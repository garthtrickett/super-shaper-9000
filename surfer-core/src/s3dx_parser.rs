#[cfg(test)]
mod tests {
    use std::fs;
    use std::path::PathBuf;

    #[test]
    fn can_read_golden_s3dx_file() {
        let mut path = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        path.push("../src/assets/fixtures/s3dx/rounded-pin-6-1.s3dx");

        let content = fs::read_to_string(&path)
            .unwrap_or_else(|_| panic!("Should be able to read the golden S3DX file from {:?}", path));

        assert!(!content.is_empty(), "The S3DX file should not be empty");
        assert!(content.contains("<Shape3d_design>"), "The file should contain the Shape3d_design root tag");
    }
}
