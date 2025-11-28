// server.js
const express = require("express");
const fetch = require("node-fetch");
const fs = require("fs").promises;
const path = require("path");
const session = require("express-session");
const bodyParser = require("body-parser");

const app = express();
const PORT = process.env.PORT || 3000;

const PUBLIC_DIR = path.join(__dirname, "public");

// ===========================
//  BODY PARSER — DEVE VIR ANTES DE TUDO

// nao importa como isso funciona, nao altera
// ===========================
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

// ===========================
//  ARQUIVOS ESTÁTICOS
// ===========================

// serve /public na raiz, mas sem auto-index
app.use(express.static(PUBLIC_DIR, { index: false }));

// serve /public/assets como /assets
app.use("/assets", express.static(path.join(PUBLIC_DIR, "assets")));

// ===========================
//  SESSÃO
// ===========================
app.use(
  session({
    secret: "sivir-secret-key",
    resave: false,
    saveUninitialized: true,
  })
);

// ===========================
//  LOGIN — ARQUIVO DE USUÁRIOS
// ===========================
const USERS_PATH = path.join(__dirname, "users.json");

function requireLogin(req, res, next) {
  if (req.session && req.session.user) return next();
  return res.redirect("/login");
}

// ===========================
//  ROTAS DE LOGIN
// ===========================
app.get("/login", (req, res) => {
  res.sendFile(path.join(__dirname, "views", "login.html"));
});

app.post("/login", async (req, res) => {
  const { username, password } = req.body;

  console.log("Recebido do formulário:", req.body); // DEBUG OPCIONAL

  if (!username || !password) {
    return res.redirect("/login?error=1");
  }

  const raw = await fs.readFile(USERS_PATH, "utf8");
  const users = JSON.parse(raw);

  const found = users.find(
    (u) => u.username === username && u.password === password
  );

  if (!found) {
    return res.redirect("/login?error=1"); // melhor UX
  }

  req.session.user = { username };
  return res.redirect("/");
});

app.get("/logout", (req, res) => {
  req.session.destroy(() => res.redirect("/login"));
});

// ===========================
//  ADMIN - PROTEGIDO
// ===========================

function requireAdmin(req, res, next) {
  if (req.session?.user?.username === "admin") return next();
  return res.redirect("/login");
}

// Painel do administrador
app.get("/admin", requireAdmin, (req, res) => {
  res.sendFile(path.join(__dirname, "views", "admin.html"));
});

// Retornar lista de usuários no painel
app.get("/admin/users", requireAdmin, async (req, res) => {
  const raw = await fs.readFile(USERS_PATH, "utf8");
  const users = JSON.parse(raw);
  res.json(users);
});

// Criar novo usuário
app.post("/admin/create", requireAdmin, async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password)
    return res.status(400).send("Dados inválidos");

  const raw = await fs.readFile(USERS_PATH, "utf8");
  const users = JSON.parse(raw);

  if (users.some(u => u.username === username))
    return res.status(409).send("Usuário já existe.");

  users.push({ username, password });
  await fs.writeFile(USERS_PATH, JSON.stringify(users, null, 2));

  return res.redirect("/admin");
});

// Apagar usuário
app.post("/admin/delete", requireAdmin, async (req, res) => {
  const { username } = req.body;

  if (!username || username === "admin")
    return res.status(400).send("Ação inválida.");

  const raw = await fs.readFile(USERS_PATH, "utf8");
  let users = JSON.parse(raw);

  users = users.filter(u => u.username !== username);

  await fs.writeFile(USERS_PATH, JSON.stringify(users, null, 2));

  return res.redirect("/admin");
});

// ===========================
//  HOME PROTEGIDA
// ===========================
app.get("/", requireLogin, (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "index.html"));
});

// ===========================
//  NAGIOS: FUNÇÕES AUXILIARES
// ===========================
async function readLocations() {
  const raw = await fs.readFile(path.join(PUBLIC_DIR, "locations.json"), "utf8");
  return JSON.parse(raw);
}

