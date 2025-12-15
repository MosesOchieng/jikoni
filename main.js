// Use relative URLs for production (Vercel), absolute for local dev
// Detect if we're on a different port than the API server
const API_BASE = (() => {
  const hostname = window.location.hostname;
  const port = window.location.port;
  
  // If on localhost/127.0.0.1/0.0.0.0 and not on port 4000, use port 4000 for API
  const isLocal = hostname === "localhost" || hostname === "127.0.0.1" || hostname === "0.0.0.0" || hostname === "";
  if (isLocal && port !== "4000") {
    return "http://localhost:4000";
  }
  // If on port 4000 or production, use relative URLs
  return "";
})();

const SCREENS = {
  LOADER: "loader",
  SPLASH_1: "splash1",
  SPLASH_2: "splash2",
  AUTH_CHOICE: "authChoice",
  SIGN_UP: "signup",
  LOGIN: "login",
  VERIFY: "verify",
   FORGOT: "forgot",
  HOME: "home",
  CART: "cart",
  LOYALTY: "loyalty",
  NOTIFICATIONS: "notifications",
  PROFILE: "profile",
  SEARCH: "search",
  ORDER_SUCCESS: "orderSuccess",
  ORDER_HISTORY: "orderHistory",
};

let currentScreen = SCREENS.LOADER;
let toastTimeout = null;
let currentUser = null;
let pendingUser = null;
let cart = [];
let deliveryMethod = "delivery"; // or "pickup"
let paymentMethod = "paystack"; // single payment method: Paystack
let heroIndex = 0;
let hubsData = [];
let currentHubId = "trm";
let walkInMode = false;
let loyaltyState = { points: 0, streak: 0, toNextReward: 100 };
let botOpen = false;
let botMessages = [];
let productsData = [];
let heroTimerSeconds = 59;
let notificationPrefs = { streakReminders: true, hamperAlerts: true };
let lastOrderSummary = null;
let deferredInstallPrompt = null;
let currentCategory = null; // For filtering products by category
let deliveryAddress = "";

function authHeaders() {
  if (currentUser?.token) {
    return {
      Authorization: `Bearer ${currentUser.token}`,
      "Content-Type": "application/json",
    };
  }
  return { "Content-Type": "application/json" };
}

function getCurrentHub() {
  return hubsData.find((h) => h.id === currentHubId) || hubsData[0] || {
    id: "trm",
    name: "TRM Hub",
    etaMinutes: 8,
    stock: { eggs: 0, sukuma: 0 },
  };
}

function getNearestHubForAddress(address) {
  if (!address) return getCurrentHub();
  const lower = address.toLowerCase();
  if (lower.includes("thika") || lower.includes("kasarani") || lower.includes("roysambu") || lower.includes("trm")) {
    return hubsData.find((h) => h.id === "trm") || getCurrentHub();
  }
  if (lower.includes("westlands") || lower.includes("parklands") || lower.includes("lavington") || lower.includes("riverside")) {
    return hubsData.find((h) => h.id === "westlands") || getCurrentHub();
  }
  if (lower.includes("cbd") || lower.includes("upper hill") || lower.includes("ngara") || lower.includes("south b")) {
    return hubsData.find((h) => h.id === "cbd") || getCurrentHub();
  }
  return getCurrentHub();
}

function loadState() {
  try {
    const savedUser = localStorage.getItem("jikoniUser");
    if (savedUser) {
      currentUser = JSON.parse(savedUser);
      // Load cart from backend if user is logged in
      if (currentUser?.email && currentUser?.token) {
        loadCartFromBackend();
      } else {
        // Fallback to local storage
        const savedCart = localStorage.getItem("jikoniCart");
        if (savedCart) cart = JSON.parse(savedCart);
      }
    } else {
      const savedCart = localStorage.getItem("jikoniCart");
      if (savedCart) cart = JSON.parse(savedCart);
    }
    const savedHub = localStorage.getItem("jikoniHub");
    if (savedHub) currentHubId = savedHub;
    const savedWalkIn = localStorage.getItem("jikoniWalkIn");
    if (savedWalkIn) walkInMode = savedWalkIn === "true";
    const savedPrefs = localStorage.getItem("jikoniNotificationPrefs");
    if (savedPrefs) notificationPrefs = JSON.parse(savedPrefs);
    const savedAddress = localStorage.getItem("jikoniAddress");
    if (savedAddress) deliveryAddress = savedAddress;
  } catch {
    // ignore
  }
}

function loadCartFromBackend() {
  if (!currentUser?.email || !currentUser?.token) return;
  fetch(`${API_BASE}/api/cart`, {
    method: "GET",
    headers: authHeaders(),
  })
    .then((res) => {
      if (res.ok) return res.json();
      throw new Error("Failed to load cart");
    })
    .then((data) => {
      if (data.cart && Array.isArray(data.cart)) {
        // Merge backend cart with local products data
        cart = data.cart.map((item) => {
          const product = productsData.find((p) => p.id === item.productId);
          if (product) {
            return {
              id: item.productId,
              name: product.name,
              meta: product.unit,
              price: product.price,
              qty: item.qty,
            };
          }
          return item;
        });
        saveCart(); // Save to localStorage too
      }
    })
    .catch((err) => {
      console.error("Cart load error:", err);
      // Fallback to local storage
      const savedCart = localStorage.getItem("jikoniCart");
      if (savedCart) cart = JSON.parse(savedCart);
    });
}

function saveUser() {
  if (currentUser) {
    localStorage.setItem("jikoniUser", JSON.stringify(currentUser));
  }
}

function saveCart() {
  localStorage.setItem("jikoniCart", JSON.stringify(cart));
  // Sync with backend if user is logged in
  if (currentUser?.email && currentUser?.token) {
    const items = cart.map((item) => ({
      productId: item.id,
      qty: item.qty,
    }));
    fetch(`${API_BASE}/api/cart`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ items }),
    }).catch((err) => {
      console.error("Cart sync error:", err);
      // Don't show error to user, cart is saved locally
    });
  }
}

function saveHubSettings() {
  localStorage.setItem("jikoniHub", currentHubId);
  localStorage.setItem("jikoniWalkIn", walkInMode ? "true" : "false");
}

function saveNotificationPrefs() {
  localStorage.setItem("jikoniNotificationPrefs", JSON.stringify(notificationPrefs));
}

function saveAddress() {
  if (deliveryAddress) {
    localStorage.setItem("jikoniAddress", deliveryAddress);
  }
}

function loadHubs() {
  const apiUrl = `${API_BASE}/api/hubs`;
  fetch(apiUrl)
    .then(async (res) => {
      if (!res.ok) {
        throw new Error(`Failed to load hubs: ${res.status}`);
      }
      return res.json();
    })
    .then((data) => {
      hubsData = data.hubs || [];
      render();
    })
    .catch((err) => {
      console.error("Failed to load hubs:", err);
      // Use default hub if API fails
      hubsData = [{
        id: "trm",
        name: "TRM Hub",
        areas: ["Thika Road", "Kasarani", "Roysambu"],
        etaMinutes: 8,
        walkInOffers: [],
        stock: { eggs: 0, sukuma: 0 },
      }];
    });
}

function loadLoyalty() {
  if (!currentUser?.email) return;
  fetch(`${API_BASE}/api/loyalty`, { headers: authHeaders() })
    .then((res) => {
      if (res.status === 401) {
        currentUser = null;
        localStorage.removeItem("jikoniUser");
        showToast("Session expired. Please log in again.");
        currentScreen = SCREENS.AUTH_CHOICE;
        render();
        throw new Error("unauthorized");
      }
      if (!res.ok) throw new Error();
      return res.json();
    })
    .then((data) => {
      loyaltyState = {
        points: data.points ?? 0,
        streak: data.streak ?? 0,
        toNextReward: data.toNextReward ?? 100,
      };
      render();
    })
    .catch(() => {
      // ignore for now
    });
}

function loadProducts() {
  if (productsData.length > 0) return; // Already loaded
  const apiUrl = `${API_BASE}/api/products`;
  console.log("Loading products from:", apiUrl);
  fetch(apiUrl, {
    method: "GET",
    headers: { "Content-Type": "application/json" },
  })
    .then(async (res) => {
      if (!res.ok) {
        throw new Error(`Failed to load products: ${res.status} ${res.statusText}`);
      }
      return res.json();
    })
    .then((data) => {
      productsData = data.products || [];
      if (currentScreen === SCREENS.SEARCH) {
        render(); // Re-render search if we're on that screen
      }
    })
    .catch((err) => {
      console.error("Failed to load products:", err);
      showToast("Could not load products. Make sure the backend is running on port 4000.");
    });
}

function render() {
  const root = document.getElementById("app");
  root.innerHTML = "";

  const shell = document.createElement("div");
  // Full-bleed layout and no top bar on loader / splash screens
  const isSplashLike =
    currentScreen === SCREENS.LOADER ||
    currentScreen === SCREENS.SPLASH_1 ||
    currentScreen === SCREENS.SPLASH_2;
  shell.className = isSplashLike ? "app-shell app-shell--fullscreen" : "app-shell";

  if (!isSplashLike) {
    const topBar = document.createElement("div");
    topBar.className = "top-bar";
    const logo = document.createElement("div");
    logo.className = "logo-mark";
    logo.innerHTML = `<img src="/public/logo.png" alt="Jikoni" class="logo-img" />`;
    const icons = document.createElement("div");
    icons.className = "top-icons";

    const bell = document.createElement("button");
    bell.className = "icon-btn";
    bell.textContent = "🔔";
    bell.onclick = () => {
      currentScreen = SCREENS.NOTIFICATIONS;
      render();
    };

    icons.appendChild(bell);
    topBar.appendChild(logo);
    topBar.appendChild(icons);
    shell.appendChild(topBar);
  }

  if (currentScreen === SCREENS.LOADER) {
    shell.appendChild(renderLoader());
  } else if (currentScreen === SCREENS.SPLASH_1) {
    shell.appendChild(renderSplash1());
  } else if (currentScreen === SCREENS.SPLASH_2) {
    shell.appendChild(renderSplash2());
  } else if (currentScreen === SCREENS.AUTH_CHOICE) {
    shell.appendChild(renderAuthChoice());
  } else if (currentScreen === SCREENS.SIGN_UP) {
    shell.appendChild(renderSignUp());
  } else if (currentScreen === SCREENS.LOGIN) {
    shell.appendChild(renderLogin());
  } else if (currentScreen === SCREENS.VERIFY) {
    shell.appendChild(renderVerify());
  } else if (currentScreen === SCREENS.FORGOT) {
    shell.appendChild(renderForgotPassword());
  } else if (currentScreen === SCREENS.CART) {
    shell.appendChild(renderCart());
  } else if (currentScreen === SCREENS.LOYALTY) {
    shell.appendChild(renderLoyalty());
  } else if (currentScreen === SCREENS.NOTIFICATIONS) {
    shell.appendChild(renderNotifications());
  } else if (currentScreen === SCREENS.PROFILE) {
    shell.appendChild(renderProfile());
  } else if (currentScreen === SCREENS.SEARCH) {
    // Ensure products are loaded
    if (productsData.length === 0) {
      loadProducts();
    }
    shell.appendChild(renderSearch());
  } else if (currentScreen === SCREENS.ORDER_SUCCESS) {
    shell.appendChild(renderOrderSuccess());
  } else if (currentScreen === SCREENS.ORDER_HISTORY) {
    shell.appendChild(renderOrderHistory());
  } else {
    shell.appendChild(renderHome());
  }

  root.appendChild(shell);

  renderFooterNav();

  // Only show the voice bot mic on the main dashboard (home) screen
  const existingBot = document.querySelector(".floating-bot");
  if (existingBot) existingBot.remove();
  if (currentScreen === SCREENS.HOME) {
    const bot = document.createElement("button");
    bot.className = "floating-bot";
    bot.innerHTML = "<span>🎙️</span>";
    bot.addEventListener("click", () => {
      botOpen = !botOpen;
      if (botOpen && botMessages.length === 0) {
        botMessages.push({
          from: "bot",
          text: "Hi, I’m Jikoni Bot. Try: “What’s on offer today?” or “Add eggs and sukuma.”",
        });
      }
      renderBotOverlay();
    });
    document.body.appendChild(bot);
  }

  renderBotOverlay();
}

