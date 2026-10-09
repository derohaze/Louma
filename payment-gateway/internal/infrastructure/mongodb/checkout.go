package mongodb

import (
	"context"
	"errors"
	"time"

	"github.com/derohaze/Louma/payment-gateway/internal/domain"
	"go.mongodb.org/mongo-driver/v2/bson"
	"go.mongodb.org/mongo-driver/v2/mongo"
)

func (s *Store) Payment(ctx context.Context, app, id string) (domain.Payment, error) {
	var p domain.Payment
	filter := bson.M{"publicId": id}
	if app != "" {
		filter["applicationId"] = app
	}
	err := s.C("gateway_payments").FindOne(ctx, filter).Decode(&p)
	return p, Missing(err)
}
func (s *Store) Price(ctx context.Context, app, id string) (domain.Price, error) {
	var p domain.Price
	err := s.C("gateway_prices").FindOne(ctx, bson.M{"publicId": id, "applicationId": app, "status": "active"}).Decode(&p)
	return p, Missing(err)
}
func (s *Store) SaveCheckout(ctx context.Context, principal Principal, p domain.Payment) (domain.Payment, error) {
	find := func(ctx context.Context) (domain.Payment, error) {
		var prior domain.Payment
		err := s.C("gateway_payments").FindOne(ctx, bson.M{"applicationId": p.AppID, "idempotencyKey": p.Key}).Decode(&prior)
		if err == nil && prior.Fingerprint != p.Fingerprint {
			return prior, domain.Reject("idempotency_key_reused", 409)
		}
		return prior, err
	}
	if prior, err := find(ctx); err == nil {
		return prior, nil
	} else if !errors.Is(err, mongo.ErrNoDocuments) {
		return p, err
	}
	err := s.Transaction(ctx, func(tx context.Context) error {
		if prior, err := find(tx); err == nil {
			p = prior
			return nil
		} else if !errors.Is(err, mongo.ErrNoDocuments) {
			return err
		}
		if err := s.GuardApplication(tx, principal); err != nil {
			return err
		}
		_, err := s.C("gateway_payments").InsertOne(tx, p)
		return err
	})
	if err != nil {
		if prior, readErr := find(ctx); readErr == nil {
			return prior, nil
		}
		return p, err
	}
	return p, nil
}
func (s *Store) Approval(ctx context.Context, owner, payment, key string) (domain.Approval, error) {
	var a domain.Approval
	err := s.C("gateway_approvals").FindOne(ctx, bson.M{"paymentId": payment, "ownerUserId": owner, "idempotencyKey": key}).Decode(&a)
	return a, Missing(err)
}
func (s *Store) Approve(ctx context.Context, a domain.Approval) (domain.Approval, error) {
	p, err := s.Payment(ctx, "", a.PaymentID)
	if err != nil {
		return a, err
	}
	if a.IntentHash != p.IntentHash || a.SessionID == "" || a.WalletID == "" || a.Key == "" {
		return a, domain.Reject("invalid_approval", 400)
	}
	if p.Interval != "" && (!a.Consent || a.Policy != "2026-10-08") {
		return a, domain.Reject("recurring_consent_required", 400)
	}
	if prior, err := s.Approval(ctx, a.Owner, a.PaymentID, a.Key); err == nil {
		if prior.IntentHash != a.IntentHash || prior.WalletID != a.WalletID || prior.SessionID != a.SessionID || prior.Consent != a.Consent || prior.Policy != a.Policy {
			return a, domain.Reject("idempotency_key_reused", 409)
		}
		return prior, nil
	}
	if p.Status != "requires_action" || !p.ExpiresAt.After(time.Now()) {
		return a, domain.Reject("checkout_not_payable", 409)
	}
	if len(a.Proof.VerifiedHashes) > 16 || len(a.Proof.RemainingHashes) > 16 {
		return a, domain.Reject("invalid_proof", 400)
	}
	switch a.Proof.Kind {
	case "none", "password", "totp", "recovery_code":
	default:
		return a, domain.Reject("invalid_proof", 400)
	}
	if a.Proof.VerifiedHashes == nil {
		a.Proof.VerifiedHashes = []string{}
	}
	if a.Proof.RemainingHashes == nil {
		a.Proof.RemainingHashes = []string{}
	}
	a.ID = ID()
	a.CreatedAt = time.Now().UTC()
	a.ExpiresAt = a.CreatedAt.Add(2 * time.Minute)
	_, err = s.C("gateway_approvals").InsertOne(ctx, a)
	if mongo.IsDuplicateKeyError(err) {
		prior, readErr := s.Approval(ctx, a.Owner, a.PaymentID, a.Key)
		if readErr == nil && (prior.IntentHash != a.IntentHash || prior.WalletID != a.WalletID || prior.SessionID != a.SessionID || prior.Consent != a.Consent || prior.Policy != a.Policy) {
			return a, domain.Reject("idempotency_key_reused", 409)
		}
		return prior, readErr
	}
	return a, err
}
