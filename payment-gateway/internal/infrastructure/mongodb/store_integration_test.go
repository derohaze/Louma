//go:build integration

package mongodb_test

import (
	"context"
	"encoding/json"
	"errors"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"

	"github.com/derohaze/Louma/payment-gateway/internal/config"
	"github.com/derohaze/Louma/payment-gateway/internal/domain"
	"github.com/derohaze/Louma/payment-gateway/internal/gateway"
	"github.com/derohaze/Louma/payment-gateway/internal/infrastructure/mongodb"
	"go.mongodb.org/mongo-driver/v2/bson"
)

type identity struct{ UserID, SessionID, WalletID, Address string }
type fixture struct {
	store      *mongodb.Store
	principal  mongodb.Principal
	identities map[string]identity
	uri, root  string
}

// Every test uses real Node validators, wallet provisioning and journaled funding.
// Credentials and financial data are never read from developer/production env files.
func newFixture(t *testing.T) *fixture {
	t.Helper()
	uri := os.Getenv("GATEWAY_TEST_MONGODB_URI")
	if uri == "" {
		t.Fatal("set GATEWAY_TEST_MONGODB_URI to an explicit isolated loopback replica set URI")
	}
	u, err := url.Parse(uri)
	if err != nil || u.Scheme != "mongodb" || u.User != nil || u.Port() == "" || (u.Hostname() != "127.0.0.1" && u.Hostname() != "localhost" && u.Hostname() != "::1") || (u.Path != "" && u.Path != "/") {
		t.Fatal("integration tests require a credential-free loopback URI with explicit port")
	}
	_, file, _, _ := runtime.Caller(0)
	root := filepath.Clean(filepath.Join(filepath.Dir(file), "..", "..", "..", ".."))
	f := &fixture{uri: uri, root: root}
	c := config.Config{Environment: "live", MongoURI: uri, Database: "louma_gateway_test_" + mongodb.ID(), Pepper: strings.Repeat("fixture-pepper-", 4), Fee: domain.FeePolicy{Version: "integration-v1", BasisPoints: 100}}
	clientURI := *u
	query := clientURI.Query()
	query.Set("appName", c.Database)
	clientURI.RawQuery = query.Encode()
	c.MongoURI = clientURI.String()
	f.store, err = mongodb.Open(context.Background(), c)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if !strings.HasPrefix(f.store.Config.Database, "louma_gateway_test_") {
			t.Error("refusing cleanup outside isolated database")
			return
		}
		if err := f.store.DB.Drop(ctx); err != nil {
			t.Errorf("isolated database cleanup: %v", err)
		}
		if err := f.store.Client.Disconnect(ctx); err != nil {
			t.Errorf("disconnect: %v", err)
		}
	})
	var hello struct {
		SetName string `bson:"setName"`
	}
	if err = f.store.DB.RunCommand(context.Background(), bson.M{"hello": 1}).Decode(&hello); err != nil || hello.SetName == "" {
		t.Fatalf("transaction replica set required: %v", err)
	}
	var seed map[string]json.RawMessage
	if err := json.Unmarshal(f.node(t, "setup", ""), &seed); err != nil {
		t.Fatal(err)
	}
	f.identities = make(map[string]identity)
	for _, name := range []string{"payer", "payer2", "merchant", "otherMerchant"} {
		var who identity
		if err := json.Unmarshal(seed[name], &who); err != nil {
			t.Fatal(err)
		}
		f.identities[name] = who
	}
	if err = f.store.Migrate(context.Background()); err != nil {
		t.Fatal(err)
	}
	if err = f.store.Compatible(context.Background()); err != nil {
		t.Fatal(err)
	}
	merchant := f.identities["merchant"]
	app, err := f.store.CreateApplication(context.Background(), domain.Application{Owner: merchant.UserID, WalletID: merchant.WalletID, Name: "Contract Merchant", Domains: []string{"merchant.example"}})
	if err != nil {
		t.Fatal(err)
	}
	key, _, err := f.store.CreateCredential(context.Background(), mongodb.Principal{App: app}, []string{"checkout:create", "payments:read", "refunds:create"}, nil)
	if err != nil {
		t.Fatal(err)
	}
	f.principal = mongodb.Principal{App: app, Credential: key}
	return f
}

func (f *fixture) node(t *testing.T, mode, owner string, extra ...string) []byte {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	args := []string{"--import", "tsx", filepath.Join(f.root, "payment-gateway", "tests", "setup-financial.mjs"), mode, f.uri, f.store.Config.Database, owner}
	cmd := exec.CommandContext(ctx, "node", append(args, extra...)...)
	cmd.Dir = filepath.Join(f.root, "back-end")
	out, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("Node %s failed: %v\n%s", mode, err, out)
	}
	return out
}

func (f *fixture) reconcile(t *testing.T) {
	t.Helper()
	var report struct {
		OK     bool              `json:"ok"`
		Issues []json.RawMessage `json:"issues"`
	}
	if err := json.Unmarshal(f.node(t, "reconcile", ""), &report); err != nil {
		t.Fatal(err)
	}
	if !report.OK || len(report.Issues) != 0 {
		t.Fatalf("Node reconciliation failed: %+v", report)
	}
}

func (f *fixture) checkout(t *testing.T, amount int64, price string) (domain.Payment, domain.Approval) {
	t.Helper()
	p, err := (&gateway.Service{Store: f.store}).Checkout(context.Background(), f.principal, domain.CheckoutInput{Subtotal: domain.FormatMoney(amount), Currency: "LMA", Description: "Integration contract", PriceID: price}, mongodb.ID())
	if err != nil {
		t.Fatal(err)
	}
	payer := f.identities["payer"]
	a, err := f.store.Approve(context.Background(), domain.Approval{PaymentID: p.ID, Owner: payer.UserID, WalletID: payer.WalletID, SessionID: payer.SessionID, IntentHash: p.IntentHash, Key: mongodb.ID(), Proof: domain.Proof{Kind: "none"}, Consent: price != "", Policy: "2026-10-08"})
	if err != nil {
		t.Fatal(err)
	}
	return p, a
}

func (f *fixture) confirm(p domain.Payment, a domain.Approval) (domain.Payment, error) {
	return f.store.Confirm(context.Background(), a.Owner, p.ID, a.ID, p.IntentHash)
}

func (f *fixture) balance(t *testing.T, name string) int64 {
	t.Helper()
	a, err := f.store.Account(context.Background(), f.identities[name].WalletID)
	if err != nil {
		t.Fatal(err)
	}
	return a.Balance
}

func requireCode(t *testing.T, err error, code string) {
	t.Helper()
	var rejection *domain.Error
	if !errors.As(err, &rejection) || rejection.Code != code {
		t.Fatalf("wanted %s, got %v", code, err)
	}
}

func count(t *testing.T, f *fixture, collection string, filter bson.M, want int64) {
	t.Helper()
	n, err := f.store.C(collection).CountDocuments(context.Background(), filter)
	if err != nil || n != want {
		t.Fatalf("%s count: got %d want %d error=%v", collection, n, want, err)
	}
}
