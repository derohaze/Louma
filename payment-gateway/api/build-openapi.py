"""Build the versioned contract. Regenerate after editing schemas or route declarations."""
import json
from pathlib import Path
import yaml

ref = lambda name: {"$ref": "#/components/schemas/" + name}
text = {"type": "string"}
identifier = {"type": "string", "format": "uuid"}
date = {"type": "string", "format": "date-time"}
minor = {"type": "integer", "minimum": 0, "maximum": 9007199254740000, "description": "Exact LMA minor units: 10000 minor units = 1 LMA."}
money = {"type": "string", "pattern": r"^(0|[1-9][0-9]{0,11})\.[0-9]{4}$"}
input_money = {"type": "string", "pattern": r"^(0|[1-9][0-9]{0,11})(\.[0-9]{1,4})?$"}
def model(properties, required=None, additional=True):
    return {"type": "object", "properties": properties, "required": list(properties) if required is None else required, "additionalProperties": additional}

schemas = {
    "Error": model({"error": model({"code": text, "message": text, "request_id": identifier})}),
    "Money": money,
    "Metadata": {"type":"object","maxProperties":16,"propertyNames":{"maxLength":40},"additionalProperties":{"type":"string","maxLength":240}},
    "CheckoutInput": model({"subtotal":input_money,"tax":input_money,"currency":{"const":"LMA"},"description":{"type":"string","maxLength":240},"success_url":{"type":"string","maxLength":2048},"cancel_url":{"type":"string","maxLength":2048},"price_id":identifier,"metadata":ref("Metadata")},["currency"],False),
    "Payment": model({"id":identifier,"payment_id":identifier,"application_id":identifier,"intent_hash":{"type":"string","pattern":"^[a-f0-9]{64}$"},"status":{"enum":["requires_action","succeeded","canceled","failed"]},"currency":{"const":"LMA"},"subtotal":money,"tax":money,"total":money,"fee":money,"merchant_net":money,"fee_policy":model({"version":text,"basis_points":{"type":"integer","minimum":0,"maximum":9999}}),"description":text,"merchant":model({"id":identifier,"name":text}),"expires_at":date,"created_at":date,"transaction_reference":text,"refunded":money,"metadata":ref("Metadata"),"recurring":model({"price_id":identifier,"amount":money,"interval":{"enum":["month","year"]},"consent_policy_version":text,"description":text}),"subscription_id":identifier,"invoice_id":identifier},["id","payment_id","application_id","intent_hash","status","currency","subtotal","tax","total","fee","merchant_net","merchant","expires_at","created_at","transaction_reference","refunded","metadata"]),
    "CheckoutCreated": {"allOf":[ref("Payment"),model({"checkout_url":{"type":"string","format":"uri"}},["checkout_url"])]},
    "SubscriptionInput": model({"price_id":identifier,"currency":{"const":"LMA"},"description":{"type":"string","maxLength":240},"success_url":{"type":"string","maxLength":2048},"cancel_url":{"type":"string","maxLength":2048},"metadata":ref("Metadata")},["price_id","currency"],False),
    "Product": model({"id":identifier,"application_id":identifier,"name":text,"description":text,"status":{"enum":["active","archived"]},"created_at":date}),
    "Price": model({"id":identifier,"application_id":identifier,"product_id":identifier,"amount_minor":minor,"interval":{"enum":["","month","year"]},"version":{"type":"integer"},"status":{"enum":["active","archived"]},"created_at":date}),
    "PriceInput": model({"product_id":identifier,"amount":input_money,"currency":{"const":"LMA"},"interval":{"enum":["one_time","monthly","yearly","month","year",""]}},["product_id","amount","currency"],False),
    "Subscription": model({"id":identifier,"application_id":identifier,"price_id":identifier,"price_version":{"type":"integer"},"amount_minor":minor,"interval":{"enum":["month","year"]},"status":{"enum":["active","past_due","paused","canceled"]},"mandate_active":{"type":"boolean"},"consent_at":date,"policy_version":text,"anchor_at":date,"cycle":{"type":"integer"},"due_at":date,"cancel_at_period_end":{"type":"boolean"},"created_at":date}),
    "Invoice": model({"id":identifier,"application_id":identifier,"subscription_id":identifier,"cycle":{"type":"integer"},"amount_minor":minor,"status":text,"payment_id":identifier,"period_start":date,"period_end":date,"due_at":date,"attempts":{"type":"integer"},"created_at":date}),
    "Refund": model({"id":identifier,"application_id":identifier,"payment_id":identifier,"amount_minor":minor,"status":{"enum":["pending","succeeded"]},"transaction_reference":text,"created_at":date}),
    "RefundInput": model({"payment_id":identifier,"amount":input_money,"reason":{"type":"string","maxLength":240}},["payment_id"],False),
    "LinkInput": model({"subtotal":text,"tax":text,"currency":{"const":"LMA"},"description":text,"success_url":text,"cancel_url":text,"price_id":text,"metadata":{"anyOf":[ref("Metadata"),{"type":"null"}]}},None,False),
    "Link": model({"id":identifier,"application_id":identifier,"input":ref("LinkInput"),"url":{"type":"string","format":"uri"},"status":{"enum":["active","disabled"]},"created_at":date}),
    "Webhook": model({"id":identifier,"application_id":identifier,"url":{"type":"string","format":"uri"},"events":{"type":"array","minItems":1,"maxItems":16,"items":text},"status":{"enum":["active","disabled"]},"created_at":date}),
    "WebhookCreated": model({"id":identifier,"endpoint":ref("Webhook"),"signing_secret":text}),
    "WebhookRotated": model({"id":identifier,"signing_secret":text}),
    "WebhookInput": model({"url":{"type":"string","format":"uri","maxLength":2048},"events":{"type":"array","minItems":1,"maxItems":16,"items":text}},None,False),
    "Delivery": model({"id":identifier,"application_id":identifier,"event_id":identifier,"endpoint_id":identifier,"status":{"enum":["pending","succeeded","failed"]},"attempts":{"type":"integer","minimum":0,"maximum":8},"due_at":date,"last_status":{"type":"integer"},"created_at":date}),
    "Credential": model({"id":identifier,"application_id":identifier,"prefix":text,"scopes":{"type":"array","maxItems":8,"items":text},"status":{"enum":["active","revoked"]},"expires_at":{"type":["string","null"],"format":"date-time"},"created_at":date}),
    "CredentialCreated": model({"id":identifier,"credential":ref("Credential"),"api_key":text}),
    "Application": model({"id":identifier,"name":text,"receiving_wallet_id":identifier,"domains":{"type":"array","maxItems":16,"items":text},"status":{"enum":["active","suspended","disabled"]},"created_at":date}),
    "Event": model({"id":identifier,"type":text,"api_version":{"const":"v1"},"environment":{"enum":["test","live"]},"created_at":date,"data":model({"id":identifier})}),
    "Approval": model({"id":identifier,"payment_id":identifier,"owner_user_id":identifier,"wallet_id":identifier,"session_id":identifier,"intent_hash":text,"idempotency_key":text,"proof":model({"kind":text,"timeStep":{"type":"integer"},"passwordChangedAt":{"type":["string","null"],"format":"date-time"},"twoFactorEnabledAt":{"type":["string","null"],"format":"date-time"},"credentialId":text,"verifiedHashes":{"type":["array","null"],"maxItems":16,"items":text},"remainingHashes":{"type":["array","null"],"maxItems":16,"items":text}},["kind"]),"recurring_consent":{"type":"boolean"},"policy_version":text,"expires_at":date},["payment_id","owner_user_id","wallet_id","session_id","intent_hash","idempotency_key","proof"],False),
    "ApprovalCreated": model({"id":identifier,"approval_id":identifier,"expires_at":date},["id","expires_at"]),
    "ApprovalDetails": model({"id":identifier,"expires_at":date,"session_id":identifier,"owner_user_id":identifier,"wallet_id":identifier,"intent_hash":text,"recurring_consent":{"type":"boolean"},"policy_version":text}),
    "Usage": model({"requests":{"type":"integer","minimum":0},"errors":{"type":"integer","minimum":0},"rate_limit_per_minute":{"type":"integer","minimum":1},"environment":{"enum":["test","live"]}}),
}
for resource in ("Payment","Product","Price","Subscription","Invoice","Refund","Link","Webhook","Delivery","Credential","Application"):
    schemas[resource+"Page"]=model({"data":{"type":"array","maxItems":50,"items":ref(resource)},"next_cursor":text})

