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
  GUILD_ID,
  VERIFY_ROLE_ID,
  VERIFY_CODE
} = process.env;

function normalize(s) { return (s||'').trim().toLowerCase(); }

async function startDMVerifyFlow(user, guildIdForContext) {
  
  const guild = await client.guilds.fetch(guildIdForContext || GUILD_ID).catch(()=>null);
  if (!guild) throw new Error('GUILD_NOT_FOUND');

  
  const me = await guild.members.fetch(client.user.id);
  const targetRole = guild.roles.cache.get(VERIFY_ROLE_ID);
  if (!targetRole) throw new Error('VERIFY_ROLE_NOT_FOUND');
  if (!me.permissions.has(PermissionFlagsBits.ManageRoles)) throw new Error('BOT_MISSING_MANAGE_ROLES');
  if (targetRole.position >= me.roles.highest.position) throw new Error('ROLE_ORDER_TOO_HIGH');

  // DM ask code
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
      if (!ok) {
        await dm.send('❌ Sai mã, thử lại nha.');
        return;
      }
      try {
        const member = await guild.members.fetch(user.id);

        
        if (member.pending) {
          await dm.send('⚠️ M cần **Accept Rules / Screening** trong server trước, rồi gõ lại /verify hoặc !verify nha.');
          return; 
        }

        await member.roles.add(VERIFY_ROLE_ID);

        // re-fetch & re-check
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
        dm.send('⌛ Hết thời gian, gõ lại /verify hoặc !verify trong server để thử lại.').catch(()=>{});
        resolve(false);
      }
    });
  });
}


client.on(Events.InteractionCreate, async (i) => {
  if (!i.isChatInputCommand() || i.commandName !== 'verify') return;
  await i.reply({ content: '📩 Check DMs nhé!', ephemeral: true });
  try {
    await startDMVerifyFlow(i.user, i.guildId);
  } catch (e) {
    console.error('DM flow error (slash):', e);
    await i.followUp({ content: '❗Không thể bắt đầu DM. Kiểm tra xem đã bật “Allow DMs from server members/Cho phép DM từ các thành viên máy chủ khác" chưa nhé..', ephemeral: true });
  }
});


client.on(Events.MessageCreate, async (msg) => {
  if (!msg.guild || msg.author.bot) return;
  if (normalize(msg.content) !== '!verify') return;

  
  if (msg.channel.permissionsFor(client.user.id)?.has(PermissionFlagsBits.ManageMessages)) {
    msg.delete().catch(()=>{});
  }

  try {
    await startDMVerifyFlow(msg.author, msg.guild.id);
  } catch (e) {
    console.error('DM flow error (!verify):', e);
    
    try {
      const dm = await msg.author.createDM();
      await dm.send('❗Không thể bắt đầu DM. Kiểm tra xem đã bật “Allow DMs from server members/Cho phép DM từ các thành viên máy chủ khác" chưa nhé.');
    } catch {}
  }
});

client.once(Events.ClientReady, () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
});

// ====== ENV & TOKEN CHECK ======
const raw = process.env.DISCORD_TOKEN ?? '';
const TOKEN = raw.trim();

// log nhẹ cho chắc không lộ secret
console.log('🔎 ENV sanity:', {
  hasToken: !!TOKEN,
  tokenLen: TOKEN.length,
  hasNewline: /\r|\n/.test(TOKEN),
});

// format phải có 3 phần, ngăn bởi 2 dấu chấm
const tokenOk = /^[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+$/.test(TOKEN);
if (!tokenOk) {
  console.error('❌ DISCORD_TOKEN rỗng/không đúng format (không đủ 3 phần). Check lại Variables trên Railway.');
  process.exit(1);
}

// giải mã phần 1 để so ID
try {
  const first = TOKEN.split('.')[0];
  const decodedId = Buffer.from(first, 'base64').toString('utf8');
  console.log('🆔 Token says ID =', decodedId, ' | CLIENT_ID =', process.env.CLIENT_ID);

  if (decodedId !== process.env.CLIENT_ID) {
    console.error('❌ Token KHÔNG thuộc cùng app (CLIENT_ID mismatch). M đang dán token của app/bot khác rồi.');
    process.exit(1);
  }
} catch (e) {
  console.error('❌ Không decode được phần đầu token:', e.message);
  process.exit(1);
}

client.login(TOKEN);

