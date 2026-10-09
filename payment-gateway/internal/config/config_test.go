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
		{name: "confirmed Atlas sandbox", database: "louma"},
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
