//go:build integration

package mongodb_test

import (
	"context"
	"sync"
	"testing"

	"github.com/derohaze/Louma/payment-gateway/internal/domain"
	"github.com/derohaze/Louma/payment-gateway/internal/gateway"
	"github.com/derohaze/Louma/payment-gateway/internal/infrastructure/mongodb"
	"go.mongodb.org/mongo-driver/v2/bson"
)

func TestCheckoutDifferentIntentDurableIdempotency(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()
	service := &gateway.Service{Store: f.store}
	input := domain.CheckoutInput{Currency: "LMA", Subtotal: "10.0000"}
	key := mongodb.ID()
	p, err := service.Checkout(ctx, f.principal, input, key)
	if err != nil {
		t.Fatal(err)
	}
	replay, err := service.Checkout(ctx, f.principal, input, key)
	if err != nil || replay.ID != p.ID {
		t.Fatalf("checkout replay %+v %v", replay, err)
	}
	input.Subtotal = "11.0000"
	_, err = service.Checkout(ctx, f.principal, input, key)
	requireCode(t, err, "idempotency_key_reused")
	count(t, f, "gateway_payments", bson.M{"idempotencyKey": key}, 1)
	f.reconcile(t)
}

func TestCheckoutConcurrentConflictingApprovalCannotReplayDifferentSession(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()
	for round := 0; round < 12; round++ {
		p, original := f.checkout(t, 100_000, "")
		original.Key = mongodb.ID()
		original.ID = ""
		other := original
		other.SessionID = mongodb.ID()
		start := make(chan struct{})
		results := make(chan struct {
			a   domain.Approval
			err error
		}, 2)
		var wg sync.WaitGroup
		for _, intent := range []domain.Approval{original, other} {
			wg.Add(1)
			go func() {
				defer wg.Done()
				<-start
				a, err := f.store.Approve(ctx, intent)
				results <- struct {
					a   domain.Approval
					err error
				}{a, err}
			}()
		}
		close(start)
		wg.Wait()
		close(results)
		accepted := 0
		for result := range results {
			if result.err == nil {
				accepted++
			} else {
				requireCode(t, result.err, "idempotency_key_reused")
			}
		}
		if accepted != 1 {
			t.Fatalf("round %d: %d conflicting sessions were acknowledged for same approval key", round, accepted)
		}
		count(t, f, "gateway_approvals", bson.M{"paymentId": p.ID, "idempotencyKey": original.Key}, 1)
	}
	f.reconcile(t)
}
