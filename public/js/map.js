// Coordenada inicial
const inicial = [-29.684, -53.806];
const mapa = L.map("map", {
  zoomControl: false,
  maxZoom: 20,
  minZoom: 4
}).setView(inicial, 13.5);

// Tile escuro
L.tileLayer("https://tiles.stadiamaps.com/tiles/alidade_smooth_dark/{z}/{x}/{y}{r}.png", {
  maxZoom: 20,
  attribution:
    'SIVIR Desenvolvido por <a href="https://github.com/freitasfzw" target="_blank">Zucchetto</a> e <a href="https://github.com/HnrqHolanda" target="_blank">Henrique Holanda</a>'
}).addTo(mapa);

// ======== CLUSTERS ==========
const clusterGroup = L.markerClusterGroup({
  spiderfyOnMaxZoom: true,
  showCoverageOnHover: false,
  zoomToBoundsOnClick: false,
  spiderfyOnClick: true,
  spiderfyDistanceMultiplier: 2.2,
  maxClusterRadius: 5
});
mapa.addLayer(clusterGroup);

clusterGroup.on("clusterclick", function (a) {
  a.layer.spiderfy();
  a.originalEvent.preventDefault();

});

// Armazena markers
const markers = new Map();

// Cria ícone circular da OM
function createOmIcon(fotoUrl, status, size = 64) {
  const color =
    status === "UP" ? "#28a745" :
    status === "DOWN" ? "#d64545" :
    "#8a8a8a";

  const html = `
    <div class="om-icon" style="
      width:${size}px;height:${size}px;border-radius:50%;
      border:4px solid ${color};overflow:hidden;
      box-shadow:0 2px 8px rgba(0,0,0,0.6);">
      <img src="${fotoUrl}" onerror="this.src='/assets/fotos/default.jpg'"
        style="width:100%;height:100%;object-fit:cover;">
    </div>
  `;

  return L.divIcon({
    className: "om-div-icon",
    html,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    popupAnchor: [0, -size / 2 - 6]
  });
}

// Popup
function popupContent(item) {
  return `
    <div style="min-width:200px">
      <strong>${item.nome}</strong><br/>
      <small>${item.hostname} ${item.ip ? "• " + item.ip : ""}</small><br/>
      <b>Status:</b> ${item.status}<br/>
      <b>Última verificação:</b> ${item.last_check || "—"}
    </div>
  `;
}

// Insere ou atualiza marker
function upsertMarker(item) {
  if (!item.latitude || !item.longitude) return;

  const key = item.hostname;
  const latlng = [item.latitude, item.longitude];
  const foto = item.foto || "/assets/fotos/default.jpg";
  const icon = createOmIcon(foto, item.status);

  if (markers.has(key)) {
    const m = markers.get(key);
    clusterGroup.removeLayer(m);

    m.setIcon(icon);
    m.setLatLng(latlng);
    m.getPopup().setContent(popupContent(item));

    clusterGroup.addLayer(m);

  } else {
    const m = L.marker(latlng, { icon });
    m.bindPopup(popupContent(item));

    markers.set(key, m);
    clusterGroup.addLayer(m);
  }
}

// Chama API
async function fetchAndUpdate() {
  try {
    const res = await fetch("/api/om-status", { cache: "no-store" });
    const data = await res.json();
    data.forEach(upsertMarker);

  } catch (err) {
    console.error("Erro ao carregar /api/om-status:", err);
  }
}

// Execução inicial + polling
fetchAndUpdate();
setInterval(fetchAndUpdate, 30000);

// Sidebar
const sidebar = document.getElementById("sidebar");
document.getElementById("toggleSidebar")
  .addEventListener("click", () => sidebar.classList.add("open"));
document.getElementById("closeSidebar")
  .addEventListener("click", () => sidebar.classList.remove("open"));