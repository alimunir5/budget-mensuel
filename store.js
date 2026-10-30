// Données et calculs du budget. Aucun accès au DOM : ce module est testé sous Node.
// Tous les montants sont stockés en centimes entiers pour éviter les erreurs d'arrondi.

export const APP_ID = 'budget-mensuel';
export const SCHEMA_VERSION = 2;
export const STORAGE_KEY = 'budget-mensuel.v1';
export const OTHER_CATEGORY_ID = 'cat-autre';
export const SAVINGS_CATEGORY_ID = 'cat-epargne';

export const STYLES = ['sobre', 'colore', 'doux'];
export const MODES = ['light', 'dark', 'auto'];

export const DEFAULT_CATEGORIES = [
  { id: 'cat-logement', name: 'Logement', color: '#2a78d6' },
  { id: 'cat-abonnements', name: 'Abonnements', color: '#eb6834' },
  { id: 'cat-transport', name: 'Transport', color: '#1baf7a' },
  { id: 'cat-etudes', name: 'Études', color: '#eda100' },
  { id: 'cat-courses', name: 'Courses', color: '#e87ba4' },
  { id: 'cat-loisirs', name: 'Loisirs', color: '#008300' },
  { id: 'cat-dons', name: 'Dons', color: '#6250d6' },
  { id: 'cat-credit', name: 'Crédit', color: '#e34948' },
  { id: OTHER_CATEGORY_ID, name: 'Autre', color: '#898781' },
  { id: SAVINGS_CATEGORY_ID, name: 'Épargne & investissement', color: '#0f766e', savings: true },
];

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const COLOR_RE = /^#[0-9a-f]{6}$/i;

export function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export function emptyState() {
  return {
    categories: DEFAULT_CATEGORIES.map((c) => ({ ...c })),
    months: {},
    settings: { style: 'sobre', mode: 'auto', lastBackupAt: null },
  };
}

// ---------- Montants ----------

const euroFormat = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' });
const percentFormat = new Intl.NumberFormat('fr-FR', { style: 'percent', minimumFractionDigits: 1, maximumFractionDigits: 1 });

export const formatEuro = (cents) => euroFormat.format(cents / 100);
export const formatPercent = (ratio) => percentFormat.format(ratio);

// Accepte « 1 234,50 », « 1234.5 », « 1.234,50 ». Vide = 0. Invalide = null.
export function parseAmount(value) {
  let s = String(value ?? '').replace(/[\s  €]/g, '');
  if (s === '') return 0;
  const comma = s.lastIndexOf(',');
  const dot = s.lastIndexOf('.');
  const decimalAt = Math.max(comma, dot);
  if (decimalAt !== -1) {
    const separator = s[decimalAt];
    const repeated = s.indexOf(separator) !== decimalAt;
    if (repeated) s = s.replace(/[.,]/g, '');
    else s = s.slice(0, decimalAt).replace(/[.,]/g, '') + '.' + s.slice(decimalAt + 1);
  }
  const match = /^(\d{1,9})(?:\.(\d{1,2}))?$/.exec(s);
  if (!match) return null;
  return Number(match[1]) * 100 + Number((match[2] || '').padEnd(2, '0') || 0);
}

// Valeur affichée dans un champ de saisie : « 1234 », « 12,5 ». Zéro reste vide.
export function amountToInput(cents) {
  if (!cents) return '';
  const euros = Math.floor(cents / 100);
  const rest = cents % 100;
  return rest ? `${euros},${String(rest).padStart(2, '0')}` : String(euros);
}

// ---------- Mois ----------

export const isMonthKey = (key) => MONTH_RE.test(key);

