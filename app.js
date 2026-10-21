/**
 * VIA Mester - Mértékegység & Normálalak
 * Valódi AI integráció (LLM) • Mindig 4 tizedesre kerekítés • Görgetésmentes mobil UI
 */

// SI Prefixes with exponents, symbols and names
const SI_PREFIXES = {
  'T':  { name: 'Tera',  exp: 12, symbol: 'T' },
  'G':  { name: 'Giga',  exp: 9,  symbol: 'G' },
  'M':  { name: 'Mega',  exp: 6,  symbol: 'M' },
  'k':  { name: 'kilo',  exp: 3,  symbol: 'k' },
  '':   { name: 'alap',  exp: 0,  symbol: '' },
  'm':  { name: 'milli', exp: -3, symbol: 'm' },
  'μ':  { name: 'mikro', exp: -6, symbol: 'μ' },
  'u':  { name: 'mikro', exp: -6, symbol: 'μ' },
  'n':  { name: 'nano',  exp: -9, symbol: 'n' },
  'p':  { name: 'piko',  exp: -12, symbol: 'p' },
  'f':  { name: 'femto', exp: -15, symbol: 'f' }
};

// Application State
const state = {
  mode: 'learn', // 'learn' or 'practice'
  currentTask: null,
  answered: false,
  apiKey: (typeof localStorage !== 'undefined' && localStorage.getItem('via_gemini_api_key')) || '',
  chatHistory: [],
  stats: {
    correct: 0,
    total: 0,
    streak: 0
  }
};

