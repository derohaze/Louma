package redis

import (
	"context"
	"sync"
	"time"

	redisclient "github.com/redis/go-redis/v9"
)

type bucket struct {
	count   int
	expires time.Time
}
type Limiter struct {
	Client  *redisclient.Client
	mu      sync.Mutex
	buckets map[string]bucket
	Prefix  string
}

func New(raw, environment string) (*Limiter, error) {
	l := &Limiter{buckets: map[string]bucket{}, Prefix: "louma:gateway:" + environment + ":"}
	if raw == "" {
		return l, nil
	}
	opts, err := redisclient.ParseURL(raw)
	if err != nil {
		return nil, err
	}
	opts.PoolSize = 16
	opts.DialTimeout = time.Second
	opts.ReadTimeout = time.Second
	opts.WriteTimeout = time.Second
	opts.MaxRetries = 0
	l.Client = redisclient.NewClient(opts)
	return l, nil
}

var script = redisclient.NewScript(`local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('EXPIRE',KEYS[1],60) end; return n`)

func (l *Limiter) Allow(ctx context.Context, key string, max int) bool {
	if l.Client != nil {
		n, err := script.Run(ctx, l.Client, []string{l.Prefix + key}).Int()
		return err == nil && n <= max
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	now := time.Now()
	b := l.buckets[key]
	if !b.expires.After(now) {
		b = bucket{expires: now.Add(time.Minute)}
	}
	if len(l.buckets) >= 4096 {
		for k, v := range l.buckets {
			if !v.expires.After(now) {
				delete(l.buckets, k)
			}
		}
		if len(l.buckets) >= 4096 {
			return false
		}
	}
	b.count++
	l.buckets[key] = b
	return b.count <= max
}
func (l *Limiter) Ready(ctx context.Context) bool {
	return l.Client == nil || l.Client.Ping(ctx).Err() == nil
}
func (l *Limiter) Close() error {
	if l.Client != nil {
		return l.Client.Close()
	}
	return nil
}
