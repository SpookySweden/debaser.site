// THE PC'S SCREEN MODE (SPEC-screens.md): reading the main screen's modes, changing it for a while, giving it back.
//
// Written from Microsoft's documentation of EnumDisplayDevices, EnumDisplaySettingsEx and ChangeDisplaySettingsEx.
// No code from Sunshine, Moonlight or any GPL project is copied here.
//
// The rules about WHEN the mode may change (only with --allow-fit, only while a viewer wants it, never during a
// League match, always given back) live in src/fit.rs. This file only does as it is told.

#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <windows.h>

#include <cstring>

#include "modes.h"

namespace {

// Windows' name for the main screen (the one the desktop's corner 0,0 is on), such as \\.\DISPLAY1.
bool main_screen(wchar_t name[32]) {
  for (DWORD i = 0;; ++i) {
    DISPLAY_DEVICEW device = {};
    device.cb = sizeof device;
    if (!EnumDisplayDevicesW(nullptr, i, &device, 0)) return false;
    if (device.StateFlags & DISPLAY_DEVICE_PRIMARY_DEVICE) {
      wcsncpy_s(name, 32, device.DeviceName, _TRUNCATE);
      return true;
    }
  }
}

// A mode as Windows wants it described when asked to set it: the size, the rate and full colour, nothing else.
DEVMODEW described(const DbeMode* mode) {
  DEVMODEW wanted = {};
  wanted.dmSize = sizeof wanted;
  wanted.dmPelsWidth = (DWORD)mode->width;
  wanted.dmPelsHeight = (DWORD)mode->height;
  wanted.dmDisplayFrequency = (DWORD)mode->hz;
  wanted.dmBitsPerPel = 32;
  wanted.dmFields = DM_PELSWIDTH | DM_PELSHEIGHT | DM_DISPLAYFREQUENCY | DM_BITSPERPEL;
  return wanted;
}

}  // namespace

int32_t dbe_mode_now(DbeMode* mode) {
  memset(mode, 0, sizeof *mode);
  wchar_t name[32];
  if (!main_screen(name)) return 1;
  DEVMODEW current = {};
  current.dmSize = sizeof current;
  if (!EnumDisplaySettingsExW(name, ENUM_CURRENT_SETTINGS, &current, 0)) return 1;
  mode->width = (int32_t)current.dmPelsWidth;
  mode->height = (int32_t)current.dmPelsHeight;
  mode->hz = (int32_t)current.dmDisplayFrequency;
  return 0;
}

int32_t dbe_modes(DbeMode* out, int32_t most) {
  wchar_t name[32];
  if (!main_screen(name)) return 0;
  int32_t count = 0;
  // Windows lists only the modes the monitor says it can show, the way the screen is turned now.
  for (DWORD i = 0; count < most; ++i) {
    DEVMODEW one = {};
    one.dmSize = sizeof one;
    if (!EnumDisplaySettingsExW(name, i, &one, 0)) break;
    if (one.dmBitsPerPel != 32) continue;
    if (one.dmDisplayFlags & DM_INTERLACED) continue;
    const DbeMode mode = {(int32_t)one.dmPelsWidth, (int32_t)one.dmPelsHeight, (int32_t)one.dmDisplayFrequency};
    // The same size and rate comes up several times (once for each way of stretching it): listed once.
    bool listed = false;
    for (int32_t k = 0; k < count; ++k) {
      if (out[k].width == mode.width && out[k].height == mode.height && out[k].hz == mode.hz) listed = true;
    }
    if (!listed) out[count++] = mode;
  }
  return count;
}

int32_t dbe_mode_would_take(const DbeMode* mode) {
  wchar_t name[32];
  if (!main_screen(name)) return DISP_CHANGE_BADPARAM;
  DEVMODEW wanted = described(mode);
  // CDS_TEST: Windows only answers; nothing changes.
  return (int32_t)ChangeDisplaySettingsExW(name, &wanted, nullptr, CDS_TEST, nullptr);
}

int32_t dbe_mode_set_for_now(const DbeMode* mode) {
  wchar_t name[32];
  if (!main_screen(name)) return DISP_CHANGE_BADPARAM;
  DEVMODEW wanted = described(mode);
  // CDS_FULLSCREEN is Windows' name for "temporary": the mode is not saved anywhere, and Windows goes back to
  // the saved one by itself when this program ends, however it ends.
  return (int32_t)ChangeDisplaySettingsExW(name, &wanted, nullptr, CDS_FULLSCREEN, nullptr);
}

int32_t dbe_mode_give_back(void) {
  wchar_t name[32];
  if (!main_screen(name)) return DISP_CHANGE_BADPARAM;
  // No mode named: Windows returns to the one in its own settings.
  return (int32_t)ChangeDisplaySettingsExW(name, nullptr, nullptr, 0, nullptr);
}