function renderLoader() {
  const wrap = document.createElement("div");
  wrap.className = "loader-screen";
  wrap.innerHTML = `
    <div class="loader-inner">
      <img src="/public/logo.png" alt="Jikoni" class="loader-logo" />
      <div class="loader-spinner"></div>
    </div>
  `;
  return wrap;
}

function renderSplash1() {
  const container = document.createElement("div");
  container.className = "splash";
  container.style.backgroundImage =
    'url("/public/WhatsApp%20Image%202025-11-16%20at%2014.06.30.jpeg")';

  const hero = document.createElement("div");
  hero.className = "splash-hero";
  hero.innerHTML = `
    <div class="splash-title">Groceries that feel like a warm kitchen.</div>
    <div class="splash-subtitle">
      Fresh veggies, warm bread, and smart hampers — picked for how you really cook.
    </div>
  `;

  const footer = document.createElement("div");
  footer.className = "splash-footer";
  const primary = document.createElement("button");
  primary.className = "primary-btn";
  primary.textContent = "Continue";
  primary.onclick = () => {
    currentScreen = SCREENS.SPLASH_2;
    render();
  };
  const secondary = document.createElement("button");
  secondary.className = "secondary-btn";
  secondary.textContent = "Skip to home";
  secondary.onclick = () => {
    if (currentUser && currentUser.isVerified) {
      currentScreen = SCREENS.HOME;
    } else {
      currentScreen = SCREENS.AUTH_CHOICE;
    }
    render();
  };
  const meta = document.createElement("div");
  meta.className = "splash-meta";
  meta.textContent = "Built for how Nairobi shops, cooks, and lives.";

  const chipsRow = document.createElement("div");
  chipsRow.className = "chips-row";
  ["Voice orders", "Walk-in mode", "Subscriptions"].forEach((label) => {
    const c = document.createElement("div");
    c.className = "chip";
    c.textContent = label;
    chipsRow.appendChild(c);
  });

  footer.appendChild(primary);
  footer.appendChild(secondary);
  footer.appendChild(meta);
  footer.appendChild(chipsRow);

  container.appendChild(hero);
  container.appendChild(footer);
  return container;
}

function renderSplash2() {
  const container = document.createElement("div");
  container.className = "splash";
  container.style.backgroundImage =
    'url("/public/WhatsApp%20Image%202025-11-16%20at%2014.06.31.jpeg")';

  const hero = document.createElement("div");
  hero.className = "splash-secondary-card";
  hero.innerHTML = `
    <div class="splash-secondary-title">Streaks, glow cards & surprise hampers.</div>
    <div class="splash-secondary-text">
      Keep your streak, earn points, and unlock little kitchen surprises as you shop.
    </div>
  `;

  const footer = document.createElement("div");
  footer.className = "splash-footer";
  const primary = document.createElement("button");
  primary.className = "primary-btn";
  primary.textContent = "Get started";
  primary.onclick = () => {
    if (currentUser && currentUser.isVerified) {
      currentScreen = SCREENS.HOME;
    } else {
      currentScreen = SCREENS.AUTH_CHOICE;
    }
    render();
  };
  const secondary = document.createElement("button");
  secondary.className = "secondary-btn";
  secondary.textContent = "Back";
  secondary.onclick = () => {
    currentScreen = SCREENS.SPLASH_1;
    render();
  };

  const meta = document.createElement("div");
  meta.className = "splash-meta";
  meta.textContent = "Install Jikoni as an app for faster access later.";

  footer.appendChild(primary);
  footer.appendChild(secondary);
  footer.appendChild(meta);

  container.appendChild(hero);
  container.appendChild(footer);
  return container;
}

function renderAuthChoice() {
  const wrap = document.createElement("div");
  wrap.className = "auth-screen";

  const header = document.createElement("div");
  header.className = "auth-header";
  header.innerHTML = `
    <div style="display:flex; justify-content:center; margin-bottom:12px;">
      <img src="/public/logo.png" alt="Jikoni" style="height:72px; border-radius:16px;" />
    </div>
    <div class="auth-title">Welcome to Jikoni</div>
    <div class="auth-subtitle">Create an account with your email to track streaks, points, and hampers.</div>
  `;

  const heroImage = document.createElement("div");
  heroImage.style.marginTop = "12px";
  heroImage.style.borderRadius = "20px";
  heroImage.style.overflow = "hidden";
  heroImage.innerHTML = `
    <img src="/public/jikoni.jpeg" alt="Jikoni groceries" style="width:100%; display:block;" />
  `;

  const buttons = document.createElement("div");
  buttons.className = "splash-footer";
  const signup = document.createElement("button");
  signup.className = "primary-btn";
  signup.textContent = "Sign up with email";
  signup.onclick = () => {
    currentScreen = SCREENS.SIGN_UP;
    render();
  };
  const login = document.createElement("button");
  login.className = "secondary-btn";
  login.textContent = "I already have an account";
  login.onclick = () => {
    currentScreen = SCREENS.LOGIN;
    render();
  };

  const meta = document.createElement("div");
  meta.className = "splash-meta";
  meta.textContent = "We’ll send a 4‑digit code to verify it’s really you.";

  buttons.appendChild(signup);
  buttons.appendChild(login);
  buttons.appendChild(meta);

  wrap.appendChild(header);
  wrap.appendChild(heroImage);
  wrap.appendChild(buttons);
  return wrap;
}

function renderSignUp() {
  const wrap = document.createElement("div");
  wrap.className = "auth-screen";

  const header = document.createElement("div");
  header.className = "auth-header";
  header.innerHTML = `
    <div class="auth-title">Create your Jikoni account</div>
    <div class="auth-subtitle">Sign up with the email you check often.</div>
  `;

  const form = document.createElement("form");
  form.className = "auth-form";
  form.innerHTML = `
    <div>
      <div class="field-label">Full name</div>
      <input class="field-input" name="name" placeholder="Moses Mwangi" required />
    </div>
    <div>
      <div class="field-label">Email address</div>
      <input class="field-input" name="email" type="email" placeholder="moses@example.com" required />
      <div class="auth-helper">We’ll email you a one‑time code to confirm.</div>
    </div>
    <div>
      <div class="field-label">Password</div>
      <input class="field-input" name="password" type="password" placeholder="Create a strong password" required />
    </div>
    <div>
      <div class="field-label">Confirm password</div>
      <input class="field-input" name="confirmPassword" type="password" placeholder="Repeat your password" required />
    </div>
  `;

  const actions = document.createElement("div");
  actions.className = "splash-footer";
  const submit = document.createElement("button");
  submit.type = "submit";
  submit.className = "primary-btn";
  submit.textContent = "Create account";
  const back = document.createElement("button");
  back.type = "button";
  back.className = "secondary-btn";
  back.textContent = "Back";
  back.onclick = () => {
    currentScreen = SCREENS.AUTH_CHOICE;
    render();
  };
  actions.appendChild(submit);
  actions.appendChild(back);

  // Social auth section (UI only for now)
  const social = document.createElement("div");
  social.className = "auth-form";
  social.style.marginTop = "8px";
  social.innerHTML = `
    <div style="text-align:center; font-size:12px; color:#7a847f; margin-bottom:6px;">Or sign up with</div>
    <div style="display:flex; gap:8px;">
      <button type="button" class="secondary-btn" style="flex:1; display:flex; align-items:center; justify-content:center; gap:6px; font-size:14px;">
        <span>🔵</span><span>Google</span>
      </button>
      <button type="button" class="secondary-btn" style="flex:1; display:flex; align-items:center; justify-content:center; gap:6px; font-size:14px;">
        <span>📸</span><span>Instagram</span>
      </button>
    </div>
  `;
  const [googleBtn, instagramBtn] = social.querySelectorAll("button");
  googleBtn.addEventListener("click", () => {
    showToast("Google sign-up coming soon.");
  });
  instagramBtn.addEventListener("click", () => {
    showToast("Instagram sign-up coming soon.");
  });

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const formData = new FormData(form);
    const name = (formData.get("name") || "").toString().trim();
    const email = (formData.get("email") || "").toString().trim();
    const password = (formData.get("password") || "").toString();
    const confirmPassword = (formData.get("confirmPassword") || "").toString();
    if (!name || !email || !password || !confirmPassword) {
      showToast("Fill in your name, email and both password fields");
      return;
    }
    if (password !== confirmPassword) {
      showToast("Your passwords do not match. Please check and try again.");
      return;
    }
    pendingUser = { name, email };

    // Basic loading state
    showToast("Sending your code…");
    submit.disabled = true;
    const previousLabel = submit.textContent;
    submit.textContent = "Sending code…";

    const apiUrl = `${API_BASE}/api/auth/signup`;
    console.log("Signup API URL:", apiUrl);
    console.log("Signup payload:", { name, email, password: "***" });
    
    // Show loading state
    submit.disabled = true;
    submit.textContent = "Creating account...";
    submit.style.opacity = "0.7";
    
    fetch(apiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, email, password }),
    })
      .then(async (res) => {
        console.log("Signup response status:", res.status);
        const contentType = res.headers.get("content-type");
        if (!contentType || !contentType.includes("application/json")) {
          const text = await res.text();
          console.error("Non-JSON response:", text);
          throw new Error(`Server returned non-JSON response: ${res.status}`);
        }
        
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          const errorMsg = data.message || `Server error (${res.status})`;
          throw new Error(errorMsg);
        }
        return res.json();
      })
      .then((data) => {
        console.log("Signup success:", data);
        showToast("✅ Account created! Check your email for the verification code.");
        
        // Small delay to show success message, then redirect to verify
        setTimeout(() => {
          currentScreen = SCREENS.VERIFY;
          render();
        }, 1500);
      })
      .catch((err) => {
        console.error("Signup error:", err);
        let errorMsg = err.message || "Could not reach Jikoni servers";
        
        // More helpful error messages
        if (err.message.includes("Failed to fetch") || err.message.includes("NetworkError") || err.name === "TypeError") {
          errorMsg = "❌ Cannot connect to server. Make sure the backend is running on port 4000.";
        } else if (err.message.includes("404")) {
          errorMsg = "❌ API endpoint not found. Check server configuration.";
        } else if (err.message.includes("CORS")) {
          errorMsg = "❌ CORS error. Check server CORS settings.";
        } else if (err.message.includes("already exists") || err.message.includes("duplicate")) {
          errorMsg = "❌ This email is already registered. Try logging in instead.";
        }
        
        showToast(errorMsg);
        submit.disabled = false;
        submit.textContent = previousLabel;
        submit.style.opacity = "1";
      });
  });

  // Attach buttons inside the form so clicks always trigger submit
  form.appendChild(actions);

  wrap.appendChild(header);
  wrap.appendChild(form);
  wrap.appendChild(social);
  return wrap;
}

