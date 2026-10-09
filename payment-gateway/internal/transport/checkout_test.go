package transport

import (
	"strings"
	"testing"
)

// The hosted page is the payer's trust surface: it must render the exact
// amount/merchant, escape merchant-controlled text, and never emit scripts.
func TestHostedCheckoutRendersAndEscapes(t *testing.T) {
	var out strings.Builder
	data := map[string]any{
		"Mode": "test", "Sandbox": true, "Merchant": `<img src=x onerror=alert(1)>Shop`,
		"Description": "<b>deal</b>", "Total": "100.0000", "Subtotal": "100.0000",
		"Tax": "0.0000", "Recurring": "monthly", "StatusLabel": "Awaiting your approval",
		"InactiveNote": "", "Reference": "pay_123", "ExpiresAt": "2026-10-09 10:00 UTC",
		"Payable": true, "Continue": "http://localhost:3000/checkout?session=pay_123&mode=test",
	}
	if err := checkoutTemplate.Execute(&out, data); err != nil {
		t.Fatal(err)
	}
	page := out.String()
	for _, want := range []string{"Payment to", "100.0000 LMA", "TEST MODE", "pay_123", "Continue with Louma", "Recurring billing"} {
		if !strings.Contains(page, want) {
			t.Fatalf("missing %q", want)
		}
	}
	if strings.Contains(page, "<img src=x") || strings.Contains(page, "<b>deal</b>") || !strings.Contains(page, "&lt;img") {
		t.Fatal("merchant-controlled markup must be escaped")
	}
	if strings.Contains(strings.ToLower(page), "<script") {
		t.Fatal("hosted checkout must not emit scripts")
	}
}
