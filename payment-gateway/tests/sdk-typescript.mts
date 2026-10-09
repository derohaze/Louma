import { LoumaClient } from '../sdk/javascript/index.js';
import type { CheckoutInput, SubscriptionInput, PriceInput } from '../sdk/javascript/index.js';
import { runMatrix } from './sdk-matrix.mjs';

// Compile the public declarations and exercise the same real HTTP matrix in TS.
const checkout: CheckoutInput = { subtotal: '2.1234', tax: '0.0000', currency: 'LMA', description: 'TS' };
const subscription: SubscriptionInput = { price_id: 'id', currency: 'LMA' };
const price: PriceInput = { product_id: 'id', amount: '1.0000', currency: 'LMA', interval: 'month' };
void checkout; void subscription; void price;
await runMatrix(LoumaClient, 'TypeScript');
