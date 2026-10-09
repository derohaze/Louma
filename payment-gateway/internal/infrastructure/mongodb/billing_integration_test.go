//go:build integration

package mongodb_test

import (
	"context"
	"sync"
	"testing"
	"time"

	"github.com/derohaze/Louma/payment-gateway/internal/domain"
	"github.com/derohaze/Louma/payment-gateway/internal/infrastructure/mongodb"
	"go.mongodb.org/mongo-driver/v2/bson"
	"go.mongodb.org/mongo-driver/v2/mongo"
)

func (f *fixture) subscription(t *testing.T, amount int64, interval string, anchor time.Time) domain.Subscription {
	t.Helper()
	ctx := context.Background()
	product := domain.Product{ID: mongodb.ID(), AppID: f.principal.App.ID, Name: "Contract plan", Status: "active", CreatedAt: time.Now().UTC()}
	if _, err := f.store.C("gateway_products").InsertOne(ctx, product); err != nil {
		t.Fatal(err)
	}
	price := domain.Price{ID: mongodb.ID(), AppID: product.AppID, ProductID: product.ID, Amount: amount, Interval: interval, Version: 1, Status: "active", CreatedAt: time.Now().UTC()}
	if _, err := f.store.C("gateway_prices").InsertOne(ctx, price); err != nil {
		t.Fatal(err)
	}
	p, a := f.checkout(t, amount, price.ID)
	paid, err := f.confirm(p, a)
	if err != nil || paid.SubscriptionID == "" {
		t.Fatalf("first recurring payment %+v %v", paid, err)
	}
	due, err := domain.Period(anchor, interval, 1)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = f.store.C("gateway_subscriptions").UpdateOne(ctx, bson.M{"publicId": paid.SubscriptionID}, bson.M{"$set": bson.M{"anchorAt": anchor, "dueAt": due}}); err != nil {
		t.Fatal(err)
	}
	var sub domain.Subscription
	if err := f.store.C("gateway_subscriptions").FindOne(ctx, bson.M{"publicId": paid.SubscriptionID}).Decode(&sub); err != nil {
		t.Fatal(err)
	}
	return sub
}

func TestBillingCalendarRenewalDuplicateWorkersAndCrashLease(t *testing.T) {
	for _, tc := range []struct {
		name, interval  string
		anchor, wantEnd time.Time
	}{
		{"month_end_leap_year", "month", time.Date(2024, 1, 31, 12, 0, 0, 0, time.UTC), time.Date(2024, 3, 31, 12, 0, 0, 0, time.UTC)},
		{"year_leap_day", "year", time.Date(2024, 2, 29, 12, 0, 0, 0, time.UTC), time.Date(2026, 2, 28, 12, 0, 0, 0, time.UTC)},
	} {
		t.Run(tc.name, func(t *testing.T) {
			f := newFixture(t)
			sub := f.subscription(t, 100_000, tc.interval, tc.anchor)
			now := sub.DueAt.Add(time.Second)
			ctx := context.Background()
			for i := 0; i < 2; i++ {
				if err := f.store.Schedule(ctx, now); err != nil {
					t.Fatal(err)
				}
			}
			count(t, f, "gateway_invoices", bson.M{"subscriptionId": sub.ID, "cycle": int32(1)}, 1)
			claim, err := f.store.ClaimInvoice(ctx, now)
			if err != nil || !claim.End.Equal(tc.wantEnd) {
				t.Fatalf("claim %+v %v", claim, err)
			}
			if _, err := f.store.ClaimInvoice(ctx, now); err != mongo.ErrNoDocuments {
				t.Fatalf("second worker got same lease: %v", err)
			}
			// Worker dies before settling; a new process recovers the original invoice after lease expiry.
			restarted, err := mongodb.Open(ctx, f.store.Config)
			if err != nil {
				t.Fatal(err)
			}
			defer restarted.Client.Disconnect(ctx)
			recoveryNow := now.Add(31 * time.Second)
			fresh, err := restarted.ClaimInvoice(ctx, recoveryNow)
			if err != nil || fresh.ID != claim.ID || fresh.Fence != claim.Fence+1 {
				t.Fatalf("lease recovery %+v %v", fresh, err)
			}
			if err = f.store.Renew(ctx, claim, recoveryNow); err == nil {
				t.Fatal("stale worker was allowed to renew")
			}
			if err = restarted.Renew(ctx, fresh, recoveryNow); err != nil {
				t.Fatal(err)
			}
			// Crash after commit but before acknowledgement: replay must preserve one identity.
			if err = restarted.Renew(ctx, fresh, recoveryNow); err != nil {
				t.Fatal(err)
			}
			count(t, f, "transactions", bson.M{"type": "merchant_payment"}, 2)
			count(t, f, "gateway_payments", bson.M{"invoiceId": fresh.ID}, 1)
			if f.balance(t, "payer") != 800_000 || f.balance(t, "merchant") != 198_000 {
				t.Fatal("renewal projections wrong")
			}
			f.reconcile(t)
		})
	}
}

