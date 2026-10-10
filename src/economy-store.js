'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { randomInt } = require('node:crypto');
const { ShopError, LIMITS, exact, validId, validSlug, integer, validItem, validInventory, validReceipt } = require('./shop-schema');

const MAX_ACCOUNTS = 50_000;
const MAX_BALANCE = 9_000_000_000_000_000;
const DAILY_COOLDOWN_MS = 24 * 60 * 60 * 1000;
const WORK_COOLDOWN_MS = 60 * 60 * 1000;
const BEG_COOLDOWN_MS = 15 * 60 * 1000;
const PROFESSION_COOLDOWN_MS = DAILY_COOLDOWN_MS;
const PROFESSIONS = Object.freeze(['developer', 'artist', 'builder']);
const rankOf = (works) => Math.min(5, 1 + Math.floor(works / 10));

class EconomyStore {
  constructor(filePath, { rollWork = () => randomInt(25, 101), rollBeg = () => randomInt(0, 26) } = {}) {
    this.filePath = filePath;
    this.accounts = new Map();
    this.items = new Map();
    this.receipts = new Map();
    this.queue = Promise.resolve();
    this.rollWork = rollWork;
    this.rollBeg = rollBeg;
  }

  async load() {
    try {
      if ((await fs.stat(this.filePath)).size > LIMITS.bytes) throw new Error('Economy store exceeds its size limit.');
      const parsed = JSON.parse(await fs.readFile(this.filePath, 'utf8'));
      if (!(exact(parsed, 'version,accounts') && parsed.version === 1 || exact(parsed, 'version,accounts,items,receipts') && parsed.version === 2) || !Array.isArray(parsed.accounts) || parsed.accounts.length > MAX_ACCOUNTS
        || parsed.accounts.some((account) => !this.#valid(account))) {
        throw new Error('Economy store contains invalid records; refusing to modify it.');
      }
      const accounts = new Map();
      for (const account of parsed.accounts) {
        const key = this.#key(account.guildId, account.userId);
        if (accounts.has(key)) throw new Error('Economy store contains duplicate accounts; refusing to modify it.');
        accounts.set(key, Object.freeze({ ...account, ...(account.profession ? { profession: Object.freeze({ ...account.profession }) } : {}), ...(account.inventory ? { inventory: Object.freeze(account.inventory.map((entry) => Object.freeze({ ...entry }))) } : {}) }));
      }
      const items = new Map(); const receipts = new Map();
      if (parsed.version === 2) {
        if (!Array.isArray(parsed.items) || !Array.isArray(parsed.receipts) || parsed.items.length > MAX_ACCOUNTS || parsed.receipts.length > LIMITS.receipts) throw new Error('Invalid shop records.');
        for (const item of parsed.items) {
          const key = this.#key(item?.guildId, item?.id);
          if (!validItem(item) || items.has(key)) throw new Error('Invalid or duplicate shop item.');
          items.set(key, Object.freeze({ ...item }));
        }
        for (const receipt of parsed.receipts) {
          if (!validReceipt(receipt) || receipts.has(receipt.id)) throw new Error('Invalid or duplicate shop receipt.');
          receipts.set(receipt.id, Object.freeze({ ...receipt }));
        }
      }
      this.#validateShop(accounts, items, receipts);
      this.accounts = accounts; this.items = items; this.receipts = receipts;
    } catch (error) {
      if (error.code === 'ENOENT') return;
      throw error;
    }
  }

  balance(guildId, userId) { return this.accounts.get(this.#key(guildId, userId))?.balance || 0; }
  profile(guildId, userId) {
    const account = this.accounts.get(this.#key(guildId, userId)) || this.#empty(guildId, userId);
    const profile = structuredClone(account);
    if (profile.profession) profile.profession.rank = rankOf(profile.profession.works);
    return profile;
  }

  async chooseProfession(guildId, userId, name, now = new Date()) {
    if (!PROFESSIONS.includes(name) || !Number.isFinite(now.getTime())) throw new Error('Choose a valid profession.');
    return this.#transaction((accounts) => {
      const key = this.#key(guildId, userId);
      const account = accounts.get(key) || this.#empty(guildId, userId);
      if (account.profession?.name === name) return { claimed: false, unchanged: true };
      const changed = account.profession ? Date.parse(account.profession.changedAt) : 0;
      if (changed && now.getTime() - changed < PROFESSION_COOLDOWN_MS) return { claimed: false, nextAt: new Date(changed + PROFESSION_COOLDOWN_MS).toISOString() };
      accounts.set(key, Object.freeze({ ...account, profession: Object.freeze({ name, works: 0, changedAt: now.toISOString() }) }));
      return { changed: true, name };
    });
  }

  leaderboard(guildId, limit = 10) {
    return [...this.accounts.values()].filter((account) => account.guildId === guildId && account.balance > 0)
      .sort((left, right) => right.balance - left.balance || left.userId.localeCompare(right.userId))
      .slice(0, limit).map((account) => structuredClone(account));
  }

  async claim(guildId, userId, kind, now = new Date()) {
    const cooldown = kind === 'daily' ? DAILY_COOLDOWN_MS : kind === 'work' ? WORK_COOLDOWN_MS : kind === 'beg' ? BEG_COOLDOWN_MS : 0;
    if (!cooldown) throw new Error('Unknown reward type.');
    if (!Number.isFinite(now.getTime())) throw new Error('Invalid reward time.');
    return this.#transaction((accounts) => {
      const key = this.#key(guildId, userId);
      const existing = accounts.get(key) || this.#empty(guildId, userId);
      const lastKey = kind === 'daily' ? 'lastDaily' : kind === 'beg' ? 'lastBeg' : 'lastWork';
      const last = existing[lastKey] ? Date.parse(existing[lastKey]) : 0;
      if (last && now.getTime() - last < cooldown) return { claimed: false, nextAt: new Date(last + cooldown).toISOString() };
      const baseReward = kind === 'daily' ? 100 : kind === 'beg' ? this.rollBeg() : this.rollWork();
      if (!Number.isInteger(baseReward) || baseReward < (kind === 'beg' ? 0 : 25) || baseReward > (kind === 'beg' ? 25 : 100)) throw new Error('Invalid reward amount.');
      const bonus = kind === 'work' && existing.profession ? rankOf(existing.profession.works) * 5 : 0;
      const reward = baseReward + bonus;
      const profession = kind === 'work' && existing.profession ? { profession: Object.freeze({ ...existing.profession, works: Math.min(1000, existing.profession.works + 1) }) } : {};
      const updated = Object.freeze({ ...existing, ...profession, balance: existing.balance + reward, [lastKey]: now.toISOString() });
      if (!Number.isSafeInteger(updated.balance) || updated.balance > MAX_BALANCE) throw new Error('Balance limit reached.');
      accounts.set(key, updated);
      return { claimed: true, reward, balance: updated.balance, ...(updated.profession ? { bonus, profession: { ...updated.profession, rank: rankOf(updated.profession.works) } } : {}) };
    });
  }

