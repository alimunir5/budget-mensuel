import test from 'node:test';
import assert from 'node:assert/strict';
import {
  amountToInput, categoryBreakdown, compareMonths, copyFromPrevious, createEmptyMonth, createStore, deleteCategory,
  emptyState, evolution, expensesByCategory, formatEuro, hasLines, initialMonth, monthAlerts, monthTotals, moveExpense,
  moveItem, normalizeState, parseAmount, parseBackup, previousMonthWithData, quickAdd, serialize, shiftMonth, undoQuickAdd,
  OTHER_CATEGORY_ID, SAVINGS_CATEGORY_ID, STORAGE_KEY,
} from '../store.js';
import { niceTicks } from '../charts.js';

const expense = (id, categoryId, planned, actual = 0, extra = {}) => ({ id, name: id, categoryId, planned, actual, note: '', type: 'fixed', ...extra });

// Budget fictif, volontairement sans lien avec des données réelles.
function sampleState() {
  const state = emptyState();
  state.months['2030-01'] = {
    incomes: [{ id: 'i1', name: 'Paie', planned: 200000, actual: 200000 }, { id: 'i2', name: 'Prime', planned: 5050, actual: 5050 }],
    expenses: [
      expense('rent', 'cat-logement', 80000, 80000),
      expense('food', 'cat-courses', 30000, 12345, { note: 'à vider' }),
      expense('trip', 'cat-loisirs', 10000, 15000, { type: 'oneoff' }),
      expense('pea', SAVINGS_CATEGORY_ID, 20000, 5000),
    ],
    history: [],
  };
  return state;
}

function memoryStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, v),
    removeItem: (k) => map.delete(k),
    map,
  };
}

const plain = (s) => s.replace(/[  ]/g, ' ');

test('format français des montants', () => {
  assert.equal(plain(formatEuro(123400)), '1 234,00 €');
  assert.equal(plain(formatEuro(-98700)), '-987,00 €');
  assert.equal(plain(formatEuro(5)), '0,05 €');
});

test('saisie des montants', () => {
  assert.equal(parseAmount('1234'), 123400);
  assert.equal(parseAmount('12,5'), 1250);
  assert.equal(parseAmount('12.05'), 1205);
  assert.equal(parseAmount('1 234,50 €'), 123450);
  assert.equal(parseAmount('1 234,50'), 123450);
  assert.equal(parseAmount('1.234,50'), 123450);
  assert.equal(parseAmount('1,234,567'), 123456700);
  assert.equal(parseAmount(''), 0);
  assert.equal(parseAmount('abc'), null);
  assert.equal(parseAmount('-5'), null);
  assert.equal(parseAmount('1,234'), null);
  assert.equal(amountToInput(125050), '1250,50');
  assert.equal(amountToInput(123400), '1234');
  assert.equal(amountToInput(0), '');
  assert.equal(parseAmount(amountToInput(1205)), 1205);
});

test('pas d\'erreur d\'arrondi sur les sommes', () => {
  const state = emptyState();
  const month = createEmptyMonth(state, '2030-01');
  month.incomes.push({ id: 'a', name: 'a', planned: 0, actual: parseAmount('0,10') }, { id: 'b', name: 'b', planned: 0, actual: parseAmount('0,20') });
  assert.equal(monthTotals(month, state.categories).actualIncome, 30);
});

test('totaux, argent restant et taux d\'épargne', () => {
  const state = sampleState();
  const t = monthTotals(state.months['2030-01'], state.categories);
  assert.equal(t.plannedIncome, 205050);
  assert.equal(t.actualIncome, 205050);
  assert.equal(t.plannedExpenses, 120000);
  assert.equal(t.actualExpenses, 107345);
  assert.equal(t.plannedSavings, 20000);
  assert.equal(t.actualSavings, 5000);
  assert.equal(t.plannedRemaining, 65050);
  assert.equal(t.actualRemaining, 92705);
  assert.equal(t.plannedSavingsRate, 20000 / 205050);
  assert.equal(t.actualSavingsRate, 5000 / 205050);
});

test('taux d\'épargne sans revenu', () => {
  const state = emptyState();
  const t = monthTotals(createEmptyMonth(state, '2030-01'), state.categories);
  assert.equal(t.plannedSavingsRate, null);
  assert.equal(t.actualRemaining, 0);
});

