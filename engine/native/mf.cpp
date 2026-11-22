// The engine's second encoder: Windows' Media Foundation driving the graphics card's own hardware encoder
// (SPEC-screens.md, 2026-11-22: SERVER has Intel UHD 630 graphics and no NVIDIA encoder; Luke: "get our engine
// working both ways"). See mf.h.
//
// Written from Microsoft's Media Foundation documentation (hardware MFTs, the asynchronous MFT model, ICodecAPI).
// No code from Sunshine, Moonlight, OBS or any GPL project is copied here.
//
// The low-delay recipe, as for NVIDIA's: low-latency mode (no frame waits for a later one), constant bitrate, no
// B-frames, full pictures only when asked for, the picture handed over as a card-side texture (never copied to
// the processor). Hardware encoders are asynchronous in Media Foundation: they say when they want a picture and
// when a finished frame is ready, and this file waits for those two events in turn, one frame at a time.

#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <windows.h>
#include <d3d11.h>
#include <d3d10.h>
#include <dxgi.h>
#include <mfapi.h>
#include <mfidl.h>
#include <mftransform.h>
#include <mferror.h>
#include <strmif.h>
#include <wrl/client.h>
// The ICodecAPI setting names are GUIDs declared in codecapi.h; this file defines them for itself.
#include <initguid.h>
#include <codecapi.h>

#include <algorithm>
#include <cstdio>
#include <cstring>
#include <vector>

#include "mf.h"

using Microsoft::WRL::ComPtr;

struct MfEncoder {
  ComPtr<IMFTransform> mft;
  ComPtr<IMFMediaEventGenerator> events;  // only for an asynchronous (hardware) encoder
  ComPtr<ICodecAPI> codec;
  ComPtr<IMFDXGIDeviceManager> manager;
  bool async = false;
  bool started = false;
  DWORD in_id = 0, out_id = 0;
  LONGLONG frame_100ns = 166667;  // one frame's length in Media Foundation's unit (100 ns)
  LONGLONG time = 0;
  int wanted = 0;                 // pictures the encoder has asked for and not been given yet
  std::vector<uint8_t> headers;   // the stream's latest SPS and PPS, put in front of a full picture that lacks them
  // DEBASER_MF_TRACE=1: where each frame's time goes, said when the session closes (for tuning on SERVER).
  bool trace = false;
  // DEBASER_MF_DRAIN=1: after each picture the encoder is told to drain, so a pipelined encoder (Intel's with
  // low-latency mode off) gives this picture's frame back now instead of on the next call.
  bool drain = false;
  double t_asked = 0, t_given = 0, t_taken = 0;  // waiting to be asked for a picture; picture in -> frame ready; taking it
  int traced = 0, empties = 0;

  ~MfEncoder() {
    if (trace && traced > 0)
      fprintf(stderr, "  media foundation, per frame: waiting to be asked %.2f ms, picture in -> frame ready %.2f ms, taking it %.2f ms (%d frames, %d empty)\n",
              t_asked / traced, t_given / traced, t_taken / traced, traced, empties);
    if (mft && started) {
      mft->ProcessMessage(MFT_MESSAGE_NOTIFY_END_OF_STREAM, 0);
      mft->ProcessMessage(MFT_MESSAGE_NOTIFY_END_STREAMING, 0);
    }
    if (mft) mft->ProcessMessage(MFT_MESSAGE_SET_D3D_MANAGER, 0);
    events.Reset();
    codec.Reset();
    mft.Reset();
    manager.Reset();
    MFShutdown();
  }
};