function renderLogin() {
  const wrap = document.createElement("div");
  wrap.className = "auth-screen";

  const header = document.createElement("div");
  header.className = "auth-header";
  header.innerHTML = `
    <div class="auth-title">Welcome back</div>
    <div class="auth-subtitle">Log in with the email and password you used to sign up.</div>
  `;

  const form = document.createElement("form");
  form.className = "auth-form";
  form.innerHTML = `
    <div>
      <div class="field-label">Email address</div>
      <input class="field-input" name="email" type="email" placeholder="you@example.com" required />
    </div>
    <div>
      <div class="field-label">Password</div>
      <input class="field-input" name="password" type="password" placeholder="Your password" required />
    </div>
  `;

  const actions = document.createElement("div");
  actions.className = "splash-footer";
  const submit = document.createElement("button");
  submit.type = "submit";
  submit.className = "primary-btn";
  submit.textContent = "Log in";
  const back = document.createElement("button");
  back.type = "button";
  back.className = "secondary-btn";
  back.textContent = "Back";
  back.onclick = () => {
    currentScreen = SCREENS.AUTH_CHOICE;
    render();
  };
  actions.appendChild(submit);
  actions.appendChild(back);

  const forgot = document.createElement("button");
  forgot.type = "button";
  forgot.className = "link-btn";
  forgot.textContent = "Forgot password?";
  forgot.onclick = () => {
    currentScreen = SCREENS.FORGOT;
    render();
  };
  actions.appendChild(forgot);

  // Social auth section (UI only for now)
  const social = document.createElement("div");
  social.className = "auth-form";
  social.style.marginTop = "8px";
  social.innerHTML = `
    <div style="text-align:center; font-size:12px; color:#7a847f; margin-bottom:6px;">Or continue with</div>
    <div style="display:flex; gap:8px;">
      <button type="button" class="secondary-btn" style="flex:1; display:flex; align-items:center; justify-content:center; gap:6px; font-size:14px;">
        <span>🔵</span><span>Google</span>
      </button>
      <button type="button" class="secondary-btn" style="flex:1; display:flex; align-items:center; justify-content:center; gap:6px; font-size:14px;">
        <span>📸</span><span>Instagram</span>
      </button>
    </div>
  `;
  const [loginGoogleBtn, loginInstagramBtn] = social.querySelectorAll("button");
  loginGoogleBtn.addEventListener("click", () => {
    showToast("Google login coming soon.");
  });
  loginInstagramBtn.addEventListener("click", () => {
    showToast("Instagram login coming soon.");
  });

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const email = (new FormData(form).get("email") || "").toString().trim();
    const password = (new FormData(form).get("password") || "").toString();
    if (!email || !password) {
      showToast("Enter your email and password");
      return;
    }

    const previousLabel = submit.textContent;
    submit.disabled = true;
    submit.textContent = "Checking…";

    const apiUrl = `${API_BASE}/api/auth/login`;
    console.log("Login API URL:", apiUrl);
    console.log("Login payload:", { email, password: "***" });
    
    // Show loading state
    submit.disabled = true;
    submit.textContent = "Logging in...";
    submit.style.opacity = "0.7";
    
    fetch(apiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    })
      .then(async (res) => {
        console.log("Login response status:", res.status);
        const contentType = res.headers.get("content-type");
        if (!contentType || !contentType.includes("application/json")) {
          const text = await res.text();
          console.error("Non-JSON response:", text);
          throw new Error(`Server returned non-JSON response: ${res.status}`);
        }
        
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          const errorMsg = data.message || `Server error (${res.status})`;
          throw new Error(errorMsg);
        }
        return res.json();
      })
      .then((data) => {
        console.log("Login success:", data);
        if (!data.user || !data.token) {
          throw new Error("Invalid response from server");
        }
        currentUser = { ...data.user, token: data.token };
        saveUser();
        showToast(`✅ Karibu back, ${currentUser.name || "rafiki"}!`);
        
        // Load user data
        loadLoyalty();
        loadCartFromBackend();
        
        // Small delay to show success message, then redirect to dashboard
        setTimeout(() => {
          currentScreen = SCREENS.HOME;
          render();
        }, 1500);
      })
      .catch((err) => {
        console.error("Login error:", err);
        let errorMsg = err.message || "Could not reach Jikoni servers";
        
        // More helpful error messages
        if (err.message.includes("Failed to fetch") || err.message.includes("NetworkError") || err.name === "TypeError") {
          errorMsg = "❌ Cannot connect to server. Make sure the backend is running on port 4000.";
        } else if (err.message.includes("404")) {
          errorMsg = "❌ API endpoint not found. Check server configuration.";
        } else if (err.message.includes("401") || err.message.includes("Incorrect password")) {
          errorMsg = "❌ Incorrect email or password. Please try again.";
        } else if (err.message.includes("not verified")) {
          errorMsg = "❌ Please verify your email first. Check your inbox for the verification code.";
        } else if (err.message.includes("User not found")) {
          errorMsg = "❌ No account found with this email. Please sign up first.";
        }
        
        showToast(errorMsg);
        submit.disabled = false;
        submit.textContent = previousLabel;
        submit.style.opacity = "1";
      });
  });

  // Attach buttons inside the form so clicks always trigger submit
  form.appendChild(actions);

  wrap.appendChild(header);
  wrap.appendChild(form);
  wrap.appendChild(social);
  return wrap;
}

function renderVerify() {
  const wrap = document.createElement("div");
  wrap.className = "auth-screen";

  const header = document.createElement("div");
  header.className = "auth-header";
  const emailMask = pendingUser ? pendingUser.email : "you@example.com";
  header.innerHTML = `
    <div class="auth-title">Enter the 4‑digit code</div>
    <div class="auth-subtitle">We’ve emailed a code to <strong>${emailMask}</strong>.</div>
  `;

  const form = document.createElement("form");
  form.className = "auth-form";
  form.innerHTML = `
    <div>
      <div class="field-label">Code</div>
      <div class="code-input-row">
        <input class="field-input code-input" name="c1" maxlength="1" inputmode="numeric" autocomplete="one-time-code" />
        <input class="field-input code-input" name="c2" maxlength="1" inputmode="numeric" autocomplete="one-time-code" />
        <input class="field-input code-input" name="c3" maxlength="1" inputmode="numeric" autocomplete="one-time-code" />
        <input class="field-input code-input" name="c4" maxlength="1" inputmode="numeric" autocomplete="one-time-code" />
        <input class="field-input code-input" name="c5" maxlength="1" inputmode="numeric" autocomplete="one-time-code" />
        <input class="field-input code-input" name="c6" maxlength="1" inputmode="numeric" autocomplete="one-time-code" />
      </div>
      <div class="auth-helper">Enter the 6‑digit code we emailed you.</div>
    </div>
  `;

  const actions = document.createElement("div");
  actions.className = "splash-footer";
  const submit = document.createElement("button");
  submit.type = "submit";
  submit.className = "primary-btn";
  submit.textContent = "Verify & continue";
  const back = document.createElement("button");
  back.type = "button";
  back.className = "secondary-btn";
  back.textContent = "Back";
  back.onclick = () => {
    currentScreen = SCREENS.SIGN_UP;
    render();
  };
  actions.appendChild(submit);
  actions.appendChild(back);

  const codeInputs = Array.from(form.querySelectorAll(".code-input"));
  codeInputs.forEach((input, idx) => {
    input.addEventListener("input", (e) => {
      const value = e.target.value.replace(/\D/g, "");
      e.target.value = value.slice(0, 1);
      if (value && idx < codeInputs.length - 1) {
        codeInputs[idx + 1].focus();
      }
    });
    input.addEventListener("keydown", (e) => {
      if (e.key === "Backspace" && !e.target.value && idx > 0) {
        codeInputs[idx - 1].focus();
      }
    });
  });

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const code = codeInputs.map((inp) => inp.value.trim()).join("");
    if (!pendingUser || !pendingUser.email) {
      showToast("Something went wrong, please start again.");
      currentScreen = SCREENS.SIGN_UP;
      render();
      return;
    }
    if (!code || code.length !== 6) {
      showToast("Enter the 6‑digit verification code");
      return;
    }

    const previousLabel = submit.textContent;
    submit.disabled = true;
    submit.textContent = "Verifying...";
    submit.style.opacity = "0.7";

    const apiUrl = `${API_BASE}/api/auth/verify`;
    console.log("Verify API URL:", apiUrl);
    console.log("Verify payload:", { email: pendingUser.email, code: "****" });

    fetch(apiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: pendingUser.email, code }),
    })
      .then(async (res) => {
        console.log("Verify response status:", res.status);
        const contentType = res.headers.get("content-type");
        if (!contentType || !contentType.includes("application/json")) {
          const text = await res.text();
          console.error("Non-JSON response:", text);
          throw new Error(`Server returned non-JSON response: ${res.status}`);
        }
        
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.message || "Verification failed");
        }
        return res.json();
      })
      .then((data) => {
        console.log("Verify success:", data);
        if (!data.user || !data.token) {
          throw new Error("Invalid response from server");
        }
        currentUser = { ...data.user, isVerified: true, token: data.token };
        saveUser();
        pendingUser = null;
        showToast("✅ Email verified! Welcome to Jikoni!");
        
        // Load user data
        loadLoyalty();
        loadCartFromBackend();
        
        // Small delay to show success message, then redirect to dashboard
        setTimeout(() => {
          currentScreen = SCREENS.HOME;
          render();
        }, 1500);
      })
      .catch((err) => {
        console.error("Verify error:", err);
        let errorMsg = err.message || "Could not reach Jikoni servers";
        
        if (err.message.includes("Failed to fetch") || err.message.includes("NetworkError") || err.name === "TypeError") {
          errorMsg = "❌ Cannot connect to server. Make sure the backend is running on port 4000.";
        } else if (err.message.includes("Invalid code")) {
          errorMsg = "❌ Invalid verification code. Please check and try again.";
        }
        
        showToast(errorMsg);
        submit.disabled = false;
        submit.textContent = previousLabel;
        submit.style.opacity = "1";
      });
  });

  // Attach buttons inside the form so clicks always trigger submit
  form.appendChild(actions);

  wrap.appendChild(header);
  wrap.appendChild(form);
  return wrap;
}

