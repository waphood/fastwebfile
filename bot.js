/**
 * FastWebFile — Telegram Bot & Telegram Web App Controller
 * Zero-dependency Telegram Bot Polling Engine
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const CONFIG_PATH = path.join(__dirname, 'bot_config.json');

function loadConfig() {
  let cfg = {
    botToken: process.env.BOT_TOKEN || '8921742373:AAEGsuPulshO3WN_fTpRI-1zGvyfZzojY4s',
    adminId: Number(process.env.ADMIN_ID) || 7936378054,
    appUrl: process.env.RENDER_EXTERNAL_URL || (process.env.RENDER_EXTERNAL_HOSTNAME ? `https://${process.env.RENDER_EXTERNAL_HOSTNAME}` : (process.env.APP_URL || '')),
    disableLocalPolling: true
  };

  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const fileCfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
      // Clean dead tunnel / localhost URLs
      if (fileCfg.appUrl && (fileCfg.appUrl.includes('serveousercontent') || fileCfg.appUrl.includes('localhost') || fileCfg.appUrl.includes('pinggy'))) {
        delete fileCfg.appUrl;
      }
      cfg = { ...cfg, ...fileCfg };
    }
  } catch {}

  // If running on Render, always prioritize Render's actual hostname/URL
  if (process.env.RENDER_EXTERNAL_URL) {
    cfg.appUrl = process.env.RENDER_EXTERNAL_URL.replace(/\/+$/, '');
  } else if (process.env.RENDER_EXTERNAL_HOSTNAME) {
    cfg.appUrl = `https://${process.env.RENDER_EXTERNAL_HOSTNAME}`.replace(/\/+$/, '');
  }

  return cfg;
}

function saveConfig(cfg) {
  try {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2));
  } catch (e) {
    console.error('[Bot] Failed to save config:', e.message);
  }
}

let config = loadConfig();

function updateAppUrl(newUrl) {
  if (!newUrl || !newUrl.startsWith('https://')) return;
  const cleanUrl = newUrl.replace(/\/+$/, '');
  if (config.appUrl === cleanUrl) return;
  console.log(`[Bot] Auto-detected live HTTPS URL: ${cleanUrl}`);
  config.appUrl = cleanUrl;
  saveConfig(config);
  setupBotMenu().catch(e => console.error('[Bot] Failed to refresh menu with new URL:', e.message));
}

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
      // Do not log 409 Conflict during getUpdates as an error; polling handles it gracefully
      if (!(method === 'getUpdates' && data.error_code === 409)) {
        console.error(`[Bot] Telegram API error (${method}):`, data.description || data);
      }
    }
    return data;
  } catch (err) {
    if (isPolling) {
      console.error(`[Bot] Network error calling ${method}:`, err.message);
    }
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

// Polling loop with graceful shutdown & 409 conflict handling
let isPolling = false;
let pollingAbort = false;
let lastUpdateId = 0;

function stopBot() {
  if (isPolling) {
    console.log('[Bot] Stopping Telegram bot polling...');
    isPolling = false;
    pollingAbort = true;
  }
}

async function startBot(getDbStatsCallback, cleanupExpiredCallback) {
  // If running locally on development machine and disableLocalPolling is set, skip
  const isCloud = !!(process.env.RENDER || process.env.RENDER_EXTERNAL_HOSTNAME || process.env.NODE_ENV === 'production');
  if (!isCloud && config.disableLocalPolling) {
    console.log('[Bot] Local bot polling disabled (running on local dev machine). Cloud Render service handles updates.');
    return;
  }

  if (isPolling) return;
  isPolling = true;
  pollingAbort = false;

  console.log(`[Bot] Starting Telegram bot polling... (Admin ID: ${config.adminId})`);
  await setupBotMenu();

  while (isPolling && !pollingAbort) {
    try {
      const res = await tgCall('getUpdates', {
        offset: lastUpdateId + 1,
        timeout: 15,
        allowed_updates: ['message', 'callback_query']
      });

      if (pollingAbort || !isPolling) break;

      if (!res) {
        await new Promise(r => setTimeout(r, 3000));
        continue;
      }

      if (!res.ok) {
        // Handle 409 Conflict gracefully (e.g. during Render zero-downtime rolling container deploy)
        if (res.error_code === 409) {
          console.log('[Bot] 409 Conflict: waiting for previous container/instance to shut down (retrying in 5s)...');
          await new Promise(r => setTimeout(r, 5000));
          continue;
        }
        await new Promise(r => setTimeout(r, 3000));
        continue;
      }

      if (Array.isArray(res.result)) {
        for (const update of res.result) {
          if (!isPolling || pollingAbort) break;
          lastUpdateId = update.update_id;
          if (update.message) {
            await handleMessage(update.message, getDbStatsCallback, cleanupExpiredCallback);
          }
        }
      }
    } catch (err) {
      if (!pollingAbort) {
        console.error('[Bot] Polling loop error:', err.message);
      }
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
      `• P2P прямая передача больших файлов (50 ГБ+)\n` +
      `• Air (Wi-Fi) — моментальный AirDrop в 1 клик между устройствами`;

    const keyboard = [];

    if (isHttps) {
      keyboard.push([
        {
          text: '📂 Открыть FastWebFile (Web App)',
          web_app: { url: config.appUrl }
        }
      ]);
      keyboard.push([
        {
          text: '📡 Открыть Air (Wi-Fi AirDrop)',
          web_app: { url: `${config.appUrl}/air` }
        }
      ]);
    } else {
      replyText += `\n\n<i>⚠️ WebApp URL еще не настроен. Откройте сайт в браузере или настройте /seturl.</i>`;
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

    const stats = typeof getDbStatsCallback === 'function' ? getDbStatsCallback() : { totalFiles: 0, totalSizeMb: '0', dropCount: 0 };

    if (!isHttps) {
      await tgCall('sendMessage', {
        chat_id: chatId,
        text: `🛠 <b>Панель администратора FastWebFile</b>\n\n` +
              `⚠️ <b>HTTPS URL сервиса еще не определен</b> (текущий: <code>${config.appUrl || 'не задан'}</code>).\n\n` +
              `Чтобы подключить WebApp, отправьте адрес вашего проекта на Render:\n` +
              `<code>/seturl https://ваш-проект.onrender.com</code>\n\n` +
              `<i>После этого кнопка админки сразу заработает!</i>`,
        parse_mode: 'HTML'
      });
      return;
    }

    const token = generateAdminToken(fromId);
    const adminUrl = `${config.appUrl}/admin.html?token=${token}`;

    const adminMsg = `🛠 <b>Панель администратора FastWebFile</b>\n\n` +
      `📊 <b>Сводка сервера:</b>\n` +
      `• Файлов на сервере: <b>${stats.totalFiles}</b>\n` +
      `• Занято места: <b>${stats.totalSizeMb} МБ</b>\n` +
      `• Активных Drop-папок: <b>${stats.dropCount}</b>\n` +
      `• Сервер: <code>${config.appUrl}</code>\n\n` +
      `В панели вы можете модерировать файлы, просматривать ссылки, PIN-коды и удалять любые файлы с сервера в 1 клик.`;

    const adminKeyboard = [
      [
        {
          text: '🛡 Открыть Админ-панель (Web App)',
          web_app: { url: adminUrl }
        }
      ],
      [
        {
          text: '🌐 Открыть в обычном браузере',
          url: adminUrl
        }
      ]
    ];

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
        text: `ℹ️ <b>Настройка адреса WebApp</b>\n\n` +
              `Текущий адрес: <code>${config.appUrl || 'не настроен'}</code>\n\n` +
              `Чтобы обновить адрес сервиса (например, с Render), отправьте:\n` +
              `<code>/seturl https://ваш-проект.onrender.com</code>`,
        parse_mode: 'HTML'
      });
      return;
    }

    config.appUrl = newUrl.replace(/\/+$/, '');
    saveConfig(config);
    await setupBotMenu();

    const token = generateAdminToken(fromId);
    const testAdminUrl = `${config.appUrl}/admin.html?token=${token}`;

    await tgCall('sendMessage', {
      chat_id: chatId,
      text: `✅ <b>URL приложения успешно обновлен!</b>\nНовый адрес: <code>${config.appUrl}</code>\n\nКнопка меню бота и команды обновлены.`,
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          [{ text: '🛡 Проверить Админку', web_app: { url: testAdminUrl } }],
          [{ text: '📂 Проверить FastWebFile', web_app: { url: config.appUrl } }]
        ]
      }
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
      `• WebApp URL: <code>${config.appUrl || 'не настроен'}</code>`;

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
  stopBot,
  updateAppUrl,
  validateAdminToken,
  verifyTelegramWebAppData,
  getConfig: () => config,
  generateAdminToken
};