namespace {

double ms_now() {
  static LARGE_INTEGER f = {};
  if (f.QuadPart == 0) QueryPerformanceFrequency(&f);
  LARGE_INTEGER t;
  QueryPerformanceCounter(&t);
  return (double)t.QuadPart * 1000.0 / (double)f.QuadPart;
}

// A whole number from the environment, or `fallback` when it is not set or not a number.
long env_number(const char* name, long fallback) {
  char text[32] = {0};
  if (GetEnvironmentVariableA(name, text, sizeof text) == 0) return fallback;
  char* end = nullptr;
  const long value = strtol(text, &end, 10);
  return end != text ? value : fallback;
}

bool say(char* error, int32_t error_len, const char* what, HRESULT hr) {
  if (error && error_len > 0) snprintf(error, (size_t)error_len, "%s (0x%08lx)", what, (unsigned long)hr);
  return false;
}

void set_number(ICodecAPI* codec, const GUID& name, ULONG value) {
  VARIANT v;
  VariantInit(&v);
  v.vt = VT_UI4;
  v.ulVal = value;
  codec->SetValue(&name, &v);  // a setting this encoder does not know is left as it is
}

void set_yes(ICodecAPI* codec, const GUID& name, bool yes) {
  VARIANT v;
  VariantInit(&v);
  v.vt = VT_BOOL;
  v.boolVal = yes ? VARIANT_TRUE : VARIANT_FALSE;
  codec->SetValue(&name, &v);
}

// The parts of an Annex-B stream: each part's kind (the low five bits after a start code) and where it is.
struct Part {
  int kind;
  size_t start;  // where its start code begins
  size_t end;    // one past its last byte
};

std::vector<Part> parts_of(const uint8_t* data, size_t size) {
  std::vector<Part> found;
  size_t i = 0;
  while (i + 3 < size) {
    const bool three = data[i] == 0 && data[i + 1] == 0 && data[i + 2] == 1;
    const bool four = i + 4 < size && data[i] == 0 && data[i + 1] == 0 && data[i + 2] == 0 && data[i + 3] == 1;
    if (three || four) {
      const size_t head = i + (four ? 4 : 3);
      if (!found.empty()) found.back().end = i;
      found.push_back({data[head] & 0x1f, i, size});
      i = head + 1;
    } else {
      ++i;
    }
  }
  return found;
}

// Keeps the stream's headers (SPS 7, PPS 8) from a stretch of Annex-B bytes; leaves `headers` alone if it has none.
void keep_headers(std::vector<uint8_t>& headers, const uint8_t* data, size_t size) {
  std::vector<uint8_t> next;
  for (const Part& p : parts_of(data, size))
    if (p.kind == 7 || p.kind == 8) next.insert(next.end(), data + p.start, data + p.end);
  if (!next.empty()) headers.swap(next);
}

// The headers the encoder put on its output type, when it put them there rather than in the stream.
void headers_from_type(MfEncoder* e) {
  ComPtr<IMFMediaType> type;
  if (FAILED(e->mft->GetOutputCurrentType(e->out_id, &type))) return;
  UINT32 size = 0;
  if (FAILED(type->GetBlobSize(MF_MT_MPEG_SEQUENCE_HEADER, &size)) || size == 0) return;
  std::vector<uint8_t> blob(size);
  if (SUCCEEDED(type->GetBlob(MF_MT_MPEG_SEQUENCE_HEADER, blob.data(), size, nullptr))) keep_headers(e->headers, blob.data(), size);
}

void describe_colours(IMFMediaType* type) {
  // BT.709 with the usual narrowed range: what the card's video unit makes (core.cpp's scale step).
  type->SetUINT32(MF_MT_VIDEO_NOMINAL_RANGE, MFNominalRange_16_235);
  type->SetUINT32(MF_MT_YUV_MATRIX, MFVideoTransferMatrix_BT709);
  type->SetUINT32(MF_MT_VIDEO_PRIMARIES, MFVideoPrimaries_BT709);
  type->SetUINT32(MF_MT_TRANSFER_FUNCTION, MFVideoTransFunc_709);
}

// One finished frame out of the encoder, into `out`. Returns S_OK with bytes, MF_E_TRANSFORM_NEED_MORE_INPUT when
// it had none, or a failure.
HRESULT take_output(MfEncoder* e, std::vector<uint8_t>& out) {
  MFT_OUTPUT_STREAM_INFO info = {};
  HRESULT hr = e->mft->GetOutputStreamInfo(e->out_id, &info);
  if (FAILED(hr)) return hr;
  const bool provides = (info.dwFlags & (MFT_OUTPUT_STREAM_PROVIDES_SAMPLES | MFT_OUTPUT_STREAM_CAN_PROVIDE_SAMPLES)) != 0;

  for (int tries = 0; tries < 3; ++tries) {
    MFT_OUTPUT_DATA_BUFFER buffer = {};
    buffer.dwStreamID = e->out_id;
    ComPtr<IMFSample> mine;
    if (!provides) {
      ComPtr<IMFMediaBuffer> memory;
      hr = MFCreateMemoryBuffer(std::max<DWORD>(info.cbSize, 4 * 1024 * 1024), &memory);
      if (SUCCEEDED(hr)) hr = MFCreateSample(&mine);
      if (SUCCEEDED(hr)) hr = mine->AddBuffer(memory.Get());
      if (FAILED(hr)) return hr;
      buffer.pSample = mine.Get();
    }
    DWORD status = 0;
    hr = e->mft->ProcessOutput(0, 1, &buffer, &status);
    if (buffer.pEvents) buffer.pEvents->Release();
    if (hr == MF_E_TRANSFORM_STREAM_CHANGE) {
      // The encoder settled its output format (some do on the first frame): take the one it offers, read the
      // headers off it, and ask again.
      if (provides && buffer.pSample) buffer.pSample->Release();
      ComPtr<IMFMediaType> offered;
      hr = e->mft->GetOutputAvailableType(e->out_id, 0, &offered);
      if (SUCCEEDED(hr)) hr = e->mft->SetOutputType(e->out_id, offered.Get(), 0);
      if (FAILED(hr)) return hr;
      headers_from_type(e);
      continue;
    }
    if (FAILED(hr)) {
      if (provides && buffer.pSample) buffer.pSample->Release();
      return hr;
    }
    IMFSample* sample = buffer.pSample;
    ComPtr<IMFMediaBuffer> joined;
    hr = sample ? sample->ConvertToContiguousBuffer(&joined) : E_POINTER;
    BYTE* bytes = nullptr;
    DWORD length = 0;
    if (SUCCEEDED(hr)) hr = joined->Lock(&bytes, nullptr, &length);
    if (SUCCEEDED(hr)) {
      out.assign(bytes, bytes + length);
      joined->Unlock();
    }
    if (provides && sample) sample->Release();
    return hr;
  }
  return E_FAIL;
}

// Waits for the asynchronous encoder's next event of either kind; returns its type, or 0 when none came in time.
// Short waits are spent spinning (a frame is a few milliseconds of work), longer ones resting a millisecond at a time.
MediaEventType next_event(MfEncoder* e, double patience_ms) {
  LARGE_INTEGER f, start, t;
  QueryPerformanceFrequency(&f);
  QueryPerformanceCounter(&start);
  for (;;) {
    ComPtr<IMFMediaEvent> event;
    HRESULT hr = e->events->GetEvent(MF_EVENT_FLAG_NO_WAIT, &event);
    if (SUCCEEDED(hr)) {
      MediaEventType type = MEUnknown;
      event->GetType(&type);
      return type;
    }
    if (hr != MF_E_NO_EVENTS_AVAILABLE) return 0;
    QueryPerformanceCounter(&t);
    const double waited = (double)(t.QuadPart - start.QuadPart) * 1000.0 / (double)f.QuadPart;
    if (waited > patience_ms) return 0;
    if (waited < 3.0) SwitchToThread();
    else Sleep(1);
  }
}

}  // namespace

