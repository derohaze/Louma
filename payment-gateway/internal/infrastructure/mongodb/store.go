package mongodb

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"sync/atomic"
	"time"

	"github.com/derohaze/Louma/payment-gateway/internal/config"
	"github.com/derohaze/Louma/payment-gateway/internal/domain"
	"go.mongodb.org/mongo-driver/v2/bson"
	"go.mongodb.org/mongo-driver/v2/mongo"
	"go.mongodb.org/mongo-driver/v2/mongo/options"
	"go.mongodb.org/mongo-driver/v2/mongo/readconcern"
	"go.mongodb.org/mongo-driver/v2/mongo/writeconcern"
)

type Store struct {
	Client                          *mongo.Client
	DB                              *mongo.Database
	Config                          config.Config
	Transactions, Retries, Failures atomic.Int64
}

func Open(ctx context.Context, c config.Config) (*Store, error) {
	client, err := mongo.Connect(options.Client().ApplyURI(c.MongoURI).SetMaxPoolSize(64).SetMinPoolSize(2).SetServerSelectionTimeout(3 * time.Second).SetConnectTimeout(3 * time.Second).SetTimeout(8 * time.Second))
	if err != nil {
		return nil, err
	}
	s := &Store{Client: client, DB: client.Database(c.Database, options.Database().SetReadConcern(readconcern.Majority()).SetWriteConcern(writeconcern.Majority())), Config: c}
	if err = client.Ping(ctx, nil); err != nil {
		client.Disconnect(ctx)
		return nil, err
	}
	return s, nil
}
func (s *Store) C(name string) *mongo.Collection { return s.DB.Collection(name) }
func (s *Store) Compatible(ctx context.Context) error {
	var marker bson.M
	if err := s.C("gateway_schema").FindOne(ctx, bson.M{"_id": "v1", "financialContract": "merchant-v1"}).Decode(&marker); err != nil {
		return errors.New("gateway migration and compatible Node journal contract are required")
	}
	if err := s.CheckFinancialContract(ctx); err != nil {
		return err
	}
	var info struct {
		SetName string `bson:"setName"`
		Msg     string `bson:"msg"`
	}
	if err := s.DB.RunCommand(ctx, bson.M{"hello": 1}).Decode(&info); err != nil {
		return err
	}
	if info.SetName == "" && info.Msg != "isdbgrid" {
		return errors.New("MongoDB replica set with transactions is required")
	}
	return nil
}

// Old Node installers can replace a newer validator, so readiness inspects the live contract.
func (s *Store) CheckFinancialContract(ctx context.Context) error {
	collections, err := s.DB.ListCollections(ctx, bson.M{"name": "transactions"})
	if err != nil {
		return err
	}
	defer collections.Close(ctx)
	if !collections.Next(ctx) {
		if err := collections.Err(); err != nil {
			return err
		}
		return errors.New("install compatible Node financial schema before gateway migration")
	}
	var description struct {
		Options struct {
			Validator struct {
				Schema struct {
					Properties struct {
						Type struct {
							Enum []string `bson:"enum"`
						} `bson:"type"`
					} `bson:"properties"`
				} `bson:"$jsonSchema"`
			} `bson:"validator"`
			Level  string `bson:"validationLevel"`
			Action string `bson:"validationAction"`
		} `bson:"options"`
	}
	if err := collections.Decode(&description); err != nil {
		return err
	}
	for _, required := range []string{"transfer", "mining", "merchant_payment", "merchant_refund"} {
		found := false
		for _, variant := range description.Options.Validator.Schema.Properties.Type.Enum {
			if variant == required {
				found = true
				break
			}
		}
		if !found {
			return errors.New("shared journal validator is incompatible")
		}
	}
	if level := description.Options.Level; level != "" && level != "strict" {
		return errors.New("shared journal validation must be strict")
	}
	if action := description.Options.Action; action != "" && action != "error" {
		return errors.New("shared journal validation must reject invalid writes")
	}
	return nil
}
func ID() string {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		panic(err)
	}
	b[6] = (b[6] & 15) | 64
	b[8] = (b[8] & 63) | 128
	h := hex.EncodeToString(b)
	return h[:8] + "-" + h[8:12] + "-" + h[12:16] + "-" + h[16:20] + "-" + h[20:]
}
func (s *Store) Transaction(ctx context.Context, fn func(context.Context) error) error {
	ctx, cancel := context.WithTimeout(ctx, 8*time.Second)
	defer cancel()
	session, err := s.Client.StartSession()
	if err != nil {
		return err
	}
	defer session.EndSession(context.Background())
	var attempts int
	_, err = session.WithTransaction(ctx, func(tx context.Context) (any, error) {
		attempts++
		if attempts > 3 {
			return nil, domain.Reject("transaction_conflict", 503)
		}
		if attempts > 1 {
			s.Retries.Add(1)
		}
		return nil, fn(tx)
	}, options.Transaction().SetReadConcern(readconcern.Snapshot()).SetWriteConcern(writeconcern.Majority()))
	if err != nil {
		s.Failures.Add(1)
	} else {
		s.Transactions.Add(1)
	}
	return err
}
func Changed(result *mongo.UpdateResult, err error, code string) error {
	if err != nil {
		return err
	}
	if result.ModifiedCount != 1 {
		return domain.Reject(code, 409)
	}
	return nil
}
func Missing(err error) error {
	if errors.Is(err, mongo.ErrNoDocuments) {
		return domain.Reject("not_found", 404)
	}
	return err
}
func (s *Store) EnsureFinancialIndexes(ctx context.Context) error {
	for _, entry := range []struct {
		name    string
		keys    bson.D
		partial bson.M
	}{
		{"transactions", bson.D{{Key: "type", Value: 1}, {Key: "operationId", Value: 1}}, bson.M{"type": bson.M{"$in": bson.A{"merchant_payment", "merchant_refund"}}}},
	} {
		_, err := s.C(entry.name).Indexes().CreateOne(ctx, mongo.IndexModel{Keys: entry.keys, Options: options.Index().SetName("transactions_merchant_operation_unique").SetUnique(true).SetPartialFilterExpression(entry.partial)})
		if err != nil {
			return fmt.Errorf("financial index: %w", err)
		}
	}
	return nil
}
