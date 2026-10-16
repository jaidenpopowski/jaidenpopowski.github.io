/**
 * AFL Fantasy draft futures — client-side VORP + Tabulator views.
 * League-dependent math lives here; R owns model components in the JSON.
 */
(function (global) {
  "use strict";

  const POS_KEYS = ["DEF", "MID", "RUC", "FWD"];
  const STORAGE_URL =
    "https://firebasestorage.googleapis.com/v0/b/statsbyjaiden.firebasestorage.app/o/fantasy_draft_futures.json?alt=media";

  const DEFAULT_CFG = {
    teams: 10,
    slots: { DEF: 5, MID: 7, RUC: 1, FWD: 5 },
    bench: 12,
    keeperCount: 20,
    endSeason: null,
    view: "value",
    byYear: false,
    posFilter: "ALL",
    search: ""
  };

  let state = {
    cfg: { ...DEFAULT_CFG, slots: { ...DEFAULT_CFG.slots } },
    data: null,
    seasons: [],
    rows: [],
    table: null
  };

  // ── URL config ─────────────────────────────────────────────────────────────

  function readCfgFromUrl() {
    const q = new URLSearchParams(window.location.search);
    const cfg = { ...DEFAULT_CFG, slots: { ...DEFAULT_CFG.slots } };
    if (q.has("teams")) cfg.teams = clampInt(q.get("teams"), 2, 30, 10);
    if (q.has("bench")) cfg.bench = clampInt(q.get("bench"), 0, 40, 12);
    if (q.has("keepers")) cfg.keeperCount = clampInt(q.get("keepers"), 0, 40, 20);
    POS_KEYS.forEach((k) => {
      const key = k.toLowerCase();
      if (q.has(key)) cfg.slots[k] = clampInt(q.get(key), 0, 20, cfg.slots[k]);
    });
    if (q.has("end")) cfg.endSeason = parseInt(q.get("end"), 10) || null;
    if (q.has("view")) cfg.view = q.get("view") || "value";
    if (q.has("byYear")) cfg.byYear = q.get("byYear") === "1" || q.get("byYear") === "true";
    if (q.has("pos")) cfg.posFilter = q.get("pos") || "ALL";
    if (q.has("q")) cfg.search = q.get("q") || "";
    return cfg;
  }

  function writeCfgToUrl(cfg) {
    const q = new URLSearchParams();
    q.set("teams", String(cfg.teams));
    q.set("bench", String(cfg.bench));
    q.set("keepers", String(cfg.keeperCount));
    POS_KEYS.forEach((k) => q.set(k.toLowerCase(), String(cfg.slots[k])));
    if (cfg.endSeason) q.set("end", String(cfg.endSeason));
    q.set("view", cfg.view);
    if (cfg.byYear) q.set("byYear", "1");
    if (cfg.posFilter && cfg.posFilter !== "ALL") q.set("pos", cfg.posFilter);
    if (cfg.search) q.set("q", cfg.search);
    const url = window.location.pathname + "?" + q.toString();
    window.history.replaceState({}, "", url);
  }

  function clampInt(v, lo, hi, fallback) {
    const n = parseInt(v, 10);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(lo, Math.min(hi, n));
  }

  // ── Aggregation / VORP ─────────────────────────────────────────────────────

  function horizonLen(seasons, endSeason) {
    if (!seasons.length) return 0;
    if (endSeason == null) return seasons.length;
    const idx = seasons.indexOf(Number(endSeason));
    if (idx < 0) return seasons.length;
    return idx + 1;
  }

  function sumSlice(arr, h) {
    if (!arr || !arr.length) return 0;
    let s = 0;
    for (let i = 0; i < h && i < arr.length; i++) s += Number(arr[i]) || 0;
    return s;
  }

  function meanPos(asset, pos, h) {
    const arr = asset.pos && asset.pos[pos];
    if (!arr || !arr.length) return 0;
    let s = 0;
    const n = Math.min(h, arr.length);
    for (let i = 0; i < n; i++) s += Number(arr[i]) || 0;
    return n ? s / n : 0;
  }

  /** Formation-proportional bench seats; remainder to largest on-field slots. */
  function allocateBenchSlots(slots, bench) {
    const total = POS_KEYS.reduce((s, k) => s + (slots[k] || 0), 0);
    const out = { DEF: 0, MID: 0, RUC: 0, FWD: 0 };
    if (bench <= 0 || total <= 0) return out;
    let assigned = 0;
    const exact = POS_KEYS.map((k) => ({
      k,
      v: (bench * (slots[k] || 0)) / total,
      slot: slots[k] || 0
    }));
    exact.forEach((e) => {
      out[e.k] = Math.floor(e.v);
      assigned += out[e.k];
    });
    let rem = bench - assigned;
    exact
      .slice()
      .sort((a, b) => b.slot - a.slot || b.v - a.v)
      .forEach((e) => {
        if (rem > 0) {
          out[e.k] += 1;
          rem -= 1;
        }
      });
    return out;
  }

  function computeRows(assets, cfg, seasons) {
    const h = horizonLen(seasons, cfg.endSeason);
    const benchSlots = allocateBenchSlots(cfg.slots, cfg.bench);

    const enriched = assets.map((a) => {
      const value = sumSlice(a.xPoints, h);
      const P = {};
      POS_KEYS.forEach((p) => {
        P[p] = meanPos(a, p, h);
      });
      const prevXp = a.prev && a.prev.xPoints ? a.prev.xPoints : null;
      const dxPoints = prevXp != null ? value - sumSlice(prevXp, h) : null;
      return { asset: a, value, P, dxPoints, h };
    });

    const baselines = {};
    POS_KEYS.forEach((p) => {
      const depth = cfg.teams * ((cfg.slots[p] || 0) + (benchSlots[p] || 0));
      const ranked = enriched
        .map((r) => ({ id: r.asset.id, score: r.value * r.P[p] }))
        .sort((a, b) => b.score - a.score);
      if (depth <= 0 || !ranked.length) {
        baselines[p] = 0;
      } else {
        const idx = Math.min(depth, ranked.length) - 1;
        // Soft baseline: use the asset's full value at that rank (not fractional score)
        const id = ranked[idx].id;
        const hit = enriched.find((r) => r.asset.id === id);
        baselines[p] = hit ? hit.value : 0;
      }
    });

    return enriched.map((r) => {
      let repl = 0;
      POS_KEYS.forEach((p) => {
        repl += r.P[p] * baselines[p];
      });
      const vorp = r.value - repl;
      const a = r.asset;
      const last = Math.max(0, r.h - 1);
      return {
        id: a.id,
        type: a.type,
        name: a.name,
        club: a.club,
        age: a.age,
        contract: a.contract,
        fantasyPos: Array.isArray(a.fantasyPos) ? a.fantasyPos.join("/") : "",
        status: a.status,
        value: r.value,
        vorp,
        dxPoints: r.dxPoints,
        driver: a.delta && a.delta.driver,
        event: (a.delta && a.delta.event) || null,
        xAvg: numAt(a.xAvg, last),
        xGames: numAt(a.xGames, last),
        pListed: numAt(a.probListed, last),
        pDEF: r.P.DEF,
        pMID: r.P.MID,
        pRUC: r.P.RUC,
        pFWD: r.P.FWD,
        _asset: a,
        _h: r.h,
        _baselines: baselines
      };
    });
  }

  function numAt(arr, i) {
    if (!arr || arr[i] == null) return null;
    return Number(arr[i]);
  }

  // ── Columns / views ────────────────────────────────────────────────────────

  function fmt1(v) {
    if (v == null || !Number.isFinite(v)) return "—";
    return v.toFixed(1);
  }
  function fmt3(v) {
    if (v == null || !Number.isFinite(v)) return "—";
    return v.toFixed(3);
  }
  function fmtInt(v) {
    if (v == null || !Number.isFinite(v)) return "—";
    return String(Math.round(v));
  }

  function yearCols(seasons, metric, labelPrefix, fmt) {
    return seasons.map((y, i) => ({
      title: labelPrefix + " " + y,
      field: metric + "_Y" + (i + 1),
      hozAlign: "right",
      sorter: "number",
      formatter: (cell) => fmt(cell.getValue())
    }));
  }

  function buildColumnDefs(seasons, view, byYear) {
    const baseName = {
      title: "Name",
      field: "name",
      frozen: true,
      minWidth: 140,
      headerFilter: false
    };
    const cols = {
      name: baseName,
      type: { title: "Type", field: "type", width: 70 },
      pos: { title: "Pos", field: "fantasyPos", width: 70 },
      club: { title: "Club", field: "club", width: 70 },
      age: {
        title: "Age",
        field: "age",
        width: 55,
        hozAlign: "right",
        formatter: (c) => fmt1(c.getValue())
      },
      contract: {
        title: "Contract",
        field: "contract",
        width: 80,
        hozAlign: "right",
        formatter: (c) => fmtInt(c.getValue())
      },
      vorp: {
        title: "VORP",
        field: "vorp",
        hozAlign: "right",
        sorter: "number",
        formatter: (c) => fmt1(c.getValue())
      },
      xValue: {
        title: "xValue",
        field: "value",
        hozAlign: "right",
        sorter: "number",
        formatter: (c) => fmt1(c.getValue())
      },
      xAvg: {
        title: "xAvg",
        field: "xAvg",
        hozAlign: "right",
        formatter: (c) => fmt1(c.getValue())
      },
      xGames: {
        title: "xGames",
        field: "xGames",
        hozAlign: "right",
        formatter: (c) => fmt1(c.getValue())
      },
      pListed: {
        title: "pListed",
        field: "pListed",
        hozAlign: "right",
        formatter: (c) => fmt3(c.getValue())
      },
      dxPoints: {
        title: "Δ xPts",
        field: "dxPoints",
        hozAlign: "right",
        sorter: "number",
        formatter: (c) => fmt1(c.getValue())
      },
      driver: { title: "Driver", field: "driver", width: 90 },
      event: { title: "Event", field: "event", minWidth: 100 },
      pDEF: {
        title: "pDEF",
        field: "pDEF",
        hozAlign: "right",
        formatter: (c) => fmt3(c.getValue())
      },
      pMID: {
        title: "pMID",
        field: "pMID",
        hozAlign: "right",
        formatter: (c) => fmt3(c.getValue())
      },
      pRUC: {
        title: "pRUC",
        field: "pRUC",
        hozAlign: "right",
        formatter: (c) => fmt3(c.getValue())
      },
      pFWD: {
        title: "pFWD",
        field: "pFWD",
        hozAlign: "right",
        formatter: (c) => fmt3(c.getValue())
      }
    };

    const views = {
      value: ["name", "pos", "age", "vorp", "xValue", "xAvg", "xGames", "pListed"],
      lists: ["name", "club", "age", "contract"],
      scoring: ["name"],
      positions: ["name", "pos", "pDEF", "pMID", "pRUC", "pFWD"],
      movers: ["name", "vorp", "dxPoints", "driver", "event"]
    };

    let keys = views[view] || views.value;
    let out = keys.map((k) => cols[k]).filter(Boolean);

    if (view === "lists" || (byYear && view === "value")) {
      // pListed by year
      seasons.forEach((y, i) => {
        out.push({
          title: "pListed " + y,
          field: "pListed_Y" + (i + 1),
          hozAlign: "right",
          sorter: "number",
          formatter: (c) => fmt3(c.getValue())
        });
      });
    }
    if (view === "scoring" || (byYear && view === "scoring")) {
      seasons.forEach((y, i) => {
        out.push({
          title: "xAvg " + y,
          field: "xAvg_Y" + (i + 1),
          hozAlign: "right",
          formatter: (c) => fmt1(c.getValue())
        });
        out.push({
          title: "xGames " + y,
          field: "xGames_Y" + (i + 1),
          hozAlign: "right",
          formatter: (c) => fmt1(c.getValue())
        });
      });
    }
    if (byYear && view === "value") {
      seasons.forEach((y, i) => {
        out.push({
          title: "xPts " + y,
          field: "xPoints_Y" + (i + 1),
          hozAlign: "right",
          formatter: (c) => fmt1(c.getValue())
        });
      });
    }

    return out;
  }

  function flattenRow(row, seasons) {
    const a = row._asset;
    const out = { ...row };
    seasons.forEach((y, i) => {
      out["pListed_Y" + (i + 1)] = numAt(a.probListed, i);
      out["xAvg_Y" + (i + 1)] = numAt(a.xAvg, i);
      out["xGames_Y" + (i + 1)] = numAt(a.xGames, i);
      out["xPoints_Y" + (i + 1)] = numAt(a.xPoints, i);
    });
    return out;
  }

  function filterRows(rows, cfg) {
    return rows.filter((r) => {
      if (cfg.posFilter && cfg.posFilter !== "ALL") {
        const fp = r.fantasyPos || "";
        if (r.type === "pick") {
          // picks: use dominant soft pos
          const scores = {
            DEF: r.pDEF,
            MID: r.pMID,
            RUC: r.pRUC,
            FWD: r.pFWD
          };
          const top = POS_KEYS.reduce((a, b) => (scores[a] >= scores[b] ? a : b));
          if (top !== cfg.posFilter) return false;
        } else if (!fp.includes(cfg.posFilter)) {
          return false;
        }
      }
      if (cfg.search) {
        const q = cfg.search.toLowerCase();
        if (!(r.name || "").toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }

  // ── Detail / movers ────────────────────────────────────────────────────────

  function detailHtml(row) {
    const a = row._asset;
    const seasons = state.seasons;
    const lines = ["<div class='futures-detail'>"];
    lines.push("<table><thead><tr><th></th>");
    seasons.forEach((y) => lines.push("<th>" + y + "</th>"));
    lines.push("</tr></thead><tbody>");
    [
      ["pListed", a.probListed, fmt3],
      ["xGames", a.xGames, fmt1],
      ["xAvg", a.xAvg, fmt1],
      ["xPoints", a.xPoints, fmt1]
    ].forEach(([lab, arr, fmt]) => {
      lines.push("<tr><td>" + lab + "</td>");
      seasons.forEach((_, i) => lines.push("<td>" + fmt(numAt(arr, i)) + "</td>"));
      lines.push("</tr>");
    });
    lines.push("</tbody></table>");
    if (a.band) {
      lines.push(
        "<p class='muted'>Band p10/p90: precomputed cumulative quantiles (null until MC layer).</p>"
      );
    }
    if (a.delta) {
      lines.push(
        "<p>Δ driver: <b>" +
          (a.delta.driver || "—") +
          "</b> · event: " +
          (a.delta.event || "—") +
          "</p>"
      );
    }
    lines.push("</div>");
    return lines.join("");
  }

  function renderMoversPanel(rows, cfg, data) {
    const el = document.getElementById("movers-panel");
    if (!el) return;
    const h = horizonLen(state.seasons, cfg.endSeason);
    const defaultH = (data.meta && data.meta.defaultHorizon) || state.seasons.length;
    let rising;
    let falling;
    if (h === defaultH && data.movers) {
      const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
      rising = (data.movers.rising || [])
        .map((m) => ({ ...m, name: (byId[m.id] && byId[m.id].name) || m.id }))
        .slice(0, 10);
      falling = (data.movers.falling || [])
        .map((m) => ({ ...m, name: (byId[m.id] && byId[m.id].name) || m.id }))
        .slice(0, 10);
    } else {
      const withDx = rows
        .filter((r) => r.dxPoints != null && r.status !== "new")
        .slice()
        .sort((a, b) => b.dxPoints - a.dxPoints);
      rising = withDx.filter((r) => r.dxPoints > 0).slice(0, 10);
      falling = withDx
        .filter((r) => r.dxPoints < 0)
        .sort((a, b) => a.dxPoints - b.dxPoints)
        .slice(0, 10);
    }
    function list(title, items, pos) {
      const lis = items
        .map(
          (m) =>
            "<li><span>" +
            (m.name || m.id) +
            "</span> <span class='" +
            (pos ? "up" : "down") +
            "'>" +
            fmt1(m.dxPoints) +
            "</span></li>"
        )
        .join("");
      return "<div><h4>" + title + "</h4><ul>" + (lis || "<li class='muted'>None</li>") + "</ul></div>";
    }
    el.innerHTML =
      "<div class='movers-grid'>" +
      list("Rising", rising, true) +
      list("Falling", falling, false) +
      "</div>";
  }

  // ── Tabulator ──────────────────────────────────────────────────────────────

  function ensureTable(columns) {
    const hold = document.getElementById("futures-table");
    if (!hold) return;
    if (state.table) {
      state.table.setColumns(columns);
      return;
    }
    state.table = new Tabulator("#futures-table", {
      data: [],
      columns,
      layout: "fitDataFill",
      height: "640px",
      placeholder: "No assets match these filters",
      initialSort: [{ column: "vorp", dir: "desc" }],
      rowFormatter: function (row) {
        // no-op; expansion via click
      }
    });
    state.table.on("rowClick", function (e, row) {
      const d = row.getData();
      const existing = row.getElement().querySelector(".futures-detail");
      if (existing) {
        existing.remove();
        return;
      }
      const div = document.createElement("div");
      div.innerHTML = detailHtml(d);
      row.getElement().appendChild(div.firstChild);
    });
  }

  function refresh() {
    if (!state.data) return;
    const cfg = state.cfg;
    writeCfgToUrl(cfg);
    const all = computeRows(state.data.assets, cfg, state.seasons);
    state.rows = all;
    const filtered = filterRows(all, cfg).map((r) => flattenRow(r, state.seasons));
    const columns = buildColumnDefs(state.seasons, cfg.view, cfg.byYear);
    ensureTable(columns);
    state.table.replaceData(filtered);
    renderMoversPanel(all, cfg, state.data);
    const meta = document.getElementById("futures-meta");
    if (meta && state.data.meta) {
      meta.textContent =
        "As of " +
        state.data.meta.asOf +
        " · " +
        state.data.assets.length +
        " assets · model " +
        (state.data.meta.modelVersion || "");
    }
  }

  // ── Controls wiring ────────────────────────────────────────────────────────

  function syncControlsToDom(cfg, seasons) {
    const setVal = (id, v) => {
      const el = document.getElementById(id);
      if (el) el.value = v;
    };
    setVal("cfg-teams", cfg.teams);
    setVal("cfg-bench", cfg.bench);
    setVal("cfg-keepers", cfg.keeperCount);
    POS_KEYS.forEach((k) => setVal("cfg-" + k.toLowerCase(), cfg.slots[k]));
    const endSel = document.getElementById("cfg-endSeason");
    if (endSel && seasons.length) {
      endSel.innerHTML = seasons
        .map((y) => "<option value='" + y + "'>" + y + "</option>")
        .join("");
      cfg.endSeason = cfg.endSeason || seasons[seasons.length - 1];
      endSel.value = String(cfg.endSeason);
    }
    setVal("cfg-view", cfg.view);
    const by = document.getElementById("cfg-byYear");
    if (by) by.checked = !!cfg.byYear;
    setVal("cfg-search", cfg.search || "");
    document.querySelectorAll(".pos-filter-btn").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.pos === (cfg.posFilter || "ALL"));
    });
  }

  function readControlsFromDom() {
    const cfg = state.cfg;
    const num = (id, fb) => {
      const el = document.getElementById(id);
      return el ? clampInt(el.value, -999, 999, fb) : fb;
    };
    cfg.teams = Math.max(2, num("cfg-teams", cfg.teams));
    cfg.bench = Math.max(0, num("cfg-bench", cfg.bench));
    cfg.keeperCount = Math.max(0, num("cfg-keepers", cfg.keeperCount));
    POS_KEYS.forEach((k) => {
      cfg.slots[k] = Math.max(0, num("cfg-" + k.toLowerCase(), cfg.slots[k]));
    });
    const endSel = document.getElementById("cfg-endSeason");
    if (endSel) cfg.endSeason = parseInt(endSel.value, 10);
    const view = document.getElementById("cfg-view");
    if (view) cfg.view = view.value;
    const by = document.getElementById("cfg-byYear");
    if (by) cfg.byYear = by.checked;
    const search = document.getElementById("cfg-search");
    if (search) cfg.search = search.value.trim();
    return cfg;
  }

  function bindControls() {
    const ids = [
      "cfg-teams",
      "cfg-bench",
      "cfg-keepers",
      "cfg-def",
      "cfg-mid",
      "cfg-ruc",
      "cfg-fwd",
      "cfg-endSeason",
      "cfg-view",
      "cfg-byYear",
      "cfg-search"
    ];
    ids.forEach((id) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.addEventListener("change", () => {
        readControlsFromDom();
        refresh();
      });
      if (id === "cfg-search") {
        el.addEventListener("input", () => {
          readControlsFromDom();
          refresh();
        });
      }
    });
    document.querySelectorAll(".pos-filter-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        state.cfg.posFilter = btn.dataset.pos || "ALL";
        document.querySelectorAll(".pos-filter-btn").forEach((b) => {
          b.classList.toggle("active", b === btn);
        });
        refresh();
      });
    });
  }

  // ── Boot ───────────────────────────────────────────────────────────────────

  async function init() {
    state.cfg = readCfgFromUrl();
    bindControls();

    const loading = document.getElementById("loading-state");
    const err = document.getElementById("futures-error");
    const shell = document.getElementById("futures-shell");

    try {
      const res = await fetch(STORAGE_URL);
      if (!res.ok) throw new Error("HTTP " + res.status);
      const data = await res.json();
      if (!data.assets || !data.meta) throw new Error("Invalid payload");
      state.data = data;
      state.seasons = (data.meta.seasons || []).map(Number);
      if (!state.cfg.endSeason) {
        state.cfg.endSeason = state.seasons[state.seasons.length - 1];
      }
      syncControlsToDom(state.cfg, state.seasons);
      if (loading) loading.style.display = "none";
      if (shell) shell.style.display = "block";
      refresh();
    } catch (e) {
      console.error(e);
      if (loading) loading.style.display = "none";
      if (err) {
        err.style.display = "block";
        err.textContent =
          "Failed to load fantasy_draft_futures.json — " +
          (e && e.message ? e.message : "unknown error") +
          ". Try refresh, or check that the weekly publish has run.";
      }
    }
  }

  global.FantasyDraftFutures = { init, refresh, state };
})(window);

document.addEventListener("DOMContentLoaded", function () {
  if (window.FantasyDraftFutures) window.FantasyDraftFutures.init();
});
