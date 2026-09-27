// === CONFIG ===
const BOT_TOKEN = '8727223928:AAHCu-jJhFWmyqY4r0iUPWOJD445SbZNa9o';
const GEMINI_API_KEY = 'AQ.Ab8RN6LXnqN9L-Lj1V_ltNLKsrbs_CCmKaQas3CnXXl3L9FirQ';

const CHAT_ID = '-1004379161096';              // supergroup ID
const TOPIC_ID = 3;                           // default topic for deadlines
const TOPIC_REQUESTS_ID = 4;                  // topic for team invitations
const WEB_APP_TELEGRAM_LINK = 'https://lssmlbb1-design.github.io/class-hub/';

const SPREADSHEET_ID = '1ygTKJmW_9GWwPspc1RY2yJjvfI8WT5XsFf2NNZuAT_M';

// Your deployed /exec URL
const WEBHOOK_URL = 'https://script.google.com/macros/s/AKfycbxwvJdHq7pDG6YGRs8Z_2yyeyCOUW7RLJEyevZEWE-KE-TDZCI3mU5tdqMGPQUR7ucR/exec';

// Optional shared secret
const WEBHOOK_SECRET = '1234899384';

const SCHEDULE_ANCHOR_MONDAY = '2026-09-07';
const SCHEDULE_ANCHOR_WEEK_TYPE = 1;
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// Sheet names reference
const SHEET_NAMES = {
  deadlines: 'Deadlines',
  groups: 'Groups',
  syllabus: 'Syllabus',
  projects: 'Projects',
  studentProjects: 'Student_Projects',
  homeworkPool: 'Homework_Pool',
  schedule: 'Schedule'
};

const CONFIG = {
  TEAM_FORM_ID: '1ygTKJmW_9GWwPspc1RY2yJjvfI8WT5XsFf2NNZuAT_M',
  SHEETS: {
    DEADLINES: 'Deadlines',
    PROJECTS: 'Projects',
    STUDENT_PROJECTS: 'Student_Projects',
    RESPONSES_DEADLINES: 'Form Responses 1',
    RESPONSES_PROJECTS: 'Form Responses 2'
  }
};

// ============================================================
// doGet — API для Mini App / Сайта
// ============================================================

function doGet(e) {
  try {
    updateExpiredStatuses();

    const action = (e && e.parameter && e.parameter.action) || 'getAll';
    let payload;
    
    switch (action) {
      case 'getDeadlines': 
      case 'getSchedule': 
        payload = { schedule: getSheetData(SHEET_NAMES.deadlines) }; 
        break;
      case 'getGroups': 
        payload = { groups: getSheetData(SHEET_NAMES.groups) }; 
        break;
      case 'getSyllabus': 
        payload = { syllabus: getSheetData(SHEET_NAMES.syllabus) }; 
        break;
      case 'getProjects': 
        payload = { projects: getSheetData(SHEET_NAMES.projects).filter(p => p.Status !== 'Expired' && p.Status !== 'Archived') }; 
        break;
      case 'getProjectsWithStudents': {
        const projects = getSheetData(SHEET_NAMES.projects);
        const students = getSheetData(SHEET_NAMES.studentProjects);
        
        const result = projects.map(p => {
          const members = students
            .filter(s => String(s.Project_Name).trim().toLowerCase() === String(p.Project_Name).trim().toLowerCase())
            .map(s => s.Student_Name);
          return {
            id: p.Project_ID,
            subject: p.Subject,
            name: p.Project_Name,
            deadline: p.Deadline,
            maxCapacity: Number(p.Max_Capacity) || 0,
            currentCount: members.length,
            telegramLink: p.Telegram_Msg_Link || '',
            status: p.Status || 'Active',
            members: members
          };
        });
        payload = { projects: result };
        break;
      }
      case 'getAll': {
        const deadlines = getSheetData(SHEET_NAMES.deadlines);
        payload = {
          deadlines: deadlines,
          schedule: deadlines,
          groups: getSheetData(SHEET_NAMES.groups),
          syllabus: getSheetData(SHEET_NAMES.syllabus),
          projects: getSheetData(SHEET_NAMES.projects)
        };
        break;
      }
      default: payload = { error: 'Unknown action: ' + action };
    }
    return jsonResponse({ ok: true, data: payload, updatedAt: new Date().toISOString() });
  } catch (err) {
    Logger.log('doGet error: ' + err);
    return jsonResponse({ ok: false, error: err.message });
  }
}

