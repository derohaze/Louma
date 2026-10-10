"""Real isolated API checks; no financial confirmation or production requests."""
import os
import sys
import uuid
from pathlib import Path
from urllib.parse import urlsplit

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'sdk' / 'python'))
from louma_payments import LoumaClient, GatewayError

key = Path(os.environ['LMA_API_KEY_FILE']).read_text().strip()
assert key.startswith('lma_test_')
base = os.environ.get('LMA_BASE_URL', 'http://127.0.0.1:8000')
assert urlsplit(base).hostname in ('127.0.0.1', 'localhost', '::1')
client = LoumaClient(key, base)

def rejected(call, status, code=None):
    try:
        call()
    except GatewayError as error:
        assert error.status == status, (error.status, error.code)
        assert error.request_id
        if code:
            assert error.code == code
    else:
        raise AssertionError('request unexpectedly accepted')

body = dict(subtotal='2.1234', tax='0.0000', currency='LMA', description='SDK Python', metadata={'suite': 'sdk-matrix'})
idem = str(uuid.uuid4())
checkout = client.create_checkout(body, idem)
assert checkout['total'] == '2.1234'
assert checkout['status'] == 'requires_action'
assert checkout['checkout_url'].endswith('/checkout/' + checkout['id'])
assert client.create_checkout(body, idem)['id'] == checkout['id']
assert client.retrieve_checkout(checkout['id'])['id'] == checkout['id']
assert client.retrieve_payment(checkout['id'])['id'] == checkout['id']
page = client.list_payments()
assert isinstance(page['data'], list)
assert isinstance(page['next_cursor'], str)
rejected(lambda: client.create_checkout({**body, 'subtotal': '3.0000'}, idem), 409, 'idempotency_key_reused')
rejected(lambda: client.create_checkout({**body, 'subtotal': '-1'}, str(uuid.uuid4())), 400)
rejected(lambda: client.retrieve_payment(str(uuid.uuid4())), 404)
rejected(lambda: LoumaClient('lma_test_invalid', base).list_payments(), 401)
for api_key, endpoint, environment in [(key, base, 'live'), (key, 'http://example.com', 'test')]:
    try:
        LoumaClient(api_key, endpoint, environment)
    except ValueError:
        pass
    else:
        raise AssertionError('unsafe configuration accepted')
product = client.create_product({'name': 'SDK Python'})
price = client.create_price(dict(product_id=product['id'], amount='1.0000', currency='LMA', interval='month'))
assert price['amount_minor'] == 10000
sub_body = dict(price_id=price['id'], currency='LMA', description='Recurring SDK check')
sub_key = str(uuid.uuid4())
consent = client.create_subscription(sub_body, sub_key)
assert consent['recurring']['interval'] == 'month'
assert client.create_subscription(sub_body, sub_key)['id'] == consent['id']
assert isinstance(client.list_subscriptions()['data'], list)
rejected(lambda: client.retrieve_subscription(consent['id']), 404)
assert client.expire_checkout(checkout['id'])['status'] == 'canceled'
assert client.expire_checkout(consent['id'])['status'] == 'canceled'
print('SDK matrix: Python passed checkout, billing, authentication and error checks against real test API')
