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
    /** Draw red cut after Keepers when true (pre-keeper / list-management mode). */
    keeperCut: null, // null → auto from upcoming draft picks in payload
    endSeason: null,
    view: "value",
    byYear: false,
    posFilter: "ALL",
    /** Empty = all clubs. Values are futures club abbrs (ADEL, GEEL, …). */
    clubs: [],
    /** When false, table shows only unowned / free-agent players. */
    includeOwned: true,
    /** Fantasy team name from Keeper CSV (highlight). */
    myTeam: "",
    search: ""
  };

  const CLUB_FILTER_ORDER = [
    "ADEL",
    "BL",
    "CARL",
    "COLL",
    "ESS",
    "FRE",
    "GEEL",
    "GCFC",
    "GWS",
    "HAW",
    "MELB",
    "NMFC",
    "PORT",
    "RICH",
    "STK",
    "SYD",
    "WCE",
    "WB"
  ];

  /** Keeper Fantasy CSV club codes → AFL / futures JSON abbreviations. */
  const KEEPER_TEAM_MAP = {
    ADE: "ADEL",
    BRL: "BL",
    CAR: "CARL",
    COL: "COLL",
    ESS: "ESS",
    FRE: "FRE",
    GCS: "GCFC",
    GEE: "GEEL",
    GWS: "GWS",
    HAW: "HAW",
    MEL: "MELB",
    NTH: "NMFC",
    PTA: "PORT",
    RIC: "RICH",
    STK: "STK",
    SYD: "SYD",
    WBD: "WB",
    WCE: "WCE"
  };

  /** Given-name aliases (already normalised) — subset of Keeper playerNameHelpers.R. */
  const GIVEN_ALIASES = [
    ["matt", "matthew"],
    ["matty", "matthew"],
    ["matty", "matt"],
    ["matt", "matty"],
    ["mat", "matthew"],
    ["mathew", "matthew"],
    ["josh", "joshua"],
    ["sam", "samuel"],
    ["sammy", "samuel"],
    ["tom", "thomas"],
    ["tommy", "thomas"],
    ["nick", "nicholas"],
    ["nic", "nicholas"],
    ["will", "william"],
    ["bill", "william"],
    ["billy", "william"],
    ["harry", "harrison"],
    ["harrison", "harry"],
    ["zac", "zachary"],
    ["zach", "zachary"],
    ["zack", "zachary"],
    ["zac", "zach"],
    ["alex", "alexander"],
    ["archie", "archer"],
    ["lachie", "lachlan"],
    ["lachlan", "lachie"],
    ["max", "maxwell"],
    ["ben", "benjamin"],
    ["brad", "bradley"],
    ["chris", "christopher"],
    ["dan", "daniel"],
    ["danny", "daniel"],
    ["dom", "dominic"],
    ["mitch", "mitchell"],
    ["mitchell", "mitch"],
    ["ollie", "oliver"],
    ["oliver", "ollie"],
    ["pat", "patrick"],
    ["paddy", "patrick"],
    ["tim", "timothy"],
    ["ed", "edward"],
    ["eddie", "edward"],
    ["cam", "cameron"],
    ["joe", "joseph"],
    ["jake", "jacob"],
    ["fin", "finlay"],
    ["finn", "finnegan"],
    ["charlie", "charles"],
    ["charles", "charlie"],
    ["jim", "james"],
    ["jimmy", "james"],
    ["jamie", "james"],
    ["rob", "robert"],
    ["robbie", "robert"],
    ["steve", "stephen"],
    ["steve", "steven"],
    ["tony", "anthony"],
    ["seb", "sebastian"],
    ["oskar", "oscar"],
    ["oscar", "oskar"],
    ["jordon", "jordan"]
  ];

  /** Stubborn full-name remaps (normalised on use). */
  const FULL_NAME_OVERRIDES = [
    ["bobby hill", "ian hill"],
    ["ian hill", "bobby hill"],
    ["charles cameron", "charlie cameron"],
    ["charlie cameron", "charles cameron"]
  ];

  function cloneCfg(base) {
    const src = base || DEFAULT_CFG;
    return {
      ...src,
      slots: { ...src.slots },
      clubs: Array.isArray(src.clubs) ? src.clubs.slice() : []
    };
  }

  let state = {
    cfg: cloneCfg(DEFAULT_CFG),
    data: null,
    seasons: [],
    rows: [],
    table: null,
    hadQueryOnLoad: false,
    /** @type {null | {source:string, fileName:string, ownership:Object.<string,string>, owners:string[], unmatchedOwned:Array, matchedOwned:number, totalOwned:number}} */
    league: null
  };

  // ── URL config ─────────────────────────────────────────────────────────────

  function readCfgFromUrl() {
    const q = new URLSearchParams(window.location.search);
    const cfg = cloneCfg(DEFAULT_CFG);
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
    if (q.has("cut")) {
      cfg.keeperCut = q.get("cut") === "1" || q.get("cut") === "true";
    }
    if (q.has("pos")) cfg.posFilter = q.get("pos") || "ALL";
    if (q.has("owned")) {
      cfg.includeOwned = !(q.get("owned") === "0" || q.get("owned") === "false");
    }
    if (q.has("clubs")) {
      cfg.clubs = String(q.get("clubs") || "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    }
    if (q.has("me")) cfg.myTeam = q.get("me") || "";
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
    if (cfg.keeperCut) q.set("cut", "1");
    else if (cfg.keeperCut === false) q.set("cut", "0");
    if (cfg.posFilter && cfg.posFilter !== "ALL") q.set("pos", cfg.posFilter);
    if (!cfg.includeOwned) q.set("owned", "0");
    if (cfg.clubs && cfg.clubs.length) q.set("clubs", cfg.clubs.join(","));
    if (cfg.myTeam) q.set("me", cfg.myTeam);
    if (cfg.search) q.set("q", cfg.search);
    const url = window.location.pathname + "?" + q.toString();
    window.history.replaceState({}, "", url);
  }

  /** True when model still has draft picks for the first horizon season (e.g. PICK_2027_01). */
  function hasUpcomingDraftPicks(data, seasons) {
    if (!data || !data.assets || !seasons || !seasons.length) return false;
    const y = Number(seasons[0]);
    if (!Number.isFinite(y)) return false;
    const prefix = "PICK_" + y + "_";
    return data.assets.some(
      (a) => a && (a.type === "pick" || String(a.id || "").indexOf("PICK_") === 0) &&
        String(a.id || "").indexOf(prefix) === 0
    );
  }

  function resolveKeeperCut(cfg, data, seasons) {
    if (cfg.keeperCut === true || cfg.keeperCut === false) return cfg.keeperCut;
    return hasUpcomingDraftPicks(data, seasons);
  }

  function clampInt(v, lo, hi, fallback) {
    const n = parseInt(v, 10);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(lo, Math.min(hi, n));
  }

  // ── Keeper Fantasy CSV import / name matching ───────────────────────────────

  function normName(x) {
    let s = String(x == null ? "" : x);
    s = s.replace(/\*/g, "");
    s = s.replace(/[\u2018\u2019\u201A\u201B\u2032\u0060\u00B4']/g, "");
    s = s.toLowerCase();
    // Strip combining marks after a light ASCII fold for common Latin accents
    try {
      s = s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    } catch (e) {
      /* older browsers */
    }
    s = s.replace(/\s+(jnr|jr|junior)\.?\s*$/i, "");
    s = s.replace(/[^a-z\- ]/g, " ");
    s = s.replace(/\s+/g, " ").trim();
    return s;
  }

  function nameParts(fullN) {
    const bits = String(fullN || "")
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    if (!bits.length) return { given: "", surname: "" };
    return { given: bits[0], surname: bits.slice(1).join(" ") };
  }

  /** Expand a normalised name with given-aliases, middle-initial drop, overrides. */
  function nameVariants(fullN) {
    const out = new Set();
    const base = normName(fullN);
    if (!base) return out;
    out.add(base);

    FULL_NAME_OVERRIDES.forEach(([a, b]) => {
      if (base === a) out.add(b);
      if (base === b) out.add(a);
    });

    const addGivenSwap = (n) => {
      const { given, surname } = nameParts(n);
      if (!surname) return;
      const givenFirst = given.replace(/(?:\s+[a-z])+$/g, "");
      if (givenFirst && givenFirst !== given) {
        out.add(givenFirst + " " + surname);
      }
      GIVEN_ALIASES.forEach(([alias, givenCanon]) => {
        if (given === alias || givenFirst === alias) {
          out.add(givenCanon + " " + surname);
        }
        if (given === givenCanon || givenFirst === givenCanon) {
          out.add(alias + " " + surname);
        }
      });
    };

    Array.from(out).forEach(addGivenSwap);
    // Second pass so alias↔alias chains (zac↔zach↔zachary) expand once more
    Array.from(out).forEach(addGivenSwap);
    return out;
  }

  function parseCsvText(text) {
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    const rows = [];
    let row = [];
    let cell = "";
    let i = 0;
    let inQuotes = false;
    while (i < text.length) {
      const c = text[i];
      if (inQuotes) {
        if (c === '"') {
          if (text[i + 1] === '"') {
            cell += '"';
            i += 2;
            continue;
          }
          inQuotes = false;
          i++;
          continue;
        }
        cell += c;
        i++;
        continue;
      }
      if (c === '"') {
        inQuotes = true;
        i++;
        continue;
      }
      if (c === ",") {
        row.push(cell);
        cell = "";
        i++;
        continue;
      }
      if (c === "\n" || c === "\r") {
        if (c === "\r" && text[i + 1] === "\n") i++;
        row.push(cell);
        cell = "";
        if (row.length > 1 || (row[0] && row[0].length)) rows.push(row);
        row = [];
        i++;
        continue;
      }
      cell += c;
      i++;
    }
    if (cell.length || row.length) {
      row.push(cell);
      rows.push(row);
    }
    return rows;
  }

  function csvRowsToObjects(matrix) {
    if (!matrix.length) return [];
    const headers = matrix[0].map((h) => String(h || "").trim());
    return matrix.slice(1).map((cells) => {
      const o = {};
      headers.forEach((h, idx) => {
        o[h] = cells[idx] != null ? String(cells[idx]).trim() : "";
      });
      return o;
    });
  }

  function mapKeeperClub(code) {
    const k = String(code || "")
      .trim()
      .toUpperCase();
    return KEEPER_TEAM_MAP[k] || k;
  }

  function buildPlayerIndex(assets) {
    const byClub = new Map(); // key "norm|club" → Map(id → asset)
    const byName = new Map();
    function add(map, key, asset) {
      if (!key) return;
      let m = map.get(key);
      if (!m) {
        m = new Map();
        map.set(key, m);
      }
      m.set(asset.id, asset);
    }
    (assets || []).forEach((a) => {
      if (!a || a.type === "pick") return;
      const club = a.club || "";
      nameVariants(a.name).forEach((v) => {
        add(byName, v, a);
        add(byClub, v + "|" + club, a);
      });
    });
    return { byClub, byName };
  }

  function uniqueHit(map, key) {
    const m = map.get(key);
    if (!m || m.size !== 1) return null;
    return m.values().next().value;
  }

  function matchKeeperPlayers(csvRows, assets) {
    const index = buildPlayerIndex(assets);
    const ownership = Object.create(null);
    const unmatchedOwned = [];
    const unmatchedAll = [];
    let matchedOwned = 0;
    let totalOwned = 0;
    const ownersSet = new Set();

    csvRows.forEach((r) => {
      const name = r.name || r.Player || r.player || "";
      const owner = r.owner || r.Owner || "";
      const team = r.team || r.Team || "";
      if (!name) return;
      const isFa = !owner || /^free\s*agent$/i.test(owner);
      if (!isFa) {
        totalOwned++;
        ownersSet.add(owner);
      }
      const club = mapKeeperClub(team);
      let hit = null;
      const variants = nameVariants(name);
      for (const v of variants) {
        hit = uniqueHit(index.byClub, v + "|" + club);
        if (hit) break;
      }
      if (!hit) {
        for (const v of variants) {
          hit = uniqueHit(index.byName, v);
          if (hit) break;
        }
      }
      if (hit) {
        if (!isFa) {
          ownership[hit.id] = owner;
          matchedOwned++;
        }
      } else {
        const miss = { name, team, owner: owner || "Free Agent", club };
        unmatchedAll.push(miss);
        if (!isFa) unmatchedOwned.push(miss);
      }
    });

    return {
      ownership,
      owners: Array.from(ownersSet).sort((a, b) => a.localeCompare(b)),
      unmatchedOwned,
      unmatchedAll,
      matchedOwned,
      totalOwned
    };
  }

  function applyLeagueOwnership(rows, league) {
    if (!league || !league.ownership) {
      rows.forEach((r) => {
        r.owner = null;
      });
      return rows;
    }
    rows.forEach((r) => {
      r.owner = league.ownership[r.id] || null;
    });
    return rows;
  }

  function setLeagueStatus(msg, isError) {
    const el = document.getElementById("keeper-import-status");
    if (!el) return;
    el.textContent = msg || "";
    el.classList.toggle("is-error", !!isError);
  }

  function syncMyTeamSelect(league, cfg) {
    const wrap = document.getElementById("my-team-wrap");
    const sel = document.getElementById("cfg-myTeam");
    if (!wrap || !sel) return;
    if (!league || !league.owners || !league.owners.length) {
      wrap.style.display = "none";
      sel.innerHTML = "";
      return;
    }
    wrap.style.display = "";
    const cur = cfg.myTeam && league.owners.indexOf(cfg.myTeam) >= 0 ? cfg.myTeam : "";
    if (cfg.myTeam && !cur) cfg.myTeam = "";
    sel.innerHTML =
      '<option value="">— Select —</option>' +
      league.owners
        .map(
          (o) =>
            '<option value="' +
            escapeHtml(o) +
            '"' +
            (o === cur ? " selected" : "") +
            ">" +
            escapeHtml(o) +
            "</option>"
        )
        .join("");
  }

  function clearKeeperLeague() {
    state.league = null;
    state.cfg.myTeam = "";
    const input = document.getElementById("keeper-csv-input");
    if (input) input.value = "";
    setLeagueStatus("");
    syncMyTeamSelect(null, state.cfg);
    refresh();
  }

  function handleKeeperCsvFile(file) {
    if (!file) return;
    if (!state.data || !state.data.assets) {
      setLeagueStatus("Player data still loading — try again in a moment.", true);
      return;
    }
    const reader = new FileReader();
    reader.onload = function () {
      try {
        const text = String(reader.result || "");
        const matrix = parseCsvText(text);
        const objects = csvRowsToObjects(matrix);
        if (!objects.length) throw new Error("CSV has no data rows");
        const cols = Object.keys(objects[0]);
        if (!cols.some((c) => /^name$/i.test(c)) || !cols.some((c) => /^owner$/i.test(c))) {
          throw new Error('Expected columns include "name" and "owner"');
        }
        const matched = matchKeeperPlayers(objects, state.data.assets);
        if (!matched.owners.length) {
          throw new Error("No fantasy teams found (every row was Free Agent?)");
        }
        state.league = {
          source: "keeper",
          fileName: file.name || "players.csv",
          ownership: matched.ownership,
          owners: matched.owners,
          unmatchedOwned: matched.unmatchedOwned,
          unmatchedAll: matched.unmatchedAll,
          matchedOwned: matched.matchedOwned,
          totalOwned: matched.totalOwned
        };
        // Align VORP depth with imported league size
        state.cfg.teams = Math.max(2, matched.owners.length);
        const teamsEl = document.getElementById("cfg-teams");
        if (teamsEl) teamsEl.value = String(state.cfg.teams);
        if (state.cfg.myTeam && matched.owners.indexOf(state.cfg.myTeam) < 0) {
          state.cfg.myTeam = "";
        }
        syncMyTeamSelect(state.league, state.cfg);

        const missN = matched.unmatchedOwned.length;
        setLeagueStatus(
          "Loaded " +
            matched.owners.length +
            " teams · matched " +
            matched.matchedOwned +
            "/" +
            matched.totalOwned +
            " rostered players" +
            (missN
              ? " · " + missN + " owned unmatched (often delisted / not in model)"
              : "")
        );
        refresh();
      } catch (e) {
        console.error(e);
        state.league = null;
        setLeagueStatus(
          "Could not import CSV — " + (e && e.message ? e.message : "unknown error"),
          true
        );
        refresh();
      }
    };
    reader.onerror = function () {
      setLeagueStatus("Failed to read file.", true);
    };
    reader.readAsText(file);
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
      lists: ["name", "age", "contract"],
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
    const clubSet =
      cfg.clubs && cfg.clubs.length ? new Set(cfg.clubs.map(String)) : null;
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
      if (!cfg.includeOwned && r.owner) return false;
      if (clubSet) {
        const club = r.teamAbbr || r.club || "";
        if (!club || !clubSet.has(club)) return false;
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

  function teamPlayerRowHtml(r, belowCut) {
    const abbr = r.teamAbbr || r.club || "";
    const teamChip = abbr
      ? '<span class="fd-team-chip fd-team-' +
        escapeHtml(abbr) +
        '">' +
        escapeHtml(abbr) +
        "</span>"
      : "";
    return (
      '<div class="lt-player' +
      (belowCut ? " lt-below-cut" : "") +
      '">' +
      headshotHtml(r) +
      '<div class="lt-player-meta">' +
      '<div class="lt-player-name" title="' +
      escapeHtml(r.name || "") +
      '">' +
      escapeHtml(r.name || "") +
      "</div>" +
      '<div class="lt-player-chips">' +
      teamChip +
      posChipsHtml(r.fantasyPos) +
      "</div>" +
      "</div>" +
      '<div class="lt-player-vorp">' +
      fmtInt(r.vorp) +
      "</div>" +
      "</div>"
    );
  }

  /** Map owner → medal place (1–3) for a numeric column. */
  function medalPlaces(teams, valueFn) {
    const ranked = teams
      .map((t) => ({ owner: t.owner, v: valueFn(t) }))
      .sort((a, b) => b.v - a.v || a.owner.localeCompare(b.owner));
    const out = Object.create(null);
    ranked.forEach((r, i) => {
      if (i < 3) out[r.owner] = i + 1;
    });
    return out;
  }

  function renderTeamRatings(rows, league, cfg) {
    const el = document.getElementById("team-ratings");
    if (!el) return;
    if (!league || !league.owners || !league.owners.length) {
      el.style.display = "none";
      el.innerHTML = "";
      return;
    }

    const cutOn = resolveKeeperCut(cfg, state.data, state.seasons);
    const cutN = Math.max(0, Number(cfg.keeperCount) || 0);
    const h = horizonLen(state.seasons, cfg.endSeason);
    const yearSeasons = state.seasons.slice(0, h);
    const myTeam = cfg.myTeam || "";

    const byOwner = Object.create(null);
    league.owners.forEach((o) => {
      byOwner[o] = {
        owner: o,
        vorp: 0,
        n: 0,
        players: [],
        counted: [],
        yearPts: yearSeasons.map(() => 0)
      };
    });
    rows.forEach((r) => {
      const o = r.owner;
      if (!o || !byOwner[o]) return;
      byOwner[o].players.push(r);
    });
    league.owners.forEach((o) => {
      const t = byOwner[o];
      t.players.sort(
        (a, b) => (b.vorp || 0) - (a.vorp || 0) || (a.name || "").localeCompare(b.name || "")
      );
      t.n = t.players.length;
      // Keeper cut on: ladder / year cols use top N by total VORP through current end
      t.counted = cutOn && cutN > 0 ? t.players.slice(0, cutN) : t.players.slice();
      t.vorp = t.counted.reduce((s, p) => s + (Number(p.vorp) || 0), 0);
      t.counted.forEach((p) => {
        const xp = p._asset && p._asset.xPoints;
        yearSeasons.forEach((_, i) => {
          t.yearPts[i] += Number(numAt(xp, i)) || 0;
        });
      });
    });

    const ranked = league.owners
      .map((o) => byOwner[o])
      .sort((a, b) => b.vorp - a.vorp || a.owner.localeCompare(b.owner));

    const medalsByYear = yearSeasons.map((_, i) =>
      medalPlaces(ranked, (t) => t.yearPts[i])
    );

    const ladderHead =
      "<tr><th class='lt-ladder-team'>Team</th>" +
      yearSeasons.map((y) => "<th>" + y + "</th>").join("") +
      "<th>VORP</th></tr>";

    const ladderBody = ranked
      .map((t, i) => {
        const mine = myTeam && t.owner === myTeam;
        const yearCells = yearSeasons
          .map((_, yi) => {
            const place = medalsByYear[yi][t.owner];
            return (
              "<td class='lt-num" +
              (place ? " medal-" + place : "") +
              "'>" +
              fmtInt(t.yearPts[yi]) +
              "</td>"
            );
          })
          .join("");
        return (
          "<tr class='" +
          (mine ? "lt-mine-row" : "") +
          "'>" +
          "<td class='lt-ladder-team'>" +
          '<span class="tr-rank">' +
          (i + 1) +
          "</span> " +
          escapeHtml(t.owner) +
          (mine ? ' <span class="lt-you">you</span>' : "") +
          "</td>" +
          yearCells +
          "<td class='lt-num lt-vorp-col'>" +
          fmtInt(t.vorp) +
          "</td>" +
          "</tr>"
        );
      })
      .join("");

    const boards = ranked
      .map((t, i) => {
        const mine = myTeam && t.owner === myTeam;
        const body = [];
        t.players.forEach((p, idx) => {
          if (cutOn && cutN > 0 && idx === cutN) {
            body.push(
              '<div class="lt-cut" role="separator" title="Keeper cut (top ' +
                cutN +
                ')">' +
                "<span>Keeper cut · " +
                cutN +
                "</span>" +
                "</div>"
            );
          }
          body.push(teamPlayerRowHtml(p, cutOn && cutN > 0 && idx >= cutN));
        });
        return (
          '<article class="lt-board' +
          (mine ? " lt-mine-board" : "") +
          '">' +
          '<header class="lt-board-head">' +
          '<div class="lt-board-title">' +
          '<span class="lt-board-rank">#' +
          (i + 1) +
          "</span> " +
          '<span class="lt-board-name" title="' +
          escapeHtml(t.owner) +
          '">' +
          escapeHtml(t.owner) +
          "</span>" +
          (mine ? ' <span class="lt-you">you</span>' : "") +
          "</div>" +
          '<div class="lt-board-stats">' +
          '<span class="lt-stat lt-stat-total">' +
          fmtInt(t.vorp) +
          " VORP</span>" +
          "</div>" +
          "</header>" +
          '<div class="lt-board-body">' +
          (body.join("") || '<p class="muted">No matched players</p>') +
          "</div>" +
          "</article>"
        );
      })
      .join("");

    const cutNote = cutOn
      ? " Year columns and VORP use each team's top " +
        cutN +
        " by total VORP through " +
        (cfg.endSeason || "end") +
        ". Red line on boards marks the keeper cut."
      : " Year columns sum xPoints; VORP is full-roster total under current settings.";

    el.style.display = "block";
    el.innerHTML =
      "<h3>Ladder</h3>" +
      "<p class='muted'>Gold / silver / bronze mark the top 3 in each column." +
      cutNote +
      "</p>" +
      "<div class='lt-ladder-wrap'><table class='lt-ladder'><thead>" +
      ladderHead +
      "</thead><tbody>" +
      ladderBody +
      "</tbody></table></div>" +
      "<h3 class='lt-boards-heading'>Teams</h3>" +
      "<p class='muted'>Players sorted by VORP.</p>" +
      "<div class='lt-boards'>" +
      boards +
      "</div>";
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
        },
        rowFormatter: function (row) {
          const d = row.getData();
          const el = row.getElement();
          const mine = state.cfg.myTeam && d.owner && d.owner === state.cfg.myTeam;
          el.classList.toggle("fd-my-team-row", !!mine);
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
    const all = applyLeagueOwnership(
      computeRows(state.data.assets, cfg, state.seasons),
      state.league
    );
    state.rows = all;
    const filtered = filterRows(all, cfg).map((r) => flattenRow(r, state.seasons));
    const columns = buildColumnDefs(state.seasons, cfg.view, cfg.byYear);
    return ensureTable(columns, filtered).then(function () {
      renderMoversPanel(all, cfg, state.data);
      renderTeamRatings(all, state.league, cfg);
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
    const cut = document.getElementById("cfg-keeperCut");
    if (cut) cut.checked = !!resolveKeeperCut(cfg, state.data, seasons);
    const owned = document.getElementById("cfg-includeOwned");
    if (owned) owned.checked = cfg.includeOwned !== false;
    setVal("cfg-search", cfg.search || "");
    document.querySelectorAll(".pos-filter-btn").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.pos === (cfg.posFilter || "ALL"));
    });
    syncClubDropdown(cfg);
    syncMyTeamSelect(state.league, cfg);
  }

  function updateClubDropdownLabel(cfg) {
    const btn = document.getElementById("club-dropdown-btn");
    if (!btn) return;
    const clubs = cfg.clubs || [];
    if (!clubs.length) btn.textContent = "All Clubs";
    else if (clubs.length <= 2) btn.textContent = clubs.join(", ");
    else btn.textContent = clubs.length + " Clubs";
  }

  function syncClubDropdown(cfg) {
    const panel = document.getElementById("club-dropdown-panel");
    if (!panel) return;
    const selected = new Set(cfg.clubs || []);
    panel.querySelectorAll(".club-checkbox").forEach((cb) => {
      cb.checked = selected.has(cb.value);
    });
    updateClubDropdownLabel(cfg);
  }

  function ensureClubDropdownBuilt() {
    const panel = document.getElementById("club-dropdown-panel");
    if (!panel || panel.dataset.built === "1") return;
    panel.innerHTML = CLUB_FILTER_ORDER.map(
      (c) =>
        '<label class="team-option">' +
        '<input type="checkbox" value="' +
        c +
        '" class="club-checkbox"/>' +
        escapeHtml(c) +
        "</label>"
    ).join("");
    panel.dataset.built = "1";
    panel.querySelectorAll(".club-checkbox").forEach((cb) => {
      cb.addEventListener("change", () => {
        const checked = Array.from(
          panel.querySelectorAll(".club-checkbox:checked")
        ).map((el) => el.value);
        state.cfg.clubs = checked;
        updateClubDropdownLabel(state.cfg);
        refresh();
      });
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
    const cut = document.getElementById("cfg-keeperCut");
    if (cut) cfg.keeperCut = cut.checked;
    const owned = document.getElementById("cfg-includeOwned");
    if (owned) cfg.includeOwned = owned.checked;
    const my = document.getElementById("cfg-myTeam");
    if (my) cfg.myTeam = my.value || "";
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
      "cfg-keeperCut",
      "cfg-includeOwned",
      "cfg-myTeam",
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

    ensureClubDropdownBuilt();
    const clubBtn = document.getElementById("club-dropdown-btn");
    if (clubBtn) {
      clubBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        const panel = document.getElementById("club-dropdown-panel");
        if (!panel) return;
        panel.style.display = panel.style.display === "none" ? "grid" : "none";
      });
    }
    document.addEventListener("click", (e) => {
      const dropdown = document.getElementById("club-dropdown");
      const panel = document.getElementById("club-dropdown-panel");
      if (dropdown && panel && !dropdown.contains(e.target)) {
        panel.style.display = "none";
      }
    });

    const keeperInput = document.getElementById("keeper-csv-input");
    if (keeperInput) {
      keeperInput.addEventListener("change", () => {
        const file = keeperInput.files && keeperInput.files[0];
        if (file) handleKeeperCsvFile(file);
      });
    }
    const keeperClear = document.getElementById("keeper-csv-clear");
    if (keeperClear) {
      keeperClear.addEventListener("click", () => clearKeeperLeague());
    }
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
