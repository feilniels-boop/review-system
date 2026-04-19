require("dotenv").config();

const express = require("express");
const path = require("path");
const fs = require("fs");
const { Resend } = require("resend");

const CLIENTS_PATH = path.join(__dirname, "../clients.json");
const FEEDBACK_LOG_PATH = path.join(__dirname, "../feedback.json");

function loadClients() {
  try {
    const raw = fs.readFileSync(CLIENTS_PATH, "utf-8");
    return JSON.parse(raw);
  } catch (err) {
    console.error("❌ Failed to load clients.json", err);
    return {};
  }
}

function saveClients(data) {
  fs.writeFileSync(CLIENTS_PATH, JSON.stringify(data, null, 2));
}

function normalizeDomain(domain) {
  if (domain == null) return "";
  let d = Array.isArray(domain) ? domain[0] : domain;
  d = d.toString().toLowerCase().trim();
  if (!d) return "";
  return d
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .split("/")[0]
    .split("?")[0]
    .split("#")[0]
    .trim();
}

function buildTrustpilotUrl(client, stars) {
  if (!client) return null;
  const base = client.trustpilotInvite || client.trustpilot;
  if (!base) return null;
  const s = Number(stars);
  if (!s || isNaN(s) || s < 1 || s > 5) return base;
  const sep = base.includes("?") ? "&" : "?";
  return `${base}${sep}stars=${s}`;
}

let CLIENTS = loadClients();

const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.get("/", (req, res) => res.send("OK"));

app.get("/r", (req, res) => {
  const { rating, domain, email, name, order_id } = req.query;

  const cleanDomain = normalizeDomain(domain);
  const r = Number(rating);

  console.log("Incoming /r:", { rating, domain, cleanDomain });

  if (!r || isNaN(r) || r < 1 || r > 5) {
    return res.status(400).send("Invalid rating");
  }

  if (!cleanDomain) {
    return res.status(400).send("Missing domain");
  }

  CLIENTS = loadClients();
  const client = CLIENTS[cleanDomain];

  if (!client) {
    console.warn("Blocked /r for unauthorized domain:", cleanDomain);
    return res.redirect("/unknown-domain");
  }

  if (r <= 3) {
    return res.redirect(
      `/review?rating=${r}&domain=${cleanDomain}&email=${encodeURIComponent(email || "")}&name=${encodeURIComponent(name || "")}&order_id=${encodeURIComponent(order_id || "")}`
    );
  }

  const trustpilotUrl = buildTrustpilotUrl(client, r);
  if (trustpilotUrl) {
    return res.redirect(trustpilotUrl);
  }

  return res.redirect("/unknown-domain");
});

