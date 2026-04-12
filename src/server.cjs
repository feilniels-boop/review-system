const express = require("express");
const path = require("path");
const fs = require("fs");

require("dotenv").config();

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
    const rating = Number(query.rating);

    if (!rating || isNaN(rating)) {
      return res.status(400).send("Invalid rating");
    }

    if (rating >= 4) {
      return res.redirect("https://www.trustpilot.com/review/jysk.dk");
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
    '<span style="color:#f5b301;">★</span>'.repeat(Math.max(0, Math.min(5, rating))) +
    '<span style="color:#e0e0e0;">★</span>'.repeat(5 - Math.max(0, Math.min(5, rating)))
  }
</div>

<p style="
  color:#555;
  font-size:13px;
  margin-bottom:20px;
">
  Du har valgt <strong>${rating}</strong> ud af 5 stjerner
</p>

<form method="POST" action="/feedback">

  <input type="hidden" name="rating" value="${rating}" />

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

</body>
</html>
`);
  } catch (err) {
    console.error("REVIEW ERROR:", err);
    return res.status(500).send("Error");
  }
});

app.post("/feedback", (req, res) => {
  try {
    const { rating, message } = req.body;

    const timestamp = new Date().toISOString();

    const log = `
--- FEEDBACK ---
Time: ${timestamp}
Rating: ${rating}
Message: ${message}
-------------------

`;

    fs.appendFileSync("feedback.txt", log);

    return res.send(`
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
`);
  } catch (err) {
    console.error("FEEDBACK ERROR:", err);
    return res.status(500).send("Noget gik galt");
  }
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, "0.0.0.0", () => {
  console.log("SERVER RUNNING ON PORT:", PORT);
});