func TestBillingCancellationAndMandateRevocationPreventRenewal(t *testing.T) {
	for _, mode := range []string{"cancel_before_schedule", "cancel_after_claim", "mandate_revoked", "cancel_at_period_end"} {
		t.Run(mode, func(t *testing.T) {
			f := newFixture(t)
			sub := f.subscription(t, 100_000, "month", time.Date(2024, 1, 31, 12, 0, 0, 0, time.UTC))
			ctx := context.Background()
			now := sub.DueAt.Add(time.Second)
			if mode == "cancel_before_schedule" {
				if err := f.store.CancelSubscription(ctx, "", sub.PayerID, sub.ID, false); err != nil {
					t.Fatal(err)
				}
				if err := f.store.Schedule(ctx, now); err != nil {
					t.Fatal(err)
				}
				count(t, f, "gateway_invoices", bson.M{"subscriptionId": sub.ID, "cycle": int32(1)}, 0)
			} else {
				if err := f.store.Schedule(ctx, now); err != nil {
					t.Fatal(err)
				}
				claim, err := f.store.ClaimInvoice(ctx, now)
				if err != nil {
					t.Fatal(err)
				}
				if mode == "mandate_revoked" {
					_, err = f.store.C("gateway_subscriptions").UpdateOne(ctx, bson.M{"publicId": sub.ID}, bson.M{"$set": bson.M{"mandateActive": false}, "$inc": bson.M{"version": int32(1)}})
				} else {
					err = f.store.CancelSubscription(ctx, "", sub.PayerID, sub.ID, mode == "cancel_at_period_end")
				}
				if err != nil {
					t.Fatal(err)
				}
				if err = f.store.Renew(ctx, claim, now); err != nil {
					t.Fatal(err)
				}
				count(t, f, "gateway_invoices", bson.M{"publicId": claim.ID, "status": "void"}, 1)
			}
			if f.balance(t, "payer") != 900_000 {
				t.Fatal("canceled mandate charged payer")
			}
			count(t, f, "transactions", bson.M{"type": "merchant_payment"}, 1)
			f.reconcile(t)
		})
	}
}

func TestBillingConcurrentCancellationIsSerialized(t *testing.T) {
	f := newFixture(t)
	sub := f.subscription(t, 100_000, "month", time.Date(2024, 1, 31, 12, 0, 0, 0, time.UTC))
	ctx := context.Background()
	now := sub.DueAt.Add(time.Second)
	if err := f.store.Schedule(ctx, now); err != nil {
		t.Fatal(err)
	}
	claim, err := f.store.ClaimInvoice(ctx, now)
	if err != nil {
		t.Fatal(err)
	}
	start := make(chan struct{})
	results := make(chan error, 2)
	var wg sync.WaitGroup
	wg.Add(2)
	go func() { defer wg.Done(); <-start; results <- f.store.Renew(ctx, claim, now) }()
	go func() {
		defer wg.Done()
		<-start
		results <- f.store.CancelSubscription(ctx, "", sub.PayerID, sub.ID, false)
	}()
	close(start)
	wg.Wait()
	close(results)
	for err := range results {
		if err != nil {
			t.Fatal(err)
		}
	}
	var invoice domain.Invoice
	if err := f.store.C("gateway_invoices").FindOne(ctx, bson.M{"publicId": claim.ID}).Decode(&invoice); err != nil {
		t.Fatal(err)
	}
	if invoice.Status != "paid" && invoice.Status != "void" {
		t.Fatalf("unresolved cancel race %+v", invoice)
	}
	if invoice.Status == "paid" && f.balance(t, "payer") != 800_000 {
		t.Fatal("paid invoice projection mismatch")
	}
	if invoice.Status == "void" && f.balance(t, "payer") != 900_000 {
		t.Fatal("void invoice debited payer")
	}
	if err := f.store.Schedule(ctx, now.AddDate(0, 2, 0)); err != nil {
		t.Fatal(err)
	}
	count(t, f, "gateway_invoices", bson.M{"subscriptionId": sub.ID, "cycle": int32(2)}, 0)
	f.reconcile(t)
}

