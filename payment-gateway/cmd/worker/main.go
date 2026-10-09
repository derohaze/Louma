package main

import (
	"context"
	"log/slog"
	"os"
	"os/signal"
	"syscall"

	"github.com/derohaze/Louma/payment-gateway/internal/config"
	"github.com/derohaze/Louma/payment-gateway/internal/infrastructure/mongodb"
	"github.com/derohaze/Louma/payment-gateway/internal/logging"
	"github.com/derohaze/Louma/payment-gateway/internal/security"
	"github.com/derohaze/Louma/payment-gateway/internal/worker"
)

func main() {
	logger := slog.New(logging.NewHandler(os.Stdout))
	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()
	cfg, err := config.Load()
	if err != nil {
		logger.Error("invalid_configuration", "reason", err.Error())
		os.Exit(1)
	}
	store, err := mongodb.Open(ctx, cfg)
	if err != nil {
		logger.Error("database_unavailable")
		os.Exit(1)
	}
	defer store.Client.Disconnect(context.Background())
	if err = store.Compatible(ctx); err != nil {
		logger.Error("incompatible_schema")
		os.Exit(1)
	}
	logger.Info("gateway_worker_started", "environment", cfg.Environment)
	w := worker.Worker{Store: store, Logger: logger, Client: security.WebhookClient()}
	if err = w.Run(ctx); err != nil {
		logger.Error("worker_stopped")
		os.Exit(1)
	}
}
