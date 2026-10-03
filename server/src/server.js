import express from "express";
import mysql from "mysql2/promise";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import Stripe from "stripe";

const app = express();
const port = Number(process.env.PORT || 3000);
const apiPrefix = String(process.env.API_PREFIX || "/api/sheets-drawer").replace(/\/$/, "");
const publicUrl = String(process.env.PUBLIC_URL || `http://localhost:${port}`).replace(/\/$/, "");
const jwtSecret = String(process.env.JWT_SECRET || "");
const adminName = String(process.env.ADMIN_NAME || "Administrador").trim();
const adminEmail = String(process.env.ADMIN_EMAIL || "").trim().toLowerCase();
const adminPassword = String(process.env.ADMIN_PASSWORD || "");
const stripe = process.env.STRIPE_SECRET_KEY ? new Stripe(process.env.STRIPE_SECRET_KEY) : null;
const stripeWebhookSecret = String(process.env.STRIPE_WEBHOOK_SECRET || "");

if (process.env.NODE_ENV === "production" && jwtSecret.length < 32) {
  throw new Error("JWT_SECRET debe tener al menos 32 caracteres en producción.");
}

let pool;

const databaseConfig = {
  host: process.env.DB_HOST || "localhost",
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || "sheetsdrawer",
  password: process.env.DB_PASSWORD || "sheetsdrawer",
  database: process.env.DB_NAME || "sheetsdrawer",
  waitForConnections: true,
  connectionLimit: 10,
  charset: "utf8mb4"
};

