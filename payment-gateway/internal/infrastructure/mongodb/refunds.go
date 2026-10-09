package mongodb

import (
	"context"
	"errors"
	"time"

	"github.com/derohaze/Louma/payment-gateway/internal/domain"
	"github.com/derohaze/Louma/payment-gateway/internal/security"
	"go.mongodb.org/mongo-driver/v2/bson"
	"go.mongodb.org/mongo-driver/v2/mongo"
)

func (s *Store) Refund(ctx context.Context, principal Principal, paymentID string, amount int64, key string) (domain.Refund, error) {
	return s.refund(ctx, principal, paymentID, amount, key, false, "")
}
func (s *Store) RefundRequest(ctx context.Context, principal Principal, paymentID, rawAmount, key, reason string) (domain.Refund, error) {
	var amount int64
	if rawAmount != "" {
		var err error
		amount, err = domain.ParseMoney(rawAmount)
		if err != nil {
			return domain.Refund{}, err
		}
	}
	return s.refund(ctx, principal, paymentID, amount, key, rawAmount == "", reason)
}
func (s *Store) refund(ctx context.Context, principal Principal, paymentID string, amount int64, key string, full bool, reason string) (domain.Refund, error) {
	intentAmount := domain.FormatMoney(amount)
	if full {
		intentAmount = "remaining"
	}
	fingerprint := paymentID + ":" + intentAmount
	if reason != "" {
		fingerprint += ":reason:" + reason
	}
	r := domain.Refund{ID: ID(), AppID: principal.App.ID, PaymentID: paymentID, Amount: amount, Status: "pending", Key: key, Reason: reason, Fingerprint: security.Hash(fingerprint), CreatedAt: time.Now().UTC()}
	if (!full && amount < 1) || amount > domain.MaxAmount || key == "" {
		return r, domain.Reject("invalid_refund", 400)
	}
	var prior domain.Refund
	err := s.C("gateway_refunds").FindOne(ctx, bson.M{"applicationId": r.AppID, "idempotencyKey": key}).Decode(&prior)
	if err == nil {
		if prior.Fingerprint != r.Fingerprint {
			return prior, domain.Reject("idempotency_key_reused", 409)
		}
		r = prior
	} else if !errors.Is(err, mongo.ErrNoDocuments) {
		return r, err
	}
	if r.Status == "succeeded" {
		return r, nil
	}
	if err != nil {
		p, err := s.Payment(ctx, principal.App.ID, paymentID)
		if err != nil {
			return r, err
		}
		if full {
			amount = p.Total - p.Refunded
			r.Amount = amount
		}
		if p.Status != "succeeded" || amount < 1 || amount > p.Total-p.Refunded {
			return r, domain.Reject("refund_limit_exceeded", 409)
		}
		_, err = s.C("gateway_refunds").InsertOne(ctx, r)
		if mongo.IsDuplicateKeyError(err) {
			if readErr := s.C("gateway_refunds").FindOne(ctx, bson.M{"applicationId": r.AppID, "idempotencyKey": key}).Decode(&prior); readErr != nil {
				return r, readErr
			}
			if prior.Fingerprint != r.Fingerprint {
				return prior, domain.Reject("idempotency_key_reused", 409)
			}
			r = prior
			err = nil
		}
		if err != nil {
			return r, err
		}
	}
	err = s.Transaction(ctx, func(tx context.Context) error {
		if s.Config.SettlementPaused || s.Config.MerchantPaused {
			return domain.Reject("settlement_paused", 503)
		}
		var current domain.Refund
		if err := s.C("gateway_refunds").FindOne(tx, bson.M{"publicId": r.ID}).Decode(&current); err != nil {
			return err
		}
		if current.Status == "succeeded" {
			return nil
		}
		if current.Status != "pending" {
			return domain.Reject("refund_not_payable", 409)
		}
		p, err := s.Payment(tx, r.AppID, r.PaymentID)
		if err != nil {
			return err
		}
		if p.Status != "succeeded" || r.Amount > p.Total-p.Refunded {
			return domain.Reject("refund_limit_exceeded", 409)
		}
		if err = s.GuardApplication(tx, principal); err != nil {
			return err
		}
		from, err := s.GuardWallet(tx, p.WalletID, principal.App.Owner)
		if err != nil {
			return err
		}
		to, err := s.GuardReceiver(tx, p.PayerWalletID, p.PayerID)
		if err != nil {
			return err
		}
		debit, err := s.Account(tx, from.ID)
		if err != nil {
			return err
		}
		credit, err := s.Account(tx, to.ID)
		if err != nil {
			return err
		}
		if err = s.Move(tx, debit, -r.Amount); err != nil {
			return err
		}
		if err = s.Move(tx, credit, r.Amount); err != nil {
			return err
		}
		now := time.Now().UTC()
		transactionID := ID()
		header := bson.M{"publicId": transactionID, "type": "merchant_refund", "paymentId": p.ID, "originalPaymentId": p.ID, "operationId": r.ID, "merchantId": principal.App.ID, "senderUserId": from.Owner, "receiverUserId": to.Owner, "senderWalletId": from.ID, "receiverWalletId": to.ID, "participants": bson.A{from.Owner, to.Owner}, "senderAddress": from.Address, "receiverAddress": to.Address, "amountMinor": r.Amount, "feeMinor": int64(0), "netAmountMinor": r.Amount, "currency": "LMA", "status": "completed", "note": "Merchant refund", "idempotencyKey": r.ID, "requestFingerprint": r.Fingerprint, "correlationId": r.ID, "balanceAfterMinor": debit.Balance - r.Amount, "createdAt": now, "completedAt": now}
		if err = s.PostJournal(tx, header, []journalLine{{Account: debit, WalletID: &from.ID, Side: "debit", Amount: r.Amount}, {Account: credit, WalletID: &to.ID, Side: "credit", Amount: r.Amount}}); err != nil {
			return err
		}
		result, err := s.C("gateway_payments").UpdateOne(tx, bson.M{"publicId": p.ID, "refundedMinor": bson.M{"$lte": p.Total - r.Amount}}, bson.M{"$inc": bson.M{"refundedMinor": r.Amount}})
		if err = Changed(result, err, "refund_limit_exceeded"); err != nil {
			return err
		}
		result, err = s.C("gateway_refunds").UpdateOne(tx, bson.M{"publicId": r.ID, "status": "pending"}, bson.M{"$set": bson.M{"status": "succeeded", "transactionId": transactionID}})
		if err = Changed(result, err, "refund_already_settled"); err != nil {
			return err
		}
		return s.Event(tx, p.AppID, "payment.refunded", p.ID)
	})
	var landed domain.Refund
	if readErr := s.C("gateway_refunds").FindOne(ctx, bson.M{"publicId": r.ID}).Decode(&landed); readErr != nil {
		return r, domain.Reject("refund_outcome_unknown", 503)
	}
	if landed.Status == "succeeded" {
		return landed, nil
	}
	var rejection *domain.Error
	if errors.As(err, &rejection) && rejection.Code == "insufficient_funds" {
		return landed, nil
	}
	return landed, err
}