function getSheetData(sheetName) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName(sheetName);
  if (!sheet) return [];
  
  const values = sheet.getDataRange().getValues();
  if (values.length < 2) return [];
  
  const headers = values[0].map(h => String(h).trim());
  const rows = [];
  
  for (let i = 1; i < values.length; i++) {
    // Пропускаем полностью пустые строки
    if (values[i].every(c => c === '' || c === null)) continue;
    
    const obj = {};
    headers.forEach((h, idx) => {
      let v = values[i][idx];
      if (v instanceof Date) {
        v = Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd');
      }
      obj[h] = v;
    });
    rows.push(obj);
  }
  return rows;
}

function jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// ============================================================
// doPost — Telegram Webhook Handler
// ============================================================

function doPost(e) {
  const responseOK = ContentService.createTextOutput('OK').setMimeType(ContentService.MimeType.TEXT);
  
  try {
    if (!e || !e.postData || !e.postData.contents) return responseOK;

    // Проверка безопасности: валидация токена
    if (WEBHOOK_SECRET && e.parameter && e.parameter.token !== WEBHOOK_SECRET) {
      Logger.log('Invalid webhook token');
      return responseOK;
    }

    const update = JSON.parse(e.postData.contents);
    
    // Обработка обычных сообщений
    const msg = update.message || update.edited_message;
    if (msg && msg.text && !msg.from.is_bot) {
      handleTextMessage(msg);
      return responseOK;
    }

    // Обработка нажатий на Inline кнопки
    const cq = update.callback_query;
    if (cq && cq.data) {
      handleCallbackQuery(cq);
      return responseOK;
    }

  } catch (err) {
    Logger.log('doPost error: ' + err.toString());
  }

  return responseOK;
}

// ============================================================
// Text Message Handler (with admin commands)
// ============================================================

function handleTextMessage(msg) {
  const text = msg.text.trim();
  const chatId = msg.chat.id;
  const threadId = msg.message_thread_id || null;
  const messageId = msg.message_id;

  // Обработка admin команд, начинающихся с '='
  if (text.startsWith('=')) {
    handleAdminCommand(text, chatId, threadId, messageId);
    return;
  }

  // Реакция на команду /start
  if (text === '/start' || text === '/help') {
    sendTelegramMessage(chatId, threadId, 
      '👋 Привет! Я бот Class Hub.\n\nЗайди на наш сайт, чтобы посмотреть актуальные дедлайны, проекты и расписание:',
      [[{ text: '📱 Открыть Class Hub', url: WEB_APP_TELEGRAM_LINK }]]
    );
    return;
  }

  // Реакция на ключевые слова
  const lowerText = text.toLowerCase();
  if (lowerText.includes('дедлайн') || lowerText.includes('проект') || lowerText.includes('домашка') || lowerText.includes('сдать')) {
    sendTelegramMessage(chatId, threadId, 
      '📅 Все актуальные дедлайны и проекты доступны на сайте Class Hub!',
      [[{ text: '🔗 Перейти к дедлайнам', url: WEB_APP_TELEGRAM_LINK }]]
    );
    return;
  }
}

// ============================================================
// Admin Commands Handler (= команды)
// ============================================================

