const WEBSITE_URL = "https://sparklestarcleaning.co.uk";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/admin") {
      return new Response(adminPage(), {
        headers: { "Content-Type": "text/html; charset=UTF-8" }
      });
    }


    if (request.method === "POST" && url.pathname === "/create-booking") {
      try {
        const body = await request.json();
        const customerName = String(body.customerName || "").trim();
        const phone = String(body.phone || "").trim();
        const email = String(body.email || "").trim();
        const address = String(body.address || "").trim();
        const service = String(body.service || "");
        const bedrooms = String(body.bedrooms || "");
        const bathrooms = Number(body.bathrooms || 1);
        const date = String(body.date || "");
        const startTime = String(body.startTime || "");
        const hours = Number(body.hours);
        const amount = Number(body.amount);
        const rates = { regular: 20, oneoff: 23, deep: 25 };
        const BOOKINGS_OPEN_DATE = "2026-10-08";

        if (!customerName || !phone || !email || !address || !date || !startTime) return json({ error: "Please complete all booking details." }, 400);
        if (date < BOOKINGS_OPEN_DATE) return json({ error: "Online bookings open from 8 October 2026." }, 400);
        if (!rates[service]) return json({ error: "End of Tenancy bookings require a quote." }, 400);
        if (!Number.isInteger(bathrooms) || bathrooms < 1 || bathrooms > 10) return json({ error: "Please choose a valid number of bathrooms." }, 400);
        if (!Number.isFinite(hours) || hours < 3 || hours > 12) return json({ error: "Invalid cleaning duration." }, 400);
        if (!Number.isFinite(amount) || amount !== Math.round(hours * rates[service] * 100) / 100) return json({ error: "The booking price could not be verified." }, 400);

        const chosen = new Date(date + "T" + startTime + ":00");
        if (Number.isNaN(chosen.getTime())) return json({ error: "Invalid booking date or time." }, 400);
        const day = chosen.getDay();
        const minutes = chosen.getHours() * 60 + chosen.getMinutes();
        const endMinutes = minutes + hours * 60;
        const open = day === 6 ? 600 : 480;
        const close = day === 6 ? 960 : 1020;
        if (day === 0 || minutes < open || endMinutes > close) return json({ error: "That time is outside our booking hours." }, 400);

        const serviceName = service === "regular" ? "Regular Cleaning" : service === "oneoff" ? "One-Off Cleaning" : "Deep Cleaning";
        const estimate = "£" + Math.round(amount).toLocaleString("en-GB");
        const businessEmail = "hello@sparklestarcleaning.co.uk";
        const subject = "Sparkle Star Cleaning booking — " + date + " " + startTime;
        const customerText = `Hello ${customerName},

Thank you for booking with Sparkle Star Cleaning.

Booking details:
Customer phone: ${phone}
Service: ${serviceName}
Date: ${date}
Start time: ${startTime}
Estimated duration: ${hours} hours
Property: ${bedrooms}
Bathrooms: ${bathrooms}
Address: ${address}
Estimated price: ${estimate}

No payment is required at the time of booking. After your cleaning is completed, we will send you a secure payment link for the final amount.

Thank you,
Sparkle Star Cleaning
`;

        let emailSent = false;
        if (env.RESEND_API_KEY) {
          const emailResponse = await fetch("https://api.resend.com/emails", {
            method: "POST",
            headers: { "Authorization": "Bearer " + env.RESEND_API_KEY, "Content-Type": "application/json" },
            body: JSON.stringify({
              from: "Sparkle Star Cleaning <hello@sparklestarcleaning.co.uk>",
              to: [email],
              cc: [businessEmail],
              subject,
              text: customerText
            })
          });
          emailSent = emailResponse.ok;
        }

        return json({
          success: true,
          message: emailSent
            ? "Booking received. No payment is required now. We have emailed your booking details and estimated price."
            : "Booking received. No payment is required now. We will confirm your booking and email your booking details and estimated price."
        });
      } catch {
        return json({ error: "Something went wrong submitting the booking." }, 500);
      }
    }

    if (request.method === "POST" && url.pathname === "/create-payment") {
      try {
        const body = await request.json();
        const password = String(body.password || "");
        const customerName = String(body.customerName || "").trim();
        const amount = Number(body.amount);

        if (!env.ADMIN_PASSWORD) return json({ error: "Admin password is not configured yet." }, 500);
        if (password !== env.ADMIN_PASSWORD) return json({ error: "Incorrect admin password." }, 401);
        if (!customerName) return json({ error: "Please enter the customer's name." }, 400);
        if (!Number.isFinite(amount) || amount <= 0 || amount > 10000) return json({ error: "Please enter a valid amount in pounds." }, 400);
        if (!env.STRIPE_SECRET_KEY) return json({ error: "Stripe key is not configured yet." }, 500);

        const stripeBody = new URLSearchParams();
        stripeBody.append("line_items[0][price_data][currency]", "gbp");
        stripeBody.append("line_items[0][price_data][product_data][name]", "Sparkle Star Cleaning");
        stripeBody.append("line_items[0][price_data][product_data][description]", `Cleaning service for ${customerName}`);
        stripeBody.append("line_items[0][price_data][unit_amount]", String(Math.round(amount * 100)));
        stripeBody.append("line_items[0][quantity]", "1");
        stripeBody.append("mode", "payment");
        stripeBody.append("success_url", `${new URL(request.url).origin}/paid?session_id={CHECKOUT_SESSION_ID}`);
        stripeBody.append("cancel_url", `${WEBSITE_URL}/?payment=cancelled`);
        stripeBody.append("metadata[customer_name]", customerName);

        const stripeResponse = await stripeRequest(env, "/checkout/sessions", "POST", stripeBody);
        const stripeData = await stripeResponse.json();
        if (!stripeResponse.ok) return json({ error: stripeData.error?.message || "Stripe could not create the payment." }, 400);

        return json({ success: true, payment_url: stripeData.url, session_id: stripeData.id });
      } catch {
        return json({ error: "Something went wrong creating the payment." }, 500);
      }
    }

    if (request.method === "GET" && url.pathname === "/paid") {
      const sessionId = url.searchParams.get("session_id");
      if (!sessionId || !env.STRIPE_SECRET_KEY) return paymentNotConfirmed();

      const response = await stripeRequest(env, `/checkout/sessions/${encodeURIComponent(sessionId)}`, "GET");
      if (!response.ok) return paymentNotConfirmed();

      const session = await response.json();
      if (session.payment_status !== "paid") return paymentNotConfirmed();

      const name = escapeHtml(session.metadata?.customer_name || "there");
      const amount = ((session.amount_total || 0) / 100).toFixed(2);
      const ratingUrl = `${new URL(request.url).origin}/rate?session_id=${encodeURIComponent(session.id)}`;

      return new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Thank you — Sparkle Star Cleaning</title><style>body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#f7f8fc;margin:0;padding:24px;color:#17231d}.card{max-width:520px;margin:30px auto;background:#fff;padding:30px;border-radius:22px;box-shadow:0 10px 35px rgba(0,0,0,.08)}h1{font-size:30px}.ok{width:58px;height:58px;border-radius:50%;background:#dff2e9;color:#28785a;display:grid;place-items:center;font-size:30px;font-weight:800}.button{display:inline-block;margin-top:18px;background:#28785a;color:#fff;text-decoration:none;border-radius:12px;padding:14px 20px;font-weight:700}</style></head><body><div class="card"><div class="ok">✓</div><h1>Thank you, ${name}!</h1><p>Your payment of <strong>£${amount}</strong> has been confirmed.</p><p>We'd love to know how your cleaning service went.</p><a class="button" href="${ratingUrl}">Rate Sparkle Star Cleaning</a></div></body></html>`, { headers: { "Content-Type": "text/html; charset=UTF-8", "Cache-Control": "no-store" } });
    }

    if (request.method === "GET" && url.pathname === "/rate") {
      const sessionId = url.searchParams.get("session_id");
      return ratingPage(sessionId, env);
    }

    if (request.method === "POST" && url.pathname === "/rate") {
      return saveRating(request, env);
    }

    return new Response("Sparkle Star Cleaning payment system is online.", { headers: { "Content-Type": "text/plain; charset=UTF-8" } });
  }
};

