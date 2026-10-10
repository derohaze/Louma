package transport

import (
	"io"
	"log/slog"
	"net/http/httptest"
	"net/netip"
	"strings"
	"testing"

	"github.com/derohaze/Louma/payment-gateway/internal/config"
	"github.com/derohaze/Louma/payment-gateway/internal/gateway"
	"github.com/derohaze/Louma/payment-gateway/internal/infrastructure/mongodb"
	redisinfra "github.com/derohaze/Louma/payment-gateway/internal/infrastructure/redis"
)

func TestClientIPTrustBoundary(t *testing.T) {
	trusted := []netip.Prefix{netip.MustParsePrefix("172.20.0.0/24"), netip.MustParsePrefix("fd00::/64")}
	for _, tt := range []struct{ name, remote, forwarded, want string }{
		{"direct spoof", "198.51.100.1:1234", "203.0.113.9", "198.51.100.1"},
		{"proxy", "172.20.0.2:1234", "198.51.100.1", "198.51.100.1"},
		{"spoofed leftmost", "172.20.0.2:1234", "203.0.113.9, 198.51.100.1", "198.51.100.1"},
		{"multiple trusted hops", "172.20.0.2:1234", "198.51.100.1, 172.20.0.3", "198.51.100.1"},
		{"IPv6", "[fd00::2]:1234", "2001:db8::1", "2001:db8::1"},
		{"mapped IPv4", "[::ffff:172.20.0.2]:1234", "::ffff:198.51.100.1", "198.51.100.1"},
		{"malformed", "172.20.0.2:1234", "unknown", "172.20.0.2"},
		{"missing", "172.20.0.2:1234", "", "172.20.0.2"},
		{"bounded chain", "172.20.0.2:1234", strings.Repeat("172.20.0.3,", 17) + "198.51.100.1", "172.20.0.2"},
	} {
		t.Run(tt.name, func(t *testing.T) {
			r := httptest.NewRequest("GET", "/", nil)
			r.RemoteAddr = tt.remote
			r.Header.Set("X-Forwarded-For", tt.forwarded)
			if got := clientIP(r, trusted); got != tt.want {
				t.Fatalf("got %s, want %s", got, tt.want)
			}
		})
	}
}

func TestProxyRateLimitsSeparateClientsAndIgnoreSpoofing(t *testing.T) {
	for _, trusted := range []bool{false, true} {
		cfg := config.Config{}
		if trusted {
			cfg.TrustedProxyCIDRs = []netip.Prefix{netip.MustParsePrefix("172.20.0.0/24")}
		}
		rate, err := redisinfra.New("", "test")
		if err != nil {
			t.Fatal(err)
		}
		server := New(&gateway.Service{Store: &mongodb.Store{Config: cfg}}, rate, slog.New(slog.NewTextHandler(io.Discard, nil)))
		request := func(ip string) int {
			r := httptest.NewRequest("GET", "/not-found", nil)
			r.RemoteAddr = "172.20.0.2:1234"
			r.Header.Set("X-Forwarded-For", ip)
			w := httptest.NewRecorder()
			server.Handler().ServeHTTP(w, r)
			return w.Code
		}
		for i := 0; i < 300; i++ {
			if got := request("198.51.100.1"); got != 404 {
				t.Fatalf("request %d: %d", i, got)
			}
		}
		if got := request("198.51.100.1"); got != 429 {
			t.Fatalf("exhausted client should be limited, got %d", got)
		}
		want := 429
		if trusted {
			want = 404
		}
		if got := request("198.51.100.2"); got != want {
			t.Fatalf("trusted=%v second client got %d, want %d", trusted, got, want)
		}
	}
}
