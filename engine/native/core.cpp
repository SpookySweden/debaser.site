// The engine's native core (SPEC-screens.md): grab the main screen and encode it on the graphics card.
//
// Written from Microsoft's Desktop Duplication documentation and NVIDIA's own encoder header (vendor/nvEncodeAPI.h,
// MIT-style notice). No code from Sunshine, Moonlight or any GPL project is copied here.
//
// The picture never leaves the graphics card: Windows hands over a texture, the wanted piece of it is copied
// card-side into the engine's own texture, and NVIDIA's encoder reads that texture directly. When a smaller
// picture is asked for than the piece taken, the card's video unit shrinks it on the way (see "scale step").
//
// A session (core.h) is opened once and then asked for one encoded frame at a time, so the same code serves the
// bench (`bench-encode`) and the live stream (`serve`).

#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <windows.h>
#include <d3d11.h>
#include <dxgi1_2.h>
#include <wrl/client.h>
#include <mmsystem.h>
#include <tlhelp32.h>

#include <algorithm>
#include <vector>
#include <cstdio>
#include <cstring>

#include "../vendor/nvEncodeAPI.h"
#include "core.h"

using Microsoft::WRL::ComPtr;

namespace {

double g_ticks_per_ms = 1;

LONGLONG now() {
  LARGE_INTEGER t;
  QueryPerformanceCounter(&t);
  return t.QuadPart;
}

double ms_between(LONGLONG from, LONGLONG to) { return (double)(to - from) / g_ticks_per_ms; }

// How long Windows may refuse to share the screen (a game switching to full screen, a permission prompt) before
// the session gives up. Until then the last picture is sent again and sharing is asked for anew on every frame.
const double kLostScreenPatienceMs = 5000.0;
// A frame Windows showed longer ago than this was already waiting when it was picked up (tweak 16).
const double kStaleFrameMs = 0.75;
// ...and the longest it is worth waiting for the screen's next frame instead of taking the one in hand.
const double kChaseWaitMs = 4.0;

// The main screen (the one whose corner is 0,0) and the graphics card it hangs off.
bool find_main_screen(ComPtr<IDXGIAdapter1>& adapter, ComPtr<IDXGIOutput>& output, DXGI_OUTPUT_DESC& desc) {
  ComPtr<IDXGIFactory1> factory;
  if (FAILED(CreateDXGIFactory1(IID_PPV_ARGS(&factory)))) return false;
  for (UINT a = 0;; ++a) {
    ComPtr<IDXGIAdapter1> candidate;
    if (factory->EnumAdapters1(a, &candidate) == DXGI_ERROR_NOT_FOUND) return false;
    for (UINT i = 0;; ++i) {
      ComPtr<IDXGIOutput> screen;
      if (candidate->EnumOutputs(i, &screen) == DXGI_ERROR_NOT_FOUND) break;
      screen->GetDesc(&desc);
      if (desc.AttachedToDesktop && desc.DesktopCoordinates.left == 0 && desc.DesktopCoordinates.top == 0) {
        adapter = candidate;
        output = screen;
        return true;
      }
    }
  }
}

}  // namespace

struct DbeSession {
  // The card and the screen. Declared before the encoder's handles and released after them (see the destructor).
  ComPtr<ID3D11Device> device;
  ComPtr<ID3D11DeviceContext> context;
  ComPtr<IDXGIOutput1> output1;
  ComPtr<IDXGIOutputDuplication> duplication;
  ComPtr<ID3D11Texture2D> picture;  // the piece of the screen, as Windows drew it (BGRA)

  // The scale step, only made when the picture sent is smaller than the piece taken: the card's video unit
  // shrinks `picture` into `shrunk_picture`, in the encoder's own colour layout (NV12), and the encoder reads that.
  ComPtr<ID3D11VideoDevice> video_device;
  ComPtr<ID3D11VideoContext> video_context;
  ComPtr<ID3D11VideoProcessorEnumerator> scaler_kind;
  ComPtr<ID3D11VideoProcessor> scaler;
  ComPtr<ID3D11VideoProcessorInputView> scaler_in;
  ComPtr<ID3D11VideoProcessorOutputView> scaler_out;
  ComPtr<ID3D11Texture2D> shrunk_picture;
  bool shrunk_filled = false;     // `shrunk_picture` holds a picture (before the first one it is empty)

  // NVIDIA's encoder.
  HMODULE dll = nullptr;
  NV_ENCODE_API_FUNCTION_LIST fn = {};
  void* session = nullptr;
  NV_ENC_REGISTERED_PTR registered = nullptr;
  NV_ENC_OUTPUT_PTR bitstream = nullptr;
  HANDLE done = nullptr;         // tweak 4: the encoder's "frame finished" signal
  bool event_registered = false;
  bool holding = false;          // the last frame's bytes are still lent to the caller
  bool fine_timer = false;       // tweak 2 is on and has to be handed back
  bool skip_pointer_only = false;  // see DbeOptions
  bool chase_fresh = false;      // tweak 16: see next()
  bool region_only = false;      // tweak 32: see next()
  bool pretend_still = false;    // the still-screen check's switch: see DbeOptions
  std::vector<BYTE> changed;     // Windows' list of what changed in a frame
  double refresh_ms = 16.7;      // one refresh of the shared screen
  LONGLONG prev_present = 0;     // when Windows showed the last frame taken
  double source_ms = 0;          // how often the screen is really changing, 0 = not known (still, or just started)
  NV_ENC_PRESET_CONFIG preset_config;
  NV_ENC_CONFIG config;

