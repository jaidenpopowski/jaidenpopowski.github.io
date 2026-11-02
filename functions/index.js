const { onRequest } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const admin = require("firebase-admin");

admin.initializeApp();

const stripeSecret = defineSecret("STRIPE_SECRET");
const stripeWebhookSecret = defineSecret("STRIPE_WEBHOOK_SECRET");

const AFL_SHARE_BASE =
  "https://fantasy.afl.com.au/api/en/draft/share-draft-board/league";

const ALLOWED_ORIGINS = new Set([
  "https://jaidenpopowski.github.io",
  "https://statsbyjaiden.com.au",
  "https://www.statsbyjaiden.com.au",
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  "http://localhost:4321",
  "http://127.0.0.1:5500"
]);

/** @type {Map<string, number[]>} */
const rateBuckets = new Map();

function setCors(req, res) {
  const origin = req.get("origin") || "";
  if (ALLOWED_ORIGINS.has(origin)) {
    res.set("Access-Control-Allow-Origin", origin);
    res.set("Vary", "Origin");
  }
  res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.set("Access-Control-Max-Age", "3600");
}

function parseLeagueHash(body) {
  if (!body || typeof body !== "object") return "";
  if (body.leagueHash && /^\w+$/.test(String(body.leagueHash))) {
    return String(body.leagueHash);
  }
  const url = String(body.url || "").trim();
  if (!url) return "";
  if (/^\w{16,}$/.test(url)) return url;
  const m = url.match(/\/draft\/(\w+)/i) || url.match(/league\/(\w+)/i);
  return m ? m[1] : "";
}

function allowRate(uid) {
  const now = Date.now();
  const windowMs = 60 * 1000;
  const max = 10;
  const prev = (rateBuckets.get(uid) || []).filter((t) => now - t < windowMs);
  if (prev.length >= max) {
    rateBuckets.set(uid, prev);
    return false;
  }
  prev.push(now);
  rateBuckets.set(uid, prev);
  return true;
}

