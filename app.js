// Interface : un rendu par écran, des panneaux d'édition et une délégation d'événements.

import {
  addCategory, amountToInput, categoryBreakdown, compareMonths, copyFromPrevious, createEmptyMonth, createStore,
  deleteCategory, emptyState, evolution, expensesByCategory, formatEuro, formatPercent, hasLines, initialMonth,
  isProtectedCategory, monthAlerts, monthKeyOf, monthKeysWithData, monthLabel, monthTotals, moveExpense, moveItem,
  parseAmount, parseBackup, previousMonthWithData, quickAdd, serialize, shiftMonth, undoQuickAdd, uid,
} from './store.js';
import { donut, evolutionLine, plannedActualBars } from './charts.js';

const store = createStore(window.localStorage);
let state = null;

const ui = {
  view: 'month',
  month: monthKeyOf(new Date()),
  reorder: false,
  charts: { basis: 'actual', sliceId: null, pointKey: null },
  compare: { a: null, b: null, basis: 'actual' },
};

const $ = (selector, root = document) => root.querySelector(selector);
const viewEl = $('#view');
const sheetEl = $('#sheet');
const toastEl = $('#toast');
const importInput = $('#import-file');

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const ICONS = {
  prev: '<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  next: '<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><path d="M9 5l7 7-7 7" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  up: '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M6 15l6-6 6 6" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  down: '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
};

// ---------- Sauvegarde et rendu ----------

function commit() {
  if (!store.save(state)) toast("Impossible d'enregistrer : le stockage de l'appareil est plein ou bloqué.");
  render();
}

function render() {
  if (!state) return renderWelcome();
  $('#tabs').hidden = false;
  const renderers = { month: renderMonth, charts: renderCharts, compare: renderCompare, settings: renderSettings };
  renderers[ui.view]();

  const month = state.months[ui.month];
  $('#fab').hidden = !(ui.view === 'month' && month);
  $('#tab-alert').hidden = !(month && monthAlerts(month, state.categories).length);
  for (const tab of document.querySelectorAll('#tabs button')) {
    if (tab.dataset.view === ui.view) tab.setAttribute('aria-current', 'page');
    else tab.removeAttribute('aria-current');
  }
}

