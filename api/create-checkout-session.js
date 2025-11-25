// FILE: /api/create-checkout-session.js
import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { pack } = req.body || {};
    // pack = "5", "10", "20", ecc.

    let credits = 5;
    let amount = 199; // in centesimi -> 1,99 €

    if (pack === "10") {
      credits = 10;
      amount = 299;   // 2,99 €
    } else if (pack === "20") {
      credits = 20;
      amount = 499;   // 4,99 €
    }

    // Prende il dominio AUTOMATICAMENTE
    // 1) prima prova con req.headers.origin
    // 2) se manca, usa https:// + req.headers.host
    const origin =
      req.headers.origin ||
      (req.headers.host ? `https://${req.headers.host}` : "https://example.com");

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      line_items: [
        {
          price_data: {
            currency: "eur",
            product_data: {
              name: `What?f — Pacchetto ${credits} crediti`,
            },
            unit_amount: amount, // in centesimi
          },
          quantity: 1,
        },
      ],
      metadata: {
        credits: String(credits),
      },
      success_url: `${origin}/fourth.html?payment=ok&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/fourth.html?payment=ko`,
    });

    return res.status(200).json({ url: session.url });
  } catch (err) {
    console.error("Stripe error:", err);
    return res.status(500).json({ error: "Stripe error" });
  }
}
