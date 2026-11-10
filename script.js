"use strict";

/*
  SmartChoice AI — логика калькулятора.

  Часть 1 — расчёты. Это «чистые» функции: получают числа, возвращают числа или текст
  и ничего не трогают на странице. Именно их проверяет файл tests.html.

  Часть 2 — работа со страницей: язык, чтение формы, сообщения об ошибках, вывод результатов.

  Все тексты интерфейса лежат в i18n.js (русский, узбекский, английский).
*/

(function () {

  const I18N = window.SC_I18N;

  // Словарь нужного языка (по умолчанию — русский)
  function dict(lang) { return I18N[lang] || I18N.ru; }

  /* =====================================================================
     Часть 1. Расчёты
     ===================================================================== */

  // Превращает текст из поля в число.
  // Русский и узбекский: "4 000 000" → 4000000, "1000,5" → 1000.5
  // Английский:          "4,000,000" → 4000000, "1000.5" → 1000.5
  // Пустая строка → null, текст с буквами → NaN
  function parseNumber(raw, lang) {
    if (raw === null || raw === undefined) return null;
    let s = String(raw).replace(/[\s\u00A0\u202F]/g, "");
    s = (lang === "en") ? s.replace(/,/g, "") : s.replace(",", ".");
    if (s === "") return null;
    if (!/^-?\d+(\.\d+)?$/.test(s)) return NaN;
    return Number(s);
  }

  // Правила проверки. В полях empty/tooBig — ключи сообщений из i18n.js
  const RULES = {
    price: { empty: "err_price_empty", positive: true, max: 1e11, tooBig: "err_price_big" },
    energy: { empty: "err_energy_empty", max: 20000, tooBig: "err_energy_big" },
    maintenance: { empty: "err_maint_empty", max: 1e10, tooBig: "err_maint_big" },
    tariff: { empty: "err_tariff_empty", max: 100000, tooBig: "err_tariff_big" },
    years: { empty: "err_years_empty", integer: true, min: 1, max: 30, range: "err_years_range" }
  };

  // Проверяет одно значение. Возвращает { value, error }, где error — ключ сообщения или null.
  function validateValue(raw, rule, lang) {
    const value = parseNumber(raw, lang);
    if (value === null) return { value: null, error: rule.empty };
    if (Number.isNaN(value)) return { value: null, error: rule.integer ? "err_nan_years" : "err_nan" };
    if (value < 0) return { value: null, error: "err_negative" };
    if (rule.integer) {
      if (!Number.isInteger(value) || value < rule.min || value > rule.max) return { value: null, error: rule.range };
      return { value: value, error: null };
    }
    if (rule.positive && value === 0) return { value: null, error: "err_price_zero" };
    if (value > rule.max) return { value: null, error: rule.tooBig };
    return { value: value, error: null };
  }

  // Главная формула: TCO = P + (E × R × Y) + (M × Y)
  // item = { price, energy, maintenance }
  function calculateTCO(item, tariff, years) {
    const energyPerYear = item.energy * tariff;           // E × R
    const annual = energyPerYear + item.maintenance;      // расходы за один год
    const energy = energyPerYear * years;                 // E × R × Y
    const maintenance = item.maintenance * years;         // M × Y
    return {
      purchase: item.price,
      energy: energy,
      maintenance: maintenance,
      annual: annual,
      total: item.price + energy + maintenance
    };
  }

  // Накопленные расходы к концу каждого года: [год 0, год 1, ..., год Y]
  function cumulativeCosts(tco, years) {
    const out = [];
    for (let y = 0; y <= years; y++) out.push(tco.purchase + tco.annual * y);
    return out;
  }

  // Точка равенства: через сколько лет общие расходы двух товаров сравниваются.
  // Решаем Pa + Aa·t = Pb + Ab·t  →  t = (Pb − Pa) / (Aa − Ab)
  // Возвращает null, если линии не пересекаются при t > 0.
  function breakEven(a, b) {
    const annualDiff = a.annual - b.annual;
    if (annualDiff === 0) return null;
    const t = (b.purchase - a.purchase) / annualDiff;
    return t > 0 ? t : null;
  }

  /* ---------- Режим аналитика: рост тарифа и дисконтирование ----------
     g — рост тарифа в год (0.1 = 10 %), d — ставка дисконтирования (0.15 = 15 %).
     Расходы года k (k = 1…Y) считаются оплаченными в конце года:
       электроэнергия: E × R × (1 + g)^(k−1),  обслуживание: M
     и приводятся к сегодняшним деньгам делением на (1 + d)^k.
     NPV = P + Σ (E × R × (1 + g)^(k−1) + M) / (1 + d)^k
     При g = 0 и d = 0 это та же формула, что и базовая.                       */

  // F — множитель для электроэнергии, G — для обслуживания
  function pvFactors(years, g, d) {
    let F = 0, G = 0;
    for (let k = 1; k <= years; k++) {
      const disc = Math.pow(1 + d, k);
      F += Math.pow(1 + g, k - 1) / disc;
      G += 1 / disc;
    }
    return { F: F, G: G };
  }

  /* ---------- Муддатли тўлов / рассрочка ----------
     Ежемесячный платёж по аннуитету: PMT = P × i / (1 − (1 + i)^−n), i = r / 12
     r — процент в год (0.24 = 24 %), n — число месяцев. При r = 0 платёж = P / n.     */
  function loanPayment(price, annualRate, months) {
    if (!months || months <= 0) return null;
    const i = annualRate / 12;
    return i === 0 ? price / months : price * i / (1 - Math.pow(1 + i, -months));
  }

  // Ежемесячная ставка, эквивалентная годовой ставке дисконтирования d
  function monthlyDiscount(d) { return Math.pow(1 + d, 1 / 12) - 1; }

  // Стоимость покупки в сегодняшних деньгах.
  // Без рассрочки — цена. С рассрочкой — приведённая стоимость всех ежемесячных платежей.
  function purchasePV(item, d) {
    const c = item.credit;
    if (!c || !c.months) return item.price;
    const pmt = loanPayment(item.price, c.rate, c.months);
    const dm = monthlyDiscount(d);
    return dm === 0 ? pmt * c.months : pmt * (1 - Math.pow(1 + dm, -c.months)) / dm;
  }

  // Платежи по покупке, приведённые к сегодняшнему дню, за каждый год: [год 0, год 1, ...]
  function purchaseByYear(item, d, maxYears) {
    const out = [];
    for (let k = 0; k <= maxYears; k++) out.push(0);
    const c = item.credit;
    if (!c || !c.months) { out[0] = item.price; return out; }
    const pmt = loanPayment(item.price, c.rate, c.months);
    const dm = monthlyDiscount(d);
    for (let m = 1; m <= c.months; m++) {
      const year = Math.ceil(m / 12);
      if (year <= maxYears) out[year] += pmt / Math.pow(1 + dm, m);
    }
    return out;
  }

  // Стоимость владения в сегодняшних деньгах (с учётом рассрочки, если она задана)
  function calculateNPV(item, tariff, years, g, d) {
    const f = pvFactors(years, g, d);
    const purchase = purchasePV(item, d);
    const energy = item.energy * tariff * f.F;
    const maintenance = item.maintenance * f.G;
    return { purchase: purchase, energy: energy, maintenance: maintenance, total: purchase + energy + maintenance };
  }

  // Накопленные расходы в сегодняшних деньгах к концу каждого года: [год 0 … год maxYears]
  function cumulativePV(item, tariff, maxYears, g, d) {
    const buy = purchaseByYear(item, d, maxYears);
    const out = [buy[0]];
    let sum = buy[0];
    for (let k = 1; k <= maxYears; k++) {
      sum += buy[k] + (item.energy * tariff * Math.pow(1 + g, k - 1) + item.maintenance) / Math.pow(1 + d, k);
      out.push(sum);
    }
    return out;
  }

  /* ---------- Разный срок службы: годовая эквивалентная стоимость (EAC) ----------
     EAC = NPV за срок службы L × CRF,  CRF = d / (1 − (1 + d)^−L),  при d = 0 CRF = 1 / L
     Предполагается, что после окончания срока службы товар заменяется таким же.        */
  function capitalRecovery(d, life) {
    return d === 0 ? 1 / life : d / (1 - Math.pow(1 + d, -life));
  }

  function calculateEAC(item, tariff, life, g, d) {
    return calculateNPV(item, tariff, life, g, d).total * capitalRecovery(d, life);
  }

  // Порог тарифа: цена 1 кВт·ч, при которой NPV двух товаров равны.
  // NPVa − NPVb = (Pa − Pb) + (Ea − Eb)·R·F + (Ma − Mb)·G = 0  →  R = −((Pa − Pb) + (Ma − Mb)·G) / ((Ea − Eb)·F)
  // null — если энергопотребление одинаковое или порог не положительный.
  function thresholdTariff(a, b, years, g, d) {
    const dE = a.energy - b.energy;
    if (dE === 0) return null;
    const f = pvFactors(years, g, d);
    const r = -((purchasePV(a, d) - purchasePV(b, d)) + (a.maintenance - b.maintenance) * f.G) / (dE * f.F);
    return r > 0 ? r : null;
  }

  // Дисконтированная окупаемость: через сколько лет накопленные расходы (в сегодняшних деньгах)
  // сравниваются. Между годами — линейная интерполяция. null — если не сравниваются за maxYears лет.
  function paybackYears(a, b, tariff, g, d, maxYears) {
    const n = maxYears || 30;
    const ca = cumulativePV(a, tariff, n, g, d);
    const cb = cumulativePV(b, tariff, n, g, d);
    let k0 = 0;
    while (k0 <= n && Math.abs(ca[k0] - cb[k0]) < 1e-9) k0++;
    if (k0 > n) return null;
    const sign0 = Math.sign(ca[k0] - cb[k0]);
    for (let k = k0 + 1; k <= n; k++) {
      const prev = ca[k - 1] - cb[k - 1];
      const cur = ca[k] - cb[k];
      if (Math.abs(cur) < 1e-9) return k;
      if (Math.sign(cur) !== sign0) return (k - 1) + prev / (prev - cur);
    }
    return null;
  }

  /* ---------- Ссылка «Поделиться» ----------
     Все данные сравнения кладутся в адрес страницы после «#», например:
     index.html#t=1000&y=5&ap=4000000&ae=300&am=100000&bp=3200000...
     Сервер не нужен: ссылку открывает браузер получателя и заполняет форму сам.   */

  const TERMS = [0, 3, 6, 9, 12, 18, 24, 36];   // варианты рассрочки, месяцев

  function encodeShare(st) {
    const p = new URLSearchParams();
    p.set("t", st.tariff);
    p.set("y", st.years);
    ["a", "b"].forEach(function (k) {
      const x = st[k];
      if (x.name) p.set(k + "n", x.name);
      p.set(k + "p", x.price);
      p.set(k + "e", x.energy);
      p.set(k + "m", x.maintenance);
      if (x.term) { p.set(k + "t", x.term); p.set(k + "r", x.rate); }
      if (x.life) p.set(k + "l", x.life);
    });
    if (st.g) p.set("g", st.g);
    if (st.d) p.set("d", st.d);
    if (st.lang) p.set("lang", st.lang);
    return p.toString();
  }

  // Читает данные из ссылки. Возвращает null, если в ссылке нет сравнения.
  // Значения полей остаются строками — их потом проверяет обычная проверка формы.
  // Ползунки и списки ограничиваются допустимыми значениями.
  function decodeShare(str) {
    const p = new URLSearchParams(String(str || "").replace(/^#/, ""));
    if (!p.has("t") || !p.has("ap") || !p.has("bp")) return null;
    const num = function (k) {
      if (!p.has(k)) return null;
      const v = Number(p.get(k));
      return Number.isFinite(v) ? v : null;
    };
    const clamp = function (v, min, max, step) {
      if (v === null) return min;
      return Math.min(max, Math.max(min, Math.round(v / step) * step));
    };
    const product = function (k) {
      const term = num(k + "t");
      return {
        name: (p.get(k + "n") || "").slice(0, 40),
        price: p.get(k + "p") || "",
        energy: p.get(k + "e") || "",
        maintenance: p.get(k + "m") || "",
        term: TERMS.indexOf(term) !== -1 ? term : 0,
        rate: clamp(num(k + "r"), 0, 60, 1),
        life: clamp(num(k + "l"), 0, 30, 1)
      };
    };
    return {
      tariff: p.get("t") || "",
      years: p.get("y") || "",
      a: product("a"),
      b: product("b"),
      g: clamp(num("g"), 0, 30, 0.5),
      d: clamp(num("d"), 0, 30, 0.5),
      lang: p.get("lang")
    };
  }

  // ---------- Форматирование ----------
  // Форматируем числа сами, а не через Intl: в некоторых браузерах (например, на Android)
  // нет данных для узбекского языка, и числа выводились бы в чужом формате.
  function formatNumber(v, lang, digits) {
    const d = dict(lang);
    const factor = Math.pow(10, digits || 0);
    const n = Math.round(Math.abs(v) * factor) / factor;
    const parts = String(n).split(".");
    const intPart = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, d.groupSep);
    return (v < 0 && n !== 0 ? "−" : "") + intPart + (parts[1] ? d.decimalSep + parts[1] : "");
  }

  // Короткая запись для графика: 6 млн, 6 mln, 6M
  function formatCompact(v, lang) {
    const d = dict(lang);
    for (let i = 0; i < d.compact.length; i++) {
      const base = d.compact[i][0];
      if (Math.abs(v) >= base) return formatNumber(v / base, lang, 1) + d.compactSep + d.compact[i][1];
    }
    return formatNumber(v, lang);
  }

  function formatSum(v, lang) {
    return formatNumber(Math.round(v), lang) + "\u00A0" + dict(lang).currency;
  }

  function formatYears(t, lang) {
    const d = dict(lang);
    const rounded = Math.round(t * 10) / 10;
    const text = formatNumber(rounded, lang, 1);
    return text + "\u00A0" + d.yearsWord(rounded);
  }

  // Нейтральное объяснение результата: заголовок + несколько пунктов.
  function buildExplanation(a, b, nameA, nameB, years, lang) {
    const d = dict(lang);
    const ex = d.ex;
    const q = d.quote;
    const sum = function (v) { return formatSum(v, lang); };
    const period = years + "\u00A0" + d.yearsWord(years);
    const diffTotal = Math.round(a.total) - Math.round(b.total);
    const points = [];
    let headline;

    if (diffTotal === 0) {
      headline = ex.headlineEqual(period, sum(a.total));
    } else {
      const cheaper = diffTotal < 0 ? nameA : nameB;
      const other = diffTotal < 0 ? nameB : nameA;
      headline = ex.headlineDiff(period, q(cheaper), sum(Math.abs(diffTotal)), q(other));
    }

    // 1. Какая часть расходов дала самую большую разницу
    const parts = [
      { label: ex.labelPurchase(), d: a.purchase - b.purchase },
      { label: ex.labelEnergy(period), d: a.energy - b.energy },
      { label: ex.labelMaint(period), d: a.maintenance - b.maintenance }
    ];
    const top = parts.reduce(function (m, p) { return Math.abs(p.d) > Math.abs(m.d) ? p : m; });
    if (Math.abs(top.d) >= 0.5) points.push(ex.topFactor(top.label, sum(Math.abs(top.d))));

    // 2. Компромисс «дешевле купить» против «дешевле содержать»
    const dP = a.purchase - b.purchase;
    const dA = a.annual - b.annual;
    const sameP = Math.abs(dP) < 0.5;
    const sameA = Math.abs(dA) < 0.5;

    if (sameP && sameA) {
      points.push(ex.sameBoth());
    } else if (sameP) {
      points.push(ex.samePrice(q(dA < 0 ? nameA : nameB), sum(Math.abs(dA))));
    } else if (sameA) {
      points.push(ex.sameAnnual());
    } else {
      const buyName = dP < 0 ? nameA : nameB;
      const annualName = dA < 0 ? nameA : nameB;
      if (buyName === annualName) {
        points.push(ex.bothCheaper(q(buyName)));
      } else {
        const t = breakEven(a, b);
        let s = ex.tradeoff(q(buyName), sum(Math.abs(dP)), sum(Math.abs(dA)), formatYears(t, lang));
        if (t < years) s += ex.tradeoffAfter(period, q(annualName));
        else if (t > years) s += ex.tradeoffBefore(period, q(buyName), q(annualName));
        points.push(s);
      }
    }

    // 3. Предупреждение, если разница слишком маленькая
    const larger = Math.max(a.total, b.total);
    if (diffTotal !== 0 && Math.abs(diffTotal) / larger < 0.03) points.push(ex.smallDiff());

    return { headline: headline, points: points };
  }

  // Открываем функции для tests.html
  window.SmartChoice = {
    parseNumber: parseNumber,
    RULES: RULES,
    validateValue: validateValue,
    calculateTCO: calculateTCO,
    cumulativeCosts: cumulativeCosts,
    breakEven: breakEven,
    encodeShare: encodeShare,
    decodeShare: decodeShare,
    pvFactors: pvFactors,
    loanPayment: loanPayment,
    purchasePV: purchasePV,
    capitalRecovery: capitalRecovery,
    calculateEAC: calculateEAC,
    calculateNPV: calculateNPV,
    cumulativePV: cumulativePV,
    thresholdTariff: thresholdTariff,
    paybackYears: paybackYears,
    buildExplanation: buildExplanation,
    formatNumber: formatNumber,
    formatCompact: formatCompact,
    formatSum: formatSum,
    formatYears: formatYears
  };


  /* =====================================================================
     Часть 2. Работа со страницей
     ===================================================================== */

  const form = document.getElementById("compare-form");
  if (!form) return; // на странице тестов формы нет — дальше не идём

  const $ = function (id) { return document.getElementById(id); };

  let lang = "ru";               // текущий язык страницы
  function t(key) { return dict(lang)[key]; }

  // Числовые поля в порядке, в котором они стоят на странице
  const FIELDS = [
    { id: "tariff", rule: "tariff" },
    { id: "years", rule: "years" },
    { id: "a-price", rule: "price" },
    { id: "a-energy", rule: "energy" },
    { id: "a-maintenance", rule: "maintenance" },
    { id: "b-price", rule: "price" },
    { id: "b-energy", rule: "energy" },
    { id: "b-maintenance", rule: "maintenance" }
  ];
  const FIELD_IDS = FIELDS.map(function (f) { return f.id; });

  const results = $("results");
  const formError = $("form-error");
  const staleNote = $("stale-note");
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  let lastInvalidCount = 0;

  // Показывает или убирает ошибку поля. errorKey — ключ сообщения из i18n.js
  function setFieldError(id, errorKey) {
    const input = $(id);
    const field = input.closest(".field");
    const err = $(id + "-err");
    if (errorKey) {
      input.dataset.errKey = errorKey;
      err.textContent = t(errorKey);
      err.hidden = false;
      field.classList.add("has-error");
      input.setAttribute("aria-invalid", "true");
    } else {
      delete input.dataset.errKey;
      err.textContent = "";
      err.hidden = true;
      field.classList.remove("has-error");
      input.removeAttribute("aria-invalid");
    }
  }

  // Читает и проверяет все поля
  function readForm(showErrors) {
    const values = {};
    const invalid = [];
    FIELDS.forEach(function (f) {
      const r = validateValue($(f.id).value, RULES[f.rule], lang);
      if (r.error) invalid.push(f.id);
      else values[f.id] = r.value;
      if (showErrors) setFieldError(f.id, r.error);
    });
    return { ok: invalid.length === 0, values: values, invalid: invalid };
  }

  function productName(id, fallbackKey) {
    const v = $(id).value.trim();
    return v ? v.slice(0, 40) : t(fallbackKey);
  }

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  // Полоса «из чего складывается сумма»
  function stackRow(name, tco, maxTotal, animate) {
    const row = el("div", "stack-row");
    const head = el("div", "stack-head");
    head.append(el("span", "stack-name", name), el("span", "stack-value", formatSum(tco.total, lang)));

    const track = el("div", "stack-track");
    const bar = el("div", "stack-bar");
    const target = (tco.total / maxTotal * 100) + "%";
    bar.style.width = animate && !reduceMotion ? "0%" : target;

    [
      ["purchase", "seg-purchase", "bdPurchase"],
      ["energy", "seg-energy", "bdEnergy"],
      ["maintenance", "seg-maint", "bdMaint"]
    ].forEach(function (s) {
      if (tco[s[0]] <= 0) return;
      const seg = el("span", "seg " + s[1]);
      seg.style.flex = "0 0 " + (tco[s[0]] / tco.total * 100) + "%";
      seg.title = t(s[2]) + ": " + formatSum(tco[s[0]], lang);
      bar.appendChild(seg);
    });

    track.appendChild(bar);
    row.append(head, track);

    if (animate && !reduceMotion) {
      requestAnimationFrame(function () {
        requestAnimationFrame(function () { bar.style.width = target; });
      });
    }
    return row;
  }

  // «Красивый» шаг для делений графика: 1, 2, 5, 10, 20, 50...
  function niceStep(x) {
    if (x <= 0) return 1;
    const pow = Math.pow(10, Math.floor(Math.log10(x)));
    const f = x / pow;
    const nice = f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10;
    return nice * pow;
  }

  // Экранирование текста для SVG (на всякий случай)
  function esc(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  // Линейный график накопленных расходов (SVG).
  // width — реальная ширина блока на экране, чтобы на телефоне текст не был мелким
  function buildChart(cumA, cumB, be, width) {
    const W = Math.max(320, Math.min(720, Math.round(width || 640)));
    const H = W < 480 ? 260 : 300, L = W < 480 ? 52 : 70, R = 20, T = 30, B = 44;
    const years = cumA.length - 1;
    const maxRaw = Math.max.apply(null, cumA.concat(cumB));
    const step = niceStep(maxRaw / 4);
    const maxV = Math.ceil(maxRaw / step) * step;
    const x = function (i) { return L + (i / years) * (W - L - R); };
    const y = function (v) { return T + (1 - v / maxV) * (H - T - B); };

    let s = '<svg viewBox="0 0 ' + W + ' ' + H + '" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" font-size="13">';

    // Горизонтальные линии сетки и подписи сумм
    for (let v = 0; v <= maxV + step / 2; v += step) {
      s += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + y(v) + '" y2="' + y(v) + '" style="stroke:var(--line)"/>';
      s += '<text x="' + (L - 10) + '" y="' + (y(v) + 4) + '" text-anchor="end" style="fill:var(--muted)">' +
        (v === 0 ? "0" : esc(formatCompact(v, lang))) + '</text>';
    }

    // Подписи лет
    const every = years <= 10 ? 1 : Math.ceil(years / 10);
    for (let i = 0; i <= years; i += every) {
      s += '<text x="' + x(i) + '" y="' + (H - B + 22) + '" text-anchor="middle" style="fill:var(--muted)">' + i + '</text>';
    }
    s += '<text x="' + (W - R) + '" y="' + (H - 4) + '" text-anchor="end" style="fill:var(--muted)">' + esc(t("axisYears")) + '</text>';

    // Линии товаров
    function line(cum, color, dash) {
      const pts = cum.map(function (v, i) { return x(i) + "," + y(v); }).join(" ");
      let out = '<polyline points="' + pts + '" fill="none" style="stroke:' + color + ';stroke-width:3;stroke-linejoin:round' +
        (dash ? ';stroke-dasharray:7 5' : '') + '"/>';
      if (years <= 15) {
        cum.forEach(function (v, i) {
          out += '<circle cx="' + x(i) + '" cy="' + y(v) + '" r="3.5" style="fill:' + color + '"/>';
        });
      }
      return out;
    }
    s += line(cumA, "var(--a)", false);
    s += line(cumB, "var(--b)", true);

    // Точка, где расходы сравниваются
    if (be !== null && be <= years) {
      const annualA = cumA[1] - cumA[0];
      const cx = x(be), cy = y(cumA[0] + annualA * be);
      const anchor = cx > W - 110 ? "end" : cx < L + 90 ? "start" : "middle";
      s += '<line x1="' + cx + '" x2="' + cx + '" y1="' + cy + '" y2="' + (H - B) + '" style="stroke:var(--muted);stroke-dasharray:3 4"/>';
      s += '<circle cx="' + cx + '" cy="' + cy + '" r="7" style="fill:var(--surface);stroke:var(--ink);stroke-width:2.5"/>';
      s += '<text x="' + cx + '" y="' + (cy - 18) + '" text-anchor="' + anchor + '" font-weight="600" style="fill:var(--ink);stroke:var(--surface);stroke-width:5px;paint-order:stroke">' +
        esc(dict(lang).equalAt(formatYears(be, lang))) + '</text>';
    }

    return s + '</svg>';
  }

  function setText(id, text) { $(id).textContent = text; }

  // Выводит все результаты на страницу
  function render(v, nameA, nameB, animate) {
    const years = v.years;
    const a = calculateTCO({ price: v["a-price"], energy: v["a-energy"], maintenance: v["a-maintenance"] }, v.tariff, years);
    const b = calculateTCO({ price: v["b-price"], energy: v["b-energy"], maintenance: v["b-maintenance"] }, v.tariff, years);
    const expl = buildExplanation(a, b, nameA, nameB, years, lang);

    setText("verdict", expl.headline);

    [["a", a, nameA], ["b", b, nameB]].forEach(function (p) {
      const k = p[0], tco = p[1];
      setText("r-" + k + "-name", p[2]);
      setText("r-" + k + "-total", formatSum(tco.total, lang));
      setText("r-" + k + "-purchase", formatSum(tco.purchase, lang));
      setText("r-" + k + "-energy", formatSum(tco.energy, lang));
      setText("r-" + k + "-maint", formatSum(tco.maintenance, lang));
      setText("r-" + k + "-annual", formatSum(tco.annual, lang));
    });

    const stack = $("stack");
    stack.replaceChildren();
    const maxTotal = Math.max(a.total, b.total);
    stack.append(stackRow(nameA, a, maxTotal, animate), stackRow(nameB, b, maxTotal, animate));

    const cumA = cumulativeCosts(a, years);
    const cumB = cumulativeCosts(b, years);
    setText("legend-a", nameA);
    setText("legend-b", nameB);
    $("chart").innerHTML = buildChart(cumA, cumB, breakEven(a, b), $("chart").clientWidth);

    setText("th-a", nameA);
    setText("th-b", nameB);
    const body = $("year-body");
    body.replaceChildren();
    cumA.forEach(function (va, i) {
      const tr = el("tr");
      tr.append(
        el("td", "", i === 0 ? t("year0") : String(i)),
        el("td", "", formatSum(va, lang)),
        el("td", "", formatSum(cumB[i], lang)),
        el("td", "", formatSum(va - cumB[i], lang))
      );
      body.appendChild(tr);
    });

    const list = $("explain");
    list.replaceChildren();
    expl.points.forEach(function (p) { list.appendChild(el("li", "", p)); });

    renderPrintSummary(v, nameA, nameB);
  }

  // Сводка исходных данных — видна только при печати / в PDF
  function renderPrintSummary(v, nameA, nameB) {
    const d = dict(lang);
    const now = new Date();
    const pad = function (n) { return (n < 10 ? "0" : "") + n; };
    setText("print-date", d.printDate + ": " + pad(now.getDate()) + "." + pad(now.getMonth() + 1) + "." + now.getFullYear() +
      " · " + d.tariffLabel + ": " + formatSum(v.tariff, lang) + " · " + d.yearsLabel + ": " + v.years + "\u00A0" + d.yearsWord(v.years));
    const table = $("print-table");
    table.replaceChildren();
    const head = el("tr");
    head.append(el("th", "", ""), el("th", "", nameA), el("th", "", nameB));
    table.appendChild(head);
    const optText = function (id) { const sel = $(id); return sel.options[sel.selectedIndex] ? sel.options[sel.selectedIndex].text : ""; };
    [
      [d.priceLabel, formatSum(v["a-price"], lang), formatSum(v["b-price"], lang)],
      [d.energyLabel, formatNumber(v["a-energy"], lang, 2) + "\u00A0" + d.unitKwh, formatNumber(v["b-energy"], lang, 2) + "\u00A0" + d.unitKwh],
      [d.maintLabel, formatSum(v["a-maintenance"], lang), formatSum(v["b-maintenance"], lang)],
      [d.an_payMethod, optText("a-term"), optText("b-term")],
      [d.an_life, optText("a-life"), optText("b-life")]
    ].forEach(function (r) {
      const tr = el("tr");
      tr.append(el("td", "", r[0]), el("td", "", r[1]), el("td", "", r[2]));
      table.appendChild(tr);
    });
  }

  /* ---------- Режим аналитика ---------- */

  const analyst = $("analyst");
  let lastData = null;  // последние верные данные формы — чтобы ползунки пересчитывали без проверки формы

  function sliderRate(id) { return Number($(id).value) / 100; }
  function pctText(rate) { return dict(lang).anx.percent(formatNumber(rate * 100, lang, 1)); }

  function updateSliderOutputs() {
    $("growth-out").textContent = pctText(sliderRate("growth"));
    $("discount-out").textContent = pctText(sliderRate("discount"));
    $("growth").setAttribute("aria-valuetext", pctText(sliderRate("growth")));
    $("discount").setAttribute("aria-valuetext", pctText(sliderRate("discount")));
  }

  // Кто выгоднее: 0 — A, 1 — B, null — разница меньше 1 % (почти равны)
  function winnerOf(totA, totB) {
    if (Math.abs(totA - totB) < 0.01 * Math.max(totA, totB)) return null;
    return totA < totB ? 0 : 1;
  }

  function formatTariff(r) {
    return r < 100 ? formatNumber(r, lang, 1) + "\u00A0" + dict(lang).currency : formatSum(r, lang);
  }

  // График: насколько A выгоднее B при разных тарифах (в сегодняшних деньгах)
  function buildSensChart(A, B, years, g, d, current, thr, names, width) {
    const ax = dict(lang).anx;
    const q = dict(lang).quote;
    const W = Math.max(320, Math.min(720, Math.round(width || 640)));
    const H = W < 480 ? 260 : 300, L = W < 480 ? 58 : 76, R = 20, T = 32, B2 = 44;
    const adv = function (rate) { return calculateNPV(B, rate, years, g, d).total - calculateNPV(A, rate, years, g, d).total; };

    const xMaxRaw = Math.max(current * 2, thr ? thr * 1.6 : 0, 1);
    const xStep = niceStep(xMaxRaw / 4);
    const xMax = Math.ceil(xMaxRaw / xStep) * xStep;
    const y0 = adv(0), y1 = adv(xMax);
    let lo = Math.min(y0, y1, 0), hi = Math.max(y0, y1, 0);
    if (hi === lo) { hi += 1; lo -= 1; }
    const yStep = niceStep((hi - lo) / 4);
    lo = Math.floor(lo / yStep) * yStep;
    hi = Math.ceil(hi / yStep) * yStep;
    const x = function (v) { return L + v / xMax * (W - L - R); };
    const y = function (v) { return T + (hi - v) / (hi - lo) * (H - T - B2); };
    const anchorAt = function (px) { return px > W - 110 ? "end" : px < L + 70 ? "start" : "middle"; };
    const halo = ';stroke:var(--hero-bg);stroke-width:5px;paint-order:stroke';

    let s = '<svg viewBox="0 0 ' + W + ' ' + H + '" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" font-size="13">';

    for (let v = lo; v <= hi + yStep / 2; v += yStep) {
      const zero = Math.abs(v) < yStep / 1000;
      s += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + y(v) + '" y2="' + y(v) + '" style="stroke:' +
        (zero ? 'var(--muted);stroke-width:1.5' : 'var(--line)') + '"/>';
      s += '<text x="' + (L - 10) + '" y="' + (y(v) + 4) + '" text-anchor="end" style="fill:var(--muted)">' +
        (zero ? "0" : esc(formatCompact(v, lang))) + '</text>';
    }
    for (let v = 0; v <= xMax + xStep / 2; v += xStep) {
      s += '<text x="' + x(v) + '" y="' + (H - B2 + 22) + '" text-anchor="middle" style="fill:var(--muted)">' + esc(formatNumber(v, lang)) + '</text>';
    }
    s += '<text x="' + (W - R) + '" y="' + (H - 4) + '" text-anchor="end" style="fill:var(--muted)">' + esc(ax.axisTariff(dict(lang).currency)) + '</text>';

    // Подписи областей
    if (hi > 0) s += '<text x="' + (L + 10) + '" y="' + (T + 14) + '" font-weight="600" style="fill:var(--a)' + halo + '">↑ ' + esc(ax.regionBetter(q(names[0]))) + '</text>';
    if (lo < 0) s += '<text x="' + (L + 10) + '" y="' + (H - B2 - 10) + '" font-weight="600" style="fill:var(--b)' + halo + '">↓ ' + esc(ax.regionBetter(q(names[1]))) + '</text>';

    // Ваш тариф
    const cx = x(Math.min(current, xMax));
    s += '<line x1="' + cx + '" x2="' + cx + '" y1="' + T + '" y2="' + (H - B2) + '" style="stroke:var(--muted);stroke-dasharray:3 4"/>';
    s += '<text x="' + cx + '" y="' + (T - 10) + '" text-anchor="' + anchorAt(cx) + '" style="fill:var(--ink)">' + esc(dict(lang).an_markCurrent) + '</text>';

    // Линия выгоды
    s += '<line x1="' + x(0) + '" y1="' + y(y0) + '" x2="' + x(xMax) + '" y2="' + y(y1) + '" style="stroke:#E8B33A;stroke-width:3;stroke-linecap:round"/>';
    s += '<circle cx="' + cx + '" cy="' + y(adv(Math.min(current, xMax))) + '" r="5" style="fill:var(--ink)"/>';

    // Порог
    if (thr && thr <= xMax) {
      const tx = x(thr), ty = y(0);
      const ly = (ty + 24 > H - B2 - 4) ? ty - 14 : ty + 24;
      s += '<circle cx="' + tx + '" cy="' + ty + '" r="7" style="fill:var(--hero-bg);stroke:#E8B33A;stroke-width:2.5"/>';
      s += '<text x="' + tx + '" y="' + ly + '" text-anchor="' + anchorAt(tx) + '" font-weight="600" style="fill:#E8B33A' + halo + '">' +
        esc(dict(lang).an_markThreshold + ": " + formatTariff(thr)) + '</text>';
    }
    return s + '</svg>';
  }

  // Заполняет выпадающие списки на текущем языке, сохраняя выбор
  function populateSelects() {
    const d = dict(lang);
    ["a", "b"].forEach(function (k) {
      const term = $(k + "-term"), life = $(k + "-life");
      const termVal = term.value || "0", lifeVal = life.value || "0";
      term.replaceChildren();
      TERMS.forEach(function (m) {
        const o = el("option", "", m === 0 ? d.an_cash : d.anx.months(m));
        o.value = String(m);
        term.appendChild(o);
      });
      life.replaceChildren();
      const none = el("option", "", d.an_lifeNone);
      none.value = "0";
      life.appendChild(none);
      for (let y = 1; y <= 30; y++) {
        const o = el("option", "", y + "\u00A0" + d.yearsWord(y));
        o.value = String(y);
        life.appendChild(o);
      }
      term.value = termVal;
      life.value = lifeVal;
    });
  }

  // Рассрочка товара из полей режима аналитика (или null — покупка сразу)
  function creditOf(k) {
    const months = Number($(k + "-term").value);
    return months > 0 ? { rate: Number($(k + "-rate").value) / 100, months: months } : null;
  }

  function updateCreditUI() {
    ["a", "b"].forEach(function (k) {
      const c = creditOf(k);
      $(k + "-rate-row").hidden = !c;
      $(k + "-rate-out").textContent = pctText(Number($(k + "-rate").value) / 100);
      $(k + "-rate").setAttribute("aria-valuetext", $(k + "-rate-out").textContent);
      if (c && lastData) {
        const price = lastData.values[k + "-price"];
        const pmt = loanPayment(price, c.rate, c.months);
        $(k + "-credit-info").textContent = dict(lang).anx.creditInfo(formatSum(pmt, lang), formatSum(pmt * c.months - price, lang));
      } else {
        $(k + "-credit-info").textContent = "";
      }
    });
  }

  function renderAnalyst() {
    updateCreditUI();
    if (!lastData) return;
    const v = lastData.values;
    const names = [lastData.nameA, lastData.nameB];
    const d = dict(lang), ax = d.anx, q = d.quote;
    const g = sliderRate("growth"), r = sliderRate("discount");
    const cashA = { price: v["a-price"], energy: v["a-energy"], maintenance: v["a-maintenance"] };
    const cashB = { price: v["b-price"], energy: v["b-energy"], maintenance: v["b-maintenance"] };
    const A = Object.assign({}, cashA, { credit: creditOf("a") });
    const B = Object.assign({}, cashB, { credit: creditOf("b") });
    const hasCredit = !!(A.credit || B.credit);
    const Y = v.years, R = v.tariff;
    const gs = pctText(g), ds = pctText(r);

    setText("an-a-legend", names[0]);
    setText("an-b-legend", names[1]);

    // Вывод: базовая модель против полной (рост тарифа + дисконт + рассрочка)
    const baseA = calculateNPV(cashA, R, Y, 0, 0).total, baseB = calculateNPV(cashB, R, Y, 0, 0).total;
    const npvA = calculateNPV(A, R, Y, g, r).total, npvB = calculateNPV(B, R, Y, g, r).total;
    const wBase = winnerOf(baseA, baseB), wNpv = winnerOf(npvA, npvB);
    const cond = ax.cond(gs, ds, hasCredit);
    let verdict;
    if (g === 0 && r === 0 && !hasCredit) verdict = ax.noChange();
    else if (wNpv === null) verdict = ax.equal(cond);
    else if (wNpv === wBase) verdict = ax.same(cond, q(names[wNpv]), formatSum(Math.abs(npvA - npvB), lang));
    else verdict = ax.changed(cond, q(names[wNpv]), formatSum(Math.abs(npvA - npvB), lang));
    setText("an-verdict", verdict);

    // Порог тарифа
    const thr = thresholdTariff(A, B, Y, g, r);
    if (A.energy === B.energy) {
      setText("an-thr-value", "—");
      setText("an-thr-desc", ax.thresholdNone());
    } else if (thr === null) {
      setText("an-thr-value", "—");
      setText("an-thr-desc", ax.thresholdAlways(q(names[npvA <= npvB ? 0 : 1])));
    } else {
      const saver = A.energy < B.energy ? 0 : 1;
      setText("an-thr-value", ax.thresholdValue(formatTariff(thr)));
      setText("an-thr-desc", ax.thresholdDesc(q(names[saver]), q(names[1 - saver])));
    }

    // Окупаемость
    const buyA = purchasePV(A, r), buyB = purchasePV(B, r);
    const pb = paybackYears(A, B, R, g, r, 30);
    if (Math.abs(buyA - buyB) < 0.5) {
      setText("an-pb-value", "—");
      setText("an-pb-desc", ax.paybackSamePrice());
    } else if (pb !== null) {
      setText("an-pb-value", "≈\u00A0" + formatYears(pb, lang));
      setText("an-pb-desc", ax.paybackDesc());
    } else {
      const cheapBuy = buyA < buyB ? 0 : 1;
      const runA = A.energy * R + A.maintenance, runB = B.energy * R + B.maintenance;
      const cheapRun = runA <= runB ? 0 : 1;
      setText("an-pb-value", "—");
      setText("an-pb-desc", cheapBuy === cheapRun ? ax.paybackNotNeeded(q(names[cheapBuy])) : ax.paybackNever());
    }

    // Сценарии: каждое допущение добавляется по шагам
    setText("an-th-a", names[0]);
    setText("an-th-b", names[1]);
    const body = $("an-scen-body");
    body.replaceChildren();
    const rows = [[ax.scenBase(), cashA, cashB, 0, 0]];
    if (hasCredit) rows.push([ax.scenCredit(), A, B, 0, 0]);
    rows.push([ax.scenGrowth(gs), A, B, g, 0]);
    rows.push([ax.scenNPV(ds), A, B, g, r]);
    rows.forEach(function (row) {
      const ta = calculateNPV(row[1], R, Y, row[3], row[4]).total;
      const tb = calculateNPV(row[2], R, Y, row[3], row[4]).total;
      const w = winnerOf(ta, tb);
      const tr = el("tr");
      const cells = [
        el("td", "scen-name", row[0]),
        el("td", "", formatSum(ta, lang)),
        el("td", "", formatSum(tb, lang)),
        el("td", "", w === null ? d.an_almostEqual : names[w])
      ];
      // подписи для мобильной версии (там таблица превращается в карточки)
      [null, names[0], names[1], d.an_thBetter].forEach(function (label, i) { if (label) cells[i].dataset.label = label; });
      tr.append.apply(tr, cells);
      body.appendChild(tr);
    });

    // Разный срок службы: EAC
    const lifeA = Number($("a-life").value), lifeB = Number($("b-life").value);
    const showEac = lifeA > 0 && lifeB > 0;
    $("eac-hint").hidden = showEac;
    $("eac-result").hidden = !showEac;
    if (showEac) {
      const eacA = calculateEAC(A, R, lifeA, g, r), eacB = calculateEAC(B, R, lifeB, g, r);
      setText("eac-a-name", names[0]);
      setText("eac-b-name", names[1]);
      setText("eac-a-value", ax.eacValue(formatSum(eacA, lang)));
      setText("eac-b-value", ax.eacValue(formatSum(eacB, lang)));
      setText("eac-a-desc", ax.eacDesc(lifeA + "\u00A0" + d.yearsWord(lifeA)));
      setText("eac-b-desc", ax.eacDesc(lifeB + "\u00A0" + d.yearsWord(lifeB)));
      const w = winnerOf(eacA, eacB);
      setText("eac-verdict", w === null ? ax.eacEqual() : ax.eacVerdict(q(names[w]), formatSum(Math.abs(eacA - eacB), lang)));
    }

    $("sens-chart").innerHTML = buildSensChart(A, B, Y, g, r, R, thr, names, $("sens-chart").clientWidth);
  }

  // Проверить форму и, если всё верно, посчитать
  function run(showErrors, animate) {
    const res = readForm(showErrors);
    if (!res.ok) {
      if (showErrors) {
        lastInvalidCount = res.invalid.length;
        formError.textContent = dict(lang).formErrors(lastInvalidCount);
        formError.hidden = false;
        $(res.invalid[0]).focus();
      } else {
        staleNote.hidden = false;
      }
      return false;
    }
    formError.hidden = true;
    staleNote.hidden = true;
    results.hidden = false;
    analyst.hidden = false;
    $("nav-results-item").hidden = false;
    lastData = { values: res.values, nameA: productName("a-name", "productA"), nameB: productName("b-name", "productB") };
    render(lastData.values, lastData.nameA, lastData.nameB, animate);
    renderAnalyst();
    return true;
  }

  function scrollToResults() {
    results.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
    $("verdict").focus({ preventScroll: true });
  }

  /* ---------- Меню ---------- */

  const nav = $("topnav");
  const navLinks = Array.prototype.slice.call(document.querySelectorAll(".nav-links a"));

  // Высота меню нужна, чтобы при переходе к разделу заголовок не прятался под ним
  function updateNavHeight() {
    document.documentElement.style.setProperty("--nav-h", nav.offsetHeight + "px");
  }

  navLinks.forEach(function (a) {
    a.addEventListener("click", function (e) {
      const target = document.querySelector(a.getAttribute("href"));
      if (!target) return;
      e.preventDefault();
      target.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
    });
  });

  // Подсветка текущего раздела в меню
  let navTicking = false;
  function updateActiveNav() {
    navTicking = false;
    const line = nav.offsetHeight + 40;
    let current = null;
    const visible = navLinks.filter(function (a) {
      const sec = document.querySelector(a.getAttribute("href"));
      return sec && !sec.hidden && sec.offsetParent !== null;
    });
    visible.forEach(function (a) {
      if (document.querySelector(a.getAttribute("href")).getBoundingClientRect().top <= line) current = a;
    });
    // В самом низу страницы последний раздел не может подняться наверх — подсвечиваем его
    if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4 && visible.length) {
      current = visible[visible.length - 1];
    }
    navLinks.forEach(function (a) {
      if (a === current) a.setAttribute("aria-current", "true");
      else a.removeAttribute("aria-current");
    });
  }
  window.addEventListener("scroll", function () {
    if (!navTicking) { navTicking = true; requestAnimationFrame(updateActiveNav); }
  }, { passive: true });

  /* ---------- Поделиться и PDF ---------- */

  function collectState() {
    const v = lastData.values;
    const prod = function (k) {
      const c = creditOf(k);
      return {
        name: $(k + "-name").value.trim().slice(0, 40),
        price: v[k + "-price"], energy: v[k + "-energy"], maintenance: v[k + "-maintenance"],
        term: c ? c.months : 0, rate: c ? Number($(k + "-rate").value) : 0,
        life: Number($(k + "-life").value)
      };
    };
    return {
      tariff: v.tariff, years: v.years, a: prod("a"), b: prod("b"),
      g: Number($("growth").value), d: Number($("discount").value), lang: lang
    };
  }

  function shareResult() {
    if (!lastData) return;
    const url = location.href.split("#")[0] + "#" + encodeShare(collectState());
    const status = $("share-status"), field = $("share-url");
    field.hidden = true;
    status.textContent = "";

    function showManual() {
      status.textContent = t("shareManual");
      field.value = url;
      field.hidden = false;
      field.focus();
      field.select();
    }
    function copy() {
      if (!navigator.clipboard) { showManual(); return; }
      navigator.clipboard.writeText(url).then(function () { status.textContent = t("shareCopied"); }, showManual);
    }

    // На телефоне — системное меню «Поделиться» (Telegram и др.), на компьютере — копирование
    if (navigator.share && window.matchMedia("(pointer: coarse)").matches) {
      navigator.share({ title: t("shareText"), url: url }).catch(function (e) {
        if (!e || e.name !== "AbortError") copy();
      });
    } else {
      copy();
    }
  }

  $("share-btn").addEventListener("click", shareResult);
  $("print-btn").addEventListener("click", function () {
    try { window.print(); } catch (e) { /* печать недоступна в этом окне */ }
  });

  // Заполняет форму данными из ссылки и считает
  function applySharedState(st) {
    $("tariff").value = st.tariff;
    $("years").value = st.years;
    ["a", "b"].forEach(function (k) {
      const x = st[k];
      $(k + "-name").value = x.name;
      [["price", "-price"], ["energy", "-energy"], ["maintenance", "-maintenance"]].forEach(function (f) {
        const n = parseNumber(x[f[0]], "en");
        $(k + f[1]).value = (n !== null && !Number.isNaN(n)) ? formatNumber(n, lang, 2) : x[f[0]];
      });
      $(k + "-term").value = String(x.term);
      $(k + "-rate").value = String(x.rate);
      $(k + "-life").value = String(x.life);
    });
    ["tariff", "years"].forEach(function (id) {
      const n = parseNumber($(id).value, "en");
      if (n !== null && !Number.isNaN(n)) $(id).value = formatNumber(n, lang, 2);
    });
    $("growth").value = String(st.g);
    $("discount").value = String(st.d);
    updateSliderOutputs();
    if (run(true, true)) {
      $("shared-note").hidden = false;
      setTimeout(scrollToResults, 50);
    }
  }

  /* ---------- Автор ---------- */

  function renderAuthor() {
    const a = window.SC_AUTHOR || {};
    const name = a.name || "";
    setText("author-name", name);
    setText("author-initials", name.split(/\s+/).filter(Boolean).slice(0, 2).map(function (w) { return w.charAt(0); }).join("").toUpperCase());
    setText("author-version", (a.version || "") + (a.year ? " · " + a.year : ""));
    if (a.github) {
      $("author-github").href = a.github;
      $("author-github-wrap").hidden = false;
    }
    setText("footer-meta", "© " + (a.year || "") + " " + name + (a.version ? " · " + a.version : ""));
  }

  /* ---------- Язык ---------- */

  // Переключает язык: тексты, числа в полях, ошибки и результаты
  function setLang(next, initial) {
    if (!I18N[next]) next = "ru";
    const prev = lang;
    lang = next;
    const d = dict(lang);

    document.documentElement.lang = d.htmlLang;
    document.title = d.title;
    const meta = document.querySelector('meta[name="description"]');
    if (meta) meta.setAttribute("content", d.metaDesc);

    document.querySelectorAll("[data-i18n]").forEach(function (node) {
      node.textContent = d[node.dataset.i18n];
    });
    document.querySelectorAll("[data-i18n-ph]").forEach(function (node) {
      node.setAttribute("placeholder", d[node.dataset.i18nPh]);
    });
    document.querySelectorAll("[data-i18n-aria]").forEach(function (node) {
      node.setAttribute("aria-label", d[node.dataset.i18nAria]);
    });
    document.querySelectorAll(".lang-switch button").forEach(function (btn) {
      btn.setAttribute("aria-pressed", String(btn.dataset.lang === lang));
    });

    if (!initial && prev !== lang) {
      // Числа в полях переписываем в формате нового языка: 4 000 000 ↔ 4,000,000
      FIELD_IDS.forEach(function (id) {
        const input = $(id);
        const v = parseNumber(input.value, prev);
        if (v !== null && !Number.isNaN(v) && v >= 0) input.value = formatNumber(v, lang, 2);
      });
      // Названия из примера тоже переводим
      [["a-name", "exNameA"], ["b-name", "exNameB"]].forEach(function (p) {
        if ($(p[0]).value === dict(prev)[p[1]]) $(p[0]).value = d[p[1]];
      });
      // Показанные ошибки — на новом языке
      FIELD_IDS.forEach(function (id) {
        if ($(id).dataset.errKey) setFieldError(id, $(id).dataset.errKey);
      });
      if (!formError.hidden) formError.textContent = d.formErrors(lastInvalidCount);
      if (!results.hidden) run(false, false);
    }

    updateSliderOutputs();
    populateSelects();
    if ($("share-status").textContent) $("share-status").textContent = "";
    updateNavHeight();
    updateCreditUI();

    try { localStorage.setItem("smartchoice-lang", lang); } catch (e) { /* хранилище недоступно — не страшно */ }
  }

  function detectLang(shared) {
    try {
      const saved = localStorage.getItem("smartchoice-lang");
      if (saved && I18N[saved]) return saved;
    } catch (e) { /* хранилище недоступно */ }
    if (shared && shared.lang && I18N[shared.lang]) return shared.lang;
    const nav = (navigator.language || "ru").toLowerCase();
    if (nav.indexOf("uz") === 0) return "uz";
    if (nav.indexOf("en") === 0) return "en";
    return "ru";
  }

  document.querySelectorAll(".lang-switch button").forEach(function (btn) {
    btn.addEventListener("click", function () { setLang(btn.dataset.lang, false); });
  });

  /* ---------- Кнопки и поля ---------- */

  // При повороте телефона или изменении окна перерисовываем график под новую ширину
  let resizeTimer = null;
  let lastWidth = window.innerWidth;
  window.addEventListener("resize", function () {
    if (results.hidden || window.innerWidth === lastWidth) return;
    lastWidth = window.innerWidth;
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () { run(false, false); }, 150);
  });

  // Поля режима аналитика пересчитывают только его блок
  ["growth", "discount", "a-rate", "b-rate", "a-term", "b-term", "a-life", "b-life"].forEach(function (id) {
    $(id).addEventListener("input", function () {
      updateSliderOutputs();
      renderAnalyst();
    });
  });

  // Кнопка «Рассчитать»
  form.addEventListener("submit", function (e) {
    e.preventDefault();
    const wasHidden = results.hidden;
    if (run(true, wasHidden)) scrollToResults();
  });

  // Когда пользователь меняет данные: убираем ошибку поля и пересчитываем, если результат уже показан
  form.addEventListener("input", function (e) {
    if (FIELD_IDS.indexOf(e.target.id) !== -1) setFieldError(e.target.id, null);
    if (!results.hidden) run(false, false);
  });

  // После выхода из поля красиво расставляем разделители: 4000000 → 4 000 000 (или 4,000,000)
  FIELD_IDS.forEach(function (id) {
    $(id).addEventListener("blur", function () {
      const v = parseNumber(this.value, lang);
      if (v !== null && !Number.isNaN(v) && v >= 0) this.value = formatNumber(v, lang, 2);
    });
  });

  // Учебный пример (из концепции проекта)
  $("fill-example").addEventListener("click", function () {
    const numbers = {
      "tariff": 1000, "years": 5,
      "a-price": 4000000, "a-energy": 300, "a-maintenance": 100000,
      "b-price": 3200000, "b-energy": 520, "b-maintenance": 150000
    };
    Object.keys(numbers).forEach(function (id) { $(id).value = formatNumber(numbers[id], lang); });
    $("a-name").value = t("exNameA");
    $("b-name").value = t("exNameB");
    $("growth").value = "10";      // учебные допущения для режима аналитика
    $("discount").value = "15";
    $("a-term").value = "0";       // A покупают сразу
    $("b-term").value = "12";      // B — в рассрочку на 12 месяцев под 24 % годовых
    $("b-rate").value = "24";
    $("a-life").value = "12";      // A служит 12 лет, B — 9 лет
    $("b-life").value = "9";
    updateSliderOutputs();
    FIELD_IDS.forEach(function (id) { setFieldError(id, null); });
    const wasHidden = results.hidden;
    if (run(true, wasHidden)) scrollToResults();
  });

  // Кнопка «Очистить»
  $("clear-btn").addEventListener("click", function () {
    form.reset();
    FIELD_IDS.forEach(function (id) { setFieldError(id, null); });
    formError.hidden = true;
    results.hidden = true;
    analyst.hidden = true;
    $("nav-results-item").hidden = true;
    $("shared-note").hidden = true;
    $("share-status").textContent = "";
    $("share-url").hidden = true;
    lastData = null;
    $("growth").value = "0";
    $("discount").value = "0";
    ["a", "b"].forEach(function (k) {
      $(k + "-term").value = "0";
      $(k + "-rate").value = "0";
      $(k + "-life").value = "0";
    });
    updateCreditUI();
    updateSliderOutputs();
    $("tariff").focus();
  });

  // Кнопка «Изменить данные»
  $("edit-data").addEventListener("click", function () {
    form.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
    $("a-price").focus({ preventScroll: true });
  });

  const sharedState = decodeShare(location.hash);
  renderAuthor();
  setLang(detectLang(sharedState), true);
  updateNavHeight();
  window.addEventListener("resize", updateNavHeight);
  if (sharedState) applySharedState(sharedState);
  updateActiveNav();

})();
