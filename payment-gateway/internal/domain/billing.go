package domain

import "time"

// Period uses the original anchor, so a February clamp does not move March's billing day.
func Period(anchor time.Time, interval string, cycle int32) (time.Time, error) {
	if cycle < 0 || cycle > 1200 {
		return time.Time{}, Reject("invalid_cycle", 400)
	}
	months := int(cycle)
	if interval == "year" {
		months *= 12
	} else if interval != "month" {
		return time.Time{}, Reject("invalid_interval", 400)
	}
	anchor = anchor.UTC()
	monthStart := time.Date(anchor.Year(), anchor.Month()+time.Month(months), 1, anchor.Hour(), anchor.Minute(), anchor.Second(), anchor.Nanosecond(), time.UTC)
	last := monthStart.AddDate(0, 1, -1).Day()
	day := min(anchor.Day(), last)
	return monthStart.AddDate(0, 0, day-1), nil
}
