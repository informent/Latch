'use strict';
const ID = /^\d{5,25}$/;
class ShopError extends Error {}
const SLUG = /^[a-z0-9][a-z0-9-]{0,31}$/;
const LIMITS = Object.freeze({ items: 100, quantity: 10000, receipts: 50000, bytes: 32 * 1024 * 1024, retention: 7 * 86400000 });
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).sort().join(',') === keys.split(',').sort().join(',');
const validId = (id) => typeof id === 'string' && ID.test(id);
const validSlug = (slug) => typeof slug === 'string' && SLUG.test(slug);
const integer = (n, min, max) => Number.isSafeInteger(n) && n >= min && n <= max;
function validItem(item) {
  return exact(item, 'guildId,id,title,description,price,stock,enabled') && validId(item.guildId) && validSlug(item.id)
    && typeof item.title === 'string' && item.title.trim().length > 0 && item.title.length <= 80
    && typeof item.description === 'string' && item.description.length <= 300
    && integer(item.price, 1, 1000000) && (item.stock === null || integer(item.stock, 0, 1000000)) && typeof item.enabled === 'boolean';
}
function validInventory(inventory) {
  return Array.isArray(inventory) && inventory.length <= LIMITS.items && new Set(inventory.map((entry) => entry?.itemId)).size === inventory.length
    && inventory.every((entry) => exact(entry, 'itemId,quantity') && validSlug(entry.itemId) && integer(entry.quantity, 1, LIMITS.quantity));
}
function validReceipt(receipt) {
  return exact(receipt, 'id,guildId,userId,targetId,kind,itemId,quantity,total,balance,createdAt')
    && [receipt.id, receipt.guildId, receipt.userId].every(validId) && (receipt.targetId === null || validId(receipt.targetId))
    && ['buy', 'gift', 'use'].includes(receipt.kind) && validSlug(receipt.itemId) && integer(receipt.quantity, 1, 100)
    && integer(receipt.total, 0, 100000000) && integer(receipt.balance, 0, 9000000000000000)
    && (receipt.kind !== 'buy' || receipt.total % receipt.quantity === 0 && integer(receipt.total / receipt.quantity, 1, 1000000))
    && (receipt.kind === 'gift' ? receipt.targetId !== null && receipt.targetId !== receipt.userId && receipt.total === 0 : receipt.targetId === null)
    && (receipt.kind !== 'use' || receipt.total === 0)
    && typeof receipt.createdAt === 'string' && Number.isFinite(Date.parse(receipt.createdAt));
}
module.exports = { ShopError, LIMITS, exact, validId, validSlug, integer, validItem, validInventory, validReceipt };
