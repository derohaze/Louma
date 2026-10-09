package mongodb

import (
	"context"
	"errors"
	"time"

	"github.com/derohaze/Louma/payment-gateway/internal/domain"
	"go.mongodb.org/mongo-driver/v2/bson"
	"go.mongodb.org/mongo-driver/v2/mongo"
)

func (s *Store) Confirm(ctx context.Context, owner, paymentID, approvalID, intent string) (domain.Payment, error) {
	prior, err := s.Payment(ctx, "", paymentID)
	if err != nil {
		return prior, err
	}
	if intent != prior.IntentHash {
		return prior, domain.Reject("intent_mismatch", 409)
	}
	if prior.Status == "succeeded" {
		if prior.PayerID != owner {
			return prior, domain.Reject("not_found", 404)
		}
		return prior, nil
	}
	if s.Config.SettlementPaused || s.Config.MerchantPaused {
		return prior, domain.Reject("settlement_paused", 503)
	}
	err = s.Transaction(ctx, func(tx context.Context) error {
		p, err := s.Payment(tx, "", paymentID)
		if err != nil {
			return err
		}
		if p.Status == "succeeded" {
			if p.PayerID != owner {
				return domain.Reject("not_found", 404)
			}
			return nil
		}
		if p.Status != "requires_action" || !p.ExpiresAt.After(time.Now()) {
			return domain.Reject("checkout_not_payable", 409)
		}
		var approval domain.Approval
		if err = s.C("gateway_approvals").FindOne(tx, bson.M{"publicId": approvalID, "paymentId": p.ID, "ownerUserId": owner, "intentHash": intent, "consumed": false, "expiresAt": bson.M{"$gt": time.Now()}}).Decode(&approval); err != nil {
			return domain.Reject("approval_expired_or_used", 409)
		}
		if err = s.GuardPayer(tx, approval); err != nil {
			return err
		}
		result, err := s.C("gateway_approvals").UpdateOne(tx, bson.M{"publicId": approval.ID, "consumed": false}, bson.M{"$set": bson.M{"consumed": true}})
		if err = Changed(result, err, "approval_used"); err != nil {
			return err
		}
		p.PayerID = owner
		p.PayerWalletID = approval.WalletID
		if p.Interval != "" {
			if !approval.Consent || approval.Policy != "2026-10-08" {
				return domain.Reject("recurring_consent_required", 400)
			}
			if err = s.FirstSubscription(tx, &p, approval); err != nil {
				return err
			}
		}
		return s.SettlePayment(tx, &p)
	})
	// The majority read is the only response authority, including a lost acknowledgement.
	stored, readErr := s.Payment(ctx, "", paymentID)
	if readErr == nil && stored.Status == "succeeded" && stored.PayerID == owner {
		return stored, nil
	}
	if err != nil {
		return prior, err
	}
	return prior, domain.Reject("payment_outcome_unknown", 503)
}
func sameDate(a, b *time.Time) bool {
	if a == nil || b == nil {
		return a == nil && b == nil
	}
	return a.UnixMilli() == b.UnixMilli()
}
func (s *Store) GuardPayer(ctx context.Context, a domain.Approval) error {
	if s.Config.Environment == "test" {
		if a.Proof.Kind != "none" || a.Proof.PasswordChangedAt != nil || a.Proof.TwoFactorEnabledAt != nil {
			return domain.Reject("invalid_sandbox_proof", 400)
		}
		return nil
	}
	result, err := s.C("sessions").UpdateOne(ctx, bson.M{"publicId": a.SessionID, "ownerUserId": a.Owner, "status": "active", "expiresAt": bson.M{"$gt": time.Now()}}, bson.M{"$inc": bson.M{"gatewayFinancialVersion": int32(1)}})
	if err = Changed(result, err, "session_revoked"); err != nil {
		return err
	}
	var password struct {
		ChangedAt *time.Time `bson:"changedAt"`
	}
	var factor struct {
		EnabledAt *time.Time `bson:"enabledAt"`
	}
	if err = s.C("transfer_password_credentials").FindOne(ctx, bson.M{"ownerUserId": a.Owner}).Decode(&password); err != nil && !errors.Is(err, mongo.ErrNoDocuments) {
		return err
	}
	if err = s.C("two_factor_credentials").FindOne(ctx, bson.M{"ownerUserId": a.Owner, "enabledAt": bson.M{"$ne": nil}}).Decode(&factor); err != nil && !errors.Is(err, mongo.ErrNoDocuments) {
		return err
	}
	if !sameDate(password.ChangedAt, a.Proof.PasswordChangedAt) || !sameDate(factor.EnabledAt, a.Proof.TwoFactorEnabledAt) {
		return domain.Reject("credential_changed", 409)
	}
	if a.Proof.Kind == "none" && (password.ChangedAt != nil || factor.EnabledAt != nil) {
		return domain.Reject("credential_required", 403)
	}
	if a.Proof.Kind == "password" && password.ChangedAt == nil {
		return domain.Reject("invalid_proof", 403)
	}
	if a.Proof.Kind == "totp" {
		if factor.EnabledAt == nil || a.Proof.TimeStep < time.Now().Unix()/30-4 || a.Proof.TimeStep > time.Now().Unix()/30+1 {
			return domain.Reject("proof_expired", 409)
		}
		if a.Proof.TimeStep > 2147483647 {
			return domain.Reject("invalid_proof", 403)
		}
		now := time.Now().UTC()
		_, err = s.C("two_factor_uses").InsertOne(ctx, bson.M{"ownerUserId": a.Owner, "purpose": "transfer", "timeStep": int32(a.Proof.TimeStep), "intentHash": a.IntentHash, "correlationId": a.ID, "createdAt": now, "retainUntil": now.Add(7 * 24 * time.Hour)})
		if mongo.IsDuplicateKeyError(err) {
			return domain.Reject("two_factor_code_already_used", 409)
		}
		return err
	}
	if a.Proof.Kind == "recovery_code" {
		id, err := bson.ObjectIDFromHex(a.Proof.CredentialID)
		if err != nil || len(a.Proof.VerifiedHashes) != len(a.Proof.RemainingHashes)+1 {
			return domain.Reject("invalid_proof", 403)
		}
		result, err := s.C("two_factor_credentials").UpdateOne(ctx, bson.M{"_id": id, "ownerUserId": a.Owner, "enabledAt": a.Proof.TwoFactorEnabledAt, "recoveryCodeHashes": a.Proof.VerifiedHashes}, bson.M{"$set": bson.M{"recoveryCodeHashes": a.Proof.RemainingHashes, "updatedAt": time.Now()}})
		return Changed(result, err, "recovery_code_already_used")
	}
	return nil
}
func (s *Store) GuardWallet(ctx context.Context, id, owner string) (domain.Wallet, error) {
	var wallet domain.Wallet
	if err := s.C("wallets").FindOne(ctx, bson.M{"publicId": id, "ownerUserId": owner, "status": "active"}).Decode(&wallet); err != nil {
		return wallet, domain.Reject("wallet_frozen_or_unowned", 403)
	}
	result, err := s.C("wallets").UpdateOne(ctx, bson.M{"publicId": id, "ownerUserId": owner, "status": "active", "financialVersion": bson.M{"$lt": int32(2147483647)}}, bson.M{"$inc": bson.M{"financialVersion": int32(1)}})
	return wallet, Changed(result, err, "wallet_frozen_or_unowned")
}
func (s *Store) Account(ctx context.Context, walletID string) (domain.Account, error) {
	var a domain.Account
	err := s.C("ledger_accounts").FindOne(ctx, bson.M{"walletId": walletID, "accountType": "wallet", "currency": "LMA"}).Decode(&a)
	return a, Missing(err)
}
func (s *Store) GuardReceiver(ctx context.Context, id, owner string) (domain.Wallet, error) {
	var wallet domain.Wallet
	if err := s.C("wallets").FindOne(ctx, bson.M{"publicId": id, "ownerUserId": owner}).Decode(&wallet); err != nil {
		return wallet, Missing(err)
	}
	result, err := s.C("wallets").UpdateOne(ctx, bson.M{"publicId": id, "ownerUserId": owner, "financialVersion": bson.M{"$lt": int32(2147483647)}}, bson.M{"$inc": bson.M{"financialVersion": int32(1)}})
	return wallet, Changed(result, err, "wallet_ownership_changed")
}
func (s *Store) Move(ctx context.Context, account domain.Account, delta int64) error {
	filter := bson.M{"publicId": account.ID, "currency": "LMA"}
	code := "wallet_limit_exceeded"
	if delta < 0 {
		filter["balanceMinor"] = bson.M{"$gte": -delta}
		code = "insufficient_funds"
	} else {
		filter["balanceMinor"] = bson.M{"$lte": domain.MaxBalance - delta}
	}
	result, err := s.C("ledger_accounts").UpdateOne(ctx, filter, bson.M{"$inc": bson.M{"balanceMinor": delta}})
	return Changed(result, err, code)
}