const connectDatabase = async () => {
  for (let attempt = 1; attempt <= 30; attempt += 1) {
    try {
      pool = mysql.createPool(databaseConfig);
      await pool.query("SELECT 1");
      return;
    } catch (error) {
      if (attempt === 30) throw error;
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
};

const ignoreDuplicateColumn = error => {
  if (error?.code !== "ER_DUP_FIELDNAME") throw error;
};

const migrate = async () => {
  await pool.query(`CREATE TABLE IF NOT EXISTS accounts (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(160) NOT NULL,
    status ENUM('active','suspended') NOT NULL DEFAULT 'active',
    expires_at DATETIME NULL,
    max_workspaces INT UNSIGNED NOT NULL DEFAULT 0,
    stripe_customer_id VARCHAR(190) NULL,
    stripe_subscription_id VARCHAR(190) NULL,
    billing_status VARCHAR(60) NULL,
    billing_plan VARCHAR(60) NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uniq_accounts_stripe_customer (stripe_customer_id),
    UNIQUE KEY uniq_accounts_stripe_subscription (stripe_subscription_id)
  )`);

  await pool.query(`CREATE TABLE IF NOT EXISTS users (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    account_id BIGINT UNSIGNED NULL,
    name VARCHAR(160) NOT NULL,
    email VARCHAR(190) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    role ENUM('superadmin','admin','user') NOT NULL DEFAULT 'user',
    active TINYINT(1) NOT NULL DEFAULT 1,
    last_login_at DATETIME NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_drawer_users_account FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE SET NULL
  )`);

  await pool.query(`CREATE TABLE IF NOT EXISTS workspaces (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    account_id BIGINT UNSIGNED NOT NULL,
    spreadsheet_id VARCHAR(200) NOT NULL,
    name VARCHAR(255) NOT NULL DEFAULT '',
    config_json JSON NOT NULL,
    revision BIGINT UNSIGNED NOT NULL DEFAULT 1,
    created_by BIGINT UNSIGNED NULL,
    updated_by BIGINT UNSIGNED NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uniq_drawer_workspace (account_id, spreadsheet_id),
    INDEX idx_drawer_workspace_updated (account_id, updated_at),
    CONSTRAINT fk_drawer_workspace_account FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE,
    CONSTRAINT fk_drawer_workspace_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT fk_drawer_workspace_updated_by FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL
  )`);

  await pool.query(`CREATE TABLE IF NOT EXISTS impersonation_logs (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    admin_user_id BIGINT UNSIGNED NOT NULL,
    target_user_id BIGINT UNSIGNED NOT NULL,
    account_id BIGINT UNSIGNED NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_drawer_imp_admin FOREIGN KEY (admin_user_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT fk_drawer_imp_target FOREIGN KEY (target_user_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT fk_drawer_imp_account FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE SET NULL
  )`);

  await pool.query(`CREATE TABLE IF NOT EXISTS billing_checkout_requests (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    stripe_session_id VARCHAR(190) NOT NULL UNIQUE,
    name VARCHAR(160) NOT NULL,
    email VARCHAR(190) NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    plan VARCHAR(60) NOT NULL,
    status ENUM('pending','completed','expired') NOT NULL DEFAULT 'pending',
    account_id BIGINT UNSIGNED NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_drawer_checkout_email (email),
    CONSTRAINT fk_drawer_checkout_account FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE SET NULL
  )`);

  await pool.query(`CREATE TABLE IF NOT EXISTS billing_plans (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    code VARCHAR(60) NOT NULL UNIQUE,
    name VARCHAR(160) NOT NULL,
    description TEXT NULL,
    amount_cents INT UNSIGNED NOT NULL,
    currency CHAR(3) NOT NULL DEFAULT 'usd',
    billing_interval ENUM('month','year') NOT NULL DEFAULT 'month',
    max_workspaces INT UNSIGNED NOT NULL DEFAULT 0,
    active TINYINT(1) NOT NULL DEFAULT 1,
    is_public TINYINT(1) NOT NULL DEFAULT 1,
    sort_order INT NOT NULL DEFAULT 0,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  )`);

  await pool.query("ALTER TABLE accounts ADD COLUMN max_workspaces INT UNSIGNED NOT NULL DEFAULT 0").catch(ignoreDuplicateColumn);
  await pool.query("ALTER TABLE billing_plans ADD COLUMN max_workspaces INT UNSIGNED NOT NULL DEFAULT 0").catch(ignoreDuplicateColumn);

  const [plans] = await pool.query("SELECT id FROM billing_plans LIMIT 1");
  if (!plans.length) {
    await pool.query(`INSERT INTO billing_plans
      (code, name, description, amount_cents, currency, billing_interval, max_workspaces, sort_order)
      VALUES
      ('monthly', 'Sheets CRM', 'Acceso mensual a Sheets Row Drawer', 1200, 'usd', 'month', 0, 10),
      ('annual', 'Sheets CRM', 'Acceso anual a Sheets Row Drawer', 9700, 'usd', 'year', 0, 20)`);
  }

  if (adminEmail && adminPassword) {
    const [users] = await pool.query("SELECT id FROM users WHERE email = ? LIMIT 1", [adminEmail]);
    if (!users.length) {
      const connection = await pool.getConnection();
      try {
        await connection.beginTransaction();
        const [account] = await connection.query("INSERT INTO accounts (name) VALUES (?)", ["Sheets Row Drawer"]);
        const passwordHash = await bcrypt.hash(adminPassword, 12);
        await connection.query(
          "INSERT INTO users (account_id, name, email, password_hash, role) VALUES (?, ?, ?, ?, 'superadmin')",
          [account.insertId, adminName, adminEmail, passwordHash]
        );
        await connection.commit();
      } catch (error) {
        await connection.rollback();
        throw error;
      } finally {
        connection.release();
      }
    }
  }
};

const normalizeEmail = value => String(value || "").trim().toLowerCase();
const validEmail = value => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
const normalizePlanCode = value => String(value || "").trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
const normalizeSpreadsheetId = value => {
  const id = String(value || "").trim();
  return /^[A-Za-z0-9_-]{8,200}$/.test(id) ? id : "";
};
const parseJson = value => {
  if (!value) return {};
  if (typeof value === "object") return value;
  try { return JSON.parse(value); } catch { return {}; }
};
const accountExpired = account => Boolean(account?.expires_at && new Date(account.expires_at).getTime() < Date.now());
const signToken = user => jwt.sign({
  id: user.id,
  accountId: user.account_id,
  role: user.role,
  impersonatedBy: user.impersonatedBy || null
}, jwtSecret || "sheets-row-drawer-development-only", { expiresIn: "7d" });
const publicUser = user => ({
  id: Number(user.id),
  accountId: user.account_id === null ? null : Number(user.account_id),
  name: user.name,
  email: user.email,
  role: user.role,
  active: Boolean(user.active),
  impersonatedBy: user.impersonatedBy ? Number(user.impersonatedBy) : null
});
const publicAccount = account => account ? ({
  id: Number(account.id),
  name: account.name,
  status: account.status,
  expiresAt: account.expires_at,
  expired: accountExpired(account),
  maxWorkspaces: Number(account.max_workspaces) || 0,
  billingStatus: account.billing_status || "",
  billingPlan: account.billing_plan || "",
  hasBillingPortal: Boolean(account.stripe_customer_id)
}) : null;
const publicPlan = plan => ({
  id: Number(plan.id),
  code: plan.code,
  name: plan.name,
  description: plan.description || "",
  amountCents: Number(plan.amount_cents) || 0,
  currency: plan.currency,
  interval: plan.billing_interval,
  maxWorkspaces: Number(plan.max_workspaces) || 0,
  active: Boolean(plan.active),
  public: Boolean(plan.is_public),
  sortOrder: Number(plan.sort_order) || 0
});

const findPlan = async (code, { publicOnly = false } = {}) => {
  const clauses = ["code = ?", "active = 1"];
  if (publicOnly) clauses.push("is_public = 1");
  const [rows] = await pool.query(`SELECT * FROM billing_plans WHERE ${clauses.join(" AND ")} LIMIT 1`, [normalizePlanCode(code)]);
  return rows[0] || null;
};
const listPlans = async ({ all = false } = {}) => {
  const [rows] = await pool.query(`SELECT * FROM billing_plans ${all ? "" : "WHERE active = 1 AND is_public = 1"} ORDER BY sort_order, id`);
  return rows.map(publicPlan);
};
const requireStripe = () => {
  if (!stripe) {
    const error = new Error("Stripe no está configurado.");
    error.statusCode = 503;
    throw error;
  }
  return stripe;
};
const subscriptionExpiry = subscription => {
  const seconds = Number(subscription?.current_period_end || 0);
  return seconds ? new Date(seconds * 1000) : null;
};

const loadSession = async (request, response, { allowBlocked = false } = {}) => {
  const authorization = request.get("authorization") || "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  if (!token) {
    response.status(401).json({ message: "No autenticado." });
    return null;
  }
  try {
    const payload = jwt.verify(token, jwtSecret || "sheets-row-drawer-development-only");
    const [users] = await pool.query("SELECT * FROM users WHERE id = ? LIMIT 1", [payload.id]);
    const user = users[0];
    if (!user || !user.active) {
      response.status(401).json({ message: "Usuario inactivo." });
      return null;
    }
    const [accounts] = user.account_id
      ? await pool.query("SELECT * FROM accounts WHERE id = ? LIMIT 1", [user.account_id])
      : [[]];
    const account = accounts[0] || null;
    if (!allowBlocked && user.role !== "superadmin") {
      if (!account || account.status !== "active") {
        response.status(403).json({ message: "Cuenta suspendida.", code: "ACCOUNT_SUSPENDED" });
        return null;
      }
      if (accountExpired(account)) {
        response.status(403).json({ message: "Cuenta expirada.", code: "ACCOUNT_EXPIRED" });
        return null;
      }
    }
    user.impersonatedBy = payload.impersonatedBy || null;
    request.user = user;
    request.account = account;
    return { user, account };
  } catch {
    response.status(401).json({ message: "Sesión inválida." });
    return null;
  }
};
const auth = async (request, response, next) => {
  if (await loadSession(request, response)) next();
};
const accountSession = async (request, response, next) => {
  if (await loadSession(request, response, { allowBlocked: true })) next();
};
const superadmin = (request, response, next) => {
  if (request.user?.role !== "superadmin") return response.status(403).json({ message: "Permiso denegado." });
  next();
};

app.disable("x-powered-by");
app.use((request, response, next) => {
  response.set({
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Cache-Control": "no-store"
  });
  next();
});

app.post(`${apiPrefix}/stripe/webhook`, express.raw({ type: "application/json", limit: "2mb" }), async (request, response) => {
  if (!stripe || !stripeWebhookSecret) return response.status(503).json({ message: "Webhook de Stripe no configurado." });
  let event;
  try {
    event = stripe.webhooks.constructEvent(request.body, request.get("stripe-signature") || "", stripeWebhookSecret);
  } catch (error) {
    return response.status(400).send(`Webhook inválido: ${error.message}`);
  }
  try {
    if (event.type === "checkout.session.completed") {
      const session = await stripe.checkout.sessions.retrieve(event.data.object.id, { expand: ["subscription"] });
      const [requests] = await pool.query("SELECT * FROM billing_checkout_requests WHERE stripe_session_id = ? LIMIT 1", [session.id]);
      const checkout = requests[0];
      const subscription = typeof session.subscription === "string"
        ? await stripe.subscriptions.retrieve(session.subscription)
        : session.subscription;
      const expiresAt = subscriptionExpiry(subscription);
      const customerId = typeof session.customer === "string" ? session.customer : session.customer?.id || null;
      const subscriptionId = typeof session.subscription === "string" ? session.subscription : session.subscription?.id || null;
      const renewalAccountId = Number(session.metadata?.renewalAccountId || 0);
      if (!checkout && renewalAccountId) {
        const plan = await findPlan(session.metadata?.plan);
        await pool.query(`UPDATE accounts SET status='active', expires_at=?, stripe_customer_id=COALESCE(?,stripe_customer_id), stripe_subscription_id=COALESCE(?,stripe_subscription_id), billing_status=?, billing_plan=?, max_workspaces=? WHERE id=?`,
          [expiresAt, customerId, subscriptionId, subscription?.status || session.payment_status, plan?.code || null, Number(plan?.max_workspaces) || 0, renewalAccountId]);
      }
      if (checkout?.status === "pending") {
        const plan = await findPlan(checkout.plan);
        const connection = await pool.getConnection();
        try {
          await connection.beginTransaction();
          const [existing] = await connection.query("SELECT * FROM users WHERE email = ? LIMIT 1", [checkout.email]);
          let accountId = existing[0]?.account_id || null;
          if (accountId) {
            await connection.query(`UPDATE accounts SET status='active', expires_at=?, stripe_customer_id=?, stripe_subscription_id=?, billing_status=?, billing_plan=?, max_workspaces=? WHERE id=?`,
              [expiresAt, customerId, subscriptionId, subscription?.status || session.payment_status, checkout.plan, Number(plan?.max_workspaces) || 0, accountId]);
            await connection.query("UPDATE users SET name=?, password_hash=?, active=1 WHERE id=?", [checkout.name, checkout.password_hash, existing[0].id]);
          } else {
            const [account] = await connection.query(`INSERT INTO accounts (name, status, expires_at, max_workspaces, stripe_customer_id, stripe_subscription_id, billing_status, billing_plan) VALUES (?, 'active', ?, ?, ?, ?, ?, ?)`,
              [checkout.name, expiresAt, Number(plan?.max_workspaces) || 0, customerId, subscriptionId, subscription?.status || session.payment_status, checkout.plan]);
            accountId = account.insertId;
            await connection.query("INSERT INTO users (account_id, name, email, password_hash, role) VALUES (?, ?, ?, ?, 'admin')",
              [accountId, checkout.name, checkout.email, checkout.password_hash]);
          }
          await connection.query("UPDATE billing_checkout_requests SET status='completed', account_id=? WHERE id=?", [accountId, checkout.id]);
          await connection.commit();
        } catch (error) {
          await connection.rollback();
          throw error;
        } finally {
          connection.release();
        }
      }
    }
    if (event.type === "checkout.session.expired") {
      await pool.query("UPDATE billing_checkout_requests SET status='expired' WHERE stripe_session_id=? AND status='pending'", [event.data.object.id]);
    }
    if (["customer.subscription.created", "customer.subscription.updated", "customer.subscription.deleted"].includes(event.type)) {
      const subscription = event.data.object;
      const active = ["active", "trialing"].includes(subscription.status);
      await pool.query("UPDATE accounts SET status=?, expires_at=?, billing_status=? WHERE stripe_subscription_id=?",
        [active ? "active" : "suspended", subscriptionExpiry(subscription), subscription.status, subscription.id]);
    }
    response.json({ received: true });
  } catch (error) {
    response.status(500).json({ message: error.message || "No se pudo procesar el webhook." });
  }
});

app.use(express.json({ limit: "3mb" }));

app.get(`${apiPrefix}/health`, (request, response) => response.json({ ok: true, service: "sheets-row-drawer" }));
app.get(`${apiPrefix}/billing/plans`, async (request, response) => response.json({ plans: await listPlans() }));

app.post(`${apiPrefix}/billing/checkout`, async (request, response) => {
  try {
    const stripeClient = requireStripe();
    const name = String(request.body?.name || "").trim();
    const email = normalizeEmail(request.body?.email);
    const password = String(request.body?.password || "");
    const plan = await findPlan(request.body?.plan, { publicOnly: true });
    if (!name || !validEmail(email) || password.length < 8 || !plan) {
      return response.status(400).json({ message: "Revisa el nombre, correo, contraseña y plan." });
    }
    const [existing] = await pool.query(`SELECT users.id, users.account_id, accounts.status, accounts.expires_at FROM users LEFT JOIN accounts ON accounts.id=users.account_id WHERE users.email=? LIMIT 1`, [email]);
    const existingUser = existing[0];
    if (existingUser && existingUser.status === "active" && !accountExpired(existingUser)) {
      return response.status(409).json({ message: "Ya existe una cuenta activa con ese correo." });
    }
    const passwordHash = await bcrypt.hash(password, 12);
    const session = await stripeClient.checkout.sessions.create({
      mode: "subscription",
      customer_email: email,
      success_url: `${publicUrl}/sheets-drawer/billing/success`,
      cancel_url: `${publicUrl}/sheets-drawer/billing/cancel`,
      metadata: { product: "sheets-row-drawer", plan: plan.code, email },
      line_items: [{
        quantity: 1,
        price_data: {
          currency: plan.currency,
          unit_amount: plan.amount_cents,
          recurring: { interval: plan.billing_interval },
          product_data: { name: plan.name }
        }
      }]
    });
    await pool.query(`INSERT INTO billing_checkout_requests (stripe_session_id,name,email,password_hash,plan,account_id) VALUES (?,?,?,?,?,?)
      ON DUPLICATE KEY UPDATE name=VALUES(name),email=VALUES(email),password_hash=VALUES(password_hash),plan=VALUES(plan),status='pending',account_id=VALUES(account_id)`,
      [session.id, name, email, passwordHash, plan.code, existingUser?.account_id || null]);
    response.json({ url: session.url });
  } catch (error) {
    response.status(error.statusCode || 500).json({ message: error.message || "No se pudo iniciar el pago." });
  }
});

app.post(`${apiPrefix}/billing/portal`, accountSession, async (request, response) => {
  try {
    const stripeClient = requireStripe();
    if (!request.account?.stripe_customer_id) return response.status(400).json({ message: "La cuenta no tiene una suscripción asociada." });
    const session = await stripeClient.billingPortal.sessions.create({
      customer: request.account.stripe_customer_id,
      return_url: `${publicUrl}/sheets-drawer/billing/success`
    });
    response.json({ url: session.url });
  } catch (error) {
    response.status(error.statusCode || 500).json({ message: error.message || "No se pudo abrir el portal de pagos." });
  }
});

app.post(`${apiPrefix}/billing/renew-checkout`, accountSession, async (request, response) => {
  try {
    const stripeClient = requireStripe();
    const plan = await findPlan(request.body?.plan || request.account?.billing_plan, { publicOnly: true });
    if (!plan) return response.status(400).json({ message: "Plan inválido." });
    const session = await stripeClient.checkout.sessions.create({
      mode: "subscription",
      customer: request.account?.stripe_customer_id || undefined,
      customer_email: request.account?.stripe_customer_id ? undefined : request.user.email,
      success_url: `${publicUrl}/sheets-drawer/billing/success`,
      cancel_url: `${publicUrl}/sheets-drawer/billing/cancel`,
      metadata: { product: "sheets-row-drawer", renewalAccountId: String(request.account.id), plan: plan.code },
      line_items: [{ quantity: 1, price_data: { currency: plan.currency, unit_amount: plan.amount_cents, recurring: { interval: plan.billing_interval }, product_data: { name: plan.name } } }]
    });
    response.json({ url: session.url });
  } catch (error) {
    response.status(error.statusCode || 500).json({ message: error.message || "No se pudo iniciar la renovación." });
  }
});

app.post(`${apiPrefix}/auth/login`, async (request, response) => {
  const email = normalizeEmail(request.body?.email);
  const password = String(request.body?.password || "");
  const [users] = await pool.query("SELECT * FROM users WHERE email=? LIMIT 1", [email]);
  const user = users[0];
  if (!user || !user.active || !await bcrypt.compare(password, user.password_hash)) {
    return response.status(401).json({ message: "Correo o contraseña incorrectos." });
  }
  const [accounts] = user.account_id ? await pool.query("SELECT * FROM accounts WHERE id=? LIMIT 1", [user.account_id]) : [[]];
  await pool.query("UPDATE users SET last_login_at=NOW() WHERE id=?", [user.id]);
  response.json({ token: signToken(user), user: publicUser(user), account: publicAccount(accounts[0]) });
});

app.get(`${apiPrefix}/auth/me`, accountSession, (request, response) => {
  response.json({ user: publicUser(request.user), account: publicAccount(request.account) });
});

app.put(`${apiPrefix}/auth/me`, accountSession, async (request, response) => {
  const name = String(request.body?.name || request.user.name).trim().slice(0, 160);
  const email = normalizeEmail(request.body?.email || request.user.email);
  const password = String(request.body?.password || "");
  if (!name || !validEmail(email) || (password && password.length < 8)) {
    return response.status(400).json({ message: "Revisa el nombre, correo y contraseña." });
  }
  try {
    const fields = ["name=?", "email=?"];
    const params = [name, email];
    if (password) {
      fields.push("password_hash=?");
      params.push(await bcrypt.hash(password, 12));
    }
    params.push(request.user.id);
    await pool.query(`UPDATE users SET ${fields.join(",")} WHERE id=?`, params);
    const [users] = await pool.query("SELECT * FROM users WHERE id=?", [request.user.id]);
    users[0].impersonatedBy = request.user.impersonatedBy || null;
    response.json({ user: publicUser(users[0]), account: publicAccount(request.account) });
  } catch (error) {
    response.status(error.code === "ER_DUP_ENTRY" ? 409 : 500).json({ message: error.code === "ER_DUP_ENTRY" ? "Ese correo ya está registrado." : "No se pudo actualizar la cuenta." });
  }
});

app.delete(`${apiPrefix}/account/data`, accountSession, async (request, response) => {
  if (request.body?.confirmation !== "ELIMINAR TODO") {
    return response.status(400).json({ message: "Escribe ELIMINAR TODO exactamente para continuar." });
  }
  if (request.user?.impersonatedBy) {
    return response.status(403).json({ message: "No puedes eliminar una cuenta durante una impersonación." });
  }
  if (!["admin", "superadmin"].includes(request.user?.role)) {
    return response.status(403).json({ message: "Solo el administrador de la cuenta puede eliminar todos sus datos." });
  }
  if (!request.account?.id) return response.status(404).json({ message: "Cuenta no encontrada." });

  const accountId = Number(request.account.id);
  const [result] = await pool.query("DELETE FROM workspaces WHERE account_id=?", [accountId]);
  response.json({ ok: true, accountId, deletedWorkspaces: Number(result.affectedRows) || 0 });
});

const workspaceForRequest = async request => {
  const spreadsheetId = normalizeSpreadsheetId(request.params.spreadsheetId);
  if (!spreadsheetId) return { spreadsheetId: "", workspace: null };
  const accountId = request.user.role === "superadmin" && request.query.accountId
    ? Number(request.query.accountId)
    : Number(request.user.account_id);
  const [rows] = await pool.query("SELECT * FROM workspaces WHERE account_id=? AND spreadsheet_id=? LIMIT 1", [accountId, spreadsheetId]);
  return { spreadsheetId, accountId, workspace: rows[0] || null };
};

app.get(`${apiPrefix}/workspaces`, auth, async (request, response) => {
  const accountId = request.user.role === "superadmin" && request.query.accountId ? Number(request.query.accountId) : request.user.account_id;
  const [rows] = await pool.query("SELECT id,account_id,spreadsheet_id,name,revision,created_at,updated_at FROM workspaces WHERE account_id=? ORDER BY updated_at DESC", [accountId]);
  response.json({ workspaces: rows });
});

app.get(`${apiPrefix}/workspaces/:spreadsheetId`, auth, async (request, response) => {
  const target = await workspaceForRequest(request);
  if (!target.spreadsheetId) return response.status(400).json({ message: "Documento inválido." });
  if (!target.workspace) return response.status(404).json({ message: "Workspace no encontrado.", code: "WORKSPACE_NOT_FOUND" });
  response.json({
    workspace: parseJson(target.workspace.config_json),
    revision: Number(target.workspace.revision),
    updatedAt: target.workspace.updated_at,
    name: target.workspace.name
  });
});

app.put(`${apiPrefix}/workspaces/:spreadsheetId`, auth, async (request, response) => {
  const spreadsheetId = normalizeSpreadsheetId(request.params.spreadsheetId);
  const workspace = request.body?.workspace;
  const name = String(request.body?.name || "").trim().slice(0, 255);
  if (!spreadsheetId || !workspace || typeof workspace !== "object" || Array.isArray(workspace)) {
    return response.status(400).json({ message: "Workspace inválido." });
  }
  const serialized = JSON.stringify(workspace);
  if (Buffer.byteLength(serialized, "utf8") > 2 * 1024 * 1024) {
    return response.status(413).json({ message: "El workspace supera el límite de 2 MB." });
  }
  const accountId = request.user.role === "superadmin" && request.body?.accountId ? Number(request.body.accountId) : Number(request.user.account_id);
  const [accounts] = await pool.query("SELECT id,max_workspaces FROM accounts WHERE id=? LIMIT 1", [accountId]);
  if (!accounts.length) return response.status(404).json({ message: "Cuenta no encontrada." });
  const [existing] = await pool.query("SELECT id,revision FROM workspaces WHERE account_id=? AND spreadsheet_id=? LIMIT 1", [accountId, spreadsheetId]);
  if (!existing.length && Number(accounts[0].max_workspaces) > 0) {
    const [count] = await pool.query("SELECT COUNT(*) total FROM workspaces WHERE account_id=?", [accountId]);
    if (Number(count[0].total) >= Number(accounts[0].max_workspaces)) {
      return response.status(403).json({ message: `La cuenta alcanzó su límite de ${accounts[0].max_workspaces} documentos.`, code: "WORKSPACE_LIMIT" });
    }
  }
  const expectedRevision = Number(request.body?.revision || 0);
  if (existing.length && expectedRevision && expectedRevision !== Number(existing[0].revision)) {
    return response.status(409).json({ message: "El workspace cambió en otra sesión.", code: "WORKSPACE_CONFLICT", revision: Number(existing[0].revision) });
  }
  await pool.query(`INSERT INTO workspaces (account_id,spreadsheet_id,name,config_json,created_by,updated_by)
    VALUES (?,?,?,?,?,?)
    ON DUPLICATE KEY UPDATE name=VALUES(name),config_json=VALUES(config_json),revision=revision+1,updated_by=VALUES(updated_by)`,
    [accountId, spreadsheetId, name, serialized, request.user.id, request.user.id]);
  const [saved] = await pool.query("SELECT revision,updated_at FROM workspaces WHERE account_id=? AND spreadsheet_id=?", [accountId, spreadsheetId]);
  response.json({ ok: true, revision: Number(saved[0].revision), updatedAt: saved[0].updated_at });
});

app.delete(`${apiPrefix}/workspaces/:spreadsheetId`, auth, async (request, response) => {
  const target = await workspaceForRequest(request);
  if (!target.spreadsheetId) return response.status(400).json({ message: "Documento inválido." });
  await pool.query("DELETE FROM workspaces WHERE account_id=? AND spreadsheet_id=?", [target.accountId, target.spreadsheetId]);
  response.json({ ok: true });
});

app.get(`${apiPrefix}/admin/accounts`, auth, superadmin, async (request, response) => {
  const [accounts] = await pool.query(`SELECT accounts.*,
    (SELECT COUNT(*) FROM users WHERE users.account_id=accounts.id) user_count,
    (SELECT COUNT(*) FROM workspaces WHERE workspaces.account_id=accounts.id) workspace_count,
    (SELECT users.email FROM users WHERE users.account_id=accounts.id AND users.role IN ('admin','superadmin') ORDER BY users.id LIMIT 1) admin_email
    FROM accounts ORDER BY accounts.created_at DESC`);
  response.json({ accounts: accounts.map(account => ({ ...publicAccount(account), userCount: Number(account.user_count), workspaceCount: Number(account.workspace_count), adminEmail: account.admin_email || "" })) });
});

app.post(`${apiPrefix}/admin/accounts`, auth, superadmin, async (request, response) => {
  const name = String(request.body?.name || "Nueva cuenta").trim();
  const email = normalizeEmail(request.body?.email);
  const password = String(request.body?.password || "");
  if (!name || !validEmail(email) || password.length < 8) return response.status(400).json({ message: "Nombre, correo y contraseña válida son requeridos." });
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [account] = await connection.query("INSERT INTO accounts (name,expires_at,max_workspaces) VALUES (?,?,?)", [name, request.body?.expiresAt || null, Math.max(0, Number(request.body?.maxWorkspaces) || 0)]);
    await connection.query("INSERT INTO users (account_id,name,email,password_hash,role) VALUES (?,?,?,?, 'admin')", [account.insertId, name, email, await bcrypt.hash(password, 12)]);
    await connection.commit();
    response.status(201).json({ ok: true, accountId: Number(account.insertId) });
  } catch (error) {
    await connection.rollback();
    response.status(error.code === "ER_DUP_ENTRY" ? 409 : 500).json({ message: error.code === "ER_DUP_ENTRY" ? "Ese correo ya existe." : "No se pudo crear la cuenta." });
  } finally {
    connection.release();
  }
});

