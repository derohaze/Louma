package gateway

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"slices"
	"time"

	"github.com/derohaze/Louma/payment-gateway/internal/domain"
	"github.com/derohaze/Louma/payment-gateway/internal/infrastructure/mongodb"
	"github.com/derohaze/Louma/payment-gateway/internal/security"
)

func Decode[T any](raw []byte) (T, error) {
	var out T
	d := json.NewDecoder(bytes.NewReader(raw))
	d.DisallowUnknownFields()
	if err := d.Decode(&out); err != nil {
		return out, domain.Reject("invalid_json", 400)
	}
	var trailing any
	if err := d.Decode(&trailing); err != io.EOF {
		return out, domain.Reject("invalid_json", 400)
	}
	return out, nil
}

var Scopes = []string{"checkout:create", "payments:read", "refunds:create", "subscriptions:manage", "products:manage", "webhooks:manage", "credentials:manage"}
var Events = []string{"payment.succeeded", "payment.failed", "payment.refunded", "checkout.session.completed", "invoice.paid", "invoice.payment_failed", "subscription.created", "subscription.renewed", "subscription.past_due", "subscription.canceled", "subscription.cancellation_scheduled"}

func (s *Service) resourceView(kind string, value any) any {
	if view, ok := value.(map[string]any); ok && kind == "checkouts" {
		if id, ok := view["id"].(string); ok {
			view["checkout_url"] = s.Store.Config.PublicURL + "/checkout/" + id
		}
	}
	if link, ok := value.(*domain.Link); ok {
		return map[string]any{"id": link.ID, "application_id": link.AppID, "status": link.Status, "input": link.Input, "created_at": link.CreatedAt, "url": s.Store.Config.PublicURL + "/pay/" + link.ID}
	}
	return value
}

