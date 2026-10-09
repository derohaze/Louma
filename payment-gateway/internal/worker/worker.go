package worker

import (
	"bytes"
	"context"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"time"

	"github.com/derohaze/Louma/payment-gateway/internal/infrastructure/mongodb"
	"github.com/derohaze/Louma/payment-gateway/internal/security"
	"go.mongodb.org/mongo-driver/v2/mongo"
)

type Worker struct {
	Store  *mongodb.Store
	Logger *slog.Logger
	Client *http.Client
}

func (w *Worker) Tick(ctx context.Context, now time.Time) error {
	if !w.Store.Config.BillingPaused && !w.Store.Config.SettlementPaused && !w.Store.Config.MerchantPaused {
		if err := w.Store.Schedule(ctx, now); err != nil {
			return err
		}
		for range 16 {
			invoice, err := w.Store.ClaimInvoice(ctx, now)
			if errors.Is(err, mongo.ErrNoDocuments) {
				break
			}
			if err != nil {
				return err
			}
			if err = w.Store.Renew(ctx, invoice, now); err != nil {
				w.Logger.Warn("invoice_retry_required", "invoice_id", invoice.ID)
			}
		}
	}
	if err := w.Store.ExpandEvents(ctx, now); err != nil {
		return err
	}
	for range 16 {
		delivery, err := w.Store.ClaimDelivery(ctx, now)
		if errors.Is(err, mongo.ErrNoDocuments) {
			break
		}
		if err != nil {
			return err
		}
		endpoint, body, err := w.Store.DeliveryPayload(ctx, delivery)
		status := 0
		if err == nil {
			secret, e := security.Decrypt(w.Store.Config.EncryptionKey, endpoint.Secret)
			err = e
			if err == nil {
				req, e := http.NewRequestWithContext(ctx, "POST", endpoint.URL, bytes.NewReader(body))
				err = e
				if err == nil {
					req.Header.Set("Content-Type", "application/json")
					req.Header.Set("Louma-Signature", security.Signature(secret, body, now))
					req.Header.Set("Louma-Event-Id", delivery.EventID)
					response, e := w.Client.Do(req)
					err = e
					if response != nil {
						status = response.StatusCode
						io.Copy(io.Discard, io.LimitReader(response.Body, 4096))
						response.Body.Close()
					}
				}
			}
		}
		if err = w.Store.FinishDelivery(ctx, delivery, status, now); err != nil {
			return err
		}
	}
	return nil
}
func (w *Worker) Run(ctx context.Context) error {
	ticker := time.NewTicker(time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return nil
		case now := <-ticker.C:
			if err := w.Tick(ctx, now.UTC()); err != nil {
				w.Logger.Error("worker_tick_failed", "retryable", true)
			}
		}
	}
}