function renderForgotPassword() {
  const wrap = document.createElement("div");
  wrap.className = "auth-screen";

  const header = document.createElement("div");
  header.className = "auth-header";
  header.innerHTML = `
    <div class="auth-title">Forgot your password?</div>
    <div class="auth-subtitle">Enter the email you used for Jikoni and we’ll email you a reset code.</div>
  `;

  const form = document.createElement("form");
  form.className = "auth-form";
  form.innerHTML = `
    <div>
      <div class="field-label">Email address</div>
      <input class="field-input" name="email" type="email" placeholder="you@example.com" required />
    </div>
  `;

  const actions = document.createElement("div");
  actions.className = "splash-footer";
  const submit = document.createElement("button");
  submit.type = "submit";
  submit.className = "primary-btn";
  submit.textContent = "Send reset code";
  const back = document.createElement("button");
  back.type = "button";
  back.className = "secondary-btn";
  back.textContent = "Back to login";
  back.onclick = () => {
    currentScreen = SCREENS.LOGIN;
    render();
  };
  actions.appendChild(submit);
  actions.appendChild(back);

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const email = (new FormData(form).get("email") || "").toString().trim();
    if (!email) {
      showToast("Enter your email address");
      return;
    }

    const previousLabel = submit.textContent;
    submit.disabled = true;
    submit.textContent = "Sending…";
    submit.style.opacity = "0.7";

    const apiUrl = `${API_BASE}/api/auth/forgot`;
    console.log("Forgot password API URL:", apiUrl);
    console.log("Forgot password payload:", { email });

    fetch(apiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    })
      .then(async (res) => {
        const contentType = res.headers.get("content-type");
        if (!contentType || !contentType.includes("application/json")) {
          const text = await res.text();
          console.error("Non-JSON response (forgot):", text);
          throw new Error(`Server returned non-JSON response: ${res.status}`);
        }
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.message || `Server error (${res.status})`);
        }
        showToast("✅ Reset code sent. Check your email.");
        submit.disabled = false;
        submit.textContent = previousLabel;
        submit.style.opacity = "1";
      })
      .catch((err) => {
        console.error("Forgot password error:", err);
        let errorMsg = err.message || "Could not start reset";
        if (err.message.includes("Failed to fetch") || err.message.includes("NetworkError") || err.name === "TypeError") {
          errorMsg = "❌ Cannot connect to server. Make sure the backend is running on port 4000.";
        }
        showToast(errorMsg);
        submit.disabled = false;
        submit.textContent = previousLabel;
        submit.style.opacity = "1";
      });
  });

  form.appendChild(actions);

  wrap.appendChild(header);
  wrap.appendChild(form);
  return wrap;
}

function renderHome() {
  const container = document.createElement("div");
  container.className = "home";

  // If there is a recent order, surface a compact tracking card at the top
  if (lastOrderSummary) {
    const placedAt = lastOrderSummary.placedAt
      ? new Date(lastOrderSummary.placedAt)
      : new Date();
    const now = new Date();
    const minutes = Math.max(
      0,
      Math.floor((now.getTime() - placedAt.getTime()) / 60000)
    );
    let stage = 0;
    if (minutes >= 0) stage = 1;
    if (minutes >= 3) stage = 2;
    if (minutes >= 8) stage = 3;
    if (minutes >= 15) stage = 4;

    const nearestHub = getNearestHubForAddress(deliveryAddress);

    const trackCard = document.createElement("div");
    trackCard.className = "loyalty-widget";
    trackCard.style.marginTop = "4px";
    trackCard.innerHTML = `
      <div style="font-weight:600; margin-bottom:4px;">Your last order is on its way 🛵</div>
      <div style="font-size:12px; color:#647067; margin-bottom:6px;">
        ${
          stage === 1
            ? "We’ve received your order at the nearest Jikoni hub."
            : stage === 2
            ? "Your order is being picked & packed."
            : stage === 3
            ? "Your rider has left the hub and is on the way."
            : "Your rider is near your place. Tafadhali keep your phone close."
        }
      </div>
      <div style="display:flex; gap:8px; align-items:flex-start;">
        <div style="flex:2;">
          <div style="position:relative; height:6px; border-radius:999px; background:rgba(21,53,47,0.18); overflow:hidden;">
            <div style="height:100%; width:${(stage / 4) * 100}%; background:linear-gradient(90deg,#22c55e,#f97316);"></div>
          </div>
          <div style="margin-top:4px; font-size:11px; color:#647067;">
            Order #${lastOrderSummary.id} · KSh ${lastOrderSummary.total}
          </div>
          <div style="margin-top:2px; font-size:11px; color:#647067;">
            From ${nearestHub?.name || "Jikoni Hub"} ${deliveryAddress ? `→ ${deliveryAddress}` : ""}
          </div>
        </div>
        <div style="flex:1; text-align:right; font-size:24px;">🛵</div>
      </div>
    `;
    container.appendChild(trackCard);
  }

  const header = document.createElement("div");
  header.className = "home-header";
  header.innerHTML = `
    <div class="home-title-block">
      <div class="home-greeting">Good evening, ${currentUser?.name || "Moses"}</div>
      <div class="home-title"></div>
    </div>
  `;
  const right = document.createElement("div");
  right.style.display = "flex";
  right.style.gap = "8px";

  // Search bar now sits just under the header, above the Glow section
  const search = document.createElement("div");
  search.className = "search-bar";
  search.innerHTML = `
    <span>🔍</span>
    <input class="search-input" placeholder="Search flour, veggies, spices…" />
    <span>🎙️</span>
  `;

  const streak = document.createElement("div");
  streak.className = "streak-pill";
  streak.innerHTML = "🔥 Day 3";

  const cartChip = document.createElement("button");
  cartChip.className = "cart-chip";
  const count = cart.reduce((sum, item) => sum + item.qty, 0);
  cartChip.innerHTML = `🛒 <span>${count}</span>`;
  cartChip.onclick = () => {
    currentScreen = SCREENS.CART;
    render();
  };

  right.appendChild(streak);
  right.appendChild(cartChip);
  header.appendChild(right);

  const hubStrip = document.createElement("div");
  hubStrip.className = "hub-strip";
  const hub = getCurrentHub();
  const modeLabel = walkInMode ? "Walk-in mode" : "Delivery mode";
  const etaText = walkInMode
    ? `Avg wait ${hub?.etaMinutes || 8} min at counter`
    : `Delivery ~${hub?.etaMinutes || 8} min from ${hub?.name || "hub"}`;
  hubStrip.innerHTML = `
    <div class="hub-strip-main">
      <div class="hub-strip-title">${hub?.name || "TRM Hub"}</div>
      <div class="hub-strip-sub">${etaText}</div>
    </div>
    <button class="hub-strip-toggle">${walkInMode ? "Switch to delivery" : "I’m at the hub"}</button>
  `;
  const hubMain = hubStrip.querySelector(".hub-strip-main");
  hubMain.addEventListener("click", () => {
    if (!hubsData.length) {
      showToast("Finding your nearest Jikoni hub…");
      return;
    }
    const currentIndex = hubsData.findIndex((h) => h.id === currentHubId);
    const nextIndex = currentIndex === -1 ? 0 : (currentIndex + 1) % hubsData.length;
    currentHubId = hubsData[nextIndex].id;
    saveHubSettings();
    const nextHub = getCurrentHub();
    showToast(`Switched to ${nextHub.name}`);
    render();
  });
  const toggleBtn = hubStrip.querySelector(".hub-strip-toggle");
  toggleBtn.addEventListener("click", () => {
    walkInMode = !walkInMode;
    deliveryMethod = walkInMode ? "pickup" : "delivery";
    saveHubSettings();
    const msg = walkInMode
      ? `Walk-in mode on at ${hub?.name || "Jikoni Hub"}. We’ll prep your order while you queue.`
      : "Back to delivery mode from your nearest hub.";
    showToast(msg);
    render();
  });

  const heroGlow = document.createElement("div");
  heroGlow.className = "hero-glow";
  heroGlow.innerHTML = `
    <div class="hero-glow-pill"></div>
    <div class="hero-glow-title"></div>
    <div class="hero-glow-sub hero-glow-sub-main"></div>
    <div class="hero-glow-sub hero-glow-sub-secondary"></div>
  `;
  const heroCta = document.createElement("button");
  heroCta.className = "hero-glow-cta";
  heroCta.textContent = "Shop now";
  heroCta.onclick = () => showToast("Glow combo added to your suggestions");
  heroGlow.appendChild(heroCta);

  const timerEl = document.createElement("div");
  timerEl.className = "hero-glow-sub hero-timer";
  timerEl.textContent = `Offer ends in 00:${String(heroTimerSeconds).padStart(2, "0")}`;
  heroGlow.appendChild(timerEl);

  const iconsRow = document.createElement("div");
  iconsRow.className = "hero-glow-icons";
  iconsRow.innerHTML = "<span>🛵</span>";
  heroGlow.appendChild(iconsRow);

  // initialise hero text & timer without re-rendering page
  updateHeroMessageDom();
  startHeroTimer();

  // Removed explicit live stock line to keep hero cleaner in walk-in mode

  const quickTitle = document.createElement("div");
  quickTitle.className = "section-title";
  quickTitle.textContent = "Quick categories";
  const catRow = document.createElement("div");
  catRow.className = "category-row";
  [
    ["🥦", "Vegetables"],
    ["🥖", "Flour"],
    ["🧂", "Spices"],
    ["🥛", "Milk"],
    ["🥚", "Eggs"],
  ].forEach(([icon, label]) => {
    const chip = document.createElement("button");
    chip.className = "category-chip";
    chip.style.cursor = "pointer";
    chip.innerHTML = `<div class="category-icon">${icon}</div><div>${label}</div>`;
    chip.onclick = () => {
      currentCategory = label;
      currentScreen = SCREENS.SEARCH;
      render();
    };
    catRow.appendChild(chip);
  });

  const subsTitle = document.createElement("div");
  subsTitle.className = "section-title";
  subsTitle.textContent = "Save time with packs & subscriptions";

  const subsRow = document.createElement("div");
  subsRow.className = "recommended-row";
  const packs = [
    {
      name: "Groceries Pack",
      items: ["sukuma", "tomatoes", "onions", "honey"],
    },
    {
      name: "Eggs & Milk Pack",
      items: ["milk", "eggs", "honey", "tomatoes"],
    },
    {
      name: "Cereals & Flour Pack",
      items: ["maize_flour", "rice", "beans", "sukuma"],
    },
  ];

  packs.forEach((pack) => {
    const card = document.createElement("div");
    card.className = "product-card";
    const title = document.createElement("div");
    title.className = "product-name";
    title.textContent = pack.name;
    card.appendChild(title);

    const iconRow = document.createElement("div");
    iconRow.className = "pack-icons";
    pack.items.forEach((id) => {
      const p = productsData.find((prod) => prod.id === id);
      if (p) {
        const bubble = document.createElement("div");
        bubble.className = "pack-icon";
        bubble.textContent = p.icon || "🛒";
        iconRow.appendChild(bubble);
      }
    });
    card.appendChild(iconRow);

    const btn = document.createElement("button");
    btn.className = "combo-btn primary";
    btn.textContent = "Add pack";
    btn.onclick = () => {
      pack.items.forEach((id) => {
        const p = productsData.find((prod) => prod.id === id);
        if (p) {
          addToCart({
            id: p.id,
            name: p.name,
            meta: `${p.unit}`,
            price: p.price,
            icon: p.icon,
          });
        }
      });
      saveCart();
      showToast(`${pack.name} added to cart`);
      render();
    };
    card.appendChild(btn);
    subsRow.appendChild(card);
  });

  container.appendChild(header);
  container.appendChild(hubStrip);
  container.appendChild(search);
  container.appendChild(heroGlow);
  container.appendChild(quickTitle);
  container.appendChild(catRow);
  const loyalty = document.createElement("div");
  loyalty.className = "loyalty-widget";
  loyalty.innerHTML = `
    <div>Earn 80 more points to unlock a KSh 100 discount.</div>
    <div class="loyalty-bar">
      <div class="loyalty-bar-fill"></div>
    </div>
  `;
  container.appendChild(loyalty);
  container.appendChild(subsTitle);
  container.appendChild(subsRow);

  return container;
}