MfEncoder* mf_open(ID3D11Device* device, int32_t width, int32_t height, int32_t fps, int32_t bitrate_kbps, int32_t* kind,
                   char* error, int32_t error_len) {
  *kind = 0;
  CoInitializeEx(nullptr, COINIT_MULTITHREADED);  // already set up on this thread: fine either way
  HRESULT hr = MFStartup(MF_VERSION, MFSTARTUP_LITE);
  if (FAILED(hr)) {
    say(error, error_len, "Windows' Media Foundation would not start", hr);
    return nullptr;
  }
  MfEncoder* e = new MfEncoder();
  auto give_up = [&](const char* what, HRESULT code) {
    say(error, error_len, what, code);
    delete e;
    return (MfEncoder*)nullptr;
  };

  // The encoder works on the engine's own card from other threads too, so the card's context is guarded.
  ComPtr<ID3D10Multithread> guard;
  if (SUCCEEDED(device->QueryInterface(IID_PPV_ARGS(&guard)))) guard->SetMultithreadProtected(TRUE);

  // 1. A hardware H.264 encoder taking NV12, preferably the one on the card the screen is on.
  MFT_REGISTER_TYPE_INFO in_type = {MFMediaType_Video, MFVideoFormat_NV12};
  MFT_REGISTER_TYPE_INFO out_type = {MFMediaType_Video, MFVideoFormat_H264};
  IMFActivate** found = nullptr;
  UINT32 count = 0;
  ComPtr<IDXGIDevice> dxgi;
  ComPtr<IDXGIAdapter> adapter;
  DXGI_ADAPTER_DESC described = {};
  if (SUCCEEDED(device->QueryInterface(IID_PPV_ARGS(&dxgi))) && SUCCEEDED(dxgi->GetAdapter(&adapter))) adapter->GetDesc(&described);
  ComPtr<IMFAttributes> which;
  if (SUCCEEDED(MFCreateAttributes(&which, 1))) {
    which->SetBlob(MFT_ENUM_ADAPTER_LUID, (const UINT8*)&described.AdapterLuid, sizeof described.AdapterLuid);
    MFTEnum2(MFT_CATEGORY_VIDEO_ENCODER, MFT_ENUM_FLAG_HARDWARE | MFT_ENUM_FLAG_SORTANDFILTER, &in_type, &out_type,
             which.Get(), &found, &count);
  }
  if (count == 0) {
    if (found) CoTaskMemFree(found);
    found = nullptr;
    MFTEnumEx(MFT_CATEGORY_VIDEO_ENCODER, MFT_ENUM_FLAG_HARDWARE | MFT_ENUM_FLAG_SORTANDFILTER, &in_type, &out_type, &found, &count);
  }
  if (count == 0) {
    if (found) CoTaskMemFree(found);
    return give_up("This graphics card has no hardware H.264 encoder Windows can drive", MF_E_TOPO_CODEC_NOT_FOUND);
  }
  hr = found[0]->ActivateObject(IID_PPV_ARGS(&e->mft));
  for (UINT32 i = 0; i < count; ++i) found[i]->Release();
  CoTaskMemFree(found);
  if (FAILED(hr)) return give_up("The hardware encoder would not start", hr);
  *kind = 1;

  // 2. Asynchronous (hardware encoders are): unlocked, and its events listened to.
  ComPtr<IMFAttributes> attributes;
  if (SUCCEEDED(e->mft->GetAttributes(&attributes))) {
    UINT32 async = 0;
    attributes->GetUINT32(MF_TRANSFORM_ASYNC, &async);
    if (async) {
      attributes->SetUINT32(MF_TRANSFORM_ASYNC_UNLOCK, TRUE);
      if (FAILED(e->mft.As(&e->events))) return give_up("The hardware encoder has no events to listen to", E_NOINTERFACE);
      e->async = true;
    }
    attributes->SetUINT32(MF_LOW_LATENCY, env_number("DEBASER_MF_LLATTR", env_number("DEBASER_MF_LOWLATENCY", 1)) != 0 ? TRUE : FALSE);
  }

  // 3. The engine's card handed over, so the encoder reads the picture where it already is.
  UINT token = 0;
  hr = MFCreateDXGIDeviceManager(&token, &e->manager);
  if (SUCCEEDED(hr)) hr = e->manager->ResetDevice(device, token);
  if (SUCCEEDED(hr)) hr = e->mft->ProcessMessage(MFT_MESSAGE_SET_D3D_MANAGER, (ULONG_PTR)e->manager.Get());
  if (FAILED(hr)) return give_up("The hardware encoder would not share the graphics card", hr);

  DWORD ins = 1, outs = 1;
  if (e->mft->GetStreamIDs(1, &e->in_id, 1, &e->out_id) == E_NOTIMPL) {
    e->in_id = 0;
    e->out_id = 0;
  }
  (void)ins;
  (void)outs;

  // 4. The low-delay settings, then the two formats (output first, as Media Foundation asks of encoders).
  const UINT32 bits_per_second = (UINT32)std::max(500, bitrate_kbps) * 1000u;
  const int32_t rate = std::max(1, fps);
  e->frame_100ns = 10000000LL / rate;
  e->trace = env_number("DEBASER_MF_TRACE", 0) != 0;
  e->drain = env_number("DEBASER_MF_DRAIN", 0) != 0;
  // Settings that can be tried on a machine without rebuilding (DEBASER_MF_*): rate control (0 CBR, 1 peak-limited
  // VBR, 4 low-delay VBR...), speed against quality (0 fastest to 100), low-latency mode (1 on).
  const long rate_control = env_number("DEBASER_MF_RC", eAVEncCommonRateControlMode_CBR);
  const long speed = env_number("DEBASER_MF_SPEED", 0);
  const bool low_latency = env_number("DEBASER_MF_LOWLATENCY", 1) != 0;
  if (SUCCEEDED(e->mft.As(&e->codec))) {
    set_yes(e->codec.Get(), CODECAPI_AVLowLatencyMode, low_latency);
    set_number(e->codec.Get(), CODECAPI_AVEncCommonRateControlMode, (ULONG)rate_control);
    set_number(e->codec.Get(), CODECAPI_AVEncCommonMeanBitRate, bits_per_second);
    set_number(e->codec.Get(), CODECAPI_AVEncCommonMaxBitRate, bits_per_second);
    set_number(e->codec.Get(), CODECAPI_AVEncCommonBufferSize, bits_per_second / (UINT32)rate);
    set_number(e->codec.Get(), CODECAPI_AVEncMPVDefaultBPictureCount, 0);
    set_number(e->codec.Get(), CODECAPI_AVEncMPVGOPSize, (ULONG)rate * 600);  // full pictures only when asked for
    set_number(e->codec.Get(), CODECAPI_AVEncCommonQualityVsSpeed, (ULONG)speed);  // 0: the fastest it has
  }

  ComPtr<IMFMediaType> out;
  hr = MFCreateMediaType(&out);
  if (SUCCEEDED(hr)) {
    out->SetGUID(MF_MT_MAJOR_TYPE, MFMediaType_Video);
    out->SetGUID(MF_MT_SUBTYPE, MFVideoFormat_H264);
    out->SetUINT32(MF_MT_AVG_BITRATE, bits_per_second);
    MFSetAttributeSize(out.Get(), MF_MT_FRAME_SIZE, (UINT32)width, (UINT32)height);
    MFSetAttributeRatio(out.Get(), MF_MT_FRAME_RATE, (UINT32)rate, 1);
    MFSetAttributeRatio(out.Get(), MF_MT_PIXEL_ASPECT_RATIO, 1, 1);
    out->SetUINT32(MF_MT_INTERLACE_MODE, MFVideoInterlace_Progressive);
    // Baseline: what every browser decodes, and no frame ever waits for a later one.
    out->SetUINT32(MF_MT_MPEG2_PROFILE, eAVEncH264VProfile_Base);
    describe_colours(out.Get());
    hr = e->mft->SetOutputType(e->out_id, out.Get(), 0);
    if (FAILED(hr)) {
      out->SetUINT32(MF_MT_MPEG2_PROFILE, eAVEncH264VProfile_Main);
      hr = e->mft->SetOutputType(e->out_id, out.Get(), 0);
    }
  }
  if (FAILED(hr)) return give_up("The hardware encoder refused this picture size, rate or bitrate", hr);

  ComPtr<IMFMediaType> input;
  hr = MFCreateMediaType(&input);
  if (SUCCEEDED(hr)) {
    input->SetGUID(MF_MT_MAJOR_TYPE, MFMediaType_Video);
    input->SetGUID(MF_MT_SUBTYPE, MFVideoFormat_NV12);
    MFSetAttributeSize(input.Get(), MF_MT_FRAME_SIZE, (UINT32)width, (UINT32)height);
    MFSetAttributeRatio(input.Get(), MF_MT_FRAME_RATE, (UINT32)rate, 1);
    MFSetAttributeRatio(input.Get(), MF_MT_PIXEL_ASPECT_RATIO, 1, 1);
    input->SetUINT32(MF_MT_INTERLACE_MODE, MFVideoInterlace_Progressive);
    describe_colours(input.Get());
    hr = e->mft->SetInputType(e->in_id, input.Get(), 0);
  }
  if (FAILED(hr)) return give_up("The hardware encoder would not take the card's NV12 picture", hr);
  headers_from_type(e);

  // 5. Started.
  e->mft->ProcessMessage(MFT_MESSAGE_COMMAND_FLUSH, 0);
  hr = e->mft->ProcessMessage(MFT_MESSAGE_NOTIFY_BEGIN_STREAMING, 0);
  if (SUCCEEDED(hr)) hr = e->mft->ProcessMessage(MFT_MESSAGE_NOTIFY_START_OF_STREAM, 0);
  if (FAILED(hr)) return give_up("The hardware encoder would not start streaming", hr);
  e->started = true;
  return e;
}

