//go:build integration

package mongodb_test

import (
	"context"
	"errors"
	"sync"
	"testing"

	"github.com/derohaze/Louma/payment-gateway/internal/domain"
	"go.mongodb.org/mongo-driver/v2/bson"
	"go.mongodb.org/mongo-driver/v2/mongo"
)

func TestSettlementBalancesReplayAndIndexes(t *testing.T) {
	f := newFixture(t)
	p, approval := f.checkout(t, 100_000, "")
	paid, err := f.confirm(p, approval)
	if err != nil || paid.Status != "succeeded" {
		t.Fatalf("settlement: %+v %v", paid, err)
	}
	if got := f.balance(t, "payer"); got != 900_000 {
		t.Fatalf("payer %d", got)
	}
	if got := f.balance(t, "merchant"); got != 99_000 {
		t.Fatalf("merchant %d", got)
	}
	var fee domain.Account
	if err := f.store.C("ledger_accounts").FindOne(context.Background(), bson.M{"accountType": "fee_revenue"}).Decode(&fee); err != nil || fee.Balance != 1_000 {
		t.Fatalf("fee %+v %v", fee, err)
	}
	for i := 0; i < 3; i++ {
		replay, err := f.confirm(p, approval)
		if err != nil || replay.TransactionID != paid.TransactionID {
			t.Fatalf("replay %+v %v", replay, err)
		}
	}
	count(t, f, "transactions", bson.M{"operationId": p.ID}, 1)
	count(t, f, "ledger_entries", bson.M{"transactionId": paid.TransactionID}, 3)
	count(t, f, "gateway_events", bson.M{"resourceId": p.ID}, 2)
	_, err = f.store.Confirm(context.Background(), f.identities["payer2"].UserID, p.ID, approval.ID, p.IntentHash)
	requireCode(t, err, "not_found")
	var journal bson.M
	if err = f.store.C("transactions").FindOne(context.Background(), bson.M{"publicId": paid.TransactionID}).Decode(&journal); err != nil {
		t.Fatal(err)
	}
	delete(journal, "_id")
	journal["publicId"] = "different-journal-id"
	if _, err = f.store.C("transactions").InsertOne(context.Background(), journal); !mongo.IsDuplicateKeyError(err) {
		t.Fatalf("operation uniqueness not enforced: %v", err)
	}
	f.reconcile(t)
}

func TestSettlementFailureRollsBackAllWrites(t *testing.T) {
	f := newFixture(t)
	p, a := f.checkout(t, 1_000_001, "")
	_, err := f.confirm(p, a)
	requireCode(t, err, "insufficient_funds")
	if f.balance(t, "payer") != 1_000_000 || f.balance(t, "merchant") != 0 {
		t.Fatal("failed debit changed balances")
	}
	var stored domain.Approval
	if err := f.store.C("gateway_approvals").FindOne(context.Background(), bson.M{"publicId": a.ID}).Decode(&stored); err != nil || stored.Consumed {
		t.Fatalf("approval not rolled back: %+v %v", stored, err)
	}
	count(t, f, "transactions", bson.M{"operationId": p.ID}, 0)
	count(t, f, "gateway_events", bson.M{"resourceId": p.ID}, 0)
	// Force a failure after all three balance projections were already changed.
	p, a = f.checkout(t, 100_000, "")
	if err := f.store.DB.RunCommand(context.Background(), bson.D{{Key: "collMod", Value: "gateway_events"}, {Key: "validator", Value: bson.M{"forcedRollback": true}}, {Key: "validationLevel", Value: "strict"}, {Key: "validationAction", Value: "error"}}).Err(); err != nil {
		t.Fatal(err)
	}
	if _, err = f.confirm(p, a); err == nil {
		t.Fatal("injected final event validation failure did not abort settlement")
	}
	if f.balance(t, "payer") != 1_000_000 || f.balance(t, "merchant") != 0 {
		t.Fatal("late failure retained balance changes")
	}
	count(t, f, "transactions", bson.M{"operationId": p.ID}, 0)
	if err := f.store.Migrate(context.Background()); err != nil {
		t.Fatal(err)
	}
	if _, err = f.confirm(p, a); err != nil {
		t.Fatalf("recovery after rollback: %v", err)
	}
	f.reconcile(t)
}

func TestSettlementConcurrentSpendAndDuplicateConfirmation(t *testing.T) {
	f := newFixture(t)
	p1, a1 := f.checkout(t, 600_000, "")
	p2, a2 := f.checkout(t, 600_000, "")
	start := make(chan struct{})
	results := make(chan error, 2)
	var wg sync.WaitGroup
	for _, pair := range []struct {
		p domain.Payment
		a domain.Approval
	}{{p1, a1}, {p2, a2}} {
		wg.Add(1)
		go func() { defer wg.Done(); <-start; _, err := f.confirm(pair.p, pair.a); results <- err }()
	}
	close(start)
	wg.Wait()
	close(results)
	success := 0
	for err := range results {
		if err == nil {
			success++
		} else {
			var rejection *domain.Error
			if errors.As(err, &rejection) && rejection.Code == "transaction_conflict" {
				if rejection.Status != 503 {
					t.Fatal(err)
				}
			} else {
				requireCode(t, err, "insufficient_funds")
			}
		}
	}
	if success != 1 || f.balance(t, "payer") != 400_000 || f.balance(t, "merchant") != 594_000 {
		t.Fatalf("double spend: success=%d", success)
	}
	count(t, f, "transactions", bson.M{"type": "merchant_payment"}, 1)
	paid, err := f.store.Payment(context.Background(), "", p1.ID)
	a := a1
	if err != nil {
		t.Fatal(err)
	}
	if paid.Status != "succeeded" {
		paid, err = f.store.Payment(context.Background(), "", p2.ID)
		a = a2
	}
	loser, loserApproval := p2, a2
	if paid.ID == p2.ID {
		loser, loserApproval = p1, a1
	}
	_, retryErr := f.confirm(loser, loserApproval)
	requireCode(t, retryErr, "insufficient_funds")
	if err != nil {
		t.Fatal(err)
	}
	results = make(chan error, 8)
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func() { defer wg.Done(); _, err := f.confirm(paid, a); results <- err }()
	}
	wg.Wait()
	close(results)
	for err := range results {
		if err != nil {
			t.Fatal(err)
		}
	}
	count(t, f, "transactions", bson.M{"type": "merchant_payment"}, 1)
	f.reconcile(t)
}

