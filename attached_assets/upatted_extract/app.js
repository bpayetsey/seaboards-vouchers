/* The Seaboards voucher storefront — talks to the Express API and mounts the
   real Stripe Payment Element. */

let CFG = null, stripe = null, CART = null, plan = "full";
let elements = null, currentClientSecret = null, currentOrderId = null;
let giftAmount = 0;

const $ = (id) => document.getElementById(id);
const fmt = (n) => CFG.symbol + Number(n).toLocaleString(undefined, { minimumFractionDigits: 0 });

init();

async function init() {
  CFG = await (await fetch("/api/config")).json();
  giftAmount = CFG.gift.amounts[1];
  if (CFG.publishableKey) stripe = Stripe(CFG.publishableKey);
  renderCatalog();
  startCountdown();
  $("closeBtn").onclick = closeDrawer;
  $("scrim").onclick = closeDrawer;
  document.addEventListener("keydown", (e) => e.key === "Escape" && closeDrawer());
}

/* ---------- catalogue ---------- */
function renderCatalog() {
  const grid = $("voucherGrid");
  grid.innerHTML = "";
  CFG.catalog.forEach((v) => {
    const el = document.createElement("div");
    el.className = "card" + (v.featured ? " featured" : "");
    el.innerHTML = `
      <div class="ribbon">${v.ribbon}</div>
      <h3>${v.name}</h3>
      <p class="desc">${v.desc}</p>
      <ul class="feat">${v.feat.map((f) => `<li>${f}</li>`).join("")}</ul>
      <div class="price">${fmt(v.price)} <small>voucher</small><span class="was">${fmt(v.was)}</span></div>
      <button class="btn btn-ocean buy">Buy this voucher</button>`;
    el.querySelector(".buy").onclick = () =>
      openCheckout({ type: "package", id: v.id, name: v.name, amount: v.price });
    grid.appendChild(el);
  });

  const gift = document.createElement("div");
  gift.className = "card giftcard";
  gift.innerHTML = `
    <div>
      <div class="ribbon" style="background:rgba(255,255,255,.1);color:var(--gold)">Open value</div>
      <h3>${CFG.gift.name}</h3>
      <p class="desc">Choose any amount and let them pick their own dates. Perfect for the friend who has everything except a holiday.</p>
      <div class="amounts" id="giftChips">${CFG.gift.amounts.map((a) =>
        `<button class="chip${a === giftAmount ? " active" : ""}" data-a="${a}">${fmt(a)}</button>`).join("")}</div>
      <div class="gift-custom"><span style="font-size:13px;color:#cfdad9">or enter amount</span>
        <input id="giftInput" type="number" min="${CFG.gift.min}" step="10" placeholder="${CFG.symbol} ___"/></div>
    </div>
    <div style="text-align:center">
      <div class="price" id="giftPrice" style="color:var(--gold)">${fmt(giftAmount)}</div>
      <button class="btn btn-gold" id="giftBuy" style="margin-top:16px">Buy gift voucher</button>
    </div>`;
  grid.appendChild(gift);

  gift.querySelectorAll(".chip").forEach((c) => (c.onclick = () => {
    giftAmount = +c.dataset.a; $("giftInput").value = "";
    gift.querySelectorAll(".chip").forEach((x) => x.classList.toggle("active", x === c));
    $("giftPrice").textContent = fmt(giftAmount);
  }));
  $("giftInput").oninput = (e) => {
    const val = Math.max(0, +e.target.value || 0);
    gift.querySelectorAll(".chip").forEach((x) => x.classList.remove("active"));
    giftAmount = val; $("giftPrice").textContent = fmt(val || 0);
  };
  $("giftBuy").onclick = () => {
    if (giftAmount < CFG.gift.min) return alert("Minimum gift voucher is " + fmt(CFG.gift.min));
    openCheckout({ type: "gift", id: "gift", name: CFG.gift.name, amount: giftAmount });
  };
}

/* ---------- countdown ---------- */
function startCountdown() {
  const tick = () => {
    const target = new Date("2026-06-29T00:00:00+04:00");
    let s = Math.max(0, (target - new Date()) / 1000);
    const d = Math.floor(s / 86400); s -= d * 86400;
    const h = Math.floor(s / 3600); s -= h * 3600;
    const m = Math.floor(s / 60);
    $("countdown").innerHTML = [["Days", d], ["Hours", h], ["Min", m]]
      .map(([l, v]) => `<div class="cd"><b>${String(v).padStart(2, "0")}</b><span>${l}</span></div>`).join("");
  };
  tick(); setInterval(tick, 60000);
}

