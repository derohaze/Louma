package mongodb

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/derohaze/Louma/payment-gateway/internal/domain"
	"go.mongodb.org/mongo-driver/v2/bson"
	"go.mongodb.org/mongo-driver/v2/mongo"
	"go.mongodb.org/mongo-driver/v2/mongo/options"
)

func (s *Store) CreateEndpoint(ctx context.Context, principal Principal, endpoint domain.Endpoint) error {
	return s.Transaction(ctx, func(tx context.Context) error {
		if err := s.GuardApplication(tx, principal); err != nil {
			return err
		}
		count, err := s.C("gateway_webhooks").CountDocuments(tx, bson.M{"applicationId": principal.App.ID, "status": "active"}, options.Count().SetLimit(16))
		if err != nil {
			return err
		}
		if count >= 16 {
			return domain.Reject("webhook_endpoint_limit", 409)
		}
		_, err = s.C("gateway_webhooks").InsertOne(tx, endpoint)
		return err
	})
}

func (s *Store) ExpandEvents(ctx context.Context, now time.Time) error {
	cur, err := s.C("gateway_events").Find(ctx, bson.M{"expanded": false}, options.Find().SetLimit(50))
	if err != nil {
		return err
	}
	defer cur.Close(ctx)
	events := []domain.Event{}
	if err = cur.All(ctx, &events); err != nil {
		return err
	}
	for _, event := range events {
		err = s.Transaction(ctx, func(tx context.Context) error {
			var current domain.Event
			if err := s.C("gateway_events").FindOne(tx, bson.M{"publicId": event.ID, "expanded": false}).Decode(&current); errors.Is(err, mongo.ErrNoDocuments) {
				return nil
			} else if err != nil {
				return err
			}
			endpoints, err := s.C("gateway_webhooks").Find(tx, bson.M{"applicationId": event.AppID, "status": "active", "events": event.Type}, options.Find().SetLimit(17))
			if err != nil {
				return err
			}
			defer endpoints.Close(tx)
			rows := []domain.Endpoint{}
			if err = endpoints.All(tx, &rows); err != nil {
				return err
			}
			if len(rows) > 16 {
				return domain.Reject("webhook_endpoint_limit", 409)
			}
			for _, endpoint := range rows {
				delivery := domain.Delivery{ID: ID(), AppID: event.AppID, EventID: event.ID, EndpointID: endpoint.ID, Status: "pending", DueAt: now, CreatedAt: now}
				if _, err = s.C("gateway_deliveries").InsertOne(tx, delivery); err != nil {
					return err
				}
			}
			_, err = s.C("gateway_events").UpdateOne(tx, bson.M{"publicId": event.ID, "expanded": false}, bson.M{"$set": bson.M{"expanded": true}})
			return err
		})
		if err != nil && !mongo.IsDuplicateKeyError(err) {
			return err
		}
	}
	return nil
}
func (s *Store) ClaimDelivery(ctx context.Context, now time.Time) (domain.Delivery, error) {
	var delivery domain.Delivery
	err := s.C("gateway_deliveries").FindOneAndUpdate(ctx, bson.M{"status": "pending", "dueAt": bson.M{"$lte": now}, "leaseUntil": bson.M{"$lte": now}}, bson.M{"$set": bson.M{"leaseUntil": now.Add(30 * time.Second)}, "$inc": bson.M{"fence": int32(1)}}, options.FindOneAndUpdate().SetReturnDocument(options.After).SetSort(bson.D{{Key: "dueAt", Value: 1}})).Decode(&delivery)
	return delivery, err
}
func (s *Store) DeliveryPayload(ctx context.Context, d domain.Delivery) (domain.Endpoint, []byte, error) {
	var endpoint domain.Endpoint
	var event domain.Event
	err := s.C("gateway_webhooks").FindOne(ctx, bson.M{"publicId": d.EndpointID, "applicationId": d.AppID, "status": "active"}).Decode(&endpoint)
	if err != nil {
		return endpoint, nil, err
	}
	err = s.C("gateway_events").FindOne(ctx, bson.M{"publicId": d.EventID, "applicationId": d.AppID}).Decode(&event)
	if err != nil {
		return endpoint, nil, err
	}
	body, err := json.Marshal(map[string]any{"id": event.ID, "type": event.Type, "api_version": "v1", "environment": s.Config.Environment, "created_at": event.CreatedAt, "data": map[string]string{"id": event.ResourceID}})
	return endpoint, body, err
}
func (s *Store) FinishDelivery(ctx context.Context, d domain.Delivery, status int, now time.Time) error {
	attempts := d.Attempts + 1
	state := "pending"
	if status >= 200 && status < 300 {
		state = "succeeded"
	} else if attempts >= 8 || now.Sub(d.CreatedAt) >= 48*time.Hour {
		state = "failed"
	}
	// Jitter depends on a unique immutable delivery ID so worker restarts keep scheduling bounded.
	backoff := time.Duration(30*(1<<min(attempts, 8)))*time.Second + time.Duration(d.ID[0]%30)*time.Second
	result, err := s.C("gateway_deliveries").UpdateOne(ctx, bson.M{"publicId": d.ID, "fence": d.Fence, "status": "pending"}, bson.M{"$set": bson.M{"status": state, "attempts": attempts, "lastStatus": status, "dueAt": now.Add(backoff), "leaseUntil": time.Time{}}})
	return Changed(result, err, "delivery_claim_lost")
}
func (s *Store) RetryDelivery(ctx context.Context, app, id string) error {
	result, err := s.C("gateway_deliveries").UpdateOne(ctx, bson.M{"publicId": id, "applicationId": app, "status": "failed"}, bson.M{"$set": bson.M{"status": "pending", "attempts": int32(0), "dueAt": time.Now(), "createdAt": time.Now(), "leaseUntil": time.Time{}}, "$inc": bson.M{"fence": int32(1)}})
	return Changed(result, err, "delivery_not_retryable")
}
