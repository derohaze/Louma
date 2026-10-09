package mongodb

import (
	"context"
	"errors"
	"strings"
	"time"

	"github.com/derohaze/Louma/payment-gateway/internal/domain"
	"github.com/derohaze/Louma/payment-gateway/internal/security"
	"go.mongodb.org/mongo-driver/v2/bson"
	"go.mongodb.org/mongo-driver/v2/mongo"
	"go.mongodb.org/mongo-driver/v2/mongo/options"
)

type Principal struct {
	App        domain.Application
	Credential domain.Credential
	Internal   bool
}

func (s *Store) Eligible(ctx context.Context, owner string) error {
	var grant bson.M
	if err := s.C("gateway_developers").FindOne(ctx, bson.M{"ownerUserId": owner, "status": "active"}).Decode(&grant); err != nil {
		if !errors.Is(err, mongo.ErrNoDocuments) {
			return domain.Reject("gateway_storage_unavailable", 503)
		}
		return domain.Reject("developer_access_required", 403)
	}
	return nil
}
func (s *Store) Application(ctx context.Context, owner, id string) (domain.Application, error) {
	var app domain.Application
	err := s.C("gateway_applications").FindOne(ctx, bson.M{"publicId": id, "ownerUserId": owner}).Decode(&app)
	return app, Missing(err)
}
func (s *Store) Authenticate(ctx context.Context, key, scope string) (Principal, error) {
	p := Principal{}
	if !strings.HasPrefix(key, "lma_"+s.Config.Environment+"_") || len(key) > 160 {
		return p, domain.Reject("invalid_api_key", 401)
	}
	notExpired := bson.A{bson.M{"expiresAt": nil}, bson.M{"expiresAt": bson.M{"$gt": time.Now()}}}
	err := s.C("gateway_credentials").FindOne(ctx, bson.M{"hash": security.MAC(s.Config.Pepper, key), "status": "active", "scopes": scope, "$or": notExpired}).Decode(&p.Credential)
	if err != nil {
		if !errors.Is(err, mongo.ErrNoDocuments) {
			return p, domain.Reject("gateway_storage_unavailable", 503)
		}
		// A genuine key with the wrong scope is forbidden (403); an unknown,
		// revoked, or expired key stays unauthenticated (401) with no distinction.
		var known domain.Credential
		if scoped := s.C("gateway_credentials").FindOne(ctx, bson.M{"hash": security.MAC(s.Config.Pepper, key), "status": "active", "$or": notExpired}).Decode(&known); scoped == nil {
			return p, domain.Reject("insufficient_scope", 403)
		} else if !errors.Is(scoped, mongo.ErrNoDocuments) {
			return p, domain.Reject("gateway_storage_unavailable", 503)
		}
		return p, domain.Reject("invalid_api_key", 401)
	}
	err = s.C("gateway_applications").FindOne(ctx, bson.M{"publicId": p.Credential.AppID, "status": "active"}).Decode(&p.App)
	if err != nil {
		if !errors.Is(err, mongo.ErrNoDocuments) {
			return p, domain.Reject("gateway_storage_unavailable", 503)
		}
		return p, domain.Reject("application_suspended", 403)
	}
	if err = s.Eligible(ctx, p.App.Owner); err != nil {
		return p, err
	}
	return p, nil
}
func (s *Store) CreateApplication(ctx context.Context, app domain.Application) (domain.Application, error) {
	if err := s.Eligible(ctx, app.Owner); err != nil {
		return app, err
	}
	var wallet domain.Wallet
	if err := s.C("wallets").FindOne(ctx, bson.M{"publicId": app.WalletID, "ownerUserId": app.Owner, "status": "active"}).Decode(&wallet); err != nil {
		return app, domain.Reject("invalid_receiving_wallet", 400)
	}
	app.ID = ID()
	if app.Key == "" {
		app.Key = app.ID
	}
	app.Status = "active"
	app.CreatedAt = time.Now().UTC()
	app.Version = 0
	find := func() (domain.Application, error) {
		var prior domain.Application
		err := s.C("gateway_applications").FindOne(ctx, bson.M{"ownerUserId": app.Owner, "idempotencyKey": app.Key}).Decode(&prior)
		if err == nil && prior.Fingerprint != app.Fingerprint {
			return prior, domain.Reject("idempotency_key_reused", 409)
		}
		return prior, err
	}
	if prior, err := find(); err == nil {
		return prior, nil
	} else if !errors.Is(err, mongo.ErrNoDocuments) {
		return app, err
	}
	_, err := s.C("gateway_applications").InsertOne(ctx, app)
	if mongo.IsDuplicateKeyError(err) {
		return find()
	}
	return app, err
}

