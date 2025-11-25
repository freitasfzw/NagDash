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

      console.log(`Hostgroup ${g}:`, hosts.length, "hosts carregados");
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

// ===========================
//  API PROTEGIDA
// ===========================
app.get("/api/om-status", requireLogin, async (req, res) => {
  try {
    const locations = await readLocations();
    const hostnames = await getHostList();

    const details = {};
    for (const h of hostnames) {
      details[h] = await getHostDetails(h);
    }

    const merged = locations.map((loc) => {
      const detail = details[loc.hostname];

      if (!detail) {
        return { ...loc, status: "UNKNOWN", last_check: null };
      }

      const code = detail.last_hard_state ?? detail.status;

      const STATUS_MAP = {
        0: "UP",
        1: "DOWN",
        2: "UNREACHABLE",
        3: "UNKNOWN",
      };

      return {
        ...loc,
        status: STATUS_MAP[code] || "UNKNOWN",
        last_check: detail.last_check
          ? new Date(detail.last_check).toLocaleString("pt-BR")
          : null,
      };
    });

    res.json(merged);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ===========================
app.listen(PORT, () => {
  console.log(`SIVIR rodando em http://0.0.0.0:${PORT}`);
});