function handleAdminCommand(text, chatId, threadId, messageId) {
  const parts = text.split(/\s+/);
  const command = parts[0].toLowerCase();

  // =remove или =kick: удалить из команды
  if (command === '=remove' || command === '=kick') {
    const projectName = parts.slice(1).join(' ');
    if (!projectName) {
      sendTelegramReply(chatId, threadId, '❌ Укажите название проекта: =remove [Название проекта]', [], messageId);
      return;
    }

    const lock = LockService.getScriptLock();
    try {
      lock.waitLock(10000);
      
      const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
      const projSheet = ss.getSheetByName(SHEET_NAMES.projects);
      const projData = projSheet.getDataRange().getValues();
      
      let projectRow = -1;
      let currentCount = 0;

      for (let i = 1; i < projData.length; i++) {
        if (String(projData[i][1]).trim().toLowerCase() === projectName.toLowerCase()) {
          projectRow = i;
          currentCount = Number(projData[i][4]) || 0;
          break;
        }
      }

      if (projectRow === -1) {
        sendTelegramReply(chatId, threadId, '❌ Проект не найден: ' + esc(projectName), [], messageId);
        return;
      }

      const newCount = Math.max(0, currentCount - 1);
      projSheet.getRange(projectRow + 1, 5).setValue(newCount);
      
      sendTelegramReply(chatId, threadId, 
        '✅ Количество участников в проекте «' + esc(projectName) + '» уменьшено на 1.\nТекущее значение: ' + newCount, 
        [], 
        messageId
      );

    } catch (err) {
      Logger.log('Admin command error: ' + err);
      sendTelegramReply(chatId, threadId, '❌ Ошибка при выполнении команды.', [], messageId);
    } finally {
      lock.releaseLock();
    }
  }
}

// ============================================================
// Team Invitation System
// ============================================================

function sendTeamInvite(studentName, leaderName, subject, projectName) {
  const inviteMessage = '📩 <b>' + esc(studentName) + '</b>, пользователь <b>' + esc(leaderName) + 
    '</b> хочет добавить вас в свою команду по предмету <b>' + esc(subject) + 
    '</b> в проект «<b>' + esc(projectName) + '</b>».\n\n' +
    'Примите или отклоните приглашение:';

  const buttons = [
    [
      { text: '✅ Согласиться', callback_data: 'acc:' + encodeURIComponent(studentName) + ':' + encodeURIComponent(projectName) },
      { text: '❌ Отказаться', callback_data: 'rej:' + encodeURIComponent(studentName) + ':' + encodeURIComponent(projectName) }
    ]
  ];

  sendTelegramMessage(CHAT_ID, TOPIC_REQUESTS_ID, inviteMessage, buttons);
}

// ============================================================
// Callback Query Handler (Invite Responses)
// ============================================================

function handleCallbackQuery(cq) {
  const callbackId = cq.id;
  const data = cq.data || '';
  const parts = data.split(':');

  // Обработка приглашений в команду
  if (parts[0] === 'acc' || parts[0] === 'rej') {
    handleInviteCallback(cq);
    return;
  }

  // Обработка старой системы (enroll)
  if (parts[0] === 'enroll') {
    handleCallbackQueryEnroll(cq);
    return;
  }
}

