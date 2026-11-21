// This PC's own IPv4 addresses, as Windows lists them (for `serve --lan`: the home-network addresses a viewer on
// another device can send video traffic to). It only reads Windows' list of network cards: nothing is opened,
// bound or sent. Which of the addresses are fit to offer is decided on the Rust side (src/serve.rs).

#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <winsock2.h>
#include <ws2tcpip.h>
#include <iphlpapi.h>

#include <vector>

#include "core.h"

int32_t dbe_local_ipv4(uint32_t* addresses, int32_t most) {
  // Windows says how much room its list needs; it is asked twice at most (the list can grow in between).
  ULONG size = 16 * 1024;
  std::vector<unsigned char> room;
  IP_ADAPTER_ADDRESSES* cards = nullptr;
  for (int attempt = 0; attempt < 3; ++attempt) {
    room.resize(size);
    cards = (IP_ADAPTER_ADDRESSES*)room.data();
    const ULONG result = GetAdaptersAddresses(AF_INET, GAA_FLAG_SKIP_ANYCAST | GAA_FLAG_SKIP_MULTICAST | GAA_FLAG_SKIP_DNS_SERVER, nullptr, cards, &size);
    if (result == NO_ERROR) break;
    cards = nullptr;
    if (result != ERROR_BUFFER_OVERFLOW) return 0;
  }
  int32_t count = 0;
  for (IP_ADAPTER_ADDRESSES* card = cards; card; card = card->Next) {
    // Only cards that are up and carrying traffic.
    if (card->OperStatus != IfOperStatusUp) continue;
    for (IP_ADAPTER_UNICAST_ADDRESS* at = card->FirstUnicastAddress; at; at = at->Next) {
      if (!at->Address.lpSockaddr || at->Address.lpSockaddr->sa_family != AF_INET) continue;
      if (count >= most) return count;
      // The four numbers of the address, first number in the highest byte.
      const in_addr& a = ((sockaddr_in*)at->Address.lpSockaddr)->sin_addr;
      addresses[count++] = ((uint32_t)a.S_un.S_un_b.s_b1 << 24) | ((uint32_t)a.S_un.S_un_b.s_b2 << 16) | ((uint32_t)a.S_un.S_un_b.s_b3 << 8) | (uint32_t)a.S_un.S_un_b.s_b4;
    }
  }
  return count;
}
