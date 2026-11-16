import "dotenv/config";
import express, { type NextFunction, type Request, type Response } from "express";
import session from "express-session";
import bcrypt from "bcryptjs";
import { promisify } from "node:util";

const app = express();
const port = Number(process.env.PORT ?? 3000);
const isProduction = process.env.NODE_ENV === "production";
const secret = process.env.SESSION_SECRET;
if (!secret) throw new Error("session_secret fehlt in .env");

app.use(express.json());
app.use(session({
  secret,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: "lax",
    secure: isProduction,
    maxAge: 1000 * 60 * 30,
  },
}));

interface User {
  id: number;
  email: string;
  name: string;
  passwordHash: string;
}

const users: User[] = [];
const text = (value: unknown) => typeof value === "string" ? value : "";
const publicUser = ({ id, email, name }: User) => ({ id, email, name });
// immer die aktuelle session verwenden: regenerate ersetzt req.session.
const sessionTask = (req: Request, action: "regenerate" | "save" | "destroy") =>
  promisify(req.session[action].bind(req.session))();

const requireAuth = (req: Request, res: Response, next: NextFunction) => {
  if (!req.session.userId) return res.status(401).json({ error: "nicht angemeldet" });
  next();
};

app.get("/", (_req, res) => res.send("session-authentication demo"));
app.get("/visits", (req, res) => {
  req.session.visits = (req.session.visits ?? 0) + 1;
  res.json({ sessionId: req.sessionID, visits: req.session.visits });
});

app.post("/register", async (req, res) => {
  const email = text(req.body?.email).trim().toLowerCase();
  const name = text(req.body?.name).trim();
  const password = text(req.body?.password);
  if (!email || !name || !password) {
    return res.status(400).json({ error: "email, name und password sind erforderlich" });
  }
  if (password.length < 8 || bcrypt.truncates(password)) {
    return res.status(400).json({ error: "passwort: mindestens 8 zeichen, höchstens 72 bytes" });
  }
  const passwordHash = await bcrypt.hash(password, 10);
  // nach dem await prüfen: auch zwei gleichzeitige registrierungen bleiben eindeutig.
  if (users.some(user => user.email === email)) {
    return res.status(409).json({ error: "email bereits vergeben" });
  }
  const user = { id: users.length + 1, email, name, passwordHash };
  users.push(user);
  res.status(201).json(publicUser(user));
});

app.post("/login", async (req, res) => {
  const email = text(req.body?.email).trim().toLowerCase();
  const password = text(req.body?.password);
  const user = users.find(user => user.email === email);
  if (!user || bcrypt.truncates(password) || !await bcrypt.compare(password, user.passwordHash)) {
    return res.status(401).json({ error: "ungültige zugangsdaten" });
  }
  await sessionTask(req, "regenerate");
  req.session.userId = user.id;
  await sessionTask(req, "save");
  res.json({ message: "login erfolgreich", name: user.name });
});

app.get("/me", requireAuth, (req, res) => {
  const user = users.find(user => user.id === req.session.userId);
  if (!user) return res.status(401).json({ error: "nicht angemeldet" });
  res.json(publicUser(user));
});

app.post("/logout", requireAuth, async (req, res) => {
  await sessionTask(req, "destroy");
  res.clearCookie("connect.sid", { path: "/" });
  res.json({ message: "logout erfolgreich" });
});

app.listen(port, () => console.log(`server läuft auf http://localhost:${port}`));