function applyTheme() {
  const { style, mode } = state?.settings ?? { style: 'sobre', mode: 'auto' };
  const dark = mode === 'dark' || (mode === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.style = style;
  document.documentElement.dataset.mode = dark ? 'dark' : 'light';
  $('meta[name="theme-color"]').content = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
}

// Mémorise l'état pour proposer « Annuler » après une action destructive.
function undoable(message, change) {
  const snapshot = JSON.stringify(state);
  change();
  commit();
  toast(message, 'Annuler', () => {
    state = JSON.parse(snapshot);
    applyTheme();
    commit();
  });
}

let toastTimer;
function toast(message, actionLabel, onAction) {
  clearTimeout(toastTimer);
  toastEl.innerHTML = `<span>${esc(message)}</span>${actionLabel ? `<button type="button">${esc(actionLabel)}</button>` : ''}`;
  toastEl.hidden = false;
  if (actionLabel) {
    $('button', toastEl).onclick = () => {
      toastEl.hidden = true;
      onAction();
    };
  }
  toastTimer = setTimeout(() => { toastEl.hidden = true; }, actionLabel ? 6000 : 3500);
}

const categoryOf = (id) => state.categories.find((c) => c.id === id);
const currentMonth = () => state.months[ui.month];
const segmented = (action, options, value, label) => `
  <div class="segmented" role="group" aria-label="${esc(label)}">
    ${options.map(([v, text]) => `<button type="button" data-action="${action}" data-value="${v}" aria-pressed="${v === value}">${esc(text)}</button>`).join('')}
  </div>`;

function monthHeader() {
  const month = currentMonth();
  const alerts = month ? monthAlerts(month, state.categories) : [];
  return `
    <header class="month-nav">
      <button type="button" class="icon-btn" data-action="month-shift" data-delta="-1" aria-label="Mois précédent">${ICONS.prev}</button>
      <button type="button" class="month-title" data-action="month-today" aria-label="${esc(monthLabel(ui.month))}, revenir au mois en cours">${esc(monthLabel(ui.month))}</button>
      ${alerts.length ? `<button type="button" class="alert-badge" data-action="show-alerts" aria-label="${alerts.length} alerte${alerts.length > 1 ? 's' : ''}">⚠ ${alerts.length}</button>` : ''}
      <button type="button" class="icon-btn" data-action="month-shift" data-delta="1" aria-label="Mois suivant">${ICONS.next}</button>
    </header>`;
}

// ---------- Accueil (aucune donnée) ----------

function renderWelcome() {
  $('#tabs').hidden = true;
  $('#fab').hidden = true;
  viewEl.innerHTML = `
    <section class="welcome">
      <h1>Budget mensuel</h1>
      <p>Vos données restent sur cet appareil. Importez une sauvegarde ou commencez un budget vide.</p>
      ${store.corrupted ? '<p class="error-text">Les données enregistrées sont illisibles. Une copie a été conservée, importez votre dernière sauvegarde.</p>' : ''}
      <button type="button" class="btn btn-primary" data-action="import">Importer un fichier</button>
      <button type="button" class="btn" data-action="start-empty">Commencer un budget vide</button>
    </section>`;
}

// ---------- Écran du mois ----------

function renderMonth() {
  const month = currentMonth();
  if (!month) {
    const previous = previousMonthWithData(state, ui.month);
    viewEl.innerHTML = `
      ${monthHeader()}
      <section class="card empty-month">
        <h2>Ce mois est vide</h2>
        ${previous ? `<p>Reprendre les revenus et les dépenses fixes de ${esc(monthLabel(previous))}, avec le réel remis à 0 et les notes vides.</p>
        <button type="button" class="btn btn-primary" data-action="month-copy">Copier ${esc(monthLabel(previous))}</button>` : ''}
        <button type="button" class="btn" data-action="month-empty">Commencer un mois vide</button>
      </section>`;
    return;
  }

  const totals = monthTotals(month, state.categories);
  const groups = categoryBreakdown(month, state.categories);

  viewEl.innerHTML = `
    ${monthHeader()}
    ${recapCard(totals)}
    <div class="list-tools list-tools-end">
      <button type="button" class="link-btn" data-action="toggle-reorder" aria-pressed="${ui.reorder}">${ui.reorder ? 'Terminer' : 'Réorganiser'}</button>
    </div>
    <section class="ledger ledger-income">
      <header class="ledger-head">
        <h2>Revenus</h2>
        <span class="ledger-total">+ ${formatEuro(totals.actualIncome)} <small>/ ${formatEuro(totals.plannedIncome)}</small></span>
      </header>
      <div class="group">
        ${month.incomes.map(incomeRow).join('')}
        <button type="button" class="add-line" data-action="edit-income">+ Ajouter un revenu</button>
      </div>
    </section>
    <section class="ledger ledger-expense">
      <header class="ledger-head">
        <h2>Dépenses</h2>
        <span class="ledger-total">− ${formatEuro(totals.actualExpenses)} <small>/ ${formatEuro(totals.plannedExpenses)}</small></span>
      </header>
      ${groups.map(expenseGroup).join('')}
      <button type="button" class="btn" data-action="edit-expense">+ Nouvelle dépense</button>
    </section>
    ${historySection(month)}
    <button type="button" class="link-btn link-danger" data-action="month-clear">Vider ce mois</button>`;
}

function recapCard(t) {
  const negative = t.actualRemaining < 0;
  const rate = (value) => (value === null ? '–' : formatPercent(value));
  return `
    <section class="card recap" aria-label="Récapitulatif du mois">
      <p class="recap-label">Argent restant réel</p>
      <p class="recap-hero${negative ? ' is-negative' : ''}">${negative ? '⚠ ' : ''}${formatEuro(t.actualRemaining)}</p>
      <p class="recap-sub${t.plannedRemaining < 0 ? ' is-negative' : ''}">Prévu : ${formatEuro(t.plannedRemaining)}</p>
      <table class="recap-table">
        <thead><tr><td></td><th scope="col">Prévu</th><th scope="col">Réel</th></tr></thead>
        <tbody>
          <tr><th scope="row">Revenus</th><td>${formatEuro(t.plannedIncome)}</td><td>${formatEuro(t.actualIncome)}</td></tr>
          <tr><th scope="row">Dépenses</th><td>${formatEuro(t.plannedExpenses)}</td><td>${formatEuro(t.actualExpenses)}</td></tr>
          <tr><th scope="row">Épargne</th><td>${formatEuro(t.plannedSavings)}</td><td>${formatEuro(t.actualSavings)}</td></tr>
          <tr><th scope="row">Taux d'épargne</th><td>${rate(t.plannedSavingsRate)}</td><td>${rate(t.actualSavingsRate)}</td></tr>
        </tbody>
      </table>
    </section>`;
}

function reorderButtons(kind, id) {
  return `
    <span class="reorder">
      <button type="button" class="icon-btn" data-action="move-${kind}" data-id="${esc(id)}" data-delta="-1" aria-label="Monter">${ICONS.up}</button>
      <button type="button" class="icon-btn" data-action="move-${kind}" data-id="${esc(id)}" data-delta="1" aria-label="Descendre">${ICONS.down}</button>
    </span>`;
}

function incomeRow(income) {
  if (ui.reorder) {
    return `<div class="line line-static"><span class="line-name">${esc(income.name)}</span>${reorderButtons('income', income.id)}</div>`;
  }
  return `
    <button type="button" class="line" data-action="edit-income" data-id="${esc(income.id)}">
      <span class="line-top"><span class="line-name">${esc(income.name)}</span><span class="line-amount">${formatEuro(income.actual)} <small>/ ${formatEuro(income.planned)}</small></span></span>
    </button>`;
}

function expenseRow(line, savings) {
  if (ui.reorder) {
    return `<div class="line line-static"><span class="line-name">${esc(line.name)}</span>${reorderButtons('expense', line.id)}</div>`;
  }
  const over = !savings && line.actual > line.planned;
  const ratio = line.planned > 0 ? Math.min(line.actual / line.planned, 1) : (line.actual > 0 ? 1 : 0);
  return `
    <button type="button" class="line${over ? ' is-over' : ''}" data-action="edit-expense" data-id="${esc(line.id)}">
      <span class="line-top">
        <span class="line-name">${esc(line.name)}${line.type === 'oneoff' ? ' <small class="pill">ponctuel</small>' : ''}</span>
        <span class="line-amount">${formatEuro(line.actual)} <small>/ ${formatEuro(line.planned)}</small></span>
      </span>
      <span class="bar"><i style="width:${(ratio * 100).toFixed(1)}%"></i></span>
      ${over ? `<span class="line-over">⚠ Dépassé de ${formatEuro(line.actual - line.planned)}</span>` : ''}
      ${line.note ? `<span class="line-note">${esc(line.note)}</span>` : ''}
    </button>`;
}

function expenseGroup(group) {
  const { category, lines, planned, actual, over } = group;
  const savings = !!category.savings;
  return `
    <section class="group group-category${savings ? ' is-savings' : ''}" style="--cat:${esc(category.color)}">
      <header class="group-head">
        <h3><i class="swatch"></i>${esc(category.name)}</h3>
        <span class="group-total${over ? ' is-negative' : ''}">${over ? '⚠ ' : ''}${formatEuro(actual)} <small>/ ${formatEuro(planned)}</small></span>
      </header>
      ${savings ? '<p class="group-hint">Compté à part des dépenses</p>' : ''}
      ${lines.map((line) => expenseRow(line, savings)).join('')}
      <button type="button" class="add-line" data-action="edit-expense" data-category="${esc(category.id)}">+ Ajouter à ${esc(category.name)}</button>
    </section>`;
}

const historyDate = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

function historySection(month) {
  if (!month.history.length) return '';
  const rows = [...month.history].reverse().map((entry) => `
    <li class="history-row">
      <span class="history-main">
        <strong>${formatEuro(entry.amount)}</strong> · ${esc(entry.name)}
        <small>${esc(historyDate.format(entry.at))}${entry.note ? ` · ${esc(entry.note)}` : ''}</small>
      </span>
      <button type="button" class="link-btn" data-action="undo-add" data-id="${esc(entry.id)}">Annuler</button>
    </li>`).join('');
  return `
    <div class="list-tools"><h2>Ajouts du mois</h2></div>
    <section class="group"><ul class="history">${rows}</ul></section>`;
}

// ---------- Panneaux ----------

function openSheet(html, focusSelector) {
  sheetEl.innerHTML = `<div class="sheet-inner">${html}</div>`;
  if (!sheetEl.open) sheetEl.showModal();
  document.body.classList.add('sheet-open');
  updateKeyboardOffset();
  const target = focusSelector ? $(focusSelector, sheetEl) : null;
  if (target) {
    target.focus();
    target.select?.();
  } else {
    sheetEl.focus();
  }
}

function closeSheet() {
  if (sheetEl.open) sheetEl.close();
}

sheetEl.addEventListener('close', () => {
  document.body.classList.remove('sheet-open');
  sheetEl.innerHTML = '';
});
sheetEl.addEventListener('click', (event) => {
  if (event.target === sheetEl) closeSheet();
});

// Sur iOS, le clavier ne redimensionne pas la page : on remonte le panneau d'autant.
function updateKeyboardOffset() {
  const viewport = window.visualViewport;
  if (!viewport) return;
  const offset = Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop);
  document.documentElement.style.setProperty('--kb', `${offset}px`);
  document.documentElement.style.setProperty('--vvh', `${viewport.height}px`);
}
window.visualViewport?.addEventListener('resize', updateKeyboardOffset);
window.visualViewport?.addEventListener('scroll', updateKeyboardOffset);

