/**
 * AFL Fantasy draft futures
 */
(function (global) {
  "use strict";

  const POS_KEYS = ["DEF", "MID", "RUC", "FWD"];
  const STORAGE_URL =
    "https://firebasestorage.googleapis.com/v0/b/statsbyjaiden.firebasestorage.app/o/fantasy_draft_futures.json?alt=media";
  const HEADSHOT_BASE =
    "https://s.afl.com.au/staticfile/AFL%20Tenant/AFL/Players/ChampIDImages/AFL/2026014/";

  const OWNER_FA = "__FA__";

  const DEFAULT_CFG = {
    teams: 10,
    slots: { DEF: 5, MID: 7, RUC: 1, FWD: 5 },
    bench: 12,
    keeperCount: 20,
    keeperCut: null,
    endSeason: 2029,
    posFilter: "ALL",
    clubs: [],
    owners: [],
    myTeam: "",
    search: "",
    tab: "pool"
  };

  const FD_TABS = ["pool", "planner", "teams", "trades", "ladder", "import", "help"];

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
      clubs: Array.isArray(src.clubs) ? src.clubs.slice() : [],
      owners: Array.isArray(src.owners) ? src.owners.slice() : []
    };
  }

  let state = {
    cfg: cloneCfg(DEFAULT_CFG),
    data: null,
    seasons: [],
    rows: [],
    table: null,
    detailId: null,
    /** @type {null | {source:string, fileName:string, ownership:Object.<string,string>, positions:Object.<string,string>, owners:string[], unmatchedOwned:Array, matchedOwned:number, totalOwned:number}} */
    league: null,
    trade: {
      otherTeam: "",
      search: "",
      give: [],
      get: [],
      bound: false
    },
    /** @type {Object.<string,string>} */
    teamLabels: Object.create(null)
  };

  /** Tunable thresholds for team trajectory labels (see teamRatingSpec.txt). */
  const TRAJECTORY_CFG = {
    sustainedEliteAvg: 0.6,
    sustainedEliteMin: 0.5,
    cliffEarly: 0.6,
    cliffSlope: -0.5,
    risingEliteSlope: 0.3,
    risingEliteLate: 0.75,
    risingSlope: 0.3,
    bottomAvg: 0.3,
    bottomMax: 0.55,
    fadingSlope: -0.25,
    peakMid: 0.2,
    volatileVol: 0.25,
    hiddenDepthGap: 0.3,
    paperTigerGap: -0.3,
    upperMidAvg: 0.5,
    spillover: ["II", "Jr"],
    /** Fixed labels; only TREADMILL has two for uniqueness within that bucket. */
    pools: {
      SUSTAINED_ELITE: ["Evergreen"],
      CLIFF: ["Cliff Diver"],
      RISING_ELITE: ["Slow Burn"],
      RISING: ["Up and Comer"],
      BOTTOM: ["Cellar Dweller"],
      FADING: ["Window Closing"],
      PEAK_WINDOW: ["Peak Window"],
      VOLATILE: ["Rollercoaster"],
      HIDDEN_DEPTH: ["Sneaky Chance"],
      PAPER_TIGER: ["House of Cards"],
      UPPER_MID: ["Quiet Contender"],
      TREADMILL: ["Treadmill", "Middle Child"]
    }
  };

  (function assertTrajectoryPools() {
    Object.keys(TRAJECTORY_CFG.pools).forEach((k) => {
      TRAJECTORY_CFG.pools[k].forEach((lab) => {
        if (String(lab).length > 16) {
          throw new Error("Trajectory label too long: " + lab);
        }
      });
    });
  })();

  // URL setup

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
    if (q.has("cut")) {
      cfg.keeperCut = q.get("cut") === "1" || q.get("cut") === "true";
    }
    if (q.has("pos")) cfg.posFilter = q.get("pos") || "ALL";
    if (q.has("clubs")) {
      cfg.clubs = String(q.get("clubs") || "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    }
    if (q.has("owners")) {
      cfg.owners = String(q.get("owners") || "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
        .map((s) => (s === "FA" || s === OWNER_FA ? OWNER_FA : s));
    } else if (q.get("owned") === "0" || q.get("owned") === "false") {
      cfg.owners = [OWNER_FA];
    }
    if (q.has("me")) cfg.myTeam = q.get("me") || "";
    if (q.has("q")) cfg.search = q.get("q") || "";
    if (q.has("tab")) {
      let tab = q.get("tab");
      if (tab === "movers") tab = "pool";
      if (tab === "league") tab = "ladder";
      if (FD_TABS.indexOf(tab) >= 0) cfg.tab = tab;
    }
    return cfg;
  }

  function writeCfgToUrl(cfg) {
    const q = new URLSearchParams();
    q.set("teams", String(cfg.teams));
    q.set("bench", String(cfg.bench));
    q.set("keepers", String(cfg.keeperCount));
    POS_KEYS.forEach((k) => q.set(k.toLowerCase(), String(cfg.slots[k])));
    if (cfg.endSeason) q.set("end", String(cfg.endSeason));
    if (cfg.keeperCut) q.set("cut", "1");
    else if (cfg.keeperCut === false) q.set("cut", "0");
    if (cfg.posFilter && cfg.posFilter !== "ALL") q.set("pos", cfg.posFilter);
    if (cfg.clubs && cfg.clubs.length) q.set("clubs", cfg.clubs.join(","));
    if (cfg.owners && cfg.owners.length) {
      q.set(
        "owners",
        cfg.owners.map((o) => (o === OWNER_FA ? "FA" : o)).join(",")
      );
    }
    if (cfg.myTeam) q.set("me", cfg.myTeam);
    if (cfg.search) q.set("q", cfg.search);
    if (cfg.tab && cfg.tab !== "pool") q.set("tab", cfg.tab);
    const url = window.location.pathname + "?" + q.toString();
    window.history.replaceState({}, "", url);
  }

  function setActiveTab(tab) {
    const next = FD_TABS.indexOf(tab) >= 0 ? tab : "pool";
    state.cfg.tab = next;
    document.querySelectorAll(".fd-tab-btn").forEach((btn) => {
      btn.classList.toggle("active", btn.getAttribute("data-tab") === next);
    });
    document.querySelectorAll(".fd-tab-panel").forEach((panel) => {
      const on = panel.id === "fd-tab-" + next;
      panel.classList.toggle("is-active", on);
      panel.hidden = !on;
    });
    writeCfgToUrl(state.cfg);
    if (next === "pool" && state.table) {
      try {
        state.table.redraw(true);
      } catch (e) {
        /* ignore */
      }
    }
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

  // Match names to keeper fantasy import

  function normName(x) {
    let s = String(x == null ? "" : x);
    s = s.replace(/\*/g, "");
    s = s.replace(/[\u2018\u2019\u201A\u201B\u2032\u0060\u00B4']/g, "");
    s = s.toLowerCase();
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
    // Second pass for secondary alias zac to zach to zachary merrett
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
    const byClub = new Map();
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

  /** Normalize Keeper CSV position labels for chip display (e.g. D/M → DEF/MID). */
  function normalizeKeeperPos(raw) {
    const parts = String(raw || "")
      .split(/[/,+|]+/)
      .map((p) => p.trim())
      .filter(Boolean)
      .map((p) => {
        const u = p.toUpperCase();
        if (u === "D" || u === "DEF") return "DEF";
        if (u === "M" || u === "MID") return "MID";
        if (u === "R" || u === "RUC" || u === "RUCK") return "RUC";
        if (u === "F" || u === "FWD" || u === "FORWARD") return "FWD";
        return u;
      })
      .filter((p) => POS_KEYS.indexOf(p) >= 0);
    return parts.length ? Array.from(new Set(parts)).join("/") : "";
  }

  function matchKeeperPlayers(csvRows, assets) {
    const index = buildPlayerIndex(assets);
    const ownership = Object.create(null);
    const positions = Object.create(null);
    const unmatchedOwned = [];
    const unmatchedAll = [];
    let matchedOwned = 0;
    let totalOwned = 0;
    const ownersSet = new Set();

    csvRows.forEach((r) => {
      const name = r.name || r.Player || r.player || "";
      const owner = r.owner || r.Owner || "";
      const team = r.team || r.Team || "";
      const posRaw = r.position || r.Position || r.pos || "";
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
        const posNorm = normalizeKeeperPos(posRaw);
        if (posNorm) positions[hit.id] = posNorm;
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
      positions,
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
        r.keeperPos = null;
      });
      return rows;
    }
    rows.forEach((r) => {
      r.owner = league.ownership[r.id] || null;
      r.keeperPos =
        (league.positions && league.positions[r.id]) || null;
    });
    return rows;
  }

  /** Display position: Keeper CSV when imported, else fantasy position. */
  function displayPos(row) {
    return (row && (row.keeperPos || row.fantasyPos)) || "";
  }

  function setLeagueStatus(msg, isError) {
    const el = document.getElementById("keeper-import-status");
    if (!el) return;
    el.textContent = msg || "";
    el.classList.toggle("is-error", !!isError);
  }

  function syncOwnerDropdownVisibility(league) {
    const wrap = document.getElementById("owner-dropdown");
    if (!wrap) return;
    const hasLeague = !!(league && league.owners && league.owners.length);
    wrap.classList.toggle("is-visible", hasLeague);
    if (!hasLeague) {
      state.cfg.owners = [];
      updateOwnerDropdownLabel(state.cfg);
    }
  }

  function syncMyTeamSelect(league, cfg) {
    const wrap = document.getElementById("my-team-wrap");
    const sel = document.getElementById("cfg-myTeam");
    syncOwnerDropdownVisibility(league);
    rebuildOwnerDropdown(league, cfg);
    if (!wrap || !sel) return;
    const hasLeague = !!(league && league.owners && league.owners.length);
    wrap.classList.toggle("is-visible", hasLeague);
    if (!hasLeague) {
      sel.innerHTML = "";
      return;
    }
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
    state.cfg.owners = [];
    state.trade.otherTeam = "";
    state.trade.search = "";
    state.trade.give = [];
    state.trade.get = [];
    state.teamLabels = Object.create(null);
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
          positions: matched.positions,
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

  /** Map model delta.driver → display reason (Contract / Scoring / Games). */
  function driverLabel(driver) {
    const d = String(driver || "").toLowerCase();
    if (d === "problisted" || d === "contract") return "Contract";
    if (d === "xavg" || d === "scoring") return "Scoring";
    if (d === "xgames" || d === "games") return "Games";
    return driver ? String(driver) : "";
  }

  function signedInt(v) {
    if (v == null || !Number.isFinite(Number(v))) return "—";
    const n = Math.round(Number(v));
    return (n > 0 ? "+" : "") + String(n);
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
      posChipsHtml(displayPos(row)) +
      "</div>" +
      "</div>" +
      "</div>"
    );
  }

  // ── Columns ────────────────────────────────────────────────────────────────

  const POS_BAR_SHORT = { DEF: "D", MID: "M", RUC: "R", FWD: "F" };

  function posShareBarHtml(row) {
    const parts = POS_KEYS.map((p) => ({
      p,
      v: Math.max(0, Number(row["p" + p]) || 0)
    }));
    const sum = parts.reduce((s, x) => s + x.v, 0);
    if (sum <= 0) {
      return '<div class="fd-pos-bar" title="No position share"></div>';
    }
    const tip = parts
      .map((x) => x.p + " " + Math.round((100 * x.v) / sum) + "%")
      .join(" · ");
    return (
      '<div class="fd-pos-bar" title="' +
      escapeHtml(tip) +
      '">' +
      parts
        .map((x) => {
          const pct = (100 * x.v) / sum;
          if (pct < 0.5) return "";
          const label = pct >= 22 ? POS_BAR_SHORT[x.p] : "";
          return (
            '<div class="fd-pos-bar-seg fd-pos-' +
            x.p +
            '" style="width:' +
            pct.toFixed(2) +
            '%">' +
            escapeHtml(label) +
            "</div>"
          );
        })
        .join("") +
      "</div>"
    );
  }

  function buildColumnDefs() {
    return [
      {
        title: "Player",
        field: "name",
        frozen: true,
        width: 220,
        minWidth: 220,
        maxWidth: 220,
        headerFilter: false,
        formatter: nameCellHtml
      },
      {
        title: "Age",
        field: "age",
        width: 52,
        hozAlign: "right",
        formatter: (c) => fmtInt(c.getValue())
      },
      {
        title: "VORP",
        field: "vorp",
        width: 72,
        hozAlign: "right",
        sorter: "number",
        formatter: (c) => fmtInt(c.getValue())
      },
      {
        title: "xValue",
        field: "value",
        width: 80,
        hozAlign: "right",
        sorter: "number",
        formatter: (c) => fmtInt(c.getValue())
      },
      {
        title: "xAvg",
        field: "xAvg",
        width: 64,
        hozAlign: "right",
        formatter: (c) => fmt1(c.getValue())
      },
      {
        title: "xGames",
        field: "xGames",
        width: 72,
        hozAlign: "right",
        formatter: (c) => fmt1(c.getValue())
      },
      {
        title: "pListed",
        field: "pListed",
        width: 72,
        hozAlign: "right",
        formatter: (c) => fmtPct(c.getValue())
      },
      {
        title: "Contract",
        field: "contract",
        width: 80,
        hozAlign: "right",
        formatter: (c) => fmtInt(c.getValue())
      },
      {
        title: "Pos",
        field: "pDEF",
        width: 72,
        minWidth: 64,
        maxWidth: 80,
        headerSort: false,
        formatter: (c) => posShareBarHtml(c.getRow().getData())
      }
    ];
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
    const ownerSet =
      cfg.owners && cfg.owners.length ? new Set(cfg.owners) : null;
    return rows.filter((r) => {
      if (cfg.posFilter && cfg.posFilter !== "ALL") {
        const fp = displayPos(r) || r.fantasyPos || "";
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
      if (ownerSet) {
        if (r.owner) {
          if (!ownerSet.has(r.owner)) return false;
        } else if (!ownerSet.has(OWNER_FA)) {
          return false;
        }
      }
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
    const lines = [
      "<div class='futures-detail'>"
    ];
    lines.push("<table><thead><tr><th></th>");
    seasons.forEach((y) => lines.push("<th>" + y + "</th>"));
    lines.push("</tr></thead><tbody>");
    [
      ["pListed", a.probListed, fmtPct, "raw"],
      ["xGames", a.xGames, fmt1, "xGamesListed"],
      ["xAvg", a.xAvg, fmt1, "raw"],
      ["xValue", a.xPoints, fmt1, "raw"]
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
    lines.push("</tbody></table></div>");
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
      posChipsHtml(displayPos(r)) +
      "</div>" +
      "</div>" +
      '<div class="lt-player-vorp">' +
      fmtInt(r.vorp) +
      "</div>" +
      "</div>"
    );
  }

  /** Movers sidebar row — same layout as Teams, with reason + rounded Δ xPts. */
  function moverPlayerRowHtml(r, rising) {
    const abbr = r.teamAbbr || r.club || "";
    const teamChip = abbr
      ? '<span class="fd-team-chip fd-team-' +
        escapeHtml(abbr) +
        '">' +
        escapeHtml(abbr) +
        "</span>"
      : "";
    const reason = driverLabel(r.driver);
    const dxCls = rising ? "up" : "down";
    return (
      '<div class="lt-player">' +
      headshotHtml(r) +
      '<div class="lt-player-meta">' +
      '<div class="lt-player-name" title="' +
      escapeHtml(r.name || "") +
      '">' +
      escapeHtml(r.name || "") +
      "</div>" +
      '<div class="lt-player-chips">' +
      teamChip +
      posChipsHtml(displayPos(r)) +
      (reason
        ? '<span class="lt-player-reason">' + escapeHtml(reason) + "</span>"
        : "") +
      "</div>" +
      "</div>" +
      '<div class="lt-player-dx ' +
      dxCls +
      '">' +
      signedInt(r.dxPoints) +
      "</div>" +
      "</div>"
    );
  }

  // ── Trade calculator ───────────────────────────────────────────────────────

  function yearPointsForRow(row, yearCount) {
    const xp = row && row._asset && row._asset.xPoints;
    const out = [];
    for (let i = 0; i < yearCount; i++) out.push(Number(numAt(xp, i)) || 0);
    return out;
  }

  // ── Keeper cut: VORP order + year-1 pos probs + quotas ─────────────────────

  /** Fantasy eligibility labels (chips) — fallback only when year-1 pos missing. */
  function playerFantasyPosKeys(row) {
    return String(row.fantasyPos || "")
      .split("/")
      .map((p) => p.trim())
      .filter((p) => POS_KEYS.indexOf(p) >= 0);
  }

  /**
   * Positional probabilities for a horizon year index.
   * Falls back to fantasyPos one-hot when pos[] is missing.
   */
  function seasonPosProbs(row, yearIdx) {
    const out = { DEF: 0, MID: 0, RUC: 0, FWD: 0 };
    const a = row && row._asset;
    const yi = Math.max(0, Number(yearIdx) || 0);
    let any = false;
    POS_KEYS.forEach((p) => {
      const arr = a && a.pos && a.pos[p];
      const v = arr && arr.length > yi ? Number(arr[yi]) : NaN;
      if (Number.isFinite(v) && v > 0) {
        out[p] = v;
        any = true;
      }
    });
    if (any) return out;
    playerFantasyPosKeys(row).forEach((p) => {
      out[p] = 1;
    });
    return out;
  }

  /**
   * Season-1 positional probabilities from JSON (index 0 = first horizon year,
   * currently 2027). Falls back to fantasyPos one-hot when pos[] is missing.
   */
  function year1PosProbs(row) {
    return seasonPosProbs(row, 0);
  }

  function seasonXPoints(row, yearIdx) {
    const xp = row && row._asset && row._asset.xPoints;
    return Number(numAt(xp, yearIdx)) || 0;
  }

  /** Min year-1 share to claim a positional keeper slot. */
  const KEEPER_POS_MIN_P = 0.05;
  /** Min season pos share to claim an on-field planner slot. */
  const LINEUP_POS_MIN_P = 0.05;
  /** Min season xGamesPOS to claim a planner slot when pos share is thin. */
  const LINEUP_XGAMES_MIN = 5;

  /** True if the player can legally fill `pos` in that horizon year. */
  function canPlaySeasonPos(row, pos, yearIdx) {
    const probs = seasonPosProbs(row, yearIdx);
    if ((probs[pos] || 0) >= LINEUP_POS_MIN_P) return true;
    const a = row && row._asset;
    const xg = numAt(a && a["xGames" + pos], yearIdx);
    return Number.isFinite(xg) && xg >= LINEUP_XGAMES_MIN;
  }

  /**
   * Soft positional targets from on-field formation only (bench is flex).
   * Sum of targets ≤ min(K, on-field slots) so leftover keeper slots stay
   * pure VORP — avoids forcing negative-VORP positional fillers.
   */
  function allocateKeeperTargets(cfg) {
    const K = Math.max(0, Number(cfg.keeperCount) || 0);
    const targets = { DEF: 0, MID: 0, RUC: 0, FWD: 0 };
    if (K <= 0) return targets;
    const depth = {};
    let onField = 0;
    POS_KEYS.forEach((p) => {
      depth[p] = cfg.slots[p] || 0;
      onField += depth[p];
    });
    if (onField <= 0) return targets;
    // Only reserve on-field shape; remaining keepers are VORP flex
    const quotaN = Math.min(K, onField);
    let assigned = 0;
    const exact = POS_KEYS.map((p) => ({
      p,
      v: (quotaN * depth[p]) / onField,
      depth: depth[p]
    }));
    exact.forEach((e) => {
      targets[e.p] = Math.floor(e.v);
      assigned += targets[e.p];
    });
    let rem = quotaN - assigned;
    exact
      .slice()
      .sort(
        (a, b) =>
          b.v - Math.floor(b.v) - (a.v - Math.floor(a.v)) || b.depth - a.depth
      )
      .forEach((e) => {
        if (rem > 0) {
          targets[e.p] += 1;
          rem -= 1;
        }
      });
    return targets;
  }

  /**
   * Select keepers:
   *  1) Fill soft on-field quotas with VORP > 0 players (year-1 pos probs)
   *  2) Backfill remaining slots by pure VORP (ignores position)
   * Negative VORP never takes a positional slot — FAs are better by definition.
   */
  function selectKeepersByVorpQuotas(players, cfg) {
    const K = Math.max(0, Number(cfg.keeperCount) || 0);
    if (!players || !players.length || K <= 0) return [];
    if (players.length <= K) return players.slice();

    const targets = allocateKeeperTargets(cfg);
    const remaining = {
      DEF: targets.DEF,
      MID: targets.MID,
      RUC: targets.RUC,
      FWD: targets.FWD
    };

    const ranked = players.slice().sort(
      (a, b) =>
        (b.vorp || 0) - (a.vorp || 0) ||
        (a.name || "").localeCompare(b.name || "") ||
        String(a.id).localeCompare(String(b.id))
    );

    const kept = [];
    const keptIds = new Set();

    function tryAssignPositive(p) {
      if (!(Number(p.vorp) > 0)) return false;
      const y1 = year1PosProbs(p);
      const open = POS_KEYS.filter(
        (pos) => remaining[pos] > 0 && (y1[pos] || 0) >= KEEPER_POS_MIN_P
      ).sort(
        (a, b) =>
          (y1[b] || 0) - (y1[a] || 0) ||
          remaining[b] - remaining[a] ||
          a.localeCompare(b)
      );
      if (!open.length) return false;
      remaining[open[0]] -= 1;
      return true;
    }

    // Phase 1 — positional shape from positive-VORP players only
    ranked.forEach((p) => {
      if (kept.length >= K) return;
      if (tryAssignPositive(p)) {
        kept.push(p);
        keptIds.add(p.id);
      }
    });

    // Phase 2 — flex: best remaining VORP (Young over ANB)
    if (kept.length < K) {
      ranked.forEach((p) => {
        if (kept.length >= K || keptIds.has(p.id)) return;
        kept.push(p);
        keptIds.add(p.id);
      });
    }

    return kept;
  }

  function splitRosterByKeepers(players, cfg, owner, cutOn) {
    const sorted = (players || []).slice().sort(
      (a, b) => (b.vorp || 0) - (a.vorp || 0) || (a.name || "").localeCompare(b.name || "")
    );
    const cutN = Math.max(0, Number(cfg.keeperCount) || 0);
    if (!cutOn || cutN <= 0) {
      return { kept: sorted.slice(), cut: [], keptSet: new Set(sorted.map((p) => p.id)) };
    }
    const kept = selectKeepersByVorpQuotas(sorted, cfg);
    const keptSet = new Set(kept.map((p) => p.id));
    const keptSorted = kept
      .slice()
      .sort(
        (a, b) => (b.vorp || 0) - (a.vorp || 0) || (a.name || "").localeCompare(b.name || "")
      );
    const cut = sorted.filter((p) => !keptSet.has(p.id));
    return { kept: keptSorted, cut, keptSet };
  }

  /** Players not kept after cuts: free agents + rostered players outside keeper set. */
  function unownedAfterCuts(rows, league, cfg) {
    const cutOn = resolveKeeperCut(cfg, state.data, state.seasons);
    const kept = new Set();
    if (league && league.owners) {
      if (cutOn) {
        league.owners.forEach((owner) => {
          const roster = rows.filter((r) => r.owner === owner);
          selectKeepersByVorpQuotas(roster, cfg).forEach((r) => kept.add(r.id));
        });
      } else {
        rows.forEach((r) => {
          if (r.owner) kept.add(r.id);
        });
      }
    }
    return rows
      .filter((r) => r.type !== "pick" && r.id && String(r.id).indexOf("CD_I") === 0)
      .filter((r) => !kept.has(r.id))
      .slice()
      .sort(
        (a, b) =>
          (b.vorp || 0) - (a.vorp || 0) || (a.name || "").localeCompare(b.name || "")
      );
  }

  /** Full roster = on-field slots + bench. Draft picks/team = roster − keepers. */
  function rosterSize(cfg) {
    const slots = cfg.slots || {};
    return (
      POS_KEYS.reduce((s, k) => s + (Number(slots[k]) || 0), 0) +
      (Number(cfg.bench) || 0)
    );
  }

  function keeperDraftPicksPerTeam(cfg) {
    return Math.max(0, rosterSize(cfg) - (Number(cfg.keeperCount) || 0));
  }

  /** Per-team kept roster + year xPoints / VORP. Year columns always use all seasons. */
  function buildTeamStandings(rows, league, cfg) {
    const cutOn = resolveKeeperCut(cfg, state.data, state.seasons);
    const yearSeasons = state.seasons.slice();
    const yLen = yearSeasons.length;
    return (league.owners || []).map((owner) => {
      const players = rows.filter((r) => r.owner === owner);
      const split = splitRosterByKeepers(players, cfg, owner, cutOn);
      const counted = split.kept;
      const yearPts = yearSeasons.map(() => 0);
      counted.forEach((p) => {
        const yp = yearPointsForRow(p, yLen);
        yp.forEach((v, i) => {
          yearPts[i] += v;
        });
      });
      const vorp = counted.reduce((s, p) => s + (Number(p.vorp) || 0), 0);
      return { owner, players: split.kept.concat(split.cut), counted, yearPts, vorp, split };
    });
  }

  function meanNums(arr) {
    if (!arr || !arr.length) return 0;
    let s = 0;
    for (let i = 0; i < arr.length; i++) s += arr[i];
    return s / arr.length;
  }

  function popStd(arr) {
    if (!arr || !arr.length) return 0;
    const m = meanNums(arr);
    let s = 0;
    for (let i = 0; i < arr.length; i++) {
      const d = arr[i] - m;
      s += d * d;
    }
    return Math.sqrt(s / arr.length);
  }

  /** Average ranks for ties; higher value → better (rank 1). */
  function rankDescending(items, valueFn, nameFn) {
    const sorted = items.slice().sort(
      (a, b) =>
        valueFn(b) - valueFn(a) || String(nameFn(a)).localeCompare(String(nameFn(b)))
    );
    const ranks = Object.create(null);
    let i = 0;
    while (i < sorted.length) {
      let j = i;
      const v = valueFn(sorted[i]);
      while (j < sorted.length && valueFn(sorted[j]) === v) j++;
      const avgRank = (i + 1 + j) / 2;
      for (let k = i; k < j; k++) ranks[nameFn(sorted[k])] = avgRank;
      i = j;
    }
    return ranks;
  }

  function strengthFromRank(rank, n) {
    if (n <= 1) return 1;
    return 1 - (rank - 1) / (n - 1);
  }

  function trajectoryCategory(feat, cfg) {
    const c = cfg || TRAJECTORY_CFG;
    if (feat.avg >= c.sustainedEliteAvg && feat.min_s >= c.sustainedEliteMin) {
      return { id: "SUSTAINED_ELITE", pool: c.pools.SUSTAINED_ELITE };
    }
    if (feat.early >= c.cliffEarly && feat.slope <= c.cliffSlope) {
      return { id: "CLIFF", pool: c.pools.CLIFF };
    }
    if (feat.slope >= c.risingEliteSlope && feat.late >= c.risingEliteLate) {
      return { id: "RISING_ELITE", pool: c.pools.RISING_ELITE };
    }
    if (feat.slope >= c.risingSlope) {
      return { id: "RISING", pool: c.pools.RISING };
    }
    if (feat.avg <= c.bottomAvg && feat.max_s <= c.bottomMax) {
      return { id: "BOTTOM", pool: c.pools.BOTTOM };
    }
    if (feat.slope <= c.fadingSlope) {
      return { id: "FADING", pool: c.pools.FADING };
    }
    if (feat.peak_mid >= c.peakMid) {
      return { id: "PEAK_WINDOW", pool: c.pools.PEAK_WINDOW };
    }
    if (feat.vol >= c.volatileVol) {
      return { id: "VOLATILE", pool: c.pools.VOLATILE };
    }
    if (feat.vorp_gap >= c.hiddenDepthGap) {
      return { id: "HIDDEN_DEPTH", pool: c.pools.HIDDEN_DEPTH };
    }
    if (feat.vorp_gap <= c.paperTigerGap) {
      return { id: "PAPER_TIGER", pool: c.pools.PAPER_TIGER };
    }
    if (feat.avg >= c.upperMidAvg) {
      return { id: "UPPER_MID", pool: c.pools.UPPER_MID };
    }
    return { id: "TREADMILL", pool: c.pools.TREADMILL };
  }

  function trajectorySortKey(categoryId, feat) {
    if (
      categoryId === "SUSTAINED_ELITE" ||
      categoryId === "UPPER_MID" ||
      categoryId === "TREADMILL" ||
      categoryId === "HIDDEN_DEPTH"
    ) {
      return feat.avg;
    }
    if (categoryId === "RISING" || categoryId === "RISING_ELITE") return feat.late;
    if (categoryId === "CLIFF" || categoryId === "FADING") return feat.early;
    if (categoryId === "BOTTOM") return -feat.avg;
    return feat.avg;
  }

  /**
   * Assign 1–2 word trajectory labels from rank-derived features only.
   * @returns {Object.<string,{label:string,category:string,features:Object}>}
   */
  function assignTeamTrajectoryLabels(standings) {
    const teams = (standings || []).slice();
    const n = teams.length;
    const out = Object.create(null);
    if (n < 4) {
      teams.forEach((t) => {
        out[t.owner] = {
          label: "Rollercoaster",
          category: "VOLATILE",
          features: null
        };
      });
      return out;
    }

    const yLen = Math.max.apply(
      null,
      teams.map((t) => (t.yearPts && t.yearPts.length) || 0).concat([0])
    );
    const yearRanks = [];
    for (let y = 0; y < yLen; y++) {
      yearRanks.push(
        rankDescending(
          teams,
          (t) => (t.yearPts && t.yearPts[y]) || 0,
          (t) => t.owner
        )
      );
    }
    const vorpRanks = rankDescending(
      teams,
      (t) => Number(t.vorp) || 0,
      (t) => t.owner
    );

    const classified = teams.map((t) => {
      const s = [];
      for (let y = 0; y < yLen; y++) {
        s.push(strengthFromRank(yearRanks[y][t.owner], n));
      }
      while (s.length < 5) s.push(s.length ? s[s.length - 1] : 0.5);
      const vorp_s = strengthFromRank(vorpRanks[t.owner], n);
      const early = meanNums([s[0], s[1]]);
      const mid = s[2];
      const late = meanNums([s[3], s[4]]);
      const avg = meanNums(s.slice(0, 5));
      const min_s = Math.min.apply(null, s.slice(0, 5));
      const max_s = Math.max.apply(null, s.slice(0, 5));
      const slope = late - early;
      const vol = popStd(s.slice(0, 5));
      const vorp_gap = vorp_s - avg;
      const peak_mid = mid - Math.max(early, late);
      const features = {
        early,
        mid,
        late,
        avg,
        min_s,
        max_s,
        slope,
        vol,
        vorp_gap,
        peak_mid,
        vorp_s
      };
      const cat = trajectoryCategory(features, TRAJECTORY_CFG);
      return {
        owner: t.owner,
        category: cat.id,
        pool: cat.pool.slice(),
        features,
        sortKey: trajectorySortKey(cat.id, features)
      };
    });

    const byCat = Object.create(null);
    classified.forEach((c) => {
      if (!byCat[c.category]) byCat[c.category] = [];
      byCat[c.category].push(c);
    });

    Object.keys(byCat).forEach((catId) => {
      const group = byCat[catId].sort(
        (a, b) =>
          b.sortKey - a.sortKey || String(a.owner).localeCompare(String(b.owner))
      );
      // Single-label categories share the same tag. TREADMILL (2 labels) gets unique assignment.
      const unique = group[0] && group[0].pool.length > 1;
      const used = new Set();
      group.forEach((c) => {
        let label = c.pool[0] || "Treadmill";
        if (unique) {
          label = null;
          for (let i = 0; i < c.pool.length; i++) {
            if (!used.has(c.pool[i])) {
              label = c.pool[i];
              break;
            }
          }
          if (!label) {
            const base = c.pool[c.pool.length - 1] || "Treadmill";
            for (let i = 0; i < TRAJECTORY_CFG.spillover.length; i++) {
              const cand = (base + " " + TRAJECTORY_CFG.spillover[i]).slice(0, 16);
              if (!used.has(cand)) {
                label = cand;
                break;
              }
            }
            if (!label) label = base;
          }
          used.add(label);
        }
        out[c.owner] = {
          label,
          category: c.category,
          features: c.features
        };
      });
    });
    return out;
  }

  function teamPlanLabelHtml(owner) {
    const lab = state.teamLabels && state.teamLabels[owner];
    if (!lab || !lab.label) return "";
    return (
      '<div class="lt-team-plan" title="' +
      escapeHtml(lab.category || "") +
      '">' +
      escapeHtml(lab.label) +
      "</div>"
    );
  }

  /**
   * Place roster into on-field formation then bench for one season.
   * Greedy by season xPoints; only into positions they can play that year.
   * Empty slots stay empty — never force ineligible players into a line.
   */
  function buildSeasonLineup(players, cfg, yearIdx) {
    const need = {
      DEF: Math.max(0, Number(cfg.slots && cfg.slots.DEF) || 0),
      MID: Math.max(0, Number(cfg.slots && cfg.slots.MID) || 0),
      RUC: Math.max(0, Number(cfg.slots && cfg.slots.RUC) || 0),
      FWD: Math.max(0, Number(cfg.slots && cfg.slots.FWD) || 0)
    };
    const remaining = {
      DEF: need.DEF,
      MID: need.MID,
      RUC: need.RUC,
      FWD: need.FWD
    };
    const filled = { DEF: [], MID: [], RUC: [], FWD: [] };
    const used = new Set();
    const ranked = (players || []).slice().sort(
      (a, b) =>
        seasonXPoints(b, yearIdx) - seasonXPoints(a, yearIdx) ||
        (b.vorp || 0) - (a.vorp || 0) ||
        (a.name || "").localeCompare(b.name || "") ||
        String(a.id).localeCompare(String(b.id))
    );

    ranked.forEach((p) => {
      if (used.has(p.id)) return;
      if (!POS_KEYS.some((pos) => remaining[pos] > 0)) return;
      const probs = seasonPosProbs(p, yearIdx);
      const open = POS_KEYS.filter(
        (pos) => remaining[pos] > 0 && canPlaySeasonPos(p, pos, yearIdx)
      ).sort(
        (a, b) =>
          (probs[b] || 0) - (probs[a] || 0) ||
          remaining[b] - remaining[a] ||
          a.localeCompare(b)
      );
      if (!open.length) return;
      const pos = open[0];
      filled[pos].push({
        player: p,
        pos,
        xp: seasonXPoints(p, yearIdx),
        probs
      });
      remaining[pos] -= 1;
      used.add(p.id);
    });

    const benchN = Math.max(0, Number(cfg.bench) || 0);
    const bench = [];
    ranked.forEach((p) => {
      if (used.has(p.id) || bench.length >= benchN) return;
      bench.push({
        player: p,
        pos: "BENCH",
        xp: seasonXPoints(p, yearIdx),
        probs: seasonPosProbs(p, yearIdx)
      });
      used.add(p.id);
    });

    const overflow = ranked
      .filter((p) => !used.has(p.id))
      .map((p) => ({
        player: p,
        pos: "OUT",
        xp: seasonXPoints(p, yearIdx),
        probs: seasonPosProbs(p, yearIdx)
      }));

    let onFieldTotal = 0;
    POS_KEYS.forEach((pos) => {
      filled[pos].forEach((slot) => {
        onFieldTotal += slot.xp;
      });
    });
    const benchTotal = bench.reduce((s, x) => s + x.xp, 0);

    return {
      need,
      remaining,
      filled,
      bench,
      overflow,
      onFieldTotal,
      squadTotal: onFieldTotal + benchTotal
    };
  }

  function plannerPlayerRowHtml(slot, belowCut) {
    const r = slot.player;
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
      posChipsHtml(displayPos(r)) +
      "</div>" +
      "</div>" +
      '<div class="fp-player-xp">' +
      fmtInt(slot.xp) +
      "</div>" +
      "</div>"
    );
  }

  function plannerPosBlockHtml(label, slots, emptyCount) {
    const rows = (slots || []).map((slot) => plannerPlayerRowHtml(slot, false));
    for (let i = 0; i < (emptyCount || 0); i++) {
      rows.push('<div class="fp-empty-slot">Empty</div>');
    }
    if (!rows.length) return "";
    return (
      '<div class="fp-pos-label">' +
      escapeHtml(label) +
      "</div>" +
      rows.join("")
    );
  }

  function ordinalRank(n) {
    const num = Number(n) || 0;
    const v = Math.abs(num) % 100;
    const d = Math.abs(num) % 10;
    const s =
      v >= 11 && v <= 13 ? "th" : d === 1 ? "st" : d === 2 ? "nd" : d === 3 ? "rd" : "th";
    return num + s;
  }

  /** League ladder place for owner in season index (1 = best by yearPts). */
  function ladderRankForOwner(standings, owner, yearIdx) {
    const ranked = (standings || []).slice().sort(
      (a, b) =>
        ((b.yearPts && b.yearPts[yearIdx]) || 0) -
          ((a.yearPts && a.yearPts[yearIdx]) || 0) ||
        String(a.owner).localeCompare(String(b.owner))
    );
    const i = ranked.findIndex((t) => t.owner === owner);
    return i < 0 ? null : i + 1;
  }

  function renderTeamPlanner(rows, league, cfg) {
    const el = document.getElementById("team-planner");
    if (!el) return;

    if (!league || !league.owners || !league.owners.length) {
      el.innerHTML =
        "<p class='muted'>Upload a Keeper Fantasy CSV in <b>Import</b>, then choose <b>My team</b> to plan lineups.</p>";
      return;
    }

    const myTeam =
      cfg.myTeam && league.owners.indexOf(cfg.myTeam) >= 0 ? cfg.myTeam : "";
    if (!myTeam) {
      el.innerHTML =
        "<p class='muted'>Select <b>My team</b> (next to Through) to see your season-by-season planner.</p>";
      return;
    }

    const cutOn = resolveKeeperCut(cfg, state.data, state.seasons);
    const cutN = Math.max(0, Number(cfg.keeperCount) || 0);
    // Keepers follow Through (endSeason) via VORP in computeRows / selectKeepers*
    const roster = rows.filter((r) => r.owner === myTeam && r.type !== "pick");
    const split = splitRosterByKeepers(roster, cfg, myTeam, cutOn);
    const keepers = split.kept;
    const cutList = split.cut || [];

    const yearSeasons = state.seasons.slice();
    if (!yearSeasons.length) {
      el.innerHTML = "<p class='muted'>No seasons available.</p>";
      return;
    }

    const standings = buildTeamStandings(rows, league, cfg);

    const boards = yearSeasons.map((year, yi) => {
      const lineup = buildSeasonLineup(keepers, cfg, yi);
      const rank = ladderRankForOwner(standings, myTeam, yi);
      const yearPts =
        ((standings.find((t) => t.owner === myTeam) || {}).yearPts || [])[yi] ||
        0;
      return { year, yi, lineup, isFirst: yi === 0, rank, yearPts };
    });

    let bestIdx = 0;
    boards.forEach((b, i) => {
      const br = boards[bestIdx].rank;
      const r = b.rank;
      if (r == null) return;
      if (
        br == null ||
        r < br ||
        (r === br && b.yearPts > boards[bestIdx].yearPts)
      ) {
        bestIdx = i;
      }
    });
    const bestYear = boards[bestIdx].year;

    const lab = state.teamLabels && state.teamLabels[myTeam];
    const head =
      '<div class="fp-head">' +
      '<h3 class="fp-head-title">' +
      escapeHtml(myTeam) +
      "</h3>" +
      (lab && lab.label
        ? '<span class="fp-head-tag" title="' +
          escapeHtml(lab.category || "") +
          '">' +
          escapeHtml(lab.label) +
          "</span>"
        : "") +
      '<span class="fp-head-best">Best year · ' +
      bestYear +
      "</span>" +
      "</div>";

    const seasonCards = boards
      .map((b, i) => {
        const isBest = i === bestIdx;
        const lineup = b.lineup;
        let body = "";
        POS_KEYS.forEach((pos) => {
          body += plannerPosBlockHtml(
            pos,
            lineup.filled[pos],
            lineup.remaining[pos]
          );
        });
        body += plannerPosBlockHtml("Bench", lineup.bench, 0);
        if (lineup.overflow.length) {
          body += plannerPosBlockHtml("Reserve", lineup.overflow, 0);
        }
        if (b.isFirst && cutOn && cutN > 0 && cutList.length) {
          body +=
            '<div class="lt-cut" role="separator" title="Keeper cut">' +
            "<span>Keeper cut · " +
            keepers.length +
            "/" +
            cutN +
            "</span>" +
            "</div>";
          cutList.forEach((p) => {
            body += plannerPlayerRowHtml(
              {
                player: p,
                xp: seasonXPoints(p, 0),
                pos: "CUT"
              },
              true
            );
          });
        }
        const projLabel =
          b.rank != null ? "Proj " + ordinalRank(b.rank) : "Proj —";
        return (
          '<article class="fp-season' +
          (isBest ? " is-best" : "") +
          '">' +
          '<header class="fp-season-head">' +
          "<div>" +
          '<div class="fp-season-year">' +
          b.year +
          (isBest ? '<span class="fp-season-badge">Best</span>' : "") +
          "</div>" +
          '<div class="fp-season-sub">' +
          (b.isFirst ? "Current team · keepers" : "Best lineup") +
          "</div>" +
          "</div>" +
          '<div class="fp-season-total" title="Projected ladder place">' +
          escapeHtml(projLabel) +
          "</div>" +
          "</header>" +
          '<div class="fp-season-body">' +
          (body || '<p class="muted" style="padding:8px 10px;">No players</p>') +
          "</div>" +
          "</article>"
        );
      })
      .join("");

    el.innerHTML = head + '<div class="fp-seasons">' + seasonCards + "</div>";
  }

  /**
   * Best→worst by projected first-horizon season (e.g. 2027) xPoints.
   * Used to snake the keeper draft: R1 worst→best, R2 best→worst, …
   */
  function projectedLadderBestToWorst(rows, league, cfg) {
    return buildTeamStandings(rows, league, cfg)
      .slice()
      .sort(
        (a, b) =>
          (b.yearPts[0] || 0) - (a.yearPts[0] || 0) ||
          (b.vorp || 0) - (a.vorp || 0) ||
          a.owner.localeCompare(b.owner)
      )
      .map((t) => t.owner);
  }

  function snakeDraftSlots(ownersBestToWorst, rounds) {
    const slots = [];
    for (let r = 0; r < rounds; r++) {
      const order =
        r % 2 === 0
          ? ownersBestToWorst.slice().reverse() // R1: worst picks first
          : ownersBestToWorst.slice(); // R2: best picks first
      order.forEach((owner) => {
        slots.push({ owner, round: r + 1 });
      });
    }
    return slots;
  }

  function buildKeeperDraftPicks(unowned, cfg, seasons, rows, league) {
    const yearSeasons = seasons.slice();
    const draftYear = yearSeasons[0] || seasons[0] || "";
    const perTeam = keeperDraftPicksPerTeam(cfg);
    const ladder = projectedLadderBestToWorst(rows, league, cfg);
    const slots = snakeDraftSlots(ladder, perTeam);
    return slots.map((slot, i) => {
      const proxy = unowned[i] || null;
      const ypts = proxy
        ? yearPointsForRow(proxy, yearSeasons.length)
        : yearSeasons.map(() => 0);
      const overall = i + 1;
      return {
        key: "PICK:" + overall,
        pick: overall,
        round: slot.round,
        owner: slot.owner,
        id: "KD_PICK_" + String(overall).padStart(2, "0"),
        name: draftYear + " R" + slot.round + " (#" + overall + ")",
        vorp: proxy ? Number(proxy.vorp) || 0 : 0,
        yearPts: ypts,
        proxyName: proxy ? proxy.name : null,
        proxyId: proxy ? proxy.id : null
      };
    });
  }

  function fmtSigned(v) {
    if (v == null || !Number.isFinite(v)) return "—";
    const n = Math.round(v);
    return (n > 0 ? "+" : "") + String(n);
  }

  function tradeAssetMap(rows, picks, keptSets) {
    const yLen = state.seasons.length;
    const map = Object.create(null);
    rows.forEach((r) => {
      if (!r.id || !r.owner) return;
      const kept = keptSets && keptSets[r.owner] ? keptSets[r.owner].has(r.id) : true;
      map[r.id] = {
        key: r.id,
        kind: "player",
        name: r.name,
        vorp: Number(r.vorp) || 0,
        yearPts: yearPointsForRow(r, yLen),
        owner: r.owner,
        belowCut: !kept,
        row: r
      };
    });
    (picks || []).forEach((p) => {
      map[p.key] = {
        key: p.key,
        kind: "pick",
        name: p.name,
        vorp: p.vorp,
        yearPts: (p.yearPts || []).slice(),
        proxyName: p.proxyName,
        pick: p.pick,
        round: p.round,
        owner: p.owner,
        belowCut: false,
        row: null
      };
    });
    return map;
  }

  function buildKeptSets(rows, league, cfg) {
    const cutOn = resolveKeeperCut(cfg, state.data, state.seasons);
    const out = Object.create(null);
    (league.owners || []).forEach((owner) => {
      const players = rows.filter((r) => r.owner === owner);
      out[owner] = splitRosterByKeepers(players, cfg, owner, cutOn).keptSet;
    });
    return out;
  }

  /**
   * Kept-player totals + owned pick proxy values.
   * Always chooses keeperCount keepers for trade math — you finalise 20
   * before the draft even if the UI cut toggle is off. Picks sit outside
   * that 20; trading a pick can free a roster spot so the lowest keeper drops.
   */
  function teamTradeTotals(rows, owner, cfg, pickOwnerByKey, picksByKey) {
    const cutOn = Math.max(0, Number(cfg.keeperCount) || 0) > 0;
    const yLen = state.seasons.length;
    const players = rows.filter((r) => r.owner === owner);
    const split = splitRosterByKeepers(players, cfg, owner, cutOn);
    const yearPts = Array.from({ length: yLen }, () => 0);
    let vorp = 0;
    split.kept.forEach((p) => {
      const yp = yearPointsForRow(p, yLen);
      yp.forEach((v, i) => {
        yearPts[i] += v;
      });
      vorp += Number(p.vorp) || 0;
    });
    Object.keys(pickOwnerByKey || {}).forEach((k) => {
      if (pickOwnerByKey[k] !== owner) return;
      const pk = picksByKey[k];
      if (!pk) return;
      vorp += Number(pk.vorp) || 0;
      for (let i = 0; i < yLen; i++) yearPts[i] += (pk.yearPts && pk.yearPts[i]) || 0;
    });
    return { yearPts, vorp, split };
  }

  /**
   * Swap players/picks between sideA and sideB, re-cut keepers, return per-team diffs.
   * Team A score is not −Team B — cuts change independently.
   */
  function buildPickMaps(picks) {
    const picksByKey = Object.create(null);
    const pickOwnerByKey = Object.create(null);
    (picks || []).forEach((p) => {
      picksByKey[p.key] = p;
      pickOwnerByKey[p.key] = p.owner;
    });
    return { picksByKey, pickOwnerByKey };
  }

  function simulateTrade(rows, league, cfg, sideA, sideB, giveKeys, getKeys, picks, preCache) {
    const yLen = state.seasons.length;
    const base = buildPickMaps(picks);
    const picksByKey = base.picksByKey;
    const pickOwnerByKey = Object.assign(Object.create(null), base.pickOwnerByKey);

    const preA =
      (preCache && preCache[sideA]) ||
      teamTradeTotals(rows, sideA, cfg, base.pickOwnerByKey, picksByKey);
    const preB =
      (preCache && preCache[sideB]) ||
      teamTradeTotals(rows, sideB, cfg, base.pickOwnerByKey, picksByKey);

    const ownerOverride = Object.create(null);
    (giveKeys || []).forEach((k) => {
      if (picksByKey[k]) pickOwnerByKey[k] = sideB;
      else ownerOverride[k] = sideB;
    });
    (getKeys || []).forEach((k) => {
      if (picksByKey[k]) pickOwnerByKey[k] = sideA;
      else ownerOverride[k] = sideA;
    });

    const touched = Object.keys(ownerOverride);
    const simRows =
      touched.length === 0
        ? rows
        : rows.map((r) => {
            if (!ownerOverride[r.id]) return r;
            return Object.assign({}, r, { owner: ownerOverride[r.id] });
          });

    const postA = teamTradeTotals(simRows, sideA, cfg, pickOwnerByKey, picksByKey);
    const postB = teamTradeTotals(simRows, sideB, cfg, pickOwnerByKey, picksByKey);

    function diffTotals(post, pre) {
      return {
        yearPts: post.yearPts.map((v, i) => v - (pre.yearPts[i] || 0)),
        vorp: post.vorp - pre.vorp,
        post,
        pre
      };
    }

    return {
      a: diffTotals(postA, preA),
      b: diffTotals(postB, preB),
      yLen
    };
  }

  function combinations(arr, k) {
    if (k <= 0) return [[]];
    if (!arr.length || k > arr.length) return [];
    const out = [];
    function rec(start, path) {
      if (path.length === k) {
        out.push(path.slice());
        return;
      }
      for (let i = start; i < arr.length; i++) {
        path.push(arr[i]);
        rec(i + 1, path);
        path.pop();
      }
    }
    rec(0, []);
    return out;
  }

  /**
   * Absolute |Σ give xPoints − Σ get xPoints| across all seasons must be ≤ this.
   * Uses the same units as the year columns (not scarcity-adjusted VORP).
   */
  const TRADE_XPTS_GAP_MAX = 450;

  /** Soft buckets for plan-tag trade chemistry (bonus only). */
  const PLAN_TRADE_SIDE = {
    SUSTAINED_ELITE: "contend",
    UPPER_MID: "contend",
    PEAK_WINDOW: "contend",
    CLIFF: "sell",
    FADING: "sell",
    PAPER_TIGER: "sell",
    RISING: "buy",
    RISING_ELITE: "buy",
    BOTTOM: "buy",
    HIDDEN_DEPTH: "buy",
    VOLATILE: "mid",
    TREADMILL: "mid"
  };

  function planCategory(owner) {
    const lab = state.teamLabels && state.teamLabels[owner];
    return (lab && lab.category) || "TREADMILL";
  }

  function planTradeAffinity(ownerA, ownerB) {
    const a = PLAN_TRADE_SIDE[planCategory(ownerA)] || "mid";
    const b = PLAN_TRADE_SIDE[planCategory(ownerB)] || "mid";
    if ((a === "sell" && b === "buy") || (a === "buy" && b === "sell")) return 28;
    if (a === "contend" && b === "buy") return 10;
    if (a === "buy" && b === "contend") return 10;
    if (a === b && a !== "mid") return 4;
    return 0;
  }

  function sumAssetYearPts(keys, assetMap) {
    let s = 0;
    (keys || []).forEach((k) => {
      const a = assetMap[k];
      if (!a || !a.yearPts) return;
      for (let i = 0; i < a.yearPts.length; i++) s += Number(a.yearPts[i]) || 0;
    });
    return s;
  }

  function yearPtsTotal(yearPts) {
    return (yearPts || []).reduce((s, v) => s + (Number(v) || 0), 0);
  }

  function scoreTradePackage(sim, giveKeys, getKeys, assetMap, myTeam, other) {
    const myTotal = yearPtsTotal(sim.a.yearPts);
    const theirTotal = yearPtsTotal(sim.b.yearPts);
    const assetGap = Math.abs(
      sumAssetYearPts(giveKeys, assetMap) - sumAssetYearPts(getKeys, assetMap)
    );
    if (assetGap > TRADE_XPTS_GAP_MAX) return -1e9;
    // Soft fairness on post-cut roster impact — prefer win-win, don't require it
    if (myTotal < -200) return -1e9;
    if (theirTotal < -800 && myTotal > 400) return -1e9;

    let score = myTotal * 1.0 + theirTotal * 0.4 - assetGap * 0.05;

    if (myTotal >= -50 && theirTotal >= -50) score += 350;
    else if (myTotal >= 0 && theirTotal >= -250) score += 180;

    score += planTradeAffinity(myTeam, other) * 8;
    return score;
  }

  function packageSignature(giveKeys, getKeys) {
    const g = giveKeys.slice().sort().join(",");
    const t = getKeys.slice().sort().join(",");
    return g + "||" + t;
  }

  /** Package gap below this → stop suggesting fillers. */
  const TRADE_BALANCED_GAP = 140;
  const TRADE_MAX_ASSETS = 2;

  function emptyTradeSim(yLen) {
    const z = Array.from({ length: yLen }, () => 0);
    return {
      a: { yearPts: z.slice(), vorp: 0 },
      b: { yearPts: z.slice(), vorp: 0 },
      yLen: yLen
    };
  }

  /**
   * Suggest at most one filler piece (often one side only) to balance confirmed give/get.
   * When both sides empty, proposes an opening 1-for-1.
   */
  function suggestTradeFillers(opts) {
    const {
      rows,
      league,
      cfg,
      myTeam,
      other,
      giveKeys,
      getKeys,
      assetMap,
      picks
    } = opts;
    const empty = { suggestGive: null, suggestGet: null, balanced: false };
    if (!myTeam || !other || myTeam === other) return empty;

    const give = (giveKeys || []).slice();
    const get = (getKeys || []).slice();
    const baseMaps = buildPickMaps(picks);
    const preCache = Object.create(null);
    preCache[myTeam] = teamTradeTotals(
      rows,
      myTeam,
      cfg,
      baseMaps.pickOwnerByKey,
      baseMaps.picksByKey
    );
    preCache[other] = teamTradeTotals(
      rows,
      other,
      cfg,
      baseMaps.pickOwnerByKey,
      baseMaps.picksByKey
    );

    function runSim(g, t) {
      return simulateTrade(rows, league, cfg, myTeam, other, g, t, picks, preCache);
    }

    const giveX0 = sumAssetYearPts(give, assetMap);
    const getX0 = sumAssetYearPts(get, assetMap);
    if (give.length || get.length) {
      const gap = Math.abs(giveX0 - getX0);
      const sim0 = runSim(give, get);
      if (gap <= TRADE_BALANCED_GAP) {
        const myT = yearPtsTotal(sim0.a.yearPts);
        const theirT = yearPtsTotal(sim0.b.yearPts);
        if (myT >= -180 && theirT >= -350) {
          return { suggestGive: null, suggestGet: null, balanced: true };
        }
      }
    }

    const giveSet = new Set(give);
    const getSet = new Set(get);
    const myAvail = Object.keys(assetMap)
      .map((k) => assetMap[k])
      .filter((a) => a.owner === myTeam && !giveSet.has(a.key))
      .sort(
        (a, b) =>
          yearPtsTotal(b.yearPts) - yearPtsTotal(a.yearPts) ||
          a.name.localeCompare(b.name)
      )
      .slice(0, 14);
    const theirAvail = Object.keys(assetMap)
      .map((k) => assetMap[k])
      .filter((a) => a.owner === other && !getSet.has(a.key))
      .sort(
        (a, b) =>
          yearPtsTotal(b.yearPts) - yearPtsTotal(a.yearPts) ||
          a.name.localeCompare(b.name)
      )
      .slice(0, 14);

    const canAddGive = give.length < TRADE_MAX_ASSETS;
    const canAddGet = get.length < TRADE_MAX_ASSETS;
    let best = { score: -1e9, suggestGive: null, suggestGet: null };

    function consider(sg, st) {
      const g = sg ? give.concat([sg]) : give.slice();
      const t = st ? get.concat([st]) : get.slice();
      // Need a real trade direction after applying the suggestion
      if (!g.length && !t.length) return;
      if (g.length > TRADE_MAX_ASSETS || t.length > TRADE_MAX_ASSETS) return;
      const assetGap = Math.abs(
        sumAssetYearPts(g, assetMap) - sumAssetYearPts(t, assetMap)
      );
      if (assetGap > TRADE_XPTS_GAP_MAX) return;
      const sim = runSim(g, t);
      const score = scoreTradePackage(sim, g, t, assetMap, myTeam, other);
      if (score <= -1e8 || score <= best.score) return;
      best = { score, suggestGive: sg || null, suggestGet: st || null };
    }

    if (!give.length && !get.length) {
      // Opening: one piece each
      myAvail.forEach((a) => {
        theirAvail.forEach((b) => consider(a.key, b.key));
      });
    } else {
      // Prefer a single-side filler on the short side
      const needGet = giveX0 > getX0 + TRADE_BALANCED_GAP * 0.25;
      const needGive = getX0 > giveX0 + TRADE_BALANCED_GAP * 0.25;
      if (needGet && canAddGet) {
        theirAvail.forEach((b) => consider(null, b.key));
      } else if (needGive && canAddGive) {
        myAvail.forEach((a) => consider(a.key, null));
      } else {
        if (canAddGet) theirAvail.forEach((b) => consider(null, b.key));
        if (canAddGive) myAvail.forEach((a) => consider(a.key, null));
      }
    }

    if (best.score <= -1e8) return empty;
    return {
      suggestGive: best.suggestGive,
      suggestGet: best.suggestGet,
      balanced: false
    };
  }

  function libraryAddIconHtml() {
    return (
      '<span class="tc-pick-icon" aria-hidden="true">' +
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="28" height="28" focusable="false">' +
      '<path fill="currentColor" d="M4 6H2v14c0 1.1.9 2 2 2h14v-2H4V6zm16-4H8c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-1 9h-4v4h-2v-4H9V9h4V5h2v4h4v2z"/>' +
      "</svg></span>"
    );
  }

  function pickPlayerRowHtml(p) {
    const tip =
      "Overall #" +
      (p.pick || "") +
      (p.proxyName ? " · proxy " + p.proxyName : "");
    return (
      '<div class="lt-player tc-pick-row">' +
      libraryAddIconHtml() +
      '<div class="lt-player-meta">' +
      '<div class="lt-player-name" title="' +
      escapeHtml(tip) +
      '">' +
      escapeHtml(p.name || "") +
      "</div>" +
      '<div class="lt-player-chips"><span class="fd-pos-chip">PICK</span></div>' +
      "</div>" +
      '<div class="lt-player-vorp">' +
      fmtInt(p.vorp) +
      "</div>" +
      "</div>"
    );
  }

  function tradeAssetBodyHtml(asset) {
    if (!asset) return "";
    if (asset.kind === "pick") return pickPlayerRowHtml(asset);
    return teamPlayerRowHtml(asset.row || asset, !!asset.belowCut);
  }

  function tradeAssetRowHtml(asset, selected, opts) {
    if (!asset) return "";
    const o = opts || {};
    const owner = o.owner != null ? o.owner : asset.owner;
    return (
      '<button type="button" class="tc-asset-btn' +
      (selected ? " is-selected" : "") +
      (o.suggested ? " is-suggested" : "") +
      (asset.belowCut ? " is-cut" : "") +
      '" data-tc-asset="' +
      escapeHtml(asset.key) +
      '"' +
      (o.role ? ' data-tc-role="' + escapeHtml(o.role) + '"' : "") +
      (owner
        ? ' data-tc-owner="' + escapeHtml(owner) + '"'
        : "") +
      ">" +
      tradeAssetBodyHtml(asset) +
      "</button>"
    );
  }

  function tradeDiffTableHtml(sim, myTeam, other, yearSeasons) {
    const yLen = yearSeasons.length;
    const s = sim || emptyTradeSim(yLen);
    const ya = (s.a && s.a.yearPts) || Array.from({ length: yLen }, () => 0);
    const yb = (s.b && s.b.yearPts) || Array.from({ length: yLen }, () => 0);
    function row(label, yearPts, cls) {
      const total = yearPtsTotal(yearPts);
      return (
        "<tr class='" +
        cls +
        "'><td class='tc-team-col'>" +
        escapeHtml(label) +
        "</td>" +
        yearPts
          .map((v) => {
            return (
              "<td class='tc-num " +
              (v > 0 ? "up" : v < 0 ? "down" : "") +
              "'>" +
              fmtSigned(v) +
              "</td>"
            );
          })
          .join("") +
        "<td class='tc-num tc-emph " +
        (total > 0 ? "up" : total < 0 ? "down" : "") +
        "'>" +
        fmtSigned(total) +
        "</td></tr>"
      );
    }
    return (
      '<div class="tc-overview-wrap"><table class="tc-overview"><thead><tr>' +
      "<th class='tc-team-col'></th>" +
      yearSeasons.map((y) => "<th>" + y + "</th>").join("") +
      "<th title='Sum of year deltas'>Total</th></tr></thead><tbody>" +
      row(myTeam, ya, "tc-row-a") +
      row(other, yb, "tc-row-b") +
      "</tbody></table></div>"
    );
  }

  function renderTradeCalculator(rows, league, cfg) {
    const el = document.getElementById("trade-calculator");
    if (!el) return;
    if (!league || !league.owners || !league.owners.length) {
      el.style.display = "block";
      el.innerHTML =
        "<p class='muted'>Upload a Keeper Fantasy CSV in <b>Import</b> to use the trade calculator.</p>";
      return;
    }

    const yearSeasons = state.seasons.slice();
    const unowned = unownedAfterCuts(rows, league, cfg);
    const picks = buildKeeperDraftPicks(unowned, cfg, state.seasons, rows, league);
    const keptSets = buildKeptSets(rows, league, cfg);
    const assetMap = tradeAssetMap(rows, picks, keptSets);

    const myTeam =
      cfg.myTeam && league.owners.indexOf(cfg.myTeam) >= 0 ? cfg.myTeam : "";

    let otherTeam =
      state.trade.otherTeam && league.owners.indexOf(state.trade.otherTeam) >= 0
        ? state.trade.otherTeam
        : "";
    if (otherTeam && otherTeam === myTeam) otherTeam = "";
    state.trade.otherTeam = otherTeam;

    const searchQ = String(state.trade.search || "")
      .trim()
      .toLowerCase();

    state.trade.give = (state.trade.give || []).filter(
      (k) => assetMap[k] && assetMap[k].owner === myTeam
    );
    state.trade.get = (state.trade.get || []).filter(
      (k) =>
        assetMap[k] &&
        assetMap[k].owner &&
        assetMap[k].owner !== myTeam &&
        (!otherTeam || assetMap[k].owner === otherTeam)
    );

    const giveSet = new Set(state.trade.give);
    const getSet = new Set(state.trade.get);

    const myAssets = myTeam
      ? Object.keys(assetMap)
          .map((k) => assetMap[k])
          .filter((a) => a.owner === myTeam)
          .sort((a, b) => {
            const ac = a.belowCut ? 1 : 0;
            const bc = b.belowCut ? 1 : 0;
            if (ac !== bc) return ac - bc;
            return (
              yearPtsTotal(b.yearPts) - yearPtsTotal(a.yearPts) ||
              a.name.localeCompare(b.name)
            );
          })
      : [];

    let theirAssets = [];
    if (myTeam) {
      theirAssets = Object.keys(assetMap)
        .map((k) => assetMap[k])
        .filter((a) => a.owner && a.owner !== myTeam)
        .filter((a) => {
          if (searchQ) {
            return String(a.name || "")
              .toLowerCase()
              .includes(searchQ);
          }
          return !otherTeam || a.owner === otherTeam;
        })
        .sort((a, b) => {
          if (!searchQ && otherTeam) {
            /* same team */
          } else {
            const oc = String(a.owner).localeCompare(String(b.owner));
            if (oc) return oc;
          }
          const ac = a.belowCut ? 1 : 0;
          const bc = b.belowCut ? 1 : 0;
          if (ac !== bc) return ac - bc;
          return (
            yearPtsTotal(b.yearPts) - yearPtsTotal(a.yearPts) ||
            a.name.localeCompare(b.name)
          );
        });
    }

    const otherOptions =
      '<option value="">— Other team —</option>' +
      league.owners
        .filter((o) => o !== myTeam)
        .map(
          (o) =>
            '<option value="' +
            escapeHtml(o) +
            '"' +
            (o === otherTeam ? " selected" : "") +
            ">" +
            escapeHtml(o) +
            "</option>"
        )
        .join("");

    let fillers = {
      suggestGive: null,
      suggestGet: null,
      balanced: false
    };
    if (myTeam && otherTeam) {
      fillers = suggestTradeFillers({
        rows,
        league,
        cfg,
        myTeam,
        other: otherTeam,
        giveKeys: state.trade.give,
        getKeys: state.trade.get,
        assetMap,
        picks
      });
    }

    // Yearly diffs use confirmed pieces only (suggestions stay visual).
    let displaySim = emptyTradeSim(yearSeasons.length);
    if (myTeam && otherTeam) {
      displaySim = simulateTrade(
        rows,
        league,
        cfg,
        myTeam,
        otherTeam,
        state.trade.give || [],
        state.trade.get || [],
        picks
      );
    }

    function rosterListHtml(list, selectedSet, role, emptyMsg) {
      if (!list.length) return '<p class="muted">' + emptyMsg + "</p>";
      const parts = [];
      let last = null;
      const multiOwner = role === "get" && (searchQ || !otherTeam);
      list.forEach((a) => {
        if (multiOwner && a.owner !== last) {
          last = a.owner;
          parts.push(
            '<div class="tc-owner-head">' +
              escapeHtml(a.owner) +
              teamPlanLabelHtml(a.owner) +
              "</div>"
          );
        }
        parts.push(
          tradeAssetRowHtml(a, selectedSet.has(a.key), {
            role: role,
            owner: a.owner
          })
        );
      });
      return parts.join("");
    }

    function confirmedStackHtml(keys, role) {
      if (!keys.length) {
        return '<p class="muted tc-slot-hint">Confirmed</p>';
      }
      return keys
        .map((k) =>
          tradeAssetRowHtml(assetMap[k], true, {
            role: role + "-locked",
            owner: assetMap[k] && assetMap[k].owner
          })
        )
        .join("");
    }

    function suggestStackHtml(key, role) {
      if (!key || !assetMap[key]) return "";
      return (
        '<div class="tc-suggest-label">Suggested</div>' +
        tradeAssetRowHtml(assetMap[key], false, {
          role: role + "-suggest",
          suggested: true,
          owner: assetMap[key].owner
        })
      );
    }

    el.style.display = "block";
    if (!myTeam) {
      el.innerHTML =
        "<h3>Trade calculator</h3>" +
        "<p class='muted'>Select <b>My team</b> (header / Import) to start.</p>";
      return;
    }

    el.innerHTML =
      "<h3>Trade calculator</h3>" +
      '<div class="tc-board">' +
      '<div class="tc-col tc-roster">' +
      '<div class="tc-col-head">' +
      '<div class="tc-col-title">' +
      escapeHtml(myTeam) +
      "</div>" +
      teamPlanLabelHtml(myTeam) +
      "</div>" +
      '<div class="tc-list" id="tc-my-list">' +
      rosterListHtml(myAssets, giveSet, "give", "No assets") +
      "</div></div>" +
      '<div class="tc-center">' +
      '<div class="tc-diff">' +
      tradeDiffTableHtml(
        displaySim,
        "You",
        otherTeam || "Them",
        yearSeasons
      ) +
      (fillers.balanced
        ? '<p class="muted tc-balanced">Balanced</p>'
        : "") +
      "</div>" +
      '<div class="tc-inputs">' +
      '<div class="tc-col tc-tray" id="tc-give-tray">' +
      confirmedStackHtml(state.trade.give, "give") +
      suggestStackHtml(fillers.suggestGive, "give") +
      "</div>" +
      '<div class="tc-col tc-tray" id="tc-get-tray">' +
      confirmedStackHtml(state.trade.get, "get") +
      suggestStackHtml(fillers.suggestGet, "get") +
      "</div>" +
      "</div></div>" +
      '<div class="tc-col tc-roster">' +
      '<div class="tc-col-head">' +
      '<select id="tc-other-team">' +
      otherOptions +
      "</select>" +
      (otherTeam ? teamPlanLabelHtml(otherTeam) : "") +
      '<input id="tc-player-search" type="search" placeholder="Search players" value="' +
      escapeHtml(state.trade.search || "") +
      '"/>' +
      "</div>" +
      '<div class="tc-list" id="tc-other-list">' +
      rosterListHtml(
        theirAssets,
        getSet,
        "get",
        otherTeam || searchQ ? "No assets" : "Choose a team or search"
      ) +
      "</div></div>" +
      "</div>";
  }

  function bindTradeCalculator() {
    if (state.trade.bound) return;
    state.trade.bound = true;
    const el = document.getElementById("trade-calculator");
    if (!el) return;

    function toggleKey(arrName, key, maxN) {
      const arr = (state.trade[arrName] || []).slice();
      const i = arr.indexOf(key);
      if (i >= 0) arr.splice(i, 1);
      else {
        if (arr.length >= maxN) return false;
        arr.push(key);
      }
      state.trade[arrName] = arr;
      return true;
    }

    el.addEventListener("change", (e) => {
      const t = e.target;
      if (!t) return;
      if (t.id === "tc-other-team") {
        state.trade.otherTeam = t.value || "";
        state.trade.search = "";
        state.trade.get = [];
        state.trade.give = [];
        renderTradeCalculator(state.rows, state.league, state.cfg);
      }
    });

    el.addEventListener("input", (e) => {
      const t = e.target;
      if (!t || t.id !== "tc-player-search") return;
      state.trade.search = t.value || "";
      if (state.trade.search.trim()) {
        // Search overrides team filter; keep otherTeam for affinity but list is search-wide
      }
      renderTradeCalculator(state.rows, state.league, state.cfg);
      const inp = document.getElementById("tc-player-search");
      if (inp) {
        inp.focus();
        const len = inp.value.length;
        try {
          inp.setSelectionRange(len, len);
        } catch (err) {
          /* ignore */
        }
      }
    });

    el.addEventListener("click", (e) => {
      const btn = e.target && e.target.closest ? e.target.closest("[data-tc-asset]") : null;
      if (!btn) return;
      const key = btn.getAttribute("data-tc-asset");
      const role = btn.getAttribute("data-tc-role") || "";
      const owner = btn.getAttribute("data-tc-owner") || "";
      if (!key) return;

      if (role === "give-suggest" || role === "get-suggest") {
        const side = role.indexOf("give") === 0 ? "give" : "get";
        if ((state.trade[side] || []).indexOf(key) < 0) {
          if ((state.trade[side] || []).length >= TRADE_MAX_ASSETS) return;
          state.trade[side] = (state.trade[side] || []).concat([key]);
        }
        renderTradeCalculator(state.rows, state.league, state.cfg);
        return;
      }

      if (role === "give-locked" || role === "get-locked") {
        const side = role.indexOf("give") === 0 ? "give" : "get";
        state.trade[side] = (state.trade[side] || []).filter((k) => k !== key);
        renderTradeCalculator(state.rows, state.league, state.cfg);
        return;
      }

      const inMy = btn.closest("#tc-my-list");
      const inOther = btn.closest("#tc-other-list");
      if (inMy) {
        toggleKey("give", key, TRADE_MAX_ASSETS);
      } else if (inOther) {
        if (owner && owner !== state.cfg.myTeam && state.trade.otherTeam !== owner) {
          state.trade.otherTeam = owner;
          state.trade.get = [];
          state.trade.search = "";
        }
        toggleKey("get", key, TRADE_MAX_ASSETS);
      } else {
        return;
      }
      renderTradeCalculator(state.rows, state.league, state.cfg);
    });
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
    const ladderEl = document.getElementById("league-ladder") || el;
    const boardsEl = document.getElementById("teams-boards");
    if (!ladderEl && !boardsEl) return;

    if (!league || !league.owners || !league.owners.length) {
      if (ladderEl) {
        ladderEl.style.display = "block";
        ladderEl.innerHTML =
          "<p class='muted'>Upload a Keeper Fantasy CSV in <b>Import</b> to see the ladder.</p>";
      }
      if (boardsEl) {
        boardsEl.style.display = "block";
        boardsEl.innerHTML =
          "<p class='muted'>Upload a Keeper Fantasy CSV in <b>Import</b> to see team boards.</p>";
      }
      if (el && el !== ladderEl) {
        el.style.display = "none";
        el.innerHTML = "";
      }
      return;
    }

    const cutOn = resolveKeeperCut(cfg, state.data, state.seasons);
    const cutN = Math.max(0, Number(cfg.keeperCount) || 0);
    const yearSeasons = state.seasons.slice();
    const myTeam = cfg.myTeam || "";
    const standings = buildTeamStandings(rows, league, cfg);
    const labelMap = assignTeamTrajectoryLabels(standings);
    state.teamLabels = Object.create(null);
    Object.keys(labelMap).forEach((o) => {
      state.teamLabels[o] = labelMap[o];
    });
    const byOwner = Object.create(null);
    standings.forEach((t) => {
      byOwner[t.owner] = {
        owner: t.owner,
        vorp: t.vorp,
        n: t.players.length,
        players: t.players,
        counted: t.counted,
        cut: t.split ? t.split.cut : [],
        yearPts: t.yearPts
      };
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
          '<div class="lt-team-cell">' +
          '<div class="lt-team-name-row">' +
          '<span class="tr-rank">' +
          (i + 1) +
          "</span> " +
          escapeHtml(t.owner) +
          (mine ? ' <span class="lt-you">you</span>' : "") +
          "</div>" +
          teamPlanLabelHtml(t.owner) +
          "</div>" +
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
        const keptList = t.counted || [];
        const cutList = t.cut || [];
        keptList.forEach((p) => body.push(teamPlayerRowHtml(p, false)));
        if (cutOn && cutN > 0 && cutList.length) {
          body.push(
            '<div class="lt-cut" role="separator" title="Keeper cut">' +
              "<span>Keeper cut · " +
              keptList.length +
              "/" +
              cutN +
              "</span>" +
              "</div>"
          );
          cutList.forEach((p) => body.push(teamPlayerRowHtml(p, true)));
        }
        return (
          '<article class="lt-board' +
          (mine ? " lt-mine-board" : "") +
          '">' +
          '<header class="lt-board-head">' +
          '<div class="lt-board-title">' +
          '<div class="lt-team-name-row">' +
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
          teamPlanLabelHtml(t.owner) +
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

    if (ladderEl) {
      ladderEl.style.display = "block";
      ladderEl.innerHTML =
        "<h3>Ladder</h3>" +
        "<div class='lt-ladder-wrap'><table class='lt-ladder'><thead>" +
        ladderHead +
        "</thead><tbody>" +
        ladderBody +
        "</tbody></table></div>";
    }
    if (boardsEl) {
      boardsEl.style.display = "block";
      boardsEl.innerHTML =
        "<h3>Teams</h3>" +
        "<div class='lt-boards'>" +
        boards +
        "</div>";
    }
    if (el && el !== ladderEl) {
      el.style.display = "none";
      el.innerHTML = "";
    }
  }

  function renderMoversPanel(rows, cfg, data) {
    const el = document.getElementById("movers-panel");
    if (!el) return;
    const h = horizonLen(state.seasons, cfg.endSeason);
    const defaultH = (data.meta && data.meta.defaultHorizon) || state.seasons.length;
    const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
    let rising;
    let falling;
    if (h === defaultH && data.movers) {
      rising = (data.movers.rising || [])
        .map((m) => {
          const row = byId[m.id];
          if (!row) {
            return {
              id: m.id,
              name: m.id,
              dxPoints: m.dxPoints,
              driver: m.driver
            };
          }
          return {
            ...row,
            dxPoints: m.dxPoints != null ? m.dxPoints : row.dxPoints,
            driver: m.driver || row.driver
          };
        })
        .slice(0, 10);
      falling = (data.movers.falling || [])
        .map((m) => {
          const row = byId[m.id];
          if (!row) {
            return {
              id: m.id,
              name: m.id,
              dxPoints: m.dxPoints,
              driver: m.driver
            };
          }
          return {
            ...row,
            dxPoints: m.dxPoints != null ? m.dxPoints : row.dxPoints,
            driver: m.driver || row.driver
          };
        })
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
    function block(title, items, risingFlag) {
      const body = items.length
        ? items.map((m) => moverPlayerRowHtml(m, risingFlag)).join("")
        : '<p class="muted" style="margin:0 8px;">None</p>';
      return (
        '<div class="movers-block"><h4>' + title + "</h4>" + body + "</div>"
      );
    }
    el.innerHTML =
      "<div class='movers-stack'>" +
      block("Rising", rising, true) +
      block("Falling", falling, false) +
      "</div>";
  }

  // ── Tabulator ──────────────────────────────────────────────────────────────

  function bindTableRowClick(table) {
    table.on("rowClick", function (e, row) {
      const el = row.getElement();
      const existing = el.querySelector(".futures-detail");
      if (existing) {
        existing.remove();
        el.style.height = "";
        try {
          row.normalizeHeight();
        } catch (err) {
          /* ignore */
        }
        state.detailId = null;
        return;
      }
      // Close any other open in-row detail (keeps virtual scroll sane)
      table.getRows("active").forEach((r) => {
        const node = r.getElement && r.getElement();
        if (!node) return;
        const d = node.querySelector(".futures-detail");
        if (d) {
          d.remove();
          node.style.height = "";
          try {
            r.normalizeHeight();
          } catch (err2) {
            /* ignore */
          }
        }
      });
      const wrap = document.createElement("div");
      wrap.innerHTML = detailHtml(row.getData());
      const detail = wrap.firstChild;
      detail.addEventListener("click", (ev) => ev.stopPropagation());
      el.appendChild(detail);
      el.style.height = "";
      try {
        row.normalizeHeight();
      } catch (err3) {
        /* ignore */
      }
      state.detailId = row.getData().id;
    });
  }

  /** Create or update the table. First paint must include data — replaceData
   *  before tableBuilt is silently dropped by Tabulator. */
  function ensureTable(columns, data) {
    const hold = document.getElementById("futures-table");
    if (!hold) return Promise.resolve(null);

    if (state.table) {
      // Avoid setColumns on every refresh — it forces a full rebuild and janks scroll.
      return Promise.resolve(state.table.replaceData(data)).then(function () {
        return state.table;
      });
    }

    return new Promise(function (resolve) {
      const table = new Tabulator("#futures-table", {
        data: data || [],
        columns,
        // fitData (not Stretch) — Position stays compact; leftover gap is empty
        layout: "fitData",
        height: "640px",
        renderVertical: "virtual",
        renderVerticalBuffer: 300,
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
    const columns = buildColumnDefs();
    return ensureTable(columns, filtered).then(function () {
      renderMoversPanel(all, cfg, state.data);
      renderTeamRatings(all, state.league, cfg);
      renderTeamPlanner(all, state.league, cfg);
      renderTradeCalculator(all, state.league, cfg);
      state.detailId = null;
      const asof = document.getElementById("futures-asof");
      if (asof && state.data.meta && state.data.meta.asOf) {
        asof.textContent = "As of " + state.data.meta.asOf;
      } else if (asof) {
        asof.textContent = "";
      }
    });
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
    const cut = document.getElementById("cfg-keeperCut");
    if (cut) cut.checked = !!resolveKeeperCut(cfg, state.data, seasons);
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

  function updateOwnerDropdownLabel(cfg) {
    const btn = document.getElementById("owner-dropdown-btn");
    if (!btn) return;
    const owners = cfg.owners || [];
    if (!owners.length) {
      btn.textContent = "All Players";
      return;
    }
    const labels = owners.map((o) => (o === OWNER_FA ? "Free Agents" : o));
    if (labels.length <= 2) btn.textContent = labels.join(", ");
    else btn.textContent = labels.length + " Teams";
  }

  function rebuildOwnerDropdown(league, cfg) {
    const panel = document.getElementById("owner-dropdown-panel");
    if (!panel) return;
    if (!league || !league.owners || !league.owners.length) {
      panel.innerHTML = "";
      panel.dataset.built = "0";
      updateOwnerDropdownLabel(cfg);
      return;
    }
    const my =
      cfg.myTeam && league.owners.indexOf(cfg.myTeam) >= 0 ? cfg.myTeam : "";
    const others = league.owners
      .filter((o) => o !== my)
      .slice()
      .sort((a, b) => a.localeCompare(b));
    const entries = [{ value: OWNER_FA, label: "Free Agents" }];
    if (my) entries.push({ value: my, label: my + " (you)" });
    others.forEach((o) => entries.push({ value: o, label: o }));

    if (cfg.owners && cfg.owners.length) {
      const allowed = new Set(entries.map((e) => e.value));
      cfg.owners = cfg.owners.filter((o) => allowed.has(o));
    }

    panel.innerHTML = entries
      .map(
        (e) =>
          '<label class="team-option">' +
          '<input type="checkbox" value="' +
          escapeHtml(e.value) +
          '" class="owner-checkbox"/>' +
          escapeHtml(e.label) +
          "</label>"
      )
      .join("");
    panel.dataset.built = "1";
    const selected = new Set(cfg.owners || []);
    panel.querySelectorAll(".owner-checkbox").forEach((cb) => {
      cb.checked = selected.has(cb.value);
      cb.addEventListener("change", () => {
        state.cfg.owners = Array.from(
          panel.querySelectorAll(".owner-checkbox:checked")
        ).map((el) => el.value);
        updateOwnerDropdownLabel(state.cfg);
        refresh();
      });
    });
    updateOwnerDropdownLabel(cfg);
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
    const cut = document.getElementById("cfg-keeperCut");
    if (cut) cfg.keeperCut = cut.checked;
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
      "cfg-keeperCut",
      "cfg-myTeam",
      "cfg-search"
    ];
    ids.forEach((id) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.addEventListener("change", () => {
        readControlsFromDom();
        if (id === "cfg-myTeam") {
          rebuildOwnerDropdown(state.league, state.cfg);
          state.trade.otherTeam = "";
          state.trade.search = "";
          state.trade.give = [];
          state.trade.get = [];
        }
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

    document.querySelectorAll(".fd-tab-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        setActiveTab(btn.getAttribute("data-tab") || "pool");
      });
    });

    bindTradeCalculator();
    ensureClubDropdownBuilt();

    function bindDropdownToggle(btnId, panelId, rootId) {
      const btn = document.getElementById(btnId);
      if (!btn) return;
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const panel = document.getElementById(panelId);
        if (!panel) return;
        panel.style.display =
          panel.style.display === "none" ? "grid" : "none";
      });
      document.addEventListener("click", (e) => {
        const root = document.getElementById(rootId);
        const panel = document.getElementById(panelId);
        if (root && panel && !root.contains(e.target)) {
          panel.style.display = "none";
        }
      });
    }
    bindDropdownToggle(
      "club-dropdown-btn",
      "club-dropdown-panel",
      "club-dropdown"
    );
    bindDropdownToggle(
      "owner-dropdown-btn",
      "owner-dropdown-panel",
      "owner-dropdown"
    );

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
    state.cfg = readCfgFromUrl();
    bindControls();
    setActiveTab(state.cfg.tab || "pool");

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
      setActiveTab(state.cfg.tab || "pool");
      if (loading) loading.style.display = "none";
      if (shell) {
        shell.style.display = "block";
        // Force layout before Tabulator measures the container
        void shell.offsetHeight;
      }
      await refresh();
      if (state.cfg.tab === "pool" && state.table) {
        try {
          state.table.redraw(true);
        } catch (e2) {
          /* ignore */
        }
      }
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
