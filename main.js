const API_BASE = "http://localhost:4000";

const SCREENS = {
  LOADER: "loader",
  SPLASH_1: "splash1",
  SPLASH_2: "splash2",
  AUTH_CHOICE: "authChoice",
  SIGN_UP: "signup",
  LOGIN: "login",
  VERIFY: "verify",
  HOME: "home",
  CART: "cart",
  LOYALTY: "loyalty",
  PROFILE: "profile",
  SEARCH: "search",
  ORDER_SUCCESS: "orderSuccess",
};

let currentScreen = SCREENS.LOADER;
let toastTimeout = null;
let currentUser = null;
let pendingUser = null;
let cart = [];
let deliveryMethod = "delivery"; // or "pickup"
let paymentMethod = "mpesa"; // "mpesa" | "card" | "cod"
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

function loadState() {
  try {
    const savedUser = localStorage.getItem("jikoniUser");
    if (savedUser) currentUser = JSON.parse(savedUser);
    const savedCart = localStorage.getItem("jikoniCart");
    if (savedCart) cart = JSON.parse(savedCart);
    const savedHub = localStorage.getItem("jikoniHub");
    if (savedHub) currentHubId = savedHub;
    const savedWalkIn = localStorage.getItem("jikoniWalkIn");
    if (savedWalkIn) walkInMode = savedWalkIn === "true";
    const savedPrefs = localStorage.getItem("jikoniNotificationPrefs");
    if (savedPrefs) notificationPrefs = JSON.parse(savedPrefs);
  } catch {
    // ignore
  }
}

function saveUser() {
  if (currentUser) {
    localStorage.setItem("jikoniUser", JSON.stringify(currentUser));
  }
}

function saveCart() {
  localStorage.setItem("jikoniCart", JSON.stringify(cart));
}

function saveHubSettings() {
  localStorage.setItem("jikoniHub", currentHubId);
  localStorage.setItem("jikoniWalkIn", walkInMode ? "true" : "false");
}

function saveNotificationPrefs() {
  localStorage.setItem("jikoniNotificationPrefs", JSON.stringify(notificationPrefs));
}

function loadHubs() {
  fetch(`${API_BASE}/api/hubs`)
    .then((res) => res.json())
    .then((data) => {
      hubsData = data.hubs || [];
      render();
    })
    .catch(() => {
      // ignore; keep fallback UI
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
  fetch(`${API_BASE}/api/products`)
    .then((res) => res.json())
    .then((data) => {
      productsData = data.products || [];
      render();
    })
    .catch(() => {
      // ignore
    });
}

function render() {
  const root = document.getElementById("app");
  root.innerHTML = "";

  const shell = document.createElement("div");
  shell.className = "app-shell";

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
  bell.onclick = () => showToast("Notifications coming soon");

  const profileBtn = document.createElement("button");
  profileBtn.className = "icon-btn";
  profileBtn.textContent = "👤";
  profileBtn.onclick = () => {
    currentScreen = SCREENS.PROFILE;
    render();
  };

  const cartIcon = document.createElement("button");
  cartIcon.className = "icon-btn";
  cartIcon.textContent = "🛒";
  cartIcon.onclick = () => {
    currentScreen = SCREENS.CART;
    render();
  };

  icons.appendChild(bell);
  icons.appendChild(profileBtn);
  icons.appendChild(cartIcon);
  topBar.appendChild(logo);
  topBar.appendChild(icons);
  shell.appendChild(topBar);

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
  } else if (currentScreen === SCREENS.CART) {
    shell.appendChild(renderCart());
  } else if (currentScreen === SCREENS.LOYALTY) {
    shell.appendChild(renderLoyalty());
  } else if (currentScreen === SCREENS.PROFILE) {
    shell.appendChild(renderProfile());
  } else if (currentScreen === SCREENS.SEARCH) {
    shell.appendChild(renderSearch());
  } else if (currentScreen === SCREENS.ORDER_SUCCESS) {
    shell.appendChild(renderOrderSuccess());
  } else {
    shell.appendChild(renderHome());
  }

  root.appendChild(shell);

  renderFooterNav();

  const existingBot = document.querySelector(".floating-bot");
  if (existingBot) existingBot.remove();
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
  `;

  const actions = document.createElement("div");
  actions.className = "splash-footer";
  const submit = document.createElement("button");
  submit.type = "submit";
  submit.className = "primary-btn";
  submit.textContent = "Continue";
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

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const formData = new FormData(form);
    const name = (formData.get("name") || "").toString().trim();
    const email = (formData.get("email") || "").toString().trim();
    const password = (formData.get("password") || "").toString();
    if (!name || !email || !password) {
      showToast("Fill in your name, email and password");
      return;
    }
    pendingUser = { name, email };

    // Basic loading state
    showToast("Sending your code…");
    submit.disabled = true;
    const previousLabel = submit.textContent;
    submit.textContent = "Sending code…";

    fetch(`${API_BASE}/api/auth/signup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, email, password }),
    })
      .then(async (res) => {
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.message || "Failed to start signup");
        }
        return res.json();
      })
      .then((data) => {
        if (data.code) {
          // Show mock OTP while you are testing
          showToast(`Mock code: ${data.code}`);
        } else {
          showToast("We’ve emailed you a code");
        }
        // Confirm success clearly
        showToast("Sign up successful. Check your email for the 4‑digit code.");
        currentScreen = SCREENS.VERIFY;
        render();
      })
      .catch((err) => {
        console.error(err);
        showToast(err.message || "Could not reach Jikoni servers");
      })
      .finally(() => {
        submit.disabled = false;
        submit.textContent = previousLabel;
      });
  });

  wrap.appendChild(header);
  wrap.appendChild(form);
  wrap.appendChild(actions);
  return wrap;
}

