fn main() {
    ensure_frontend_dist();
    tauri_build::build();
}

/// `tauri::generate_context!()` fails the compile if `frontendDist` is missing.
/// Workspace `cargo test`/`clippy` and the release validate job do not build the
/// Vite app first, so create a placeholder when `../dist` is absent.
fn ensure_frontend_dist() {
    let dist = std::path::Path::new("../dist");
    println!("cargo:rerun-if-changed=../dist/index.html");
    if dist.join("index.html").exists() {
        return;
    }
    std::fs::create_dir_all(dist).expect("create Tauri frontendDist");
    std::fs::write(
        dist.join("index.html"),
        "<!doctype html><title>ApiVoy</title>",
    )
    .expect("write placeholder frontendDist");
}
