package mongodb

import (
	"context"
	"time"

	"github.com/derohaze/Louma/payment-gateway/internal/domain"
	"go.mongodb.org/mongo-driver/v2/bson"
	"go.mongodb.org/mongo-driver/v2/mongo/options"
)

var collections = map[string]string{"credentials": "gateway_credentials", "checkouts": "gateway_payments", "payments": "gateway_payments", "links": "gateway_links", "products": "gateway_products", "prices": "gateway_prices", "subscriptions": "gateway_subscriptions", "invoices": "gateway_invoices", "refunds": "gateway_refunds", "webhooks": "gateway_webhooks", "deliveries": "gateway_deliveries"}

func Collection(kind string) string { return collections[kind] }
func PublicResource(kind string, row bson.M) (any, error) {
	b, err := bson.Marshal(row)
	if err != nil {
		return nil, err
	}
	var out any
	switch kind {
	case "payments", "checkouts":
		out = &domain.Payment{}
	case "credentials":
		out = &domain.Credential{}
	case "links":
		out = &domain.Link{}
	case "products":
		out = &domain.Product{}
	case "prices":
		out = &domain.Price{}
	case "subscriptions":
		out = &domain.Subscription{}
	case "invoices":
		out = &domain.Invoice{}
	case "refunds":
		out = &domain.Refund{}
	case "webhooks":
		out = &domain.Endpoint{}
	case "deliveries":
		out = &domain.Delivery{}
	default:
		return nil, domain.Reject("not_found", 404)
	}
	if err = bson.Unmarshal(b, out); err != nil {
		return nil, err
	}
	if p, ok := out.(*domain.Payment); ok {
		return p.View(), nil
	}
	return out, nil
}
func (s *Store) Resource(ctx context.Context, app, kind, id string) (any, error) {
	var row bson.M
	err := s.C(Collection(kind)).FindOne(ctx, bson.M{"publicId": id, "applicationId": app}).Decode(&row)
	if err != nil {
		return nil, Missing(err)
	}
	return PublicResource(kind, row)
}
func (s *Store) InsertResource(ctx context.Context, kind string, value any) error {
	_, err := s.C(Collection(kind)).InsertOne(ctx, value)
	return err
}
func (s *Store) ChangeResource(ctx context.Context, app, kind, id string, fields map[string]any) error {
	result, err := s.C(Collection(kind)).UpdateOne(ctx, bson.M{"publicId": id, "applicationId": app}, bson.M{"$set": fields, "$inc": bson.M{"version": int32(1)}})
	if err != nil {
		return err
	}
	if result.MatchedCount != 1 {
		return domain.Reject("not_found", 404)
	}
	return nil
}
func (s *Store) Applications(ctx context.Context, owner string) ([]domain.Application, error) {
	cur, err := s.C("gateway_applications").Find(ctx, bson.M{"ownerUserId": owner}, options.Find().SetLimit(50).SetSort(bson.D{{Key: "publicId", Value: 1}}))
	if err != nil {
		return nil, err
	}
	defer cur.Close(ctx)
	rows := []domain.Application{}
	err = cur.All(ctx, &rows)
	return rows, err
}
func (s *Store) ResourceApplication(ctx context.Context, owner, kind, id string) (domain.Application, error) {
	var row struct {
		AppID string `bson:"applicationId"`
	}
	if Collection(kind) == "" {
		return domain.Application{}, domain.Reject("not_found", 404)
	}
	if err := s.C(Collection(kind)).FindOne(ctx, bson.M{"publicId": id}).Decode(&row); err != nil {
		return domain.Application{}, Missing(err)
	}
	return s.Application(ctx, owner, row.AppID)
}
func (s *Store) UpdateApplication(ctx context.Context, app domain.Application, name, wallet string, domains []string) (domain.Application, error) {
	err := s.Transaction(ctx, func(tx context.Context) error {
		if err := s.GuardApplication(tx, Principal{App: app, Internal: true}); err != nil {
			return err
		}
		if _, err := s.GuardReceiver(tx, wallet, app.Owner); err != nil {
			return err
		}
		_, err := s.C("gateway_applications").UpdateOne(tx, bson.M{"publicId": app.ID, "ownerUserId": app.Owner}, bson.M{"$set": bson.M{"name": name, "walletId": wallet, "domains": domains}, "$inc": bson.M{"version": int32(1)}})
		return err
	})
	if err != nil {
		return app, err
	}
	return s.Application(ctx, app.Owner, app.ID)
}
func (s *Store) RecordUsage(ctx context.Context, app string, failed bool) {
	inc := bson.M{"requests": int64(1)}
	if failed {
		inc["errors"] = int64(1)
	}
	_, _ = s.C("gateway_usage").UpdateOne(ctx, bson.M{"_id": app}, bson.M{"$inc": inc}, options.UpdateOne().SetUpsert(true))
}
func (s *Store) Usage(ctx context.Context, app string) (any, error) {
	var row struct {
		Requests int64 `bson:"requests"`
		Errors   int64 `bson:"errors"`
	}
	err := s.C("gateway_usage").FindOne(ctx, bson.M{"_id": app}).Decode(&row)
	if err != nil {
		if _, ok := Missing(err).(*domain.Error); !ok {
			return nil, err
		}
	}
	return map[string]any{"requests": row.Requests, "errors": row.Errors, "rate_limit_per_minute": s.Config.RateLimit, "environment": s.Config.Environment}, nil
}
func (s *Store) Suspend(ctx context.Context, owner, id string) error {
	result, err := s.C("gateway_applications").UpdateOne(ctx, bson.M{"publicId": id, "ownerUserId": owner}, bson.M{"$set": bson.M{"status": "suspended"}, "$inc": bson.M{"version": int32(1)}})
	if err != nil {
		return err
	}
	if result.MatchedCount != 1 {
		return domain.Reject("not_found", 404)
	}
	return nil
}
func (s *Store) Nonce(ctx context.Context, nonce string) error {
	_, err := s.C("gateway_nonces").InsertOne(ctx, bson.M{"_id": nonce, "expiresAt": time.Now().Add(5 * time.Minute)})
	if err != nil {
		return domain.Reject("internal_request_replayed", 401)
	}
	return nil
}
func (s *Store) ExpireCheckout(ctx context.Context, app, id string) error {
	return s.Transaction(ctx, func(tx context.Context) error {
		result, err := s.C("gateway_payments").UpdateOne(tx, bson.M{"publicId": id, "applicationId": app, "status": "requires_action"}, bson.M{"$set": bson.M{"status": "canceled"}})
		if err = Changed(result, err, "invalid_transition"); err != nil {
			return err
		}
		return s.Event(tx, app, "payment.failed", id)
	})
}
func (s *Store) Link(ctx context.Context, id string) (domain.Link, domain.Application, error) {
	var link domain.Link
	var app domain.Application
	err := s.C("gateway_links").FindOne(ctx, bson.M{"publicId": id, "status": "active"}).Decode(&link)
	if err != nil {
		return link, app, Missing(err)
	}
	err = s.C("gateway_applications").FindOne(ctx, bson.M{"publicId": link.AppID, "status": "active"}).Decode(&app)
	return link, app, Missing(err)
}