app.put(`${apiPrefix}/admin/accounts/:id`, auth, superadmin, async (request, response) => {
  const accountId = Number(request.params.id);
  const status = ["active", "suspended"].includes(request.body?.status) ? request.body.status : "active";
  await pool.query("UPDATE accounts SET name=COALESCE(?,name),status=?,expires_at=?,max_workspaces=COALESCE(?,max_workspaces) WHERE id=?", [
    String(request.body?.name || "").trim() || null,
    status,
    request.body?.expiresAt || null,
    Number.isFinite(Number(request.body?.maxWorkspaces)) ? Math.max(0, Math.floor(Number(request.body.maxWorkspaces))) : null,
    accountId
  ]);
  if (request.body?.adminEmail || request.body?.adminPassword) {
    const [admins] = await pool.query("SELECT id FROM users WHERE account_id=? AND role IN ('admin','superadmin') ORDER BY id LIMIT 1", [accountId]);
    if (admins[0]) {
      if (request.body.adminEmail) await pool.query("UPDATE users SET email=? WHERE id=?", [normalizeEmail(request.body.adminEmail), admins[0].id]);
      if (request.body.adminPassword) await pool.query("UPDATE users SET password_hash=? WHERE id=?", [await bcrypt.hash(String(request.body.adminPassword), 12), admins[0].id]);
    }
  }
  response.json({ ok: true });
});

