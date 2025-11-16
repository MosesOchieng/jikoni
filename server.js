const express = require("express");
const cors = require("cors");
const sqlite3 = require("sqlite3").verbose();
const path = require("path");
const nodemailer = require("nodemailer");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const app = express();
app.use(cors());
app.use(express.json());

const JWT_SECRET = process.env.JWT_SECRET || "dev-jikoni-secret-change-me";

// ----- SQLite setup -----
const dbPath = path.join(__dirname, "jikoni.db");
const db = new sqlite3.Database(dbPath);

db.serialize(() => {
  // For development we recreate the users table to switch schema
  db.run(`DROP TABLE IF EXISTS users`);
  db.run(`DROP TABLE IF EXISTS products`);
  db.run(`DROP TABLE IF EXISTS orders`);
  db.run(
    `CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      isVerified INTEGER NOT NULL DEFAULT 0,
      otp TEXT,
      passwordHash TEXT,
      points INTEGER NOT NULL DEFAULT 0,
      streak INTEGER NOT NULL DEFAULT 0,
      lastOrderDate TEXT
    )`
  );
  db.run(
    `CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL,
      itemsJson TEXT NOT NULL,
      deliveryMethod TEXT,
      paymentMethod TEXT,
      subtotal INTEGER,
      discounts INTEGER,
      deliveryFee INTEGER,
      total INTEGER,
      createdAt TEXT NOT NULL
    )`
  );
  db.run(
    `CREATE TABLE IF NOT EXISTS products (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      category TEXT NOT NULL,
      price INTEGER NOT NULL,
      unit TEXT NOT NULL,
      icon TEXT,
      glowType TEXT,
      isActive INTEGER NOT NULL DEFAULT 1
    )`
  );

  // Seed basic products if table is empty
  db.get("SELECT COUNT(*) as count FROM products", (err, row) => {
    if (err) {
      console.error("Product count error", err);
      return;
    }
    if (row && row.count === 0) {
      const seed = [
        ["sukuma", "Sukuma Wiki", "Vegetables", 40, "500 g", "🥬", "combo"],
        ["tomatoes", "Tomatoes", "Vegetables", 80, "1 kg", "🍅", "combo"],
        ["onions", "Onions", "Vegetables", 90, "1 kg", "🧅", "expiry"],
        ["eggs", "Eggs Tray", "Breakfast", 420, "30 pcs", "🥚", "streak"],
        ["milk", "Fresh Milk", "Dairy", 120, "1 L", "🥛", "loyalty"],
        ["honey", "Honey Jar", "Honey", 260, "500 g", "🍯", "combo"],
        ["maize_flour", "Maize Flour", "Flour", 200, "2 kg", "🌽", "combo"],
        ["rice", "Pishori Rice", "Cereals", 260, "2 kg", "🍚", "combo"],
        ["beans", "Rosecoco Beans", "Cereals", 220, "1 kg", "🫘", "expiry"],
      ];
      const stmt = db.prepare(
        "INSERT INTO products (id, name, category, price, unit, icon, glowType) VALUES (?, ?, ?, ?, ?, ?, ?)"
      );
      seed.forEach((p) => stmt.run(p));
      stmt.finalize();
    }
  });
});

function signToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email },
    JWT_SECRET,
    { expiresIn: "1d" }
  );
}

function authRequired(req, res, next) {
  const auth = req.headers.authorization || "";
  const parts = auth.split(" ");
  if (parts.length !== 2 || parts[0] !== "Bearer") {
    return res.status(401).json({ message: "Missing token" });
  }
  try {
    req.user = jwt.verify(parts[1], JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ message: "Invalid or expired token" });
  }
}

// ----- Mail setup (Nodemailer, JSON transport for now) -----
const mailer = nodemailer.createTransport({
  jsonTransport: true, // logs email content instead of actually sending; swap to real SMTP later
});

// ----- In-memory data (hubs / carts can stay in memory for now) -----
const hubs = [
  {
    id: "trm",
    name: "TRM Hub",
    areas: ["Thika Road", "Kasarani", "Roysambu"],
    etaMinutes: 8,
    walkInOffers: ["Buy 2 loaves, get 1 free", "Flash greens at 15% off"],
    stock: {
      sukuma: 48,
      tomatoes: 36,
      onions: 22,
      eggs: 14,
      milk: 60,
    },
  },
  {
    id: "westlands",
    name: "Westlands Hub",
    areas: ["Parklands", "Lavington", "Riverside"],
    etaMinutes: 12,
    walkInOffers: ["Morning milk bundle · save KSh 40"],
    stock: {
      sukuma: 30,
      tomatoes: 28,
      onions: 18,
      eggs: 20,
      milk: 40,
    },
  },
  {
    id: "cbd",
    name: "CBD Hub",
    areas: ["Upper Hill", "Ngara", "South B"],
    etaMinutes: 10,
    walkInOffers: ["Lunch-time veggie trays at 10% off"],
    stock: {
      sukuma: 40,
      tomatoes: 32,
      onions: 25,
      eggs: 18,
      milk: 55,
    },
  },
];
let carts = {}; // key = phone/email, value = [{ productId, qty }]