const sheetHead = (title) => `
  <header class="sheet-head">
    <h2>${esc(title)}</h2>
    <button type="button" class="icon-btn" data-action="close-sheet" aria-label="Fermer">✕</button>
  </header>`;

const categoryOptions = (selected) => state.categories
  .map((c) => `<option value="${esc(c.id)}"${c.id === selected ? ' selected' : ''}>${esc(c.name)}</option>`).join('');

const amountField = (name, label, cents) => `
  <label class="field">
    <span>${esc(label)}</span>
    <span class="amount-wrap"><input name="${name}" type="text" inputmode="decimal" autocomplete="off" enterkeyhint="done" placeholder="0" value="${amountToInput(cents)}"><span>€</span></span>
  </label>`;

// Lit les montants du formulaire et signale ceux qui sont invalides.
function readAmounts(form, names) {
  const values = {};
  let valid = true;
  for (const name of names) {
    const input = form.elements[name];
    const value = parseAmount(input.value);
    input.closest('.amount-wrap').classList.toggle('is-invalid', value === null);
    if (value === null) valid = false;
    values[name] = value;
  }
  return valid ? values : null;
}

function openExpenseSheet(id, presetCategory) {
  const month = currentMonth();
  const line = id ? month.expenses.find((e) => e.id === id) : null;
  const data = line ?? { name: '', categoryId: presetCategory ?? state.categories[0].id, planned: 0, actual: 0, note: '', type: 'fixed' };

  openSheet(`
    ${sheetHead(line ? 'Modifier la dépense' : 'Nouvelle dépense')}
    <form id="line-form" novalidate>
      <label class="field"><span>Nom</span><input name="name" type="text" maxlength="80" autocomplete="off" value="${esc(data.name)}"></label>
      <div class="field-row">
        ${amountField('actual', 'Réel', data.actual)}
        ${amountField('planned', 'Prévu', data.planned)}
      </div>
      <label class="field"><span>Catégorie</span><select name="categoryId">${categoryOptions(data.categoryId)}</select></label>
      <fieldset class="field">
        <legend>Type</legend>
        <div class="segmented">
          <label><input type="radio" name="type" value="fixed"${data.type === 'fixed' ? ' checked' : ''}><span>Fixe</span></label>
          <label><input type="radio" name="type" value="oneoff"${data.type === 'oneoff' ? ' checked' : ''}><span>Ponctuel</span></label>
        </div>
        <small class="field-hint">Les dépenses fixes sont reprises dans le mois suivant.</small>
      </fieldset>
      <label class="field"><span>Note</span><input name="note" type="text" maxlength="300" autocomplete="off" value="${esc(data.note)}"></label>
      <p class="error-text" id="line-error" hidden></p>
      <button type="submit" class="btn btn-primary">${line ? 'Terminé' : 'Ajouter'}</button>
      ${line ? `<button type="button" class="btn btn-danger" data-action="delete-expense" data-id="${esc(line.id)}">Supprimer</button>` : ''}
    </form>`, line ? 'input[name="actual"]' : 'input[name="name"]');

  const form = $('#line-form', sheetEl);
  const read = () => {
    const amounts = readAmounts(form, ['actual', 'planned']);
    if (!amounts) return null;
    return {
      ...amounts,
      name: form.elements.name.value.trim(),
      categoryId: form.elements.categoryId.value,
      type: form.elements.type.value,
      note: form.elements.note.value.trim(),
    };
  };

  if (line) {
    // Une ligne existante se met à jour à chaque frappe : le récap se recalcule derrière le panneau.
    form.addEventListener('input', () => {
      const values = read();
      if (!values) return;
      Object.assign(line, values, { name: values.name || line.name });
      commit();
    });
  }
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const values = read();
    if (!values) return;
    if (!line) {
      if (!values.name) {
        const error = $('#line-error', form);
        error.textContent = 'Donnez un nom à cette dépense.';
        error.hidden = false;
        form.elements.name.focus();
        return;
      }
      month.expenses.push({ id: uid(), ...values });
      commit();
    }
    closeSheet();
  });
}