type journalLine struct {
	Account  domain.Account
	WalletID *string
	Side     string
	Amount   int64
}

func (s *Store) PostJournal(ctx context.Context, header bson.M, lines []journalLine) error {
	var debit, credit int64
	for _, line := range lines {
		if line.Amount < 1 || line.Amount > domain.MaxAmount {
			return errors.New("invalid journal amount")
		}
		if line.Side == "debit" {
			if debit > domain.MaxBalance-line.Amount {
				return errors.New("journal overflow")
			}
			debit += line.Amount
		} else if line.Side == "credit" {
			if credit > domain.MaxBalance-line.Amount {
				return errors.New("journal overflow")
			}
			credit += line.Amount
		} else {
			return errors.New("invalid journal side")
		}
	}
	if len(lines) < 2 || debit != credit {
		return errors.New("unbalanced journal")
	}
	if _, err := s.C("transactions").InsertOne(ctx, header); err != nil {
		return err
	}
	for i, line := range lines {
		_, err := s.C("ledger_entries").InsertOne(ctx, bson.M{"publicId": ID(), "transactionId": header["publicId"], "lineNumber": int32(i + 1), "walletId": line.WalletID, "ledgerAccountId": line.Account.ID, "side": line.Side, "amountMinor": line.Amount, "currency": "LMA", "correlationId": header["correlationId"], "createdAt": header["createdAt"]})
		if err != nil {
			return err
		}
	}
	return nil
}
func (s *Store) SettlePayment(ctx context.Context, p *domain.Payment) error {
	if s.Config.SettlementPaused || s.Config.MerchantPaused {
		return domain.Reject("settlement_paused", 503)
	}
	var app domain.Application
	if err := s.C("gateway_applications").FindOne(ctx, bson.M{"publicId": p.AppID}).Decode(&app); err != nil {
		return Missing(err)
	}
	principal := Principal{App: app, Credential: domain.Credential{ID: p.CredentialID}}
	if err := s.GuardApplication(ctx, principal); err != nil {
		return err
	}
	if app.WalletID != p.WalletID || app.Owner == p.PayerID {
		return domain.Reject("self_payment_or_wallet_changed", 409)
	}
	result, err := s.C("users").UpdateOne(ctx, bson.M{"publicId": p.PayerID, "status": "active"}, bson.M{"$inc": bson.M{"gatewayFinancialVersion": int32(1)}})
	if err = Changed(result, err, "payer_suspended"); err != nil {
		return err
	}
	payer, err := s.GuardWallet(ctx, p.PayerWalletID, p.PayerID)
	if err != nil {
		return err
	}
	receiver, err := s.GuardReceiver(ctx, p.WalletID, app.Owner)
	if err != nil {
		return err
	}
	from, err := s.Account(ctx, payer.ID)
	if err != nil {
		return err
	}
	to, err := s.Account(ctx, receiver.ID)
	if err != nil {
		return err
	}
	if err = s.Move(ctx, from, -p.Total); err != nil {
		return err
	}
	if err = s.Move(ctx, to, p.Net); err != nil {
		return err
	}
	lines := []journalLine{{Account: from, WalletID: &payer.ID, Side: "debit", Amount: p.Total}, {Account: to, WalletID: &receiver.ID, Side: "credit", Amount: p.Net}}
	if p.Fee > 0 {
		var revenue domain.Account
		if err = s.C("ledger_accounts").FindOne(ctx, bson.M{"accountType": "fee_revenue", "currency": "LMA"}).Decode(&revenue); err != nil {
			return err
		}
		if err = s.Move(ctx, revenue, p.Fee); err != nil {
			return err
		}
		lines = append(lines, journalLine{Account: revenue, Side: "credit", Amount: p.Fee})
	}
	now := time.Now().UTC()
	p.TransactionID = ID()
	p.Status = "succeeded"
	header := bson.M{"publicId": p.TransactionID, "type": "merchant_payment", "paymentId": p.ID, "operationId": p.ID, "merchantId": app.ID, "senderUserId": payer.Owner, "receiverUserId": receiver.Owner, "senderWalletId": payer.ID, "receiverWalletId": receiver.ID, "participants": bson.A{payer.Owner, receiver.Owner}, "senderAddress": payer.Address, "receiverAddress": receiver.Address, "amountMinor": p.Total, "feeMinor": p.Fee, "netAmountMinor": p.Net, "currency": "LMA", "status": "completed", "note": p.Description, "idempotencyKey": p.ID, "requestFingerprint": p.IntentHash, "correlationId": p.ID, "balanceAfterMinor": from.Balance - p.Total, "createdAt": now, "completedAt": now}
	if err = s.PostJournal(ctx, header, lines); err != nil {
		return err
	}
	result, err = s.C("gateway_payments").UpdateOne(ctx, bson.M{"publicId": p.ID, "status": "requires_action"}, bson.M{"$set": bson.M{"status": "succeeded", "payerUserId": p.PayerID, "payerWalletId": p.PayerWalletID, "transactionId": p.TransactionID, "subscriptionId": p.SubscriptionID, "invoiceId": p.InvoiceID}})
	if err = Changed(result, err, "payment_already_settled"); err != nil {
		return err
	}
	for _, kind := range []string{"payment.succeeded", "checkout.session.completed"} {
		if err = s.Event(ctx, p.AppID, kind, p.ID); err != nil {
			return err
		}
	}
	return nil
}
func (s *Store) Event(ctx context.Context, app, kind, resource string) error {
	_, err := s.C("gateway_events").InsertOne(ctx, domain.Event{ID: ID(), AppID: app, Type: kind, ResourceID: resource, CreatedAt: time.Now().UTC()})
	return err
}
