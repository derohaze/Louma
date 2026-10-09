//go:build integration

package mongodb_test

import (
	"context"
	"testing"

	"go.mongodb.org/mongo-driver/v2/bson"
)

func TestSettlementUnknownCommitAcknowledgementRecovery(t *testing.T) {
	f := newFixture(t)
	p, a := f.checkout(t, 100_000, "")
	ctx := context.Background()
	// Only this test's application-named Mongo client can trigger the failpoint.
	// The actual commit executes, but its first acknowledgement is an unknown outcome.
	command := bson.D{{Key: "configureFailPoint", Value: "failCommand"}, {Key: "mode", Value: bson.M{"times": 1}}, {Key: "data", Value: bson.M{"failCommands": bson.A{"commitTransaction"}, "appName": f.store.Config.Database, "writeConcernError": bson.M{"code": 64, "errmsg": "integration lost commit acknowledgement"}, "errorLabels": bson.A{"UnknownTransactionCommitResult"}}}}
	var before struct {
		Count int64 `bson:"count"`
	}
	if err := f.store.Client.Database("admin").RunCommand(ctx, command).Decode(&before); err != nil {
		t.Fatalf("isolated Mongo enableTestCommands=1 required for commit failure injection: %v", err)
	}
	t.Cleanup(func() {
		var after struct {
			Count int64 `bson:"count"`
		}
		if err := f.store.Client.Database("admin").RunCommand(context.Background(), bson.D{{Key: "configureFailPoint", Value: "failCommand"}, {Key: "mode", Value: "off"}}).Decode(&after); err != nil {
			t.Errorf("disable own commit failpoint: %v", err)
		} else if after.Count != before.Count+1 {
			t.Errorf("commit failure injection was not exercised exactly once: before=%d after=%d", before.Count, after.Count)
		}
	})
	paid, err := f.confirm(p, a)
	if err != nil || paid.Status != "succeeded" {
		t.Fatalf("unknown commit recovery %+v %v", paid, err)
	}
	replay, err := f.confirm(p, a)
	if err != nil || replay.TransactionID != paid.TransactionID {
		t.Fatalf("retry changed settled identity %+v %v", replay, err)
	}
	count(t, f, "transactions", bson.M{"operationId": p.ID}, 1)
	if f.balance(t, "payer") != 900_000 || f.balance(t, "merchant") != 99_000 {
		t.Fatal("unknown commit duplicated financial movement")
	}
	f.reconcile(t)
}
