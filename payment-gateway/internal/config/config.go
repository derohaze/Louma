package config

import (
	"bytes"
	"context"
	"encoding/hex"
	"errors"
	"net"
	"net/netip"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/derohaze/Louma/payment-gateway/internal/domain"
)

type Config struct {
	Environment, Address, MongoURI, Database, RedisURL, PublicURL, DashboardURL  string
	ServiceKey, Pepper                                                           string
	EncryptionKey                                                                []byte
	Fee                                                                          domain.FeePolicy
	LiveEnabled, CreationPaused, SettlementPaused, BillingPaused, MerchantPaused bool
	RateLimit                                                                    int
	TrustedProxyCIDRs                                                            []netip.Prefix
}

func Load() (Config, error) {
	c := Config{Environment: env("GATEWAY_ENVIRONMENT", "test"), Address: env("GATEWAY_ADDRESS", "127.0.0.1:8090"), MongoURI: os.Getenv("GATEWAY_MONGODB_URI"), Database: os.Getenv("GATEWAY_DATABASE"), RedisURL: os.Getenv("GATEWAY_REDIS_URL"), PublicURL: env("GATEWAY_PUBLIC_URL", "http://localhost:8090"), DashboardURL: env("GATEWAY_DASHBOARD_URL", "http://localhost:3000"), ServiceKey: os.Getenv("GATEWAY_SERVICE_KEY"), Pepper: os.Getenv("GATEWAY_API_KEY_PEPPER"), Fee: domain.FeePolicy{Version: env("GATEWAY_FEE_VERSION", "2026-10-08"), BasisPoints: 100}, LiveEnabled: os.Getenv("GATEWAY_LIVE_ENABLED") == "true", CreationPaused: os.Getenv("GATEWAY_CREATION_PAUSED") == "true", SettlementPaused: os.Getenv("GATEWAY_SETTLEMENT_PAUSED") == "true", BillingPaused: os.Getenv("GATEWAY_BILLING_PAUSED") == "true", MerchantPaused: os.Getenv("GATEWAY_MERCHANT_PAUSED") == "true", RateLimit: 120}
	for _, key := range []string{"GATEWAY_LIVE_ENABLED", "GATEWAY_CREATION_PAUSED", "GATEWAY_SETTLEMENT_PAUSED", "GATEWAY_BILLING_PAUSED", "GATEWAY_MERCHANT_PAUSED"} {
		if value := os.Getenv(key); value != "" && value != "true" && value != "false" {
			return c, errors.New(key + " must be true or false")
		}
	}
	if raw := strings.TrimSpace(os.Getenv("GATEWAY_TRUSTED_PROXY_CIDRS")); raw != "" {
		for _, value := range strings.Split(raw, ",") {
			prefix, err := netip.ParsePrefix(strings.TrimSpace(value))
			if err != nil || prefix.Bits() == 0 {
				return c, errors.New("GATEWAY_TRUSTED_PROXY_CIDRS requires explicit proxy CIDRs, never a universal range")
			}
			c.TrustedProxyCIDRs = append(c.TrustedProxyCIDRs, prefix.Masked())
		}
	}
	if err := configureDNS(); err != nil {
		return c, err
	}
	var err error
	c.EncryptionKey, err = hex.DecodeString(os.Getenv("GATEWAY_ENCRYPTION_KEY"))
	if err != nil || len(c.EncryptionKey) != 32 {
		return c, errors.New("GATEWAY_ENCRYPTION_KEY must be 32 bytes encoded as hex")
	}
	if value := os.Getenv("GATEWAY_FEE_BASIS_POINTS"); value != "" {
		c.Fee.BasisPoints, err = strconv.ParseInt(value, 10, 64)
		if err != nil {
			return c, errors.New("invalid gateway fee")
		}
	}
	if c.MongoURI == "" || c.Database == "" || len(c.ServiceKey) < 32 || len(c.Pepper) < 32 {
		return c, errors.New("MongoDB configuration and separate 32-byte service key/pepper are required")
	}
	if c.ServiceKey == c.Pepper || c.ServiceKey == string(c.EncryptionKey) || c.Pepper == string(c.EncryptionKey) || strings.EqualFold(c.ServiceKey, hex.EncodeToString(c.EncryptionKey)) || strings.EqualFold(c.Pepper, hex.EncodeToString(c.EncryptionKey)) {
		return c, errors.New("keys must be separated by purpose")
	}
	if c.Environment != "test" && c.Environment != "live" {
		return c, errors.New("environment must be test or live")
	}
	if c.Environment == "test" && !strings.HasPrefix(c.Database, "louma_gateway_test") {
		return c, errors.New("test mode requires an isolated louma_gateway_test* database")
	}
	if c.Environment == "live" && !c.LiveEnabled {
		return c, errors.New("live settlement requires explicit enablement after compatibility verification")
	}
	if c.Environment == "live" {
		if strings.HasPrefix(c.Database, "louma_gateway_test") {
			return c, errors.New("live mode cannot use a gateway test database")
		}
		if c.RedisURL == "" {
			return c, errors.New("GATEWAY_REDIS_URL is required for shared live rate limits")
		}
		for _, key := range []string{c.ServiceKey, c.Pepper} {
			if strings.HasPrefix(strings.ToLower(key), "change-me") || strings.HasPrefix(strings.ToLower(key), "replace") {
				return c, errors.New("live mode requires generated secrets, not placeholders")
			}
		}
		if bytes.Equal(c.EncryptionKey, bytes.Repeat(c.EncryptionKey[:1], 32)) {
			return c, errors.New("live mode requires a random encryption key")
		}
	}
	for _, raw := range []string{c.PublicURL, c.DashboardURL} {
		u, e := url.Parse(raw)
		if e != nil || u.Host == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" || (u.Path != "" && u.Path != "/") {
			return c, errors.New("invalid origin URL")
		}
		local := u.Hostname() == "localhost" || u.Hostname() == "127.0.0.1"
		if u.Scheme != "https" && !(c.Environment == "test" && local && u.Scheme == "http") {
			return c, errors.New("HTTPS is required outside localhost sandbox")
		}
	}
	if _, err = c.Fee.Fee(10000); err != nil {
		return c, err
	}
	return c, nil
}

func configureDNS() error {
	raw := strings.TrimSpace(os.Getenv("GATEWAY_DNS_SERVERS"))
	if raw == "" {
		return nil
	}

	servers := strings.Split(raw, ",")
	for i, server := range servers {
		server = strings.TrimSpace(server)
		if net.ParseIP(server) == nil {
			return errors.New("GATEWAY_DNS_SERVERS must contain comma-separated IP addresses")
		}
		servers[i] = net.JoinHostPort(server, "53")
	}

	net.DefaultResolver = &net.Resolver{
		PreferGo: true,
		Dial: func(ctx context.Context, network, _ string) (net.Conn, error) {
			dialer := net.Dialer{Timeout: 2 * time.Second}
			var lastErr error
			for _, server := range servers {
				conn, err := dialer.DialContext(ctx, network, server)
				if err == nil {
					return conn, nil
				}
				lastErr = err
			}
			return nil, lastErr
		},
	}
	return nil
}

func env(key, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return fallback
}
