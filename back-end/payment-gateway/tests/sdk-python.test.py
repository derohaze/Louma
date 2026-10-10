import hashlib
import hmac
import math
import sys
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'sdk' / 'python'))
from louma_payments import LoumaClient, GatewayError, verify_webhook

class Responses(BaseHTTPRequestHandler):
    def do_GET(self):
        content = {'null': b'null', 'array': b'[]', 'broken': b'{broken', 'failure': b'{"error":{"code":"rate_limit_exceeded","message":"rate limit","request_id":"fixture-request"}}'}
        kind = self.path.rsplit('/', 1)[-1]
        self.send_response(429 if kind == 'failure' else 200)
        self.send_header('Content-Type', 'application/json')
        self.end_headers()
        self.wfile.write(content[kind])
    def log_message(self, *args):
        pass

class SDKTest(unittest.TestCase):
    def test_webhook(self):
        body, now = '{"message":"اشتراك"}'.encode(), 1700000000
        def signed(timestamp):
            digest = hmac.new(b'fixture-secret', str(timestamp).encode() + b'.' + body, hashlib.sha256).hexdigest()
            return f't={timestamp},v1={digest}'
        for timestamp in [now, now - 300, now + 30]:
            self.assertTrue(verify_webhook('fixture-secret', body, signed(timestamp), now))
        for timestamp in [now - 301, now + 31]:
            self.assertFalse(verify_webhook('fixture-secret', body, signed(timestamp), now))
        self.assertFalse(verify_webhook('wrong', body, signed(now), now))
        self.assertFalse(verify_webhook('fixture-secret', b'{}', signed(now), now))
        for signature in ['', 't=no,v1=bad', signed(now) + '\n', 't=' + '9' * 5000 + ',v1=' + '0' * 64, None]:
            self.assertFalse(verify_webhook('fixture-secret', body, signature, now))

    def test_config(self):
        self.assertEqual(LoumaClient('lma_live_fixture', 'https://example.com').environment, 'live')
        for options in [dict(environment='live'), dict(base_url='http://example.com'), dict(base_url='https://user@example.com'), dict(timeout=0), dict(timeout=math.nan), dict(timeout=math.inf)]:
            with self.assertRaises(ValueError):
                LoumaClient(**{**dict(api_key='lma_test_fixture', base_url='http://127.0.0.1'), **options})

    def test_response_errors(self):
        server = ThreadingHTTPServer(('127.0.0.1', 0), Responses)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            client = LoumaClient('lma_test_fixture', f'http://127.0.0.1:{server.server_port}')
            self.assertNotIn('lma_test_fixture', repr(client))
            for kind in ['null', 'array', 'broken']:
                with self.assertRaises(GatewayError) as caught:
                    client.retrieve_payment(kind)
                self.assertEqual(caught.exception.code, 'invalid_response')
                self.assertEqual(caught.exception.status, 200)
            with self.assertRaises(GatewayError) as caught:
                client.retrieve_payment('failure')
            self.assertEqual((caught.exception.status, caught.exception.code, caught.exception.request_id), (429, 'rate_limit_exceeded', 'fixture-request'))
        finally:
            server.shutdown()
            server.server_close()
            thread.join()

if __name__ == '__main__':
    unittest.main()