function openIncomeSheet(id) {
  const month = currentMonth();
  const income = id ? month.incomes.find((i) => i.id === id) : null;
  openSheet(`
    ${sheetHead(income ? 'Modifier le revenu' : 'Nouveau revenu')}
    <form id="income-form" novalidate>
      <label class="field"><span>Nom</span><input name="name" type="text" maxlength="80" autocomplete="off" value="${esc(income?.name)}"></label>
      <div class="field-row">
        ${amountField('actual', 'Réel', income?.actual ?? 0)}
        ${amountField('planned', 'Prévu', income?.planned ?? 0)}
      </div>
      <p class="error-text" id="income-error" hidden></p>
      <button type="submit" class="btn btn-primary">${income ? 'Terminé' : 'Ajouter'}</button>
      ${income ? `<button type="button" class="btn btn-danger" data-action="delete-income" data-id="${esc(income.id)}">Supprimer</button>` : ''}
    </form>`, income ? 'input[name="actual"]' : 'input[name="name"]');

  const form = $('#income-form', sheetEl);
  if (income) {
    form.addEventListener('input', () => {
      const amounts = readAmounts(form, ['actual', 'planned']);
      if (!amounts) return;
      Object.assign(income, amounts);
      income.name = form.elements.name.value.trim() || income.name;
      commit();
    });
  }
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const amounts = readAmounts(form, ['actual', 'planned']);
    if (!amounts) return;
    if (!income) {
      const name = form.elements.name.value.trim();
      if (!name) {
        const error = $('#income-error', form);
        error.textContent = 'Donnez un nom à ce revenu.';
        error.hidden = false;
        form.elements.name.focus();
        return;
      }
      month.incomes.push({ id: uid(), name, ...amounts });
      commit();
    }
    closeSheet();
  });
}

