import dotenv from "dotenv";
dotenv.config();

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REVIEW_INVITE_EMAIL_PATH = path.join(
  __dirname,
  "..",
  "templates",
  "review-invite-email.html",
);
import OpenAI from "openai";
import { createClient } from "@supabase/supabase-js";
/**
 * @typedef {{
 *   sentiment: "positive" | "negative";
 *   confidence: number;
 *   topic: "delivery" | "product" | "service" | "other";
 *   urgency: "low" | "medium" | "high";
 *   summary: string;
 * }} Classification
 */

/**
 * @typedef {{
 *   id: string;
 *   createdAt: string;
 *   review: string;
 *   sentiment: Classification["sentiment"];
 *   topic: Classification["topic"];
 *   urgency: Classification["urgency"];
 *   summary: string;
 * }} ReviewRecord
 */

const app = express();
app.use(express.json({ limit: "64kb" }));
app.use(express.urlencoded({ extended: true, limit: "64kb" }));

const TRUSTPILOT_REVIEW_URL =
  String(process.env.TRUSTPILOT_REVIEW_URL ?? "").trim() ||
  "https://www.trustpilot.com/evaluate/example.com";

/**
 * @param {{ rating: number; message: string; order_id: string }} payload
 */
async function sendFeedbackEmail(payload) {
  const to = String(process.env.FEEDBACK_EMAIL_TO ?? "").trim();
  const from = String(process.env.FEEDBACK_EMAIL_FROM ?? "").trim();
  const resendKey = String(process.env.RESEND_API_KEY ?? "").trim();

  const subject = `Customer feedback — order ${payload.order_id} — ${payload.rating}★`;
  const text = `Order ID: ${payload.order_id}
Rating: ${payload.rating} / 5

Message:
${payload.message}`;

  if (resendKey && to && from) {
    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${resendKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from,
          to: [to],
          subject,
          text,
        }),
      });
      if (!res.ok) {
        const errBody = await res.text();
        console.error("Resend email failed:", res.status, errBody.slice(0, 500));
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("Resend request error:", message);
    }
    return;
  }

  console.log("[feedback email — configure RESEND_API_KEY + FEEDBACK_EMAIL_FROM + FEEDBACK_EMAIL_TO to send via Resend]");
  console.log({ ...payload, at: new Date().toISOString() });
}

/**
 * @param {unknown} v
 * @returns {number | null}
 */
function parseStarRating(v) {
  if (typeof v === "number" && Number.isInteger(v)) {
    return v >= 1 && v <= 5 ? v : null;
  }
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number.parseInt(v, 10);
    if (!Number.isNaN(n) && Number.isInteger(n) && n >= 1 && n <= 5) {
      return n;
    }
  }
  return null;
}

/**
 * @param {string} s
 */
function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const MODEL = process.env.OPENAI_MODEL ?? "gpt-4o-mini";

/** @type {import("@supabase/supabase-js").SupabaseClient | null} */
let supabase = null;

/**
 * Supabase is optional: only when both env vars are non-empty (trimmed).
 * @returns {boolean}
 */