func TestBillingInsufficientFundsRecoveryAndGraceExpiry(t *testing.T) {
	for _, recoverFunds := range []bool{true, false} {
		name := "grace_expiration"
		if recoverFunds {
			name = "recovery_after_mining_funding"
		}
		t.Run(name, func(t *testing.T) {
			f := newFixture(t)
			sub := f.subscription(t, 600_000, "month", time.Date(2024, 1, 31, 12, 0, 0, 0, time.UTC))
			ctx := context.Background()
			now := sub.DueAt.Add(time.Second)
			if err := f.store.Schedule(ctx, now); err != nil {
				t.Fatal(err)
			}
			claim, err := f.store.ClaimInvoice(ctx, now)
			if err != nil {
				t.Fatal(err)
			}
			if err = f.store.Renew(ctx, claim, now); err != nil {
				t.Fatal(err)
			}
			if f.balance(t, "payer") != 400_000 {
				t.Fatal("insufficient renewal debited payer")
			}
			count(t, f, "transactions", bson.M{"type": "merchant_payment"}, 1)
			count(t, f, "gateway_payments", bson.M{"invoiceId": claim.ID}, 0)
			var invoice domain.Invoice
			if err := f.store.C("gateway_invoices").FindOne(ctx, bson.M{"publicId": claim.ID}).Decode(&invoice); err != nil {
				t.Fatal(err)
			}
			if invoice.Attempts != 1 || invoice.Status != "open" || !invoice.DueAt.Equal(claim.Start.Add(24*time.Hour)) {
				t.Fatalf("retry schedule %+v", invoice)
			}
			if recoverFunds {
				f.node(t, "mine", sub.PayerID)
				// An already-issued invoice keeps its authorized fee even if policy changes before retry.
				f.store.Config.Fee.BasisPoints = 200
				claim, err = f.store.ClaimInvoice(ctx, invoice.DueAt.Add(time.Second))
				if err != nil {
					t.Fatal(err)
				}
				if err = f.store.Renew(ctx, claim, invoice.DueAt.Add(time.Second)); err != nil {
					t.Fatal(err)
				}
				if f.balance(t, "payer") != 800_000 || f.balance(t, "merchant") != 1_188_000 {
					t.Fatal("funded retry or fee snapshot failed")
				}
				count(t, f, "gateway_invoices", bson.M{"publicId": claim.ID, "status": "paid"}, 1)
				count(t, f, "transactions", bson.M{"type": "merchant_payment"}, 2)
			} else {
				for attempt := int32(2); attempt <= 4; attempt++ {
					now = invoice.DueAt.Add(time.Second)
					claim, err = f.store.ClaimInvoice(ctx, now)
					if err != nil {
						t.Fatal(err)
					}
					if err = f.store.Renew(ctx, claim, now); err != nil {
						t.Fatal(err)
					}
					if err = f.store.C("gateway_invoices").FindOne(ctx, bson.M{"publicId": claim.ID}).Decode(&invoice); err != nil {
						t.Fatal(err)
					}
					if invoice.Attempts != attempt {
						t.Fatalf("attempt got %d wanted %d", invoice.Attempts, attempt)
					}
				}
				if invoice.Status != "uncollectible" {
					t.Fatalf("grace did not expire %+v", invoice)
				}
				count(t, f, "gateway_subscriptions", bson.M{"publicId": sub.ID, "status": "paused"}, 1)
				if f.balance(t, "payer") != 400_000 {
					t.Fatal("grace failure charged payer")
				}
			}
			f.reconcile(t)
		})
	}
}

func TestBillingPriceAndReceivingWalletChangesRequireReauthorization(t *testing.T) {
	for _, change := range []string{"price_version", "receiving_wallet"} {
		t.Run(change, func(t *testing.T) {
			f := newFixture(t)
			sub := f.subscription(t, 100_000, "month", time.Date(2024, 1, 31, 12, 0, 0, 0, time.UTC))
			ctx := context.Background()
			now := sub.DueAt.Add(time.Second)
			if err := f.store.Schedule(ctx, now); err != nil {
				t.Fatal(err)
			}
			claim, err := f.store.ClaimInvoice(ctx, now)
			if err != nil {
				t.Fatal(err)
			}
			if change == "price_version" {
				_, err = f.store.C("gateway_prices").UpdateOne(ctx, bson.M{"publicId": sub.PriceID}, bson.M{"$inc": bson.M{"version": int32(1)}})
			} else {
				_, err = f.store.C("gateway_applications").UpdateOne(ctx, bson.M{"publicId": sub.AppID}, bson.M{"$set": bson.M{"walletId": f.identities["otherMerchant"].WalletID}, "$inc": bson.M{"version": int32(1)}})
			}
			if err != nil {
				t.Fatal(err)
			}
			if err = f.store.Renew(ctx, claim, now); err != nil {
				t.Fatal(err)
			}
			if f.balance(t, "payer") != 900_000 || f.balance(t, "otherMerchant") != 0 {
				t.Fatal("changed mandate debited payer or diverted settlement")
			}
			count(t, f, "gateway_payments", bson.M{"invoiceId": claim.ID}, 0)
			count(t, f, "transactions", bson.M{"type": "merchant_payment"}, 1)
			f.reconcile(t)
		})
	}
}