// ----- Auth -----

// Request OTP for signup
app.post("/api/auth/signup", (req, res) => {
  const { name, email, password } = req.body;
  if (!name || !email || !password) {
    return res.status(400).json({ message: "Name, email and password required" });
  }

  const otp = String(Math.floor(1000 + Math.random() * 9000));
  const passwordHash = bcrypt.hashSync(password, 10);

  // Upsert user manually to avoid ON CONFLICT quirks
  db.get("SELECT id FROM users WHERE email = ?", [email], (findErr, existing) => {
    if (findErr) {
      console.error("Signup lookup error", findErr);
      return res.status(500).json({ message: "Could not start signup" });
    }

    const handler = (err) => {
      if (err) {
        console.error("Signup save error", err);
        return res.status(500).json({ message: "Could not start signup" });
      }

      // Send email with Nodemailer (logged to console via jsonTransport)
      mailer.sendMail(
        {
          to: email,
          from: "no-reply@jikoni.app",
          subject: "Your Jikoni verification code",
          text: `Hi ${name},\n\nYour Jikoni verification code is: ${otp}\n\nIf you did not request this, you can ignore this email.\n`,
        },
        (mailErr, info) => {
          if (mailErr) {
            console.error("Mail error", mailErr);
          } else {
            console.log("Sent verification email:", info && (info.messageId || info));
          }
        }
      );

      // For now, also return the OTP in the response so the PWA can show it while testing
      res.json({ message: "OTP sent", email, code: otp });
    };

    if (!existing) {
      db.run(
        "INSERT INTO users (name, email, isVerified, otp, passwordHash) VALUES (?, ?, 0, ?, ?)",
        [name, email, otp, passwordHash],
        handler
      );
    } else {
      db.run(
        "UPDATE users SET name = ?, otp = ?, passwordHash = ? WHERE email = ?",
        [name, otp, passwordHash, email],
        handler
      );
    }
  });
});

// Verify OTP
app.post("/api/auth/verify", (req, res) => {
  const { email, code } = req.body;
  if (!email || !code) {
    return res.status(400).json({ message: "Email and code required" });
  }

  db.get("SELECT * FROM users WHERE email = ?", [email], (err, user) => {
    if (err) {
      console.error("Verify error", err);
      return res.status(500).json({ message: "Verification failed" });
    }
    if (!user || !user.otp || user.otp !== code) {
      return res.status(400).json({ message: "Invalid code" });
    }

    db.run(
      "UPDATE users SET isVerified = 1, otp = NULL WHERE email = ?",
      [email],
      (updateErr) => {
        if (updateErr) {
          console.error("Verify update error", updateErr);
          return res.status(500).json({ message: "Verification failed" });
        }
        const token = signToken(user);
        res.json({
          message: "Verified",
          user: { id: user.id, name: user.name, email: user.email },
          token,
        });
      }
    );
  });
});

// Login with email + password
app.post("/api/auth/login", (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ message: "Email and password required" });
  }

  db.get("SELECT * FROM users WHERE email = ?", [email], (err, user) => {
    if (err) {
      console.error("Login error", err);
      return res.status(500).json({ message: "Login failed" });
    }
    if (!user || !user.isVerified) {
      return res.status(400).json({ message: "User not found or not verified" });
    }
    if (!user.passwordHash || !bcrypt.compareSync(password, user.passwordHash)) {
      return res.status(400).json({ message: "Incorrect password" });
    }
    const token = signToken(user);
    res.json({
      user: { id: user.id, name: user.name, email: user.email },
      token,
    });
  });
});

// ----- Products & GlowCards -----

app.get("/api/products", (req, res) => {
  db.all(
    "SELECT id, name, category, price, unit, icon, glowType FROM products WHERE isActive = 1",
    (err, rows) => {
      if (err) {
        console.error("Products query error", err);
        return res.status(500).json({ message: "Could not load products" });
      }
      const products = rows.map((p) => ({
        id: p.id,
        name: p.name,
        category: p.category,
        price: p.price,
        unit: p.unit,
        icon: p.icon,
      }));
      const glowCards = rows.map((p) => {
        let message;
        switch (p.glowType) {
          case "combo":
            message = `Add ${p.name} to complete your combo and save more.`;
            break;
          case "streak":
            message = `Buy ${p.name} today to keep your streak and earn bonus points.`;
            break;
          case "expiry":
            message = `${p.name} is fresh but going fast — flash discount today.`;
            break;
          case "loyalty":
            message = `Add ${p.name} to earn double loyalty points.`;
            break;
          default:
            message = null;
        }
        return { productId: p.id, type: p.glowType, message };
      });

      res.json({ products, glowCards });
    }
  );
});

