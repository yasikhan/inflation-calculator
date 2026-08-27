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
    convert: document.getElementById("controls"),
    toYearLabel: document.getElementById("to-year-label"),
    status: document.getElementById("status"),
    asof: document.getElementById("asof")
  };

  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ---------- formatting ---------- */

  function money(value) {
    var abs = Math.abs(value);
    var decimals = abs >= 100000 ? 0 : (abs >= 0.01 || abs === 0 ? 2 : 4);
    return "$" + value.toLocaleString("en-US", {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals
    });
  }

  function weight(value) {
    var abs = Math.abs(value);
    var decimals = abs >= 1000 ? 1 : abs >= 10 ? 2 : abs >= 1 ? 3 : 4;
    return value.toLocaleString("en-US", {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals
    });
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

  function readAmount() {
    var raw = els.amount.value.replace(/[$,\s]/g, "");
    var value = parseFloat(raw);
    var valid = raw !== "" && isFinite(value) && value >= 0;
    els.amount.setAttribute("aria-invalid", valid ? "false" : "true");
    return valid ? value : null;
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
    var amount = readAmount();
    var from = clampYear(els.fromYear.value);
    var to = clampYear(els.toYear.value);

    if (from === null || to === null) { return; }

    els.toYearLabel.textContent = "dollars";
    var partial = DATA.years[String(to)].partial ? ", year to date" : "";

    if (amount === null) {
      blankAll();
      return;
    }

    var answers = {};
    ["gold", "silver"].forEach(function (metal) {
      var fromPrice = priceOf(from, metal);
      var toPrice = priceOf(to, metal);
      var ounces = amount / fromPrice;
      var equivalent = ounces * toPrice;
      answers[metal] = equivalent;

      setSlot(metal, "ounces", weight(ounces), ounces, weight);
      setSlot(metal, "target-amount", money(equivalent), equivalent, money);
      setSlot(metal, "from-price", money(fromPrice) + " an ounce in " + from, fromPrice,
        function (v) { return money(v) + " an ounce in " + from; });
      setSlot(metal, "to-price", money(toPrice) + " an ounce in " + to + partial, toPrice,
        function (v) { return money(v) + " an ounce in " + to + partial; });
    });

    renderCpi(amount, from, to, partial);
  }

  function renderCpi(amount, from, to, partial) {
    var fromCpi = DATA.years[String(from)].cpi;
    var toCpi = DATA.years[String(to)].cpi;
    var first = DATA.meta.cpi_first_year;

    // CPI-U does not exist before 1913, and the row says so rather than guessing.
    if (!fromCpi || !toCpi) {
      ["cpi-multiple", "cpi-amount"].forEach(function (name) {
        setCell(name, "—", null, null);
      });
      setCell("cpi-from", !fromCpi ? "No CPI-U for " + from : "CPI-U " + round1(fromCpi) + " in " + from, null, null);
      setCell("cpi-to", !toCpi ? "No CPI-U for " + to
        : "CPI-U " + round1(toCpi) + " in " + to + partial, null, null);
      return;
    }

    var ratio = toCpi / fromCpi;
    setCell("cpi-multiple", multiple(ratio), ratio, multiple);
    setCell("cpi-amount", money(amount * ratio), amount * ratio, money);
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
      var value = readAmount();
      if (value !== null) { els.amount.value = money(value).slice(1); }
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
