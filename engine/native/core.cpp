// The engine's native core (SPEC-screens.md): grab the main screen and encode it on the graphics card.
//
// Written from Microsoft's Desktop Duplication documentation and NVIDIA's own encoder header (vendor/nvEncodeAPI.h,
// MIT-style notice). No code from Sunshine, Moonlight or any GPL project is copied here.
//
// The picture never leaves the graphics card: Windows hands over a texture, it is copied card-side into the
// encoder's own texture, and NVIDIA's encoder reads that texture directly.

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

int32_t fail(DbeBenchResult* r, const char* what, long code) {
  snprintf(r->error, sizeof r->error, "%s (0x%08lx)", what, (unsigned long)code);
  r->ok = 0;
  return 1;
}

struct Encoder {
  HMODULE dll = nullptr;
  NV_ENCODE_API_FUNCTION_LIST fn = {};
  void* session = nullptr;
  NV_ENC_REGISTERED_PTR registered = nullptr;
  NV_ENC_OUTPUT_PTR bitstream = nullptr;

  ~Encoder() {
    if (session) {
      if (registered) fn.nvEncUnregisterResource(session, registered);
      if (bitstream) fn.nvEncDestroyBitstreamBuffer(session, bitstream);
      fn.nvEncDestroyEncoder(session);
    }
    if (dll) FreeLibrary(dll);
  }

  int32_t nvfail(DbeBenchResult* r, const char* what, NVENCSTATUS status) {
    const char* detail = session ? fn.nvEncGetLastErrorString(session) : "";
    snprintf(r->error, sizeof r->error, "%s (NVENC status %d) %s", what, (int)status, detail ? detail : "");
    r->ok = 0;
    return 1;
  }
};

}  // namespace