// === ОБРАБОТКА КНОПКИ СОГЛАСИЯ В TELEGRAM ===
function handleInviteCallback(cq) {
  const data = cq.data || '';
  const parts = data.split(':');
  if (parts.length < 3) return;

  const action = parts[0];       // acc или rej
  const studentName = parts[1];
  const projectName = parts[2];

  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);

    if (action === 'rej') {
      answerCallback(cq.id, 'Вы отклонили приглашение.', true);
      editTelegramMessage(cq.message.chat.id, cq.message.message_id, `❌ <b>${esc(studentName)}</b> отклонил(а) приглашение в проект <b>«${esc(projectName)}»</b>.`);
      return;
    }

    if (action === 'acc') {
      const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
      const projSheet = ss.getSheetByName('Projects');
      if (!projSheet) {
        answerCallback(cq.id, 'Ошибка: Вкладка Projects не найдена!', true);
        return;
      }

      const projData = projSheet.getDataRange().getValues();
      let rowIndex = -1;

      for (let i = 1; i < projData.length; i++) {
        if (String(projData[i][1]).trim().toLowerCase() === String(projectName).trim().toLowerCase()) {
          rowIndex = i;
          break;
        }
      }

      if (rowIndex === -1) {
        answerCallback(cq.id, '❌ Проект не найден.', true);
        return;
      }

      const maxCap = Number(projData[rowIndex][3]) || 0;
      const curCount = Number(projData[rowIndex][4]) || 0;
      let membersStr = String(projData[rowIndex][5] || '').trim();

      if (curCount >= maxCap) {
        answerCallback(cq.id, '⚠️ В проекте больше нет свободных мест!', true);
        editTelegramMessage(cq.message.chat.id, cq.message.message_id, `⚠️ Приглашение для <b>${esc(studentName)}</b> недействительно: проект <b>«${esc(projectName)}»</b> уже заполнен.`);
        return;
      }

      // Добавляем участника в список
      let membersList = membersStr ? membersStr.split(',').map(s => s.trim()) : [];
      if (!membersList.includes(studentName)) {
        membersList.push(studentName);
      }

      // Обновляем Current_Count (колонка 5) и Members (колонка 6)
      projSheet.getRange(rowIndex + 1, 5).setValue(membersList.length);
      projSheet.getRange(rowIndex + 1, 6).setValue(membersList.join(', '));

      answerCallback(cq.id, '✅ Вы успешно присоединены к проекту!', false);
      editTelegramMessage(cq.message.chat.id, cq.message.message_id, `🎉 <b>${esc(studentName)}</b> принял(а) приглашение и зачислен(а) в проект <b>«${esc(projectName)}»</b>!`);
    }

  } catch (err) {
    Logger.log('Callback error: ' + err);
  } finally {
    lock.releaseLock();
  }
}

// Старая система (enroll) для совместимости
function handleCallbackQueryEnroll(cq) {
  const data = cq.data || '';
  const parts = data.split(':');
  const projectId = parts[1];
  const fromId = cq.from.id;
  const fromName = [cq.from.first_name, cq.from.last_name].filter(Boolean).join(' ') || ('@' + (cq.from.username || fromId));

  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);

    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const projSheet = ss.getSheetByName(SHEET_NAMES.projects);
    const studSheet = ss.getSheetByName(SHEET_NAMES.studentProjects);
    
    const projData = projSheet.getDataRange().getValues();
    
    let rowIndex = -1;
    for (let i = 1; i < projData.length; i++) {
      if (String(projData[i][0]) === String(projectId)) { rowIndex = i; break; }
    }

    if (rowIndex === -1) {
      answerCallback(cq.id, '❌ Проект не найден.', true);
      return;
    }

    const row = projData[rowIndex];
    const projectName = row[1];
    const subject = row[2];
    const maxCap = Number(row[3]) || 0;
    const curCount = Number(row[4]) || 0;
    const status = row[7] || 'Active';

    if (status === 'Expired' || status === 'Archived') {
      answerCallback(cq.id, '⚠️ Дедлайн проекта истек. Запись закрыта!', true);
      return;
    }

    if (curCount >= maxCap) {
      answerCallback(cq.id, '⚠️ В этой команде больше нет мест!', true);
      return;
    }

    const studentData = studSheet.getDataRange().getValues();
    const isEnrolled = studentData.slice(1).some(r => String(r[0]) === String(fromId) && String(r[3]) === String(projectName));
    
    if (isEnrolled) {
      answerCallback(cq.id, 'Вы уже состоите в этой команде! ✅', false);
      return;
    }

    projSheet.getRange(rowIndex + 1, 5).setValue(curCount + 1);
    studSheet.appendRow([fromId, fromName, subject, projectName, new Date().toISOString()]);

    answerCallback(cq.id, '✅ Вы успешно записаны в команду «' + projectName + '»!', false);

  } catch (err) {
    Logger.log('Enroll callback error: ' + err);
  } finally {
    lock.releaseLock();
  }
}

