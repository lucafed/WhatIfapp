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

    // ✅ QUI decidiamo quanti crediti e quanto costa
    //    (puoi cambiare gli importi come vuoi)
    let credits = 5;
    let amount = 199; // in centesimi -> 1,99 €

    if (pack === "15") {
      credits = 15;
      amount = 399; // 3,99 €
    } else if (pack === "30") {
      credits = 30;
      amount = 699; // 6,99 €
    } else if (pack === "5") {
      credits = 5;
      amount = 199; // 1,99 €
    }

    // Se arriva un valore strano, fallback a 5 crediti
    if (!["5", "15", "30"].includes(String(pack))) {
      credits = 5;
      amount = 199;
    }

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
        pack: String(pack || credits),
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
