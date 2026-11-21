// The part that talks to Windows' graphics and to NVIDIA's encoder is C++ (native/core.cpp), because NVIDIA's own
// header describes its structures in C and using it as it came is safer than re-typing them by hand.
// The part that puts a viewer's mouse and keys into Windows (native/control.cpp) is C++ for the same reason:
// Windows' own structures, used as Microsoft describes them. The part that reads back what the PC is playing
// (native/sound.cpp) is C++ too: Windows' sound interfaces are COM, which C++ speaks directly.
fn main() {
    println!("cargo:rerun-if-changed=native/core.cpp");
    println!("cargo:rerun-if-changed=native/core.h");
    println!("cargo:rerun-if-changed=native/control.cpp");
    println!("cargo:rerun-if-changed=native/control.h");
    println!("cargo:rerun-if-changed=native/lan.cpp");
    println!("cargo:rerun-if-changed=native/sound.cpp");
    println!("cargo:rerun-if-changed=native/sound.h");
    println!("cargo:rerun-if-changed=native/modes.cpp");
    println!("cargo:rerun-if-changed=native/modes.h");
    println!("cargo:rerun-if-changed=vendor/nvEncodeAPI.h");
    cc::Build::new()
        .cpp(true)
        .file("native/core.cpp")
        .file("native/control.cpp")
        .file("native/lan.cpp")
        .file("native/sound.cpp")
        .file("native/modes.cpp")
        .flag_if_supported("/std:c++17")
        .flag_if_supported("/EHsc")
        .warnings(false)
        .compile("debaser_core");
    for lib in ["d3d11", "dxgi", "user32", "gdi32", "kernel32", "winmm", "iphlpapi", "ole32"] {
        println!("cargo:rustc-link-lib={lib}");
    }
}