bool mf_encode(MfEncoder* e, ID3D11Texture2D* nv12, bool force_keyframe, std::vector<uint8_t>& out, bool* keyframe,
               char* error, int32_t error_len) {
  out.clear();
  *keyframe = false;

  // The picture, wrapped where it is (no copy): a sample with its time and length.
  ComPtr<IMFMediaBuffer> buffer;
  HRESULT hr = MFCreateDXGISurfaceBuffer(__uuidof(ID3D11Texture2D), nv12, 0, FALSE, &buffer);
  if (FAILED(hr)) return say(error, error_len, "Could not hand the picture to the encoder", hr);
  ComPtr<IMF2DBuffer> flat;
  if (SUCCEEDED(buffer.As(&flat))) {
    DWORD length = 0;
    if (SUCCEEDED(flat->GetContiguousLength(&length))) buffer->SetCurrentLength(length);
  }
  ComPtr<IMFSample> sample;
  hr = MFCreateSample(&sample);
  if (SUCCEEDED(hr)) hr = sample->AddBuffer(buffer.Get());
  if (FAILED(hr)) return say(error, error_len, "Could not make the encoder's sample", hr);
  sample->SetSampleTime(e->time);
  sample->SetSampleDuration(e->frame_100ns);
  e->time += e->frame_100ns;
  if (force_keyframe && e->codec) set_number(e->codec.Get(), CODECAPI_AVEncVideoForceKeyFrame, 1);

  if (!e->async) {
    hr = e->mft->ProcessInput(e->in_id, sample.Get(), 0);
    if (FAILED(hr)) return say(error, error_len, "The encoder would not take the picture", hr);
    hr = take_output(e, out);
    if (hr == MF_E_TRANSFORM_NEED_MORE_INPUT) return true;  // nothing out yet: an empty frame
    if (FAILED(hr)) return say(error, error_len, "The encoder gave no frame", hr);
  } else {
    // Wait until it asks for a picture, give it this one, then wait for the finished frame.
    const double t0 = ms_now();
    while (e->wanted == 0) {
      const MediaEventType type = next_event(e, 500);
      if (type == METransformNeedInput) e->wanted += 1;
      else if (type == METransformHaveOutput) {
        std::vector<uint8_t> stray;
        take_output(e, stray);  // a frame left from before: not this one
      } else if (type == 0) return say(error, error_len, "The hardware encoder stopped asking for pictures", E_FAIL);
    }
    const double t1 = ms_now();
    hr = e->mft->ProcessInput(e->in_id, sample.Get(), 0);
    // "Not accepting" (Intel's, just after a drain): it was not really asking yet. Wait for its next request and give
    // the picture again, a few times at most.
    for (int again = 0; hr == MF_E_NOTACCEPTING && again < 4; ++again) {
      e->wanted = 0;
      while (e->wanted == 0) {
        const MediaEventType type = next_event(e, 500);
        if (type == METransformNeedInput) e->wanted += 1;
        else if (type == METransformHaveOutput) {
          std::vector<uint8_t> stray;
          take_output(e, stray);
        } else if (type == 0) return say(error, error_len, "The hardware encoder stopped asking for pictures", E_FAIL);
      }
      hr = e->mft->ProcessInput(e->in_id, sample.Get(), 0);
    }
    if (FAILED(hr)) return say(error, error_len, "The hardware encoder would not take the picture", hr);
    e->wanted -= 1;
    double t2 = t1, t3 = t1;
    if (e->drain) {
      // Drained: every frame it holds comes out now (this picture's last), then "drain complete".
      hr = e->mft->ProcessMessage(MFT_MESSAGE_COMMAND_DRAIN, 0);
      if (FAILED(hr)) return say(error, error_len, "The hardware encoder would not drain", hr);
      for (;;) {
        const MediaEventType type = next_event(e, 500);
        if (type == METransformNeedInput) {}  // a request during the drain does not count (see "not accepting" above)
        else if (type == METransformHaveOutput) {
          std::vector<uint8_t> got;
          t2 = ms_now();
          hr = take_output(e, got);
          t3 = ms_now();
          if (FAILED(hr) && hr != MF_E_TRANSFORM_NEED_MORE_INPUT) return say(error, error_len, "The hardware encoder gave no frame", hr);
          if (!got.empty()) out.swap(got);  // the newest frame is this picture's
        } else if (type == METransformDrainComplete) {
          // A drained encoder may wait to be told the stream goes on before it asks for the next picture (NVIDIA's
          // does); DEBASER_MF_DRAIN_RESTART=0 leaves that out, for one that does not want it.
          e->wanted = 0;
          if (env_number("DEBASER_MF_DRAIN_RESTART", 1) != 0) e->mft->ProcessMessage(MFT_MESSAGE_NOTIFY_START_OF_STREAM, 0);
          break;
        }
        else if (type == 0) return say(error, error_len, "The hardware encoder did not finish draining", E_FAIL);
      }
      if (out.empty()) return say(error, error_len, "The hardware encoder drained without giving the frame", E_FAIL);
      if (e->trace) {
        e->t_asked += t1 - t0;
        e->t_given += t2 - t1;
        e->t_taken += t3 - t2;
        e->traced += 1;
      }
    }
    for (; !e->drain;) {
      const MediaEventType type = next_event(e, 500);
      if (type == METransformNeedInput) {
        e->wanted += 1;
        continue;
      }
      if (type == METransformHaveOutput) {
        t2 = ms_now();
        hr = take_output(e, out);
        t3 = ms_now();
        if (FAILED(hr) && hr != MF_E_TRANSFORM_NEED_MORE_INPUT) return say(error, error_len, "The hardware encoder gave no frame", hr);
        if (!out.empty()) {
          if (e->trace) {
            e->t_asked += t1 - t0;
            e->t_given += t2 - t1;
            e->t_taken += t3 - t2;
            e->traced += 1;
          }
          break;
        }
        continue;
      }
      if (type == 0) {
        // It wants more pictures before it gives this one back: an empty frame now, the bytes come next time.
        if (e->wanted > 0) {
          e->empties += 1;
          return true;
        }
        return say(error, error_len, "The hardware encoder held the picture and gave nothing back", E_FAIL);
      }
    }
  }

  // Full pictures carry the headers, so a viewer can start from any of them.
  keep_headers(e->headers, out.data(), out.size());
  bool has_headers = false;
  for (const Part& p : parts_of(out.data(), out.size())) {
    if (p.kind == 5) *keyframe = true;
    if (p.kind == 7) has_headers = true;
  }
  if (*keyframe && !has_headers && !e->headers.empty()) out.insert(out.begin(), e->headers.begin(), e->headers.end());
  return true;
}

void mf_close(MfEncoder* encoder) { delete encoder; }