// ----- Hubs & Walk-in mode -----

app.get("/api/hubs", (req, res) => {
  res.json({ hubs });
});

// ----- Cart -----

app.get("/api/cart/:phone", (req, res) => {
  const phone = req.params.phone;
  res.json({ cart: carts[phone] || [] });
});

app.post("/api/cart/:phone", (req, res) => {
  const phone = req.params.phone;
  const { items } = req.body; // [{ productId, qty }]
  if (!Array.isArray(items)) {
    return res.status(400).json({ message: "items[] required" });
  }
  carts[phone] = items.filter((i) => i.qty > 0);
  res.json({ cart: carts[phone] });
});

// ----- Orders (auth required) -----

app.post("/api/orders", authRequired, (req, res) => {
  const { items, deliveryMethod, paymentMethod, totals } = req.body;
  const email = req.user.email;
  if (!Array.isArray(items) || !items.length) {
    return res.status(400).json({ message: "email and items required" });
  }
  const createdAt = new Date().toISOString();
  const subtotal = totals?.subtotal ?? 0;
  const discounts = totals?.discountTotal ?? 0;
  const deliveryFee = totals?.deliveryFee ?? 0;
  const total = totals?.total ?? 0;

  db.run(
    `INSERT INTO orders (email, itemsJson, deliveryMethod, paymentMethod, subtotal, discounts, deliveryFee, total, createdAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      email,
      JSON.stringify(items),
      deliveryMethod,
      paymentMethod,
      subtotal,
      discounts,
      deliveryFee,
      total,
      createdAt,
    ],
    function orderInserted(err) {
      if (err) {
        console.error("Order insert error", err);
        return res.status(500).json({ message: "Could not save order" });
      }

      const id = this.lastID;

      // award points & update streak
      const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
      const basePoints = Math.round((total || 0) / 50); // ~1pt per 50 KSh

      db.get(
        "SELECT id, points, streak, lastOrderDate FROM users WHERE email = ?",
        [email],
        (userErr, user) => {
          if (userErr || !user) {
            return res.json({ message: "Order placed", orderId: id });
          }

          let newStreak = user.streak || 0;
          if (!user.lastOrderDate) {
            newStreak = 1;
          } else {
            const last = new Date(user.lastOrderDate);
            const now = new Date(today);
            const diffDays = Math.round(
              (now - last) / (1000 * 60 * 60 * 24)
            );
            if (diffDays === 1) {
              newStreak = (user.streak || 0) + 1;
            } else if (diffDays > 1) {
              newStreak = 1; // streak reset
            }
          }

          const bonus =
            newStreak > 0 && newStreak % 5 === 0 ? 20 : 0; // small bonus every 5 days
          const newPoints = (user.points || 0) + basePoints + bonus;

          db.run(
            "UPDATE users SET points = ?, streak = ?, lastOrderDate = ? WHERE id = ?",
            [newPoints, newStreak, today, user.id],
            () => {
              res.json({
                message: "Order placed",
                orderId: id,
                awardedPoints: basePoints + bonus,
                streak: newStreak,
                points: newPoints,
              });
            }
          );
        }
      );
    }
  );
});

app.get("/api/orders", authRequired, (req, res) => {
  const email = req.user.email;
  db.all(
    "SELECT id, itemsJson, total, createdAt FROM orders WHERE email = ? ORDER BY datetime(createdAt) DESC LIMIT 20",
    [email],
    (err, rows) => {
      if (err) {
        console.error("Orders query error", err);
        return res.status(500).json({ message: "Could not load orders" });
      }
      const orders = rows.map((row) => ({
        id: row.id,
        total: row.total,
        createdAt: row.createdAt,
      }));
      res.json({ orders });
    }
  );
});

// ----- Loyalty summary (auth required) -----

app.get("/api/loyalty", authRequired, (req, res) => {
  const email = req.user.email;
  db.get(
    "SELECT points, streak, lastOrderDate FROM users WHERE email = ?",
    [email],
    (err, user) => {
      if (err || !user) {
        return res.status(404).json({ message: "User not found" });
      }
      const nextRewardAt = 100; // simple fixed threshold
      const toNextReward = Math.max(0, nextRewardAt - (user.points || 0));
      res.json({
        points: user.points || 0,
        streak: user.streak || 0,
        lastOrderDate: user.lastOrderDate || null,
        nextRewardAt,
        toNextReward,
      });
    }
  );
});

// ----- Start server -----

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`Jikoni API running on http://localhost:${PORT}`);
});


