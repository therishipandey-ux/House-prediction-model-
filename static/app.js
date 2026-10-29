/* Gharmol: live price and rent estimator front end.
   Every change in the form calls /api/predict and redraws the result. */
(function () {
  "use strict";

  var BOOT = JSON.parse(document.getElementById("boot").textContent);
  var $ = function (id) { return document.getElementById(id); };
  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // ------------------------------------------------------------------
  // Helpers
  // ------------------------------------------------------------------
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function title(name) { return name.replace(/\b[a-z]/g, function (c) { return c.toUpperCase(); }); }
  function grp(n) { return Math.round(n).toLocaleString("en-IN"); }

  // 12500000 -> "₹1.25 Cr",  850000 -> "₹8.50 Lakh"
  function inr(n) {
    if (n >= 1e7) return "₹" + (n / 1e7).toFixed(2) + " Cr";
    if (n >= 1e5) return "₹" + (n / 1e5).toFixed(2) + " Lakh";
    return "₹" + grp(n);
  }
  function rentFmt(n) {
    n = Math.round(n / 100) * 100;
    return n >= 1e5 ? "₹" + (n / 1e5).toFixed(2) + " Lakh" : "₹" + grp(n);
  }
  function axisFmt(n) {
    if (n === 0) return "0";
    if (n >= 1e7) return "₹" + +(n / 1e7).toFixed(2) + " Cr";
    return "₹" + +(n / 1e5).toFixed(0) + " L";
  }
  function clamp(v, a, b) { return Math.min(b, Math.max(a, v)); }

  var byName = {};
  BOOT.locations.forEach(function (l) { byName[l.name] = l; });
  var byLower = {};
  BOOT.locations.forEach(function (l) { byLower[l.name.toLowerCase()] = l; });

  // ------------------------------------------------------------------
  // State (also kept in the URL so an estimate can be shared)
  // ------------------------------------------------------------------
  var ESSENTIALS = ["Lift Available", "CarParking", "Maintenance Staff", "24x7 Security"];
  var state = {
    location: byName["Powai"] ? "Powai" : BOOT.popular[0],
    sqft: 750, bhk: 2, resale: 0,
    amenities: ESSENTIALS.filter(function (a) { return BOOT.amenities.indexOf(a) > -1; })
  };

  function readUrl() {
    var p = new URLSearchParams(location.search);
    var l = p.get("l");
    if (l && byName[l]) state.location = l;
    var a = parseInt(p.get("a"), 10); if (a >= 200 && a <= 8000) state.sqft = a;
    var b = parseInt(p.get("b"), 10); if (b >= 1 && b <= 7) state.bhk = b;
    if (p.get("r") === "1") state.resale = 1;
    if (p.has("am")) {
      state.amenities = p.get("am").split(",").map(function (i) { return BOOT.amenities[+i]; }).filter(Boolean);
    }
  }
  function writeUrl() {
    var p = new URLSearchParams();
    p.set("l", state.location); p.set("a", state.sqft); p.set("b", state.bhk); p.set("r", state.resale);
    p.set("am", state.amenities.map(function (a) { return BOOT.amenities.indexOf(a); }).join(","));
    try { history.replaceState(null, "", "?" + p.toString()); } catch (e) { /* ignore */ }
  }

  // ------------------------------------------------------------------
  // Number count-up
  // ------------------------------------------------------------------
  function tween(el, to, fmt) {
    var from = el._v == null ? to : el._v;
    el._v = to;
    if (el._raf) cancelAnimationFrame(el._raf);
    if (reduceMotion || from === to) { el.textContent = fmt(to); return; }
    var start = performance.now(), dur = 420;
    (function step(now) {
      var t = Math.min(1, (now - start) / dur), e = 1 - Math.pow(1 - t, 3);
      el.textContent = fmt(from + (to - from) * e);
      if (t < 1) el._raf = requestAnimationFrame(step);
    })(start);
  }

  // ------------------------------------------------------------------
  // Form: location combobox
  // ------------------------------------------------------------------
  var locInput = $("location"), locList = $("location-list");
  var activeIdx = -1, shown = [];

  function optionHtml(l, i) {
    return '<li role="option" id="opt-' + i + '" data-name="' + esc(l.name) + '">' +
      "<span>" + esc(title(l.name)) + "</span><small>" + grp(l.ppsf) + " / sq ft &middot; " + l.listings +
      (l.listings === 1 ? " listing" : " listings") + "</small></li>";
  }
  function renderList() {
    var q = locInput.value.trim().toLowerCase();
    var html = "";
    shown = [];
    if (!q || (byLower[q] && byLower[q].name === state.location)) {
      html += '<li class="group">Most listings</li>';
      shown = BOOT.popular.map(function (n) { return byName[n]; });
    } else {
      var starts = [], contains = [];
      BOOT.locations.forEach(function (l) {
        var n = l.name.toLowerCase();
        if (n.indexOf(q) === 0) starts.push(l); else if (n.indexOf(q) > -1) contains.push(l);
      });
      shown = starts.concat(contains).slice(0, 9);
    }
    if (!shown.length) {
      html = '<li class="empty">No locality matches &ldquo;' + esc(locInput.value) + "&rdquo;</li>";
    } else {
      var offset = html ? 1 : 0;
      html += shown.map(optionHtml).join("");
    }
    locList.innerHTML = html;
    activeIdx = shown.length ? 0 : -1;
    highlight();
  }
  function highlight() {
    var items = locList.querySelectorAll("li[role=option]");
    items.forEach(function (li, i) { li.setAttribute("aria-selected", i === activeIdx ? "true" : "false"); });
    if (activeIdx > -1 && items[activeIdx]) {
      locInput.setAttribute("aria-activedescendant", items[activeIdx].id);
      items[activeIdx].scrollIntoView({ block: "nearest" });
    } else { locInput.removeAttribute("aria-activedescendant"); }
  }
  function openList() { renderList(); locList.hidden = false; locInput.setAttribute("aria-expanded", "true"); }
  function closeList() { locList.hidden = true; locInput.setAttribute("aria-expanded", "false"); }

  function chooseLocation(name) {
    if (!byName[name]) return;
    state.location = name;
    locInput.value = title(name);
    locInput.classList.remove("invalid");
    closeList();
    syncLocationHint();
    syncQuick();
    update();
  }
  function syncLocationHint() {
    var l = byName[state.location];
    var txt = grp(l.ppsf) + " per sq ft typically, from " + l.listings + (l.listings === 1 ? " listing" : " listings") + ".";
    if (l.confidence === "low") txt += " Few listings here, so treat the estimate as rough.";
    $("location-hint").textContent = txt;
  }

  locInput.addEventListener("focus", function () { locInput.select(); openList(); });
  locInput.addEventListener("input", openList);
  locInput.addEventListener("keydown", function (e) {
    if (e.key === "ArrowDown") { e.preventDefault(); if (locList.hidden) openList(); else { activeIdx = Math.min(shown.length - 1, activeIdx + 1); highlight(); } }
    else if (e.key === "ArrowUp") { e.preventDefault(); activeIdx = Math.max(0, activeIdx - 1); highlight(); }
    else if (e.key === "Enter") { e.preventDefault(); if (!locList.hidden && shown[activeIdx]) chooseLocation(shown[activeIdx].name); }
    else if (e.key === "Escape") { closeList(); locInput.value = title(state.location); }
  });
  locInput.addEventListener("blur", function () {
    setTimeout(function () {
      var hit = byLower[locInput.value.trim().toLowerCase()];
      if (hit && hit.name !== state.location) chooseLocation(hit.name);
      else { locInput.value = title(state.location); locInput.classList.remove("invalid"); closeList(); }
    }, 120);
  });
  locList.addEventListener("mousedown", function (e) {
    var li = e.target.closest("li[data-name]");
    if (li) { e.preventDefault(); chooseLocation(li.dataset.name); locInput.blur(); }
  });

  // quick chips in the hero
  function buildQuick() {
    $("quick").innerHTML = BOOT.popular.slice(0, 7).map(function (n) {
      return '<button type="button" data-name="' + esc(n) + '" aria-pressed="false">' + esc(title(n)) + "</button>";
    }).join("");
    $("quick").addEventListener("click", function (e) {
      var b = e.target.closest("button"); if (b) chooseLocation(b.dataset.name);
    });
  }
  function syncQuick() {
    $("quick").querySelectorAll("button").forEach(function (b) {
      b.setAttribute("aria-pressed", b.dataset.name === state.location ? "true" : "false");
    });
  }

  // ------------------------------------------------------------------
  // Form: size, bhk, type, amenities
  // ------------------------------------------------------------------
  var sqftNum = $("sqft"), sqftRange = $("sqft-range");
  function paintRange(r) {
    var pct = (r.value - r.min) / (r.max - r.min) * 100;
    r.style.setProperty("--pct", clamp(pct, 0, 100) + "%");
  }
  function syncSize(from) {
    if (from !== "num") sqftNum.value = state.sqft;
    if (from !== "range") sqftRange.value = Math.min(state.sqft, +sqftRange.max);
    paintRange(sqftRange);
  }
  sqftRange.addEventListener("input", function () { state.sqft = +sqftRange.value; syncSize("range"); update(); });
  sqftNum.addEventListener("input", function () {
    var v = parseFloat(sqftNum.value);
    if (isNaN(v)) { showError("Enter an area between 200 and 8,000 sq ft."); return; }
    if (v < 200 || v > 8000) { showError("Area must be between 200 and 8,000 sq ft."); return; }
    state.sqft = v; syncSize("num"); update();
  });
  sqftNum.addEventListener("blur", function () { syncSize(); });

  function buildBhk() {
    var html = "";
    for (var i = 1; i <= 7; i++) {
      html += '<button type="button" role="radio" data-v="' + i + '" aria-checked="' + (i === state.bhk) + '" aria-label="' + i + ' BHK">' + i + "</button>";
    }
    $("bhk").innerHTML = html;
    $("bhk").addEventListener("click", function (e) {
      var b = e.target.closest("button"); if (!b) return;
      state.bhk = +b.dataset.v; syncBhk(); update();
    });
  }
  function syncBhk() {
    $("bhk").querySelectorAll("button").forEach(function (b) { b.setAttribute("aria-checked", +b.dataset.v === state.bhk); });
  }
  // arrow keys move through radio-style groups
  function arrowNav(group) {
    group.addEventListener("keydown", function (e) {
      if (["ArrowRight", "ArrowLeft", "ArrowDown", "ArrowUp"].indexOf(e.key) < 0) return;
      var btns = Array.prototype.slice.call(group.querySelectorAll("button"));
      var i = btns.findIndex(function (b) { return b.getAttribute("aria-checked") === "true"; });
      i = (i + (e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : -1) + btns.length) % btns.length;
      e.preventDefault(); btns[i].click(); btns[i].focus();
    });
  }

  $("type").addEventListener("click", function (e) {
    var b = e.target.closest("button"); if (!b) return;
    state.resale = +b.dataset.v; syncType(); update();
  });
  function syncType() {
    $("type").querySelectorAll("button").forEach(function (b) { b.setAttribute("aria-checked", +b.dataset.v === state.resale); });
  }

  function buildAmenities() {
    $("amen-total").textContent = BOOT.amenities.length;
    $("amenities").innerHTML = BOOT.amenities.map(function (a) {
      return '<button type="button" data-a="' + esc(a) + '" aria-pressed="false">' + esc(a) + "</button>";
    }).join("");
    $("amenities").addEventListener("click", function (e) {
      var b = e.target.closest("button"); if (!b) return;
      var a = b.dataset.a, i = state.amenities.indexOf(a);
      if (i > -1) state.amenities.splice(i, 1); else state.amenities.push(a);
      syncAmenities(); update();
    });
    document.querySelector(".presets").addEventListener("click", function (e) {
      var b = e.target.closest("button"); if (!b) return;
      var p = b.dataset.preset;
      state.amenities = p === "all" ? BOOT.amenities.slice() : p === "none" ? [] :
        ESSENTIALS.filter(function (a) { return BOOT.amenities.indexOf(a) > -1; });
      syncAmenities(); update();
    });
  }
  function syncAmenities() {
    $("amenities").querySelectorAll("button").forEach(function (b) {
      b.setAttribute("aria-pressed", state.amenities.indexOf(b.dataset.a) > -1 ? "true" : "false");
    });
    $("amen-count").textContent = state.amenities.length;
  }

  function showError(msg) {
    var el = $("form-error");
    if (msg) { el.textContent = msg; el.hidden = false; } else { el.hidden = true; }
  }

  // ------------------------------------------------------------------
  // Talking to the model
  // ------------------------------------------------------------------
  var last = null, timer = null, ctrl = null;

  function update() {
    writeUrl();
    showError("");
    $("results").classList.add("is-loading");
    clearTimeout(timer);
    timer = setTimeout(fetchEstimate, 110);
  }

  function fetchEstimate() {
    if (ctrl) ctrl.abort();
    ctrl = new AbortController();
    fetch("/api/predict", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        location: state.location, sqft: state.sqft, bhk: state.bhk,
        resale: state.resale, amenity: state.amenities
      }),
      signal: ctrl.signal
    })
      .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
      .then(function (res) {
        if (!res.ok) { showError(res.d.error || "Something went wrong. Try again."); return; }
        last = res.d; render();
      })
      .catch(function (err) {
        if (err.name !== "AbortError") showError("Can't reach the estimator. Check that the server is running and try again.");
      })
      .then(function () { $("results").classList.remove("is-loading"); });
  }

  // ------------------------------------------------------------------
  // Rendering the result
  // ------------------------------------------------------------------
  function render() {
    var d = last, a = d.area;
    $("v-where").textContent = state.bhk + " BHK, " + grp(state.sqft) + " sq ft, " + (state.resale ? "resale" : "new") + " in " + title(a.name);

    var level = { low: 1, medium: 2, high: 3 }[a.confidence];
    var label = { low: "Limited data", medium: "Good data", high: "Strong data" }[a.confidence];
    $("v-conf").innerHTML = '<span class="dots">' + [1, 2, 3].map(function (i) { return '<i class="' + (i <= level ? "on" : "") + '"></i>'; }).join("") +
      "</span>" + label + ": " + a.listings + (a.listings === 1 ? " listing" : " listings") + " in the area";

    tween($("price"), d.price, inr);
    tween($("rent"), d.rent, rentFmt);
    tween($("dock-price"), d.price, inr);
    tween($("dock-rent"), d.rent, rentFmt);
    $("price-range").textContent = "Likely " + inr(d.low) + " to " + inr(d.high);
    $("rent-range").textContent = "Likely " + rentFmt(d.rent_low) + " to " + rentFmt(d.rent_high);

    var span = Math.max(d.high - d.low, 1);
    $("rb-dot").style.left = clamp((d.price - d.low) / span * 100, 5, 95) + "%";
    $("rb-low").textContent = inr(d.low);
    $("rb-high").textContent = inr(d.high);

    renderPin();
    renderGauge(d);
    renderAmenity(d);
    renderChart(d);
    renderLadder(d);
    renderEmi();
  }

  // ---- compared with the neighbourhood ----
  function renderGauge(d) {
    var area = d.area.ppsf, you = d.price_per_sqft;
    var max = Math.max(area, you) * 1.25;
    var pa = area / max * 100, py = you / max * 100;
    var lo = Math.min(pa, py), hi = Math.max(pa, py);
    $("gauge").innerHTML =
      '<div class="g-track"></div><div class="g-fill" style="left:' + lo + "%;width:" + (hi - lo) + '%"></div>' +
      '<div class="g-tick" style="left:' + pa + '%"><span>Area typical &#8377;' + grp(area) + '</span></div>' +
      '<div class="g-you" style="left:' + py + '%"><span>This flat &#8377;' + grp(you) + "</span></div>";
    var diff = Math.round((you - area) / area * 100);
    $("gauge-note").textContent = Math.abs(diff) < 3 ? "Right in line with other flats in " + title(d.area.name) + "."
      : Math.abs(diff) + "% " + (diff > 0 ? "above" : "below") + " the typical price per sq ft in " + title(d.area.name) +
        (diff > 0 ? ". Larger or newer flats often price higher per sq ft." : ". Bigger flats usually cost less per sq ft.");
  }

  // ---- amenities ----
  function renderAmenity(d) {
    var n = state.amenities.length, total = BOOT.amenities.length;
    var max = Math.max(d.amenity_full, d.amenity_bare, d.price);
    function row(lbl, v, cls) {
      return '<div class="ab ' + cls + '"><span>' + lbl + '</span><div class="bar"><i style="width:' + (v / max * 100) + '%"></i><b>' + inr(v) + "</b></div></div>";
    }
    $("amen-bars").innerHTML = row("None", d.amenity_bare, "") + row("Your " + n, d.price, "you") + row("All " + total, d.amenity_full, "");
    var gain = d.amenity_full - d.amenity_bare, pct = Math.round(gain / d.amenity_bare * 100);
    $("amen-note").textContent = Math.abs(pct) < 1 ? "Amenities barely move the price for this flat."
      : "A full set of amenities is worth about " + inr(Math.abs(gain)) + " (" + Math.abs(pct) + "%) " + (gain >= 0 ? "more" : "less") + " than none for this flat.";
  }

  // ---- price by size chart ----
  var CH = { W: 640, H: 280, l: 62, r: 14, t: 18, b: 34 };
  function renderChart(d) {
    var pts = d.curve, x0 = pts[0][0], x1 = pts[pts.length - 1][0];
    var ymaxRaw = Math.max(d.price, Math.max.apply(null, pts.map(function (p) { return p[1]; }))) * 1.06;
    var step = niceStep(ymaxRaw / 4), ymax = step * Math.ceil(ymaxRaw / step);
    var X = function (v) { return CH.l + (v - x0) / (x1 - x0) * (CH.W - CH.l - CH.r); };
    var Y = function (v) { return CH.H - CH.b - v / ymax * (CH.H - CH.t - CH.b); };

    var grid = "", ylab = "";
    for (var v = 0; v <= ymax + 1; v += step) {
      grid += '<line x1="' + CH.l + '" x2="' + (CH.W - CH.r) + '" y1="' + Y(v) + '" y2="' + Y(v) + '"/>';
      ylab += '<text x="' + (CH.l - 8) + '" y="' + (Y(v) + 4) + '" text-anchor="end">' + axisFmt(v) + "</text>";
    }
    var xlab = "";
    [500, 1000, 1500, 2000, 2500, 3000].forEach(function (s) {
      xlab += '<text x="' + X(s) + '" y="' + (CH.H - 10) + '" text-anchor="middle">' + grp(s) + (s === 3000 ? " sq ft" : "") + "</text>";
    });
    var line = pts.map(function (p, i) { return (i ? "L" : "M") + X(p[0]).toFixed(1) + " " + Y(p[1]).toFixed(1); }).join("");
    var area = line + "L" + X(x1) + " " + Y(0) + "L" + X(x0) + " " + Y(0) + "Z";

    var you = "";
    if (state.sqft >= x0 && state.sqft <= x1) {
      you = '<g class="you"><line x1="' + X(state.sqft) + '" x2="' + X(state.sqft) + '" y1="' + Y(d.price) + '" y2="' + Y(0) + '"/>' +
        '<circle cx="' + X(state.sqft) + '" cy="' + Y(d.price) + '" r="7"/></g>';
    }
    $("chart").innerHTML =
      '<svg viewBox="0 0 ' + CH.W + " " + CH.H + '" role="img" aria-label="Estimated price against size. Your flat at ' + grp(state.sqft) + " sq ft is " + inr(d.price) + '.">' +
      '<defs><linearGradient id="ar" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#F5B614" stop-opacity=".38"/><stop offset="1" stop-color="#F5B614" stop-opacity="0"/></linearGradient></defs>' +
      '<g class="grid">' + grid + '</g><g class="axis">' + ylab + xlab + "</g>" +
      '<path d="' + area + '" fill="url(#ar)"/><path class="line" d="' + line + '"/>' + you +
      '<g class="hover" style="display:none"><line class="cross" y1="' + CH.t + '" y2="' + (CH.H - CH.b) + '"/><circle class="cross-dot" r="5"/></g>' +
      '<rect x="' + CH.l + '" y="' + CH.t + '" width="' + (CH.W - CH.l - CH.r) + '" height="' + (CH.H - CH.t - CH.b) + '" fill="transparent"/></svg>' +
      '<div class="tip"></div>';

    var svg = $("chart").querySelector("svg"), hover = svg.querySelector(".hover"), tip = $("chart").querySelector(".tip");
    function at(ev) {
      var r = svg.getBoundingClientRect();
      var px = (ev.clientX - r.left) / r.width * CH.W;
      var s = clamp(x0 + (px - CH.l) / (CH.W - CH.l - CH.r) * (x1 - x0), x0, x1);
      var i = 0; while (i < pts.length - 2 && pts[i + 1][0] < s) i++;
      var a = pts[i], b = pts[i + 1], t = (s - a[0]) / (b[0] - a[0]);
      return { s: s, p: a[1] + (b[1] - a[1]) * t, r: r };
    }
    svg.addEventListener("pointermove", function (ev) {
      var h = at(ev);
      hover.style.display = "";
      hover.querySelector("line").setAttribute("x1", X(h.s)); hover.querySelector("line").setAttribute("x2", X(h.s));
      hover.querySelector("circle").setAttribute("cx", X(h.s)); hover.querySelector("circle").setAttribute("cy", Y(h.p));
      tip.innerHTML = "<b>" + inr(h.p) + "</b>" + grp(Math.round(h.s / 10) * 10) + " sq ft";
      tip.style.left = clamp(X(h.s) / CH.W * h.r.width, 50, h.r.width - 50) + "px";
      tip.style.top = (Y(h.p) / CH.H * h.r.height) + "px";
      tip.classList.add("on");
    });
    svg.addEventListener("pointerleave", function () { hover.style.display = "none"; tip.classList.remove("on"); });
    svg.addEventListener("click", function (ev) {
      state.sqft = Math.round(at(ev).s / 10) * 10; syncSize(); update();
    });
  }
  function niceStep(raw) {
    var p = Math.pow(10, Math.floor(Math.log10(raw))), m = raw / p;
    return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10) * p;
  }

  // ---- price per sq ft ladder ----
  function renderLadder(d) {
    var names = BOOT.popular.slice();
    var inList = names.indexOf(state.location) > -1;
    var rows = names.map(function (n) { return byName[n]; }).sort(function (a, b) { return b.ppsf - a.ppsf; });
    var cur = byName[state.location];
    var max = Math.max.apply(null, rows.map(function (r) { return r.ppsf; }).concat(cur.ppsf, d.price_per_sqft));
    function row(l, label) {
      return '<button type="button" data-name="' + esc(l.name) + '" aria-pressed="' + (l.name === state.location) + '">' +
        '<span class="nm">' + esc(title(l.name)) + '</span><span class="bar"><i style="width:' + (l.ppsf / max * 100) + '%"></i></span>' +
        '<span class="val">&#8377;' + grp(l.ppsf) + "</span></button>";
    }
    var html = rows.map(row).join("");
    if (!inList) html = row(cur) + '<div class="sep"></div>' + html;
    $("ladder").innerHTML = html;
  }
  $("ladder").addEventListener("click", function (e) {
    var b = e.target.closest("button"); if (b) chooseLocation(b.dataset.name);
  });

  // ---- buy or rent ----
  var emiIds = ["down", "rate", "years"];
  emiIds.forEach(function (id) {
    $(id).addEventListener("input", function () { paintRange($(id)); if (last) renderEmi(); });
  });
  function renderEmi() {
    var down = +$("down").value, rate = +$("rate").value, yrs = +$("years").value;
    emiIds.forEach(function (id) { paintRange($(id)); });
    $("down-out").textContent = down + "%";
    $("rate-out").textContent = rate.toFixed(1) + "%";
    $("years-out").textContent = yrs + " years";
    if (!last) return;
    var price = last.price, loan = price * (1 - down / 100), r = rate / 1200, n = yrs * 12;
    var emi = loan * r * Math.pow(1 + r, n) / (Math.pow(1 + r, n) - 1);
    var interest = emi * n - loan, rent = last.rent;
    var ratio = emi / rent;
    $("emi-out").innerHTML =
      '<div class="e-row"><span>Monthly EMI</span><b class="e-big">' + rentFmt(emi) + "</b></div>" +
      '<div class="e-row"><span>Down payment today</span><b>' + inr(price * down / 100) + "</b></div>" +
      '<div class="e-row"><span>Loan amount</span><b>' + inr(loan) + "</b></div>" +
      '<div class="e-row"><span>Total interest over ' + yrs + " years</span><b>" + inr(interest) + "</b></div>" +
      '<p class="e-verdict">Renting this flat costs about <b>' + rentFmt(rent) + "</b> a month. The EMI is " +
      (ratio >= 1.1 ? "<b>" + ratio.toFixed(1) + " times</b> the rent" : ratio <= 0.9 ? "<b>below</b> the rent" : "about the same as the rent") + ", before maintenance and property tax.</p>";
  }

  // ---- pin and compare ----
  var pins = [];
  var pinBtn = $("pin");
  function key(s) { return [s.location, s.sqft, s.bhk, s.resale, s.amenities.slice().sort().join("|")].join("/"); }
  function renderPin() {
    var pinned = pins.some(function (p) { return p.key === key(state); });
    pinBtn.disabled = pinned || pins.length >= 4;
    pinBtn.textContent = pinned ? "Pinned" : pins.length >= 4 ? "Compare list is full" : "Pin to compare";
  }
  pinBtn.addEventListener("click", function () {
    if (!last) return;
    pins.push({
      key: key(state), state: JSON.parse(JSON.stringify(state)),
      price: last.price, rent: last.rent, ppsf: last.price_per_sqft
    });
    renderPin(); renderCompare();
  });
  function renderCompare() {
    $("compare").hidden = !pins.length;
    var cheapest = Math.min.apply(null, pins.map(function (p) { return p.price; }));
    $("compare-body").innerHTML = pins.map(function (p, i) {
      var s = p.state;
      return '<tr class="' + (pins.length > 1 && p.price === cheapest ? "best" : "") + '">' +
        '<td class="flat"><button type="button" data-i="' + i + '">' + esc(title(s.location)) + "</button>" +
        "<small>" + s.bhk + " BHK, " + grp(s.sqft) + " sq ft, " + (s.resale ? "resale" : "new") + ", " + s.amenities.length + " amenities</small></td>" +
        '<td class="p">' + inr(p.price) + "</td><td>" + rentFmt(p.rent) + "</td><td>&#8377;" + grp(p.ppsf) + "</td>" +
        '<td><button type="button" class="rm" data-rm="' + i + '" aria-label="Remove ' + esc(title(s.location)) + '">&times;</button></td></tr>';
    }).join("");
  }
  $("compare-body").addEventListener("click", function (e) {
    var rm = e.target.closest("[data-rm]"), ld = e.target.closest("[data-i]");
    if (rm) { pins.splice(+rm.dataset.rm, 1); renderCompare(); renderPin(); }
    else if (ld) { state = JSON.parse(JSON.stringify(pins[+ld.dataset.i].state)); syncAll(); update(); window.scrollTo({ top: 0, behavior: "smooth" }); }
  });

  // ------------------------------------------------------------------
  // Start
  // ------------------------------------------------------------------
  function syncAll() {
    locInput.value = title(state.location);
    syncLocationHint(); syncQuick(); syncSize(); syncBhk(); syncType(); syncAmenities();
  }

  readUrl();
  buildQuick(); buildBhk(); buildAmenities();
  arrowNav($("bhk")); arrowNav($("type"));
  syncAll();
  renderEmi();
  update();
})();
