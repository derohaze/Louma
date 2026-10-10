// Existing gateway v1 validators, preserved during the runtime port.
export const gatewaySchemas = {
  gateway_applications: {
    required: [
      "publicId",
      "ownerUserId",
      "name",
      "walletId",
      "domains",
      "status",
      "version",
      "createdAt",
    ],
    properties: {
      publicId: {
        bsonType: "string",
        minLength: 36,
        maxLength: 36,
      },
      ownerUserId: {
        bsonType: "string",
        minLength: 36,
        maxLength: 36,
      },
      walletId: {
        bsonType: "string",
        minLength: 36,
        maxLength: 36,
      },
      name: {
        bsonType: "string",
        maxLength: 240,
      },
      domains: {
        bsonType: "array",
        maxItems: 16,
        items: {
          bsonType: "string",
          maxLength: 240,
        },
      },
      status: {
        enum: ["active", "suspended"],
      },
      version: {
        bsonType: "int",
        minimum: 0,
      },
      createdAt: {
        bsonType: "date",
      },
    },
  },
  gateway_credentials: {
    required: [
      "publicId",
      "applicationId",
      "hash",
      "scopes",
      "status",
      "expiresAt",
      "version",
    ],
    properties: {
      publicId: {
        bsonType: "string",
        minLength: 36,
        maxLength: 36,
      },
      applicationId: {
        bsonType: "string",
        minLength: 36,
        maxLength: 36,
      },
      hash: {
        bsonType: "string",
        maxLength: 240,
      },
      scopes: {
        bsonType: "array",
        maxItems: 8,
        items: {
          bsonType: "string",
          maxLength: 240,
        },
      },
      status: {
        enum: ["active", "revoked"],
      },
      version: {
        bsonType: "int",
      },
      expiresAt: {
        bsonType: ["date", "null"],
      },
    },
  },
  gateway_payments: {
    required: [
      "publicId",
      "applicationId",
      "totalMinor",
      "subtotalMinor",
      "taxMinor",
      "feeMinor",
      "netMinor",
      "intentHash",
      "status",
      "idempotencyKey",
      "requestFingerprint",
      "createdAt",
      "expiresAt",
    ],
    properties: {
      publicId: {
        bsonType: "string",
        minLength: 36,
        maxLength: 36,
      },
      applicationId: {
        bsonType: "string",
        minLength: 36,
        maxLength: 36,
      },
      subtotalMinor: {
        bsonType: ["int", "long"],
        minimum: 0,
        maximum: 9007199254740000,
      },
      taxMinor: {
        bsonType: ["int", "long"],
        minimum: 0,
        maximum: 9007199254740000,
      },
      totalMinor: {
        bsonType: ["int", "long"],
        minimum: 0,
        maximum: 9007199254740000,
      },
      feeMinor: {
        bsonType: ["int", "long"],
        minimum: 0,
        maximum: 9007199254740000,
      },
      netMinor: {
        bsonType: ["int", "long"],
        minimum: 0,
        maximum: 9007199254740000,
      },
      refundedMinor: {
        bsonType: ["int", "long"],
        minimum: 0,
        maximum: 9007199254740000,
      },
      metadata: {
        bsonType: "object",
        maxProperties: 16,
        additionalProperties: {
          bsonType: "string",
          maxLength: 240,
        },
      },
      status: {
        enum: ["requires_action", "succeeded", "canceled", "failed"],
      },
      createdAt: {
        bsonType: "date",
      },
      expiresAt: {
        bsonType: "date",
      },
    },
  },
  gateway_approvals: {
    required: [
      "publicId",
      "paymentId",
      "ownerUserId",
      "walletId",
      "sessionId",
      "intentHash",
      "idempotencyKey",
      "proof",
      "consumed",
      "expiresAt",
    ],
    properties: {
      publicId: {
        bsonType: "string",
        minLength: 36,
        maxLength: 36,
      },
      paymentId: {
        bsonType: "string",
        minLength: 36,
        maxLength: 36,
      },
      ownerUserId: {
        bsonType: "string",
        minLength: 36,
        maxLength: 36,
      },
      walletId: {
        bsonType: "string",
        minLength: 36,
        maxLength: 36,
      },
      consumed: {
        bsonType: "bool",
      },
      expiresAt: {
        bsonType: "date",
      },
      proof: {
        bsonType: "object",
        properties: {
          verifiedHashes: {
            bsonType: "array",
            maxItems: 16,
            items: {
              bsonType: "string",
              maxLength: 240,
            },
          },
          remainingHashes: {
            bsonType: "array",
            maxItems: 16,
            items: {
              bsonType: "string",
              maxLength: 240,
            },
          },
        },
      },
    },
  },
  gateway_products: {
    required: ["publicId", "applicationId", "name", "status", "createdAt"],
    properties: {
      publicId: {
        bsonType: "string",
        minLength: 36,
        maxLength: 36,
      },
      applicationId: {
        bsonType: "string",
        minLength: 36,
        maxLength: 36,
      },
      name: {
        bsonType: "string",
        maxLength: 240,
      },
      status: {
        enum: ["active", "archived"],
      },
    },
  },
  gateway_prices: {
    required: [
      "publicId",
      "applicationId",
      "productId",
      "amountMinor",
      "interval",
      "version",
      "status",
    ],
    properties: {
      publicId: {
        bsonType: "string",
        minLength: 36,
        maxLength: 36,
      },
      applicationId: {
        bsonType: "string",
        minLength: 36,
        maxLength: 36,
      },
      productId: {
        bsonType: "string",
        minLength: 36,
        maxLength: 36,
      },
      amountMinor: {
        bsonType: ["int", "long"],
        minimum: 0,
        maximum: 9007199254740000,
      },
      interval: {
        enum: ["", "month", "year"],
      },
      version: {
        bsonType: "int",
        minimum: 1,
      },
    },
  },
  gateway_subscriptions: {
    required: [
      "publicId",
      "applicationId",
      "payerUserId",
      "payerWalletId",
      "priceId",
      "priceVersion",
      "amountMinor",
      "interval",
      "status",
      "mandateActive",
      "policyVersion",
      "consentAt",
      "anchorAt",
      "cycle",
      "dueAt",
      "version",
    ],
    properties: {
      publicId: {
        bsonType: "string",
        minLength: 36,
        maxLength: 36,
      },
      applicationId: {
        bsonType: "string",
        minLength: 36,
        maxLength: 36,
      },
      amountMinor: {
        bsonType: ["int", "long"],
        minimum: 0,
        maximum: 9007199254740000,
      },
      mandateActive: {
        bsonType: "bool",
      },
      interval: {
        enum: ["month", "year"],
      },
      status: {
        enum: ["active", "past_due", "paused", "canceled"],
      },
      cycle: {
        bsonType: "int",
        minimum: 1,
        maximum: 1200,
      },
      version: {
        bsonType: "int",
      },
      dueAt: {
        bsonType: "date",
      },
    },
  },
  gateway_invoices: {
    required: [
      "publicId",
      "applicationId",
      "subscriptionId",
      "cycle",
      "amountMinor",
      "status",
      "paymentId",
      "periodStart",
      "periodEnd",
      "dueAt",
      "attempts",
      "leaseUntil",
      "fence",
    ],
    properties: {
      publicId: {
        bsonType: "string",
        minLength: 36,
        maxLength: 36,
      },
      applicationId: {
        bsonType: "string",
        minLength: 36,
        maxLength: 36,
      },
      subscriptionId: {
        bsonType: "string",
        minLength: 36,
        maxLength: 36,
      },
      amountMinor: {
        bsonType: ["int", "long"],
        minimum: 0,
        maximum: 9007199254740000,
      },
      cycle: {
        bsonType: "int",
        minimum: 0,
      },
      attempts: {
        bsonType: "int",
        minimum: 0,
        maximum: 4,
      },
      fence: {
        bsonType: "int",
      },
      status: {
        enum: ["open", "paid", "void", "uncollectible"],
      },
      dueAt: {
        bsonType: "date",
      },
      leaseUntil: {
        bsonType: "date",
      },
    },
  },
  gateway_refunds: {
    required: [
      "publicId",
      "applicationId",
      "paymentId",
      "amountMinor",
      "status",
      "idempotencyKey",
      "requestFingerprint",
      "createdAt",
    ],
    properties: {
      publicId: {
        bsonType: "string",
        minLength: 36,
        maxLength: 36,
      },
      applicationId: {
        bsonType: "string",
        minLength: 36,
        maxLength: 36,
      },
      paymentId: {
        bsonType: "string",
        minLength: 36,
        maxLength: 36,
      },
      amountMinor: {
        bsonType: ["int", "long"],
        minimum: 0,
        maximum: 9007199254740000,
      },
      status: {
        enum: ["pending", "succeeded", "failed"],
      },
    },
  },
  gateway_links: {
    required: ["publicId", "applicationId", "input", "status", "createdAt"],
    properties: {
      publicId: {
        bsonType: "string",
        minLength: 36,
        maxLength: 36,
      },
      applicationId: {
        bsonType: "string",
        minLength: 36,
        maxLength: 36,
      },
      input: {
        bsonType: "object",
        properties: {
          metadata: {
            bsonType: "object",
            maxProperties: 16,
            additionalProperties: {
              bsonType: "string",
              maxLength: 240,
            },
          },
        },
      },
      status: {
        enum: ["active", "disabled"],
      },
    },
  },
  gateway_webhooks: {
    required: [
      "publicId",
      "applicationId",
      "url",
      "events",
      "encryptedSecret",
      "status",
    ],
    properties: {
      publicId: {
        bsonType: "string",
        minLength: 36,
        maxLength: 36,
      },
      applicationId: {
        bsonType: "string",
        minLength: 36,
        maxLength: 36,
      },
      url: {
        bsonType: "string",
        maxLength: 2048,
      },
      events: {
        bsonType: "array",
        maxItems: 16,
        items: {
          bsonType: "string",
          maxLength: 240,
        },
      },
      status: {
        enum: ["active", "disabled"],
      },
    },
  },
  gateway_events: {
    required: [
      "publicId",
      "applicationId",
      "type",
      "resourceId",
      "createdAt",
      "expanded",
    ],
    properties: {
      publicId: {
        bsonType: "string",
        minLength: 36,
        maxLength: 36,
      },
      applicationId: {
        bsonType: "string",
        minLength: 36,
        maxLength: 36,
      },
      type: {
        bsonType: "string",
        maxLength: 240,
      },
      resourceId: {
        bsonType: "string",
        minLength: 36,
        maxLength: 36,
      },
      createdAt: {
        bsonType: "date",
      },
    },
  },
  gateway_deliveries: {
    required: [
      "publicId",
      "applicationId",
      "eventId",
      "endpointId",
      "status",
      "attempts",
      "dueAt",
      "leaseUntil",
      "fence",
      "createdAt",
    ],
    properties: {
      publicId: {
        bsonType: "string",
        minLength: 36,
        maxLength: 36,
      },
      applicationId: {
        bsonType: "string",
        minLength: 36,
        maxLength: 36,
      },
      eventId: {
        bsonType: "string",
        minLength: 36,
        maxLength: 36,
      },
      endpointId: {
        bsonType: "string",
        minLength: 36,
        maxLength: 36,
      },
      status: {
        enum: ["pending", "succeeded", "failed"],
      },
      attempts: {
        bsonType: "int",
        minimum: 0,
        maximum: 8,
      },
      dueAt: {
        bsonType: "date",
      },
      leaseUntil: {
        bsonType: "date",
      },
      fence: {
        bsonType: "int",
      },
    },
  },
};
