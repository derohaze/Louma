"""Validate actual gateway responses against the shipped OpenAPI 3.1 schemas.

Requires installed PyYAML and jsonschema; never contacts a production gateway.
"""
import json
import os
import sys
import unittest
import uuid
from pathlib import Path
from urllib.parse import urlsplit
import yaml
from jsonschema import Draft202012Validator, FormatChecker

root = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(root / 'sdk' / 'python'))
from louma_payments import LoumaClient

class ContractTest(unittest.TestCase):
    def test_generated_documents_match_and_schemas_are_valid(self):
        contract = json.loads((root / 'api' / 'openapi.json').read_text())
        self.assertEqual(contract, yaml.safe_load((root / 'api' / 'openapi.yaml').read_text(encoding='utf-8')))
        for schema in contract['components']['schemas'].values():
            Draft202012Validator.check_schema(schema)
        for path, operations in contract['paths'].items():
            for operation in operations.values():
                for parameter in operation['parameters']:
                    self.assertIn(parameter['in'], ['path', 'header', 'query'])
                    if parameter['in'] == 'path':
                        self.assertIn('{' + parameter['name'] + '}', path)

    @unittest.skipUnless(os.environ.get('LMA_API_KEY_FILE'), 'set LMA_API_KEY_FILE for real contract checks')
    def test_real_api_responses(self):
        contract = json.loads((root / 'api' / 'openapi.json').read_text())
        base = os.environ.get('LMA_BASE_URL', 'http://127.0.0.1:8000')
        self.assertIn(urlsplit(base).hostname, ['localhost','127.0.0.1','::1'])
        key = Path(os.environ['LMA_API_KEY_FILE']).read_text().strip()
        self.assertTrue(key.startswith('lma_test_'))
        client = LoumaClient(key,base)
        def validate(resource, schema):
            document = {'$ref': '#/components/schemas/' + schema, 'components': contract['components']}
            Draft202012Validator(document,format_checker=FormatChecker()).validate(resource)
        checkout = client.create_checkout(dict(subtotal='2.1234',tax='0.0000',currency='LMA',description='OpenAPI contract'),str(uuid.uuid4()))
        validate(checkout,'CheckoutCreated')
        validate(client.retrieve_checkout(checkout['id']),'Payment')
        validate(client.list_payments(),'PaymentPage')
        product = client.create_product({'name':'OpenAPI contract'})
        validate(product,'Product')
        price = client.create_price(dict(product_id=product['id'],amount='1.0000',currency='LMA',interval='month'))
        validate(price,'Price')
        subscription = client.create_subscription(dict(price_id=price['id'],currency='LMA'),str(uuid.uuid4()))
        validate(subscription,'CheckoutCreated')
        validate(client.expire_checkout(checkout['id']),'Payment')
        validate(client.expire_checkout(subscription['id']),'Payment')
        link = client.create_link(dict(subtotal='1.0000',tax='0.0000',currency='LMA',description='Contract link'))
        validate(link,'Link')
        validate(client.retrieve_link(link['id']),'Link')
        validate(client.disable_link(link['id']),'Link')
        for method,schema in [(client.list_products,'ProductPage'),(client.list_prices,'PricePage'),(client.list_subscriptions,'SubscriptionPage'),(client.list_invoices,'InvoicePage'),(client.list_refunds,'RefundPage'),(client.list_webhooks,'WebhookPage'),(client.list_deliveries,'DeliveryPage')]:
            validate(method(),schema)

if __name__ == '__main__':
    unittest.main()
