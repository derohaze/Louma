package domain

import "time"

type Application struct {
	Key         string    `bson:"idempotencyKey,omitempty" json:"-"`
	Fingerprint string    `bson:"requestFingerprint,omitempty" json:"-"`
	ID          string    `bson:"publicId" json:"id"`
	Owner       string    `bson:"ownerUserId" json:"-"`
	Name        string    `bson:"name" json:"name"`
	WalletID    string    `bson:"walletId" json:"receiving_wallet_id"`
	Domains     []string  `bson:"domains" json:"domains"`
	Status      string    `bson:"status" json:"status"`
	Version     int32     `bson:"version" json:"-"`
	CreatedAt   time.Time `bson:"createdAt" json:"created_at"`
}
type Credential struct {
	ID        string     `bson:"publicId" json:"id"`
	AppID     string     `bson:"applicationId" json:"application_id"`
	Hash      string     `bson:"hash" json:"-"`
	Prefix    string     `bson:"prefix" json:"prefix"`
	Scopes    []string   `bson:"scopes" json:"scopes"`
	Status    string     `bson:"status" json:"status"`
	ExpiresAt *time.Time `bson:"expiresAt" json:"expires_at"`
	Version   int32      `bson:"version" json:"-"`
	CreatedAt time.Time  `bson:"createdAt" json:"created_at"`
}
type CheckoutInput struct {
	Subtotal    string            `json:"subtotal"`
	Tax         string            `json:"tax"`
	Currency    string            `json:"currency"`
	Description string            `json:"description"`
	SuccessURL  string            `json:"success_url"`
	CancelURL   string            `json:"cancel_url"`
	PriceID     string            `json:"price_id"`
	Metadata    map[string]string `json:"metadata"`
}
type Payment struct {
	ID             string            `bson:"publicId"`
	AppID          string            `bson:"applicationId"`
	CredentialID   string            `bson:"credentialId"`
	WalletID       string            `bson:"receivingWalletId"`
	MerchantName   string            `bson:"merchantName"`
	Subtotal       int64             `bson:"subtotalMinor"`
	Tax            int64             `bson:"taxMinor"`
	Total          int64             `bson:"totalMinor"`
	Fee            int64             `bson:"feeMinor"`
	Net            int64             `bson:"netMinor"`
	FeePolicy      FeePolicy         `bson:"feePolicy"`
	Description    string            `bson:"description"`
	Status         string            `bson:"status"`
	Key            string            `bson:"idempotencyKey"`
	Fingerprint    string            `bson:"requestFingerprint"`
	IntentHash     string            `bson:"intentHash"`
	PayerID        string            `bson:"payerUserId"`
	PayerWalletID  string            `bson:"payerWalletId"`
	TransactionID  string            `bson:"transactionId"`
	Refunded       int64             `bson:"refundedMinor"`
	PriceID        string            `bson:"priceId"`
	Interval       string            `bson:"interval"`
	SubscriptionID string            `bson:"subscriptionId"`
	InvoiceID      string            `bson:"invoiceId"`
	SuccessURL     string            `bson:"successUrl"`
	CancelURL      string            `bson:"cancelUrl"`
	Metadata       map[string]string `bson:"metadata"`
	CreatedAt      time.Time         `bson:"createdAt"`
	ExpiresAt      time.Time         `bson:"expiresAt"`
}

func (p Payment) View() map[string]any {
	v := map[string]any{"id": p.ID, "payment_id": p.ID, "application_id": p.AppID, "intent_hash": p.IntentHash, "status": p.Status, "currency": "LMA", "subtotal": FormatMoney(p.Subtotal), "tax": FormatMoney(p.Tax), "total": FormatMoney(p.Total), "fee": FormatMoney(p.Fee), "merchant_net": FormatMoney(p.Net), "fee_policy": p.FeePolicy, "description": p.Description, "merchant": map[string]string{"id": p.AppID, "name": p.MerchantName}, "expires_at": p.ExpiresAt, "created_at": p.CreatedAt, "transaction_reference": p.TransactionID, "refunded": FormatMoney(p.Refunded), "metadata": p.Metadata}
	if p.Interval != "" {
		v["recurring"] = map[string]string{"price_id": p.PriceID, "amount": FormatMoney(p.Total), "interval": p.Interval, "consent_policy_version": "2026-10-08", "description": p.Description}
	}
	if p.SubscriptionID != "" {
		v["subscription_id"] = p.SubscriptionID
		v["invoice_id"] = p.InvoiceID
	}
	return v
}

