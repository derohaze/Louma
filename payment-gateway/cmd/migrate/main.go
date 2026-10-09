package main

import (
	"context"
	"flag"
	"fmt"
	"github.com/derohaze/Louma/payment-gateway/internal/config"
	"github.com/derohaze/Louma/payment-gateway/internal/infrastructure/mongodb"
	"os"
	"time"
)

func main() {
	target := flag.String("confirm-database", "", "exact selected target database")
	backup := flag.Bool("backup-confirmed", false, "operator verified backup")
	flag.Parse()
	cfg, err := config.Load()
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	if *target != cfg.Database || (!*backup && cfg.Environment == "live") {
		fmt.Fprintln(os.Stderr, "explicit target confirmation and live backup are required")
		os.Exit(1)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	store, err := mongodb.Open(ctx, cfg)
	if err != nil {
		fmt.Fprintln(os.Stderr, "database unavailable")
		os.Exit(1)
	}
	defer store.Client.Disconnect(context.Background())
	if err = store.Migrate(ctx); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	fmt.Println("gateway additive migration verified")
}