  async transfer(guildId, fromUserId, toUserId, amount) {
    if (!Number.isSafeInteger(amount) || amount < 1 || amount > 1_000_000) throw new Error('Transfer amount must be from 1 to 1000000.');
    if (fromUserId === toUserId) throw new Error('You cannot transfer coins to yourself.');
    return this.#transaction((accounts) => {
      const fromKey = this.#key(guildId, fromUserId);
      const toKey = this.#key(guildId, toUserId);
      const from = accounts.get(fromKey) || this.#empty(guildId, fromUserId);
      const to = accounts.get(toKey) || this.#empty(guildId, toUserId);
      if (from.balance < amount) throw new Error('You do not have enough coins for that transfer.');
      if (to.balance + amount > MAX_BALANCE) throw new Error('The recipient balance limit would be exceeded.');
      accounts.set(fromKey, Object.freeze({ ...from, balance: from.balance - amount }));
      accounts.set(toKey, Object.freeze({ ...to, balance: to.balance + amount }));
      return { fromBalance: from.balance - amount, toBalance: to.balance + amount };
    });
  }

  shop(guildId, { includeDisabled = false } = {}) {
    return [...this.items.values()].filter((item) => item.guildId === guildId && (includeDisabled || item.enabled))
      .sort((a, b) => a.id.localeCompare(b.id)).map((item) => ({ ...item }));
  }
  item(guildId, id) { const item = this.items.get(this.#key(guildId, id)); return item ? { ...item } : null; }
  inventory(guildId, userId) {
    return (this.accounts.get(this.#key(guildId, userId))?.inventory || []).map((entry) => ({ ...entry, title: this.item(guildId, entry.itemId)?.title || entry.itemId }));
  }
  history(guildId, userId) {
    return [...this.receipts.values()].filter((entry) => entry.guildId === guildId && (entry.userId === userId || entry.targetId === userId))
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt) || b.id.localeCompare(a.id)).slice(0, 20).map((entry) => ({ ...entry }));
  }
  saveItem(action, input) {
    const item = structuredClone(input);
    if (!['create', 'update'].includes(action) || !validItem(item)) throw new ShopError('Invalid shop item.');
    return this.#transaction((accounts, items) => {
      const key = this.#key(item.guildId, item.id); const old = items.get(key);
      if (action === 'create' ? !!old : !old) throw new ShopError('Create needs a new item ID; update needs an existing item.');
      if (action === 'create' && [...items.values()].filter((entry) => entry.guildId === item.guildId).length >= LIMITS.items) throw new ShopError('Shop item limit reached.');
      // Updates preserve enable state. Disabled items can still be gifted or used.
      const saved = Object.freeze({ ...item, enabled: old ? old.enabled : false });
      items.set(key, saved); return { ...saved };
    });
  }
  enableItem(guildId, id, enabled) {
    if (typeof enabled !== 'boolean') throw new ShopError('Invalid enable state.');
    return this.#transaction((accounts, items) => {
      const key = this.#key(guildId, id); const item = items.get(key);
      if (!item) throw new ShopError('Shop item not found.');
      const saved = Object.freeze({ ...item, enabled }); items.set(key, saved); return { ...saved };
    });
  }
  transactItem(input, now = new Date()) {
    const request = structuredClone(input); const at = now.getTime();
    const { id, guildId, userId, kind, itemId, quantity, targetId = null } = request;
    if (![id, guildId, userId].every(validId) || !validSlug(itemId) || !integer(quantity, 1, 100) || !Number.isFinite(at)
      || !['buy', 'gift', 'use'].includes(kind) || (kind === 'gift' ? !validId(targetId) || targetId === userId : targetId !== null)) throw new ShopError('Invalid inventory transaction.');
    return this.#transaction((accounts, items, receipts) => {
      const previous = receipts.get(id);
      if (previous) {
        if (!['guildId', 'userId', 'kind', 'itemId', 'quantity', 'targetId'].every((key) => previous[key] === ({ guildId, userId, kind, itemId, quantity, targetId })[key])) throw new ShopError('Transaction ID conflict.');
        return { ...previous, claimed: false, duplicate: true };
      }
      for (const [key, receipt] of receipts) if (at - Date.parse(receipt.createdAt) > LIMITS.retention) receipts.delete(key);
      if (receipts.size >= LIMITS.receipts) throw new ShopError('Transaction history limit reached.');
      const key = this.#key(guildId, userId); const account = accounts.get(key) || this.#empty(guildId, userId);
      const itemKey = this.#key(guildId, itemId); const item = items.get(itemKey);
      if (!item) throw new ShopError('Shop item not found.');
      const owned = (account.inventory || []).find((entry) => entry.itemId === itemId)?.quantity || 0;
      let total = 0; let balance = account.balance;
      if (kind === 'buy') {
        if (!item.enabled) throw new ShopError('This item is disabled.');
        total = item.price * quantity;
        if (account.balance < total) throw new ShopError('You do not have enough coins.');
        if (item.stock !== null && item.stock < quantity) throw new ShopError('Not enough stock remains.');
        balance -= total;
        accounts.set(key, this.#inventoryAccount(account, itemId, owned + quantity, balance));
        if (item.stock !== null) items.set(itemKey, Object.freeze({ ...item, stock: item.stock - quantity }));
      } else {
        if (owned < quantity) throw new ShopError('You do not own enough of this item.');
        accounts.set(key, this.#inventoryAccount(account, itemId, owned - quantity, balance));
        if (kind === 'gift') {
          const recipientKey = this.#key(guildId, targetId); const recipient = accounts.get(recipientKey) || this.#empty(guildId, targetId);
          const received = (recipient.inventory || []).find((entry) => entry.itemId === itemId)?.quantity || 0;
          accounts.set(recipientKey, this.#inventoryAccount(recipient, itemId, received + quantity, recipient.balance));
        }
      }
      const receipt = Object.freeze({ id, guildId, userId, targetId, kind, itemId, quantity, total, balance, createdAt: new Date(at).toISOString() });
      receipts.set(id, receipt); return { ...receipt, duplicate: false };
    });
  }
  #inventoryAccount(account, itemId, quantity, balance) {
    if (!integer(quantity, 0, LIMITS.quantity)) throw new ShopError('Inventory quantity limit reached.');
    const inventory = (account.inventory || []).filter((entry) => entry.itemId !== itemId).map((entry) => Object.freeze({ ...entry }));
    if (quantity) inventory.push(Object.freeze({ itemId, quantity }));
    return Object.freeze({ ...account, balance, inventory: Object.freeze(inventory) });
  }
  #validateShop(accounts, items, receipts) {
    const counts = new Map();
    if (items.size > MAX_ACCOUNTS || receipts.size > LIMITS.receipts) throw new ShopError('Shop store limit reached.');
    for (const item of items.values()) {
      counts.set(item.guildId, (counts.get(item.guildId) || 0) + 1);
      if (!validItem(item) || counts.get(item.guildId) > LIMITS.items) throw new ShopError('Invalid shop catalog.');
    }
    for (const account of accounts.values()) for (const entry of account.inventory || []) if (!items.has(this.#key(account.guildId, entry.itemId))) throw new ShopError('Inventory references an unknown item.');
    for (const receipt of receipts.values()) if (!validReceipt(receipt) || !items.has(this.#key(receipt.guildId, receipt.itemId))) throw new ShopError('Invalid shop receipt.');
  }
  #key(guildId, userId) { return `${guildId}:${userId}`; }
  #empty(guildId, userId) { return { guildId, userId, balance: 0, lastDaily: null, lastWork: null }; }

  #valid(account) {
    return account && typeof account === 'object' && !Array.isArray(account)
      && Object.keys(account).sort().join(',') === ['balance', 'guildId', 'lastDaily', 'lastWork', 'userId', ...['lastBeg', 'profession', 'inventory'].filter((key) => Object.hasOwn(account, key))].sort().join(',')
      && validId(account.guildId) && validId(account.userId)
      && (!Object.hasOwn(account, 'inventory') || validInventory(account.inventory))
      && Number.isSafeInteger(account.balance) && account.balance >= 0 && account.balance <= MAX_BALANCE
      && (!Object.hasOwn(account, 'lastBeg') || account.lastBeg === null || typeof account.lastBeg === 'string' && Number.isFinite(Date.parse(account.lastBeg)))
      && (!Object.hasOwn(account, 'profession') || account.profession && Object.keys(account.profession).sort().join(',') === 'changedAt,name,works' && PROFESSIONS.includes(account.profession.name)
        && Number.isInteger(account.profession.works) && account.profession.works >= 0 && account.profession.works <= 1000 && typeof account.profession.changedAt === 'string' && Number.isFinite(Date.parse(account.profession.changedAt)))
      && ['lastDaily', 'lastWork'].every((key) => account[key] === null || (typeof account[key] === 'string' && Number.isFinite(Date.parse(account[key]))));
  }

  async #transaction(update) {
    const task = this.queue.then(async () => {
      const accounts = new Map(this.accounts);
      const items = new Map(this.items); const receipts = new Map(this.receipts);
      const result = update(accounts, items, receipts);
      if (result.claimed === false) return result;
      if (accounts.size > MAX_ACCOUNTS || [...accounts.values()].some((account) => !this.#valid(account))) throw new Error('Invalid economy account update.');
      this.#validateShop(accounts, items, receipts);
      const tempPath = `${this.filePath}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`;
      try {
        await fs.mkdir(path.dirname(path.resolve(this.filePath)), { recursive: true });
        const contents = `${JSON.stringify({ version: 2, accounts: [...accounts.values()], items: [...items.values()], receipts: [...receipts.values()] }, null, 2)}\n`;
        if (Buffer.byteLength(contents) > LIMITS.bytes) throw new Error('Economy store exceeds its size limit.');
        await fs.writeFile(tempPath, contents, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
        await fs.rename(tempPath, this.filePath);
        this.accounts = accounts; this.items = items; this.receipts = receipts;
        return result;
      } catch (error) {
        await fs.rm(tempPath, { force: true }).catch(() => {});
        throw error;
      }
    });
    this.queue = task.catch(() => {});
    return task;
  }
}

module.exports = { EconomyStore, MAX_ACCOUNTS, MAX_BALANCE, DAILY_COOLDOWN_MS, WORK_COOLDOWN_MS };
