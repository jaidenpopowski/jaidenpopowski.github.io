const { onRequest } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const admin = require("firebase-admin");

admin.initializeApp();

const stripeSecret = defineSecret("STRIPE_SECRET");
const stripeWebhookSecret = defineSecret("STRIPE_WEBHOOK_SECRET");

exports.stripeWebhook = onRequest(
  { secrets: [stripeSecret, stripeWebhookSecret] },
  async (req, res) => {
    const stripe = require("stripe")(stripeSecret.value());
    const sig = req.headers["stripe-signature"];

    let event;
    try {
      event = stripe.webhooks.constructEvent(
        req.rawBody,
        sig,
        stripeWebhookSecret.value()
      );
    } catch (err) {
      console.error("Webhook signature failed:", err.message);
      return res.status(400).send(`Webhook error: ${err.message}`);
    }

    if (event.type === "checkout.session.completed") {
      const session = event.data.object;
      const uid = session.client_reference_id;

      if (uid) {
        await admin.firestore()
          .collection("users")
          .doc(uid)
          .update({ paid: true });
        console.log("Marked paid for UID:", uid);
      } else {
        console.warn("No client_reference_id on session:", session.id);
      }
    }

    res.json({ received: true });
  }
);