function openQuickAdd() {
  const month = currentMonth();
  const groups = categoryBreakdown(month, state.categories).filter((g) => g.lines.length);
  const chips = groups.map((g) => `
    <p class="chip-group" style="--cat:${esc(g.category.color)}"><i class="swatch"></i>${esc(g.category.name)}</p>
    <div class="chips">
      ${g.lines.map((line) => `<label class="chip"><input type="radio" name="post" value="${esc(line.id)}"><span>${esc(line.name)}</span></label>`).join('')}
    </div>`).join('');

  openSheet(`
    ${sheetHead('Ajout rapide')}
    <form id="quick-form" novalidate>
      <label class="field">
        <span>Montant</span>
        <span class="amount-wrap amount-large"><input name="amount" type="text" inputmode="decimal" autocomplete="off" placeholder="0" aria-label="Montant en euros"><span>€</span></span>
      </label>
      <fieldset class="field">
        <legend>Poste</legend>
        <div class="post-picker">
          ${chips}
          <div class="chips chips-new"><label class="chip"><input type="radio" name="post" value="__new"${groups.length ? '' : ' checked'}><span>+ Nouveau poste</span></label></div>
        </div>
      </fieldset>
      <div id="quick-new"${groups.length ? ' hidden' : ''}>
        <label class="field"><span>Nom du poste</span><input name="newName" type="text" maxlength="80" autocomplete="off"></label>
        <label class="field"><span>Catégorie</span><select name="newCategory">${categoryOptions(state.categories[0].id)}</select></label>
      </div>
      <label class="field"><span>Note (facultatif)</span><input name="note" type="text" maxlength="300" autocomplete="off"></label>
      <p class="error-text" id="quick-error" hidden></p>
      <button type="submit" class="btn btn-primary">Ajouter</button>
    </form>`, 'input[name="amount"]');

  const form = $('#quick-form', sheetEl);
  const error = $('#quick-error', form);
  const fail = (message) => {
    error.textContent = message;
    error.hidden = false;
  };
  form.addEventListener('change', () => {
    $('#quick-new', form).hidden = form.elements.post.value !== '__new';
  });
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const amount = parseAmount(form.elements.amount.value);
    if (!amount) return fail('Saisissez un montant supérieur à 0.');
    const post = form.elements.post.value;
    if (!post) return fail('Choisissez un poste.');
    const note = form.elements.note.value.trim();
    let entry;
    if (post === '__new') {
      const name = form.elements.newName.value.trim();
      if (!name) return fail('Donnez un nom au nouveau poste.');
      entry = quickAdd(month, { amount, newExpense: { name, categoryId: form.elements.newCategory.value }, note });
    } else {
      entry = quickAdd(month, { amount, expenseId: post, note });
    }
    closeSheet();
    commit();
    const key = ui.month;
    toast(`${formatEuro(amount)} ajoutés à ${entry.name}`, 'Annuler', () => {
      // Relu ici : l'état a pu être remplacé entre-temps (import, annulation).
      if (state.months[key]) undoQuickAdd(state.months[key], entry.id);
      commit();
    });
  });
}

function openAlerts() {
  const alerts = monthAlerts(currentMonth(), state.categories);
  openSheet(`
    ${sheetHead('Alertes du mois')}
    <ul class="alert-list">
      ${alerts.map((a) => `
        <li>
          ${a.kind === 'line'
            ? `<button type="button" class="alert-row" data-action="edit-expense" data-id="${esc(a.id)}"><span>⚠ ${esc(a.label)}</span><strong>+${formatEuro(a.amount)}</strong></button>`
            : `<div class="alert-row"><span>⚠ ${esc(a.label)}</span><strong>${a.kind === 'remaining' ? '−' : '+'}${formatEuro(a.amount)}</strong></div>`}
        </li>`).join('')}
    </ul>`);
}

function confirmSheet(title, message, confirmLabel, onConfirm) {
  openSheet(`
    ${sheetHead(title)}
    <p class="sheet-text">${esc(message)}</p>
    <button type="button" class="btn btn-danger" id="confirm-yes">${esc(confirmLabel)}</button>
    <button type="button" class="btn" data-action="close-sheet">Annuler</button>`);
  $('#confirm-yes', sheetEl).onclick = () => {
    closeSheet();
    onConfirm();
  };
}

