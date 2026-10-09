//go:build integration

package mongodb_test

import (
	"encoding/json"
	"testing"

	"go.mongodb.org/mongo-driver/v2/bson"
)

func TestSettlementCoexistsWithRealNodeTransfersAndMining(t *testing.T) {
	f := newFixture(t)
	// Real Node credential policy, durable approval, atomic transfer and replay.
	f.node(t, "transfer", f.identities["payer2"].UserID, f.identities["merchant"].WalletID)
	p, a := f.checkout(t, 100_000, "")
	if _, err := f.confirm(p, a); err != nil {
		t.Fatal(err)
	}
	f.node(t, "receipt", f.identities["payer"].UserID, p.ID)
	f.node(t, "receipt", f.identities["merchant"].UserID, p.ID)
	// Existing mining settlement posts issuance exactly once; Go then spends its durable projection.
	var reward struct {
		PostedMinor int64 `json:"postedMinor"`
		Journals    int64 `json:"journals"`
	}
	if err := json.Unmarshal(f.node(t, "mine", f.identities["payer"].UserID), &reward); err != nil {
		t.Fatal(err)
	}
	if reward.PostedMinor != 1_000_000 || reward.Journals != 1 {
		t.Fatalf("mining %+v", reward)
	}
	p, a = f.checkout(t, 1_100_000, "")
	if _, err := f.confirm(p, a); err != nil {
		t.Fatal(err)
	}
	if f.balance(t, "payer") != 800_000 || f.balance(t, "payer2") != 900_000 || f.balance(t, "merchant") != 1_287_000 {
		t.Fatal("mixed Node/Go projections disagree")
	}
	count(t, f, "transactions", bson.M{"type": "transfer"}, 1)
	count(t, f, "transactions", bson.M{"type": "merchant_payment"}, 2)
	f.reconcile(t)
}
