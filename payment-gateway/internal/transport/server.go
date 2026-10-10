package transport

import (
	"context"
	"crypto/hmac"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"strconv"
	"strings"
	"sync/atomic"
	"time"

	"github.com/derohaze/Louma/payment-gateway/internal/domain"
	"github.com/derohaze/Louma/payment-gateway/internal/gateway"
	"github.com/derohaze/Louma/payment-gateway/internal/infrastructure/mongodb"
	redisinfra "github.com/derohaze/Louma/payment-gateway/internal/infrastructure/redis"
	"github.com/derohaze/Louma/payment-gateway/internal/security"
	gatewayweb "github.com/derohaze/Louma/payment-gateway/web"
)

type Server struct {
	Service          *gateway.Service
	Rate             *redisinfra.Limiter
	Logger           *slog.Logger
	Requests, Errors atomic.Int64
	inflight         chan struct{}
}

func New(service *gateway.Service, rate *redisinfra.Limiter, logger *slog.Logger) *Server {
	return &Server{Service: service, Rate: rate, Logger: logger, inflight: make(chan struct{}, 128)}
}
func (s *Server) Handler() http.Handler { return http.HandlerFunc(s.serve) }
func (s *Server) serve(w http.ResponseWriter, r *http.Request) {
	id := mongodb.ID()
	w.Header().Set("X-Request-Id", id)
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Referrer-Policy", "no-referrer")
	w.Header().Set("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; img-src 'self'; frame-ancestors 'none'; form-action 'self'")
	w.Header().Set("Strict-Transport-Security", "max-age=31536000")
	ctx, cancel := context.WithTimeout(r.Context(), 12*time.Second)
	defer cancel()
	r = r.WithContext(ctx)
	select {
	case s.inflight <- struct{}{}:
		defer func() { <-s.inflight }()
	default:
		s.fail(w, id, domain.Reject("server_busy", 503))
		return
	}
	s.Requests.Add(1)
	started := time.Now()
	var err error
	usageApp := ""
	defer func() {
		if err != nil {
			s.Errors.Add(1)
			s.fail(w, id, err)
		}
		if usageApp != "" {
			usageCtx, done := context.WithTimeout(ctx, 200*time.Millisecond)
			s.Service.Store.RecordUsage(usageCtx, usageApp, err != nil)
			done()
		}
		s.Logger.Info("http_request", "request_id", id, "method", r.Method, "route_group", routeGroup(r.URL.Path), "failed", err != nil, "duration_ms", time.Since(started).Milliseconds())
	}()
	if r.URL.Path == "/healthz" {
		s.json(w, map[string]string{"status": "ok"})
		return
	}
	if r.URL.Path == "/assets/louma-logo.png" && r.Method == "GET" {
		w.Header().Set("Content-Type", "image/png")
		_, err = w.Write(gatewayweb.Logo)
		return
	}
	if r.URL.Path == "/readyz" {
		if err = s.Service.Store.Compatible(ctx); err != nil {
			err = domain.Reject("gateway_not_ready", 503)
			return
		}
		if !s.Rate.Ready(ctx) {
			err = domain.Reject("redis_unavailable", 503)
			return
		}
		s.json(w, map[string]string{"status": "ready"})
		return
	}
	ip := clientIP(r, s.Service.Store.Config.TrustedProxyCIDRs)
	if !s.Rate.Allow(ctx, "ip:"+ip, 300) {
		w.Header().Set("Retry-After", "60")
		err = domain.Reject("rate_limit_exceeded", 429)
		return
	}
	raw, readErr := io.ReadAll(http.MaxBytesReader(w, r.Body, 64<<10))
	if readErr != nil {
		err = domain.Reject("request_too_large", 413)
		return
	}
	if strings.HasPrefix(r.URL.Path, "/checkout/") && r.Method == "GET" {
		err = s.hosted(w, r)
		return
	}
	if strings.HasPrefix(r.URL.Path, "/pay/") && r.Method == "GET" {
		err = s.linkCheckout(w, r)
		return
	}
	if strings.HasPrefix(r.URL.Path, "/internal/v1/") {
		owner := r.Header.Get("X-Louma-User")
		if err = s.internalAuth(r, owner, raw); err != nil {
			return
		}
		err = s.internal(w, r, owner, raw)
		return
	}
	if !strings.HasPrefix(r.URL.Path, "/v1/") {
		err = domain.Reject("not_found", 404)
		return
	}
	parts := strings.Split(strings.TrimPrefix(r.URL.Path, "/v1/"), "/")
	kind := alias(parts[0])
	scope := "payments:read"
	switch kind {
	case "checkouts", "links":
		if r.Method != "GET" {
			scope = "checkout:create"
		}
	case "refunds":
		if r.Method != "GET" {
			scope = "refunds:create"
		}
	case "subscriptions":
		scope = "subscriptions:manage"
	case "products", "prices":
		scope = "products:manage"
	case "webhooks", "deliveries":
		scope = "webhooks:manage"
	case "credentials":
		scope = "credentials:manage"
	}
	principal, authErr := s.Service.Store.Authenticate(ctx, strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer "), scope)
	if authErr != nil {
		err = authErr
		return
	}
	usageApp = principal.App.ID
	if s.Service.Store.Config.MerchantPaused {
		err = domain.Reject("merchant_access_paused", 503)
		return
	}
	limit := s.Service.Store.Config.RateLimit
	if r.Method != "GET" {
		limit = 30
	}
	for _, key := range []string{"merchant:" + principal.App.Owner, "application:" + principal.App.ID, "credential:" + principal.Credential.ID + ":" + kind} {
		if !s.Rate.Allow(ctx, key, limit) {
			w.Header().Set("Retry-After", "60")
			err = domain.Reject("rate_limit_exceeded", 429)
			return
		}
	}
	w.Header().Set("RateLimit-Limit", strconv.Itoa(limit))
	w.Header().Set("RateLimit-Reset", "60")
	idResource, action := "", ""
	if len(parts) > 1 {
		idResource = parts[1]
	}
	if len(parts) > 2 {
		action = parts[2]
	}
	if len(parts) > 3 {
		err = domain.Reject("not_found", 404)
		return
	}
	value, resourceErr := s.Service.Resource(ctx, principal, kind, idResource, action, r.Method, r.Header.Get("Idempotency-Key"), r.URL.Query().Get("cursor"), raw)
	err = resourceErr
	if err == nil {
		s.json(w, value)
	}
}
func alias(kind string) string {
	switch kind {
	case "payment-links":
		return "links"
	case "checkout-sessions":
		return "checkouts"
	case "webhook-deliveries":
		return "deliveries"
	}
	return kind
}
func routeGroup(path string) string {
	parts := strings.Split(path, "/")
	if len(parts) > 2 {
		return "/" + parts[1] + "/" + parts[2]
	}
	return path
}
func (s *Server) internalAuth(r *http.Request, owner string, raw []byte) error {
	ts := r.Header.Get("X-Louma-Timestamp")
	nonce := r.Header.Get("X-Louma-Nonce")
	seconds, err := strconv.ParseInt(ts, 10, 64)
	if err != nil || seconds < time.Now().Unix()-60 || seconds > time.Now().Unix()+30 || !gateway.UUID.MatchString(owner) || !gateway.UUID.MatchString(nonce) {
		return domain.Reject("invalid_internal_auth", 401)
	}
	expected := security.InternalSignature(s.Service.Store.Config.ServiceKey, ts, nonce, r.Method, r.URL.RequestURI(), owner, raw)
	if !hmac.Equal([]byte(expected), []byte(r.Header.Get("X-Louma-Signature"))) {
		return domain.Reject("invalid_internal_auth", 401)
	}
	return s.Service.Store.Nonce(r.Context(), nonce)
}
func (s *Server) json(w http.ResponseWriter, value any) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(value)
}
func (s *Server) fail(w http.ResponseWriter, id string, err error) {
	status := 500
	code := "internal_error"
	var rejection *domain.Error
	if errors.As(err, &rejection) {
		status = rejection.Status
		code = rejection.Code
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(map[string]any{"error": map[string]string{"code": code, "message": strings.ReplaceAll(code, "_", " "), "request_id": id}})
}
func (s *Server) internal(w http.ResponseWriter, r *http.Request, owner string, raw []byte) error {
	path := strings.TrimPrefix(r.URL.Path, "/internal/v1/")
	parts := strings.Split(path, "/")
	ctx := r.Context()
	store := s.Service.Store
	if path == "metrics" {
		w.Header().Set("Content-Type", "text/plain")
		fmt.Fprintf(w, "louma_gateway_requests_total %d\nlouma_gateway_errors_total %d\nlouma_gateway_transactions_total %d\nlouma_gateway_transaction_retries_total %d\nlouma_gateway_transaction_failures_total %d\n", s.Requests.Load(), s.Errors.Load(), store.Transactions.Load(), store.Retries.Load(), store.Failures.Load())
		return nil
	}
	if parts[0] == "checkout" && len(parts) >= 2 {
		if !gateway.UUID.MatchString(parts[1]) {
			return domain.Reject("not_found", 404)
		}
		if r.Method == "GET" && len(parts) == 2 {
			p, err := store.Payment(ctx, "", parts[1])
			if err != nil {
				return err
			}
			if p.Status == "succeeded" && p.PayerID != owner {
				return domain.Reject("not_found", 404)
			}
			s.json(w, p.View())
			return nil
		}
		if r.Method == "POST" && len(parts) == 3 && parts[2] == "confirm" {
			if !s.Rate.Allow(ctx, "payer:"+owner, 20) {
				return domain.Reject("rate_limit_exceeded", 429)
			}
			input, err := gateway.Decode[struct {
				ApprovalID string `json:"approval_id"`
				IntentHash string `json:"intent_hash"`
				Key        string `json:"idempotency_key"`
			}](raw)
			if err != nil {
				return err
			}
			p, err := store.Confirm(ctx, owner, parts[1], input.ApprovalID, input.IntentHash)
			if err != nil {
				return err
			}
			s.json(w, p.View())
			return nil
		}
	}
	if path == "approvals" {
		if r.Method == "GET" {
			a, err := store.Approval(ctx, owner, r.URL.Query().Get("payment_id"), r.URL.Query().Get("idempotency_key"))
			if err != nil {
				return err
			}
			s.json(w, map[string]any{"id": a.ID, "expires_at": a.ExpiresAt, "session_id": a.SessionID, "owner_user_id": a.Owner, "wallet_id": a.WalletID, "intent_hash": a.IntentHash, "recurring_consent": a.Consent, "policy_version": a.Policy})
			return nil
		}
		if r.Method == "POST" {
			a, err := gateway.Decode[domain.Approval](raw)
			if err != nil {
				return err
			}
			if a.Owner != owner || !gateway.Key.MatchString(a.Key) {
				return domain.Reject("invalid_approval", 400)
			}
			a, err = store.Approve(ctx, a)
			if err != nil {
				return err
			}
			s.json(w, map[string]any{"id": a.ID, "approval_id": a.ID, "expires_at": a.ExpiresAt})
			return nil
		}
	}
	if parts[0] == "customer-subscriptions" && len(parts) == 3 && parts[2] == "cancel" && r.Method == "POST" {
		if err := store.CancelSubscription(ctx, "", owner, parts[1], false); err != nil {
			return err
		}
		s.json(w, map[string]string{"status": "canceled"})
		return nil
	}
	if err := store.Eligible(ctx, owner); err != nil {
		return err
	}
	if len(parts) == 3 && parts[0] != "applications" && r.Method == "POST" {
		kind := alias(parts[0])
		app, err := store.ResourceApplication(ctx, owner, kind, parts[1])
		if err != nil {
			return err
		}
		if app.Status != "active" {
			return domain.Reject("application_suspended", 403)
		}
		var body map[string]json.RawMessage
		key := ""
		if json.Unmarshal(raw, &body) == nil {
			_ = json.Unmarshal(body["idempotency_key"], &key)
			delete(body, "idempotency_key")
			raw, _ = json.Marshal(body)
		}
		value, err := s.Service.Resource(ctx, mongodb.Principal{App: app, Internal: true}, kind, parts[1], parts[2], r.Method, key, "", raw)
		if err != nil {
			return err
		}
		s.json(w, value)
		return nil
	}
	if parts[0] != "applications" {
		return domain.Reject("not_found", 404)
	}
	if len(parts) == 1 {
		if r.Method == "GET" {
			apps, err := store.Applications(ctx, owner)
			if err != nil {
				return err
			}
			s.json(w, map[string]any{"data": apps, "next_cursor": ""})
			return nil
		}
		if r.Method == "POST" {
			app, err := s.Service.CreateApplication(ctx, owner, raw)
			if err != nil {
				return err
			}
			s.json(w, app)
			return nil
		}
	}
	if len(parts) < 2 {
		return domain.Reject("not_found", 404)
	}
	app, err := store.Application(ctx, owner, parts[1])
	if err != nil {
		return err
	}
	if len(parts) == 2 {
		if r.Method == "GET" {
			s.json(w, app)
			return nil
		}
		if r.Method == "PATCH" {
			input, err := gateway.Decode[struct {
				Status  string    `json:"status"`
				Name    *string   `json:"name"`
				Wallet  *string   `json:"receiving_wallet_id"`
				Domains *[]string `json:"domains"`
			}](raw)
			if err != nil {
				return err
			}
			if input.Status != "" {
				if input.Status != "suspended" && input.Status != "disabled" {
					return domain.Reject("invalid_transition", 400)
				}
				if input.Name != nil || input.Wallet != nil || input.Domains != nil {
					return domain.Reject("invalid_application", 400)
				}
				if err = store.Suspend(ctx, owner, app.ID); err != nil {
					return err
				}
				app.Status = "suspended"
			} else {
				name, wallet, domains := app.Name, app.WalletID, app.Domains
				if input.Name != nil {
					name = *input.Name
				}
				if input.Wallet != nil {
					wallet = *input.Wallet
				}
				if input.Domains != nil {
					domains = *input.Domains
				}
				if name == "" || len(name) > 120 || !gateway.UUID.MatchString(wallet) {
					return domain.Reject("invalid_application", 400)
				}
				if err = gateway.ValidateDomains(domains, store.Config.Environment == "test"); err != nil {
					return err
				}
				app, err = store.UpdateApplication(ctx, app, name, wallet, domains)
				if err != nil {
					return err
				}
			}
			s.json(w, app)
			return nil
		}
	}
	if app.Status != "active" {
		return domain.Reject("application_suspended", 403)
	}
	if len(parts) < 3 || len(parts) > 5 {
		return domain.Reject("not_found", 404)
	}
	kind := alias(parts[2])
	resourceID, action := "", ""
	if len(parts) > 3 {
		resourceID = parts[3]
	}
	if len(parts) > 4 {
		action = parts[4]
	}
	if kind == "usage" {
		if r.Method != "GET" || len(parts) != 3 {
			return domain.Reject("method_not_allowed", 405)
		}
		usage, err := store.Usage(ctx, app.ID)
		if err != nil {
			return err
		}
		s.json(w, usage)
		return nil
	}
	key := r.Header.Get("Idempotency-Key")
	if key == "" {
		var input struct {
			Key string `json:"idempotency_key"`
		}
		json.Unmarshal(raw, &input)
		key = input.Key
	}
	// The BFF may carry idempotency in its signed JSON rather than an unsigned header.
	var body map[string]json.RawMessage
	if json.Unmarshal(raw, &body) == nil {
		delete(body, "idempotency_key")
		raw, _ = json.Marshal(body)
	}
	value, err := s.Service.Resource(ctx, mongodb.Principal{App: app, Internal: true}, kind, resourceID, action, r.Method, key, r.URL.Query().Get("cursor"), raw)
	if err != nil {
		return err
	}
	s.json(w, value)
	return nil
}
