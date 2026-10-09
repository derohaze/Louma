package main

import (
	"context"
	"errors"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/derohaze/Louma/payment-gateway/internal/config"
	"github.com/derohaze/Louma/payment-gateway/internal/gateway"
	"github.com/derohaze/Louma/payment-gateway/internal/infrastructure/mongodb"
	redisinfra "github.com/derohaze/Louma/payment-gateway/internal/infrastructure/redis"
	"github.com/derohaze/Louma/payment-gateway/internal/logging"
	"github.com/derohaze/Louma/payment-gateway/internal/transport"
)

func main() {
	logger := slog.New(logging.NewHandler(os.Stdout))
	if err := run(logger); err != nil {
		logger.Error("gateway_startup_failed", "reason", err.Error())
		os.Exit(1)
	}
}
func run(logger *slog.Logger) error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}
	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()
	store, err := mongodb.Open(ctx, cfg)
	if err != nil {
		return errors.New("MongoDB connection failed")
	}
	defer store.Client.Disconnect(context.Background())
	if err = store.Compatible(ctx); err != nil {
		return err
	}
	rate, err := redisinfra.New(cfg.RedisURL, cfg.Environment)
	if err != nil {
		return err
	}
	defer rate.Close()
	server := &http.Server{Addr: cfg.Address, Handler: transport.New(&gateway.Service{Store: store}, rate, logger).Handler(), ReadHeaderTimeout: 3 * time.Second, ReadTimeout: 10 * time.Second, WriteTimeout: 15 * time.Second, IdleTimeout: 30 * time.Second, MaxHeaderBytes: 16 << 10}
	listener, err := net.Listen("tcp", cfg.Address)
	if err != nil {
		return err
	}
	stopped := make(chan error, 1)
	go func() { stopped <- server.Serve(listener) }()
	logger.Info("gateway_started", "environment", cfg.Environment, "address", cfg.Address)
	select {
	case err = <-stopped:
		if !errors.Is(err, http.ErrServerClosed) {
			return err
		}
	case <-ctx.Done():
		shutdown, stop := context.WithTimeout(context.Background(), 10*time.Second)
		defer stop()
		return server.Shutdown(shutdown)
	}
	return nil
}