paths={}
def operation(path,method,response,*,body=None,scope=None,idempotency=False,public=False,internal=False,summary=None):
    parameters=[]
    for segment in path.split("/"):
        if segment.startswith("{"):
            parameters.append({"name":segment[1:-1],"in":"path","required":True,"schema":identifier})
    if method=="get" and response.endswith("Page"):
        parameters.append({"name":"cursor","in":"query","schema":text,"description":"Use next_cursor verbatim; omit for first page. Empty next_cursor ends pagination."})
    if idempotency:
        parameters.append({"name":"Idempotency-Key","in":"header","required":True,"schema":{"type":"string","pattern":"^[A-Za-z0-9:_-]{1,128}$"}})
    if internal:
        for name,schema in (("X-Louma-User",identifier),("X-Louma-Timestamp",text),("X-Louma-Nonce",identifier)):
            parameters.append({"name":name,"in":"header","required":True,"schema":schema})
    declared={"operationId":method+path.replace("/","_").replace("{","").replace("}","").replace("-","_"),"summary":summary or method.upper()+" "+path,"security":[] if public else [{"InternalSignature":[]}] if internal else [{"MerchantKey":[]}],"parameters":parameters,"responses":{"200":{"description":"Successful operation","content":{"application/json":{"schema":ref(response)}}}}}
    for status in (400,401,403,404,405,409,413,429,500,503,504):
        declared["responses"][str(status)]={"description":"Request rejected; inspect error.code and request_id.","content":{"application/json":{"schema":ref("Error")}}}
    if body is not None:
        declared["requestBody"]={"required":True,"content":{"application/json":{"schema":ref(body) if isinstance(body,str) else body}}}
    if scope: declared["x-louma-scope"]=scope
    paths.setdefault(path,{})[method]=declared

