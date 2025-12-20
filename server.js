const express = require("express");
const cors = require("cors");
const sqlite3 = require("sqlite3").verbose();
const path = require("path");
const nodemailer = require("nodemailer");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const app = express();
// CORS configuration - allow all origins for development
app.use(cors({
  origin: true, // Allow all origins
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json());

const JWT_SECRET = process.env.JWT_SECRET || "dev-jikoni-secret-change-me";

// ----- SQLite setup -----
// Use /tmp on Vercel (read-only filesystem), project root for local dev
const dbPath = process.env.VERCEL
  ? path.join("/tmp", "jikoni.db")
  : path.join(__dirname, "jikoni.db");
const db = new sqlite3.Database(dbPath);

// In production we must NOT drop tables on every cold start,
// otherwise users and orders disappear. Allow optional reset
// in local dev with JIKONI_RESET_DB=true.
const shouldResetDb =
  !process.env.VERCEL && process.env.JIKONI_RESET_DB === "true";

db.serialize(() => {
  if (shouldResetDb) {
  db.run(`DROP TABLE IF EXISTS users`);
  db.run(`DROP TABLE IF EXISTS products`);
  db.run(`DROP TABLE IF EXISTS orders`);
  }
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
        ["bread", "Fresh Bread Loaf", "Breakfast", 70, "400 g", "🍞", "combo"],
        ["sugar", "Sugar", "Pantry", 150, "1 kg", "🧃", "expiry"],
        ["salt", "Table Salt", "Pantry", 40, "500 g", "🧂", "combo"],
        ["oil", "Cooking Oil", "Pantry", 350, "1 L", "🛢️", "loyalty"],
        ["chapati", "Chapati Pack", "Ready to Eat", 200, "10 pcs", "🥙", "combo"],
        ["ugali_mix", "Ugali & Greens Combo", "Combos", 260, "serves 2", "🥗", "combo"],
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

// ----- Mail setup (Nodemailer) -----
// For this demo we hard-code a Gmail app password so emails actually send.
// NOTE: In real projects you should ALWAYS use environment variables instead.
const mailer = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: "mosesochiengopiyo@gmail.com",
    pass: "yzunvoglhrpznylc", // Gmail app password (16 chars, no spaces)
  },
});

// Verify mailer connection on startup
mailer.verify((error, success) => {
  if (error) {
    console.error("❌ Mailer verification failed!");
    console.error("Error code:", error.code);
    console.error("Error message:", error.message);
    console.error("Full error:", JSON.stringify(error, null, 2));
    console.error("\n⚠️  Email sending may fail. Please check:");
    console.error("   1. Gmail account: mosesochiengopiyo@gmail.com");
    console.error("   2. App password is correct (16 characters)");
    console.error("   3. 2-Step Verification is enabled on the Gmail account");
    console.error("   4. 'Less secure app access' is not needed when using app passwords\n");
  } else {
    console.log("✅ Mailer verified and ready to send emails");
  }
});

// Helper function to create email template with Mama Mboga logo
function createEmailTemplate(title, content, gradientColor = "#f97316") {
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
    </head>
    <body style="margin: 0; padding: 0; background-color: #f6f2e7; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif;">
      <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f6f2e7; padding: 40px 20px;">
        <tr>
          <td align="center">
            <table width="600" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 12px rgba(0,0,0,0.1);">
              <!-- Header with Logo -->
              <tr>
                <td style="background: linear-gradient(135deg, ${gradientColor} 0%, ${gradientColor === "#f97316" ? "#ea580c" : gradientColor === "#22c55e" ? "#16a34a" : "#0284c7"} 100%); padding: 32px 40px; text-align: center;">
                  <div style="font-size: 36px; font-weight: 700; color: #ffffff; margin-bottom: 8px;">🍅 Mama Mboga</div>
                  <h1 style="margin: 0; color: #ffffff; font-size: 24px; font-weight: 600;">${title}</h1>
                </td>
              </tr>
              <!-- Content -->
              <tr>
                <td style="padding: 40px;">
                  ${content}
                </td>
              </tr>
              <!-- Footer -->
              <tr>
                <td style="padding: 24px 40px; background-color: #f6f2e7; text-align: center; border-top: 1px solid #e5e0d5;">
                  <p style="margin: 0; color: #647067; font-size: 14px;">Asante,<br><strong style="color: #0d3b32;">The Mama Mboga Team</strong></p>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
    </body>
    </html>
  `;
}

// ----- In-memory data (hubs / carts can stay in memory for now) -----
const hubs = [
  {
    id: "trm",
    name: "TRM Hub",
    areas: ["Thika Road", "Kasarani", "Roysambu"],
    etaMinutes: 8,
    lat: -1.2186,
    lng: 36.8933,
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
    lat: -1.2634,
    lng: 36.8025,
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
    lat: -1.2921,
    lng: 36.8219,
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

  // Generate a 6-digit verification code
  const otp = String(Math.floor(100000 + Math.random() * 900000));
  const passwordHash = bcrypt.hashSync(password, 10);

  // Check if email is already registered and verified
  db.get("SELECT id, isVerified FROM users WHERE email = ?", [email], (findErr, existing) => {
    if (findErr) {
      console.error("Signup lookup error", findErr);
      return res.status(500).json({ message: "Could not start signup" });
    }

    // Prevent duplicate registrations - if email exists and is verified, reject
    if (existing && existing.isVerified) {
      return res.status(400).json({ 
        message: "This email is already registered. Please log in instead." 
      });
    }

    const handler = (err) => {
      if (err) {
        console.error("Signup save error", err);
        return res.status(500).json({ message: "Could not start signup" });
      }

      // Send verification email with Nodemailer
      const verificationContent = `
        <p style="margin: 0 0 24px 0; color: #647067; font-size: 16px; line-height: 1.6;">Hi ${name},</p>
        <p style="margin: 0 0 24px 0; color: #647067; font-size: 16px; line-height: 1.6;">Welcome to Mama Mboga! Use this code to verify your email address:</p>
        <div style="background: linear-gradient(135deg, #f6f2e7 0%, #fdfaf2 100%); padding: 24px; border-radius: 12px; text-align: center; margin: 32px 0; border: 2px solid #f97316;">
          <div style="font-size: 36px; font-weight: 700; color: #0d3b32; letter-spacing: 8px; font-family: 'Courier New', monospace;">${otp}</div>
        </div>
        <p style="margin: 0 0 24px 0; color: #647067; font-size: 16px; line-height: 1.6;">Enter this 6-digit code in the app to complete your registration.</p>
        <p style="margin: 32px 0 0 0; color: #7a847f; font-size: 14px; line-height: 1.6;">If you didn't create a Mama Mboga account, you can safely ignore this email.</p>
      `;
      
      mailer.sendMail(
        {
          from: "mosesochiengopiyo@gmail.com", // Must match authenticated Gmail user
          to: email,
          subject: "Your Mama Mboga verification code",
          html: createEmailTemplate("Verify Your Email", verificationContent, "#f97316"),
          text: `Hi ${name},\n\nWelcome to Mama Mboga! Use this code to verify your email address:\n\n${otp}\n\nEnter this 6-digit code in the app to complete your registration.\n\nIf you didn't create a Mama Mboga account, you can safely ignore this email.\n\nAsante,\nThe Mama Mboga Team`,
        },
        (mailErr, info) => {
          if (mailErr) {
            console.error("Mail error:", mailErr);
            // Return error to frontend so user knows email failed
            return res.status(500).json({ 
              message: "Failed to send verification email. Please check your email address and try again.",
              error: mailErr.message 
            });
          }
          console.log("✅ Verification email sent to", email);
          // Do NOT return the OTP in the API response – only send it via email
          res.json({ message: "OTP sent", email });
        }
      );
    };

    if (!existing) {
      db.run(
        "INSERT INTO users (name, email, isVerified, otp, passwordHash) VALUES (?, ?, 0, ?, ?)",
        [name, email, otp, passwordHash],
        handler
      );
    } else {
      // User exists but not verified - update with new OTP and password
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

        // Send a beautiful welcome email after successful verification
        const welcomeContent = `
          <p style="margin: 0 0 24px 0; color: #0d3b32; font-size: 18px; font-weight: 600;">Hi ${user.name},</p>
          <p style="margin: 0 0 24px 0; color: #647067; font-size: 16px; line-height: 1.6;">Great news! Your email has been verified and your Mama Mboga account is now active. 🎉</p>
          
          <div style="background: #f6f2e7; padding: 24px; border-radius: 12px; margin: 32px 0;">
            <p style="margin: 0 0 16px 0; color: #0d3b32; font-size: 16px; font-weight: 600;">You can now:</p>
            <ul style="margin: 0; padding-left: 20px; color: #647067; font-size: 16px; line-height: 2;">
              <li>🛒 Shop fresh groceries and essentials</li>
              <li>🔥 Build your streak and earn loyalty points</li>
              <li>🎁 Get surprise hampers and exclusive glow offers</li>
              <li>🚚 Enjoy fast delivery from your nearest Mama Mboga hub</li>
            </ul>
          </div>

          <div style="text-align: center; margin: 32px 0;">
            <div style="display: inline-block; background: linear-gradient(135deg, #f97316 0%, #ea580c 100%); padding: 14px 32px; border-radius: 8px;">
              <p style="margin: 0; color: #ffffff; font-size: 16px; font-weight: 600;">Start Shopping Now →</p>
            </div>
          </div>

          <p style="margin: 32px 0 0 0; color: #647067; font-size: 16px; line-height: 1.6;">We're excited to have you as part of the Mama Mboga family!</p>
          <p style="margin: 16px 0 0 0; color: #7a847f; font-size: 14px; line-height: 1.6;">Questions? Reply to this email anytime.</p>
        `;
        
        mailer.sendMail(
          {
            from: "mosesochiengopiyo@gmail.com",
            to: email,
            subject: "Welcome to Mama Mboga! 🍅",
            html: createEmailTemplate("Karibu Mama Mboga! 🎉", welcomeContent, "#22c55e"),
            text: `Hi ${user.name},\n\nKaribu Mama Mboga! Your email has been verified and your account is now active.\n\nYou can now:\n- Shop fresh groceries and essentials\n- Build your streak and earn loyalty points\n- Get surprise hampers and exclusive glow offers\n- Enjoy fast delivery from your nearest Mama Mboga hub\n\nWe're excited to have you as part of the Mama Mboga family!\n\nAsante,\nThe Mama Mboga Team`,
          },
          (mailErr) => {
            if (mailErr) {
              console.error("Welcome mail error", mailErr);
            } else {
              console.log("✅ Welcome email sent to", email);
            }
          }
        );

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

// Forgot password - request reset code
app.post("/api/auth/forgot", (req, res) => {
  const { email } = req.body;
  if (!email) {
    return res.status(400).json({ message: "Email required" });
  }

  db.get("SELECT * FROM users WHERE email = ?", [email], (err, user) => {
    if (err) {
      console.error("Forgot password lookup error", err);
      return res.status(500).json({ message: "Could not start reset" });
    }
    if (!user) {
      return res.status(400).json({ message: "User not found" });
    }

    const otp = String(Math.floor(100000 + Math.random() * 900000));

    db.run(
      "UPDATE users SET otp = ? WHERE email = ?",
      [otp, email],
      (updateErr) => {
        if (updateErr) {
          console.error("Forgot password save error", updateErr);
          return res.status(500).json({ message: "Could not start reset" });
        }

        const resetContent = `
          <p style="margin: 0 0 24px 0; color: #647067; font-size: 16px; line-height: 1.6;">Hi ${user.name},</p>
          <p style="margin: 0 0 24px 0; color: #647067; font-size: 16px; line-height: 1.6;">You requested to reset your Mama Mboga password. Use this code to verify your identity:</p>
          <div style="background: linear-gradient(135deg, #f6f2e7 0%, #fdfaf2 100%); padding: 24px; border-radius: 12px; text-align: center; margin: 32px 0; border: 2px solid #f97316;">
            <div style="font-size: 36px; font-weight: 700; color: #0d3b32; letter-spacing: 8px; font-family: 'Courier New', monospace;">${otp}</div>
          </div>
          <p style="margin: 0 0 24px 0; color: #647067; font-size: 16px; line-height: 1.6;">Enter this 6-digit code in the app to reset your password.</p>
          <div style="background: #fff7ed; padding: 16px; border-radius: 8px; border-left: 4px solid #f97316; margin: 24px 0;">
            <p style="margin: 0; color: #7a847f; font-size: 14px; line-height: 1.6;">⚠️ <strong>Security tip:</strong> If you didn't request this password reset, please ignore this email. Your account remains secure.</p>
          </div>
        `;
        
        mailer.sendMail(
          {
            from: "mosesochiengopiyo@gmail.com",
            to: email,
            subject: "Reset your Mama Mboga password",
            html: createEmailTemplate("🔐 Password Reset", resetContent, "#f97316"),
            text: `Hi ${user.name},\n\nYou requested to reset your Mama Mboga password. Use this code to verify your identity:\n\n${otp}\n\nEnter this 6-digit code in the app to reset your password.\n\nIf you didn't request this password reset, please ignore this email. Your account remains secure.\n\nAsante,\nThe Mama Mboga Team`,
          },
          (mailErr) => {
            if (mailErr) {
              console.error("Reset mail error:", mailErr);
              return res.status(500).json({ 
                message: "Failed to send reset code. Please try again.",
                error: mailErr.message 
              });
            }
            console.log("✅ Reset code email sent to", email);
            res.json({ message: "Reset code sent", email });
          }
        );
      }
    );
  });
});

// Reset password with code
app.post("/api/auth/reset-password", (req, res) => {
  const { email, code, newPassword } = req.body;
  if (!email || !code || !newPassword) {
    return res.status(400).json({ message: "Email, code, and new password required" });
  }

  db.get("SELECT * FROM users WHERE email = ?", [email], (err, user) => {
    if (err) {
      console.error("Reset password lookup error", err);
      return res.status(500).json({ message: "Password reset failed" });
    }
    if (!user) {
      return res.status(400).json({ message: "User not found" });
    }
    if (!user.otp || user.otp !== code) {
      return res.status(400).json({ message: "Invalid or expired reset code" });
    }

    const passwordHash = bcrypt.hashSync(newPassword, 10);
    db.run(
      "UPDATE users SET passwordHash = ?, otp = NULL WHERE email = ?",
      [passwordHash, email],
      (updateErr) => {
        if (updateErr) {
          console.error("Reset password update error", updateErr);
          return res.status(500).json({ message: "Password reset failed" });
        }

        // Send confirmation email
        const resetConfirmContent = `
          <p style="margin: 0 0 24px 0; color: #0d3b32; font-size: 18px; font-weight: 600;">Hi ${user.name},</p>
          <p style="margin: 0 0 24px 0; color: #647067; font-size: 16px; line-height: 1.6;">Your Mama Mboga password has been successfully reset.</p>
          <div style="background: #f0fdf4; padding: 16px; border-radius: 8px; border-left: 4px solid #22c55e; margin: 24px 0;">
            <p style="margin: 0; color: #166534; font-size: 14px; line-height: 1.6;">🔒 Your account is now secure with your new password. You can log in using your new password.</p>
          </div>
          <p style="margin: 24px 0 0 0; color: #647067; font-size: 16px; line-height: 1.6;">If you didn't make this change, please contact us immediately.</p>
        `;
        
        mailer.sendMail(
          {
            from: "mosesochiengopiyo@gmail.com",
            to: email,
            subject: "Your Mama Mboga password has been reset",
            html: createEmailTemplate("✅ Password Reset Successful", resetConfirmContent, "#22c55e"),
            text: `Hi ${user.name},\n\nYour Mama Mboga password has been successfully reset.\n\nYour account is now secure with your new password. You can log in using your new password.\n\nIf you didn't make this change, please contact us immediately.\n\nAsante,\nThe Mama Mboga Team`,
          },
          (mailErr) => {
            if (mailErr) {
              console.error("Password reset confirmation email error", mailErr);
            } else {
              console.log("✅ Password reset confirmation email sent to", email);
            }
          }
        );

        res.json({ message: "Password reset successful" });
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

// ----- Cart (auth required) -----

app.get("/api/cart", authRequired, (req, res) => {
  const email = req.user.email;
  res.json({ cart: carts[email] || [] });
});

app.post("/api/cart", authRequired, (req, res) => {
  const email = req.user.email;
  const { items } = req.body; // [{ productId, qty }]
  if (!Array.isArray(items)) {
    return res.status(400).json({ message: "items[] required" });
  }
  carts[email] = items.filter((i) => i.qty > 0);
  res.json({ cart: carts[email] });
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

      // Process payment (placeholder - integrate with M-Pesa, card processor, or COD)
      // For now, we assume payment is successful
      // TODO: Integrate with actual payment gateways:
      // - M-Pesa: Use Safaricom Daraja API
      // - Card: Use Stripe, Flutterwave, or similar
      // - COD: Mark as pending, confirm on delivery
      const paymentStatus = paymentMethod === "cod" ? "pending" : "completed";
      console.log(`Order ${id}: Payment ${paymentStatus} via ${paymentMethod}`);

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
              // Get user name for email
              db.get("SELECT name FROM users WHERE email = ?", [email], (nameErr, userData) => {
                const userName = userData?.name || "Customer";
                
                // Get product names from database for email
                const productIds = items.map(item => item.productId);
                const placeholders = productIds.map(() => "?").join(",");
                
                db.all(
                  `SELECT id, name FROM products WHERE id IN (${placeholders})`,
                  productIds,
                  (prodErr, productRows) => {
                    const productMap = {};
                    if (!prodErr && productRows) {
                      productRows.forEach(p => { productMap[p.id] = p.name; });
                    }
                    
                    const orderItems = items.map(item => {
                      const productName = productMap[item.productId] || `Item #${item.productId}`;
                      return `${productName} x${item.qty}`;
                    }).join(", ");

                    const orderContent = `
                      <p style="margin: 0 0 24px 0; color: #0d3b32; font-size: 18px; font-weight: 600;">Hi ${userName},</p>
                      <p style="margin: 0 0 24px 0; color: #647067; font-size: 16px; line-height: 1.6;">Your order has been confirmed and is being prepared!</p>
                      <div style="background: #f6f2e7; padding: 20px; border-radius: 12px; margin: 24px 0;">
                        <div style="font-weight: 600; color: #0d3b32; margin-bottom: 12px; font-size: 16px;">Order Details</div>
                        <div style="font-size: 14px; color: #647067; margin-bottom: 8px;"><strong>Order #:</strong> ${id}</div>
                        <div style="font-size: 14px; color: #647067; margin-bottom: 8px;"><strong>Items:</strong> ${orderItems}</div>
                        <div style="font-size: 14px; color: #647067; margin-bottom: 8px;"><strong>Total:</strong> KSh ${total}</div>
                        <div style="font-size: 14px; color: #647067;"><strong>Delivery:</strong> ${deliveryMethod === "delivery" ? "Home delivery" : "Pickup at hub"}</div>
                      </div>
                      <p style="margin: 24px 0 0 0; color: #647067; font-size: 16px; line-height: 1.6;">You earned <strong style="color: #f97316;">${basePoints + bonus} points</strong> from this order! Track your order in the app.</p>
                    `;

                    mailer.sendMail(
                      {
                        from: "mosesochiengopiyo@gmail.com",
                        to: email,
                        subject: `Order Confirmed - #${id}`,
                        html: createEmailTemplate("Order Confirmed! 🎉", orderContent, "#22c55e"),
                        text: `Hi ${userName},\n\nYour order #${id} has been confirmed. Total: KSh ${total}\n\nYou earned ${basePoints + bonus} points from this order!\n\nTrack your order in the app.\n\nAsante,\nThe Mama Mboga Team`,
                      },
                      (mailErr) => {
                        if (mailErr) {
                          console.error("Order confirmation email error:", mailErr);
                        } else {
                          console.log("✅ Order confirmation email sent to", email);
                        }
                      }
                    );

                    res.json({
                      message: "Order placed",
                      orderId: id,
                      awardedPoints: basePoints + bonus,
                      streak: newStreak,
                      points: newPoints,
                      createdAt,
                    });
                  }
                );
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

// Mark order as delivered and send delivery email
app.post("/api/orders/:orderId/delivered", authRequired, (req, res) => {
  const { orderId } = req.params;
  const email = req.user.email;
  
  db.get("SELECT * FROM orders WHERE id = ? AND email = ?", [orderId, email], (err, order) => {
    if (err) {
      console.error("Order lookup error", err);
      return res.status(500).json({ message: "Could not find order" });
    }
    if (!order) {
      return res.status(404).json({ message: "Order not found" });
    }
    
    // Get user details
    db.get("SELECT name FROM users WHERE email = ?", [email], (userErr, user) => {
      if (userErr || !user) {
        return res.status(500).json({ message: "Could not find user" });
      }
      
      const orderItems = JSON.parse(order.itemsJson || "[]");
      
      // Get product names from database
      const productIds = orderItems.map(item => item.productId);
      const placeholders = productIds.map(() => "?").join(",");
      
      db.all(
        `SELECT id, name FROM products WHERE id IN (${placeholders})`,
        productIds,
        (prodErr, productRows) => {
          if (prodErr) {
            console.error("Product lookup error", prodErr);
            // Fallback: use item names if available
            const itemsList = orderItems.map(item => `Item x${item.qty}`).join(", ");
            sendDeliveryEmail();
            return;
          }
          
          const productMap = {};
          productRows.forEach(p => { productMap[p.id] = p.name; });
          
          const itemsList = orderItems.map(item => {
            const productName = productMap[item.productId] || `Item #${item.productId}`;
            return `${productName} x${item.qty}`;
          }).join(", ");
          
          sendDeliveryEmail();
          
          function sendDeliveryEmail() {
      
            const deliveryContent = `
              <p style="margin: 0 0 24px 0; color: #0d3b32; font-size: 18px; font-weight: 600;">Hi ${user.name},</p>
              <p style="margin: 0 0 24px 0; color: #647067; font-size: 16px; line-height: 1.6;">Great news! Your order has been delivered! 🎉</p>
              
              <div style="background: #f6f2e7; padding: 20px; border-radius: 12px; margin: 24px 0;">
                <div style="font-weight: 600; color: #0d3b32; margin-bottom: 12px; font-size: 16px;">Order Summary</div>
                <div style="font-size: 14px; color: #647067; margin-bottom: 8px;"><strong>Order #:</strong> ${orderId}</div>
                <div style="font-size: 14px; color: #647067; margin-bottom: 8px;"><strong>Items:</strong> ${itemsList}</div>
                <div style="font-size: 14px; color: #647067;"><strong>Total:</strong> KSh ${order.total}</div>
              </div>
              
              <div style="background: #f0fdf4; padding: 16px; border-radius: 8px; border-left: 4px solid #22c55e; margin: 24px 0;">
                <p style="margin: 0; color: #166534; font-size: 14px; line-height: 1.6;">✅ Your order has been successfully delivered. We hope you enjoy your groceries!</p>
              </div>
              
              <p style="margin: 24px 0 0 0; color: #647067; font-size: 16px; line-height: 1.6;">Thank you for choosing Mama Mboga. We'd love to hear your feedback!</p>
            `;
            
            // Send delivery email
            mailer.sendMail(
              {
                from: "mosesochiengopiyo@gmail.com",
                to: email,
                subject: `Order Delivered - #${orderId} 🎉`,
                html: createEmailTemplate("Order Delivered! 🎉", deliveryContent, "#22c55e"),
                text: `Hi ${user.name},\n\nGreat news! Your order #${orderId} has been delivered!\n\nItems: ${itemsList}\nTotal: KSh ${order.total}\n\nThank you for choosing Mama Mboga!\n\nAsante,\nThe Mama Mboga Team`,
              },
              (mailErr) => {
                if (mailErr) {
                  console.error("Delivery email error:", mailErr);
                } else {
                  console.log("✅ Delivery email sent to", email);
                }
              }
            );
            
            res.json({ message: "Order marked as delivered", orderId });
          }
        }
      );
    });
  });
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
 
// ----- Serve frontend (static PWA) -----

app.use(express.static(__dirname));

// Catch-all route for SPA - must be after all API routes
// Express 5 doesn't support "*", so we use a regex pattern
app.get(/^(?!\/api).*/, (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

// ----- Start server (only when running locally) -----

if (!process.env.VERCEL) {
  const PORT = process.env.PORT || 4000;
  app.listen(PORT, () => {
    console.log(`Mama Mboga API + frontend running on http://localhost:${PORT}`);
  });
}

module.exports = app;