type Proof struct {
	Kind               string     `json:"kind" bson:"kind"`
	TimeStep           int64      `json:"timeStep" bson:"timeStep"`
	PasswordChangedAt  *time.Time `json:"passwordChangedAt" bson:"passwordChangedAt"`
	TwoFactorEnabledAt *time.Time `json:"twoFactorEnabledAt" bson:"twoFactorEnabledAt"`
	CredentialID       string     `json:"credentialId" bson:"credentialId"`
	VerifiedHashes     []string   `json:"verifiedHashes" bson:"verifiedHashes"`
	RemainingHashes    []string   `json:"remainingHashes" bson:"remainingHashes"`
}
type Approval struct {
	ID         string    `bson:"publicId" json:"id"`
	PaymentID  string    `bson:"paymentId" json:"payment_id"`
	Owner      string    `bson:"ownerUserId" json:"owner_user_id"`
	WalletID   string    `bson:"walletId" json:"wallet_id"`
	SessionID  string    `bson:"sessionId" json:"session_id"`
	IntentHash string    `bson:"intentHash" json:"intent_hash"`
	Key        string    `bson:"idempotencyKey" json:"idempotency_key"`
	Proof      Proof     `bson:"proof" json:"proof"`
	Consent    bool      `bson:"recurringConsent" json:"recurring_consent"`
	Policy     string    `bson:"policyVersion" json:"policy_version"`
	Consumed   bool      `bson:"consumed" json:"-"`
	ExpiresAt  time.Time `bson:"expiresAt" json:"expires_at"`
	CreatedAt  time.Time `bson:"createdAt" json:"-"`
}
type Wallet struct {
	ID      string `bson:"publicId"`
	Owner   string `bson:"ownerUserId"`
	Address string `bson:"address"`
	Status  string `bson:"status"`
	Version int32  `bson:"financialVersion"`
}
type Account struct {
	ID       string  `bson:"publicId"`
	WalletID *string `bson:"walletId"`
	Type     string  `bson:"accountType"`
	Currency string  `bson:"currency"`
	Balance  int64   `bson:"balanceMinor"`
}
type Product struct {
	Description string    `bson:"description" json:"description"`
	ID          string    `bson:"publicId" json:"id"`
	AppID       string    `bson:"applicationId" json:"application_id"`
	Name        string    `bson:"name" json:"name"`
	Status      string    `bson:"status" json:"status"`
	CreatedAt   time.Time `bson:"createdAt" json:"created_at"`
}
type Price struct {
	ID        string    `bson:"publicId" json:"id"`
	AppID     string    `bson:"applicationId" json:"application_id"`
	ProductID string    `bson:"productId" json:"product_id"`
	Amount    int64     `bson:"amountMinor" json:"amount_minor"`
	Interval  string    `bson:"interval" json:"interval"`
	Version   int32     `bson:"version" json:"version"`
	Status    string    `bson:"status" json:"status"`
	CreatedAt time.Time `bson:"createdAt" json:"created_at"`
}
type Subscription struct {
	ReceivingWalletID string    `bson:"receivingWalletId" json:"-"`
	ID                string    `bson:"publicId" json:"id"`
	AppID             string    `bson:"applicationId" json:"application_id"`
	PayerID           string    `bson:"payerUserId" json:"-"`
	WalletID          string    `bson:"payerWalletId" json:"-"`
	PriceID           string    `bson:"priceId" json:"price_id"`
	PriceVersion      int32     `bson:"priceVersion" json:"price_version"`
	Amount            int64     `bson:"amountMinor" json:"amount_minor"`
	Interval          string    `bson:"interval" json:"interval"`
	Status            string    `bson:"status" json:"status"`
	MandateActive     bool      `bson:"mandateActive" json:"mandate_active"`
	ConsentAt         time.Time `bson:"consentAt" json:"consent_at"`
	Policy            string    `bson:"policyVersion" json:"policy_version"`
	Anchor            time.Time `bson:"anchorAt" json:"anchor_at"`
	Cycle             int32     `bson:"cycle" json:"cycle"`
	DueAt             time.Time `bson:"dueAt" json:"due_at"`
	CancelAtEnd       bool      `bson:"cancelAtEnd" json:"cancel_at_period_end"`
	Version           int32     `bson:"version" json:"-"`
	CreatedAt         time.Time `bson:"createdAt" json:"created_at"`
}
type Invoice struct {
	Fee            int64     `bson:"feeMinor" json:"fee_minor"`
	FeePolicy      FeePolicy `bson:"feePolicy" json:"fee_policy"`
	ID             string    `bson:"publicId" json:"id"`
	AppID          string    `bson:"applicationId" json:"application_id"`
	SubscriptionID string    `bson:"subscriptionId" json:"subscription_id"`
	Cycle          int32     `bson:"cycle" json:"cycle"`
	Amount         int64     `bson:"amountMinor" json:"amount_minor"`
	Status         string    `bson:"status" json:"status"`
	PaymentID      string    `bson:"paymentId" json:"payment_id"`
	Start          time.Time `bson:"periodStart" json:"period_start"`
	End            time.Time `bson:"periodEnd" json:"period_end"`
	DueAt          time.Time `bson:"dueAt" json:"due_at"`
	Attempts       int32     `bson:"attempts" json:"attempts"`
	LeaseUntil     time.Time `bson:"leaseUntil" json:"-"`
	Fence          int32     `bson:"fence" json:"-"`
	CreatedAt      time.Time `bson:"createdAt" json:"created_at"`
}
type Refund struct {
	Reason        string    `bson:"reason,omitempty" json:"reason,omitempty"`
	ID            string    `bson:"publicId" json:"id"`
	AppID         string    `bson:"applicationId" json:"application_id"`
	PaymentID     string    `bson:"paymentId" json:"payment_id"`
	Amount        int64     `bson:"amountMinor" json:"amount_minor"`
	Status        string    `bson:"status" json:"status"`
	Key           string    `bson:"idempotencyKey" json:"-"`
	Fingerprint   string    `bson:"requestFingerprint" json:"-"`
	TransactionID string    `bson:"transactionId" json:"transaction_reference"`
	CreatedAt     time.Time `bson:"createdAt" json:"created_at"`
}
type Link struct {
	ID        string        `bson:"publicId" json:"id"`
	AppID     string        `bson:"applicationId" json:"application_id"`
	Input     CheckoutInput `bson:"input" json:"checkout"`
	Status    string        `bson:"status" json:"status"`
	CreatedAt time.Time     `bson:"createdAt" json:"created_at"`
}
type Endpoint struct {
	ID        string    `bson:"publicId" json:"id"`
	AppID     string    `bson:"applicationId" json:"application_id"`
	URL       string    `bson:"url" json:"url"`
	Events    []string  `bson:"events" json:"events"`
	Secret    string    `bson:"encryptedSecret" json:"-"`
	Status    string    `bson:"status" json:"status"`
	CreatedAt time.Time `bson:"createdAt" json:"created_at"`
}
type Event struct {
	ID         string    `bson:"publicId" json:"id"`
	AppID      string    `bson:"applicationId" json:"application_id"`
	Type       string    `bson:"type" json:"type"`
	ResourceID string    `bson:"resourceId" json:"resource_id"`
	CreatedAt  time.Time `bson:"createdAt" json:"created_at"`
	Expanded   bool      `bson:"expanded" json:"-"`
}
type Delivery struct {
	ID         string    `bson:"publicId" json:"id"`
	AppID      string    `bson:"applicationId" json:"application_id"`
	EventID    string    `bson:"eventId" json:"event_id"`
	EndpointID string    `bson:"endpointId" json:"endpoint_id"`
	Status     string    `bson:"status" json:"status"`
	Attempts   int32     `bson:"attempts" json:"attempts"`
	DueAt      time.Time `bson:"dueAt" json:"due_at"`
	LeaseUntil time.Time `bson:"leaseUntil" json:"-"`
	Fence      int32     `bson:"fence" json:"-"`
	LastStatus int       `bson:"lastStatus" json:"last_status"`
	CreatedAt  time.Time `bson:"createdAt" json:"created_at"`
}