// ============================================================
// Telegram API Helpers
// ============================================================

function sendTelegramMessage(chatId, threadId, text, buttons) {
  const payload = {
    chat_id: chatId,
    text: text,
    parse_mode: 'HTML'
  };

  if (threadId) payload.message_thread_id = threadId;
  if (buttons && buttons.length > 0) payload.reply_markup = { inline_keyboard: buttons };

  UrlFetchApp.fetch('https://api.telegram.org/bot' + BOT_TOKEN + '/sendMessage', {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });
}

function sendTelegramReply(chatId, threadId, text, buttons, replyToMsgId) {
  const payload = {
    chat_id: chatId,
    text: text,
    parse_mode: 'HTML',
    allow_sending_without_reply: true
  };

  if (replyToMsgId) payload.reply_to_message_id = replyToMsgId;
  if (threadId !== undefined && threadId !== null) payload.message_thread_id = threadId;
  if (buttons && buttons.length > 0) payload.reply_markup = { inline_keyboard: buttons };

  UrlFetchApp.fetch('https://api.telegram.org/bot' + BOT_TOKEN + '/sendMessage', {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });
}

function editTelegramMessage(chatId, messageId, text) {
  const payload = {
    chat_id: chatId,
    message_id: messageId,
    text: text,
    parse_mode: 'HTML'
  };

  UrlFetchApp.fetch('https://api.telegram.org/bot' + BOT_TOKEN + '/editMessageText', {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });
}

function answerCallback(callbackQueryId, text, showAlert) {
  const payload = {
    callback_query_id: callbackQueryId,
    text: text,
    show_alert: !!showAlert
  };

  UrlFetchApp.fetch('https://api.telegram.org/bot' + BOT_TOKEN + '/answerCallbackQuery', {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });
}

// ============================================================
// Webhook Setup
// ============================================================

function setupWebhook() {
  // Берём ссылку напрямую из константы WEBHOOK_URL
  const webAppUrl = WEBHOOK_URL;
  
  if (!webAppUrl || webAppUrl.indexOf('/exec') === -1 || webAppUrl.includes('ВАША_СКОПИРОВАННАЯ_ССЫЛКА')) {
    Logger.log('ОШИБКА: Укажите корректную ссылку /exec в переменной WEBHOOK_URL вверху файла!');
    return;
  }

  const telegramApiUrl = 'https://api.telegram.org/bot' + BOT_TOKEN + '/setWebhook?url=' + encodeURIComponent(webAppUrl) + (WEBHOOK_SECRET ? '?token=' + encodeURIComponent(WEBHOOK_SECRET) : '');
  
  const response = UrlFetchApp.fetch(telegramApiUrl);
  Logger.log('Результат привязки вебхука: ' + response.getContentText());
}

function deleteWebhook() {
  const response = UrlFetchApp.fetch('https://api.telegram.org/bot' + BOT_TOKEN + '/deleteWebhook', {
    method: 'post',
    muteHttpExceptions: true
  });
  Logger.log('Webhook deleted: ' + response.getContentText());
}

function checkWebhookInfo() {
  const response = UrlFetchApp.fetch('https://api.telegram.org/bot' + BOT_TOKEN + '/getWebhookInfo', {
    method: 'get',
    muteHttpExceptions: true
  });
  Logger.log('Webhook info: ' + response.getContentText());
}

// ============================================================
// Utility Functions
// ============================================================

function esc(str) {
  return String(str == null ? '' : str).replace(/[&<>]/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c];
  });
}

function normalizeDateString(value) {
  if (!value) return '';
  const d = new Date(value);
  if (isNaN(d.getTime())) return String(value || '').trim();
  return Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyy-MM-dd');
}

function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

// ============================================================
// Schedule & Deadline Helpers
// ============================================================