const NAGIOS_HOST = "10.26.1.161";
const NAGIOS_USER = "nagiosadmin";
const NAGIOS_PASS = "123456";

function nagiosAuth() {
  const token = Buffer.from(`${NAGIOS_USER}:${NAGIOS_PASS}`).toString("base64");
  return { Authorization: `Basic ${token}` };
}

const HOSTGROUPS = [
  "santa_maria",
  "itaara",
  "alegrete",
  "santiago",
  "sao_borja",
  "sao_gabriel",
  "uruguaiana",
  "cruz_alta",
  "cachoeira_do_sul",
  "itaqui",
  "rosario_do_sul",
];

let cacheOMs = [];
let ultimaAtualizacao = null;


async function getHostList() {
  const result = new Set();

  for (const g of HOSTGROUPS) {
    const url = `http://${NAGIOS_HOST}/nagios/cgi-bin/statusjson.cgi?query=hostlist&hostgroup=${g}`;

    try {
      const res = await fetch(url, { headers: nagiosAuth() });
      if (!res.ok) continue;

      const json = await res.json();
      const hosts = Object.keys(json.data.hostlist || {});
      hosts.forEach((h) => result.add(h));

    } catch (err) {
      console.warn(`Falha ao ler hostgroup ${g}:`, err.message);
    }
  }

  return [...result];
}

async function getHostDetails(hostname) {
  const url = `http://${NAGIOS_HOST}/nagios/cgi-bin/statusjson.cgi?query=host&hostname=${hostname}`;
  const res = await fetch(url, { headers: nagiosAuth() });
  if (!res.ok) return null;

  const json = await res.json();
  return json.data.host || null;
}

async function atualizarCacheOMs() {
  try {
    const locations = await readLocations();
    const hostnames = await getHostList();

    const details = {};
    for (const h of hostnames) {
      details[h] = await getHostDetails(h);
    }

    // Tradutor para os códigos específicos do seu Nagios
    function translateHostStatus(raw) {
      if (raw === 0) return 0;   // UP
      if (raw === 2) return 0;   // também UP no seu ambiente
      if (raw === 4) return 1;   // DOWN
      return 3;                  // UNKNOWN
    }

    // Mapa final do SIVIR
    const STATUS_MAP = {
      0: "UP",
      1: "DOWN",
      2: "UNREACHABLE",
      3: "UNKNOWN",
    };

    // Montagem final do cache
    cacheOMs = locations.map((loc) => {
      const detail = details[loc.hostname];

      if (!detail) {
        return {
          ...loc,
          status: "UNKNOWN",
          last_check: null,
        };
      }

      // Status bruto vindo da API JSON do Nagios
      const raw = detail.status;

      // Traduz para o padrão usado pelo SIVIR
      const code = translateHostStatus(raw);

      return {
        ...loc,
        status: STATUS_MAP[code],
        last_check: detail?.last_check
          ? new Date(detail.last_check).toLocaleString("pt-BR")
          : null,
      };
    });

    ultimaAtualizacao = Date.now();

  } catch (err) {
    console.error("Erro no cache de OMs:", err);
  }
}


// ===========================
//  API PROTEGIDA
// ===========================
app.get("/api/om-status", requireLogin, (req, res) => {
  res.json(cacheOMs);
});

app.get("/api/enlaces", requireLogin, async (req, res) => {
  try {
    const locations = await readLocations();
    const locIndex = {};
    for (const l of locations) locIndex[l.hostname] = l;

    const enlaces = [];

    for (const city of Object.keys(ENLACES_CFG)) {
      enlaces.push(...await readEnlaces(city));
    }

    const withStatus = await Promise.all(
      enlaces.map(async (e) => {
        const detail = await getServiceStatus(
          e.host_name,
          e.service_description
        );

        let status = "UNKNOWN";
        if (detail) {
          const code = detail.last_hard_state ?? detail.status;
          status = mapServiceStatus(code);
        }

        return { ...e, status };
      })
    );

    const result = [];

    for (const e of withStatus) {
      const locA = locIndex[e.omA];
      const locB = locIndex[e.omB];
      if (!locA || !locB) continue;

      result.push({
        id: `${e.omA}-${e.tipo}-${e.omB}`,
        tipo: e.tipo,
        status: e.status,
        ipDestino: e.ipDestino,
        a: locA,
        b: locB
      });
    }

    res.json(result);

  } catch (err) {
    console.error("Erro /api/enlaces:", err);
    res.status(500).json({ error: err.message });
  }
});