func (s *Store) RotateCredential(ctx context.Context, p Principal, id string) (any, error) {
	var old domain.Credential
	if err := s.C("gateway_credentials").FindOne(ctx, bson.M{"publicId": id, "applicationId": p.App.ID, "status": "active"}).Decode(&old); err != nil {
		return nil, Missing(err)
	}
	raw := "lma_" + s.Config.Environment + "_" + strings.ReplaceAll(ID(), "-", "") + "_" + security.Secret()
	newKey := domain.Credential{ID: ID(), AppID: p.App.ID, Hash: security.MAC(s.Config.Pepper, raw), Prefix: raw[:18], Scopes: old.Scopes, Status: "active", ExpiresAt: old.ExpiresAt, CreatedAt: time.Now().UTC()}
	err := s.Transaction(ctx, func(tx context.Context) error {
		result, err := s.C("gateway_credentials").UpdateOne(tx, bson.M{"publicId": id, "applicationId": p.App.ID, "status": "active"}, bson.M{"$set": bson.M{"status": "revoked"}, "$inc": bson.M{"version": int32(1)}})
		if err = Changed(result, err, "credential_revoked"); err != nil {
			return err
		}
		_, err = s.C("gateway_credentials").InsertOne(tx, newKey)
		return err
	})
	if err != nil {
		return nil, err
	}
	return map[string]any{"id": newKey.ID, "credential": newKey, "api_key": raw}, nil
}
func (s *Store) CreateCredential(ctx context.Context, p Principal, scopes []string, expires *time.Time) (domain.Credential, string, error) {
	id := ID()
	raw := "lma_" + s.Config.Environment + "_" + strings.ReplaceAll(id, "-", "") + "_" + security.Secret()
	key := domain.Credential{ID: id, AppID: p.App.ID, Hash: security.MAC(s.Config.Pepper, raw), Prefix: raw[:18], Scopes: scopes, Status: "active", ExpiresAt: expires, CreatedAt: time.Now().UTC()}
	_, err := s.C("gateway_credentials").InsertOne(ctx, key)
	return key, raw, err
}
func (s *Store) GuardApplication(ctx context.Context, p Principal) error {
	if err := s.Eligible(ctx, p.App.Owner); err != nil {
		return err
	}
	result, err := s.C("gateway_developers").UpdateOne(ctx, bson.M{"ownerUserId": p.App.Owner, "status": "active"}, bson.M{"$inc": bson.M{"financialVersion": int32(1)}})
	if err = Changed(result, err, "merchant_suspended"); err != nil {
		return err
	}
	result, err = s.C("gateway_applications").UpdateOne(ctx, bson.M{"publicId": p.App.ID, "ownerUserId": p.App.Owner, "status": "active", "walletId": p.App.WalletID}, bson.M{"$inc": bson.M{"version": int32(1)}})
	if err = Changed(result, err, "application_suspended"); err != nil {
		return err
	}
	if p.Credential.ID != "" {
		result, err = s.C("gateway_credentials").UpdateOne(ctx, bson.M{"publicId": p.Credential.ID, "applicationId": p.App.ID, "status": "active", "$or": bson.A{bson.M{"expiresAt": nil}, bson.M{"expiresAt": bson.M{"$gt": time.Now()}}}}, bson.M{"$inc": bson.M{"version": int32(1)}})
		if err = Changed(result, err, "credential_revoked"); err != nil {
			return err
		}
	}
	return nil
}
func (s *Store) List(ctx context.Context, collection, app, cursor string) ([]bson.M, string, error) {
	filter := bson.M{"applicationId": app}
	if cursor != "" {
		filter["publicId"] = bson.M{"$gt": cursor}
	}
	cur, err := s.C(collection).Find(ctx, filter, options.Find().SetSort(bson.D{{Key: "publicId", Value: 1}}).SetLimit(51).SetProjection(bson.M{"_id": 0, "hash": 0, "encryptedSecret": 0, "proof": 0, "requestFingerprint": 0, "idempotencyKey": 0, "payerUserId": 0, "payerWalletId": 0, "ownerUserId": 0, "financialVersion": 0, "version": 0}))
	if err != nil {
		return nil, "", err
	}
	defer cur.Close(ctx)
	rows := []bson.M{}
	if err = cur.All(ctx, &rows); err != nil {
		return nil, "", err
	}
	next := ""
	if len(rows) > 50 {
		rows = rows[:50]
		next, _ = rows[49]["publicId"].(string)
	}
	return rows, next, nil
}
