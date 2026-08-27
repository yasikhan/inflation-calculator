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
    fromRuler: document.getElementById("from-ruler"),
    toRuler: document.getElementById("to-ruler"),
    results: document.getElementById("results"),
    ledger: document.getElementById("ledger"),
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

  function setSlot(row, name, text, value, format) {
    var el = row.querySelector('[data-slot="' + name + '"]');
    if (!el) { return; }
    el._format = format;
    paint(el, text, value);
  }

  function blankRow(row) {
    ["source-amount", "target-amount", "ounces", "source-price", "target-price"]
      .forEach(function (name) {
        var el = row.querySelector('[data-slot="' + name + '"]');
        if (el) {
          if (el._frame) { cancelAnimationFrame(el._frame); el._frame = null; }
          if (el._timer) { clearTimeout(el._timer); el._timer = null; }
          el._target = null;
          el._shown = null;
          el.textContent = "—";
        }
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
    var rows = els.results.querySelectorAll(".assay");

    if (from === null || to === null) { return; }

    if (amount === null) {
      Array.prototype.forEach.call(rows, blankRow);
      els.ledger.textContent = "Enter an amount to convert.";
      return;
    }

    Array.prototype.forEach.call(rows, function (row) {
      var metal = row.dataset.metal;
      var fromPrice = priceOf(from, metal);
      var toPrice = priceOf(to, metal);
      var ounces = amount / fromPrice;
      var equivalent = ounces * toPrice;

      setSlot(row, "source-amount", money(amount), amount, money);
      setSlot(row, "ounces", weight(ounces), ounces, weight);
      setSlot(row, "target-amount", money(equivalent), equivalent, money);
      setSlot(row, "source-price", money(fromPrice) + " an ounce", fromPrice,
        function (v) { return money(v) + " an ounce"; });
      setSlot(row, "target-price", money(toPrice) + " an ounce", toPrice,
        function (v) { return money(v) + " an ounce"; });

      row.querySelector('[data-slot="source-year"]').textContent = yearLabel(from);
      row.querySelector('[data-slot="target-year"]').textContent = yearLabel(to);
    });

    renderLedger(amount, from, to);
  }

  function renderLedger(amount, from, to) {
    if (from === to) {
      els.ledger.textContent =
        "Both years are " + from + ", so there is nothing to convert. " +
        "Move one of the years apart to see what the dollar did in between.";
      return;
    }

    var parts = [];
    var fromCpi = DATA.years[String(from)].cpi;
    var toCpi = DATA.years[String(to)].cpi;

    if (fromCpi && toCpi) {
      parts.push("Official CPI puts the same " + money(amount) + " at <b>" +
        money(amount * toCpi / fromCpi) + "</b>.");
    } else {
      var missing = fromCpi ? to : from;
      parts.push("The CPI-U series begins in " + DATA.meta.cpi_first_year +
        ", so there is no official figure for " + missing + ".");
    }

    var early = Math.min(from, to);
    var late = Math.max(from, to);
    var sentence = "From " + early + " to " + late + " the dollar price of gold moved <b>" +
      multiple(priceOf(late, "gold") / priceOf(early, "gold")) + "</b> and silver <b>" +
      multiple(priceOf(late, "silver") / priceOf(early, "silver")) + "</b>";
    if (DATA.years[String(early)].cpi && DATA.years[String(late)].cpi) {
      sentence += ", against <b>" +
        multiple(DATA.years[String(late)].cpi / DATA.years[String(early)].cpi) +
        "</b> for the CPI basket";
    }
    parts.push(sentence + ".");

    els.ledger.innerHTML = parts.join(" ");
  }

  /* ---------- the ruler ---------- */

  function buildRuler(slider) {
    var marks = slider.parentNode.querySelector(".ruler__marks");
    var span = LAST - FIRST;
    var step = span > 90 ? 20 : span > 40 ? 10 : 5;
    var labelEvery = span > 90 ? 2 : 1;
    var years = [];

    for (var year = Math.ceil(FIRST / step) * step; year <= LAST; year += step) {
      years.push(year);
    }
    if (years[0] !== FIRST) { years.unshift(FIRST); }

    marks.innerHTML = "";
    years.forEach(function (year, index) {
      var mark = document.createElement("span");
      // Every mark is a tick; only some carry a label, so the numbers never collide.
      var labelled = index % labelEvery === 0;
      mark.className = labelled ? "mark" : "mark mark--minor";
      mark.style.left = ((year - FIRST) / span * 100) + "%";
      if (labelled) { mark.textContent = year; }
      marks.appendChild(mark);
    });
  }

  /* ---------- wiring ---------- */

  function link(number, slider) {
    number.addEventListener("input", function () {
      var year = clampYear(number.value);
      if (year !== null) { slider.value = year; render(); }
    });
    number.addEventListener("blur", function () {
      var year = clampYear(number.value);
      number.value = year === null ? slider.value : year;
      slider.value = number.value;
      render();
    });
    slider.addEventListener("input", function () {
      number.value = slider.value;
      render();
    });
  }

  function start(data) {
    DATA = data;
    FIRST = data.meta.first_year;
    LAST = data.meta.last_year;

    document.documentElement.style.setProperty("--tick", (100 / (LAST - FIRST)) + "%");

    [[els.fromYear, els.fromRuler], [els.toYear, els.toRuler]].forEach(function (pair) {
      pair.forEach(function (el) {
        el.min = FIRST;
        el.max = LAST;
      });
      pair[1].value = pair[0].value = clampYear(pair[0].value);
      buildRuler(pair[1]);
      link(pair[0], pair[1]);
    });

    els.amount.addEventListener("input", render);
    els.amount.addEventListener("blur", function () {
      var value = readAmount();
      if (value !== null) { els.amount.value = money(value).slice(1); }
    });
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
      els.ledger.textContent =
        "The price data did not load. Reload the page, or check that data/metals.json is present.";
    });
})();
