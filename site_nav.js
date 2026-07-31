// site_nav.js — featured hub lists + section secondary nav from Firebase Storage.
//
// Featured column:
//   import { renderFeaturedNav } from "./site_nav.js";
//   renderFeaturedNav("hub-featured", "home");   // or "fantasy" / "supercoach" / "aflw"
//
// Section secondary nav:
//   import { mountSectionNav } from "./site_nav.js";
//   mountSectionNav("fantasy");

const SITE_NAV_URL =
  "https://firebasestorage.googleapis.com/v0/b/statsbyjaiden.firebasestorage.app/o/site_nav.json?alt=media";

let cachedNav = null;

function escapeHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function currentSlug() {
  const path = window.location.pathname.replace(/\/$/, "");
  const base = path.split("/").pop() || "index";
  return base.replace(/\.html$/i, "") || "index";
}

async function loadNav() {
  if (cachedNav) return cachedNav;
  const res = await fetch(SITE_NAV_URL);
  if (!res.ok) throw new Error("HTTP " + res.status);
  cachedNav = await res.json();
  return cachedNav;
}

function isActiveItem(item, slug) {
  const url = String(item.url || "").replace(/\.html$/i, "");
  return url === slug;
}

function asList(val) {
  if (val == null) return [];
  return Array.isArray(val) ? val : [val];
}

/** Featured column: prefer featuredOn, fall back to legacy pages. */
function filterFeatured(items, key) {
  return (Array.isArray(items) ? items : []).filter(function (item) {
    if (item.active === false) return false;
    const keys = asList(item.featuredOn != null ? item.featuredOn : item.pages);
    return keys.indexOf(key) >= 0;
  });
}

/** Section subnav: prefer nav, fall back to legacy pages. */
function filterNav(items, section) {
  return (Array.isArray(items) ? items : []).filter(function (item) {
    if (item.active === false) return false;
    if (item.nav != null) return asList(item.nav).indexOf(section) >= 0;
    return asList(item.pages).indexOf(section) >= 0;
  });
}

function featuredItemHtml(item) {
  const title = escapeHtml(item.title);
  const url = escapeHtml(item.url || "#");
  const tile = item.tile != null && String(item.tile).trim() !== ""
    ? String(item.tile)
    : null;
  const colour = item.tileColour || "#28a745";
  const badge = tile
    ? `<span class="badge" style="background:${escapeHtml(colour)};color:#fff;">${escapeHtml(tile)}</span>`
    : "";

  return `<li>
    <a class="page-row" href="${url}">
      <span class="page-title">${title}</span>
      ${badge}
    </a>
  </li>`;
}

function sectionItemHtml(item, slug) {
  const label = escapeHtml(item.navTitle || item.title);
  const url = escapeHtml(item.url || "#");
  const active = isActiveItem(item, slug) ? " active" : "";
  const tile = item.tile != null && String(item.tile).trim() !== ""
    ? String(item.tile)
    : null;
  const colour = item.tileColour || "#28a745";
  const badge = tile
    ? `<span class="section-nav-badge" style="background:${escapeHtml(colour)};">${escapeHtml(tile)}</span>`
    : "";

  return `<a class="section-nav-link${active}" href="${url}">${label}${badge}</a>`;
}

/**
 * Hub featured list (column 1).
 * @param {string} containerId
 * @param {string} key  "home" | "fantasy" | "supercoach" | "aflw"
 */
export async function renderFeaturedNav(containerId, key) {
  const el = document.getElementById(containerId);
  if (!el) return;
  const featuredKey = key || "home";

  try {
    const items = filterFeatured(await loadNav(), featuredKey);
    el.innerHTML = items.length
      ? items.map(featuredItemHtml).join("")
      : "<li><span class='page-title' style='color:#666;font-size:1rem;'>No pages listed.</span></li>";
  } catch (e) {
    console.error("site_nav load failed:", e);
    el.innerHTML = "<li><span class='page-title' style='color:#b00020;font-size:1rem;'>Failed to load page list — please refresh.</span></li>";
  }
}

/**
 * Inject secondary nav under the main navbar.
 * @param {string} section  Key from site_nav.json `nav`, e.g. "fantasy"
 */
export async function mountSectionNav(section) {
  if (!section) {
    console.warn('mountSectionNav("fantasy") — pass a section key');
    return;
  }

  const slug = currentSlug();

  let host = document.getElementById("section-nav");
  if (!host) {
    host = document.createElement("nav");
    host.id = "section-nav";
    host.className = "section-nav";
    host.setAttribute("aria-label", "Section");

    const navbar = document.querySelector(".navbar");
    if (navbar && navbar.parentNode) {
      navbar.parentNode.insertBefore(host, navbar.nextSibling);
    } else {
      document.body.insertBefore(host, document.body.firstChild);
    }
  }

  try {
    const items = filterNav(await loadNav(), section);
    if (!items.length) {
      host.remove();
      return;
    }
    host.innerHTML = items.map(function (item) {
      return sectionItemHtml(item, slug);
    }).join("");
  } catch (e) {
    console.error("section nav load failed:", e);
    host.remove();
  }
}