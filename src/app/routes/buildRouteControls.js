import { escapeHtml } from "../../utils/escapeHtml.js";

function buildRouteRow(routeMeta, onRouteCheckboxChange) {
  const row = document.createElement("label");
  row.className = "route-option";
  row.dataset.routeKey = routeMeta.key;

  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.checked = false;

  const swatch = document.createElement("span");
  swatch.className = "route-swatch";
  swatch.style.background = routeMeta.color;

  const text = document.createElement("span");
  text.className = "route-text";

  const title = document.createElement("span");
  title.className = "route-title";
  title.textContent = routeMeta.shortName;

  const longPart = routeMeta.longName ? ` - ${routeMeta.longName}` : "";
  const sub = document.createElement("span");
  sub.className = "route-sub";
  sub.textContent = `${routeMeta.stopCount} stops${longPart}`;

  text.appendChild(title);
  text.appendChild(sub);

  row.appendChild(checkbox);
  row.appendChild(swatch);
  row.appendChild(text);

  checkbox.addEventListener("change", () => {
    onRouteCheckboxChange(routeMeta.key, checkbox.checked);
  });

  return { row, checkbox };
}

export function buildRouteControls({
  manifest,
  routeGroupsNode,
  routeStateByKey,
  agencyStateById,
  onRouteCheckboxChange,
  onAgencyAction,
}) {
  routeGroupsNode.innerHTML = "";
  routeStateByKey.clear();
  agencyStateById.clear();

  const agencies = manifest.agencies ?? [];
  const routes = manifest.routes ?? [];
  const routesByAgency = new Map();

  for (const agency of agencies) {
    routesByAgency.set(agency.id, []);
  }

  for (const route of routes) {
    if (!routesByAgency.has(route.agencyId)) {
      routesByAgency.set(route.agencyId, []);
    }
    routesByAgency.get(route.agencyId).push(route);
  }

  for (const agency of agencies) {
    const agencyRoutes = (routesByAgency.get(agency.id) ?? []).sort((a, b) =>
      a.shortName.localeCompare(b.shortName, undefined, { numeric: true, sensitivity: "base" }),
    );

    const details = document.createElement("details");
    details.className = "agency-group";
    details.open = true;

    const summary = document.createElement("summary");
    summary.innerHTML = `<span class="agency-label">${escapeHtml(agency.label)}</span><span class="agency-count" data-agency-count="${escapeHtml(agency.id)}"></span>`;
    details.appendChild(summary);

    const actions = document.createElement("div");
    actions.className = "agency-actions-row";
    actions.innerHTML = `
      <button type="button" class="secondary" data-action="select-visible" data-agency="${escapeHtml(agency.id)}">Select Visible</button>
      <button type="button" class="secondary" data-action="clear-agency" data-agency="${escapeHtml(agency.id)}">Clear Agency</button>
    `;
    details.appendChild(actions);

    const routeList = document.createElement("div");
    routeList.className = "route-list";
    details.appendChild(routeList);

    routeGroupsNode.appendChild(details);

    const agencyState = {
      agency,
      details,
      countNode: summary.querySelector("[data-agency-count]"),
      routeKeys: [],
    };
    agencyStateById.set(agency.id, agencyState);

    for (const route of agencyRoutes) {
      const routeRow = buildRouteRow(route, onRouteCheckboxChange);
      routeList.appendChild(routeRow.row);

      agencyState.routeKeys.push(route.key);
      routeStateByKey.set(route.key, {
        meta: route,
        row: routeRow.row,
        checkbox: routeRow.checkbox,
        selected: false,
        isVisible: true,
        layer: null,
        routeData: null,
        scheduleData: null,
        loadPromise: null,
        scheduleLoadPromise: null,
      });
    }
  }

  routeGroupsNode.onclick = (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;

    const action = target.dataset.action;
    const agencyId = target.dataset.agency;
    if (!action || !agencyId) return;

    onAgencyAction({ action, agencyId });
  };
}

export function renderSourceDetails(sourceDetailsNode, sources) {
  sourceDetailsNode.innerHTML = "";

  for (const source of sources) {
    const wrapper = document.createElement("div");
    wrapper.className = "source-item";

    const updatedAt = source.feedUpdatedAt
      ? new Date(source.feedUpdatedAt).toLocaleString()
      : "Unknown";

    wrapper.innerHTML = `
      <p><strong>${escapeHtml(source.agencyLabel)}</strong></p>
      <p>${escapeHtml(source.description || "")}</p>
      <p><a href="${escapeHtml(source.gtfsUrl)}" target="_blank" rel="noreferrer">${escapeHtml(source.gtfsUrl)}</a></p>
      <p>Feed updated: ${escapeHtml(updatedAt)}</p>
    `;

    sourceDetailsNode.appendChild(wrapper);
  }
}
