const express = require("express");
const dotenv = require("dotenv");
const path = require("path");
const fs = require("fs");

dotenv.config();

const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.get("/", (req, res) => res.send("OK"));

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

    return res.send("LOW RATING");
  } catch (err) {
    console.error("REVIEW ERROR:", err);
    return res.status(500).send("Error");
  }
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, "0.0.0.0", () => {
  console.log("SERVER RUNNING ON PORT:", PORT);
});
