package config

import (
	"strings"
	"testing"
)

func TestLoadTestEnvironmentDatabase(t *testing.T) {
	tests := []struct {
		name     string
		database string
		wantErr  bool
	}{
		{name: "production database is no longer a sandbox", database: "louma", wantErr: true},
		{name: "isolated gateway sandbox", database: "louma_gateway_test_local"},
		{name: "unapproved database", database: "other", wantErr: true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Setenv("GATEWAY_ENVIRONMENT", "test")
			t.Setenv("GATEWAY_ADDRESS", "127.0.0.1:8090")
			t.Setenv("GATEWAY_PUBLIC_URL", "http://localhost:8090")
			t.Setenv("GATEWAY_DASHBOARD_URL", "http://localhost:3000")
			t.Setenv("GATEWAY_MONGODB_URI", "mongodb://localhost")
			t.Setenv("GATEWAY_DATABASE", tt.database)
			t.Setenv("GATEWAY_LIVE_ENABLED", "false")
			t.Setenv("GATEWAY_SERVICE_KEY", strings.Repeat("s", 32))
			t.Setenv("GATEWAY_API_KEY_PEPPER", strings.Repeat("p", 32))
			t.Setenv("GATEWAY_ENCRYPTION_KEY", strings.Repeat("61", 32))
			t.Setenv("GATEWAY_FEE_BASIS_POINTS", "")
			t.Setenv("GATEWAY_DNS_SERVERS", "")

			_, err := Load()
			if (err != nil) != tt.wantErr {
				t.Fatalf("Load() error = %v, wantErr %v", err, tt.wantErr)
			}
		})
	}
}

func TestLiveDeploymentConfiguration(t *testing.T) {
	tests := []struct {
		name, key, value string
		wantErr          bool
	}{
		{name: "valid production"},
		{name: "live requires opt in", key: "GATEWAY_LIVE_ENABLED", value: "false", wantErr: true},
		{name: "live cannot use sandbox database", key: "GATEWAY_DATABASE", value: "louma_gateway_test_dev", wantErr: true},
		{name: "shared rate limiting required", key: "GATEWAY_REDIS_URL", value: "", wantErr: true},
		{name: "placeholder service key", key: "GATEWAY_SERVICE_KEY", value: "change-me-service-key-min-32-chars-0000", wantErr: true},
		{name: "placeholder encryption", key: "GATEWAY_ENCRYPTION_KEY", value: strings.Repeat("0", 64), wantErr: true},
		{name: "pepper cannot equal encryption hex", key: "GATEWAY_API_KEY_PEPPER", value: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef", wantErr: true},
		{name: "origin cannot contain path", key: "GATEWAY_PUBLIC_URL", value: "https://checkout.loumapay.com/path", wantErr: true},
		{name: "origin requires TLS", key: "GATEWAY_PUBLIC_URL", value: "http://checkout.loumapay.com", wantErr: true},
		{name: "invalid kill switch", key: "GATEWAY_SETTLEMENT_PAUSED", value: "treu", wantErr: true},
		{name: "invalid trusted proxy", key: "GATEWAY_TRUSTED_PROXY_CIDRS", value: "trust-everyone", wantErr: true},
		{name: "universal trusted proxy", key: "GATEWAY_TRUSTED_PROXY_CIDRS", value: "0.0.0.0/0", wantErr: true},
		{name: "explicit proxy subnet", key: "GATEWAY_TRUSTED_PROXY_CIDRS", value: "172.20.0.0/24,fd00::/64"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			for key, value := range map[string]string{
				"GATEWAY_ENVIRONMENT": "live", "GATEWAY_ADDRESS": "0.0.0.0:8090",
				"GATEWAY_MONGODB_URI": "mongodb://localhost", "GATEWAY_DATABASE": "louma_live",
				"GATEWAY_REDIS_URL": "redis://localhost:6379", "GATEWAY_LIVE_ENABLED": "true",
				"GATEWAY_PUBLIC_URL": "https://checkout.loumapay.com", "GATEWAY_DASHBOARD_URL": "https://app.loumapay.com",
				"GATEWAY_SERVICE_KEY":      "live-service-test-fixture-0123456789abcdef",
				"GATEWAY_API_KEY_PEPPER":   "live-pepper-test-fixture-0123456789abcdef",
				"GATEWAY_ENCRYPTION_KEY":   "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
				"GATEWAY_FEE_BASIS_POINTS": "100", "GATEWAY_DNS_SERVERS": "", "GATEWAY_TRUSTED_PROXY_CIDRS": "",
				"GATEWAY_CREATION_PAUSED": "false", "GATEWAY_SETTLEMENT_PAUSED": "false",
				"GATEWAY_BILLING_PAUSED": "false", "GATEWAY_MERCHANT_PAUSED": "false",
			} {
				t.Setenv(key, value)
			}
			if tt.key != "" {
				t.Setenv(tt.key, tt.value)
			}
			_, err := Load()
			if (err != nil) != tt.wantErr {
				t.Fatalf("Load() error = %v, wantErr %v", err, tt.wantErr)
			}
		})
	}
}