function getMondayOf(date) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = (day === 0 ? -6 : 1) - day;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function getWeekTypeForDate(date) {
  const anchorMonday = getMondayOf(new Date(SCHEDULE_ANCHOR_MONDAY + 'T00:00:00'));
  const targetMonday = getMondayOf(date);
  const diffWeeks = Math.round((targetMonday - anchorMonday) / (7 * 24 * 60 * 60 * 1000));
  const parity = ((diffWeeks % 2) + 2) % 2;
  return parity === 0 ? SCHEDULE_ANCHOR_WEEK_TYPE : (SCHEDULE_ANCHOR_WEEK_TYPE === 1 ? 2 : 1);
}

function getTasksForDate(date) {
  const dateStr = Utilities.formatDate(date, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  const dayName = DAY_NAMES[date.getDay()];
  const weekType = getWeekTypeForDate(date);
  const tasks = [];

  getSheetData(SHEET_NAMES.schedule).forEach(function (r) {
    const type = String(r.Type || '').toLowerCase();
    const isDeadlineType = type.indexOf('дедлайн') > -1 || type.indexOf('дз') > -1 || type.indexOf('deadline') > -1;
    if (!isDeadlineType) return;
    if (String(r.Day || '').trim() !== dayName) return;
    if (Number(r.WeekType) !== weekType) return;
    tasks.push({ subject: r.Subject || '', task: r.Task || '', due: dateStr });
  });

  getSheetData(SHEET_NAMES.homeworkPool).forEach(function (r) {
    if (normalizeDateString(r.Deadline_Date) === dateStr) {
      tasks.push({ subject: r.Subject || '', task: r.Task_Description || '', due: dateStr });
    }
  });

  return tasks;
}

function formatTaskLines(tasks) {
  return tasks.map(function (t) {
    return '• <b>[' + esc(t.subject) + ']</b>: ' + esc(t.task) + ' (' + t.due + ')';
  });
}

function checkAndSend3DayReminders() {
  const target = addDays(new Date(), 3);
  const tasks = getTasksForDate(target);
  if (!tasks.length) {
    Logger.log('No tasks due in 3 days');
    return;
  }
  const message = '⏰ <b>Напоминание: через 3 дня (' + normalizeDateString(target) + ') сдача:</b>\n\n' +
    formatTaskLines(tasks).join('\n');
  sendTelegramMessage(CHAT_ID, TOPIC_ID, message, null);
}

// ============================================================
// Sheet Management
// ============================================================

function setupSheets() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  ensureSheet(ss, SHEET_NAMES.deadlines, ['Subject', 'Task', 'Date', 'Type', 'Credits', 'Points', 'Link']);
  ensureSheet(ss, SHEET_NAMES.projects, ['Project_ID', 'Project_Name', 'Subject', 'Max_Capacity', 'Current_Count', 'Deadline', 'Telegram_Msg_Link', 'Status']);
  ensureSheet(ss, SHEET_NAMES.studentProjects, ['Telegram_ID', 'Student_Name', 'Subject', 'Project_Name', 'Timestamp']);
  ensureSheet(ss, SHEET_NAMES.homeworkPool, ['ID', 'Subject', 'Task_Description', 'Deadline_Date', 'Created_At', 'Status']);
}

function ensureSheet(ss, name, headers) {
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.appendRow(headers);
    sheet.setFrozenRows(1);
    Logger.log('Created sheet: ' + name);
  }
}

function updateExpiredStatuses() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const todayStr = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');

  const projSheet = ss.getSheetByName(SHEET_NAMES.projects);
  if (projSheet) {
    const projData = projSheet.getDataRange().getValues();
    if (projData.length > 1) {
      const headers = projData[0].map(h => String(h).trim());
      const deadlineCol = headers.indexOf('Deadline');
      let statusCol = headers.indexOf('Status');

      if (statusCol === -1) {
        statusCol = headers.length;
        projSheet.getRange(1, statusCol + 1).setValue('Status');
      }

      for (let i = 1; i < projData.length; i++) {
        const rowDateStr = normalizeDateString(projData[i][deadlineCol]);
        const currentStatus = projData[i][statusCol];

        if (rowDateStr && rowDateStr < todayStr && currentStatus !== 'Expired' && currentStatus !== 'Archived') {
          projSheet.getRange(i + 1, statusCol + 1).setValue('Expired');
        }
      }
    }
  }
}