function isSupabaseConfigured() {
  return Boolean(
    String(process.env.SUPABASE_URL ?? "").trim() &&
      String(process.env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim(),
  );
}

function getSupabase() {
  if (!isSupabaseConfigured()) {
    return null;
  }
  if (supabase) {
    return supabase;
  }
  const url = String(process.env.SUPABASE_URL ?? "").trim();
  const key = String(process.env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim();
  if (!url || !key) {
    return null;
  }
  supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return supabase;
}

/**
 * @param {Record<string, unknown>} row
 * @returns {ReviewRecord}
 */
function mapRow(row) {
  return {
    id: String(row.id),
    createdAt: /** @type {string} */ (row.created_at),
    review: /** @type {string} */ (row.review),
    sentiment: /** @type {ReviewRecord["sentiment"]} */ (row.sentiment),
    topic: /** @type {ReviewRecord["topic"]} */ (row.topic),
    urgency: /** @type {ReviewRecord["urgency"]} */ (row.urgency),
    summary: /** @type {string} */ (row.summary),
  };
}

/**
 * @param {string} review
 * @param {Classification} aiResult
 */
function rowPayload(review, aiResult) {
  return {
    review,
    sentiment: aiResult.sentiment,
    topic: aiResult.topic,
    urgency: aiResult.urgency,
    summary: aiResult.summary,
  };
}

/**
 * @param {string} review
 * @param {Classification} aiResult
 */
async function saveToPublic(review, aiResult) {
  const client = getSupabase();
  if (!client) {
    return;
  }
  const payload = rowPayload(review, aiResult);
  const { error: errPublic } = await client.from("public_reviews").insert(payload);
  if (errPublic) {
    console.error("public_reviews insert:", errPublic);
    return;
  }
  const { error: errAll } = await client.from("all_reviews").insert(payload);
  if (errAll) {
    console.error("all_reviews insert (from saveToPublic):", errAll);
  }
}

/**
 * @param {string} review
 * @param {Classification} aiResult
 */
async function saveToAll(review, aiResult) {
  const client = getSupabase();
  if (!client) {
    return;
  }
  const { error } = await client.from("all_reviews").insert(rowPayload(review, aiResult));
  if (error) {
    console.error("all_reviews insert:", error);
  }
}

/**
 * @param {string} reviewText
 * @returns {Promise<Classification>}
 */
async function classifyReview(reviewText) {
  const userPrompt = `Classify the following customer review.

Return ONLY valid JSON:

{
  "sentiment": "positive" or "negative",
  "confidence": number between 0 and 1,
  "topic": "delivery" | "product" | "service" | "other",
  "urgency": "low" | "medium" | "high",
  "summary": "short summary"
}

Review:
${reviewText}`;

  const completion = await openai.chat.completions.create({
    model: MODEL,
    messages: [
      {
        role: "system",
        content:
          "You are a precise classifier. Reply with a single JSON object only, no markdown or extra text.",
      },
      { role: "user", content: userPrompt },
    ],
    response_format: { type: "json_object" },
    temperature: 0,
  });

  const raw = completion.choices[0]?.message?.content;
  if (!raw) {
    throw new Error("EMPTY_MODEL_RESPONSE");
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("INVALID_JSON");
  }

  return validateClassification(parsed);
}

/**
 * @param {unknown} obj
 * @returns {Classification}
 */
function validateClassification(obj) {
  if (!obj || typeof obj !== "object") {
    throw new Error("INVALID_SHAPE");
  }
  const p = /** @type {Record<string, unknown>} */ (obj);

  const sentiment = p.sentiment;
  if (sentiment !== "positive" && sentiment !== "negative") {
    throw new Error("INVALID_SENTIMENT");
  }

  let confidence = p.confidence;
  if (typeof confidence !== "number" || Number.isNaN(confidence)) {
    throw new Error("INVALID_CONFIDENCE");
  }
  confidence = Math.min(1, Math.max(0, confidence));

  const topic = p.topic;
  const topics = new Set(["delivery", "product", "service", "other"]);
  if (typeof topic !== "string" || !topics.has(topic)) {
    throw new Error("INVALID_TOPIC");
  }

  const urgency = p.urgency;
  const urgencies = new Set(["low", "medium", "high"]);
  if (typeof urgency !== "string" || !urgencies.has(urgency)) {
    throw new Error("INVALID_URGENCY");
  }

  const summary = p.summary;
  if (typeof summary !== "string" || summary.trim().length === 0) {
    throw new Error("INVALID_SUMMARY");
  }

  return {
    sentiment,
    confidence,
    topic,
    urgency,
    summary: summary.trim(),
  };
}

/**
 * @param {string} s
 * @param {number} max
 */
function truncateForSlack(s, max) {
  const t = String(s);
  if (t.length <= max) {
    return t;
  }
  return `${t.slice(0, max - 1)}…`;
}

/**
 * @param {string} review
 * @param {Classification} aiResult
 */
async function sendToInternal(review, aiResult) {
  if (aiResult.sentiment !== "negative") {
    return;
  }

  console.log("🚨 NEGATIVE REVIEW ALERT");
  console.log({
    review,
    ...aiResult,
  });

  const webhookUrl = process.env.SLACK_WEBHOOK_URL;
  if (!webhookUrl?.trim()) {
    return;
  }

  const reviewBody = truncateForSlack(review, 6000);
  const summaryBody = truncateForSlack(aiResult.summary, 2000);

  const text = `🚨 Negative Review Alert

Review:
${reviewBody}

Summary:
${summaryBody}

Topic:
${aiResult.topic}

Urgency:
${aiResult.urgency}`;

  try {
    const res = await fetch(webhookUrl.trim(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });

    if (!res.ok) {
      let errBody = "";
      try {
        errBody = await res.text();
      } catch {
        errBody = "";
      }
      console.error(
        "Slack webhook failed:",
        res.status,
        res.statusText,
        errBody.slice(0, 500),
      );
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack : undefined;
    console.error("Slack webhook request error:", message, stack ?? "");
  }
}

app.post("/classify-review", async (req, res) => {
  const review = req.body?.review;

  if (typeof review !== "string" || review.trim().length === 0) {
    return res.status(400).json({
      success: false,
      error: 'Body must be JSON with a non-empty string field "review".',
    });
  }

  if (!String(process.env.OPENAI_API_KEY ?? "").trim()) {
    return res.status(500).json({
      success: false,
      error: "OPENAI_API_KEY is not set.",
    });
  }

  const trimmed = review.trim();

  try {
    const aiResult = await classifyReview(trimmed);

    if (aiResult.sentiment === "negative") {
      await sendToInternal(trimmed, aiResult);
    }

    if (isSupabaseConfigured()) {
      if (aiResult.sentiment === "positive") {
        await saveToPublic(trimmed, aiResult);
      } else {
        await saveToAll(trimmed, aiResult);
      }
    }

    return res.json({
      success: true,
      data: {
        review: trimmed,
        sentiment: aiResult.sentiment,
        confidence: aiResult.confidence,
        topic: aiResult.topic,
        urgency: aiResult.urgency,
        summary: aiResult.summary,
      },
    });
  } catch (err) {
    const code = err instanceof Error ? err.message : String(err);
    if (
      code === "EMPTY_MODEL_RESPONSE" ||
      code === "INVALID_JSON" ||
      code.startsWith("INVALID_")
    ) {
      console.error("classify-review model/parse error:", code);
      return res.status(502).json({
        success: false,
        error: "Unexpected or invalid model output.",
      });
    }
    const message = err instanceof Error ? err.message : String(err);
    console.error("classify-review error:", message);
    return res.status(500).json({
      success: false,
      error: "Classification failed.",
    });
  }
});

app.get("/public-reviews", async (_req, res) => {
  if (!isSupabaseConfigured()) {
    return res.json({ success: true, data: [] });
  }
  const client = getSupabase();
  if (!client) {
    return res.json({ success: true, data: [] });
  }
  const { data, error } = await client
    .from("public_reviews")
    .select("id, review, sentiment, topic, urgency, summary, created_at")
    .order("created_at", { ascending: false });

  if (error) {
    console.error("public-reviews:", error);
    return res.json({ success: true, data: [] });
  }

  const rows = (data ?? []).map((row) => mapRow(row));
  res.json({ success: true, data: rows });
});

app.get("/all-reviews", async (_req, res) => {
  if (!isSupabaseConfigured()) {
    return res.json({ success: true, data: [] });
  }
  const client = getSupabase();
  if (!client) {
    return res.json({ success: true, data: [] });
  }
  const { data, error } = await client
    .from("all_reviews")
    .select("id, review, sentiment, topic, urgency, summary, created_at")
    .order("created_at", { ascending: false });

  if (error) {
    console.error("all-reviews:", error);
    return res.json({ success: true, data: [] });
  }

  const rows = (data ?? []).map((row) => mapRow(row));
  res.json({ success: true, data: rows });
});

/**
 * Star-click routing: rating alone decides Trustpilot vs internal feedback (no AI).
 * GET /review?rating=4&order_id=SHOP-123
 */
app.get("/review", (req, res) => {
  const rating = parseStarRating(req.query?.rating);
  if (rating === null) {
    return res.status(400).json({
      success: false,
      error: 'Query must include "rating" as an integer from 1 to 5.',
    });
  }

  const orderIdRaw = req.query?.order_id;
  const order_id =
    orderIdRaw === undefined || orderIdRaw === null
      ? ""
      : Array.isArray(orderIdRaw)
        ? String(orderIdRaw[0] ?? "")
        : String(orderIdRaw);

  if (rating >= 4) {
    return res.redirect(302, TRUSTPILOT_REVIEW_URL);
  }

  const q = new URLSearchParams();
  q.set("rating", String(rating));
  if (order_id) {
    q.set("order_id", order_id);
  }
  return res.redirect(302, `/feedback?${q.toString()}`);
});

/**
 * @param {number | null} rating
 */
function starRowHtml(rating) {
  let out = "";
  for (let i = 1; i <= 5; i += 1) {
    const filled = rating !== null && i <= rating;
    const color = filled ? "#f59e0b" : "#e5e7eb";
    out += `<span style="font-size:1.75rem;line-height:1;color:${color};" aria-hidden="true">★</span>`;
  }
  return out;
}

app.get("/feedback", (req, res) => {
  const rating = parseStarRating(req.query?.rating);
  const orderIdRaw = req.query?.order_id;
  const order_id =
    orderIdRaw === undefined || orderIdRaw === null
      ? ""
      : Array.isArray(orderIdRaw)
        ? String(orderIdRaw[0] ?? "")
        : String(orderIdRaw);
  const thanks = String(req.query?.thanks ?? "") === "1";

  const ratingValue = rating !== null ? String(rating) : "";
  const orderEsc = escapeHtml(order_id);
  const ratingEsc = escapeHtml(ratingValue);
  const stars = starRowHtml(rating);
  const ratingLabel =
    rating !== null ? `You selected <strong>${rating} out of 5</strong> stars.` : "We could not load your star rating from this link.";

  const successBlock = thanks
    ? `<div style="background:#ecfdf5;border:1px solid #a7f3d0;border-radius:10px;padding:1rem 1.1rem;margin:0 0 1.5rem 0;" role="status">
         <p style="margin:0;font-size:0.95rem;line-height:1.5;color:#065f46;font-weight:600;">Thank you — your feedback was received.</p>
         <p style="margin:0.5rem 0 0 0;font-size:0.9rem;line-height:1.5;color:#047857;">We read every message and use it to improve.</p>
       </div>`
    : "";

  const formBlock =
    thanks || rating === null || !order_id
      ? ""
      : `<form method="post" action="/feedback" style="margin:0;">
    <input type="hidden" name="rating" value="${ratingEsc}" />
    <input type="hidden" name="order_id" value="${orderEsc}" />
    <label for="msg" style="display:block;font-size:0.9rem;font-weight:600;color:#374151;margin:0 0 0.4rem 0;">What could we have done better?</label>
    <textarea id="msg" name="message" required maxlength="10000" rows="6" placeholder="Shipping, product quality, support — share anything that would help us do better next time." style="width:100%;box-sizing:border-box;padding:0.85rem 1rem;border:1px solid #d1d5db;border-radius:10px;font-size:1rem;line-height:1.5;font-family:inherit;color:#111827;resize:vertical;min-height:9rem;"></textarea>
    <button type="submit" style="margin-top:1rem;width:100%;box-sizing:border-box;padding:0.85rem 1.25rem;border:none;border-radius:10px;background:#111827;color:#fff;font-size:1rem;font-weight:600;font-family:inherit;cursor:pointer;">Submit feedback</button>
  </form>`;

  const missingHint =
    !thanks && (rating === null || !order_id)
      ? `<p style="margin:0;font-size:0.9rem;line-height:1.55;color:#6b7280;">Please open the link from your email so your order and rating are included.</p>`
      : "";

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="color-scheme" content="light" />
  <title>Your feedback</title>
  <style>
    body { margin:0; background:#f4f6f8; color:#111827; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif; -webkit-font-smoothing:antialiased; }
    .wrap { max-width:28rem; margin:0 auto; padding:1.75rem 1.15rem 3rem; }
    .card { background:#fff; border-radius:12px; border:1px solid #e5e7eb; padding:1.5rem 1.35rem 1.6rem; box-shadow:0 1px 2px rgba(0,0,0,0.04); }
    h1 { margin:0 0 0.35rem 0; font-size:1.35rem; font-weight:600; line-height:1.3; letter-spacing:-0.02em; }
    .sub { margin:0 0 1.25rem 0; font-size:0.95rem; line-height:1.55; color:#6b7280; }
    .rating-row { display:flex; flex-wrap:wrap; align-items:center; gap:0.5rem 0.75rem; margin:0 0 1.15rem 0; }
    .rating-row span[aria-hidden] { letter-spacing:0.12em; }
    .badge { font-size:0.8rem; font-weight:600; color:#92400e; background:#fffbeb; border:1px solid #fde68a; padding:0.2rem 0.55rem; border-radius:999px; }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="card">
      <p style="margin:0 0 0.5rem 0;font-size:0.75rem;font-weight:600;letter-spacing:0.06em;text-transform:uppercase;color:#9ca3af;">We’re listening</p>
      <h1>Help us do better</h1>
      <p class="sub">We’re sorry your experience wasn’t great. A few honest details go a long way.</p>
      ${successBlock}
      <div class="rating-row" ${rating === null ? 'style="margin-bottom:0.75rem;"' : ""}>
        <span class="badge" aria-hidden="true">Your rating</span>
        <span style="display:flex;align-items:center;gap:0.1rem;" aria-label="${rating !== null ? `Rating ${rating} out of 5 stars` : "Rating unknown"}">${stars}</span>
      </div>
      <p style="margin:0 0 1.25rem 0;font-size:0.95rem;line-height:1.55;color:#374151;">${ratingLabel}</p>
      ${missingHint}
      ${formBlock}
    </div>
    <p style="margin:1.25rem 0 0 0;text-align:center;font-size:0.8rem;color:#9ca3af;">Secure feedback — we use this only to improve our service.</p>
  </div>
</body>
</html>`;

  res.type("html").send(html);
});

/**
 * POST /feedback — JSON or form body. Email via Resend when configured; otherwise logs.
 */
app.post("/feedback", async (req, res) => {
  const isJson = req.is("application/json");
  const ratingRaw = req.body?.rating;
  const messageRaw = req.body?.message;
  const order_idRaw = req.body?.order_id;

  const rating = parseStarRating(ratingRaw);
  if (rating === null) {
    if (isJson) {
      return res.status(400).json({
        success: false,
        error: 'Body must include "rating" as an integer from 1 to 5.',
      });
    }
    return res.status(400).send("Invalid rating.");
  }

  if (typeof messageRaw !== "string" || messageRaw.trim().length === 0) {
    if (isJson) {
      return res.status(400).json({
        success: false,
        error: 'Body must include a non-empty string "message".',
      });
    }
    return res.status(400).send("Message is required.");
  }

  if (typeof order_idRaw !== "string" || order_idRaw.trim().length === 0) {
    if (isJson) {
      return res.status(400).json({
        success: false,
        error: 'Body must include a non-empty string "order_id".',
      });
    }
    return res.status(400).send("Order ID is required.");
  }

  const message = messageRaw.trim();
  const order_id = order_idRaw.trim();
  if (message.length > 10000) {
    if (isJson) {
      return res.status(400).json({
        success: false,
        error: '"message" must be at most 10000 characters.',
      });
    }
    return res.status(400).send("Message too long.");
  }

  await sendFeedbackEmail({ rating, message, order_id });

  if (isJson) {
    return res.json({ success: true });
  }
  const q = new URLSearchParams();
  q.set("thanks", "1");
  q.set("rating", String(rating));
  q.set("order_id", order_id);
  return res.redirect(303, `/feedback?${q.toString()}`);
});

/**
 * Browser preview of `templates/review-invite-email.html` with sample data.
 * Open: http://localhost:PORT/preview/review-invite-email
 * Set PUBLIC_APP_URL in .env so star links use your deployed API origin.
 */
app.get("/preview/review-invite-email", async (req, res) => {
  try {
    let html = await readFile(REVIEW_INVITE_EMAIL_PATH, "utf8");
    const base =
      String(process.env.PUBLIC_APP_URL ?? "").trim() ||
      `${req.protocol}://${req.get("host") || `localhost:${Number(process.env.PORT) || 3000}`}`;
    const orderId = "1001";
    const brand =
      String(process.env.PREVIEW_BRAND_NAME ?? "").trim() || "Your Brand";
    html = html
      .split("{{ BASE_URL }}")
      .join(base)
      .split("{{ order.id }}")
      .join(orderId)
      .split("{{ BRAND_NAME }}")
      .join(brand);
    res.type("html").send(html);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("review-invite-email preview:", message);
    res.status(500).send("Could not load email preview.");
  }
});

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

const port = Number(process.env.PORT) || 3000;
app.listen(port, () => {
  console.log(`Review classifier listening on http://localhost:${port}`);
});
