package mongodb

import (
	"context"
	"errors"
	"time"

	"github.com/derohaze/Louma/payment-gateway/internal/domain"
	"go.mongodb.org/mongo-driver/v2/bson"
	"go.mongodb.org/mongo-driver/v2/mongo"
	"go.mongodb.org/mongo-driver/v2/mongo/options"
)

func (s *Store) FirstSubscription(ctx context.Context, p *domain.Payment, a domain.Approval) error {
	price, err := s.Price(ctx, p.AppID, p.PriceID)
	if err != nil {
		return err
	}
	if price.Amount != p.Total || price.Interval != p.Interval {
		return domain.Reject("price_changed", 409)
	}
	now := time.Now().UTC()
	due, err := domain.Period(now, p.Interval, 1)
	if err != nil {
		return err
	}
	p.SubscriptionID = ID()
	p.InvoiceID = ID()
	sub := domain.Subscription{ID: p.SubscriptionID, AppID: p.AppID, ReceivingWalletID: p.WalletID, PayerID: a.Owner, WalletID: a.WalletID, PriceID: price.ID, PriceVersion: price.Version, Amount: p.Total, Interval: p.Interval, Status: "active", MandateActive: true, ConsentAt: now, Policy: a.Policy, Anchor: now, Cycle: 1, DueAt: due, CreatedAt: now}
	if _, err = s.C("gateway_subscriptions").InsertOne(ctx, sub); err != nil {
		return err
	}
	inv := domain.Invoice{ID: p.InvoiceID, AppID: p.AppID, SubscriptionID: sub.ID, Cycle: 0, Amount: p.Total, Fee: p.Fee, FeePolicy: p.FeePolicy, Status: "paid", PaymentID: p.ID, Start: now, End: due, DueAt: now, CreatedAt: now}
	if _, err = s.C("gateway_invoices").InsertOne(ctx, inv); err != nil {
		return err
	}
	if err = s.Event(ctx, p.AppID, "subscription.created", sub.ID); err != nil {
		return err
	}
	return s.Event(ctx, p.AppID, "invoice.paid", inv.ID)
}
func (s *Store) CancelSubscription(ctx context.Context, app, owner, id string, atEnd bool) error {
	return s.Transaction(ctx, func(tx context.Context) error {
		filter := bson.M{"publicId": id}
		if app != "" {
			filter["applicationId"] = app
		} else {
			filter["payerUserId"] = owner
		}
		set := bson.M{"cancelAtEnd": atEnd}
		kind := "subscription.cancellation_scheduled"
		if !atEnd {
			set["status"] = "canceled"
			set["mandateActive"] = false
			kind = "subscription.canceled"
		}
		var sub domain.Subscription
		if err := s.C("gateway_subscriptions").FindOne(tx, filter).Decode(&sub); err != nil {
			return Missing(err)
		}
		if sub.Status == "canceled" || atEnd && sub.CancelAtEnd {
			return nil
		}
		if sub.Status != "active" && sub.Status != "past_due" && sub.Status != "paused" {
			return domain.Reject("invalid_transition", 409)
		}
		result, err := s.C("gateway_subscriptions").UpdateOne(tx, filter, bson.M{"$set": set, "$inc": bson.M{"version": int32(1)}})
		if err = Changed(result, err, "subscription_changed"); err != nil {
			return err
		}
		return s.Event(tx, sub.AppID, kind, id)
	})
}
func (s *Store) Schedule(ctx context.Context, now time.Time) error {
	cur, err := s.C("gateway_subscriptions").Find(ctx, bson.M{"status": bson.M{"$in": bson.A{"active", "past_due"}}, "dueAt": bson.M{"$lte": now}}, options.Find().SetLimit(50).SetSort(bson.D{{Key: "dueAt", Value: 1}}))
	if err != nil {
		return err
	}
	defer cur.Close(ctx)
	rows := []domain.Subscription{}
	if err = cur.All(ctx, &rows); err != nil {
		return err
	}
	for _, candidate := range rows {
		invoiceID, paymentID := ID(), ID()
		err = s.Transaction(ctx, func(tx context.Context) error {
			var sub domain.Subscription
			if err := s.C("gateway_subscriptions").FindOne(tx, bson.M{"publicId": candidate.ID}).Decode(&sub); err != nil {
				return err
			}
			if sub.Status == "canceled" || sub.Status == "paused" || sub.DueAt.After(now) {
				return nil
			}
			if sub.CancelAtEnd || !sub.MandateActive {
				_, err := s.C("gateway_subscriptions").UpdateOne(tx, bson.M{"publicId": sub.ID}, bson.M{"$set": bson.M{"status": "canceled", "mandateActive": false}, "$inc": bson.M{"version": int32(1)}})
				if err != nil {
					return err
				}
				return s.Event(tx, sub.AppID, "subscription.canceled", sub.ID)
			}
			var prior domain.Invoice
			err := s.C("gateway_invoices").FindOne(tx, bson.M{"subscriptionId": sub.ID, "cycle": sub.Cycle}).Decode(&prior)
			if err == nil {
				return nil
			}
			if !errors.Is(err, mongo.ErrNoDocuments) {
				return err
			}
			end, err := domain.Period(sub.Anchor, sub.Interval, sub.Cycle+1)
			if err != nil {
				return err
			}
			fee, err := s.Config.Fee.Fee(sub.Amount)
			if err != nil {
				return err
			}
			inv := domain.Invoice{ID: invoiceID, AppID: sub.AppID, SubscriptionID: sub.ID, Cycle: sub.Cycle, Amount: sub.Amount, Fee: fee, FeePolicy: s.Config.Fee, Status: "open", PaymentID: paymentID, Start: sub.DueAt, End: end, DueAt: sub.DueAt, CreatedAt: now}
			_, err = s.C("gateway_invoices").InsertOne(tx, inv)
			return err
		})
		if err != nil && !mongo.IsDuplicateKeyError(err) {
			return err
		}
	}
	return nil
}
func (s *Store) ClaimInvoice(ctx context.Context, now time.Time) (domain.Invoice, error) {
	var inv domain.Invoice
	err := s.C("gateway_invoices").FindOneAndUpdate(ctx, bson.M{"status": "open", "dueAt": bson.M{"$lte": now}, "leaseUntil": bson.M{"$lte": now}}, bson.M{"$set": bson.M{"leaseUntil": now.Add(30 * time.Second)}, "$inc": bson.M{"fence": int32(1)}}, options.FindOneAndUpdate().SetSort(bson.D{{Key: "dueAt", Value: 1}}).SetReturnDocument(options.After)).Decode(&inv)
	return inv, err
}
func (s *Store) Renew(ctx context.Context, claim domain.Invoice, now time.Time) error {
	err := s.Transaction(ctx, func(tx context.Context) error {
		var invoice domain.Invoice
		if err := s.C("gateway_invoices").FindOne(tx, bson.M{"publicId": claim.ID, "status": "open", "fence": claim.Fence, "leaseUntil": bson.M{"$gt": now}}).Decode(&invoice); err != nil {
			return Missing(err)
		}
		var sub domain.Subscription
		if err := s.C("gateway_subscriptions").FindOne(tx, bson.M{"publicId": invoice.SubscriptionID}).Decode(&sub); err != nil {
			return err
		}
		if !sub.MandateActive || sub.CancelAtEnd || sub.Status == "canceled" || sub.Status == "paused" {
			_, err := s.C("gateway_invoices").UpdateOne(tx, bson.M{"publicId": invoice.ID, "fence": claim.Fence}, bson.M{"$set": bson.M{"status": "void", "leaseUntil": time.Time{}}})
			return err
		}
		if sub.Cycle != invoice.Cycle || sub.Amount != invoice.Amount {
			return domain.Reject("mandate_mismatch", 409)
		}
		price, err := s.Price(tx, sub.AppID, sub.PriceID)
		if err != nil {
			return err
		}
		if price.Version != sub.PriceVersion || price.Amount != sub.Amount || price.Interval != sub.Interval {
			return domain.Reject("reauthorization_required", 409)
		}
		var app domain.Application
		if err = s.C("gateway_applications").FindOne(tx, bson.M{"publicId": sub.AppID}).Decode(&app); err != nil {
			return err
		}
		if sub.ReceivingWalletID == "" || sub.ReceivingWalletID != app.WalletID {
			return domain.Reject("reauthorization_required", 409)
		}
		p := domain.Payment{ID: invoice.PaymentID, AppID: sub.AppID, WalletID: app.WalletID, MerchantName: app.Name, Subtotal: invoice.Amount, Total: invoice.Amount, Fee: invoice.Fee, Net: invoice.Amount - invoice.Fee, FeePolicy: invoice.FeePolicy, Description: "Subscription renewal", Status: "requires_action", Key: "invoice:" + invoice.ID, Fingerprint: invoice.ID, IntentHash: invoice.ID, PayerID: sub.PayerID, PayerWalletID: sub.WalletID, PriceID: sub.PriceID, Interval: sub.Interval, SubscriptionID: sub.ID, InvoiceID: invoice.ID, Metadata: map[string]string{}, CreatedAt: now, ExpiresAt: now.Add(time.Hour)}
		if _, err = s.C("gateway_payments").InsertOne(tx, p); err != nil {
			return err
		}
		if err = s.SettlePayment(tx, &p); err != nil {
			return err
		}
		result, err := s.C("gateway_invoices").UpdateOne(tx, bson.M{"publicId": invoice.ID, "status": "open", "fence": claim.Fence}, bson.M{"$set": bson.M{"status": "paid", "leaseUntil": time.Time{}}})
		if err = Changed(result, err, "invoice_claim_lost"); err != nil {
			return err
		}
		result, err = s.C("gateway_subscriptions").UpdateOne(tx, bson.M{"publicId": sub.ID, "mandateActive": true, "cycle": invoice.Cycle, "status": bson.M{"$in": bson.A{"active", "past_due"}}}, bson.M{"$set": bson.M{"status": "active", "dueAt": invoice.End}, "$inc": bson.M{"cycle": int32(1), "version": int32(1)}})
		if err = Changed(result, err, "mandate_revoked"); err != nil {
			return err
		}
		if err = s.Event(tx, sub.AppID, "invoice.paid", invoice.ID); err != nil {
			return err
		}
		return s.Event(tx, sub.AppID, "subscription.renewed", sub.ID)
	})
	if err == nil {
		return nil
	}
	// Never turn an uncertain database outcome into a payment failure or fresh identity.
	var landed domain.Invoice
	if readErr := s.C("gateway_invoices").FindOne(ctx, bson.M{"publicId": claim.ID}).Decode(&landed); readErr != nil {
		return err
	}
	if landed.Status == "paid" || landed.Status == "void" {
		return nil
	}
	var rejection *domain.Error
	if !errors.As(err, &rejection) || rejection.Status >= 500 {
		return err
	}
	return s.Transaction(ctx, func(tx context.Context) error {
		var sub domain.Subscription
		if readErr := s.C("gateway_subscriptions").FindOne(tx, bson.M{"publicId": claim.SubscriptionID}).Decode(&sub); readErr != nil {
			return readErr
		}
		if !sub.MandateActive || sub.Status == "canceled" {
			_, e := s.C("gateway_invoices").UpdateOne(tx, bson.M{"publicId": claim.ID, "fence": claim.Fence, "status": "open"}, bson.M{"$set": bson.M{"status": "void", "leaseUntil": time.Time{}}})
			return e
		}
		attempt := landed.Attempts + 1
		status := "open"
		subStatus := "past_due"
		due := now.Add(24 * time.Hour)
		days := []int{1, 3, 5}
		if attempt <= 3 {
			due = claim.Start.Add(time.Duration(days[attempt-1]) * 24 * time.Hour)
		}
		if attempt >= 4 || now.After(claim.Start.Add(7*24*time.Hour)) {
			status = "uncollectible"
			subStatus = "paused"
			attempt = min(attempt, 4)
		}
		result, e := s.C("gateway_invoices").UpdateOne(tx, bson.M{"publicId": claim.ID, "fence": claim.Fence, "status": "open"}, bson.M{"$set": bson.M{"status": status, "attempts": attempt, "dueAt": due, "leaseUntil": time.Time{}}})
		if e = Changed(result, e, "invoice_claim_lost"); e != nil {
			return e
		}
		result, e = s.C("gateway_subscriptions").UpdateOne(tx, bson.M{"publicId": sub.ID, "mandateActive": true, "status": bson.M{"$in": bson.A{"active", "past_due"}}}, bson.M{"$set": bson.M{"status": subStatus}, "$inc": bson.M{"version": int32(1)}})
		if e = Changed(result, e, "mandate_revoked"); e != nil {
			return e
		}
		if e = s.Event(tx, sub.AppID, "invoice.payment_failed", claim.ID); e != nil {
			return e
		}
		return s.Event(tx, sub.AppID, "subscription.past_due", sub.ID)
	})
}
