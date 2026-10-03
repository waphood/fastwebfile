/**
 * FastWebFile — Telegram Bot & Telegram Web App Controller
 * Zero-dependency Telegram Bot Polling Engine
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const CONFIG_PATH = path.join(__dirname, 'bot_config.json');

function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    }
  } catch {}
  return {
    botToken: '8921742373:AAEGsuPulshO3WN_fTpRI-1zGvyfZzojY4s',
    adminId: 7936378054,
    appUrl: 'http://localhost:3000'
  };
}

function saveConfig(cfg) {
  try {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2));
  } catch (e) {
    console.error('[Bot] Failed to save config:', e.message);
  }
}

let config = loadConfig();

// Stateless HMAC-signed admin session tokens (userId.expires.sig)
function generateAdminToken(userId) {
  const expires = Date.now() + 24 * 3600 * 1000; // 24 hours
  const payload = `${userId}.${expires}`;
  const sig = crypto.createHmac('sha256', config.botToken).update(payload).digest('hex');
  return `${payload}.${sig}`;
}

function validateAdminToken(token) {
  if (!token || typeof token !== 'string') return false;
  const parts = token.split('.');
  if (parts.length !== 3) return false;
  const [userId, expiresStr, sig] = parts;
  const expires = Number(expiresStr);
  if (!expires || Date.now() > expires) return false;
  const payload = `${userId}.${expiresStr}`;
  const expectedSig = crypto.createHmac('sha256', config.botToken).update(payload).digest('hex');
  if (sig !== expectedSig) return false;
  return Number(userId) === Number(config.adminId);
}

function verifyTelegramWebAppData(initDataStr) {
  if (!initDataStr || !config.botToken) return null;
  try {
    const urlParams = new URLSearchParams(initDataStr);
    const hash = urlParams.get('hash');
    if (!hash) return null;
    urlParams.delete('hash');

    const params = Array.from(urlParams.entries())
      .map(([k, v]) => `${k}=${v}`)
      .sort()
      .join('\n');

    const secretKey = crypto.createHmac('sha256', 'WebAppData').update(config.botToken).digest();
    const calculatedHash = crypto.createHmac('sha256', secretKey).update(params).digest('hex');

    if (calculatedHash !== hash) return null;
    const userStr = urlParams.get('user');
    return userStr ? JSON.parse(userStr) : null;
  } catch {
    return null;
  }
}

// Telegram API Client
async function tgCall(method, params = {}) {
  const token = config.botToken;
  if (!token) return null;
  const url = `https://api.telegram.org/bot${token}/${method}`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params)
    });
    const data = await res.json();
    if (!data.ok) {
      console.error(`[Bot] Telegram API error (${method}):`, data.description || data);
    }
    return data;
  } catch (err) {
    console.error(`[Bot] Network error calling ${method}:`, err.message);
    return null;
  }
}

// Setup Menu Button & Scoped Commands (Admin commands ONLY visible to admin ID)
async function setupBotMenu() {
  const isHttps = config.appUrl && config.appUrl.startsWith('https://');

  // 1. Default commands for ALL normal users (only /start)
  await tgCall('setMyCommands', {
    commands: [
      { command: 'start', description: 'Запустить FastWebFile' }
    ],
    scope: { type: 'default' }
  });

  // 2. Secret commands for ADMIN ONLY (chat_id = adminId)
  if (config.adminId) {
    await tgCall('setMyCommands', {
      commands: [
        { command: 'start', description: 'Запустить FastWebFile' },
        { command: 'adm', description: 'Панель управления (модерация)' },
        { command: 'stats', description: 'Статистика сервера' },
        { command: 'clean', description: 'Очистить истекшие файлы' },
        { command: 'seturl', description: 'Установить публичный HTTPS URL' }
      ],
      scope: { type: 'chat', chat_id: Number(config.adminId) }
    });
  }

  // 3. Set bottom chat menu button to WebApp if HTTPS is configured
  if (isHttps) {
    await tgCall('setChatMenuButton', {
      menu_button: {
        type: 'web_app',
        text: 'FastWebFile 📂',
        web_app: { url: config.appUrl }
      }
    });
    console.log(`[Bot] Telegram WebApp Menu Button set to: ${config.appUrl}`);
  }
}

// Polling loop
let isPolling = false;
let lastUpdateId = 0;

async function startBot(getDbStatsCallback, cleanupExpiredCallback) {
  if (isPolling) return;
  isPolling = true;

  console.log(`[Bot] Starting Telegram bot @fastwebfilebot polling...`);
  await setupBotMenu();

  while (isPolling) {
    try {
      const res = await tgCall('getUpdates', {
        offset: lastUpdateId + 1,
        timeout: 10,
        allowed_updates: ['message', 'callback_query']
      });

      if (res && res.ok && Array.isArray(res.result)) {
        for (const update of res.result) {
          lastUpdateId = update.update_id;
          if (update.message) {
            await handleMessage(update.message, getDbStatsCallback, cleanupExpiredCallback);
          }
        }
      }
    } catch (err) {
      console.error('[Bot] Polling loop error:', err.message);
      await new Promise(r => setTimeout(r, 3000));
    }
  }
}

async function handleMessage(msg, getDbStatsCallback, cleanupExpiredCallback) {
  const chatId = msg.chat?.id;
  const fromId = msg.from?.id;
  const text = (msg.text || '').trim();

  if (!chatId) return;

  const isAdmin = Number(fromId) === Number(config.adminId);
  const isHttps = config.appUrl && config.appUrl.startsWith('https://');

  // Command: /start
  if (text.startsWith('/start')) {
    let replyText = `👋 <b>Добро пожаловать в FastWebFile (FWF)!</b>\n\n` +
      `⚡ Мгновенный и безопасный обмен файлами:\n` +
      `• Загрузка до 500 МБ на файл без регистрации\n` +
      `• Скачивание по ссылке, QR-коду или 5-значному PIN\n` +
      `• Самоуничтожение файлов (1 скачивание, 1 или 3 дня)\n` +
      `• Защита паролем и удаление EXIF-метаданных\n` +
      `• Drop-папки (сбор файлов от клиентов и друзей)\n` +
      `• P2P прямая передача больших файлов (50 ГБ+)`;

    const keyboard = [];

    if (isHttps) {
      keyboard.push([
        {
          text: '📂 Открыть FastWebFile (Web App)',
          web_app: { url: config.appUrl }
        }
      ]);
    }

    if (isAdmin) {
      replyText += `\n\n👑 <b>Вы распознаны как Администратор.</b>\nДля перехода в панель управления отправьте команду /adm`;
    }

    const payload = {
      chat_id: chatId,
      text: replyText,
      parse_mode: 'HTML'
    };

    if (keyboard.length > 0) {
      payload.reply_markup = { inline_keyboard: keyboard };
    }

    await tgCall('sendMessage', payload);
    return;
  }

  // Command: /adm (Admin only)
  if (text.startsWith('/adm')) {
    if (!isAdmin) {
      await tgCall('sendMessage', {
        chat_id: chatId,
        text: `⛔ <b>Доступ запрещен.</b>\nЭта команда доступна только владельцу сервиса.`,
        parse_mode: 'HTML'
      });
      return;
    }

    const token = generateAdminToken(fromId);
    const stats = typeof getDbStatsCallback === 'function' ? getDbStatsCallback() : { totalFiles: 0, totalSizeMb: '0', dropCount: 0 };
    const adminUrl = `${config.appUrl}/admin.html?token=${token}`;

    const adminMsg = `🛠 <b>Панель администратора FastWebFile</b>\n\n` +
      `📊 <b>Сводка сервера:</b>\n` +
      `• Файлов на сервере: <b>${stats.totalFiles}</b>\n` +
      `• Занято места: <b>${stats.totalSizeMb} МБ</b>\n` +
      `• Активных Drop-папок: <b>${stats.dropCount}</b>\n\n` +
      `В панели вы можете модерировать файлы, просматривать ссылки, PIN-коды и удалять любые файлы с сервера в 1 клик.`;

    const adminKeyboard = [];

    if (isHttps) {
      adminKeyboard.push([
        {
          text: '🛡 Открыть Админ-панель (Web App)',
          web_app: { url: adminUrl }
        }
      ]);
    } else {
      adminKeyboard.push([
        {
          text: '🛡 Открыть Админ-панель (Браузер)',
          url: adminUrl
        }
      ]);
    }

    await tgCall('sendMessage', {
      chat_id: chatId,
      text: adminMsg,
      parse_mode: 'HTML',
      reply_markup: { inline_keyboard: adminKeyboard }
    });
    return;
  }

  // Command: /seturl <https://...> (Admin only)
  if (text.startsWith('/seturl')) {
    if (!isAdmin) {
      await tgCall('sendMessage', { chat_id: chatId, text: '⛔ Только для администратора.' });
      return;
    }

    const parts = text.split(/\s+/);
    const newUrl = parts[1] ? parts[1].trim() : '';

    if (!newUrl || !newUrl.startsWith('http')) {
      await tgCall('sendMessage', {
        chat_id: chatId,
        text: `❗ <b>Укажите URL.</b> Пример:\n<code>/seturl https://my-fastwebfile.onrender.com</code>\n\n<i>Для Web App Telegram требуется https://</i>`,
        parse_mode: 'HTML'
      });
      return;
    }

    config.appUrl = newUrl.replace(/\/+$/, '');
    saveConfig(config);
    await setupBotMenu();

    await tgCall('sendMessage', {
      chat_id: chatId,
      text: `✅ <b>URL приложения успешно обновлен!</b>\nНовый адрес: <code>${config.appUrl}</code>\n\nКнопка меню бота и команды обновлены.`,
      parse_mode: 'HTML'
    });
    return;
  }

  // Command: /stats (Admin only)
  if (text.startsWith('/stats')) {
    if (!isAdmin) {
      await tgCall('sendMessage', { chat_id: chatId, text: '⛔ Только для администратора.' });
      return;
    }

    const stats = typeof getDbStatsCallback === 'function' ? getDbStatsCallback() : { totalFiles: 0, totalSizeMb: '0', dropCount: 0 };
    const mem = process.memoryUsage();
    const rssMb = (mem.rss / 1024 / 1024).toFixed(1);
    const heapMb = (mem.heapUsed / 1024 / 1024).toFixed(1);
    const uptimeH = (process.uptime() / 3600).toFixed(1);

    const statsText = `📈 <b>Статистика системы:</b>\n\n` +
      `• Всего файлов: <b>${stats.totalFiles}</b>\n` +
      `• Объем uploads: <b>${stats.totalSizeMb} МБ</b>\n` +
      `• Drop-папок: <b>${stats.dropCount}</b>\n` +
      `• RAM (RSS / Heap): <b>${rssMb} MB / ${heapMb} MB</b>\n` +
      `• Время работы (Uptime): <b>${uptimeH} ч.</b>\n` +
      `• Node.js: <b>${process.version}</b>\n` +
      `• WebApp URL: <code>${config.appUrl}</code>`;

    await tgCall('sendMessage', {
      chat_id: chatId,
      text: statsText,
      parse_mode: 'HTML'
    });
    return;
  }

  // Command: /clean (Admin only)
  if (text.startsWith('/clean')) {
    if (!isAdmin) {
      await tgCall('sendMessage', { chat_id: chatId, text: '⛔ Только для администратора.' });
      return;
    }

    let cleaned = 0;
    if (typeof cleanupExpiredCallback === 'function') {
      cleaned = cleanupExpiredCallback();
    }

    await tgCall('sendMessage', {
      chat_id: chatId,
      text: `🧹 Очистка завершена! Удалено истекших файлов: <b>${cleaned}</b>`,
      parse_mode: 'HTML'
    });
    return;
  }
}

module.exports = {
  startBot,
  validateAdminToken,
  verifyTelegramWebAppData,
  getConfig: () => config,
  generateAdminToken
};