resources={"checkouts":"Payment","payments":"Payment","payment-links":"Link","products":"Product","prices":"Price","subscriptions":"Subscription","invoices":"Invoice","refunds":"Refund","webhooks":"Webhook","webhook-deliveries":"Delivery","credentials":"Credential"}
inputs={"checkouts":"CheckoutInput","payment-links":"CheckoutInput","products":model({"name":{"type":"string","minLength":1,"maxLength":120},"description":{"type":"string","maxLength":240}},["name"],False),"prices":"PriceInput","subscriptions":"SubscriptionInput","refunds":"RefundInput","webhooks":"WebhookInput","credentials":model({"scopes":{"type":"array","minItems":1,"maxItems":8,"items":text},"expires_at":{"type":["string","null"],"format":"date-time"}},["scopes"],False)}
scopes={"subscriptions":"subscriptions:manage","products":"products:manage","prices":"products:manage","webhooks":"webhooks:manage","webhook-deliveries":"webhooks:manage","credentials":"credentials:manage"}
for resource,output in resources.items():
    scope=scopes.get(resource,"payments:read")
    operation("/v1/"+resource,"get",output+"Page",scope=scope)
    operation("/v1/"+resource+"/{id}","get",output,scope=scope)
    if resource in inputs:
        write_scope={"checkouts":"checkout:create","payment-links":"checkout:create","refunds":"refunds:create"}.get(resource,scope)
        operation("/v1/"+resource,"post",{"checkouts":"CheckoutCreated","subscriptions":"CheckoutCreated","webhooks":"WebhookCreated","credentials":"CredentialCreated"}.get(resource,output),body=inputs[resource],scope=write_scope,idempotency=resource in ("checkouts","subscriptions","refunds"))
for resource,status in (("payment-links","disabled"),("products","archived"),("webhooks","disabled")):
    operation("/v1/"+resource+"/{id}","patch",resources[resource],body=model({"status":{"const":status}},None,False),scope=scopes.get(resource,"checkout:create"))
for resource,action,body in (("checkouts","expire",model({},[],False)),("subscriptions","cancel",model({"at_period_end":{"type":"boolean"}},None,False)),("credentials","revoke",model({},[],False)),("webhook-deliveries","retry",model({},[],False))):
    operation("/v1/"+resource+"/{id}/"+action,"post",resources[resource],body=body,scope=scopes.get(resource,"checkout:create"))
for resource,action,response in (("payment-links","disable","Link"),("webhooks","disable","Webhook"),("webhooks","rotate","WebhookRotated"),("credentials","rotate","CredentialCreated")):
    operation("/v1/"+resource+"/{id}/"+action,"post",response,body=model({},[],False),scope=scopes.get(resource,"checkout:create"))

for endpoint,status in (("/healthz","ok"),("/readyz","ready")):
    schemas[status.title()+"Health"]=model({"status":{"const":status}})
    operation(endpoint,"get",status.title()+"Health",public=True)
for endpoint in ("/checkout/{id}","/pay/{id}"):
    operation(endpoint,"get","Payment",public=True)
    paths[endpoint]["get"]["responses"]["200"]["content"]={"text/html":{"schema":{"type":"string"}}}
    paths[endpoint]["get"]["responses"]["303"]={"description":"Redirect to the hosted checkout/login handoff."}

