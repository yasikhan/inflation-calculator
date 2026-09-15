/* Assay — the ounce is the constant; the dollars on either side of it move. */

(function () {
  "use strict";

  var DATA = null;
  var FIRST = 1900;
  var LAST = 2026;

  var els = {
    amount: document.getElementById("amount"),
    fromYear: document.getElementById("from-year"),
    toYear: document.getElementById("to-year"),
    amountScale: document.getElementById("amount-scale"),
    answerScale: document.getElementById("answer-scale"),
    convert: document.getElementById("controls"),
    toYearLabel: document.getElementById("to-year-label"),
    status: document.getElementById("status"),
    asof: document.getElementById("asof")
  };

  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ---------- formatting ---------- */

  var SUFFIX = { 0: "", 3: "K", 6: "M", 9: "B", 12: "T" };

  function fixed(value, decimals) {
    return value.toLocaleString("en-US", {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals
    });
  }

  // A scaled figure is held to four significant digits, so 7.673B and 767.3M
  // carry the same precision however the scale is set.
  function sigDecimals(abs, digits) {
    if (!(abs > 0) || !isFinite(abs)) { return digits - 1; }
    return Math.min(12, Math.max(0, digits - 1 - Math.floor(Math.log10(abs))));
  }

  function scale(value, exp) {
    var scaled = value / Math.pow(10, exp);
    return fixed(scaled, sigDecimals(Math.abs(scaled), 4)) + SUFFIX[exp];
  }

  // Auto only reaches for a suffix once the plain figure stops being readable:
  // millions at a million, billions at a billion. Below that, dollars are dollars.
  function autoExp(value) {
    var abs = Math.abs(value);
    if (!isFinite(abs)) { return 0; }
    return abs >= 1e12 ? 12 : abs >= 1e9 ? 9 : abs >= 1e6 ? 6 : 0;
  }

  function moneyAt(value, exp) {
    if (!exp) {
      var abs = Math.abs(value);
      return "$" + fixed(value, abs >= 100000 ? 0 : (abs >= 0.01 || abs === 0 ? 2 : 4));
    }
    return "$" + scale(value, exp);
  }

  function money(value) {
    return moneyAt(value, 0);
  }

  function weightAt(value, exp) {
    if (exp) { return scale(value, exp); }
    var abs = Math.abs(value);
    return fixed(value, abs >= 1000 ? 1 : abs >= 10 ? 2 : abs >= 1 ? 3 : 4);
  }

  function weight(value) {
    return weightAt(value, 0);
  }

  function round1(value) {
    return value.toLocaleString("en-US", {
      minimumFractionDigits: 1, maximumFractionDigits: 1
    });
  }

  function multiple(value) {
    return value.toLocaleString("en-US", {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1
    }) + "×";
  }

  function yearLabel(year) {
    var record = DATA.years[year];
    return record && record.partial ? year + ", year to date" : String(year);
  }

  /* ---------- writing numbers into the sheet ---------- */

  function paint(el, text, value) {
    // A figure that has not changed is never touched, so the pivot weight sits
    // still while the target year is dragged. That stillness is the argument.
    if (el._target === value && el.textContent === text) { return; }

    var from = el._shown;
    el._target = value;

    function settle() {
      if (el._frame) { cancelAnimationFrame(el._frame); el._frame = null; }
      if (el._timer) { clearTimeout(el._timer); el._timer = null; }
      el.textContent = text;
      el._shown = value;
    }

    if (reduceMotion || typeof value !== "number" || typeof from !== "number" ||
        !isFinite(from) || !isFinite(value) || from === value) {
      settle();
      return;
    }

    if (el._frame) { cancelAnimationFrame(el._frame); }
    if (el._timer) { clearTimeout(el._timer); }

    var format = el._format;
    var start = performance.now();
    var span = 360;

    // The animation is decoration; this timer is the guarantee. If rAF never
    // runs — a background tab, a throttled frame clock — the figure still
    // lands on its correct value.
    el._timer = setTimeout(settle, span + 120);

    el._frame = requestAnimationFrame(function step(now) {
      var t = Math.min(1, (now - start) / span);
      if (t >= 1) { settle(); return; }
      var eased = 1 - Math.pow(1 - t, 3);
      el._shown = from + (value - from) * eased;
      el.textContent = format(el._shown);
      el._frame = requestAnimationFrame(step);
    });
  }

  function setCell(name, text, value, format) {
    var el = els.convert.querySelector('[data-slot="' + name + '"]');
    if (!el) { return; }
    el._format = format;
    paint(el, text, value);
  }

  function setSlot(metal, name, text, value, format) {
    var el = els.convert.querySelector(
      '[data-metal="' + metal + '"] [data-slot="' + name + '"]');
    if (!el) { return; }
    el._format = format;
    paint(el, text, value);
  }

  function blankAll() {
    els.convert.querySelectorAll("[data-slot]")
      .forEach(function (el) {
        if (el._frame) { cancelAnimationFrame(el._frame); el._frame = null; }
        if (el._timer) { clearTimeout(el._timer); el._timer = null; }
        el._target = null;
        el._shown = null;
        el.textContent = "—";
      });
  }

  /* ---------- reading the controls ---------- */

  var TYPED_SUFFIX = { k: 3, m: 6, b: 9, t: 12 };

  // Returns the number as typed, before the scale is applied to it.
  function readAmount() {
    var raw = els.amount.value.replace(/[$,\s]/g, "");

    // A suffix typed into the field sets the dropdown, so 2.5b and 2.5 + B
    // are the same gesture.
    var typed = raw.match(/^([0-9.]+)([kmbtKMBT])$/);
    if (typed) {
      raw = typed[1];
      els.amountScale.value = String(TYPED_SUFFIX[typed[2].toLowerCase()]);
      els.amount.value = raw;
    }

    var value = parseFloat(raw);
    var valid = raw !== "" && isFinite(value) && value >= 0;
    els.amount.setAttribute("aria-invalid", valid ? "false" : "true");
    return valid ? value : null;
  }

  function amountExp() {
    return parseInt(els.amountScale.value, 10) || 0;
  }

  // Auto lets the answers pick their own suffix; anything else is the reader's word.
  function answerExp(largest) {
    var chosen = els.answerScale.value;
    return chosen === "auto" ? autoExp(largest) : (parseInt(chosen, 10) || 0);
  }

  function clampYear(value) {
    var year = parseInt(value, 10);
    if (!isFinite(year)) { return null; }
    return Math.min(LAST, Math.max(FIRST, year));
  }

  /* ---------- the calculation ---------- */

  function priceOf(year, metal) {
    return DATA.years[String(year)][metal].mid;
  }

  function render() {
    var typed = readAmount();
    var from = clampYear(els.fromYear.value);
    var to = clampYear(els.toYear.value);

    if (from === null || to === null) { return; }

    els.toYearLabel.textContent = "dollars";
    var partial = DATA.years[String(to)].partial ? ", year to date" : "";

    if (typed === null) {
      blankAll();
      return;
    }

    var amount = typed * Math.pow(10, amountExp());

    var rows = ["gold", "silver"].map(function (metal) {
      var fromPrice = priceOf(from, metal);
      var toPrice = priceOf(to, metal);
      var ounces = amount / fromPrice;
      return {
        metal: metal,
        fromPrice: fromPrice,
        toPrice: toPrice,
        ounces: ounces,
        equivalent: ounces * toPrice
      };
    });

    var fromCpi = DATA.years[String(from)].cpi;
    var toCpi = DATA.years[String(to)].cpi;
    var ratio = (fromCpi && toCpi) ? toCpi / fromCpi : null;
    var cpiAmount = ratio === null ? null : amount * ratio;

    // All three answers share one scale, so the columns stay comparable at a glance.
    var largest = rows.reduce(function (max, row) {
      return Math.max(max, Math.abs(row.equivalent));
    }, cpiAmount === null ? 0 : Math.abs(cpiAmount));
    var exp = answerExp(largest);
    var dollars = function (v) { return moneyAt(v, exp); };

    rows.forEach(function (row) {
      // An ounce count is not a dollar amount, so it takes its own scale from
      // its own size rather than borrowing the one set for the answers.
      var ozExp = autoExp(row.ounces);
      var ounces = function (v) { return weightAt(v, ozExp); };

      setSlot(row.metal, "ounces", ounces(row.ounces), row.ounces, ounces);
      setSlot(row.metal, "target-amount", dollars(row.equivalent), row.equivalent, dollars);
      setSlot(row.metal, "from-price", money(row.fromPrice) + " an ounce in " + from, row.fromPrice,
        function (v) { return money(v) + " an ounce in " + from; });
      setSlot(row.metal, "to-price", money(row.toPrice) + " an ounce in " + to + partial, row.toPrice,
        function (v) { return money(v) + " an ounce in " + to + partial; });
    });

    renderCpi(from, to, partial, fromCpi, toCpi, ratio, cpiAmount, dollars);
  }

  function renderCpi(from, to, partial, fromCpi, toCpi, ratio, cpiAmount, dollars) {
    // CPI-U does not exist before 1913, and the row says so rather than guessing.
    if (ratio === null) {
      ["cpi-multiple", "cpi-amount"].forEach(function (name) {
        setCell(name, "—", null, null);
      });
      setCell("cpi-from", !fromCpi ? "No CPI-U for " + from : "CPI-U " + round1(fromCpi) + " in " + from, null, null);
      setCell("cpi-to", !toCpi ? "No CPI-U for " + to
        : "CPI-U " + round1(toCpi) + " in " + to + partial, null, null);
      return;
    }

    setCell("cpi-multiple", multiple(ratio), ratio, multiple);
    setCell("cpi-amount", dollars(cpiAmount), cpiAmount, dollars);
    setCell("cpi-from", "CPI-U " + round1(fromCpi) + " in " + from, fromCpi,
      function (v) { return "CPI-U " + round1(v) + " in " + from; });
    setCell("cpi-to", "CPI-U " + round1(toCpi) + " in " + to + partial, toCpi,
      function (v) { return "CPI-U " + round1(v) + " in " + to + partial; });
  }

  /* ---------- wiring ---------- */

  function bindYear(input) {
    input.addEventListener("input", function () {
      if (clampYear(input.value) !== null) { render(); }
    });
    input.addEventListener("blur", function () {
      var year = clampYear(input.value);
      input.value = year === null ? DATA.meta.last_year : year;
      render();
    });
  }

  function start(data) {
    DATA = data;
    FIRST = data.meta.first_year;
    LAST = data.meta.last_year;

    [els.fromYear, els.toYear].forEach(function (input) {
      input.min = FIRST;
      input.max = LAST;
      input.value = clampYear(input.value);
      bindYear(input);
    });

    els.amount.addEventListener("input", render);
    els.amount.addEventListener("blur", function () {
      var typed = readAmount();
      if (typed !== null) { els.amount.value = money(typed).slice(1); }
    });
    [els.amountScale, els.answerScale].forEach(function (select) {
      select.addEventListener("change", render);
    });
    els.amount.addEventListener("focus", function () { els.amount.select(); });
    document.getElementById("controls").addEventListener("submit", function (e) {
      e.preventDefault();
    });

    els.asof.textContent = "Prices through " + data.meta.latest_date +
      " · built " + data.meta.generated;

    render();
  }

  fetch("data/metals.json")
    .then(function (response) {
      if (!response.ok) { throw new Error(response.status); }
      return response.json();
    })
    .then(start)
    .catch(function () {
      els.status.textContent =
        "The price data did not load. Reload the page, or check that data/metals.json is present.";
    });
})();
