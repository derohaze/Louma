package transport

import (
	"net"
	"net/http"
	"net/netip"
	"strings"
)

// Walk from the immediate peer to the first untrusted hop. A client-supplied
// leftmost X-Forwarded-For value must never override the address added by our proxy.
func clientIP(r *http.Request, trusted []netip.Prefix) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	peer, err := netip.ParseAddr(host)
	if err != nil {
		return host
	}
	peer = peer.Unmap()
	isTrusted := func(ip netip.Addr) bool {
		for _, prefix := range trusted {
			if prefix.Contains(ip) {
				return true
			}
		}
		return false
	}
	if !isTrusted(peer) {
		return peer.String()
	}
	forwarded := strings.Split(strings.Join(r.Header.Values("X-Forwarded-For"), ","), ",")
	if len(forwarded) > 16 {
		return peer.String()
	}
	current := peer
	for i := len(forwarded) - 1; i >= 0 && isTrusted(current); i-- {
		next, err := netip.ParseAddr(strings.TrimSpace(forwarded[i]))
		if err != nil {
			return peer.String()
		}
		current = next.Unmap()
	}
	return current.String()
}