app.get("/review", (req, res) => {
  try {
    const { rating, domain } = req.query;
    const r = Number(rating);

    if (!r || isNaN(r) || r < 1 || r > 5) {
      return res.status(400).send("Invalid rating");
    }

    const cleanDomain = normalizeDomain(domain);

    if (!cleanDomain) {
      return res.status(400).send("Missing domain");
    }

    CLIENTS = loadClients();
    const client = CLIENTS[cleanDomain];

    if (!client) {
      console.warn("Blocked /review for unauthorized domain:", cleanDomain);
      return res.redirect("/unknown-domain");
    }

    if (r >= 4) {
      const trustpilotUrl = buildTrustpilotUrl(client, r);
      if (!trustpilotUrl) {
        return res.redirect("/unknown-domain");
      }
      return res.redirect(trustpilotUrl);
    }

    return res.send(`

<!DOCTYPE html>

<html lang="da">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>Feedback</title>

  <link href="https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600&display=swap" rel="stylesheet">
</head>

<body style="
  margin:0;
  font-family: 'Manrope', -apple-system, BlinkMacSystemFont, sans-serif;
  background:#f4f6f8;
  display:flex;
  align-items:center;
  justify-content:center;
  height:100vh;
">

  <div style="
    background:white;
    padding:40px;
    border-radius:16px;
    box-shadow:0 20px 60px rgba(0,0,0,0.08);
    max-width:440px;
    width:100%;
  ">

<h1 style="
  font-size:25px;
  font-weight:600;
  letter-spacing:-0.3px;
  margin-bottom:10px;
">
  Hjælp os med at forbedre din oplevelse
</h1>

<p style="
  color:#6b7280;
  font-size:14px;
  line-height:1.6;
  margin-bottom:24px;
">
  Det ser ud til, at din oplevelse ikke var helt som forventet.
  Fortæl os hvad der gik galt — vi læser alt feedback og bruger det aktivt til at forbedre os.
</p>

<!-- ⭐ STARS -->
<div style="margin-bottom:10px; font-size:26px; letter-spacing:3px;">
  ${
    '<span style="color:#f5b301;">★</span>'.repeat(Math.max(0, Math.min(5, r))) +
    '<span style="color:#e0e0e0;">★</span>'.repeat(5 - Math.max(0, Math.min(5, r)))
  }
</div>

<p style="
  color:#555;
  font-size:13px;
  margin-bottom:20px;
">
  Du har valgt <strong>${r}</strong> ud af 5 stjerner
</p>

<form method="POST" action="/feedback">

  <input type="hidden" name="rating" value="${r}" />
  <input type="hidden" name="domain" value="${cleanDomain}" />
  <input type="hidden" name="email" />

  <input
    type="text"
    name="name"
    required
    placeholder="Dit navn"
    autocomplete="name"
    style="
      width:100%;
      box-sizing:border-box;
      padding:12px 14px;
      margin-bottom:12px;
      border-radius:12px;
      border:1px solid #ddd;
      font-size:14px;
      outline:none;
    "
  />

  <input
    type="text"
    name="order_id"
    placeholder="Ordrenummer (valgfrit)"
    autocomplete="off"
    style="
      width:100%;
      box-sizing:border-box;
      padding:12px 14px;
      margin-bottom:12px;
      border-radius:12px;
      border:1px solid #ddd;
      font-size:14px;
      outline:none;
    "
  />

  <textarea 
    name="message"
    placeholder="Hvad gik galt, og hvad kunne vi gøre bedre?"
    required
    style="
      width:100%;
      height:120px;
      padding:14px;
      border-radius:12px;
      border:1px solid #ddd;
      font-size:14px;
      line-height:1.5;
      resize:none;
      outline:none;
      transition:0.2s;
    "
    onfocus="this.style.borderColor='#111'; this.style.boxShadow='0 0 0 2px rgba(0,0,0,0.05)'"
    onblur="this.style.borderColor='#ddd'; this.style.boxShadow='none'"
  ></textarea>

  <button type="submit"
    style="
      margin-top:20px;
      width:100%;
      padding:14px;
      border:none;
      border-radius:12px;
      background:#0f172a;
      color:white;
      font-size:15px;
      font-weight:500;
      cursor:pointer;
      transition:0.2s;
    "
    onmouseover="this.style.opacity='0.9'"
    onmouseout="this.style.opacity='1'"
  >
    Send din feedback
  </button>

</form>

<p style="
  margin-top:18px;
  font-size:12px;
  color:#999;
  text-align:center;
">
  Fortroligt — vi bruger kun din feedback til at forbedre oplevelsen
</p>

  </div>

<script>
  const params = new URLSearchParams(window.location.search);

  document.querySelector('input[name="email"]').value = params.get("email") || "";
  document.querySelector('input[name="name"]').value = params.get("name") || "";
  document.querySelector('input[name="order_id"]').value = params.get("order_id") || "";
</script>

</body>
</html>
`);
  } catch (err) {
    console.error("REVIEW ERROR:", err);
    return res.status(500).send("Error");
  }
});

const thankYouPageHtml = `
  <!DOCTYPE html>
  <html lang="da">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
    <title>Tak</title>
  </head>
  <body style="
    margin:0;
    font-family:sans-serif;
    display:flex;
    align-items:center;
    justify-content:center;
    height:100vh;
    background:#f4f6f8;
  ">
    <div style="
      background:white;
      padding:40px;
      border-radius:16px;
      box-shadow:0 20px 60px rgba(0,0,0,0.08);
      text-align:center;
    ">
      <h1>Tak for din feedback 🙏</h1>
      <p>Vi sætter stor pris på din tid.</p>
    </div>
  </body>
  </html>
`;

app.get("/tak", (req, res) => {
  return res.send(thankYouPageHtml);
});

const unknownDomainPageHtml = `
<!DOCTYPE html>
<html lang="da">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>Tjenesten er ikke tilgængelig</title>
  <link href="https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700&display=swap" rel="stylesheet">
</head>
<body style="
  margin:0;
  font-family:'Manrope',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;
  display:flex;
  align-items:center;
  justify-content:center;
  min-height:100vh;
  background:#f4f6f8;
  padding:24px;
">
  <div style="
    background:white;
    padding:40px;
    border-radius:16px;
    box-shadow:0 20px 60px rgba(0,0,0,0.08);
    max-width:460px;
    width:100%;
    text-align:center;
    box-sizing:border-box;
  ">
    <div style="
      width:56px;
      height:56px;
      border-radius:50%;
      background:#fff4e5;
      display:inline-flex;
      align-items:center;
      justify-content:center;
      margin-bottom:20px;
      font-size:28px;
    ">🔒</div>

    <h1 style="
      margin:0 0 10px 0;
      font-size:22px;
      font-weight:600;
      letter-spacing:-0.3px;
      color:#111827;
    ">
      Tjenesten er ikke aktiv
    </h1>

    <p style="
      margin:0 0 24px 0;
      font-size:14px;
      line-height:1.6;
      color:#6b7280;
    ">
      Denne anmeldelses-service er ikke aktiveret for den angivne butik,
      eller abonnementet er udløbet.<br/>
      Kontakt butikken direkte, hvis du vil dele din oplevelse.
    </p>

    <p style="
      margin:0;
      font-size:12px;
      color:#9ca3af;
    ">
      Er du butiksejer? Kontakt os for at aktivere tjenesten.
    </p>
  </div>
</body>
</html>
`;