export function monthKeyOf(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

export function shiftMonth(key, delta) {
  const [y, m] = key.split('-').map(Number);
  return monthKeyOf(new Date(y, m - 1 + delta, 1));
}

const monthFormat = new Intl.DateTimeFormat('fr-FR', { month: 'long', year: 'numeric' });
const monthShortFormat = new Intl.DateTimeFormat('fr-FR', { month: 'short' });

const dateOfKey = (key) => {
  const [y, m] = key.split('-').map(Number);
  return new Date(y, m - 1, 1);
};
export const monthLabel = (key) => monthFormat.format(dateOfKey(key));
export const monthShortLabel = (key) => monthShortFormat.format(dateOfKey(key));

export const hasLines = (month) => !!month && (month.incomes.length > 0 || month.expenses.length > 0);

export function monthKeysWithData(state) {
  return Object.keys(state.months).filter((k) => hasLines(state.months[k])).sort();
}

// Le mois à ouvrir au lancement : le mois courant, sauf s'il précède le premier budget saisi.
export function initialMonth(state, nowKey) {
  const keys = monthKeysWithData(state);
  return keys.length && nowKey < keys[0] ? keys[0] : nowKey;
}

export function previousMonthWithData(state, key) {
  return monthKeysWithData(state).filter((k) => k < key).pop() ?? null;
}

export function createEmptyMonth(state, key) {
  state.months[key] = { incomes: [], expenses: [], history: [] };
  return state.months[key];
}

// Copie les revenus et les dépenses fixes du dernier mois renseigné : réel à 0, notes vides.
export function copyFromPrevious(state, key) {
  const sourceKey = previousMonthWithData(state, key);
  if (!sourceKey) return null;
  const source = state.months[sourceKey];
  state.months[key] = {
    incomes: source.incomes.map((i) => ({ ...i, id: uid(), actual: 0 })),
    expenses: source.expenses
      .filter((e) => e.type === 'fixed')
      .map((e) => ({ ...e, id: uid(), actual: 0, note: '' })),
    history: [],
  };
  return state.months[key];
}

// ---------- Calculs ----------

const sum = (items, read) => items.reduce((total, item) => total + read(item), 0);

function savingsIds(categories) {
  return new Set(categories.filter((c) => c.savings).map((c) => c.id));
}

export function monthTotals(month, categories) {
  const savings = savingsIds(categories);
  const isSavings = (e) => savings.has(e.categoryId);
  const expenses = month.expenses.filter((e) => !isSavings(e));
  const saved = month.expenses.filter(isSavings);

  const plannedIncome = sum(month.incomes, (i) => i.planned);
  const actualIncome = sum(month.incomes, (i) => i.actual);
  const plannedExpenses = sum(expenses, (e) => e.planned);
  const actualExpenses = sum(expenses, (e) => e.actual);
  const plannedSavings = sum(saved, (e) => e.planned);
  const actualSavings = sum(saved, (e) => e.actual);

  return {
    plannedIncome,
    actualIncome,
    plannedExpenses,
    actualExpenses,
    plannedSavings,
    actualSavings,
    plannedRemaining: plannedIncome - plannedExpenses - plannedSavings,
    actualRemaining: actualIncome - actualExpenses - actualSavings,
    plannedSavingsRate: plannedIncome > 0 ? plannedSavings / plannedIncome : null,
    actualSavingsRate: actualIncome > 0 ? actualSavings / actualIncome : null,
  };
}

// Dépenser plus que prévu est un dépassement ; épargner plus que prévu n'en est pas un.
export function categoryBreakdown(month, categories) {
  return categories.map((category) => {
    const lines = month.expenses.filter((e) => e.categoryId === category.id);
    const planned = sum(lines, (e) => e.planned);
    const actual = sum(lines, (e) => e.actual);
    return { category, lines, planned, actual, over: !category.savings && actual > planned };
  });
}

export function monthAlerts(month, categories) {
  const alerts = [];
  const { actualRemaining } = monthTotals(month, categories);
  if (actualRemaining < 0) {
    alerts.push({ kind: 'remaining', label: 'Argent restant réel négatif', amount: -actualRemaining });
  }
  for (const group of categoryBreakdown(month, categories)) {
    if (group.category.savings) continue;
    if (group.over) {
      alerts.push({ kind: 'category', label: `Catégorie ${group.category.name}`, amount: group.actual - group.planned });
    }
    for (const line of group.lines) {
      if (line.actual > line.planned) {
        alerts.push({ kind: 'line', id: line.id, label: line.name, amount: line.actual - line.planned });
      }
    }
  }
  return alerts;
}

// Répartition des dépenses (hors épargne) pour le donut. basis : 'actual' ou 'planned'.
export function expensesByCategory(month, categories, basis) {
  const groups = categoryBreakdown(month, categories)
    .filter((g) => !g.category.savings && g[basis] > 0)
    .map((g) => ({ category: g.category, amount: g[basis] }));
  const total = sum(groups, (g) => g.amount);
  return { total, slices: groups.map((g) => ({ ...g, share: g.amount / total })) };
}

export function evolution(state) {
  return monthKeysWithData(state).map((key) => ({ key, ...monthTotals(state.months[key], state.categories) }));
}

function delta(a, b) {
  return { a, b, diff: b - a, pct: a === 0 ? null : (b - a) / Math.abs(a) };
}

// Écart de b par rapport à a, catégorie par catégorie. Un mois sans données compte pour zéro.
export function compareMonths(state, keyA, keyB, basis) {
  const blank = { incomes: [], expenses: [], history: [] };
  const monthA = state.months[keyA] ?? blank;
  const monthB = state.months[keyB] ?? blank;
  const groupsB = categoryBreakdown(monthB, state.categories);
  const rows = categoryBreakdown(monthA, state.categories)
    .map((groupA, i) => ({ category: groupA.category, ...delta(groupA[basis], groupsB[i][basis]) }))
    .filter((row) => row.a !== 0 || row.b !== 0);
  const totalsA = monthTotals(monthA, state.categories);
  const totalsB = monthTotals(monthB, state.categories);
  const field = (name) => (basis === 'actual' ? `actual${name}` : `planned${name}`);
  return {
    rows,
    summary: {
      income: delta(totalsA[field('Income')], totalsB[field('Income')]),
      expenses: delta(totalsA[field('Expenses')], totalsB[field('Expenses')]),
      savings: delta(totalsA[field('Savings')], totalsB[field('Savings')]),
      remaining: delta(totalsA[field('Remaining')], totalsB[field('Remaining')]),
    },
  };
}

// ---------- Modifications ----------

export function moveItem(list, id, direction) {
  const from = list.findIndex((item) => item.id === id);
  const to = from + direction;
  if (from === -1 || to < 0 || to >= list.length) return false;
  [list[from], list[to]] = [list[to], list[from]];
  return true;
}

// Déplace une dépense parmi celles de sa catégorie, sans toucher aux autres lignes.
export function moveExpense(month, id, direction) {
  const line = month.expenses.find((e) => e.id === id);
  if (!line) return false;
  const siblings = month.expenses.filter((e) => e.categoryId === line.categoryId);
  const target = siblings[siblings.indexOf(line) + direction];
  if (!target) return false;
  const from = month.expenses.indexOf(line);
  const to = month.expenses.indexOf(target);
  [month.expenses[from], month.expenses[to]] = [month.expenses[to], month.expenses[from]];
  return true;
}

// Ajout rapide : le montant s'ajoute au réel du poste et l'historique permet de l'annuler.
export function quickAdd(month, { amount, expenseId, newExpense, note = '', now = Date.now() }) {
  if (!Number.isInteger(amount) || amount <= 0) throw new Error('Montant invalide');
  let line;
  if (expenseId) {
    line = month.expenses.find((e) => e.id === expenseId);
    if (!line) throw new Error('Poste introuvable');
  } else {
    line = { id: uid(), name: newExpense.name, categoryId: newExpense.categoryId, planned: 0, actual: 0, note: '', type: 'oneoff' };
    month.expenses.push(line);
  }
  line.actual += amount;
  const entry = { id: uid(), expenseId: line.id, name: line.name, amount, note, at: now, createdExpense: !expenseId };
  month.history.push(entry);
  return entry;
}

export function undoQuickAdd(month, entryId) {
  const index = month.history.findIndex((h) => h.id === entryId);
  if (index === -1) return false;
  const [entry] = month.history.splice(index, 1);
  const line = month.expenses.find((e) => e.id === entry.expenseId);
  if (!line) return true;
  line.actual = Math.max(0, line.actual - entry.amount);
  const stillReferenced = month.history.some((h) => h.expenseId === line.id);
  if (entry.createdExpense && !stillReferenced && line.actual === 0 && line.planned === 0) {
    month.expenses.splice(month.expenses.indexOf(line), 1);
  }
  return true;
}

export function addCategory(state, name, color) {
  const category = { id: `cat-${uid()}`, name, color };
  // Les nouvelles catégories passent avant « Autre » et l'épargne.
  const anchor = state.categories.findIndex((c) => c.id === OTHER_CATEGORY_ID);
  state.categories.splice(anchor === -1 ? state.categories.length : anchor, 0, category);
  return category;
}

export const isProtectedCategory = (category) => category.id === OTHER_CATEGORY_ID || !!category.savings;

// Les lignes d'une catégorie supprimée rejoignent « Autre ».
export function deleteCategory(state, id) {
  const category = state.categories.find((c) => c.id === id);
  if (!category || isProtectedCategory(category)) return false;
  state.categories = state.categories.filter((c) => c.id !== id);
  for (const month of Object.values(state.months)) {
    for (const line of month.expenses) {
      if (line.categoryId === id) line.categoryId = OTHER_CATEGORY_ID;
    }
  }
  return true;
}

// ---------- Export / import ----------

export function serialize(state, now = new Date()) {
  return JSON.stringify({ app: APP_ID, version: SCHEMA_VERSION, exportedAt: now.toISOString(), data: state }, null, 2);
}

const text = (value, max) => (typeof value === 'string' ? value.slice(0, max) : '');
const cents = (value) => (Number.isInteger(value) && value >= 0 ? value : 0);

function uniqueId(value, seen) {
  const id = typeof value === 'string' && value && !seen.has(value) ? value : uid();
  seen.add(id);
  return id;
}

// Reconstruit un état sûr à partir de données externes. Les champs inconnus sont ignorés.
export function normalizeState(raw) {
  if (!raw || typeof raw !== 'object') throw new Error('Données illisibles.');
  if (!Array.isArray(raw.categories) || !raw.months || typeof raw.months !== 'object') {
    throw new Error('Il manque les catégories ou les mois.');
  }

  const categoryIds = new Set();
  const categories = raw.categories
    .filter((c) => c && typeof c.name === 'string' && c.name.trim())
    .map((c) => {
      const category = {
        id: uniqueId(c.id, categoryIds),
        name: text(c.name, 60),
        color: COLOR_RE.test(c.color) ? c.color : '#898781',
      };
      if (c.savings === true) category.savings = true;
      return category;
    });
  // « Autre » et l'épargne sont indispensables aux calculs.
  for (const required of DEFAULT_CATEGORIES.filter(isProtectedCategory)) {
    if (!categoryIds.has(required.id)) {
      categories.push({ ...required });
      categoryIds.add(required.id);
    }
  }

  const months = {};
  for (const [key, month] of Object.entries(raw.months)) {
    if (!isMonthKey(key) || !month || typeof month !== 'object') continue;
    const ids = new Set();
    const incomes = (Array.isArray(month.incomes) ? month.incomes : [])
      .filter((i) => i && typeof i === 'object')
      // Avant la version 2, un revenu n'avait qu'un montant : il sert alors de prévu et de réel.
      .map((i) => ({ id: uniqueId(i.id, ids), name: text(i.name, 80), planned: cents(i.planned ?? i.amount), actual: cents(i.actual ?? i.amount) }));
    const expenses = (Array.isArray(month.expenses) ? month.expenses : [])
      .filter((e) => e && typeof e === 'object')
      .map((e) => ({
        id: uniqueId(e.id, ids),
        name: text(e.name, 80),
        categoryId: categoryIds.has(e.categoryId) ? e.categoryId : OTHER_CATEGORY_ID,
        planned: cents(e.planned),
        actual: cents(e.actual),
        note: text(e.note, 300),
        type: e.type === 'oneoff' ? 'oneoff' : 'fixed',
      }));
    const history = (Array.isArray(month.history) ? month.history : [])
      .filter((h) => h && typeof h === 'object' && cents(h.amount) > 0)
      .map((h) => ({
        id: uniqueId(h.id, ids),
        expenseId: text(h.expenseId, 40),
        name: text(h.name, 80),
        amount: h.amount,
        note: text(h.note, 300),
        at: Number.isFinite(h.at) ? h.at : 0,
        createdExpense: h.createdExpense === true,
      }));
    months[key] = { incomes, expenses, history };
  }

  const settings = raw.settings && typeof raw.settings === 'object' ? raw.settings : {};
  return {
    categories,
    months,
    settings: {
      style: STYLES.includes(settings.style) ? settings.style : 'sobre',
      mode: MODES.includes(settings.mode) ? settings.mode : 'auto',
      lastBackupAt: Number.isFinite(settings.lastBackupAt) ? settings.lastBackupAt : null,
    },
  };
}

export function parseBackup(json) {
  let parsed;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error("Ce fichier n'est pas un JSON valide.");
  }
  if (!parsed || parsed.app !== APP_ID) throw new Error("Ce fichier n'est pas une sauvegarde de cette application.");
  if (parsed.version > SCHEMA_VERSION) throw new Error('Cette sauvegarde vient d\'une version plus récente de l\'application.');
  return normalizeState(parsed.data);
}

// ---------- Persistance ----------

export function createStore(storage) {
  return {
    corrupted: false,
    load() {
      let raw;
      try {
        raw = storage.getItem(STORAGE_KEY);
      } catch {
        return null;
      }
      if (raw === null) return null;
      try {
        return normalizeState(JSON.parse(raw));
      } catch {
        // On garde une copie : une prochaine sauvegarde ne doit pas écraser ces données.
        this.corrupted = true;
        try {
          storage.setItem(`${STORAGE_KEY}.corrupt`, raw);
        } catch {}
        return null;
      }
    },
    save(state) {
      try {
        storage.setItem(STORAGE_KEY, JSON.stringify(state));
        return true;
      } catch {
        return false;
      }
    },
    clear() {
      try {
        storage.removeItem(STORAGE_KEY);
      } catch {}
    },
  };
}
