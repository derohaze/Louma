"""Telegram bot sketch: grant access only after verified settlement.

Requires: httpx, LOUMA_API_KEY, TELEGRAM_BOT_TOKEN. Polling loop omitted;
wire do_buy/do_claim into your bot framework's /buy and /claim handlers.
"""
import os
import uuid
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'sdk' / 'python'))

import httpx

from louma_payments import LoumaClient

louma = LoumaClient(
    api_key=os.environ.get("LOUMA_API_KEY", ""),
    base_url=os.environ.get("LOUMA_BASE_URL", "http://localhost:8000"),
)
TG = f"https://api.telegram.org/bot{os.environ.get('TELEGRAM_BOT_TOKEN', '')}"
pending: dict[str, int] = {}  # payment_id -> telegram user id (use a real DB)


def send(chat_id: int, text: str) -> None:
    httpx.post(f"{TG}/sendMessage", json={"chat_id": chat_id, "text": text}, timeout=10)


def do_buy(chat_id: int) -> None:
    checkout = louma.create_checkout(
        {
            "subtotal": "10.0000",
            "tax": "0.0000",
            "currency": "LMA",
            "description": f"Premium for {chat_id}",
            "metadata": {"telegram_user": str(chat_id)},
        },
        str(uuid.uuid4()),
    )
    payment_id = checkout.get("payment_id", checkout.get("id"))
    pending[payment_id] = chat_id
    send(chat_id, f"Pay here: {checkout.get('checkout_url', payment_id)}\n"
                  f"Then send /claim {payment_id}")


def do_claim(chat_id: int, payment_id: str) -> None:
    payment = louma.retrieve_payment(payment_id)  # authoritative record
    if payment["status"] == "succeeded" and pending.get(payment_id) == chat_id:
        del pending[payment_id]
        send(chat_id, "Premium granted — payment verified.")
    else:
        send(chat_id, f"Not settled yet (status: {payment['status']}).")
