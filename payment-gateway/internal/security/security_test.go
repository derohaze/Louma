package security

import (
	"net/netip"
	"testing"
	"time"
)

func TestVerifySignature(t *testing.T) {
	t.Parallel()
	now := time.Unix(1000000, 0)
	body := []byte(`{"id":"event"}`)
	sig := Signature("secret", body, now)
	if !VerifySignature("secret", body, sig, now) || VerifySignature("forged", body, sig, now) || VerifySignature("secret", body, sig, now.Add(301*time.Second)) {
		t.Fatal("signature or replay validation")
	}
}
func TestPublicIP(t *testing.T) {
	t.Parallel()
	for _, tc := range []struct {
		name, ip string
		public   bool
	}{{"loopback", "127.0.0.1", false}, {"metadata", "169.254.169.254", false}, {"mapped", "::ffff:127.0.0.1", false}, {"private v6", "fd00::1", false}, {"NAT translation", "64:ff9b::a00:1", false}, {"shared", "100.64.0.1", false}, {"public", "8.8.8.8", true}} {
		t.Run(tc.name, func(t *testing.T) {
			if PublicIP(netip.MustParseAddr(tc.ip)) != tc.public {
				t.Fatal(tc.ip)
			}
		})
	}
}
func TestEncryption(t *testing.T) {
	t.Parallel()
	key := make([]byte, 32)
	encrypted, err := Encrypt(key, "test-secret")
	if err != nil {
		t.Fatal(err)
	}
	got, err := Decrypt(key, encrypted)
	if err != nil || got != "test-secret" {
		t.Fatal(err)
	}
	key[0] = 1
	if _, err = Decrypt(key, encrypted); err == nil {
		t.Fatal("wrong key accepted")
	}
}