async function fetchAflJson(url) {
  const res = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": "statsbyjaiden-import/1.0"
    }
  });
  if (!res.ok) {
    const err = new Error("AFL upstream HTTP " + res.status);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

function collectPlayerIds(team) {
  const ids = [];
  const pushArr = (arr) => {
    if (!Array.isArray(arr)) return;
    arr.forEach((id) => {
      if (id != null && id !== "") ids.push(Number(id));
    });
  };
  const lineup = team && team.lineup ? team.lineup : {};
  ["DEF", "MID", "RUC", "FWD", "FLX"].forEach((k) => pushArr(lineup[k]));
  pushArr(team && team.bench);
  pushArr(team && team.reserve);
  pushArr(team && team.injuryReplacement);
  if (team && team.captainId) ids.push(Number(team.captainId));
  if (team && team.viceCaptainId) ids.push(Number(team.viceCaptainId));
  return ids.filter((n) => Number.isFinite(n));
}

function squadSlotTotal(squadSize) {
  const s = squadSize || {};
  return (
    (Number(s.DEF) || 0) +
    (Number(s.MID) || 0) +
    (Number(s.RUC) || 0) +
    (Number(s.FWD) || 0) +
    (Number(s.FLX) || 0) +
    (Number(s.INT) || 0)
  );
}

function inferKeeperCount(leagueMeta, draftBoard) {
  if (!leagueMeta || leagueMeta.leagueType !== "keeper") return null;
  const squad =
    squadSlotTotal(leagueMeta.squadSize) + (Number(leagueMeta.reserve) || 0);
  if (!squad) return null;
  const picks = (draftBoard && draftBoard.completedPicks) || [];
  if (!picks.length) return null;

  const byOriginal = new Map();
  picks.forEach((p) => {
    const oid = p && p.originalTeamId;
    if (oid == null) return;
    if (!byOriginal.has(oid)) byOriginal.set(oid, { total: 0, kept: 0 });
    const row = byOriginal.get(oid);
    row.total += 1;
    if (p.teamId != null && Number(p.teamId) === Number(oid)) row.kept += 1;
  });

  let minUsed = Infinity;
  byOriginal.forEach((row) => {
    const used = row.total - row.kept;
    if (used < minUsed) minUsed = used;
  });
  if (!Number.isFinite(minUsed)) return null;
  // squad - picks used by original team ≈ keepers (see importKeeper notes)
  return Math.max(0, squad - minUsed);
}

function normalizeAflPayload(leagueMeta, teamsArr, draftBoard) {
  const teams = Object.create(null);
  const ownership = Object.create(null);

  (teamsArr || []).forEach((t) => {
    if (!t || t.id == null) return;
    const id = String(t.id);
    teams[id] = { name: t.name || "Team " + id };
    collectPlayerIds(t).forEach((pid) => {
      ownership[String(pid)] = id;
    });
  });

  const slots = {
    DEF: Number(leagueMeta.squadSize && leagueMeta.squadSize.DEF) || 0,
    MID: Number(leagueMeta.squadSize && leagueMeta.squadSize.MID) || 0,
    RUC: Number(leagueMeta.squadSize && leagueMeta.squadSize.RUC) || 0,
    FWD: Number(leagueMeta.squadSize && leagueMeta.squadSize.FWD) || 0
  };
  const bench =
    (Number(leagueMeta.squadSize && leagueMeta.squadSize.FLX) || 0) +
    (Number(leagueMeta.squadSize && leagueMeta.squadSize.INT) || 0) +
    (Number(leagueMeta.reserve) || 0) +
    (Number(leagueMeta.injuryReplacement) || 0);

  return {
    teams,
    ownership,
    platform: {
      leagueHash: leagueMeta._hash,
      leagueId: leagueMeta.id,
      leagueName: leagueMeta.name,
      leagueType: leagueMeta.leagueType,
      draftStatus: leagueMeta.draftStatus,
      year: leagueMeta.year,
      draftTurnType: leagueMeta.draftTurnType,
      reserveDraftRounds: leagueMeta.reserveDraftRounds
    },
    infer: {
      leagueType: leagueMeta.leagueType,
      draftStatus: leagueMeta.draftStatus,
      slots,
      bench,
      reserveDraftRounds: leagueMeta.reserveDraftRounds,
      inferredKeeperCount: inferKeeperCount(leagueMeta, draftBoard),
      year: leagueMeta.year
    }
  };
}

exports.stripeWebhook = onRequest(
  { secrets: [stripeSecret, stripeWebhookSecret] },
  async (req, res) => {
    const stripe = require("stripe")(stripeSecret.value());
    const sig = req.headers["stripe-signature"];

    let event;
    try {
      event = stripe.webhooks.constructEvent(
        req.rawBody,
        sig,
        stripeWebhookSecret.value()
      );
    } catch (err) {
      console.error("Webhook signature failed:", err.message);
      return res.status(400).send(`Webhook error: ${err.message}`);
    }

    if (event.type === "checkout.session.completed") {
      const session = event.data.object;
      const uid = session.client_reference_id;

      if (uid) {
        await admin
          .firestore()
          .collection("users")
          .doc(uid)
          .set({ paid: true }, { merge: true });
        console.log("Marked paid for UID:", uid);
      } else {
        console.warn("No client_reference_id on session:", session.id);
      }
    }

    res.json({ received: true });
  }
);

exports.importAflLeague = onRequest(
  { cors: false, timeoutSeconds: 60, memory: "256MiB" },
  async (req, res) => {
    setCors(req, res);
    if (req.method === "OPTIONS") {
      return res.status(204).send("");
    }
    if (req.method !== "POST") {
      return res.status(405).json({ error: "POST only" });
    }

    const authHeader = req.get("authorization") || "";
    const match = authHeader.match(/^Bearer\s+(.+)$/i);
    if (!match) {
      return res.status(401).json({ error: "Missing Authorization bearer token" });
    }

    let decoded;
    try {
      decoded = await admin.auth().verifyIdToken(match[1]);
    } catch (e) {
      console.warn("ID token verify failed:", e.message);
      return res.status(401).json({ error: "Invalid auth token" });
    }

    if (!allowRate(decoded.uid)) {
      return res.status(429).json({ error: "Too many import requests — try again shortly" });
    }

    const leagueHash = parseLeagueHash(req.body);
    if (!leagueHash) {
      return res.status(400).json({ error: "Provide url or leagueHash" });
    }

    try {
      const leagueUrl = `${AFL_SHARE_BASE}/${leagueHash}`;
      const teamsUrl = `${leagueUrl}/teams`;
      const [leagueJson, teamsJson] = await Promise.all([
        fetchAflJson(leagueUrl),
        fetchAflJson(teamsUrl)
      ]);

      const leagueMeta =
        (leagueJson && leagueJson.success && leagueJson.success.league) || null;
      const teamsArr =
        (teamsJson && teamsJson.success && teamsJson.success.teams) || [];

      if (!leagueMeta) {
        const msg =
          (leagueJson &&
            leagueJson.errors &&
            leagueJson.errors[0] &&
            leagueJson.errors[0].message) ||
          "League not found";
        return res.status(404).json({ error: msg });
      }

      leagueMeta._hash = leagueHash;

      let draftBoard = null;
      if (
        leagueMeta.leagueType === "keeper" &&
        leagueMeta.draftStatus &&
        leagueMeta.draftStatus !== "scheduled"
      ) {
        try {
          const boardJson = await fetchAflJson(`${leagueUrl}/draft-board`);
          draftBoard =
            (boardJson && boardJson.success) || null;
        } catch (e) {
          console.warn("draft-board fetch skipped:", e.message);
        }
      }

      const normalized = normalizeAflPayload(leagueMeta, teamsArr, draftBoard);
      return res.json(normalized);
    } catch (e) {
      console.error("importAflLeague failed:", e);
      const status = e.status && e.status >= 400 && e.status < 600 ? e.status : 502;
      return res.status(status).json({
        error: e.message || "Upstream AFL Fantasy request failed"
      });
    }
  }
);