app.get("/unknown-domain", (req, res) => {
  return res.status(403).send(unknownDomainPageHtml);
});

app.get("/admin", (req, res) => {
  const key = req.query.key;
  if (key !== process.env.ADMIN_KEY) {
    return res.status(401).send("Unauthorized");
  }
  res.send(`
    <h2>Add Client</h2>
    <form method="POST" action="/admin?key=${encodeURIComponent(key)}">
      <input name="domain" placeholder="domain (e.g. test.dk)" required />
      <input name="email" placeholder="email" required />
      <input name="trustpilot" placeholder="trustpilot review page (fallback)" />
      <input name="trustpilotInvite" placeholder="trustpilot evaluate-link (with hmac)" />
      <button type="submit">Save</button>
    </form>
  `);
});

app.post(
  "/admin",
  express.urlencoded({ extended: true }),
  (req, res) => {
    const key = req.query.key;
    if (key !== process.env.ADMIN_KEY) {
      return res.status(401).send("Unauthorized");
    }
    const { domain, email, trustpilot, trustpilotInvite } = req.body;

    if (!domain || !email) {
      return res.send("Missing fields");
    }

    const clients = loadClients();
    const cleanDomain = normalizeDomain(domain);

    const entry = { email };
    if (trustpilot) entry.trustpilot = trustpilot;
    if (trustpilotInvite) entry.trustpilotInvite = trustpilotInvite;
    clients[cleanDomain] = entry;

    saveClients(clients);

    res.send("✅ Client saved");
  }
);

app.get("/feedbacks", (req, res) => {
  const key = req.query.key;
  if (key !== process.env.ADMIN_KEY) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  try {
    const raw = fs.readFileSync(FEEDBACK_LOG_PATH, "utf8");
    const parsed = JSON.parse(raw);
    let data = Array.isArray(parsed) ? parsed : [];
    const domainFilter = req.query.domain;
    if (domainFilter) {
      data = data.filter((entry) => entry.domain === domainFilter);
    }
    return res.json(data);
  } catch (err) {
    return res.json([]);
  }
});

app.post("/feedback", async (req, res) => {
  try {
    const { rating, message, domain, email, name, order_id } = req.body;

    const cleanDomain = normalizeDomain(domain);

    CLIENTS = loadClients();

    console.log("RAW domain:", domain);
    console.log("CLEAN domain:", cleanDomain);
    console.log("AVAILABLE clients:", Object.keys(CLIENTS));

    const client = CLIENTS[cleanDomain];

    console.log("Feedback received:", {
      rating,
      message,
      domain,
      cleanDomain,
      email,
      name,
      order_id,
    });

    if (!client) {
      console.error("Unknown domain:", cleanDomain);
      return res.status(400).send(`Unknown domain: ${cleanDomain}`);
    }

    const recipientEmail = client.email;

    try {
      let entries = [];
      try {
        const raw = fs.readFileSync(FEEDBACK_LOG_PATH, "utf8");
        const parsed = JSON.parse(raw);
        entries = Array.isArray(parsed) ? parsed : [];
      } catch {
        entries = [];
      }
      entries.push({
        rating,
        message,
        domain: cleanDomain,
        email,
        name,
        orderId: order_id,
        createdAt: new Date().toISOString(),
      });
      fs.writeFileSync(FEEDBACK_LOG_PATH, JSON.stringify(entries, null, 2));
    } catch (err) {
      console.error("Failed to save feedback");
    }

    const timestamp = new Date().toISOString();

    const log = `
--- FEEDBACK ---
Time: ${timestamp}
Rating: ${rating}
Message: ${message}
-------------------

`;

    fs.appendFileSync("feedback.txt", log);

    const html = `
        <h2>New Feedback</h2>
        <p><strong>Rating:</strong> ${rating}</p>
        <p><strong>Message:</strong> ${message}</p>
        <p><strong>Name:</strong> ${name}</p>
        <p><strong>Email:</strong> ${email}</p>
        <p><strong>Order ID:</strong> ${order_id}</p>
        <p><strong>Domain:</strong> ${cleanDomain}</p>
      `;

    if (!process.env.RESEND_API_KEY) {
      console.error("❌ Missing RESEND_API_KEY");
    }

    const resend = new Resend(process.env.RESEND_API_KEY);

    try {
      console.log("📨 Sending email to:", recipientEmail);

      const result = await resend.emails.send({
        from: "Feedback <onboarding@resend.dev>",
        to: recipientEmail,
        subject: "New Feedback",
        html: html,
      });

      console.log("✅ Email sent:", result);
    } catch (error) {
      console.error("❌ Email failed:", error);
    }

    return res.redirect("/tak");
  } catch (err) {
    console.error("Feedback error:", err);
    return res.status(500).send("Server error");
  }
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, "0.0.0.0", () => {
  console.log("SERVER RUNNING ON PORT:", PORT);
});
