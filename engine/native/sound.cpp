// SOUND (SPEC-screens.md): what the PC is playing, read back from Windows' own mixer ("WASAPI loopback").
//
// Written from Microsoft's documentation of the Core Audio interfaces (IMMDeviceEnumerator, IAudioClient,
// IAudioCaptureClient) and its "Loopback Recording" page. No code from Sunshine, Moonlight or any GPL project is
// copied here.
//
// Windows wakes this code when sound has arrived (an event), so nothing is polled and nothing waits longer than
// the playback device's own beat (10 ms on ordinary hardware).

#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <windows.h>
#include <objbase.h>
#include <mmreg.h>
#include <mmdeviceapi.h>
#include <audioclient.h>
#include <wrl/client.h>

#include <algorithm>
#include <cstdio>
#include <cstring>

#include "sound.h"

using Microsoft::WRL::ComPtr;

namespace {

// Windows' name for "32-bit float samples" (KSDATAFORMAT_SUBTYPE_IEEE_FLOAT), written out here so that no extra
// header or library is needed for one number.
const GUID kFloatSamples = {0x00000003, 0x0000, 0x0010, {0x80, 0x00, 0x00, 0xaa, 0x00, 0x38, 0x9b, 0x71}};

const int kRate = 48000;

}  // namespace

struct DbeSound {
  ComPtr<IMMDeviceEnumerator> devices;
  ComPtr<IMMDevice> device;
  ComPtr<IAudioClient> client;
  ComPtr<IAudioCaptureClient> capture;
  HANDLE arrived = nullptr;  // Windows signals this when sound has come
  bool started = false;
  bool com = false;          // this thread's use of Windows' component system was begun here, and is ended here
  int channels = 2;          // how many channels Windows hands over (2, unless it would not convert for us)
  char error[256] = {0};

  ~DbeSound() {
    if (started && client) client->Stop();
    capture.Reset();
    client.Reset();
    device.Reset();
    devices.Reset();
    if (arrived) CloseHandle(arrived);
    if (com) CoUninitialize();
  }

  bool fail(const char* what, HRESULT code) {
    snprintf(error, sizeof error, "%s (0x%08lx)", what, (unsigned long)code);
    return false;
  }

  bool open();
  int32_t take(float* out, int32_t most_frames);
};

bool DbeSound::open() {
  HRESULT hr = CoInitializeEx(nullptr, COINIT_MULTITHREADED);
  // "Already begun on this thread" (either kind) is fine; only a real begin is ended again.
  com = SUCCEEDED(hr);
  if (FAILED(hr) && hr != RPC_E_CHANGED_MODE) return fail("Windows' sound system could not be reached", hr);

  hr = CoCreateInstance(__uuidof(MMDeviceEnumerator), nullptr, CLSCTX_ALL, IID_PPV_ARGS(&devices));
  if (FAILED(hr)) return fail("Windows would not list its sound devices", hr);
  // The device Windows is playing ordinary sound on right now.
  hr = devices->GetDefaultAudioEndpoint(eRender, eConsole, &device);
  if (FAILED(hr)) return fail("This PC has no playback device (no speakers or headphones Windows knows of)", hr);
  hr = device->Activate(__uuidof(IAudioClient), CLSCTX_ALL, nullptr, &client);
  if (FAILED(hr)) return fail("The playback device would not be opened", hr);

  // What is asked for: 48,000 a second, left and right, 32-bit float. Whatever the device itself runs at, Windows
  // is asked to convert on the way (AUTOCONVERTPCM), which it does in its own mixer.
  WAVEFORMATEXTENSIBLE wanted = {};
  wanted.Format.wFormatTag = WAVE_FORMAT_EXTENSIBLE;
  wanted.Format.nChannels = 2;
  wanted.Format.nSamplesPerSec = kRate;
  wanted.Format.wBitsPerSample = 32;
  wanted.Format.nBlockAlign = 8;
  wanted.Format.nAvgBytesPerSec = kRate * 8;
  wanted.Format.cbSize = sizeof(WAVEFORMATEXTENSIBLE) - sizeof(WAVEFORMATEX);
  wanted.Samples.wValidBitsPerSample = 32;
  wanted.dwChannelMask = SPEAKER_FRONT_LEFT | SPEAKER_FRONT_RIGHT;
  wanted.SubFormat = kFloatSamples;
  // LOOPBACK: a copy of what is being played, not a microphone. EVENTCALLBACK: Windows signals when sound has come.
  const DWORD flags = AUDCLNT_STREAMFLAGS_LOOPBACK | AUDCLNT_STREAMFLAGS_EVENTCALLBACK;
  const DWORD convert = AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM | AUDCLNT_STREAMFLAGS_SRC_DEFAULT_QUALITY;
  // Room for a fifth of a second, so a busy moment loses nothing. It adds no delay: sound is taken as it comes.
  const REFERENCE_TIME room = 2000000;
  hr = client->Initialize(AUDCLNT_SHAREMODE_SHARED, flags | convert, room, 0, &wanted.Format, nullptr);
  if (FAILED(hr)) {
    // Windows would not convert. The device's own format is taken instead, when it is one this code can use as
    // it is: float samples at 48,000 a second (the first two channels are then kept).
    client.Reset();
    HRESULT again = device->Activate(__uuidof(IAudioClient), CLSCTX_ALL, nullptr, &client);
    WAVEFORMATEX* own = nullptr;
    if (SUCCEEDED(again)) again = client->GetMixFormat(&own);
    if (FAILED(again)) return fail("The playback device would not say what format it plays in", again);
    const bool is_float = own->wFormatTag == WAVE_FORMAT_IEEE_FLOAT ||
                          (own->wFormatTag == WAVE_FORMAT_EXTENSIBLE && own->cbSize >= 22 &&
                           IsEqualGUID(((WAVEFORMATEXTENSIBLE*)own)->SubFormat, kFloatSamples));
    const bool usable = is_float && own->wBitsPerSample == 32 && own->nSamplesPerSec == (DWORD)kRate && own->nChannels >= 1;
    if (usable) {
      channels = own->nChannels;
      again = client->Initialize(AUDCLNT_SHAREMODE_SHARED, flags, room, 0, own, nullptr);
    }
    const DWORD rate = own->nSamplesPerSec;
    CoTaskMemFree(own);
    if (!usable) {
      snprintf(error, sizeof error,
               "The playback device plays at %lu samples a second and Windows would not convert it to 48000 (0x%08lx)",
               (unsigned long)rate, (unsigned long)hr);
      return false;
    }
    if (FAILED(again)) return fail("Windows would not hand over a copy of what the PC is playing", again);
  }

  arrived = CreateEventW(nullptr, FALSE, FALSE, nullptr);
  if (!arrived) return fail("No signal could be made for arriving sound", (HRESULT)GetLastError());
  hr = client->SetEventHandle(arrived);
  if (FAILED(hr)) return fail("Windows would not signal arriving sound", hr);
  hr = client->GetService(IID_PPV_ARGS(&capture));
  if (FAILED(hr)) return fail("Windows would not hand over the sound reader", hr);
  hr = client->Start();
  if (FAILED(hr)) return fail("The copy of the PC's sound would not start", hr);
  started = true;
  return true;
}

