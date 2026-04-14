require("dotenv").config();

const express = require("express");
const path = require("path");
const fs = require("fs");
const { Resend } = require("resend");

let resend = null;

if (!process.env.RESEND_API_KEY) {
  console.error("Missing RESEND_API_KEY");
} else {
  resend = new Resend(process.env.RESEND_API_KEY);
}

const CLIENTS_PATH = path.join(__dirname, "../clients.json");
const FEEDBACK_LOG_PATH = path.join(__dirname, "../feedback.json");

function loadClients() {
  try {
    return JSON.parse(fs.readFileSync(CLIENTS_PATH, "utf8"));
  } catch (err) {
    console.error("❌ Failed to load clients.json", err);
    return {};
  }
}

function saveClients(data) {
  fs.writeFileSync(CLIENTS_PATH, JSON.stringify(data, null, 2));
}

let CLIENTS = loadClients();

const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.get("/", (req, res) => res.send("OK"));

app.get("/r", (req, res) => {
  const rating = parseInt(req.query.rating, 10);
  const domain = req.query.domain;

  if (!rating || rating < 1 || rating > 5) {
    return res.status(400).send("Invalid rating");
  }

  if (!domain) {
    return res.status(400).send("Missing domain");
  }

  if (rating <= 3) {
    return res.redirect(`/review?rating=${rating}&domain=${domain}`);
  }

  return res.redirect(`https://www.trustpilot.com/review/${domain}`);
});

app.get("/review", (req, res) => {
  try {
    const query = req.query || {};
    const { rating, domain } = req.query;
    const r = Number(rating);

    if (!r || isNaN(r)) {
      return res.status(400).send("Invalid rating");
    }

    CLIENTS = loadClients();
    const client = CLIENTS[domain];

    if (r >= 4) {
      if (client && client.trustpilot) {
        return res.redirect(client.trustpilot);
      }

      return res.redirect("https://trustpilot.com");
    }

    const domainParam =
      query.domain == null
        ? ""
        : Array.isArray(query.domain)
          ? String(query.domain[0] || "")
          : String(query.domain);

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
  <input type="hidden" name="domain" value="${domainParam}" />
  <input type="hidden" name="email" id="email" />
  <input type="hidden" name="name" id="name" />
  <input type="hidden" name="order_id" id="order_id" />

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

  const email = params.get("email");
  const name = params.get("name");
  const orderId = params.get("order_id");

  if (email) document.getElementById("email").value = email;
  if (name) document.getElementById("name").value = name;
  if (orderId) document.getElementById("order_id").value = orderId;
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
      <input name="trustpilot" placeholder="trustpilot link" required />
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
    const { domain, email, trustpilot } = req.body;

    if (!domain || !email) {
      return res.send("Missing fields");
    }

    const clients = loadClients();

    clients[domain] = {
      email,
      trustpilot,
    };

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
    console.log("🔥 HIT /feedback");
    console.log("BODY:", req.body);
    const { rating, message, domain, email, name, order_id } = req.body;

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
        domain,
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

    CLIENTS = loadClients();

    const client = CLIENTS[domain];

    if (!client) {
      console.error("❌ Unknown domain:", domain);
    }

    const recipient = client?.email || process.env.CLIENT_EMAIL;

    try {
      console.log("📧 Sending email to:", recipient);

      if (resend) {
        const response = await resend.emails.send({
          from: "onboarding@resend.dev",
          to: recipient,
          subject: `New feedback (${rating} stars) from ${domain || "unknown domain"}`,
          html: `
  <h2>New Feedback</h2>
  <p><strong>Rating:</strong> ${rating}</p>
  <p><strong>Message:</strong> ${message}</p>
  <p><strong>Domain:</strong> ${domain}</p>
  <p><strong>Customer:</strong> ${name || "N/A"}</p>
  <p><strong>Email:</strong> ${email || "N/A"}</p>
  <p><strong>Order ID:</strong> ${order_id || "N/A"}</p>
`,
        });

        console.log("✅ Resend response:", response);
      }
    } catch (err) {
      console.error("❌ Email failed:", err);
    }

    return res.redirect("/tak");
  } catch (err) {
    console.error("FEEDBACK ERROR:", err);
    return res.status(500).send("Noget gik galt");
  }
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, "0.0.0.0", () => {
  console.log("SERVER RUNNING ON PORT:", PORT);
});