func (s *Service) CreateApplication(ctx context.Context, owner string, raw []byte) (any, error) {
	input, err := Decode[struct {
		Name              string   `json:"name"`
		WalletID          string   `json:"wallet_id"`
		ReceivingWalletID string   `json:"receiving_wallet_id"`
		Domains           []string `json:"domains"`
		Key               string   `json:"idempotency_key"`
	}](raw)
	if err != nil {
		return nil, err
	}
	if input.WalletID == "" {
		input.WalletID = input.ReceivingWalletID
	}
	if input.Name == "" || len(input.Name) > 120 || !UUID.MatchString(input.WalletID) {
		return nil, domain.Reject("invalid_application", 400)
	}
	if input.Domains == nil {
		input.Domains = []string{}
	}
	if err = ValidateDomains(input.Domains, s.Store.Config.Environment == "test"); err != nil {
		return nil, err
	}
	if !Key.MatchString(input.Key) {
		return nil, domain.Reject("idempotency_key_required", 400)
	}
	return s.Store.CreateApplication(ctx, domain.Application{Owner: owner, Name: input.Name, WalletID: input.WalletID, Domains: input.Domains, Key: input.Key, Fingerprint: Fingerprint(struct {
		Name, Wallet string
		Domains      []string
	}{input.Name, input.WalletID, input.Domains})})
}
func (s *Service) Resource(ctx context.Context, p mongodb.Principal, kind, id, action, method, key, cursor string, raw []byte) (any, error) {
	if mongodb.Collection(kind) == "" {
		return nil, domain.Reject("not_found", 404)
	}
	if method == "GET" {
		if action != "" {
			return nil, domain.Reject("method_not_allowed", 405)
		}
		if id != "" {
			value, err := s.Store.Resource(ctx, p.App.ID, kind, id)
			return s.resourceView(kind, value), err
		}
		rows, next, err := s.Store.List(ctx, mongodb.Collection(kind), p.App.ID, cursor)
		if err != nil {
			return nil, err
		}
		views := []any{}
		for _, row := range rows {
			view, e := mongodb.PublicResource(kind, row)
			if e != nil {
				return nil, e
			}
			views = append(views, s.resourceView(kind, view))
		}
		return map[string]any{"data": views, "next_cursor": next}, nil
	}
	if s.Store.Config.MerchantPaused {
		return nil, domain.Reject("merchant_access_paused", 503)
	}
	if id != "" {
		if kind == "deliveries" && action == "retry" && method == "POST" {
			if err := s.Store.RetryDelivery(ctx, p.App.ID, id); err != nil {
				return nil, err
			}
			value, resourceErr := s.Store.Resource(ctx, p.App.ID, kind, id)
			return s.resourceView(kind, value), resourceErr
		}
		if kind == "webhooks" && action == "rotate" && method == "POST" {
			secret := security.Secret()
			encrypted, err := security.Encrypt(s.Store.Config.EncryptionKey, secret)
			if err != nil {
				return nil, err
			}
			if err = s.Store.ChangeResource(ctx, p.App.ID, kind, id, map[string]any{"encryptedSecret": encrypted}); err != nil {
				return nil, err
			}
			return map[string]any{"id": id, "signing_secret": secret}, nil
		}
		if kind == "credentials" && action == "rotate" && method == "POST" {
			return s.Store.RotateCredential(ctx, p, id)
		}
		if (kind == "links" || kind == "webhooks") && action == "disable" && method == "POST" {
			if err := s.Store.ChangeResource(ctx, p.App.ID, kind, id, map[string]any{"status": "disabled"}); err != nil {
				return nil, err
			}
			value, resourceErr := s.Store.Resource(ctx, p.App.ID, kind, id)
			return s.resourceView(kind, value), resourceErr
		}
		if kind == "subscriptions" && action == "cancel" && method == "POST" {
			input, err := Decode[struct {
				AtEnd bool `json:"at_period_end"`
			}](raw)
			if err != nil {
				return nil, err
			}
			if err = s.Store.CancelSubscription(ctx, p.App.ID, "", id, input.AtEnd); err != nil {
				return nil, err
			}
			value, resourceErr := s.Store.Resource(ctx, p.App.ID, kind, id)
			return s.resourceView(kind, value), resourceErr
		}
		if kind == "credentials" && action == "revoke" && method == "POST" {
			if err := s.Store.ChangeResource(ctx, p.App.ID, kind, id, map[string]any{"status": "revoked"}); err != nil {
				return nil, err
			}
			value, resourceErr := s.Store.Resource(ctx, p.App.ID, kind, id)
			return s.resourceView(kind, value), resourceErr
		}
		if kind == "checkouts" && action == "expire" && method == "POST" {
			if err := s.Store.ExpireCheckout(ctx, p.App.ID, id); err != nil {
				return nil, err
			}
			value, resourceErr := s.Store.Resource(ctx, p.App.ID, kind, id)
			return s.resourceView(kind, value), resourceErr
		}
		if method == "PATCH" && (kind == "links" || kind == "products" || kind == "webhooks") {
			input, err := Decode[struct {
				Status string `json:"status"`
			}](raw)
			if err != nil {
				return nil, err
			}
			allowed := input.Status == "disabled" && (kind == "links" || kind == "webhooks") || input.Status == "archived" && kind == "products"
			if !allowed {
				return nil, domain.Reject("invalid_transition", 400)
			}
			if err = s.Store.ChangeResource(ctx, p.App.ID, kind, id, map[string]any{"status": input.Status}); err != nil {
				return nil, err
			}
			value, resourceErr := s.Store.Resource(ctx, p.App.ID, kind, id)
			return s.resourceView(kind, value), resourceErr
		}
		return nil, domain.Reject("not_found", 404)
	}
	if method != "POST" {
		return nil, domain.Reject("method_not_allowed", 405)
	}
	now := time.Now().UTC()
	resourceID := mongodb.ID()
	switch kind {
	case "checkouts", "subscriptions":
		input, err := Decode[domain.CheckoutInput](raw)
		if err != nil {
			return nil, err
		}
		if kind == "subscriptions" && input.PriceID == "" {
			return nil, domain.Reject("price_required", 400)
		}
		if kind == "subscriptions" {
			price, err := s.Store.Price(ctx, p.App.ID, input.PriceID)
			if err != nil {
				return nil, err
			}
			if price.Interval == "" {
				return nil, domain.Reject("recurring_price_required", 400)
			}
		}
		payment, err := s.Checkout(ctx, p, input, key)
		if err != nil {
			return nil, err
		}
		view := payment.View()
		view["checkout_url"] = s.Store.Config.PublicURL + "/checkout/" + payment.ID
		return view, nil
	case "credentials":
		input, err := Decode[struct {
			Scopes  []string   `json:"scopes"`
			Expires *time.Time `json:"expires_at"`
		}](raw)
		if err != nil {
			return nil, err
		}
		if len(input.Scopes) < 1 || len(input.Scopes) > 8 || input.Expires != nil && !input.Expires.After(now) {
			return nil, domain.Reject("invalid_credential", 400)
		}
		for _, scope := range input.Scopes {
			if !slices.Contains(Scopes, scope) {
				return nil, domain.Reject("invalid_scope", 400)
			}
		}
		credential, secret, err := s.Store.CreateCredential(ctx, p, input.Scopes, input.Expires)
		return map[string]any{"credential": credential, "id": credential.ID, "api_key": secret}, err
	case "products":
		input, err := Decode[struct {
			Name        string `json:"name"`
			Description string `json:"description"`
		}](raw)
		if err != nil {
			return nil, err
		}
		if input.Name == "" || len(input.Name) > 120 || len(input.Description) > 240 {
			return nil, domain.Reject("invalid_product", 400)
		}
		product := domain.Product{ID: resourceID, AppID: p.App.ID, Name: input.Name, Description: input.Description, Status: "active", CreatedAt: now}
		return product, s.Store.InsertResource(ctx, kind, product)
	case "prices":
		input, err := Decode[struct {
			ProductID string `json:"product_id"`
			Amount    string `json:"amount"`
			Currency  string `json:"currency"`
			Interval  string `json:"interval"`
		}](raw)
		if err != nil {
			return nil, err
		}
		amount, err := domain.ParseMoney(input.Amount)
		if err != nil || amount < 1 || input.Currency != "LMA" {
			return nil, domain.Reject("invalid_price", 400)
		}
		if _, err = s.Store.Resource(ctx, p.App.ID, "products", input.ProductID); err != nil {
			return nil, err
		}
		interval := ""
		switch input.Interval {
		case "", "one_time":
		case "month", "monthly":
			interval = "month"
		case "year", "yearly":
			interval = "year"
		default:
			return nil, domain.Reject("invalid_interval", 400)
		}
		price := domain.Price{ID: resourceID, AppID: p.App.ID, ProductID: input.ProductID, Amount: amount, Interval: interval, Version: 1, Status: "active", CreatedAt: now}
		return price, s.Store.InsertResource(ctx, kind, price)
	case "refunds":
		input, err := Decode[struct {
			PaymentID string `json:"payment_id"`
			Amount    string `json:"amount"`
			Reason    string `json:"reason"`
		}](raw)
		if err != nil {
			return nil, err
		}
		if len(input.Reason) > 240 {
			return nil, domain.Reject("invalid_refund", 400)
		}
		if !Key.MatchString(key) {
			return nil, domain.Reject("invalid_refund", 400)
		}
		return s.Store.RefundRequest(ctx, p, input.PaymentID, input.Amount, key, input.Reason)
	case "links":
		input, err := Decode[domain.CheckoutInput](raw)
		if err != nil {
			return nil, err
		}
		if input.Metadata == nil {
			input.Metadata = map[string]string{}
		}
		_, err = s.prepareCheckout(ctx, p, input, "link-validation:"+resourceID)
		if err != nil {
			return nil, err
		}
		link := domain.Link{ID: resourceID, AppID: p.App.ID, Input: input, Status: "active", CreatedAt: now}
		return s.resourceView(kind, &link), s.Store.InsertResource(ctx, kind, link)
	case "webhooks":
		input, err := Decode[struct {
			URL    string   `json:"url"`
			Events []string `json:"events"`
		}](raw)
		if err != nil {
			return nil, err
		}
		if err = security.WebhookURL(input.URL); err != nil {
			return nil, domain.Reject("invalid_webhook_url", 400)
		}
		if len(input.Events) < 1 || len(input.Events) > 16 {
			return nil, domain.Reject("invalid_events", 400)
		}
		for _, kind := range input.Events {
			if !slices.Contains(Events, kind) {
				return nil, domain.Reject("invalid_events", 400)
			}
		}
		secret := security.Secret()
		encrypted, err := security.Encrypt(s.Store.Config.EncryptionKey, secret)
		if err != nil {
			return nil, err
		}
		endpoint := domain.Endpoint{ID: resourceID, AppID: p.App.ID, URL: input.URL, Events: input.Events, Secret: encrypted, Status: "active", CreatedAt: now}
		return map[string]any{"endpoint": endpoint, "id": resourceID, "signing_secret": secret}, s.Store.CreateEndpoint(ctx, p, endpoint)
	}
	return nil, domain.Reject("not_found", 404)
}
