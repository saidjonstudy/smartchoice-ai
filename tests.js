"use strict";

/*
  Тесты расчётов SmartChoice AI (раздел 11 концепции).
  Откройте tests.html в браузере — увидите результат каждой проверки.
*/

function runSmartChoiceTests(S) {
  const results = [];
  function check(name, fn) {
    try {
      const r = fn();
      results.push({ name: name, ok: r === true, detail: r === true ? "" : String(r) });
    } catch (e) {
      results.push({ name: name, ok: false, detail: e.message });
    }
  }
  const norm = function (s) { return s.replace(/\s/g, " "); };

  const A = { price: 4000000, energy: 300, maintenance: 100000 };
  const B = { price: 3200000, energy: 520, maintenance: 150000 };

  // --- Формула ---
  check("Пример из концепции: 4 000 000 + 300×1000×5 + 100 000×5 = 6 000 000 сум", function () {
    const t = S.calculateTCO(A, 1000, 5).total;
    return t === 6000000 || "получилось " + t;
  });
  check("Второй пример совпадает с ручным расчётом: 3 200 000 + 520×1000×5 + 150 000×5 = 6 550 000 сум", function () {
    const t = S.calculateTCO(B, 1000, 5).total;
    return t === 6550000 || "получилось " + t;
  });
  check("Одинаковые данные всегда дают одинаковый результат", function () {
    return JSON.stringify(S.calculateTCO(A, 1000, 5)) === JSON.stringify(S.calculateTCO(A, 1000, 5));
  });
  check("Нулевое энергопотребление не создаёт расходов на электричество", function () {
    const t = S.calculateTCO({ price: 1000000, energy: 0, maintenance: 0 }, 1000, 10);
    return (t.energy === 0 && t.total === 1000000) || "электроэнергия: " + t.energy;
  });
  check("Рост тарифа не уменьшает расходы на электроэнергию", function () {
    let prev = -1;
    for (const r of [0, 300, 800, 1000, 2500, 10000]) {
      const e = S.calculateTCO(A, r, 5).energy;
      if (e < prev) return "уменьшилось при тарифе " + r;
      prev = e;
    }
    return true;
  });
  check("Больший срок не уменьшает общую стоимость", function () {
    let prev = -1;
    for (let y = 1; y <= 30; y++) {
      const t = S.calculateTCO(A, 1000, y).total;
      if (t < prev) return "уменьшилось на сроке " + y;
      prev = t;
    }
    return true;
  });
  check("Накопленные расходы: год 0 = цена покупки, последний год = общая стоимость", function () {
    const tco = S.calculateTCO(A, 1000, 5);
    const c = S.cumulativeCosts(tco, 5);
    return (c.length === 6 && c[0] === 4000000 && c[5] === tco.total) || JSON.stringify(c);
  });

  // --- Точка равенства ---
  check("Точка равенства для примера: 800 000 / 270 000 ≈ 2,96 года", function () {
    const t = S.breakEven(S.calculateTCO(A, 1000, 5), S.calculateTCO(B, 1000, 5));
    return Math.abs(t - 800000 / 270000) < 1e-9 || "получилось " + t;
  });
  check("Нет точки равенства, если один товар дешевле и при покупке, и в год", function () {
    const cheap = S.calculateTCO({ price: 1000000, energy: 100, maintenance: 0 }, 1000, 5);
    const dear = S.calculateTCO({ price: 2000000, energy: 200, maintenance: 0 }, 1000, 5);
    return S.breakEven(cheap, dear) === null;
  });

  // --- Режим аналитика (NPV) ---
  check("NPV при росте 0 % и ставке 0 % совпадает с базовой формулой (6 000 000)", function () {
    const t = S.calculateNPV(A, 1000, 5, 0, 0).total;
    return Math.abs(t - 6000000) < 1e-6 || "получилось " + t;
  });
  check("NPV совпадает с ручным расчётом: 1000 + 100/1,1 + 100×1,1/1,1² = 1181,82", function () {
    const t = S.calculateNPV({ price: 1000, energy: 100, maintenance: 0 }, 1, 2, 0.1, 0.1).total;
    return Math.abs(t - (1000 + 100 / 1.1 + 110 / 1.21)) < 1e-9 || "получилось " + t;
  });
  check("Дисконтирование уменьшает будущие расходы в сегодняшних деньгах", function () {
    return S.calculateNPV(A, 1000, 5, 0, 0.15).total < S.calculateNPV(A, 1000, 5, 0, 0).total;
  });
  check("Рост тарифа увеличивает расходы на электроэнергию", function () {
    return S.calculateNPV(A, 1000, 5, 0.1, 0).energy > S.calculateNPV(A, 1000, 5, 0, 0).energy;
  });
  check("Порог тарифа для примера: (800 000 − 250 000) / (220 × 5) = 500 сум", function () {
    const r = S.thresholdTariff(A, B, 5, 0, 0);
    return Math.abs(r - 500) < 1e-9 || "получилось " + r;
  });
  check("При пороговом тарифе NPV двух товаров равны (рост 10 %, ставка 15 %)", function () {
    const r = S.thresholdTariff(A, B, 5, 0.1, 0.15);
    const diff = S.calculateNPV(A, r, 5, 0.1, 0.15).total - S.calculateNPV(B, r, 5, 0.1, 0.15).total;
    return Math.abs(diff) < 1e-6 || "разница " + diff;
  });
  check("Нет порога, если энергопотребление одинаковое", function () {
    return S.thresholdTariff({ price: 1, energy: 100, maintenance: 0 }, { price: 2, energy: 100, maintenance: 0 }, 5, 0, 0) === null;
  });
  check("Окупаемость без дисконта совпадает с точкой равенства (≈ 2,96 года)", function () {
    const t = S.paybackYears(A, B, 1000, 0, 0, 30);
    return Math.abs(t - 800000 / 270000) < 1e-9 || "получилось " + t;
  });
  check("Дисконтирование откладывает окупаемость", function () {
    return S.paybackYears(A, B, 1000, 0, 0.15, 30) > S.paybackYears(A, B, 1000, 0, 0, 30);
  });

  // --- Рассрочка ---
  check("Платёж без процентов: 1 200 / 12 мес. = 100 в месяц", function () { return S.loanPayment(1200, 0, 12) === 100; });
  check("Аннуитет: 1 000 под 12 % годовых на 12 мес. ≈ 88,85 в месяц", function () {
    const p = S.loanPayment(1000, 0.12, 12);
    return Math.abs(p - 88.8487886783) < 1e-6 || "получилось " + p;
  });
  check("Без дисконта рассрочка добавляет переплату: стоимость покупки = платёж × число месяцев", function () {
    const item = { price: 1000, energy: 0, maintenance: 0, credit: { rate: 0.12, months: 12 } };
    const t = S.calculateNPV(item, 1, 1, 0, 0).purchase;
    return Math.abs(t - S.loanPayment(1000, 0.12, 12) * 12) < 1e-9 || "получилось " + t;
  });
  check("Если процент рассрочки равен ставке дисконтирования, рассрочка стоит столько же, сколько цена", function () {
    const pv = S.purchasePV({ price: 1000, credit: { rate: 0.12, months: 12 } }, Math.pow(1.01, 12) - 1);
    return Math.abs(pv - 1000) < 1e-6 || "получилось " + pv;
  });
  check("Беспроцентная рассрочка выгодна при положительной ставке дисконтирования", function () {
    return S.purchasePV({ price: 1000, credit: { rate: 0, months: 12 } }, 0.15) < 1000;
  });
  check("Порог тарифа с рассрочкой: при нём NPV равны", function () {
    const Bc = { price: 3200000, energy: 520, maintenance: 150000, credit: { rate: 0.24, months: 12 } };
    const r = S.thresholdTariff(A, Bc, 5, 0.1, 0.15);
    const diff = S.calculateNPV(A, r, 5, 0.1, 0.15).total - S.calculateNPV(Bc, r, 5, 0.1, 0.15).total;
    return Math.abs(diff) < 1e-6 || "разница " + diff;
  });

  // --- EAC (разный срок службы) ---
  check("Коэффициент возврата капитала: 10 %, 5 лет ≈ 0,26380", function () {
    const c = S.capitalRecovery(0.1, 5);
    return Math.abs(c - 0.2637974808) < 1e-9 || "получилось " + c;
  });
  check("EAC без дисконта = общая стоимость / срок службы (6 000 000 / 5 = 1 200 000)", function () {
    const e = S.calculateEAC(A, 1000, 5, 0, 0);
    return Math.abs(e - 1200000) < 1e-6 || "получилось " + e;
  });
  check("EAC: если вернуть годовые суммы обратно в сегодняшние деньги, получится NPV", function () {
    const e = S.calculateEAC(A, 1000, 8, 0.05, 0.12);
    let pv = 0;
    for (let k = 1; k <= 8; k++) pv += e / Math.pow(1.12, k);
    const npv = S.calculateNPV(A, 1000, 8, 0.05, 0.12).total;
    return Math.abs(pv - npv) < 1e-6 || pv + " ≠ " + npv;
  });

  // --- Чтение чисел ---
  check("«4 000 000» читается как 4000000", function () { return S.parseNumber("4 000 000") === 4000000; });
  check("«1000,5» читается как 1000.5", function () { return S.parseNumber("1000,5") === 1000.5; });
  check("Пустое поле → null", function () { return S.parseNumber("  ") === null; });
  check("Буквы → не число", function () { return Number.isNaN(S.parseNumber("abc")); });

  // --- Проверка ввода ---
  const R = S.RULES;
  check("Пустая цена → понятное сообщение", function () { return S.validateValue("", R.price).error === R.price.empty; });
  check("Отрицательное значение → ошибка", function () { return !!S.validateValue("-5", R.energy).error; });
  check("Цена 0 → ошибка", function () { return !!S.validateValue("0", R.price).error; });
  check("Энергопотребление 0 → допустимо", function () { return S.validateValue("0", R.energy).error === null; });
  check("Энергопотребление 25 000 кВт·ч → подозрительно, ошибка", function () { return !!S.validateValue("25000", R.energy).error; });
  check("Срок 2,5 года → ошибка (нужно целое число)", function () { return !!S.validateValue("2,5", R.years).error; });
  check("Срок 31 год → ошибка", function () { return !!S.validateValue("31", R.years).error; });
  check("Срок 5 лет → допустимо", function () { return S.validateValue("5", R.years).value === 5; });

  // --- Объяснение ---
  check("Объяснение называет более выгодный товар и правильную разницу (550 000 сум)", function () {
    const e = S.buildExplanation(S.calculateTCO(A, 1000, 5), S.calculateTCO(B, 1000, 5), "Товар A", "Товар B", 5);
    const h = norm(e.headline);
    return (h.indexOf("«Товар A» обойдётся примерно на 550 000 сум дешевле") !== -1) || h;
  });
  check("Одинаковые товары → «обойдутся одинаково»", function () {
    const t = S.calculateTCO(A, 1000, 5);
    return S.buildExplanation(t, t, "X", "Y", 5).headline.indexOf("одинаково") !== -1;
  });
  check("Разница меньше 3% → предупреждение, что варианты почти равны", function () {
    const a = S.calculateTCO({ price: 1000000, energy: 0, maintenance: 0 }, 1000, 5);
    const b = S.calculateTCO({ price: 1010000, energy: 0, maintenance: 0 }, 1000, 5);
    const pts = S.buildExplanation(a, b, "X", "Y", 5).points.join(" ");
    return pts.indexOf("меньше 3%") !== -1 || pts;
  });

  // --- Языки ---
  check("Формат чисел: 6 550 000 / 6,550,000 / 2,5 / 2.5", function () {
    const ok = norm(S.formatNumber(6550000, "ru")) === "6 550 000" && norm(S.formatNumber(6550000, "uz")) === "6 550 000" &&
      S.formatNumber(6550000, "en") === "6,550,000" && S.formatNumber(2.5, "ru", 1) === "2,5" && S.formatNumber(2.5, "en", 1) === "2.5";
    return ok || [S.formatNumber(6550000, "uz"), S.formatNumber(6550000, "en")].join(" | ");
  });
  check("Короткая запись для графика: 6 млн / 6 mln / 6M / 2,5 млн", function () {
    const r = [S.formatCompact(6e6, "ru"), S.formatCompact(6e6, "uz"), S.formatCompact(6e6, "en"), S.formatCompact(2.5e6, "ru")].map(norm);
    return (r[0] === "6 млн" && r[1] === "6 mln" && r[2] === "6M" && r[3] === "2,5 млн") || r.join(" | ");
  });
  check("Число не портится при смене языка туда и обратно (1 000 → 1,000 → 1 000)", function () {
    let v = 1000.5;
    for (const pair of [["ru", "en"], ["en", "uz"], ["uz", "ru"]]) v = S.parseNumber(S.formatNumber(v, pair[0], 2), pair[0]);
    return v === 1000.5 || "получилось " + v;
  });
  check("Английский формат: «4,000,000» читается как 4000000", function () { return S.parseNumber("4,000,000", "en") === 4000000; });
  check("Английский формат: «1000.5» читается как 1000.5", function () { return S.parseNumber("1000.5", "en") === 1000.5; });
  check("Узбекский формат: «4 000 000» читается как 4000000", function () { return S.parseNumber("4 000 000", "uz") === 4000000; });
  check("Английское объяснение: «Product A» дешевле на 550,000 UZS", function () {
    const e = S.buildExplanation(S.calculateTCO(A, 1000, 5), S.calculateTCO(B, 1000, 5), "Product A", "Product B", 5, "en");
    const h = norm(e.headline);
    return h.indexOf("over 5 years “Product A” will cost about 550,000 UZS less") !== -1 || h;
  });
  check("Узбекское объяснение: «Mahsulot A» arzonroq на 550 000 soʻm", function () {
    const e = S.buildExplanation(S.calculateTCO(A, 1000, 5), S.calculateTCO(B, 1000, 5), "Mahsulot A", "Mahsulot B", 5, "uz");
    const h = norm(e.headline);
    return h.indexOf("“Mahsulot A” “Mahsulot B” bilan solishtirganda taxminan 550 000 soʻm arzonroq") !== -1 || h;
  });
  check("Во всех языках есть все переводы (одинаковый набор ключей)", function () {
    const I = (typeof window !== "undefined" && window.SC_I18N) || global.SC_I18N;
    const keys = function (o) { return Object.keys(o).sort().join(","); };
    for (const l of ["uz", "en"]) {
      if (keys(I[l]) !== keys(I.ru)) return "не хватает ключей в " + l;
      if (keys(I[l].ex) !== keys(I.ru.ex)) return "не хватает фраз объяснения в " + l;
      if (keys(I[l].anx) !== keys(I.ru.anx)) return "не хватает фраз режима аналитика в " + l;
    }
    return true;
  });
  check("У каждой ошибки проверки есть текст на всех языках", function () {
    const I = (typeof window !== "undefined" && window.SC_I18N) || global.SC_I18N;
    const R2 = S.RULES;
    const errKeys = ["err_nan", "err_nan_years", "err_negative", "err_price_zero"];
    Object.keys(R2).forEach(function (k) { ["empty", "tooBig", "range"].forEach(function (f) { if (R2[k][f]) errKeys.push(R2[k][f]); }); });
    for (const l of ["ru", "uz", "en"]) for (const k of errKeys) if (!I[l][k]) return "нет «" + k + "» в " + l;
    return true;
  });

  return results;
}

// В браузере выводим таблицу результатов
if (typeof document !== "undefined" && document.getElementById("test-body")) {
  const res = runSmartChoiceTests(window.SmartChoice);
  const body = document.getElementById("test-body");
  res.forEach(function (r) {
    const tr = document.createElement("tr");
    const td1 = document.createElement("td");
    td1.textContent = r.name + (r.detail ? " — " + r.detail : "");
    const td2 = document.createElement("td");
    td2.textContent = r.ok ? "Пройден" : "Не пройден";
    td2.className = r.ok ? "pass" : "fail";
    tr.append(td1, td2);
    body.appendChild(tr);
  });
  const passed = res.filter(function (r) { return r.ok; }).length;
  document.getElementById("summary").textContent = "Пройдено " + passed + " из " + res.length;
}

if (typeof module !== "undefined") module.exports = runSmartChoiceTests;