function addToCart(item) {
  const existing = cart.find((row) => row.id === item.id);
  if (existing) {
    existing.qty += 1;
  } else {
    cart.push({ ...item, qty: 1 });
  }
  saveCart();
}

function renderCart() {
  const wrap = document.createElement("div");
  wrap.className = "cart-screen";

  const header = document.createElement("div");
  header.className = "cart-header";
  const left = document.createElement("div");
  left.innerHTML = `<div class="cart-title">Checkout</div>`;
  const backBtn = document.createElement("button");
  backBtn.className = "secondary-btn";
  backBtn.style.width = "auto";
  backBtn.style.padding = "8px 14px";
  backBtn.textContent = "Back to shop";
  backBtn.onclick = () => {
    currentScreen = SCREENS.HOME;
    render();
  };
  header.appendChild(left);
  header.appendChild(backBtn);

  const list = document.createElement("div");
  list.className = "cart-items";
  if (!cart.length) {
    const empty = document.createElement("div");
    empty.className = "splash-meta";
    empty.textContent = "Your cart is empty. Add a few veggies to get started.";
    list.appendChild(empty);
  } else {
    cart.forEach((item) => {
      const row = document.createElement("div");
      row.className = "cart-item-row";
      row.innerHTML = `
        <div class="cart-item-main">
          <div class="cart-item-name">${item.icon ? `<span style="margin-right:6px;">${item.icon}</span>` : ""}${item.name}</div>
          <div class="cart-item-meta">${item.meta}</div>
          <div class="cart-item-meta">KSh ${item.price} each</div>
        </div>
        <div>
          <div style="display:flex; align-items:center; gap:6px; justify-content:flex-end;">
            <button data-minus class="icon-btn" style="width:26px;height:26px;">–</button>
            <div class="cart-item-qty">${item.qty}</div>
            <button data-plus class="icon-btn" style="width:26px;height:26px;">+</button>
          </div>
          <div style="margin-top:4px; font-size:13px; text-align:right;">Subtotal KSh ${item.price * item.qty}</div>
          <button data-remove style="margin-top:4px; border:none; background:transparent; font-size:12px; color:#b91c1c; cursor:pointer;">🗑 Remove</button>
        </div>
      `;
      const minus = row.querySelector("[data-minus]");
      const plus = row.querySelector("[data-plus]");
      const removeBtn = row.querySelector("[data-remove]");
      minus.addEventListener("click", () => {
        updateQty(item.id, -1);
        render();
      });
      plus.addEventListener("click", () => {
        updateQty(item.id, 1);
        render();
      });
      removeBtn.addEventListener("click", () => {
        removeItem(item.id);
        render();
      });
      list.appendChild(row);
    });
  }

  const subtotal = cart.reduce((sum, item) => sum + item.price * item.qty, 0);
  const hasMilk = cart.some((i) => i.id === "milk");
  const comboDiscount = subtotal >= 300 ? 30 : 0;
  const milkDiscount = hasMilk ? 20 : 0;
  const discountTotal = comboDiscount + milkDiscount;
  const deliveryFee = deliveryMethod === "delivery" && cart.length ? 100 : 0;
  const total = subtotal - discountTotal + deliveryFee;

  const summary = document.createElement("div");
  summary.className = "cart-summary";
  summary.innerHTML = `
    <div>
      <div>Subtotal</div>
      <div style="font-size:12px; color:#7a847f;">Discounts · Delivery</div>
    </div>
    <div style="text-align:right;">
      <div>KSh ${subtotal}</div>
      <div style="font-size:12px; color:#7a847f;">–KSh ${discountTotal} · +KSh ${deliveryFee}</div>
    </div>
  `;

  const glow = document.createElement("div");
  glow.className = "glow-card";
  glow.innerHTML = `
    <div>🥛 Add 1L of milk to earn extra points & move closer to your next reward.</div>
    <div class="glow-card-actions">
      <button class="glow-btn accept">Accept</button>
      <button class="glow-btn reject">Reject</button>
    </div>
  `;
  const [acceptBtn, rejectBtn] = glow.querySelectorAll(".glow-btn");
  acceptBtn.addEventListener("click", () => {
    addToCart({ id: "milk", name: "Fresh Milk", meta: "1 L", price: 120, icon: "🥛" });
    showToast("Milk added. You just unlocked 50 extra points!");
    render();
  });
  rejectBtn.addEventListener("click", () => {
    showToast("Glow Card dismissed.");
    glow.style.display = "none";
  });

  const deliveryBlock = document.createElement("div");
  deliveryBlock.className = "glow-card";
  deliveryBlock.style.background = "#fdfaf2";
  deliveryBlock.innerHTML = `
    <div style="font-weight:600; margin-bottom:6px;">Delivery</div>
    <div style="display:flex; gap:8px; margin-bottom:8px;">
      <button data-method="pickup" class="glow-btn ${deliveryMethod === "pickup" ? "accept" : ""}">Pickup at hub</button>
      <button data-method="delivery" class="glow-btn ${deliveryMethod === "delivery" ? "accept" : ""}">Home delivery</button>
    </div>
    <div style="font-size:13px; margin-bottom:6px;">
      ${deliveryMethod === "delivery" ? "Delivery: KSh 100 · Use your saved location or drop a pin." : "Pickup free at TRM, Westlands or CBD hubs."}
    </div>
  `;
  deliveryBlock.querySelectorAll("[data-method]").forEach((btn) => {
    btn.addEventListener("click", () => {
      deliveryMethod = btn.getAttribute("data-method");
      render();
    });
  });

  const payBtn = document.createElement("button");
  payBtn.className = "primary-btn";
  payBtn.textContent = `Confirm & pay · KSh ${total}`;
  payBtn.onclick = () => {
    if (!cart.length) {
      showToast("Your cart is empty. Add a few items first.");
      return;
    }
    if (!currentUser || !currentUser.email) {
      showToast("Please log in first so we can link your order.");
      currentScreen = SCREENS.AUTH_CHOICE;
      render();
      return;
    }

    const startPayment = (method) => {
      paymentMethod = method;
      const payload = {
        email: currentUser.email,
        items: cart.map((item) => ({
          productId: item.id,
          qty: item.qty,
        })),
        deliveryMethod,
        paymentMethod,
        address: deliveryAddress || null,
        totals: { subtotal, discountTotal, deliveryFee, total },
      };

      // Centered loader overlay while processing payment
      const processingOverlay = document.createElement("div");
      processingOverlay.className = "processing-overlay";
      processingOverlay.innerHTML = `
        <div class="processing-card">
          <div class="processing-spinner"></div>
          <div style="margin-top:10px; font-weight:600;">Processing payment...</div>
          <div style="margin-top:4px; font-size:12px; color:#647067;">This is a demo flow, no real money is charged.</div>
        </div>
      `;
      document.body.appendChild(processingOverlay);

      fetch(`${API_BASE}/api/orders`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify(payload),
      })
        .then(async (res) => {
          if (res.status === 401) {
            currentUser = null;
            localStorage.removeItem("jikoniUser");
            showToast("Session expired. Please log in again.");
            currentScreen = SCREENS.AUTH_CHOICE;
            render();
            throw new Error("unauthorized");
          }
          if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            throw new Error(data.message || "Could not place order");
          }
          return res.json();
        })
        .then((data) => {
          if (processingOverlay.parentNode) processingOverlay.remove();
          const name = currentUser?.name || "rafiki";
          const awarded = data.awardedPoints ?? 0;
          if (typeof data.points === "number" && typeof data.streak === "number") {
            loyaltyState.points = data.points;
            loyaltyState.streak = data.streak;
            loyaltyState.toNextReward = Math.max(0, 100 - data.points);
          }
          lastOrderSummary = {
            id: data.orderId,
            total,
            awarded,
            points: loyaltyState.points,
            streak: loyaltyState.streak,
            placedAt: data.createdAt || new Date().toISOString(),
          };
          cart = [];
          saveCart();
          currentScreen = SCREENS.ORDER_SUCCESS;
          render();
        })
        .catch((err) => {
          console.error(err);
          if (processingOverlay.parentNode) processingOverlay.remove();
          showToast(err.message || "Order failed, please try again.");
        });
    };

    // Show a simple payment method chooser sheet
    const overlay = document.createElement("div");
    overlay.className = "bot-overlay";
    const sheet = document.createElement("div");
    sheet.className = "bot-sheet";
    sheet.innerHTML = `
      <div class="bot-header">
        <div class="bot-title">Choose payment method</div>
        <button class="icon-btn" style="width:26px;height:26px;">✕</button>
      </div>
      <div class="bot-messages">
        <button class="primary-btn" data-method="mpesa" style="margin-bottom:8px;">M‑Pesa</button>
        <button class="secondary-btn" data-method="card" style="margin-bottom:8px;">Card</button>
        <button class="secondary-btn" data-method="paystack">Paystack</button>
      </div>
    `;
    sheet.querySelector(".icon-btn").onclick = () => overlay.remove();
    sheet.querySelectorAll("[data-method]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const method = btn.getAttribute("data-method");
        showToast(
          method === "mpesa"
            ? "Processing M‑Pesa payment..."
            : method === "card"
            ? "Processing card payment..."
            : "Processing Paystack payment..."
        );
        overlay.remove();
        startPayment(method);
      });
    });
    overlay.appendChild(sheet);
    document.body.appendChild(overlay);
  };

  const addressBlock = document.createElement("div");
  addressBlock.className = "glow-card";
  addressBlock.style.background = "#fdfaf2";
  addressBlock.innerHTML = `
    <div style="font-weight:600; margin-bottom:6px;">Delivery address</div>
    <div style="font-size:13px; margin-bottom:6px;">Tell us where to bring your order (estate, building, house number).</div>
    <input class="field-input" placeholder="e.g. Thika Road, TRM area, House 12" value="${deliveryAddress || ""}" />
  `;
  const addressInput = addressBlock.querySelector("input");
  addressInput.addEventListener("input", (e) => {
    deliveryAddress = e.target.value.trim();
  });
  addressInput.addEventListener("blur", () => {
    saveAddress();
  });

  wrap.appendChild(header);
  wrap.appendChild(list);
  if (cart.length) {
    wrap.appendChild(summary);
    // Show glow card just above delivery & payment section
    wrap.appendChild(glow);
    wrap.appendChild(addressBlock);
    wrap.appendChild(deliveryBlock);
    wrap.appendChild(payBtn);
  }
  return wrap;
}

function updateQty(id, delta) {
  const item = cart.find((i) => i.id === id);
  if (!item) return;
  item.qty += delta;
  if (item.qty <= 0) {
    cart = cart.filter((i) => i.id !== id);
  }
  saveCart();
}

function removeItem(id) {
  cart = cart.filter((i) => i.id !== id);
  saveCart();
}

function renderLoyalty() {
  const wrap = document.createElement("div");
  wrap.className = "cart-screen";
  const header = document.createElement("div");
  header.className = "cart-header";
  header.innerHTML = `<div class="cart-title">Loyalty & rewards</div>`;
  const body = document.createElement("div");
  body.className = "loyalty-widget";
  body.innerHTML = `
    <div>You’ve earned ${loyaltyState.points || 0} Jikoni Points 🌟</div>
    <div style="margin-top:4px;">Streak: Day ${loyaltyState.streak || 0}</div>
    <div style="margin-top:4px;">${Math.max(
      0,
      loyaltyState.toNextReward || 0
    )} pts to unlock your next reward.</div>
    <div class="loyalty-bar" style="margin-top:10px;">
      <div class="loyalty-bar-fill" style="width:${Math.min(
        100,
        ((loyaltyState.points || 0) / (loyaltyState.points + (loyaltyState.toNextReward || 100))) *
          100 || 0
      )}%;"></div>
    </div>
  `;
  wrap.appendChild(header);
  wrap.appendChild(body);
  return wrap;
}

