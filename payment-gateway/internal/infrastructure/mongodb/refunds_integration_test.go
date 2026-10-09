//go:build integration

package mongodb_test

import (
	"context"
	"errors"
	"sync"
	"testing"

	"github.com/derohaze/Louma/payment-gateway/internal/domain"
	"github.com/derohaze/Louma/payment-gateway/internal/infrastructure/mongodb"
	"go.mongodb.org/mongo-driver/v2/bson"
)

func TestRefundAtomicityReplayAndConcurrentCaps(t *testing.T) {
	f := newFixture(t)
	p, a := f.checkout(t, 100_000, "")
	if _, err := f.confirm(p, a); err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	// The merchant receives 99%; a full refund needs additional merchant funds.
	r, err := f.store.Refund(ctx, f.principal, p.ID, 100_000, "full-refund")
	if err != nil {
		t.Fatal(err)
	}
	if r.Status != "pending" || f.balance(t, "payer") != 900_000 || f.balance(t, "merchant") != 99_000 {
		t.Fatal("failed refund moved money")
	}
	count(t, f, "transactions", bson.M{"type": "merchant_refund"}, 0)
	r, err = f.store.Refund(ctx, f.principal, p.ID, 50_000, "partial-refund")
	if err != nil || r.Status != "succeeded" {
		t.Fatalf("partial refund %+v %v", r, err)
	}
	replay, err := f.store.Refund(ctx, f.principal, p.ID, 50_000, "partial-refund")
	if err != nil || replay.TransactionID != r.TransactionID {
		t.Fatalf("refund replay %+v %v", replay, err)
	}
	_, err = f.store.Refund(ctx, f.principal, p.ID, 49_000, "partial-refund")
	requireCode(t, err, "idempotency_key_reused")
	start := make(chan struct{})
	results := make(chan struct {
		key string
		err error
	}, 2)
	var wg sync.WaitGroup
	for _, key := range []string{"concurrent-a", "concurrent-b"} {
		wg.Add(1)
		go func() {
			defer wg.Done()
			<-start
			_, err := f.store.Refund(ctx, f.principal, p.ID, 40_000, key)
			results <- struct {
				key string
				err error
			}{key, err}
		}()
	}
	close(start)
	wg.Wait()
	close(results)
	wins := 0
	for result := range results {
		err := result.err
		if err == nil {
			wins++
		} else {
			var rejection *domain.Error
			if errors.As(err, &rejection) && rejection.Code == "transaction_conflict" {
				if rejection.Status != 503 {
					t.Fatal(err)
				}
			} else {
				requireCode(t, err, "refund_limit_exceeded")
			}
			_, retryErr := f.store.Refund(ctx, f.principal, p.ID, 40_000, result.key)
			requireCode(t, retryErr, "refund_limit_exceeded")
		}
	}
	if wins != 1 || f.balance(t, "payer") != 990_000 || f.balance(t, "merchant") != 9_000 {
		t.Fatalf("refund race winners %d", wins)
	}
	stored, err := f.store.Payment(ctx, f.principal.App.ID, p.ID)
	if err != nil || stored.Refunded != 90_000 {
		t.Fatalf("refund projection %+v %v", stored, err)
	}
	count(t, f, "transactions", bson.M{"type": "merchant_refund"}, 2)
	var fee domain.Account
	if err := f.store.C("ledger_accounts").FindOne(ctx, bson.M{"accountType": "fee_revenue"}).Decode(&fee); err != nil || fee.Balance != 1_000 {
		t.Fatalf("fees unexpectedly refunded: %+v %v", fee, err)
	}
	f.reconcile(t)
}

func TestRefundPendingFundingRecoveryAndCrossMerchantIsolation(t *testing.T) {
	f := newFixture(t)
	p, a := f.checkout(t, 100_000, "")
	ctx := context.Background()
	if _, err := f.confirm(p, a); err != nil {
		t.Fatal(err)
	}
	other := f.identities["otherMerchant"]
	otherApp, err := f.store.CreateApplication(ctx, domain.Application{Owner: other.UserID, WalletID: other.WalletID, Name: "Other merchant", Domains: []string{"other.example"}})
	if err != nil {
		t.Fatal(err)
	}
	_, err = f.store.Refund(ctx, mongodb.Principal{App: otherApp}, p.ID, 50_000, "cross-tenant-refund")
	requireCode(t, err, "not_found")
	count(t, f, "gateway_refunds", bson.M{"idempotencyKey": "cross-tenant-refund"}, 0)
	pending, err := f.store.Refund(ctx, f.principal, p.ID, 100_000, "recover-full-refund")
	if err != nil || pending.Status != "pending" {
		t.Fatalf("pending refund %+v %v", pending, err)
	}
	f.node(t, "mine", f.identities["merchant"].UserID)
	paid, err := f.store.Refund(ctx, f.principal, p.ID, 100_000, "recover-full-refund")
	if err != nil || paid.Status != "succeeded" || paid.ID != pending.ID {
		t.Fatalf("refund recovery %+v %v", paid, err)
	}
	if f.balance(t, "payer") != 1_000_000 || f.balance(t, "merchant") != 999_000 {
		t.Fatal("funded full refund projections wrong")
	}
	count(t, f, "transactions", bson.M{"type": "merchant_refund"}, 1)
	stored, err := f.store.Payment(ctx, f.principal.App.ID, p.ID)
	if err != nil || stored.Refunded != 100_000 {
		t.Fatalf("full refund projection %+v %v", stored, err)
	}
	f.reconcile(t)
}

func TestRefundOmittedAmountReplaysStableIntentAndReason(t *testing.T) {
	f := newFixture(t)
	p, a := f.checkout(t, 100_000, "")
	ctx := context.Background()
	if _, err := f.confirm(p, a); err != nil {
		t.Fatal(err)
	}
	f.node(t, "mine", f.identities["merchant"].UserID)
	paid, err := f.store.RefundRequest(ctx, f.principal, p.ID, "", "full-refund-remaining", "Customer requested cancellation")
	if err != nil || paid.Status != "succeeded" || paid.Amount != 100_000 {
		t.Fatalf("full refund %+v %v", paid, err)
	}
	replay, err := f.store.RefundRequest(ctx, f.principal, p.ID, "", "full-refund-remaining", "Customer requested cancellation")
	if err != nil || replay.ID != paid.ID || replay.TransactionID != paid.TransactionID {
		t.Fatalf("omitted amount replay %+v %v", replay, err)
	}
	_, err = f.store.RefundRequest(ctx, f.principal, p.ID, "10.0000", "full-refund-remaining", "Customer requested cancellation")
	requireCode(t, err, "idempotency_key_reused")
	_, err = f.store.RefundRequest(ctx, f.principal, p.ID, "", "full-refund-remaining", "Different reason")
	requireCode(t, err, "idempotency_key_reused")
	count(t, f, "transactions", bson.M{"type": "merchant_refund"}, 1)
	if f.balance(t, "payer") != 1_000_000 {
		t.Fatal("replay moved refunded money twice")
	}
	f.reconcile(t)
}
