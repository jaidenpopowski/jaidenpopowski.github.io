/**
 * AFL Fantasy draft futures
 */
(function (global) {
  "use strict";

  const POS_KEYS = ["DEF", "MID", "RUC", "FWD"];
  /** Squad slots shown in Import steppers (VORP still uses POS_KEYS only). */
  const SLOT_KEYS = ["DEF", "MID", "RUC", "FWD", "FLX"];
  const STORAGE_URL =
    "https://firebasestorage.googleapis.com/v0/b/statsbyjaiden.firebasestorage.app/o/fantasy_draft_futures.json?alt=media";
  const HEADSHOT_BASE =
    "https://s.afl.com.au/staticfile/AFL%20Tenant/AFL/Players/ChampIDImages/AFL/2026014/";

  const OWNER_FA = "__FA__";
  const AFL_IMPORT_FN_URL =
    "https://us-central1-statsbyjaiden.cloudfunctions.net/importAflLeague";
  /** Keeper CSV owner strings treated as unowned (not a fantasy team). */
  const UNOWNED_OWNER_RE =
    /^(free\s*agents?|fa|rfa|waivers?|restricted\s*free\s*agent)$/i;
  const MONTH_NAMES = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"
  ];

  const DEFAULT_CFG = {
    teams: 10,
    slots: { DEF: 5, MID: 7, RUC: 1, FWD: 5, FLX: 0 },
    bench: 12,
    keeperCount: 20,
    keeperCut: null,
    endSeason: null,
    posFilter: "ALL",
    clubs: [],
    owners: [],
    /** Best→worst owner order for snake draft (Import tab). Empty = projected. */
    draftOrder: [],
    myTeam: "",
    search: "",
    tab: "pool",
    /** redraft | keeper | dynasty | null */
    leagueType: null,
    /** snake | linear */
    draftFormat: "snake",
    pickTrading: true
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
      owners: Array.isArray(src.owners) ? src.owners.slice() : [],
      draftOrder: Array.isArray(src.draftOrder) ? src.draftOrder.slice() : []
    };
  }

  let state = {
    cfg: cloneCfg(DEFAULT_CFG),
    data: null,
    seasons: [],
    rows: [],
    table: null,
    detailId: null,
    /**
     * @type {null | {
     *   source: string,
     *   teams: Object.<string,{name:string}>,
     *   ownership: Object.<string,string>,
     *   positions?: Object.<string,string>,
     *   owners: string[],
     *   platform?: Object,
     *   matchedOwned?: number,
     *   totalOwned?: number,
     *   unmatchedOwnedCount?: number,
     *   fromAccount?: boolean
     * }}
     */
    league: null,
    accountUser: null,
    /** Session flag: user closed the empty-state Import modal. */
    importModalDismissed: false,
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

  function isUnownedOwner(owner) {
    const s = String(owner || "").trim();
    return !s || UNOWNED_OWNER_RE.test(s);
  }

  function leagueTeamEntries(league) {
    if (!league || !league.teams) return [];
    return Object.keys(league.teams)
      .map((id) => ({
        id: String(id),
        name: (league.teams[id] && league.teams[id].name) || String(id)
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  function leagueHasTeams(league) {
    return !!(league && league.teams && Object.keys(league.teams).length);
  }

  /** Runtime name list derived from teams map (not persisted). */
  function syncLeagueOwnersFromTeams(league) {
    if (!league) return league;
    league.owners = leagueTeamEntries(league).map((e) => e.name);
    return league;
  }

  function teamIdByName(league, name) {
    if (!league || !league.teams || !name) return "";
    const entries = leagueTeamEntries(league);
    const hit = entries.find((e) => e.name === name);
    return hit ? hit.id : "";
  }

  function teamNameById(league, id) {
    if (!league || !league.teams || id == null || id === "") return "";
    const t = league.teams[String(id)];
    return t && t.name ? t.name : "";
  }

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
    if (q.has("draft")) {
      cfg.draftOrder = String(q.get("draft") || "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    }
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
    // Account-backed leagues: only ephemeral UI in the URL
    const slim = !!(state.league && state.league.fromAccount);
    if (!slim) {
      q.set("teams", String(cfg.teams));
      q.set("bench", String(cfg.bench));
      q.set("keepers", String(cfg.keeperCount));
      POS_KEYS.forEach((k) => q.set(k.toLowerCase(), String(cfg.slots[k])));
      if (cfg.endSeason) q.set("end", String(cfg.endSeason));
      if (cfg.keeperCut === true) q.set("cut", "1");
      else if (cfg.keeperCut === false) q.set("cut", "0");
      if (cfg.posFilter && cfg.posFilter !== "ALL") q.set("pos", cfg.posFilter);
      if (cfg.clubs && cfg.clubs.length) q.set("clubs", cfg.clubs.join(","));
      if (cfg.owners && cfg.owners.length) {
        q.set(
          "owners",
          cfg.owners.map((o) => (o === OWNER_FA ? "FA" : o)).join(",")
        );
      }
      if (cfg.draftOrder && cfg.draftOrder.length) {
        q.set("draft", cfg.draftOrder.join(","));
      }
      if (cfg.myTeam) q.set("me", cfg.myTeam);
    }
    if (cfg.search) q.set("q", cfg.search);
    if (cfg.tab && cfg.tab !== "pool") q.set("tab", cfg.tab);
    const qs = q.toString();
    const url = window.location.pathname + (qs ? "?" + qs : "");
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
    if (next === "import") syncImportTabUi();
    else hideImportModal();
    if (next === "pool" && state.table) {
      try {
        state.table.redraw(true);
      } catch (e) {
        /* ignore */
      }
    }
  }

  function setImportModalStatus(msg, isError) {
    const el = document.getElementById("fd-import-modal-status");
    if (!el) return;
    el.textContent = msg || "";
    el.classList.toggle("is-error", !!isError);
  }

  function hideImportModal() {
    const modal = document.getElementById("fd-import-modal");
    if (modal) modal.hidden = true;
  }

  function showImportModal(mode) {
    const modal = document.getElementById("fd-import-modal");
    const guest = document.getElementById("fd-import-modal-guest");
    const authed = document.getElementById("fd-import-modal-authed");
    if (!modal) return;
    const isGuest = mode !== "authed";
    if (guest) guest.hidden = !isGuest;
    if (authed) authed.hidden = isGuest;
    modal.hidden = false;
    setImportModalStatus("");
  }

  function syncImportManageVisibility() {
    const hasLeague = leagueHasTeams(state.league);
    const source = document.getElementById("fd-import-source");
    const draft = document.getElementById("fd-draft-order-block");
    const actions = document.getElementById("fd-import-actions");
    if (source) source.hidden = !hasLeague;
    if (draft) draft.hidden = !hasLeague;
    if (actions) actions.hidden = !hasLeague;
    if (hasLeague) renderImportSourceCard();
  }

  function syncImportTabUi() {
    syncImportManageVisibility();
    if (leagueHasTeams(state.league)) {
      hideImportModal();
      return;
    }
    if (state.importModalDismissed) {
      hideImportModal();
      return;
    }
    showImportModal(state.accountUser ? "authed" : "guest");
  }

  function dismissImportModal() {
    state.importModalDismissed = true;
    hideImportModal();
    syncImportManageVisibility();
  }

  function parseKeeperCsvMeta(fileName) {
    const raw = String(fileName || "").replace(/\.csv$/i, "").trim();
    const stampRe = /_(\d{8})_(\d{4})$/;
    const m = raw.match(stampRe);
    let leagueName = raw;
    let fileStamp = "";
    let updatedAt = "";
    if (m) {
      fileStamp = m[1] + "_" + m[2];
      leagueName = raw.slice(0, m.index).replace(/_players$/i, "");
      const y = Number(m[1].slice(0, 4));
      const mo = Number(m[1].slice(4, 6));
      const d = Number(m[1].slice(6, 8));
      const hh = m[2].slice(0, 2);
      const mm = m[2].slice(2, 4);
      if (y && mo >= 1 && mo <= 12 && d >= 1 && d <= 31) {
        updatedAt = y + "-" + String(mo).padStart(2, "0") + "-" +
          String(d).padStart(2, "0") + "T" + hh + ":" + mm + ":00";
      }
    }
    leagueName = leagueName.replace(/_/g, " ").replace(/\s+/g, " ").trim() || "Keeper league";
    return { leagueName, fileStamp, updatedAt, fileName: fileName || "" };
  }

  function formatImportDate(isoOrStamp) {
    if (!isoOrStamp) return "—";
    const s = String(isoOrStamp);
    let dt = null;
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
      dt = new Date(s);
    } else if (/^\d{8}_\d{4}$/.test(s)) {
      const y = Number(s.slice(0, 4));
      const mo = Number(s.slice(4, 6));
      const d = Number(s.slice(6, 8));
      dt = new Date(y, mo - 1, d);
    }
    if (!dt || !Number.isFinite(dt.getTime())) return "—";
    return dt.getDate() + " " + MONTH_NAMES[dt.getMonth()] + " " + dt.getFullYear();
  }

  function ensureDefaultMyTeam(league, cfg) {
    if (!league || !league.owners || !league.owners.length) return;
    if (cfg.myTeam && league.owners.indexOf(cfg.myTeam) >= 0) return;
    cfg.myTeam = league.owners[0];
  }

  function renderImportSourceCard() {
    const league = state.league;
    const card = document.getElementById("fd-import-source-card");
    const title = document.getElementById("fd-import-source-title");
    const nameEl = document.getElementById("fd-import-league-name");
    const updatedEl = document.getElementById("fd-import-last-updated");
    const countEl = document.getElementById("fd-import-team-count");
    const refreshBtn = document.getElementById("fd-league-refresh");
    if (!card || !leagueHasTeams(league)) return;

    const isAfl = league.source === "afl";
    card.classList.toggle("fd-import-panel-afl", isAfl);
    card.classList.toggle("fd-import-panel-keeper", !isAfl);
    if (title) title.textContent = isAfl ? "AFL Fantasy" : "Keeper Fantasy";

    const platform = league.platform || {};
    let leagueName = platform.leagueName || "";
    if (!leagueName && platform.fileName) {
      leagueName = parseKeeperCsvMeta(platform.fileName).leagueName;
    }
    if (nameEl) nameEl.textContent = leagueName || "—";

    const updatedRaw =
      league.updatedAt ||
      platform.fileStamp ||
      platform.updatedAt ||
      "";
    if (updatedEl) updatedEl.textContent = formatImportDate(updatedRaw);

    const nTeams = (league.owners && league.owners.length) || 0;
    if (countEl) countEl.textContent = String(nTeams);

    syncImportMyTeamSelect(league, state.cfg);

    if (refreshBtn) {
      const canRefresh =
        isAfl
          ? !!(platform.leagueHash)
          : true;
      refreshBtn.style.display = canRefresh ? "" : "none";
      refreshBtn.disabled = !canRefresh;
      refreshBtn.textContent = "Refresh";
    }
  }

  function syncImportMyTeamSelect(league, cfg) {
    const sel = document.getElementById("fd-import-myTeam");
    if (!sel) return;
    const hasLeague = leagueHasTeams(league);
    if (!hasLeague) {
      sel.innerHTML = "";
      return;
    }
    const names = league.owners || [];
    ensureDefaultMyTeam(league, cfg);
    const cur = cfg.myTeam && names.indexOf(cfg.myTeam) >= 0 ? cfg.myTeam : names[0] || "";
    cfg.myTeam = cur;
    sel.innerHTML = names
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

  function afterModalImportSuccess() {
    state.importModalDismissed = false;
    hideImportModal();
    syncImportManageVisibility();
    setImportModalStatus("League imported — opening Teams…");
    setLeagueStatus("League imported — opening Teams…");
    window.setTimeout(() => setActiveTab("teams"), 1000);
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

  /**
   * True when every imported team already looks cut-down (roster ≤ keepers).
   * Used to default cut=on before the draft without relying only on PICK_* assets.
   */
  function allImportedTeamsAtOrUnderKeepers(rows, league, cfg) {
    if (!league || !league.owners || !league.owners.length) return false;
    const K = Math.max(0, Number(cfg.keeperCount) || 0);
    if (K <= 0) return false;
    return league.owners.every((owner) => {
      const n = (rows || []).filter(
        (r) =>
          r &&
          r.owner === owner &&
          r.type !== "pick" &&
          !isNationalPickAsset(r) &&
          !isKeeperLeaguePick(r)
      ).length;
      return n <= K;
    });
  }

  function resolveKeeperCut(cfg, data, seasons) {
    if (cfg.keeperCut === true || cfg.keeperCut === false) return cfg.keeperCut;
    // Imported keepers-only rosters ⇒ treat as cut already finalised.
    if (
      state.rows &&
      state.league &&
      allImportedTeamsAtOrUnderKeepers(state.rows, state.league, cfg)
    ) {
      return true;
    }
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
    const teams = Object.create(null);
    const nameToId = Object.create(null);
    let nextTeamId = 1;
    let matchedOwned = 0;
    let totalOwned = 0;
    let unmatchedOwnedCount = 0;

    function teamIdForOwnerName(ownerName) {
      if (Object.prototype.hasOwnProperty.call(nameToId, ownerName)) {
        return nameToId[ownerName];
      }
      const id = String(nextTeamId++);
      nameToId[ownerName] = id;
      teams[id] = { name: ownerName };
      return id;
    }

    csvRows.forEach((r) => {
      const name = r.name || r.Player || r.player || "";
      const owner = String(r.owner || r.Owner || "").trim();
      const team = r.team || r.Team || "";
      const posRaw = r.position || r.Position || r.pos || "";
      if (!name) return;
      const unowned = isUnownedOwner(owner);
      if (!unowned) totalOwned++;
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
        if (!unowned) {
          ownership[hit.id] = teamIdForOwnerName(owner);
          matchedOwned++;
        }
      } else if (!unowned) {
        unmatchedOwnedCount++;
      }
    });

    return {
      teams,
      ownership,
      positions,
      matchedOwned,
      totalOwned,
      unmatchedOwnedCount
    };
  }

  function applyLeagueOwnership(rows, league) {
    if (!league || !league.ownership) {
      rows.forEach((r) => {
        r.owner = null;
        r.ownerTeamId = null;
        r.keeperPos = null;
      });
      return rows;
    }
    rows.forEach((r) => {
      const tid = league.ownership[r.id];
      if (tid != null && tid !== "") {
        r.ownerTeamId = String(tid);
        r.owner = teamNameById(league, tid) || null;
      } else {
        r.ownerTeamId = null;
        r.owner = null;
      }
      r.keeperPos = (league.positions && league.positions[r.id]) || null;
    });
    return rows;
  }

  /** Display position: Keeper CSV when imported, else fantasy position. */
  function displayPos(row) {
    return (row && (row.keeperPos || row.fantasyPos)) || "";
  }

  function setLeagueStatus(msg, isError) {
    const el = document.getElementById("keeper-import-status");
    if (el) {
      el.textContent = msg || "";
      el.classList.toggle("is-error", !!isError);
    }
    const modalOpen = document.getElementById("fd-import-modal");
    if (modalOpen && !modalOpen.hidden) setImportModalStatus(msg, isError);
  }

  function syncOwnerDropdownVisibility(league) {
    const wrap = document.getElementById("owner-dropdown");
    if (!wrap) return;
    const hasLeague = leagueHasTeams(league);
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
    if (wrap && sel) {
      const hasLeague = leagueHasTeams(league);
      wrap.classList.toggle("is-visible", hasLeague);
      if (!hasLeague) {
        sel.innerHTML = "";
      } else {
        const names = league.owners || [];
        ensureDefaultMyTeam(league, cfg);
        const cur = cfg.myTeam && names.indexOf(cfg.myTeam) >= 0 ? cfg.myTeam : names[0] || "";
        cfg.myTeam = cur;
        sel.innerHTML =
          '<option value="">— Select —</option>' +
          names
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
    }
    syncImportMyTeamSelect(league, cfg);
  }

  function clearKeeperLeague() {
    state.league = null;
    state.cfg.myTeam = "";
    state.cfg.owners = [];
    state.cfg.draftOrder = [];
    state.cfg.leagueType = null;
    state.trade.otherTeam = "";
    state.trade.search = "";
    state.trade.give = [];
    state.trade.get = [];
    state.teamLabels = Object.create(null);
    const refreshInput = document.getElementById("keeper-csv-refresh-input");
    if (refreshInput) refreshInput.value = "";
    setLeagueStatus("");
    applyLeagueTypeUi(state.cfg);
    syncMyTeamSelect(null, state.cfg);
    updateAccountSyncUi();
    state.importModalDismissed = false;
    if (state.cfg.tab === "import") syncImportTabUi();
    else syncImportManageVisibility();
    refresh();
  }

  function applyImportedLeague(league, opts) {
    const o = opts || {};
    syncLeagueOwnersFromTeams(league);
    const nowIso = new Date().toISOString();
    if (!league.createdAt) league.createdAt = nowIso;
    league.updatedAt = o.updatedAt || nowIso;
    state.league = league;
    const nTeams = (league.owners && league.owners.length) || 0;
    if (nTeams >= 2) {
      state.cfg.teams = nTeams;
      const teamsEl = document.getElementById("cfg-teams");
      if (teamsEl) teamsEl.value = String(state.cfg.teams);
    }
    if (state.cfg.myTeam && league.owners.indexOf(state.cfg.myTeam) < 0) {
      state.cfg.myTeam = "";
    }
    ensureDefaultMyTeam(league, state.cfg);
    if (o.settings) applyLeagueSettingsToCfg(o.settings, state.cfg);
    applyLeagueTypeDefaults(state.cfg, league, o.infer || null);
    applyLeagueTypeUi(state.cfg);
    syncMyTeamSelect(state.league, state.cfg);
    syncControlsToDom(state.cfg, state.seasons);
    updateAccountSyncUi();
    syncImportManageVisibility();
  }

  function handleKeeperCsvFile(file, opts) {
    const o = opts || {};
    if (!file) return Promise.resolve(false);
    if (!state.data || !state.data.assets) {
      setLeagueStatus("Player data still loading — try again in a moment.", true);
      return Promise.resolve(false);
    }
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = async function () {
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
          if (!Object.keys(matched.teams).length) {
            throw new Error("No fantasy teams found (every row was Free Agent?)");
          }
          const meta = parseKeeperCsvMeta(file.name || "players.csv");
          const prevCreated =
            state.league && state.league.source === "keeper"
              ? state.league.createdAt
              : null;
          const league = {
            source: "keeper",
            teams: matched.teams,
            ownership: matched.ownership,
            positions: matched.positions,
            platform: {
              fileName: meta.fileName || file.name || "players.csv",
              leagueName: meta.leagueName,
              fileStamp: meta.fileStamp,
              leagueType: "keeper"
            },
            matchedOwned: matched.matchedOwned,
            totalOwned: matched.totalOwned,
            unmatchedOwnedCount: matched.unmatchedOwnedCount,
            fromAccount: false,
            createdAt: prevCreated || undefined
          };
          state.cfg.leagueType = "keeper";
          applyImportedLeague(league, {
            infer: { leagueType: "keeper" },
            updatedAt: meta.updatedAt || undefined
          });
          const missN = matched.unmatchedOwnedCount;
          setLeagueStatus(
            "Loaded " +
              league.owners.length +
              " teams · matched " +
              matched.matchedOwned +
              "/" +
              matched.totalOwned +
              " rostered players" +
              (missN
                ? " · " + missN + " owned unmatched (often delisted / not in model)"
                : "")
          );
          await refresh();
          if (o.autoSave) await saveLeagueToAccount();
          if (o.redirectToTeams) afterModalImportSuccess();
          resolve(true);
        } catch (e) {
          console.error(e);
          state.league = null;
          setLeagueStatus(
            "Could not import CSV — " + (e && e.message ? e.message : "unknown error"),
            true
          );
          refresh();
          resolve(false);
        }
      };
      reader.onerror = function () {
        setLeagueStatus("Failed to read file.", true);
        resolve(false);
      };
      reader.readAsText(file);
    });
  }

  // ── League type defaults / account sync / AFL import ───────────────────────

  function squadSlotTotal(slots) {
    const s = slots || {};
    return (
      (Number(s.DEF) || 0) +
      (Number(s.MID) || 0) +
      (Number(s.RUC) || 0) +
      (Number(s.FWD) || 0) +
      (Number(s.FLX) || 0) +
      (Number(s.INT) || 0)
    );
  }

  function applyLeagueSettingsToCfg(settings, cfg) {
    if (!settings) return cfg;
    if (settings.bench != null) cfg.bench = Number(settings.bench) || cfg.bench;
    if (settings.keeperCount != null) {
      cfg.keeperCount = Number(settings.keeperCount) || 0;
    }
    if (settings.keeperCut === true || settings.keeperCut === false) {
      cfg.keeperCut = settings.keeperCut;
    }
    if (settings.slots && typeof settings.slots === "object") {
      SLOT_KEYS.forEach((k) => {
        if (settings.slots[k] != null) cfg.slots[k] = Number(settings.slots[k]) || 0;
      });
    }
    if (settings.endSeason != null) cfg.endSeason = Number(settings.endSeason) || cfg.endSeason;
    if (Array.isArray(settings.draftOrder)) cfg.draftOrder = settings.draftOrder.slice();
    if (settings.myTeam != null) cfg.myTeam = settings.myTeam || "";
    if (settings.leagueType) cfg.leagueType = settings.leagueType;
    if (settings.draftFormat === "linear" || settings.draftFormat === "snake") {
      cfg.draftFormat = settings.draftFormat;
    }
    if (settings.pickTrading === true || settings.pickTrading === false) {
      cfg.pickTrading = settings.pickTrading;
    }
    return cfg;
  }

  /**
   * @param {object} cfg
   * @param {object|null} league
   * @param {null|{leagueType?:string,draftStatus?:string,squadSize?:object,reserve?:number,reserveDraftRounds?:number,inferredKeeperCount?:number|null,year?:number}} infer
   */
  function applyLeagueTypeDefaults(cfg, league, infer) {
    const lt =
      (infer && infer.leagueType) ||
      cfg.leagueType ||
      (league && league.platform && league.platform.leagueType) ||
      null;
    if (!lt) return;
    cfg.leagueType = lt;

    const seasons = state.seasons || [];
    const pickEnd = (offsetFromStart) => {
      if (!seasons.length) return cfg.endSeason;
      const idx = Math.min(Math.max(0, offsetFromStart), seasons.length - 1);
      return seasons[idx];
    };

    if (infer && infer.slots) {
      SLOT_KEYS.forEach((k) => {
        if (infer.slots[k] != null) cfg.slots[k] = Number(infer.slots[k]) || 0;
      });
    }
    if (infer && infer.bench != null) cfg.bench = Number(infer.bench) || 0;

    if (lt === "redraft") {
      cfg.endSeason = pickEnd(0);
      cfg.keeperCount = 0;
      cfg.keeperCut = false;
    } else if (lt === "keeper") {
      cfg.endSeason = pickEnd(2);
      if (infer && infer.inferredKeeperCount != null) {
        cfg.keeperCount = Number(infer.inferredKeeperCount) || cfg.keeperCount;
      }
      if (infer && infer.draftStatus && infer.draftStatus !== "scheduled") {
        cfg.keeperCut = true;
      }
    } else if (lt === "dynasty") {
      cfg.endSeason = pickEnd(4);
      cfg.keeperCut = false;
      const squad = squadSlotTotal(cfg.slots) + (Number(cfg.bench) || 0);
      if (infer && infer.reserveDraftRounds != null) {
        // Dynasty: no cut UI; keepers ≈ full roster (everything is kept)
        cfg.keeperCount = Math.max(0, squad);
      } else {
        cfg.keeperCount = Math.max(0, squad);
      }
    }
  }

  function applyLeagueTypeUi(cfg) {
    const lt = cfg && cfg.leagueType;
    const hidePlanner = lt === "redraft";
    const hideCut = lt !== "keeper";

    document.querySelectorAll('.fd-tab-btn[data-tab="planner"]').forEach((btn) => {
      btn.style.display = hidePlanner ? "none" : "";
    });
    if (hidePlanner && cfg.tab === "planner") {
      setActiveTab("pool");
    }

    const finalisedRow = document.getElementById("fd-keepers-finalised-row");
    if (finalisedRow) finalisedRow.hidden = hideCut;

    const keepersRow = document.getElementById("fd-keepers-stepper-row");
    if (keepersRow) keepersRow.style.display = lt === "redraft" ? "none" : "";

    const typeSel = document.getElementById("cfg-leagueType");
    if (typeSel && lt) typeSel.value = lt;
  }

  function buildLeaguePersistPayload() {
    const league = state.league;
    const cfg = state.cfg;
    if (!league || !leagueHasTeams(league)) return null;

    const draftOrderIds = (cfg.draftOrder || [])
      .map((name) => teamIdByName(league, name))
      .filter(Boolean);
    const myTeamId = teamIdByName(league, cfg.myTeam);
    const nowIso = new Date().toISOString();
    const createdAt = league.createdAt || nowIso;
    league.createdAt = createdAt;
    league.updatedAt = nowIso;

    return {
      source: league.source || "keeper",
      createdAt,
      updatedAt: nowIso,
      platform: league.platform || {},
      teams: league.teams,
      ownership: league.ownership || {},
      positions: league.positions || {},
      settings: {
        bench: cfg.bench,
        keeperCount: cfg.keeperCount,
        keeperCut: cfg.keeperCut,
        slots: { ...cfg.slots },
        endSeason: cfg.endSeason,
        draftOrder: draftOrderIds,
        myTeam: myTeamId || "",
        leagueType: cfg.leagueType || null,
        draftFormat: cfg.draftFormat || "snake",
        pickTrading: cfg.pickTrading !== false
      }
    };
  }

  function hydrateLeagueFromPersist(raw) {
    if (!raw || !raw.teams || typeof raw.teams !== "object") return null;
    const league = {
      source: raw.source || "keeper",
      teams: raw.teams,
      ownership: raw.ownership || {},
      positions: raw.positions || {},
      platform: raw.platform || {},
      fromAccount: true,
      createdAt: raw.createdAt || null,
      updatedAt: raw.updatedAt || null
    };
    syncLeagueOwnersFromTeams(league);

    const settings = raw.settings || {};
    const draftNames = (settings.draftOrder || [])
      .map((id) => teamNameById(league, id))
      .filter(Boolean);
    const myName = teamNameById(league, settings.myTeam);

    state.league = league;
    state.cfg.teams = Math.max(2, league.owners.length || state.cfg.teams);
    applyLeagueSettingsToCfg(
      {
        bench: settings.bench,
        keeperCount: settings.keeperCount,
        keeperCut: settings.keeperCut,
        slots: settings.slots,
        endSeason: settings.endSeason,
        leagueType: settings.leagueType,
        draftOrder: draftNames,
        myTeam: myName,
        draftFormat: settings.draftFormat,
        pickTrading: settings.pickTrading
      },
      state.cfg
    );
    ensureDefaultMyTeam(league, state.cfg);
    applyLeagueTypeUi(state.cfg);
    syncMyTeamSelect(state.league, state.cfg);
    syncControlsToDom(state.cfg, state.seasons);
    updateAccountSyncUi();
    syncImportManageVisibility();
    return league;
  }

  function updateAccountSyncUi() {
    const saveBtn = document.getElementById("fd-league-save");
    const delBtn = document.getElementById("fd-league-delete");
    const hasLeague = leagueHasTeams(state.league);
    const loggedIn = !!state.accountUser;
    if (saveBtn) saveBtn.disabled = !hasLeague || !loggedIn;
    if (delBtn) delBtn.disabled = !hasLeague;
    syncImportManageVisibility();
  }

  async function waitForSbjAuth(timeoutMs) {
    const start = Date.now();
    const limit = timeoutMs == null ? 8000 : timeoutMs;
    while (!window.SbjAuth) {
      if (Date.now() - start > limit) return null;
      await new Promise((r) => setTimeout(r, 50));
    }
    return window.SbjAuth;
  }

  async function saveLeagueToAccount() {
    const sbj = await waitForSbjAuth();
    if (!sbj || !sbj.currentUser) {
      setLeagueStatus("Log in to save your league to your account.", true);
      return;
    }
    const payload = buildLeaguePersistPayload();
    if (!payload) {
      setLeagueStatus("Import a league before saving.", true);
      return;
    }
    try {
      const { doc, setDoc } = await import(
        "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js"
      );
      const userRef = doc(sbj.db, "users", sbj.currentUser.uid);
      await setDoc(userRef, { league: payload }, { merge: true });
      if (state.league) {
        state.league.fromAccount = true;
        state.league.createdAt = payload.createdAt;
        state.league.updatedAt = payload.updatedAt;
      }
      setLeagueStatus("Saved league to your account.");
      updateAccountSyncUi();
      renderImportSourceCard();
      writeCfgToUrl(state.cfg);
    } catch (e) {
      console.error(e);
      setLeagueStatus(
        "Save failed — " + (e && e.message ? e.message : "unknown error"),
        true
      );
    }
  }

  async function deleteLeagueFromAccount() {
    const sbj = await waitForSbjAuth();
    if (!sbj || !sbj.currentUser) return;
    if (!window.confirm("Delete saved league data from your account?")) return;
    try {
      const { doc, setDoc, deleteField } = await import(
        "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js"
      );
      const userRef = doc(sbj.db, "users", sbj.currentUser.uid);
      await setDoc(userRef, { league: deleteField() }, { merge: true });
      clearKeeperLeague();
      setLeagueStatus("Deleted saved league from your account.");
    } catch (e) {
      console.error(e);
      setLeagueStatus(
        "Delete failed — " + (e && e.message ? e.message : "unknown error"),
        true
      );
    }
  }

  async function loadLeagueFromAccount() {
    const sbj = await waitForSbjAuth();
    if (!sbj) return;
    const { user } = await sbj.authReady;
    state.accountUser = user || null;
    updateAccountSyncUi();
    if (state.cfg.tab === "import") syncImportTabUi();
    if (!user) return;
    try {
      const { doc, getDoc } = await import(
        "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js"
      );
      const snap = await getDoc(doc(sbj.db, "users", user.uid));
      if (!snap.exists()) return;
      const data = snap.data() || {};
      if (!data.league) return;
      hydrateLeagueFromPersist(data.league);
      setLeagueStatus("Loaded league from your account.");
      await refresh();
    } catch (e) {
      console.error(e);
      setLeagueStatus(
        "Could not load saved league — " + (e && e.message ? e.message : "error"),
        true
      );
    }
  }

  function parseAflShareInput(raw) {
    const s = String(raw || "").trim();
    if (!s) return "";
    if (/^[a-f0-9]{16,}$/i.test(s)) return s;
    let m = s.match(/\/draft\/league\/\d+\/draft\/([a-f0-9]{16,})/i);
    if (m) return m[1];
    m = s.match(/\/draft\/([a-f0-9]{16,})(?:[/?#]|$)/i);
    return m ? m[1] : "";
  }

  async function importAflLeagueFromShare(urlOrHash, opts) {
    const o = opts || {};
    const sbj = await waitForSbjAuth();
    if (!sbj || !sbj.currentUser) {
      setLeagueStatus("Log in to import an AFL Fantasy league.", true);
      return false;
    }
    const leagueHash = parseAflShareInput(urlOrHash);
    if (!leagueHash) {
      setLeagueStatus("Paste a valid AFL Fantasy draft share URL.", true);
      return false;
    }
    setLeagueStatus("Fetching AFL Fantasy league…");
    try {
      const token = await sbj.getAuthToken();
      const res = await fetch(AFL_IMPORT_FN_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + token
        },
        body: JSON.stringify({ leagueHash })
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error((body && body.error) || "HTTP " + res.status);
      }
      const prevCreated =
        state.league && state.league.source === "afl"
          ? state.league.createdAt
          : null;
      const league = {
        source: "afl",
        teams: body.teams || {},
        ownership: body.ownership || {},
        positions: {},
        platform: body.platform || { leagueHash },
        fromAccount: !!o.fromAccount,
        createdAt: prevCreated || undefined
      };
      applyImportedLeague(league, { infer: body.infer || null });
      const nOwn = Object.keys(league.ownership).length;
      setLeagueStatus(
        "AFL Fantasy · " +
          league.owners.length +
          " teams · " +
          nOwn +
          " rostered players" +
          (body.platform && body.platform.leagueName
            ? " · " + body.platform.leagueName
            : "")
      );
      await refresh();
      if (o.autoSave) await saveLeagueToAccount();
      if (o.redirectToTeams) afterModalImportSuccess();
      return true;
    } catch (e) {
      console.error(e);
      setLeagueStatus(
        "AFL import failed — " + (e && e.message ? e.message : "unknown error"),
        true
      );
      return false;
    }
  }

  async function refreshAflLeague() {
    const hash =
      state.league &&
      state.league.platform &&
      state.league.platform.leagueHash;
    if (!hash) {
      setLeagueStatus("No AFL league hash to refresh.", true);
      return;
    }
    await importAflLeagueFromShare(hash, {
      fromAccount: !!(state.league && state.league.fromAccount),
      autoSave: !!(state.league && state.league.fromAccount)
    });
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

  /** Cumulative expected games: Σ pListed × xGames through index i (inclusive). */
  function cumExpectedGames(asset, i) {
    if (!asset || i < 0) return null;
    const xg = asset.xGames;
    const pl = asset.probListed;
    if (!xg || !xg.length) return null;
    let s = 0;
    let any = false;
    const n = Math.min(i + 1, xg.length);
    for (let j = 0; j < n; j++) {
      const g = Number(xg[j]);
      if (!Number.isFinite(g)) continue;
      const p = pl && pl.length > j ? Number(pl[j]) : 1;
      s += g * (Number.isFinite(p) ? p : 1);
      any = true;
    }
    return any ? s : null;
  }

  /** Value-weighted mean xAvg over horizon (weights = pListed × xGames). */
  function weightedXAvg(asset, h) {
    if (!asset) return null;
    const xa = asset.xAvg;
    const xg = asset.xGames;
    const pl = asset.probListed;
    if (!xa || !xa.length) return null;
    let num = 0;
    let den = 0;
    const n = Math.min(h, xa.length);
    for (let i = 0; i < n; i++) {
      const a = Number(xa[i]);
      if (!Number.isFinite(a)) continue;
      const g = xg && xg.length > i ? Number(xg[i]) : 0;
      const p = pl && pl.length > i ? Number(pl[i]) : 1;
      const w = (Number.isFinite(g) ? g : 0) * (Number.isFinite(p) ? p : 1);
      if (w <= 0) continue;
      num += a * w;
      den += w;
    }
    return den > 0 ? num / den : numAt(xa, Math.max(0, h - 1));
  }

  function meanPos(asset, pos, h) {
    const arr = asset.pos && asset.pos[pos];
    if (!arr || !arr.length) return 0;
    let s = 0;
    const n = Math.min(h, arr.length);
    for (let i = 0; i < n; i++) s += Number(arr[i]) || 0;
    return n ? s / n : 0;
  }

  /**
   * Horizon-mean positional weights for VORP replacement.
   * Same uniform→fantasyPos fallback as seasonPosProbs (lineup path).
   * Picks keep their real draft-class priors (non-uniform pos[]).
   */
  function assetPosWeights(asset, h) {
    const out = { DEF: 0, MID: 0, RUC: 0, FWD: 0 };
    let any = false;
    POS_KEYS.forEach((p) => {
      const v = meanPos(asset, p, h);
      out[p] = v;
      if (v > 0) any = true;
    });
    if (any) {
      const vals = POS_KEYS.map((p) => out[p]);
      const first = vals[0];
      const uniform =
        vals.every((v) => Math.abs(v - first) < 1e-6) && first > 0;
      if (!uniform) return out;
    }
    const keys = (
      Array.isArray(asset && asset.fantasyPos)
        ? asset.fantasyPos
        : String((asset && asset.fantasyPos) || "").split("/")
    )
      .map((p) => String(p || "").trim())
      .filter((p) => POS_KEYS.indexOf(p) >= 0);
    POS_KEYS.forEach((p) => {
      out[p] = 0;
    });
    if (!keys.length) return out;
    keys.forEach((p) => {
      out[p] = 1;
    });
    return out;
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
      const P = assetPosWeights(a, h);
      const score = {};
      POS_KEYS.forEach((p) => {
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
        event: (a.delta && a.delta.event) || (a.event) || null,
        xAvg: weightedXAvg(a, r.h),
        xGames: cumExpectedGames(a, last),
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

  /** National draft pick asset ids are PICK_YYYY_NN (not KD_PICK_* proxies). */
  function isNationalPickAsset(r) {
    return !!(r && String(r.id || "").indexOf("PICK_") === 0);
  }

  /** True for keeper-league top-up slots (KD / type=pick without a national id). */
  function isKeeperLeaguePick(r) {
    if (!r) return false;
    const id = String(r.id || "");
    const key = String(r.key || "");
    if (id.indexOf("KD_PICK_") === 0 || key.indexOf("PICK:") === 0) return true;
    // National pool assets (PICK_YYYY_*) are not keeper slots.
    if (isNationalPickAsset(r)) return false;
    if (r.type === "pick") return true;
    return false;
  }

  /** Material Person icon — national / real AFL draftee placeholder. */
  function personIconHtml(className) {
    return (
      '<span class="' +
      (className || "fd-headshot fd-headshot-pick") +
      '" aria-hidden="true">' +
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" focusable="false">' +
      '<path fill="currentColor" d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/>' +
      "</svg></span>"
    );
  }

  /** Material Library-add icon — keeper-league draft slot (not a real AFL asset). */
  function libraryAddIconHtml() {
    return (
      '<span class="tc-pick-icon" aria-hidden="true">' +
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="28" height="28" focusable="false">' +
      '<path fill="currentColor" d="M4 6H2v14c0 1.1.9 2 2 2h14v-2H4V6zm16-4H8c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-1 9h-4v4h-2v-4H9V9h4V5h2v4h4v2z"/>' +
      "</svg></span>"
    );
  }

  function pickIconHtml(row) {
    // Only real PICK_YYYY_* pool assets get the person icon — never KD slots,
    // even when their value proxy is a national pick.
    if (isNationalPickAsset(row) && !isKeeperLeaguePick(row)) {
      return personIconHtml("fd-headshot fd-headshot-pick");
    }
    return libraryAddIconHtml();
  }

  /** ChampID / AFL Fantasy player id (digits). Accepts legacy CD_I prefix. */
  function pulsePlayerId(row) {
    if (!row || row.type === "pick") return "";
    const id = String(row.id || "");
    if (!id) return "";
    if (/^CD_I\d+$/i.test(id)) return id.replace(/^CD_I/i, "");
    if (/^\d+$/.test(id)) return id;
    return "";
  }

  function headshotHtml(row) {
    if (isNationalPickAsset(row)) {
      return personIconHtml("fd-headshot fd-headshot-pick");
    }
    if (isKeeperLeaguePick(row) || row.type === "pick") {
      return libraryAddIconHtml();
    }
    const pid = pulsePlayerId(row);
    if (!pid) {
      return personIconHtml("fd-headshot fd-headshot-pick");
    }
    const src = HEADSHOT_BASE + pid + ".png?im=Resize=(80,80)";
    return (
      '<span class="fd-headshot">' +
      '<img src="' +
      src +
      '" alt="" loading="lazy" onerror="this.parentNode.classList.add(\'fd-headshot-empty\');this.remove();">' +
      "</span>"
    );
  }

  function teamChipHtml(abbr) {
    if (!abbr) return "";
    return (
      '<span class="fd-team-chip fd-team-' +
      escapeHtml(abbr) +
      '">' +
      escapeHtml(abbr) +
      "</span>"
    );
  }

  function nationalPicksForYear(rows, draftYear) {
    const y = Number(draftYear);
    if (!Number.isFinite(y)) return [];
    const prefix = "PICK_" + y + "_";
    return (rows || [])
      .filter((r) => isNationalPickAsset(r) && String(r.id).indexOf(prefix) === 0)
      .slice()
      .sort(
        (a, b) =>
          (b.vorp || 0) - (a.vorp || 0) ||
          (a.name || "").localeCompare(b.name || "") ||
          String(a.id).localeCompare(String(b.id))
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
      teamChipHtml(abbr) +
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

  /** AFL H&A-ish season length for cover need (slots × games). */
  const COVER_GAMES_SEASON = 23;
  /** Cover is "enough" when Σ xGamesPOS ≥ this × slots × games. */
  const COVER_ADEQUACY = 0.8;

  /** Expected games at `pos` for one horizon year (xGamesPOS, else pos% × xGames). */
  function seasonXGamesAtPos(row, pos, yearIdx) {
    const a = row && row._asset;
    const xgPos = numAt(a && a["xGames" + pos], yearIdx);
    if (Number.isFinite(xgPos) && xgPos > 0) return xgPos;
    const probs = seasonPosProbs(row, yearIdx);
    const xg = numAt(a && a.xGames, yearIdx);
    const g = Number.isFinite(xg) ? Math.max(0, xg) : 0;
    const pl = numAt(a && a.probListed, yearIdx);
    const pList = Number.isFinite(pl) ? pl : 1;
    return Math.max(0, (probs[pos] || 0) * g * pList);
  }

  /**
   * Season points with xGames cover: on-field always counts; bench/depth counts
   * in full when that position's Σ xGamesPOS covers ~80% of slots × games.
   * Example: 5 DEFs with strong xGamesDEF vs 4 slots → all five count.
   */
  function coverWeightedSeasonPoints(players, cfg, yearIdx, opts) {
    const list = (players || []).filter(Boolean);
    if (!list.length) return 0;
    const lineup = buildSeasonLineup(list, cfg, yearIdx, opts || {});
    const onFieldIds = new Set();
    POS_KEYS.forEach((pos) => {
      (lineup.filled[pos] || []).forEach((s) => {
        if (s && s.player && s.player.id != null) onFieldIds.add(s.player.id);
      });
    });
    const cover = { DEF: 0, MID: 0, RUC: 0, FWD: 0 };
    list.forEach((p) => {
      POS_KEYS.forEach((pos) => {
        cover[pos] += seasonXGamesAtPos(p, pos, yearIdx);
      });
    });
    const adequate = {};
    POS_KEYS.forEach((pos) => {
      const need =
        (Number(cfg.slots && cfg.slots[pos]) || 0) * COVER_GAMES_SEASON;
      adequate[pos] = need <= 0 || cover[pos] >= COVER_ADEQUACY * need;
    });
    let pts = 0;
    list.forEach((p) => {
      const xp = seasonXPoints(p, yearIdx);
      if (!(xp > 0) && xp !== 0) return;
      if (onFieldIds.has(p.id)) {
        pts += xp;
        return;
      }
      const counts = POS_KEYS.some(
        (pos) => canPlaySeasonPos(p, pos, yearIdx) && adequate[pos]
      );
      if (counts) pts += xp;
    });
    return pts;
  }

  function coverWeightedYearPoints(players, cfg, yearCount, opts) {
    const out = [];
    for (let i = 0; i < yearCount; i++) {
      out.push(coverWeightedSeasonPoints(players, cfg, i, opts));
    }
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
   * Falls back to fantasyPos/keeperPos one-hot when pos[] is missing or
   * flat/uniform (e.g. 0.25×4 from export when n+1 probs are unknown).
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
    if (any) {
      const vals = POS_KEYS.map((p) => out[p]);
      const first = vals[0];
      const uniform =
        vals.every((v) => Math.abs(v - first) < 1e-6) && first > 0;
      if (!uniform) return out;
    }
    const keys = playerFantasyPosKeys(row);
    if (!keys.length) {
      const kp = String((row && row.keeperPos) || "")
        .split("/")
        .map((p) => p.trim())
        .filter((p) => POS_KEYS.indexOf(p) >= 0);
      kp.forEach((p) => {
        out[p] = 1;
      });
      if (kp.length) {
        POS_KEYS.forEach((p) => {
          if (kp.indexOf(p) < 0) out[p] = 0;
        });
      }
      return out;
    }
    POS_KEYS.forEach((p) => {
      out[p] = 0;
    });
    keys.forEach((p) => {
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
      .filter((r) => r.type !== "pick" && !!pulsePlayerId(r))
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

  /**
   * Pre-draft (cut on): roster − keepers (default 10).
   * Post-draft (cut off): 0 invented picks — full roster already filled.
   */
  function keeperDraftPicksPerTeam(cfg) {
    const cutOn = resolveKeeperCut(cfg, state.data, state.seasons);
    if (!cutOn) return 0;
    return Math.max(0, rosterSize(cfg) - (Number(cfg.keeperCount) || 0));
  }

  /** Per-team kept roster + cover-weighted year xPoints / VORP. Through = endSeason. */
  function buildTeamStandings(rows, league, cfg) {
    const cutOn = resolveKeeperCut(cfg, state.data, state.seasons);
    const yLen = horizonLen(state.seasons, cfg.endSeason) || state.seasons.length;
    return (league.owners || []).map((owner) => {
      const players = rows.filter((r) => r.owner === owner);
      const split = splitRosterByKeepers(players, cfg, owner, cutOn);
      const counted = split.kept;
      const yearPts = coverWeightedYearPoints(counted, cfg, yLen);
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

  function sortBySeasonXp(a, b, yearIdx) {
    return (
      seasonXPoints(b, yearIdx) - seasonXPoints(a, yearIdx) ||
      (b.vorp || 0) - (a.vorp || 0) ||
      (a.name || "").localeCompare(b.name || "") ||
      String(a.id).localeCompare(String(b.id))
    );
  }

  /** Share of a line still empty (1 = fully empty). */
  function posEmptyShare(pos, remaining, need) {
    const n = need[pos] || 0;
    if (n <= 0) return -1;
    return (remaining[pos] || 0) / n;
  }

  /**
   * Emptiest on-field line by remaining/need; ties → more absolute empty → POS order.
   * When priors (e.g. pick pos shares) are provided, score = emptyShare × prior.
   */
  function emptiestOpenPos(remaining, need, priors) {
    let best = null;
    let bestScore = -1;
    let bestRem = -1;
    POS_KEYS.forEach((pos) => {
      const rem = remaining[pos] || 0;
      if (rem <= 0) return;
      const share = posEmptyShare(pos, remaining, need);
      const prior =
        priors && Number.isFinite(Number(priors[pos]))
          ? Math.max(0, Number(priors[pos]))
          : 1;
      const score = share * prior;
      if (
        score > bestScore ||
        (score === bestScore && rem > bestRem) ||
        (score === bestScore && rem === bestRem && (best == null || pos < best))
      ) {
        best = pos;
        bestScore = score;
        bestRem = rem;
      }
    });
    return best;
  }

  /**
   * Place roster into on-field formation then bench for one season.
   * Kept assets: greedy by season xPoints into eligible positions.
   * opts.mustInclude (new picks): draft order into the proportionally emptiest
   * open line; leftover picks take bench before remaining kept assets.
   */
  function buildSeasonLineup(players, cfg, yearIdx, opts) {
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
    const mustList = ((opts && opts.mustInclude) || []).slice();
    const mustIds = new Set(mustList.map((p) => p && p.id).filter(Boolean));
    // Draft order: earlier overall pick first (R1 before R2…)
    const mustRanked = mustList.slice().sort((a, b) => {
      const pa = a && a._pick;
      const pb = b && b._pick;
      return (
        ((pa && pa.pick) || 0) - ((pb && pb.pick) || 0) ||
        ((pa && pa.round) || 0) - ((pb && pb.round) || 0) ||
        String(a.id).localeCompare(String(b.id))
      );
    });
    const restRanked = (players || [])
      .filter((p) => p && !mustIds.has(p.id))
      .slice()
      .sort((a, b) => sortBySeasonXp(a, b, yearIdx));
    const ranked = restRanked.concat(mustRanked);

    function placeOnField(p, pos) {
      filled[pos].push({
        player: p,
        pos,
        xp: seasonXPoints(p, yearIdx),
        probs: seasonPosProbs(p, yearIdx)
      });
      remaining[pos] -= 1;
      used.add(p.id);
    }

    // 1) Kept assets claim eligible on-field spots
    restRanked.forEach((p) => {
      if (!p || used.has(p.id)) return;
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
      placeOnField(p, open[0]);
    });

    // 2) Incoming picks: emptiest line × pick pos priors (nationals); any line
    mustRanked.forEach((p) => {
      if (!p || used.has(p.id)) return;
      const priors = seasonPosProbs(p, yearIdx);
      const pos = emptiestOpenPos(remaining, need, priors);
      if (!pos) return;
      placeOnField(p, pos);
    });

    const benchN = Math.max(0, Number(cfg.bench) || 0);
    const bench = [];
    function tryBench(p) {
      if (!p || used.has(p.id) || bench.length >= benchN) return;
      bench.push({
        player: p,
        pos: "BENCH",
        xp: seasonXPoints(p, yearIdx),
        probs: seasonPosProbs(p, yearIdx)
      });
      used.add(p.id);
    }
    // 3) Leftover picks → bench, then remaining kept
    mustRanked.forEach(tryBench);
    restRanked.forEach(tryBench);

    // Last resort: bump lowest kept bench seat so every pick fits
    mustRanked.forEach((p) => {
      if (!p || used.has(p.id)) return;
      let worstIdx = -1;
      let worstXp = Infinity;
      for (let i = 0; i < bench.length; i++) {
        const bp = bench[i].player;
        if (mustIds.has(bp.id)) continue;
        const xp = seasonXPoints(bp, yearIdx);
        if (xp < worstXp) {
          worstXp = xp;
          worstIdx = i;
        }
      }
      if (worstIdx < 0) return;
      const bumped = bench[worstIdx].player;
      used.delete(bumped.id);
      bench[worstIdx] = {
        player: p,
        pos: "BENCH",
        xp: seasonXPoints(p, yearIdx),
        probs: seasonPosProbs(p, yearIdx)
      };
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
    const isNat = isNationalPickAsset(r) && !isKeeperLeaguePick(r);
    const isPick = r.type === "pick" || isNat || isKeeperLeaguePick(r);
    if (isPick) {
      const tip =
        r._pick && r._pick.proxyName
          ? r.name + " · proxy " + r._pick.proxyName
          : r.name || "";
      const abbr = isNat ? r.teamAbbr || r.club || "" : "";
      return (
        '<div class="lt-player tc-pick-row' +
        (belowCut ? " lt-below-cut" : "") +
        '">' +
        pickIconHtml(r) +
        '<div class="lt-player-meta">' +
        '<div class="lt-player-name" title="' +
        escapeHtml(tip) +
        '">' +
        escapeHtml(r.name || "") +
        "</div>" +
        '<div class="lt-player-chips">' +
        teamChipHtml(abbr) +
        (isNat ? "" : '<span class="fd-pos-chip">PICK</span>') +
        "</div>" +
        "</div>" +
        '<div class="fp-player-xp">' +
        fmtInt(slot.xp) +
        "</div>" +
        "</div>"
      );
    }
    const abbr = r.teamAbbr || r.club || "";
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
      teamChipHtml(abbr) +
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
    const initialCut = split.cut || [];

    const yearSeasons = state.seasons.slice();
    if (!yearSeasons.length) {
      el.innerHTML = "<p class='muted'>No seasons available.</p>";
      return;
    }

    // Planner: draft class every season. Trades still call yearCount=1.
    const unowned = unownedAfterCuts(rows, league, cfg);
    const allPicks = buildKeeperDraftPicks(
      unowned,
      cfg,
      yearSeasons,
      rows,
      league,
      { yearCount: yearSeasons.length }
    );
    const picksByOwner = Object.create(null);
    (league.owners || []).forEach((o) => {
      picksByOwner[o] = [];
    });
    allPicks.forEach((p) => {
      if (!picksByOwner[p.owner]) picksByOwner[p.owner] = [];
      picksByOwner[p.owner].push(p);
    });

    // Rolling keep-20 + add-10 path for every team (Proj ranks + my boards)
    const pathsByOwner = Object.create(null);
    const plannerYearPts = (league.owners || []).map((owner) => {
      const owned = rows.filter((r) => r.owner === owner && r.type !== "pick");
      const k = splitRosterByKeepers(owned, cfg, owner, cutOn).kept;
      const path = buildPlannerSeasonPath(
        k,
        picksByOwner[owner] || [],
        cfg,
        yearSeasons
      );
      pathsByOwner[owner] = path;
      return { owner, yearPts: path.yearPts };
    });

    const myPath = pathsByOwner[myTeam] || {
      boards: [],
      yearPts: []
    };
    const boards = myPath.boards.map((b) => {
      const cutList =
        b.yi === 0 && cutOn && cutN > 0
          ? initialCut.concat(b.cutList || [])
          : b.cutList || [];
      return {
        year: b.year,
        yi: b.yi,
        lineup: b.lineup,
        isFirst: b.yi === 0,
        rank: ladderRankForOwner(plannerYearPts, myTeam, b.yi),
        yearPts: b.yearPts,
        cutList,
        pickCount: b.pickCount,
        keptCount: (b.kept || []).length
      };
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
        const cutList = b.cutList || [];
        if (cutList.length) {
          const cutTitle = b.isFirst ? "Keeper cut" : "Squad cut";
          const keptHave = b.isFirst ? keepers.length : b.keptCount;
          const keptNeed = cutN > 0 ? cutN : keptHave;
          body +=
            '<div class="lt-cut" role="separator" title="' +
            cutTitle +
            '">' +
            "<span>" +
            cutTitle +
            " · " +
            keptHave +
            "/" +
            keptNeed +
            "</span>" +
            "</div>";
          cutList.forEach((p) => {
            body += plannerPlayerRowHtml(
              {
                player: p,
                xp: seasonXPoints(p, b.yi),
                pos: "CUT"
              },
              true
            );
          });
        }
        const projLabel =
          b.rank != null ? "Proj " + ordinalRank(b.rank) : "Proj —";
        const sub =
          b.isFirst && b.pickCount
            ? "Keepers + " + b.pickCount + " picks"
            : b.isFirst
              ? "Current team · keepers"
              : b.keptCount + " kept + " + b.pickCount + " picks";
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
          sub +
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
   * Fallback when no Import-tab draft order is set.
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

  /**
   * Draft order for snake: Import-tab order (best→worst) when complete,
   * else projected keeper ladder. R1 still snakes worst→best via snakeDraftSlots.
   */
  function draftOrderBestToWorst(rows, league, cfg) {
    const owners = (league && league.owners) || [];
    const order = (cfg && cfg.draftOrder) || [];
    if (order.length && owners.length) {
      const set = new Set(owners);
      const filtered = order.filter((o) => set.has(o));
      if (filtered.length === owners.length) return filtered.slice();
      // Partial import: keep listed first, append missing by projected rank
      const missing = projectedLadderBestToWorst(rows, league, cfg).filter(
        (o) => filtered.indexOf(o) < 0
      );
      return filtered.concat(missing);
    }
    return projectedLadderBestToWorst(rows, league, cfg);
  }

  function snakeDraftSlots(ownersBestToWorst, rounds, draftFormat) {
    const slots = [];
    const linear = draftFormat === "linear";
    for (let r = 0; r < rounds; r++) {
      const order =
        linear || r % 2 === 0
          ? ownersBestToWorst.slice().reverse() // R1 / linear: worst picks first
          : ownersBestToWorst.slice(); // Snake even rounds: best picks first
      order.forEach((owner) => {
        slots.push({ owner, round: r + 1 });
      });
    }
    return slots;
  }

  /**
   * Snake-draft pick slots with unowned proxies.
   * yearCount=1 (default): upcoming draft only — used by Trades.
   * yearCount>1: one draft class per horizon season — used by Planner.
   * Value pool = that year's national PICK_YYYY_* + remaining FAs (VORP-ranked).
   * Slots are always keeper-league assets (KD id / R# name / no AFL club) —
   * national picks only supply proxy value, never slot identity or club chips.
   */
  function buildKeeperDraftPicks(unowned, cfg, seasons, rows, league, opts) {
    const yearSeasons = seasons.slice();
    const yLen = yearSeasons.length;
    const yearCount = Math.max(
      1,
      Math.min(yLen || 1, Number(opts && opts.yearCount) || 1)
    );
    const perTeam = keeperDraftPicksPerTeam(cfg);
    const standings = buildTeamStandings(rows, league, cfg);
    const faRemaining = (unowned || []).slice();
    const out = [];

    for (let yi = 0; yi < yearCount; yi++) {
      const draftYear = yearSeasons[yi] || seasons[yi] || "";
      const natPicks = nationalPicksForYear(rows, draftYear);
      const pool = natPicks.concat(faRemaining);
      // Rank like keepers: horizon VORP first (Through), not season-yi xPoints.
      pool.sort(
        (a, b) =>
          (b.vorp || 0) - (a.vorp || 0) ||
          seasonXPoints(b, yi) - seasonXPoints(a, yi) ||
          (a.name || "").localeCompare(b.name || "") ||
          String(a.id).localeCompare(String(b.id))
      );
      const ladder =
        yi === 0
          ? draftOrderBestToWorst(rows, league, cfg)
          : standings
              .slice()
              .sort(
                (a, b) =>
                  ((b.yearPts && b.yearPts[yi]) || 0) -
                    ((a.yearPts && a.yearPts[yi]) || 0) ||
                  (b.vorp || 0) - (a.vorp || 0) ||
                  a.owner.localeCompare(b.owner)
              )
              .map((t) => t.owner);
      const slots = snakeDraftSlots(ladder, perTeam, cfg.draftFormat || "snake");
      const singleYear = yearCount === 1;
      const usedFaIds = new Set();
      slots.forEach((slot, i) => {
        const proxy = pool[i] || null;
        const proxyIsNat = !!(proxy && isNationalPickAsset(proxy));
        if (proxy && !proxyIsNat) usedFaIds.add(proxy.id);
        const ypts = proxy
          ? yearPointsForRow(proxy, yLen)
          : Array.from({ length: yLen }, () => 0);
        const overall = i + 1;
        out.push({
          // Slot-stable keys (not proxy id) so trades survive pool re-rank.
          key: singleYear
            ? "PICK:" + overall
            : "PICK:" + draftYear + ":" + overall,
          pick: overall,
          round: slot.round,
          owner: slot.owner,
          seasonIdx: yi,
          draftYear: draftYear,
          // Always KD identity — never adopt PICK_YYYY_* / AFL club from proxy.
          id: singleYear
            ? "KD_PICK_" + String(overall).padStart(2, "0")
            : "KD_PICK_" + draftYear + "_" + String(overall).padStart(2, "0"),
          name: draftYear + " R" + slot.round + " (#" + overall + ")",
          vorp: proxy ? Number(proxy.vorp) || 0 : 0,
          yearPts: ypts,
          club: "",
          proxyName: proxy ? proxy.name : null,
          proxyId: proxy ? proxy.id : null,
          proxyRow: proxy
        });
      });
      // Drop used free agents; unused nationals stay out of later FA pools
      // (each later year gets its own PICK_YYYY_* class via nationalPicksForYear).
      for (let i = faRemaining.length - 1; i >= 0; i--) {
        if (usedFaIds.has(faRemaining[i].id)) faRemaining.splice(i, 1);
      }
    }
    return out;
  }

  /** Synthetic roster row so planner lineups can place a pick via its proxy. */
  function plannerPlayerFromPick(pick) {
    const proxy = pick && pick.proxyRow;
    const proxyIsNat = !!(proxy && isNationalPickAsset(proxy));
    const proxyAsset = proxy && proxy._asset ? proxy._asset : null;
    const asset = proxyAsset
      ? proxyAsset
      : {
          xPoints: (pick.yearPts || []).slice(),
          pos: proxyIsNat && proxy && proxy.pos ? proxy.pos : undefined
        };
    // Value proxy may be a national pick — copy pos priors only, never club.
    if (proxyIsNat && proxy && proxy.pos && !asset.pos) {
      asset.pos = proxy.pos;
    }
    return {
      id: pick.id,
      name: pick.name,
      owner: pick.owner,
      type: "pick",
      vorp: Number(pick.vorp) || 0,
      teamAbbr: "",
      club: "",
      fantasyPos: "",
      keeperPos: "",
      event: null,
      _asset: asset,
      _pick: pick
    };
  }

  /**
   * Pre-draft cut: keep top keeperCount by season xPoints, cut the rest
   * (rosterSize − keepers, e.g. 10). Incoming picks are added after this.
   */
  function cutDownToKeepers(roster, cfg, yearIdx) {
    const keepN = Math.max(0, Number(cfg.keeperCount) || 0);
    const ranked = (roster || [])
      .slice()
      .sort((a, b) => sortBySeasonXp(a, b, yearIdx));
    return {
      kept: ranked.slice(0, keepN),
      cut: ranked.slice(keepN)
    };
  }

  /**
   * Rolling planner path: each season keep 20 from prior roster, add that
   * year's picks (locked into lineup). Returns per-season boards + yearPts.
   */
  function buildPlannerSeasonPath(initialKeepers, ownerPicks, cfg, yearSeasons) {
    const picksBySeason = Object.create(null);
    (ownerPicks || []).forEach((p) => {
      const yi = Number(p.seasonIdx) || 0;
      if (!picksBySeason[yi]) picksBySeason[yi] = [];
      picksBySeason[yi].push(p);
    });

    let prevRoster = null;
    const boards = [];
    const yearPts = [];

    yearSeasons.forEach((year, yi) => {
      let kept;
      let cutList;
      if (yi === 0) {
        kept = (initialKeepers || []).slice();
        cutList = [];
      } else {
        const split = cutDownToKeepers(prevRoster, cfg, yi);
        kept = split.kept;
        cutList = split.cut;
      }
      const newPicks = (picksBySeason[yi] || []).map(plannerPlayerFromPick);
      const active = kept.concat(newPicks);
      const lineupOpts = { mustInclude: newPicks };
      const lineup = buildSeasonLineup(active, cfg, yi, lineupOpts);
      const pts = coverWeightedSeasonPoints(active, cfg, yi, lineupOpts);
      yearPts.push(pts);
      prevRoster = active;
      boards.push({
        year,
        yi,
        lineup,
        cutList,
        kept,
        newPicks,
        active,
        pickCount: newPicks.length,
        yearPts: pts
      });
    });

    return { boards, yearPts };
  }

  function fmtSigned(v) {
    if (v == null || !Number.isFinite(v)) return "—";
    const n = Math.round(v);
    return (n > 0 ? "+" : "") + String(n);
  }

  function tradeAssetMap(rows, picks, keptSets) {
    const yLen = horizonLen(state.seasons, state.cfg.endSeason) || state.seasons.length;
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
        yearPts: (p.yearPts || []).slice(0, yLen),
        proxyName: p.proxyName,
        pick: p.pick,
        round: p.round,
        owner: p.owner,
        belowCut: false,
        // KD slots never inherit AFL club from a national value proxy.
        club: "",
        proxyRow: p.proxyRow || null,
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
   * Cut follows resolveKeeperCut (toggle / imported ≤ keepers / upcoming picks).
   * League rule: nPicks = roster − keepers; trading picks changes which picks
   * you hold (e.g. two 1sts, lose a late round), not keeper count or slot count.
   */
  function teamTradeTotals(rows, owner, cfg, pickOwnerByKey, picksByKey) {
    const cutOn = resolveKeeperCut(cfg, state.data, state.seasons);
    const yLen = horizonLen(state.seasons, cfg.endSeason) || state.seasons.length;
    const players = rows.filter((r) => r.owner === owner);
    const split = splitRosterByKeepers(players, cfg, owner, cutOn);
    const yearPts = coverWeightedYearPoints(split.kept, cfg, yLen);
    let vorp = split.kept.reduce((s, p) => s + (Number(p.vorp) || 0), 0);
    Object.keys(pickOwnerByKey || {}).forEach((k) => {
      if (pickOwnerByKey[k] !== owner) return;
      const pk = picksByKey[k];
      if (!pk) return;
      vorp += Number(pk.vorp) || 0;
      for (let i = 0; i < yLen; i++) yearPts[i] += (pk.yearPts && pk.yearPts[i]) || 0;
    });
    return { yearPts, vorp, split };
  }

  /** Draft picks each team may hold: rosterSize − keepers (default 10). */
  function nPicksCap(cfg) {
    return Math.max(0, rosterSize(cfg) - (Number(cfg.keeperCount) || 0));
  }

  /**
   * If owner holds more than nPicks, drop highest overall pick numbers first
   * (e.g. #96 before #50). Dropped keys are removed from pickOwnerByKey.
   */
  function trimOwnerPicksToCap(pickOwnerByKey, picksByKey, owner, cap) {
    if (!pickOwnerByKey || !owner || !(cap >= 0)) return [];
    const owned = Object.keys(pickOwnerByKey).filter(
      (k) => pickOwnerByKey[k] === owner
    );
    if (owned.length <= cap) return [];
    owned.sort((a, b) => {
      const pa = picksByKey && picksByKey[a];
      const pb = picksByKey && picksByKey[b];
      return (
        (Number(pb && pb.pick) || 0) - (Number(pa && pa.pick) || 0) ||
        String(b).localeCompare(String(a))
      );
    });
    const dropped = [];
    const nDrop = owned.length - cap;
    for (let i = 0; i < nDrop; i++) {
      const k = owned[i];
      delete pickOwnerByKey[k];
      dropped.push(k);
    }
    return dropped;
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
    const yLen = horizonLen(state.seasons, cfg.endSeason) || state.seasons.length;
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

    // Unequal pick hauls: keep nPicks = roster − keepers; drop highest #s (e.g. #96).
    const pickCap = nPicksCap(cfg);
    trimOwnerPicksToCap(pickOwnerByKey, picksByKey, sideA, pickCap);
    trimOwnerPicksToCap(pickOwnerByKey, picksByKey, sideB, pickCap);

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

  /**
   * Relative trade fairness vs package scale (star 5y totals are ~7–10k+).
   * Max gap ≈ 7% of the larger side; "balanced" ≈ 2%. Floors for tiny deals.
   */
  const TRADE_XPTS_GAP_PCT = 0.07;
  const TRADE_BALANCED_PCT = 0.02;
  const TRADE_XPTS_GAP_FLOOR = 80;
  const TRADE_BALANCED_FLOOR = 40;
  const TRADE_AFFINITY_WEIGHT = 2;

  function tradeGapMax(sideA, sideB) {
    const m = Math.max(Math.abs(sideA) || 0, Math.abs(sideB) || 0, 1);
    return Math.max(TRADE_XPTS_GAP_FLOOR, m * TRADE_XPTS_GAP_PCT);
  }

  function tradeBalancedGap(sideA, sideB) {
    const m = Math.max(Math.abs(sideA) || 0, Math.abs(sideB) || 0, 1);
    return Math.max(TRADE_BALANCED_FLOOR, m * TRADE_BALANCED_PCT);
  }

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
    const giveX = sumAssetYearPts(giveKeys, assetMap);
    const getX = sumAssetYearPts(getKeys, assetMap);
    const assetGap = Math.abs(giveX - getX);
    if (assetGap > tradeGapMax(giveX, getX)) return -1e9;
    // Soft fairness on post-cut roster impact — prefer win-win, don't require it
    if (myTotal < -200) return -1e9;
    if (theirTotal < -800 && myTotal > 400) return -1e9;

    let score = myTotal * 1.0 + theirTotal * 0.4 - assetGap * 0.05;

    if (myTotal >= -50 && theirTotal >= -50) score += 350;
    else if (myTotal >= 0 && theirTotal >= -250) score += 180;

    score += planTradeAffinity(myTeam, other) * TRADE_AFFINITY_WEIGHT;
    return score;
  }

  function packageSignature(giveKeys, getKeys) {
    const g = giveKeys.slice().sort().join(",");
    const t = getKeys.slice().sort().join(",");
    return g + "||" + t;
  }

  const TRADE_MAX_ASSETS = 2;
  const TRADE_FILLER_CANDIDATES = 25;

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
    const balGap = tradeBalancedGap(giveX0, getX0);
    if (give.length || get.length) {
      const gap = Math.abs(giveX0 - getX0);
      const sim0 = runSim(give, get);
      if (gap <= balGap) {
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
          (b.vorp || 0) - (a.vorp || 0) ||
          a.name.localeCompare(b.name)
      )
      .slice(0, TRADE_FILLER_CANDIDATES);
    const theirAvail = Object.keys(assetMap)
      .map((k) => assetMap[k])
      .filter((a) => a.owner === other && !getSet.has(a.key))
      .sort(
        (a, b) =>
          yearPtsTotal(b.yearPts) - yearPtsTotal(a.yearPts) ||
          (b.vorp || 0) - (a.vorp || 0) ||
          a.name.localeCompare(b.name)
      )
      .slice(0, TRADE_FILLER_CANDIDATES);

    const canAddGive = give.length < TRADE_MAX_ASSETS;
    const canAddGet = get.length < TRADE_MAX_ASSETS;
    let best = { score: -1e9, suggestGive: null, suggestGet: null };

    function consider(sg, st) {
      const g = sg ? give.concat([sg]) : give.slice();
      const t = st ? get.concat([st]) : get.slice();
      // Need a real trade direction after applying the suggestion
      if (!g.length && !t.length) return;
      if (g.length > TRADE_MAX_ASSETS || t.length > TRADE_MAX_ASSETS) return;
      const gSum = sumAssetYearPts(g, assetMap);
      const tSum = sumAssetYearPts(t, assetMap);
      const assetGap = Math.abs(gSum - tSum);
      if (assetGap > tradeGapMax(gSum, tSum)) return;
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
      const needGet = giveX0 > getX0 + balGap * 0.25;
      const needGive = getX0 > giveX0 + balGap * 0.25;
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

  function pickPlayerRowHtml(p) {
    // Trade/board pick rows from buildKeeperDraftPicks are always KD slots.
    const isNat =
      isNationalPickAsset(p) &&
      !isKeeperLeaguePick(p) &&
      !(p && p.key && String(p.key).indexOf("PICK:") === 0);
    const tip =
      "Overall #" +
      (p.pick || "") +
      (p.proxyName ? " · proxy " + p.proxyName : "");
    const pUsedChip = isNat ? pickUsageChipHtml(p) : "";
    return (
      '<div class="lt-player tc-pick-row">' +
      (isNat
        ? personIconHtml("fd-headshot fd-headshot-pick")
        : libraryAddIconHtml()) +
      '<div class="lt-player-meta">' +
      '<div class="lt-player-name" title="' +
      escapeHtml(tip) +
      '">' +
      escapeHtml(p.name || "") +
      "</div>" +
      '<div class="lt-player-chips">' +
      (isNat ? teamChipHtml((p && p.club) || "") : "") +
      (isNat ? "" : '<span class="fd-pos-chip">PICK</span>') +
      pUsedChip +
      "</div>" +
      "</div>" +
      '<div class="lt-player-vorp">' +
      fmtInt(p.vorp) +
      "</div>" +
      "</div>"
    );
  }

  /** Chip when a real national PICK_YYYY_* asset carries usage risk (p_used &lt; 1). */
  function pickUsageChipHtml(assetOrPick) {
    const self = assetOrPick;
    // KD slots / FA proxies never get this chip — even if value proxy is national.
    if (
      !self ||
      isKeeperLeaguePick(self) ||
      (self.key && String(self.key).indexOf("PICK:") === 0) ||
      (self.id && String(self.id).indexOf("KD_PICK_") === 0)
    ) {
      return "";
    }
    const row = isNationalPickAsset(self)
      ? self
      : self.proxyRow && isNationalPickAsset(self.proxyRow) && !self.key
        ? self.proxyRow
        : null;
    if (!row || !isNationalPickAsset(row)) return "";
    const a = row._asset || row;
    let pUsed = null;
    const ev = (a && a.event) || (row && row.event) || "";
    const m = String(ev).match(/p_used\s*=\s*([0-9.]+)/i);
    if (m) pUsed = Number(m[1]);
    if (pUsed == null && a && a.probListed && a.probListed.length) {
      const pl0 = Number(a.probListed[0]);
      if (Number.isFinite(pl0) && pl0 > 0 && pl0 < 0.999) pUsed = pl0;
    }
    if (pUsed == null || !(pUsed < 0.999)) return "";
    return (
      '<span class="fd-pos-chip fd-pused-chip" title="Club list headroom: pick may go unused">' +
      "p_used " +
      Math.round(pUsed * 100) +
      "%</span>"
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

    const debouncedTradeSearch = debounce(() => {
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
    }, 200);
    el.addEventListener("input", (e) => {
      const t = e.target;
      if (!t || t.id !== "tc-player-search") return;
      state.trade.search = t.value || "";
      debouncedTradeSearch();
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

  /** Current draft order for UI: explicit cfg.draftOrder or projected fallback. */
  function currentDraftOrderList(rows, league, cfg) {
    if (!league || !league.owners || !league.owners.length) return [];
    if (cfg.draftOrder && cfg.draftOrder.length) {
      return draftOrderBestToWorst(rows || state.rows, league, cfg);
    }
    return projectedLadderBestToWorst(rows || state.rows, league, cfg);
  }

  function renderDraftOrderEditor() {
    const list = document.getElementById("fd-draft-order-list");
    const block = document.getElementById("fd-draft-order-block");
    if (!list) return;
    const league = state.league;
    if (!league || !league.owners || !league.owners.length) {
      if (block) block.hidden = true;
      list.innerHTML = "";
      return;
    }
    if (block && state.cfg.tab === "import") block.hidden = false;
    const order = currentDraftOrderList(state.rows, league, state.cfg);
    const usingCustom = !!(state.cfg.draftOrder && state.cfg.draftOrder.length);
    const fmt = state.cfg.draftFormat === "linear" ? "linear" : "snake";
    list.innerHTML = order
      .map((owner, i) => {
        return (
          '<li data-owner="' +
          escapeHtml(owner) +
          '" draggable="true">' +
          '<span class="fd-do-rank">#' +
          (i + 1) +
          "</span>" +
          '<span class="fd-do-name">' +
          escapeHtml(owner) +
          "</span>" +
          '<button type="button" class="fd-do-handle" aria-label="Drag to reorder" title="Drag to reorder">⠿</button>' +
          "</li>"
        );
      })
      .join("");
    const hint = block && block.querySelector(".fd-draft-order-help");
    if (hint) {
      hint.textContent = usingCustom
        ? "Custom order (best → worst)" +
          (fmt === "snake" ? ". Snake reverses odd rounds." : ". Linear keeps the same order each round.")
        : "Using projected ladder (best → worst). Drag to lock a custom order.";
    }
    bindDraftOrderDrag(list);
  }

  function bindDraftOrderDrag(list) {
    if (!list || list.dataset.dndBound === "1") return;
    list.dataset.dndBound = "1";
    let dragOwner = null;

    list.addEventListener("dragstart", (e) => {
      const li = e.target && e.target.closest ? e.target.closest("li[data-owner]") : null;
      if (!li) return;
      dragOwner = li.getAttribute("data-owner");
      li.classList.add("fd-do-dragging");
      if (e.dataTransfer) {
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", dragOwner || "");
      }
    });
    list.addEventListener("dragend", () => {
      list.querySelectorAll(".fd-do-dragging, .fd-do-drag-over").forEach((el) => {
        el.classList.remove("fd-do-dragging", "fd-do-drag-over");
      });
      dragOwner = null;
    });
    list.addEventListener("dragover", (e) => {
      e.preventDefault();
      const li = e.target && e.target.closest ? e.target.closest("li[data-owner]") : null;
      list.querySelectorAll(".fd-do-drag-over").forEach((el) => el.classList.remove("fd-do-drag-over"));
      if (li) li.classList.add("fd-do-drag-over");
      if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
    });
    list.addEventListener("drop", (e) => {
      e.preventDefault();
      const li = e.target && e.target.closest ? e.target.closest("li[data-owner]") : null;
      list.querySelectorAll(".fd-do-dragging, .fd-do-drag-over").forEach((el) => {
        el.classList.remove("fd-do-dragging", "fd-do-drag-over");
      });
      if (!li || !dragOwner) return;
      const targetOwner = li.getAttribute("data-owner");
      if (!targetOwner || targetOwner === dragOwner) return;
      reorderDraftOrder(dragOwner, targetOwner);
      dragOwner = null;
    });
  }

  function reorderDraftOrder(fromOwner, toOwner) {
    const league = state.league;
    if (!league) return;
    let order = (state.cfg.draftOrder && state.cfg.draftOrder.length
      ? state.cfg.draftOrder.slice()
      : currentDraftOrderList(state.rows, league, state.cfg)
    ).slice();
    const from = order.indexOf(fromOwner);
    const to = order.indexOf(toOwner);
    if (from < 0 || to < 0 || from === to) return;
    order.splice(from, 1);
    order.splice(to, 0, fromOwner);
    state.cfg.draftOrder = order;
    refresh();
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
      renderDraftOrderEditor();
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
    SLOT_KEYS.forEach((k) => {
      if (cfg.slots[k] == null) cfg.slots[k] = k === "FLX" ? 0 : cfg.slots[k] || 0;
      setVal("cfg-" + k.toLowerCase(), cfg.slots[k] || 0);
    });
    const endSel = document.getElementById("cfg-endSeason");
    if (endSel && seasons.length) {
      endSel.innerHTML = seasons
        .map((y) => "<option value='" + y + "'>" + y + "</option>")
        .join("");
      cfg.endSeason = cfg.endSeason || seasons[seasons.length - 1];
      endSel.value = String(cfg.endSeason);
    }
    const finalised = document.getElementById("cfg-keepersFinalised");
    if (finalised) {
      // Keepers finalised ON ⇔ keeperCut false
      const cut = resolveKeeperCut(cfg, state.data, seasons);
      finalised.checked = cut === false;
    }
    const typeSel = document.getElementById("cfg-leagueType");
    if (typeSel) typeSel.value = cfg.leagueType || "keeper";
    const fmtSel = document.getElementById("cfg-draftFormat");
    if (fmtSel) fmtSel.value = cfg.draftFormat === "linear" ? "linear" : "snake";
    const pickEl = document.getElementById("cfg-pickTrading");
    if (pickEl) pickEl.checked = cfg.pickTrading !== false;
    setVal("cfg-search", cfg.search || "");
    document.querySelectorAll(".pos-filter-btn").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.pos === (cfg.posFilter || "ALL"));
    });
    syncClubDropdown(cfg);
    syncMyTeamSelect(state.league, cfg);
    applyLeagueTypeUi(cfg);
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
    if (!leagueHasTeams(league)) {
      panel.innerHTML = "";
      panel.dataset.built = "0";
      updateOwnerDropdownLabel(cfg);
      return;
    }
    const names = league.owners || [];
    const my = cfg.myTeam && names.indexOf(cfg.myTeam) >= 0 ? cfg.myTeam : "";
    const others = names
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

  function readControlsFromDom(opts) {
    const o = opts || {};
    const cfg = state.cfg;
    const num = (id, fb) => {
      const el = document.getElementById(id);
      return el ? clampInt(el.value, -999, 999, fb) : fb;
    };
    cfg.teams = Math.max(2, num("cfg-teams", cfg.teams));
    cfg.bench = Math.max(0, num("cfg-bench", cfg.bench));
    cfg.keeperCount = Math.max(0, num("cfg-keepers", cfg.keeperCount));
    SLOT_KEYS.forEach((k) => {
      cfg.slots[k] = Math.max(0, num("cfg-" + k.toLowerCase(), cfg.slots[k] || 0));
    });
    const endSel = document.getElementById("cfg-endSeason");
    if (endSel) cfg.endSeason = parseInt(endSel.value, 10);
    if (o.includeCut) {
      const finalised = document.getElementById("cfg-keepersFinalised");
      if (finalised) cfg.keeperCut = !finalised.checked;
    }
    const typeSel = document.getElementById("cfg-leagueType");
    if (typeSel && typeSel.value) cfg.leagueType = typeSel.value;
    const fmtSel = document.getElementById("cfg-draftFormat");
    if (fmtSel) cfg.draftFormat = fmtSel.value === "linear" ? "linear" : "snake";
    const pickEl = document.getElementById("cfg-pickTrading");
    if (pickEl) cfg.pickTrading = !!pickEl.checked;
    const my = document.getElementById("cfg-myTeam");
    if (my) cfg.myTeam = my.value || "";
    const importMy = document.getElementById("fd-import-myTeam");
    if (importMy && importMy.value) cfg.myTeam = importMy.value;
    const search = document.getElementById("cfg-search");
    if (search) cfg.search = search.value.trim();
    return cfg;
  }

  function debounce(fn, ms) {
    let t = null;
    return function () {
      const args = arguments;
      const self = this;
      if (t) clearTimeout(t);
      t = setTimeout(function () {
        t = null;
        fn.apply(self, args);
      }, ms);
    };
  }

  function onImportSettingsChanged(extra) {
    readControlsFromDom(extra || {});
    applyLeagueTypeUi(state.cfg);
    refresh();
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
      "cfg-flx",
      "cfg-endSeason",
      "cfg-myTeam",
      "fd-import-myTeam",
      "cfg-leagueType",
      "cfg-draftFormat"
    ];
    ids.forEach((id) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.addEventListener("change", () => {
        onImportSettingsChanged();
        if (id === "cfg-myTeam" || id === "fd-import-myTeam") {
          const importMy = document.getElementById("fd-import-myTeam");
          const headerMy = document.getElementById("cfg-myTeam");
          if (id === "fd-import-myTeam" && headerMy) headerMy.value = state.cfg.myTeam;
          if (id === "cfg-myTeam" && importMy) importMy.value = state.cfg.myTeam;
          rebuildOwnerDropdown(state.league, state.cfg);
          state.trade.otherTeam = "";
          state.trade.search = "";
          state.trade.give = [];
          state.trade.get = [];
        }
      });
    });
    document.querySelectorAll(".fd-stepper-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const targetId = btn.getAttribute("data-target");
        const dir = Number(btn.getAttribute("data-dir")) || 0;
        const input = targetId ? document.getElementById(targetId) : null;
        if (!input) return;
        const min = input.min !== "" ? Number(input.min) : 0;
        const max = input.max !== "" ? Number(input.max) : 99;
        const next = Math.max(min, Math.min(max, (Number(input.value) || 0) + dir));
        input.value = String(next);
        onImportSettingsChanged();
      });
    });
    const finalisedEl = document.getElementById("cfg-keepersFinalised");
    if (finalisedEl) {
      finalisedEl.addEventListener("change", () => {
        onImportSettingsChanged({ includeCut: true });
      });
    }
    const pickEl = document.getElementById("cfg-pickTrading");
    if (pickEl) {
      pickEl.addEventListener("change", () => onImportSettingsChanged());
    }
    const searchEl = document.getElementById("cfg-search");
    if (searchEl) {
      const debouncedSearch = debounce(() => {
        readControlsFromDom();
        refresh();
      }, 200);
      searchEl.addEventListener("change", () => {
        readControlsFromDom();
        refresh();
      });
      searchEl.addEventListener("input", debouncedSearch);
    }
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

    function closeDropdown(panel) {
      if (!panel) return;
      panel.style.display = "none";
      panel.classList.remove("is-open");
    }
    function openDropdown(panel) {
      if (!panel) return;
      panel.style.display = "grid";
      panel.classList.add("is-open");
    }
    function bindDropdownToggle(btnId, panelId, rootId) {
      const btn = document.getElementById(btnId);
      if (!btn) return;
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const panel = document.getElementById(panelId);
        if (!panel) return;
        const open = panel.classList.contains("is-open") || panel.style.display === "grid";
        // Close sibling dropdowns
        ["club-dropdown-panel", "owner-dropdown-panel"].forEach((id) => {
          if (id !== panelId) closeDropdown(document.getElementById(id));
        });
        if (open) closeDropdown(panel);
        else openDropdown(panel);
      });
      document.addEventListener("pointerdown", (e) => {
        const root = document.getElementById(rootId);
        const panel = document.getElementById(panelId);
        if (root && panel && !root.contains(e.target)) {
          closeDropdown(panel);
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

    const saveBtn = document.getElementById("fd-league-save");
    if (saveBtn) saveBtn.addEventListener("click", () => saveLeagueToAccount());
    const delBtn = document.getElementById("fd-league-delete");
    if (delBtn) delBtn.addEventListener("click", () => deleteLeagueFromAccount());
    const refreshBtn = document.getElementById("fd-league-refresh");
    if (refreshBtn) {
      refreshBtn.addEventListener("click", () => {
        if (state.league && state.league.source === "afl") {
          refreshAflLeague();
          return;
        }
        const input = document.getElementById("keeper-csv-refresh-input");
        if (input) input.click();
      });
    }
    const keeperRefresh = document.getElementById("keeper-csv-refresh-input");
    if (keeperRefresh) {
      keeperRefresh.addEventListener("change", () => {
        const file = keeperRefresh.files && keeperRefresh.files[0];
        if (file) {
          handleKeeperCsvFile(file, { autoSave: !!state.accountUser });
        }
      });
    }

    const importModalClose = document.getElementById("fd-import-modal-close");
    if (importModalClose) {
      importModalClose.addEventListener("click", () => dismissImportModal());
    }
    const importModalBackdrop = document.getElementById("fd-import-modal-backdrop");
    if (importModalBackdrop) {
      importModalBackdrop.addEventListener("click", () => dismissImportModal());
    }
    const getStarted = document.getElementById("fd-import-get-started");
    if (getStarted) {
      getStarted.addEventListener("click", (e) => {
        e.preventDefault();
        const q = new URLSearchParams(window.location.search);
        q.set("tab", "import");
        const redirect = encodeURIComponent(
          window.location.pathname + "?" + q.toString()
        );
        window.location.href = "/login.html?redirect=" + redirect;
      });
    }
    const aflModalBtn = document.getElementById("afl-import-btn-modal");
    const aflModalInput = document.getElementById("afl-share-url-modal");
    const runModalAflImport = () => {
      if (!aflModalInput) return;
      importAflLeagueFromShare(aflModalInput.value, {
        autoSave: true,
        redirectToTeams: true
      });
    };
    if (aflModalBtn) aflModalBtn.addEventListener("click", runModalAflImport);
    if (aflModalInput) {
      aflModalInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          runModalAflImport();
        }
      });
      aflModalInput.addEventListener("paste", () => {
        window.setTimeout(runModalAflImport, 0);
      });
    }
    const keeperModalInput = document.getElementById("keeper-csv-input-modal");
    const keeperModalBtn = document.getElementById("keeper-import-btn-modal");
    const runModalKeeperImport = () => {
      const file = keeperModalInput && keeperModalInput.files && keeperModalInput.files[0];
      if (!file) {
        setLeagueStatus("Choose a Keeper Fantasy CSV to import.", true);
        return;
      }
      handleKeeperCsvFile(file, { autoSave: true, redirectToTeams: true });
    };
    if (keeperModalBtn) {
      keeperModalBtn.addEventListener("click", runModalKeeperImport);
    }

    const doProj = document.getElementById("fd-draft-order-projected");
    if (doProj) {
      doProj.addEventListener("click", () => {
        if (!state.league) return;
        state.cfg.draftOrder = projectedLadderBestToWorst(
          state.rows,
          state.league,
          state.cfg
        );
        refresh();
      });
    }
  }

  // ── Boot ───────────────────────────────────────────────────────────────────

  async function init() {
    state.cfg = readCfgFromUrl();
    bindControls();
    setActiveTab(state.cfg.tab || "pool");
    updateAccountSyncUi();

    const loading = document.getElementById("loading-state");
    const err = document.getElementById("futures-error");
    const shell = document.getElementById("futures-shell");

    try {
      const res = await fetch(STORAGE_URL, { cache: "no-cache" });
      if (!res.ok) throw new Error("HTTP " + res.status);
      const data = await res.json();
      if (!data.assets || !data.meta) throw new Error("Invalid payload");
      state.data = data;
      state.seasons = (data.meta.seasons || []).map(Number);
      if (!state.cfg.endSeason) {
        const dh = Number(data.meta.defaultHorizon);
        if (Number.isFinite(dh) && dh > 0 && dh <= state.seasons.length) {
          state.cfg.endSeason = state.seasons[dh - 1];
        } else {
          state.cfg.endSeason = state.seasons[state.seasons.length - 1];
        }
      }
      await loadLeagueFromAccount();
      syncControlsToDom(state.cfg, state.seasons);
      applyLeagueTypeUi(state.cfg);
      syncImportManageVisibility();
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