function renderNotifications() {
  const wrap = document.createElement("div");
  wrap.className = "cart-screen";

  const header = document.createElement("div");
  header.className = "cart-header";
  header.innerHTML = `
    <div class="cart-title">Notifications</div>
    <button class="secondary-btn" style="width:auto; padding:8px 14px;">Back</button>
  `;
  const backBtn = header.querySelector("button");
  backBtn.onclick = () => {
    currentScreen = SCREENS.HOME;
    render();
  };

  const body = document.createElement("div");
  body.className = "loyalty-widget";
  body.style.display = "flex";
  body.style.flexDirection = "column";
  body.style.gap = "10px";

  const prefsCard = document.createElement("div");
  prefsCard.style.cssText =
    "background:white; border-radius:14px; padding:10px 12px; border:1px solid #e0e0e0; font-size:13px;";
  prefsCard.innerHTML = `
    <div style="font-weight:600; margin-bottom:4px;">Notification preferences</div>
    <label style="display:flex; align-items:center; gap:6px; margin-top:4px; font-size:13px;">
      <input type="checkbox" ${notificationPrefs.streakReminders ? "checked" : ""} />
      Streak & loyalty reminders
    </label>
    <label style="display:flex; align-items:center; gap:6px; margin-top:4px; font-size:13px;">
      <input type="checkbox" ${notificationPrefs.hamperAlerts ? "checked" : ""} />
      Surprise hamper & glow offers
    </label>
  `;
  const [streakToggle, hamperToggle] = prefsCard.querySelectorAll("input");
  streakToggle.addEventListener("change", () => {
    notificationPrefs.streakReminders = streakToggle.checked;
    saveNotificationPrefs();
    showToast("Streak reminder preference updated.");
  });
  hamperToggle.addEventListener("change", () => {
    notificationPrefs.hamperAlerts = hamperToggle.checked;
    saveNotificationPrefs();
    showToast("Hamper alerts preference updated.");
  });

  const listCard = document.createElement("div");
  listCard.style.cssText =
    "background:white; border-radius:14px; padding:10px 12px; border:1px solid #e0e0e0; font-size:13px;";
  listCard.innerHTML = `
    <div style="font-weight:600; margin-bottom:6px;">Recent notifications</div>
    <div style="margin-bottom:6px;">
      <div style="font-weight:500;">🎁 New glow hamper available</div>
      <div style="font-size:12px; color:#647067;">Tap Home to see today’s surprise hamper and streak-friendly combos.</div>
    </div>
    <div style="margin-bottom:6px;">
      <div style="font-weight:500;">🛵 Order tracking</div>
      <div style="font-size:12px; color:#647067;">Your latest order status appears on the Home screen when active.</div>
    </div>
    <div>
      <div style="font-weight:500;">⭐ Loyalty update</div>
      <div style="font-size:12px; color:#647067;">You’ll see new points & streak changes on the Loyalty page after every order.</div>
    </div>
  `;

  body.appendChild(prefsCard);
  body.appendChild(listCard);

  wrap.appendChild(header);
  wrap.appendChild(body);
  return wrap;
}

function renderProfile() {
  const wrap = document.createElement("div");
  wrap.className = "cart-screen";
  const header = document.createElement("div");
  header.className = "cart-header";
  header.innerHTML = `<div class="cart-title">Profile</div>`;
  const body = document.createElement("div");
  body.className = "loyalty-widget";
  const name = currentUser?.name || "Guest";
  const email = currentUser?.email || "Not set";
  const hub = getCurrentHub();
  body.innerHTML = `
    <div><strong>${name}</strong></div>
    <div style="margin-top:4px; font-size:13px;">Email: ${email}</div>
    <div style="margin-top:8px; font-size:13px;">Points: ${
      loyaltyState.points || 0
    } · Streak: Day ${loyaltyState.streak || 0}</div>
    <div style="margin-top:6px; font-size:13px;">Preferred hub: ${
      hub?.name || "TRM Hub"
    }</div>
  `;
  const editRow = document.createElement("div");
  editRow.className = "auth-form";
  editRow.innerHTML = `
    <div>
      <div class="field-label">Display name</div>
      <input class="field-input" value="${name}" />
    </div>
  `;
  const nameInput = editRow.querySelector("input");
  nameInput.addEventListener("blur", () => {
    if (currentUser) {
      currentUser.name = nameInput.value.trim() || currentUser.name;
      saveUser();
      showToast("Name updated for this device.");
    }
  });

  const prefs = document.createElement("div");
  prefs.className = "loyalty-widget";
  prefs.style.marginTop = "12px";
  prefs.innerHTML = `
    <div style="font-weight:600; margin-bottom:4px;">Account & notifications</div>
    <label style="display:flex; align-items:center; gap:6px; font-size:13px;">
      <input type="checkbox" ${notificationPrefs.streakReminders ? "checked" : ""} />
      Streak reminders
    </label>
    <label style="display:flex; align-items:center; gap:6px; font-size:13px; margin-top:4px;">
      <input type="checkbox" ${notificationPrefs.hamperAlerts ? "checked" : ""} />
      Surprise hamper alerts
    </label>
  `;
  const [streakToggle, hamperToggle] = prefs.querySelectorAll("input");
  streakToggle.addEventListener("change", () => {
    notificationPrefs.streakReminders = streakToggle.checked;
    saveNotificationPrefs();
    showToast("Streak reminder preference updated.");
  });
  hamperToggle.addEventListener("change", () => {
    notificationPrefs.hamperAlerts = hamperToggle.checked;
    saveNotificationPrefs();
    showToast("Hamper alerts preference updated.");
  });

  const orderHistoryBtn = document.createElement("button");
  orderHistoryBtn.className = "secondary-btn";
  orderHistoryBtn.style.marginTop = "8px";
  orderHistoryBtn.textContent = "View order history";
  orderHistoryBtn.onclick = () => {
    currentScreen = SCREENS.ORDER_HISTORY;
    render();
  };

  const logoutWrap = document.createElement("div");
  logoutWrap.className = "splash-footer";
  const logoutBtn = document.createElement("button");
  logoutBtn.className = "secondary-btn";
  logoutBtn.textContent = "Log out of this device";
  logoutBtn.onclick = () => {
    currentUser = null;
    cart = [];
    localStorage.removeItem("jikoniUser");
    saveCart();
    showToast("You've been logged out.");
    currentScreen = SCREENS.AUTH_CHOICE;
    render();
  };
  logoutWrap.appendChild(logoutBtn);

  wrap.appendChild(header);
  wrap.appendChild(body);
  wrap.appendChild(editRow);
  wrap.appendChild(prefs);
  wrap.appendChild(orderHistoryBtn);
  wrap.appendChild(logoutWrap);
  return wrap;
}

function renderOrderSuccess() {
  const wrap = document.createElement("div");
  wrap.className = "cart-screen";
  const header = document.createElement("div");
  header.className = "cart-header";
  header.innerHTML = `<div class="cart-title">Order confirmed</div>`;

  const body = document.createElement("div");
  body.className = "loyalty-widget";
  if (!lastOrderSummary) {
    body.innerHTML = `
      <div>Your order has been placed.</div>
      <div style="margin-top:4px; font-size:13px;">You can view your recent orders from your profile.</div>
    `;
  } else {
    const placedAt = lastOrderSummary.placedAt
      ? new Date(lastOrderSummary.placedAt)
      : new Date();
    const now = new Date();
    const minutes = Math.max(
      0,
      Math.floor((now.getTime() - placedAt.getTime()) / 60000)
    );
    // Simple time-based tracking states
    let stage = 0;
    if (minutes >= 0) stage = 1; // received
    if (minutes >= 3) stage = 2; // preparing
    if (minutes >= 8) stage = 3; // on the way
    if (minutes >= 15) stage = 4; // near you

    body.innerHTML = `
      <div>Asante, ${currentUser?.name || "rafiki"}! 🍅🚚</div>
      <div style="margin-top:4px; font-size:13px;">Order #${
        lastOrderSummary.id
      } · Total KSh ${lastOrderSummary.total}</div>
      <div style="margin-top:4px; font-size:13px;">You earned ${
        lastOrderSummary.awarded
      } pts · Balance ${lastOrderSummary.points ?? 0} pts.</div>
      <div style="margin-top:10px; font-size:13px; font-weight:600;">Live order tracking</div>
      <div style="margin-top:6px; font-size:12px; color:#647067;">
        ${stage === 1 ? "We’ve received your order at the nearest Jikoni hub." :
          stage === 2 ? "Your order is being picked & packed." :
          stage === 3 ? "Your rider has left the hub and is on the way." :
          "Your rider is near your place. Tafadhali keep your phone close."}
      </div>
      <div style="margin-top:10px; display:flex; gap:8px; align-items:flex-start;">
        <div style="flex:2;">
          <div style="display:flex; justify-content:space-between; font-size:11px; color:#647067; margin-bottom:6px;">
            <span>Received</span><span>Prepping</span><span>On the way</span><span>Near you</span>
          </div>
          <div style="position:relative; height:6px; border-radius:999px; background:rgba(21,53,47,0.18); overflow:hidden;">
            <div style="height:100%; width:${(stage / 4) * 100}%; background:linear-gradient(90deg,#22c55e,#f97316);"></div>
          </div>
        </div>
        <div style="flex:1; text-align:right; font-size:11px; color:#647067;">
          ~${8 + (deliveryMethod === "delivery" ? 5 : 0)} min from hub
        </div>
      </div>
      <div style="margin-top:10px; border-radius:14px; background:#fdfaf2; padding:10px; display:flex; gap:10px; align-items:center; font-size:12px;">
        <div style="flex:1; min-width:0;">
          <div style="font-weight:600; margin-bottom:4px;">Jikoni Hub → Your place</div>
          <div style="color:#647067;">This is a mock route for now, but feels like Glovo-style tracking.</div>
        </div>
        <div style="width:90px; height:70px; border-radius:10px; background:linear-gradient(135deg,#e5e7eb,#f97316); position:relative; overflow:hidden;">
          <div style="position:absolute; left:10px; top:10px; width:6px; height:6px; border-radius:999px; background:#16a34a;"></div>
          <div style="position:absolute; right:10px; bottom:10px; width:6px; height:6px; border-radius:999px; background:#0ea5e9;"></div>
          <div style="position:absolute; left:12px; top:12px; right:16px; bottom:16px; border-radius:999px; border:2px dashed rgba(15,23,42,0.4);"></div>
          <div style="position:absolute; left:${15 + (stage / 4) * 45}px; top:${15 + (stage / 4) * 25}px; font-size:18px;">🛵</div>
        </div>
      </div>
    `;
  }

  const actions = document.createElement("div");
  actions.className = "splash-footer";
  const homeBtn = document.createElement("button");
  homeBtn.className = "primary-btn";
  homeBtn.textContent = "Back to home";
  homeBtn.onclick = () => {
    currentScreen = SCREENS.HOME;
    render();
  };
  const historyBtn = document.createElement("button");
  historyBtn.className = "secondary-btn";
  historyBtn.textContent = "View order history";
  historyBtn.onclick = () => {
    currentScreen = SCREENS.ORDER_HISTORY;
    render();
  };
  const loyaltyBtn = document.createElement("button");
  loyaltyBtn.className = "secondary-btn";
  loyaltyBtn.textContent = "View loyalty";
  loyaltyBtn.onclick = () => {
    currentScreen = SCREENS.LOYALTY;
    render();
  };
  actions.appendChild(homeBtn);
  actions.appendChild(historyBtn);
  actions.appendChild(loyaltyBtn);

  wrap.appendChild(header);
  wrap.appendChild(body);
  wrap.appendChild(actions);
  return wrap;
}