app.get(`${apiPrefix}/admin/users`, auth, superadmin, async (request, response) => {
  const [users] = await pool.query("SELECT id,account_id,name,email,role,active,last_login_at,created_at FROM users ORDER BY created_at DESC");
  response.json({ users: users.map(publicUser) });
});

app.post(`${apiPrefix}/admin/users/:id/impersonate`, auth, superadmin, async (request, response) => {
  const [users] = await pool.query("SELECT * FROM users WHERE id=? LIMIT 1", [Number(request.params.id)]);
  const target = users[0];
  if (!target || !target.active) return response.status(404).json({ message: "Usuario no encontrado." });
  await pool.query("INSERT INTO impersonation_logs (admin_user_id,target_user_id,account_id) VALUES (?,?,?)", [request.user.id, target.id, target.account_id]);
  const [accounts] = target.account_id ? await pool.query("SELECT * FROM accounts WHERE id=?", [target.account_id]) : [[]];
  target.impersonatedBy = request.user.id;
  response.json({ token: signToken(target), user: publicUser(target), account: publicAccount(accounts[0]) });
});

app.get(`${apiPrefix}/admin/billing-plans`, auth, superadmin, async (request, response) => response.json({ plans: await listPlans({ all: true }) }));

const planPayload = body => ({
  code: normalizePlanCode(body?.code),
  name: String(body?.name || "").trim().slice(0, 160),
  description: String(body?.description || "").trim(),
  amountCents: Math.max(0, Math.floor(Number(body?.amountCents) || 0)),
  currency: /^[a-z]{3}$/.test(String(body?.currency || "usd").toLowerCase()) ? String(body.currency || "usd").toLowerCase() : "usd",
  interval: body?.interval === "year" ? "year" : "month",
  maxWorkspaces: Math.max(0, Math.floor(Number(body?.maxWorkspaces) || 0)),
  active: body?.active === false ? 0 : 1,
  public: body?.public === false ? 0 : 1,
  sortOrder: Math.floor(Number(body?.sortOrder) || 0)
});