  int32_t screen_width = 0, screen_height = 0;
  int32_t width = 0, height = 0;                // the picture that is sent
  int32_t region_width = 0, region_height = 0;  // the piece of the screen it is made from
  D3D11_BOX piece = {};                         // that piece, as the card's copy wants it described
  uint64_t count = 0;            // frames encoded so far
  LONGLONG lost_since = 0;       // when Windows stopped sharing the screen; 0 while it shares
  char error[512] = {0};

  ~DbeSession() {
    if (session) {
      if (holding) fn.nvEncUnlockBitstream(session, bitstream);
      if (event_registered) {
        NV_ENC_EVENT_PARAMS event = {};
        event.version = NV_ENC_EVENT_PARAMS_VER;
        event.completionEvent = done;
        fn.nvEncUnregisterAsyncEvent(session, &event);
      }
      if (registered) fn.nvEncUnregisterResource(session, registered);
      if (bitstream) fn.nvEncDestroyBitstreamBuffer(session, bitstream);
      fn.nvEncDestroyEncoder(session);
    }
    if (done) CloseHandle(done);
    if (dll) FreeLibrary(dll);
    if (fine_timer) timeEndPeriod(1);
  }

  bool fail(const char* what, long code) {
    snprintf(error, sizeof error, "%s (0x%08lx)", what, (unsigned long)code);
    return false;
  }

  bool nvfail(const char* what, NVENCSTATUS status) {
    const char* detail = session ? fn.nvEncGetLastErrorString(session) : "";
    snprintf(error, sizeof error, "%s (NVENC status %d) %s", what, (int)status, detail ? detail : "");
    return false;
  }

  bool open(const DbeOptions* o, DbeInfo* info);
  bool make_scaler(int32_t fps);
  bool next(int32_t wait_ms, bool force_keyframe, DbeFrame* frame, bool only_if_changed = false);
  bool touches_piece(const DXGI_OUTDUPL_FRAME_INFO& info);
};

// The scale step's parts: the video unit told the two sizes, the two textures it works between, and the colours.
bool DbeSession::make_scaler(int32_t fps) {
  HRESULT hr = device.As(&video_device);
  if (SUCCEEDED(hr)) hr = context.As(&video_context);
  if (FAILED(hr)) return fail("This graphics card has no video unit to shrink the picture with", hr);

  D3D11_VIDEO_PROCESSOR_CONTENT_DESC content = {};
  content.InputFrameFormat = D3D11_VIDEO_FRAME_FORMAT_PROGRESSIVE;
  content.InputFrameRate.Numerator = (UINT)fps;
  content.InputFrameRate.Denominator = 1;
  content.InputWidth = (UINT)region_width;
  content.InputHeight = (UINT)region_height;
  content.OutputFrameRate.Numerator = (UINT)fps;
  content.OutputFrameRate.Denominator = 1;
  content.OutputWidth = (UINT)width;
  content.OutputHeight = (UINT)height;
  content.Usage = D3D11_VIDEO_USAGE_OPTIMAL_SPEED;
  hr = video_device->CreateVideoProcessorEnumerator(&content, &scaler_kind);
  if (SUCCEEDED(hr)) hr = video_device->CreateVideoProcessor(scaler_kind.Get(), 0, &scaler);
  if (FAILED(hr)) return fail("The card's video unit would not shrink the picture to this size", hr);

  D3D11_TEXTURE2D_DESC wanted = {};
  wanted.Width = (UINT)width;
  wanted.Height = (UINT)height;
  wanted.MipLevels = 1;
  wanted.ArraySize = 1;
  wanted.Format = DXGI_FORMAT_NV12;
  wanted.SampleDesc.Count = 1;
  wanted.Usage = D3D11_USAGE_DEFAULT;
  wanted.BindFlags = D3D11_BIND_RENDER_TARGET;
  hr = device->CreateTexture2D(&wanted, nullptr, &shrunk_picture);
  if (FAILED(hr)) return fail("Could not make the shrunk picture's texture", hr);

  D3D11_VIDEO_PROCESSOR_INPUT_VIEW_DESC in = {};
  in.ViewDimension = D3D11_VPIV_DIMENSION_TEXTURE2D;
  hr = video_device->CreateVideoProcessorInputView(picture.Get(), scaler_kind.Get(), &in, &scaler_in);
  if (FAILED(hr)) return fail("The card's video unit would not read the screen's picture", hr);
  D3D11_VIDEO_PROCESSOR_OUTPUT_VIEW_DESC out = {};
  out.ViewDimension = D3D11_VPOV_DIMENSION_TEXTURE2D;
  hr = video_device->CreateVideoProcessorOutputView(shrunk_picture.Get(), scaler_kind.Get(), &out, &scaler_out);
  if (FAILED(hr)) return fail("The card's video unit would not write the shrunk picture", hr);

  // The whole piece in, the whole picture out, and none of the driver's own "improvements" on the way.
  const RECT from = {0, 0, region_width, region_height};
  const RECT to = {0, 0, width, height};
  video_context->VideoProcessorSetStreamFrameFormat(scaler.Get(), 0, D3D11_VIDEO_FRAME_FORMAT_PROGRESSIVE);
  video_context->VideoProcessorSetStreamSourceRect(scaler.Get(), 0, TRUE, &from);
  video_context->VideoProcessorSetStreamDestRect(scaler.Get(), 0, TRUE, &to);
  video_context->VideoProcessorSetOutputTargetRect(scaler.Get(), TRUE, &to);
  video_context->VideoProcessorSetStreamAutoProcessingMode(scaler.Get(), 0, FALSE);
  // Colours: the screen is full-range RGB; video is BT.709 with the usual narrowed range (16 to 235).
  D3D11_VIDEO_PROCESSOR_COLOR_SPACE screen_colours = {};
  screen_colours.RGB_Range = 0;       // 0 to 255
  screen_colours.YCbCr_Matrix = 1;    // BT.709
  screen_colours.Nominal_Range = D3D11_VIDEO_PROCESSOR_NOMINAL_RANGE_0_255;
  D3D11_VIDEO_PROCESSOR_COLOR_SPACE video_colours = {};
  video_colours.YCbCr_Matrix = 1;     // BT.709
  video_colours.Nominal_Range = D3D11_VIDEO_PROCESSOR_NOMINAL_RANGE_16_235;
  video_context->VideoProcessorSetStreamColorSpace(scaler.Get(), 0, &screen_colours);
  video_context->VideoProcessorSetOutputColorSpace(scaler.Get(), &video_colours);
  return true;
}