function renderOrderHistory() {
  const wrap = document.createElement("div");
  wrap.className = "cart-screen";
  
  const header = document.createElement("div");
  header.className = "cart-header";
  const left = document.createElement("div");
  left.innerHTML = `<div class="cart-title">Order History</div>`;
  const backBtn = document.createElement("button");
  backBtn.className = "secondary-btn";
  backBtn.style.width = "auto";
  backBtn.style.padding = "8px 14px";
  backBtn.textContent = "Back";
  backBtn.onclick = () => {
    currentScreen = SCREENS.PROFILE;
    render();
  };
  header.appendChild(left);
  header.appendChild(backBtn);

  const body = document.createElement("div");
  body.className = "loyalty-widget";
  body.style.minHeight = "200px";
  body.innerHTML = `<div style="text-align:center; padding:20px;">Loading orders...</div>`;

  if (!currentUser || !currentUser.token) {
    body.innerHTML = `
      <div style="text-align:center; padding:20px;">
        <div>Please log in to view your order history.</div>
        <button class="primary-btn" style="margin-top:12px;">Log in</button>
      </div>
    `;
    const loginBtn = body.querySelector("button");
    loginBtn.onclick = () => {
      currentScreen = SCREENS.AUTH_CHOICE;
      render();
    };
  } else {
    fetch(`${API_BASE}/api/orders`, {
      method: "GET",
      headers: authHeaders(),
    })
      .then(async (res) => {
        if (res.status === 401) {
          currentUser = null;
          localStorage.removeItem("jikoniUser");
          showToast("Session expired. Please log in again.");
          currentScreen = SCREENS.AUTH_CHOICE;
          render();
          throw new Error("unauthorized");
        }
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.message || "Could not load orders");
        }
        return res.json();
      })
      .then((data) => {
        const orders = data.orders || [];
        if (orders.length === 0) {
          body.innerHTML = `
            <div style="text-align:center; padding:20px;">
              <div>No orders yet.</div>
              <div style="font-size:13px; margin-top:8px; color:#666;">Start shopping to see your orders here!</div>
            </div>
          `;
          return;
        }
        
        body.innerHTML = "";
        orders.forEach((order) => {
          const orderCard = document.createElement("div");
          orderCard.style.cssText = "background:white; border-radius:8px; padding:12px; margin-bottom:8px; border:1px solid #e0e0e0;";
          const date = new Date(order.createdAt);
          const dateStr = date.toLocaleDateString("en-KE", {
            year: "numeric",
            month: "short",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit",
          });
          orderCard.innerHTML = `
            <div style="display:flex; justify-content:space-between; align-items:start; margin-bottom:4px;">
              <div>
                <div style="font-weight:600;">Order #${order.id}</div>
                <div style="font-size:12px; color:#666; margin-top:2px;">${dateStr}</div>
              </div>
              <div style="font-weight:600; color:#f97316;">KSh ${order.total || 0}</div>
            </div>
          `;
          body.appendChild(orderCard);
        });
      })
      .catch((err) => {
        console.error(err);
        if (err.message !== "unauthorized") {
          body.innerHTML = `
            <div style="text-align:center; padding:20px; color:#d32f2f;">
              <div>Could not load orders.</div>
              <div style="font-size:12px; margin-top:4px;">${err.message || "Please try again later."}</div>
            </div>
          `;
        }
      });
  }

  wrap.appendChild(header);
  wrap.appendChild(body);
  return wrap;
}

function renderSearch() {
  const wrap = document.createElement("div");
  wrap.className = "cart-screen";
  
  const header = document.createElement("div");
  header.className = "cart-header";
  const left = document.createElement("div");
  left.innerHTML = `<div class="cart-title">${currentCategory ? currentCategory : "All Products"}</div>`;
  const backBtn = document.createElement("button");
  backBtn.className = "secondary-btn";
  backBtn.style.width = "auto";
  backBtn.style.padding = "8px 14px";
  backBtn.textContent = "Back";
  backBtn.onclick = () => {
    currentCategory = null;
    currentScreen = SCREENS.HOME;
    render();
  };
  header.appendChild(left);
  header.appendChild(backBtn);
  wrap.appendChild(header);

  // Search bar
  const searchBar = document.createElement("div");
  searchBar.className = "search-bar";
  searchBar.style.margin = "12px 16px";
  const searchInput = document.createElement("input");
  searchInput.className = "search-input";
  searchInput.placeholder = "Search products...";
  searchInput.style.width = "100%";
  let searchQuery = "";
  searchInput.addEventListener("input", (e) => {
    searchQuery = e.target.value.toLowerCase();
    renderProductGrid();
  });
  searchBar.appendChild(searchInput);
  wrap.appendChild(searchBar);

  // Category filter chips
  const categoryRow = document.createElement("div");
  categoryRow.className = "category-row";
  categoryRow.style.margin = "0 16px 12px";
  categoryRow.style.overflowX = "auto";
  categoryRow.style.display = "flex";
  categoryRow.style.gap = "8px";
  const categories = ["All", "Vegetables", "Flour", "Spices", "Milk", "Eggs", "Dairy", "Cereals", "Honey", "Breakfast"];
  categories.forEach((cat) => {
    const chip = document.createElement("button");
    chip.className = "category-chip";
    chip.style.cursor = "pointer";
    chip.style.padding = "6px 12px";
    chip.style.borderRadius = "16px";
    chip.style.border = currentCategory === cat || (!currentCategory && cat === "All") ? "2px solid #f97316" : "1px solid #e0e0e0";
    chip.style.background = currentCategory === cat || (!currentCategory && cat === "All") ? "#fff5f0" : "white";
    chip.style.color = currentCategory === cat || (!currentCategory && cat === "All") ? "#f97316" : "#333";
    chip.textContent = cat;
    chip.onclick = () => {
      currentCategory = cat === "All" ? null : cat;
      render();
    };
    categoryRow.appendChild(chip);
  });
  wrap.appendChild(categoryRow);

  // Product grid container
  const gridContainer = document.createElement("div");
  gridContainer.style.padding = "0 16px 80px";
  
  function renderProductGrid() {
    gridContainer.innerHTML = "";
    const grid = document.createElement("div");
    grid.className = "browse-grid";
    grid.style.display = "grid";
    grid.style.gridTemplateColumns = "repeat(auto-fill, minmax(160px, 1fr))";
    grid.style.gap = "12px";

    // Filter products
    let filteredProducts = productsData;
    if (currentCategory && currentCategory !== "All") {
      // Map category names to match product categories
      const categoryMap = {
        "Milk": "Dairy",
        "Eggs": "Breakfast",
        "Spices": "Spices", // May not exist, but allow it
      };
      const searchCategory = categoryMap[currentCategory] || currentCategory;
      filteredProducts = productsData.filter((p) => 
        p.category.toLowerCase() === searchCategory.toLowerCase()
      );
    }
    if (searchQuery) {
      filteredProducts = filteredProducts.filter((p) =>
        p.name.toLowerCase().includes(searchQuery) ||
        p.category.toLowerCase().includes(searchQuery)
      );
    }

    if (filteredProducts.length === 0) {
      grid.innerHTML = `
        <div style="grid-column: 1 / -1; text-align:center; padding:40px; color:#666;">
          <div>No products found</div>
          <div style="font-size:13px; margin-top:8px;">Try a different category or search term</div>
        </div>
      `;
      gridContainer.appendChild(grid);
      return;
    }

    filteredProducts.forEach((p) => {
      const card = document.createElement("div");
      card.className = "product-tile";
      card.style.cssText = "background:white; border-radius:12px; padding:12px; border:1px solid #e0e0e0; display:flex; flex-direction:column;";
      
      // Product icon and name
      const nameRow = document.createElement("div");
      nameRow.style.cssText = "display:flex; align-items:center; gap:8px; margin-bottom:6px;";
      nameRow.innerHTML = `
        <span style="font-size:24px;">${p.icon || "📦"}</span>
        <div style="flex:1;">
          <div style="font-weight:600; font-size:14px; line-height:1.3;">${p.name}</div>
          <div style="font-size:11px; color:#666; margin-top:2px;">${p.unit}</div>
        </div>
      `;
      card.appendChild(nameRow);

      // Category badge
      const categoryBadge = document.createElement("div");
      categoryBadge.style.cssText = "font-size:10px; color:#666; margin-bottom:8px; text-transform:uppercase;";
      categoryBadge.textContent = p.category;
      card.appendChild(categoryBadge);

      // Price and quantity controls
      const priceRow = document.createElement("div");
      priceRow.style.cssText = "display:flex; justify-content:space-between; align-items:center; margin-top:auto;";
      
      const price = document.createElement("div");
      price.style.cssText = "font-weight:600; font-size:16px; color:#f97316;";
      price.textContent = `KSh ${p.price}`;
      priceRow.appendChild(price);

      // Check if item is in cart
      const cartItem = cart.find((item) => item.id === p.id);
      const qty = cartItem ? cartItem.qty : 0;

      if (qty > 0) {
        // Quantity controls
        const qtyControls = document.createElement("div");
        qtyControls.style.cssText = "display:flex; align-items:center; gap:8px; background:#f5f5f5; border-radius:20px; padding:4px 8px;";
        
        const minusBtn = document.createElement("button");
        minusBtn.textContent = "−";
        minusBtn.style.cssText = "width:24px; height:24px; border:none; background:#fff; border-radius:50%; cursor:pointer; font-size:16px; font-weight:bold;";
        minusBtn.onclick = (e) => {
          e.stopPropagation();
          updateQty(p.id, -1);
          render();
        };
        
        const qtyDisplay = document.createElement("span");
        qtyDisplay.style.cssText = "min-width:20px; text-align:center; font-weight:600;";
        qtyDisplay.textContent = qty;
        
        const plusBtn = document.createElement("button");
        plusBtn.textContent = "+";
        plusBtn.style.cssText = "width:24px; height:24px; border:none; background:#f97316; color:white; border-radius:50%; cursor:pointer; font-size:16px; font-weight:bold;";
        plusBtn.onclick = (e) => {
          e.stopPropagation();
          addToCart({
            id: p.id,
            name: p.name,
            meta: p.unit,
            price: p.price,
            icon: p.icon,
          });
          saveCart();
          showToast(`${p.name} added`);
          render();
        };
        
        qtyControls.appendChild(minusBtn);
        qtyControls.appendChild(qtyDisplay);
        qtyControls.appendChild(plusBtn);
        priceRow.appendChild(qtyControls);
      } else {
        // Add button
        const addBtn = document.createElement("button");
        addBtn.className = "product-add-btn";
        addBtn.textContent = "Add";
        addBtn.style.cssText = "background:#f97316; color:white; border:none; padding:6px 16px; border-radius:16px; font-weight:600; cursor:pointer; font-size:13px;";
        addBtn.onclick = (e) => {
          e.stopPropagation();
          addToCart({
            id: p.id,
            name: p.name,
            meta: p.unit,
            price: p.price,
            icon: p.icon,
          });
          saveCart();
          showToast(`${p.name} added to cart`);
          render();
        };
        priceRow.appendChild(addBtn);
      }

      card.appendChild(priceRow);
      grid.appendChild(card);
    });

    gridContainer.appendChild(grid);
  }

  renderProductGrid();
  wrap.appendChild(gridContainer);
  return wrap;
}

