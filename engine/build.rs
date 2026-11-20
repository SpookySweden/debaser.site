// The part that talks to Windows' graphics and to NVIDIA's encoder is C++ (native/core.cpp), because NVIDIA's own
// header describes its structures in C and using it as it came is safer than re-typing them by hand.
// The part that puts a viewer's mouse and keys into Windows (native/control.cpp) is C++ for the same reason:
// Windows' own structures, used as Microsoft describes them.
fn main() {
    println!("cargo:rerun-if-changed=native/core.cpp");
    println!("cargo:rerun-if-changed=native/core.h");
    println!("cargo:rerun-if-changed=native/control.cpp");
    println!("cargo:rerun-if-changed=native/control.h");
    println!("cargo:rerun-if-changed=vendor/nvEncodeAPI.h");
    cc::Build::new()
        .cpp(true)
        .file("native/core.cpp")
        .file("native/control.cpp")
        .flag_if_supported("/std:c++17")
        .flag_if_supported("/EHsc")
        .warnings(false)
        .compile("debaser_core");
    for lib in ["d3d11", "dxgi", "user32", "gdi32", "kernel32", "winmm"] {
        println!("cargo:rustc-link-lib={lib}");
    }
}