bool DbeSession::open(const DbeOptions* o, DbeInfo* info) {
  LARGE_INTEGER frequency;
  QueryPerformanceFrequency(&frequency);
  g_ticks_per_ms = (double)frequency.QuadPart / 1000.0;
  info->ticks_per_second = frequency.QuadPart;
  skip_pointer_only = o->skip_pointer_only != 0;
  chase_fresh = (o->tweaks & 16) != 0;
  region_only = (o->tweaks & 32) != 0;
  pretend_still = o->pretend_still != 0;

  // 1. The main screen (the one whose corner is 0,0) and the graphics card it hangs off.
  ComPtr<IDXGIAdapter1> adapter;
  ComPtr<IDXGIOutput> output;
  DXGI_OUTPUT_DESC described;
  if (!find_main_screen(adapter, output, described)) return fail("No main screen found", 0);

  const D3D_FEATURE_LEVEL levels[] = {D3D_FEATURE_LEVEL_11_0};
  HRESULT hr = D3D11CreateDevice(adapter.Get(), D3D_DRIVER_TYPE_UNKNOWN, nullptr, 0, levels, 1, D3D11_SDK_VERSION, &device,
                         nullptr, &context);
  if (FAILED(hr)) return fail("Could not open the graphics card", hr);

  // Tweak 1: ask Windows to schedule this program's graphics work ahead of others (a game, the browser), so a
  // frame to encode does not sit in a queue behind them.
  if (o->tweaks & 1) {
    ComPtr<IDXGIDevice1> scheduling;
    if (SUCCEEDED(device.As(&scheduling))) {
      scheduling->SetGPUThreadPriority(7);
      scheduling->SetMaximumFrameLatency(1);
    }
    typedef LONG(WINAPI * SetClass)(HANDLE, int);
    HMODULE gdi = GetModuleHandleA("gdi32.dll");
    if (!gdi) gdi = LoadLibraryA("gdi32.dll");
    SetClass set_class = gdi ? (SetClass)GetProcAddress(gdi, "D3DKMTSetProcessSchedulingPriorityClass") : nullptr;
    if (set_class) set_class(GetCurrentProcess(), 4 /* HIGH; REALTIME needs administrator rights */);
    SetThreadPriority(GetCurrentThread(), THREAD_PRIORITY_HIGHEST);
  }
  // Tweak 2: Windows' waits are 15.6 ms coarse unless a program asks for 1 ms.
  if (o->tweaks & 2) {
    timeBeginPeriod(1);
    fine_timer = true;
  }

  hr = output.As(&output1);
  if (FAILED(hr)) return fail("This Windows has no Desktop Duplication", hr);
  hr = output1->DuplicateOutput(device.Get(), &duplication);
  if (FAILED(hr)) return fail("Windows refused to share the screen (another program may hold it)", hr);

  DXGI_OUTDUPL_DESC shared;
  duplication->GetDesc(&shared);
  screen_width = (int32_t)shared.ModeDesc.Width;
  screen_height = (int32_t)shared.ModeDesc.Height;
  info->screen_width = screen_width;
  info->screen_height = screen_height;
  info->screen_hz = shared.ModeDesc.RefreshRate.Denominator
                        ? (int32_t)(shared.ModeDesc.RefreshRate.Numerator / shared.ModeDesc.RefreshRate.Denominator)
                        : 0;
  if (info->screen_hz > 0) refresh_ms = 1000.0 / info->screen_hz;
  if (shared.ModeDesc.Format != DXGI_FORMAT_B8G8R8A8_UNORM)
    return fail("The screen is not in the ordinary 8-bit format (HDR on?): not handled yet", shared.ModeDesc.Format);

  // The piece of the screen to take (kept inside the screen, even numbers), and the picture to make from it
  // (never larger than the piece, even numbers).
  int32_t region_x = o->region_x, region_y = o->region_y;
  region_width = o->region_width;
  region_height = o->region_height;
  if (region_width <= 0 || region_height <= 0) {
    region_x = 0;
    region_y = 0;
    region_width = screen_width;
    region_height = screen_height;
  }
  region_x = std::max(0, std::min(region_x, screen_width - 2));
  region_y = std::max(0, std::min(region_y, screen_height - 2));
  region_width = std::min(region_width, screen_width - region_x) & ~1;
  region_height = std::min(region_height, screen_height - region_y) & ~1;
  if (region_width < 2 || region_height < 2) return fail("The piece of the screen asked for is empty", 0);
  width = (o->encode_width > 0 ? std::min(o->encode_width, region_width) : region_width) & ~1;
  height = (o->encode_height > 0 ? std::min(o->encode_height, region_height) : region_height) & ~1;
  if (width < 2 || height < 2) return fail("The picture asked for is empty", 0);
  const bool scaled = width != region_width || height != region_height;
  info->encode_width = width;
  info->encode_height = height;
  info->region_x = region_x;
  info->region_y = region_y;
  info->region_width = region_width;
  info->region_height = region_height;
  info->scaled = scaled ? 1 : 0;
  const int32_t fps = std::max(1, o->fps);

  // 2. The engine's own texture: the piece of each frame is copied into it card-side. Unscaled, the encoder
  // reads it in place; scaled, the video unit reads it and the encoder reads what that makes (`shrunk_picture`).
  D3D11_TEXTURE2D_DESC wanted = {};
  wanted.Width = (UINT)region_width;
  wanted.Height = (UINT)region_height;
  wanted.MipLevels = 1;
  wanted.ArraySize = 1;
  wanted.Format = DXGI_FORMAT_B8G8R8A8_UNORM;
  wanted.SampleDesc.Count = 1;
  wanted.Usage = D3D11_USAGE_DEFAULT;
  wanted.BindFlags = D3D11_BIND_RENDER_TARGET;
  hr = device->CreateTexture2D(&wanted, nullptr, &picture);
  if (FAILED(hr)) return fail("Could not make the encoder's texture", hr);
  if (scaled && !make_scaler(fps)) return false;

  // 3. NVIDIA's encoder. It lives in the graphics driver; nothing of NVIDIA's is shipped with the engine.
  dll = LoadLibraryA("nvEncodeAPI64.dll");
  if (!dll) return fail("No NVIDIA encoder on this PC (nvEncodeAPI64.dll not found)", GetLastError());
  typedef NVENCSTATUS(NVENCAPI * MaxVersion)(uint32_t*);
  typedef NVENCSTATUS(NVENCAPI * CreateInstance)(NV_ENCODE_API_FUNCTION_LIST*);
  MaxVersion max_version = (MaxVersion)GetProcAddress(dll, "NvEncodeAPIGetMaxSupportedVersion");
  CreateInstance create_instance = (CreateInstance)GetProcAddress(dll, "NvEncodeAPICreateInstance");
  if (!max_version || !create_instance) return fail("The NVIDIA encoder library is missing its entry points", 0);

  uint32_t driver = 0;
  max_version(&driver);
  info->driver_api = driver;
  info->header_api = (NVENCAPI_MAJOR_VERSION << 4) | NVENCAPI_MINOR_VERSION;
  if (driver < info->header_api) return fail("The graphics driver's encoder is older than the engine expects", driver);

  fn.version = NV_ENCODE_API_FUNCTION_LIST_VER;
  NVENCSTATUS status = create_instance(&fn);
  if (status != NV_ENC_SUCCESS) return nvfail("Could not start the NVIDIA encoder", status);

  NV_ENC_OPEN_ENCODE_SESSION_EX_PARAMS open = {};
  open.version = NV_ENC_OPEN_ENCODE_SESSION_EX_PARAMS_VER;
  open.device = device.Get();
  open.deviceType = NV_ENC_DEVICE_TYPE_DIRECTX;
  open.apiVersion = NVENCAPI_VERSION;
  status = fn.nvEncOpenEncodeSessionEx(&open, &session);
  if (status != NV_ENC_SUCCESS) return nvfail("The NVIDIA encoder would not open a session", status);

  const GUID codec = o->hevc ? NV_ENC_CODEC_HEVC_GUID : NV_ENC_CODEC_H264_GUID;
  const GUID presets[] = {NV_ENC_PRESET_P1_GUID, NV_ENC_PRESET_P2_GUID, NV_ENC_PRESET_P3_GUID, NV_ENC_PRESET_P4_GUID,
                          NV_ENC_PRESET_P5_GUID, NV_ENC_PRESET_P6_GUID, NV_ENC_PRESET_P7_GUID};
  const GUID preset = presets[std::min(7, std::max(1, o->preset)) - 1];

  // The fastest tuning NVIDIA offers, then the low-delay recipe on top: no frame waits for a later one, no
  // looking ahead, full pictures only when asked for, every frame given one frame's worth of data.
  memset(&preset_config, 0, sizeof preset_config);
  preset_config.version = NV_ENC_PRESET_CONFIG_VER;
  preset_config.presetCfg.version = NV_ENC_CONFIG_VER;
  status = fn.nvEncGetEncodePresetConfigEx(session, codec, preset, NV_ENC_TUNING_INFO_ULTRA_LOW_LATENCY,
                                           &preset_config);
  if (status != NV_ENC_SUCCESS) return nvfail("The NVIDIA encoder has no such preset", status);

  config = preset_config.presetCfg;
  const uint32_t bits_per_second = (uint32_t)std::max(500, o->bitrate_kbps) * 1000u;
  config.gopLength = NVENC_INFINITE_GOPLENGTH;
  config.frameIntervalP = 1;
  config.rcParams.rateControlMode = NV_ENC_PARAMS_RC_CBR;
  config.rcParams.averageBitRate = bits_per_second;
  config.rcParams.maxBitRate = bits_per_second;
  config.rcParams.vbvBufferSize = bits_per_second / (uint32_t)fps;
  config.rcParams.vbvInitialDelay = bits_per_second / (uint32_t)fps;
  config.rcParams.zeroReorderDelay = 1;
  config.rcParams.enableLookahead = 0;
  config.rcParams.lowDelayKeyFrameScale = 1;
  if (o->tweaks & 8) config.rcParams.multiPass = NV_ENC_MULTI_PASS_DISABLED;
  if (o->hevc) {
    config.encodeCodecConfig.hevcConfig.idrPeriod = NVENC_INFINITE_GOPLENGTH;
    config.encodeCodecConfig.hevcConfig.repeatSPSPPS = 1;
    if (o->intra_refresh) {
      config.encodeCodecConfig.hevcConfig.enableIntraRefresh = 1;
      config.encodeCodecConfig.hevcConfig.intraRefreshPeriod = (uint32_t)fps * 5;
      config.encodeCodecConfig.hevcConfig.intraRefreshCnt = (uint32_t)fps;
    }
  } else {
    config.encodeCodecConfig.h264Config.idrPeriod = NVENC_INFINITE_GOPLENGTH;
    config.encodeCodecConfig.h264Config.repeatSPSPPS = 1;
    if (scaled) {
      // The shrunk picture arrives already in video colours, so the stream says which ones (BT.709, narrowed
      // range) instead of leaving the viewer's decoder to guess.
      NV_ENC_CONFIG_H264_VUI_PARAMETERS& says = config.encodeCodecConfig.h264Config.h264VUIParameters;
      says.videoSignalTypePresentFlag = 1;
      says.videoFormat = NV_ENC_VUI_VIDEO_FORMAT_UNSPECIFIED;
      says.videoFullRangeFlag = 0;
      says.colourDescriptionPresentFlag = 1;
      says.colourPrimaries = NV_ENC_VUI_COLOR_PRIMARIES_BT709;
      says.transferCharacteristics = NV_ENC_VUI_TRANSFER_CHARACTERISTIC_BT709;
      says.colourMatrix = NV_ENC_VUI_MATRIX_COEFFS_BT709;
    }
    if (o->intra_refresh) {
      config.encodeCodecConfig.h264Config.enableIntraRefresh = 1;
      config.encodeCodecConfig.h264Config.intraRefreshPeriod = (uint32_t)fps * 5;
      config.encodeCodecConfig.h264Config.intraRefreshCnt = (uint32_t)fps;
    }
  }

  NV_ENC_INITIALIZE_PARAMS init = {};
  init.version = NV_ENC_INITIALIZE_PARAMS_VER;
  init.encodeGUID = codec;
  init.presetGUID = preset;
  init.tuningInfo = NV_ENC_TUNING_INFO_ULTRA_LOW_LATENCY;
  init.encodeWidth = (uint32_t)width;
  init.encodeHeight = (uint32_t)height;
  init.darWidth = (uint32_t)width;
  init.darHeight = (uint32_t)height;
  init.maxEncodeWidth = (uint32_t)width;
  init.maxEncodeHeight = (uint32_t)height;
  init.frameRateNum = (uint32_t)fps;
  init.frameRateDen = 1;
  init.enablePTD = 1;
  init.encodeConfig = &config;
  // Tweak 4: the encoder signals an event when a frame is done, instead of this thread asking and waiting.
  if (o->tweaks & 4) {
    done = CreateEventA(nullptr, FALSE, FALSE, nullptr);
    init.enableEncodeAsync = 1;
  }
  status = fn.nvEncInitializeEncoder(session, &init);
  if (status != NV_ENC_SUCCESS) return nvfail("The NVIDIA encoder refused these settings", status);

  NV_ENC_CREATE_BITSTREAM_BUFFER out = {};
  out.version = NV_ENC_CREATE_BITSTREAM_BUFFER_VER;
  status = fn.nvEncCreateBitstreamBuffer(session, &out);
  if (status != NV_ENC_SUCCESS) return nvfail("No output buffer from the NVIDIA encoder", status);
  bitstream = out.bitstreamBuffer;
  if (done) {
    NV_ENC_EVENT_PARAMS event = {};
    event.version = NV_ENC_EVENT_PARAMS_VER;
    event.completionEvent = done;
    status = fn.nvEncRegisterAsyncEvent(session, &event);
    if (status != NV_ENC_SUCCESS) return nvfail("The NVIDIA encoder has no event mode here", status);
    event_registered = true;
  }

  NV_ENC_REGISTER_RESOURCE reg = {};
  reg.version = NV_ENC_REGISTER_RESOURCE_VER;
  reg.resourceType = NV_ENC_INPUT_RESOURCE_TYPE_DIRECTX;
  reg.resourceToRegister = scaled ? shrunk_picture.Get() : picture.Get();
  reg.width = (uint32_t)width;
  reg.height = (uint32_t)height;
  reg.bufferFormat = scaled ? NV_ENC_BUFFER_FORMAT_NV12 : NV_ENC_BUFFER_FORMAT_ARGB;
  reg.bufferUsage = NV_ENC_INPUT_IMAGE;
  status = fn.nvEncRegisterResource(session, &reg);
  if (status != NV_ENC_SUCCESS) return nvfail("The NVIDIA encoder would not take the texture", status);
  registered = reg.registeredResource;

  // The piece of the screen that is copied out of every frame.
  piece.left = (UINT)region_x;
  piece.top = (UINT)region_y;
  piece.right = piece.left + (UINT)region_width;
  piece.bottom = piece.top + (UINT)region_height;
  piece.front = 0;
  piece.back = 1;
  return true;
}