// Everything that is waiting, up to `most_frames`. Windows hands sound over in packets (one per beat of the
// device); a packet is only taken when all of it fits.
int32_t DbeSound::take(float* out, int32_t most_frames) {
  int32_t written = 0;
  for (;;) {
    UINT32 next = 0;
    HRESULT hr = capture->GetNextPacketSize(&next);
    if (FAILED(hr)) {
      fail("The playback device went away", hr);
      return -1;
    }
    if (next == 0) break;
    // A packet larger than the caller's whole room (it never is) is taken and thrown away, or nothing would
    // ever be read again.
    const bool fits = written + (int32_t)next <= most_frames;
    if (!fits && written > 0) break;
    BYTE* data = nullptr;
    UINT32 frames = 0;
    DWORD marks = 0;
    hr = capture->GetBuffer(&data, &frames, &marks, nullptr, nullptr);
    if (FAILED(hr)) {
      fail("The playback device went away", hr);
      return -1;
    }
    if (fits) {
      float* to = out + (size_t)written * 2;
      if ((marks & AUDCLNT_BUFFERFLAGS_SILENT) || !data) {
        memset(to, 0, (size_t)frames * 2 * sizeof(float));
      } else if (channels == 2) {
        memcpy(to, data, (size_t)frames * 2 * sizeof(float));
      } else {
        // More (or fewer) channels than two, handed over as they are: the first two are left and right, and a
        // single channel goes to both.
        const float* from = (const float*)data;
        for (UINT32 i = 0; i < frames; ++i) {
          to[i * 2] = from[(size_t)i * channels];
          to[i * 2 + 1] = from[(size_t)i * channels + (channels > 1 ? 1 : 0)];
        }
      }
      written += (int32_t)frames;
    }
    capture->ReleaseBuffer(frames);
  }
  return written;
}

DbeSound* dbe_sound_open(char* error, int32_t error_len) {
  DbeSound* s = new DbeSound();
  if (s->open()) return s;
  if (error && error_len > 0) snprintf(error, (size_t)error_len, "%s", s->error);
  delete s;
  return nullptr;
}

int32_t dbe_sound_read(DbeSound* sound, float* out, int32_t most_frames, int32_t wait_ms) {
  int32_t got = sound->take(out, most_frames);
  if (got != 0) return got;
  WaitForSingleObject(sound->arrived, (DWORD)std::max(0, wait_ms));
  return sound->take(out, most_frames);
}

const char* dbe_sound_error(DbeSound* sound) { return sound->error; }

void dbe_sound_close(DbeSound* sound) { delete sound; }
