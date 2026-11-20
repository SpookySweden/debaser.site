// The engine's native core (SPEC-screens.md): grab the main screen and encode it on the graphics card.
//
// Written from Microsoft's Desktop Duplication documentation and NVIDIA's own encoder header (vendor/nvEncodeAPI.h,
// MIT-style notice). No code from Sunshine, Moonlight or any GPL project is copied here.
//
// The picture never leaves the graphics card: Windows hands over a texture, it is copied card-side into the
// encoder's own texture, and NVIDIA's encoder reads that texture directly.
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

#include <algorithm>
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
const double kChaseWaitMs = 1.5;

}  // namespace

struct DbeSession {
  // The card and the screen. Declared before the encoder's handles and released after them (see the destructor).
  ComPtr<ID3D11Device> device;
  ComPtr<ID3D11DeviceContext> context;
  ComPtr<IDXGIOutput1> output1;
  ComPtr<IDXGIOutputDuplication> duplication;
  ComPtr<ID3D11Texture2D> picture;

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
  double refresh_ms = 16.7;      // one refresh of the shared screen
  LONGLONG prev_present = 0;     // when Windows showed the last frame taken
  double source_ms = 0;          // how often the screen is really changing, 0 = not known (still, or just started)
  NV_ENC_PRESET_CONFIG preset_config;
  NV_ENC_CONFIG config;

  int32_t screen_width = 0, screen_height = 0;
  int32_t width = 0, height = 0;
  D3D11_BOX middle = {};
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
  bool next(int32_t wait_ms, bool force_keyframe, DbeFrame* frame);
};

bool DbeSession::open(const DbeOptions* o, DbeInfo* info) {
  LARGE_INTEGER frequency;
  QueryPerformanceFrequency(&frequency);
  g_ticks_per_ms = (double)frequency.QuadPart / 1000.0;
  info->ticks_per_second = frequency.QuadPart;
  skip_pointer_only = o->skip_pointer_only != 0;
  chase_fresh = (o->tweaks & 16) != 0;

  // 1. The main screen (the one whose corner is 0,0) and the graphics card it hangs off.
  ComPtr<IDXGIFactory1> factory;
  HRESULT hr = CreateDXGIFactory1(IID_PPV_ARGS(&factory));
  if (FAILED(hr)) return fail("Could not reach Windows' graphics layer", hr);

  ComPtr<IDXGIAdapter1> adapter;
  ComPtr<IDXGIOutput> output;
  bool found = false;
  for (UINT a = 0; !found; ++a) {
    ComPtr<IDXGIAdapter1> candidate;
    if (factory->EnumAdapters1(a, &candidate) == DXGI_ERROR_NOT_FOUND) break;
    for (UINT i = 0; !found; ++i) {
      ComPtr<IDXGIOutput> screen;
      if (candidate->EnumOutputs(i, &screen) == DXGI_ERROR_NOT_FOUND) break;
      DXGI_OUTPUT_DESC desc;
      screen->GetDesc(&desc);
      if (desc.AttachedToDesktop && desc.DesktopCoordinates.left == 0 && desc.DesktopCoordinates.top == 0) {
        adapter = candidate;
        output = screen;
        found = true;
      }
    }
  }
  if (!found) return fail("No main screen found", 0);

  const D3D_FEATURE_LEVEL levels[] = {D3D_FEATURE_LEVEL_11_0};
  hr = D3D11CreateDevice(adapter.Get(), D3D_DRIVER_TYPE_UNKNOWN, nullptr, 0, levels, 1, D3D11_SDK_VERSION, &device,
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

  width = o->encode_width > 0 ? std::min(o->encode_width, screen_width) : screen_width;
  height = o->encode_height > 0 ? std::min(o->encode_height, screen_height) : screen_height;
  width &= ~1;
  height &= ~1;
  info->encode_width = width;
  info->encode_height = height;
  const int32_t fps = std::max(1, o->fps);

  // 2. The encoder's own texture: frames are copied into it card-side, and the encoder reads it in place.
  D3D11_TEXTURE2D_DESC wanted = {};
  wanted.Width = (UINT)width;
  wanted.Height = (UINT)height;
  wanted.MipLevels = 1;
  wanted.ArraySize = 1;
  wanted.Format = DXGI_FORMAT_B8G8R8A8_UNORM;
  wanted.SampleDesc.Count = 1;
  wanted.Usage = D3D11_USAGE_DEFAULT;
  wanted.BindFlags = D3D11_BIND_RENDER_TARGET;
  hr = device->CreateTexture2D(&wanted, nullptr, &picture);
  if (FAILED(hr)) return fail("Could not make the encoder's texture", hr);

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
  reg.resourceToRegister = picture.Get();
  reg.width = (uint32_t)width;
  reg.height = (uint32_t)height;
  reg.bufferFormat = NV_ENC_BUFFER_FORMAT_ARGB;
  reg.bufferUsage = NV_ENC_INPUT_IMAGE;
  status = fn.nvEncRegisterResource(session, &reg);
  if (status != NV_ENC_SUCCESS) return nvfail("The NVIDIA encoder would not take the texture", status);
  registered = reg.registeredResource;

  // The piece of the screen that is encoded: its middle.
  middle.left = (UINT)((screen_width - width) / 2);
  middle.top = (UINT)((screen_height - height) / 2);
  middle.right = middle.left + (UINT)width;
  middle.bottom = middle.top + (UINT)height;
  middle.front = 0;
  middle.back = 1;
  return true;
}

// One frame: wait for the screen to change (or `wait_ms`), copy, encode, time each step.
bool DbeSession::next(int32_t wait_ms, bool force_keyframe, DbeFrame* frame) {
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
      if (info.LastPresentTime.QuadPart != 0) {
        ComPtr<ID3D11Texture2D> texture;
        if (SUCCEEDED(resource.As(&texture))) {
          context->CopySubresourceRegion(picture.Get(), 0, 0, 0, 0, texture.Get(), 0, &middle);
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

int32_t dbe_next_frame(DbeSession* session, int32_t wait_ms, int32_t force_keyframe, DbeFrame* frame) {
  memset(frame, 0, sizeof *frame);
  return session->next(wait_ms, force_keyframe != 0, frame) ? 0 : 1;
}

const char* dbe_last_error(DbeSession* session) { return session->error; }

int64_t dbe_now(void) { return now(); }

void dbe_close(DbeSession* session) { delete session; }
