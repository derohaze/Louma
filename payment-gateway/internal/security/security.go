package security

import (
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/netip"
	"net/url"
	"strconv"
	"strings"
	"time"
)

func Hash(value string) string {
	sum := sha256.Sum256([]byte(value))
	return hex.EncodeToString(sum[:])
}
func MAC(key, value string) string {
	h := hmac.New(sha256.New, []byte(key))
	h.Write([]byte(value))
	return hex.EncodeToString(h.Sum(nil))
}
func Secret() string {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		panic(err)
	}
	return base64.RawURLEncoding.EncodeToString(b)
}
func Encrypt(key []byte, plaintext string) (string, error) {
	block, err := aes.NewCipher(key)
	if err != nil {
		return "", err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}
	nonce := make([]byte, gcm.NonceSize())
	if _, err = rand.Read(nonce); err != nil {
		return "", err
	}
	return base64.RawStdEncoding.EncodeToString(gcm.Seal(nonce, nonce, []byte(plaintext), []byte("louma-webhook-v1"))), nil
}
func Decrypt(key []byte, value string) (string, error) {
	b, err := base64.RawStdEncoding.DecodeString(value)
	if err != nil {
		return "", err
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return "", err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}
	if len(b) < gcm.NonceSize() {
		return "", errors.New("invalid ciphertext")
	}
	plain, err := gcm.Open(nil, b[:gcm.NonceSize()], b[gcm.NonceSize():], []byte("louma-webhook-v1"))
	return string(plain), err
}
func Signature(secret string, body []byte, now time.Time) string {
	ts := strconv.FormatInt(now.Unix(), 10)
	return "t=" + ts + ",v1=" + MAC(secret, ts+"."+string(body))
}
func VerifySignature(secret string, body []byte, signature string, now time.Time) bool {
	parts := strings.Split(signature, ",")
	if len(parts) != 2 || !strings.HasPrefix(parts[0], "t=") || !strings.HasPrefix(parts[1], "v1=") {
		return false
	}
	ts, err := strconv.ParseInt(parts[0][2:], 10, 64)
	if err != nil || ts < now.Unix()-300 || ts > now.Unix()+30 {
		return false
	}
	expected := MAC(secret, parts[0][2:]+"."+string(body))
	return hmac.Equal([]byte(expected), []byte(parts[1][3:]))
}
func InternalSignature(key, ts, nonce, method, uri, owner string, body []byte) string {
	return MAC(key, strings.Join([]string{ts, nonce, method, uri, owner, Hash(string(body))}, "\n"))
}
func ReturnURL(raw string, domains []string, test bool) error {
	if raw == "" {
		return nil
	}
	u, err := url.Parse(raw)
	if err != nil || u.Host == "" || u.User != nil || len(raw) > 2048 {
		return errors.New("invalid_return_url")
	}
	local := u.Hostname() == "localhost" || u.Hostname() == "127.0.0.1"
	if u.Scheme != "https" && !(test && local && u.Scheme == "http") {
		return errors.New("invalid_return_url")
	}
	for _, allowed := range domains {
		if u.Host == allowed {
			return nil
		}
	}
	return errors.New("invalid_return_url")
}
func WebhookURL(raw string) error {
	u, err := url.Parse(raw)
	if err != nil || u.Scheme != "https" || u.Host == "" || u.User != nil || u.Fragment != "" || len(raw) > 2048 {
		return errors.New("invalid_webhook_url")
	}
	if p := u.Port(); p != "" && p != "443" {
		return errors.New("invalid_webhook_port")
	}
	if ip, err := netip.ParseAddr(u.Hostname()); err == nil && !PublicIP(ip) {
		return errors.New("restricted_webhook_destination")
	}
	return nil
}

var blocked = []netip.Prefix{
	netip.MustParsePrefix("0.0.0.0/8"), netip.MustParsePrefix("100.64.0.0/10"), netip.MustParsePrefix("192.0.0.0/24"), netip.MustParsePrefix("192.0.2.0/24"), netip.MustParsePrefix("198.18.0.0/15"), netip.MustParsePrefix("198.51.100.0/24"), netip.MustParsePrefix("203.0.113.0/24"), netip.MustParsePrefix("240.0.0.0/4"), netip.MustParsePrefix("2001:db8::/32"), netip.MustParsePrefix("64:ff9b::/96"),
}

func PublicIP(ip netip.Addr) bool {
	ip = ip.Unmap()
	if !ip.IsGlobalUnicast() || ip.IsPrivate() || ip.IsLoopback() || ip.IsLinkLocalUnicast() {
		return false
	}
	for _, prefix := range blocked {
		if prefix.Contains(ip) {
			return false
		}
	}
	return true
}

// The dialer resolves once, rejects every restricted answer, then connects to the checked IP.
// TLS still validates the original host; no redirects, proxies or DNS re-resolution are used.
func WebhookClient() *http.Client {
	transport := &http.Transport{Proxy: nil, TLSHandshakeTimeout: 3 * time.Second, ResponseHeaderTimeout: 5 * time.Second, MaxIdleConns: 16, MaxConnsPerHost: 2, IdleConnTimeout: 30 * time.Second, DialContext: func(ctx context.Context, network, address string) (net.Conn, error) {
		host, port, err := net.SplitHostPort(address)
		if err != nil {
			return nil, err
		}
		ips, err := net.DefaultResolver.LookupNetIP(ctx, "ip", host)
		if err != nil || len(ips) == 0 || len(ips) > 16 {
			return nil, errors.New("webhook_dns_failed")
		}
		for _, ip := range ips {
			if !PublicIP(ip) {
				return nil, errors.New("restricted_webhook_destination")
			}
		}
		dialer := net.Dialer{Timeout: 3 * time.Second}
		return dialer.DialContext(ctx, network, net.JoinHostPort(ips[0].String(), port))
	}}
	return &http.Client{Transport: transport, Timeout: 8 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return fmt.Errorf("webhook_redirect_blocked") }}
}
