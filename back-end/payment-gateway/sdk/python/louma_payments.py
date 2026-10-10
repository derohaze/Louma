"""Synchronous Louma gateway client. Money remains an exact decimal string."""
import hashlib
import hmac
import json
import math
import re
import time
from typing import Any, TypedDict
from urllib import error, parse, request


class CheckoutInput(TypedDict):
    subtotal: str
    tax: str
    currency: str
    description: str


class GatewayError(Exception):
    def __init__(self, status: int, code: str, message: str, request_id: str = ""):
        super().__init__(message)
        self.status, self.code, self.request_id = status, code, request_id


def verify_webhook(secret: str, raw_body: bytes, signature: str, now: int | None = None) -> bool:
    parts = re.fullmatch(r"t=([0-9]+),v1=([a-f0-9]{64})", signature or "")
    if not parts or not secret:
        return False
    try:
        timestamp = int(parts[1])
    except ValueError:
        return False
    current = int(time.time()) if now is None else now
    if timestamp < current - 300 or timestamp > current + 30:
        return False
    expected = hmac.new(secret.encode(), parts[1].encode() + b"." + raw_body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, parts[2])


class _NoRedirect(request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


class LoumaClient:
    def __init__(self, api_key: str, base_url: str, environment: str | None = None, timeout: float = 10):
        if environment is None:
            environment = "live" if api_key.startswith("lma_live_") else "test"
        if environment not in ("test", "live") or not api_key.startswith(f"lma_{environment}_"):
            raise ValueError("API key environment mismatch")
        endpoint = parse.urlsplit(base_url)
        local = endpoint.hostname in ("localhost", "127.0.0.1", "::1")
        if endpoint.username or endpoint.password or endpoint.query or endpoint.fragment or not endpoint.hostname or (endpoint.scheme != "https" and not (environment == "test" and local and endpoint.scheme == "http")):
            raise ValueError("HTTPS base_url required outside local test mode")
        if not math.isfinite(timeout) or timeout <= 0:
            raise ValueError("timeout must be positive seconds")
        self._api_key, self.base_url, self.timeout = api_key, base_url.rstrip("/"), timeout
        self.environment, self._opener = environment, request.build_opener(_NoRedirect())

    def request(self, method: str, path: str, *, body: Any = None, idempotency_key: str | None = None, query: dict | None = None) -> dict:
        endpoint = self.base_url + path
        if query:
            endpoint += "?" + parse.urlencode({name: parameter for name, parameter in query.items() if parameter is not None})
        headers = {"Authorization": "Bearer " + self._api_key, "Accept": "application/json"}
        payload = None if body is None else json.dumps(body, separators=(",", ":")).encode()
        if payload is not None:
            headers["Content-Type"] = "application/json"
        if idempotency_key:
            headers["Idempotency-Key"] = idempotency_key
        try:
            with self._opener.open(request.Request(endpoint, data=payload, headers=headers, method=method), timeout=self.timeout) as response:
                return self._decode(response.read(1048577), response.status)
        except error.HTTPError as rejected:
            with rejected:
                failure = self._decode(rejected.read(1048577), rejected.code).get("error", {})
            if not isinstance(failure, dict):
                failure = {}
            raise GatewayError(rejected.code, failure.get("code", "http_error"), failure.get("message", "Gateway request rejected"), failure.get("request_id", "")) from None
        except (error.URLError, TimeoutError):
            raise GatewayError(0, "transport_error", "Gateway request failed; reconcile before retrying") from None

    @staticmethod
    def _decode(raw: bytes, status: int) -> dict:
        if len(raw) > 1048576:
            raise GatewayError(status, "invalid_response", "Gateway response exceeded size limit")
        try:
            resource = json.loads(raw)
        except (json.JSONDecodeError, UnicodeDecodeError):
            raise GatewayError(status, "invalid_response", "Gateway returned invalid JSON") from None
        if not isinstance(resource, dict):
            raise GatewayError(status, "invalid_response", "Gateway returned invalid resource")
        return resource

    def create_checkout(self, body: CheckoutInput, idempotency_key: str):
        return self.request("POST", "/v1/checkouts", body=body, idempotency_key=idempotency_key)

    def retrieve_checkout(self, checkout_id: str):
        return self.request("GET", "/v1/checkouts/" + parse.quote(checkout_id, safe=""))

    def expire_checkout(self, checkout_id: str):
        return self.request("POST", "/v1/checkouts/" + parse.quote(checkout_id, safe="") + "/expire", body={})

    def retrieve_payment(self, payment_id: str):
        return self.request("GET", "/v1/payments/" + parse.quote(payment_id, safe=""))

    def list_payments(self, **query):
        return self.request("GET", "/v1/payments", query=query)

    def create_link(self, body: dict, idempotency_key: str | None = None):
        return self.request("POST", "/v1/payment-links", body=body, idempotency_key=idempotency_key)

    def retrieve_link(self, link_id: str):
        return self.request("GET", "/v1/payment-links/" + parse.quote(link_id, safe=""))

    def list_links(self, **query):
        return self.request("GET", "/v1/payment-links", query=query)

    def update_link(self, link_id: str, status: str):
        return self.request("PATCH", "/v1/payment-links/" + parse.quote(link_id, safe=""), body={"status": status})

    def create_product(self, body: dict):
        return self.request("POST", "/v1/products", body=body)

    def list_products(self, **query):
        return self.request("GET", "/v1/products", query=query)

    def create_price(self, body: dict):
        return self.request("POST", "/v1/prices", body=body)

    def list_prices(self, **query):
        return self.request("GET", "/v1/prices", query=query)

    def create_subscription(self, body: dict, idempotency_key: str):
        return self.request("POST", "/v1/subscriptions", body=body, idempotency_key=idempotency_key)

    def retrieve_subscription(self, subscription_id: str):
        return self.request("GET", "/v1/subscriptions/" + parse.quote(subscription_id, safe=""))

    def list_subscriptions(self, **query):
        return self.request("GET", "/v1/subscriptions", query=query)

    def cancel_subscription(self, subscription_id: str, at_period_end: bool = True):
        return self.request("POST", "/v1/subscriptions/" + parse.quote(subscription_id, safe="") + "/cancel", body={"at_period_end": at_period_end})

    def retrieve_invoice(self, invoice_id: str):
        return self.request("GET", "/v1/invoices/" + parse.quote(invoice_id, safe=""))

    def list_invoices(self, **query):
        return self.request("GET", "/v1/invoices", query=query)

    def create_refund(self, body: dict, idempotency_key: str):
        return self.request("POST", "/v1/refunds", body=body, idempotency_key=idempotency_key)

    def retrieve_refund(self, refund_id: str):
        return self.request("GET", "/v1/refunds/" + parse.quote(refund_id, safe=""))

    def list_refunds(self, **query):
        return self.request("GET", "/v1/refunds", query=query)

    def create_webhook(self, body: dict):
        return self.request("POST", "/v1/webhooks", body=body)

    def list_webhooks(self, **query):
        return self.request("GET", "/v1/webhooks", query=query)

    def list_deliveries(self, **query):
        return self.request("GET", "/v1/webhook-deliveries", query=query)

    def retrieve_delivery(self, delivery_id: str):
        return self.request("GET", "/v1/webhook-deliveries/" + parse.quote(delivery_id, safe=""))

    def retry_delivery(self, delivery_id: str):
        return self.request("POST", "/v1/webhook-deliveries/" + parse.quote(delivery_id, safe="") + "/retry", body={})

    def disable_link(self, link_id: str):
        return self.request("POST", "/v1/payment-links/" + parse.quote(link_id, safe="") + "/disable", body={})

    def disable_webhook(self, webhook_id: str):
        return self.request("POST", "/v1/webhooks/" + parse.quote(webhook_id, safe="") + "/disable", body={})

    def rotate_webhook(self, webhook_id: str):
        return self.request("POST", "/v1/webhooks/" + parse.quote(webhook_id, safe="") + "/rotate", body={})

    def create_credential(self, body: dict):
        return self.request("POST", "/v1/credentials", body=body)

    def rotate_credential(self, credential_id: str):
        return self.request("POST", "/v1/credentials/" + parse.quote(credential_id, safe="") + "/rotate", body={})

    def revoke_credential(self, credential_id: str):
        return self.request("POST", "/v1/credentials/" + parse.quote(credential_id, safe="") + "/revoke", body={})