// ---------- Graphiques ----------

function renderCharts() {
  const { basis } = ui.charts;
  const month = currentMonth();
  const basisLabel = basis === 'actual' ? 'réel' : 'prévu';
  const points = evolution(state);

  let monthCards = '<section class="card"><p class="muted">Aucune donnée pour ce mois.</p></section>';
  if (month && hasLines(month)) {
    const split = expensesByCategory(month, state.categories, basis);
    const groups = categoryBreakdown(month, state.categories).filter((g) => g.planned > 0 || g.actual > 0);
    monthCards = `
      <section class="card chart-card">
        <h2>Dépenses par catégorie <small>${basisLabel}</small></h2>
        ${split.total > 0 ? donut(split, ui.charts.sliceId) : `<p class="muted">Aucune dépense ${basisLabel === 'réel' ? 'réelle' : 'prévue'} ce mois-ci.</p>`}
      </section>
      <section class="card chart-card">
        <h2>Prévu et réel par catégorie</h2>
        ${groups.length ? plannedActualBars(groups) : '<p class="muted">Aucun montant saisi.</p>'}
      </section>`;
  }

  let evolutionCard = '';
  if (points.length) {
    let index = points.findIndex((p) => p.key === ui.charts.pointKey);
    if (index === -1) index = points.findIndex((p) => p.key === ui.month);
    if (index === -1) index = points.length - 1;
    const width = Math.max(280, Math.min(viewEl.clientWidth, 640) - 64);
    evolutionCard = `
      <section class="card chart-card">
        <h2>Évolution sur les mois <small>${basisLabel}</small></h2>
        ${evolutionLine(points, basis, index, width)}
        ${points.length === 1 ? '<p class="muted">La courbe apparaîtra dès le deuxième mois renseigné.</p>' : ''}
      </section>`;
  }

  viewEl.innerHTML = `
    ${monthHeader()}
    ${segmented('chart-basis', [['actual', 'Réel'], ['planned', 'Prévu']], basis, 'Montants affichés')}
    ${monthCards}
    ${evolutionCard}`;
}

// ---------- Comparaison ----------

function deltaCell(d, goodWhenUp) {
  if (d.diff === 0) return '<span class="delta">= 0,00 €</span>';
  const up = d.diff > 0;
  const tone = up === goodWhenUp ? 'is-good' : 'is-bad';
  const sign = up ? '+' : '−';
  const pct = d.pct === null ? 'nouveau' : `${sign}${formatPercent(Math.abs(d.pct))}`;
  return `<span class="delta ${tone}">${up ? '▲' : '▼'} ${sign}${formatEuro(Math.abs(d.diff))}<small>${pct}</small></span>`;
}

function renderCompare() {
  const keys = monthKeysWithData(state);
  if (keys.length < 2) {
    viewEl.innerHTML = `
      <header class="page-head"><h1>Comparer</h1></header>
      <section class="card"><p class="muted">Il faut au moins deux mois renseignés pour les comparer.</p></section>`;
    return;
  }
  const { compare } = ui;
  // Par défaut : le mois affiché face au mois d'avant, ou au suivant s'il est le premier.
  if (!keys.includes(compare.b)) compare.b = keys.indexOf(ui.month) > 0 ? ui.month : (keys.includes(ui.month) ? keys[1] : keys[keys.length - 1]);
  if (!keys.includes(compare.a)) compare.a = keys.filter((k) => k < compare.b).pop() ?? keys.find((k) => k !== compare.b);

  const options = (selected) => keys.map((k) => `<option value="${k}"${k === selected ? ' selected' : ''}>${esc(monthLabel(k))}</option>`).join('');
  const { rows, summary } = compareMonths(state, compare.a, compare.b, compare.basis);
  const row = (label, d, goodWhenUp, swatch = '') => `
    <li class="compare-row">
      <span class="compare-main">
        <span class="compare-name">${swatch}${esc(label)}</span>
        <small>${formatEuro(d.a)} → ${formatEuro(d.b)}</small>
      </span>
      ${deltaCell(d, goodWhenUp)}
    </li>`;

  viewEl.innerHTML = `
    <header class="page-head"><h1>Comparer</h1></header>
    <div class="compare-pick">
      <label class="field"><span>De</span><select data-change="compare-a">${options(compare.a)}</select></label>
      <label class="field"><span>À</span><select data-change="compare-b">${options(compare.b)}</select></label>
    </div>
    ${segmented('compare-basis', [['actual', 'Réel'], ['planned', 'Prévu']], compare.basis, 'Montants comparés')}
    <section class="card">
      <h2>Bilan</h2>
      <ul class="compare-list">
        ${row('Revenus', summary.income, true)}
        ${row('Dépenses', summary.expenses, false)}
        ${row('Épargne', summary.savings, true)}
        ${row('Argent restant', summary.remaining, true)}
      </ul>
    </section>
    <section class="card">
      <h2>Par catégorie</h2>
      ${rows.length ? `<ul class="compare-list">
        ${rows.map((r) => row(r.category.name, r, !!r.category.savings, `<i class="swatch" style="background:${esc(r.category.color)}"></i>`)).join('')}
      </ul>` : '<p class="muted">Aucun montant à comparer.</p>'}
    </section>`;
}

