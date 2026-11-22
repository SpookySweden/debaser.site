// The engine's second encoder (SPEC-screens.md, 2026-11-22): Windows' own Media Foundation, which drives whatever
// hardware encoder the graphics card has (Intel Quick Sync on SERVER, AMD's, or NVIDIA's own through Windows).
// Used when there is no NVIDIA encoder (nvEncodeAPI64.dll), or when DEBASER_ENCODER=mf asks for it.
//
// It takes the NV12 picture the card's video unit made (core.cpp's scale step, run even at full size for this
// encoder) and gives back Annex-B H.264, every full picture carrying its headers so a viewer can start from it.
#pragma once
#include <d3d11.h>
#include <stdint.h>
#include <vector>

struct MfEncoder;

// Opens the hardware encoder on the card that `device` belongs to. `kind` comes back 1 for a hardware encoder,
// 2 when Windows only had its software one (much slower, used only so something still works).
MfEncoder* mf_open(ID3D11Device* device, int32_t width, int32_t height, int32_t fps, int32_t bitrate_kbps, int32_t* kind,
                   char* error, int32_t error_len);

// Encodes one NV12 picture. `out` gets the frame's bytes (replaced, not added to); `keyframe` whether it is a full
// picture. Returns false with the reason in `error`.
bool mf_encode(MfEncoder* encoder, ID3D11Texture2D* nv12, bool force_keyframe, std::vector<uint8_t>& out, bool* keyframe,
               char* error, int32_t error_len);

void mf_close(MfEncoder* encoder);
