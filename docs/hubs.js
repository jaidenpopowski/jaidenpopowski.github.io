// hubs.js — render hub top-10 panels from Firebase Storage hubs/*.json
//
//   import { renderHubPanel, loadHub } from "./hubs.js";
//   const data = await loadHub("fantasy");
//   renderHubPanel("hub-projections", data.projections, { kind: "projections" });

const HUB_BASE =
  "https://firebasestorage.googleapis.com/v0/b/statsbyjaiden.firebasestorage.app/o/";

function escapeHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function headshot(playerId, league) {
  if (!playerId) return "";
  const id = String(playerId).replace(/\D/g, "");
  const path =
    league === "aflw"
      ? `AFLW/2026264/${id}.png`
      : `AFL/2026014/${id}.png`;
  return `<img class="hub-headshot" src="https://s.afl.com.au/staticfile/AFL%20Tenant/AFL/Players/ChampIDImages/${path}?im=Resize=(50,50)" alt="" onerror="this.style.display='none'">`;
}

function formatPrice(price) {
  if (price == null || price === "") return "";
  const n = Number(price);
  if (!Number.isFinite(n)) return "";
  return "$" + Math.round(n / 1000) + "K";
}

function formatNum(val, digits) {
  if (val == null || val === "") return "";
  const n = Number(val);
  if (!Number.isFinite(n)) return "";
  return n.toFixed(digits);
}

/**
 * @param {string} name  e.g. "index" | "fantasy" → hubs/index.json
 */
export async function loadHub(name) {
  const objectPath = "hubs/" + name + ".json";
  const url = HUB_BASE + encodeURIComponent(objectPath) + "?alt=media";
  const res = await fetch(url);
  if (!res.ok) throw new Error(objectPath + " → HTTP " + res.status);
  return res.json();
}

/**
 * @param {string} containerId
 * @param {Array} rows
 * @param {{ kind: "projections"|"season"|"cbas"|"kickins", emptyMessage?: string }} opts
 */
export function renderHubPanel(containerId, rows, opts) {
  const el = document.getElementById(containerId);
  if (!el) return;

  const kind = (opts && opts.kind) || "projections";
  const emptyMessage = (opts && opts.emptyMessage) || "No data yet.";
  const list = Array.isArray(rows) ? rows : [];
  const league = kind === "cbas" || kind === "kickins" ? "aflw" : "afl";

  if (!list.length) {
    el.innerHTML = `<p class="hub-empty">${escapeHtml(emptyMessage)}</p>`;
    return;
  }

  let head;
  if (kind === "season") {
    head = `<thead><tr><th class="hub-player-col">Player</th><th>Price</th><th>Avg</th></tr></thead>`;
  } else if (kind === "cbas") {
    head = `<thead><tr><th class="hub-player-col">Player</th><th>Team</th><th>Avg</th></tr></thead>`;
  } else if (kind === "kickins") {
    head = `<thead><tr><th class="hub-player-col">Player</th><th>Team</th><th>Tot</th></tr></thead>`;
  } else {
    head = `<thead><tr><th class="hub-player-col">Player</th><th>Pos</th><th>Proj</th></tr></thead>`;
  }

  const body = list
    .map(function (r) {
      const name = escapeHtml(r.player || r.Player || "");
      const img = headshot(r.playerId, league);
      if (kind === "season") {
        return `<tr>
          <td class="hub-player-col">${img}<span>${name}</span></td>
          <td>${escapeHtml(formatPrice(r.Price))}</td>
          <td>${escapeHtml(formatNum(r.Avg, 1))}</td>
        </tr>`;
      }
      if (kind === "cbas") {
        const avgPct =
          r.avg == null || r.avg === ""
            ? ""
            : (Math.round(1000 * Number(r.avg)) / 10).toFixed(1) + "%";
        return `<tr>
          <td class="hub-player-col">${img}<span>${name}</span></td>
          <td>${escapeHtml(r.team || "")}</td>
          <td>${escapeHtml(avgPct)}</td>
        </tr>`;
      }
      if (kind === "kickins") {
        return `<tr>
          <td class="hub-player-col">${img}<span>${name}</span></td>
          <td>${escapeHtml(r.team || "")}</td>
          <td>${escapeHtml(r.total == null ? "" : String(r.total))}</td>
        </tr>`;
      }
      return `<tr>
        <td class="hub-player-col">${img}<span>${name}</span></td>
        <td>${escapeHtml(r.Position || "")}</td>
        <td>${escapeHtml(formatNum(r.Projected, 1))}</td>
      </tr>`;
    })
    .join("");

  el.innerHTML = `<table class="hub-table">${head}<tbody>${body}</tbody></table>`;
}

export function renderHubPlaceholder(containerId, message) {
  const el = document.getElementById(containerId);
  if (!el) return;
  el.innerHTML = `<p class="hub-empty">${escapeHtml(message || "Coming soon")}</p>`;
}
