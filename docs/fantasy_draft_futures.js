/**
 * AFL Fantasy draft futures — client-side VORP + Tabulator views.
 * League-dependent math lives here; R owns model components in the JSON.
 */
(function (global) {
  "use strict";

  const POS_KEYS = ["DEF", "MID", "RUC", "FWD"];
  const STORAGE_URL =
    "https://firebasestorage.googleapis.com/v0/b/statsbyjaiden.firebasestorage.app/o/fantasy_draft_futures.json?alt=media";
  const HEADSHOT_BASE =
    "https://s.afl.com.au/staticfile/AFL%20Tenant/AFL/Players/ChampIDImages/AFL/2026014/";

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
    table: null,
    hadQueryOnLoad: false
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

  function cumAt(arr, i) {
    if (!arr || !arr.length || i < 0) return null;
    let s = 0;
    let any = false;
    for (let j = 0; j <= i && j < arr.length; j++) {
      const v = Number(arr[j]);
      if (Number.isFinite(v)) {
        s += v;
        any = true;
      }
    }
    return any ? s : null;
  }

  function meanPos(asset, pos, h) {
    const arr = asset.pos && asset.pos[pos];
    if (!arr || !arr.length) return 0;
    let s = 0;
    const n = Math.min(h, arr.length);
    for (let i = 0; i < n; i++) s += Number(arr[i]) || 0;
    return n ? s / n : 0;
  }

  /** Position-weighted value: Σ probListed * xGamesPOS * xAvg over horizon. */
  function posScore(asset, pos, h) {
    const key = "xGames" + pos;
    const xgPos = asset[key];
    const pl = asset.probListed;
    const xa = asset.xAvg;
    if (xgPos && xgPos.length && pl && xa) {
      let s = 0;
      const n = Math.min(h, xgPos.length, pl.length, xa.length);
      for (let i = 0; i < n; i++) {
        s += (Number(pl[i]) || 0) * (Number(xgPos[i]) || 0) * (Number(xa[i]) || 0);
      }
      return s;
    }
    // Fallback: full value × mean eligibility share
    return sumSlice(asset.xPoints, h) * meanPos(asset, pos, h);
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
      const score = {};
      POS_KEYS.forEach((p) => {
        P[p] = meanPos(a, p, h);
        score[p] = posScore(a, p, h);
      });
      const prevXp = a.prev && a.prev.xPoints ? a.prev.xPoints : null;
      const dxPoints = prevXp != null ? value - sumSlice(prevXp, h) : null;
      return { asset: a, value, P, score, dxPoints, h };
    });

    const baselines = {};
    POS_KEYS.forEach((p) => {
      const depth = cfg.teams * ((cfg.slots[p] || 0) + (benchSlots[p] || 0));
      const ranked = enriched
        .map((r) => ({ id: r.asset.id, score: r.score[p] }))
        .sort((a, b) => b.score - a.score);
      if (depth <= 0 || !ranked.length) {
        baselines[p] = 0;
      } else {
        const idx = Math.min(depth, ranked.length) - 1;
        const id = ranked[idx].id;
        const hit = enriched.find((r) => r.asset.id === id);
        baselines[p] = hit ? hit.value : 0;
      }
    });

    return enriched.map((r) => {
      // Rank-by-position uses raw eligibility / xGamesPOS (DPP may sum > 1).
      // Replacement cost must not: a player is only rostered once, so weight
      // baselines by P[p] / sum(P). Otherwise DEF/MID DPP pays ~2× replacement
      // and can go deeply negative despite elite xValue (e.g. Max Holmes 2027).
      const sumP = POS_KEYS.reduce((s, p) => s + (r.P[p] || 0), 0);
      let repl = 0;
      POS_KEYS.forEach((p) => {
        const w = sumP > 0 ? (r.P[p] || 0) / sumP : 0;
        repl += w * baselines[p];
      });
      const vorp = r.value - repl;
      const a = r.asset;
      const last = Math.max(0, r.h - 1);
      return {
        id: a.id,
        type: a.type,
        name: a.name,
        club: a.club,
        teamAbbr: a.club || null,
        age: a.age != null && Number.isFinite(Number(a.age)) ? Math.round(Number(a.age)) : null,
        contract: a.contract,
        fantasyPos: Array.isArray(a.fantasyPos) ? a.fantasyPos.join("/") : "",
        status: a.status,
        value: r.value,
        vorp,
        dxPoints: r.dxPoints,
        driver: a.delta && a.delta.driver,
        event: (a.delta && a.delta.event) || null,
        xAvg: numAt(a.xAvg, last),
        xGames: cumAt(a.xGames, last),
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

  // ── Formatters ─────────────────────────────────────────────────────────────

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
  function fmtPct(v) {
    if (v == null || !Number.isFinite(v)) return "—";
    return Math.round(v * 100) + "%";
  }

  function escapeHtml(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function headshotHtml(row) {
    const isPick = row.type === "pick" || !row.id || String(row.id).indexOf("CD_I") !== 0;
    if (isPick) {
      return '<span class="fd-headshot fd-headshot-empty" aria-hidden="true"></span>';
    }
    const pid = String(row.id).replace("CD_I", "");
    const src = HEADSHOT_BASE + pid + ".png?im=Resize=(80,80)";
    return (
      '<span class="fd-headshot">' +
      '<img src="' +
      src +
      '" alt="" loading="lazy" onerror="this.parentNode.classList.add(\'fd-headshot-empty\');this.remove();">' +
      "</span>"
    );
  }

  function posChipsHtml(fantasyPos) {
    const parts = String(fantasyPos || "")
      .split("/")
      .map((p) => p.trim())
      .filter(Boolean);
    if (!parts.length) return "";
    return parts
      .map((p) => '<span class="fd-pos-chip fd-pos-' + escapeHtml(p) + '">' + escapeHtml(p) + "</span>")
      .join("");
  }

  function nameCellHtml(cell) {
    const row = cell.getRow().getData();
    const abbr = row.teamAbbr || row.club || "";
    const teamChip = abbr
      ? '<span class="fd-team-chip fd-team-' +
        escapeHtml(abbr) +
        '">' +
        escapeHtml(abbr) +
        "</span>"
      : "";
    return (
      '<div class="fd-name-cell">' +
      headshotHtml(row) +
      '<div class="fd-name-meta">' +
      '<div class="fd-name-top" title="' +
      escapeHtml(row.name || "") +
      '">' +
      escapeHtml(row.name || "") +
      "</div>" +
      '<div class="fd-name-bottom">' +
      teamChip +
      posChipsHtml(row.fantasyPos) +
      "</div>" +
      "</div>" +
      "</div>"
    );
  }

  // ── Columns / views ────────────────────────────────────────────────────────

  function buildColumnDefs(seasons, view, byYear) {
    const baseName = {
      title: "Name",
      field: "name",
      frozen: true,
      width: 220,
      minWidth: 220,
      maxWidth: 220,
      headerFilter: false,
      formatter: nameCellHtml,
      variableHeight: true
    };
    const cols = {
      name: baseName,
      type: { title: "Type", field: "type", width: 70 },
      club: { title: "Club", field: "club", width: 70 },
      teamAbbr: { title: "Team", field: "teamAbbr", width: 70 },
      age: {
        title: "Age",
        field: "age",
        width: 52,
        hozAlign: "right",
        formatter: (c) => fmtInt(c.getValue())
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
        width: 72,
        hozAlign: "right",
        sorter: "number",
        formatter: (c) => fmtInt(c.getValue())
      },
      xValue: {
        title: "xValue",
        field: "value",
        width: 80,
        hozAlign: "right",
        sorter: "number",
        formatter: (c) => fmtInt(c.getValue())
      },
      xAvg: {
        title: "xAvg",
        field: "xAvg",
        width: 64,
        hozAlign: "right",
        formatter: (c) => fmt1(c.getValue())
      },
      xGames: {
        title: "xGames",
        field: "xGames",
        width: 72,
        hozAlign: "right",
        formatter: (c) => fmt1(c.getValue())
      },
      pListed: {
        title: "pListed",
        field: "pListed",
        width: 72,
        hozAlign: "right",
        formatter: (c) => fmtPct(c.getValue())
      },
      dxPoints: {
        title: "Δ xPts",
        field: "dxPoints",
        width: 80,
        hozAlign: "right",
        sorter: "number",
        formatter: (c) => fmt1(c.getValue())
      },
      driver: { title: "Driver", field: "driver", width: 90 },
      event: { title: "Event", field: "event", width: 120 },
      pDEF: {
        title: "pDEF",
        field: "pDEF",
        width: 64,
        hozAlign: "right",
        formatter: (c) => fmtPct(c.getValue())
      },
      pMID: {
        title: "pMID",
        field: "pMID",
        width: 64,
        hozAlign: "right",
        formatter: (c) => fmtPct(c.getValue())
      },
      pRUC: {
        title: "pRUC",
        field: "pRUC",
        width: 64,
        hozAlign: "right",
        formatter: (c) => fmtPct(c.getValue())
      },
      pFWD: {
        title: "pFWD",
        field: "pFWD",
        width: 64,
        hozAlign: "right",
        formatter: (c) => fmtPct(c.getValue())
      }
    };

    const views = {
      value: ["name", "age", "vorp", "xValue", "xAvg", "xGames", "pListed"],
      lists: ["name", "teamAbbr", "age", "contract"],
      scoring: ["name"],
      positions: ["name", "pDEF", "pMID", "pRUC", "pFWD"],
      movers: ["name", "vorp", "dxPoints", "driver", "event"]
    };

    let keys = views[view] || views.value;
    let out = keys.map((k) => cols[k]).filter(Boolean);

    if (view === "lists" || (byYear && view === "value")) {
      seasons.forEach((y, i) => {
        out.push({
          title: "pListed " + y,
          field: "pListed_Y" + (i + 1),
          width: 88,
          hozAlign: "right",
          sorter: "number",
          formatter: (c) => fmtPct(c.getValue())
        });
      });
    }
    if (view === "scoring" || (byYear && view === "scoring")) {
      seasons.forEach((y, i) => {
        out.push({
          title: "xAvg " + y,
          field: "xAvg_Y" + (i + 1),
          width: 80,
          hozAlign: "right",
          formatter: (c) => fmt1(c.getValue())
        });
        out.push({
          title: "xGames " + y,
          field: "xGames_Y" + (i + 1),
          width: 88,
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
          width: 80,
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
      out["xGames_Y" + (i + 1)] = cumAt(a.xGames, i);
      out["xPoints_Y" + (i + 1)] = numAt(a.xPoints, i);
    });
    return out;
  }

  function filterRows(rows, cfg) {
    return rows.filter((r) => {
      if (cfg.posFilter && cfg.posFilter !== "ALL") {
        const fp = r.fantasyPos || "";
        if (r.type === "pick") {
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

  /** Per-season xGames for detail: raw × pListed (not cumulative). */
  function xGamesListedAt(xgArr, plArr, i) {
    const xg = numAt(xgArr, i);
    const pl = numAt(plArr, i);
    if (xg == null || pl == null || !Number.isFinite(xg) || !Number.isFinite(pl)) {
      return null;
    }
    return xg * pl;
  }

  function detailHtml(row) {
    const a = row._asset;
    const seasons = state.seasons;
    const lines = ["<div class='futures-detail'>"];
    lines.push("<table><thead><tr><th></th>");
    seasons.forEach((y) => lines.push("<th>" + y + "</th>"));
    lines.push("</tr></thead><tbody>");
    [
      ["pListed", a.probListed, fmtPct, "raw"],
      ["xGames", a.xGames, fmt1, "xGamesListed"],
      ["xAvg", a.xAvg, fmt1, "raw"],
      ["xPoints", a.xPoints, fmt1, "raw"]
    ].forEach(([lab, arr, fmt, mode]) => {
      lines.push("<tr><td>" + lab + "</td>");
      seasons.forEach((_, i) => {
        let v;
        if (mode === "xGamesListed") {
          v = xGamesListedAt(arr, a.probListed, i);
        } else {
          v = numAt(arr, i);
        }
        lines.push("<td>" + fmt(v) + "</td>");
      });
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
            escapeHtml(m.name || m.id) +
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

  function bindTableRowClick(table) {
    table.on("rowClick", function (e, row) {
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

  /** Create or update the table. First paint must include data — replaceData
   *  before tableBuilt is silently dropped by Tabulator. */
  function ensureTable(columns, data) {
    const hold = document.getElementById("futures-table");
    if (!hold) return Promise.resolve(null);

    if (state.table) {
      state.table.setColumns(columns);
      return Promise.resolve(state.table.replaceData(data)).then(function () {
        return state.table;
      });
    }

    return new Promise(function (resolve) {
      const table = new Tabulator("#futures-table", {
        data: data || [],
        columns,
        layout: "fitData",
        height: "640px",
        rowHeight: 48,
        placeholder: "No assets match these filters",
        initialSort: [{ column: "vorp", dir: "desc" }],
        columnHeaderVertAlign: "bottom",
        columnDefaults: {
          resizable: false
        }
      });
      state.table = table;
      bindTableRowClick(table);
      table.on("tableBuilt", function () {
        resolve(table);
      });
    });
  }

  function refresh() {
    if (!state.data) return Promise.resolve();
    const cfg = state.cfg;
    writeCfgToUrl(cfg);
    const all = computeRows(state.data.assets, cfg, state.seasons);
    state.rows = all;
    const filtered = filterRows(all, cfg).map((r) => flattenRow(r, state.seasons));
    const columns = buildColumnDefs(state.seasons, cfg.view, cfg.byYear);
    return ensureTable(columns, filtered).then(function () {
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
    });
  }

  // ── Controls wiring ────────────────────────────────────────────────────────

  function applySettingsOpenState() {
    const details = document.getElementById("futures-settings");
    if (!details) return;
    details.open = !state.hadQueryOnLoad;
  }

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
    state.hadQueryOnLoad = window.location.search.length > 1;
    state.cfg = readCfgFromUrl();
    applySettingsOpenState();
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
      if (shell) {
        shell.style.display = "block";
        // Force layout before Tabulator measures the container
        void shell.offsetHeight;
      }
      await refresh();
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
