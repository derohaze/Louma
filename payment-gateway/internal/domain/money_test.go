package domain

import "testing"

func TestParseMoney(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name, input string
		want        int64
		valid       bool
	}{
		{"one minor", "0.0001", 1, true}, {"four decimals", "100.1234", 1001234, true},
		{"whole", "100", 1000000, true}, {"ceiling", "900719925474.0000", MaxAmount, true},
		{"too large", "900719925474.0001", 0, false}, {"negative", "-1", 0, false},
		{"exponent", "1e2", 0, false}, {"precision", "1.00001", 0, false},
		{"leading zero", "01", 0, false}, {"whitespace", " 1", 0, false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, err := ParseMoney(tc.input)
			if (err == nil) != tc.valid || tc.valid && got != tc.want {
				t.Fatalf("got %d, %v", got, err)
			}
		})
	}
}

func TestFee(t *testing.T) {
	t.Parallel()
	policy := FeePolicy{Version: "v1", BasisPoints: 100}
	for _, tc := range []struct {
		name        string
		amount, fee int64
	}{
		{"example", 1000000, 10000}, {"round half up", 50, 1}, {"round down", 49, 0},
		{"max exact", MaxAmount, 90071992547400},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got, err := policy.Fee(tc.amount)
			if err != nil || got != tc.fee {
				t.Fatalf("%d %v", got, err)
			}
		})
	}
	if _, err := (FeePolicy{Version: "bad", BasisPoints: 10000}).Fee(1); err == nil {
		t.Fatal("zero-net fee accepted")
	}
}