app.post(`${apiPrefix}/admin/billing-plans`, auth, superadmin, async (request, response) => {
  const plan = planPayload(request.body);
  if (!plan.code || !plan.name || !plan.amountCents) return response.status(400).json({ message: "Código, nombre y monto son requeridos." });
  try {
    await pool.query("INSERT INTO billing_plans (code,name,description,amount_cents,currency,billing_interval,max_workspaces,active,is_public,sort_order) VALUES (?,?,?,?,?,?,?,?,?,?)",
      [plan.code, plan.name, plan.description, plan.amountCents, plan.currency, plan.interval, plan.maxWorkspaces, plan.active, plan.public, plan.sortOrder]);
    response.status(201).json({ ok: true });
  } catch (error) {
    response.status(error.code === "ER_DUP_ENTRY" ? 409 : 500).json({ message: error.code === "ER_DUP_ENTRY" ? "Ese código ya existe." : "No se pudo crear el plan." });
  }
});

app.put(`${apiPrefix}/admin/billing-plans/:id`, auth, superadmin, async (request, response) => {
  const plan = planPayload(request.body);
  if (!plan.name || !plan.amountCents) return response.status(400).json({ message: "Nombre y monto son requeridos." });
  await pool.query("UPDATE billing_plans SET name=?,description=?,amount_cents=?,currency=?,billing_interval=?,max_workspaces=?,active=?,is_public=?,sort_order=? WHERE id=?",
    [plan.name, plan.description, plan.amountCents, plan.currency, plan.interval, plan.maxWorkspaces, plan.active, plan.public, plan.sortOrder, Number(request.params.id)]);
  response.json({ ok: true });
});