// ============================================================
// Form Submission Handlers
// ============================================================

function onFormSubmit(e) {
  try {
    if (!e || !e.namedValues) return;
    
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);

    // Form 1: Deadline submission
    const taskDesc = firstValue(e.namedValues, ['Task Description', 'Задание', 'Task']);
    if (taskDesc) {
      const subject = firstValue(e.namedValues, ['Subject', 'Предмет']);
      const dueDate = firstValue(e.namedValues, ['Due Date', 'Дедлайн', 'Deadline', 'Date']);
      
      const hwSheet = ss.getSheetByName(SHEET_NAMES.homeworkPool);
      if (hwSheet) {
        const newId = 'HW-' + new Date().getTime();
        hwSheet.appendRow([newId, subject, taskDesc, dueDate, new Date().toISOString(), 'Active']);
      }
    }

    // Form 2: Project submission by admin
    const projectName = firstValue(e.namedValues, ['Project Name', 'Название проекта', 'Project_Name']);
    if (projectName) {
      const subject = firstValue(e.namedValues, ['Subject', 'Предмет']);
      const maxCap = firstValue(e.namedValues, ['Max Capacity', 'Макс. вместимость', 'Max_Capacity']) || 4;
      const deadline = firstValue(e.namedValues, ['Deadline', 'Дедлайн', 'Дата']);
      const link = firstValue(e.namedValues, ['Telegram Link', 'Ссылка', 'Telegram_Msg_Link']) || '';

      const projSheet = ss.getSheetByName(SHEET_NAMES.projects);
      if (projSheet) {
        const newProjId = 'P-' + Math.floor(Math.random() * 8999 + 1000);
        projSheet.appendRow([newProjId, projectName, subject, Number(maxCap), 0, deadline, link, 'Active']);
        Logger.log('Project added: ' + projectName);
      }
    }

  } catch (err) {
    Logger.log('Form submit error: ' + err);
  }
}

function onSpreadsheetFormSubmit(e) {
  if (!e || !e.range) return;

  const sheetName = e.range.getSheet().getName();
  const lock = LockService.getScriptLock();
  
  if (lock.tryLock(10000)) {
    try {
      if (sheetName === CONFIG.SHEETS.RESPONSES_DEADLINES || sheetName.includes('Ответы на форму 1')) {
        processDeadlineSubmission(e);
      } else if (sheetName === CONFIG.SHEETS.RESPONSES_PROJECTS || sheetName.includes('Ответы на форму 2')) {
        processTeamSubmission(e);
      }
    } catch (err) {
      Logger.log('Form submit error: ' + err.toString());
    } finally {
      lock.releaseLock();
    }
  }
}

function processDeadlineSubmission(e) {
  const values = e.values;
  if (!values || values.length < 4) return;
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(CONFIG.SHEETS.DEADLINES);

  let formattedDate = values[3];
  if (values[3]) {
    const parsed = new Date(values[3]);
    if (!isNaN(parsed.getTime())) {
      formattedDate = Utilities.formatDate(parsed, ss.getSpreadsheetTimeZone(), 'yyyy-MM-dd');
    }
  }
  sheet.appendRow([values[1], values[2], formattedDate, values[4] || 'Дедлайн', values[5], values[6], values[7]]);
}