// Play audio cue
function playTone(type) {
  try {
    if (typeof window === 'undefined') return;
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    
    if (type === 'success') {
      osc.frequency.setValueAtTime(587.33, ctx.currentTime);
      osc.frequency.setValueAtTime(880, ctx.currentTime + 0.08);
      gain.gain.setValueAtTime(0.12, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
      osc.start();
      osc.stop(ctx.currentTime + 0.3);
    } else if (type === 'warn') {
      osc.frequency.setValueAtTime(440, ctx.currentTime);
      osc.frequency.setValueAtTime(370, ctx.currentTime + 0.1);
      gain.gain.setValueAtTime(0.12, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.25);
      osc.start();
      osc.stop(ctx.currentTime + 0.25);
    } else if (type === 'error') {
      osc.frequency.setValueAtTime(250, ctx.currentTime);
      osc.frequency.setValueAtTime(190, ctx.currentTime + 0.12);
      gain.gain.setValueAtTime(0.15, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);
      osc.start();
      osc.stop(ctx.currentTime + 0.35);
    }
  } catch (e) {}
}

// Format numbers in Hungarian style
function formatNumberHu(num) {
  if (num === null || num === undefined) return '';
  return num.toString().replace('.', ',');
}

// Unicode superscripts converter
function toSuperscript(num) {
  const map = {
    '-': '⁻', '+': '⁺', '0': '⁰', '1': '¹', '2': '²', '3': '³',
    '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹'
  };
  return num.toString().split('').map(char => map[char] || char).join('');
}

function fromSuperscript(str) {
  const map = {
    '⁰': '0', '¹': '1', '²': '2', '³': '3', '⁴': '4',
    '⁵': '5', '⁶': '6', '⁷': '7', '⁸': '8', '⁹': '9',
    '⁻': '-', '⁺': '+'
  };
  return str.split('').map(c => map[c] || c).join('');
}

/**
 * Robust Input Parser
 */
function parseScientificInput(raw) {
  if (!raw) return null;
  let str = raw.trim();
  
  // Remove trailing unit letters
  str = str.replace(/[a-zA-ZΩμöőüűáéíóúÖŐÜŰÁÉÍÓÚ]+$/, '').trim();
  str = fromSuperscript(str);
  str = str.replace(',', '.');
  str = str.replace(/\s+/g, '');

  // 1) e-notation
  const eMatch = str.match(/^([+-]?\d+(?:\.\d+)?)[eE]([+-]?\d+)$/);
  if (eMatch) {
    const coeff = parseFloat(eMatch[1]);
    const exp = parseInt(eMatch[2], 10);
    return { coeff, exp, rawCoeffStr: eMatch[1], totalValue: coeff * Math.pow(10, exp) };
  }

  // 2) Multiplication with 10^exp
  const multMatch = str.match(/^([+-]?\d+(?:\.\d+)?)(?:[·\*xX]|times|szor)?(?:10(?:\^|\*\*)?([+-]?\d+))$/);
  if (multMatch) {
    const coeff = parseFloat(multMatch[1]);
    const exp = parseInt(multMatch[2], 10);
    return { coeff, exp, rawCoeffStr: multMatch[1], totalValue: coeff * Math.pow(10, exp) };
  }

  // 3) Pure power of 10
  const purePowerMatch = str.match(/^(?:10(?:\^|\*\*)?([+-]?\d+))$/);
  if (purePowerMatch) {
    const exp = parseInt(purePowerMatch[1], 10);
    return { coeff: 1, exp, rawCoeffStr: '1', totalValue: Math.pow(10, exp) };
  }

  // 4) Plain number
  const plainMatch = str.match(/^([+-]?\d+(?:\.\d+)?)$/);
  if (plainMatch) {
    const val = parseFloat(plainMatch[1]);
    return { coeff: val, exp: 0, rawCoeffStr: plainMatch[1], totalValue: val };
  }

  return null;
}

/**
 * Normalize into scientific notation: a * 10^k, 1 <= |a| < 10
 */
function toStandardScientific(val) {
  if (val === 0) return { a: 0, k: 0 };
  const sign = val < 0 ? -1 : 1;
  const absVal = Math.abs(val);
  
  let k = Math.floor(Math.log10(absVal));
  let a = absVal / Math.pow(10, k);

  if (a >= 10 - 1e-9) {
    a /= 10;
    k += 1;
  } else if (a < 1 - 1e-9) {
    a *= 10;
    k -= 1;
  }

  return { a: sign * a, k };
}

/**
 * ALWAYS 4 decimal places rounding:
 * e.g. 1.9769 · 10³
 */
function applyRounding4Dec(coeff, exp) {
  const rounded = Math.round(coeff * 10000) / 10000;
  return { coeff: rounded, exp, ruleText: 'mindig 4 tizedesjegyre kerekítve' };
}

/**
 * Generate tough multi-digit numbers with decimals
 */
function generateToughNumber() {
  if (Math.random() < 0.12) {
    const simples = [47.5, 220, 150, 4.7, 33, 10, 8.2];
    return simples[Math.floor(Math.random() * simples.length)];
  }

  const patterns = [
    () => 1111.123,
    () => 1976.942,
    () => {
      const intVal = Math.floor(Math.random() * 8900) + 1100;
      const decVal = Math.floor(Math.random() * 900) + 100;
      return parseFloat(`${intVal}.${decVal}`);
    },
    () => {
      const intVal = Math.floor(Math.random() * 890) + 110;
      return parseFloat(`0.00${intVal}`);
    },
    () => {
      const intVal = Math.floor(Math.random() * 89000) + 10000;
      const decVal = Math.floor(Math.random() * 90) + 10;
      return parseFloat(`${intVal}.${decVal}`);
    }
  ];

  return patterns[Math.floor(Math.random() * patterns.length)]();
}

/**
 * Generate Task
 */
function generateTask() {
  const categoryChoice = (typeof document !== 'undefined' && (document.getElementById('category-select')?.value || document.getElementById('mobile-cat-select')?.value)) || 'all';
  const difficultyChoice = (typeof document !== 'undefined' && (document.getElementById('difficulty-select')?.value || document.getElementById('mobile-diff-select')?.value)) || 'hard';

  let baseUnit = 'F';
  let unitName = 'Farád';
  let availablePrefixes = ['f', 'p', 'n', 'μ', 'm', ''];

  if (categoryChoice === 'elec_cap') {
    baseUnit = 'F'; unitName = 'Farád'; availablePrefixes = ['f', 'p', 'n', 'μ', 'm', ''];
  } else if (categoryChoice === 'elec_res') {
    baseUnit = 'Ω'; unitName = 'Ohm'; availablePrefixes = ['m', '', 'k', 'M', 'G'];
  } else if (categoryChoice === 'elec_volt_curr') {
    const isVolt = Math.random() < 0.5;
    baseUnit = isVolt ? 'V' : 'A';
    unitName = isVolt ? 'Volt' : 'Amper';
    availablePrefixes = isVolt ? ['μ', 'm', '', 'k', 'M'] : ['p', 'n', 'μ', 'm', '', 'k'];
  } else if (categoryChoice === 'time_freq') {
    const isSec = Math.random() < 0.5;
    baseUnit = isSec ? 's' : 'Hz';
    unitName = isSec ? 'másodperc' : 'Hertz';
    availablePrefixes = isSec ? ['f', 'p', 'n', 'μ', 'm', ''] : ['', 'k', 'M', 'G', 'T'];
  } else {
    const allDefs = [
      { baseUnit: 'F', unitName: 'Farád', prefixes: ['f', 'p', 'n', 'μ', 'm', ''] },
      { baseUnit: 'Ω', unitName: 'Ohm', prefixes: ['m', '', 'k', 'M', 'G'] },
      { baseUnit: 'V', unitName: 'Volt', prefixes: ['μ', 'm', '', 'k', 'M'] },
      { baseUnit: 'A', unitName: 'Amper', prefixes: ['p', 'n', 'μ', 'm', '', 'k'] },
      { baseUnit: 'W', unitName: 'Watt', prefixes: ['μ', 'm', '', 'k', 'M', 'G'] },
      { baseUnit: 's', unitName: 'másodperc', prefixes: ['f', 'p', 'n', 'μ', 'm', ''] },
      { baseUnit: 'Hz', unitName: 'Hertz', prefixes: ['', 'k', 'M', 'G', 'T'] }
    ];
    const picked = allDefs[Math.floor(Math.random() * allDefs.length)];
    baseUnit = picked.baseUnit;
    unitName = picked.unitName;
    availablePrefixes = picked.prefixes;
  }

  const isCompound = difficultyChoice === 'expert';

  if (isCompound) {
    return generateCompoundTask(baseUnit, unitName, availablePrefixes);
  }

  // Single conversion
  const startPrefixKey = availablePrefixes[Math.floor(Math.random() * availablePrefixes.length)];
  let targetPrefixKey = startPrefixKey;
  while (targetPrefixKey === startPrefixKey && availablePrefixes.length > 1) {
    targetPrefixKey = availablePrefixes[Math.floor(Math.random() * availablePrefixes.length)];
  }

  const startPrefixInfo = SI_PREFIXES[startPrefixKey];
  const targetPrefixInfo = SI_PREFIXES[targetPrefixKey];
  const startNumber = generateToughNumber();

  const hasStartMultiplier = Math.random() < 0.88;
  const multipliers = [-9, -6, -5, -4, -3, -2, 2, 3, 4, 5, 6, 7, 8, 9];
  const startMultiplierExp = hasStartMultiplier ? multipliers[Math.floor(Math.random() * multipliers.length)] : 0;

  const totalBaseExp = startMultiplierExp + startPrefixInfo.exp;
  const targetPowerShift = totalBaseExp - targetPrefixInfo.exp;
  const rawTargetValue = startNumber * Math.pow(10, targetPowerShift);

  const norm = toStandardScientific(rawTargetValue);
  const roundedResult = applyRounding4Dec(norm.a, norm.k);

  const startUnitSymbol = startPrefixKey + baseUnit;
  const targetUnitSymbol = targetPrefixKey + baseUnit;

  return {
    type: 'single',
    baseUnit,
    unitName,
    startNumber,
    hasStartMultiplier,
    startMultiplierExp,
    startPrefixKey,
    startPrefixInfo,
    startUnitSymbol,
    targetPrefixKey,
    targetPrefixInfo,
    targetUnitSymbol,
    totalBaseExp,
    targetPowerShift,
    rawTargetValue,
    normA: norm.a,
    normK: norm.k,
    roundedA: roundedResult.coeff,
    roundedK: roundedResult.exp,
    ruleText: 'mindig 4 tizedesjegyre kerekítve'
  };
}

/**
 * Compound task: (A) ± (B)
 */
function generateCompoundTask(baseUnit, unitName, availablePrefixes) {
  const p1 = availablePrefixes[Math.floor(Math.random() * availablePrefixes.length)];
  const p2 = availablePrefixes[Math.floor(Math.random() * availablePrefixes.length)];
  let pTarget = availablePrefixes[Math.floor(Math.random() * availablePrefixes.length)];

  const p1Info = SI_PREFIXES[p1];
  const p2Info = SI_PREFIXES[p2];
  const targetInfo = SI_PREFIXES[pTarget];

  const num1 = generateToughNumber();
  const num2 = generateToughNumber();
  const exp1 = (Math.floor(Math.random() * 7) - 3) * 2 || 3;
  const exp2 = (Math.floor(Math.random() * 7) - 3) * 2 || -2;

  const isAddition = Math.random() < 0.7;
  const op = isAddition ? '+' : '-';

  const val1Base = num1 * Math.pow(10, exp1 + p1Info.exp);
  const val2Base = num2 * Math.pow(10, exp2 + p2Info.exp);

  let totalBase = isAddition ? (val1Base + val2Base) : (val1Base - val2Base);
  if (totalBase <= 0) totalBase = Math.abs(totalBase) + 1e-12;

  const rawTargetValue = totalBase / Math.pow(10, targetInfo.exp);
  const norm = toStandardScientific(rawTargetValue);
  const roundedResult = applyRounding4Dec(norm.a, norm.k);

  return {
    type: 'compound',
    baseUnit,
    unitName,
    term1: { num: num1, exp: exp1, prefix: p1, unit: p1 + baseUnit, baseExp: exp1 + p1Info.exp },
    term2: { num: num2, exp: exp2, prefix: p2, unit: p2 + baseUnit, baseExp: exp2 + p2Info.exp },
    op,
    targetPrefixKey: pTarget,
    targetPrefixInfo: targetInfo,
    targetUnitSymbol: pTarget + baseUnit,
    rawTargetValue,
    normA: norm.a,
    normK: norm.k,
    roundedA: roundedResult.coeff,
    roundedK: roundedResult.exp,
    ruleText: 'mindig 4 tizedesjegyre kerekítve'
  };
}

/**
 * Render task
 */
function renderTask(task) {
  state.currentTask = task;
  state.answered = false;

  const inputEl = document.getElementById('answer-input');
  inputEl.value = '';
  inputEl.focus();

  document.getElementById('feedback-panel').style.display = 'none';

  let srcHtml = '';
  if (task.type === 'single') {
    const startNumStr = formatNumberHu(task.startNumber);
    srcHtml = `<span class="num-highlight">${startNumStr}</span>`;
    if (task.hasStartMultiplier && task.startMultiplierExp !== 0) {
      srcHtml += `<span class="op"> · </span>10<sup class="exp">${toSuperscript(task.startMultiplierExp)}</sup>`;
    }
    srcHtml += ` <span class="unit">${task.startUnitSymbol}</span>`;
  } else {
    const n1 = formatNumberHu(task.term1.num);
    const n2 = formatNumberHu(task.term2.num);
    srcHtml = `(${n1}·10<sup class="exp">${toSuperscript(task.term1.exp)}</sup> ${task.term1.unit}) <span class="op">${task.op}</span> (${n2}·10<sup class="exp">${toSuperscript(task.term2.exp)}</sup> ${task.term2.unit})`;
  }

  document.getElementById('eq-source-display').innerHTML = srcHtml;
  document.getElementById('eq-target-unit').textContent = task.targetUnitSymbol;
  document.getElementById('input-unit-tag').textContent = task.targetUnitSymbol;
}

/**
 * Step by step explanation
 */
function buildExplanation(task) {
  const steps = [];

  if (task.type === 'single') {
    const startNumStr = formatNumberHu(task.startNumber);
    const startPrefExp = task.startPrefixInfo.exp;
    const startMultExp = task.startMultiplierExp;

    steps.push(`1. Alapegységben: <code>${startNumStr} · 10${toSuperscript(startMultExp + startPrefExp)} ${task.baseUnit}</code>`);
    steps.push(`2. Cél egységbe (${task.targetUnitSymbol}): kivonjuk a cél kitevőt &rarr; <code>${startNumStr} · 10${toSuperscript(task.targetPowerShift)} ${task.targetUnitSymbol}</code>`);
    steps.push(`3. Normálalakra hozás: <code>${formatNumberHu(Math.round(task.normA * 10000)/10000)} · 10${toSuperscript(task.normK)} ${task.targetUnitSymbol}</code>`);
    steps.push(`4. 4 tizedesjegyre kerekített végeredmény: <strong>${formatNumberHu(task.roundedA.toFixed(4))} · 10${toSuperscript(task.roundedK)} ${task.targetUnitSymbol}</strong>`);
  } else {
    steps.push(`1. Tagok átváltása alapegységbe (${task.baseUnit}) és művelet (${task.op}).`);
    steps.push(`2. Cél prefixumba osztás és normálalak.`);
    steps.push(`3. Végeredmény: <strong>${formatNumberHu(task.roundedA.toFixed(4))} · 10${toSuperscript(task.roundedK)} ${task.targetUnitSymbol}</strong>`);
  }

  return steps;
}

/**
 * Check answer
 */
function checkAnswer() {
  const inputEl = document.getElementById('answer-input');
  const userRaw = inputEl.value;

  if (!userRaw || !userRaw.trim()) {
    showEvalSheet('warning', 'Üres mező', 'Írj be egy számértéket normálalakban 4 tizedesjegyre kerekítve!');
    inputEl.focus();
    return;
  }

  const parsed = parseScientificInput(userRaw);
  if (!parsed) {
    showEvalSheet('error', 'Érvénytelen formátum', 'Használd a <code>· 10^</code> gombot, pl.: <code>1,1111·10⁶</code>');
    playTone('error');
    return;
  }

  const task = state.currentTask;
  const userTotal = parsed.totalValue;
  const expectedTotal = task.rawTargetValue;
  const expectedRoundedTotal = task.roundedA * Math.pow(10, task.roundedK);

  const relDiff = Math.abs(userTotal - expectedTotal) / (Math.abs(expectedTotal) || 1);
  const relDiffRounded = Math.abs(userTotal - expectedRoundedTotal) / (Math.abs(expectedRoundedTotal) || 1);
  const isMatchTotal = relDiff < 0.008 || relDiffRounded < 0.008;

  const isNormalized = Math.abs(parsed.coeff) >= 1 && Math.abs(parsed.coeff) < 10;
  const expStrHu = `${formatNumberHu(task.roundedA.toFixed(4))} · 10${toSuperscript(task.roundedK)}`;

  if (isMatchTotal) {
    if (!isNormalized && (parsed.exp !== 0 || Math.abs(parsed.coeff) >= 10 || Math.abs(parsed.coeff) < 1)) {
      showEvalSheet(
        'warning',
        'Jó számérték, de NEM normálalak!',
        `A számolásod stimmel (${formatNumberHu(userTotal)}), de nem normálalakban írtad be! <strong>1 ≤ |a| &lt; 10</strong> kell legyen.<br>Helyes normálalak: <strong>${expStrHu} ${task.targetUnitSymbol}</strong>`
      );
      playTone('warn');
      revealSteps(task);
      return;
    }

    // Check 4 decimal places precision
    const userCoeffRounded = Math.round(parsed.coeff * 10000) / 10000;
    const expectedCoeff = Math.round(task.roundedA * 10000) / 10000;

    if (Math.abs(userCoeffRounded - expectedCoeff) > 0.0005 && parsed.exp === task.roundedK) {
      showEvalSheet(
        'warning',
        'Kerekítési hiba!',
        `A kitevő jó, de a szorzótényezőt pontosan <strong>4 tizedesjegyre</strong> kell kerekíteni!<br>A te számod: <code>${formatNumberHu(parsed.coeff)}</code><br>Helyes alak: <strong>${expStrHu} ${task.targetUnitSymbol}</strong>`
      );
      playTone('warn');
      revealSteps(task);
      return;
    }

    // Success
    state.stats.correct++;
    state.stats.total++;
    state.stats.streak++;
    updateStatsDisplay();

    showEvalSheet(
      'success',
      'Kiváló válasz! 🎉',
      `Tökéletes! <strong>${formatNumberHu(parsed.coeff)} · 10${toSuperscript(parsed.exp)} ${task.targetUnitSymbol}</strong> a helyes megoldás.`
    );
    playTone('success');
    state.answered = true;

    if (state.mode === 'learn') {
      revealSteps(task);
    }
  } else {
    state.stats.total++;
    state.stats.streak = 0;
    updateStatsDisplay();

    showEvalSheet(
      'error',
      'Helytelen válasz!',
      `Te beírásod: <code>${userRaw}</code><br>Helyes megoldás: <strong>${expStrHu} ${task.targetUnitSymbol}</strong>`
    );
    playTone('error');
    state.answered = true;
    revealSteps(task);
  }
}

function showEvalSheet(type, title, messageHtml) {
  const panel = document.getElementById('feedback-panel');
  panel.style.display = 'flex';
  panel.className = `eval-sheet ${type}`;

  const iconMap = { success: '✓', error: '✕', warning: '⚠️' };
  document.getElementById('feedback-icon').textContent = iconMap[type] || 'ℹ️';
  document.getElementById('feedback-title').textContent = title;
  document.getElementById('feedback-message').innerHTML = messageHtml;
}

function revealSteps(task) {
  const box = document.getElementById('step-by-step-box');
  const list = document.getElementById('steps-list');
  list.innerHTML = '';

  const steps = buildExplanation(task);
  steps.forEach(s => {
    const d = document.createElement('div');
    d.innerHTML = s;
    list.appendChild(d);
  });
  box.style.display = 'block';
}

function updateStatsDisplay() {
  const c = state.stats.correct;
  const t = state.stats.total;
  const s = `🔥 ${state.stats.streak}`;

  const sc1 = document.getElementById('stat-correct');
  if (sc1) sc1.textContent = c;
  const st1 = document.getElementById('stat-total');
  if (st1) st1.textContent = t;
  const ss1 = document.getElementById('stat-streak');
  if (ss1) ss1.textContent = s;

  const msc = document.getElementById('mobile-stat-correct');
  if (msc) msc.textContent = c;
  const mst = document.getElementById('mobile-stat-total');
  if (mst) mst.textContent = t;
  const mss = document.getElementById('mobile-stat-streak');
  if (mss) mss.textContent = s;
}

function resetStats() {
  state.stats.correct = 0;
  state.stats.total = 0;
  state.stats.streak = 0;
  updateStatsDisplay();
}

function insertAtCursor(text) {
  const input = document.getElementById('answer-input');
  input.focus();
  const start = input.selectionStart || 0;
  const end = input.selectionEnd || 0;
  const currentVal = input.value;
  input.value = currentVal.substring(0, start) + text + currentVal.substring(end);
  const newPos = start + text.length;
  input.setSelectionRange(newPos, newPos);
}

function handleBackspace() {
  const input = document.getElementById('answer-input');
  input.focus();
  const start = input.selectionStart;
  const end = input.selectionEnd;
  const currentVal = input.value;
  if (start === end && start > 0) {
    input.value = currentVal.substring(0, start - 1) + currentVal.substring(end);
    input.setSelectionRange(start - 1, start - 1);
  } else if (start !== end) {
    input.value = currentVal.substring(0, start) + currentVal.substring(end);
    input.setSelectionRange(start, start);
  }
}

function setMode(newMode) {
  state.mode = newMode;
  const learnBtn = document.getElementById('mode-learn-btn');
  const practiceBtn = document.getElementById('mode-practice-btn');
  const tableBtn = document.getElementById('open-table-btn');
  const aiBtn = document.getElementById('open-ai-btn');

  if (newMode === 'learn') {
    learnBtn.classList.add('active');
    practiceBtn.classList.remove('active');
    tableBtn.style.display = 'inline-flex';
    aiBtn.style.display = 'inline-flex';
  } else {
    practiceBtn.classList.add('active');
    learnBtn.classList.remove('active');
    tableBtn.style.display = 'none';
    aiBtn.style.display = 'none';
    document.getElementById('prefix-modal').style.display = 'none';
    document.getElementById('ai-modal').style.display = 'none';
  }
}

/* =======================================================
   VALÓDI AI OKTATÓ (Real Cloud LLM - Pollinations / Gemini)
======================================================= */
const AITutor = {
  initChat() {
    state.chatHistory = [];
    const container = document.getElementById('ai-chat-messages');
    container.innerHTML = '';
    const task = state.currentTask;

    let initText = `Szia! A <strong>VIA AI Mentorod</strong> vagyok. Valódi mesterséges intelligenciával válaszolok a kérdéseidre.`;
    if (task) {
      if (task.type === 'single') {
        const mult = (task.hasStartMultiplier && task.startMultiplierExp !== 0) ? ` · 10${toSuperscript(task.startMultiplierExp)}` : '';
        initText += `<br><br>Aktuális feladatod: <code>${formatNumberHu(task.startNumber)}${mult} ${task.startUnitSymbol} = ? ${task.targetUnitSymbol}</code><br>Követelmény: <strong>mindig 4 tizedesjegyre kerekítve</strong> normálalakban!`;
      } else {
        initText += `<br><br>Aktuális feladatod: <strong>összetett 2-tagú művelet</strong> cél egysége: <code>${task.targetUnitSymbol}</code>.`;
      }
    }
    initText += `<br><br>Kérdezz bármit gépelve, vagy válassz az alábbi gyors témákból!`;
    this.addMessage('ai', initText);
  },

  addMessage(sender, htmlContent, customId) {
    const container = document.getElementById('ai-chat-messages');
    if (!container) return;

    const bubble = document.createElement('div');
    bubble.className = `chat-bubble bubble-${sender}`;
    if (customId) bubble.id = customId;
    bubble.innerHTML = htmlContent;
    container.appendChild(bubble);
    container.scrollTop = container.scrollHeight;
  },

  async ask(userQuestion) {
    if (!userQuestion || !userQuestion.trim()) return;
    this.addMessage('user', userQuestion);

    const tempLoadingId = 'ai-loading-' + Date.now();
    this.addMessage('ai', '<em>🤖 A valódi AI gondolkodik a válaszon...</em>', tempLoadingId);

    const task = state.currentTask;
    const taskSummary = task ? `Feladat: ${task.type === 'single' ? task.startNumber + ' ' + task.startUnitSymbol + ' -> ' + task.targetUnitSymbol : '2-tagu muvelet'}. Elvárt: normalalak 1 <= |a| < 10, mindig 4 tizedesjegyre kerekitve. Számított válasz: ${task.roundedA} * 10^${task.roundedK}` : 'Nincs aktiv feladat.';
    const sysPrompt = `Te egy türelmes, barátságos egyetemi villamosságtan oktató vagy a BME VIA tantárgyhoz. Aktuális feladat adatai: ${taskSummary}. Válaszolj magyarul, segítőkészen, világosan, 2-4 tömör bekezdésben! Használj HTML <code> és <strong> tageket a képletekhez.`;

    try {
      let aiResponseText = '';

      // 1. If Gemini API key is provided, use official Gemini API
      if (state.apiKey && state.apiKey.trim().length > 15) {
        aiResponseText = await this.callGeminiAPI(userQuestion, sysPrompt);
      } else {
        // 2. Query real free public LLM (Pollinations AI)
        aiResponseText = await this.callRealLLM(userQuestion, sysPrompt);
      }

      // Format markdown bold and backticks
      aiResponseText = this.formatMarkdown(aiResponseText);

      // Update message
      const loadingEl = document.getElementById(tempLoadingId);
      if (loadingEl) {
        loadingEl.innerHTML = aiResponseText;
      } else {
        this.addMessage('ai', aiResponseText);
      }
    } catch (err) {
      console.warn('Real AI endpoint error, using intelligent offline tutor fallback:', err);
      const fallback = this.generateOfflineFallback(userQuestion);
      const loadingEl = document.getElementById(tempLoadingId);
      if (loadingEl) {
        loadingEl.innerHTML = fallback;
      } else {
        this.addMessage('ai', fallback);
      }
    }
  },

  async callRealLLM(question, systemPrompt) {
    const url = `https://text.pollinations.ai/${encodeURIComponent(question)}?system=${encodeURIComponent(systemPrompt)}&model=openai`;
    const res = await fetch(url, { method: 'GET' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    return text || "Nem érkezett válasz az AI modelltől.";
  },

  async callGeminiAPI(question, systemPrompt) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${encodeURIComponent(state.apiKey.trim())}`;
    const payload = {
      contents: [{ role: 'user', parts: [{ text: `${systemPrompt}\n\nA diák kérdése: ${question}` }] }]
    };
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!res.ok) throw new Error(`Gemini HTTP ${res.status}`);
    const data = await res.json();
    return data.candidates?.[0]?.content?.parts?.[0]?.text || "Nem érkezett válasz.";
  },

  formatMarkdown(txt) {
    if (!txt) return '';
    return txt
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\n\n/g, '<br><br>')
      .replace(/\n/g, '<br>');
  },

  generateOfflineFallback(question) {
    const q = question.toLowerCase();
    const task = state.currentTask;
    if (!task) return "Nincs aktív feladat kiválasztva.";

    if (q.includes('kerekít') || q.includes('4 tizedes')) {
      return `<strong>A 4 tizedesjegyre kerekítés szabálya:</strong><br>A normálalak szorzótényezőjének ($1 \\le |a| < 10$) a tizedesvessző után pontosan <strong>4 számjegyet</strong> kell tartalmaznia. Az 5. jegy alapján kerekítünk lefelé (0-4) vagy felfelé (5-9).`;
    }
    if (q.includes('kitev') || q.includes('hatvány')) {
      return `<strong>Kitevők számolása:</strong><br>Kezdő kitevő = ${task.hasStartMultiplier ? task.startMultiplierExp : 0} + (${task.startPrefixInfo?.exp || 0}) = <code>${task.totalBaseExp}</code>.<br>Cél prefixum levonása: ${task.totalBaseExp} - (${task.targetPrefixInfo?.exp || 0}) = <code>${task.targetPowerShift}</code>.`;
    }
    if (q.includes('megold') || q.includes('levezetés')) {
      return `<strong>Teljes levezetés:</strong><br>` + buildExplanation(task).join('<br>');
    }
    return `A jelenlegi feladatban a cél mértékegység: <code>${task.targetUnitSymbol}</code> normálalakban, mindig 4 tizedesjegyre kerekítve. Számold össze a kiinduló 10-es hatványokat, vond le a cél prefixum kitevőjét, és formázd 1 és 10 közé!`;
  }
};

/**
 * Event setup
 */
function setupEvents() {
  document.getElementById('mode-learn-btn').addEventListener('click', () => setMode('learn'));
  document.getElementById('mode-practice-btn').addEventListener('click', () => setMode('practice'));

  // Modals
  const tableModal = document.getElementById('prefix-modal');
  document.getElementById('open-table-btn').addEventListener('click', () => { tableModal.style.display = 'flex'; });
  document.getElementById('close-modal-btn').addEventListener('click', () => { tableModal.style.display = 'none'; });
  document.getElementById('modal-ok-btn').addEventListener('click', () => {
    tableModal.style.display = 'none';
    document.getElementById('answer-input').focus();
  });
  tableModal.addEventListener('click', (e) => { if (e.target === tableModal) tableModal.style.display = 'none'; });

  const aiModal = document.getElementById('ai-modal');
  document.getElementById('open-ai-btn').addEventListener('click', () => {
    aiModal.style.display = 'flex';
    if (state.chatHistory.length === 0) AITutor.initChat();
    document.getElementById('ai-user-input').focus();
  });
  document.getElementById('close-ai-btn').addEventListener('click', () => { aiModal.style.display = 'none'; });
  aiModal.addEventListener('click', (e) => { if (e.target === aiModal) aiModal.style.display = 'none'; });

  // AI Sending & Chips
  const sendAIMsg = () => {
    const input = document.getElementById('ai-user-input');
    const txt = input.value.trim();
    if (!txt) return;
    input.value = '';
    AITutor.ask(txt);
  };

  document.getElementById('ai-send-btn').addEventListener('click', sendAIMsg);
  document.getElementById('ai-user-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); sendAIMsg(); }
  });

  document.querySelectorAll('.prompt-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      const p = chip.getAttribute('data-prompt');
      if (p) AITutor.ask(p);
    });
  });

  // Settings Modal
  const apiModal = document.getElementById('api-key-modal');
  document.getElementById('ai-settings-btn').addEventListener('click', () => {
    document.getElementById('gemini-api-key-input').value = state.apiKey;
    apiModal.style.display = 'flex';
  });
  document.getElementById('close-api-modal-btn').addEventListener('click', () => { apiModal.style.display = 'none'; });
  document.getElementById('save-api-key-btn').addEventListener('click', () => {
    state.apiKey = document.getElementById('gemini-api-key-input').value.trim();
    if (typeof localStorage !== 'undefined') localStorage.setItem('via_gemini_api_key', state.apiKey);
    apiModal.style.display = 'none';
  });

  // Close Eval sheet
  document.getElementById('close-eval-btn').addEventListener('click', () => {
    document.getElementById('feedback-panel').style.display = 'none';
  });

  // Task actions
  document.getElementById('check-btn').addEventListener('click', checkAnswer);
  document.getElementById('next-btn').addEventListener('click', () => {
    renderTask(generateTask());
    if (aiModal.style.display === 'flex') AITutor.initChat();
  });

  // Select changes & Desktop-Mobile two-way sync
  const diffDesktop = document.getElementById('difficulty-select');
  const diffMobile = document.getElementById('mobile-diff-select');
  if (diffDesktop && diffMobile) {
    diffDesktop.addEventListener('change', () => {
      diffMobile.value = diffDesktop.value;
      renderTask(generateTask());
    });
    diffMobile.addEventListener('change', () => {
      diffDesktop.value = diffMobile.value;
      renderTask(generateTask());
    });
  } else if (diffDesktop) {
    diffDesktop.addEventListener('change', () => { renderTask(generateTask()); });
  }

  const catDesktop = document.getElementById('category-select');
  const catMobile = document.getElementById('mobile-cat-select');
  if (catDesktop && catMobile) {
    catDesktop.addEventListener('change', () => {
      catMobile.value = catDesktop.value;
      renderTask(generateTask());
    });
    catMobile.addEventListener('change', () => {
      catDesktop.value = catMobile.value;
      renderTask(generateTask());
    });
  } else if (catDesktop) {
    catDesktop.addEventListener('change', () => { renderTask(generateTask()); });
  }

  // Stat Reset buttons
  const resetBtn = document.getElementById('reset-stats-btn');
  if (resetBtn) resetBtn.addEventListener('click', resetStats);

  const mobileStats = document.querySelector('.mobile-stats');
  if (mobileStats) {
    mobileStats.addEventListener('click', () => {
      if (confirm('Szeretnéd nullázni a statisztikát?')) {
        resetStats();
      }
    });
  }

  // Virtual Keypad
  document.querySelectorAll('[data-insert]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      insertAtCursor(btn.getAttribute('data-insert'));
    });
  });

  document.getElementById('key-backspace').addEventListener('click', (e) => {
    e.preventDefault();
    handleBackspace();
  });

  document.getElementById('key-clear').addEventListener('click', (e) => {
    e.preventDefault();
    const input = document.getElementById('answer-input');
    input.value = '';
    input.focus();
  });

  // Keyboard navigation
  const inputEl = document.getElementById('answer-input');
  inputEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (!state.answered) {
        checkAnswer();
      } else {
        renderTask(generateTask());
      }
    }
  });

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      tableModal.style.display = 'none';
      aiModal.style.display = 'none';
      apiModal.style.display = 'none';
      document.getElementById('feedback-panel').style.display = 'none';
    }
  });
}

// Initialize on DOM load
if (typeof window !== 'undefined') {
  window.addEventListener('DOMContentLoaded', () => {
    setupEvents();
    setMode('learn');
    renderTask(generateTask());
  });
}

// Module export for Node testing
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    state,
    SI_PREFIXES,
    parseScientificInput,
    toStandardScientific,
    applyRounding4Dec,
    generateToughNumber,
    generateTask,
    buildExplanation,
    AITutor
  };
}