//------------------------------------------------------
// ENLACES DAS OM'S
//------------------------------------------------------
const ENLACES_CFG = {
  cruz_alta: path.join(__dirname, "cruz_alta_enlaces_checkcluster.cfg"),
  sao_gabriel: path.join(__dirname, "sao_gabriel_enlaces_checkcluster.cfg"),
  cachoeira_do_sul: path.join(__dirname, "cachoeira_do_sul_enlaces_checkcluster.cfg"),
  alegrete: path.join(__dirname, "alegrete_enlaces_checkcluster.cfg"),
  rosario_do_sul: path.join(__dirname, "rosario_do_sul_enlaces_checkcluster.cfg"),
  uruguaiana: path.join(__dirname, "uruguaiana_enlaces_checkcluster.cfg"),
  sao_borja: path.join(__dirname, "sao_borja_enlaces_checkcluster.cfg"),
  santa_maria: path.join(__dirname, "santa_maria_enlaces_checkcluster.cfg"),
};

// Nomes usados no Nagios → nomes do locations.json
const ENLACE_ALIAS = {
  CMDAD3: "CMD_AD3",
  BIACMDAD3: "BIA_CMD_AD3",
  PMEDCZA: "P_MED_CZA",
  // 1CTA vai ficar sem, até você cadastrar no locations.json
};

async function readEnlaces(city) {
  const cfgPath = ENLACES_CFG[city];
  if (!cfgPath) return [];

  const raw = await fs.readFile(cfgPath, "utf8");

  const blocks = raw.split("define service").slice(1);
  const enlaces = [];

  for (const block of blocks) {
    const hostMatch = block.match(/host_name\s+([^\n]+)/);
    const descMatch = block.match(/service_description\s+([^\n]+)/);
    const cmdMatch = block.match(/check_command\s+([^\n]+)/);

    if (!hostMatch || !descMatch || !cmdMatch) continue;

    const host_name = hostMatch[1].trim();
    const desc = descMatch[1].trim();
    const cmd = cmdMatch[1].trim();

    const parts = desc.split(/\s+/);
    if (parts.length < 3) continue;

    const rawA = parts[0];
    const rawTipo = parts[1].toUpperCase();
    const rawB = parts[2];

    const omA = ENLACE_ALIAS[rawA] || rawA;
    const omB = ENLACE_ALIAS[rawB] || rawB;

    const ipDestino = cmd.split("!").pop().trim();

    enlaces.push({
      host_name,
      service_description: desc,
      omA,
      omB,
      tipo: rawTipo,
      ipDestino
    });
  }

  return enlaces;
}

async function getServiceStatus(hostname, desc) {
  const url =
    `http://${NAGIOS_HOST}/nagios/cgi-bin/statusjson.cgi` +
    `?query=service&hostname=${encodeURIComponent(hostname)}` +
    `&servicedescription=${encodeURIComponent(desc)}`;

  const res = await fetch(url, { headers: nagiosAuth() });
  if (!res.ok) return null;

  const json = await res.json();
  return json.data.service || null;
}

function mapServiceStatus(code) {
  const map = {
    0: "OK",
    1: "WARNING",
    2: "CRITICAL",
    3: "UNKNOWN",
  };
  return map[code] ?? "UNKNOWN";
}


app.listen(PORT, () => {
  console.log(`SIVIR rodando em http://0.0.0.0:${PORT}`);
});

setInterval(atualizarCacheOMs, 2000);
atualizarCacheOMs(); // iniciar imediatamente