// Whether what changed on screen in this frame touches the piece being sent. Asked of Windows while the frame is
// still held. When Windows cannot say, the answer is yes.
bool DbeSession::touches_piece(const DXGI_OUTDUPL_FRAME_INFO& info) {
  if (info.TotalMetadataBufferSize == 0) return true;
  if (changed.size() < info.TotalMetadataBufferSize) changed.resize(info.TotalMetadataBufferSize);
  const LONG left = (LONG)piece.left, top = (LONG)piece.top, right = (LONG)piece.right, bottom = (LONG)piece.bottom;
  UINT bytes = 0;
  HRESULT hr = duplication->GetFrameMoveRects((UINT)changed.size(), (DXGI_OUTDUPL_MOVE_RECT*)changed.data(), &bytes);
  if (FAILED(hr)) return true;
  const DXGI_OUTDUPL_MOVE_RECT* moved = (const DXGI_OUTDUPL_MOVE_RECT*)changed.data();
  for (UINT i = 0; i < bytes / sizeof(DXGI_OUTDUPL_MOVE_RECT); ++i) {
    const RECT& r = moved[i].DestinationRect;
    if (r.left < right && r.right > left && r.top < bottom && r.bottom > top) return true;
  }
  hr = duplication->GetFrameDirtyRects((UINT)changed.size(), (RECT*)changed.data(), &bytes);
  if (FAILED(hr)) return true;
  const RECT* dirty = (const RECT*)changed.data();
  for (UINT i = 0; i < bytes / sizeof(RECT); ++i) {
    const RECT& r = dirty[i];
    if (r.left < right && r.right > left && r.top < bottom && r.bottom > top) return true;
  }
  return false;
}