// ---------- Réglages ----------

const backupDate = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'long', timeStyle: 'short' });

function renderSettings() {
  const { style, mode, lastBackupAt } = state.settings;
  const categories = state.categories.map((c) => `
    <li class="category-row">
      <input type="color" value="${esc(c.color)}" data-change="category-color" data-id="${esc(c.id)}" aria-label="Couleur de ${esc(c.name)}">
      <input type="text" value="${esc(c.name)}" maxlength="60" data-change="category-name" data-id="${esc(c.id)}" aria-label="Nom de la catégorie">
      ${reorderButtons('category', c.id)}
      ${isProtectedCategory(c)
        ? '<span class="icon-btn" aria-hidden="true"></span>'
        : `<button type="button" class="icon-btn" data-action="delete-category" data-id="${esc(c.id)}" aria-label="Supprimer ${esc(c.name)}">✕</button>`}
    </li>`).join('');

  viewEl.innerHTML = `
    <header class="page-head"><h1>Réglages</h1></header>
    <section class="card">
      <h2>Thème</h2>
      <p class="field-label">Style</p>
      ${segmented('set-style', [['sobre', 'Sobre'], ['colore', 'Coloré'], ['doux', 'Doux']], style, 'Style')}
      <p class="field-label">Apparence</p>
      ${segmented('set-mode', [['light', 'Clair'], ['dark', 'Sombre'], ['auto', 'Auto']], mode, 'Apparence')}
    </section>
    <section class="card">
      <h2>Catégories</h2>
      <ul class="category-list">${categories}</ul>
      <p class="muted">Les lignes d'une catégorie supprimée passent dans « Autre ».</p>
      <button type="button" class="btn" data-action="add-category">+ Ajouter une catégorie</button>
    </section>
    <section class="card">
      <h2>Sauvegarde</h2>
      <p class="muted">Vos données restent uniquement sur cet appareil. ${lastBackupAt ? `Dernier export : ${esc(backupDate.format(lastBackupAt))}.` : 'Aucun export pour le moment.'}</p>
      <button type="button" class="btn btn-primary" data-action="export">Exporter en JSON</button>
      <button type="button" class="btn" data-action="import">Importer un JSON</button>
    </section>
    <section class="card">
      <h2>Zone sensible</h2>
      <button type="button" class="btn btn-danger" data-action="reset">Tout effacer</button>
    </section>`;
}

async function exportBackup() {
  const name = `budget-${new Date().toISOString().slice(0, 10)}.json`;
  state.settings.lastBackupAt = Date.now();
  const content = serialize(state);
  const file = new File([content], name, { type: 'application/json' });
  // Dans une app installée sur iPhone, seule la feuille de partage enregistre le fichier de façon fiable.
  if (navigator.maxTouchPoints > 0 && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file] });
      commit();
      return;
    } catch (error) {
      if (error.name === 'AbortError') {
        state = store.load() ?? state;
        return;
      }
    }
  }
  const url = URL.createObjectURL(file);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  commit();
  toast('Sauvegarde exportée.');
}

async function importBackup(file) {
  let imported;
  try {
    imported = parseBackup(await file.text());
  } catch (error) {
    toast(`Import impossible : ${error.message}`);
    return;
  }
  const count = monthKeysWithData(imported).length;
  const apply = () => {
    const finish = () => {
      state = imported;
      ui.month = initialMonth(state, monthKeyOf(new Date()));
      ui.view = 'month';
      applyTheme();
    };
    if (!state) {
      finish();
      commit();
      toast(`${count} mois importé${count > 1 ? 's' : ''}.`);
    } else {
      undoable(`${count} mois importé${count > 1 ? 's' : ''}.`, finish);
    }
  };
  if (!state) return apply();
  confirmSheet('Remplacer les données ?', `Ce fichier contient ${count} mois. Il remplacera toutes les données de cet appareil.`, 'Remplacer', apply);
}

// ---------- Actions ----------

function afterViewChange() {
  render();
  window.scrollTo(0, 0);
}