app.delete(`${apiPrefix}/admin/billing-plans/:id`, auth, superadmin, async (request, response) => {
  await pool.query("DELETE FROM billing_plans WHERE id=?", [Number(request.params.id)]);
  response.json({ ok: true });
});

app.get("/sheets-drawer/billing/success", (request, response) => response.type("html").send(`<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Pago completado</title><style>body{font:16px system-ui;display:grid;min-height:100vh;place-items:center;margin:0;color:#1f1f1f}.card{max-width:520px;border:1px solid #d9d9d9;border-radius:8px;padding:24px}h1{margin-top:0}</style><main class="card"><h1>Pago completado</h1><p>Stripe está activando tu cuenta. Vuelve a Google Sheets e inicia sesión en la extensión.</p></main></html>`));
app.get("/sheets-drawer/billing/cancel", (request, response) => response.type("html").send(`<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Pago cancelado</title><style>body{font:16px system-ui;display:grid;min-height:100vh;place-items:center;margin:0}.card{max-width:520px;border:1px solid #d9d9d9;border-radius:8px;padding:24px}h1{margin-top:0}</style><main class="card"><h1>Pago cancelado</h1><p>No se realizó ningún cargo. Puedes volver a la extensión cuando quieras.</p></main></html>`));

app.use((error, request, response, next) => {
  console.error(error);
  if (response.headersSent) return next(error);
  response.status(error.statusCode || 500).json({ message: error.message || "Error interno." });
});

await connectDatabase();
await migrate();
app.listen(port, () => console.log(`Sheets Row Drawer API en http://localhost:${port}${apiPrefix}`));
