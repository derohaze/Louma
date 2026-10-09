package transport

import (
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/derohaze/Louma/payment-gateway/internal/domain"
	"github.com/derohaze/Louma/payment-gateway/internal/infrastructure/mongodb"
	gatewayweb "github.com/derohaze/Louma/payment-gateway/web"
)

var checkoutTemplate = gatewayweb.CheckoutTemplate

func checkoutStatus(p domain.Payment) (label, note string) {
	switch p.Status {
	case "succeeded":
		return "Payment complete", "Your payment has been received. You can return to the merchant."
	case "requires_action":
		return "Awaiting your approval", ""
	case "processing":
		return "Processing", "Your payment is processing. Check its status shortly."
	case "expired":
		return "Expired", "This checkout has expired and can no longer be paid. Contact the merchant for a new checkout."
	case "canceled":
		return "Canceled", "This checkout was canceled. Contact the merchant for a new checkout."
	case "failed":
		return "Failed", "This payment could not be completed. Contact the merchant for a new checkout."
	default:
		return p.Status, "This checkout can no longer be paid. Contact the merchant for a new checkout."
	}
}

func (s *Server) hosted(w http.ResponseWriter, r *http.Request) error {
	id := strings.TrimPrefix(r.URL.Path, "/checkout/")
	p, err := s.Service.Store.Payment(r.Context(), "", id)
	if err != nil {
		return err
	}
	if p.Status == "requires_action" && !p.ExpiresAt.After(time.Now()) {
		p.Status = "expired"
	}
	arabic := r.URL.Query().Get("lang") == "ar"
	continueURL := s.Service.Store.Config.DashboardURL + "/checkout?session=" + url.QueryEscape(p.ID) + "&mode=" + s.Service.Store.Config.Environment
	label, note := checkoutStatus(p)
	interval := "Monthly"
	if p.Interval == "year" {
		interval = "Yearly"
	}
	languageURL := "/checkout/" + url.PathEscape(p.ID) + "?lang=ar"
	if arabic {
		languageURL = "/checkout/" + url.PathEscape(p.ID) + "?lang=en"
		interval = "شهريًا"
		if p.Interval == "year" {
			interval = "سنويًا"
		}
		switch p.Status {
		case "succeeded":
			label, note = "تم الدفع بنجاح", "استلم التاجر المبلغ. يمكنك العودة إلى موقعه."
		case "requires_action":
			label, note = "بانتظار تأكيدك", ""
		case "processing":
			label, note = "جارٍ معالجة الدفع", "تحقق من حالة الدفع بعد قليل."
		case "expired":
			label, note = "انتهت صلاحية الدفع", "اطلب رابط دفع جديدًا من التاجر."
		case "canceled":
			label, note = "تم إلغاء الدفع", "اطلب رابط دفع جديدًا من التاجر."
		default:
			label, note = "تعذر إتمام الدفع", "تواصل مع التاجر لطلب رابط جديد."
		}
	}
	expires := ""
	if p.Status == "requires_action" {
		expires = p.ExpiresAt.UTC().Format("2006-01-02 15:04 UTC")
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	return checkoutTemplate.Execute(w, map[string]any{"Arabic": arabic, "LanguageURL": languageURL, "IntervalLabel": interval, "Succeeded": p.Status == "succeeded", "Mode": s.Service.Store.Config.Environment, "Sandbox": s.Service.Store.Config.Environment == "test", "Merchant": p.MerchantName, "Description": p.Description, "Total": domain.FormatMoney(p.Total), "Subtotal": domain.FormatMoney(p.Subtotal), "Tax": domain.FormatMoney(p.Tax), "Recurring": p.Interval, "StatusLabel": label, "InactiveNote": note, "Reference": p.ID, "ExpiresAt": expires, "Payable": p.Status == "requires_action", "Continue": continueURL})
}
func (s *Server) linkCheckout(w http.ResponseWriter, r *http.Request) error {
	link, app, err := s.Service.Store.Link(r.Context(), strings.TrimPrefix(r.URL.Path, "/pay/"))
	if err != nil {
		return err
	}
	p, err := s.Service.Checkout(r.Context(), mongodb.Principal{App: app}, link.Input, "link:"+mongodb.ID())
	if err != nil {
		return err
	}
	http.Redirect(w, r, "/checkout/"+p.ID, http.StatusSeeOther)
	return nil
}
