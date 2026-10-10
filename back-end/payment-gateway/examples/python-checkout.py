"""Minimal merchant backend. Run: LOUMA_API_KEY=lma_test_... python python-checkout.py"""
import os
import uuid
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'sdk' / 'python'))

from louma_payments import LoumaClient

client = LoumaClient(
    api_key=os.environ.get("LOUMA_API_KEY", ""),
    base_url=os.environ.get("LOUMA_BASE_URL", "http://localhost:8000"),
)

checkout = client.create_checkout(
    {
        "subtotal": "100.0000",
        "tax": "0.0000",
        "currency": "LMA",
        "description": "Example order #42",
        "success_url": "https://example.com/success",
        "cancel_url": "https://example.com/cancel",
    },
    str(uuid.uuid4()),
)
print("redirect buyer to:", checkout.get("checkout_url", checkout.get("id")))

payment = client.retrieve_payment(checkout.get("payment_id", checkout.get("id")))
print("status:", payment["status"])
