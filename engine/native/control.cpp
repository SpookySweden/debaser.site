// CONTROL (SPEC-screens.md, phase 2): a viewer's mouse and keys put into Windows, and the guard on the PC itself.
//
// Written from Microsoft's own documentation of SendInput, RegisterHotKey and ordinary windows. No driver is
// used and nothing is installed. No code from Sunshine, Moonlight or any GPL project is copied here.
//
// The rules about WHEN any of this may happen (only with --allow-control, one viewer at a time, never during a
// League match, everything let go when control ends) live in src/control.rs. This file only does as it is told.

#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <windows.h>

#include <algorithm>
#include <atomic>
#include <cmath>
#include <cstring>
#include <mutex>

#include "control.h"

namespace {

int32_t put(INPUT& input) { return (int32_t)SendInput(1, &input, sizeof(INPUT)); }

// What has been pressed here and not yet let go of, so that it can all be let go of in an emergency.
struct HeldKey {
  int32_t scan, extended, virtual_key;
};
std::mutex g_held_lock;
HeldKey g_held_keys[64];
int g_held_key_count = 0;
bool g_held_buttons[5] = {false, false, false, false, false};

void remember_key(int32_t scan, int32_t extended, int32_t virtual_key, bool down) {
  std::lock_guard<std::mutex> guard(g_held_lock);
  int found = -1;
  for (int i = 0; i < g_held_key_count; ++i) {
    const HeldKey& k = g_held_keys[i];
    if (k.scan == scan && k.extended == extended && k.virtual_key == virtual_key) found = i;
  }
  if (down && found < 0 && g_held_key_count < 64) g_held_keys[g_held_key_count++] = {scan, extended, virtual_key};
  if (!down && found >= 0) g_held_keys[found] = g_held_keys[--g_held_key_count];
}

// ---- The guard: the cut-off key and the strip. Both belong to one small thread, because Windows delivers a
// hotkey and a window's messages to the thread that asked for them.

const wchar_t kStripClass[] = L"DebaserControlStrip";
const wchar_t kStripText[] = L"CONTROLLED FROM ANOTHER DEVICE :: CTRL+ALT+SHIFT+END STOPS IT";
const int kStripHeight = 22;
const int kCutOffId = 0x0DBE;
const UINT kCutOffKeys = MOD_CONTROL | MOD_ALT | MOD_SHIFT | 0x4000 /* MOD_NOREPEAT: holding it down counts once */;
const UINT kBegin = WM_APP + 1;
const UINT kEnd = WM_APP + 2;
// SetWindowDisplayAffinity's "leave this window out of screen captures" (Windows 10 2004 and later).
const DWORD kLeftOutOfCaptures = 0x00000011;

HANDLE g_thread = nullptr;
DWORD g_thread_id = 0;
HANDLE g_answered = nullptr;  // set by the guard's thread each time it has done what it was asked
std::atomic<int> g_answer{0};
std::atomic<int> g_cut{0};
// Only the guard's thread touches these two.
HWND g_strip = nullptr;
bool g_key_held = false;

// The strip: a dark grey band with one line of light grey text in the system's own font. Text only.
LRESULT CALLBACK strip_proc(HWND window, UINT message, WPARAM wide, LPARAM longer) {
  switch (message) {
    case WM_PAINT: {
      PAINTSTRUCT paint;
      HDC dc = BeginPaint(window, &paint);
      RECT all;
      GetClientRect(window, &all);
      HBRUSH grey = CreateSolidBrush(RGB(32, 32, 32));
      FillRect(dc, &all, grey);
      DeleteObject(grey);
      SetBkMode(dc, TRANSPARENT);
      SetTextColor(dc, RGB(208, 208, 208));
      HGDIOBJ before = SelectObject(dc, GetStockObject(DEFAULT_GUI_FONT));
      DrawTextW(dc, kStripText, -1, &all, DT_CENTER | DT_VCENTER | DT_SINGLELINE);
      SelectObject(dc, before);
      EndPaint(window, &paint);
      return 0;
    }
    case WM_NCHITTEST:
      return HTTRANSPARENT;  // clicks go to whatever is underneath
    case WM_MOUSEACTIVATE:
      return MA_NOACTIVATE;  // and it never takes the keyboard
  }
  return DefWindowProcW(window, message, wide, longer);
}

void show_strip() {
  if (g_strip) return;
  static bool known = false;
  if (!known) {
    WNDCLASSEXW kind = {};
    kind.cbSize = sizeof kind;
    kind.lpfnWndProc = strip_proc;
    kind.hInstance = GetModuleHandleW(nullptr);
    kind.lpszClassName = kStripClass;
    known = RegisterClassExW(&kind) != 0;
  }
  // On top of everything, click-through, never activated, kept off the taskbar and out of Alt+Tab.
  g_strip = CreateWindowExW(WS_EX_TOPMOST | WS_EX_NOACTIVATE | WS_EX_TRANSPARENT | WS_EX_LAYERED | WS_EX_TOOLWINDOW, kStripClass,
                            kStripText, WS_POPUP, 0, 0, GetSystemMetrics(SM_CXSCREEN), kStripHeight, nullptr, nullptr,
                            GetModuleHandleW(nullptr), nullptr);
  if (!g_strip) return;
  SetLayeredWindowAttributes(g_strip, 0, 235, LWA_ALPHA);
  // The viewer does not need to be told it is controlling: the strip is left out of the picture that is streamed.
  SetWindowDisplayAffinity(g_strip, kLeftOutOfCaptures);
  ShowWindow(g_strip, SW_SHOWNOACTIVATE);
}

DWORD WINAPI guard_thread(void*) {
  MSG message;
  // Asking for a message once is what makes Windows give this thread a queue to post to.
  PeekMessageW(&message, nullptr, WM_USER, WM_USER, PM_NOREMOVE);
  SetEvent(g_answered);
  while (GetMessageW(&message, nullptr, 0, 0) > 0) {
    if (message.hwnd == nullptr && message.message == kBegin) {
      g_cut = 0;
      if (!g_key_held) g_key_held = RegisterHotKey(nullptr, kCutOffId, kCutOffKeys, VK_END) != 0;
      if (g_key_held) show_strip();
      g_answer = g_key_held ? 0 : 1;
      SetEvent(g_answered);
    } else if (message.hwnd == nullptr && message.message == kEnd) {
      if (g_key_held) UnregisterHotKey(nullptr, kCutOffId);
      g_key_held = false;
      if (g_strip) DestroyWindow(g_strip);
      g_strip = nullptr;
      SetEvent(g_answered);
    } else if (message.message == WM_HOTKEY && (int)message.wParam == kCutOffId) {
      g_cut = 1;
    } else {
      TranslateMessage(&message);
      DispatchMessageW(&message);
    }
  }
  return 0;
}

// Asks the guard's thread to do one thing and waits (briefly) for it to say it has.
bool ask_guard(UINT what) {
  if (!g_thread) {
    g_answered = CreateEventW(nullptr, FALSE, FALSE, nullptr);
    if (!g_answered) return false;
    g_thread = CreateThread(nullptr, 0, guard_thread, nullptr, 0, &g_thread_id);
    if (!g_thread || WaitForSingleObject(g_answered, 2000) != WAIT_OBJECT_0) return false;
  }
  ResetEvent(g_answered);
  if (!PostThreadMessageW(g_thread_id, what, 0, 0)) return false;
  return WaitForSingleObject(g_answered, 2000) == WAIT_OBJECT_0;
}

}  // namespace