function renderBotOverlay() {
  const existing = document.querySelector(".bot-overlay");
  if (!botOpen) {
    if (existing) existing.remove();
    return;
  }
  if (existing) existing.remove();

  const overlay = document.createElement("div");
  overlay.className = "bot-overlay";

  const sheet = document.createElement("div");
  sheet.className = "bot-sheet";

  const header = document.createElement("div");
  header.className = "bot-header";
  header.innerHTML = `
    <div class="bot-title">Jikoni Bot</div>
    <button class="icon-btn" style="width:26px;height:26px;">✕</button>
  `;
  header.querySelector("button").addEventListener("click", () => {
    botOpen = false;
    renderBotOverlay();
  });

  const chips = document.createElement("div");
  chips.className = "bot-chip-row";
  [
    "What’s on offer today?",
    "Order my usual dinner hamper",
    "Add eggs and sukuma",
  ].forEach((label) => {
    const c = document.createElement("button");
    c.type = "button";
    c.className = "bot-chip";
    c.textContent = label;
    c.addEventListener("click", () => handleBotUserMessage(label));
    chips.appendChild(c);
  });

  const list = document.createElement("div");
  list.className = "bot-messages";
  botMessages.forEach((msg) => {
    const b = document.createElement("div");
    b.className = "bot-msg " + (msg.from === "user" ? "user" : "bot");
    b.textContent = msg.text;
    list.appendChild(b);
  });

  const inputRow = document.createElement("div");
  inputRow.className = "bot-input-row";
  const input = document.createElement("input");
  input.className = "bot-input";
  input.placeholder = "Ask Jikoni…";
  const send = document.createElement("button");
  send.className = "bot-send";
  send.textContent = "Send";

  const submitMessage = () => {
    const text = input.value.trim();
    if (!text) return;
    input.value = "";
    handleBotUserMessage(text);
  };

  send.addEventListener("click", submitMessage);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      submitMessage();
    }
  });

  inputRow.appendChild(input);
  inputRow.appendChild(send);

  sheet.appendChild(header);
  sheet.appendChild(chips);
  sheet.appendChild(list);
  sheet.appendChild(inputRow);
  overlay.appendChild(sheet);
  document.body.appendChild(overlay);

  // scroll to bottom
  list.scrollTop = list.scrollHeight;
}

function handleBotUserMessage(text) {
  botMessages.push({ from: "user", text });
  const lower = text.toLowerCase();

  if (lower.includes("offer") || lower.includes("on offer")) {
    botMessages.push({
      from: "bot",
      text:
        "Today’s glow offers: 🥬 Sukuma at 20% off, 🥚 buy 10 eggs earn extra points, and a Supper Starter Kit combo.",
    });
  } else if (lower.includes("usual") || lower.includes("dinner hamper")) {
    const items = [
      { id: "sukuma", name: "Sukuma Wiki", meta: "500 g", price: 40 },
      { id: "tomatoes", name: "Tomatoes", meta: "1 kg", price: 80 },
      { id: "onions", name: "Onions", meta: "1 kg", price: 90 },
      { id: "eggs", name: "Eggs Tray", meta: "30 pcs", price: 420 },
    ];
    items.forEach(addToCart);
    saveCart();
    botMessages.push({
      from: "bot",
      text:
        "I’ve added your usual dinner hamper: sukuma, tomatoes, onions and an eggs tray. Ready to checkout any time.",
    });
  } else if (lower.includes("egg") || lower.includes("sukuma")) {
    const eggs = { id: "eggs", name: "Eggs Tray", meta: "30 pcs", price: 420 };
    const sukuma = { id: "sukuma", name: "Sukuma Wiki", meta: "500 g", price: 40 };
    if (lower.includes("egg")) addToCart(eggs);
    if (lower.includes("sukuma")) addToCart(sukuma);
    saveCart();
    botMessages.push({
      from: "bot",
      text: "Done. I’ve topped up your cart with fresh sukuma and/or eggs.",
    });
  } else if (lower.includes("cart")) {
    const count = cart.reduce((s, i) => s + i.qty, 0);
    botMessages.push({
      from: "bot",
      text: `You currently have ${count} item${count === 1 ? "" : "s"} in your cart.`,
    });
  } else {
    botMessages.push({
      from: "bot",
      text:
        "I’m still learning. Try: “What’s on offer today?”, “Order my usual dinner hamper”, or “Add eggs and sukuma.”",
    });
  }

  render();
}

function renderFooterNav() {
  const existing = document.querySelector(".footer-nav");
  if (existing) existing.remove();

  // Only show footer navigation on main app screens, not splash/auth flows
  if (
    currentScreen === SCREENS.SPLASH_1 ||
    currentScreen === SCREENS.SPLASH_2 ||
    currentScreen === SCREENS.AUTH_CHOICE ||
    currentScreen === SCREENS.SIGN_UP ||
    currentScreen === SCREENS.LOGIN ||
    currentScreen === SCREENS.VERIFY
  ) {
    return;
  }

  const bar = document.createElement("div");
  bar.className = "footer-nav";
  const inner = document.createElement("div");
  inner.className = "footer-nav-inner";

  const tabs = [
    { id: SCREENS.HOME, icon: "🏠", label: "Home" },
    { id: SCREENS.SEARCH, icon: "🔍", label: "Search" },
    { id: SCREENS.CART, icon: "🛒", label: "Cart" },
    { id: SCREENS.LOYALTY, icon: "⭐", label: "Loyalty" },
    { id: SCREENS.PROFILE, icon: "👤", label: "Profile" },
  ];

  tabs.forEach((tab) => {
    const btn = document.createElement("button");
    btn.className = "footer-tab" + (currentScreen === tab.id ? " active" : "");
    btn.innerHTML = `<span>${tab.icon}</span><div>${tab.label}</div>`;
    btn.addEventListener("click", () => {
      currentScreen = tab.id;
      render();
    });
    inner.appendChild(btn);
  });

  bar.appendChild(inner);
  document.body.appendChild(bar);
}

function showToast(message) {
  if (toastTimeout) {
    clearTimeout(toastTimeout);
  }
  const existing = document.querySelector(".toast");
  if (existing) existing.remove();

  const t = document.createElement("div");
  t.className = "toast";
  t.textContent = message;
  document.body.appendChild(t);

  toastTimeout = setTimeout(() => {
    t.remove();
  }, 2200);
}

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("/sw.js")
      .catch(() => {
        /* ignore */
      });
  });
}

window.addEventListener("beforeinstallprompt", (e) => {
  // Android / desktop Chrome install prompt
  e.preventDefault();
  deferredInstallPrompt = e;
  renderInstallSheet();
});

function updateHeroMessageDom() {
  if (currentScreen !== SCREENS.HOME) return;
  const heroMessages = [
    {
      title: "🎁 Surprise Hamper of the Hour",
      sub: "Mixed veggies, pantry staples and a sweet treat · limited drops all day.",
      pill: "Glow Hamper · +Extra pts",
    },
    {
      title: "🚗 Free delivery over KSh 800",
      sub: "Shop your weekly basics and we’ll cover delivery from the nearest hub.",
      pill: "Delivery Glow · 🚙",
    },
    {
      title: "🍲 Supper Starter Kit",
      sub: "Tomatoes, onions & sukuma in one combo · save KSh 60 tonight.",
      pill: "Combo Glow · Save KSh 60",
    },
  ];
  const hero = heroMessages[heroIndex % heroMessages.length];
  const pill = document.querySelector(".hero-glow-pill");
  const title = document.querySelector(".hero-glow-title");
  const sub = document.querySelector(".hero-glow-sub-main");
  if (pill) pill.textContent = hero.pill;
  if (title) title.textContent = hero.title;
  if (sub) sub.textContent = hero.sub;
}

function startHeroTimer() {
  heroTimerSeconds = 59;
  if (window.__jikoniHeroTimer) {
    clearInterval(window.__jikoniHeroTimer);
  }
  window.__jikoniHeroTimer = setInterval(() => {
    if (currentScreen !== SCREENS.HOME) return;
    heroTimerSeconds = (heroTimerSeconds - 1 + 60) % 60;
    const timerEl = document.querySelector(".hero-timer");
    if (timerEl) {
      timerEl.textContent = `Offer ends in 00:${String(heroTimerSeconds).padStart(2, "0")}`;
    }
  }, 1000);
}

loadState();
loadHubs();
loadProducts();
setTimeout(() => {
  if (currentUser && currentUser.isVerified) {
    currentScreen = SCREENS.HOME;
  } else {
    currentScreen = SCREENS.SPLASH_1;
  }
  render();
}, 1500);
setInterval(() => {
  heroIndex = (heroIndex + 1) % 3;
  updateHeroMessageDom();
}, 7000);
render();

function isIOS() {
  const ua = window.navigator.userAgent.toLowerCase();
  return /iphone|ipad|ipod/.test(ua);
}

function isInStandaloneMode() {
  return window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone;
}

function renderInstallSheet() {
  const existing = document.querySelector(".install-sheet");
  if (existing) existing.remove();

  // If already installed, don't show anything
  if (isInStandaloneMode()) return;

  // For iOS Safari there is no beforeinstallprompt, show instructions instead
  const showIosInstructions = !deferredInstallPrompt && isIOS();
  if (!deferredInstallPrompt && !showIosInstructions) {
    return;
  }

  const sheet = document.createElement("div");
  sheet.className = "install-sheet";
  sheet.innerHTML = `
    <div class="install-sheet-inner">
      <img src="/public/logo.png" alt="Jikoni" class="install-sheet-logo" />
      <div class="install-sheet-text">
        ${
          showIosInstructions
            ? `Install <strong>Jikoni</strong> on your home screen for a full-screen app experience.<br/><br/><strong>On iPhone:</strong> Tap the share icon in Safari, then “Add to Home Screen”.`
            : `Install <strong>Jikoni</strong> for faster access to your groceries and hampers.`
        }
      </div>
      <div class="install-sheet-actions">
        ${
          showIosInstructions
            ? ""
            : '<button class="install-btn">Install</button>'
        }
        <button class="install-dismiss">Not now</button>
      </div>
    </div>
  `;

  const dismissBtn = sheet.querySelector(".install-dismiss");

  if (!showIosInstructions) {
    const installBtn = sheet.querySelector(".install-btn");
    installBtn.addEventListener("click", async () => {
      if (!deferredInstallPrompt) return;
      deferredInstallPrompt.prompt();
      const choice = await deferredInstallPrompt.userChoice.catch(() => null);
      deferredInstallPrompt = null;
      sheet.remove();
      if (choice && choice.outcome === "accepted") {
        showToast("Jikoni installed. Asante!");
      }
    });
  }

  dismissBtn.addEventListener("click", () => {
    deferredInstallPrompt = null;
    sheet.remove();
  });

  document.body.appendChild(sheet);
}