test('alertes : poste, catégorie, argent restant', () => {
  const state = sampleState();
  const month = state.months['2030-01'];
  let alerts = monthAlerts(month, state.categories);
  assert.deepEqual(alerts.map((a) => [a.kind, a.amount]), [['category', 5000], ['line', 5000]]);

  month.incomes = [{ id: 'i', name: 'i', planned: 1000, actual: 1000 }];
  alerts = monthAlerts(month, state.categories);
  assert.equal(alerts[0].kind, 'remaining');
  assert.equal(alerts[0].amount, monthTotals(month, state.categories).actualRemaining * -1);
});

test('alertes : atteindre le prévu n\'alerte pas, un poste sans prévu oui, l\'épargne jamais', () => {
  const state = emptyState();
  const month = createEmptyMonth(state, '2030-01');
  month.incomes.push({ id: 'i', name: 'i', planned: 100000, actual: 100000 });
  month.expenses.push(expense('exact', 'cat-logement', 5000, 5000));
  assert.equal(monthAlerts(month, state.categories).length, 0);
  month.expenses.push(expense('extra', 'cat-courses', 0, 1));
  assert.deepEqual(monthAlerts(month, state.categories).map((a) => a.kind), ['category', 'line']);
  month.expenses.pop();
  month.expenses.push(expense('more', SAVINGS_CATEGORY_ID, 1000, 9000));
  assert.equal(monthAlerts(month, state.categories).length, 0);
});

test('création d\'un nouveau mois : copie des revenus et dépenses fixes', () => {
  const state = sampleState();
  const copied = copyFromPrevious(state, '2030-02');
  assert.deepEqual(copied.incomes.map((i) => [i.name, i.planned, i.actual]), [['Paie', 200000, 0], ['Prime', 5050, 0]]);
  assert.deepEqual(copied.expenses.map((e) => e.name), ['rent', 'food', 'pea']);
  assert.ok(copied.expenses.every((e) => e.actual === 0 && e.note === ''));
  assert.deepEqual(copied.expenses.map((e) => e.planned), [80000, 30000, 20000]);
  assert.deepEqual(copied.history, []);
});

test('création d\'un nouveau mois : la source reste intacte et les identifiants changent', () => {
  const state = sampleState();
  const before = JSON.stringify(state.months['2030-01']);
  const copied = copyFromPrevious(state, '2030-02');
  copied.incomes[0].planned = 1;
  copied.expenses[0].planned = 1;
  assert.equal(JSON.stringify(state.months['2030-01']), before);
  assert.notEqual(copied.expenses[0].id, 'rent');
});

test('création d\'un nouveau mois : saute les mois vides et ignore les mois futurs', () => {
  const state = sampleState();
  createEmptyMonth(state, '2030-02');
  assert.equal(previousMonthWithData(state, '2030-03'), '2030-01');
  assert.equal(previousMonthWithData(state, '2030-01'), null);
  assert.equal(copyFromPrevious(state, '2029-12'), null);
  assert.equal(state.months['2029-12'], undefined);
});

test('navigation entre les mois et mois initial', () => {
  assert.equal(shiftMonth('2030-12', 1), '2031-01');
  assert.equal(shiftMonth('2030-01', -1), '2029-12');
  const state = sampleState();
  assert.equal(initialMonth(state, '2029-10'), '2030-01');
  assert.equal(initialMonth(state, '2030-01'), '2030-01');
  assert.equal(initialMonth(state, '2030-05'), '2030-05');
  assert.equal(initialMonth(emptyState(), '2030-05'), '2030-05');
});

test('ajout rapide puis annulation', () => {
  const state = sampleState();
  const month = state.months['2030-01'];
  const entry = quickAdd(month, { amount: 1250, expenseId: 'food', note: 'marché', now: 42 });
  assert.equal(month.expenses.find((e) => e.id === 'food').actual, 13595);
  assert.equal(month.history.length, 1);
  assert.equal(entry.note, 'marché');
  assert.ok(undoQuickAdd(month, entry.id));
  assert.equal(month.expenses.find((e) => e.id === 'food').actual, 12345);
  assert.equal(month.history.length, 0);
  assert.equal(undoQuickAdd(month, entry.id), false);
  assert.throws(() => quickAdd(month, { amount: 0, expenseId: 'food' }));
  assert.throws(() => quickAdd(month, { amount: 100, expenseId: 'inconnu' }));
});

