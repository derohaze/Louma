package gateway

import (
	"context"
	"encoding/json"
	"net/url"
	"regexp"
	"strings"
	"time"

	"github.com/derohaze/Louma/payment-gateway/internal/domain"
	"github.com/derohaze/Louma/payment-gateway/internal/infrastructure/mongodb"
	"github.com/derohaze/Louma/payment-gateway/internal/security"
)

type Service struct{ Store *mongodb.Store }

var UUID = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`)
var Key = regexp.MustCompile(`^[A-Za-z0-9:_-]{1,128}$`)

func Fingerprint(value any) string {
	b, err := json.Marshal(value)
	if err != nil {
		panic(err)
	}
	return security.Hash(string(b))
}
func (s *Service) Checkout(ctx context.Context, p mongodb.Principal, input domain.CheckoutInput, key string) (domain.Payment, error) {
	payment, err := s.prepareCheckout(ctx, p, input, key)
	if err != nil {
		return payment, err
	}
	return s.Store.SaveCheckout(ctx, p, payment)
}
func (s *Service) prepareCheckout(ctx context.Context, p mongodb.Principal, input domain.CheckoutInput, key string) (domain.Payment, error) {
	var payment domain.Payment
	if s.Store.Config.CreationPaused || s.Store.Config.MerchantPaused {
		return payment, domain.Reject("payment_creation_paused", 503)
	}
	if !Key.MatchString(key) || input.Currency != "LMA" || len(input.Description) > 240 || len(input.Metadata) > 16 {
		return payment, domain.Reject("invalid_checkout", 400)
	}
	if input.Metadata == nil {
		input.Metadata = map[string]string{}
	}
	for k, v := range input.Metadata {
		if len(k) > 40 || len(v) > 240 {
			return payment, domain.Reject("invalid_metadata", 400)
		}
	}
	if input.Tax == "" {
		input.Tax = "0"
	}
	var price domain.Price
	var err error
	if input.PriceID != "" {
		price, err = s.Store.Price(ctx, p.App.ID, input.PriceID)
		if err != nil {
			return payment, err
		}
		input.Subtotal = domain.FormatMoney(price.Amount)
	}
	subtotal, err := domain.ParseMoney(input.Subtotal)
	if err != nil {
		return payment, err
	}
	tax, err := domain.ParseMoney(input.Tax)
	if err != nil {
		return payment, err
	}
	if subtotal < 1 || tax > domain.MaxAmount-subtotal {
		return payment, domain.Reject("invalid_amount", 400)
	}
	fee, err := s.Store.Config.Fee.Fee(subtotal + tax)
	if err != nil {
		return payment, err
	}
	if price.Interval != "" && tax != 0 {
		return payment, domain.Reject("recurring_tax_requires_fixed_price", 400)
	}
	for _, raw := range []string{input.SuccessURL, input.CancelURL} {
		if err = security.ReturnURL(raw, p.App.Domains, s.Store.Config.Environment == "test"); err != nil {
			return payment, domain.Reject("invalid_return_url", 400)
		}
	}
	now := time.Now().UTC()
	payment = domain.Payment{ID: mongodb.ID(), AppID: p.App.ID, CredentialID: p.Credential.ID, WalletID: p.App.WalletID, MerchantName: p.App.Name, Subtotal: subtotal, Tax: tax, Total: subtotal + tax, Fee: fee, Net: subtotal + tax - fee, FeePolicy: s.Store.Config.Fee, Description: input.Description, Status: "requires_action", Key: key, Fingerprint: Fingerprint(input), PriceID: input.PriceID, Interval: price.Interval, SuccessURL: input.SuccessURL, CancelURL: input.CancelURL, Metadata: input.Metadata, CreatedAt: now, ExpiresAt: now.Add(30 * time.Minute)}
	payment.IntentHash = Fingerprint(struct {
		ID, App, Wallet, Price, Interval string
		Subtotal, Tax, Fee               int64
		Policy                           domain.FeePolicy
	}{payment.ID, payment.AppID, payment.WalletID, payment.PriceID, payment.Interval, payment.Subtotal, payment.Tax, payment.Fee, payment.FeePolicy})
	return payment, nil
}
func ValidateDomains(domains []string, test bool) error {
	if len(domains) > 16 {
		return domain.Reject("invalid_domains", 400)
	}
	for _, host := range domains {
		u, err := url.Parse("https://" + host)
		if err != nil || u.Host != host || u.Path != "" || u.User != nil || u.RawQuery != "" || strings.ContainsAny(host, " \r\n") || len(host) > 240 {
			return domain.Reject("invalid_domains", 400)
		}
		if !test && (u.Hostname() == "localhost" || u.Hostname() == "127.0.0.1") {
			return domain.Reject("invalid_domains", 400)
		}
	}
	return nil
}
