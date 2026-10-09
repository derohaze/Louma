//go:build integration

package mongodb_test

import (
	"context"
	"encoding/base64"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/derohaze/Louma/payment-gateway/internal/domain"
	"go.mongodb.org/mongo-driver/v2/bson"
)

func TestArchitectureBenchmarkOnIsolatedFinancialFixture(t *testing.T) {
	f := newFixture(t)
	f.node(t, "transfer", f.identities["payer"].UserID, f.identities["merchant"].WalletID)
	f.node(t, "mine", f.identities["payer"].UserID)
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, "node", "--import", "tsx", "src/tests/architecture-benchmark.ts")
	cmd.Dir = filepath.Join(f.root, "back-end")
	cmd.Env = append(os.Environ(), "NODE_ENV=test", "MONGODB_URI="+f.uri, "MONGODB_DATABASE="+f.store.Config.Database, "ACCESS_TOKEN_SECRET="+base64.StdEncoding.EncodeToString([]byte(strings.Repeat("a", 32))), "APP_ENCRYPTION_KEY="+base64.StdEncoding.EncodeToString([]byte(strings.Repeat("b", 32))), "REDIS_URL=redis://127.0.0.1:6387/13", "REDIS_KEY_PREFIX="+f.store.Config.Database[:32])
	out, err := cmd.CombinedOutput()
	if err != nil || !strings.Contains(string(out), "BENCHMARK_DONE") {
		t.Fatalf("architecture benchmark: %v\n%s", err, out)
	}
	t.Logf("Existing Node architecture benchmark on disposable strict-schema DB:\n%s", out)
	f.reconcile(t)
}

func TestSettlementContentionMeasurements(t *testing.T) {
	f := newFixture(t)
	const jobs = 24
	type task struct {
		p domain.Payment
		a domain.Approval
	}
	queue := make(chan task, jobs)
	for i := 0; i < jobs; i++ {
		p, a := f.checkout(t, 1_000, "")
		queue <- task{p, a}
	}
	close(queue)
	var wg sync.WaitGroup
	var lock sync.Mutex
	samples := make([]time.Duration, 0, jobs)
	type outcome struct {
		job task
		err error
	}
	errs := make(chan outcome, jobs)
	retriesBefore := f.store.Retries.Load()
	start := time.Now()
	for worker := 0; worker < 4; worker++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for job := range queue {
				began := time.Now()
				var err error
				for attempt := 0; attempt < 5; attempt++ {
					_, err = f.confirm(job.p, job.a)
					if err == nil {
						break
					}
					if attempt < 4 {
						time.Sleep(time.Duration(attempt+1) * 5 * time.Millisecond)
					}
				}
				lock.Lock()
				samples = append(samples, time.Since(began))
				lock.Unlock()
				errs <- outcome{job, err}
			}
		}()
	}
	wg.Wait()
	elapsed := time.Since(start)
	close(errs)
	failed := []task{}
	for result := range errs {
		if result.err != nil {
			var rejection *domain.Error
			if !errors.As(result.err, &rejection) || rejection.Code != "transaction_conflict" || rejection.Status != 503 {
				t.Fatal(result.err)
			}
			failed = append(failed, result.job)
		}
	}
	successes := jobs - len(failed)
	sort.Slice(samples, func(i, j int) bool { return samples[i] < samples[j] })
	t.Logf("synthetic shared payer/merchant/revenue contention: jobs=%d workers=4 successes=%d retryable_failures_after_5_calls=%d elapsed=%s committed_throughput=%.2f settlements/s p50=%s p95=%s p99=%s transaction_retries=%d", jobs, successes, len(failed), elapsed, float64(successes)/elapsed.Seconds(), samples[len(samples)/2], samples[len(samples)*95/100], samples[len(samples)-1], f.store.Retries.Load()-retriesBefore)
	if f.balance(t, "payer") != 1_000_000-int64(successes)*1_000 || f.balance(t, "merchant") != int64(successes)*990 {
		t.Fatal("contention failure retained uncommitted money")
	}
	count(t, f, "transactions", bson.M{"type": "merchant_payment"}, int64(successes))
	// A caller replays the original identities after contention subsides; no new payment identity.
	for _, job := range failed {
		if _, err := f.confirm(job.p, job.a); err != nil {
			t.Fatalf("serial recovery of original payment: %v", err)
		}
	}
	if f.balance(t, "payer") != 1_000_000-jobs*1_000 || f.balance(t, "merchant") != jobs*990 {
		t.Fatal("load projections wrong")
	}
	count(t, f, "transactions", bson.M{"type": "merchant_payment"}, jobs)
	f.reconcile(t)
}