test('ajout rapide sur un nouveau poste : l\'annulation retire le poste créé', () => {
  const state = sampleState();
  const month = state.months['2030-01'];
  const count = month.expenses.length;
  const single = quickAdd(month, { amount: 500, newExpense: { name: 'Seul', categoryId: 'cat-autre' } });
  undoQuickAdd(month, single.id);
  assert.equal(month.expenses.length, count, 'le poste créé disparaît avec son unique ajout');

  const first = quickAdd(month, { amount: 500, newExpense: { name: 'Cadeau', categoryId: 'cat-autre' } });
  const line = month.expenses.at(-1);
  assert.deepEqual([line.name, line.planned, line.actual, line.type], ['Cadeau', 0, 500, 'oneoff']);
  const second = quickAdd(month, { amount: 300, expenseId: line.id });
  undoQuickAdd(month, first.id);
  assert.equal(month.expenses.length, count + 1, 'un autre ajout référence encore le poste');
  undoQuickAdd(month, second.id);
  assert.equal(month.expenses.includes(line), true, 'le poste n\'a plus d\'ajout créateur : il reste');
});

test('annulation : poste supprimé ou réel modifié entre-temps', () => {
  const state = sampleState();
  const month = state.months['2030-01'];
  const entry = quickAdd(month, { amount: 1000, expenseId: 'food' });
  month.expenses.find((e) => e.id === 'food').actual = 200;
  undoQuickAdd(month, entry.id);
  assert.equal(month.expenses.find((e) => e.id === 'food').actual, 0);

  const other = quickAdd(month, { amount: 1000, expenseId: 'rent' });
  month.expenses = month.expenses.filter((e) => e.id !== 'rent');
  assert.equal(undoQuickAdd(month, other.id), true);
  assert.equal(month.history.length, 0);
});

test('donut : par catégorie, sans épargne, parts complètes', () => {
  const state = sampleState();
  const month = state.months['2030-01'];
  const actual = expensesByCategory(month, state.categories, 'actual');
  assert.equal(actual.total, 107345);
  assert.deepEqual(actual.slices.map((s) => s.category.id), ['cat-logement', 'cat-loisirs', 'cat-courses']);
  assert.ok(Math.abs(actual.slices.reduce((t, s) => t + s.share, 0) - 1) < 1e-9);
  const planned = expensesByCategory(month, state.categories, 'planned');
  assert.equal(planned.total, 120000);
  assert.deepEqual(planned.slices.map((s) => s.category.id), ['cat-logement', 'cat-courses', 'cat-loisirs']);

  month.expenses.find((e) => e.id === 'trip').actual = 12345;
  const tied = expensesByCategory(month, state.categories, 'actual');
  assert.deepEqual(tied.slices.map((s) => s.category.id), ['cat-logement', 'cat-courses', 'cat-loisirs'], 'à égalité, ordre des réglages');
});

test('regroupement par catégorie', () => {
  const state = sampleState();
  const groups = categoryBreakdown(state.months['2030-01'], state.categories);
  const fun = groups.find((g) => g.category.id === 'cat-loisirs');
  assert.deepEqual([fun.planned, fun.actual, fun.over], [10000, 15000, true]);
  assert.equal(groups.find((g) => g.category.savings).over, false);
});

test('regroupement par catégorie : toutes les catégories, dans l\'ordre des réglages', () => {
  const state = sampleState();
  const ids = () => categoryBreakdown(state.months['2030-01'], state.categories).map((g) => g.category.id);
  assert.deepEqual(ids(), state.categories.map((c) => c.id));
  moveItem(state.categories, SAVINGS_CATEGORY_ID, -1);
  assert.deepEqual(ids(), state.categories.map((c) => c.id));
  assert.equal(ids().indexOf(SAVINGS_CATEGORY_ID), state.categories.length - 2);
});