// One frame: wait for the screen to change (or `wait_ms`), copy, encode, time each step.
bool DbeSession::next(int32_t wait_ms, bool force_keyframe, DbeFrame* frame, bool only_if_changed) {
  // The bytes lent out by the last call go back to the encoder before it is asked for more.
  if (holding) {
    fn.nvEncUnlockBitstream(session, bitstream);
    holding = false;
  }

  DXGI_OUTDUPL_FRAME_INFO info = {};
  bool fresh = false;

  // Windows withdraws the share when the screen changes hands (a game going full screen, a permission prompt).
  // It is asked for again here; until it comes back the last picture is encoded again.
  if (!duplication) {
    HRESULT again = output1->DuplicateOutput(device.Get(), &duplication);
    if (SUCCEEDED(again)) {
      DXGI_OUTDUPL_DESC shared;
      duplication->GetDesc(&shared);
      if ((int32_t)shared.ModeDesc.Width != screen_width || (int32_t)shared.ModeDesc.Height != screen_height ||
          shared.ModeDesc.Format != DXGI_FORMAT_B8G8R8A8_UNORM)
        return fail("The screen changed size or format while it was shared: start again", shared.ModeDesc.Format);
      lost_since = 0;
    } else {
      duplication.Reset();
      if (ms_between(lost_since, now()) > kLostScreenPatienceMs)
        return fail("Windows stopped sharing the screen and did not give it back", again);
      Sleep((DWORD)std::max(1, std::min(wait_ms, 50)));
    }
  }

  LONGLONG acquired = 0;
  if (duplication) {
    UINT wait = (UINT)std::max(0, wait_ms);
    LONGLONG give_up = now() + (LONGLONG)(wait * g_ticks_per_ms);
    DXGI_OUTDUPL_FRAME_INFO best = {};  // the newest real frame taken in this call
    bool chasing = false;
    for (;;) {
      ComPtr<IDXGIResource> resource;
      HRESULT hr = duplication->AcquireNextFrame(wait, &info, &resource);
      acquired = now();
      if (hr == DXGI_ERROR_WAIT_TIMEOUT) break;  // nothing (more) changed: what is in hand is encoded
      if (hr == DXGI_ERROR_ACCESS_LOST) {
        duplication.Reset();
        lost_since = now();
        break;
      }
      if (FAILED(hr)) return fail("Windows stopped sharing the screen part-way", hr);
      bool real = false;
      // Tweak 32: a change somewhere else on the screen is not a change to the picture being sent. Windows says
      // which rectangles changed; when none of them touches the piece in hand, the frame is passed over like a
      // pointer-only one. Nothing identical is encoded, and the engine is not left resting when the piece itself
      // changes a moment later.
      // (The still-screen check's switch passes over every frame after the first picture, changed or not.)
      if (info.LastPresentTime.QuadPart != 0 && !(pretend_still && count > 0) && (!region_only || touches_piece(info))) {
        ComPtr<ID3D11Texture2D> texture;
        if (SUCCEEDED(resource.As(&texture))) {
          context->CopySubresourceRegion(picture.Get(), 0, 0, 0, 0, texture.Get(), 0, &piece);
          real = true;
          fresh = true;
          best = info;
        }
      }
      resource.Reset();
      duplication->ReleaseFrame();
      // How often the screen is really changing, learnt from the frames themselves: the time since the last one
      // taken, shared between however many Windows piled up meanwhile. A long gap means the screen was still.
      if (real && !chasing) {
        if (prev_present != 0 && info.AccumulatedFrames > 0) {
          const double each = ms_between(prev_present, info.LastPresentTime.QuadPart) / info.AccumulatedFrames;
          if (each > 0.5 && each < 100.0) source_ms = source_ms > 0 ? 0.8 * source_ms + 0.2 * each : each;
          else source_ms = 0;
        }
      }
      if (real) prev_present = info.LastPresentTime.QuadPart;
      // Tweak 16, the fresh-frame rule. When this call came to look, a frame was already waiting, so it is some
      // milliseconds old before any work starts. If the screen's own rhythm says its next frame is due within a
      // sliver of time, waiting that sliver means the frame that gets encoded is one Windows has only just shown.
      // If the next one is further off than that, the frame in hand is taken: waiting would slow the stream down
      // for the sake of freshness. Once one frame has been caught fresh, the ones after it fall into step.
      if (real && chase_fresh && !chasing && source_ms > 0) {
        const double age = ms_between(info.LastPresentTime.QuadPart, acquired);
        const double until_next = std::max(0.0, source_ms - age);
        if (age > kStaleFrameMs && until_next <= kChaseWaitMs) {
          chasing = true;
          give_up = acquired + (LONGLONG)((until_next + 1.0) * g_ticks_per_ms);
          wait = (UINT)(until_next + 1.9);
          continue;
        }
      }
      if (real) break;
      // Windows also answers when only the mouse pointer moved, with the same picture as before. The bench has
      // always counted that as a frame. The live stream asks to keep waiting for a real change instead, until
      // the wait is used up, so a moving mouse does not turn into hundreds of identical frames a second.
      if (!chasing && !skip_pointer_only) break;
      const LONGLONG left = give_up - acquired;
      if (left <= 0) break;
      wait = (UINT)((double)left / g_ticks_per_ms);
    }
    if (fresh) info = best;
  }
  if (!acquired) acquired = now();

  // Asked only to look, and nothing new came in time: nothing is encoded, and the caller gets an empty frame.
  if (only_if_changed && !fresh) {
    frame->acquired_time = acquired;
    return true;
  }

  // The scale step: one pass of the card's video unit from the piece taken to the smaller picture. Only when
  // there is a new picture to shrink (a repeat encodes the one already there).
  if (scaler && (fresh || !shrunk_filled)) {
    D3D11_VIDEO_PROCESSOR_STREAM stream = {};
    stream.Enable = TRUE;
    stream.pInputSurface = scaler_in.Get();
    HRESULT blt = video_context->VideoProcessorBlt(scaler.Get(), scaler_out.Get(), 0, 1, &stream);
    if (FAILED(blt)) return fail("The card's video unit failed to shrink a frame", blt);
    shrunk_filled = true;
  }
  const LONGLONG copied = now();

  NV_ENC_MAP_INPUT_RESOURCE map = {};
  map.version = NV_ENC_MAP_INPUT_RESOURCE_VER;
  map.registeredResource = registered;
  NVENCSTATUS status = fn.nvEncMapInputResource(session, &map);
  if (status != NV_ENC_SUCCESS) return nvfail("The NVIDIA encoder could not read the texture", status);

  NV_ENC_PIC_PARAMS pic = {};
  pic.version = NV_ENC_PIC_PARAMS_VER;
  pic.inputBuffer = map.mappedResource;
  pic.bufferFmt = map.mappedBufferFmt;
  pic.inputWidth = (uint32_t)width;
  pic.inputHeight = (uint32_t)height;
  pic.outputBitstream = bitstream;
  pic.pictureStruct = NV_ENC_PIC_STRUCT_FRAME;
  pic.inputTimeStamp = count;
  if (count == 0 || force_keyframe) pic.encodePicFlags = NV_ENC_PIC_FLAG_FORCEIDR | NV_ENC_PIC_FLAG_OUTPUT_SPSPPS;
  pic.completionEvent = done;
  status = fn.nvEncEncodePicture(session, &pic);
  if (status != NV_ENC_SUCCESS) {
    fn.nvEncUnmapInputResource(session, map.mappedResource);
    return nvfail("The NVIDIA encoder failed on a frame", status);
  }

  if (done) WaitForSingleObject(done, 200);
  NV_ENC_LOCK_BITSTREAM lock = {};
  lock.version = NV_ENC_LOCK_BITSTREAM_VER;
  lock.outputBitstream = bitstream;
  status = fn.nvEncLockBitstream(session, &lock);
  const LONGLONG encoded = now();
  if (status != NV_ENC_SUCCESS) {
    fn.nvEncUnmapInputResource(session, map.mappedResource);
    return nvfail("The NVIDIA encoder gave no finished frame", status);
  }
  // The encoded bytes stay lent to the caller until the next call (no copy is made of them here).
  holding = true;
  fn.nvEncUnmapInputResource(session, map.mappedResource);

  frame->data = (const uint8_t*)lock.bitstreamBufferPtr;
  frame->size = (int32_t)lock.bitstreamSizeInBytes;
  frame->keyframe = (lock.pictureType == NV_ENC_PIC_TYPE_IDR || lock.pictureType == NV_ENC_PIC_TYPE_I) ? 1 : 0;
  frame->fresh = fresh ? 1 : 0;
  frame->present_time = fresh ? info.LastPresentTime.QuadPart : 0;
  frame->acquired_time = acquired;
  frame->encoded_time = encoded;
  frame->copy_ms = ms_between(acquired, copied);
  frame->encode_ms = ms_between(copied, encoded);
  count += 1;
  return true;
}

