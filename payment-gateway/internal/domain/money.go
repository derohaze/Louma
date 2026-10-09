package domain

import (
	"fmt"
	"regexp"
	"strconv"
	"strings"
)

const MaxAmount int64 = 9007199254740000
const MaxBalance int64 = 9007199254740991

var moneyPattern = regexp.MustCompile(`^(0|[1-9][0-9]{0,11})(\.[0-9]{1,4})?$`)

type Error struct {
	Code   string
	Status int
}

func (e *Error) Error() string             { return e.Code }
func Reject(code string, status int) error { return &Error{Code: code, Status: status} }

func ParseMoney(value string) (int64, error) {
	if !moneyPattern.MatchString(value) {
		return 0, Reject("invalid_amount", 400)
	}
	parts := strings.SplitN(value, ".", 2)
	whole, _ := strconv.ParseInt(parts[0], 10, 64)
	var fraction int64
	if len(parts) == 2 {
		fraction, _ = strconv.ParseInt(parts[1]+strings.Repeat("0", 4-len(parts[1])), 10, 64)
	}
	minor := whole*10000 + fraction
	if minor > MaxAmount {
		return 0, Reject("invalid_amount", 400)
	}
	return minor, nil
}
func FormatMoney(minor int64) string { return fmt.Sprintf("%d.%04d", minor/10000, minor%10000) }

type FeePolicy struct {
	Version     string `json:"version" bson:"version"`
	BasisPoints int64  `json:"basis_points" bson:"basisPoints"`
}

func (p FeePolicy) Fee(total int64) (int64, error) {
	if total < 1 || total > MaxAmount || p.BasisPoints < 0 || p.BasisPoints >= 10000 || p.Version == "" {
		return 0, Reject("invalid_fee_policy", 400)
	}
	// Quotient/remainder avoids overflowing total*basisPoints at the safe-integer ceiling.
	fee := (total/10000)*p.BasisPoints + ((total%10000)*p.BasisPoints+5000)/10000
	if fee >= total {
		return 0, Reject("invalid_amount", 400)
	}
	return fee, nil
}
