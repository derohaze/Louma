package domain

import (
	"testing"
	"time"
)

func TestPeriod(t *testing.T) {
	t.Parallel()
	for _, tc := range []struct {
		name, anchor, interval, want string
		cycle                        int32
	}{
		{"february", "2024-01-31T12:00:00Z", "month", "2024-02-29T12:00:00Z", 1},
		{"original day", "2024-01-31T12:00:00Z", "month", "2024-03-31T12:00:00Z", 2},
		{"leap year", "2024-02-29T12:00:00Z", "year", "2025-02-28T12:00:00Z", 1},
	} {
		t.Run(tc.name, func(t *testing.T) {
			anchor, _ := time.Parse(time.RFC3339, tc.anchor)
			got, err := Period(anchor, tc.interval, tc.cycle)
			if err != nil || got.Format(time.RFC3339) != tc.want {
				t.Fatalf("%v %v", got, err)
			}
		})
	}
}