int32_t dbe_put_pointer_at(double share_x, double share_y) {
  // Windows wants "absolute" positions as 0 to 65535 across ALL the screens together, so the place on the main
  // screen (whose corner is 0,0) is first turned into a place on that whole desktop.
  const double all_left = GetSystemMetrics(SM_XVIRTUALSCREEN), all_top = GetSystemMetrics(SM_YVIRTUALSCREEN);
  const double all_wide = GetSystemMetrics(SM_CXVIRTUALSCREEN), all_tall = GetSystemMetrics(SM_CYVIRTUALSCREEN);
  const double main_wide = GetSystemMetrics(SM_CXSCREEN), main_tall = GetSystemMetrics(SM_CYSCREEN);
  if (all_wide < 2 || all_tall < 2) return 0;
  const double x = std::min(1.0, std::max(0.0, share_x)) * main_wide - all_left;
  const double y = std::min(1.0, std::max(0.0, share_y)) * main_tall - all_top;
  INPUT input = {};
  input.type = INPUT_MOUSE;
  input.mi.dx = (LONG)std::lround(x * 65535.0 / (all_wide - 1));
  input.mi.dy = (LONG)std::lround(y * 65535.0 / (all_tall - 1));
  input.mi.dwFlags = MOUSEEVENTF_MOVE | MOUSEEVENTF_ABSOLUTE | MOUSEEVENTF_VIRTUALDESK;
  return put(input);
}