test('comparaison entre deux mois : écarts en euros et en pourcentage', () => {
  const state = sampleState();
  const copy = copyFromPrevious(state, '2030-02');
  copy.expenses.find((e) => e.name === 'rent').actual = 88000;
  const { rows, summary } = compareMonths(state, '2030-01', '2030-02', 'actual');
  const rent = rows.find((r) => r.category.id === 'cat-logement');
  assert.deepEqual([rent.a, rent.b, rent.diff], [80000, 88000, 8000]);
  assert.equal(rent.pct, 0.1);
  const food = rows.find((r) => r.category.id === 'cat-courses');
  assert.deepEqual([food.diff, food.pct], [-12345, -1]);
  assert.equal(summary.income.diff, -205050, 'le réel d\'un mois copié repart de zéro');
  assert.equal(summary.expenses.a, 107345);
  assert.equal(summary.expenses.b, 88000);
  assert.equal(summary.savings.diff, -5000);

  const planned = compareMonths(state, '2030-01', '2030-02', 'planned');
  assert.equal(planned.summary.income.diff, 0);
  assert.equal(planned.summary.expenses.diff, -10000);
  const fresh = compareMonths(state, '2030-02', '2030-01', 'actual').rows.find((r) => r.category.id === 'cat-loisirs');
  assert.equal(fresh.pct, null, 'pas de pourcentage depuis zéro');
});

test('évolution : mois renseignés seulement, dans l\'ordre', () => {
  const state = sampleState();
  copyFromPrevious(state, '2030-03');
  createEmptyMonth(state, '2030-02');
  assert.deepEqual(evolution(state).map((p) => p.key), ['2030-01', '2030-03']);
  assert.equal(hasLines(state.months['2030-02']), false);
});

test('réorganisation au sein d\'une catégorie', () => {
  const state = emptyState();
  const month = createEmptyMonth(state, '2030-01');
  month.expenses.push(expense('a', 'cat-logement', 0), expense('x', 'cat-courses', 0), expense('b', 'cat-logement', 0));
  assert.ok(moveExpense(month, 'b', -1));
  assert.deepEqual(month.expenses.map((e) => e.id), ['b', 'x', 'a']);
  assert.equal(moveExpense(month, 'b', -1), false);
});

test('suppression de catégorie : les lignes rejoignent « Autre »', () => {
  const state = sampleState();
  assert.ok(deleteCategory(state, 'cat-courses'));
  assert.equal(state.months['2030-01'].expenses.find((e) => e.id === 'food').categoryId, OTHER_CATEGORY_ID);
  assert.equal(deleteCategory(state, OTHER_CATEGORY_ID), false);
  assert.equal(deleteCategory(state, SAVINGS_CATEGORY_ID), false);
});

test('export puis import : aller-retour sans perte', () => {
  const state = sampleState();
  quickAdd(state.months['2030-01'], { amount: 500, expenseId: 'food', note: 'é"<x>' });
  state.settings.style = 'doux';
  const restored = parseBackup(serialize(state));
  assert.deepEqual(restored, state);
});

test('import : refuse les fichiers invalides', () => {
  assert.throws(() => parseBackup('pas du json'), /JSON valide/);
  assert.throws(() => parseBackup('{"app":"autre","version":1}'), /sauvegarde de cette application/);
  assert.throws(() => parseBackup('null'), /sauvegarde/);
  assert.throws(() => parseBackup('{"app":"budget-mensuel","version":99,"data":{}}'), /version plus récente/);
  assert.throws(() => parseBackup('{"app":"budget-mensuel","version":1,"data":{"categories":[]}}'), /manque/);
});