const actions = {
  tab: ({ view }) => { ui.view = view; ui.reorder = false; afterViewChange(); },
  'month-shift': ({ delta }) => { ui.month = shiftMonth(ui.month, Number(delta)); ui.charts.pointKey = null; afterViewChange(); },
  'month-today': () => { ui.month = monthKeyOf(new Date()); ui.charts.pointKey = null; afterViewChange(); },
  'month-copy': () => { copyFromPrevious(state, ui.month); commit(); },
  'month-empty': () => { createEmptyMonth(state, ui.month); commit(); },
  'month-clear': () => confirmSheet('Vider ce mois ?', `Toutes les lignes de ${monthLabel(ui.month)} seront supprimées.`, 'Vider', () => {
    undoable('Mois vidé.', () => { delete state.months[ui.month]; });
  }),
  'toggle-reorder': () => { ui.reorder = !ui.reorder; render(); },
  'move-income': ({ id, delta }) => { moveItem(currentMonth().incomes, id, Number(delta)); commit(); },
  'move-expense': ({ id, delta }) => { moveExpense(currentMonth(), id, Number(delta)); commit(); },
  'move-category': ({ id, delta }) => { moveItem(state.categories, id, Number(delta)); commit(); },
  'edit-expense': ({ id, category }) => openExpenseSheet(id, category),
  'edit-income': ({ id }) => openIncomeSheet(id),
  'delete-expense': ({ id }) => {
    closeSheet();
    undoable('Dépense supprimée.', () => {
      const month = currentMonth();
      month.expenses = month.expenses.filter((e) => e.id !== id);
    });
  },
  'delete-income': ({ id }) => {
    closeSheet();
    undoable('Revenu supprimé.', () => {
      const month = currentMonth();
      month.incomes = month.incomes.filter((i) => i.id !== id);
    });
  },
  'quick-add': () => openQuickAdd(),
  'undo-add': ({ id }) => {
    undoQuickAdd(currentMonth(), id);
    commit();
    toast('Ajout annulé.');
  },
  'show-alerts': () => openAlerts(),
  'close-sheet': () => closeSheet(),
  'chart-basis': ({ value }) => { ui.charts.basis = value; ui.charts.sliceId = null; render(); },
  'chart-slice': ({ id }) => { ui.charts.sliceId = ui.charts.sliceId === id ? null : id; render(); },
  'chart-month': ({ index }) => { ui.charts.pointKey = evolution(state)[Number(index)].key; render(); },
  'compare-basis': ({ value }) => { ui.compare.basis = value; render(); },
  'set-style': ({ value }) => { state.settings.style = value; applyTheme(); commit(); },
  'set-mode': ({ value }) => { state.settings.mode = value; applyTheme(); commit(); },
  'add-category': () => {
    addCategory(state, 'Nouvelle catégorie', '#2a78d6');
    commit();
  },
  'delete-category': ({ id }) => {
    const { name } = categoryOf(id);
    undoable(`Catégorie ${name} supprimée.`, () => deleteCategory(state, id));
  },
  export: () => exportBackup(),
  import: () => importInput.click(),
  'start-empty': () => {
    state = emptyState();
    ui.month = monthKeyOf(new Date());
    createEmptyMonth(state, ui.month);
    applyTheme();
    commit();
  },
  reset: () => confirmSheet('Tout effacer ?', 'Tous les mois, catégories et réglages de cet appareil seront supprimés. Exportez une sauvegarde avant si besoin.', 'Tout effacer', () => {
    store.clear();
    state = null;
    applyTheme();
    render();
  }),
};

const changes = {
  'compare-a': (value) => { ui.compare.a = value; render(); },
  'compare-b': (value) => { ui.compare.b = value; render(); },
  'category-color': (value, { id }) => { categoryOf(id).color = value; commit(); },
  'category-name': (value, { id }, input) => {
    const name = value.trim();
    if (name) categoryOf(id).name = name;
    else input.value = categoryOf(id).name;
    commit();
  },
};

document.addEventListener('click', (event) => {
  const target = event.target.closest('[data-action]');
  if (target) actions[target.dataset.action]?.(target.dataset, target);
});

document.addEventListener('change', (event) => {
  const target = event.target.closest('[data-change]');
  if (target) changes[target.dataset.change]?.(target.value, target.dataset, target);
});

importInput.addEventListener('change', () => {
  const [file] = importInput.files;
  importInput.value = '';
  if (file) importBackup(file);
});

matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);

let resizeTimer;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => { if (ui.view === 'charts') render(); }, 150);
});

// ---------- Démarrage ----------

// Fichier de données de départ, présent seulement en local (voir README).
async function loadSeed() {
  try {
    const response = await fetch('./seed.json', { cache: 'no-store' });
    return response.ok ? parseBackup(await response.text()) : null;
  } catch {
    return null;
  }
}

async function start() {
  state = store.load();
  if (!state && !store.corrupted) {
    state = await loadSeed();
    if (state) store.save(state);
  }
  if (state) ui.month = initialMonth(state, monthKeyOf(new Date()));
  applyTheme();
  render();

  navigator.storage?.persist?.();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
}

start();