function renderLogin() {
  const wrap = document.createElement("div");
  wrap.className = "auth-screen";

  const header = document.createElement("div");
  header.className = "auth-header";
  header.innerHTML = `
    <div class="auth-title">Log back in</div>
    <div class="auth-subtitle">Use the email and password you used to sign up.</div>
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
  submit.textContent = "Continue";
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

    fetch(`${API_BASE}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    })
      .then(async (res) => {
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.message || "Login failed");
        }
        return res.json();
      })
      .then((data) => {
        currentUser = { ...data.user, token: data.token };
        saveUser();
        showToast(`Karibu back, ${currentUser.name || "rafiki"}!`);
        loadLoyalty();
        currentScreen = SCREENS.HOME;
        render();
      })
      .catch((err) => {
        console.error(err);
        showToast(err.message || "Could not reach Jikoni servers");
      })
      .finally(() => {
        submit.disabled = false;
        submit.textContent = previousLabel;
      });
  });

  wrap.appendChild(header);
  wrap.appendChild(form);
  wrap.appendChild(actions);
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
      <input class="field-input" name="code" maxlength="4" placeholder="••••" required />
      <div class="auth-helper">Use the mock code shown in the toast while testing.</div>
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

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const code = (new FormData(form).get("code") || "").toString().trim();
    if (!pendingUser || !pendingUser.email) {
      showToast("Something went wrong, please start again.");
      currentScreen = SCREENS.SIGN_UP;
      render();
      return;
    }
    if (!code) {
      showToast("Enter the 4‑digit code");
      return;
    }

    const previousLabel = submit.textContent;
    submit.disabled = true;
    submit.textContent = "Verifying…";

    fetch(`${API_BASE}/api/auth/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: pendingUser.email, code }),
    })
      .then(async (res) => {
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.message || "Verification failed");
        }
        return res.json();
      })
      .then((data) => {
        currentUser = { ...data.user, isVerified: true, token: data.token };
        saveUser();
        pendingUser = null;
        showToast("You’re in. Karibu Jikoni!");
        loadLoyalty();
        currentScreen = SCREENS.HOME;
        render();
      })
      .catch((err) => {
        console.error(err);
        showToast(err.message || "Could not reach Jikoni servers");
      })
      .finally(() => {
        submit.disabled = false;
        submit.textContent = previousLabel;
      });
  });

  wrap.appendChild(header);
  wrap.appendChild(form);
  wrap.appendChild(actions);
  return wrap;
}

function renderHome() {
  const container = document.createElement("div");
  container.className = "home";

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
  streak.innerHTML = "🔥 Day 3 · 45 pts";

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
    <div class="hero-glow-sub">
      Streak: Day ${loyaltyState.streak || 0} · ${loyaltyState.points || 0} pts · ${Math.max(
        0,
        loyaltyState.toNextReward || 0
      )} pts to next reward
    </div>
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
    const chip = document.createElement("div");
    chip.className = "category-chip";
    chip.innerHTML = `<div class="category-icon">${icon}</div><div>${label}</div>`;
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
          <div class="cart-item-name">${item.name}</div>
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
    addToCart({ id: "milk", name: "Fresh Milk", meta: "1 L", price: 120 });
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
    <div style="font-weight:600; margin-bottom:6px;">Delivery & Payment</div>
    <div style="display:flex; gap:8px; margin-bottom:8px;">
      <button data-method="pickup" class="glow-btn ${deliveryMethod === "pickup" ? "accept" : ""}">Pickup at hub</button>
      <button data-method="delivery" class="glow-btn ${deliveryMethod === "delivery" ? "accept" : ""}">Home delivery</button>
    </div>
    <div style="font-size:13px; margin-bottom:6px;">
      ${deliveryMethod === "delivery" ? "Delivery: KSh 100 · Use your saved location or drop a pin." : "Pickup free at TRM, Westlands or CBD hubs."}
    </div>
    <div style="display:flex; gap:8px; flex-wrap:wrap;">
      <button data-pay="mpesa" class="glow-btn ${paymentMethod === "mpesa" ? "accept" : ""}">M-Pesa</button>
      <button data-pay="card" class="glow-btn ${paymentMethod === "card" ? "accept" : ""}">Card</button>
      <button data-pay="cod" class="glow-btn ${paymentMethod === "cod" ? "accept" : ""}">Pay on delivery</button>
    </div>
  `;
  deliveryBlock.querySelectorAll("[data-method]").forEach((btn) => {
    btn.addEventListener("click", () => {
      deliveryMethod = btn.getAttribute("data-method");
      render();
    });
  });
  deliveryBlock.querySelectorAll("[data-pay]").forEach((btn) => {
    btn.addEventListener("click", () => {
      paymentMethod = btn.getAttribute("data-pay");
      showToast(`Paying with ${paymentMethod === "mpesa" ? "M-Pesa" : paymentMethod === "card" ? "card" : "cash on delivery"}`);
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

    const payload = {
      email: currentUser.email,
      items: cart.map((item) => ({
        productId: item.id,
        qty: item.qty,
      })),
      deliveryMethod,
      paymentMethod,
      totals: { subtotal, discountTotal, deliveryFee, total },
    };

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
        };
        cart = [];
        saveCart();
        currentScreen = SCREENS.ORDER_SUCCESS;
        render();
      })
      .catch((err) => {
        console.error(err);
        showToast(err.message || "Order failed, please try again.");
      });
  };

  wrap.appendChild(header);
  wrap.appendChild(list);
  if (cart.length) {
    wrap.appendChild(summary);
    wrap.appendChild(deliveryBlock);
    wrap.appendChild(glow);
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
    showToast("You’ve been logged out.");
    currentScreen = SCREENS.AUTH_CHOICE;
    render();
  };
  logoutWrap.appendChild(logoutBtn);

  wrap.appendChild(header);
  wrap.appendChild(body);
  wrap.appendChild(editRow);
  wrap.appendChild(prefs);
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
    body.innerHTML = `
      <div>Asante, ${currentUser?.name || "rafiki"}! 🍅🚚</div>
      <div style="margin-top:4px; font-size:13px;">Order #${
        lastOrderSummary.id
      } · Total KSh ${lastOrderSummary.total}</div>
      <div style="margin-top:4px; font-size:13px;">You earned ${
        lastOrderSummary.awarded
      } pts · Balance ${lastOrderSummary.points ?? 0} pts.</div>
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
  const loyaltyBtn = document.createElement("button");
  loyaltyBtn.className = "secondary-btn";
  loyaltyBtn.textContent = "View loyalty";
  loyaltyBtn.onclick = () => {
    currentScreen = SCREENS.LOYALTY;
    render();
  };
  actions.appendChild(homeBtn);
  actions.appendChild(loyaltyBtn);

  wrap.appendChild(header);
  wrap.appendChild(body);
  wrap.appendChild(actions);
  return wrap;
}

function renderSearch() {
  const wrap = document.createElement("div");
  wrap.className = "auth-screen";
  const header = document.createElement("div");
  header.className = "auth-header";
  header.innerHTML = `
    <div class="auth-title">Search Jikoni</div>
    <div class="auth-subtitle">What are you shopping for today?</div>
  `;
  const form = document.createElement("form");
  form.className = "auth-form";
  form.innerHTML = `
    <div>
      <div class="field-label">Search</div>
      <input class="field-input" placeholder="Milk, sukuma, spices…" />
      <div class="auth-helper">Voice search with the green mic button on the home screen.</div>
    </div>
  `;
  wrap.appendChild(header);
  wrap.appendChild(form);

  const section = document.createElement("div");
  section.className = "section-title";
  section.textContent = "Browse products";
  wrap.appendChild(section);

  const grid = document.createElement("div");
  grid.className = "browse-grid";

  productsData.forEach((p) => {
    const card = document.createElement("div");
    card.className = "product-tile";
    card.innerHTML = `
      <div class="product-tile-name">${p.icon || ""} ${p.name}</div>
      <div class="product-tile-meta">${p.category} · ${p.unit}</div>
    `;
    const priceRow = document.createElement("div");
    priceRow.className = "product-price-row";
    priceRow.innerHTML = `
      <span>KSh ${p.price}</span>
    `;
    const btn = document.createElement("button");
    btn.className = "product-add-btn";
    btn.textContent = "Add";
    btn.onclick = () => {
      addToCart({
        id: p.id,
        name: p.name,
        meta: p.unit,
        price: p.price,
      });
      saveCart();
      showToast(`${p.name} added to cart`);
      render();
    };
    priceRow.appendChild(btn);
    card.appendChild(priceRow);
    grid.appendChild(card);
  });

  wrap.appendChild(grid);
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
  e.preventDefault();
  deferredInstallPrompt = e;
  renderInstallSheet();
});

function updateHeroMessageDom() {
  if (currentScreen !== SCREENS.HOME) return;
  const heroMessages = [
    {
      title: "🥬 Fresh Sukuma at 20% off today",
      sub: "Perfect with ugali and a side of eggs.",
      pill: "20% OFF · Veggie Glow",
    },
    {
      title: "🎁 Surprise Hamper of the Hour",
      sub: "Bananas, spinach & honey sachet · limited time hamper.",
      pill: "Glow Hamper · +Extra pts",
    },
    {
      title: "🍲 Supper Starter Kit",
      sub: "Tomatoes, onions & sukuma in one quick combo.",
      pill: "Save KSh 60 · Combo Glow",
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

function renderInstallSheet() {
  const existing = document.querySelector(".install-sheet");
  if (!deferredInstallPrompt) {
    if (existing) existing.remove();
    return;
  }
  if (existing) existing.remove();

  const sheet = document.createElement("div");
  sheet.className = "install-sheet";
  sheet.innerHTML = `
    <div class="install-sheet-inner">
      <img src="/public/logo.png" alt="Jikoni" class="install-sheet-logo" />
      <div class="install-sheet-text">
        Install <strong>Jikoni</strong> for faster access to your groceries and hampers.
      </div>
      <div class="install-sheet-actions">
        <button class="install-btn">Install</button>
        <button class="install-dismiss">Not now</button>
      </div>
    </div>
  `;

  const installBtn = sheet.querySelector(".install-btn");
  const dismissBtn = sheet.querySelector(".install-dismiss");

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

  dismissBtn.addEventListener("click", () => {
    deferredInstallPrompt = null;
    sheet.remove();
  });

  document.body.appendChild(sheet);
}