DbeSession* dbe_open(const DbeOptions* options, DbeInfo* info, char* error, int32_t error_len) {
  DbeSession* s = new DbeSession();
  memset(info, 0, sizeof *info);
  if (s->open(options, info)) return s;
  if (error && error_len > 0) snprintf(error, (size_t)error_len, "%s", s->error);
  delete s;
  return nullptr;
}

int32_t dbe_next_frame_if_changed(DbeSession* session, int32_t wait_ms, DbeFrame* frame) {
  memset(frame, 0, sizeof *frame);
  return session->next(wait_ms, false, frame, true) ? 0 : 1;
}

int32_t dbe_next_frame(DbeSession* session, int32_t wait_ms, int32_t force_keyframe, DbeFrame* frame) {
  memset(frame, 0, sizeof *frame);
  return session->next(wait_ms, force_keyframe != 0, frame) ? 0 : 1;
}

const char* dbe_last_error(DbeSession* session) { return session->error; }

int32_t dbe_screen(int32_t* width, int32_t* height, int32_t* hz) {
  ComPtr<IDXGIAdapter1> adapter;
  ComPtr<IDXGIOutput> output;
  DXGI_OUTPUT_DESC desc;
  if (!find_main_screen(adapter, output, desc)) return 1;
  // Windows' current mode for that screen: its real pixels and refresh rate. Read only.
  DEVMODEW mode = {};
  mode.dmSize = sizeof mode;
  if (EnumDisplaySettingsW(desc.DeviceName, ENUM_CURRENT_SETTINGS, &mode)) {
    *width = (int32_t)mode.dmPelsWidth;
    *height = (int32_t)mode.dmPelsHeight;
    *hz = (int32_t)mode.dmDisplayFrequency;
  } else {
    *width = desc.DesktopCoordinates.right - desc.DesktopCoordinates.left;
    *height = desc.DesktopCoordinates.bottom - desc.DesktopCoordinates.top;
    *hz = 0;
  }
  return 0;
}

int32_t dbe_process_running(const wchar_t* name) {
  HANDLE list = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
  if (list == INVALID_HANDLE_VALUE) return -1;
  PROCESSENTRY32W entry = {};
  entry.dwSize = sizeof entry;
  int32_t running = 0;
  if (Process32FirstW(list, &entry)) {
    do {
      if (_wcsicmp(entry.szExeFile, name) == 0) {
        running = 1;
        break;
      }
    } while (Process32NextW(list, &entry));
  }
  CloseHandle(list);
  return running;
}

int64_t dbe_now(void) { return now(); }

void dbe_close(DbeSession* session) { delete session; }
