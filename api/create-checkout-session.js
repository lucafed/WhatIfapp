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
    // pack può essere: "5", "15", "30"

    // ===== Calcolo crediti e prezzo =====
    let credits = 5;
    let amount = 199; // €1,99

    if (pack === "15") {
      credits = 15;
      amount = 399; // €3,99
    } else if (pack === "30") {
      credits = 30;
      amount = 699; // €6,99
    } else if (pack === "5") {
      credits = 5;
      amount = 199; // €1,99
    }

    // Fallback di sicurezza
    if (!["5", "15", "30"].includes(String(pack))) {
      credits = 5;
      amount = 199;
    }

    // ===== Rileva dominio automaticamente =====
    const origin =
      req.headers.origin ||
      (req.headers.host ? `https://${req.headers.host}` : "https://example.com");

    // ===== Crea sessione Stripe Checkout =====
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
            unit_amount: amount,
          },
          quantity: 1,
        },
      ],
      metadata: {
        credits: String(credits),
        pack: String(pack || credits),
      },

      // ⭐️⭐️⭐️ IMPORTANTE: includo &pack nella URL
      success_url: `${origin}/fourth.html?payment=ok&pack=${credits}&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/fourth.html?payment=ko`,
    });

    return res.status(200).json({ url: session.url });
  } catch (err) {
    console.error("Stripe error:", err);
    return res.status(500).json({ error: "Stripe error" });
  }
}