async function stripeRequest(env, path, method, body) {
  const headers = { "Authorization": `Basic ${btoa(env.STRIPE_SECRET_KEY + ":")}` };
  const options = { method, headers };
  if (body) { options.body = body; headers["Content-Type"] = "application/x-www-form-urlencoded"; }
  return fetch(`https://api.stripe.com/v1${path}`, options);
}

function paymentNotConfirmed() {
  return new Response(`<!doctype html><html><body style="font-family:-apple-system,sans-serif;padding:30px"><h1>Payment not confirmed</h1><p>We couldn't confirm the payment yet. Please contact Sparkle Star Cleaning if you believe you have paid.</p><a href="${WEBSITE_URL}">Back to website</a></body></html>`, { status: 400, headers: { "Content-Type": "text/html; charset=UTF-8", "Cache-Control": "no-store" } });
}

async function ratingPage(sessionId, env) {
  if (!sessionId) return paymentNotConfirmed();
  const response = await stripeRequest(env, `/checkout/sessions/${encodeURIComponent(sessionId)}`, "GET");
  if (!response.ok) return paymentNotConfirmed();
  const session = await response.json();
  if (session.payment_status !== "paid") return paymentNotConfirmed();
  if (session.metadata?.rating) return new Response("Thank you — your rating has already been received.", { headers: { "Content-Type": "text/plain; charset=UTF-8" } });

  return new Response(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Rate Sparkle Star Cleaning</title><style>body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#f7f8fc;padding:24px}.card{max-width:520px;margin:30px auto;background:white;padding:28px;border-radius:20px;box-shadow:0 10px 35px rgba(0,0,0,.08)}h1{font-size:28px}.stars{display:flex;gap:5px;margin:18px 0}.stars button{border:0;background:none;font-size:42px;color:#bbb}.stars button.on{color:#f5b400}textarea{width:100%;box-sizing:border-box;min-height:110px;border:1px solid #ccc;border-radius:10px;padding:12px;font-size:16px}button.submit{width:100%;margin-top:18px;padding:14px;border:0;border-radius:10px;background:#28785a;color:#fff;font-size:17px;font-weight:700}</style></head><body><div class="card"><h1>How did we do?</h1><p>Thank you for choosing Sparkle Star Cleaning. Your payment has been confirmed.</p><div class="stars"><button type="button" data-r="1">★</button><button type="button" data-r="2">★</button><button type="button" data-r="3">★</button><button type="button" data-r="4">★</button><button type="button" data-r="5">★</button></div><textarea id="comment" placeholder="Optional comment"></textarea><button class="submit" onclick="sendRating()">Send my rating</button><p id="msg"></p></div><script>let selected=0;document.querySelectorAll('[data-r]').forEach(b=>b.onclick=()=>{selected=Number(b.dataset.r);document.querySelectorAll('[data-r]').forEach(x=>x.classList.toggle('on',Number(x.dataset.r)<=selected));});async function sendRating(){const msg=document.getElementById('msg');if(!selected){msg.textContent='Please choose a star rating.';return}msg.textContent='Sending...';const r=await fetch('/rate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({session_id:${JSON.stringify(sessionId)},rating:selected,comment:document.getElementById('comment').value})});const d=await r.json();msg.textContent=d.success?'Thank you for your feedback!':(d.error||'Unable to save your rating.');}</script></body></html>`, { headers: { "Content-Type": "text/html; charset=UTF-8", "Cache-Control": "no-store" } });
}

async function saveRating(request, env) {
  try {
    const body = await request.json();
    const sessionId = String(body.session_id || "");
    const rating = Number(body.rating);
    const comment = String(body.comment || "").trim().slice(0, 1000);
    if (!sessionId || !Number.isInteger(rating) || rating < 1 || rating > 5) return json({ error: "Please provide a valid rating." }, 400);

    const response = await stripeRequest(env, `/checkout/sessions/${encodeURIComponent(sessionId)}`, "GET");
    if (!response.ok) return json({ error: "Payment could not be verified." }, 400);
    const session = await response.json();
    if (session.payment_status !== "paid") return json({ error: "Payment could not be verified." }, 400);
    if (session.metadata?.rating) return json({ error: "This payment has already been rated." }, 409);

    const update = new URLSearchParams();
    update.append("metadata[rating]", String(rating));
    update.append("metadata[rating_comment]", comment || "(No comment)");
    update.append("metadata[rated_at]", new Date().toISOString());
    const save = await stripeRequest(env, `/checkout/sessions/${encodeURIComponent(sessionId)}`, "POST", update);
    if (!save.ok) return json({ error: "We couldn't save the rating. Please try again." }, 500);
    return json({ success: true });
  } catch { return json({ error: "Unable to save the rating." }, 500); }
}

function json(data, status = 200) { return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json; charset=UTF-8", "Cache-Control": "no-store" } }); }
function escapeHtml(value) { return String(value).replace(/[&<>\"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;"}[c])); }

function adminPage() {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Sparkle Star Cleaning — Payment</title><style>body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#f7f8fc;margin:0;padding:24px;color:#222}.card{max-width:430px;margin:30px auto;background:white;padding:24px;border-radius:18px;box-shadow:0 8px 30px rgba(0,0,0,.08)}h1{font-size:24px}label{display:block;margin-top:16px;font-weight:600}input{width:100%;box-sizing:border-box;padding:13px;margin-top:7px;border:1px solid #ccc;border-radius:10px;font-size:16px}button{width:100%;margin-top:22px;padding:14px;border:0;border-radius:10px;background:#111;color:white;font-size:17px;font-weight:600}#result{margin-top:20px;word-break:break-word}a{color:#1769ff}.note{color:#666;font-size:14px}</style></head><body><div class="card"><h1>✨ Sparkle Star Cleaning</h1><p class="note">Create a secure payment link after a cleaning is completed.</p><label>Admin password</label><input id="password" type="password"><label>Customer name</label><input id="customerName" type="text"><label>Final amount (£)</label><input id="amount" type="number" min="1" step="0.01"><button onclick="createPayment()">Create Payment Link</button><div id="result"></div></div><script>async function createPayment(){const result=document.getElementById('result');result.textContent='Creating secure payment link...';try{const r=await fetch('/create-payment',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:document.getElementById('password').value,customerName:document.getElementById('customerName').value,amount:document.getElementById('amount').value})});const d=await r.json();if(!r.ok){result.textContent=d.error;return}result.innerHTML='<strong>Payment link created!</strong><br><br><a href="'+d.payment_url+'" target="_blank">Open payment page</a><br><br><button id="copy">Copy Payment Link</button>';document.getElementById('copy').onclick=async()=>{await navigator.clipboard.writeText(d.payment_url);document.getElementById('copy').textContent='Copied!'}}catch{result.textContent='Unable to contact the payment system.'}}</script></body></html>`;
}
