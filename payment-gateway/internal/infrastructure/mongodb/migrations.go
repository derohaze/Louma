package mongodb

import (
	"context"
	"errors"

	"github.com/derohaze/Louma/payment-gateway/internal/domain"
	"go.mongodb.org/mongo-driver/v2/bson"
	"go.mongodb.org/mongo-driver/v2/mongo"
	"go.mongodb.org/mongo-driver/v2/mongo/options"
)

// Migrate owns gateway collections only. The Node migration owns the shared financial validator.
func (s *Store) Migrate(ctx context.Context) error {
	if err := s.CheckFinancialContract(ctx); err != nil {
		return err
	}
	var err error
	str := bson.M{"bsonType": "string", "maxLength": 240}
	id := bson.M{"bsonType": "string", "minLength": 36, "maxLength": 36}
	money := bson.M{"bsonType": bson.A{"int", "long"}, "minimum": 0, "maximum": domain.MaxAmount}
	date := bson.M{"bsonType": "date"}
	for name, shape := range map[string]struct {
		required   bson.A
		properties bson.M
	}{
		"gateway_applications":  {bson.A{"publicId", "ownerUserId", "name", "walletId", "domains", "status", "version", "createdAt"}, bson.M{"publicId": id, "ownerUserId": id, "walletId": id, "name": str, "domains": bson.M{"bsonType": "array", "maxItems": 16, "items": str}, "status": bson.M{"enum": bson.A{"active", "suspended"}}, "version": bson.M{"bsonType": "int", "minimum": 0}, "createdAt": date}},
		"gateway_credentials":   {bson.A{"publicId", "applicationId", "hash", "scopes", "status", "expiresAt", "version"}, bson.M{"publicId": id, "applicationId": id, "hash": str, "scopes": bson.M{"bsonType": "array", "maxItems": 8, "items": str}, "status": bson.M{"enum": bson.A{"active", "revoked"}}, "version": bson.M{"bsonType": "int"}, "expiresAt": bson.M{"bsonType": bson.A{"date", "null"}}}},
		"gateway_payments":      {bson.A{"publicId", "applicationId", "totalMinor", "subtotalMinor", "taxMinor", "feeMinor", "netMinor", "intentHash", "status", "idempotencyKey", "requestFingerprint", "createdAt", "expiresAt"}, bson.M{"publicId": id, "applicationId": id, "subtotalMinor": money, "taxMinor": money, "totalMinor": money, "feeMinor": money, "netMinor": money, "refundedMinor": money, "metadata": bson.M{"bsonType": "object", "maxProperties": 16, "additionalProperties": bson.M{"bsonType": "string", "maxLength": 240}}, "status": bson.M{"enum": bson.A{"requires_action", "succeeded", "canceled", "failed"}}, "createdAt": date, "expiresAt": date}},
		"gateway_approvals":     {bson.A{"publicId", "paymentId", "ownerUserId", "walletId", "sessionId", "intentHash", "idempotencyKey", "proof", "consumed", "expiresAt"}, bson.M{"publicId": id, "paymentId": id, "ownerUserId": id, "walletId": id, "consumed": bson.M{"bsonType": "bool"}, "expiresAt": date, "proof": bson.M{"bsonType": "object", "properties": bson.M{"verifiedHashes": bson.M{"bsonType": "array", "maxItems": 16, "items": str}, "remainingHashes": bson.M{"bsonType": "array", "maxItems": 16, "items": str}}}}},
		"gateway_products":      {bson.A{"publicId", "applicationId", "name", "status", "createdAt"}, bson.M{"publicId": id, "applicationId": id, "name": str, "status": bson.M{"enum": bson.A{"active", "archived"}}}},
		"gateway_prices":        {bson.A{"publicId", "applicationId", "productId", "amountMinor", "interval", "version", "status"}, bson.M{"publicId": id, "applicationId": id, "productId": id, "amountMinor": money, "interval": bson.M{"enum": bson.A{"", "month", "year"}}, "version": bson.M{"bsonType": "int", "minimum": 1}}},
		"gateway_subscriptions": {bson.A{"publicId", "applicationId", "payerUserId", "payerWalletId", "priceId", "priceVersion", "amountMinor", "interval", "status", "mandateActive", "policyVersion", "consentAt", "anchorAt", "cycle", "dueAt", "version"}, bson.M{"publicId": id, "applicationId": id, "amountMinor": money, "mandateActive": bson.M{"bsonType": "bool"}, "interval": bson.M{"enum": bson.A{"month", "year"}}, "status": bson.M{"enum": bson.A{"active", "past_due", "paused", "canceled"}}, "cycle": bson.M{"bsonType": "int", "minimum": 1, "maximum": 1200}, "version": bson.M{"bsonType": "int"}, "dueAt": date}},
		"gateway_invoices":      {bson.A{"publicId", "applicationId", "subscriptionId", "cycle", "amountMinor", "status", "paymentId", "periodStart", "periodEnd", "dueAt", "attempts", "leaseUntil", "fence"}, bson.M{"publicId": id, "applicationId": id, "subscriptionId": id, "amountMinor": money, "cycle": bson.M{"bsonType": "int", "minimum": 0}, "attempts": bson.M{"bsonType": "int", "minimum": 0, "maximum": 4}, "fence": bson.M{"bsonType": "int"}, "status": bson.M{"enum": bson.A{"open", "paid", "void", "uncollectible"}}, "dueAt": date, "leaseUntil": date}},
		"gateway_refunds":       {bson.A{"publicId", "applicationId", "paymentId", "amountMinor", "status", "idempotencyKey", "requestFingerprint", "createdAt"}, bson.M{"publicId": id, "applicationId": id, "paymentId": id, "amountMinor": money, "status": bson.M{"enum": bson.A{"pending", "succeeded", "failed"}}}},
		"gateway_links":         {bson.A{"publicId", "applicationId", "input", "status", "createdAt"}, bson.M{"publicId": id, "applicationId": id, "input": bson.M{"bsonType": "object", "properties": bson.M{"metadata": bson.M{"bsonType": "object", "maxProperties": 16, "additionalProperties": str}}}, "status": bson.M{"enum": bson.A{"active", "disabled"}}}},
		"gateway_webhooks":      {bson.A{"publicId", "applicationId", "url", "events", "encryptedSecret", "status"}, bson.M{"publicId": id, "applicationId": id, "url": bson.M{"bsonType": "string", "maxLength": 2048}, "events": bson.M{"bsonType": "array", "maxItems": 16, "items": str}, "status": bson.M{"enum": bson.A{"active", "disabled"}}}},
		"gateway_events":        {bson.A{"publicId", "applicationId", "type", "resourceId", "createdAt", "expanded"}, bson.M{"publicId": id, "applicationId": id, "type": str, "resourceId": id, "createdAt": date}},
		"gateway_deliveries":    {bson.A{"publicId", "applicationId", "eventId", "endpointId", "status", "attempts", "dueAt", "leaseUntil", "fence", "createdAt"}, bson.M{"publicId": id, "applicationId": id, "eventId": id, "endpointId": id, "status": bson.M{"enum": bson.A{"pending", "succeeded", "failed"}}, "attempts": bson.M{"bsonType": "int", "minimum": 0, "maximum": 8}, "dueAt": date, "leaseUntil": date, "fence": bson.M{"bsonType": "int"}}},
	} {
		validator := bson.M{"$jsonSchema": bson.M{"bsonType": "object", "required": shape.required, "properties": shape.properties}}
		if name == "gateway_payments" {
			validator = bson.M{"$and": bson.A{validator, bson.M{"$expr": bson.M{"$and": bson.A{bson.M{"$eq": bson.A{"$totalMinor", bson.M{"$add": bson.A{"$subtotalMinor", "$taxMinor"}}}}, bson.M{"$eq": bson.A{"$totalMinor", bson.M{"$add": bson.A{"$feeMinor", "$netMinor"}}}}, bson.M{"$gt": bson.A{"$netMinor", 0}}, bson.M{"$lte": bson.A{"$refundedMinor", "$totalMinor"}}}}}}}
		}
		if err = s.DB.CreateCollection(ctx, name, options.CreateCollection().SetValidator(validator).SetValidationLevel("strict").SetValidationAction("error")); err != nil {
			var ce mongo.CommandError
			if !errors.As(err, &ce) || ce.Code != 48 {
				return err
			}
			if err = s.DB.RunCommand(ctx, bson.D{{Key: "collMod", Value: name}, {Key: "validator", Value: validator}, {Key: "validationLevel", Value: "strict"}, {Key: "validationAction", Value: "error"}}).Err(); err != nil {
				return err
			}
		}
		if _, err = s.C(name).Indexes().CreateOne(ctx, mongo.IndexModel{Keys: bson.D{{Key: "publicId", Value: 1}}, Options: options.Index().SetUnique(true)}); err != nil {
			return err
		}
		if _, err = s.C(name).Indexes().CreateOne(ctx, mongo.IndexModel{Keys: bson.D{{Key: "applicationId", Value: 1}, {Key: "publicId", Value: 1}}}); err != nil {
			return err
		}
	}
	// Only newly keyed application creations participate; historical rows remain intact.
	if _, err = s.C("gateway_applications").Indexes().CreateOne(ctx, mongo.IndexModel{Keys: bson.D{{Key: "ownerUserId", Value: 1}, {Key: "idempotencyKey", Value: 1}}, Options: options.Index().SetUnique(true).SetPartialFilterExpression(bson.M{"idempotencyKey": bson.M{"$type": "string"}})}); err != nil {
		return err
	}
	for _, idx := range []struct {
		collection string
		keys       bson.D
		unique     bool
	}{
		{"gateway_credentials", bson.D{{Key: "hash", Value: 1}}, true},
		{"gateway_applications", bson.D{{Key: "ownerUserId", Value: 1}, {Key: "publicId", Value: 1}}, false},
		{"gateway_payments", bson.D{{Key: "applicationId", Value: 1}, {Key: "idempotencyKey", Value: 1}}, true},
		{"gateway_approvals", bson.D{{Key: "paymentId", Value: 1}, {Key: "ownerUserId", Value: 1}, {Key: "idempotencyKey", Value: 1}}, true},
		{"gateway_invoices", bson.D{{Key: "subscriptionId", Value: 1}, {Key: "cycle", Value: 1}}, true},
		{"gateway_invoices", bson.D{{Key: "status", Value: 1}, {Key: "dueAt", Value: 1}, {Key: "leaseUntil", Value: 1}}, false},
		{"gateway_subscriptions", bson.D{{Key: "status", Value: 1}, {Key: "dueAt", Value: 1}}, false},
		{"gateway_refunds", bson.D{{Key: "applicationId", Value: 1}, {Key: "idempotencyKey", Value: 1}}, true},
		{"gateway_deliveries", bson.D{{Key: "eventId", Value: 1}, {Key: "endpointId", Value: 1}}, true},
		{"gateway_deliveries", bson.D{{Key: "status", Value: 1}, {Key: "dueAt", Value: 1}, {Key: "leaseUntil", Value: 1}}, false},
		{"gateway_events", bson.D{{Key: "expanded", Value: 1}, {Key: "publicId", Value: 1}}, false},
	} {
		if _, err = s.C(idx.collection).Indexes().CreateOne(ctx, mongo.IndexModel{Keys: idx.keys, Options: options.Index().SetUnique(idx.unique)}); err != nil {
			return err
		}
	}
	if _, err = s.C("gateway_nonces").Indexes().CreateOne(ctx, mongo.IndexModel{Keys: bson.D{{Key: "expiresAt", Value: 1}}, Options: options.Index().SetExpireAfterSeconds(0)}); err != nil {
		return err
	}
	if err = s.EnsureFinancialIndexes(ctx); err != nil {
		return err
	}
	_, err = s.C("gateway_schema").UpdateOne(ctx, bson.M{"_id": "v1"}, bson.M{"$set": bson.M{"financialContract": "merchant-v1"}}, options.UpdateOne().SetUpsert(true))
	return err
}