test('import : nettoie les données douteuses', () => {
  const state = normalizeState({
    categories: [{ id: 'c1', name: 'Ok', color: 'red;background:url(x)' }, { name: '' }, null],
    months: {
      '2030-13': { incomes: [], expenses: [] },
      __proto__x: {},
      '2030-01': {
        incomes: [{ name: 'i', planned: -5, actual: -5 }, { name: 'j', planned: 12.5, actual: 12.5 }],
        expenses: [
          { id: 'dup', name: 'a', categoryId: 'absente', planned: '100', actual: 5, type: 'bizarre' },
          { id: 'dup', name: 'b', categoryId: 'c1', planned: 1, actual: 1, type: 'oneoff' },
          null,
        ],
      },
    },
    settings: { style: 'inconnu', mode: 'dark' },
  });
  assert.equal(state.categories[0].color, '#898781');
  assert.ok(state.categories.some((c) => c.id === OTHER_CATEGORY_ID));
  assert.ok(state.categories.some((c) => c.savings));
  assert.deepEqual(Object.keys(state.months), ['2030-01']);
  const month = state.months['2030-01'];
  assert.deepEqual(month.incomes.map((i) => [i.planned, i.actual]), [[0, 0], [0, 0]]);
  assert.equal(month.expenses.length, 2);
  assert.equal(month.expenses[0].categoryId, OTHER_CATEGORY_ID);
  assert.equal(month.expenses[0].planned, 0);
  assert.equal(month.expenses[0].type, 'fixed');
  assert.notEqual(month.expenses[0].id, month.expenses[1].id);
  assert.deepEqual([state.settings.style, state.settings.mode], ['sobre', 'dark']);
});

test('persistance : relecture, stockage plein et données corrompues', () => {
  const storage = memoryStorage();
  const store = createStore(storage);
  assert.equal(store.load(), null);
  const state = sampleState();
  assert.equal(store.save(state), true);
  assert.deepEqual(store.load(), state);

  const full = createStore({ getItem: () => null, setItem: () => { throw new Error('quota'); }, removeItem: () => {} });
  assert.equal(full.save(state), false);

  storage.map.set(STORAGE_KEY, '{cassé');
  const broken = createStore(storage);
  assert.equal(broken.load(), null);
  assert.equal(broken.corrupted, true);
  assert.equal(storage.map.get(`${STORAGE_KEY}.corrupt`), '{cassé');
});

test('graduations des graphiques', () => {
  const ticks = niceTicks(-98700, 411100);
  assert.ok(ticks[0] <= -98700);
  assert.ok(ticks.at(-1) >= 411100);
  assert.ok(ticks.includes(0));
  assert.deepEqual(niceTicks(0, 0), [0, 10000]);
});

test('revenus : prévu et réel comptés séparément', () => {
  const state = emptyState();
  const month = createEmptyMonth(state, '2030-01');
  month.incomes.push({ id: 'i', name: 'i', planned: 200000, actual: 150000 });
  month.expenses.push(expense('pea', SAVINGS_CATEGORY_ID, 20000, 30000));
  const t = monthTotals(month, state.categories);
  assert.equal(t.plannedRemaining, 180000);
  assert.equal(t.actualRemaining, 120000);
  assert.equal(t.plannedSavingsRate, 0.1);
  assert.equal(t.actualSavingsRate, 0.2);

  const other = createEmptyMonth(state, '2030-02');
  other.incomes.push({ id: 'j', name: 'j', planned: 210000, actual: 100000 });
  assert.equal(compareMonths(state, '2030-01', '2030-02', 'planned').summary.income.diff, 10000);
  assert.equal(compareMonths(state, '2030-01', '2030-02', 'actual').summary.income.diff, -50000);
});

test('import : un revenu à montant unique devient prévu et réel, sans rien changer aux totaux', () => {
  const backup = JSON.stringify({
    app: 'budget-mensuel',
    version: 1,
    data: { categories: [], months: { '2030-01': { incomes: [{ id: 'i', name: 'Paie', amount: 200000 }], expenses: [] } } },
  });
  const state = parseBackup(backup);
  assert.deepEqual(state.months['2030-01'].incomes, [{ id: 'i', name: 'Paie', planned: 200000, actual: 200000 }]);
  const t = monthTotals(state.months['2030-01'], state.categories);
  assert.equal(t.plannedRemaining, 200000);
  assert.equal(t.actualRemaining, 200000);
});

test('import : le nouveau format est conservé tel quel, y compris un réel à zéro', () => {
  const state = normalizeState({
    categories: [],
    months: { '2030-01': { incomes: [{ id: 'i', name: 'Paie', planned: 200000, actual: 0 }], expenses: [] } },
  });
  assert.deepEqual(state.months['2030-01'].incomes, [{ id: 'i', name: 'Paie', planned: 200000, actual: 0 }]);
});