/* ---------- instalment maths (display only; server is authoritative) ---------- */
function schedule(total) {
  const n = CFG.instalments;
  const per = Math.round((total / n) * 100) / 100;
  const last = Math.round((total - per * (n - 1)) * 100) / 100;
  return Array.from({ length: n }, (_, i) => {
    const due = new Date(); due.setDate(due.getDate() + i * CFG.intervalDays);
    return { n: i + 1, amount: i === n - 1 ? last : per,
      when: i === 0 ? "Today" : due.toLocaleDateString(undefined, { day: "numeric", month: "short" }) };
  });
}

/* ---------- drawer ---------- */
function openCheckout(item) {
  CART = item; plan = "full"; elements = null; currentClientSecret = null; currentOrderId = null;
  $("drawerTitle").textContent = "Checkout";
  renderDetails();
  $("scrim").classList.add("open");
  $("drawer").classList.add("open");
}
function closeDrawer() {
  $("scrim").classList.remove("open");
  $("drawer").classList.remove("open");
}

/* step 1 — details + plan choice */
function renderDetails() {
  const total = CART.amount;
  const sched = schedule(total);
  $("drawerBody").innerHTML = `
    <div class="summary">
      <div class="row"><span>${CART.name}</span><b>${fmt(total)}</b></div>
      <div class="row" style="color:var(--muted)"><span>Valid 12 months · emailed redemption code</span><span></span></div>
      <div class="row total"><span>Voucher value</span><span>${fmt(total)}</span></div>
    </div>
    <label style="font-size:12.5px;letter-spacing:.04em;text-transform:uppercase;color:var(--muted);font-weight:600">Payment</label>
    <div class="plan-toggle">
      <button class="plan ${plan === "full" ? "active" : ""}" data-plan="full">
        <b>Pay in full</b><span>${fmt(total)} today</span></button>
      <button class="plan ${plan === "3" ? "active" : ""}" data-plan="3">
        <b>Pay in ${CFG.instalments}</b><span>${fmt(sched[0].amount)} today, then ${CFG.instalments - 1}×</span></button>
    </div>
    ${plan === "3" ? `<ul class="schedule">${sched.map((r) =>
      `<li class="${r.n === 1 ? "now" : ""}"><span>Instalment ${r.n} · ${r.when}</span><b>${fmt(r.amount)}</b></li>`).join("")}
      <li style="border:none;color:var(--muted);font-size:12.5px"><span>Interest-free · same card charged automatically</span><span></span></li></ul>` : ""}
    <div class="field"><label>Full name</label><input id="ckName" placeholder="As it appears on the card" value="${CART._name || ""}"/></div>
    <div class="field"><label>Email for the voucher</label><input id="ckEmail" type="email" placeholder="you@email.com" value="${CART._email || ""}"/></div>`;

  $("drawerBody").querySelectorAll(".plan").forEach((b) =>
    (b.onclick = () => { CART._name = $("ckName").value; CART._email = $("ckEmail").value; plan = b.dataset.plan; renderDetails(); }));

  const firstNow = plan === "full" ? total : sched[0].amount;
  $("drawerFoot").innerHTML = `
    <button class="btn btn-gold" id="toPay">Continue to payment · ${fmt(firstNow)}</button>
    <div class="fineprint">${plan === "3" ? `Total ${fmt(total)} over ${CFG.instalments} months, 0% interest.` : "One secure payment."}</div>`;
  $("toPay").onclick = startPayment;
}