int32_t dbe_put_pointer_by(int32_t dx, int32_t dy) {
  INPUT input = {};
  input.type = INPUT_MOUSE;
  input.mi.dx = dx;
  input.mi.dy = dy;
  input.mi.dwFlags = MOUSEEVENTF_MOVE;
  return put(input);
}

int32_t dbe_put_button(int32_t button, int32_t down) {
  INPUT input = {};
  input.type = INPUT_MOUSE;
  switch (button) {
    case 0: input.mi.dwFlags = down ? MOUSEEVENTF_LEFTDOWN : MOUSEEVENTF_LEFTUP; break;
    case 1: input.mi.dwFlags = down ? MOUSEEVENTF_RIGHTDOWN : MOUSEEVENTF_RIGHTUP; break;
    case 2: input.mi.dwFlags = down ? MOUSEEVENTF_MIDDLEDOWN : MOUSEEVENTF_MIDDLEUP; break;
    case 3: input.mi.dwFlags = down ? MOUSEEVENTF_XDOWN : MOUSEEVENTF_XUP; input.mi.mouseData = XBUTTON1; break;
    case 4: input.mi.dwFlags = down ? MOUSEEVENTF_XDOWN : MOUSEEVENTF_XUP; input.mi.mouseData = XBUTTON2; break;
    default: return 0;
  }
  {
    std::lock_guard<std::mutex> guard(g_held_lock);
    g_held_buttons[button] = down != 0;
  }
  return put(input);
}

int32_t dbe_put_wheel(int32_t dx, int32_t dy) {
  int32_t taken = 0;
  if (dy != 0) {
    INPUT input = {};
    input.type = INPUT_MOUSE;
    input.mi.dwFlags = MOUSEEVENTF_WHEEL;
    input.mi.mouseData = (DWORD)dy;
    taken += put(input);
  }
  if (dx != 0) {
    INPUT input = {};
    input.type = INPUT_MOUSE;
    input.mi.dwFlags = MOUSEEVENTF_HWHEEL;
    input.mi.mouseData = (DWORD)dx;
    taken += put(input);
  }
  return taken;
}

int32_t dbe_put_key(int32_t scan, int32_t extended, int32_t virtual_key, int32_t down) {
  INPUT input = {};
  input.type = INPUT_KEYBOARD;
  if (virtual_key != 0) {
    input.ki.wVk = (WORD)virtual_key;
  } else {
    input.ki.wScan = (WORD)scan;
    input.ki.dwFlags = KEYEVENTF_SCANCODE | (extended ? KEYEVENTF_EXTENDEDKEY : 0);
  }
  if (!down) input.ki.dwFlags |= KEYEVENTF_KEYUP;
  remember_key(scan, extended ? 1 : 0, virtual_key, down != 0);
  return put(input);
}

int32_t dbe_put_all_up(void) {
  HeldKey keys[64];
  bool buttons[5];
  int count;
  {
    std::lock_guard<std::mutex> guard(g_held_lock);
    count = g_held_key_count;
    memcpy(keys, g_held_keys, sizeof keys);
    memcpy(buttons, g_held_buttons, sizeof buttons);
  }
  int32_t let_go = 0;
  for (int i = count - 1; i >= 0; --i) {
    dbe_put_key(keys[i].scan, keys[i].extended, keys[i].virtual_key, 0);
    let_go += 1;
  }
  for (int b = 0; b < 5; ++b) {
    if (buttons[b]) {
      dbe_put_button(b, 0);
      let_go += 1;
    }
  }
  return let_go;
}

