// index.js
import 'dotenv/config';
import {
  Client, GatewayIntentBits, Partials, Events, PermissionFlagsBits
} from 'discord.js';

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.MessageContent
  ],
  partials: [Partials.Channel]
});

const {
  DISCORD_TOKEN,
  CLIENT_ID,
  GUILD_ID,
  VERIFY_ROLE_ID,
  VERIFY_CODE,
  CHANNEL_ID_VERIFY     // ← ID kênh verify (env trên Railway)
} = process.env;

function normalize(s) { return (s || '').trim().toLowerCase(); }

async function startDMVerifyFlow(user, guildIdForContext) {
  const guild = await client.guilds.fetch(guildIdForContext || GUILD_ID).catch(() => null);
  if (!guild) throw new Error('GUILD_NOT_FOUND');

  const me = await guild.members.fetch(client.user.id);
  const targetRole = guild.roles.cache.get(VERIFY_ROLE_ID);
  if (!targetRole) throw new Error('VERIFY_ROLE_NOT_FOUND');
  if (!me.permissions.has(PermissionFlagsBits.ManageRoles)) throw new Error('BOT_MISSING_MANAGE_ROLES');
  if (targetRole.position >= me.roles.highest.position) throw new Error('ROLE_ORDER_TOO_HIGH');

  // Nếu đã có role → báo & dừng
  try {
    const existed = await guild.members.fetch(user.id);
    if (existed.roles.cache.has(VERIFY_ROLE_ID)) {
      const dm0 = await user.createDM();
      await dm0.send('ℹ️ **Bạn đã được cấp role sẵn, không cần verify lại.**');
      return true;
    }
  } catch { /* ignore */ }

  // Hỏi mã trong DM
  const dm = await user.createDM();
  await dm.send('Nhập mã xác minh của bạn (bạn có 180 giây):');

  return new Promise((resolve) => {
    const collector = dm.createMessageCollector({
      filter: (m) => m.author.id === user.id,
      time: 180_000,
      max: 3
    });

    collector.on('collect', async (msg) => {
      const ok = normalize(msg.content) === normalize(VERIFY_CODE);
      if (!ok) { await dm.send('❌ Sai mã, thử lại nha.'); return; }

      try {
        const member = await guild.members.fetch(user.id);

        if (member.pending) {
          await dm.send('⚠️ Bạn cần **Accept Rules / Screening** trong server trước, rồi gõ lại /verify hoặc !verify nha.');
          return;
        }

        await member.roles.add(VERIFY_ROLE_ID);

        const updated = await guild.members.fetch(user.id);
        if (updated.roles.cache.has(VERIFY_ROLE_ID)) {
          await dm.send('✅ Xác minh thành công! Role đã được cấp.');
          collector.stop('verified');
          resolve(true);
        } else {
          await dm.send('❌ Add role có vẻ không thành công. Kiểm tra lại quyền bot/role order/screening nhé.');
        }
      } catch (err) {
        console.error('Add role error:', err);
        await dm.send(`❌ Lỗi khi cấp role: \`${err.code || err.message}\`. Hãy kiểm tra **Manage Roles / role order / screening**.`);
      }
    });

    collector.on('end', async (_, reason) => {
      if (reason !== 'verified') {
        dm.send('⌛ Hết thời gian, gõ lại /verify hoặc !verify trong server để thử lại.').catch(() => {});
        resolve(false);
      }
    });
  });
}

// =============== Slash Command (/verify) ===============
client.on(Events.InteractionCreate, async (i) => {
  if (!i.isChatInputCommand() || i.commandName !== 'verify') return;

  // Chỉ cho dùng trong kênh verify (nếu đã set env)
  if (CHANNEL_ID_VERIFY && i.channelId !== CHANNEL_ID_VERIFY) {
    return i.reply({
      content: `⚠️ Lệnh này chỉ dùng trong <#${CHANNEL_ID_VERIFY}> nha!`,
      flags: 64
    });
  }

  // Đã có role → báo luôn, khỏi mở DM
  try {
    const guild = await client.guilds.fetch(i.guildId);
    const member = await guild.members.fetch(i.user.id);
    if (member.roles.cache.has(VERIFY_ROLE_ID)) {
      return i.reply({ content: 'ℹ️ **Bạn đã có role sẵn rồi, không cần verify lại đâu nha.**', flags: 64 });
    }
  } catch {}

  await i.reply({ content: '📩 Check DMs nhé!', flags: 64 });
  try {
    await startDMVerifyFlow(i.user, i.guildId);
  } catch (e) {
    console.error('DM flow error (slash):', e);
    await i.followUp({ content: '❗Không thể bắt đầu DM. Kiểm tra xem đã bật “Allow DMs from server members” chưa nhé.', flags: 64 });
  }
});

// =============== Message Command (!verify) ===============
client.on(Events.MessageCreate, async (msg) => {
  if (!msg.guild || msg.author.bot) return;

  // Xoá mọi tin nhắn mới trong kênh verify (từ giờ trở đi)
  if (CHANNEL_ID_VERIFY && msg.channel.id === CHANNEL_ID_VERIFY) {
    if (msg.channel.permissionsFor(client.user.id)?.has(PermissionFlagsBits.ManageMessages)) {
      msg.delete().catch(() => {});
    }
  }

  // Chỉ xử lý !verify trong đúng kênh
  if (normalize(msg.content) !== '!verify') return;
  if (CHANNEL_ID_VERIFY && msg.channel.id !== CHANNEL_ID_VERIFY) return;

  try {
    const member = await msg.guild.members.fetch(msg.author.id);
    if (member.roles.cache.has(VERIFY_ROLE_ID)) {
      const dm = await msg.author.createDM();
      await dm.send('ℹ️ **Bạn đã được cấp role sẵn, không cần verify lại.**');
      return;
    }
  } catch {}

  try {
    await startDMVerifyFlow(msg.author, msg.guild.id);
  } catch (e) {
    console.error('DM flow error (!verify):', e);
    try {
      const dm = await msg.author.createDM();
      await dm.send('❗Không thể bắt đầu DM. Kiểm tra xem đã bật “Allow DMs from server members” chưa nhé.');
    } catch {}
  }
});

// =============== Ready & Token Sanity ===============
client.once(Events.ClientReady, () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
});

const raw = DISCORD_TOKEN ?? '';
const TOKEN = raw.trim();

console.log('🔎 ENV sanity:', {
  hasToken: !!TOKEN,
  tokenLen: TOKEN.length,
  hasNewline: /\r|\n/.test(TOKEN),
});

const tokenOk = /^[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+$/.test(TOKEN);
if (!tokenOk) {
  console.error('❌ DISCORD_TOKEN rỗng/không đúng format. Check lại Variables trên Railway.');
  process.exit(1);
}

try {
  const first = TOKEN.split('.')[0];
  const decodedId = Buffer.from(first, 'base64').toString('utf8');
  console.log('🆔 Token says ID =', decodedId, ' | CLIENT_ID =', CLIENT_ID);
  if (decodedId !== CLIENT_ID) {
    console.error('❌ Token KHÔNG thuộc cùng app (CLIENT_ID mismatch).');
    process.exit(1);
  }
} catch (e) {
  console.error('❌ Không decode được token:', e.message);
  process.exit(1);
}

client.login(TOKEN);
