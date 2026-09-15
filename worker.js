const WEBSITE_URL = "https://sparklestarcleaning.co.uk";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/admin") {
      return new Response(adminPage(), {
        headers: { "Content-Type": "text/html; charset=UTF-8" }
      });
    }

    if (request.method === "POST" && url.pathname === "/create-payment") {
      try {
        const body = await request.json();
        const password = String(body.password || "");
        const customerName = String(body.customerName || "").trim();
        const amount = Number(body.amount);

        if (!env.ADMIN_PASSWORD) {
          return json({ error: "Admin password is not configured yet." }, 500);
        }
        if (password !== env.ADMIN_PASSWORD) {
          return json({ error: "Incorrect admin password." }, 401);
        }
        if (!customerName) {
          return json({ error: "Please enter the customer's name." }, 400);
        }
        if (!Number.isFinite(amount) || amount <= 0 || amount > 10000) {
          return json({ error: "Please enter a valid amount in pounds." }, 400);
        }
        if (!env.STRIPE_SECRET_KEY) {
          return json({ error: "Stripe key is not configured yet." }, 500);
        }

        const stripeBody = new URLSearchParams();
        stripeBody.append("line_items[0][price_data][currency]", "gbp");
        stripeBody.append("line_items[0][price_data][product_data][name]", "Sparkle Star Cleaning");
        stripeBody.append("line_items[0][price_data][product_data][description]", `Cleaning service for ${customerName}`);
        stripeBody.append("line_items[0][price_data][unit_amount]", String(Math.round(amount * 100)));
        stripeBody.append("line_items[0][quantity]", "1");
        stripeBody.append("mode", "payment");
        stripeBody.append("success_url", `${WEBSITE_URL}/?payment=success&session_id={CHECKOUT_SESSION_ID}`);
        stripeBody.append("cancel_url", `${WEBSITE_URL}/?payment=cancelled`);
        stripeBody.append("metadata[customer_name]", customerName);

        const stripeResponse = await fetch("https://api.stripe.com/v1/checkout/sessions", {
          method: "POST",
          headers: {
            "Authorization": `Basic ${btoa(env.STRIPE_SECRET_KEY + ":")}`,
            "Content-Type": "application/x-www-form-urlencoded"
          },
          body: stripeBody
        });

        const stripeData = await stripeResponse.json();
        if (!stripeResponse.ok) {
          return json({ error: stripeData.error?.message || "Stripe could not create the payment." }, 400);
        }

        return json({ success: true, payment_url: stripeData.url, session_id: stripeData.id });
      } catch {
        return json({ error: "Something went wrong creating the payment." }, 500);
      }
    }

    return new Response("Sparkle Star Cleaning payment system is online.", {
      headers: { "Content-Type": "text/plain; charset=UTF-8" }
    });
  }
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=UTF-8",
      "Cache-Control": "no-store"
    }
  });
}

function adminPage() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Sparkle Star Cleaning — Payment</title>
<style>
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#f7f8fc;margin:0;padding:24px;color:#222}
.card{max-width:430px;margin:30px auto;background:white;padding:24px;border-radius:18px;box-shadow:0 8px 30px rgba(0,0,0,.08)}
h1{margin-top:0;font-size:24px}label{display:block;margin-top:16px;font-weight:600}
input{width:100%;box-sizing:border-box;padding:13px;margin-top:7px;border:1px solid #ccc;border-radius:10px;font-size:16px}
button{width:100%;margin-top:22px;padding:14px;border:0;border-radius:10px;background:#111;color:white;font-size:17px;font-weight:600}
#result{margin-top:20px;word-break:break-word}a{color:#1769ff}.note{color:#666;font-size:14px}
</style>
</head>
<body><div class="card">
<h1>✨ Sparkle Star Cleaning</h1>
<p class="note">Create a secure payment link after a cleaning is completed.</p>
<label>Admin password</label><input id="password" type="password" autocomplete="current-password">
<label>Customer name</label><input id="customerName" type="text" placeholder="Customer name">
<label>Final amount (£)</label><input id="amount" type="number" min="1" step="0.01" placeholder="Example: 96">
<button onclick="createPayment()">Create Payment Link</button><div id="result"></div>
</div>
<script>
async function createPayment(){
 const result=document.getElementById("result"); result.textContent="Creating secure payment link...";
 try{
  const response=await fetch("/create-payment",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({password:document.getElementById("password").value,customerName:document.getElementById("customerName").value,amount:document.getElementById("amount").value})});
  const data=await response.json();
  if(!response.ok){result.textContent=data.error||"Unable to create payment.";return;}
  result.innerHTML="<strong>Payment link created!</strong><br><br><a href='"+data.payment_url+"' target='_blank'>Open payment page</a><br><br><button id='copyBtn'>Copy Payment Link</button>";
  document.getElementById("copyBtn").onclick=async()=>{await navigator.clipboard.writeText(data.payment_url);document.getElementById("copyBtn").textContent="Copied!";};
 }catch{result.textContent="Unable to contact the payment system.";}
}
</script></body></html>`;
}