int32_t dbe_pointer_where(int32_t* x, int32_t* y) {
  POINT at;
  if (!GetCursorPos(&at)) return 1;
  *x = at.x;
  *y = at.y;
  return 0;
}

int32_t dbe_guard_begin(void) {
  if (!ask_guard(kBegin)) return 2;
  return g_answer.load();
}

void dbe_guard_end(void) {
  if (g_thread) ask_guard(kEnd);
}

int32_t dbe_guard_cut(void) { return g_cut.exchange(0); }

void dbe_strip_seen(DbeStripSeen* seen) {
  memset(seen, 0, sizeof *seen);
  HWND strip = FindWindowW(kStripClass, nullptr);
  if (!strip) return;
  seen->present = 1;
  seen->visible = IsWindowVisible(strip) ? 1 : 0;
  RECT where;
  if (GetWindowRect(strip, &where)) {
    seen->left = where.left;
    seen->top = where.top;
    seen->right = where.right;
    seen->bottom = where.bottom;
  }
  const LONG_PTR style = GetWindowLongPtrW(strip, GWL_EXSTYLE);
  seen->topmost = (style & WS_EX_TOPMOST) ? 1 : 0;
  seen->click_through = (style & WS_EX_TRANSPARENT) ? 1 : 0;
  seen->no_activate = (style & WS_EX_NOACTIVATE) ? 1 : 0;
  seen->in_front = GetForegroundWindow() == strip ? 1 : 0;
  GetWindowTextW(strip, (LPWSTR)seen->text, (int)(sizeof seen->text / sizeof seen->text[0]));
}

int32_t dbe_cut_off_key_free(void) {
  if (!RegisterHotKey(nullptr, kCutOffId + 1, kCutOffKeys, VK_END)) return 0;
  UnregisterHotKey(nullptr, kCutOffId + 1);
  return 1;
}

int32_t dbe_post_cut_off(void) {
  HWND strip = FindWindowW(kStripClass, nullptr);
  if (!strip) return 0;
  const DWORD thread = GetWindowThreadProcessId(strip, nullptr);
  if (!thread) return 0;
  return PostThreadMessageW(thread, WM_HOTKEY, (WPARAM)kCutOffId, MAKELPARAM(MOD_CONTROL | MOD_ALT | MOD_SHIFT, VK_END)) ? 1 : 0;
}

int32_t dbe_pads_seen(DbePadSeen seen[4]) {
  memset(seen, 0, 4 * sizeof(DbePadSeen));
  // XInput is part of Windows; it is looked up by name so that the engine still starts on a PC without it.
  HMODULE dll = LoadLibraryA("xinput1_4.dll");
  if (!dll) dll = LoadLibraryA("xinput9_1_0.dll");
  if (!dll) return -1;
  // One controller's state, as Microsoft's XINPUT_STATE lays it out.
  struct State {
    DWORD packet;
    WORD buttons;
    BYTE left_trigger, right_trigger;
    SHORT left_x, left_y, right_x, right_y;
  };
  typedef DWORD(WINAPI * GetState)(DWORD, State*);
  GetState get_state = (GetState)GetProcAddress(dll, "XInputGetState");
  int32_t connected = -1;
  if (get_state) {
    connected = 0;
    for (DWORD place = 0; place < 4; ++place) {
      State state = {};
      if (get_state(place, &state) != ERROR_SUCCESS) continue;
      connected += 1;
      seen[place].connected = 1;
      seen[place].changes = (int32_t)state.packet;
      seen[place].buttons = state.buttons;
      seen[place].left_trigger = state.left_trigger;
      seen[place].right_trigger = state.right_trigger;
      seen[place].left_x = state.left_x;
      seen[place].left_y = state.left_y;
      seen[place].right_x = state.right_x;
      seen[place].right_y = state.right_y;
    }
  }
  FreeLibrary(dll);
  return connected;
}