func TestSettlementAuthorizationInvalidatedAfterApproval(t *testing.T) {
	for _, tc := range []struct {
		name, code string
		invalidate func(*testing.T, *fixture)
	}{
		{"wallet_freeze", "wallet_frozen_or_unowned", func(t *testing.T, f *fixture) { f.node(t, "freeze", f.identities["payer"].UserID) }},
		{"password_changed", "credential_changed", func(t *testing.T, f *fixture) { f.node(t, "password", f.identities["payer"].UserID) }},
		{"session_revoked", "session_revoked", func(t *testing.T, f *fixture) {
			_, err := f.store.C("sessions").UpdateOne(context.Background(), bson.M{"publicId": f.identities["payer"].SessionID}, bson.M{"$set": bson.M{"status": "revoked"}})
			if err != nil {
				t.Fatal(err)
			}
		}},
		{"key_revoked", "credential_revoked", func(t *testing.T, f *fixture) {
			_, err := f.store.C("gateway_credentials").UpdateOne(context.Background(), bson.M{"publicId": f.principal.Credential.ID}, bson.M{"$set": bson.M{"status": "revoked"}})
			if err != nil {
				t.Fatal(err)
			}
		}},
		{"merchant_suspended", "developer_access_required", func(t *testing.T, f *fixture) {
			_, err := f.store.C("gateway_developers").UpdateOne(context.Background(), bson.M{"ownerUserId": f.principal.App.Owner}, bson.M{"$set": bson.M{"status": "suspended"}})
			if err != nil {
				t.Fatal(err)
			}
		}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			f := newFixture(t)
			p, a := f.checkout(t, 100_000, "")
			tc.invalidate(t, f)
			_, err := f.confirm(p, a)
			requireCode(t, err, tc.code)
			if f.balance(t, "payer") != 1_000_000 {
				t.Fatal("invalidated approval debited payer")
			}
			count(t, f, "transactions", bson.M{"operationId": p.ID}, 0)
			f.reconcile(t)
		})
	}
}

func TestSettlementConcurrentFreezeAndCredentialRevocation(t *testing.T) {
	for _, tc := range []struct {
		name, collection, code string
		filter                 func(*fixture) bson.M
		update                 bson.M
	}{
		{"wallet_freeze", "wallets", "wallet_frozen_or_unowned", func(f *fixture) bson.M { return bson.M{"publicId": f.identities["payer"].WalletID} }, bson.M{"$set": bson.M{"status": "frozen"}, "$inc": bson.M{"financialVersion": int32(1)}}},
		{"credential_revoke", "gateway_credentials", "credential_revoked", func(f *fixture) bson.M { return bson.M{"publicId": f.principal.Credential.ID} }, bson.M{"$set": bson.M{"status": "revoked"}, "$inc": bson.M{"version": int32(1)}}},
		{"session_revoke", "sessions", "session_revoked", func(f *fixture) bson.M { return bson.M{"publicId": f.identities["payer"].SessionID} }, bson.M{"$set": bson.M{"status": "revoked"}}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			f := newFixture(t)
			p, a := f.checkout(t, 100_000, "")
			later, laterApproval := f.checkout(t, 100_000, "")
			start := make(chan struct{})
			done := make(chan error, 1)
			var paid domain.Payment
			var paymentErr error
			var wg sync.WaitGroup
			wg.Add(2)
			go func() { defer wg.Done(); <-start; paid, paymentErr = f.confirm(p, a) }()
			go func() {
				defer wg.Done()
				<-start
				_, err := f.store.C(tc.collection).UpdateOne(context.Background(), tc.filter(f), tc.update)
				done <- err
			}()
			close(start)
			wg.Wait()
			if err := <-done; err != nil {
				t.Fatal(err)
			}
			want := int64(1_000_000)
			journals := int64(0)
			if paymentErr == nil {
				if paid.Status != "succeeded" {
					t.Fatalf("acknowledged without settlement %+v", paid)
				}
				want -= 100_000
				journals = 1
			} else {
				requireCode(t, paymentErr, tc.code)
			}
			if got := f.balance(t, "payer"); got != want {
				t.Fatalf("race debit got %d want %d", got, want)
			}
			// Once revocation/freeze has durably returned, every later approval must fail.
			_, err := f.confirm(later, laterApproval)
			requireCode(t, err, tc.code)
			count(t, f, "transactions", bson.M{"type": "merchant_payment"}, journals)
			f.reconcile(t)
		})
	}
}