int32_t dbe_bench_encode(const DbeBenchOptions* o, DbeBenchResult* r) {
  r->ok = 0;
  r->error[0] = 0;
  r->encoded = 0;
  r->fresh = 0;

  LARGE_INTEGER frequency;
  QueryPerformanceFrequency(&frequency);
  g_ticks_per_ms = (double)frequency.QuadPart / 1000.0;

  // 1. The main screen (the one whose corner is 0,0) and the graphics card it hangs off.
  ComPtr<IDXGIFactory1> factory;
  HRESULT hr = CreateDXGIFactory1(IID_PPV_ARGS(&factory));
  if (FAILED(hr)) return fail(r, "Could not reach Windows' graphics layer", hr);

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
  if (!found) return fail(r, "No main screen found", 0);

  ComPtr<ID3D11Device> device;
  ComPtr<ID3D11DeviceContext> context;
  const D3D_FEATURE_LEVEL levels[] = {D3D_FEATURE_LEVEL_11_0};
  hr = D3D11CreateDevice(adapter.Get(), D3D_DRIVER_TYPE_UNKNOWN, nullptr, 0, levels, 1, D3D11_SDK_VERSION, &device,
                         nullptr, &context);
  if (FAILED(hr)) return fail(r, "Could not open the graphics card", hr);

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
  if (o->tweaks & 2) timeBeginPeriod(1);

  ComPtr<IDXGIOutput1> output1;
  hr = output.As(&output1);
  if (FAILED(hr)) return fail(r, "This Windows has no Desktop Duplication", hr);
  ComPtr<IDXGIOutputDuplication> duplication;
  hr = output1->DuplicateOutput(device.Get(), &duplication);
  if (FAILED(hr)) return fail(r, "Windows refused to share the screen (another program may hold it)", hr);

  DXGI_OUTDUPL_DESC shared;
  duplication->GetDesc(&shared);
  r->screen_width = (int32_t)shared.ModeDesc.Width;
  r->screen_height = (int32_t)shared.ModeDesc.Height;
  r->screen_hz = shared.ModeDesc.RefreshRate.Denominator
                     ? (int32_t)(shared.ModeDesc.RefreshRate.Numerator / shared.ModeDesc.RefreshRate.Denominator)
                     : 0;
  if (shared.ModeDesc.Format != DXGI_FORMAT_B8G8R8A8_UNORM)
    return fail(r, "The screen is not in the ordinary 8-bit format (HDR on?): not handled yet", shared.ModeDesc.Format);

  int32_t width = o->encode_width > 0 ? std::min(o->encode_width, r->screen_width) : r->screen_width;
  int32_t height = o->encode_height > 0 ? std::min(o->encode_height, r->screen_height) : r->screen_height;
  width &= ~1;
  height &= ~1;
  r->encode_width = width;
  r->encode_height = height;
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
  ComPtr<ID3D11Texture2D> picture;
  hr = device->CreateTexture2D(&wanted, nullptr, &picture);
  if (FAILED(hr)) return fail(r, "Could not make the encoder's texture", hr);

  // 3. NVIDIA's encoder. It lives in the graphics driver; nothing of NVIDIA's is shipped with the engine.
  Encoder e;
  e.dll = LoadLibraryA("nvEncodeAPI64.dll");
  if (!e.dll) return fail(r, "No NVIDIA encoder on this PC (nvEncodeAPI64.dll not found)", GetLastError());
  typedef NVENCSTATUS(NVENCAPI * MaxVersion)(uint32_t*);
  typedef NVENCSTATUS(NVENCAPI * CreateInstance)(NV_ENCODE_API_FUNCTION_LIST*);
  MaxVersion max_version = (MaxVersion)GetProcAddress(e.dll, "NvEncodeAPIGetMaxSupportedVersion");
  CreateInstance create_instance = (CreateInstance)GetProcAddress(e.dll, "NvEncodeAPICreateInstance");
  if (!max_version || !create_instance) return fail(r, "The NVIDIA encoder library is missing its entry points", 0);

  uint32_t driver = 0;
  max_version(&driver);
  r->driver_api = driver;
  r->header_api = (NVENCAPI_MAJOR_VERSION << 4) | NVENCAPI_MINOR_VERSION;
  if (driver < r->header_api) return fail(r, "The graphics driver's encoder is older than the engine expects", driver);

  e.fn.version = NV_ENCODE_API_FUNCTION_LIST_VER;
  NVENCSTATUS status = create_instance(&e.fn);
  if (status != NV_ENC_SUCCESS) return e.nvfail(r, "Could not start the NVIDIA encoder", status);

  NV_ENC_OPEN_ENCODE_SESSION_EX_PARAMS open = {};
  open.version = NV_ENC_OPEN_ENCODE_SESSION_EX_PARAMS_VER;
  open.device = device.Get();
  open.deviceType = NV_ENC_DEVICE_TYPE_DIRECTX;
  open.apiVersion = NVENCAPI_VERSION;
  status = e.fn.nvEncOpenEncodeSessionEx(&open, &e.session);
  if (status != NV_ENC_SUCCESS) return e.nvfail(r, "The NVIDIA encoder would not open a session", status);

  const GUID codec = o->hevc ? NV_ENC_CODEC_HEVC_GUID : NV_ENC_CODEC_H264_GUID;
  const GUID presets[] = {NV_ENC_PRESET_P1_GUID, NV_ENC_PRESET_P2_GUID, NV_ENC_PRESET_P3_GUID, NV_ENC_PRESET_P4_GUID,
                          NV_ENC_PRESET_P5_GUID, NV_ENC_PRESET_P6_GUID, NV_ENC_PRESET_P7_GUID};
  const GUID preset = presets[std::min(7, std::max(1, o->preset)) - 1];

  // The fastest tuning NVIDIA offers, then the low-delay recipe on top: no frame waits for a later one, no
  // looking ahead, full pictures only when asked for, every frame given one frame's worth of data.
  static NV_ENC_PRESET_CONFIG preset_config;
  memset(&preset_config, 0, sizeof preset_config);
  preset_config.version = NV_ENC_PRESET_CONFIG_VER;
  preset_config.presetCfg.version = NV_ENC_CONFIG_VER;
  status = e.fn.nvEncGetEncodePresetConfigEx(e.session, codec, preset, NV_ENC_TUNING_INFO_ULTRA_LOW_LATENCY,
                                             &preset_config);
  if (status != NV_ENC_SUCCESS) return e.nvfail(r, "The NVIDIA encoder has no such preset", status);

  static NV_ENC_CONFIG config;
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
  HANDLE done = nullptr;
  if (o->tweaks & 4) {
    done = CreateEventA(nullptr, FALSE, FALSE, nullptr);
    init.enableEncodeAsync = 1;
  }
  status = e.fn.nvEncInitializeEncoder(e.session, &init);
  if (status != NV_ENC_SUCCESS) return e.nvfail(r, "The NVIDIA encoder refused these settings", status);

  NV_ENC_CREATE_BITSTREAM_BUFFER out = {};
  out.version = NV_ENC_CREATE_BITSTREAM_BUFFER_VER;
  status = e.fn.nvEncCreateBitstreamBuffer(e.session, &out);
  if (status != NV_ENC_SUCCESS) return e.nvfail(r, "No output buffer from the NVIDIA encoder", status);
  e.bitstream = out.bitstreamBuffer;
  if (done) {
    NV_ENC_EVENT_PARAMS event = {};
    event.version = NV_ENC_EVENT_PARAMS_VER;
    event.completionEvent = done;
    status = e.fn.nvEncRegisterAsyncEvent(e.session, &event);
    if (status != NV_ENC_SUCCESS) return e.nvfail(r, "The NVIDIA encoder has no event mode here", status);
  }

  NV_ENC_REGISTER_RESOURCE reg = {};
  reg.version = NV_ENC_REGISTER_RESOURCE_VER;
  reg.resourceType = NV_ENC_INPUT_RESOURCE_TYPE_DIRECTX;
  reg.resourceToRegister = picture.Get();
  reg.width = (uint32_t)width;
  reg.height = (uint32_t)height;
  reg.bufferFormat = NV_ENC_BUFFER_FORMAT_ARGB;
  reg.bufferUsage = NV_ENC_INPUT_IMAGE;
  status = e.fn.nvEncRegisterResource(e.session, &reg);
  if (status != NV_ENC_SUCCESS) return e.nvfail(r, "The NVIDIA encoder would not take the texture", status);
  e.registered = reg.registeredResource;

  FILE* dump = nullptr;
  if (o->dump_path && o->dump_path[0]) dump = fopen(o->dump_path, "wb");

  // 4. The loop: wait for the screen to change (or one frame's time), copy, encode, time each step.
  D3D11_BOX middle;
  middle.left = (UINT)((r->screen_width - width) / 2);
  middle.top = (UINT)((r->screen_height - height) / 2);
  middle.right = middle.left + (UINT)width;
  middle.bottom = middle.top + (UINT)height;
  middle.front = 0;
  middle.back = 1;
  const UINT wait_ms = (UINT)std::max(1, 1000 / fps);

  for (int32_t i = 0; i < o->frames; ++i) {
    DXGI_OUTDUPL_FRAME_INFO info = {};
    ComPtr<IDXGIResource> resource;
    hr = duplication->AcquireNextFrame(i == 0 ? 500 : wait_ms, &info, &resource);
    const LONGLONG acquired = now();
    bool fresh = false;
    if (hr == DXGI_ERROR_WAIT_TIMEOUT) {
      // Nothing on screen changed: the last picture is encoded again.
    } else if (FAILED(hr)) {
      if (dump) fclose(dump);
      return fail(r, "Windows stopped sharing the screen part-way", hr);
    } else {
      if (info.LastPresentTime.QuadPart != 0) {
        ComPtr<ID3D11Texture2D> frame;
        if (SUCCEEDED(resource.As(&frame))) {
          context->CopySubresourceRegion(picture.Get(), 0, 0, 0, 0, frame.Get(), 0, &middle);
          fresh = true;
        }
      }
      resource.Reset();
      duplication->ReleaseFrame();
    }
    const LONGLONG copied = now();

    NV_ENC_MAP_INPUT_RESOURCE map = {};
    map.version = NV_ENC_MAP_INPUT_RESOURCE_VER;
    map.registeredResource = e.registered;
    status = e.fn.nvEncMapInputResource(e.session, &map);
    if (status != NV_ENC_SUCCESS) {
      if (dump) fclose(dump);
      return e.nvfail(r, "The NVIDIA encoder could not read the texture", status);
    }

    NV_ENC_PIC_PARAMS pic = {};
    pic.version = NV_ENC_PIC_PARAMS_VER;
    pic.inputBuffer = map.mappedResource;
    pic.bufferFmt = map.mappedBufferFmt;
    pic.inputWidth = (uint32_t)width;
    pic.inputHeight = (uint32_t)height;
    pic.outputBitstream = e.bitstream;
    pic.pictureStruct = NV_ENC_PIC_STRUCT_FRAME;
    pic.inputTimeStamp = (uint64_t)i;
    if (i == 0) pic.encodePicFlags = NV_ENC_PIC_FLAG_FORCEIDR | NV_ENC_PIC_FLAG_OUTPUT_SPSPPS;
    pic.completionEvent = done;
    status = e.fn.nvEncEncodePicture(e.session, &pic);
    if (status != NV_ENC_SUCCESS) {
      e.fn.nvEncUnmapInputResource(e.session, map.mappedResource);
      if (dump) fclose(dump);
      return e.nvfail(r, "The NVIDIA encoder failed on a frame", status);
    }

    if (done) WaitForSingleObject(done, 200);
    NV_ENC_LOCK_BITSTREAM lock = {};
    lock.version = NV_ENC_LOCK_BITSTREAM_VER;
    lock.outputBitstream = e.bitstream;
    status = e.fn.nvEncLockBitstream(e.session, &lock);
    const LONGLONG encoded = now();
    if (status != NV_ENC_SUCCESS) {
      e.fn.nvEncUnmapInputResource(e.session, map.mappedResource);
      if (dump) fclose(dump);
      return e.nvfail(r, "The NVIDIA encoder gave no finished frame", status);
    }
    if (dump) fwrite(lock.bitstreamBufferPtr, 1, lock.bitstreamSizeInBytes, dump);
    const int32_t size = (int32_t)lock.bitstreamSizeInBytes;
    e.fn.nvEncUnlockBitstream(e.session, e.bitstream);
    e.fn.nvEncUnmapInputResource(e.session, map.mappedResource);

    r->copy_ms[i] = ms_between(acquired, copied);
    r->encode_ms[i] = ms_between(copied, encoded);
    r->present_to_encoded_ms[i] = fresh ? ms_between(info.LastPresentTime.QuadPart, encoded) : -1.0;
    r->bytes[i] = size;
    r->encoded = i + 1;
    if (fresh) r->fresh += 1;
  }

  if (dump) fclose(dump);
  if (done) {
    NV_ENC_EVENT_PARAMS event = {};
    event.version = NV_ENC_EVENT_PARAMS_VER;
    event.completionEvent = done;
    e.fn.nvEncUnregisterAsyncEvent(e.session, &event);
    CloseHandle(done);
  }
  if (o->tweaks & 2) timeEndPeriod(1);
  r->ok = 1;
  return 0;
}
