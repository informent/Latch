'use strict';
const { ShopError, validId } = require('./shop-schema');
function createShopHandler({ config, economy, discord, logger = () => {}, now = () => new Date() }, { response, defer, hasPermission, findOption, safeText }) {
  return async (interaction) => {
    if (!economy) return { immediate: response('The economy store is unavailable.') };
    const subcommand = interaction.data?.options?.[0]; const action = subcommand?.name; const options = subcommand?.options || [];
    if (!['create', 'update', 'enable', 'disable', 'list', 'info', 'buy', 'inventory', 'use', 'gift', 'history'].includes(action)) return { immediate: response('Choose a shop action.') };
    const staff = hasPermission(interaction.member?.permissions, 32n);
    if (['create', 'update', 'enable', 'disable'].includes(action) && !staff) return { immediate: response('You need Manage Server to configure shop items.') };
    const user = interaction.member?.user;
    if (!validId(user?.id) || user.bot) return { immediate: response('Shop commands require a human server member.') };
    const get = (name) => findOption(options, name);
    return { immediate: defer(), work: async () => {
      try {
        const guildId = config.guildId; const itemId = get('item'); let content;
        if (['create', 'update'].includes(action)) {
          const stock = get('stock') ?? -1;
          const saved = await economy.saveItem(action, { guildId, id: itemId, title: get('title'), description: get('description') ?? '', price: get('price'), stock: stock === -1 ? null : stock, enabled: false });
          content = `Saved **${safeText(saved.title)}** (${saved.id}) at ${saved.price} coins. Stock: ${saved.stock ?? 'unlimited'}. ${saved.enabled ? 'Available for purchase.' : 'Disabled; use /shop enable when ready.'}`;
        } else if (['enable', 'disable'].includes(action)) {
          const saved = await economy.enableItem(guildId, itemId, action === 'enable'); content = `Item ${saved.id} ${saved.enabled ? 'enabled' : 'disabled'}. Existing inventory remains usable and giftable.`;
        } else if (action === 'info') {
          const item = economy.item(guildId, itemId);
          if (!item || !item.enabled && !staff) throw new ShopError('Available shop item not found.');
          content = `**${safeText(item.title)}** (${item.id})\n${safeText(item.description)}\nPrice: ${item.price} coins\nStock: ${item.stock ?? 'unlimited'}\nPurchases: ${item.enabled ? 'enabled' : 'disabled'}`;
        } else if (['list', 'inventory', 'history'].includes(action)) {
          const page = get('page') ?? 1;
          if (!Number.isInteger(page) || page < 1 || page > 5000) throw new ShopError('Choose a valid page.');
          const records = action === 'list' ? economy.shop(guildId, { includeDisabled: staff }) : action === 'inventory' ? economy.inventory(guildId, user.id) : economy.history(guildId, user.id);
          const pages = Math.max(1, Math.ceil(records.length / 10));
          if (page > pages) throw new ShopError(`Choose a page from 1 to ${pages}.`);
          const lines = records.slice((page - 1) * 10, page * 10).map((entry) => action === 'list' ? `${entry.id}: ${safeText(entry.title)} | ${entry.price} coins | stock ${entry.stock ?? 'unlimited'}${entry.enabled ? '' : ' | disabled'}` : action === 'inventory' ? `${entry.itemId}: ${safeText(entry.title)} x${entry.quantity}` : `${entry.kind} ${entry.itemId} x${entry.quantity} | ${entry.total} coins${entry.targetId ? ` | ${entry.userId === user.id ? 'to' : 'from'} ${entry.userId === user.id ? entry.targetId : entry.userId}` : ''} | ${entry.createdAt}`);
          content = `**Your ${action === 'list' ? 'server shop' : action}** | page ${page}/${pages}\n${lines.join('\n') || 'No entries yet.'}`;
        } else {
          const raw = get('user'); const targetId = raw && typeof raw === 'object' ? raw.id : raw;
          if (action === 'gift') {
            if (!validId(targetId) || targetId === user.id) throw new ShopError('Choose another human server member.');
            const member = await discord.getGuildMember(guildId, targetId);
            if (member?.user?.id !== targetId || member.user.bot || member.pending) throw new ShopError('Choose a current human member who completed screening.');
          }
          const receipt = await economy.transactItem({ id: interaction.id, guildId, userId: user.id, kind: action, itemId, quantity: get('quantity') ?? 1, targetId: action === 'gift' ? targetId : null }, now());
          content = `${receipt.duplicate ? 'Already recorded; no repeat transaction. ' : ''}${action === 'buy' ? 'Purchased' : action === 'gift' ? 'Gifted' : 'Consumed'} ${receipt.quantity} x ${receipt.itemId}${receipt.targetId ? ` to <@${receipt.targetId}>` : ''}. ${action === 'buy' ? `Cost: ${receipt.total} coins. Balance after purchase: ${receipt.balance}.` : 'Inventory updated.'}\nReceipt: ${receipt.id}`;
        }
        await discord.editOriginalResponse(config.applicationId, interaction.token, { content: content.slice(0, 1900), allowed_mentions: { parse: [] } });
      } catch (error) {
        try { logger('shop_action_failed', { action }); } catch {}
        await discord.editOriginalResponse(config.applicationId, interaction.token, { content: error instanceof ShopError ? error.message : 'Shop action failed. Check server membership and store availability. If a transaction response was lost, check /shop history before retrying.', allowed_mentions: { parse: [] } }).catch(() => {});
      }
    } };
  };
}
module.exports = { createShopHandler };
