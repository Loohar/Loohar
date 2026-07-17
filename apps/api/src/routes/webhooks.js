import { Router } from "express";
import { handleStripeConnectWebhook } from "../modules/orderPayments/orderPaymentService.js";
import { handleStripePlatformWebhook } from "../modules/platformBilling/platformBillingService.js";
import { parseRawWebhook, verifyStripeWebhook } from "../modules/paymentProviders/stripeRest.js";

export const stripePlatformWebhookRouter = Router();
export const stripeConnectWebhookRouter = Router();
export const authorizeNetPlatformWebhookRouter = Router();
export const authorizeNetOrdersWebhookRouter = Router();

stripePlatformWebhookRouter.post("/", async (req, res, next) => {
  try {
    const { rawBody, payload } = parseRawWebhook(req);
    verifyStripeWebhook({
      rawBody,
      payload,
      signatureHeader: req.get("stripe-signature") || "",
      webhookSecret: process.env.STRIPE_PLATFORM_WEBHOOK_SECRET
    });
    res.json(await handleStripePlatformWebhook(payload));
  } catch (error) {
    next(error);
  }
});

stripeConnectWebhookRouter.post("/", async (req, res, next) => {
  try {
    const { rawBody, payload } = parseRawWebhook(req);
    verifyStripeWebhook({
      rawBody,
      payload,
      signatureHeader: req.get("stripe-signature") || "",
      webhookSecret: process.env.STRIPE_CONNECT_WEBHOOK_SECRET
    });
    res.json(await handleStripeConnectWebhook(payload));
  } catch (error) {
    next(error);
  }
});

function authorizeNetDisabled(req, res) {
  res.status(process.env.AUTHORIZE_NET_ENABLED === "true" ? 501 : 503).json({
    error: process.env.AUTHORIZE_NET_ENABLED === "true"
      ? "Authorize.Net webhook handling is reserved for sandbox certification in a later phase."
      : "Authorize.Net is disabled. Enable only after sandbox testing passes.",
    provider: "authorize_net"
  });
}

authorizeNetPlatformWebhookRouter.post("/", authorizeNetDisabled);
authorizeNetOrdersWebhookRouter.post("/", authorizeNetDisabled);