function processTeamSubmission(e) {
  const values = e.values;
  if (!values || values.length < 4) return;

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const projectsSheet = ss.getSheetByName(CONFIG.SHEETS.PROJECTS);
  const studentProjectsSheet = ss.getSheetByName(CONFIG.SHEETS.STUDENT_PROJECTS);

  const leaderName = (values[1] || '').trim();
  const subject = (values[2] || '').trim();
  const projectName = (values[3] || '').trim();

  const applicants = [leaderName, values[4], values[5], values[6]]
    .map(v => (v || '').trim())
    .filter(v => v.length > 0);

  if (!projectName || applicants.length === 0) return;

  const projectsData = projectsSheet.getDataRange().getValues();
  let projectRow = -1, maxCap = 0, curCount = 0;

  for (let i = 1; i < projectsData.length; i++) {
    if (String(projectsData[i][1]).trim() === projectName) {
      projectRow = i + 1;
      maxCap = Number(projectsData[i][3]) || 0;
      curCount = Number(projectsData[i][4]) || 0;
      break;
    }
  }

  if (projectRow === -1) return;

  const freeSpace = maxCap - curCount;
  if (freeSpace > 0) {
    const accepted = applicants.slice(0, freeSpace);
    const now = new Date().toISOString();

    accepted.forEach(student => {
      studentProjectsSheet.appendRow(['', student, subject, projectName, now]);
    });

    const newCount = curCount + accepted.length;
    projectsSheet.getRange(projectRow, 5).setValue(newCount);

    if (newCount >= maxCap) {
      removeProjectFromFormChoices(projectName);
    }
  }
}

function firstValue(namedValues, keys) {
  for (let i = 0; i < keys.length; i++) {
    if (namedValues[keys[i]] && namedValues[keys[i]][0]) return namedValues[keys[i]][0];
  }
  return '';
}

function syncFormOptionsWithSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const projectsSheet = ss.getSheetByName('Projects');
  if (!projectsSheet) return;

  const data = projectsSheet.getDataRange().getValues();
  const activeProjects = [];

  for (let i = 1; i < data.length; i++) {
    const projectName = String(data[i][1]).trim();
    const maxCapacity = Number(data[i][3]) || 0;
    const currentCount = Number(data[i][4]) || 0;
    const status = String(data[i][7] || 'Active').trim();

    if (projectName && currentCount < maxCapacity && status !== 'Archived') {
      activeProjects.push(projectName);
    }
  }

  if (!CONFIG.TEAM_FORM_ID || CONFIG.TEAM_FORM_ID.includes('YOUR_')) return;

  try {
    const form = FormApp.openById(CONFIG.TEAM_FORM_ID);
    const items = form.getItems();

    items.forEach(item => {
      const type = item.getType();
      if (type === FormApp.ItemType.LIST || type === FormApp.ItemType.MULTIPLE_CHOICE) {
        if (item.getTitle().toLowerCase().includes('проект')) {
          const choiceItem = type === FormApp.ItemType.LIST ? item.asListItem() : item.asMultipleChoiceItem();
          
          if (activeProjects.length > 0) {
            choiceItem.setChoiceValues(activeProjects);
          } else {
            choiceItem.setChoiceValues(['Нет доступных проектов']);
          }
        }
      }
    });
    Logger.log('Form options synced');
  } catch (err) {
    Logger.log('Sync error: ' + err.toString());
  }
}

function removeProjectFromFormChoices(projectName) {
  if (!CONFIG.TEAM_FORM_ID || CONFIG.TEAM_FORM_ID.includes('YOUR_')) return;

  try {
    const form = FormApp.openById(CONFIG.TEAM_FORM_ID);
    const items = form.getItems();

    items.forEach(item => {
      const type = item.getType();
      if (type === FormApp.ItemType.LIST || type === FormApp.ItemType.MULTIPLE_CHOICE) {
        if (item.getTitle().toLowerCase().includes('проект')) {
          const choiceItem = type === FormApp.ItemType.LIST ? item.asListItem() : item.asMultipleChoiceItem();
          const updatedChoices = choiceItem.getChoices().filter(c => c.getValue().trim() !== projectName.trim());

          if (updatedChoices.length > 0) {
            choiceItem.setChoices(updatedChoices);
          } else {
            choiceItem.setChoiceValues(['Все проекты забиты!']);
          }
        }
      }
    });
  } catch (err) {
    Logger.log('Form update error: ' + err.toString());
  }
}