operation("/internal/v1/applications","get","ApplicationPage",internal=True)
operation("/internal/v1/applications","post","Application",body=model({"name":{"type":"string","maxLength":120},"receiving_wallet_id":identifier,"wallet_id":identifier,"domains":{"type":"array","maxItems":16,"items":text},"idempotency_key":{"type":"string","pattern":"^[A-Za-z0-9:_-]{1,128}$"}},["name","idempotency_key"],False),internal=True)
operation("/internal/v1/applications/{application_id}","get","Application",internal=True)
operation("/internal/v1/applications/{application_id}","patch","Application",body=model({"status":{"enum":["suspended","disabled"]},"name":{"type":"string","minLength":1,"maxLength":120},"receiving_wallet_id":identifier,"domains":{"type":"array","maxItems":16,"items":text}},[],False),internal=True,summary="Update application configuration, or suspend; status cannot be combined with other fields.")
for path,methods in list(paths.items()):
    if not path.startswith("/v1/"): continue
    for method,declared in methods.items():
        import copy
        internal_path="/internal/v1/applications/{application_id}/"+path[4:]
        mirrored=copy.deepcopy(declared)
        mirrored["security"]=[{"InternalSignature":[]}]
        mirrored["operationId"]="internal_"+declared["operationId"]
        mirrored["parameters"] += [{"name":"application_id","in":"path","required":True,"schema":identifier}]+[{"name":name,"in":"header","required":True,"schema":schema} for name,schema in (("X-Louma-User",identifier),("X-Louma-Timestamp",text),("X-Louma-Nonce",identifier))]
        paths.setdefault(internal_path,{})[method]=mirrored
operation("/internal/v1/checkout/{id}","get","Payment",internal=True)
operation("/internal/v1/checkout/{id}/confirm","post","Payment",body=model({"approval_id":identifier,"intent_hash":text,"idempotency_key":text},None,False),internal=True)
operation("/internal/v1/approvals","post","ApprovalCreated",body="Approval",internal=True)
operation("/internal/v1/approvals","get","ApprovalDetails",internal=True)
paths["/internal/v1/approvals"]["get"]["parameters"] += [{"name":name,"in":"query","required":True,"schema":text} for name in ("payment_id","idempotency_key")]
operation("/internal/v1/customer-subscriptions/{id}/cancel","post","Subscription",body=model({},[],False),internal=True)
paths["/internal/v1/customer-subscriptions/{id}/cancel"]["post"]["responses"]["200"]["content"]["application/json"]["schema"]=model({"status":{"const":"canceled"}})
operation("/internal/v1/applications/{application_id}/usage","get","Usage",internal=True)
for resource,action,response,scope in (("credentials","revoke","Credential","credentials:manage"),("credentials","rotate","CredentialCreated","credentials:manage"),("links","disable","Link","checkout:create"),("subscriptions","cancel","Subscription","subscriptions:manage"),("webhooks","disable","Webhook","webhooks:manage"),("webhooks","rotate","WebhookRotated","webhooks:manage"),("deliveries","retry","Delivery","webhooks:manage")):
    operation("/internal/v1/"+resource+"/{id}/"+action,"post",response,body=model({"at_period_end":{"type":"boolean"}} if action=="cancel" else {},[],False),scope=scope,internal=True)
operation("/internal/v1/metrics","get","Payment",internal=True)
paths["/internal/v1/metrics"]["get"]["responses"]["200"]["content"]={"text/plain":{"schema":text}}

contract={"openapi":"3.1.1","info":{"title":"Louma Payments API","version":"1.0.0","description":"One environment per process. Merchant keys create consent checkouts; payer confirmation is an internal session-bound operation. Money inputs and payment views are decimal strings; catalog/billing/refund views expose exact integer amount_minor. Requests are limited to 64 KiB. SDKs never retry automatically."},"servers":[{"url":"http://127.0.0.1:8090","description":"Local test process; override with your configured gateway URL."}],"paths":paths,"components":{"securitySchemes":{"MerchantKey":{"type":"http","scheme":"bearer","bearerFormat":"lma_test_... or lma_live_..."},"InternalSignature":{"type":"apiKey","in":"header","name":"X-Louma-Signature","description":"HMAC-SHA256 of timestamp, nonce, method, request URI, authenticated owner UUID, and SHA256(raw body), joined with newline. Trusted Node service only; 60-second past/30-second future window and durable nonce replay rejection."}},"schemas":schemas},"webhooks":{"gatewayEvent":{"post":{"summary":"At-least-once gateway event","parameters":[{"name":"Louma-Signature","in":"header","required":True,"schema":text,"description":"t=seconds,v1=hex HMAC-SHA256(secret, timestamp + '.' + raw request body). Reject older than 300 seconds or more than 30 seconds in the future."}],"requestBody":{"required":True,"content":{"application/json":{"schema":ref("Event")}}},"responses":{"200":{"description":"Event durably accepted. Dedupe by event id; verify authoritative payment before fulfillment."},"400":{"description":"Invalid signature or malformed event."},"503":{"description":"Not accepted; eligible for bounded retry."}}}}}}
Path(__file__).with_name('openapi.json').write_text(json.dumps(contract,indent=2)+'\n',encoding='utf-8')
Path(__file__).with_name('openapi.yaml').write_text(yaml.safe_dump(contract,sort_keys=False,allow_unicode=True),encoding='utf-8')
print(f'OpenAPI: {len(paths)} paths, {sum(len(methods) for methods in paths.values())} operations')