/* step 2 — create order, mount Stripe Payment Element */
async function startPayment() {
  const name = ($("ckName").value || "").trim();
  const email = ($("ckEmail").value || "").trim();
  if (!name || !email.includes("@")) return alert("Please enter your name and a valid email.");
  CART._name = name; CART._email = email;

  if (!stripe) return alert("Stripe key not set. Add STRIPE_PUBLISHABLE_KEY in Replit Secrets.");

  $("drawerFoot").innerHTML = `<button class="btn btn-gold" disabled><span class="spinner"></span>Setting up secure payment…</button>`;
  let data;
  try {
    const res = await fetch("/api/orders", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ productId: CART.id, type: CART.type, amount: CART.amount, plan, name, email }),
    });
    data = await res.json();
    if (!res.ok) throw new Error(data.error || "Could not start checkout.");
  } catch (e) {
    renderDetails(); $("drawerBody").insertAdjacentHTML("beforeend", `<p class="err">${e.message}</p>`); return;
  }

  currentClientSecret = data.clientSecret;
  currentOrderId = data.orderId;
  const total = CART.amount;
  const firstNow = plan === "full" ? total : schedule(total)[0].amount;

  $("drawerTitle").textContent = "Payment";
  $("drawerBody").innerHTML = `
    <div class="summary">
      <div class="row"><span>${CART.name}</span><b>${fmt(total)}</b></div>
      ${plan === "3" ? `<div class="row" style="color:var(--muted)"><span>Paying today (1 of ${CFG.instalments})</span><b>${fmt(firstNow)}</b></div>` : ""}
      <div class="row total"><span>Charged now</span><span>${fmt(firstNow)}</span></div>
    </div>
    <div class="field"><label>Card details</label><div id="payment-element"></div><div class="err" id="payErr"></div></div>
    <div class="stripe-note">🔒 <span>${plan === "3"
      ? "Your card is stored securely with Stripe and charged automatically for the remaining instalments."
      : "Processed securely by Stripe. We never see your card number."}</span></div>`;

  elements = stripe.elements({
    clientSecret: currentClientSecret,
    appearance: { theme: "flat", variables: { colorPrimary: "#C9A24B", fontFamily: "Inter, sans-serif", borderRadius: "11px", colorBackground: "#ffffff" } },
  });
  elements.create("payment", { layout: "tabs" }).mount("#payment-element");

  $("drawerFoot").innerHTML = `
    <button class="btn btn-gold" id="payBtn">Pay ${fmt(firstNow)}${plan === "3" ? " now" : ""}</button>
    <button class="btn btn-ghost" id="backBtn" style="width:100%;margin-top:8px">Back</button>
    <div class="fineprint">By paying you agree to the voucher terms.${plan === "3" ? ` Total ${fmt(total)} over ${CFG.instalments} months.` : ""}</div>`;
  $("payBtn").onclick = pay;
  $("backBtn").onclick = renderDetails;
}

/* confirm with Stripe, then finalise on the server */
async function pay() {
  $("payErr").textContent = "";
  $("payBtn").disabled = true;
  $("payBtn").innerHTML = `<span class="spinner"></span>Processing…`;

  const { error, paymentIntent } = await stripe.confirmPayment({ elements, redirect: "if_required" });
  if (error) {
    $("payErr").textContent = error.message || "Payment could not be completed.";
    $("payBtn").disabled = false;
    $("payBtn").textContent = "Try again";
    return;
  }

  // finalise on the server (issues / activates the voucher; webhook does the same)
  let result = {};
  try {
    const res = await fetch(`/api/orders/${currentOrderId}/confirm`, { method: "POST" });
    result = await res.json();
  } catch (_) {}
  renderSuccess(paymentIntent, result);
}

function renderSuccess(paymentIntent, result) {
  const firstName = (CART._name || "").split(" ")[0] || "there";
  const code = result.voucher?.code;
  const active = result.voucher?.status === "active";
  let statusLine;
  if (plan === "3") statusLine = `First instalment paid. Your code activates once all ${CFG.instalments} instalments clear.`;
  else statusLine = active ? "Paid in full — your code is active now." : "Paid in full — your code is on its way.";

  $("drawerTitle").textContent = "Order confirmed";
  $("drawerBody").innerHTML = `
    <div class="success">
      <svg class="seal-ok" viewBox="0 0 120 120"><circle cx="60" cy="60" r="56" fill="none" stroke="#C9A24B" stroke-width="2"/><path d="M40 62 L54 76 L82 44" fill="none" stroke="#1F8A52" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/></svg>
      <h3 style="font-size:24px">Thank you, ${firstName}!</h3>
      <p style="color:var(--muted);margin-top:8px">We've emailed your voucher to <b>${CART._email}</b>.</p>
      ${code ? `<div class="codebox">${code}</div>` : ""}
      <p style="font-size:13.5px;color:#3c4f52">${statusLine}</p>
    </div>`;
  $("drawerFoot").innerHTML = `<button class="btn btn-ocean" id="doneBtn">Done</button>`;
  $("doneBtn").onclick = closeDrawer;
}
